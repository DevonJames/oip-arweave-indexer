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
        
        // Check if templates index exists - handle undefined response
        let exists;
        try {
            const existsResponse = await elasticClient.indices.exists({ index: 'templates' });
            exists = existsResponse.body;
            console.log('Templates index exists response:', exists);
        } catch (error) {
            console.log('Error checking if index exists, assuming it exists:', error.message);
            exists = true; // Assume it exists if we can't check
        }
        
        // Force delete the index regardless of exists check result
        if (exists === true || exists === undefined) {
            console.log('🗑️  Force deleting existing templates index...');
            try {
                await elasticClient.indices.delete({ index: 'templates' });
                console.log('✅ Templates index deleted');
            } catch (deleteError) {
                if (deleteError.meta && deleteError.meta.body && deleteError.meta.body.error && deleteError.meta.body.error.type === 'index_not_found_exception') {
                    console.log('✅ Templates index did not exist, continuing...');
                } else {
                    console.error('Error deleting index:', deleteError.message);
                    throw deleteError;
                }
            }
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
        
        console.log('✅ Templates index recreation complete! Your application should now work correctly.');
        
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