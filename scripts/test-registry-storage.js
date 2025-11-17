#!/usr/bin/env node

/**
 * Test script to verify GUN registry storage is working correctly
 * This tests the putSimple method and registry index retrieval
 */

const axios = require('axios');

// Get GUN relay URL from command line or use default
const gunRelayUrl = process.argv[2] || 'http://localhost:8765';

async function testRegistryStorage() {
    console.log(`\n🧪 Testing GUN registry storage on ${gunRelayUrl}\n`);
    
    try {
        // Step 1: Create a test registry index
        const testIndexSoul = 'oip:registry:index:test';
        const testEntry = {
            soul: 'test123:testrecord',
            nodeId: 'test-node',
            timestamp: Date.now()
        };
        
        console.log('1️⃣ Storing test registry index...');
        const putResponse = await axios.post(`${gunRelayUrl}/put`, {
            soul: testIndexSoul,
            data: { 'test123:testrecord': testEntry }
        }, {
            timeout: 5000,
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (putResponse.data && putResponse.data.success) {
            console.log('✅ Test registry index stored successfully\n');
        } else {
            throw new Error('Failed to store test index');
        }
        
        // Step 2: Wait a moment for GUN to process
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Step 3: Retrieve the test registry index
        console.log('2️⃣ Retrieving test registry index...');
        const getResponse = await axios.get(`${gunRelayUrl}/get`, {
            params: { soul: testIndexSoul },
            timeout: 5000
        });
        
        if (getResponse.data && getResponse.data.success) {
            console.log('✅ Test registry index retrieved successfully');
            console.log('\n📊 Registry index contents:');
            console.log(JSON.stringify(getResponse.data.data, null, 2));
            
            // Verify the entry exists
            if (getResponse.data.data && getResponse.data.data['test123:testrecord']) {
                console.log('\n✅ Test entry found in registry index!');
                console.log('Entry details:', getResponse.data.data['test123:testrecord']);
                return true;
            } else {
                console.error('\n❌ Test entry NOT found in registry index');
                console.log('Expected key: test123:testrecord');
                console.log('Available keys:', Object.keys(getResponse.data.data || {}));
                return false;
            }
        } else {
            throw new Error('Failed to retrieve test index');
        }
        
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
        }
        return false;
    }
}

async function checkExistingRegistries() {
    console.log(`\n🔍 Checking existing registry indexes on ${gunRelayUrl}\n`);
    
    const recordTypes = ['image', 'post', 'video', 'audio', 'recipe', 'workout', 'exercise'];
    
    for (const recordType of recordTypes) {
        try {
            const soul = `oip:registry:index:${recordType}`;
            const response = await axios.get(`${gunRelayUrl}/get`, {
                params: { soul },
                timeout: 5000
            });
            
            if (response.data && response.data.success && response.data.data) {
                const entries = Object.keys(response.data.data).filter(k => !k.startsWith('_'));
                console.log(`✅ ${recordType}: ${entries.length} entries`);
                if (entries.length > 0) {
                    console.log(`   Sample: ${entries.slice(0, 3).join(', ')}`);
                }
            } else {
                console.log(`❌ ${recordType}: No data found`);
            }
        } catch (error) {
            console.log(`❌ ${recordType}: Error - ${error.message}`);
        }
    }
}

// Run tests
(async () => {
    console.log('\n========================================');
    console.log('   GUN Registry Storage Test');
    console.log('========================================');
    
    // Test basic storage and retrieval
    const testPassed = await testRegistryStorage();
    
    // Check existing registries
    await checkExistingRegistries();
    
    console.log('\n========================================');
    if (testPassed) {
        console.log('✅ Registry storage is working correctly!');
    } else {
        console.log('❌ Registry storage has issues - see errors above');
    }
    console.log('========================================\n');
    
    process.exit(testPassed ? 0 : 1);
})();

