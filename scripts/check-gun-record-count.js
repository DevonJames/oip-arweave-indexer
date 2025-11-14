#!/usr/bin/env node

/**
 * Check GUN Record Count
 * Quick script to count GUN records in Elasticsearch
 */

const { elasticClient } = require('../helpers/elasticsearch');

async function checkGunRecordCount() {
    try {
        console.log('🔍 Checking GUN record count in Elasticsearch...\n');
        
        const response = await elasticClient.count({
            index: 'records',
            body: {
                query: {
                    bool: {
                        should: [
                            { prefix: { "oip.did": "did:gun:" } },
                            { prefix: { "oip.didTx": "did:gun:" } },
                            { term: { "oip.storage": "gun" } }
                        ],
                        minimum_should_match: 1
                    }
                }
            }
        });
        
        const count = response.count || 0;
        
        console.log(`📊 Total GUN records: ${count}`);
        console.log(`\n💡 This is the number that should be restored to oip`);
        
        return count;
        
    } catch (error) {
        console.error('❌ Error checking count:', error.message);
        throw error;
    }
}

// Run if called directly
if (require.main === module) {
    checkGunRecordCount()
        .then((count) => {
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Failed:', error.message);
            process.exit(1);
        });
}

module.exports = { checkGunRecordCount };

