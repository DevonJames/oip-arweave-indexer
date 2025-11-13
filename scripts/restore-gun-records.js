#!/usr/bin/env node

/**
 * Restore GUN Records from Backup
 * Restores GUN records from backup JSON file to Elasticsearch
 * 
 * Usage: node scripts/restore-gun-records.js <backup-file.json>
 */

const { indexRecord } = require('../helpers/elasticsearch');
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
        
        // Restore records
        console.log(`\n🔄 Restoring ${backup.records.length} records to Elasticsearch...`);
        
        let restored = 0;
        let skipped = 0;
        let errors = 0;
        
        for (let i = 0; i < backup.records.length; i++) {
            const record = backup.records[i];
            
            try {
                // Index record using existing function
                await indexRecord(record._source);
                restored++;
                
                if ((i + 1) % 100 === 0) {
                    console.log(`   Progress: ${i + 1}/${backup.records.length} (${restored} restored, ${skipped} skipped, ${errors} errors)`);
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
        console.log(`   ✅ Restored: ${restored}`);
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

