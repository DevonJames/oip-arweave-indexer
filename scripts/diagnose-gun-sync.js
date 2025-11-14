#!/usr/bin/env node

/**
 * Diagnose GUN Sync Issues
 * Checks all components of GUN sync to identify problems
 */

const { GunHelper } = require('../helpers/gun');
const { OIPGunRegistry } = require('../helpers/oipGunRegistry');

async function diagnoseGunSync() {
    console.log('🔍 GUN Sync Diagnosis\n');
    console.log('='.repeat(60));
    
    const gunHelper = new GunHelper();
    const registry = new OIPGunRegistry();
    
    // 1. Check GUN API connectivity
    console.log('\n1️⃣ Checking GUN API connectivity...');
    try {
        const testResult = await gunHelper.getRecord('test:connectivity');
        console.log('   ✅ GUN API is accessible');
        console.log(`   📡 API URL: ${gunHelper.apiUrl}`);
    } catch (error) {
        console.log('   ❌ GUN API not accessible:', error.message);
        return;
    }
    
    // 2. Check registry indexes
    console.log('\n2️⃣ Checking registry indexes...');
    const recordTypes = ['post', 'image', 'video', 'audio', 'text', 'recipe', 'workout', 'exercise', 
                        'conversationSession', 'media', 'creatorRegistration', 'organization'];
    
    let totalRecords = 0;
    for (const recordType of recordTypes) {
        const indexKey = `oip:registry:index:${recordType}`;
        try {
            const index = await gunHelper.getRecord(indexKey);
            if (index) {
                const recordCount = Object.keys(index).filter(k => 
                    !k.startsWith('oip:') && !k.startsWith('_') && index[k]?.soul
                ).length;
                totalRecords += recordCount;
                if (recordCount > 0) {
                    console.log(`   ✅ ${recordType}: ${recordCount} records`);
                }
            } else {
                console.log(`   ⚠️  ${recordType}: No index found`);
            }
        } catch (error) {
            console.log(`   ❌ ${recordType}: Error - ${error.message}`);
        }
    }
    console.log(`\n   📊 Total records in registry: ${totalRecords}`);
    
    // 3. Check node registry
    console.log('\n3️⃣ Checking node registry...');
    try {
        const nodeRegistry = await gunHelper.getRecord('oip:registry:nodes');
        if (nodeRegistry) {
            const nodeCount = Object.keys(nodeRegistry).filter(k => 
                !k.startsWith('oip:') && !k.startsWith('_')
            ).length;
            console.log(`   ✅ Found ${nodeCount} nodes in registry`);
            
            // List nodes
            for (const [nodeKey, nodeData] of Object.entries(nodeRegistry)) {
                if (!nodeKey.startsWith('oip:') && !nodeKey.startsWith('_') && nodeData) {
                    console.log(`      - Node: ${nodeKey.substring(0, 16)}... (ID: ${nodeData.nodeId || 'unknown'})`);
                }
            }
        } else {
            console.log('   ⚠️  No node registry found');
        }
    } catch (error) {
        console.log(`   ❌ Error checking node registry: ${error.message}`);
    }
    
    // 4. Check current node ID
    console.log('\n4️⃣ Current node information...');
    console.log(`   Node ID: ${registry.nodeId}`);
    console.log(`   Registry Root: ${registry.registryRoot}`);
    
    // 5. Test discovery
    console.log('\n5️⃣ Testing record discovery...');
    try {
        const discovered = await registry.discoverOIPRecords();
        console.log(`   ✅ Discovery found ${discovered.length} records from other nodes`);
        
        if (discovered.length > 0) {
            console.log('\n   Discovered records:');
            discovered.slice(0, 5).forEach((record, i) => {
                console.log(`      ${i + 1}. ${record.data?.oip?.did || record.soul} (from node ${record.sourceNodeId})`);
            });
            if (discovered.length > 5) {
                console.log(`      ... and ${discovered.length - 5} more`);
            }
        }
    } catch (error) {
        console.log(`   ❌ Discovery error: ${error.message}`);
        console.log(`   Stack: ${error.stack?.split('\n').slice(0, 3).join('\n')}`);
    }
    
    // 6. Check environment variables
    console.log('\n6️⃣ Environment configuration...');
    console.log(`   GUN_PEERS: ${process.env.GUN_PEERS || 'not set'}`);
    console.log(`   GUN_EXTERNAL_PEERS: ${process.env.GUN_EXTERNAL_PEERS || 'not set'}`);
    console.log(`   GUN_SYNC_ENABLED: ${process.env.GUN_SYNC_ENABLED !== 'false' ? 'true' : 'false'}`);
    console.log(`   GUN_SYNC_INTERVAL: ${process.env.GUN_SYNC_INTERVAL || '300000 (default)'}`);
    console.log(`   GUN_REGISTRY_ROOT: ${process.env.GUN_REGISTRY_ROOT || 'oip:registry (default)'}`);
    
    console.log('\n' + '='.repeat(60));
    console.log('\n💡 Diagnosis complete!\n');
    
    if (totalRecords === 0) {
        console.log('⚠️  WARNING: No records found in registry indexes.');
        console.log('   This could mean:');
        console.log('   1. No records have been published yet');
        console.log('   2. Registry indexes aren\'t syncing from peers');
        console.log('   3. Records aren\'t being registered properly');
    }
    
    if (totalRecords > 0 && discovered.length === 0) {
        console.log('⚠️  WARNING: Records exist in registry but discovery found none.');
        console.log('   This could mean:');
        console.log('   1. All records are from this node (filtered out)');
        console.log('   2. Records already exist in Elasticsearch (skipped)');
        console.log('   3. Discovery logic has an issue');
    }
}

// Run if called directly
if (require.main === module) {
    diagnoseGunSync()
        .then(() => {
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Diagnosis failed:', error.message);
            console.error(error.stack);
            process.exit(1);
        });
}

module.exports = { diagnoseGunSync };

