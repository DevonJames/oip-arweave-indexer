const { Client } = require('@elastic/elasticsearch');
const Arweave = require('arweave');
const { getTransaction, getBlockHeightFromTxId, getCurrentBlockHeight } = require('./arweave');
// const { resolveRecords, getLineNumber } = require('../helpers/utils');
const { setIsProcessing } = require('../helpers/processingState');  // Adjust the path as needed
const arweaveConfig = require('../config/arweave.config');
const arweave = Arweave.init(arweaveConfig);
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key_here';
const semver = require('semver');
const { gql, GraphQLClient } = require('graphql-request');
const { validateTemplateFields, verifySignature, getTemplateTxidByName, txidToDid, getLineNumber, resolveRecords } = require('./utils');
const recordTypeIndexConfig = require('../config/recordTypesToIndex');
const http = require('http');
const https = require('https');

// Helper function for async filtering
async function asyncFilter(array, predicate) {
    const results = await Promise.all(array.map(predicate));
    return array.filter((_, index) => results[index]);
}

// Check organization membership for record access
async function checkOrganizationMembershipForRecord(userPublicKey, sharedWithArray, requestInfo) {
    const { OrganizationEncryption } = require('./organizationEncryption');
    const orgEncryption = new OrganizationEncryption();
    
    // Check membership for any organization in the shared_with array
    for (const organizationDid of sharedWithArray) {
        try {
            const isMember = await orgEncryption.isUserOrganizationMember(userPublicKey, organizationDid, requestInfo);
            if (isMember) {
                return true; // User is member of at least one organization
            }
        } catch (error) {
            console.error(`Error checking membership for ${organizationDid}:`, error);
            continue;
        }
    }
    
    return false; // User is not member of any organization
}
// const { sign } = require('crypto');
// const { get } = require('http');
const path = require('path');
const fs = require('fs');
const e = require('express');
// const { loadRemapTemplates, remapRecordData } = require('./templateHelper'); // Use updated remap functions
// let startBlockHeight = 1463762

let startBlockHeight = 1579580;

// Note: Elasticsearch client (v8+) uses Undici and manages connection pooling internally
// The custom HTTP agent configuration is not compatible with newer ES clients
// Connection pooling is handled automatically by the client
//
// NOTE: Periodic ES client recreation was DISABLED as it caused connection failures
// and was not the source of the memory leak. The GraphQL client is the real culprit.

const elasticClient = new Client({
    node: process.env.ELASTICSEARCHHOST || 'http://elasticsearch:9200',
    auth: {
        username: process.env.ELASTICCLIENTUSERNAME,
        password: process.env.ELASTICCLIENTPASSWORD
    },
    maxRetries: 3,
    requestTimeout: 30000
});

console.log('✅ [ES Client] Created Elasticsearch client');

// MEMORY LEAK FIX: Configure GraphQL client for Arweave with non-persistent connections
// This prevents socket accumulation from graphql-request library
let graphQLClient = null;
let graphQLClientCreatedAt = null;
const GRAPHQL_CLIENT_RECREATION_INTERVAL = parseInt(process.env.GRAPHQL_CLIENT_RECREATION_INTERVAL) || 1800000; // 30 minutes

function createGraphQLClient() {
    if (graphQLClient) {
        console.log('🔄 [GraphQL Client] Disposing old GraphQL client');
        graphQLClient = null; // graphql-request doesn't have explicit close method
    }
    
    // Create HTTP agent with keepAlive: false to prevent socket leaks
    const httpAgent = new http.Agent({
        keepAlive: false,
        maxSockets: 50,
        maxFreeSockets: 0,
        timeout: 30000
    });
    
    const httpsAgent = new https.Agent({
        keepAlive: false,
        maxSockets: 50,
        maxFreeSockets: 0,
        timeout: 30000
    });
    
    graphQLClient = new GraphQLClient('https://arweave.net/graphql', {
        agent: (url) => url.protocol === 'https:' ? httpsAgent : httpAgent,
        timeout: 30000
    });
    
    graphQLClientCreatedAt = Date.now();
    console.log(`✅ [GraphQL Client] Created new GraphQL client (will recreate every ${GRAPHQL_CLIENT_RECREATION_INTERVAL / 60000} minutes)`);
    
    return graphQLClient;
}

function checkAndRecreateGraphQLClient() {
    if (!graphQLClient || !graphQLClientCreatedAt) {
        return createGraphQLClient();
    }
    
    const clientAge = Date.now() - graphQLClientCreatedAt;
    if (clientAge > GRAPHQL_CLIENT_RECREATION_INTERVAL) {
        const ageMinutes = Math.round(clientAge / 60000);
        console.log(`🔄 [GraphQL Client] Recreating client (age: ${ageMinutes} minutes, threshold: ${GRAPHQL_CLIENT_RECREATION_INTERVAL / 60000} minutes)`);
        return createGraphQLClient();
    }
    
    return graphQLClient;
}

// Initialize GraphQL client
createGraphQLClient();

// Check GraphQL client age periodically
setInterval(() => {
    checkAndRecreateGraphQLClient();
}, 300000); // Check every 5 minutes

// Helper function for backward-compatible DID queries
function createDIDQuery(targetDid) {
    return {
        bool: {
            should: [
                { term: { "oip.did": targetDid } },
                { term: { "oip.didTx": targetDid } }
            ]
        }
    };
}

function getFileInfo() {
    const filename = path.basename(__filename);
    const directory = path.basename(__dirname);
    return `${directory}/${filename}`;
}

/**
 * Function to load remap templates from the file system.
 * @param {String} templateName - The name of the template to load.
 * @returns {Object|null} - The remap template object or null if not found.
 */
const loadRemapTemplates = (templateName) => {
    const templatePath = path.resolve(__dirname, '../remapTemplates', `${templateName}.json`);
    if (fs.existsSync(templatePath)) {
        return JSON.parse(fs.readFileSync(templatePath, 'utf-8'));
    } else {
        console.error(`Template file not found: ${templatePath}`);
        return null;
    }
};

/**
 * This function handles remapping existing records based on the provided templates.
 * @param {Array<String>} remapTemplates - The names of templates to remap.
 */
async function remapExistingRecords(remapTemplates) {
    console.log(`Starting remapping process for templates: ${remapTemplates.join(', ')}`);

    // Load remap templates
    const remapTemplateData = {};
    for (const templateName of remapTemplates) {
        const template = loadRemapTemplates(templateName);
        if (!template) {
            console.error(`Remap template ${templateName} not found. Skipping...`);
            continue;
        }
        remapTemplateData[templateName] = template;
    }

    // Fetch records from the database
    const { records } = await getRecordsInDB(); // Fetch all records (filtered later)
    if (!records || records.length === 0) {
        console.log('No records found in the database.');
        return;
    }
console.log('54 remapTemplates:', remapTemplates);
// Process each record
for (const record of records) {
    // Check if the recordType matches any of the remap templates
    const recordType = record.oip.recordType;
    if (!remapTemplates.includes(recordType)) {
        continue; // Skip records that don't match the specified remap templates
    }

    // Remap the record data
    const remappedRecord = remapRecordData(record, remapTemplateData[recordType], recordType);
    console.log(`Remapped record`, remappedRecord);

    // Reindex the remapped record
    if (remappedRecord) {
        console.log(`Reindexing remapped record ${record.oip.didTx}`);
        await indexRecord(remappedRecord);
    }
}

    console.log('Remapping process complete.');
}

/**
 * This function remaps a record based on the provided remap template.
 * @param {Object} record - The expanded record to be remapped.
 * @param {Object} remapTemplate - The remap template with field mappings.
 * @returns {Object} The remapped record.
 */

function remapRecordData(record, remapTemplate, templateName) {
    const remappedData = {}; // This will hold the remapped fields for the template

    // Go through each key in the remap template and remap fields accordingly
    for (const [newField, oldFieldPath] of Object.entries(remapTemplate)) {
        const fieldParts = oldFieldPath.split('.'); // Split the path to access nested fields
        let fieldValue;

        // console.log(`Remapping ${newField} using path ${oldFieldPath}`);

        // Iterate through the 'data' array to find the relevant object that contains the field
        for (const dataObj of record.data) {
            fieldValue = dataObj;

            // Traverse the path within each object in the 'data' array
            for (const part of fieldParts) {
                console.log(`X Traversing part: ${part}`, fieldValue);
                if (fieldValue && typeof fieldValue === 'object' && part in fieldValue) {
                    fieldValue = fieldValue[part];
                } else {
                    fieldValue = undefined; // If any part of the path doesn't exist, set undefined
                    break;
                }
            }

            // If the field was found, break out of the loop
            if (fieldValue !== undefined) {
                break;
            }
        }

        // Set the new field in the remappedData if the field was found
        if (fieldValue !== undefined) {
            remappedData[newField] = fieldValue;
        } else {
            console.warn(`Field ${oldFieldPath} not found in record`);
        }
    }

    // Ensure templateName is properly used here and isn't undefined
    if (!templateName) {
        console.error(`templateName is undefined or invalid`);
        return null; // Don't process further if templateName is invalid
    }

    // Construct the final remapped record by replacing the entire 'data' array
    const remappedRecord = {
        data: [
            { [templateName]: remappedData }  // Replace the data array with the remapped data only
        ],
        oip: {
            ...record.oip,
            recordStatus: "remapped" // Set status to remapped
        }
    };

    return remappedRecord;
}

// Search for records by specific fields
async function searchByField(index, field, value) {
    try {
        const searchResponse = await elasticClient.search({
            index,
            body: { query: { match: { [field]: value } } }
        });
        return searchResponse.hits.hits.map(hit => hit._source);
    } catch (error) {
        console.error(`Error searching ${index} by ${field}:`, error);
        return [];
    }
}

const findTemplateByTxId = (txId, templates) => {
    return templates.find(template => template.data.TxId === txId);
};

const searchRecordByTxId = async (txid) => {
    // console.log('searching by txid:', txid);
    try {
        const searchResponse = await elasticClient.search({
            index: 'records',
            body: {
                query: createDIDQuery("did:arweave:" + txid)
            }
        });

        if (searchResponse.hits.hits.length > 0) {
            return searchResponse.hits.hits[0]._source;
        } else {
            console.log(getFileInfo(), getLineNumber(), 'No record found for txid:', txid);
            return null;
        }
    } catch (error) {
        console.error(getFileInfo(), getLineNumber(), 'Error searching for record by txid:', error);
        throw error;
    }
};

const translateOIPDataToJSON = async (record, template) => {
    if (!template) return null;

    const fields = JSON.parse(template.data.fields);
    const indexToFieldMap = {};
    const enumIndexMappings = {};

    // Build the index-to-field map
    for (const fieldName in fields) {
        const indexKey = `index_${fieldName}`;
        const fieldType = fields[fieldName];

        if (typeof fields[indexKey] !== "undefined") {
            indexToFieldMap[fields[indexKey]] = fieldName;

            // Map enum values if applicable
            if (fieldType === "enum" && Array.isArray(fields[`${fieldName}Values`])) {
                enumIndexMappings[fieldName] = fields[`${fieldName}Values`].map((item) => item.name);
            }
        }
    }

    // console.log("Index-to-Field Map:", indexToFieldMap);

    const translatedRecord = {};
    // console.log("Translating Record:", record);

    for (const [key, value] of Object.entries(record)) {
        if (key === "t") {
            translatedRecord["templateTxId"] = value;
            continue;
        }

        const fieldName = indexToFieldMap[key];
        const fieldType = fields[fieldName];

        if (!fieldName) {
            console.log(`Field with index ${key} not found in template`);
            continue;
        }

        // Handle `repeated` fields (arrays)
        if (fieldType && fieldType.startsWith("repeated")) {
            if (Array.isArray(value)) {
                translatedRecord[fieldName] = value.map((item) => {
                    if (fieldType.includes("uint64")) return parseInt(item, 10);
                    if (fieldType.includes("float")) return parseFloat(item);
                    return item; // Default for strings or other types
                });
            } else {
                console.log(`Invalid data for repeated field: ${fieldName}`, value);
            }
        } else if (fieldType === "uint64") {
            // Handle scalar uint64 fields
            if (typeof value === "string" || typeof value === "number") {
                translatedRecord[fieldName] = parseInt(value, 10);
            } else {
                console.log(`Invalid uint64 value for field: ${fieldName}`, value);
            }
        } else if (fieldType === "float") {
            // Handle scalar float fields
            if (typeof value === "string" || typeof value === "number") {
                translatedRecord[fieldName] = parseFloat(value);
            } else {
                console.log(`Invalid float value for field: ${fieldName}`, value);
            }
        } else if (fieldName in enumIndexMappings && typeof value === "number") {
            // Handle enums
            translatedRecord[fieldName] = enumIndexMappings[fieldName][value] || null;
        } else {
            // Handle all other scalar fields
            translatedRecord[fieldName] = value;
        }
    }

    translatedRecord.template = template.data.template;
    // console.log("Translated Record:", translatedRecord);
    return translatedRecord;
};

const expandData = async (compressedData, templates) => {
    const records = JSON.parse(compressedData);
    // console.log('es 68 records:', records);

    const expandedRecords = await Promise.all(records.map(async record => {
        // console.log('es 72 record:', record.t);
        
        // Skip translation for delete and deleteTemplate messages
        if (record.delete || record.deleteTemplate) {
            console.log('Skipping template translation for delete/deleteTemplate message');
            return null;
        }

        let template = findTemplateByTxId(record.t, templates);
        // console.log('es 70 template:', record.t, template);

        let jsonData = await translateOIPDataToJSON(record, template);
        if (!jsonData) {
            console.log('Template translation failed for record:', record);
            return null;
        }

        let expandedRecord = {
            [jsonData.template]: { ...jsonData }
        };

        // Remove internal fields
        delete expandedRecord[jsonData.template].templateTxId;
        delete expandedRecord[jsonData.template].template;

        return expandedRecord;
    }));

    // console.log('es 290 expandedRecords:', expandedRecords);
    return expandedRecords.filter(record => record !== null);
};

const ensureIndexExists = async () => {
    try {
        let templatesExists;
        try {
            const existsResponse = await elasticClient.indices.exists({ index: 'templates' });
            templatesExists = existsResponse.body !== undefined ? existsResponse.body : existsResponse;
            // console.log('🔍 Templates index exists check:', templatesExists);
        } catch (existsError) {
            console.log('❌ Error checking templates index existence:', existsError.message);
            templatesExists = false; // Assume it doesn't exist if we can't check
        }
        
        if (!templatesExists) {
            // console.log('📝 Creating new templates index with correct mapping...');
            try {
                await elasticClient.indices.create({
                    index: 'templates',
                    body: {
                        settings: {
                            'mapping.total_fields.limit': 5000,  // Increase field limit from 1000 to 5000
                            'mapping.nested_fields.limit': 100,  // Increase nested field limit
                            'mapping.nested_objects.limit': 10000  // Increase nested objects limit
                        },
                        mappings: {
                            properties: {
                                data: {
                                    type: 'object',
                                    properties: {
                                        TxId: { type: 'text' },
                                        template: { type: 'text' },
                                        fields: { type: 'text' },
                                        fieldsInTemplate: { 
                                            type: 'object',
                                            dynamic: true,
                                            enabled: true
                                        },
                                        fieldsInTemplateCount: { type: 'integer' },
                                        creator: { type: 'text' },
                                        creatorSig: { type: 'text' }
                                    }
                                },
                                oip: {
                                    type: 'object',
                                    properties: {
                                        didTx: { type: 'keyword' },
                                        inArweaveBlock: { type: 'long' },
                                        indexedAt: { type: 'date' },
                                        recordStatus: { type: 'text' },
                                        ver: { type: 'text' },
                                        creator: {
                                            type: 'object',
                                            properties: {
                                                creatorHandle: { type: 'text' },
                                                didAddress: { type: 'text' },
                                                didTx: { type: 'text' },
                                                publicKey: { type: 'text' }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                });
                console.log('✅ Templates index created with correct mapping');
                
                // Show the created mapping
                const newMapping = await elasticClient.indices.getMapping({ index: 'templates' });
                console.log('📋 New templates mapping structure:', JSON.stringify(newMapping.body.templates.mappings.properties.data.properties.fieldsInTemplate, null, 2));
                
            } catch (error) {
                if (error.meta && error.meta.body && error.meta.body.error && error.meta.body.error.type !== "resource_already_exists_exception") {
                    console.error('❌ Error creating templates index:', error.message);
                    throw error;
                }
                // console.log('✅ Templates index already exists (resource_already_exists_exception)');
            }
        } else {
            // console.log('✅ Templates index already exists');
        }
        const recordsExists = await elasticClient.indices.exists({ index: 'records' });
        if (!recordsExists.body) {
            try {
                await elasticClient.indices.create({
                    index: 'records',
                    body: {
                        settings: {
                            'mapping.total_fields.limit': 5000,  // Increase field limit from 1000 to 5000
                            'mapping.nested_fields.limit': 100,  // Increase nested field limit
                            'mapping.nested_objects.limit': 10000  // Increase nested objects limit
                        },
                        mappings: {
                            properties: {
                                data: { type: 'nested' },
                                oip: {
                                    type: 'object',
                                    properties: {
                                        recordType: { type: 'text' },
                                        didTx: { type: 'keyword' },
                                        inArweaveBlock: { type: 'long' },
                                        indexedAt: { type: 'date' },
                                        ver: { type: 'text' },
                                        signature: { type: 'text' },
                                        creator: {
                                            type: 'object',
                                            properties: {
                                                creatorHandle: { type: 'text' },
                                                didAddress: { type: 'text' },
                                                didTx: { type: 'text' }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                });
            } catch (error) {
                if (error.meta.body.error.type !== "resource_already_exists_exception") {
                    throw error;
                }
            }
        }
        const creatorsExists = await elasticClient.indices.exists({ index: 'creatorregistrations' });
        if (!creatorsExists.body) {
            try {
                await elasticClient.indices.create({
                    index: 'creatorregistrations',
                    body: {
                        mappings: {
                            properties: {
                                data: {
                                    type: 'object',
                                    properties: {
                                        publicKey: { type: 'text' },
                                        creatorHandle: { type: 'text' },
                                        didAddress: { type: 'text' },
                                        // didTx: { type: 'text' },
                                        name: { type: 'text' },
                                        surname: { type: 'text' },
                                        description: { type: 'text' },
                                        language: { type: 'text' },
                                        youtube: { type: 'text' },
                                        x: { type: 'text' },
                                        instagram: { type: 'text' },
                                        tiktok: { type: 'text' }
                                    }
                                },
                                oip: {
                                    type: 'object',
                                    properties: {
                                        didTx: { type: 'keyword' },
                                        inArweaveBlock: { type: 'long' },
                                        indexedAt: { type: 'date' },
                                        ver: { type: 'text' },
                                        creator: { type: 'object' }
                                    }
                                }
                            }
                        }
                    }
                });
            } catch (error) {
                if (error.meta.body.error.type !== "resource_already_exists_exception") {
                    throw error;
                }
            }
        }
        
        const organizationsExists = await elasticClient.indices.exists({ index: 'organizations' });
        if (!organizationsExists.body) {
            try {
                await elasticClient.indices.create({
                    index: 'organizations',
                    body: {
                        mappings: {
                            properties: {
                                data: {
                                    type: 'object',
                                    properties: {
                                        orgHandle: { type: 'text' },
                                        orgPublicKey: { type: 'text' },
                                        adminPublicKeys: { type: 'text' },
                                        membershipPolicy: { type: 'text' },
                                        metadata: { type: 'text' },
                                        didAddress: { type: 'text' },
                                        didTx: { type: 'text' }
                                    }
                                },
                                oip: {
                                    type: 'object',
                                    properties: {
                                        didTx: { type: 'keyword' },
                                        inArweaveBlock: { type: 'long' },
                                        indexedAt: { type: 'date' },
                                        ver: { type: 'text' },
                                        organization: { type: 'object' }
                                    }
                                }
                            }
                        }
                    }
                });
            } catch (error) {
                if (error.meta.body.error.type !== "resource_already_exists_exception") {
                    throw error;
                }
            }
        }
    } catch (error) {
        console.error("Error checking or creating index:", error);
        throw error;
    }
};

const ensureUserIndexExists = async () => {
    try {
        const indexExists = await elasticClient.indices.exists({ index: 'users' });
        console.log(`Index exists check for 'users':`, indexExists);  // Log existence check result
        
        if (!indexExists.body) {
            await elasticClient.indices.create({
                index: 'users',
                body: {
                    mappings: {
                        properties: {
                            email: { 
                                type: 'text',
                                fields: {
                                    keyword: {
                                        type: 'keyword',
                                        ignore_above: 256
                                    }
                                }
                            },
                            passwordHash: { type: 'text' },
                            subscriptionStatus: { 
                                type: 'text',
                                fields: {
                                    keyword: {
                                        type: 'keyword',
                                        ignore_above: 256
                                    }
                                }
                            },
                            paymentMethod: { 
                                type: 'text',
                                fields: {
                                    keyword: {
                                        type: 'keyword',
                                        ignore_above: 256
                                    }
                                }
                            },
                            createdAt: { type: 'date' },
                            publicKey: { 
                                type: 'text',
                                fields: {
                                    keyword: {
                                        type: 'keyword',
                                        ignore_above: 256
                                    }
                                }
                            },
                            encryptedPrivateKey: { type: 'text' },
                            encryptedMnemonic: { type: 'text' },
                            encryptedGunSalt: { type: 'text' },
                            keyDerivationPath: { type: 'text' },
                            waitlistStatus: { 
                                type: 'text',
                                fields: {
                                    keyword: {
                                        type: 'keyword',
                                        ignore_above: 256
                                    }
                                }
                            }
                        }
                    }
                }
            });
            console.log('Users index created successfully.');
        } else {
            console.log('Users index already exists, skipping creation.');
        }
    } catch (error) {
        if (error.meta && error.meta.body && error.meta.body.error && error.meta.body.error.type === 'resource_already_exists_exception') {
            console.log('Users index already exists (caught in error).');
        } else {
            console.error('Error creating users index:', error);
        }
    }
};

// General function to index a document
async function indexDocument(index, id, body) {
    try {
        const response = await elasticClient.index({ index, id, body, refresh: 'wait_for' });
        console.log(`Document ${response.result} in ${index} with ID: ${id}`);
    } catch (error) {
        console.error(`Error indexing document in ${index} with ID ${id}:`, error);
    }
}

// Process record to convert JSON strings back to arrays for Elasticsearch compatibility
const processRecordForElasticsearch = (record) => {
    const processedRecord = JSON.parse(JSON.stringify(record)); // Deep clone
    
    // Recursively convert JSON string arrays back to actual arrays for Elasticsearch
    const convertJSONStringsToArrays = (obj) => {
        if (obj === null || obj === undefined) return obj;
        
        if (typeof obj === 'string' && obj.startsWith('[') && obj.endsWith(']')) {
            try {
                // Try to parse as JSON array
                const parsed = JSON.parse(obj);
                if (Array.isArray(parsed)) {
                    return parsed;
                }
            } catch (e) { 
                // If parsing fails, return original string
                return obj;
            }
        }
        
        if (typeof obj === 'object' && !Array.isArray(obj)) {
            const converted = {};
            for (const [key, value] of Object.entries(obj)) {
                converted[key] = convertJSONStringsToArrays(value);
            }
            return converted;
        }
        
        if (Array.isArray(obj)) {
            return obj.map(item => convertJSONStringsToArrays(item));
        }
        
        return obj;
    };
    
    // Apply conversion to the entire record data
    if (processedRecord.data) {
        processedRecord.data = convertJSONStringsToArrays(processedRecord.data);
    }
    
    return processedRecord;
};

const indexRecord = async (record) => {
    const recordId = record?.oip?.did || record?.oip?.didTx;
    console.log(`\n      💾 [indexRecord] Attempting to index/update record: ${recordId}`);
    console.log(`      📊 [indexRecord] Record status: ${record?.oip?.recordStatus}`);
    try {
        // Enforce record type indexing policy as a safety net
        const typeForIndex = record?.oip?.recordType;
        if (typeForIndex && !shouldIndexRecordType(typeForIndex)) {
            console.log(`      ⏭️  [indexRecord] Skipping indexing for recordType '${typeForIndex}' per configuration.`);
            return;
        }
        
        // Use unified DID field as primary identifier, fallback to didTx for backward compatibility
        if (!recordId) {
            throw new Error('Record must have either oip.did or oip.didTx field');
        }
        
        const existingRecord = await elasticClient.exists({
            index: 'records',
            id: recordId
        });
        
        if (existingRecord.body) {
            console.log(`      🔄 [indexRecord] Found existing record, UPDATING it with confirmed blockchain data...`);
            // Update existing record - process for Elasticsearch compatibility
            const processedRecord = processRecordForElasticsearch(record);
            
            const response = await elasticClient.update({
                index: 'records',
                id: recordId,
                body: {
                    doc: {
                        ...processedRecord,
                        "oip.recordStatus": "original"
                    }
                },
                refresh: 'wait_for'
            });
            console.log(`      ✅ [indexRecord] Record UPDATED successfully: ${recordId} → status changed to "original" (${response.result})`);    
        } else {
            console.log(`      ➕ [indexRecord] No existing record found, CREATING new record...`);
            // Create new record - but first process any JSON string arrays for Elasticsearch compatibility
            const processedRecord = processRecordForElasticsearch(record);
            
            const response = await elasticClient.index({
                index: 'records',
                id: recordId, // Use unified DID as the ID
                body: processedRecord,
                refresh: 'wait_for' // Wait for indexing to be complete before returning
            });
            console.log(`      ✅ [indexRecord] Record CREATED successfully: ${recordId} (${response.result})`);
        }

    } catch (error) {
        console.error(`      ❌ [indexRecord] Error indexing record ${recordId}:`, error.message);
    }
};

const getTemplatesInDB = async () => {
    try {
        const searchResponse = await elasticClient.search({
            index: 'templates',
            body: {
                query: {
                    match_all: {}
                },
                size: 1000 // make this a variable to be passed in
            }
        });
        const templatesInDB = searchResponse.hits.hits.map(hit => hit._source);
        const qtyTemplatesInDB = templatesInDB.length;
        
        // Filter out templates with "pending confirmation in Arweave" status when calculating max block height
        // This ensures pending templates get re-processed when found confirmed on chain
        const confirmedTemplates = templatesInDB.filter(template => 
            template.oip.recordStatus !== "pending confirmation in Arweave"
        );
        const pendingTemplatesCount = templatesInDB.length - confirmedTemplates.length;
        if (pendingTemplatesCount > 0) {
            console.log(getFileInfo(), getLineNumber(), `Found ${pendingTemplatesCount} pending templates (will re-process when confirmed)`);
        }
        const maxArweaveBlockInDB = confirmedTemplates.length > 0 
            ? Math.max(...confirmedTemplates.map(template => template.oip.inArweaveBlock)) || 0
            : 0;
        const maxArweaveBlockInDBisNull = (maxArweaveBlockInDB === -Infinity);
        const finalMaxArweaveBlock = maxArweaveBlockInDBisNull ? 0 : maxArweaveBlockInDB;
        return { qtyTemplatesInDB, finalMaxArweaveBlock, templatesInDB };
    } catch (error) {
        console.error('Error retrieving templates from database:', error);
        return { qtyTemplatesInDB: 0, maxArweaveBlockInDB: 0, templatesInDB: [] };
    }
};

// Retrieve all templates from the database - might be deprecated already
async function getTemplates() {
    try {
        const response = await elasticClient.search({
            index: 'templates',
            body: { query: { match_all: {} }, size: 1000 }
        });
        return response.hits.hits.map(hit => hit._source);
    } catch (error) {
        console.error('Error retrieving templates:', error);
        return [];
    }
}

async function searchTemplateByTxId(templateTxid) {
    const searchResponse = await elasticClient.search({
        index: 'templates',
        body: {
            query: {
                match: { "data.TxId": templateTxid }
            }
        }
    });
    // console.log('1234 searchResponse hits hits:', searchResponse.hits.hits);
    
    // Check if any results were found
    if (searchResponse.hits.hits.length === 0) {
        console.log(`Template not found in database for TxId: ${templateTxid}`);
        return null;
    }
    
    template = searchResponse.hits.hits[0]._source;
    // console.log('12345 template:', template);
    return template
}

async function deleteRecordFromDB(creatorDid, transaction) {
    console.log(getFileInfo(), getLineNumber(), 'deleteRecordFromDB:', creatorDid)
    try {

        const parsedData = typeof transaction.data === 'string' 
            ? JSON.parse(transaction.data) 
            : transaction.data;
        
        // If parsedData is an array, extract the first element
        const dataToProcess = Array.isArray(parsedData) ? parsedData[0] : parsedData;
        
        didTxToDelete = dataToProcess.deleteTemplate?.didTx || dataToProcess.deleteTemplate?.did || dataToProcess.delete?.didTx || dataToProcess.delete?.did;
        console.log(getFileInfo(), getLineNumber(), 'didTxToDelete:', creatorDid, transaction.creator, transaction.data, { didTxToDelete })
        
        if (!didTxToDelete) {
            console.log(getFileInfo(), getLineNumber(), 'No target DID found in delete message:', parsedData);
            return;
        }
        
        if (creatorDid === 'did:arweave:' + transaction.creator) {
            console.log(getFileInfo(), getLineNumber(), 'same creator, deletion authorized')

            // First, search in the records index
            const recordsSearchResponse = await elasticClient.search({
                index: 'records',
                body: {
                    query: createDIDQuery(didTxToDelete)
                }
            });

            if (recordsSearchResponse.hits.hits.length > 0) {
                // Found in records index, delete it
                const recordId = recordsSearchResponse.hits.hits[0]._id;
                const response = await elasticClient.delete({
                    index: 'records',
                    id: recordId
                });
                console.log(getFileInfo(), getLineNumber(), 'Record deleted from records index:', response);
                return;
            }

            // If not found in records, search in organizations index
            console.log(getFileInfo(), getLineNumber(), 'Record not found in records index, checking organizations index');
            const organizationsSearchResponse = await elasticClient.search({
                index: 'organizations',
                body: {
                    query: createDIDQuery(didTxToDelete)
                }
            });

            if (organizationsSearchResponse.hits.hits.length > 0) {
                // Found in organizations index, delete it
                const orgId = organizationsSearchResponse.hits.hits[0]._id;
                const response = await elasticClient.delete({
                    index: 'organizations',
                    id: orgId
                });
                console.log(getFileInfo(), getLineNumber(), 'Organization deleted from organizations index:', response);
                return;
            }

            // If not found in either index, log and exit
            console.log(getFileInfo(), getLineNumber(), 'No record found with the specified ID in records or organizations indices:', didTxToDelete);
            return; // Exit the function early if no record is found

        } else {
            console.log(getFileInfo(), getLineNumber(), 'different creator, deletion unauthorized');
        }
    } catch (error) {
        console.error('Error deleting record:', error);
        throw error;
    }
}

async function checkTemplateUsage(templateTxId) {
    console.log(getFileInfo(), getLineNumber(), 'checkTemplateUsage:', templateTxId);
    try {
        // Get all records to check template usage
        const result = await getRecordsInDB();
        let records = result.records;
        
        // Filter records that use the specified template transaction ID
        const recordsUsingTemplate = records.filter(record => {
            // Check if record.oip.templates contains the templateTxId
            if (record.oip && record.oip.templates && typeof record.oip.templates === 'object') {
                // Check if any template in the templates object matches the templateTxId
                return Object.values(record.oip.templates).includes(templateTxId);
            }
            
            // No fallback logic - all records will be re-indexed with the new templates array
            return false;
        });
        
        console.log(getFileInfo(), getLineNumber(), 'Records using template:', recordsUsingTemplate.length);
        return recordsUsingTemplate.length > 0;
    } catch (error) {
        console.error('Error checking template usage:', error);
        throw error;
    }
}

async function deleteTemplateFromDB(creatorDid, transaction) {
    console.log(getFileInfo(), getLineNumber(), 'deleteTemplateFromDB:', creatorDid);
    try {
        const parsedData = typeof transaction.data === 'string' 
            ? JSON.parse(transaction.data) 
            : transaction.data;
        
        const didTxToDelete = parsedData.deleteTemplate?.didTx;
        
        console.log(getFileInfo(), getLineNumber(), 'template didTxToDelete:', creatorDid, transaction.creator, transaction.data, { didTxToDelete });
        
        if (creatorDid === 'did:arweave:' + transaction.creator) {
            console.log(getFileInfo(), getLineNumber(), 'same creator, template deletion authorized');

            // First, check if the template exists
            const searchResponse = await elasticClient.search({
                index: 'templates',
                body: {
                    query: createDIDQuery(didTxToDelete)
                }
            });

            if (searchResponse.hits.hits.length === 0) {
                console.log(getFileInfo(), getLineNumber(), 'No template found with the specified ID:', didTxToDelete);
                return;
            }

            const template = searchResponse.hits.hits[0]._source;
            const templateTxId = template.data.TxId;
            
            // Check if any records are using this template
            const templateInUse = await checkTemplateUsage(templateTxId);
            
            if (templateInUse) {
                console.log(getFileInfo(), getLineNumber(), 'Template is in use by existing records, deletion not allowed:', didTxToDelete);
                return { error: 'Template is in use by existing records and cannot be deleted' };
            }

            // If template is not in use, proceed with deletion
            const templateId = searchResponse.hits.hits[0]._id;

            const response = await elasticClient.delete({
                index: 'templates',
                id: templateId
            });
            
            console.log(getFileInfo(), getLineNumber(), 'Template deleted:', response);
            return { success: true, message: 'Template deleted successfully' };
        } else {
            console.log(getFileInfo(), getLineNumber(), 'different creator, template deletion unauthorized');
            return { error: 'Unauthorized: only the template creator can delete this template' };
        }
    } catch (error) {
        console.error('Error deleting template:', error);
        throw error;
    }
}

async function searchCreatorByAddress(didAddress) {
    // console.log(getFileInfo(), getLineNumber(), 'searchCreatorByAddress:', didAddress)
    try {
        const searchResponse = await elasticClient.search({
            index: 'creatorregistrations',
            body: {
                query: {
                    match: {
                        "oip.creator.didAddress": didAddress
                    }
                }
            }
        });

        if (searchResponse.hits.hits.length > 0) {
            const creatorRecord = searchResponse.hits.hits[0]._source;
            // console.log(getFileInfo(), getLineNumber(), 'Creator found for address:', didAddress);
            const creatorInfo = {
                data: { 
                    creatorHandle: creatorRecord.oip.creator.creatorHandle,
                    didAddress: creatorRecord.oip.creator.didAddress,
                    didTx: creatorRecord.oip.creator.didTx,
                    publicKey: creatorRecord.oip.creator.publicKey,
                  }
            }
            // console.log(getFileInfo(), getLineNumber(), 'Creator found for address:', didAddress, creatorInfo);
            return creatorInfo;
        } else {
            console.log(getFileInfo(), getLineNumber(), 'Error - No creator found in db for address:', didAddress);
            if (didAddress === 'did:arweave:u4B6d5ddggsotOiG86D-KPkeW23qQNdqaXo_ZcdI3k0') {
                console.log(getFileInfo(), getLineNumber(), 'Exception - creator is u4B6..., looking up registration data from hard-coded txid');
                const hardCodedTxId = 'eqUwpy6et2egkGlkvS7c5GKi0aBsCXT6Dhlydf3GA3Y';
                const inArweaveBlock = startBlockHeight;
                const transaction = await getTransaction(hardCodedTxId);
                const creatorSig = transaction.creatorSig;
                const transactionData = JSON.parse(transaction.data);
                const creatorPublicKey = transactionData[0]["1"];
                const handle = transactionData[0]["2"];
                const surname = transactionData[0]["3"]
                const name = transactionData[1]["0"];
                const language = transactionData[1]["3"];
                // const inArweaveBlock = await getBlockHeightFromTxId(hardCodedTxId);
                const creatorHandle = await convertToCreatorHandle(hardCodedTxId, handle);
                const creator = {
                    data: {
                        templates: [
                            {
                                "creatorRegistration": "creatorRegistration",
                                "basic": "basic"
                            }
                        ],
                        publicKey: creatorPublicKey,
                        creatorHandle: creatorHandle,
                        name: name + ' ' + surname,
                        didAddress,
                        signature: creatorSig
                    },
                    oip: {
                        didTx: 'did:arweave:' + hardCodedTxId,
                        inArweaveBlock,
                        indexedAt: new Date(),
                        ver: transaction.ver,
                        signature: creatorSig,
                        creator: {
                            creatorHandle: creatorHandle,
                            didAddress,
                            didTx: 'did:arweave:' + hardCodedTxId
                        }
                    }
                }
                return creator;
            } else {
                return null;
            }

        }
    } catch (error) {
        console.error(getFileInfo(), getLineNumber(), 'Error searching for creator by address:', error);
        throw error;
    }
};

// Helper function to normalize and extract base unit from compound descriptions
const normalizeUnit = (unit) => {
    if (!unit) return '';
    
    const normalized = unit.toLowerCase().trim();
    
    // Handle compound units like "tsp or 1 packet" -> "tsp"
    if (normalized.includes(' or ')) {
        return normalized.split(' or ')[0].trim();
    }
    
    // Handle descriptive units like "cups shredded" -> "cups"
    // or "roll 1 serving" -> "roll"
    const firstWord = normalized.split(' ')[0];
    
    return firstWord;
};

// Check if a unit is count-based (pieces, units, etc.)
const isCountUnit = (unit) => {
    const countUnits = [
        'unit', 'units', 'piece', 'pieces', 'item', 'items', 
        'large', 'medium', 'small', 'whole', 'clove', 'cloves', 
        'slice', 'slices', 'pickle', 'pickles', 'spear', 'spears',
        'head', 'heads', 'bun', 'buns', 'roll', 'rolls',
        'leaf', 'leaves', 'stalk', 'stalks', 'bunch', 'bunches',
        'can', 'cans', 'bottle', 'bottles', 'jar', 'jars',
        'packet', 'packets', 'bag', 'bags', 'box', 'boxes',
        'fillet', 'fillets', 'breast', 'breasts', 'thigh', 'thighs',
        'serving', 'servings', 'portion', 'portions'
    ];
    
    const normalizedUnit = normalizeUnit(unit);
    return countUnits.includes(normalizedUnit);
};

// Enhanced unit conversion utility functions
const convertToGrams = (amount, unit) => {
    const conversions = {
        // Weight conversions to grams
        'g': 1,
        'gram': 1,
        'grams': 1,
        'kg': 1000,
        'kilogram': 1000,
        'kilograms': 1000,
        'lb': 453.592,
        'lbs': 453.592,
        'pound': 453.592,
        'pounds': 453.592,
        'oz': 28.3495,
        'ounce': 28.3495,
        'ounces': 28.3495,
        
        // Volume conversions to grams (approximate for water-like density)
        'ml': 1,
        'milliliter': 1,
        'milliliters': 1,
        'l': 1000,
        'liter': 1000,
        'liters': 1000,
        'cup': 240,
        'cups': 240,
        'tbsp': 15,
        'tablespoon': 15,
        'tablespoons': 15,
        'tsp': 5,
        'teaspoon': 5,
        'teaspoons': 5,
        'pinch': 0.3125,  // 1 pinch ≈ 1/16 tsp ≈ 0.3125 g
        'pinches': 0.3125,
        'dash': 0.625,    // 1 dash ≈ 1/8 tsp ≈ 0.625 g
        'dashes': 0.625,
        'smidgen': 0.15625,  // 1 smidgen ≈ 1/32 tsp ≈ 0.15625 g
        'smidgens': 0.15625,
        'smidge': 0.15625,
        'fl oz': 30,
        'fluid ounce': 30,
        'fluid ounces': 30,
        'pint': 473,
        'pints': 473,
        'quart': 946,
        'quarts': 946,
        'gallon': 3785,
        'gallons': 3785
    };
    
    // Use normalizeUnit helper to extract base unit from compound descriptions
    const normalizedUnit = normalizeUnit(unit);
    const conversionFactor = conversions[normalizedUnit];
    
    if (conversionFactor) {
        return amount * conversionFactor;
    }
    
    // For count-based units, return null to indicate special handling needed
    const countUnits = [
        'unit', 'units', 'piece', 'pieces', 'item', 'items', 
        'large', 'medium', 'small', 'whole', 'clove', 'cloves', 
        'slice', 'slices', 'pickle', 'pickles', 'spear', 'spears',
        'head', 'heads', 'bun', 'buns', 'roll', 'rolls',
        'leaf', 'leaves', 'stalk', 'stalks', 'bunch', 'bunches',
        'can', 'cans', 'bottle', 'bottles', 'jar', 'jars',
        'packet', 'packets', 'bag', 'bags', 'box', 'boxes',
        'fillet', 'fillets', 'breast', 'breasts', 'thigh', 'thighs',
        'serving', 'servings', 'portion', 'portions'
    ];
    if (countUnits.includes(normalizedUnit)) {
        // console.log(`🔢 '${unit}' (normalized: '${normalizedUnit}') is a count unit, returning null`);
        return null; // Special handling required
    }
    
    // If no conversion found, assume it's already in grams or return a reasonable default
    console.warn(`Unknown unit for conversion: ${unit}, assuming 1:1 ratio`);
    return amount;
};

// Enhanced unit conversion function that attempts direct unit matching first
const convertUnits = (fromAmount, fromUnit, toUnit) => {
    // Normalize units using helper function to extract base units
    const normalizedFromUnit = normalizeUnit(fromUnit);
    const normalizedToUnit = normalizeUnit(toUnit);
    
    // If base units are identical, return 1:1 ratio
    if (normalizedFromUnit === normalizedToUnit) {
        // console.log(`Units are same after normalization: '${fromUnit}' -> '${normalizedFromUnit}', '${toUnit}' -> '${normalizedToUnit}'`);
        return fromAmount;
    }
    
    // Handle common unit aliases
    const unitAliases = {
        'tablespoon': 'tbsp',
        'tablespoons': 'tbsp',
        'teaspoon': 'tsp',
        'teaspoons': 'tsp',
        'pinches': 'pinch',
        'dashes': 'dash',
        'smidgens': 'smidgen',
        'smidge': 'smidgen',
        'cups': 'cup',
        'grams': 'g',
        'gram': 'g',
        'kilograms': 'kg',
        'kilogram': 'kg',
        'pounds': 'lb',
        'pound': 'lb',
        'ounces': 'oz',
        'ounce': 'oz',
        'milliliters': 'ml',
        'milliliter': 'ml',
        'liters': 'l',
        'liter': 'l',
        'slices': 'slice',
        'units': 'unit',
        'pieces': 'piece',
        'items': 'item',
        // Count-based item equivalencies
        'spear': 'pickle',  // pickle spears are pickles
        'spears': 'pickle',
        'pickles': 'pickle',
        'roll': 'bun',  // rolls and buns are equivalent
        'rolls': 'bun',
        'buns': 'bun',
        'cloves': 'clove',
        'heads': 'head',
        'fillets': 'fillet',
        'breasts': 'breast',
        'thighs': 'thigh',
        'leaves': 'leaf',
        'stalks': 'stalk',
        'bunches': 'bunch'
    };
    
    const aliasedFromUnit = unitAliases[normalizedFromUnit] || normalizedFromUnit;
    const aliasedToUnit = unitAliases[normalizedToUnit] || normalizedToUnit;
    
    // Check again after alias resolution
    if (aliasedFromUnit === aliasedToUnit) {
        return fromAmount;
    }
    
    // Handle complex standard units (like "cup spaghetti not packed")
    // Extract the actual unit from complex descriptions
    const extractBaseUnit = (unitString) => {
        const baseUnits = ['cup', 'tbsp', 'tsp', 'pinch', 'dash', 'smidgen', 'g', 'kg', 'lb', 'oz', 'ml', 'l'];
        for (const baseUnit of baseUnits) {
            if (unitString.includes(baseUnit)) {
                return baseUnit;
            }
        }
        return unitString;
    };
    
    const baseFromUnit = extractBaseUnit(aliasedFromUnit);
    const baseToUnit = extractBaseUnit(aliasedToUnit);
    
    // Check if base units are the same
    if (baseFromUnit === baseToUnit) {
        return fromAmount;
    }
    
    // Direct volume conversions (more accurate than going through grams)
    const volumeConversions = {
        'pinch': { 'tsp': 1/16, 'tbsp': 1/48, 'dash': 1/2 },
        'dash': { 'tsp': 1/8, 'tbsp': 1/24, 'pinch': 2 },
        'smidgen': { 'tsp': 1/32, 'tbsp': 1/96, 'pinch': 1/2 },
        'tsp': { 'tbsp': 1/3, 'cup': 1/48, 'ml': 5, 'pinch': 16, 'dash': 8, 'smidgen': 32 },
        'tbsp': { 'tsp': 3, 'cup': 1/16, 'ml': 15, 'pinch': 48, 'dash': 24 },
        'cup': { 'tsp': 48, 'tbsp': 16, 'ml': 240 },
        'ml': { 'tsp': 1/5, 'tbsp': 1/15, 'cup': 1/240 }
    };
    
    // Try direct volume conversion first
    if (volumeConversions[baseFromUnit] && volumeConversions[baseFromUnit][baseToUnit]) {
        return fromAmount * volumeConversions[baseFromUnit][baseToUnit];
    }
    
    // Special conversions for common food items (count-based to grams)
    // Note: These are approximate values based on standard serving sizes
    const foodItemConversions = {
        'pat': 10,           // Butter pat
        'pats': 10,
        'clove': 3,          // Garlic clove
        'cloves': 3,
        'wedge': 7,          // Lemon wedge
        'wedges': 7,
        'stalk': 40,         // Celery stalk (average), also for scallion/green onion use 15g if specified
        'stalks': 40,
        'slice': 28,         // Cheese/bread slice (average - American cheese ~28g, bread ~40g, bacon ~16g)
        'slices': 28,
        'medium': 18,        // Medium mushroom (cremini/button)
        'sprig': 1,          // Herb sprig (parsley ~1g, thyme ~0.64g, average ~1g)
        'sprigs': 1,
        'piece': 8,          // 1-inch piece (e.g., ginger)
        'pieces': 8
    };
    
    // Context-aware conversions based on ingredient name hints
    // Check if we can determine a more specific conversion based on the unit description
    const contextualGrams = (() => {
        const fromUnitLower = fromUnit.toLowerCase();
        const toUnitLower = toUnit.toLowerCase();
        
        // Bacon slice: 16g instead of default 28g
        if (fromUnitLower.includes('bacon') || (normalizedFromUnit === 'slice' && fromUnitLower.includes('bacon'))) {
            return 16;
        }
        // Bread slice: 40g instead of default 28g
        if (fromUnitLower.includes('bread') || fromUnitLower.includes('sandwich')) {
            return 40;
        }
        // Scallion/green onion stalk: 15g instead of default 40g
        if (fromUnitLower.includes('scallion') || fromUnitLower.includes('green onion')) {
            return 15;
        }
        // Thyme sprig: 0.64g instead of default 1g
        if (fromUnitLower.includes('thyme')) {
            return 0.64;
        }
        
        return null;
    })();
    
    if (contextualGrams && foodItemConversions[normalizedFromUnit]) {
        const totalGrams = fromAmount * contextualGrams;
        const targetGramConversion = {
            'g': 1, 'gram': 1, 'grams': 1,
            'kg': 1000,
            'oz': 28.3495,
            'lb': 453.592
        };
        
        if (targetGramConversion[normalizedToUnit]) {
            const result = totalGrams / targetGramConversion[normalizedToUnit];
            console.log(`🍴 Context-aware food conversion: ${fromAmount} ${fromUnit} = ${totalGrams}g (${contextualGrams}g each) = ${result} ${toUnit}`);
            return result;
        }
    }
    
    // Try food item conversions: count unit -> grams -> target weight unit
    if (foodItemConversions[normalizedFromUnit]) {
        const gramsPerUnit = foodItemConversions[normalizedFromUnit];
        const totalGrams = fromAmount * gramsPerUnit;
        
        // Now convert grams to target unit
        const targetGramConversion = {
            'g': 1,
            'gram': 1,
            'grams': 1,
            'kg': 1000,
            'oz': 28.3495,
            'lb': 453.592
        };
        
        if (targetGramConversion[normalizedToUnit]) {
            const result = totalGrams / targetGramConversion[normalizedToUnit];
            console.log(`🍴 Food item conversion: ${fromAmount} ${fromUnit} = ${totalGrams}g = ${result} ${toUnit}`);
            return result;
        }
    }
    
    // Reverse: weight unit -> grams -> count unit
    if (foodItemConversions[normalizedToUnit]) {
        const sourceGramConversion = {
            'g': 1,
            'gram': 1,
            'grams': 1,
            'kg': 1000,
            'oz': 28.3495,
            'lb': 453.592
        };
        
        if (sourceGramConversion[normalizedFromUnit]) {
            const totalGrams = fromAmount * sourceGramConversion[normalizedFromUnit];
            const gramsPerUnit = foodItemConversions[normalizedToUnit];
            const result = totalGrams / gramsPerUnit;
            console.log(`🍴 Food item conversion: ${fromAmount} ${fromUnit} = ${totalGrams}g = ${result} ${toUnit}`);
            return result;
        }
    }
    
    // Check if one unit is count-based and the other is weight/volume - can't convert
    const fromIsCount = isCountUnit(fromUnit);
    const toIsCount = isCountUnit(toUnit);

    // FALLBACK: Treat unrecognized standardUnits as count-based "whole"
    // This enables recipes to use custom standardUnits like "0.5 whole"
    const knownUnits = ['g', 'gram', 'grams', 'kg', 'kilogram', 'kilograms', 'lb', 'lbs', 'pound', 'pounds', 'oz', 'ounce', 'ounces', 'ml', 'milliliter', 'milliliters', 'l', 'liter', 'liters', 'cup', 'cups', 'tbsp', 'tablespoon', 'tablespoons', 'tsp', 'teaspoon', 'teaspoons', 'pinch', 'pinches', 'dash', 'dashes', 'smidgen', 'smidgens', 'smidge', 'fl oz', 'fluid ounce', 'fluid ounces', 'pint', 'pints', 'quart', 'quarts', 'gallon', 'gallons', 'unit', 'units', 'piece', 'pieces', 'item', 'items', 'whole', 'pat', 'pats', 'clove', 'cloves', 'slice', 'slices', 'pickle', 'pickles', 'spear', 'spears', 'head', 'heads', 'bun', 'buns', 'roll', 'rolls', 'leaf', 'leaves', 'stalk', 'stalks', 'bunch', 'bunches', 'can', 'cans', 'bottle', 'bottles', 'jar', 'jars', 'packet', 'packets', 'bag', 'bags', 'box', 'boxes', 'fillet', 'fillets', 'breast', 'breasts', 'thigh', 'thighs', 'large', 'medium', 'small', 'serving', 'servings', 'portion', 'portions', 'wedge', 'wedges', 'sprig', 'sprigs'];
    
    const normalizedToUnitForCheck = normalizeUnit(toUnit);
    if (!knownUnits.includes(normalizedToUnitForCheck)) {
        // toUnit is unrecognized - treat it as a count unit like "whole"
        if (fromIsCount || !knownUnits.includes(normalizeUnit(fromUnit))) {
            console.log(`🔄 FALLBACK: Unrecognized standardUnit '${toUnit}' treated as count; ${fromAmount} ${fromUnit} → ${fromAmount} ${toUnit}`);
            return fromAmount;
        }
    }
    
    if (fromIsCount !== toIsCount) {
        // One is count, one is weight/volume - incompatible
        console.log(`🚫 Cannot convert between count unit (${fromIsCount ? fromUnit : toUnit}) and weight/volume unit (${fromIsCount ? toUnit : fromUnit})`);
        return null;
    }
    
    // If both are count units, use simple ratio
    if (fromIsCount && toIsCount) {
        console.log(`📦 Both are count units, using simple ratio`);
        return fromAmount;
    }
    
    // Try converting both to grams and compare (for weight conversions)
    // console.log(`🔄 Attempting gram conversion: ${fromAmount} ${fromUnit} -> ${baseFromUnit}, 1 ${toUnit} -> ${baseToUnit}`);
    const fromGrams = convertToGrams(fromAmount, baseFromUnit);
    const toGramsPerUnit = convertToGrams(1, baseToUnit);
    // console.log(`📊 Gram conversion results: fromGrams=${fromGrams}, toGramsPerUnit=${toGramsPerUnit}`);
    
    // If both can be converted to grams, do the conversion
    if (fromGrams !== null && toGramsPerUnit !== null && !isNaN(fromGrams) && !isNaN(toGramsPerUnit)) {
        const result = fromGrams / toGramsPerUnit;
        // console.log(`✅ Gram conversion successful: ${fromGrams} / ${toGramsPerUnit} = ${result}`);
        return result;
    }
    
    // console.log(`❌ Gram conversion failed or returned null`);

    // Return null if conversion is not possible
    return null;
};

// Function to parse and clean units (handles "4 oz, cooked" -> "4 oz" and "tsp (1g)" -> "tsp")
const parseUnit = (unit) => {
    if (!unit) return unit;
    // Handle cases like "4 oz, cooked" -> "4 oz"
    // Split on comma and take the first part
    let cleaned = unit.includes(',') ? unit.split(',')[0].trim() : unit;
    // Remove content in parentheses: "tsp (1g)" -> "tsp"
    cleaned = cleaned.replace(/\(.*?\)/g, '').trim();
    return cleaned;
};

// Core calculation function that can be used by both preview and publish
// ingredients: array of { did, amount, unit, nutritionalInfo? }
// servings: number
// recordsInDB: optional array of records to look up DIDs (if not provided, nutritionalInfo must be in each ingredient)
const calculateRecipeNutrition = async (ingredients, servings, recordsInDB = []) => {
    try {
        // Initialize totals
        const totals = {
            calories: 0,
            proteinG: 0,
            fatG: 0,
            cholesterolMg: 0,
            sodiumMg: 0,
            carbohydratesG: 0
        };
        
        let processedIngredients = 0;
        let skippedIngredients = [];
        let ingredientBreakdown = []; // Track per-ingredient contributions
        
        // Process each ingredient
        for (let i = 0; i < ingredients.length; i++) {
            try {
                const ingredient = ingredients[i];
                const recipeAmount = ingredient.amount;
                const recipeUnit = ingredient.unit;
                
                if (!recipeAmount || !recipeUnit || recipeAmount <= 0) {
                    skippedIngredients.push({ index: i, reason: 'Invalid amount or unit', name: ingredient.name });
                    continue;
                }
                
                // Get nutritional info - either from ingredient object or by looking up DID
                let nutritionalInfo = ingredient.nutritionalInfo;
                let ingredientName = ingredient.name || `ingredient ${i}`;
                
                if (!nutritionalInfo && ingredient.did && recordsInDB.length > 0) {
                    // Look up by DID
                    const record = recordsInDB.find(r => r && r.oip && r.oip.didTx === ingredient.did);
                    if (record && record.data) {
                        nutritionalInfo = record.data.nutritionalInfo;
                        ingredientName = record.data.basic?.name || ingredientName;
                    }
                }
                
                if (!nutritionalInfo) {
                    skippedIngredients.push({ index: i, reason: 'No nutritional info', name: ingredientName });
                    continue;
                }
                
                const standardAmount = nutritionalInfo.standardAmount;
                const rawStandardUnit = nutritionalInfo.standardUnit;
                
                if (!standardAmount || !rawStandardUnit || standardAmount <= 0) {
                    skippedIngredients.push({ index: i, reason: 'Missing standard amount/unit', name: ingredientName });
                    continue;
                }
                
                // Parse and clean units
                const cleanRecipeUnit = parseUnit(recipeUnit);
                const standardUnit = parseUnit(rawStandardUnit);
                
                // Calculate multiplier
                let multiplier;
                let conversionMethod = '';
                
                // Try direct unit conversion first
                const convertedAmount = convertUnits(recipeAmount, cleanRecipeUnit, standardUnit);
                
                if (convertedAmount !== null && convertedAmount !== undefined && !isNaN(convertedAmount)) {
                    multiplier = convertedAmount / standardAmount;
                    conversionMethod = 'direct unit conversion';
                } else {
                    // Fallback logic
                    const normalizedRecipeUnit = cleanRecipeUnit.toLowerCase().trim();
                    const normalizedStandardUnit = standardUnit.toLowerCase().trim();
                    
                    if (normalizedRecipeUnit === normalizedStandardUnit) {
                        multiplier = recipeAmount / standardAmount;
                        conversionMethod = 'same unit';
                    } else if (isCountUnit(cleanRecipeUnit) && isCountUnit(standardUnit)) {
                        multiplier = recipeAmount / standardAmount;
                        conversionMethod = 'count units';
                    } else if (isCountUnit(cleanRecipeUnit) && !isCountUnit(standardUnit)) {
                        skippedIngredients.push({ index: i, reason: `Cannot convert count '${cleanRecipeUnit}' to '${standardUnit}'`, name: ingredientName });
                        continue;
                    } else if (!isCountUnit(cleanRecipeUnit) && isCountUnit(standardUnit)) {
                        skippedIngredients.push({ index: i, reason: `Cannot convert '${cleanRecipeUnit}' to count '${standardUnit}'`, name: ingredientName });
                        continue;
                    } else {
                        // Try gram conversion
                        const recipeAmountInGrams = convertToGrams(recipeAmount, cleanRecipeUnit);
                        const standardAmountInGrams = convertToGrams(standardAmount, standardUnit);
                        
                        if (recipeAmountInGrams === null || recipeAmountInGrams === undefined || 
                            standardAmountInGrams === null || standardAmountInGrams === undefined) {
                            skippedIngredients.push({ index: i, reason: `Cannot convert ${cleanRecipeUnit} to ${standardUnit}`, name: ingredientName });
                            continue;
                        }
                        
                        multiplier = recipeAmountInGrams / standardAmountInGrams;
                        conversionMethod = 'gram conversion';
                    }
                }
                
                // Validate multiplier
                if (multiplier === undefined || multiplier === null || isNaN(multiplier) || multiplier < 0) {
                    skippedIngredients.push({ index: i, reason: `Invalid multiplier: ${multiplier}`, name: ingredientName });
                    continue;
                }
                
                // Calculate contributions
                const contribution = {
                    calories: (nutritionalInfo.calories || 0) * multiplier,
                    proteinG: (nutritionalInfo.proteinG || 0) * multiplier,
                    fatG: (nutritionalInfo.fatG || 0) * multiplier,
                    carbohydratesG: (nutritionalInfo.carbohydratesG || 0) * multiplier,
                    sodiumMg: (nutritionalInfo.sodiumMg || 0) * multiplier,
                    cholesterolMg: (nutritionalInfo.cholesterolMg || 0) * multiplier
                };
                
                // Add to totals
                totals.calories += contribution.calories;
                totals.proteinG += contribution.proteinG;
                totals.fatG += contribution.fatG;
                totals.cholesterolMg += contribution.cholesterolMg;
                totals.sodiumMg += contribution.sodiumMg;
                totals.carbohydratesG += contribution.carbohydratesG;
                
                // Track breakdown
                ingredientBreakdown.push({
                    name: ingredientName,
                    amount: recipeAmount,
                    unit: cleanRecipeUnit,
                    standardAmount: standardAmount,
                    standardUnit: standardUnit,
                    multiplier: multiplier,
                    conversionMethod: conversionMethod,
                    contribution: contribution
                });
                
                processedIngredients++;
                
            } catch (ingredientError) {
                const ingredientName = ingredients[i]?.name || `ingredient ${i}`;
                skippedIngredients.push({ index: i, reason: ingredientError.message, name: ingredientName });
                continue;
            }
        }
        
        // Round values
        const roundToDecimal = (num, decimals = 2) => Math.round(num * Math.pow(10, decimals)) / Math.pow(10, decimals);
        
        // Add per-serving values to each ingredient breakdown
        const ingredientBreakdownPerServing = ingredientBreakdown.map(item => ({
            ...item,
            perServing: {
                calories: roundToDecimal(item.contribution.calories / servings, 0),
                proteinG: roundToDecimal(item.contribution.proteinG / servings, 1),
                fatG: roundToDecimal(item.contribution.fatG / servings, 1),
                carbohydratesG: roundToDecimal(item.contribution.carbohydratesG / servings, 1),
                sodiumMg: roundToDecimal(item.contribution.sodiumMg / servings, 0),
                cholesterolMg: roundToDecimal(item.contribution.cholesterolMg / servings, 0)
            }
        }));
        
        return {
            perServing: {
                calories: roundToDecimal(totals.calories / servings, 0),
                proteinG: roundToDecimal(totals.proteinG / servings, 1),
                fatG: roundToDecimal(totals.fatG / servings, 1),
                carbohydratesG: roundToDecimal(totals.carbohydratesG / servings, 1),
                sodiumMg: roundToDecimal(totals.sodiumMg / servings, 0),
                cholesterolMg: roundToDecimal(totals.cholesterolMg / servings, 0)
            },
            total: {
                calories: roundToDecimal(totals.calories, 0),
                proteinG: roundToDecimal(totals.proteinG, 1),
                fatG: roundToDecimal(totals.fatG, 1),
                carbohydratesG: roundToDecimal(totals.carbohydratesG, 1),
                sodiumMg: roundToDecimal(totals.sodiumMg, 0),
                cholesterolMg: roundToDecimal(totals.cholesterolMg, 0)
            },
            processedIngredients,
            totalIngredients: ingredients.length,
            skippedIngredients,
            ingredientBreakdown: ingredientBreakdownPerServing
        };
        
    } catch (error) {
        console.error('Error in calculateRecipeNutrition:', error);
        throw error;
    }
};

// Function to add nutritional summary to recipe records
// fieldPrefix: 'summary' (default, for publish-time) or 'calculatedSummary' (for on-demand recalculation)
const addRecipeNutritionalSummary = async (record, recordsInDB, fieldPrefix = 'summary') => {
    try {
        const recipe = record.data.recipe;
        
        if (!recipe || !recipe.ingredient || !recipe.ingredient_amount || !recipe.ingredient_unit) {
            console.warn(`Recipe ${record.oip?.didTx || 'unknown'} missing required ingredient data for nutritional calculation`);
            return record;
        }
        
        // Build ingredients array for the shared calculation function
        const ingredients = recipe.ingredient.map((ingredientRef, i) => ({
            did: typeof ingredientRef === 'string' && ingredientRef.startsWith('did:') ? ingredientRef : null,
            amount: recipe.ingredient_amount[i],
            unit: recipe.ingredient_unit[i],
            name: typeof ingredientRef === 'object' && ingredientRef?.data?.basic?.name ? ingredientRef.data.basic.name : `ingredient ${i}`,
            nutritionalInfo: typeof ingredientRef === 'object' && ingredientRef?.data?.nutritionalInfo ? ingredientRef.data.nutritionalInfo : null
        }));
        
        const servings = recipe.servings || 1;
        
        // Use the shared calculation function
        const result = await calculateRecipeNutrition(ingredients, servings, recordsInDB);
        
        // Check if we processed enough ingredients
        const minimumThreshold = Math.max(1, Math.ceil(result.totalIngredients * 0.25));
        if (result.processedIngredients < minimumThreshold) {
            console.warn(`Recipe ${record.oip?.didTx || 'unknown'} has insufficient nutritional data (${result.processedIngredients}/${result.totalIngredients} ingredients), skipping summary`);
            return record;
        }
        
        console.log(`\n✅ Successfully processed ${result.processedIngredients}/${result.totalIngredients} ingredients for recipe ${record.oip?.didTx || 'unknown'}`);
        console.log(`📊 Total recipe nutritional values (for ${servings} servings):`);
        console.log(`   Calories: ${result.total.calories}`);
        console.log(`   Protein: ${result.total.proteinG}g`);
        console.log(`   Fat: ${result.total.fatG}g`);
        console.log(`   Carbs: ${result.total.carbohydratesG}g`);
        console.log(`\n📊 Per-serving nutritional values (1 of ${servings} servings):`);
        console.log(`   Calories: ${result.perServing.calories}`);
        console.log(`   Protein: ${result.perServing.proteinG}g`);
        console.log(`   Fat: ${result.perServing.fatG}g`);
        console.log(`   Carbs: ${result.perServing.carbohydratesG}g`);
        
        if (result.skippedIngredients.length > 0) {
            console.log(`\n⚠️ Skipped ${result.skippedIngredients.length} ingredients:`);
            result.skippedIngredients.forEach(skip => {
                console.log(`   - ${skip.name}: ${skip.reason}`);
            });
        }
        
        // Add the summaries to the record using the specified field prefix
        const totalFieldName = `${fieldPrefix}NutritionalInfo`;
        const perServingFieldName = `${fieldPrefix}NutritionalInfoPerServing`;
        
        return {
            ...record,
            data: {
                ...record.data,
                [totalFieldName]: result.total,
                [perServingFieldName]: result.perServing
            }
        };
        
    } catch (error) {
        console.error(`Error calculating nutritional summary for recipe ${record.oip?.didTx || 'unknown'}:`, error.message);
        return record; // Return original record without summary
    }
};

async function getRecords(queryParams) {

    const {
        template,
        resolveDepth,
        resolveNamesOnly = false,
        summarizeRecipe = false,
        hideDateReadable = false,
        hideNullValues = false,
        // creator_name,
        creator_did_address,
        creatorHandle,
        // txid,
        url,
        didTx,
        didTxRef,
        did,           // NEW: unified DID parameter
        source,        // NEW: 'all', 'arweave', 'gun'
        storage,       // ALIAS: maps to oip.storage
        tags,
        tagsMatchMode = 'OR', // New parameter: 'AND' or 'OR' (default: 'OR' for backward compatibility)
        sortBy = 'inArweaveBlock:desc',
        recordType,
        limit,
        page,
        search,
        searchMatchMode = 'AND', // New parameter: 'AND' or 'OR' (default: 'AND' for backward compatibility)
        inArweaveBlock,
        hasAudio,
        summarizeTags,
        user,           // NEW: User information from optional auth
        isAuthenticated, // NEW: Authentication status
        requestInfo,    // NEW: Request information for domain validation
        tagCount,
        tagPage,
        dateStart,
        dateEnd,
        includeDeleteMessages = false,
        includeSigs = true,
        includePubKeys = true,
        exactMatch,
        exerciseNames, // New parameter for workout exercise filtering
        exerciseDIDs, // New parameter for workout exercise filtering by DID
        ingredientNames, // New parameter for recipe ingredient filtering
        equipmentRequired, // New parameter for exercise equipment filtering
        equipmentMatchMode = 'AND', // New parameter for equipment match behavior (AND/OR)
        exerciseType, // New parameter for exercise type filtering
        exerciseTypeMatchMode = 'OR', // New parameter for exercise type match behavior (AND/OR, default OR)
        cuisine, // New parameter for recipe cuisine filtering
        cuisineMatchMode = 'OR', // New parameter for cuisine match behavior (AND/OR, default OR)
        model, // New parameter for model provider filtering
        modelMatchMode = 'OR', // New parameter for model match behavior (AND/OR, default OR)
        noDuplicates = false, // New parameter: filter out duplicate names (default: false)
        scheduledOn, // New parameter for filtering workoutSchedule by specific date (YYYY-MM-DD format)
        fieldSearch, // New parameter: value to search for in a specific field path
        fieldName, // New parameter: dot-notation path to field (e.g., 'recipe.course', 'data.basic.name')
        fieldMatchMode = 'partial', // New parameter: 'exact' or 'partial' matching (default: 'partial')
    } = queryParams;

    // Normalize DID parameter for backward compatibility
    const normalizedDid = did || didTx;
    
    // console.log('get records using:', {queryParams});
    try {
        // ============================================================
        // OPTIMIZED ELASTICSEARCH QUERY IMPLEMENTATION
        // Phases 1-3: Use ES for filtering instead of fetching all + in-memory filter
        // ============================================================
        
        // Build Elasticsearch query from parameters
        const esQuery = buildElasticsearchQuery(queryParams);
        
        // Determine if we need post-processing (affects pagination)
        const requiresPostProcessing = needsPostProcessing(queryParams);
        let overFetchMultiplier = getOverFetchMultiplier(queryParams);
        
        // CRITICAL FIX: When limit is small and post-processing is required,
        // increase the multiplier to ensure we fetch enough records
        // Example: limit=1 with multiplier=3 only fetches 3 records, which might all be filtered out
        if (requiresPostProcessing && limit && parseInt(limit) <= 5) {
            overFetchMultiplier = Math.max(overFetchMultiplier, 10); // Fetch at least 10x for small limits
            console.log(`⚠️  [Over-fetch] Small limit (${limit}) with post-processing - using multiplier ${overFetchMultiplier}`);
        }
        
        // Calculate pagination for ES query
        // Ensure both pageSize and pageNumber have valid defaults
        const pageSize = Math.max(1, parseInt(limit) || 20); // Minimum 1, default 20
        const pageNumber = Math.max(1, parseInt(page) || 1);  // Minimum 1, default 1 (ALWAYS defaults to page 1 if not provided)
        
        // If post-processing needed, fetch more records to account for filtering
        // Special case: for noDuplicates, fetch ALL records to ensure we get all unique ones
        let esFrom, esSize;
        if (noDuplicates) {
            // Fetch all records for this query, we'll filter and paginate after deduplication
            esFrom = 0;
            esSize = 10000; // ES default max
        } else if (requiresPostProcessing) {
            // Over-fetch based on complexity
            esFrom = 0;
            esSize = pageSize * overFetchMultiplier;
        } else {
            // ES can handle pagination directly
            esFrom = (pageNumber - 1) * pageSize;
            esSize = pageSize;
        }
        
        // Build sort configuration
        const esSort = buildElasticsearchSort(sortBy);
        
        // Execute optimized Elasticsearch query
        console.log(`🚀 [ES Query] Executing optimized query: from=${esFrom}, size=${esSize}, requiresPostProcessing=${requiresPostProcessing}, pageSize=${pageSize}, pageNumber=${pageNumber}`);
        
        // DEBUG: Log the full ES query for date filters
        if (dateStart || dateEnd) {
            console.log(`🔍 [ES Query DEBUG] Full query:`, JSON.stringify(esQuery, null, 2));
        }
        
        // Debug: Log the ES query for equipment filtering
        if (equipmentRequired) {
            console.log(`🔍 [ES Query DEBUG] equipmentRequired query:`, JSON.stringify(esQuery, null, 2));
            
            // Debug: Fetch a sample exercise to see actual field structure
            try {
                const sampleExercise = await elasticClient.search({
                    index: 'records',
                    body: {
                        query: { term: { "oip.recordType.keyword": "exercise" } },
                        size: 1
                    }
                });
                if (sampleExercise.hits.hits.length > 0) {
                    const sample = sampleExercise.hits.hits[0]._source;
                    console.log(`🔍 [ES Query DEBUG] Sample exercise.equipmentRequired field:`, sample.data?.exercise?.equipmentRequired);
                    console.log(`🔍 [ES Query DEBUG] Sample exercise name:`, sample.data?.basic?.name);
                }
            } catch (debugError) {
                console.error(`⚠️  [ES Query DEBUG] Error fetching sample:`, debugError.message);
            }
        }
        
        const searchResponse = await elasticClient.search({
            index: 'records',
            body: {
                query: esQuery,
                sort: esSort || [{ "oip.inArweaveBlock": { order: 'desc' } }],
                from: esFrom,
                size: esSize
            }
        });
        
        // Extract records from search response
        let records = searchResponse.hits.hits.map(hit => hit._source);
        const totalHits = searchResponse.hits.total.value;
        
        console.log(`✅ [ES Query] Retrieved ${records.length} records (total: ${totalHits})`);
        
        // Get metadata (for backward compatibility with old code)
        // Note: We still need these for response metadata
        const result = await getRecordsInDB(false); // Use cache for metadata only
        let recordsInDB = result.records; // Used only for resolution
        let qtyRecordsInDB = result.qtyRecordsInDB;
        let maxArweaveBlockInDB = result.finalMaxRecordArweaveBlock;

        // ============================================================
        // PHASE 4: POST-PROCESSING FILTERS
        // These filters require complex logic that ES cannot handle efficiently
        // ============================================================
        
        // Note: The following filters are now handled in Elasticsearch:
        // - source, storage (DID prefix filtering)
        // - includeDeleteMessages (record type filtering)
        // - dateStart, dateEnd (range queries)
        // - scheduledOn (date range for workoutSchedule/mealPlan)
        // - inArweaveBlock (term query or exists)
        // - creatorHandle, creator_did_address (term queries)
        // - recordType (term query)
        // - tags (terms query with AND/OR modes)
        // - search (multi_match query with AND/OR modes)
        // - equipmentRequired, exerciseType, cuisine, model (wildcard/terms queries)
        // - fieldSearch (wildcard or term query)
        // - exactMatch (term queries)
        // - hasAudio (exists queries)
        // - url (multi-field term query)
        //
        // Only complex filters remain below (those that need post-processing):
        
        // Template filtering - requires object key inspection
        // (kept as post-processing because it searches through object keys dynamically)

        if (template != undefined) {
            records = records.filter(record => {
                // Check if record.data is an object (not an array) and look for template names as keys
                if (record.data && typeof record.data === 'object' && !Array.isArray(record.data)) {
                    return Object.keys(record.data).some(key => key.toLowerCase().includes(template.toLowerCase()));
                }
                // If record.data is an array, check each object in the array
                else if (Array.isArray(record.data)) {
                    return record.data.some(dataItem => 
                        Object.keys(dataItem).some(key => key.toLowerCase().includes(template.toLowerCase()))
                    );
                }
                return false;
            });
            // console.log('after filtering by template, there are', records.length, 'records');
        }

        // recordType filter now handled in Elasticsearch (no longer needed here)

        // didTxRef - requires recursive object search (kept as post-processing)
        if (didTxRef != undefined) {
            // console.log('didTxRef:', didTxRef);

            // Helper function to recursively search through objects and arrays for matching values
            const searchForDidTxRef = (obj) => {
                if (Array.isArray(obj)) {
                    // If it's an array, recursively search its elements
                    return obj.some(item => searchForDidTxRef(item));
                } else if (typeof obj === 'object' && obj !== null) {
                    // If it's an object, recursively search its values
                    return Object.values(obj).some(value => searchForDidTxRef(value));
                } else if (typeof obj === 'string') {
                    // If it's a string, check if it starts with didTxRef
                    return obj.startsWith(didTxRef);
                }
                return false;
            };

            // Filter records based on the recursive search function
            records = records.filter(record =>
                // record.data.some(item => searchForDidTxRef(item))
                searchForDidTxRef(record.data)
            );
            // console.log('after filtering by didTxRef, there are', records.length, 'records');
        }
        
        // exactMatch, url, tags filters now handled in Elasticsearch (no longer needed here)
        
        // ============================================================
        // POST-PROCESSING: Add Scores for Ranking
        // ES filtered the data, now we add scores for custom sorting
        // ============================================================
        
        // Add tag match scores (for sortBy=tags)
        if (tags !== undefined) {
            const tagArray = tags.split(',').map(tag => tag.trim());
            records = records.map(record => {
                const countMatches = (record) => {
                    if (record.data && record.data.basic && record.data.basic.tagItems) {
                        return record.data.basic.tagItems.filter(tag => tagArray.includes(tag)).length;
                    }
                    return 0;
                };
                const matches = countMatches(record);
                const score = (matches / tagArray.length).toFixed(3);
                return { ...record, score };
            });
        }
        
        // Add search match counts (for sortBy=matchCount)
        if (search !== undefined) {
            const searchTerms = search.toLowerCase().split(' ').map(term => term.trim()).filter(Boolean);
            records = records.map(record => {
                const basicData = record.data.basic;
                let matchCount = 0;
                searchTerms.forEach(term => {
                    if (
                        (basicData?.name?.toLowerCase().includes(term)) ||
                        (basicData?.description?.toLowerCase().includes(term)) ||
                        (basicData?.tagItems?.some(tag => tag.toLowerCase().includes(term)))
                    ) {
                        matchCount++;
                    }
                });
                return { ...record, matchCount };
            });
        }
        
        // Add equipment match scores (ES filtered, now add scores)
        if (equipmentRequired && recordType === 'exercise') {
            const equipmentArray = equipmentRequired.split(',').map(eq => eq.trim());
            const isDID = (str) => str && typeof str === 'string' && (str.startsWith('did:arweave:') || str.startsWith('did:gun:'));
            
            // Resolve DIDs to equipment names
            const resolvedEquipment = await Promise.all(equipmentArray.map(async (eq) => {
                if (isDID(eq)) {
                    // Resolve DID to get equipment name
                    try {
                        const equipRecord = await searchRecordInDB(eq);
                        if (equipRecord && equipRecord.data && equipRecord.data.basic && equipRecord.data.basic.name) {
                            return equipRecord.data.basic.name.toLowerCase();
                        }
                    } catch (error) {
                        console.error(`⚠️  Failed to resolve equipment DID ${eq}:`, error.message);
                    }
                }
                return eq.toLowerCase();
            }));
            
            // Cache for resolved equipment DIDs to avoid duplicate lookups
            const equipmentNameCache = {};
            
            const getEquipmentName = async (equipment) => {
                if (equipment && typeof equipment === 'object' && equipment.data && equipment.data.basic && equipment.data.basic.name) {
                    return equipment.data.basic.name.toLowerCase();
                }
                if (equipment && typeof equipment === 'object' && equipment.name) {
                    return equipment.name.toLowerCase();
                }
                if (typeof equipment === 'string') {
                    // Check if it's a DID
                    if (isDID(equipment)) {
                        // Check cache first
                        if (equipmentNameCache[equipment]) {
                            return equipmentNameCache[equipment];
                        }
                        // Resolve DID to name
                        try {
                            const equipRecord = await searchRecordInDB(equipment);
                            if (equipRecord && equipRecord.data && equipRecord.data.basic && equipRecord.data.basic.name) {
                                const name = equipRecord.data.basic.name.toLowerCase();
                                equipmentNameCache[equipment] = name;
                                return name;
                            }
                        } catch (error) {
                            console.error(`⚠️  Failed to resolve equipment DID ${equipment}:`, error.message);
                        }
                        return ''; // Failed to resolve
                    }
                    // It's already a name
                    return equipment.toLowerCase();
                }
                return '';
            };
            
            const equipmentMatches = async (exerciseEq, requiredEq) => {
                const exerciseName = await getEquipmentName(exerciseEq);
                const requiredName = requiredEq.toLowerCase();
                return exerciseName.includes(requiredName) || requiredName.includes(exerciseName);
            };
            
            records = await Promise.all(records.map(async (record) => {
                const countMatches = async (record) => {
                    if (!record.data.exercise) return 0;
                    let exerciseEquipment = [];
                    if (record.data.exercise.equipmentRequired && Array.isArray(record.data.exercise.equipmentRequired)) {
                        exerciseEquipment = record.data.exercise.equipmentRequired;
                    } else if (record.data.exercise.equipment) {
                        if (typeof record.data.exercise.equipment === 'string') {
                            exerciseEquipment = [record.data.exercise.equipment];
                        } else if (Array.isArray(record.data.exercise.equipment)) {
                            exerciseEquipment = record.data.exercise.equipment;
                        }
                    }
                    if (exerciseEquipment.length === 0 && equipmentMatchMode.toUpperCase() === 'OR') {
                        return resolvedEquipment.length;
                    }
                    
                    // Check how many required equipment items match
                    let matchCount = 0;
                    for (const requiredEquipment of resolvedEquipment) {
                        for (const exerciseEq of exerciseEquipment) {
                            if (await equipmentMatches(exerciseEq, requiredEquipment)) {
                                matchCount++;
                                break; // Found a match for this required equipment
                            }
                        }
                    }
                    return matchCount;
                };
                const matches = await countMatches(record);
                const score = (matches / resolvedEquipment.length).toFixed(3);
                return { ...record, equipmentScore: score, equipmentMatchedCount: matches };
            }));
            
            // Filter out records that don't match equipment requirements
            if (equipmentMatchMode.toUpperCase() === 'AND') {
                // AND mode: must match ALL equipment
                records = records.filter(r => r.equipmentMatchedCount === resolvedEquipment.length);
            } else {
                // OR mode: must match at least ONE equipment
                records = records.filter(r => r.equipmentMatchedCount > 0);
            }
        }
        
        // Add exercise type scores
        if (exerciseType && recordType === 'exercise') {
            const exerciseTypeArray = exerciseType.split(',').map(type => type.trim().toLowerCase());
            const exerciseTypeEnumMap = {
                'warmup': 'Warm-Up', 'warm-up': 'Warm-Up',
                'main': 'Main', 'cooldown': 'Cool-Down', 'cool-down': 'Cool-Down'
            };
            const normalizedTypes = exerciseTypeArray.map(type => exerciseTypeEnumMap[type] || type);
            records = records.map(record => {
                const countMatches = (record) => {
                    if (!record.data.exercise || !record.data.exercise.exercise_type) return 0;
                    const exerciseTypeValue = record.data.exercise.exercise_type;
                    return normalizedTypes.filter(requestedType => exerciseTypeValue === requestedType).length;
                };
                const matches = countMatches(record);
                const score = (matches / normalizedTypes.length).toFixed(3);
                return { ...record, exerciseTypeScore: score, exerciseTypeMatchedCount: matches };
            });
        }
        
        // Add cuisine scores
        if (cuisine && recordType === 'recipe') {
            const cuisineArray = cuisine.split(',').map(c => c.trim().toLowerCase());
            records = records.map(record => {
                const countMatches = (record) => {
                    if (!record.data.recipe || !record.data.recipe.cuisine) return 0;
                    const recipeCuisine = record.data.recipe.cuisine.toLowerCase();
                    return cuisineArray.filter(requestedCuisine => recipeCuisine.includes(requestedCuisine)).length;
                };
                const matches = countMatches(record);
                const score = (matches / cuisineArray.length).toFixed(3);
                return { ...record, cuisineScore: score, cuisineMatchedCount: matches };
            });
        }
        
        // Add model scores
        if (model && recordType === 'modelProvider') {
            const modelArray = model.split(',').map(m => m.trim().toLowerCase());
            records = records.map(record => {
                const countMatches = (record) => {
                    if (!record.data.modelProvider || !record.data.modelProvider.supported_models) return 0;
                    let supportedModels = [];
                    if (Array.isArray(record.data.modelProvider.supported_models)) {
                        supportedModels = record.data.modelProvider.supported_models.map(model => model.toLowerCase());
                    } else if (typeof record.data.modelProvider.supported_models === 'string') {
                        supportedModels = record.data.modelProvider.supported_models.split(',').map(model => model.trim().toLowerCase());
                    }
                    return modelArray.filter(requestedModel =>
                        supportedModels.some(supportedModel =>
                            supportedModel.includes(requestedModel) || requestedModel.includes(supportedModel)
                        )
                    ).length;
                };
                const matches = countMatches(record);
                const score = (matches / modelArray.length).toFixed(3);
                return { ...record, modelScore: score, modelMatchedCount: matches };
            });
        }
        
        // Helper function to calculate string similarity score (for fieldSearch scoring)
        const calculateSimilarityScore = (fieldValue, searchValue) => {
            const fieldLower = String(fieldValue).toLowerCase().trim();
            const searchLower = String(searchValue).toLowerCase().trim();
            
            if (fieldLower === searchLower) return 1000;
            if (fieldLower.startsWith(searchLower)) return 900;
            if (fieldLower.endsWith(searchLower)) return 800;
            
            const wordBoundaryRegex = new RegExp(`\\b${searchLower}\\b`, 'i');
            if (wordBoundaryRegex.test(fieldLower)) return 700;
            if (fieldLower.includes(searchLower)) return 600;
            
            // Levenshtein distance for remaining cases
            const levenshteinDistance = (str1, str2) => {
                const matrix = [];
                for (let i = 0; i <= str2.length; i++) matrix[i] = [i];
                for (let j = 0; j <= str1.length; j++) matrix[0][j] = j;
                for (let i = 1; i <= str2.length; i++) {
                    for (let j = 1; j <= str1.length; j++) {
                        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                            matrix[i][j] = matrix[i - 1][j - 1];
                        } else {
                            matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
                        }
                    }
                }
                return matrix[str2.length][str1.length];
            };
            
            const distance = levenshteinDistance(fieldLower, searchLower);
            const maxLength = Math.max(fieldLower.length, searchLower.length);
            const similarity = 1 - (distance / maxLength);
            return Math.floor(similarity * 500);
        };
        
        // Add field search scoring (fieldSearch filter already handled in ES, just add scores)
        if (fieldSearch !== undefined && fieldName !== undefined) {
            // Helper function to safely navigate nested object paths
            const getNestedValue = (obj, path) => {
                const pathParts = path.split('.');
                let currentValue = obj;
                for (const part of pathParts) {
                    if (currentValue && typeof currentValue === 'object' && part in currentValue) {
                        currentValue = currentValue[part];
                    } else {
                        return undefined;
                    }
                }
                return currentValue;
            };
            
            // Add similarity scores to already-filtered records for sorting
            records = records.map(record => {
                const fieldValue = getNestedValue(record.data, fieldName);
                if (fieldValue !== undefined && fieldValue !== null) {
                    const fieldValueStr = String(fieldValue);
                    record.fieldSearchScore = calculateSimilarityScore(fieldValueStr, fieldSearch);
                }
                return record;
            });
        }
        
        // url, tags, equipmentRequired, exerciseType, cuisine, model, search filtering now handled in Elasticsearch (scoring added above)
        
        // ============================================================
        // AUTHENTICATION-BASED PRIVACY FILTERING (POST-PROCESSING)
        // Complex ownership checks that require user context
        // ============================================================
        
        // Skip the old redundant filter blocks (equipment, exerciseType, cuisine, model, search)
        // These are now handled in Elasticsearch queries above
        
        // Jump directly to authentication filtering below...
        // NEW: Filter by access level based on authentication status
        if (!isAuthenticated) {
            // Unauthenticated users only see public records
            records = records.filter(record => {
                // Check if record has access control settings
                const accessControl = record.data?.accessControl;
                const accessLevel = accessControl?.access_level;
                
                // Check conversation session privacy (legacy support for is_private)
                const conversationSession = record.data?.conversationSession;
                const legacySessionPrivate = conversationSession?.is_private === true;
                
                // Exclude non-public records for unauthenticated users
                if (accessLevel && accessLevel !== 'public') {
                    // console.log('Filtering out non-public record for unauthenticated user:', record.oip?.did, 'access_level:', accessLevel);
                    return false;
                }
                
                // Legacy fallback: treat old private fields as access_level: 'private'
                if (legacySessionPrivate) {
                    // console.log('Filtering out legacy private conversation session for unauthenticated user (treating as access_level: private):', record.oip?.did);
                    return false;
                }
                
                return true;
            });
            // console.log(`after filtering non-public records for unauthenticated user, there are ${records.length} records`);
        } else {
            // Authenticated users see public records + their own private/shared records
            // Use async filter for organization membership checking
            records = await asyncFilter(records, async (record) => {
                const accessControl = record.data?.accessControl;
                const conversationSession = record.data?.conversationSession;
                const accessLevel = accessControl?.access_level;
                
                // Always include public records
                if (accessLevel === 'public' || !accessLevel) {
                    return true;
                }
                
                // For private/shared records, check ownership
                if (accessLevel === 'private' || accessLevel === 'shared') {
                    const recordOwnerPubKey = accessControl?.owner_public_key || 
                                            accessControl?.created_by || 
                                            conversationSession?.owner_public_key;
                    const userPubKey = user?.publicKey || user?.publisherPubKey;
                    
                    if (recordOwnerPubKey && userPubKey) {
                        // Check direct ownership
                        if (recordOwnerPubKey === userPubKey) {
                            // console.log('Including owned record for user:', record.oip?.did, 'access_level:', accessLevel, 'owner:', recordOwnerPubKey.slice(0, 12));
                            return true;
                        }
                        
                        // Note: Shared access and permissions will be implemented when we have the full accessControl template
                        // For now, we only support private/public access levels
                    }
                    
                    // console.log('Excluding private/shared record (not owner/shared):', record.oip?.did, 'user:', userPubKey?.slice(0, 12), 'owner:', recordOwnerPubKey?.slice(0, 12));
                    return false;
                }
                
                // For organization records, check membership based on policy
                if (accessLevel === 'organization') {
                    const sharedWith = accessControl?.shared_with;
                    const userPubKey = user?.publicKey || user?.publisherPubKey;
                    
                    // Handle both string and array formats for shared_with
                    let sharedWithArray = [];
                    if (typeof sharedWith === 'string') {
                        sharedWithArray = [sharedWith];
                    } else if (Array.isArray(sharedWith)) {
                        sharedWithArray = sharedWith;
                    }
                    
                    if (!sharedWith || sharedWithArray.length === 0) {
                        // console.log('Excluding organization record (no shared_with):', record.oip?.did);
                        return false;
                    }
                    
                    if (!userPubKey) {
                        console.log('Excluding organization record (no user public key):', record.oip?.did);
                        return false;
                    }
                    
                    // Check membership for each organization in shared_with
                    try {
                        const isMember = await checkOrganizationMembershipForRecord(userPubKey, sharedWithArray, requestInfo);
                        if (isMember) {
                            console.log('Including organization record for member:', record.oip?.did, 'user:', userPubKey.slice(0, 12));
                        return true;
                    } else {
                        // console.log('Excluding organization record (not member):', record.oip?.did, 'user:', userPubKey.slice(0, 12));
                        return false;
                    }
                    } catch (error) {
                        console.error('Error checking organization membership:', error);
                        return false;
                    }
                }
                
                // Legacy support: treat conversation sessions with is_private as access_level: 'private'
                if (conversationSession?.is_private === true) {
                    const recordOwnerPubKey = conversationSession?.owner_public_key;
                    const userPubKey = user?.publicKey || user?.publisherPubKey;
                    
                    if (recordOwnerPubKey && userPubKey && recordOwnerPubKey === userPubKey) {
                        console.log('Including legacy private conversation session for owner (treating as access_level: private):', record.oip?.did, 'owner:', recordOwnerPubKey.slice(0, 12));
                        return true;
                    } else {
                        console.log('Excluding legacy private conversation session (treating as access_level: private, not owner):', record.oip?.did, 'user:', userPubKey?.slice(0, 12), 'owner:', recordOwnerPubKey?.slice(0, 12));
                        return false;
                    }
                }
                
                // Default: include record
                return true;
            });
            // console.log(`after filtering records for authenticated user ${user?.email}, there are ${records.length} records`);
        }

        // console.log('all filters complete, there are', records.length, 'records');
        
        
    // remove the signature and public key hash data if requested        
        if (includeSigs === "false" || includeSigs === false) {
            records = records.map(record => {
                if (record.oip && record.oip.signature) {
                    delete record.oip.signature;
                }
                return record;
            });
        }
    
        if (includePubKeys === "false" || includePubKeys === false) {
            records = records.map(record => {
                if (record.oip && record.oip.creator && record.oip.creator.publicKey) {
                    delete record.oip.creator.publicKey;
                }
                return record;
            });
        }
       
    // Add a dateReadable field to each record that has a timestamp value at ...basic.date (unless hideDateReadable is true)
    records = records.map(record => {
        const basicData = record.data?.basic; // Directly access `basic`
        if (basicData?.date && hideDateReadable !== 'true' && hideDateReadable !== true) {
            const date = new Date(basicData.date * 1000); // Convert Unix timestamp to milliseconds
            record.data.basic.dateReadable = date.toDateString();
        }
        return record;
    });

        // console.log('after adding dateReadable field, there are', records.length, 'records');

        // Helper function to sort records based on sortBy parameter
        const applySorting = (recordsToSort, sortByParam, silent = false) => {
            if (sortByParam != undefined) {
                // console.log('sorting by:', sortByParam);
                const fieldToSortBy = sortByParam.split(':')[0];
                const order = sortByParam.split(':')[1];
                
                if (fieldToSortBy === 'inArweaveBlock') {
                    recordsToSort.sort((a, b) => {
                        if (order === 'asc') {
                            return a.oip.inArweaveBlock - b.oip.inArweaveBlock;
                        } else {
                            return b.oip.inArweaveBlock - a.oip.inArweaveBlock;
                        }
                    });
                }

                if (fieldToSortBy === 'indexedAt') {
                    recordsToSort.sort((a, b) => {
                        if (order === 'asc') {
                            return new Date(a.oip.indexedAt) - new Date(b.oip.indexedAt);
                        } else {
                            return new Date(b.oip.indexedAt) - new Date(a.oip.indexedAt);
                        }
                    });
                }

                if (fieldToSortBy === 'ver') {
                    recordsToSort.sort((a, b) => {
                        if (order === 'asc') {
                            return a.oip.ver - b.oip.ver;
                        } else {
                            return b.oip.ver - a.oip.ver;
                        }
                    });
                }

                if (fieldToSortBy === 'recordType') {
                    recordsToSort.sort((a, b) => {
                        if (order === 'asc') {
                            return a.oip.recordType.localeCompare(b.oip.recordType);
                        } else {
                            return b.oip.recordType.localeCompare(a.oip.recordType);
                        }
                    });
                }

                if (fieldToSortBy === 'creatorHandle') {
                    recordsToSort.sort((a, b) => {
                        if (order === 'asc') {
                            return a.oip.creator.creatorHandle.localeCompare(b.oip.creator.creatorHandle);
                        } else {
                            return b.oip.creator.creatorHandle.localeCompare(a.oip.creator.creatorHandle);
                        }
                    });
                }

                if (fieldToSortBy === 'date') {
                    recordsToSort.sort((a, b) => {
                        if (!a.data || !a.data.basic || !a.data.basic.date) return 1;
                        if (!b.data || !b.data.basic || !b.data.basic.date) return -1;
                        if (order === 'asc') {
                            return a.data.basic.date - b.data.basic.date;
                        } else {
                            return b.data.basic.date - a.data.basic.date;
                        }
                    });
                }

                if (fieldToSortBy === 'score') {
                    recordsToSort.sort((a, b) => {
                        if (order === 'asc') {
                            return (a.score || 0) - (b.score || 0);
                        } else {
                            return (b.score || 0) - (a.score || 0);
                        }
                    });
                }

                if (fieldToSortBy === 'tags') {
                    // Only allow 'tags' sorting when tags parameter is provided
                    if (tags != undefined) {
                        recordsToSort.sort((a, b) => {
                            if (order === 'asc') {
                                return (a.score || 0) - (b.score || 0);
                            } else {
                                return (b.score || 0) - (a.score || 0);
                            }
                        });
                        if (!silent) console.log('sorted by tags match score (' + order + ')');
                    } else {
                        if (!silent) console.log('Warning: sortBy=tags specified but no tags parameter provided - skipping tags sort');
                    }
                }

                if (fieldToSortBy === 'exerciseScore') {
                    // Only allow 'exerciseScore' sorting when exerciseNames parameter is provided
                    if (exerciseNames != undefined) {
                        recordsToSort.sort((a, b) => {
                            if (order === 'asc') {
                                return (a.exerciseScore || 0) - (b.exerciseScore || 0);
                            } else {
                                return (b.exerciseScore || 0) - (a.exerciseScore || 0);
                            }
                        });
                        if (!silent) console.log('sorted by exercise score (' + order + ')');
                    } else {
                        if (!silent) console.log('Warning: sortBy=exerciseScore specified but no exerciseNames parameter provided - skipping exerciseScore sort');
                    }
                }

                if (fieldToSortBy === 'ingredientScore') {
                    // Only allow 'ingredientScore' sorting when ingredientNames parameter is provided
                    if (ingredientNames != undefined) {
                        recordsToSort.sort((a, b) => {
                            if (order === 'asc') {
                                return (a.ingredientScore || 0) - (b.ingredientScore || 0);
                            } else {
                                return (b.ingredientScore || 0) - (a.ingredientScore || 0);
                            }
                        });
                        if (!silent) console.log('sorted by ingredient score (' + order + ')');
                    } else {
                        if (!silent) console.log('Warning: sortBy=ingredientScore specified but no ingredientNames parameter provided - skipping ingredientScore sort');
                    }
                }

                if (fieldToSortBy === 'equipmentScore') {
                    // Only allow 'equipmentScore' sorting when equipmentRequired parameter is provided
                    if (equipmentRequired != undefined) {
                        recordsToSort.sort((a, b) => {
                            if (order === 'asc') {
                                return (a.equipmentScore || 0) - (b.equipmentScore || 0);
                            } else {
                                return (b.equipmentScore || 0) - (a.equipmentScore || 0);
                            }
                        });
                        if (!silent) console.log('sorted by equipment score (' + order + ')');
                    } else {
                        if (!silent) console.log('Warning: sortBy=equipmentScore specified but no equipmentRequired parameter provided - skipping equipmentScore sort');
                    }
                }

                if (fieldToSortBy === 'exerciseTypeScore') {
                    // Only allow 'exerciseTypeScore' sorting when exerciseType parameter is provided
                    if (exerciseType != undefined) {
                        recordsToSort.sort((a, b) => {
                            if (order === 'asc') {
                                return (a.exerciseTypeScore || 0) - (b.exerciseTypeScore || 0);
                            } else {
                                return (b.exerciseTypeScore || 0) - (a.exerciseTypeScore || 0);
                            }
                        });
                        if (!silent) console.log('sorted by exercise type score (' + order + ')');
                    } else {
                        if (!silent) console.log('Warning: sortBy=exerciseTypeScore specified but no exerciseType parameter provided - skipping exerciseTypeScore sort');
                    }
                }

                if (fieldToSortBy === 'cuisineScore') {
                    // Only allow 'cuisineScore' sorting when cuisine parameter is provided
                    if (cuisine != undefined) {
                        recordsToSort.sort((a, b) => {
                            if (order === 'asc') {
                                return (a.cuisineScore || 0) - (b.cuisineScore || 0);
                            } else {
                                return (b.cuisineScore || 0) - (a.cuisineScore || 0);
                            }
                        });
                        if (!silent) console.log('sorted by cuisine score (' + order + ')');
                    } else {
                        if (!silent) console.log('Warning: sortBy=cuisineScore specified but no cuisine parameter provided - skipping cuisineScore sort');
                    }
                }

                if (fieldToSortBy === 'modelScore') {
                    // Only allow 'modelScore' sorting when model parameter is provided
                    if (model != undefined) {
                        recordsToSort.sort((a, b) => {
                            if (order === 'asc') {
                                return (a.modelScore || 0) - (b.modelScore || 0);
                            } else {
                                return (b.modelScore || 0) - (a.modelScore || 0);
                            }
                        });
                        if (!silent) console.log('sorted by model score (' + order + ')');
                    } else {
                        if (!silent) console.log('Warning: sortBy=modelScore specified but no model parameter provided - skipping modelScore sort');
                    }
                }

                if (fieldToSortBy === 'matchCount') {
                    // Only allow 'matchCount' sorting when search parameter is provided
                    if (search != undefined) {
                        recordsToSort.sort((a, b) => {
                            if (order === 'asc') {
                                return (a.matchCount || 0) - (b.matchCount || 0);
                            } else {
                                return (b.matchCount || 0) - (a.matchCount || 0);
                            }
                        });
                        if (!silent) console.log('sorted by match count (' + order + ')');
                    } else {
                        if (!silent) console.log('Warning: sortBy=matchCount specified but no search parameter provided - skipping matchCount sort');
                    }
                }

                if (fieldToSortBy === 'scheduleDate') {
                    // Only allow 'scheduleDate' sorting when recordType is mealPlan or workoutSchedule
                    if (recordType === 'mealPlan' || recordType === 'workoutSchedule') {
                        recordsToSort.sort((a, b) => {
                            let aDate, bDate;
                            
                            // Get the appropriate date field based on record type
                            if (recordType === 'mealPlan') {
                                aDate = a.data?.mealPlan?.meal_date;
                                bDate = b.data?.mealPlan?.meal_date;
                            } else if (recordType === 'workoutSchedule') {
                                aDate = a.data?.workoutSchedule?.scheduled_date;
                                bDate = b.data?.workoutSchedule?.scheduled_date;
                            }
                            
                            // Handle missing dates (put them at the end)
                            if (!aDate && !bDate) return 0;
                            if (!aDate) return 1;
                            if (!bDate) return -1;
                            
                            // Sort by unix timestamp values
                            if (order === 'asc') {
                                return aDate - bDate;
                            } else {
                                return bDate - aDate;
                            }
                        });
                        if (!silent) console.log(`sorted by scheduled date (${order}) for recordType=${recordType}`);
                    } else {
                        if (!silent) console.log(`Warning: sortBy=scheduledDate specified but recordType is '${recordType}' (must be 'mealPlan' or 'workoutSchedule') - skipping scheduledDate sort`);
                    }
                }
            }
        };

        // Sort records based on sortBy parameter
        applySorting(records, sortBy);

        // Apply noDuplicates filtering if requested (after applySorting is defined)
        if (noDuplicates === true || noDuplicates === 'true') {
            // console.log('Applying noDuplicates filtering...');
            
            // use default for duplicate resolution
            const duplicateSortBy = 'inArweaveBlock:desc';
            
            // Group records by their basic.name field
            const recordsByName = {};
            records.forEach(record => {
                const name = record.data?.basic?.name;
                if (name) {
                    if (!recordsByName[name]) {
                        recordsByName[name] = [];
                    }
                    recordsByName[name].push(record);
                }
            });
            
            // For each name group, keep only the best record based on sorting criteria
            const uniqueRecords = [];
            Object.entries(recordsByName).forEach(([name, duplicateRecords]) => {
                if (duplicateRecords.length === 1) {
                    // No duplicates, keep the single record
                    uniqueRecords.push(duplicateRecords[0]);
                } else {
                    // Multiple records with same name, sort and keep the best one
                    const sortedDuplicates = [...duplicateRecords];
                    applySorting(sortedDuplicates, duplicateSortBy, true); // silent = true to avoid spamming logs
                    uniqueRecords.push(sortedDuplicates[0]);
                    // console.log(`Filtered ${duplicateRecords.length - 1} duplicate(s) for name "${name}", kept record with DID: ${sortedDuplicates[0].oip?.did || sortedDuplicates[0].oip?.didTx}`);
                }
            });
            
            // Also include records that don't have a basic.name field
            const recordsWithoutName = records.filter(record => !record.data?.basic?.name);
            uniqueRecords.push(...recordsWithoutName);
            
            records = uniqueRecords;
            console.log(`After noDuplicates filtering, ${records.length} unique records remain`);
        }

        // Resolve records if resolveDepth is specified
        let resolvedRecords = await Promise.all(records.map(async (record) => {
            let resolvedRecord = await resolveRecords(
                record, 
                parseInt(resolveDepth), 
                recordsInDB, 
                resolveNamesOnly === 'true' || resolveNamesOnly === true,
                summarizeRecipe === 'true' || summarizeRecipe === true,
                addRecipeNutritionalSummary
            );
            return resolvedRecord;
        }));

        // Helper function to recursively remove null values from an object
        const removeNullValues = (obj) => {
            if (Array.isArray(obj)) {
                return obj.map(item => removeNullValues(item)).filter(item => item !== null);
            } else if (obj !== null && typeof obj === 'object') {
                const result = {};
                for (const [key, value] of Object.entries(obj)) {
                    if (value !== null) {
                        const cleanedValue = removeNullValues(value);
                        if (cleanedValue !== null) {
                            result[key] = cleanedValue;
                        }
                    }
                }
                return result;
            }
            return obj;
        };

        // Add nutritional summaries for recipe records if summarizeRecipe is true
        // Use 'calculatedSummary' prefix to distinguish from publish-time 'summary' fields
        if (summarizeRecipe === 'true' || summarizeRecipe === true) {
            resolvedRecords = await Promise.all(resolvedRecords.map(async (record) => {
                if (record.oip.recordType === 'recipe' && record.data.recipe) {
                    return await addRecipeNutritionalSummary(record, recordsInDB, 'calculatedSummary');
                }
                return record;
            }));
        }

        // Remove null values if hideNullValues is true
        if (hideNullValues === 'true' || hideNullValues === true) {
            resolvedRecords = resolvedRecords.map(record => removeNullValues(record));
        }

        // Filter workouts by exercise names if exerciseNames parameter is provided
        if (exerciseNames && recordType === 'workout') {
            console.log('Filtering workouts by exercise names:', exerciseNames);
            const requestedExercises = exerciseNames.split(',').map(name => name.trim().toLowerCase());
            
            // Helper function to calculate order similarity score
            const calculateOrderSimilarity = (workoutExercises, requestedExercises) => {
                // Extract exercise names from various data structures
                const workoutExercisesLower = workoutExercises.map(ex => {
                    if (typeof ex === 'string') {
                        return ex.toLowerCase();
                    } else if (ex && typeof ex === 'object' && ex.data && ex.data.basic && ex.data.basic.name) {
                        return ex.data.basic.name.toLowerCase();
                    } else if (ex && typeof ex === 'object' && ex.name) {
                        return ex.name.toLowerCase();
                    } else {
                        console.warn('Unexpected exercise data structure:', ex);
                        return '';
                    }
                }).filter(name => name); // Remove empty strings
                
                let score = 0;
                let matchedCount = 0;
                
                // Check how many requested exercises are present
                for (const requestedExercise of requestedExercises) {
                    if (workoutExercisesLower.includes(requestedExercise)) {
                        matchedCount++;
                    }
                }
                
                // Base score is the ratio of matched exercises
                const matchRatio = matchedCount / requestedExercises.length;
                
                // Bonus points for maintaining order
                let orderBonus = 0;
                let lastFoundIndex = -1;
                
                for (const requestedExercise of requestedExercises) {
                    const foundIndex = workoutExercisesLower.indexOf(requestedExercise);
                    if (foundIndex > lastFoundIndex) {
                        orderBonus += 0.1; // Small bonus for maintaining order
                        lastFoundIndex = foundIndex;
                    }
                }
                
                score = matchRatio + (orderBonus / requestedExercises.length);
                return { score, matchedCount };
            };
            
            // Filter and score workout records
            resolvedRecords = resolvedRecords.filter(record => {
                if (record.oip.recordType !== 'workout' || !record.data.workout || !record.data.workout.exercise) {
                    return false;
                }
                
                const workoutExercises = record.data.workout.exercise;
                
                // Ensure workoutExercises is an array
                if (!Array.isArray(workoutExercises) || workoutExercises.length === 0) {
                    return false;
                }
                
                const { score, matchedCount } = calculateOrderSimilarity(workoutExercises, requestedExercises);
                
                // Only include workouts that have at least one matching exercise
                if (matchedCount > 0) {
                    record.exerciseScore = score;
                    record.exerciseMatchedCount = matchedCount;
                    return true;
                }
                
                return false;
            });
            
            // Sort by exercise score (best matches first)
            resolvedRecords.sort((a, b) => {
                // Sort by exercise score descending, then by matched count descending
                if (b.exerciseScore !== a.exerciseScore) {
                    return b.exerciseScore - a.exerciseScore;
                }
                return b.exerciseMatchedCount - a.exerciseMatchedCount;
            });
            
            console.log('After filtering by exercise names, there are', resolvedRecords.length, 'workout records');
        }

        // Filter workouts by exercise DIDs if exerciseDIDs parameter is provided
        if (exerciseDIDs && recordType === 'workout') {
            console.log('Filtering workouts by exercise DIDs:', exerciseDIDs);
            const requestedExerciseDIDs = exerciseDIDs.split(',').map(did => did.trim());
            
            // Helper function to calculate order similarity score for DIDs
            const calculateDIDOrderSimilarity = (workoutExercises, requestedExerciseDIDs) => {
                // Extract exercise DIDs from various data structures
                const workoutExerciseDIDs = workoutExercises.map(ex => {
                    if (typeof ex === 'string' && (ex.startsWith('did:arweave:') || ex.startsWith('did:gun:'))) {
                        return ex; // Direct DID string
                    } else if (ex && typeof ex === 'object' && ex.oip && ex.oip.didTx) {
                        return ex.oip.didTx; // Resolved record with DID
                    } else if (ex && typeof ex === 'object' && ex.did) {
                        return ex.did; // Object with DID property
                    } else {
                        console.warn('Unexpected exercise data structure for DID matching:', ex);
                        return '';
                    }
                }).filter(did => did); // Remove empty strings
                
                let score = 0;
                let matchedCount = 0;
                
                // Check how many requested exercise DIDs are present
                for (const requestedDID of requestedExerciseDIDs) {
                    if (workoutExerciseDIDs.includes(requestedDID)) {
                        matchedCount++;
                    }
                }
                
                // Base score is the ratio of matched exercises
                const matchRatio = matchedCount / requestedExerciseDIDs.length;
                
                // Bonus points for maintaining order
                let orderBonus = 0;
                let lastFoundIndex = -1;
                
                for (const requestedDID of requestedExerciseDIDs) {
                    const foundIndex = workoutExerciseDIDs.indexOf(requestedDID);
                    if (foundIndex > lastFoundIndex) {
                        orderBonus += 0.1; // Small bonus for maintaining order
                        lastFoundIndex = foundIndex;
                    }
                }
                
                score = matchRatio + (orderBonus / requestedExerciseDIDs.length);
                return { score, matchedCount };
            };
            
            // Filter and score workout records
            resolvedRecords = resolvedRecords.filter(record => {
                if (record.oip.recordType !== 'workout' || !record.data.workout || !record.data.workout.exercise) {
                    return false;
                }
                
                const workoutExercises = record.data.workout.exercise;
                
                // Ensure workoutExercises is an array
                if (!Array.isArray(workoutExercises) || workoutExercises.length === 0) {
                    return false;
                }
                
                const { score, matchedCount } = calculateDIDOrderSimilarity(workoutExercises, requestedExerciseDIDs);
                
                // Only include workouts that have at least one matching exercise
                if (matchedCount > 0) {
                    record.exerciseScore = score;
                    record.exerciseMatchedCount = matchedCount;
                    return true;
                }
                
                return false;
            });
            
            // Sort by exercise score (best matches first)
            resolvedRecords.sort((a, b) => {
                // Sort by exercise score descending, then by matched count descending
                if (b.exerciseScore !== a.exerciseScore) {
                    return b.exerciseScore - a.exerciseScore;
                }
                return b.exerciseMatchedCount - a.exerciseMatchedCount;
            });
            
            console.log('After filtering by exercise DIDs, there are', resolvedRecords.length, 'workout records');
        }

        // Filter recipes by ingredient names if ingredientNames parameter is provided
        if (ingredientNames && recordType === 'recipe') {
            console.log('Filtering recipes by ingredient names:', ingredientNames);
            const requestedIngredients = ingredientNames.split(',').map(name => name.trim().toLowerCase());
            
            // Helper function to calculate order similarity score for ingredients
            const calculateIngredientOrderSimilarity = (recipeIngredients, requestedIngredients) => {
                // Extract ingredient names from resolved records
                const recipeIngredientNames = recipeIngredients.map(ingredient => {
                    if (typeof ingredient === 'string') {
                        return ingredient.toLowerCase();
                    } else if (ingredient && typeof ingredient === 'object' && ingredient.data && ingredient.data.basic && ingredient.data.basic.name) {
                        return ingredient.data.basic.name.toLowerCase();
                    } else if (ingredient && typeof ingredient === 'object' && ingredient.name) {
                        return ingredient.name.toLowerCase();
                    } else {
                        console.warn('Unexpected ingredient data structure:', ingredient);
                        return '';
                    }
                }).filter(name => name); // Remove empty strings
                
                let score = 0;
                let matchedCount = 0;
                
                // Check how many requested ingredients are present
                for (const requestedIngredient of requestedIngredients) {
                    if (recipeIngredientNames.includes(requestedIngredient)) {
                        matchedCount++;
                    }
                }
                
                // Base score is the ratio of matched ingredients
                const matchRatio = matchedCount / requestedIngredients.length;
                
                // Bonus points for maintaining order
                let orderBonus = 0;
                let lastFoundIndex = -1;
                
                for (const requestedIngredient of requestedIngredients) {
                    const foundIndex = recipeIngredientNames.indexOf(requestedIngredient);
                    if (foundIndex > lastFoundIndex) {
                        orderBonus += 0.1; // Small bonus for maintaining order
                        lastFoundIndex = foundIndex;
                    }
                }
                
                score = matchRatio + (orderBonus / requestedIngredients.length);
                return { score, matchedCount };
            };
            
            // Filter and score recipe records
            resolvedRecords = resolvedRecords.filter(record => {
                if (record.oip.recordType !== 'recipe' || !record.data.recipe || !record.data.recipe.ingredient) {
                    return false;
                }
                
                const recipeIngredients = record.data.recipe.ingredient;
                
                // Ensure recipeIngredients is an array
                if (!Array.isArray(recipeIngredients) || recipeIngredients.length === 0) {
                    return false;
                }
                
                const { score, matchedCount } = calculateIngredientOrderSimilarity(recipeIngredients, requestedIngredients);
                
                // Only include recipes that have at least one matching ingredient
                if (matchedCount > 0) {
                    record.ingredientScore = score;
                    record.ingredientMatchedCount = matchedCount;
                    return true;
                }
                
                return false;
            });
            
            // Sort by ingredient score (best matches first)
            resolvedRecords.sort((a, b) => {
                // Sort by ingredient score descending, then by matched count descending
                if (b.ingredientScore !== a.ingredientScore) {
                    return b.ingredientScore - a.ingredientScore;
                }
                return b.ingredientMatchedCount - a.ingredientMatchedCount;
            });
            
            console.log('After filtering by ingredient names, there are', resolvedRecords.length, 'recipe records');
        }

        if (hasAudio) {
            // console.log('Filtering for records with audio...');
            const initialResolvedRecords = resolvedRecords;
            resolvedRecords = resolvedRecords.filter(record => {
                return Object.values(record.data).some(item => {
                    // Check for audioItems array and iterate safely
                    if (item.audioItems) {
                        return item.audioItems.some(audioItem => 
                            audioItem?.data?.audio?.webUrl || audioItem?.data?.associatedURLOnWeb?.url
                        );
                    }
                    // Check directly for audio data at other possible places
                    if (item.post?.audioItems) {
                        return item.post.audioItems.some(audioItem => 
                            audioItem?.data?.audio?.webUrl || audioItem?.data?.associatedURLOnWeb?.url
                        );
                    }
                    // Add a final safety check for `webUrl` at a higher level
                    return item?.webUrl && item.webUrl.includes('http');
                });
            });
            // console.log('After filtering for audio, there are', resolvedRecords.length, 'records');
            if (hasAudio === 'false') {
            // console.log('count of resolvedRecords, initialResolvedRecords', resolvedRecords.length, initialResolvedRecords.length);
            // remove the records in resolvedRecords from initialResolvedRecords and return the remaining records
            resolvedRecords = initialResolvedRecords.filter(record => !resolvedRecords.includes(record));
            // console.log('After filtering for records without audio, there are', resolvedRecords.length, 'records');
            }
            else {
            // console.log('After filtering for records with audio, there are', resolvedRecords.length, 'records');
            }
        }

        // console.log('es 982 resolvedRecords:', resolvedRecords.length);

        let currentBlockHeight = await getCurrentBlockHeight();
        let progress = Math.round((maxArweaveBlockInDB - startBlockHeight) / (currentBlockHeight - startBlockHeight)  * 100);
        const searchResults = resolvedRecords.length;
        if (summarizeTags === 'true') {
            console.log(`📊 [Tag Summary] Starting tag summarization with ${resolvedRecords.length} records`);
            const tagCounts = {};
            
            resolvedRecords.forEach(record => {
            const tags = record.data?.basic?.tagItems ?? [];
            if (Array.isArray(tags)) {
                tags.forEach(tag => {
                tagCounts[tag] = (tagCounts[tag] || 0) + 1;
                });
            }
            });
            
            console.log(`📊 [Tag Summary] Found ${Object.keys(tagCounts).length} unique tags from ${resolvedRecords.length} records`);
            
            const summary = Object.keys(tagCounts)
            .map(tag => ({ tag, count: tagCounts[tag] }))
            .sort((a, b) => b.count - a.count);
            
            // Apply Paging to tag summary (pageSize and pageNumber already declared at top)
            // const pageSize = parseInt(limit) || 20; // Already declared
            // const pageNumber = parseInt(page) || 1;  // Already declared
            const tagPageNumber = parseInt(tagPage) || 1;  // Default to the first page
            const tagCountParsed = parseInt(tagCount) || 20;  // Default to 20 tags per page
            const tagStartIndex = (tagPageNumber - 1) * tagCountParsed;
            const tagEndIndex = tagStartIndex + tagCountParsed;

            const startIndex = (pageNumber - 1) * pageSize;
            const endIndex = startIndex + pageSize;

            const paginatedTagSummary = summary.slice(tagStartIndex, tagEndIndex);

            // Only filter by tags if user has actually applied tag filters
            let sortedRecords;
            if (tags && tags.trim()) {
                // User applied tag filters - filter and sort by tag matches
                // console.log(`🔍 DEBUG: Applying tag-based filtering with tags: ${tags}`);
                const tagArray = paginatedTagSummary.map(summary => summary.tag);
                const filteredRecords = resolvedRecords.filter(record => {
                    return record.data.basic && record.data.basic.tagItems && record.data.basic.tagItems.some(tag => tagArray.includes(tag));
                });
                // Add tag match scores to records
                sortedRecords = filteredRecords.map(record => {
                    const countMatches = (record) => {
                        if (record.data && record.data.basic && record.data.basic.tagItems) {
                            return record.data.basic.tagItems.filter(tag => tagArray.includes(tag)).length;
                        }
                        return 0;
                    };

                    const matches = countMatches(record);
                    const score = (matches / tagArray.length).toFixed(3); // Calculate the score as a ratio of matches to total tags and trim to three decimal places
                    return { ...record, score }; // Attach the score to the record
                });
                // console.log(`🔍 DEBUG: After tag filtering - sortedRecords.length=${sortedRecords.length}`);
            } else {
                // No tag filters applied - use all resolved records with default score
                // console.log(`🔍 DEBUG: No tag filters applied - using all ${resolvedRecords.length} resolved records`);
                sortedRecords = resolvedRecords.map(record => {
                    return { ...record, score: 1.0 }; // Default score for non-tag-filtered records
                });
            }

            // Apply sorting - use sortBy parameter if provided, otherwise sort by score
            // console.log(`🔍 DEBUG: Before sorting - sortedRecords.length=${sortedRecords.length}, sortBy=${sortBy}`);
            if (sortBy != undefined) {
                applySorting(sortedRecords, sortBy);
                // console.log(`🔍 DEBUG: After applySorting - sortedRecords.length=${sortedRecords.length}`);
            } else {
                sortedRecords.sort((a, b) => b.score - a.score); // Sort in descending order by score
                // console.log(`🔍 DEBUG: After score sorting - sortedRecords.length=${sortedRecords.length}`);
            }

            const finalRecords = sortedRecords.slice(startIndex, endIndex);
            // console.log(`🔍 DEBUG: Final pagination - sortedRecords.length=${sortedRecords.length}, startIndex=${startIndex}, endIndex=${endIndex}, finalRecords.length=${finalRecords.length}`);
            
            return {
                message: "Records retrieved successfully",
                latestArweaveBlockInDB: maxArweaveBlockInDB,
                indexingProgress: `${progress}%`,
                totalRecords: qtyRecordsInDB,
                searchResults: searchResults,
                tagSummary: paginatedTagSummary,
                tagCount: summary.length,
                pageSize: pageSize,
                currentPage: pageNumber,
                totalPages: Math.ceil(summary.length / pageSize),
                records: finalRecords,
            };
        
        }

        // Apply in-memory paging ONLY if post-processing was required
        // (If post-processing wasn't needed, ES already paginated correctly)
        if (requiresPostProcessing) {
            const startIndex = (pageNumber - 1) * pageSize;
            const endIndex = startIndex + pageSize;
            
            const paginatedRecords = resolvedRecords.slice(startIndex, endIndex);
            resolvedRecords = paginatedRecords;
            
            console.log(`📄 [Pagination] Applied in-memory pagination: ${startIndex}-${endIndex} from ${records.length} records (post-processing mode)`);
        } else {
            console.log(`📄 [Pagination] Using ES native pagination: page ${pageNumber}, size ${pageSize} (no post-processing)`);
        }

        return {
            message: "Records retrieved successfully",
            latestArweaveBlockInDB: maxArweaveBlockInDB,
            indexingProgress: `${progress}%`,
            totalRecords: qtyRecordsInDB,
            pageSize: pageSize,
            currentPage: pageNumber,
            searchResults: searchResults,
            queryParams: queryParams,
            totalPages: Math.ceil(records.length / pageSize),
            records: resolvedRecords
        };

    } catch (error) {
        console.error('Error retrieving records:', error);
        throw new Error('Failed to retrieve records');
    }
}

const getOrganizationsInDB = async () => {
    try {
        // MEMORY LEAK FIX: Only fetch aggregated data (count and max block), not all records
        // Previously was loading 10,000 full organization records every 5 minutes!
        const response = await elasticClient.search({
            index: 'organizations',
            body: {
                query: {
                    match_all: {}
                },
                size: 0, // Don't fetch any records, just aggregations
                aggs: {
                    count: {
                        value_count: {
                            field: "_id"
                        }
                    },
                    max_block: {
                        max: {
                            field: "oip.inArweaveBlock"
                        }
                    }
                }
            }
        });

        const qtyOrganizationsInDB = response.aggregations?.count?.value || 0;
        const maxArweaveOrgBlockInDB = response.aggregations?.max_block?.value || 0;

        // console.log(getFileInfo(), getLineNumber(), `Found ${qtyOrganizationsInDB} organizations in organizations index (max block: ${maxArweaveOrgBlockInDB})`);

        return {
            qtyOrganizationsInDB,
            maxArweaveOrgBlockInDB,
            organizationsInDB: [] // Don't return full records - just the counts
        };
    } catch (error) {
        console.error(getFileInfo(), getLineNumber(), 'Error getting organizations from DB:', error);
        return {
            qtyOrganizationsInDB: 0,
            maxArweaveOrgBlockInDB: 0,
            organizationsInDB: []
        };
    }
};

const getCreatorsInDB = async () => {
    try {
        const searchResponse = await elasticClient.search({
            index: 'creatorregistrations',
            body: {
                query: {
                    match_all: {}
                },
                size: 100 // note: should make this into a variable to be passed in
            }
        });

        const creatorsInDB = searchResponse.hits.hits.map(hit => hit._source);
        if (creatorsInDB.length === 0) {
            console.log(getFileInfo(), getLineNumber(),  'Error - No creators found in DB')
            return { qtyCreatorsInDB: 0, maxArweaveCreatorRegBlockInDB: 0, creators: [] };
        } else {
            // console.log(getFileInfo(), getLineNumber(),  'Creators found in DB:', creatorsInDB.length);
            const qtyCreatorsInDB = creatorsInDB.length;
            
            // Filter out creators with "pending confirmation in Arweave" status when calculating max block height
            // This ensures pending creators get re-processed when found confirmed on chain
            const confirmedCreators = creatorsInDB.filter(creator => 
                creator.oip.recordStatus !== "pending confirmation in Arweave"
            );
            const pendingCreatorsCount = creatorsInDB.length - confirmedCreators.length;
            if (pendingCreatorsCount > 0) {
                console.log(getFileInfo(), getLineNumber(), `Found ${pendingCreatorsCount} pending creators (will re-process when confirmed)`);
            }
            const maxArweaveCreatorRegBlockInDB = confirmedCreators.length > 0 
                ? Math.max(...confirmedCreators.map(creator => creator.oip.inArweaveBlock))
                : 0;
            // console.log(getFileInfo(), getLineNumber(),  'maxArweaveCreatorRegBlockInDB:', maxArweaveCreatorRegBlockInDB);
            return { qtyCreatorsInDB, maxArweaveCreatorRegBlockInDB, creatorsInDB };
        }
    } catch (error) {
        console.error(getFileInfo(), getLineNumber(), 'Error retrieving creators from database:', error);
        return [];
    }
};

async function searchRecordInDB(didTx) {
    // console.log(getFileInfo(), getLineNumber(), 'Searching record in DB for didTx:', didTx);
        const searchResponse = await elasticClient.search({
            index: 'records',
            body: {
                query: createDIDQuery(didTx)
            }
        });
    // console.log(getFileInfo(), getLineNumber(), 'Search response:', JSON.stringify(searchResponse, null, 2));
    if (searchResponse.hits.hits.length > 0) {
        return searchResponse.hits.hits[0]._source;
    } else {
        return null;
    }
}

// MEMORY LEAK FIX: Add caching to prevent loading 5000 records on every API call
let recordsCache = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 300000; // 5 minutes cache (was 30 seconds, too aggressive)
let keepDBCycleCount = 0; // Track keepDBUpToDate cycles

/**
 * Helper function to build Elasticsearch query from getRecords parameters
 * Implements Phase 1-3 of the optimization plan
 */
const buildElasticsearchQuery = (params) => {
    const must = [];
    const should = [];
    const mustNot = [];
    
    // Phase 1: Native ES filters
    
    // Filter by record type
    if (params.recordType) {
        must.push({
            term: { "oip.recordType.keyword": params.recordType } // Don't lowercase - ES stores exact case
        });
    }
    
    // Filter by storage source (arweave/gun/irys)
    if (params.source && params.source !== 'all') {
        const didPrefix = `did:${params.source}:`;
        must.push({
            prefix: { "oip.did.keyword": didPrefix }
        });
    }
    
    // Filter by storage field (alias for source)
    if (params.storage && params.storage !== 'all') {
        const didPrefix = `did:${params.storage}:`;
        must.push({
            prefix: { "oip.did.keyword": didPrefix }
        });
    }
    
    // Filter by specific DID
    const normalizedDid = params.did || params.didTx;
    if (normalizedDid) {
        must.push({
            term: { "oip.did.keyword": normalizedDid }
        });
    }
    
    // Filter by creator handle
    if (params.creatorHandle) {
        must.push({
            term: { "oip.creator.creatorHandle.keyword": params.creatorHandle }
        });
    }
    
    // Filter by creator DID address
    if (params.creator_did_address) {
        const decodedCreatorDidAddress = decodeURIComponent(params.creator_did_address);
        must.push({
            term: { "oip.creator.didAddress.keyword": decodedCreatorDidAddress }
        });
    }
    
    // Filter by Arweave block
    if (params.inArweaveBlock !== undefined) {
        if (params.inArweaveBlock === 'bad') {
            // Filter for invalid block numbers
            should.push({ bool: { must_not: { exists: { field: "oip.inArweaveBlock" } } } });
            should.push({ term: { "oip.inArweaveBlock": null } });
        } else {
            must.push({
                term: { "oip.inArweaveBlock": params.inArweaveBlock }
            });
        }
    }
    
    // Filter by URL
    if (params.url) {
        should.push({ term: { "data.basic.url.keyword": params.url } });
        should.push({ term: { "data.basic.webUrl.keyword": params.url } });
    }
    
    // Date range filters
    if (params.dateStart || params.dateEnd) {
        const range = {};
        if (params.dateStart) {
            let dateStartTimestamp;
            if (params.dateStart instanceof Date) {
                // Already a Date object
                dateStartTimestamp = Math.floor(params.dateStart.getTime() / 1000);
            } else if (typeof params.dateStart === 'string') {
                // Check if it's a numeric string (Unix timestamp) or date string
                if (/^\d+$/.test(params.dateStart)) {
                    // Numeric string timestamp: "1762156800" → 1762156800
                    dateStartTimestamp = parseInt(params.dateStart, 10);
                } else {
                    // Date string: "2024-11-03" → convert to timestamp
                    dateStartTimestamp = Math.floor(new Date(params.dateStart).getTime() / 1000);
                }
            } else {
                // Already a number
                dateStartTimestamp = params.dateStart;
            }
            range.gte = dateStartTimestamp;
        }
        if (params.dateEnd) {
            let dateEndTimestamp;
            if (params.dateEnd instanceof Date) {
                // Already a Date object
                dateEndTimestamp = Math.floor(params.dateEnd.getTime() / 1000);
            } else if (typeof params.dateEnd === 'string') {
                // Check if it's a numeric string (Unix timestamp) or date string
                if (/^\d+$/.test(params.dateEnd)) {
                    // Numeric string timestamp: "1762761600" → 1762761600
                    dateEndTimestamp = parseInt(params.dateEnd, 10);
                } else {
                    // Date string: "2024-11-03" → convert to timestamp (end of day)
                    const endDate = new Date(params.dateEnd);
                    endDate.setHours(23, 59, 59, 999);
                    dateEndTimestamp = Math.floor(endDate.getTime() / 1000);
                }
            } else {
                // Already a number
                dateEndTimestamp = params.dateEnd;
            }
            range.lte = dateEndTimestamp;
        }
        
        console.log(`📅 [Date Filter] dateStart=${params.dateStart} (${range.gte}), dateEnd=${params.dateEnd} (${range.lte})`);
        
        // Check multiple date fields depending on record type
        const dateQueries = [
            { range: { "data.basic.date": range } },
            { range: { "data.workoutSchedule.scheduled_date": range } },
            { range: { "data.mealPlan.meal_date": range } }
        ];
        
        // Date filters are REQUIRED (must match), not optional (should match)
        must.push({
            bool: {
                should: dateQueries,
                minimum_should_match: 1
            }
        });
    }
    
    // Filter by scheduled date for workoutSchedule and mealPlan
    if (params.scheduledOn) {
        let startTimestamp, endTimestamp;
        
        // Check if it's a Unix timestamp string or number
        if (typeof params.scheduledOn === 'number' || /^\d+$/.test(params.scheduledOn)) {
            // Unix timestamp: treat as exact timestamp or start of day
            const timestamp = typeof params.scheduledOn === 'number' 
                ? params.scheduledOn 
                : parseInt(params.scheduledOn, 10);
            
            // Assume timestamp represents start of day, calculate end of day
            const date = new Date(timestamp * 1000);
            const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
            const endOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
            startTimestamp = Math.floor(startOfDay.getTime() / 1000);
            endTimestamp = Math.floor(endOfDay.getTime() / 1000);
        } else {
            // Date string in YYYY-MM-DD format
            const dateMatch = params.scheduledOn.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (dateMatch) {
                const [, year, month, day] = dateMatch;
                const startOfDay = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), 0, 0, 0, 0);
                const endOfDay = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), 23, 59, 59, 999);
                startTimestamp = Math.floor(startOfDay.getTime() / 1000);
                endTimestamp = Math.floor(endOfDay.getTime() / 1000);
            }
        }
        
        if (startTimestamp && endTimestamp) {
            const scheduledRange = { gte: startTimestamp, lte: endTimestamp };
            
            console.log(`📅 [ScheduledOn Filter] scheduledOn=${params.scheduledOn} (${startTimestamp} - ${endTimestamp})`);
            
            // ScheduledOn filter is REQUIRED (must match), not optional
            must.push({
                bool: {
                    should: [
                        { range: { "data.workoutSchedule.scheduled_date": scheduledRange } },
                        { range: { "data.mealPlan.meal_date": scheduledRange } }
                    ],
                    minimum_should_match: 1
                }
            });
        }
    }
    
    // Exclude delete messages by default
    if (params.includeDeleteMessages === false || params.includeDeleteMessages === 'false') {
        mustNot.push({
            term: { "oip.recordType.keyword": "deleteMessage" }
        });
    }
    
    // Phase 2: Authentication/Privacy Filters
    if (!params.isAuthenticated) {
        // Unauthenticated users only see public records
        must.push({
            bool: {
                should: [
                    { term: { "data.accessControl.access_level.keyword": "public" } },
                    { bool: { must_not: { exists: { field: "data.accessControl.access_level" } } } }
                ],
                minimum_should_match: 1
            }
        });
        
        // Also exclude legacy private conversation sessions
        mustNot.push({
            term: { "data.conversationSession.is_private": true }
        });
    }
    // Note: Authenticated ownership filtering is complex and requires user context,
    // so it will be handled in post-processing for now
    
    // Phase 3: Hybrid Filters (ES + post-processing)
    
    // Tag filtering with AND/OR modes
    if (params.tags) {
        const tagArray = params.tags.split(',').map(tag => tag.trim());
        if (params.tagsMatchMode === 'AND' || params.tagsMatchMode === 'and') {
            // AND mode: must have ALL tags
            tagArray.forEach(tag => {
                must.push({
                    term: { "data.basic.tagItems.keyword": tag }
                });
            });
        } else {
            // OR mode: must have at least ONE tag (default)
            must.push({
                terms: { "data.basic.tagItems.keyword": tagArray }
            });
        }
    }
    
    // Full-text search with AND/OR modes
    if (params.search) {
        const searchTerms = params.search.toLowerCase().split(' ').map(term => term.trim()).filter(Boolean);
        const searchFields = [
            "data.basic.name^3",           // Boost name matches
            "data.basic.description^2",    // Boost description matches
            "data.basic.tagItems^1"        // Normal tag matches
        ];
        
        if (params.searchMatchMode === 'AND' || params.searchMatchMode === 'and') {
            // AND mode: must match ALL terms
            searchTerms.forEach(term => {
                must.push({
                    multi_match: {
                        query: term,
                        fields: searchFields,
                        fuzziness: "AUTO"
                    }
                });
            });
        } else {
            // OR mode: must match at least ONE term
            must.push({
                multi_match: {
                    query: params.search,
                    fields: searchFields,
                    fuzziness: "AUTO"
                }
            });
        }
    }
    
    // Equipment filtering for exercises
    // NOTE: equipmentRequired is stored as array of equipment NAMES (strings), not DIDs
    // User can query by DID or name, so we need to handle both cases
    // If DID is provided, we need to resolve it to name (done in post-processing)
    // If name is provided, we can query directly
    // For now, mark this for post-processing to handle DID resolution properly
    if (params.equipmentRequired && params.recordType === 'exercise') {
        // Check if ANY of the equipment params are DIDs
        const equipmentArray = params.equipmentRequired.split(',').map(eq => eq.trim());
        const hasDID = equipmentArray.some(eq => eq.startsWith('did:arweave:') || eq.startsWith('did:gun:') || eq.startsWith('did:irys:'));
        
        if (!hasDID) {
            // All are names - can query directly in ES
            if (params.equipmentMatchMode === 'AND' || params.equipmentMatchMode === 'and') {
                // AND mode: must have ALL equipment names
                equipmentArray.forEach(equipment => {
                    must.push({
                        term: { "data.exercise.equipmentRequired.keyword": equipment.toLowerCase() }
                    });
                });
            } else {
                // OR mode: must have at least ONE equipment name (default)
                must.push({
                    terms: { "data.exercise.equipmentRequired.keyword": equipmentArray.map(e => e.toLowerCase()) }
                });
            }
        }
        // If DIDs are provided, post-processing will handle resolution
    }
    
    // Exercise type filtering
    if (params.exerciseType && params.recordType === 'exercise') {
        const exerciseTypeArray = params.exerciseType.split(',').map(type => type.trim().toLowerCase());
        const exerciseTypeEnumMap = {
            'warmup': 'Warm-Up',
            'warm-up': 'Warm-Up',
            'main': 'Main',
            'cooldown': 'Cool-Down',
            'cool-down': 'Cool-Down'
        };
        const normalizedTypes = exerciseTypeArray.map(type => exerciseTypeEnumMap[type] || type);
        
        if (params.exerciseTypeMatchMode === 'AND' || params.exerciseTypeMatchMode === 'and') {
            // AND mode: must match ALL types (unusual for enum)
            normalizedTypes.forEach(type => {
                must.push({
                    term: { "data.exercise.exercise_type.keyword": type }
                });
            });
        } else {
            // OR mode: must match at least ONE type (default)
            must.push({
                terms: { "data.exercise.exercise_type.keyword": normalizedTypes }
            });
        }
    }
    
    // Cuisine filtering for recipes
    if (params.cuisine && params.recordType === 'recipe') {
        const cuisineArray = params.cuisine.split(',').map(c => c.trim().toLowerCase());
        
        if (params.cuisineMatchMode === 'AND' || params.cuisineMatchMode === 'and') {
            // AND mode: must contain ALL cuisine terms
            cuisineArray.forEach(cuisine => {
                must.push({
                    wildcard: { "data.recipe.cuisine.keyword": `*${cuisine}*` }
                });
            });
        } else {
            // OR mode: must contain at least ONE cuisine term (default)
            const cuisineQueries = cuisineArray.map(cuisine => ({
                wildcard: { "data.recipe.cuisine.keyword": `*${cuisine}*` }
            }));
            
            should.push({
                bool: {
                    should: cuisineQueries,
                    minimum_should_match: 1
                }
            });
        }
    }
    
    // Model filtering
    if (params.model && params.recordType === 'modelProvider') {
        const modelArray = params.model.split(',').map(m => m.trim().toLowerCase());
        
        // Search in supported_models field (can be array or comma-separated string)
        const modelQueries = modelArray.map(model => ({
            wildcard: { "data.modelProvider.supported_models.keyword": `*${model}*` }
        }));
        
        if (params.modelMatchMode === 'AND' || params.modelMatchMode === 'and') {
            // AND mode: must support ALL models
            modelArray.forEach(model => {
                must.push({
                    wildcard: { "data.modelProvider.supported_models.keyword": `*${model}*` }
                });
            });
        } else {
            // OR mode: must support at least ONE model (default)
            should.push({
                bool: {
                    should: modelQueries,
                    minimum_should_match: 1
                }
            });
        }
    }
    
    // Field-specific search
    if (params.fieldSearch && params.fieldName) {
        const fieldPath = `data.${params.fieldName}`;
        
        if (params.fieldMatchMode === 'exact') {
            must.push({
                term: { [`${fieldPath}.keyword`]: params.fieldSearch }
            });
        } else {
            // Partial match (default)
            must.push({
                wildcard: { [`${fieldPath}.keyword`]: `*${params.fieldSearch.toLowerCase()}*` }
            });
        }
    }
    
    // Exact match filtering (JSON object with field paths)
    if (params.exactMatch) {
        try {
            const exactMatchObj = JSON.parse(params.exactMatch);
            Object.entries(exactMatchObj).forEach(([fieldPath, expectedValue]) => {
                must.push({
                    term: { [`${fieldPath}.keyword`]: expectedValue }
                });
            });
        } catch (error) {
            console.error('Error parsing exactMatch JSON:', error);
        }
    }
    
    // Audio filtering
    if (params.hasAudio) {
        if (params.hasAudio === true || params.hasAudio === 'true') {
            should.push({ exists: { field: "data.post.audioItems" } });
            should.push({ exists: { field: "data.basic.audioItems" } });
        } else {
            mustNot.push({ exists: { field: "data.post.audioItems" } });
            mustNot.push({ exists: { field: "data.basic.audioItems" } });
        }
    }
    
    // Special handling for nutritionalInfo records
    if (params.recordType && params.recordType.toLowerCase() === 'nutritionalinfo') {
        must.push({
            exists: { field: "data.nutritionalInfo" }
        });
    }
    
    // Build final query
    const query = {
        bool: {}
    };
    
    if (must.length > 0) query.bool.must = must;
    if (should.length > 0) {
        query.bool.should = should;
        query.bool.minimum_should_match = query.bool.minimum_should_match || 1;
    }
    if (mustNot.length > 0) query.bool.must_not = mustNot;
    
    // If no filters at all, use match_all
    if (must.length === 0 && should.length === 0 && mustNot.length === 0) {
        return { match_all: {} };
    }
    
    return query;
};

/**
 * Helper function to build Elasticsearch sort configuration
 */
const buildElasticsearchSort = (sortBy = 'inArweaveBlock:desc') => {
    const [field, order] = sortBy.split(':');
    const sortOrder = order || 'desc';
    
    const sortMap = {
        'inArweaveBlock': 'oip.inArweaveBlock',
        'indexedAt': 'oip.indexedAt',
        'date': 'data.basic.date',
        'recordType': 'oip.recordType.keyword',
        'creatorHandle': 'oip.creator.creatorHandle.keyword',
        'ver': 'oip.ver',
        'scheduleDate': null  // Handled in post-processing
    };
    
    const esField = sortMap[field];
    
    // Some sorts require post-processing (scores, complex fields)
    const postProcessSorts = ['score', 'tags', 'exerciseScore', 'ingredientScore', 
                              'equipmentScore', 'exerciseTypeScore', 'cuisineScore', 
                              'modelScore', 'matchCount', 'scheduleDate'];
    
    if (postProcessSorts.includes(field)) {
        // Return null to indicate post-processing needed
        return null;
    }
    
    if (!esField) {
        // Default to inArweaveBlock if unknown field
        return [{ "oip.inArweaveBlock": { order: 'desc' } }];
    }
    
    return [{ [esField]: { order: sortOrder } }];
};

/**
 * Helper function to determine if query needs post-processing filters
 */
const needsPostProcessing = (params) => {
    // Check if equipmentRequired contains DIDs (requires resolution)
    const hasEquipmentDID = params.equipmentRequired && 
        params.equipmentRequired.split(',').some(eq => 
            eq.trim().startsWith('did:arweave:') || 
            eq.trim().startsWith('did:gun:') || 
            eq.trim().startsWith('did:irys:')
        );
    
    return !!(
        params.exerciseNames ||
        params.exerciseDIDs ||
        params.ingredientNames ||
        params.didTxRef ||
        params.template ||
        params.noDuplicates ||
        hasEquipmentDID ||  // Equipment DIDs need resolution to names
        params.isAuthenticated  // Authenticated ownership checks need post-processing
    );
};

/**
 * Helper function to determine over-fetch multiplier
 * When we need post-processing, fetch more records to account for filtering
 */
const getOverFetchMultiplier = (params) => {
    if (params.exerciseNames || params.ingredientNames || params.didTxRef) {
        return 5;  // Need to over-fetch significantly for complex filters
    }
    if (params.template || params.isAuthenticated) {
        return 3;  // Moderate over-fetch for medium complexity
    }
    if (params.noDuplicates) {
        return 2;  // Slight over-fetch for duplicate removal
    }
    return 1;  // No over-fetch needed
};

// move this into GetRecords() ?
const getRecordsInDB = async (forceRefresh = false) => {
    try {
        const now = Date.now();
        
        // Return cached data if it's still fresh and not forcing refresh
        if (!forceRefresh && recordsCache && (now - cacheTimestamp) < CACHE_DURATION) {
            console.log(getFileInfo(), getLineNumber(), 'Using cached records data');
            return recordsCache;
        }

        console.log(getFileInfo(), getLineNumber(), 'Fetching fresh records from Elasticsearch...');
        
        const searchResponse = await elasticClient.search({
            index: 'records',
            body: {
                query: {
                    match_all: {}
                },
                size: 5000 // make this a variable to be passed in
            }
        });
        const records = searchResponse.hits.hits.map(hit => hit._source);
        
        // records.forEach(record => {
        //     console.log(getFileInfo(), getLineNumber(), 'record.oip:', record.oip.creator, record.oip.recordType, record.oip.didTx);
        //     // console.log(record.oip.creator);
        // });
        if (records.length === 0) {
            console.log(getFileInfo(), getLineNumber(), 'no records found in DB');
            const result = { qtyRecordsInDB: 0, finalMaxRecordArweaveBlock: 0, records: [] };
            recordsCache = result;
            cacheTimestamp = now;
            return result;
        } else {
            for (const record of records) {
                const creatorHandle = record.oip.creator.creatorHandle || '';
                const didAddress = record.oip.creator.didAddress || '';
                const didTx = record.oip.creator.didTx || '';
                const publicKey = record.oip.creator.publicKey || '';
                record.oip.creator = {
                    creatorHandle,
                    didAddress,
                    didTx,
                    publicKey
                };
            }
            
            const qtyRecordsInDB = records.length;
            
            // Filter out records with "pending confirmation in Arweave" status when calculating max block height
            // This ensures pending records get re-processed when found confirmed on chain
            const confirmedRecords = records.filter(record => 
                record.oip.recordStatus !== "pending confirmation in Arweave"
            );
            const pendingRecordsCount = records.length - confirmedRecords.length;
            if (pendingRecordsCount > 0) {
                const pendingRecords = records.filter(record => 
                    record.oip.recordStatus === "pending confirmation in Arweave"
                );
                const minBlockInPending = Math.min(...pendingRecords.map(record => record.oip.inArweaveBlock).filter(value => !isNaN(value)));
                const maxBlockInPending = Math.max(...pendingRecords.map(record => record.oip.inArweaveBlock).filter(value => !isNaN(value)));
                const blockRangeStr = !isNaN(minBlockInPending) && !isNaN(maxBlockInPending) ? ` (block range: ${minBlockInPending}-${maxBlockInPending})` : '';
                console.log(getFileInfo(), getLineNumber(), `Found ${pendingRecordsCount} pending records (will re-process when confirmed on chain)${blockRangeStr}`);
            }
            const maxArweaveBlockInDB = confirmedRecords.length > 0 
                ? Math.max(...confirmedRecords.map(record => record.oip.inArweaveBlock).filter(value => !isNaN(value)))
                : 0;
            // console.log(getFileInfo(), getLineNumber(), 'maxArweaveBlockInDB for records:', maxArweaveBlockInDB);
            const maxArweaveBlockInDBisNull = (maxArweaveBlockInDB === -Infinity) || (maxArweaveBlockInDB === -0) || (maxArweaveBlockInDB === null);
            const finalMaxRecordArweaveBlock = maxArweaveBlockInDBisNull ? 0 : maxArweaveBlockInDB;
            
            const result = { qtyRecordsInDB, finalMaxRecordArweaveBlock, records };
            
            // Cache the result
            recordsCache = result;
            cacheTimestamp = now;
            
            return result;
        }
    } catch (error) {
        console.error(getFileInfo(), getLineNumber(), 'Error retrieving records from database:', error);
        return { qtyRecordsInDB: 0, maxArweaveBlockInDB: 0, records: [] };
    }

};

// Function to clear the records cache (useful for memory management)
const clearRecordsCache = () => {
    recordsCache = null;
    cacheTimestamp = 0;
    keepDBCycleCount = 0; // Reset cycle count when cache is cleared
    console.log(getFileInfo(), getLineNumber(), 'Records cache cleared');
};

const findCreatorsByHandle = async (handle) => {
    try {
        const searchResponse = await elasticClient.search({
            index: 'creatorregistrations',
            body: {
                query: {
                    bool: {
                        must: [
                            {
                                wildcard: {
                                    creatorHandle: `${handle}*`
                                }
                            },
                            {
                                regexp: {
                                    creatorHandle: '.*\\d$'
                                }
                            }
                        ]
                    }
                }
            }
        });
        return searchResponse.hits.hits.map(hit => hit._source);
    } catch (error) {
        console.error(getFileInfo(), getLineNumber(), 'Error searching for creators by handle:', error);
        throw error;
    }
};

const convertToCreatorHandle = async (txId, handle) => {
    const decimalNumber = parseInt(txId.replace(/[^0-9a-fA-F]/g, ''), 16);
    
    // Start with one digit
    let digitsCount = 1;
    let uniqueHandleFound = false;
    let finalHandle = '';
    
    while (!uniqueHandleFound) {
        const currentDigits = decimalNumber.toString().substring(0, digitsCount);
        const possibleHandle = `${handle}${currentDigits}`;
        console.log(getFileInfo(), getLineNumber(), 'checking creator handle and id:', handle, decimalNumber);
        // console.log(getFileInfo(), getLineNumber(), `Checking for handle: ${possibleHandle}`);

        // Check for existing creators with the possible handle
        const creators = await findCreatorsByHandle(possibleHandle);

        if (creators.length === 0) {
            uniqueHandleFound = true;
            finalHandle = possibleHandle;
        } else {
            // Increase the number of digits and check again
            digitsCount++;
        }
    }
    console.log(getFileInfo(), getLineNumber(), 'Final handle:', finalHandle);
    return finalHandle;
};

const findOrganizationsByHandle = async (orgHandle) => {
    try {
        console.log(getFileInfo(), getLineNumber(), 'Searching for organizations with handle:', orgHandle);
        const response = await elasticClient.search({
            index: 'organizations', // Use dedicated organizations index
            body: {
                query: {
                    term: {
                        "data.orgHandle.keyword": orgHandle
                    }
                }
            }
        });
        console.log(getFileInfo(), getLineNumber(), 'Found', response.hits.hits.length, 'organizations with handle:', orgHandle);
        return response.hits.hits.map(hit => hit._source);
    } catch (error) {
        console.error(getFileInfo(), getLineNumber(), 'Error searching for organizations by handle:', error);
        throw error;
    }
};

const convertToOrgHandle = async (txId, handle) => {
    const decimalNumber = parseInt(txId.replace(/[^0-9a-fA-F]/g, ''), 16);
    
    // Start with one digit
    let digitsCount = 1;
    let uniqueHandleFound = false;
    let finalHandle = '';
    
    while (!uniqueHandleFound) {
        const currentDigits = decimalNumber.toString().substring(0, digitsCount);
        const possibleHandle = `${handle}${currentDigits}`;
        console.log(getFileInfo(), getLineNumber(), 'checking org handle and id:', handle, decimalNumber);

        // Check for existing organizations with the possible handle
        const organizations = await findOrganizationsByHandle(possibleHandle);

        if (organizations.length === 0) {
            uniqueHandleFound = true;
            finalHandle = possibleHandle;
        } else {
            // Increase the number of digits and check again
            digitsCount++;
        }
    }
    console.log(getFileInfo(), getLineNumber(), 'Final org handle:', finalHandle);
    return finalHandle;
};

// add some kind of history of registrations for organizations
async function indexNewOrganizationRegistration(organizationRegistrationParams) {
    let { transaction, organizationInfo, organizationHandle, block } = organizationRegistrationParams;
    
    let organization;
    
    // Check if this is a delete message
    if (transaction.data.includes('delete')) {
        console.log(getFileInfo(), getLineNumber(), 'Delete message detected for organization registration:', transaction.transactionId);
        return  // Return early if it's a delete message
    }
    
    block = (block !== undefined) ? block : (transaction.blockHeight || await getBlockHeightFromTxId(transaction.transactionId));
    
    console.log('Organization transaction:', transaction);
    
    // Parse organization data correctly from the second object in the data array
    const parsedData = JSON.parse(transaction.data);
    const basicData = parsedData.find(obj => obj.t === "-9DirnjVO1FlbEW1lN8jITBESrTsQKEM_BoZ1ey_0mk");
    const orgData = parsedData.find(obj => obj.t === "NQi19GjOw-Iv8PzjZ5P-XcFkAYu50cl5V_qceT2xlGM");
    
    organizationHandle = (organizationHandle !== undefined) ? organizationHandle : await convertToOrgHandle(transaction.transactionId, orgData["0"]); // Use second object for org data
    
    // Get templates and expand enum values
    const templates = await getTemplatesInDB();
    const orgTemplate = findTemplateByTxId("NQi19GjOw-Iv8PzjZ5P-XcFkAYu50cl5V_qceT2xlGM", templates.templatesInDB);
    
    // Expand membershipPolicy enum value
    let membershipPolicyValue = orgData["3"]; // Raw index value
    if (orgTemplate && orgTemplate.data && orgTemplate.data.fields) {
        const fields = JSON.parse(orgTemplate.data.fields);
        if (fields.membership_policy === "enum" && Array.isArray(fields.membership_policyValues)) {
            const enumValues = fields.membership_policyValues;
            if (typeof membershipPolicyValue === "number" && membershipPolicyValue < enumValues.length) {
                membershipPolicyValue = enumValues[membershipPolicyValue].name;
                console.log(getFileInfo(), getLineNumber(), `Expanded membershipPolicy enum: ${orgData["3"]} -> ${membershipPolicyValue}`);
            }
        }
    }
    
    // Get creator information
    const creatorDid = `did:arweave:${transaction.creator}`;
    let creatorInfo = null;
    try {
        creatorInfo = await searchCreatorByAddress(creatorDid);
        console.log(getFileInfo(), getLineNumber(), 'Creator info found for organization:', creatorInfo);
    } catch (error) {
        console.error(getFileInfo(), getLineNumber(), 'Error getting creator info for organization:', error);
    }
    
    organization = {
        data: {
            orgHandle: organizationHandle,
            name: basicData["0"],
            description: basicData["1"],
            date: basicData["2"],
            language: basicData["3"],
            nsfw: basicData["6"],
            webUrl: basicData["12"],
            orgPublicKey: orgData["1"],        // org_public_key
            adminPublicKeys: orgData["2"],     // admin_public_keys  
            membershipPolicy: membershipPolicyValue,    // Expanded enum value
            metadata: orgData["4"] || null     // metadata (if exists)
        },
        oip: {
            recordType: 'organization',
            did: organizationInfo.data.didTx,
            didTx: organizationInfo.data.didTx, // Backward compatibility
            inArweaveBlock: block,
            indexedAt: new Date(),
            ver: transaction.ver,
            signature: transaction.creatorSig,
            organization: {
                orgHandle: organizationHandle,
                orgPublicKey: orgData["1"],
                adminPublicKeys: orgData["2"],
                membershipPolicy: membershipPolicyValue,  // Expanded enum value
                metadata: orgData["4"] || null
            }
        },
    }
    
    // Add creator object if we found creator info
    if (creatorInfo && creatorInfo.data) {
        organization.oip.creator = {
            creatorHandle: creatorInfo.data.creatorHandle,
            didAddress: creatorInfo.data.didAddress,
            didTx: creatorInfo.data.didTx,
            publicKey: creatorInfo.data.publicKey
        };
        console.log(getFileInfo(), getLineNumber(), 'Added creator object to organization:', organization.oip.creator);
    } else {
        console.log(getFileInfo(), getLineNumber(), 'No creator info found for organization, creator object not added');
    }
    
    console.log(getFileInfo(), getLineNumber(), 'Organization to index:', organization);
    
    try {
        const response = await elasticClient.index({
            index: 'organizations', // Use dedicated organizations index
            id: organization.oip.did,
            body: organization
        });
        console.log(getFileInfo(), getLineNumber(), 'Organization indexed:', response);
    } catch (error) {
        console.error(getFileInfo(), getLineNumber(), 'Error indexing organization:', error);
    }
}

// add some kind of history of registrations
async function indexNewCreatorRegistration(creatorRegistrationParams) {
    let { transaction, creatorInfo, creatorHandle, block } = creatorRegistrationParams;
    
    
    // console.log(getFileInfo(), getLineNumber(), creatorInfo);
    // if (creatorInfo) {
        // creatorDid = creatorInfo.data.didAddress
        // const existingCreator = await elasticClient.search({
        //     index: 'creatorregistrations',
        //     body: {
        //     query: {
        //         match: {
        //         "data.didAddress": creatorDid
        //         }
        //     }
        //     }
        // });
        // console.log(getFileInfo(), getLineNumber(), existingCreator.hits.hits.length);

        // if (existingCreator.hits.hits.length > 0) {
        //     const creatorId = existingCreator.hits.hits[0]._id;
        //     try {
        //         await elasticClient.delete({
        //             index: 'creatorregistrations',
        //             id: creatorId
        //         });
        //         console.log(getFileInfo(), getLineNumber(), `Creator deleted successfully: ${creatorInfo.data.didAddress}`);
        //     } catch (error) {
        //         console.error(getFileInfo(), getLineNumber(), `Error deleting creatorInfo: ${creatorInfo.data.didAddress}`, error);
        //     }
        //  }
        //  console.log(getFileInfo(), getLineNumber());

        //     try {
        //         await elasticClient.index({
        //             index: 'creatorregistrations',
        //             body: creatorInfo,
        //             id: creatorInfo.data.didAddress,
        //         });
        //         console.log(getFileInfo(), getLineNumber(), `Creator indexed successfully: ${creatorInfo.data.didAddress}`);
        //     } catch (error) {
        //         console.error(getFileInfo(), getLineNumber(), `Error indexing creatorInfo: ${creatorInfo.data.didAddress}`, error);
        //     }
    // } else 
    // {
    const newCreators = [];
    let creator;
    console.log(getFileInfo(), getLineNumber());

    if (!transaction || !transaction.tags) {
        console.log(getFileInfo(), getLineNumber(), 'INDEXNEWCREATORREGISTRATION CANT FIND TRANSACTION DATA OR TAGS IN CHAIN, skipping');
        return
    }
    console.log(getFileInfo(), getLineNumber());

    let transactionData;
        // console.log(getFileInfo(), getLineNumber(),'transaction:', transaction, 'transaction.data:', transaction.data, 'type of transaction.data:', typeof transaction.data);
    if (typeof transaction.data === 'string') {
        try {
            // Attempt to parse the JSON string directly
            transactionData = JSON.parse(`[${transaction.data.replace(/}{/g, '},{')}]`);
        } catch (error) {
            console.error(getFileInfo(), getLineNumber(), `Invalid JSON data, skipping: ${transactionId}`);
            return
        }
    } else if (typeof transaction.data === 'object') {
        transactionData = transaction.data;
    } else {
        console.log(getFileInfo(), getLineNumber(), 'getNewCreatorRegistrations UNSUPPORTED DATA TYPE, skipping:', transactionId);
        return
    }
        console.log(getFileInfo(), getLineNumber());

    // Check if the parsed JSON contains a delete property
    if (transactionData.hasOwnProperty('deleteTemplate') || transactionData.hasOwnProperty('delete')) {
        console.log(getFileInfo(), getLineNumber(), 'getNewCreatorRegistrations DELETE MESSAGE FOUND, skipping', transactionId);
        return  // Return early if it's a delete message
    }
    // const creatorDid = txidToDid(transaction.creator);
    

    // if (!isVerified) {
        // console.error(getFileInfo(), getLineNumber(), `Signature verification failed for transaction ${transactionId}`);
        // return;
    // }
    if (transaction.transactionId === 'eqUwpy6et2egkGlkvS7c5GKi0aBsCXT6Dhlydf3GA3Y' || transaction.transactionId === '5lbSxo2TeD_fwZQwwCejjCUZAitJkNT63JBRdC7flgc' || transaction.transactionId === 'VPOc02NjJfJ-dYklnMTWWm3tEddEQPlmYRmJdDyzuP4') {
        // creator = creatorInfo;
        creatorHandle = (creatorHandle !== undefined) ? creatorHandle : await convertToCreatorHandle(transaction.transactionId, JSON.parse(transaction.data)[0]["2"]);
        block = (block !== undefined) ? block : (transaction.blockHeight || await getBlockHeightFromTxId(transaction.transactionId));
        console.log('1402 transaction:', transaction);
        creator = {
            data: {
                name: JSON.parse(transaction.data)[0]["3"],
                surname: JSON.parse(transaction.data)[1]["0"],
                language: (JSON.parse(transaction.data)[1]["3"] === 37) ? 'en' : '',
            },
            oip: {
                recordType: 'creatorRegistration',
                did: creatorInfo.data.didTx,
                didTx: creatorInfo.data.didTx, // Backward compatibility
                inArweaveBlock: block,
                indexedAt: new Date(),
                ver: transaction.ver,
                signature: transaction.creatorSig,
                creator: {
                    creatorHandle,
                    didAddress: creatorInfo.data.didAddress,
                    didTx: creatorInfo.data.didTx,
                    publicKey: creatorInfo.data.publicKey,
                }
            },
        }
    }
    else {
        console.log(getFileInfo(), getLineNumber());

        const templates = await getTemplatesInDB();
        console.log(getFileInfo(), getLineNumber());
        const expandedRecordPromises = await expandData(transaction.data, templates.templatesInDB);
        console.log(getFileInfo(), getLineNumber());
        const expandedRecord = await Promise.all(expandedRecordPromises);
        console.log(getFileInfo(), getLineNumber());
        const inArweaveBlock = transaction.blockHeight || await getBlockHeightFromTxId(transaction.transactionId);
        console.log(getFileInfo(), getLineNumber());

        if (expandedRecord !== null) {
            console.log(getFileInfo(), getLineNumber(), expandedRecord);
            const creatorRegistration = expandedRecord.find(item => item.creatorRegistration !== undefined);
            if (creatorRegistration) {
                console.log(getFileInfo(), getLineNumber());
                const basic = expandedRecord.find(item => item.basic !== undefined);
                const result = {};
                if (creatorRegistration.creatorRegistration.address) {
                    console.log(getFileInfo(), getLineNumber());
                    result.didAddress = 'did:arweave:' + creatorRegistration.creatorRegistration.address;
                }
                if (creatorRegistration.creatorRegistration.publicKey) {
                    console.log(getFileInfo(), getLineNumber());
                    result.creatorPublicKey = creatorRegistration.creatorRegistration.publicKey;
                }
                if (creatorRegistration.creatorRegistration.handle) {
                    console.log(getFileInfo(), getLineNumber());
                    result.creatorHandle = await convertToCreatorHandle(transaction.transactionId, creatorRegistration.creatorRegistration.handle);
                }
                if (transaction.transactionId) {
                    console.log(getFileInfo(), getLineNumber());
                    result.didTx = 'did:arweave:' + transaction.transactionId;
                }
                if (creatorRegistration.creatorRegistration.surname) {
                    console.log(getFileInfo(), getLineNumber());
                    result.surname = creatorRegistration.creatorRegistration.surname;
                }
                if (creatorRegistration.creatorRegistration.description) {
                    console.log(getFileInfo(), getLineNumber());
                    result.description = creatorRegistration.creatorRegistration.description;
                }
                if (creatorRegistration.creatorRegistration.youtube) {
                    console.log(getFileInfo(), getLineNumber());
                    result.youtube = creatorRegistration.creatorRegistration.youtube;
                }
                if (creatorRegistration.creatorRegistration.x) {
                    console.log(getFileInfo(), getLineNumber());
                    result.x = creatorRegistration.creatorRegistration.x;
                }
                if (creatorRegistration.creatorRegistration.instagram) {
                    console.log(getFileInfo(), getLineNumber());
                    result.instagram = creatorRegistration.creatorRegistration.instagram;
                }
                if (basic) {
                    console.log(getFileInfo(), getLineNumber());
                    if (basic.basic.name) {
                        console.log(getFileInfo(), getLineNumber());
                        result.name = basic.basic.name;
                    }
                    if (basic.basic.language) {
                        console.log(getFileInfo(), getLineNumber());
                        result.language = basic.basic.language;
                    }
                }
                console.log(getFileInfo(), getLineNumber());

                creator = {
                    data: {
                        creatorHandle: result.creatorHandle,
                        name: result.name,
                        surname: result.surname,
                        language: result.language,
                        description: result.description,
                        youtube: result.youtube,
                        x: result.x,
                        instagram: result.instagram,
                        raw:
                            {
                                "basic": basic.basic,
                                "creatorRegistration": creatorRegistration.creatorRegistration,
                            }
                        // ,
                        // didAddress: result.didAddress,
                        // signature: transaction.creatorSig,
                    },
                    oip: {
                        recordType: 'creatorRegistration',
                        did: result.didTx,
                        didTx: result.didTx, // Backward compatibility
                        inArweaveBlock: inArweaveBlock,
                        indexedAt: new Date(),
                        ver: transaction.ver,
                        signature: transaction.creatorSig,
                        creator: {
                            creatorHandle: result.creatorHandle,
                            didAddress: result.didAddress,
                            didTx: result.didTx,
                            publicKey: result.creatorPublicKey,
                        }
                    }
                };

            }}}
                // console.log(getFileInfo(), getLineNumber());
                
                // let isVerified = await verifySignature(dataForSignature, transaction.creatorSig, publicKey, transaction.creator);
                // console.log(getFileInfo(), getLineNumber(), {isVerified});
                
                publicKey = creator.oip.creator.publicKey;
                signature = creator.oip.signature;
                creatorAddress = creator.oip.creator.didAddress;
                // tags = transaction.tags.slice(0, -1);
                // dataForSignature = JSON.stringify(tags) + transaction.data;
                console.log(getFileInfo(), getLineNumber());
                
                let tags = transaction.tags.slice(0, -1);
                dataForSignature = JSON.stringify(tags) + transaction.data;
                isVerified = await verifySignature(dataForSignature, signature, publicKey, creatorAddress);
                console.log(getFileInfo(), getLineNumber(), {isVerified});
        
                if (!isVerified) {
                    console.error(getFileInfo(), getLineNumber(), `Signature verification failed for transaction ${transactionId}`);
                    return;
                }

                newCreators.push(creator);


            // }
        // }


        // creatorInfo = creatorRegistrationParams.creatorInfo
        // console.log(getFileInfo(), getLineNumber());

        // // creatorInfo = await searchCreatorByAddress(creatorDid) || creatorRegistrationParams.creatorInfo;
        // if (!creatorInfo) {
        //     console.log(getFileInfo(), getLineNumber(), `Creator not found for transaction ${transaction.transactionId}, skipping.`);
        //     return;
        // }
        // let publicKey = creatorInfo.data.publicKey;
       
    // }
// }
    console.log(getFileInfo(), getLineNumber());

    
    newCreators.forEach(async (creator) => {
        const existingCreator = await elasticClient.exists({
            index: 'creatorregistrations',
            id: creator.oip.did || creator.oip.didTx
        });
        console.log(getFileInfo(), getLineNumber(), { existingCreator });

        if (!existingCreator.body) {
            try {
                await elasticClient.index({
                    index: 'creatorregistrations',
                    id: creator.oip.did || creator.oip.didTx,
                    body: creator,
                });
                console.log(getFileInfo(), getLineNumber(), `Creator indexed successfully: ${creator.oip.didTx}`);
            } catch (error) {
                console.error(getFileInfo(), getLineNumber(), `Error indexing creator: ${creator.oip.didTx}`, error);
            }
            console.log(getFileInfo(), getLineNumber());

        } else {
            console.log(getFileInfo(), getLineNumber(), `Creator already exists: ${result.oip.didTx}`);
            // const creatorId = existingCreator.hits.hits[0]._id;
            try {
                await elasticClient.delete({
                    index: 'creatorregistrations',
                    id: creator.oip.did || creator.oip.didTx
                });
                console.log(getFileInfo(), getLineNumber());

                console.log(getFileInfo(), getLineNumber(), `Creator deleted successfully: ${creatorInfo.data.didAddress}`);
            } catch (error) {
                console.error(getFileInfo(), getLineNumber(), `Error deleting creatorInfo: ${creatorInfo.data.didAddress}`, error);
            }
        }
        console.log(getFileInfo(), getLineNumber());

        try {
            await elasticClient.index({
                index: 'creatorregistrations',
                body: creator,
                id: creator.oip.did || creator.oip.didTx,
            });
            console.log(getFileInfo(), getLineNumber(), `Creator indexed successfully: ${creator.oip.didTx}`);
        } catch (error) {
            console.error(getFileInfo(), getLineNumber(), `Error indexing creatorInfo: ${creator.oip.didTx}`, error);
        }
    });
    
    // }
// }
}

// maybe implement this
const reIndexUnconfirmedRecords = async () => {
    const unconfirmedRecords = await searchByField('records', 'oip.recordStatus', 'unconfirmed');
    for (const record of unconfirmedRecords) {
        const confirmedData = await getTransaction(record.oip.didTx.replace('did:arweave:', ''));
        if (confirmedData) {
            record.oip.recordStatus = "confirmed";
            await indexRecord(record);
            console.log(`Record ${record.oip.didTx} status updated to confirmed.`);
        }
    }
};

async function keepDBUpToDate(remapTemplates) {
    console.log('🔄 [keepDBUpToDate] CYCLE STARTED');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    try {
        await ensureIndexExists();
        let { qtyCreatorsInDB, maxArweaveCreatorRegBlockInDB, creatorsInDB } = await getCreatorsInDB();
        let { qtyOrganizationsInDB, maxArweaveOrgBlockInDB, organizationsInDB } = await getOrganizationsInDB();
        
        // MEMORY LEAK FIX: Only store counts and block heights, not full record data
        foundInDB = {
            qtyRecordsInDB: qtyCreatorsInDB,
            maxArweaveBlockInDB: maxArweaveCreatorRegBlockInDB
        };
        
        if (qtyCreatorsInDB === 0) {
            const hardCodedTxId = 'eqUwpy6et2egkGlkvS7c5GKi0aBsCXT6Dhlydf3GA3Y';
            const block = 1463761
            console.log(getFileInfo(), getLineNumber(), 'Exception - No creators found in DB, looking up creator registration data in hard-coded txid', hardCodedTxId);
            try {
                const transaction = await getTransaction(hardCodedTxId);
                // let creatorRegistrationParams = {
                //     transaction,
                //     block,
                //     creatorInfo: null
                // }
                let creatorHandle = await convertToCreatorHandle(transaction.transactionId, JSON.parse(transaction.data)[0]["2"]);
                const data = {
                    publicKey: JSON.parse(transaction.data)[0]["1"],
                    creatorHandle: creatorHandle,
                    didAddress: 'did:arweave:' + JSON.parse(transaction.data)[0]["0"],
                    didTx: 'did:arweave:' + transaction.transactionId,
                }
                // console.log(getFileInfo(), getLineNumber(), 'Creator data:', data);
                creatorInfo = {
                    data,
                } 
                console.log(getFileInfo(), getLineNumber(), 'Creator info:', creatorInfo);
                const creatorRegistrationParams = {
                    transaction,
                    creatorInfo,
                    creatorHandle,
                    block
                }
                await indexNewCreatorRegistration(creatorRegistrationParams)

                // await indexNewCreatorRegistration(creatorRegistrationParams)
                maxArweaveCreatorRegBlockInDB = block
                qtyCreatorsInDB = 1;
            } catch (error) {
                console.error(getFileInfo(), getLineNumber(), `Error indexing creator: ${hardCodedTxId}`, error);
            }
        };
        // to do standardize these names a bit better
        let { finalMaxArweaveBlock, qtyTemplatesInDB, templatesInDB } = await getTemplatesInDB();
        // console.log(getFileInfo(), getLineNumber(), 'Templates:', { finalMaxArweaveBlock, qtyTemplatesInDB });
        // MEMORY LEAK FIX: Only refresh cache every 10 cycles to prevent constant memory allocation
        keepDBCycleCount++;
        const shouldRefresh = keepDBCycleCount % 10 === 0; // Refresh every 10 cycles (50 minutes)
        if (shouldRefresh) {
            console.log(`🔄 [keepDBUpToDate] Refreshing records cache (cycle ${keepDBCycleCount}/10)`);
        }
        let { finalMaxRecordArweaveBlock, qtyRecordsInDB, records } = await getRecordsInDB(shouldRefresh);
        // console.log(getFileInfo(), getLineNumber(), 'Records:', { finalMaxRecordArweaveBlock, qtyRecordsInDB });
        foundInDB.maxArweaveBlockInDB = Math.max(
            maxArweaveCreatorRegBlockInDB || 0,
            maxArweaveOrgBlockInDB || 0,  // Include organizations in max block calculation
            finalMaxArweaveBlock || 0,
            finalMaxRecordArweaveBlock || 0
        );
        foundInDB.arweaveBlockHeights = {
            creators: maxArweaveCreatorRegBlockInDB,
            organizations: maxArweaveOrgBlockInDB,  // Include organizations
            templates: finalMaxArweaveBlock,
            records: finalMaxRecordArweaveBlock
        };
        foundInDB.qtyRecordsInDB = Math.max(
            qtyCreatorsInDB || 0,
            qtyOrganizationsInDB || 0,  // Include organizations
            qtyTemplatesInDB || 0,
            qtyRecordsInDB || 0
        );
        foundInDB.qtys = {
            creators: qtyCreatorsInDB,
            organizations: qtyOrganizationsInDB,  // Include organizations
            templates: qtyTemplatesInDB,
            records: qtyRecordsInDB
        };
        
        // MEMORY LEAK FIX: Don't store full record data - only store what's needed
        // This prevents accumulation of large objects in memory
        foundInDB.recordsInDB = {
            creators: creatorsInDB ? creatorsInDB.length : 0,
            organizations: organizationsInDB ? organizationsInDB.length : 0,
            templates: templatesInDB ? templatesInDB.length : 0,
            records: records ? records.length : 0
        };
        
        // MEMORY LEAK FIX: Explicitly null out large arrays to help GC
        creatorsInDB = null;
        organizationsInDB = null;
        templatesInDB = null;
        records = null;
        
        // console.log(getFileInfo(), getLineNumber(), 'Found in DB:', foundInDB);

        // searchArweaveForNewTransactions now processes transactions immediately instead of buffering
        const processedCount = await searchArweaveForNewTransactions(foundInDB, remapTemplates);
        if (processedCount === 0) {
            console.log(`⏳ [keepDBUpToDate] No new OIP transactions found (checking from block ${foundInDB.maxArweaveBlockInDB + 1})`);
        }
    } catch (error) {
        console.error('\n❌ [keepDBUpToDate] CRITICAL ERROR:', error.message);
        console.error('❌ [keepDBUpToDate] Stack trace:', error.stack);
        console.error(getFileInfo(), getLineNumber(), 'Error details:', {
            status: error.response?.status,
            headers: error.response?.headers,
            query: error.request?.query,
            message: error.message
        });
        // return [];
    } finally {
        setIsProcessing(false);
        
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🏁 [keepDBUpToDate] CYCLE ENDED');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        
        // MEMORY LEAK FIX: Trigger GC if available (optional - gc() is not available by default)
        if (global.gc) {
            global.gc();
        }
    }
}

async function searchArweaveForNewTransactions(foundInDB, remapTemplates) {
    // console.log('foundinDB:', foundInDB);
    await ensureIndexExists();
    const { qtyRecordsInDB, maxArweaveBlockInDB } = foundInDB;
    // const min = (qtyRecordsInDB === 0) ? 1463750 : (maxArweaveBlockInDB + 1);
    // const min = (qtyRecordsInDB === 0) ? 1579580 : (maxArweaveBlockInDB + 1); // before todays templates
    const min = Math.max(startBlockHeight, (maxArweaveBlockInDB + 1));

    console.log(`🔍 [searchArweaveForNewTransactions] Searching Arweave for OIP records from block ${min}`);

    // const min = (qtyRecordsInDB === 0) ? 1579817 : (maxArweaveBlockInDB + 1); // 12/31/2024 10pm
    
    // MEMORY LEAK FIX: Process transactions immediately instead of buffering
    const MAX_TRANSACTIONS_PER_CYCLE = parseInt(process.env.MAX_TRANSACTIONS_PER_CYCLE) || 1000;
    let transactionCount = 0;
    let processedCount = 0;
    let hasNextPage = true;
    let afterCursor = null;  // Cursor for pagination
    let rateLimited = false;  // Track if we hit rate limit
    const endpoint = 'https://arweave.net/graphql';
    
    // Store transactions in reverse order as we process them (newest last, oldest first in processing)
    let transactionsToProcess = [];

    while (hasNextPage && transactionCount < MAX_TRANSACTIONS_PER_CYCLE && !rateLimited) {
        console.log(`  📄 Pagination: ${transactionCount} records fetched so far (searching from block ${min})`);
        const query = gql`
            query {
                transactions(
                    block: {min: ${min}},
                    tags: [
                        { name: "Index-Method", values: ["OIP"] },
                        { name: "Ver", values: ["0.8.0"] }
                    ],
                    first: 100,
                    after: ${afterCursor ? `"${afterCursor}"` : null}
                ) {
                    edges {
                        node {
                            id
                        }
                        cursor
                    }
                    pageInfo {
                        hasNextPage
                    }
                }
            }
        `;

        let response;
        let retryCount = 0;
        const maxRetries = 3; // Retry up to 3 times

        while (retryCount < maxRetries) {
            try {
                // MEMORY LEAK FIX: Use managed GraphQL client with connection pooling
                checkAndRecreateGraphQLClient();
                response = await graphQLClient.request(query);
                break; // Break the retry loop if the request is successful
            } catch (error) {
                retryCount++;
                
                // RATE LIMIT FIX: Stop retrying immediately on 429 errors
                if (error.status === 429 || error.message?.includes('429')) {
                    console.warn(`⚠️  [Arweave] Rate limited (429). Setting 30-minute backoff.`);
                    global.rateLimitBackoffUntil = Date.now() + (30 * 60 * 1000);
                    console.warn(`    Will resume at: ${new Date(global.rateLimitBackoffUntil).toLocaleTimeString()}`);;
                    rateLimited = true;  // Signal to break out of pagination loop
                    response = null;
                    break; // Exit retry loop immediately
                }
                
                console.error(
                    `Attempt ${retryCount} failed for fetching transactions:`, 
                    error.message
                );

                if (retryCount === maxRetries) {
                    console.error('Max retries reached. Moving to the next page.');
                } else {
                    console.log(`Retrying... (${retryCount}/${maxRetries})`);
                }
            }
        }

        // If response is still undefined after retries, move to the next page
        if (!response) {
            afterCursor = null; // Move to the next page (skip the current one)
            continue;
        }

        const transactions = response.transactions.edges.map(edge => edge.node);
        
        // Store for processing in reverse order (newest first)
        transactionsToProcess = transactions.concat(transactionsToProcess);
        transactionCount += transactions.length;

        // Pagination logic
        hasNextPage = response.transactions.pageInfo.hasNextPage;
        afterCursor = response.transactions.edges.length > 0
            ? response.transactions.edges[response.transactions.edges.length - 1].cursor
            : null;

        // MEMORY LEAK FIX: Check if we've reached the limit
        if (transactionCount >= MAX_TRANSACTIONS_PER_CYCLE) {
            console.log(`[searchArweaveForNewTransactions] Reached transaction limit (${MAX_TRANSACTIONS_PER_CYCLE}), will fetch more in next cycle`);
            hasNextPage = false;
        }

        // Trigger GC occasionally to prevent external memory buildup
        if (transactionCount % 500 === 0 && global.gc) {
            global.gc();
        }

        // console.log('Fetched', transactions.length, 'transactions, total so far:', transactionCount, getFileInfo(), getLineNumber());
    }

    // MEMORY LEAK FIX: Process transactions immediately as we find them
    // This prevents buffering entire transaction objects in memory
    console.log(`🔎 [searchArweaveForNewTransactions] GraphQL query completed. Found ${transactionCount} transactions with OIP tags (Index-Method:OIP, Ver:0.8.0) from block ${min} onwards`);
    console.log(`🔍 [keepDBUpToDate] Processing ${transactionsToProcess.length} transactions...`);
    
    for (let i = 0; i < transactionsToProcess.length; i++) {
        const tx = transactionsToProcess[i];
        console.log(`📦 [Transaction ${i+1}/${transactionsToProcess.length}] Processing: ${tx.id}`);
        await processTransaction(tx, remapTemplates);
        processedCount++;
    }
    
    console.log(`✅ [searchArweaveForNewTransactions] Completed processing ${processedCount} transactions`);
    
    // Clear array to free memory
    transactionsToProcess.length = 0;
    transactionsToProcess = null;
    
    return processedCount;
}

async function processTransaction(tx, remapTemplates) {
    try {
    // console.log(`   📡 Fetching transaction data from blockchain: ${tx.id}`);
    const transaction = await getTransaction(tx.id);
    if (!transaction || !transaction.tags) {
        console.log(`   ⚠️  SKIPPED: Cannot find transaction or tags in chain: ${tx.id}`);
        return;
    }
    const tags = transaction.tags.reduce((acc, tag) => {
        acc[tag.name] = tag.value;
        return acc;
    }, {});

    // console.log(`   🏷️  Transaction tags:`, {
    //     'Type': tags['Type'],
    //     'RecordType': tags['RecordType'],
    //     'Index-Method': tags['Index-Method'],
    //     'Ver': tags['Ver']
    // });

    // { name: "Ver", values: ["0.8.0"] }
    if (tags['Type'] === 'Record' && tags['Index-Method'] === 'OIP' && semver.gte(tags['Ver'], '0.8.0')) {
            console.log(`   ✅ IDENTIFIED AS: OIP Record (${tags['RecordType'] || 'unknown type'})`);
            await processNewRecord(transaction, remapTemplates);
    } else if (tags['Type'] === 'Template' && tags['Index-Method'] === 'OIP' && semver.gte(tags['Ver'], '0.8.0')) {
        console.log(`   ✅ IDENTIFIED AS: OIP Template`);
        await processNewTemplate(transaction);
    } else {
        console.log(`   ⏭️  SKIPPED: Not an OIP Record or Template with Ver >= 0.8.0`);
    }
} catch (error) {
    console.error(`   ❌ ERROR processing transaction ${tx.id}:`, error.message);
}
}

async function processNewTemplate(transaction) {
    if (!transaction || !transaction.tags || !transaction.data) {
        console.log(getFileInfo(), getLineNumber(),'cannot find transaction (or tags or fields), skipping txid:', transaction.transactionId);
        return null;
    }
    
    const templateName = transaction.tags.find(tag => tag.name === 'TemplateName')?.value;
    let parsedData;
    try {
        parsedData = JSON.parse(transaction.data);
    } catch (error) {
        console.error(getFileInfo(), getLineNumber(),`Error parsing JSON from transaction data: ${error.message}`);
        console.error(getFileInfo(), getLineNumber(),`Invalid JSON data: ${transaction.data}`);
        return null;
    }
    
    const fieldsString = JSON.stringify(parsedData);
    const isValid = validateTemplateFields(fieldsString);
    if (!isValid) {
        console.log(getFileInfo(), getLineNumber(),`Template failed - Field formatting validation failed for transaction ${transaction.transactionId}`);
        return null;
    }
    
    // For templates: DATA + TAGS (different from creators/records which use TAGS + DATA)
    const tags = transaction.tags.slice(0, -1); // Remove signature tag
    const dataForSignature = fieldsString + JSON.stringify(tags);
    const message = dataForSignature;
    
    const didAddress = 'did:arweave:' + transaction.creator;
    // console.log(getFileInfo(), getLineNumber(), 'Template creator DID:', didAddress);
    
    const creatorInfo = await searchCreatorByAddress(didAddress);
    if (!creatorInfo) {
        console.error(`Creator data not found for DID address: ${didAddress}`);
        return null;
    }
    // console.log(getFileInfo(), getLineNumber(), 'Creator info found:', creatorInfo.data.creatorHandle);

    const publicKey = creatorInfo.data.publicKey;
    console.log(getFileInfo(), getLineNumber(), 'Public key:', publicKey ? 'found' : 'missing');

    // Fix CreatorSig format - convert spaces back to + characters for proper base64
    const templateCreatorSigRaw = transaction.creatorSig;
    const templateSignatureBase64 = templateCreatorSigRaw ? templateCreatorSigRaw.replace(/ /g, '+') : undefined;
    
    if (templateCreatorSigRaw && templateCreatorSigRaw !== templateSignatureBase64) {
        // console.log(getFileInfo(), getLineNumber(), `Fixed CreatorSig format: converted ${(templateCreatorSigRaw.match(/ /g) || []).length} spaces to + characters`);
    }
    
    // console.log(getFileInfo(), getLineNumber(), 'Signature:', templateSignatureBase64 ? 'found' : 'missing');
    
    if (!templateSignatureBase64) {
        console.error(getFileInfo(), getLineNumber(), `No signature found for template ${transaction.transactionId}`);
        return null;
    }
    
    const templateIsVerified = await verifySignature(message, templateSignatureBase64, publicKey, didAddress);
    // console.log(getFileInfo(), getLineNumber(), 'Signature verification result:', templateIsVerified);
    
    if (!templateIsVerified) {
        console.error(getFileInfo(), getLineNumber(),`Signature verification failed for template ${transaction.transactionId}`);
        return null;
    } else {
        // console.log(getFileInfo(), getLineNumber(), `✅ Template signature verified successfully for ${transaction.transactionId}`);
        
        // Use the same block height approach as successful creator verification
        const inArweaveBlock = transaction.blockHeight || await getBlockHeightFromTxId(transaction.transactionId);
        
        // Parse fields to check for enum values  
        const fieldsObject = JSON.parse(fieldsString);
        
        const oip = {
            did: 'did:arweave:' + transaction.transactionId,
            didTx: 'did:arweave:' + transaction.transactionId, // Backward compatibility
            inArweaveBlock: inArweaveBlock,
            indexedAt: new Date().toISOString(),
            recordStatus: "original",
            ver: transaction.ver,
            creator: {
                creatorHandle: creatorInfo.data.creatorHandle,
                didAddress: creatorInfo.data.didAddress,
                didTx: creatorInfo.data.didTx,
                publicKey: creatorInfo.data.publicKey
            }
        }

        try {
            const existingTemplate = await elasticClient.exists({
                index: 'templates',
                id: oip.did
            });
            
            // Create both formats - simple fields string AND complex fieldsInTemplate
            const fieldsInTemplate = {};
            let fieldCount = 0;
            
            for (const [fieldName, fieldValue] of Object.entries(fieldsObject)) {
                if (fieldName.startsWith('index_') || fieldName.endsWith('Values')) {
                    continue;
                }
                
                const fieldType = typeof fieldValue === 'object' ? fieldValue.type : fieldValue;
                const fieldIndex = typeof fieldValue === 'object' ? fieldValue.index : fieldCount;
                
                fieldsInTemplate[fieldName] = {
                    type: fieldType,
                    index: fieldIndex
                };
                fieldCount++;
            }
            
            const finalTemplate = {
                data: {
                    TxId: transaction.transactionId,
                    creator: transaction.creator,
                    creatorSig: templateSignatureBase64,
                    template: templateName,
                    fields: fieldsString,  // Store original JSON string for translateJSONtoOIPData
                    fieldsInTemplate: fieldsInTemplate,  // Store processed object structure  
                    fieldsInTemplateCount: fieldCount
                },
                oip
            };
            
            // Add enum values if they exist
            for (const [fieldName, fieldValue] of Object.entries(fieldsObject)) {
                if (fieldValue === 'enum' && fieldsObject[`${fieldName}Values`]) {
                    finalTemplate.data[`${fieldName}Values`] = fieldsObject[`${fieldName}Values`];
                    // console.log(getFileInfo(), getLineNumber(), `📋 Added enum values for ${fieldName}:`, fieldsObject[`${fieldName}Values`].length, 'values');
                }
            }
            
            if (existingTemplate.body) {
                // Update existing pending template with confirmed data
                const response = await elasticClient.update({
                    index: 'templates',
                    id: oip.didTx,
                    body: {
                        doc: {
                            ...finalTemplate,
                            "oip.recordStatus": "original"
                        }
                    },
                    refresh: 'wait_for'
                });
                console.log(getFileInfo(), getLineNumber(), `✅ Template updated successfully: ${oip.did}`, response.result);
            } else {
                // Create new template
                const indexResult = await elasticClient.index({
                    index: 'templates',
                    id: oip.did,
                    body: finalTemplate,
                    refresh: 'wait_for'  // Ensure immediate availability
                });
                console.log(`✅ Template indexed successfully: ${finalTemplate.data.TxId}`, indexResult.result);
                
                // Log what we attempted to store for debugging
                // console.log(getFileInfo(), getLineNumber(), `📋 Stored template with fields:`, {
                //     TxId: finalTemplate.data.TxId,
                //     hasFields: !!finalTemplate.data.fields,
                //     fieldsLength: finalTemplate.data.fields ? finalTemplate.data.fields.length : 0,
                //     hasFieldsInTemplate: !!finalTemplate.data.fieldsInTemplate,
                //     fieldsInTemplateKeys: Object.keys(finalTemplate.data.fieldsInTemplate || {}),
                    // fieldsInTemplateCount: finalTemplate.data.fieldsInTemplateCount
                // });
                
                // Auto-generate Elasticsearch mapping from template field types
                try {
                    const { updateMappingForNewTemplate } = require('./generateElasticsearchMappings');
                    await updateMappingForNewTemplate(templateName, fieldsInTemplate);
                } catch (mappingError) {
                    console.warn(`⚠️  Could not auto-generate Elasticsearch mapping for ${templateName}:`, mappingError.message);
                    // Don't fail template indexing if mapping update fails
                }
            }
        } catch (error) {
            console.error(`Error indexing template: ${transaction.transactionId}`, error);
        }
        
        // Return simple structure for consistency
        return {
            data: {
                TxId: transaction.transactionId,
                template: templateName,
                fields: fieldsString
            },
            oip
        };
    }
}

async function processNewRecord(transaction, remapTemplates = []) {
    console.log(`\n   📝 [processNewRecord] Starting to process record: ${transaction.transactionId}`);
    const newRecords = [];
    const recordsToDelete = [];
    if (!transaction || !transaction.tags) {
        console.log(`   ⚠️  [processNewRecord] Cannot find transaction or tags, skipping: ${transaction.transactionId}`);
        return { records: newRecords, recordsToDelete };
    }

    const transactionId = transaction.transactionId;
    const tags = transaction.tags.slice(0, -1);
    const recordType = tags.find(tag => tag.name === 'RecordType')?.value;
    // console.log(`   📋 [processNewRecord] Record type: ${recordType}`);
    // handle creator registration
    let creatorInfo;
    if (recordType && recordType === 'creatorRegistration') {
        // does not apply
        console.log(getFileInfo(), getLineNumber(), 'Processing creator registration:', transactionId, transaction);
        
        const creatorHandle = await convertToCreatorHandle(transactionId, JSON.parse(transaction.data)[0]["2"]);
        const data = {
            publicKey: JSON.parse(transaction.data)[0]["1"],
            creatorHandle: creatorHandle,
            didAddress: 'did:arweave:' + JSON.parse(transaction.data)[0]["0"],
            didTx: 'did:arweave:' + transactionId,
        }
        // console.log(getFileInfo(), getLineNumber(), 'Creator data:', data);
        creatorInfo = {
            data,
        } 
        // console.log(getFileInfo(), getLineNumber(), 'Creator info:', creatorInfo);
        const creatorRegistrationParams = {
            transaction,
            creatorInfo
        }
        await indexNewCreatorRegistration(creatorRegistrationParams)
    }
    
    // handle organization registration (use if, not else if, so it continues to normal record processing)
    if (recordType && recordType === 'organization') {
        console.log(getFileInfo(), getLineNumber(), 'Processing organization registration:', transactionId, transaction);
        
        const parsedData = JSON.parse(transaction.data);
        const basicData = parsedData.find(obj => obj.t === "-9DirnjVO1FlbEW1lN8jITBESrTsQKEM_BoZ1ey_0mk");
        const orgData = parsedData.find(obj => obj.t === "NQi19GjOw-Iv8PzjZ5P-XcFkAYu50cl5V_qceT2xlGM");
        
        const orgHandle = await convertToOrgHandle(transactionId, orgData["0"]);
        const organizationInfo = {
            data: {
                orgHandle: orgHandle,
                name: basicData["0"],
                description: basicData["1"],
                date: basicData["2"],
                language: basicData["3"],
                nsfw: basicData["6"],
                webUrl: basicData["12"],
                orgPublicKey: orgData["1"],
                adminPublicKeys: orgData["2"],
                membershipPolicy: orgData["3"],
                metadata: orgData["4"] || null,
                didAddress: 'did:arweave:' + transaction.owner,
                didTx: 'did:arweave:' + transactionId,
            }
        } 
        console.log(getFileInfo(), getLineNumber(), 'Organization info:', organizationInfo);
        const organizationRegistrationParams = {
            transaction,
            organizationInfo,
            organizationHandle: orgHandle
        }
        await indexNewOrganizationRegistration(organizationRegistrationParams)
    }
    
    // Continue with normal record processing (for both creators, organizations, and other records)
    if (recordType && (recordType === 'creatorRegistration' || recordType === 'organization')) {
        // Skip normal record processing for these special types since they're handled above
        console.log(`   ✅ [processNewRecord] Special record type processed: ${recordType}`);
        return { records: newRecords, recordsToDelete };
    } else {
        // console.log(`   🔨 [processNewRecord] Processing as standard record...`);
    // handle records
    dataForSignature = JSON.stringify(tags) + transaction.data;
    let creatorDid = txidToDid(transaction.creator);
    // console.log(getFileInfo(), getLineNumber());
    
    creatorInfo = (!creatorInfo) ? await searchCreatorByAddress(creatorDid) : creatorInfo;
    // console.log(getFileInfo(), getLineNumber(), 'Creator info:', creatorInfo);
    
    // If creator is not found, skip this record for now
    if (!creatorInfo) {
        console.log(`   ⚠️  [processNewRecord] SKIPPING record ${transaction.transactionId} - creator ${creatorDid} not found in database yet`);
        return { records: newRecords, recordsToDelete };
    }
    // console.log(`   👤 [processNewRecord] Creator found: ${creatorInfo.data.creatorHandle || creatorInfo.data.didAddress}`);
    let transactionData;
    let isDeleteMessageFound = false;

    if (typeof transaction.data === 'string') {
        try {
            transactionData = JSON.parse(transaction.data);
            // Check if transactionData is an array and look at the first element
            const dataToCheck = Array.isArray(transactionData) ? transactionData[0] : transactionData;
            if (dataToCheck && (dataToCheck.hasOwnProperty('deleteTemplate') || dataToCheck.hasOwnProperty('delete'))) {
                const msgType = dataToCheck.deleteTemplate ? 'DELETE TEMPLATE' : 'DELETE RECORD';
                console.log(getFileInfo(), getLineNumber(), msgType + ' MESSAGE FOUND, processing', transaction.transactionId);
                isDeleteMessageFound = true;
                transactionData = dataToCheck;  // Use the first element for the rest of the function
                console.log(getFileInfo(), getLineNumber(), 'DEBUG: After extraction, transactionData type:', typeof transactionData, 'isArray:', Array.isArray(transactionData), 'content:', transactionData);
            }
        } catch (error) {
            // Check if this is a malformed delete message - look for ]{ which indicates array/object concatenation
            if (transaction.data && typeof transaction.data === 'string' && /\]\{/.test(transaction.data)) {
                console.warn(getFileInfo(), getLineNumber(), `Malformed delete message, skipping ${transaction.transactionId}`, transaction.data);
            } else {
                console.error(getFileInfo(), getLineNumber(), `Invalid JSON data, skipping: ${transaction.transactionId}`, transaction.data, typeof transaction.data, error);
            }
            return { records: newRecords, recordsToDelete };
        }
    } else if (typeof transaction.data === 'object') {
        transactionData = transaction.data;
    } else {
        console.log(getFileInfo(), getLineNumber(), 'UNSUPPORTED DATA TYPE, skipping:', transaction.transactionId, typeof transaction.data);
        return { records: newRecords, recordsToDelete };
    }
    // console.log(getFileInfo(), getLineNumber());
    let record;
    let currentBlockHeight = await getCurrentBlockHeight();
    // Use block height from GraphQL data instead of making additional API calls
    let inArweaveBlock = transaction.blockHeight || await getBlockHeightFromTxId(transaction.transactionId);
    let progress = Math.round((inArweaveBlock - startBlockHeight) / (currentBlockHeight - startBlockHeight) * 100);
    console.log(getFileInfo(), getLineNumber(), `Indexing Progress: ${progress}% (Block: ${inArweaveBlock})`);
    // let dataArray = [];
    // dataArray.push(transactionData);
    // handle delete message
    if (isDeleteMessageFound) {
        // console.log(getFileInfo(), getLineNumber(), 'Delete template message found, processing:', {transaction}, {creatorInfo},{transactionData}, {record});
        
        // Safety check: Skip old-format template deletions
        if (transactionData.hasOwnProperty('delete') && !transactionData.hasOwnProperty('deleteTemplate')) {
            const targetDid = transactionData.delete.didTx || transactionData.delete.did;
            console.log(getFileInfo(), getLineNumber(), 'Checking if delete target is a template:', targetDid);
            
            // Check if the target is a template by searching the templates index
            try {
                const templateSearch = await elasticClient.search({
                    index: 'templates',
                    body: {
                        query: createDIDQuery(targetDid)
                    }
                });
                
                if (templateSearch.hits.hits.length > 0) {
                    // Double-check that it's actually a template record type
                    const foundTemplate = templateSearch.hits.hits[0]._source;
                    if (foundTemplate.oip && foundTemplate.oip.recordType === 'template') {
                        console.log(getFileInfo(), getLineNumber(), 'SAFETY: Skipping old-format template deletion:', targetDid);
                        return { records: newRecords, recordsToDelete };
                    } else {
                        console.log(getFileInfo(), getLineNumber(), 'Found in templates index but not a template record type, proceeding:', targetDid, 'recordType:', foundTemplate.oip?.recordType);
                    }
                } else {
                    console.log(getFileInfo(), getLineNumber(), 'Target is not a template, proceeding with record deletion:', targetDid);
                }
            } catch (error) {
                console.warn(getFileInfo(), getLineNumber(), 'Error checking if target is template:', error.message);
            }
        }
        
        // Determine if this is a delete record or deleteTemplate
        const isDeleteTemplate = transactionData.hasOwnProperty('deleteTemplate');
        const recordTypeStr = isDeleteTemplate ? 'deleteTemplate' : 'delete';
        
        console.log(getFileInfo(), getLineNumber(), 'DEBUG: Before indexing, transactionData type:', typeof transactionData, 'isArray:', Array.isArray(transactionData));
        record = {
            data: {...transactionData},
            oip: {
                recordType: recordTypeStr,
                did: 'did:arweave:' + transaction.transactionId,
                didTx: 'did:arweave:' + transaction.transactionId, // Backward compatibility
                inArweaveBlock: inArweaveBlock,
                indexedAt: new Date().toISOString(),
                ver: transaction.ver,
                signature: transaction.creatorSig,
                creator: {
                    ...creatorInfo.data
                    // creatorHandle: creatorInfo.data.creatorHandle,
                    // didAddress: creatorInfo.data.didAddress,
                    // didTx: creatorInfo.oip.didTx,
                    // publicKey: creatorInfo.data.publicKey
                }
            }
        };
        // console.log(getFileInfo(), getLineNumber(), 'record:', record);

        if (!record.data || !record.oip) {
            console.log(getFileInfo(), getLineNumber(), `${record.oip.didTx} is missing required data, cannot be indexed.`);
        } else {
            const existingRecord = await elasticClient.exists({
                index: 'records',
                id: record.oip.didTx
            });
            if (!existingRecord.body) {
                await indexRecord(record);
            }
        }
        // console.log(getFileInfo(), getLineNumber(), creatorDid, transaction);
        if (isDeleteMessageFound) {
            // Pass the extracted transactionData to deleteRecordFromDB
            await deleteRecordFromDB(creatorDid, { ...transaction, data: transactionData });
        }
        console.log(getFileInfo(), getLineNumber(), 'Delete message indexed:', transaction.transactionId, 'and target deleted', record.data.deleteTemplate?.didTx || record.data.deleteTemplate?.did || record.data.delete?.didTx || record.data.delete?.did);

    } else {
        // handle new records
        // console.log(getFileInfo(), getLineNumber());
        // Apply record type indexing policy early (deleteMessage bypassed above)
        if (recordType && !shouldIndexRecordType(recordType)) {
            // console.log(getFileInfo(), getLineNumber(), `Skipping processing for recordType '${recordType}' per configuration.`);
            return { records: newRecords, recordsToDelete };
        }
        // Filter for minimum OIP version (0.8.0 or above)
        const version = transaction.ver;
        const versionParts = version.split('.').map(Number);
        const minimumVersionParts = [0, 8, 0];

        const isVersionValid = versionParts.length >= 3 && versionParts.every((part, index) => part >= (minimumVersionParts[index] || 0));
        if (!isVersionValid) {
            // console.log(getFileInfo(), getLineNumber(), `Skipping transaction ${transactionId} due to OIP version (${version}) below minimum required (0.8.0).`);
            return { records: newRecords, recordsToDelete };
        }
        // console.log(getFileInfo(), getLineNumber());

        const templates = await getTemplatesInDB();
        // console.log(getFileInfo(), getLineNumber(), transaction.data);
        const expandedRecordPromises = await expandData(transaction.data, templates.templatesInDB);
        // console.log(getFileInfo(), getLineNumber(), expandedRecordPromises);
        const expandedRecord = await Promise.all(expandedRecordPromises);
        // console.log(getFileInfo(), getLineNumber(), expandedRecord, creatorInfo, transaction, inArweaveBlock );
        const combinedRecords = {};
        
        // Build templates array mapping template names to their transaction IDs
        const templatesUsed = {};
        const rawRecords = JSON.parse(transaction.data);
        rawRecords.forEach(rawRecord => {
            const templateTxId = rawRecord.t;
            const template = findTemplateByTxId(templateTxId, templates.templatesInDB);
            if (template && template.data && template.data.template) {
                templatesUsed[template.data.template] = templateTxId;
            }
        });
        
        expandedRecord.forEach(record => {
            Object.keys(record).forEach(key => {
            combinedRecords[key] = record[key];
            });
        });
        if (expandedRecord !== null && expandedRecord.length > 0) {
            // console.log(getFileInfo(), getLineNumber(), creatorInfo)
            record = {
                data: combinedRecords,
                oip: {
                    recordType: recordType,
                    recordStatus: "original",
                    did: 'did:arweave:' + transaction.transactionId,
                    didTx: 'did:arweave:' + transaction.transactionId, // Backward compatibility
                    inArweaveBlock: inArweaveBlock,
                    indexedAt: new Date().toISOString(),
                    ver: transaction.ver,
                    signature: transaction.creatorSig,
                    templates: templatesUsed,
                    creator: {
                        creatorHandle: creatorInfo.data.creatorHandle,
                        didAddress: creatorInfo.data.didAddress,
                        didTx: creatorInfo.data.didTx,
                        publicKey: creatorInfo.data.publicKey
                    }
                }
            };
            // console.log(getFileInfo(), getLineNumber(), record)

            if (!record.data || !record.oip) {
                
                console.log(getFileInfo(), getLineNumber(), `${record.oip.didTx} is missing required data, cannot be indexed.`);
            } else {
                console.log(getFileInfo(), getLineNumber(), '🔍 Checking if record exists in DB...');
                const existingRecord = await elasticClient.exists({
                    index: 'records',
                    id: record.oip.didTx
                });
                
                // console.log(getFileInfo(), getLineNumber(), `   📊 Record ${record.oip.didTx} exists: ${existingRecord.body}, Status will be: ${record.oip.recordStatus}`);
                
                if (!existingRecord.body) {
                    console.log(getFileInfo(), getLineNumber(), '   ➕ Creating NEW record...');
                    await indexRecord(record);
                } else {
                    console.log(getFileInfo(), getLineNumber(), `   ⚠️  Record ALREADY EXISTS - SKIPPING indexRecord call (THIS MAY BE THE BUG!)`);
                    console.log(getFileInfo(), getLineNumber(), `   💡 Pending records won't get updated to "original" because indexRecord is not called`);
                }
            }
        }
    }
}
}

function shouldIndexRecordType(recordType) {
    try {
        const mode = (recordTypeIndexConfig.mode || 'all').toLowerCase();
        const typeNorm = String(recordType).trim();

        // Always index delete messages regardless of config
        if (typeNorm === 'deleteMessage' || typeNorm === 'deleteTemplate' || typeNorm === 'delete') return true;

        if (mode === 'all') return true;

        if (mode === 'blacklist') {
            const blocked = new Set((recordTypeIndexConfig.blacklist || []).map(t => String(t).trim()));
            return !blocked.has(typeNorm);
        }

        if (mode === 'whitelist') {
            const allowed = new Set((recordTypeIndexConfig.whitelist || []).map(t => String(t).trim()));
            return allowed.has(typeNorm);
        }

        // Fallback to safe default: index all
        return true;
    } catch (err) {
        console.error(getFileInfo(), getLineNumber(), 'Error evaluating record type index policy:', err);
        return true; // fail-open to avoid accidental data loss
    }
}

// Middleware to verify if a user is an admin
async function verifyAdmin(req, res, next) {
    try {
        const token = req.headers.authorization?.split(' ')[1]; // Assuming 'Bearer <token>'
        console.log('Token received:', token); // Debug log
        if (!token) {
            return res.status(403).json({ success: false, error: 'Unauthorized access' });
        }

        const decoded = jwt.verify(token, JWT_SECRET); // Use your actual JWT secret
        console.log("Decoded token:", decoded);
        const userId = decoded.userId; // Assuming the token contains userId
        console.log('User ID:', userId); // Debug log
        // Check if the user has admin privileges directly from the token
        if (decoded.isAdmin) {
            req.user = decoded; // Attach token data to request
            return next(); // Proceed if the user is admin
        }

        // Fetch the user from Elasticsearch
        const user = await elasticClient.get({
            index: 'users',
            id: userId
        });
        console.log('User fetched:', user._source); // Debug log

        if (!user._source.isAdmin) {
            console.error('User is not an admin:', user._source.email);
            return res.status(403).json({ success: false, error: 'Admin access required' });
        }

        req.user = user._source; // Attach user info to the request
        next(); // Proceed to the route handler
    } catch (error) {
        console.error('Error verifying admin:', error);

        // Differentiate between invalid/expired token and other errors
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ success: false, error: 'Token expired' });
        } else if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ success: false, error: 'Invalid token' });
        } else if (error.meta && error.meta.statusCode === 404) {
            return res.status(404).json({ success: false, error: 'User not found' });
        } else {
            return res.status(500).json({ success: false, error: 'Internal server error' });
        }
    }
}

const deleteRecordsByIndexedAt = async (index, dateThreshold) => {
    try {
        const response = await elasticClient.deleteByQuery({
            index,
            body: {
                query: {
                    range: {
                        "oip.indexedAt": {
                            gte: dateThreshold
                        }
                    }
                }
            },
            refresh: true // Ensure changes are immediately visible
        });
        console.log(`Deleted ${response.deleted} records from index '${index}' where indexedAt <= ${dateThreshold}.`);
        return response;
    } catch (error) {
        console.error(`Error deleting records from index '${index}':`, error);
        throw error;
    }
};

const deleteRecordsByBlock = async (index, blockThreshold) => {
    try {
        const response = await elasticClient.deleteByQuery({
            index,
            body: {
                query: {
                    range: {
                        "oip.inArweaveBlock": {
                            gte: blockThreshold
                        }
                    }
                }
            },
            refresh: true // Ensure changes are immediately visible
        });
        console.log(`Deleted ${response.deleted} records from index '${index}' where inArweaveBlock >= ${blockThreshold}.`);
        return response;
    } catch (error) {
        console.error(`Error deleting records from index '${index}':`, error);
        throw error;
    }
};

const deleteRecordsByDID = async (index, did) => {
    try {
        const response = await elasticClient.deleteByQuery({
            index,
            body: {
                query: createDIDQuery(did)
            },
            refresh: true // Ensure changes are immediately visible
        });
        console.log(`Deleted ${response.deleted} records from index '${index}' with DID '${did}'.`);
        return response;
    } catch (error) {
        console.error(`Error deleting records from index '${index}' with DID '${did}':`, error);
        throw error;
    }
};

const deleteRecordsByIndex = async (index) => {
    try {
        const response = await elasticClient.deleteByQuery({
            index,
            body: {
                query: {
                    match_all: {}
                }
            },
            refresh: true // Ensure changes are immediately visible
        });
        console.log(`Deleted ${response.deleted} records from index '${index}'.`);
        return response;
    } catch (error) {
        console.error(`Error deleting records from index '${index}':`, error);
        throw error;
    }
};

const deleteIndex = async (indexName) => {
    try {
        // Check if index exists first
        const exists = await elasticClient.indices.exists({ index: indexName });
        
        if (!exists) {
            console.log(`Index '${indexName}' does not exist.`);
            return { acknowledged: false, message: `Index '${indexName}' does not exist.` };
        }

        // Delete the entire index
        const response = await elasticClient.indices.delete({ index: indexName });
        console.log(`Successfully deleted index '${indexName}'.`);
        return response;
    } catch (error) {
        console.error(`Error deleting index '${indexName}':`, error);
        throw error;
    }
};

const getRecordTypesSummary = async () => {
    try {
        // Since the recordType field is mapped as 'text', we need to use a different approach
        // We'll fetch all records and manually count the recordTypes
        const response = await elasticClient.search({
            index: 'records',
            body: {
                size: 10000, // Fetch a large number of records to get all
                _source: ['oip.recordType'], // Only fetch the recordType field
                query: {
                    exists: {
                        field: 'oip.recordType'
                    }
                }
            }
        });

        // Manual aggregation since the field doesn't support terms aggregation
        const recordTypeCounts = {};
        const records = response.hits.hits;

        records.forEach(hit => {
            const recordType = hit._source?.oip?.recordType;
            if (recordType) {
                recordTypeCounts[recordType] = (recordTypeCounts[recordType] || 0) + 1;
            }
        });

        // Convert to array and sort by count descending
        const recordTypeArray = Object.keys(recordTypeCounts)
            .map(recordType => ({
                recordType: recordType,
                count: recordTypeCounts[recordType]
            }))
            .sort((a, b) => b.count - a.count);

        // Get total count
        const totalRecords = response.hits.total.value || response.hits.total;

        console.log(getFileInfo(), getLineNumber(), `Found ${recordTypeArray.length} different record types across ${totalRecords} total records`);

        return {
            message: "Record types retrieved successfully",
            totalRecords: totalRecords,
            recordTypeCount: recordTypeArray.length,
            recordTypes: recordTypeArray
        };
    } catch (error) {
        console.error(getFileInfo(), getLineNumber(), 'Error retrieving record types summary:', error);
        throw error;
    }
};

module.exports = {
    ensureIndexExists,
    ensureUserIndexExists,
    indexRecord,
    indexDocument,
    searchByField,
    searchCreatorByAddress,
    searchRecordInDB,
    searchRecordByTxId,
    getTemplatesInDB,
    getRecords,
    keepDBUpToDate,
    searchTemplateByTxId,
    remapExistingRecords,
    verifyAdmin,
    deleteRecordFromDB,
    deleteTemplateFromDB,
    checkTemplateUsage,
    deleteRecordsByBlock,
    deleteRecordsByDID,
    deleteRecordsByIndexedAt,
    deleteRecordsByIndex,
    deleteIndex,
    getCreatorsInDB,
    getOrganizationsInDB,
    convertToOrgHandle,
    findOrganizationsByHandle,
    getRecordTypesSummary,
    processRecordForElasticsearch,
    addRecipeNutritionalSummary,
    clearRecordsCache,
    recreateGraphQLClient: createGraphQLClient, // Exposed for manual GraphQL client recreation
    calculateRecipeNutrition,
    elasticClient
};