#!/usr/bin/env node

/**
 * GUN Deletion Registry Management CLI
 * 
 * Usage:
 *   node scripts/manage-deletion-registry.js stats
 *   node scripts/manage-deletion-registry.js list
 *   node scripts/manage-deletion-registry.js check <did>
 *   node scripts/manage-deletion-registry.js details <did>
 *   node scripts/manage-deletion-registry.js mark <did> <deletedBy>
 *   node scripts/manage-deletion-registry.js unmark <did>
 */

const { GunDeletionRegistry } = require('../helpers/gunDeletionRegistry');
const { GunHelper } = require('../helpers/gun');

const gunHelper = new GunHelper();
const registry = new GunDeletionRegistry(gunHelper);

const commands = {
    async stats() {
        console.log('📊 Getting deletion registry statistics...\n');
        const stats = await registry.getStats();
        console.log(JSON.stringify(stats, null, 2));
    },
    
    async list() {
        console.log('📋 Listing all deleted DIDs...\n');
        const deletedDIDs = await registry.getAllDeletedDIDs();
        
        if (deletedDIDs.length === 0) {
            console.log('No deleted records found in registry.');
            return;
        }
        
        console.log(`Found ${deletedDIDs.length} deleted record(s):\n`);
        for (const did of deletedDIDs) {
            console.log(`  - ${did}`);
        }
    },
    
    async check(did) {
        if (!did) {
            console.error('❌ Error: DID argument required');
            console.log('Usage: node scripts/manage-deletion-registry.js check <did>');
            process.exit(1);
        }
        
        console.log(`🔍 Checking if ${did} is marked as deleted...\n`);
        const isDeleted = await registry.isDeleted(did);
        
        if (isDeleted) {
            console.log('✅ Record IS marked as deleted');
        } else {
            console.log('❌ Record is NOT marked as deleted');
        }
    },
    
    async details(did) {
        if (!did) {
            console.error('❌ Error: DID argument required');
            console.log('Usage: node scripts/manage-deletion-registry.js details <did>');
            process.exit(1);
        }
        
        console.log(`📄 Getting deletion details for ${did}...\n`);
        const details = await registry.getDeletionDetails(did);
        
        if (!details) {
            console.log('❌ No deletion entry found for this DID');
            return;
        }
        
        console.log('Deletion Details:');
        console.log(JSON.stringify(details, null, 2));
        
        if (details.deletedAt) {
            const date = new Date(details.deletedAt);
            console.log(`\nDeleted on: ${date.toLocaleString()}`);
        }
    },
    
    async mark(did, deletedBy) {
        if (!did || !deletedBy) {
            console.error('❌ Error: DID and deletedBy arguments required');
            console.log('Usage: node scripts/manage-deletion-registry.js mark <did> <deletedBy>');
            console.log('Example: node scripts/manage-deletion-registry.js mark did:gun:abc123:record1 migration-script');
            process.exit(1);
        }
        
        console.log(`📝 Marking ${did} as deleted...\n`);
        const success = await registry.markDeleted(did, deletedBy);
        
        if (success) {
            console.log('✅ Successfully marked record as deleted');
        } else {
            console.log('❌ Failed to mark record as deleted');
        }
    },
    
    async unmark(did) {
        if (!did) {
            console.error('❌ Error: DID argument required');
            console.log('Usage: node scripts/manage-deletion-registry.js unmark <did>');
            process.exit(1);
        }
        
        console.log(`🔄 Unmarking ${did}...\n`);
        const success = await registry.unmarkDeleted(did);
        
        if (success) {
            console.log('✅ Successfully unmarked record (removed from deletion registry)');
        } else {
            console.log('❌ Failed to unmark record');
        }
    },
    
    async help() {
        console.log(`
GUN Deletion Registry Management CLI

Commands:
  stats              Show deletion registry statistics
  list               List all deleted DIDs
  check <did>        Check if a DID is marked as deleted
  details <did>      Get deletion details for a DID
  mark <did> <by>    Mark a DID as deleted (for manual migration)
  unmark <did>       Remove a DID from deletion registry (for recovery)
  help               Show this help message

Examples:
  node scripts/manage-deletion-registry.js stats
  node scripts/manage-deletion-registry.js list
  node scripts/manage-deletion-registry.js check did:gun:647f79c2a338:workout_1
  node scripts/manage-deletion-registry.js details did:gun:647f79c2a338:workout_1
  node scripts/manage-deletion-registry.js mark did:gun:647f79c2a338:workout_1 admin
  node scripts/manage-deletion-registry.js unmark did:gun:647f79c2a338:workout_1
        `);
    }
};

// Main execution
(async () => {
    const [,, command, ...args] = process.argv;
    
    if (!command || command === 'help' || command === '--help' || command === '-h') {
        await commands.help();
        process.exit(0);
    }
    
    if (!commands[command]) {
        console.error(`❌ Error: Unknown command '${command}'`);
        await commands.help();
        process.exit(1);
    }
    
    try {
        await commands[command](...args);
        process.exit(0);
    } catch (error) {
        console.error('❌ Error executing command:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
})();

