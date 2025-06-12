require('dotenv').config();
const { Client } = require('@elastic/elasticsearch');

const client = new Client({
    node: process.env.ELASTICSEARCHHOST,
    auth: {
        username: process.env.ELASTICCLIENTUSERNAME,
        password: process.env.ELASTICCLIENTPASSWORD
    },
    maxRetries: 5,
    requestTimeout: 60000,
    ssl: {
        rejectUnauthorized: false
    }
});

async function createContentPaymentsIndex() {
    try {
        const indexExists = await client.indices.exists({
            index: 'content_payments'
        });

        if (!indexExists) {
            await client.indices.create({
                index: 'content_payments',
                body: {
                    mappings: {
                        properties: {
                            contentId: { type: 'keyword' },
                            videoTxId: { type: 'keyword' },
                            userId: { type: 'keyword' },
                            createdAt: { type: 'date' },
                            paymentAddresses: {
                                properties: {
                                    bitcoin: { type: 'keyword' }
                                    // Add other currencies here
                                }
                            },
                            payments: {
                                type: 'nested',
                                properties: {
                                    currency: { type: 'keyword' },
                                    amount: { type: 'float' },
                                    txid: { type: 'keyword' },
                                    receivedAt: { type: 'date' },
                                    confirmedAt: { type: 'date' },
                                    status: { type: 'keyword' }
                                }
                            },
                            price: { type: 'float' },
                            currency: { type: 'keyword' }
                        }
                    }
                }
            });
            console.log('Content payments index created successfully');
        }
    } catch (error) {
        console.error('Error creating content payments index:', error);
        throw error;
    }
}

async function createNotificationsIndex() {
    try {
        const indexExists = await client.indices.exists({
            index: 'notifications'
        });

        if (!indexExists) {
            await client.indices.create({
                index: 'notifications',
                body: {
                    mappings: {
                        properties: {
                            userId: { type: 'keyword' },
                            type: { type: 'keyword' },
                            contentId: { type: 'keyword' },
                            amount: { type: 'float' },
                            currency: { type: 'keyword' },
                            txid: { type: 'keyword' },
                            createdAt: { type: 'date' },
                            read: { type: 'boolean' }
                        }
                    }
                }
            });
            console.log('Notifications index created successfully');
        }
    } catch (error) {
        console.error('Error creating notifications index:', error);
        throw error;
    }
}

/**
 * Creates the index for storing cryptocurrency swap data
 */
async function createSwapsIndex() {
    try {
        const indexName = 'swaps';
        
        console.log(`Checking if ${indexName} index exists...`);
        
        // Use the exists API with proper error handling
        const indexExists = await client.indices.exists({
            index: indexName
        }).catch(err => {
            console.error(`Error checking if index exists: ${err.message}`);
            return { body: false }; // Return a default value in case of error
        });
        
        // Check if the index exists based on the statusCode
        if (indexExists.statusCode === 404 || indexExists.body === false) {
            console.log(`Creating ${indexName} index...`);
            
            try {
                await client.indices.create({
                    index: indexName,
                    body: {
                        mappings: {
                            properties: {
                                swapId: { type: 'keyword' },
                                status: { type: 'keyword' },
                                fromCurrency: { type: 'keyword' },
                                toCurrency: { type: 'keyword' },
                                fromAmount: { type: 'float' },
                                toAmount: { type: 'float' },
                                depositAddress: { type: 'keyword' },
                                depositAmount: { type: 'float' },
                                toAddress: { type: 'keyword' },
                                userId: { type: 'keyword' },
                                tradeId: { type: 'keyword' },
                                expectedRate: { type: 'float' },
                                created: { type: 'date' },
                                updated: { type: 'date' },
                                completed: { type: 'date' },
                                logs: {
                                    type: 'nested',
                                    properties: {
                                        time: { type: 'date' },
                                        status: { type: 'keyword' },
                                        message: { type: 'text' }
                                    }
                                },
                                customData: { type: 'object', enabled: false }
                            }
                        },
                        settings: {
                            number_of_shards: 1,
                            number_of_replicas: 0
                        }
                    }
                });
                console.log(`Index ${indexName} created successfully`);
            } catch (createError) {
                // Check if it's just because the index already exists
                if (createError.meta && createError.meta.body && 
                    createError.meta.body.error && 
                    createError.meta.body.error.type === 'resource_already_exists_exception') {
                    console.log(`Index ${indexName} already exists (created by another process)`);
                } else {
                    // If it's a different error, rethrow it
                    throw createError;
                }
            }
        } else {
            console.log(`Index ${indexName} already exists`);
        }
    } catch (error) {
        console.warn(`Warning: Error during swaps index creation: ${error.message}`);
        // Don't throw the error, just log it to avoid stopping the server startup
    }
}

/**
 * Initialize all indices without exiting the process
 * @returns {Promise} Promise that resolves when all indices are initialized
 */
async function initializeIndices() {
    try {
        await Promise.all([
            createContentPaymentsIndex(),
            createNotificationsIndex(),
            createSwapsIndex()
        ]);
        console.log('All indices initialized successfully');
        return true;
    } catch (error) {
        console.error('Error initializing indices:', error);
        throw error;
    }
}

module.exports = {
    createContentPaymentsIndex,
    createNotificationsIndex,
    createSwapsIndex,
    initializeIndices
}; 