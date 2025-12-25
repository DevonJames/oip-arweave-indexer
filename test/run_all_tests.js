console.log('🧪 Running All Voice Assistant Tests\n');

async function runAllTests() {
    console.log('='.repeat(60));
    console.log('VOICE ASSISTANT DEBUGGING SUITE');
    console.log('='.repeat(60));

    try {
        // Test 1: Keyword Extraction
        console.log('\n1️⃣ TESTING KEYWORD EXTRACTION');
        console.log('-'.repeat(40));
        const { testKeywordExtraction } = require('./test_keyword_extraction');
        testKeywordExtraction();

    } catch (error) {
        console.log('❌ Keyword extraction test failed:', error.message);
    }

    try {
        // Test 2: Service Health
        console.log('\n2️⃣ TESTING SERVICE HEALTH');
        console.log('-'.repeat(40));
        const { checkService, checkTTSVoices, testTTSSynthesis } = require('./check_services');
        
        // Check each service
        await checkService('TTS Service', process.env.TTS_SERVICE_URL || 'http://tts-service:8005');
        await checkService('STT Service', process.env.STT_SERVICE_URL || 'http://localhost:8003');
        await checkService('Text Generator', process.env.TEXT_GENERATOR_URL || 'http://localhost:8002');
        
        // Check TTS voices
        await checkTTSVoices();
        await testTTSSynthesis();

    } catch (error) {
        console.log('❌ Service health tests failed:', error.message);
    }

    try {
        // Test 3: TTS Direct Testing
        console.log('\n3️⃣ TESTING TTS DIRECTLY');
        console.log('-'.repeat(40));
        const { testTTSDirectly, testTTSHealth, testTTSVoices } = require('./test_tts_directly');
        
        await testTTSHealth();
        await testTTSVoices();
        await testTTSDirectly();

    } catch (error) {
        console.log('❌ TTS direct tests failed:', error.message);
    }

    try {
        // Test 4: Iran Search Testing
        console.log('\n4️⃣ TESTING IRAN SEARCH');
        console.log('-'.repeat(40));
        const { testIranSearch, testDirectElasticsearch, testRecordTypeAnalysis } = require('./test_iran_search');
        
        await testRecordTypeAnalysis();
        await testDirectElasticsearch();
        await testIranSearch();

    } catch (error) {
        console.log('❌ Iran search tests failed:', error.message);
    }

    // Final Summary
    console.log('\n' + '='.repeat(60));
    console.log('🏁 ALL TESTS COMPLETED');
    console.log('='.repeat(60));
    console.log('');
    console.log('📋 NEXT STEPS:');
    console.log('1. Check the test results above for any failures');
    console.log('2. For TTS issues: Look for 0-byte responses or timeouts');
    console.log('3. For search issues: Verify keyword extraction is working');
    console.log('4. Try the voice assistant with "What\'s the latest on Iran?"');
    console.log('5. Check Docker logs if services are failing:');
    console.log('   docker logs <container-name>');
    console.log('');
    console.log('🔧 INDIVIDUAL TEST COMMANDS:');
    console.log('   node test_keyword_extraction.js');
    console.log('   node check_services.js');  
    console.log('   node test_tts_directly.js');
    console.log('   node test_iran_search.js');
}

if (require.main === module) {
    runAllTests().catch(console.error);
}

module.exports = { runAllTests }; 