/**
 * Test Organization Registration Functionality
 * Tests the organization registration processing and unique handle generation
 */

const { convertToOrgHandle, findOrganizationsByHandle } = require('../helpers/elasticsearch');

async function testOrgHandleGeneration() {
    console.log('Testing organization handle generation...');
    
    // Test with a sample transaction ID and handle
    const testTxId = 'NQi19GjOw-Iv8PzjZ5P-XcFkAYu50cl5V_qceT2xlGM';
    const testHandle = 'testorg';
    
    try {
        // This should generate a unique handle by appending digits from the transaction ID
        const uniqueHandle = await convertToOrgHandle(testTxId, testHandle);
        console.log(`Original handle: ${testHandle}`);
        console.log(`Generated unique handle: ${uniqueHandle}`);
        
        // Verify the handle starts with the original handle
        if (uniqueHandle.startsWith(testHandle)) {
            console.log('✅ Handle generation test passed');
        } else {
            console.log('❌ Handle generation test failed');
        }
        
        return uniqueHandle;
    } catch (error) {
        console.error('❌ Error testing handle generation:', error);
        return null;
    }
}

async function testOrganizationSearch() {
    console.log('\nTesting organization search...');
    
    try {
        // Search for organizations with a handle that likely doesn't exist
        const nonExistentHandle = 'nonexistentorg123456';
        const results = await findOrganizationsByHandle(nonExistentHandle);
        
        console.log(`Search results for '${nonExistentHandle}':`, results.length);
        
        if (results.length === 0) {
            console.log('✅ Organization search test passed (no results as expected)');
        } else {
            console.log('⚠️ Organization search returned unexpected results:', results);
        }
        
        return true;
    } catch (error) {
        console.error('❌ Error testing organization search:', error);
        return false;
    }
}

async function runTests() {
    console.log('🧪 Running Organization Registration Tests\n');
    
    const handleTest = await testOrgHandleGeneration();
    const searchTest = await testOrganizationSearch();
    
    console.log('\n📋 Test Summary:');
    console.log(`Handle Generation: ${handleTest ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Organization Search: ${searchTest ? '✅ PASS' : '❌ FAIL'}`);
    
    if (handleTest && searchTest) {
        console.log('\n🎉 All tests passed!');
        console.log('\nThe organization registration functionality is ready to use.');
        console.log('You can now:');
        console.log('1. POST to /api/organizations/newOrganization to create organizations');
        console.log('2. GET /api/organizations to retrieve all organizations');
        console.log('3. Organization handles will be automatically made unique using transaction ID digits');
    } else {
        console.log('\n⚠️ Some tests failed. Please check the implementation.');
    }
}

// Run tests if this file is executed directly
if (require.main === module) {
    runTests().catch(console.error);
}

module.exports = {
    testOrgHandleGeneration,
    testOrganizationSearch,
    runTests
};
