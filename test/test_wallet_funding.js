const { upfrontFunding, lazyFunding, checkBalance } = require('./helpers/arweave');

async function testWalletFunding() {
    console.log('Testing wallet funding functions...\n');
    
    try {
        // Test balance check first
        console.log('1. Testing balance check...');
        const balance = await checkBalance();
        console.log('Balance check successful:', balance);
        console.log('');
        
        // Test upfront funding with a small amount (0.0001 AR)
        console.log('2. Testing upfront funding with 0.0001 AR...');
        const upfrontResult = await upfrontFunding(0.0001, 1.0);
        console.log('Upfront funding successful:', upfrontResult);
        console.log('');
        
        // Test lazy funding for a 1KB file
        console.log('3. Testing lazy funding for 1KB file...');
        const lazyResult = await lazyFunding(1024, 1.0);
        console.log('Lazy funding successful:', lazyResult);
        console.log('');
        
        console.log('All tests completed successfully! ✅');
        
    } catch (error) {
        console.error('Test failed:', error.message);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    }
}

// Run the test
testWalletFunding(); 