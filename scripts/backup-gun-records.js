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
            
            if (scrollId) {
                searchParams.scroll = '1m';
                searchParams.scrollId = scrollId;
            }
            
            const response = scrollId 
                ? await elasticClient.scroll({ scroll: '1m', scrollId })
                : await elasticClient.search(searchParams);
            
            const hits = response.body.hits.hits;
            totalCount += hits.length;
            
            for (const hit of hits) {
                allRecords.push({
                    _id: hit._id,
                    _source: hit._source
                });
            }
            
            scrollId = response.body._scroll_id;
            
            console.log(`   Found ${totalCount} records so far...`);
            
        } while (scrollId && totalCount < response.body.hits.total.value);
        
        // Clear scroll
        if (scrollId) {
            await elasticClient.clearScroll({ scrollId });
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

