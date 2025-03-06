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

Promise.all([
    createContentPaymentsIndex(),
    createNotificationsIndex()
])
.then(() => process.exit(0))
.catch(error => {
    console.error(error);
    process.exit(1);
}); 