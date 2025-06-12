const publisherManager = require('../helpers/publisher-manager');
require('dotenv').config();

async function testPublisher() {
    console.log('Testing Publisher Manager...\n');
    
    // Test data
    const testData = {
        message: "Test message from OIPArweave",
        timestamp: new Date().toISOString(),
        test: true
    };
    
    const tags = [
        { name: 'Content-Type', value: 'application/json' },
        { name: 'App-Name', value: 'OIPArweave-Test' }
    ];
    
    try {
        // Test 1: Get balance for Arweave
        console.log('1. Testing Arweave balance check...');
        try {
            const arweaveBalance = await publisherManager.getBalance('arweave');
            console.log('Arweave balance:', arweaveBalance);
        } catch (error) {
            console.error('Error getting Arweave balance:', error.message);
        }
        
        // Test 2: Get balance for Irys
        console.log('\n2. Testing Irys balance check...');
        try {
            const irysBalance = await publisherManager.getBalance('irys');
            console.log('Irys balance:', irysBalance);
        } catch (error) {
            console.error('Error getting Irys balance:', error.message);
        }
        
        // Test 3: Get price estimate
        console.log('\n3. Testing price estimation...');
        const dataSize = Buffer.from(JSON.stringify(testData)).length;
        
        try {
            const arweavePrice = await publisherManager.getPrice(dataSize, 'arweave');
            console.log(`Arweave price for ${dataSize} bytes:`, arweavePrice);
        } catch (error) {
            console.error('Error getting Arweave price:', error.message);
        }
        
        try {
            const irysPrice = await publisherManager.getPrice(dataSize, 'irys');
            console.log(`Irys price for ${dataSize} bytes:`, irysPrice);
        } catch (error) {
            console.error('Error getting Irys price:', error.message);
        }
        
        // Test 4: Publish to Arweave (only if explicitly requested)
        if (process.argv.includes('--publish-arweave')) {
            console.log('\n4. Testing publish to Arweave...');
            try {
                const arweaveResult = await publisherManager.publish(
                    JSON.stringify(testData),
                    {
                        blockchain: 'arweave',
                        tags: tags,
                        waitForConfirmation: false
                    }
                );
                console.log('Published to Arweave:', arweaveResult);
            } catch (error) {
                console.error('Error publishing to Arweave:', error.message);
            }
        } else {
            console.log('\n4. Skipping Arweave publish test (use --publish-arweave to test)');
        }
        
        // Test 5: Publish to Irys (only if explicitly requested)
        if (process.argv.includes('--publish-irys')) {
            console.log('\n5. Testing publish to Irys...');
            try {
                const irysResult = await publisherManager.publish(
                    JSON.stringify(testData),
                    {
                        blockchain: 'irys',
                        tags: tags
                    }
                );
                console.log('Published to Irys:', irysResult);
            } catch (error) {
                console.error('Error publishing to Irys:', error.message);
            }
        } else {
            console.log('\n5. Skipping Irys publish test (use --publish-irys to test)');
        }
        
        console.log('\n✅ Test completed!');
        
    } catch (error) {
        console.error('\n❌ Test failed:', error);
    }
}

// Run the test
testPublisher(); 