#!/usr/bin/env node

/**
 * Restore GUN backup with proper format (data/oip as JSON strings)
 * 
 * Usage:
 *   node scripts/restore-gun-backup.js <backup-file.json>
 * 
 * Example:
 *   node scripts/restore-gun-backup.js gun-backup-2025-11-14T00-56-51-339Z.json
 */

const fs = require('fs');
const axios = require('axios');
const path = require('path');

// Import Elasticsearch indexing function
const { indexRecord } = require('../helpers/elasticsearch');

// Configuration
const GUN_RELAY_URL = process.env.GUN_RELAY_URL || process.env.GUN_PEERS || 'http://gun-relay:8765';
const BATCH_SIZE = 5; // Process records in batches (reduced to avoid overwhelming server)
const DELAY_MS = 500; // Delay between batches to avoid overwhelming the server (increased)
const RETRY_DELAY = 1000; // Delay before retrying failed requests

// Statistics
const stats = {
    total: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    errors: []
};

/**
 * Extract soul from DID
 */
function extractSoulFromDid(did) {
    if (!did || !did.startsWith('did:gun:')) {
        return null;
    }
    return did.replace('did:gun:', '');
}

/**
 * Store a record in GUN via HTTP API
 */
async function storeRecordInGun(soul, data, oip) {
    try {
        // Convert data and oip to JSON strings for GUN storage
        const gunRecord = {
            data: JSON.stringify(data),
            oip: JSON.stringify(oip),
            meta: {
                created: Date.now(),
                encrypted: false,
                localId: soul.split(':')[1] || null
            }
        };

        const response = await axios.post(`${GUN_RELAY_URL}/put`, {
            soul: soul,
            data: gunRecord
        }, {
            timeout: 30000,
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.data && response.data.success) {
            return { success: true };
        } else {
            return { success: false, error: 'PUT returned false success' };
        }
    } catch (error) {
        return { 
            success: false, 
            error: error.response?.data?.error || error.message 
        };
    }
}

/**
 * Register record in discovery registry
 */
async function registerInRegistry(did, soul, recordType, creatorPubKey) {
    try {
        // Extract creator public key from the record
        const registryEntry = {
            did: did,
            soul: soul,
            recordType: recordType,
            creatorPubKey: creatorPubKey,
            nodeId: 'restore-script',
            timestamp: Date.now(),
            oipVersion: '0.8.0'
        };

        // Register in global index
        const indexSoul = `oip:registry:index:${recordType}`;
        
        // First, get current index
        let currentIndex = {};
        try {
            const getResponse = await axios.get(`${GUN_RELAY_URL}/get`, {
                params: { soul: indexSoul },
                timeout: 10000
            });
            
            if (getResponse.data && getResponse.data.success && getResponse.data.data) {
                currentIndex = getResponse.data.data;
                // Remove GUN internal properties
                delete currentIndex._;
            }
        } catch (e) {
            // Index doesn't exist yet, that's ok
        }

        // Add this entry
        currentIndex[soul] = {
            soul: soul,
            nodeId: 'restore-script',
            timestamp: Date.now()
        };

        // Store updated index
        const putResponse = await axios.post(`${GUN_RELAY_URL}/put`, {
            soul: indexSoul,
            data: currentIndex
        }, {
            timeout: 10000,
            headers: { 'Content-Type': 'application/json' }
        });

        return putResponse.data && putResponse.data.success;
    } catch (error) {
        console.warn(`⚠️ Registry registration failed for ${did}:`, error.message);
        return false; // Non-fatal, continue restoration
    }
}

/**
 * Process a single record
 */
async function processRecord(record) {
    const did = record._id;
    const source = record._source;

    // Validate record structure
    if (!did || !source || !source.data || !source.oip) {
        stats.skipped++;
        console.log(`⏭️  Skipped invalid record: ${did}`);
        return;
    }

    // Extract soul from DID
    const soul = extractSoulFromDid(did);
    if (!soul) {
        stats.skipped++;
        console.log(`⏭️  Skipped record with invalid DID: ${did}`);
        return;
    }

    // Store in GUN
    const result = await storeRecordInGun(soul, source.data, source.oip);
    
    if (result.success) {
        // Index to Elasticsearch (CRITICAL: This was missing!)
        try {
            const elasticsearchRecord = {
                data: source.data,
                oip: source.oip
            };
            await indexRecord(elasticsearchRecord);
            console.log(`📊 Indexed to Elasticsearch: ${did}`);
        } catch (indexError) {
            console.warn(`⚠️ Failed to index to Elasticsearch: ${did}:`, indexError.message);
            // Continue anyway - GUN storage succeeded
        }

        // Register in discovery registry
        const recordType = source.oip.recordType;
        const creatorPubKey = source.oip.creator?.publicKey;
        
        if (recordType && creatorPubKey) {
            await registerInRegistry(did, soul, recordType, creatorPubKey);
        }

        stats.success++;
        console.log(`✅ Restored: ${did}`);
    } else {
        stats.failed++;
        stats.errors.push({ did, error: result.error });
        console.log(`❌ Failed to restore ${did}: ${result.error}`);
    }
}

/**
 * Process records in batches
 */
async function processBatch(records) {
    const promises = records.map(record => processRecord(record));
    await Promise.all(promises);
}

/**
 * Main restoration function
 */
async function restoreBackup(backupFilePath) {
    console.log('🔄 GUN Backup Restoration Tool');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Check if file exists
    if (!fs.existsSync(backupFilePath)) {
        console.error(`❌ Backup file not found: ${backupFilePath}`);
        process.exit(1);
    }

    console.log(`📂 Reading backup file: ${backupFilePath}`);
    
    // Read and parse backup file
    let backup;
    try {
        const fileContent = fs.readFileSync(backupFilePath, 'utf8');
        backup = JSON.parse(fileContent);
    } catch (error) {
        console.error(`❌ Failed to read/parse backup file: ${error.message}`);
        process.exit(1);
    }

    // Validate backup structure
    if (!backup.records || !Array.isArray(backup.records)) {
        console.error('❌ Invalid backup format: missing records array');
        process.exit(1);
    }

    stats.total = backup.records.length;
    
    console.log(`\n📊 Backup metadata:`);
    console.log(`   Date: ${backup.metadata?.backupDate || 'unknown'}`);
    console.log(`   Total records: ${stats.total}`);
    console.log(`   Source: ${backup.metadata?.source || 'unknown'}`);
    console.log(`\n🚀 Starting restoration...\n`);

    // Process records in batches
    for (let i = 0; i < backup.records.length; i += BATCH_SIZE) {
        const batch = backup.records.slice(i, i + BATCH_SIZE);
        await processBatch(batch);
        
        // Progress update
        const progress = Math.min(i + BATCH_SIZE, backup.records.length);
        const percentage = ((progress / stats.total) * 100).toFixed(1);
        console.log(`\n📊 Progress: ${progress}/${stats.total} (${percentage}%)\n`);
        
        // Delay between batches
        if (i + BATCH_SIZE < backup.records.length) {
            await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        }
    }

    // Final statistics
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Restoration complete!\n');
    console.log(`📊 Final Statistics:`);
    console.log(`   Total records:     ${stats.total}`);
    console.log(`   ✅ Successful:      ${stats.success}`);
    console.log(`   ❌ Failed:          ${stats.failed}`);
    console.log(`   ⏭️  Skipped:         ${stats.skipped}`);
    console.log(`   Success rate:      ${((stats.success / stats.total) * 100).toFixed(1)}%`);

    if (stats.errors.length > 0) {
        console.log(`\n❌ Errors (first 10):`);
        stats.errors.slice(0, 10).forEach(({ did, error }) => {
            console.log(`   ${did}: ${error}`);
        });
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

// CLI interface
if (require.main === module) {
    const backupFile = process.argv[2];
    
    if (!backupFile) {
        console.error('Usage: node restore-gun-backup.js <backup-file.json>');
        process.exit(1);
    }

    // Resolve absolute path
    const absolutePath = path.isAbsolute(backupFile) 
        ? backupFile 
        : path.join(process.cwd(), backupFile);

    restoreBackup(absolutePath)
        .then(() => process.exit(0))
        .catch(error => {
            console.error('❌ Restoration failed:', error);
            process.exit(1);
        });
}

module.exports = { restoreBackup };

