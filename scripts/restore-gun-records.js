#!/usr/bin/env node

/**
 * Restore GUN Records from Backup
 * Restores GUN records from backup JSON file to Elasticsearch
 * 
 * Usage: node scripts/restore-gun-records.js <backup-file.json>
 */

const { indexRecord, processRecordForElasticsearch } = require('../helpers/elasticsearch');
const { publishToGun, convertArraysForGUN } = require('../helpers/templateHelper');
const fs = require('fs');
const path = require('path');

async function restoreGunRecords(backupFile) {
    const backupPath = path.resolve(process.cwd(), backupFile);
    
    if (!fs.existsSync(backupPath)) {
        throw new Error(`Backup file not found: ${backupPath}`);
    }
    
    console.log('📦 Starting GUN records restore...');
    console.log(`📁 Backup file: ${backupPath}`);
    
    try {
        // Read backup file
        console.log('📖 Reading backup file...');
        const backupContent = fs.readFileSync(backupPath, 'utf8');
        const backup = JSON.parse(backupContent);
        
        if (!backup.metadata || !backup.records) {
            throw new Error('Invalid backup file format');
        }
        
        console.log(`📊 Backup metadata:`);
        console.log(`   Date: ${backup.metadata.backupDate}`);
        console.log(`   Records: ${backup.metadata.totalRecords}`);
        console.log(`   Source: ${backup.metadata.source}`);
        
        // Check if REPUBLISH_TO_GUN flag is set
        const republishToGun = process.env.REPUBLISH_TO_GUN === 'true';
        
        if (republishToGun) {
            console.log(`\n🔄 Restoring ${backup.records.length} records to Elasticsearch AND republishing to GUN network...`);
        } else {
            console.log(`\n🔄 Restoring ${backup.records.length} records to Elasticsearch only...`);
            console.log(`   💡 To also republish to GUN network, set REPUBLISH_TO_GUN=true`);
        }
        
        let restored = 0;
        let republished = 0;
        let skipped = 0;
        let errors = 0;
        
        for (let i = 0; i < backup.records.length; i++) {
            const record = backup.records[i];
            const recordData = record._source;
            
            try {
                // Restore to Elasticsearch
                await indexRecord(recordData);
                restored++;
                
                // Optionally republish to GUN network
                if (republishToGun && recordData.oip?.storage === 'gun') {
                    try {
                        const recordType = recordData.oip?.recordType;
                        if (recordType) {
                            // Extract the data portion (without oip wrapper)
                            // Note: recordData.data is already in Elasticsearch format (arrays, not JSON strings)
                            // We need to extract the original record structure
                            let dataPortion = recordData.data || {};
                            
                            // The data from Elasticsearch has arrays already converted from JSON strings
                            // But publishToGun expects the original record structure (which it will convert)
                            // So we can pass it directly - publishToGun will call convertArraysForGUN internally
                            
                            // Extract localId from DID if possible
                            const did = recordData.oip?.did || record._id;
                            const localIdMatch = did.match(/did:gun:[^:]+:(.+)$/);
                            const localId = localIdMatch ? localIdMatch[1] : null;
                            
                            // Extract accessControl if present
                            const accessControl = dataPortion.accessControl || recordData.data?.accessControl;
                            
                            // Republish to GUN (publishToGun will handle array→JSON string conversion)
                            await publishToGun(dataPortion, recordType, {
                                localId: localId,
                                accessControl: accessControl
                            });
                            republished++;
                        }
                    } catch (gunError) {
                        console.warn(`   ⚠️  Failed to republish ${record._id} to GUN: ${gunError.message}`);
                        if (gunError.stack) {
                            console.warn(`   Stack: ${gunError.stack.split('\n').slice(0, 3).join('\n')}`);
                        }
                    }
                }
                
                if ((i + 1) % 100 === 0) {
                    const gunStatus = republishToGun ? `, ${republished} republished to GUN` : '';
                    console.log(`   Progress: ${i + 1}/${backup.records.length} (${restored} restored${gunStatus}, ${skipped} skipped, ${errors} errors)`);
                }
            } catch (error) {
                if (error.message && error.message.includes('already exists')) {
                    skipped++;
                } else {
                    errors++;
                    console.error(`   ❌ Error restoring record ${record._id}:`, error.message);
                }
            }
        }
        
        console.log(`\n✅ Restore complete!`);
        console.log(`   ✅ Restored to Elasticsearch: ${restored}`);
        if (republishToGun) {
            console.log(`   🔄 Republished to GUN network: ${republished}`);
        }
        console.log(`   ⏭️  Skipped (already exist): ${skipped}`);
        console.log(`   ❌ Errors: ${errors}`);
        
        return { restored, skipped, errors };
        
    } catch (error) {
        console.error('❌ Restore failed:', error);
        throw error;
    }
}

// Run if called directly
if (require.main === module) {
    const backupFile = process.argv[2];
    
    if (!backupFile) {
        console.error('❌ Usage: node scripts/restore-gun-records.js <backup-file.json>');
        process.exit(1);
    }
    
    restoreGunRecords(backupFile)
        .then(() => {
            console.log('\n✅ Restore completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Restore failed:', error.message);
            process.exit(1);
        });
}

module.exports = { restoreGunRecords };

