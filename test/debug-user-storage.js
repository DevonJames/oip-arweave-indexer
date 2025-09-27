/**
 * Debug User Storage
 * 
 * Helps debug user storage and retrieval issues in Elasticsearch
 */

const { elasticClient } = require('../helpers/elasticsearch');

async function debugUserStorage() {
    try {
        console.log('🔍 Debugging User Storage in Elasticsearch...\n');
        
        // 1. Check if users index exists
        const indexExists = await elasticClient.indices.exists({ index: 'users' });
        console.log('📋 Users index exists:', indexExists);
        
        // 2. Get index mapping
        if (indexExists) {
            try {
                const mapping = await elasticClient.indices.getMapping({ index: 'users' });
                console.log('\n📋 Users index mapping:');
                console.log(JSON.stringify(mapping.users.mappings, null, 2));
            } catch (error) {
                console.log('⚠️ Could not retrieve mapping:', error.message);
            }
        }
        
        // 3. Count total users
        const userCount = await elasticClient.count({ index: 'users' });
        console.log('\n👥 Total users in index:', userCount.count);
        
        // 4. Get all users (limited to 10)
        if (userCount.count > 0) {
            const allUsers = await elasticClient.search({
                index: 'users',
                body: {
                    query: { match_all: {} },
                    size: 10
                }
            });
            
            console.log('\n👤 Users found:');
            allUsers.hits.hits.forEach((hit, index) => {
                const user = hit._source;
                console.log(`${index + 1}. ID: ${hit._id}`);
                console.log(`   Email: ${user.email}`);
                console.log(`   Has mnemonic: ${!!user.encryptedMnemonic}`);
                console.log(`   Has private key: ${!!user.encryptedPrivateKey}`);
                console.log(`   Public key: ${user.publicKey ? user.publicKey.slice(0, 20) + '...' : 'None'}`);
                console.log(`   Created: ${user.createdAt || 'Unknown'}`);
                console.log('');
            });
        }
        
        // 5. Test email search for admin@fitnessally.io
        const testEmail = 'admin@fitnessally.io';
        console.log(`🔍 Testing email search for: ${testEmail}\n`);
        
        // Test 1: email.keyword
        try {
            const keywordSearch = await elasticClient.search({
                index: 'users',
                body: {
                    query: {
                        term: { 'email.keyword': testEmail.toLowerCase() }
                    }
                }
            });
            console.log('✅ email.keyword search results:', keywordSearch.hits.hits.length);
        } catch (error) {
            console.log('❌ email.keyword search failed:', error.message);
        }
        
        // Test 2: email field
        try {
            const emailSearch = await elasticClient.search({
                index: 'users',
                body: {
                    query: {
                        term: { email: testEmail.toLowerCase() }
                    }
                }
            });
            console.log('✅ email term search results:', emailSearch.hits.hits.length);
        } catch (error) {
            console.log('❌ email term search failed:', error.message);
        }
        
        // Test 3: match query
        try {
            const matchSearch = await elasticClient.search({
                index: 'users',
                body: {
                    query: {
                        match: { email: testEmail }
                    }
                }
            });
            console.log('✅ email match search results:', matchSearch.hits.hits.length);
            if (matchSearch.hits.hits.length > 0) {
                console.log('   Found email:', matchSearch.hits.hits[0]._source.email);
            }
        } catch (error) {
            console.log('❌ email match search failed:', error.message);
        }
        
        console.log('\n✅ Debug complete!');
        
    } catch (error) {
        console.error('❌ Debug failed:', error);
        throw error;
    }
}

// Export for testing
module.exports = {
    debugUserStorage
};

// Run debug if called directly
if (require.main === module) {
    debugUserStorage().catch(error => {
        console.error('❌ User storage debug failed:', error);
        process.exit(1);
    });
}
