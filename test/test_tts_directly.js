const axios = require('axios');

const TTS_SERVICE_URL = process.env.TTS_SERVICE_URL || 'http://localhost:5002';

async function testTTSDirectly() {
    console.log('🎤 Testing TTS Service Directly\n');
    
    const testCases = [
        {
            name: "Short text",
            text: "Hello, this is a test.",
            voice: "chatterbox"
        },
        {
            name: "Medium text", 
            text: "This is a longer test to see if the TTS service can handle more text. It should return audio data with a reasonable size.",
            voice: "chatterbox"
        },
        {
            name: "Long text (typical RAG response)",
            text: "Based on the latest information available, Iran continues to be a significant topic in international relations. The nuclear program remains a key concern for global security, with various administrations taking different approaches to diplomacy and sanctions. Recent developments suggest ongoing negotiations and diplomatic efforts to address these concerns.",
            voice: "chatterbox"
        }
    ];

    for (const testCase of testCases) {
        console.log(`\n=== Testing: ${testCase.name} ===`);
        console.log(`Text length: ${testCase.text.length} characters`);
        console.log(`Text: "${testCase.text.substring(0, 100)}${testCase.text.length > 100 ? '...' : ''}"`);
        
        try {
            console.log(`Calling TTS service at: ${TTS_SERVICE_URL}/synthesize`);
            
            const response = await axios.post(
                `${TTS_SERVICE_URL}/synthesize`,
                {
                    text: testCase.text,
                    voice: testCase.voice,
                    engine: 'chatterbox'
                },
                {
                    timeout: 30000,
                    responseType: 'arraybuffer'
                }
            );
            
            console.log(`✅ Success!`);
            console.log(`Response size: ${response.data.length} bytes`);
            console.log(`Content-Type: ${response.headers['content-type']}`);
            console.log(`Status: ${response.status}`);
            
            if (response.data.length === 0) {
                console.log(`⚠️  WARNING: Response is 0 bytes!`);
            }
            
        } catch (error) {
            console.log(`❌ Failed!`);
            console.log(`Error: ${error.message}`);
            if (error.response) {
                console.log(`Status: ${error.response.status}`);
                console.log(`Response: ${error.response.data}`);
            }
            if (error.code) {
                console.log(`Code: ${error.code}`);
            }
        }
    }
}

async function testTTSHealth() {
    console.log('\n=== Testing TTS Health Endpoint ===');
    
    try {
        const response = await axios.get(`${TTS_SERVICE_URL}/health`, {
            timeout: 10000
        });
        
        console.log(`✅ TTS Health OK`);
        console.log(`Status: ${response.status}`);
        console.log(`Response:`, JSON.stringify(response.data, null, 2));
        
    } catch (error) {
        console.log(`❌ TTS Health Failed`);
        console.log(`Error: ${error.message}`);
    }
}

async function testTTSVoices() {
    console.log('\n=== Testing TTS Voices Endpoint ===');
    
    try {
        const response = await axios.get(`${TTS_SERVICE_URL}/voices`, {
            timeout: 10000
        });
        
        console.log(`✅ TTS Voices OK`);
        console.log(`Available voices:`, JSON.stringify(response.data, null, 2));
        
    } catch (error) {
        console.log(`❌ TTS Voices Failed`);
        console.log(`Error: ${error.message}`);
    }
}

async function main() {
    console.log(`TTS Service URL: ${TTS_SERVICE_URL}`);
    
    await testTTSHealth();
    await testTTSVoices();
    await testTTSDirectly();
    
    console.log('\n=== Summary ===');
    console.log('If you see 0 byte responses:');
    console.log('1. Check TTS service logs: docker logs <tts-container-name>');
    console.log('2. Verify the TTS service is properly configured');
    console.log('3. Check if the service has enough resources (GPU memory, etc.)');
    console.log('4. Try restarting the TTS service container');
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { testTTSDirectly, testTTSHealth, testTTSVoices }; 