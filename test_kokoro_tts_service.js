#!/usr/bin/env node

/**
 * Kokoro TTS Service Test Script
 * Tests the Kokoro TTS service with fallback engines
 */

const axios = require('axios');
const fs = require('fs');

const TTS_SERVICE_URL = process.env.TTS_SERVICE_URL || 'http://localhost:5002';

async function testKokoroTTSService() {
    console.log('🎵 Testing Kokoro TTS Service');
    console.log('=============================');
    
    try {
        // Test 1: Health check
        console.log('\n1. Testing Kokoro TTS health endpoint...');
        try {
            const healthResponse = await axios.get(`${TTS_SERVICE_URL}/health`);
            console.log('✅ Kokoro TTS health check passed:', JSON.stringify(healthResponse.data, null, 2));
            
            if (healthResponse.data.available_engines.includes('kokoro')) {
                console.log('🎯 Kokoro engine is available and ready');
            }
            
            console.log(`Available engines: ${healthResponse.data.available_engines.join(', ')}`);
            
        } catch (error) {
            console.log('❌ Kokoro TTS health check failed:', error.message);
            return;
        }
        
        // Test 2: Engines endpoint
        console.log('\n2. Testing engines endpoint...');
        try {
            const enginesResponse = await axios.get(`${TTS_SERVICE_URL}/engines`);
            console.log('✅ Engines endpoint passed:', JSON.stringify(enginesResponse.data, null, 2));
        } catch (error) {
            console.log('❌ Engines endpoint failed:', error.message);
        }
        
        // Test 3: Voices endpoint
        console.log('\n3. Testing voices endpoint...');
        try {
            const voicesResponse = await axios.get(`${TTS_SERVICE_URL}/voices`);
            console.log('✅ Voices endpoint passed:', JSON.stringify(voicesResponse.data, null, 2));
        } catch (error) {
            console.log('❌ Voices endpoint failed:', error.message);
        }
        
        // Test 4: Basic synthesis with Kokoro
        console.log('\n4. Testing Kokoro TTS synthesis...');
        try {
            const synthesisResponse = await axios.post(
                `${TTS_SERVICE_URL}/synthesize`,
                {
                    text: "Hello, this is a test of the Kokoro TTS engine. It should produce high-quality, natural-sounding speech.",
                    voice: "en_female_01",
                    engine: "kokoro",
                    language: "en"
                },
                {
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                }
            );
            
            console.log('✅ Kokoro TTS synthesis test passed:');
            console.log('  Text:', synthesisResponse.data.text);
            console.log('  Voice:', synthesisResponse.data.voice);
            console.log('  Engine:', synthesisResponse.data.engine);
            console.log('  Processing Time:', synthesisResponse.data.processing_time_ms + 'ms');
            console.log('  Audio Duration:', synthesisResponse.data.audio_duration_ms + 'ms');
            console.log('  Sample Rate:', synthesisResponse.data.sample_rate + 'Hz');
            console.log('  Cached:', synthesisResponse.data.cached);
            
            // Save audio file for testing
            if (synthesisResponse.data.audio_data) {
                const audioBuffer = Buffer.from(synthesisResponse.data.audio_data, 'base64');
                fs.writeFileSync('test_kokoro_output.wav', audioBuffer);
                console.log('  💾 Audio saved as test_kokoro_output.wav');
            }
            
        } catch (error) {
            console.log('❌ Kokoro TTS synthesis test failed:', error.message);
            if (error.response) {
                console.log('Response data:', error.response.data);
            }
        }
        
        // Test 5: Fallback engine test (Coqui)
        console.log('\n5. Testing fallback engine (Coqui)...');
        try {
            const coquiResponse = await axios.post(
                `${TTS_SERVICE_URL}/synthesize`,
                {
                    text: "This is a test of the Coqui TTS fallback engine.",
                    voice: "ljspeech",
                    engine: "coqui",
                    language: "en"
                },
                {
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                }
            );
            
            console.log('✅ Coqui fallback test passed:');
            console.log('  Engine:', coquiResponse.data.engine);
            console.log('  Processing Time:', coquiResponse.data.processing_time_ms + 'ms');
            
        } catch (error) {
            console.log('❌ Coqui fallback test failed:', error.message);
        }
        
        // Test 6: Fast engine test (Piper)
        console.log('\n6. Testing fast engine (Piper)...');
        try {
            const piperResponse = await axios.post(
                `${TTS_SERVICE_URL}/synthesize`,
                {
                    text: "This is a test of the fast Piper TTS engine.",
                    voice: "en_US-lessac-medium",
                    engine: "piper",
                    language: "en"
                },
                {
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                }
            );
            
            console.log('✅ Piper fast engine test passed:');
            console.log('  Engine:', piperResponse.data.engine);
            console.log('  Processing Time:', piperResponse.data.processing_time_ms + 'ms');
            
        } catch (error) {
            console.log('❌ Piper fast engine test failed:', error.message);
        }
        
        // Test 7: File synthesis
        console.log('\n7. Testing file synthesis...');
        try {
            const fileResponse = await axios.post(
                `${TTS_SERVICE_URL}/synthesize_to_file`,
                {
                    text: "This audio will be returned as a file download.",
                    voice: "en_female_01",
                    engine: "kokoro"
                },
                {
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    responseType: 'arraybuffer',
                    timeout: 30000
                }
            );
            
            console.log('✅ File synthesis test passed:');
            console.log('  Content-Type:', fileResponse.headers['content-type']);
            console.log('  Engine:', fileResponse.headers['x-engine']);
            console.log('  Processing Time:', fileResponse.headers['x-processing-time'] + 'ms');
            
            // Save file
            fs.writeFileSync('test_kokoro_file.wav', fileResponse.data);
            console.log('  💾 File saved as test_kokoro_file.wav');
            
        } catch (error) {
            console.log('❌ File synthesis test failed:', error.message);
        }
        
        // Test 8: Automatic fallback test
        console.log('\n8. Testing automatic fallback (no engine specified)...');
        try {
            const fallbackResponse = await axios.post(
                `${TTS_SERVICE_URL}/synthesize`,
                {
                    text: "This should automatically use the best available engine.",
                    voice: "en_male_01",
                    language: "en"
                    // No engine specified - should use primary with fallback
                },
                {
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                }
            );
            
            console.log('✅ Automatic fallback test passed:');
            console.log('  Selected Engine:', fallbackResponse.data.engine);
            console.log('  Processing Time:', fallbackResponse.data.processing_time_ms + 'ms');
            
        } catch (error) {
            console.log('❌ Automatic fallback test failed:', error.message);
        }
        
        // Test 9: Cache test (repeat previous request)
        console.log('\n9. Testing cache functionality...');
        try {
            const cacheResponse = await axios.post(
                `${TTS_SERVICE_URL}/synthesize`,
                {
                    text: "This should automatically use the best available engine.",
                    voice: "en_male_01",
                    language: "en"
                },
                {
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                }
            );
            
            console.log('✅ Cache test passed:');
            console.log('  Cached:', cacheResponse.data.cached);
            console.log('  Processing Time:', cacheResponse.data.processing_time_ms + 'ms');
            
            if (cacheResponse.data.cached) {
                console.log('  🎯 Cache is working correctly!');
            }
            
        } catch (error) {
            console.log('❌ Cache test failed:', error.message);
        }
        
        console.log('\n🎉 Kokoro TTS service testing completed!');
        
    } catch (error) {
        console.error('💥 Test suite failed:', error.message);
        process.exit(1);
    }
}

async function runPerformanceTest() {
    console.log('\n⚡ Performance Testing');
    console.log('=====================');
    
    const testTexts = [
        "Short test.",
        "This is a medium length sentence for testing TTS performance.",
        "This is a much longer sentence that contains more words and should take longer to synthesize, allowing us to test the performance characteristics of the different TTS engines under various load conditions."
    ];
    
    for (const text of testTexts) {
        console.log(`\nTesting: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
        
        const engines = ['kokoro', 'coqui', 'piper'];
        
        for (const engine of engines) {
            try {
                const start = Date.now();
                const response = await axios.post(
                    `${TTS_SERVICE_URL}/synthesize`,
                    {
                        text: text,
                        engine: engine,
                        voice: engine === 'kokoro' ? 'en_female_01' : 
                               engine === 'coqui' ? 'ljspeech' : 'en_US-lessac-medium'
                    },
                    { timeout: 30000 }
                );
                const end = Date.now();
                
                console.log(`  ${engine}: ${response.data.processing_time_ms.toFixed(1)}ms (${(end-start)}ms total)`);
                
            } catch (error) {
                console.log(`  ${engine}: FAILED - ${error.message}`);
            }
        }
    }
}

async function runAllTests() {
    console.log('🚀 Starting Kokoro TTS Pipeline Tests');
    console.log('=====================================');
    
    await testKokoroTTSService();
    await runPerformanceTest();
    
    console.log('\n✅ All Kokoro TTS pipeline tests completed!');
}

// Run tests
if (require.main === module) {
    runAllTests().catch(error => {
        console.error('💥 Test runner failed:', error);
        process.exit(1);
    });
}

module.exports = { testKokoroTTSService, runPerformanceTest };
