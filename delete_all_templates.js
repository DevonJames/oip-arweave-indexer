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
        console.log('🔄 Templates will be re-indexed from the blockchain with the correct structure');
        
        return response;
    } catch (error) {
        console.error('❌ Error deleting templates:', error);
        throw error;
    }
}

deleteAllTemplates()
    .then(() => {
        console.log('✅ Template deletion complete. Restart your application to re-index templates.');
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ Template deletion failed:', error);
        process.exit(1);
    }); 