const { Client } = require('@elastic/elasticsearch');

const elasticClient = new Client({
    node: process.env.ELASTICSEARCHHOST || 'http://elasticsearch:9200',
    auth: {
        username: process.env.ELASTICCLIENTUSERNAME,
        password: process.env.ELASTICCLIENTPASSWORD
    }
});

async function forceRecreateTemplatesIndex() {
    try {
        console.log('🔍 Checking templates index...');
        
        // Check if templates index exists
        const exists = await elasticClient.indices.exists({ index: 'templates' });
        console.log('Templates index exists:', exists.body);
        
        if (exists.body) {
            console.log('🗑️  Deleting existing templates index...');
            await elasticClient.indices.delete({ index: 'templates' });
            console.log('✅ Templates index deleted');
        }
        
        console.log('📝 Creating templates index with correct mapping...');
        await elasticClient.indices.create({
            index: 'templates',
            body: {
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
        
        // Verify the mapping
        const mapping = await elasticClient.indices.getMapping({ index: 'templates' });
        const fieldsInTemplateMapping = mapping.body.templates.mappings.properties.data.properties.fieldsInTemplate;
        console.log('📋 Verified fieldsInTemplate mapping:', JSON.stringify(fieldsInTemplateMapping, null, 2));
        
        console.log('✅ Templates index recreation complete! You can now restart your application.');
        
    } catch (error) {
        console.error('❌ Error recreating templates index:', error);
        
        if (error.meta && error.meta.body && error.meta.body.error) {
            console.error('Error details:', JSON.stringify(error.meta.body.error, null, 2));
        }
    } finally {
        process.exit(0);
    }
}

forceRecreateTemplatesIndex(); 