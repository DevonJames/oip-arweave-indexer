const { Client } = require('@elastic/elasticsearch');
const Arweave = require('arweave');
const { getTransaction, getBlockHeightFromTxId } = require('./arweave');
const { resolveRecords } = require('../helpers/utils');
const arweaveConfig = require('../config/arweave.config');
const arweave = Arweave.init(arweaveConfig);
const { gql, request } = require('graphql-request');
const { validateTemplateFields, verifySignature, getTemplateTxidByName, txidToDid, getLineNumber } = require('./utils');
const { sign } = require('crypto');
const { get } = require('http');
const path = require('path');
const fs = require('fs');

// const { loadRemapTemplates, remapRecordData } = require('./templateHelper'); // Use updated remap functions


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

        console.log(`Remapping ${newField} using path ${oldFieldPath}`);

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


const findTemplateByTxId = (txId, templates) => {
    return templates.find(template => template.data.TxId === txId);
};

const searchRecordByTxId = async (txid) => {
    console.log('searching by txid:', txid);
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
    // console.log(getFileInfo(), getLineNumber(), 'records:', records);
    const expandedRecords = await Promise.all(records.map(async record => {
        // console.log(getFileInfo(), getLineNumber(), 'record:', record.t);
        let template = findTemplateByTxId(record.t, templates);
        // console.log(getFileInfo(), getLineNumber(), 'template:', record.t, template);
        let jsonData = await translateOIPDataToJSON(record, template);
        if (!jsonData) {
            // console.log(getFileInfo(), getLineNumber(), 'Template translation failed for record:', record);
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

const indexRecord = async (record) => {
    try {
        const didTx = record.oip.didTx;
        const response = await elasticClient.index({
            index: 'records',
            id: didTx, // Use didTx as the ID
            body: record,
            refresh: 'wait_for' // Wait for indexing to be complete before returning
        });

        if (response.result === 'created') {
            console.log(getFileInfo(), getLineNumber, `Record created successfully: ${didTx}`);
            return;
        } else if (response.result === 'updated') {
            console.log(getFileInfo(), getLineNumber, `Record updated successfully: ${didTx}`);
            return;
        } else {
            console.log(getFileInfo(), getLineNumber, `Unexpected response from Elasticsearch: ${JSON.stringify(response)}`);
        }
    } catch (error) {
        console.error(getFileInfo(), getLineNumber, `Error indexing record ${record.oip.didTx}:`, error);
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

async function searchTemplateByTxId(templateTxid) {
    const searchResponse = await elasticClient.search({
        index: 'templates',
        body: {
            query: {
                match: { "data.TxId": templateTxid }
            }
        }
    });
    template = searchResponse.hits.hits[0]._source;
    return template
}

async function deleteRecordFromDB(creatorDid, transaction) {
    console.log(getFileInfo(), getLineNumber(), 'deleteRecordFromDB:', creatorDid, 'transaction:', transaction)
    try {

        txIdToDelete = JSON.parse(transaction.data).delete.didTx;
        console.log(getFileInfo(), getLineNumber(), 'txIdToDelete:', creatorDid, transaction.creator, transaction.data, { txIdToDelete })
        if (creatorDid === 'did:arweave:' + transaction.creator) {
            console.log(getFileInfo(), getLineNumber(), 'same creator, deletion authorized')

            const searchResponse = await elasticClient.search({
                index: 'records',
                body: {
                    query: {
                        match: {
                            "oip.didTx": txIdToDelete
                        }
                    }
                }
            });

            if (searchResponse.hits.hits.length === 0) {
                console.log(getFileInfo(), getLineNumber(), 'No record found with the specified ID:', txIdToDelete);
                return; // Exit the function early if no record is found
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
        txid,
        url,
        didTx,
        didTxRef,
        tags,
        sortBy
    } = queryParams;

    // console.log('get records using:', template, creator_name, creator_did_address, txid, resolveDepth, url, didTx, didTxRef, tags, sortBy);
    try {
        const result = await getRecordsInDB();
        
        let records = result.records;
        let recordsInDB = result.records;
        records.qtyRecordsInDB = result.qtyRecordsInDB;
        records.maxArweaveBlockInDB = result.finalMaxRecordArweaveBlock;

         // Perform filtering based on query parameters
         if (template) {
            records = records.filter(record => {
                return record.data.some(item => {
                    return Object.keys(item).some(key => key.toLowerCase().includes(template.toLowerCase()));
                });
            });
        }

        if (creator_name) {
            records = records.filter(record => {
                return record.oip.creator.name.toLowerCase() === creator_name.toLowerCase();
            });
        }

        if (creatorHandle) {
            records = records.filter(record => {
                return record.oip.creator.creatorHandle === creatorHandle;
            });
        }

        if (creator_did_address) {
            const decodedCreatorDidAddress = decodeURIComponent(creator_did_address);
            records = records.filter(record => {
                return record.oip.creator.didAddress === decodedCreatorDidAddress;
            });
        }

        if (txid) {
            didTx = 'did:arweave:'+txid;
            records = records.filter(record => record.oip.didTx === didTx);
        }

        if (didTx) {
            records = records.filter(record => record.oip.didTx === didTx);
        }

        if (didTxRef) {
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
        }

        if (url) {
            records = records.filter(record => {
                return record.data.some(item => {
                    return item.associatedURLOnWeb && item.associatedURLOnWeb.url === url;
                });
            });
        }

        if (tags) {
            console.log('tags to match:', tags);
            const tagArray = tags.split(',').map(tag => tag.trim());
            console.log('type of tags:', typeof tagArray);
            records = records.filter(record => {
            return record.data.some(item => {
                return item.basic && item.basic.tagItems && item.basic.tagItems.some(tag => tagArray.includes(tag));
            });
            });

            // Sort the records by the number of matching tags
            records.sort((a, b) => {
            const countMatches = (record) => {
                return record.data.reduce((count, item) => {
                if (item.basic && item.basic.tagItems) {
                    count += item.basic.tagItems.filter(tag => tagArray.includes(tag)).length;
                }
                return count;
                }, 0);
            };

            const aMatches = countMatches(a);
            const bMatches = countMatches(b);

            return bMatches - aMatches; // Sort in descending order
            });
        }

        if (sortBy) {
            fieldToSortBy = sortBy.split(':')[0];
            order = sortBy.split(':')[1];
            console.log('fieldToSortBy:', fieldToSortBy, 'order:', order);
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
                    if (order === 'asc') {
                        return new Date(a.data[0].basic.date) - new Date(b.data[0].basic.date);
                    } else {
                        return new Date(b.data[0].basic.date) - new Date(a.data[0].basic.date);
                    }
                });
            }
                
        }


            records = await Promise.all(records.map(async (record) => {
                const resolvedRecord = await resolveRecords(record, parseInt(resolveDepth),  recordsInDB );
                return resolvedRecord;
            }));

            
        return records

    } catch (error) {
        console.error('Error retrieving records:', error);
        throw new Error('Failed to retrieve records');
    }
}

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
                size: 1000 // make this a variable to be passed in
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
                const maxArweaveBlockInDB = Math.max(...records.map(record => record.oip.inArweaveBlock));
                const maxArweaveBlockInDBisNull = (maxArweaveBlockInDB === -Infinity);
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
    console.log(getFileInfo(), getLineNumber(), 'handle and decimalNumber:', txId, handle, decimalNumber);

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

async function indexNewCreatorRegistration(transaction) {
    const newCreators = [];
    let creator;

    if (!transaction || !transaction.tags) {
        console.log(getFileInfo(), getLineNumber(), 'INDEXNEWCREATORREGISTRATION CANT FIND TRANSACTION DATA OR TAGS IN CHAIN, skipping');
        return
    }

    let transactionData;

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
    const creatorInfo = await searchCreatorByAddress(creatorDid);
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
        console.log(getFileInfo(), getLineNumber(), 'expandedRecord:', expandedRecord);
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
                        templates: [
                            {
                                "creatorRegistration": creatorRegistration.creatorRegistration.templateTxId,
                                "basic": basic.basic.templateTxId
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

    // console.log(getFileInfo(), getLineNumber(), 'creator to be indexed:', creator);
    const existingCreator = await elasticClient.exists({
        index: 'creatorregistrations',
        id: creator.oip.didTx
    });
    if (!existingCreator.body) {
        try {
            await elasticClient.index({
                index: 'creatorregistrations',
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

async function processNewTemplate(transaction) {
    console.log(getFileInfo(), getLineNumber(), 'processNewTemplate:', transaction)

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
    console.log(getFileInfo(), getLineNumber(), 'fieldsString:', transaction.transactionId, { fieldsString, fieldsString1 })
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


async function keepDBUpToDate(remapTemplates) {
    await ensureIndexExists();

    let { qtyCreatorsInDB, maxArweaveCreatorRegBlockInDB, creatorsInDB } = await getCreatorsInDB();
    // console.log('qtyCreatorsInDB:', qtyCreatorsInDB, 'maxArweaveCreatorRegBlockInDB:', maxArweaveCreatorRegBlockInDB, 'creatorsInDB:', creatorsInDB);
    foundInDB = {
        qtyRecordsInDB: qtyCreatorsInDB,
        maxArweaveBlockInDB: maxArweaveCreatorRegBlockInDB,
        recordsInDB: creatorsInDB
    };

    if (qtyCreatorsInDB === 0) {
        const hardCodedTxId = 'eqUwpy6et2egkGlkvS7c5GKi0aBsCXT6Dhlydf3GA3Y';
        console.log(getFileInfo(), getLineNumber(), 'Exception - No creators found in DB, looking up creator registration data in hard-coded txid', hardCodedTxId);
        try {
            const transaction = await getTransaction(hardCodedTxId);
            await indexNewCreatorRegistration(transaction)
            maxArweaveCreatorRegBlockInDB = await getBlockHeightFromTxId(hardCodedTxId)
            qtyCreatorsInDB = 1;
        } catch (error) {
            console.error(getFileInfo(), getLineNumber(),`Error indexing creator: ${hardCodedTxId}`, error);
        }
    };

    // standardize these names a bit better
    const { finalMaxArweaveBlock, qtyTemplatesInDB, templatesInDB } = await getTemplatesInDB();

    const { finalMaxRecordArweaveBlock, qtyRecordsInDB, recordsInDB } = await getRecordsInDB();

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
    foundInDB.recordsInDB = Math.max(
        creatorsInDB || 0,
        templatesInDB || 0,
        recordsInDB || 0
    );

    try {
        const newTransactions = await searchArweaveForNewTransactions(foundInDB);
        if (newTransactions && newTransactions.length > 0) {
            for (const tx of newTransactions) {
                await processTransaction(tx, remapTemplates);
            }
        }
        else {
            console.log(getFileInfo(), getLineNumber(), 'No new transactions found, waiting...');
        }
    } catch (error) {
        console.error(getFileInfo(), getLineNumber(), 'Error fetching new transactions:', {
            status: error.response?.status,
            headers: error.response?.headers,
            query: error.request?.query,
            message: error.message
        });
        return [];
    }
}

async function searchArweaveForNewTransactions(foundInDB) {
    await ensureIndexExists();
    const { qtyRecordsInDB, maxArweaveBlockInDB } = foundInDB;
    const min = (qtyRecordsInDB === 0) ? 1463750 : (maxArweaveBlockInDB + 1);
    console.log(getFileInfo(), getLineNumber(), 'Searching for new OIP data after block:', min);

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
        try {
            response = await request(endpoint, query);
        } catch (error) {
            console.error(getFileInfo(), getLineNumber(), 'Error fetching new transactions:', error);
            return [];
        }

        const transactions = response.transactions.edges.map(edge => edge.node);
        allTransactions = allTransactions.concat(transactions);

        // Pagination logic
        hasNextPage = response.transactions.pageInfo.hasNextPage;  // Check if more pages exist
        afterCursor = response.transactions.edges.length > 0 ? response.transactions.edges[response.transactions.edges.length - 1].cursor : null;  // Get the cursor for the next page

        console.log(getFileInfo(), getLineNumber(), 'Fetched', transactions.length, 'transactions, total so far:', allTransactions.length);

        // If there's no next page, stop the loop
        if (!hasNextPage) break;
    }

    console.log(getFileInfo(), getLineNumber(), 'Total transactions fetched:', allTransactions.length);
    return allTransactions.reverse();  // Returning reversed transactions as per your original code
}


async function processTransaction(tx, remapTemplates) {
    console.log(getFileInfo(), getLineNumber(),'processing transaction:', tx.id, 'block:', tx)
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
        const isCreatorRegistration = await checkIfCreatorRegistration(transaction);
        if (isCreatorRegistration) {
            // console.log(getFileInfo(), getLineNumber(),'processing creator registration:', transaction.transactionId)
            await indexNewCreatorRegistration(transaction);
        } else {
            // console.log(getFileInfo(), getLineNumber(),'processing record:', transaction.transactionId)
            await processNewRecord(transaction, remapTemplates);
        }
    } else if (tags['Type'] === 'Template') {
        // console.log(getFileInfo(), getLineNumber(),'processing template:', transaction.transactionId)
        await processNewTemplate(transaction);
    }
}

async function checkIfCreatorRegistration(transaction) {
    if (!transaction || !transaction.data) return false;

    const transactionData = typeof transaction.data === 'string'
        ? JSON.parse(`[${transaction.data.replace(/}{/g, '},{')}]`)
        : transaction.data;

    return transactionData.some(item => item.hasOwnProperty('creatorRegistration'));
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
        console.log(getFileInfo(), getLineNumber(),`es 848 signature verified for transaction ${transaction.transactionId}`);
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
    const tags = transaction.tags.slice(0, -1);
    const recordType = tags.find(tag => tag.name === 'RecordType')?.value;
    const dataForSignature = JSON.stringify(tags) + transaction.data;
    const creatorDid = txidToDid(transaction.creator);
    const creatorInfo = await searchCreatorByAddress(creatorDid);
    let transactionData;
    let isDeleteMessageFound = false;
    if (typeof transaction.data === 'string') {
        try {
            transactionData = JSON.parse(transaction.data);
            if (transactionData.hasOwnProperty('delete')) {
                console.log(getFileInfo(), getLineNumber(),'DELETE MESSAGE FOUND, processing', transaction.transactionId);
                isDeleteMessageFound = true;
                await deleteRecordFromDB(creatorDid, transaction);
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
    if (!creatorInfo) {
        console.log(getFileInfo(), getLineNumber(),`Creator not found for transaction ${transaction.transactionId}, skipping.`);
        return { records: newRecords, recordsToDelete };
    }
    let record;
    const publicKey = creatorInfo.data.publicKey;
    const isVerified = await verifySignature(dataForSignature, transaction.creatorSig, publicKey, transaction.creator);
    if (!isVerified) {
        console.error(getFileInfo(), getLineNumber(),`Signature verification failed for transaction ${transactionId}`);
        return { records: newRecords, recordsToDelete };
    }
    console.log(getFileInfo(), getLineNumber(),`Signature verified for transaction ${transaction.transactionId}`);

    const inArweaveBlock = await getBlockHeightFromTxId(transaction.transactionId);
    console.log(getFileInfo(), getLineNumber(),`inArweaveBlock ${inArweaveBlock}`);
    let dataArray = [];
    dataArray.push(transactionData);
    if (isDeleteMessageFound) {
        record = {
            data: dataArray,
            oip: {
                recordType: recordType,
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
        await indexRecord(record)
        console.log(getFileInfo(), getLineNumber(),'Delete message indexed:', transaction.transactionId);
    } else {
        const templates = await getTemplatesInDB();
        const expandedRecordPromises = await expandData(transaction.data, templates.templatesInDB);
        const expandedRecord = await Promise.all(expandedRecordPromises);
        // console.log(getFileInfo(), getLineNumber(),`Transaction ${transaction.transactionId}:`);
        if (expandedRecord !== null && expandedRecord.length > 0) {
            // console.log(getFileInfo(), getLineNumber(),`Transaction ${transaction.transactionId}:`, expandedRecord)
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
                        creatorHandle: creatorInfo.data.creatorHandle,
                        didAddress: creatorInfo.data.didAddress,
                        didTx: creatorInfo.oip.didTx,
                        publicKey: creatorInfo.data.publicKey
                    }
                }
            };
            console.log(getFileInfo(), getLineNumber(),'Record:', transaction.transactionId, record)


            // Check if the record should be remapped
            if (remapTemplates.includes(record.oip.recordType)) {
                const remapTemplateData = loadRemapTemplates(record.oip.recordType);
                if (remapTemplateData) {
                    console.log(getFileInfo(), getLineNumber(), `Remapping record of type: ${record.oip.recordType}`);
                    record = remapRecordData(record, remapTemplateData, record.oip.recordType);
                    
                } else {
                    // let recordStatus = "original"; // Default status for new records
                    console.warn(getFileInfo(), getLineNumber(), `No remap template found for type: ${record.oip.recordType}`);
                }
            }

            if (!record.data || !record.oip) {
                console.log(getFileInfo(), getLineNumber(),`${record.oip.didTx} is missing required data, cannot be indexed.`);
            } else {
                const existingRecord = await elasticClient.exists({
                    index: 'records',
                    id: record.oip.didTx
                });
                if (!existingRecord.body) {
                    // console.log(getFileInfo(), getLineNumber(),`Record to index:`, record);
                    return await indexRecord(record)
                }
            }
        }
    }
}



module.exports = {
    ensureIndexExists,
    indexRecord,
    searchCreatorByAddress,
    searchRecordInDB,
    searchRecordByTxId,
    getTemplatesInDB,
    getRecords,
    keepDBUpToDate,
    searchTemplateByTxId,
    remapExistingRecords,
    elasticClient
};