const axios = require('axios');

// Service URLs from environment or defaults
const TTS_SERVICE_URL = process.env.TTS_SERVICE_URL || 'http://tts-service:8005';
const STT_SERVICE_URL = process.env.STT_SERVICE_URL || 'http://localhost:8003';
const TEXT_GENERATOR_URL = process.env.TEXT_GENERATOR_URL || 'http://localhost:8002';

async function checkService(name, url, endpoint = '/health') {
    try {
        console.log(`\n=== Checking ${name} ===`);
        console.log(`URL: ${url}${endpoint}`);
        
        const response = await axios.get(`${url}${endpoint}`, {
            timeout: 10000
        });
        
        console.log(`✅ ${name} is healthy`);
        console.log(`Status: ${response.status}`);
        console.log(`Response:`, JSON.stringify(response.data, null, 2));
        
        return true;
    } catch (error) {
        console.log(`❌ ${name} is not responding`);
        if (error.response) {
            console.log(`HTTP Status: ${error.response.status}`);
            console.log(`Response:`, error.response.data);
        } else if (error.request) {
            console.log(`Network Error: Could not connect to ${url}`);
            console.log(`Error: ${error.message}`);
        } else {
            console.log(`Error: ${error.message}`);
        }
        
        return false;
    }
}

async function checkTTSVoices() {
    try {
        console.log(`\n=== Checking TTS Voices ===`);
        const response = await axios.get(`${TTS_SERVICE_URL}/voices`, {
            timeout: 10000
        });
        
        console.log(`✅ TTS Voices endpoint working`);
        console.log(`Available voices:`, JSON.stringify(response.data, null, 2));
        
        return response.data;
    } catch (error) {
        console.log(`❌ TTS Voices endpoint failed`);
        console.log(`Error: ${error.message}`);
        return null;
    }
}

async function testTTSSynthesis() {
    try {
        console.log(`\n=== Testing TTS Synthesis ===`);
        const response = await axios.post(
            `${TTS_SERVICE_URL}/synthesize`,
            {
                text: "Hello, this is a test of the text to speech system.",
                voice: "chatterbox",
                engine: "chatterbox"
            },
            {
                timeout: 30000,
                responseType: 'arraybuffer'
            }
        );
        
        console.log(`✅ TTS Synthesis working`);
        console.log(`Audio size: ${response.data.length} bytes`);
        console.log(`Content-Type: ${response.headers['content-type']}`);
        console.log(`Engine used: ${response.headers['x-engine-used'] || 'unknown'}`);
        
        return true;
    } catch (error) {
        console.log(`❌ TTS Synthesis failed`);
        if (error.response) {
            console.log(`HTTP Status: ${error.response.status}`);
        }
        console.log(`Error: ${error.message}`);
        return false;
    }
}

async function main() {
    console.log('🔍 OIP Voice Services Health Check');
    console.log('=====================================');
    
    // Check environment variables
    console.log('\n=== Environment Configuration ===');
    console.log(`TTS_SERVICE_URL: ${TTS_SERVICE_URL}`);
    console.log(`STT_SERVICE_URL: ${STT_SERVICE_URL}`);
    console.log(`TEXT_GENERATOR_URL: ${TEXT_GENERATOR_URL}`);
    
    // Check each service
    const services = [
        { name: 'TTS Service', url: TTS_SERVICE_URL },
        { name: 'STT Service', url: STT_SERVICE_URL },
        { name: 'Text Generator', url: TEXT_GENERATOR_URL }
    ];
    
    const results = {};
    
    for (const service of services) {
        results[service.name] = await checkService(service.name, service.url);
    }
    
    // Additional TTS-specific checks
    if (results['TTS Service']) {
        await checkTTSVoices();
        await testTTSSynthesis();
    }
    
    // Summary
    console.log('\n=== Summary ===');
    for (const [name, status] of Object.entries(results)) {
        console.log(`${status ? '✅' : '❌'} ${name}: ${status ? 'Working' : 'Failed'}`);
    }
    
    const allHealthy = Object.values(results).every(status => status);
    
    if (allHealthy) {
        console.log('\n🎉 All services are healthy!');
    } else {
        console.log('\n⚠️  Some services are not responding. Check the logs above for details.');
        console.log('\nTroubleshooting tips:');
        console.log('1. Make sure Docker containers are running: docker ps');
        console.log('2. Check Docker logs: docker logs <container_name>');
        console.log('3. Verify the correct docker-compose profile is used');
        console.log('4. Check if services are bound to the correct ports');
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { checkService, checkTTSVoices, testTTSSynthesis }; 