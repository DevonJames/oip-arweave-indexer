const { checkBalance, getTurboArweave } = require('./helpers/arweave');
const { getTurboArweave: getTurboArweaveFromUtils } = require('./helpers/utils');

async function debugTurboSDK() {
    console.log('=== Turbo SDK Debug Test ===\n');
    
    try {
        console.log('1. Testing Turbo SDK initialization...');
        const turbo = await getTurboArweaveFromUtils();
        console.log('✓ Turbo SDK initialized successfully');
        
        console.log('\n2. Testing balance check (simple read operation)...');
        const balance = await checkBalance();
        console.log('✓ Balance check successful:', balance);
        
        console.log('\n3. Testing getUploadCosts (this is where the error likely occurs)...');
        const costs = await turbo.getUploadCosts({ bytes: [1024] });
        console.log('✓ getUploadCosts successful:', costs);
        
        console.log('\n✅ All tests passed! The Turbo SDK is working correctly.');
        
    } catch (error) {
        console.error('\n❌ Error during testing:');
        console.error('Error message:', error.message);
        console.error('Error code:', error.code || 'N/A');
        console.error('Stack trace:', error.stack);
        
        if (error.message.includes('ERR_INVALID_URL')) {
            console.log('\n🔍 ERR_INVALID_URL diagnosis:');
            console.log('This error suggests the Turbo SDK is trying to connect to a malformed URL.');
            console.log('Possible causes:');
            console.log('- Missing environment variables');
            console.log('- Network connectivity issues in Docker');
            console.log('- Turbo SDK version compatibility issues');
            
            console.log('\nEnvironment check:');
            console.log('- NODE_ENV:', process.env.NODE_ENV || 'not set');
            console.log('- TURBO_API:', process.env.TURBO_API || 'not set');
            console.log('- TURBO_LOGIN:', process.env.TURBO_LOGIN || 'not set');
        }
    }
}

// Run the debug test
debugTurboSDK(); 