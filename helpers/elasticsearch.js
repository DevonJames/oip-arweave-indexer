const { Client } = require('@elastic/elasticsearch');
const Arweave = require('arweave');
const { getTransaction, getBlockHeightFromTxId, getCurrentBlockHeight } = require('./arweave');
// const { resolveRecords, getLineNumber } = require('../helpers/utils');
const { setIsProcessing } = require('../helpers/processingState');  // Adjust the path as needed
const arweaveConfig = require('../config/arweave.config');
const arweave = Arweave.init(arweaveConfig);
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key_here';

const { gql, request } = require('graphql-request');
const { validateTemplateFields, verifySignature, getTemplateTxidByName, txidToDid, getLineNumber, resolveRecords } = require('./utils');
// const { sign } = require('crypto');
// const { get } = require('http');
const path = require('path');
const fs = require('fs');
// const { loadRemapTemplates, remapRecordData } = require('./templateHelper'); // Use updated remap functions
let startBlockHeight = 1463761;
const elasticClient = new Client({
    node: process.env.ELASTICSEARCHHOST || 'http://elasticsearch:9200',

    auth: {
        username: process.env.ELASTICCLIENTUSERNAME,
        password: process.env.ELASTICCLIENTPASSWORD
    }
});

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
                query: {
                    match: {
                        "oip.didTx": "did:arweave:" + txid
                    }
                }
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

    for (const fieldName in fields) {
        const indexKey = `index_${fieldName}`;
        const fieldType = fields[fieldName];

        if (typeof fields[indexKey] !== 'undefined') {
            indexToFieldMap[fields[indexKey]] = fieldName;
            if (fieldType === 'enum' && Array.isArray(fields[`${fieldName}Values`])) {
                enumIndexMappings[fieldName] = fields[`${fieldName}Values`].map(item => item.name);
            }
        }
    }

    const translatedRecord = {};
    for (const [key, value] of Object.entries(record)) {
        if (key === 't') {
            translatedRecord['templateTxId'] = value;
            continue;
        }
        const fieldName = indexToFieldMap[key];
        const fieldType = fields[fieldName];
        if (fieldName) {
            if (fieldName in enumIndexMappings && typeof value === 'number' && value < enumIndexMappings[fieldName].length) {
                translatedRecord[fieldName] = enumIndexMappings[fieldName][value];
            } else {
                translatedRecord[fieldName] = value;
            }
        } else {
            console.log(getFileInfo(), getLineNumber(), `Field with index ${key} not found in template`);
        }
    }
    translatedRecord.template = template.data.template;
    return translatedRecord;
};

const expandData = async (compressedData, templates) => {
    const records = JSON.parse(compressedData);
    const expandedRecords = await Promise.all(records.map(async record => {
        let template = findTemplateByTxId(record.t, templates);
        let jsonData = await translateOIPDataToJSON(record, template);
        if (!jsonData) {
            return null;
        }
        let expandedRecord = {
            [jsonData.template]: { ...jsonData }
        };
        delete expandedRecord[jsonData.template].templateTxId;
        delete expandedRecord[jsonData.template].template;
        return expandedRecord;
    }));
    return expandedRecords.filter(record => record !== null);
};

const ensureIndexExists = async () => {
    try {
        const templatesExists = await elasticClient.indices.exists({ index: 'templates' });
        if (!templatesExists.body) {
            try {
                await elasticClient.indices.create({
                    index: 'templates',
                    body: {
                        mappings: {
                            properties: {
                                TxId: { type: 'text' },
                                template: { type: 'text' },
                                fields: { type: 'text' },
                                tags: { type: 'text' },
                                creator: { type: 'text' },
                                creatorSig: { type: 'text' },
                                oip: {
                                    type: 'object',
                                    properties: {
                                        didTx: { type: 'keyword' },
                                        inArweaveBlock: { type: 'long' },
                                        indexedAt: { type: 'date' },
                                        ver: { type: 'text' },
                                        creator: {
                                            type: 'object',
                                            properties: {
                                                creatorHandle: { type: 'text' },
                                                didAddress: { type: 'text' }
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
        const recordsExists = await elasticClient.indices.exists({ index: 'records' });
        if (!recordsExists.body) {
            try {
                await elasticClient.indices.create({
                    index: 'records',
                    body: {
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
    } catch (error) {
        console.error("Error checking or creating index:", error);
        throw error;
    }
};

const ensureUserIndexExists = async () => {
    try {
        const indexExists = await elasticClient.indices.exists({ index: 'users' });
        console.log(`Index exists check for 'users':`, indexExists.body);  // Log existence check result
        
        if (!indexExists.body) {
            await elasticClient.indices.create({
                index: 'users',
                body: {
                    mappings: {
                        properties: {
                            email: { type: 'text' },
                            passwordHash: { type: 'text' },
                            subscriptionStatus: { type: 'text' },
                            paymentMethod: { type: 'text' },
                            createdAt: { type: 'date' }
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

const indexRecord = async (record) => {
    try {
        const didTx = record.oip.didTx;
        const existingRecord = await elasticClient.exists({
            index: 'records',
            id: didTx
        });
        if (existingRecord.body) {
            // Update existing unconfirmed record with new confirmed data
            const response = await elasticClient.update({
                index: 'records',
                id: didTx,
                body: {
                    doc: {
                        ...record,
                        "oip.recordStatus": "original"
                    }
                },
                refresh: 'wait_for'
            });
            console.log(`Record updated successfully: ${didTx}`);    
        } else {
            const response = await elasticClient.index({
                index: 'records',
                id: didTx, // Use didTx as the ID
                body: record,
                refresh: 'wait_for' // Wait for indexing to be complete before returning
            });
            console.log(getFileInfo(), getLineNumber(), `Record indexed successfully: ${didTx}`);
        }

        // if (response.result === 'created') {
        //     console.log(`Record created successfully: ${didTx}`);
        //     return;
        // } else if (response.result === 'updated') {
        //     console.log(getFileInfo(), getLineNumber, `Record updated successfully: ${didTx}`);
        //     return;
        // } else {
        //     console.log(getFileInfo(), getLineNumber, `Unexpected response from Elasticsearch: ${JSON.stringify(response)}`);
        // }
    } catch (error) {
        console.error(getFileInfo(), getLineNumber(), `Error indexing record ${record.oip.didTx}:`, error);
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
        const maxArweaveBlockInDB = Math.max(...templatesInDB.map(template => template.oip.inArweaveBlock)) || 0;
        const maxArweaveBlockInDBisNull = (maxArweaveBlockInDB === -Infinity);
        const finalMaxArweaveBlock = maxArweaveBlockInDBisNull ? 0 : maxArweaveBlockInDB;
        return { qtyTemplatesInDB, finalMaxArweaveBlock, templatesInDB };
    } catch (error) {
        console.error('Error retrieving templates from database:', error);
        return { qtyTemplatesInDB: 0, maxArweaveBlockInDB: 0, templatesInDB: [] };
    }
};


// Retrieve all templates from the database
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
    template = searchResponse.hits.hits[0]._source;
    // console.log('12345 template:', template);
    return template
}

async function deleteRecordFromDB(creatorDid, transaction) {
    // console.log(getFileInfo(), getLineNumber(), 'deleteRecordFromDB:', creatorDid, 'transaction:', transaction)
    try {

        didTxToDelete = JSON.parse(transaction.data).delete.didTx;
        // console.log(getFileInfo(), getLineNumber(), 'didTxToDelete:', creatorDid, transaction.creator, transaction.data, { didTxToDelete })
        if (creatorDid === 'did:arweave:' + transaction.creator) {
            console.log(getFileInfo(), getLineNumber(), 'same creator, deletion authorized')

            const searchResponse = await elasticClient.search({
                index: 'records',
                body: {
                    query: {
                        match: {
                            "oip.didTx": didTxToDelete
                        }
                    }
                }
            });

            if (searchResponse.hits.hits.length === 0) {
                console.log(getFileInfo(), getLineNumber(), 'No record found with the specified ID:', didTxToDelete);
                // return; // Exit the function early if no record is found
                response = { message: 'No record found with the specified ID:', didTxToDelete }
            }

            const recordId = searchResponse.hits.hits[0]._id;

            const response = await elasticClient.delete({
                index: 'records',
                id: recordId
            });
            console.log(getFileInfo(), getLineNumber(), 'Record deleted:', response);
        } else {
            console.log(getFileInfo(), getLineNumber(), 'different creator, deletion unauthorized');
        }
    } catch (error) {
        console.error('Error deleting record:', error);
        throw error;
    }
}

async function searchCreatorByAddress(didAddress) {
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
            const creatorData = searchResponse.hits.hits[0]._source;
            return creatorData;
        } else {
            console.log(getFileInfo(), getLineNumber(), 'No creator found for address:', didAddress);
            if (didAddress === 'did:arweave:u4B6d5ddggsotOiG86D-KPkeW23qQNdqaXo_ZcdI3k0') {
                console.log(getFileInfo(), getLineNumber(), 'creator is u4B6, looking up registration data from hard-coded txid');
                const hardCodedTxId = 'eqUwpy6et2egkGlkvS7c5GKi0aBsCXT6Dhlydf3GA3Y';
                const transaction = await getTransaction(hardCodedTxId);
                // console.log(getFileInfo(), getLineNumber(), ' transaction:', transaction)
                const creatorSig = transaction.creatorSig;
                const transactionData = JSON.parse(transaction.data);
                const creatorPublicKey = transactionData[0]["1"];
                const handle = transactionData[0]["2"];
                const surname = transactionData[0]["3"]
                const name = transactionData[1]["0"];
                const language = transactionData[1]["3"];
                const inArweaveBlock = await getBlockHeightFromTxId(hardCodedTxId);
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

async function getRecords(queryParams) {

    const {
        template,
        resolveDepth,
        creator_name,
        creator_did_address,
        creatorHandle,
        // txid,
        url,
        didTx,
        didTxRef,
        tags,
        sortBy,
        recordType,
        limit,
        page,
        search,
        inArweaveBlock,
        hasAudio,
    } = queryParams;

    // console.log('get records using:', {template, creator_name, creator_did_address, resolveDepth, url, didTx, didTxRef, tags, sortBy, recordType});
    try {
        const result = await getRecordsInDB();
        // console.log('es 671 result:', result);
        let records = result.records;
        // console.log('es 673 records:', records[0]);
        let recordsInDB = result.records;
        // console.log('recordsInDB:', recordsInDB);
        let qtyRecordsInDB = result.qtyRecordsInDB;
        let maxArweaveBlockInDB = result.finalMaxRecordArweaveBlock;

        // Perform filtering based on query parameters

        // const totalRecordsInDB = recordsInDB.length;

        console.log('before filtering, there are', qtyRecordsInDB, 'records', hasAudio);



        if (inArweaveBlock != undefined) {
            if (inArweaveBlock === 'bad') {
                records = records.filter(record => {
                    const inArweaveBlock = record.oip.inArweaveBlock;
                    return isNaN(inArweaveBlock) || inArweaveBlock === null || inArweaveBlock === undefined || typeof inArweaveBlock !== 'number';
                });
                console.log('after filtering by invalid inArweaveBlock, there are', records.length, 'records');
            }
            else {
                // otherwise inArweaveBlock is a number
                records = records.filter(record => {
                    return record.oip.inArweaveBlock === inArweaveBlock;
                });
                console.log('after filtering by inArweaveBlock, there are', records.length, 'records');
            }
        }

        if (creator_name != undefined) {
            records = records.filter(record => {
                return record.oip.creator.name.toLowerCase() === creator_name.toLowerCase();
            });
            console.log('after filtering by creator_name, there are', records.length, 'records');
        }

        if (creatorHandle != undefined) {
            records = records.filter(record => {
                return record.oip.creator.creatorHandle === creatorHandle;
            });
            console.log('after filtering by creatorHandle, there are', records.length, 'records');
        }


        if (creator_did_address != undefined) {
            const decodedCreatorDidAddress = decodeURIComponent(creator_did_address);
            records = records.filter(record => {
                return record.oip.creator.didAddress === decodedCreatorDidAddress;
            });
            console.log('after filtering by creator_did_address, there are', records.length, 'records');
        }


        // if (txid) {
        //     didTx = 'did:arweave:'+txid;
        //     records = records.filter(record => record.oip.didTx === didTx);
        // }

        if (didTx != undefined) {
            records = records.filter(record => record.oip.didTx === didTx);
            console.log('after filtering by didTx, there are', records.length, 'records');
        }


        if (template != undefined) {
            records = records.filter(record => {
                return record.data.some(item => {
                    return Object.keys(item).some(key => key.toLowerCase().includes(template.toLowerCase()));
                });
            });
            console.log('after filtering by template, there are', records.length, 'records');
        }


        if (recordType != undefined) {
            records = records.filter(record => {
                // console.log('record', record);
                return record.oip.recordType && record.oip.recordType.toLowerCase() === recordType.toLowerCase();
            });
            console.log('after filtering by recordType, there are', records.length, 'records');
        }

    

        if (didTxRef != undefined) {
            console.log('didTxRef:', didTxRef);

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
                record.data.some(item => searchForDidTxRef(item))
            );
            console.log('after filtering by didTxRef, there are', records.length, 'records');
        }
        if (url != undefined) {
            console.log('url to match:', url);
            records = records.filter(record => {
                return record.data.some(item => {
                    return item.associatedUrlOnWeb && item.associatedUrlOnWeb.url === url || item.associatedURLOnWeb && item.associatedURLOnWeb.url === url;
                });
            });
            console.log('767 after filtering by url:', url, 'there are', records.length, 'records');
        }
        if (tags != undefined) {
            console.log('tags to match:', tags);
            const tagArray = tags.split(',').map(tag => tag.trim());
            console.log('type of tags:', typeof tagArray);
            records = records.filter(record => {
                return record.data.some(item => {
                    return item.basic && item.basic.tagItems && item.basic.tagItems.some(tag => tagArray.includes(tag));
                });
            });
            // console.log('records after filtering by tags:', records);
            // Sort the records by the number of matching tags
            records.sort((a, b) => {
                const countMatches = (record) => {
                    return record.data.reduce((count, item) => {
                        if (item.basic && item.basic.tagItems) {
                            return count + item.basic.tagItems.filter(tag => tagArray.includes(tag)).length;
                        }
                        return count;
                    }, 0);
                };

                const aMatches = countMatches(a);
                const bMatches = countMatches(b);

                return bMatches - aMatches; // Sort in descending order
            });
            console.log('795 after filtering by tags, there are', records.length, 'records');
        }

        // search records by search parameter
        if (search != undefined) {
            const searchLower = search.toLowerCase();
            console.log('searching for:', searchLower, 'in records', records[0]);
            records = records.filter(record => {
                const basicData = record.data.find(item => item.basic); // Ensure `basic` exists

                // Match title (basic.name), description (basic.description), and tags (basic.tagItems)
                const titleMatches = basicData?.basic?.name?.toLowerCase().includes(searchLower) || false;
                const descriptionMatches = basicData?.basic?.description?.toLowerCase().includes(searchLower) || false;
                const tagsMatches = basicData?.basic?.tagItems?.some(tag => tag.toLowerCase().includes(searchLower)) || false;

                return titleMatches || descriptionMatches || tagsMatches;
            });
            console.log('after search filtering, there are', records.length, 'records');
        }


        console.log('all filters complete, there are', records.length, 'records');



        // Add a dateReadable field to each record that has a timestamp value at ...basic.date
        records = records.map(record => {
            const basicData = record.data.find(item => item.basic); // Ensure `basic` exists
            if (basicData && basicData.basic.date) {
                const date = new Date(basicData.basic.date * 1000); // Convert Unix timestamp to milliseconds
                record.data = record.data.map(item => {
                    if (item.basic && item.basic.date) {
                        item.basic.dateReadable = date.toDateString();
                    }
                    return item;
                });
            }
            return record;
        });

        console.log('after adding dateReadable field, there are', records.length, 'records');

        // Sort records based on sortBy parameter
        if (sortBy != undefined) {
            console.log('sorting by:', sortBy);
            fieldToSortBy = sortBy.split(':')[0];
            order = sortBy.split(':')[1];
            // console.log('fieldToSortBy:', fieldToSortBy, 'order:', order);
            // fields will all be found in records[0].oip
            if (fieldToSortBy === 'inArweaveBlock') {
                records.sort((a, b) => {
                    if (order === 'asc') {
                        return a.oip.inArweaveBlock - b.oip.inArweaveBlock;
                    } else {
                        return b.oip.inArweaveBlock - a.oip.inArweaveBlock;
                    }
                });
            }

            if (fieldToSortBy === 'indexedAt') {
                records.sort((a, b) => {
                    if (order === 'asc') {
                        return new Date(a.oip.indexedAt) - new Date(b.oip.indexedAt);
                    } else {
                        return new Date(b.oip.indexedAt) - new Date(a.oip.indexedAt);
                    }
                });
            }

            if (fieldToSortBy === 'ver') {
                records.sort((a, b) => {
                    if (order === 'asc') {
                        return a.oip.ver - b.oip.ver;
                    } else {
                        return b.oip.ver - a.oip.ver;
                    }
                });
            }

            if (fieldToSortBy === 'recordType') {
                records.sort((a, b) => {
                    if (order === 'asc') {
                        return a.oip.recordType.localeCompare(b.oip.recordType);
                    } else {
                        return b.oip.recordType.localeCompare(a.oip.recordType);
                    }
                });
            }

            if (fieldToSortBy === 'creatorHandle') {
                records.sort((a, b) => {
                    if (order === 'asc') {
                        return a.oip.creator.creatorHandle.localeCompare(b.oip.creator.creatorHandle);
                    } else {
                        return b.oip.creator.creatorHandle.localeCompare(a.oip.creator.creatorHandle);
                    }
                });
            }

            if (fieldToSortBy === 'date') {
                records.sort((a, b) => {
                    if (!a.data || !a.data[0].basic || !a.data[0].basic.date) return 1;
                    if (!b.data || !b.data[0].basic || !b.data[0].basic.date) return -1;
                    if (order === 'asc') {
                        return a.data[0].basic.date - b.data[0].basic.date;
                    } else {
                        return b.data[0].basic.date - a.data[0].basic.date;
                    }
                });
            }

        }

        // Resolve records if resolveDepth is specified
        let resolvedRecords = await Promise.all(records.map(async (record) => {
            let resolvedRecord = await resolveRecords(record, parseInt(resolveDepth), recordsInDB);
            return resolvedRecord;
        }));

        if (hasAudio) {
            console.log('Filtering for records with audio...');
            const initialResolvedRecords = resolvedRecords;
            resolvedRecords = resolvedRecords.filter(record => {
                return record.data.some(item => {
                    // Check for audioItems array and iterate safely
                    if (item.audioItems) {
                        return item.audioItems.some(audioItem => 
                            audioItem?.data?.some(audioData => 
                                audioData?.audio?.webUrl || audioData?.associatedURLOnWeb?.url
                            )
                        );
                    }
                    // Check directly for audio data at other possible places
                    if (item.post?.audioItems) {
                        return item.post.audioItems.some(audioItem => 
                            audioItem?.data?.some(audioData =>
                                audioData?.audio?.webUrl || audioData?.associatedURLOnWeb?.url
                            )
                        );
                    }
                    // Add a final safety check for `webUrl` at a higher level
                    return item?.webUrl && item.webUrl.includes('http');
                });
            });
            // console.log('After filtering for audio, there are', resolvedRecords.length, 'records');
            if (hasAudio === 'false') {
                console.log('count of resolvedRecords, initialResolvedRecords', resolvedRecords.length, initialResolvedRecords.length);
                // remove the records in resolvedRecords from initialResolvedRecords and return the remaining records
                resolvedRecords = initialResolvedRecords.filter(record => !resolvedRecords.includes(record));
                console.log('After filtering for records without audio, there are', resolvedRecords.length, 'records');
            }
            else {
                console.log('After filtering for records with audio, there are', resolvedRecords.length, 'records');
            }
        }

        // if (hasAudio && hasAudio === 'false') {
        //     console.log('Filtering for records without audio...');
        //     let initialResolvedRecords = resolvedRecords;
        //     resolvedRecords = resolvedRecords.filter(record => {
        //         return !record.data.some(item => {
        //             // Check for audioItems array and iterate safely
        //             if (item.audioItems) {
        //                 return item.audioItems.some(audioItem => 
        //                     audioItem?.data?.some(audioData => 
        //                         audioData?.audio?.webUrl || audioData?.associatedURLOnWeb?.url
        //                     )
        //                 );
        //             }
        //             // Check directly for audio data at other possible places
        //             if (item.post?.audioItems) {
        //                 return item.post.audioItems.some(audioItem => 
        //                     audioItem?.data?.some(audioData =>
        //                         audioData?.audio?.webUrl || audioData?.associatedURLOnWeb?.url
        //                     )
        //                 );
        //             }
        //             // Add a final safety check for `webUrl` at a higher level
        //             return item?.webUrl && item.webUrl.includes('http');
        //         });
        //     });

        //     // initialResolvedRecords minus resolvedRecords should be the records without audio
        //     resolvedRecords = initialResolvedRecords.filter(record => !resolvedRecords.includes(record));

        //     console.log('after filtering by hasAudio === false, there are', resolvedRecords.length, 'records');

        // }
        console.log('es 982 resolvedRecords:', resolvedRecords.length);

        const searchResults = resolvedRecords.length;
        // Apply Paging
        const pageSize = parseInt(limit) || 20; // Default to 20 if not specified
        const pageNumber = parseInt(page) || 1;  // Default to the first page

        const startIndex = (pageNumber - 1) * pageSize;
        const endIndex = startIndex + pageSize;

        const paginatedRecords = resolvedRecords.slice(startIndex, endIndex);
        resolvedRecords = paginatedRecords;

        let currentBlockHeight = await getCurrentBlockHeight();
        // let startBlockHeight = 1463761;
        let progress = Math.round((maxArweaveBlockInDB - startBlockHeight) / (currentBlockHeight - startBlockHeight)  * 100);
        return {
            message: "Records retrieved successfully",
            // qtyRecordsInDB: records.qtyRecordsInDB,
            latestArweaveBlockInDB: maxArweaveBlockInDB,
            indexingProgress: `${progress}%`,
            // qtyReturned: records.length,
            totalRecords: qtyRecordsInDB,
            searchResults: searchResults,
            displayingResults: pageSize,
            currentPage: pageNumber,
            totalPages: Math.ceil(records.length / pageSize),
            records: resolvedRecords
        };

    } catch (error) {
        console.error('Error retrieving records:', error);
        throw new Error('Failed to retrieve records');
    }
}

// async function getRecords(queryParams) {
    
//     const {
//         template,
//         resolveDepth,
//         creator_name,
//         creator_did_address,
//         creatorHandle,
//         url,
//         didTx,
//         didTxRef,
//         tags,
//         sortBy,
//         recordType,
//         limit,
//         page,
//         search  // New search parameter
//     } = queryParams;

//     try {
//         const result = await getRecordsInDB();
        
//         let records = result.records;
//         let recordsInDB = result.records;
//         records.qtyRecordsInDB = result.qtyRecordsInDB;
//         records.maxArweaveBlockInDB = result.finalMaxRecordArweaveBlock;

//         // Perform filtering based on query parameters
//         if (creator_name != undefined) {
//             records = records.filter(record => {
//                 return record.oip.creator.name.toLowerCase() === creator_name.toLowerCase();
//             });
//         }
//         console.log('after filtering by creator_name, there are', records.length, 'records');

//         if (creatorHandle != undefined) {
//             records = records.filter(record => {
//                 return record.oip.creator.creatorHandle === creatorHandle;
//             });
//         }
//         console.log('after filtering by creatorHandle, there are', records.length, 'records');

//         if (creator_did_address != undefined) {
//             const decodedCreatorDidAddress = decodeURIComponent(creator_did_address);
//             records = records.filter(record => {
//                 return record.oip.creator.didAddress === decodedCreatorDidAddress;
//             });
//         }
//         console.log('after filtering by creator_did_address, there are', records.length, 'records');

//         if (didTx != undefined) {
//             records = records.filter(record => record.oip.didTx === didTx);
//         }
//         console.log('after filtering by didTx, there are', records.length, 'records');

//         if (template) {
//             records = records.filter(record => {
//                 return record.data.some(item => {
//                     return Object.keys(item).some(key => key.toLowerCase().includes(template.toLowerCase()));
//                 });
//             });
//         }
//         console.log('after filtering by template, there are', records.length, 'records');

//         if (recordType != undefined) {
//             records = records.filter(record => {
//                 return record.oip.recordType && record.oip.recordType.toLowerCase() === recordType.toLowerCase();
//             });
//         }
//         console.log('after filtering by recordType, there are', records.length, 'records');

//         if (didTxRef != undefined) {
//             const searchForDidTxRef = (obj) => {
//                 if (Array.isArray(obj)) {
//                     return obj.some(item => searchForDidTxRef(item));
//                 } else if (typeof obj === 'object' && obj !== null) {
//                     return Object.values(obj).some(value => searchForDidTxRef(value));
//                 } else if (typeof obj === 'string') {
//                     return obj.startsWith(didTxRef);
//                 }
//                 return false;
//             };
        
//             records = records.filter(record => 
//                 record.data.some(item => searchForDidTxRef(item))
//             );
//         }
//         console.log('after filtering by didTxRef, there are', records.length, 'records');
        
//         if (url != undefined) {
//             records = records.filter(record => {
//                 return record.data.some(item => {
//                     return item.associatedURLOnWeb && item.associatedURLOnWeb.url === url;
//                 });
//             });
//         }
//         console.log('after filtering by url, there are', records.length, 'records');

//         if (tags != undefined) {
//             const tagArray = tags.split(',').map(tag => tag.trim());
//             records = records.filter(record => {
//                 return record.data.some(item => {
//                     return item.basic && item.basic.tagItems && item.basic.tagItems.some(tag => tagArray.includes(tag));
//                 });
//             });
//             records.sort((a, b) => {
//                 const countMatches = (record) => {
//                     return record.data.reduce((count, item) => {
//                         if (item.basic && item.basic.tagItems) {
//                             return count + item.basic.tagItems.filter(tag => tagArray.includes(tag)).length;
//                         }
//                         return count;
//                     }, 0);
//                 };

//                 return countMatches(b) - countMatches(a); // Sort in descending order
//             });
//         }
//         console.log('after filtering by tags, there are', records.length, 'records');

//         // Add search functionality
//         if (search != undefined) {
//             const searchLower = search.toLowerCase();
//             records = records.filter(record => {
//                 const titleMatches = record.data.some(item => item.title && item.title.toLowerCase().includes(searchLower));
//                 const descriptionMatches = record.data.some(item => item.description && item.description.toLowerCase().includes(searchLower));
//                 const tagsMatches = record.data.some(item => item.basic && item.basic.tagItems && item.basic.tagItems.some(tag => tag.toLowerCase().includes(searchLower)));
//                 return titleMatches || descriptionMatches || tagsMatches;
//             });
//         }
//         console.log('after search filtering, there are', records.length, 'records');

//         // Apply Sorting (existing code)

//         // Apply Paging (existing code)

//         return {
//             records: resolvedRecords,
//             totalRecords: records.length,
//             pageSize: pageSize,
//             currentPage: pageNumber,
//             totalPages: Math.ceil(records.length / pageSize)
//         };

//     } catch (error) {
//         console.error('Error retrieving records:', error);
//         throw new Error('Failed to retrieve records');
//     }
// }

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
            const qtyCreatorsInDB = creatorsInDB.length;
            const maxArweaveCreatorRegBlockInDB = Math.max(...creatorsInDB.map(creator => creator.oip.inArweaveBlock));
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
            query: {
                match: {
                    "oip.didTx": didTx
                }
            }
        }
    });
    // console.log(getFileInfo(), getLineNumber(), 'Search response:', JSON.stringify(searchResponse, null, 2));
    if (searchResponse.hits.hits.length > 0) {
        return searchResponse.hits.hits[0]._source;
    } else {
        return null;
    }
}

// move this into GetRecords()
const getRecordsInDB = async () => {
    try {

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
        if (records.length === 0) {
            'no records found in DB'
            return { qtyRecordsInDB: 0, maxArweaveBlockInDB: 0, records: [] };
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
                const qtyRecordsInDB = records.length;
                const maxArweaveBlockInDB = Math.max(...records.map(record => record.oip.inArweaveBlock).filter(value => !isNaN(value)));
                // console.log(getFileInfo(), getLineNumber(), 'maxArweaveBlockInDB for records:', maxArweaveBlockInDB);
                const maxArweaveBlockInDBisNull = (maxArweaveBlockInDB === -Infinity) || (maxArweaveBlockInDB === -0) || (maxArweaveBlockInDB === null);
                const finalMaxRecordArweaveBlock = maxArweaveBlockInDBisNull ? 0 : maxArweaveBlockInDB;
                return { qtyRecordsInDB, finalMaxRecordArweaveBlock, records };
            }
        }
    } catch (error) {
        console.error(getFileInfo(), getLineNumber(), 'Error retrieving records from database:', error);
        return { qtyRecordsInDB: 0, maxArweaveBlockInDB: 0, records: [] };
    }

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
    // console.log(getFileInfo(), getLineNumber(), 'handle and decimalNumber:', txId, handle, decimalNumber);

    // Start with one digit
    let digitsCount = 1;
    let uniqueHandleFound = false;
    let finalHandle = '';

    while (!uniqueHandleFound) {
        const currentDigits = decimalNumber.toString().substring(0, digitsCount);
        const possibleHandle = `${handle}${currentDigits}`;
        console.log(getFileInfo(), getLineNumber(), `Checking for handle: ${possibleHandle}`);

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

// add some kind of history of registrations
async function indexNewCreatorRegistration(creatorRegistrationParams) {
    const { transaction, block, creatorInfo } = creatorRegistrationParams;
    if (creatorInfo) {
        creatorDid = creatorInfo.data.didAddress
        const existingCreator = await elasticClient.search({
            index: 'creatorregistrations',
            body: {
            query: {
                match: {
                "data.didAddress": creatorDid
                }
            }
            }
        });
        if (existingCreator.hits.hits.length > 0) {
            const creatorId = existingCreator.hits.hits[0]._id;
            try {
                await elasticClient.delete({
                    index: 'creatorregistrations',
                    id: creatorId
                });
                console.log(getFileInfo(), getLineNumber(), `Creator deleted successfully: ${creatorInfo.data.didAddress}`);
            } catch (error) {
                console.error(getFileInfo(), getLineNumber(), `Error deleting creatorInfo: ${creatorInfo.data.didAddress}`, error);
            }
         }
            try {
                await elasticClient.index({
                    index: 'creatorregistrations',
                    body: creatorInfo,
                    id: creatorInfo.oip.didTx,
                });
                console.log(getFileInfo(), getLineNumber(), `Creator indexed successfully: ${creatorInfo.oip.didTx}`);
            } catch (error) {
                console.error(getFileInfo(), getLineNumber(), `Error indexing creatorInfo: ${creatorInfo.oip.didTx}`, error);
            }
    } else {
    const newCreators = [];
    let creator;

    if (!transaction || !transaction.tags) {
        console.log(getFileInfo(), getLineNumber(), 'INDEXNEWCREATORREGISTRATION CANT FIND TRANSACTION DATA OR TAGS IN CHAIN, skipping');
        return
    }

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

    // Check if the parsed JSON contains a delete property
    if (transactionData.hasOwnProperty('delete')) {
        console.log(getFileInfo(), getLineNumber(), 'getNewCreatorRegistrations DELETE MESSAGE FOUND, skipping', transactionId);
        return  // Return early if it's a delete message
    }
    const creatorDid = txidToDid(transaction.creator);
    let creatorInfo = creatorRegistrationParams.creatorInfo || await searchCreatorByAddress(creatorDid)

    // creatorInfo = await searchCreatorByAddress(creatorDid) || creatorRegistrationParams.creatorInfo;
    if (!creatorInfo) {
        console.log(getFileInfo(), getLineNumber(), `Creator not found for transaction ${transaction.transactionId}, skipping.`);
        return;
    }
    const publicKey = creatorInfo.data.publicKey;
    const tags = transaction.tags.slice(0, -1);
    const dataForSignature = JSON.stringify(tags) + transaction.data;
    const isVerified = await verifySignature(dataForSignature, transaction.creatorSig, publicKey, transaction.creator);
    if (!isVerified) {
        console.error(getFileInfo(), getLineNumber(), `Signature verification failed for transaction ${transactionId}`);
        return;
    }
    if (transaction.transactionId === 'eqUwpy6et2egkGlkvS7c5GKi0aBsCXT6Dhlydf3GA3Y' && isVerified) {
        creator = creatorInfo;
    }
    else {
        const templates = await getTemplatesInDB();
        const expandedRecordPromises = await expandData(transaction.data, templates.templatesInDB);
        const expandedRecord = await Promise.all(expandedRecordPromises);
        const inArweaveBlock = await getBlockHeightFromTxId(transactionId);
        if (expandedRecord !== null) {
            const creatorRegistration = expandedRecord.find(item => item.creatorRegistration !== undefined);
            if (creatorRegistration) {
                const basic = expandedRecord.find(item => item.basic !== undefined);
                const result = {};
                if (creatorRegistration.creatorRegistration.address) {
                    result.didAddress = 'did:arweave:' + creatorRegistration.creatorRegistration.address;
                }
                if (creatorRegistration.creatorRegistration.publicKey) {
                    result.creatorPublicKey = creatorRegistration.creatorRegistration.publicKey;
                }
                if (creatorRegistration.creatorRegistration.handle) {
                    result.creatorHandle = await convertToCreatorHandle(transaction.transactionId, creatorRegistration.creatorRegistration.handle);
                }
                if (transaction.transactionId) {
                    result.didTx = 'did:arweave:' + transaction.transactionId;
                }
                if (creatorRegistration.creatorRegistration.surname) {
                    result.surname = creatorRegistration.creatorRegistration.surname;
                }
                if (creatorRegistration.creatorRegistration.description) {
                    result.description = creatorRegistration.creatorRegistration.description;
                }
                if (creatorRegistration.creatorRegistration.youtube) {
                    result.youtube = creatorRegistration.creatorRegistration.youtube;
                }
                if (creatorRegistration.creatorRegistration.x) {
                    result.x = creatorRegistration.creatorRegistration.x;
                }
                if (creatorRegistration.creatorRegistration.instagram) {
                    result.instagram = creatorRegistration.creatorRegistration.instagram;
                }
                if (basic) {
                    if (basic.basic.name) {
                        result.name = basic.basic.name;
                    }
                    if (basic.basic.language) {
                        result.language = basic.basic.language;
                    }
                }

                creator = {
                    data: {
                        raw: [
                            {
                                "creatorRegistration": creatorRegistration.creatorRegistration,
                                "basic": basic.basic
                            }
                        ],
                        publicKey: result.creatorPublicKey,
                        creatorHandle: result.creatorHandle,
                        name: result.name,
                        surname: result.surname,
                        language: result.language,
                        description: result.description,
                        youtube: result.youtube,
                        x: result.x,
                        instagram: result.instagram,
                        didAddress: result.didAddress,
                        signature: transaction.creatorSig,
                    },
                    oip: {
                        recordType: 'creatorRegistration',
                        didTx: result.didTx,
                        inArweaveBlock: inArweaveBlock,
                        indexedAt: new Date(),
                        ver: transaction.ver,
                        signature: transaction.creatorSig,
                        creator: {
                            creatorHandle: result.creatorHandle,
                            didAddress: result.didAddress,
                            didTx: result.didTx,
                        }
                    }
                };
            }
        }
    }

    const existingCreator = await elasticClient.exists({
        index: 'creatorregistrations',
        id: creator.oip.didTx
    });
    if (!existingCreator.body) {
        try {
            await elasticClient.index({
                index: 'creatorregistrations',
                id: creator.oip.didTx,
                body: creator,
            });
            console.log(getFileInfo(), getLineNumber(), `Creator indexed successfully: ${creator.oip.didTx}`);
        } catch (error) {
            console.error(getFileInfo(), getLineNumber(), `Error indexing creator: ${creator.oip.didTx}`, error);
        }

    } else {
        console.log(getFileInfo(), getLineNumber(), `Creator already exists: ${result.oip.didTx}`);
    }
}
}

async function processNewTemplate(transaction) {

    if (!transaction || !transaction.tags || !transaction.data) {
        console.log(getFileInfo(), getLineNumber(), 'CANT FIND TRANSACTION (or tags or fields), skipping txid:', transaction.transactionId);
        return
    }

    const templateName = transaction.tags.find(tag => tag.name === 'TemplateName')?.value;

    let parsedData;
    try {
        parsedData = JSON.parse(transaction.data);
    } catch (error) {
        console.error(getFileInfo(), getLineNumber(), `Error parsing JSON from transaction data: ${error.message}`);
        console.error(getFileInfo(), getLineNumber(), `Invalid JSON data: ${transaction.data}`);
        return
    }

    const fieldsString = JSON.stringify(parsedData);
    const fieldsString1 = transaction.data
    // console.log(getFileInfo(), getLineNumber(), 'fieldsString:', transaction.transactionId, { fieldsString, fieldsString1 })
    const template = {
        TxId: transaction.transactionId,
        ver: transaction.ver,
        creator: transaction.creator,
        creatorSig: transaction.creatorSig,
        template: templateName,
        fields: fieldsString
    };

    const tags = transaction.tags.slice(0, -1);
    const dataForSignature = fieldsString + JSON.stringify(tags);
    const isValid = validateTemplateFields(template.fields);

    if (!isValid) {
        console.log(getFileInfo(), getLineNumber(), `Template failed - Field formatting validation failed for transaction ${transactionId}`);
        return
    }

    const message = dataForSignature;
    const didAddress = 'did:arweave:' + transaction.creator;
    const creatorData = await searchCreatorByAddress(didAddress);

    if (!creatorData) {
        console.error(getFileInfo(), getLineNumber(), `Creator data not found for DID address: ${didAddress}`);
        return
    }

    const publicKey = creatorData.data.publicKey;
    const signatureBase64 = transaction.creatorSig;
    const isVerified = await verifySignature(message, signatureBase64, publicKey, didAddress);
    if (!isVerified) {
        console.error(getFileInfo(), getLineNumber(), `Signature verification failed for transaction ${transactionId}`);
        return
    } else {
        console.log(getFileInfo(), getLineNumber(), `es 848 signature verified for transaction ${transactionId}`);
        return template;
    }
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
    try {
        await ensureIndexExists();
        let { qtyCreatorsInDB, maxArweaveCreatorRegBlockInDB, creatorsInDB } = await getCreatorsInDB();
        foundInDB = {
            qtyRecordsInDB: qtyCreatorsInDB,
            maxArweaveBlockInDB: maxArweaveCreatorRegBlockInDB,
            recordsInDB: creatorsInDB
        };
        console.log(getFileInfo(), getLineNumber(), 'Creators:', { maxArweaveCreatorRegBlockInDB, qtyCreatorsInDB });
        if (qtyCreatorsInDB === 0) {
            const hardCodedTxId = 'eqUwpy6et2egkGlkvS7c5GKi0aBsCXT6Dhlydf3GA3Y';
            const block = 1463761
            console.log(getFileInfo(), getLineNumber(), 'Exception - No creators found in DB, looking up creator registration data in hard-coded txid', hardCodedTxId);
            try {
                const transaction = await getTransaction(hardCodedTxId);
                let creatorRegistrationParams = {
                    transaction,
                    block,
                    creatorInfo: null
                }
                await indexNewCreatorRegistration(creatorRegistrationParams)
                maxArweaveCreatorRegBlockInDB = await getBlockHeightFromTxId(hardCodedTxId)
                qtyCreatorsInDB = 1;
            } catch (error) {
                console.error(getFileInfo(), getLineNumber(), `Error indexing creator: ${hardCodedTxId}`, error);
            }
        };
        // to do standardize these names a bit better
        const { finalMaxArweaveBlock, qtyTemplatesInDB, templatesInDB } = await getTemplatesInDB();
        console.log(getFileInfo(), getLineNumber(), 'Templates:', { finalMaxArweaveBlock, qtyTemplatesInDB });
        const { finalMaxRecordArweaveBlock, qtyRecordsInDB, records } = await getRecordsInDB();
        console.log(getFileInfo(), getLineNumber(), 'Records:', { finalMaxRecordArweaveBlock, qtyRecordsInDB });
        foundInDB.maxArweaveBlockInDB = Math.max(
            maxArweaveCreatorRegBlockInDB || 0,
            finalMaxArweaveBlock || 0,
            finalMaxRecordArweaveBlock || 0
        );
        foundInDB.qtyRecordsInDB = Math.max(
            qtyCreatorsInDB || 0,
            qtyTemplatesInDB || 0,
            qtyRecordsInDB || 0
        );
        foundInDB.recordsInDB = {
            creators: creatorsInDB,
            templates: templatesInDB,
            records: records
        };
        foundInDB.arweaveBlockHeights = {
            creators: maxArweaveCreatorRegBlockInDB,
            templates: finalMaxArweaveBlock,
            records: finalMaxRecordArweaveBlock
        };
        foundInDB.qtys = {
            creators: qtyCreatorsInDB,
            templates: qtyTemplatesInDB,
            records: qtyRecordsInDB
        };
        console.log(getFileInfo(), getLineNumber(), 'Found in DB:', foundInDB);

        const newTransactions = await searchArweaveForNewTransactions(foundInDB);
        if (newTransactions && newTransactions.length > 0) {
            for (const tx of newTransactions) {
                await processTransaction(tx, remapTemplates);
            }
        }
        else {
            console.log('No new transactions found, waiting...', getFileInfo(), getLineNumber());
        }
    } catch (error) {
        console.error(getFileInfo(), getLineNumber(), 'Error fetching new transactions:', {
            status: error.response?.status,
            headers: error.response?.headers,
            query: error.request?.query,
            message: error.message
        });
        // return [];
    } finally {
        setIsProcessing(false);
    }
}

async function searchArweaveForNewTransactions(foundInDB) {
    console.log('foundinDB:', foundInDB);
    await ensureIndexExists();
    const { qtyRecordsInDB, maxArweaveBlockInDB } = foundInDB;
    const min = (qtyRecordsInDB === 0) ? 1463750 : (maxArweaveBlockInDB + 1);
    console.log('Searching for new OIP data after block:', min, getFileInfo(), getLineNumber());

    let allTransactions = [];
    let hasNextPage = true;
    let afterCursor = null;  // Cursor for pagination

    const endpoint = 'https://arweave.net/graphql';

    while (hasNextPage) {
        const query = gql`
            query {
                transactions(
                    block: {min: ${min}},
                    tags: [
                        { name: "Index-Method", values: ["OIP"] }
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
                response = await request(endpoint, query);
                break; // Break the retry loop if the request is successful
            } catch (error) {
                retryCount++;
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
        allTransactions = allTransactions.concat(transactions);

        // Pagination logic
        hasNextPage = response.transactions.pageInfo.hasNextPage;
        afterCursor = response.transactions.edges.length > 0
            ? response.transactions.edges[response.transactions.edges.length - 1].cursor
            : null;

        console.log('Fetched', transactions.length, 'transactions, total so far:', allTransactions.length, getFileInfo(), getLineNumber());
    }

    console.log('Total transactions fetched:', allTransactions.length, getFileInfo(), getLineNumber());
    return allTransactions.reverse(); // Returning reversed transactions as per your original code
}

// works great, trying one that adds retries
// async function searchArweaveForNewTransactions(foundInDB) {
//     console.log('foundinDB:', foundInDB);
//     await ensureIndexExists();
//     const { qtyRecordsInDB, maxArweaveBlockInDB } = foundInDB;
//     const min = (qtyRecordsInDB === 0) ? 1463750 : (maxArweaveBlockInDB + 1);
//     console.log('Searching for new OIP data after block:', min, getFileInfo(), getLineNumber());

//     let allTransactions = [];
//     let hasNextPage = true;
//     let afterCursor = null;  // Cursor for pagination

//     const endpoint = 'https://arweave.net/graphql';
    
//     while (hasNextPage) {
//         const query = gql`
//             query {
//                 transactions(
//                     block: {min: ${min}},
//                     tags: [
//                         { name: "Index-Method", values: ["OIP"] }
//                     ],
//                     first: 100,
//                     after: ${afterCursor ? `"${afterCursor}"` : null}
//                 ) {
//                     edges {
//                         node {
//                             id
//                         }
//                         cursor
//                     }
//                     pageInfo {
//                         hasNextPage
//                     }
//                 }
//             }
//         `;

//         let response;
//         try {
//             response = await request(endpoint, query);
//         } catch (error) {
//             console.error(getFileInfo(), getLineNumber(), 'Error fetching new transactions:', error);
//             return [];
//         }

//         const transactions = response.transactions.edges.map(edge => edge.node);
//         allTransactions = allTransactions.concat(transactions);

//         // Pagination logic
//         hasNextPage = response.transactions.pageInfo.hasNextPage;  // Check if more pages exist
//         afterCursor = response.transactions.edges.length > 0 ? response.transactions.edges[response.transactions.edges.length - 1].cursor : null;  // Get the cursor for the next page

//         console.log('Fetched', transactions.length, 'transactions, total so far:', allTransactions.length, getFileInfo(), getLineNumber());

//         // If there's no next page, stop the loop
//         if (!hasNextPage) break;
//     }

//     console.log('Total transactions fetched:', allTransactions.length, getFileInfo(), getLineNumber());
//     return allTransactions.reverse();  // Returning reversed transactions as per your original code
// }


async function processTransaction(tx, remapTemplates) {
    try {
    // console.log(getFileInfo(), getLineNumber(),'processing transaction:', tx.id, 'block:', tx)
    const transaction = await getTransaction(tx.id);
    if (!transaction || !transaction.tags) {
        console.log(getFileInfo(), getLineNumber(),'CANT FIND TX OR TAGS IN CHAIN, skipping:', tx.id);
        return;
    }
    const tags = transaction.tags.reduce((acc, tag) => {
        acc[tag.name] = tag.value;
        return acc;
    }, {});
    if (tags['Type'] === 'Record' && tags['Index-Method'] === 'OIP') {
            await processNewRecord(transaction, remapTemplates);
    } else if (tags['Type'] === 'Template') {
        await processNewTemplate(transaction);
    }
} catch (error) {
    console.error(getFileInfo(), getLineNumber(),'Error processing transaction:', tx.id);
}
}

async function processNewTemplate(transaction) {
    if (!transaction || !transaction.tags || !transaction.data) {
        console.log(getFileInfo(), getLineNumber(),'cannnot find transaction (or tags or fields), skipping txid:', transaction.transactionId);
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
    const tags = transaction.tags.slice(0, -1);
    const dataForSignature = fieldsString + JSON.stringify(tags);
    const isValid = validateTemplateFields(fieldsString);
    if (!isValid) {
        console.log(getFileInfo(), getLineNumber(),`Template failed - Field formatting validation failed for transaction ${transaction.transactionId}`);
        return null;
    }
    const message = dataForSignature;
    const didAddress = 'did:arweave:' + transaction.creator;
    const creatorData = await searchCreatorByAddress(didAddress);
    if (!creatorData) {
        console.error(`Creator data not found for DID address: ${didAddress}`);
        return null;
    }
    const publicKey = creatorData.data.publicKey;
    const signatureBase64 = transaction.creatorSig;
    const isVerified = await verifySignature(message, signatureBase64, publicKey, didAddress);
    if (!isVerified) {
        console.error(getFileInfo(), getLineNumber(),`Signature verification failed for transaction ${transaction.transactionId}`);
        return null;
    } else {
        const inArweaveBlock = await getBlockHeightFromTxId(transaction.transactionId);
        const data = {
            TxId: transaction.transactionId,
            creator: transaction.creator,
            creatorSig: transaction.creatorSig,
            template: templateName,
            fields: fieldsString
        };
        const oip = {
            didTx: 'did:arweave:' + transaction.transactionId,
            inArweaveBlock: inArweaveBlock,
            indexedAt: new Date().toISOString(),
            ver: transaction.ver,
            creator: {
                creatorHandle: creatorData.data.creatorHandle,
                didAddress: creatorData.data.didAddress
            }
        }
        const template = {
            data,
            oip
        };
        try {

            const existingTemplate = await elasticClient.exists({
                index: 'templates',
                id: oip.didTx
            });
            if (!existingTemplate.body) {
                await elasticClient.index({
                    index: 'templates',
                    body: template,
                });
            }
            console.log(`Template indexed successfully: ${template.data.TxId}`);
        } catch (error) {
            console.error(`Error indexing template: ${template.TxId}`, error);
        }
        return template;
    }
}

async function processNewRecord(transaction, remapTemplates = []) {
    console.log(getFileInfo(), getLineNumber(),'processing record:', transaction.transactionId)
    const newRecords = [];
    const recordsToDelete = [];
    if (!transaction || !transaction.tags) {
        console.log(getFileInfo(), getLineNumber(),'cannot find transaction (or data or tags) in chain, skipping:', transaction.transactionId);
        return { records: newRecords, recordsToDelete };
    }
    const transactionId = transaction.transactionId;
    const tags = transaction.tags.slice(0, -1);
    const recordType = tags.find(tag => tag.name === 'RecordType')?.value;
    const dataForSignature = JSON.stringify(tags) + transaction.data;
    const creatorDid = txidToDid(transaction.creator);
    let creatorInfo = await searchCreatorByAddress(creatorDid);
    let transactionData;
    let isDeleteMessageFound = false;
    if (typeof transaction.data === 'string') {
        try {
            transactionData = JSON.parse(transaction.data);
            if (transactionData.hasOwnProperty('delete')) {
                console.log(getFileInfo(), getLineNumber(),'DELETE MESSAGE FOUND, processing', transaction.transactionId);
                // turning off for now till we implement a security mechanism for this since it can come in over an API
                // isDeleteMessageFound = true;
                isDeleteMessageFound = true;
            }
        } catch (error) {
            console.error(getFileInfo(), getLineNumber(),`Invalid JSON data, skipping: ${transaction.transactionId}`, transaction.data, typeof transaction.data, error);
            return { records: newRecords, recordsToDelete };
        }
    } else if (typeof transaction.data === 'object') {
        transactionData = transaction.data;
    } else {
        console.log(getFileInfo(), getLineNumber(),'UNSUPPORTED DATA TYPE, skipping:', transaction.transactionId, typeof transaction.data);
        return { records: newRecords, recordsToDelete };
    }
    let record;
    let currentBlockHeight = await getCurrentBlockHeight();
    let inArweaveBlock = await getBlockHeightFromTxId(transaction.transactionId);
    let progress = Math.round((inArweaveBlock - startBlockHeight) / (currentBlockHeight - startBlockHeight)  * 100);
    console.log(getFileInfo(), getLineNumber(),`Indexing Progress: ${progress}%`);
    let dataArray = [];
    dataArray.push(transactionData);
    if (isDeleteMessageFound) {
        console.log(getFileInfo(), getLineNumber(),'Delete message found, processing:', transaction.transactionId);
        record = {
            data: dataArray,
            oip: {
                recordType: 'deleteMessage',
                didTx: 'did:arweave:' + transaction.transactionId,
                inArweaveBlock: inArweaveBlock,
                indexedAt: new Date().toISOString(),
                ver: transaction.ver,
                signature: transaction.creatorSig,
                creator: {
                    creatorHandle: creatorInfo.data.creatorHandle,
                    didAddress: creatorInfo.data.didAddress,
                    didTx: creatorInfo.oip.didTx,
                    publicKey: creatorInfo.data.publicKey
                }
            }
        };
        // console.log(getFileInfo(), getLineNumber(),'Delete message found:', transaction.transactionId);
        


        if (!record.data || !record.oip) {
            console.log(getFileInfo(), getLineNumber(),`${record.oip.didTx} is missing required data, cannot be indexed.`);
        } else {
            const existingRecord = await elasticClient.exists({
                index: 'records',
                id: record.oip.didTx
            });
            if (!existingRecord.body) {
                return await indexRecord(record)
            }
        }

        deleteRecordFromDB(creatorDid, transaction);

        console.log(getFileInfo(), getLineNumber(),'Delete message indexed:', transaction.transactionId, 'and referenced record deleted', record.data[0].didTx);

        // await indexRecord(record)
    } else {
        const templates = await getTemplatesInDB();
        const expandedRecordPromises = await expandData(transaction.data, templates.templatesInDB);
        const expandedRecord = await Promise.all(expandedRecordPromises);
        let date
        const basicRecord = expandedRecord.find(item => item.basic && item.basic.date !== undefined);
        if (basicRecord) {
            date = basicRecord.basic.date;
            if (isNaN(Date.parse(date))) {
            // If date is not a valid ISO string, assume it's already in Unix time
            date = parseInt(date, 10);
            } else {
            // If date is a valid ISO string, convert it to Unix time
            date = Math.floor(new Date(date).getTime() / 1000);
            }
            // Insert the value for date back into expandedRecord
            expandedRecord.forEach(record => {
            if (record.basic) {
                record.basic.date = date;
            }
            });
        }
        let publicKey
        if (recordType === 'creatorRegistration') {
            publicKey = expandedRecord[0].creatorRegistration.publicKey || '';
            address = expandedRecord[0].creatorRegistration.address || '';
            const creatorRegistration = expandedRecord.find(item => item.creatorRegistration !== undefined);
            if (creatorRegistration) {
                const basic = expandedRecord.find(item => item.basic !== undefined);
                const result = {};
                if (creatorRegistration.creatorRegistration.address) {
                    result.didAddress = 'did:arweave:' + creatorRegistration.creatorRegistration.address;
                }
                if (creatorRegistration.creatorRegistration.publicKey) {
                    result.creatorPublicKey = creatorRegistration.creatorRegistration.publicKey;
                }
                if (creatorRegistration.creatorRegistration.handle) {
                    result.creatorHandle = await convertToCreatorHandle(transaction.transactionId, creatorRegistration.creatorRegistration.handle);
                }
                if (transaction.transactionId) {
                    result.didTx = 'did:arweave:' + transaction.transactionId;
                }
                if (creatorRegistration.creatorRegistration.surname) {
                    result.surname = creatorRegistration.creatorRegistration.surname;
                }
                if (creatorRegistration.creatorRegistration.description) {
                    result.description = creatorRegistration.creatorRegistration.description;
                }
                if (creatorRegistration.creatorRegistration.youtube) {
                    result.youtube = creatorRegistration.creatorRegistration.youtube;
                }
                if (creatorRegistration.creatorRegistration.x) {
                    result.x = creatorRegistration.creatorRegistration.x;
                }
                if (creatorRegistration.creatorRegistration.instagram) {
                    result.instagram = creatorRegistration.creatorRegistration.instagram;
                }
                if (basic) {
                    if (basic.basic.name) {
                        result.name = basic.basic.name;
                    }
                    if (basic.basic.language) {
                        result.language = basic.basic.language;
                    }
                }

                creatorInfo = {
                    data: {
                        raw: [
                            {
                                "creatorRegistration": creatorRegistration.creatorRegistration,
                                "basic": basic.basic
                            }
                        ],
                        publicKey: result.creatorPublicKey,
                        creatorHandle: result.creatorHandle,
                        name: result.name,
                        surname: result.surname,
                        language: result.language,
                        description: result.description,
                        youtube: result.youtube,
                        x: result.x,
                        instagram: result.instagram,
                        didAddress: result.didAddress,
                        signature: transaction.creatorSig,
                    },
                    oip: {
                        recordType: 'creatorRegistration',
                        didTx: result.didTx,
                        inArweaveBlock: inArweaveBlock,
                        indexedAt: new Date(),
                        ver: transaction.ver,
                        signature: transaction.creatorSig,
                        creator: {
                            creatorHandle: result.creatorHandle,
                            didAddress: result.didAddress,
                            didTx: result.didTx,
                        }
                    }
                };
            }
        } else {
    
            publicKey = creatorInfo.data.publicKey || '';
        
        }
        const isVerified = await verifySignature(dataForSignature, transaction.creatorSig, publicKey, transaction.creator);
        if (!isVerified) {
            console.error(getFileInfo(), getLineNumber(),`Signature verification failed for transaction ${transactionId}`);
                return { records: newRecords, recordsToDelete };
        }
        const creatorRegistrationParams = {
            transaction,
            inArweaveBlock,
            creatorInfo
        }
        if (recordType === 'creatorRegistration') {
        await indexNewCreatorRegistration(creatorRegistrationParams)
        } else {
            if (expandedRecord !== null && expandedRecord.length > 0) {
                record = {
                    data: expandedRecord,
                    oip: {
                        recordType: recordType,
                        recordStatus: "original",
                        didTx: 'did:arweave:' + transaction.transactionId,
                        inArweaveBlock: inArweaveBlock,
                        indexedAt: new Date().toISOString(),
                        ver: transaction.ver,
                        signature: transaction.creatorSig,
                        creator: {
                            creatorHandle: creatorInfo.data.creatorHandle || expandedRecord[0].creatorRegistration.handle,
                            didAddress: creatorInfo.data.didAddress || expandedRecord[0].creatorRegistration.address,
                            didTx: creatorInfo.oip.didTx || 'did:arweave:' + transaction.transactionId,
                            publicKey: creatorInfo.data.publicKey || expandedRecord[0].creatorRegistration.publicKey
                        }
                    }
                };
    
    
                // Check if the record should be remapped
    
                // REMAPPING OFF FOR NOW
                // if (remapTemplates.includes(record.oip.recordType)) {
                //     const remapTemplateData = loadRemapTemplates(record.oip.recordType);
                //     if (remapTemplateData) {
                //         console.log(getFileInfo(), getLineNumber(), `Remapping record of type: ${record.oip.recordType}`);
                //         record = remapRecordData(record, remapTemplateData, record.oip.recordType);
                        
                //     } else {
                //         // let recordStatus = "original"; // Default status for new records
                //         console.warn(getFileInfo(), getLineNumber(), `No remap template found for type: ${record.oip.recordType}`);
                //     }
                // }
    
                if (!record.data || !record.oip) {
                    console.log(getFileInfo(), getLineNumber(),`${record.oip.didTx} is missing required data, cannot be indexed.`);
                } else {
                    const existingRecord = await elasticClient.exists({
                        index: 'records',
                        id: record.oip.didTx
                    });
                    if (!existingRecord.body) {
                        return await indexRecord(record)
                    }
                }
            }
        }
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
    elasticClient
};