#!/usr/bin/env node

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Configuration
const SERVICES = {
    STT: process.env.STT_SERVICE_URL || 'http://localhost:8003',
    TTS: process.env.TTS_SERVICE_URL || 'http://localhost:5002',
    VOICE_API: process.env.VOICE_API_URL || 'http://localhost:3005/api/voice',
    MAIN_API: process.env.MAIN_API_URL || 'http://localhost:3005/api'
};

// Test configuration with proper timeouts
const TEST_CONFIG = {
    timeout: 15000, // 15 second timeout to match backend
    retries: 2,
    healthCheckInterval: 1000,
    maxHealthChecks: 5
};

console.log('🎤 Voice System Integration Test');
console.log('================================');
console.log('Services Configuration:');
Object.entries(SERVICES).forEach(([name, url]) => {
    console.log(`  ${name}: ${url}`);
});
console.log('');

async function testWithTimeout(testFn, testName, timeoutMs = TEST_CONFIG.timeout) {
    console.log(`🧪 Testing: ${testName}`);
    
    try {
        const result = await Promise.race([
            testFn(),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Test timeout')), timeoutMs)
            )
        ]);
        
        console.log(`✅ ${testName}: PASSED`);
        return result;
    } catch (error) {
        console.log(`❌ ${testName}: FAILED - ${error.message}`);
        return null;
    }
}

async function healthCheck(serviceName, url) {
    try {
        const response = await axios.get(`${url}/health`, {
            timeout: 5000,
            headers: { 'Connection': 'close' }
        });
        
        console.log(`✅ ${serviceName} Health: OK (${response.status})`);
        return response.data;
    } catch (error) {
        console.log(`❌ ${serviceName} Health: FAILED - ${error.message}`);
        return null;
    }
}

async function testTTSService() {
    const testText = "Hello, this is a test of the text to speech system.";
    
    try {
        const response = await axios.post(
            `${SERVICES.TTS}/synthesize`,
            {
                text: testText,
                voice: "chatterbox",
                engine: "chatterbox"
            },
            {
                timeout: TEST_CONFIG.timeout,
                responseType: 'arraybuffer',
                headers: { 'Connection': 'close' }
            }
        );
        
        const audioSize = response.data.length;
        console.log(`  ✅ TTS Synthesis: ${audioSize} bytes generated`);
        console.log(`  ✅ Engine used: ${response.headers['x-engine-used'] || 'unknown'}`);
        
        return { audioSize, engine: response.headers['x-engine-used'] };
    } catch (error) {
        throw new Error(`TTS synthesis failed: ${error.message}`);
    }
}

async function testSTTService() {
    try {
        // Check if we have a test audio file
        const testAudioPath = path.join(__dirname, 'test-audio.wav');
        if (!fs.existsSync(testAudioPath)) {
            console.log(`  ⚠️  No test audio file found at ${testAudioPath}, skipping STT test`);
            return { skipped: true };
        }
        
        const audioBuffer = fs.readFileSync(testAudioPath);
        const formData = new FormData();
        formData.append('file', new Blob([audioBuffer]), 'test.wav');
        
        const response = await axios.post(
            `${SERVICES.STT}/transcribe_file`,
            formData,
            {
                timeout: TEST_CONFIG.timeout,
                headers: { 
                    'Content-Type': 'multipart/form-data',
                    'Connection': 'close'
                }
            }
        );
        
        console.log(`  ✅ STT Transcription: "${response.data.text}"`);
        return { text: response.data.text };
    } catch (error) {
        throw new Error(`STT transcription failed: ${error.message}`);
    }
}

async function testVoiceAPI() {
    const testText = "What are the latest news about technology?";
    
    try {
        const response = await axios.post(
            `${SERVICES.VOICE_API}/chat`,
            {
                text: testText,
                model: 'llama3.2:3b',
                voice_id: 'female_1',
                return_audio: true,
                speed: 1.0
            },
            {
                timeout: TEST_CONFIG.timeout,
                headers: { 
                    'Content-Type': 'application/json',
                    'Connection': 'close'
                }
            }
        );
        
        console.log(`  ✅ Voice Chat Response: "${response.data.response_text?.substring(0, 100)}..."`);
        console.log(`  ✅ Has Audio: ${response.data.has_audio}`);
        console.log(`  ✅ Sources Found: ${response.data.sources?.length || 0}`);
        console.log(`  ✅ Applied Filters: ${JSON.stringify(response.data.applied_filters)}`);
        
        return response.data;
    } catch (error) {
        throw new Error(`Voice API failed: ${error.message}`);
    }
}

async function testConnectionStability() {
    console.log(`🔄 Testing connection stability (${TEST_CONFIG.retries} requests)...`);
    
    const results = [];
    for (let i = 1; i <= TEST_CONFIG.retries; i++) {
        try {
            const startTime = Date.now();
            
            const response = await axios.post(
                `${SERVICES.TTS}/synthesize`,
                {
                    text: `Connection stability test number ${i}`,
                    voice: "chatterbox",
                    engine: "chatterbox"
                },
                {
                    timeout: TEST_CONFIG.timeout,
                    responseType: 'arraybuffer',
                    headers: { 'Connection': 'close' }
                }
            );
            
            const duration = Date.now() - startTime;
            const audioSize = response.data.length;
            
            console.log(`  ✅ Request ${i}: ${duration}ms, ${audioSize} bytes`);
            results.push({ success: true, duration, audioSize });
            
            // Small delay between requests
            await new Promise(resolve => setTimeout(resolve, 1000));
            
        } catch (error) {
            console.log(`  ❌ Request ${i}: FAILED - ${error.message}`);
            results.push({ success: false, error: error.message });
        }
    }
    
    const successRate = (results.filter(r => r.success).length / results.length) * 100;
    console.log(`  📊 Success Rate: ${successRate}%`);
    
    return results;
}

async function waitForService(serviceName, url, maxAttempts = TEST_CONFIG.maxHealthChecks) {
    console.log(`⏳ Waiting for ${serviceName} to be ready...`);
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await axios.get(`${url}/health`, {
                timeout: 5000,
                headers: { 'Connection': 'close' }
            });
            
            console.log(`✅ ${serviceName} is ready`);
            return true;
        } catch (error) {
            console.log(`  Attempt ${attempt}/${maxAttempts}: ${serviceName} not ready (${error.message})`);
            
            if (attempt < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, TEST_CONFIG.healthCheckInterval));
            }
        }
    }
    
    console.log(`❌ ${serviceName} failed to become ready after ${maxAttempts} attempts`);
    return false;
}

async function main() {
    console.log('🚀 Starting Voice System Tests...\n');
    
    // Step 1: Wait for services to be ready
    console.log('📡 Checking service availability...');
    const serviceChecks = await Promise.all([
        waitForService('TTS Service', SERVICES.TTS),
        waitForService('STT Service', SERVICES.STT)
    ]);
    
    if (!serviceChecks.every(check => check)) {
        console.log('\n❌ Some services are not available. Please check your docker containers.');
        console.log('   Run: docker ps');
        console.log('   Check logs: docker logs <container-name>');
        process.exit(1);
    }
    
    console.log('\n🔍 Running health checks...');
    await Promise.all([
        healthCheck('TTS Service', SERVICES.TTS),
        healthCheck('STT Service', SERVICES.STT)
    ]);
    
    console.log('\n🧪 Running functional tests...');
    
    // Test individual services
    await testWithTimeout(testTTSService, 'TTS Service Synthesis');
    await testWithTimeout(testSTTService, 'STT Service Transcription');
    await testWithTimeout(testVoiceAPI, 'Complete Voice API Pipeline');
    
    // Test connection stability
    console.log('\n🔗 Testing connection stability...');
    await testWithTimeout(() => testConnectionStability(), 'Connection Stability', 60000);
    
    console.log('\n📊 Test Summary:');
    console.log('================');
    console.log('✅ Voice system tests completed');
    console.log('');
    console.log('🔧 If you see timeouts or connection errors:');
    console.log('   1. Check that all Docker containers are running');
    console.log('   2. Restart services: docker-compose restart');
    console.log('   3. Check service logs for errors');
    console.log('   4. Verify network connectivity between containers');
    console.log('');
    console.log('🎯 For production deployment:');
    console.log('   1. Services should consistently respond within 5-10 seconds');
    console.log('   2. Connection stability should be 100%');
    console.log('   3. Audio generation should be consistent (>1000 bytes)');
}

// Error handling for unhandled promises
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Run the tests
if (require.main === module) {
    main().catch(error => {
        console.error('Test suite failed:', error);
        process.exit(1);
    });
}

module.exports = {
    testTTSService,
    testSTTService,
    testVoiceAPI,
    testConnectionStability,
    healthCheck
}; 