/**
 * Migration script to add GUN support to Elasticsearch indices
 * Adds storage and unified DID fields to support mixed Arweave/GUN querying
 */

require('dotenv').config();
const { Client } = require('@elastic/elasticsearch');

const elasticClient = new Client({
    node: process.env.ELASTICSEARCHHOST || 'http://elasticsearch:9200',
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

/**
 * Add new fields to records index mapping
 */
async function updateRecordsMapping() {
    try {
        console.log('🔄 Updating records index mapping for GUN support...');
        
        // Add new fields to the mapping
        await elasticClient.indices.putMapping({
            index: 'records',
            body: {
                properties: {
                    'oip.did': { type: 'keyword' },           // Unified DID field
                    'oip.storage': { type: 'keyword' },       // Storage type: 'arweave', 'irys', 'gun'
                    'oip.soul': { type: 'keyword' },          // GUN soul (for GUN records only)
                    'oip.encrypted': { type: 'boolean' }      // Whether record is encrypted
                }
            }
        });
        
        console.log('✅ Records mapping updated successfully');
        return true;
    } catch (error) {
        console.error('❌ Error updating records mapping:', error);
        throw error;
    }
}

/**
 * Migrate existing records to include new fields
 */
async function migrateDIDFields() {
    try {
        console.log('🔄 Migrating existing records to include new DID and storage fields...');
        
        const script = {
            source: `
                if (ctx._source.oip != null) {
                    // Add unified DID field (copy from didTx)
                    if (ctx._source.oip.did == null && ctx._source.oip.didTx != null) {
                        ctx._source.oip.did = ctx._source.oip.didTx;
                    }
                    
                    // Add storage field (default to 'arweave' for existing records)
                    if (ctx._source.oip.storage == null) {
                        ctx._source.oip.storage = 'arweave';
                    }
                    
                    // Initialize encrypted field for existing records
                    if (ctx._source.oip.encrypted == null) {
                        ctx._source.oip.encrypted = false;
                    }
                }
            `
        };
        
        const result = await elasticClient.updateByQuery({
            index: 'records',
            body: { script },
            refresh: true,
            wait_for_completion: true
        });
        
        console.log(`✅ Migration completed: ${result.body.updated} records updated`);
        return result.body;
    } catch (error) {
        console.error('❌ Error during migration:', error);
        throw error;
    }
}

/**
 * Verify migration was successful
 */
async function verifyMigration() {
    try {
        console.log('🔍 Verifying migration...');
        
        // Check if new fields exist in a sample record
        const sampleQuery = await elasticClient.search({
            index: 'records',
            body: {
                query: { match_all: {} },
                size: 1,
                _source: ['oip.did', 'oip.storage', 'oip.didTx']
            }
        });
        
        if (sampleQuery.body.hits.hits.length > 0) {
            const sample = sampleQuery.body.hits.hits[0]._source;
            console.log('📋 Sample record after migration:', {
                did: sample.oip?.did,
                didTx: sample.oip?.didTx,
                storage: sample.oip?.storage
            });
            
            const hasNewFields = sample.oip?.did && sample.oip?.storage;
            if (hasNewFields) {
                console.log('✅ Migration verification successful');
                return true;
            } else {
                console.log('❌ Migration verification failed - new fields not found');
                return false;
            }
        } else {
            console.log('⚠️  No records found to verify migration');
            return true; // No records to migrate is fine
        }
    } catch (error) {
        console.error('❌ Error verifying migration:', error);
        throw error;
    }
}

/**
 * Main migration function
 */
async function runMigration() {
    try {
        console.log('🚀 Starting GUN support migration...');
        
        // Step 1: Update mapping
        await updateRecordsMapping();
        
        // Step 2: Migrate existing data
        await migrateDIDFields();
        
        // Step 3: Verify migration
        const verified = await verifyMigration();
        
        if (verified) {
            console.log('🎉 GUN support migration completed successfully!');
            console.log('');
            console.log('📋 New capabilities:');
            console.log('  • Unified DID support (did:arweave:, did:gun:)');
            console.log('  • Storage type filtering (source=gun, source=arweave)');
            console.log('  • Mixed querying across storage types');
            console.log('  • Backward compatibility with didTx parameter');
        } else {
            throw new Error('Migration verification failed');
        }
        
    } catch (error) {
        console.error('💥 Migration failed:', error);
        throw error;
    }
}

// Run migration if called directly
if (require.main === module) {
    runMigration()
        .then(() => {
            console.log('Migration script completed');
            process.exit(0);
        })
        .catch((error) => {
            console.error('Migration script failed:', error);
            process.exit(1);
        });
}

module.exports = {
    updateRecordsMapping,
    migrateDIDFields,
    verifyMigration,
    runMigration
};
