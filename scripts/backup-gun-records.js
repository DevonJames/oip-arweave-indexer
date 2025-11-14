#!/usr/bin/env node

/**
 * Backup GUN Records to JSON File
 * Exports all GUN records from Elasticsearch to a safe backup file
 * 
 * Usage: node scripts/backup-gun-records.js [output-file.json]
 */

const { elasticClient } = require('../helpers/elasticsearch');
const fs = require('fs');
const path = require('path');

async function backupGunRecords(outputFile = null) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const defaultOutputFile = outputFile || `gun-backup-${timestamp}.json`;
    // Write to /usr/src/app/data (mounted volume) so file is accessible on host
    const dataDir = path.resolve('/usr/src/app/data');
    // Ensure data directory exists
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    const outputPath = path.resolve(dataDir, defaultOutputFile);
    
    console.log('📦 Starting GUN records backup...');
    console.log(`📁 Output file: ${outputPath}`);
    console.log(`📂 Host path: ./data/${defaultOutputFile} (relative to project root)`);
    
    try {
        // Query all GUN records from Elasticsearch
        console.log('🔍 Querying Elasticsearch for GUN records...');
        
        const allRecords = [];
        let scrollId = null;
        let totalCount = 0;
        
        do {
            const searchParams = {
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
                    },
                    size: 1000
                },
                scroll: '1m'
            };
            
            const response = scrollId 
                ? await elasticClient.scroll({ scroll: '1m', scroll_id: scrollId })
                : await elasticClient.search(searchParams);
            
            // @elastic/elasticsearch returns response directly, not wrapped in .body
            const hits = response.hits?.hits || [];
            const totalHits = response.hits?.total?.value || response.hits?.total || 0;
            
            if (!hits || hits.length === 0) {
                console.log('   No more records found');
                break;
            }
            
            totalCount += hits.length;
            
            for (const hit of hits) {
                allRecords.push({
                    _id: hit._id,
                    _source: hit._source
                });
            }
            
            // Get scroll ID from response (may be _scroll_id or scroll_id depending on version)
            scrollId = response._scroll_id || response.scroll_id || null;
            
            console.log(`   Found ${totalCount} records so far (total available: ${totalHits})...`);
            
            // Break if we've retrieved all records or no scroll ID
            if (!scrollId || totalCount >= totalHits) {
                break;
            }
            
        } while (scrollId);
        
        // Clear scroll (if still active)
        if (scrollId) {
            try {
                await elasticClient.clearScroll({ scroll_id: scrollId });
            } catch (clearError) {
                // Ignore clear scroll errors (scroll may have expired)
                console.log('   Note: Scroll already cleared or expired');
            }
        }
        
        console.log(`✅ Found ${allRecords.length} GUN records total`);
        
        // Create backup structure
        const backup = {
            metadata: {
                backupDate: new Date().toISOString(),
                totalRecords: allRecords.length,
                source: 'elasticsearch',
                version: '1.0.0'
            },
            records: allRecords
        };
        
        // Write to file
        console.log(`💾 Writing backup to ${outputPath}...`);
        fs.writeFileSync(outputPath, JSON.stringify(backup, null, 2));
        
        const fileSize = fs.statSync(outputPath).size;
        const fileSizeMB = (fileSize / 1024 / 1024).toFixed(2);
        
        console.log(`✅ Backup complete!`);
        console.log(`   📊 Records: ${allRecords.length}`);
        console.log(`   💾 File size: ${fileSizeMB} MB`);
        console.log(`   📁 Location: ${outputPath}`);
        console.log(`   📂 Host path: ./data/${defaultOutputFile} (relative to project root)`);
        console.log(`\n💡 To restore, use: make restore-gun-records FILE=./data/${defaultOutputFile}`);
        
        return outputPath;
        
    } catch (error) {
        console.error('❌ Backup failed:', error);
        throw error;
    }
}

// Run if called directly
if (require.main === module) {
    const outputFile = process.argv[2] || null;
    backupGunRecords(outputFile)
        .then(() => {
            console.log('\n✅ Backup completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Backup failed:', error.message);
            process.exit(1);
        });
}

module.exports = { backupGunRecords };

