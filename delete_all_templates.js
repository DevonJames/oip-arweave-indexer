const { Client } = require('@elastic/elasticsearch');

const elasticClient = new Client({
    node: process.env.ELASTICSEARCHHOST || 'http://elasticsearch:9200',
    auth: {
        username: process.env.ELASTICCLIENTUSERNAME,
        password: process.env.ELASTICCLIENTPASSWORD
    }
});

async function deleteAllTemplates() {
    try {
        console.log('🗑️  Deleting all templates from the templates index...');
        
        const response = await elasticClient.deleteByQuery({
            index: 'templates',
            body: {
                query: {
                    match_all: {}
                }
            },
            refresh: true
        });
        
        console.log(`✅ Deleted ${response.deleted} templates from the index`);
        console.log('🔄 Templates will now be re-indexed from the blockchain with the correct structure (both fields and fieldsInTemplate)');
        console.log('✅ Template deletion complete. The system will automatically re-index templates from the blockchain.');
        
    } catch (error) {
        console.error('❌ Error deleting templates:', error);
        process.exit(1);
    }
}

deleteAllTemplates(); 