#!/usr/bin/env node

/**
 * Enhanced STT Service Test Script
 * Tests the enhanced STT service with VAD and Smart Turn integration
 */

const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

const STT_SERVICE_URL = process.env.STT_SERVICE_URL || 'http://localhost:8003';
const MLX_SERVICE_URL = process.env.MLX_SERVICE_URL || 'http://localhost:8013';

function createMockWavFile() {
    /**
     * Create a mock WAV file with sine wave audio
     */
    const sampleRate = 16000;
    const duration = 3; // 3 seconds
    const frequency = 440; // A4 note
    const samples = sampleRate * duration;
    
    // WAV header (44 bytes)
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + samples * 2, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // PCM header size
    header.writeUInt16LE(1, 20);  // PCM format
    header.writeUInt16LE(1, 22);  // Mono
    header.writeUInt32LE(sampleRate, 24); // Sample rate
    header.writeUInt32LE(sampleRate * 2, 28); // Byte rate
    header.writeUInt16LE(2, 32);  // Block align
    header.writeUInt16LE(16, 34); // Bits per sample
    header.write('data', 36);
    header.writeUInt32LE(samples * 2, 40);
    
    // Audio data
    const audioData = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) {
        const sample = Math.sin(2 * Math.PI * frequency * i / sampleRate) * 16000;
        audioData.writeInt16LE(sample, i * 2);
    }
    
    return Buffer.concat([header, audioData]);
}

async function testEnhancedSTTService() {
    console.log('🧪 Testing Enhanced STT Service');
    console.log('===============================');
    
    try {
        // Test 1: Health check
        console.log('\n1. Testing enhanced STT health endpoint...');
        try {
            const healthResponse = await axios.get(`${STT_SERVICE_URL}/health`);
            console.log('✅ Enhanced STT health check passed:', JSON.stringify(healthResponse.data, null, 2));
            
            if (healthResponse.data.vad_enabled) {
                console.log('🎯 VAD is enabled and ready');
            }
            if (healthResponse.data.smart_turn_enabled) {
                console.log('🎯 Smart Turn integration is enabled');
            }
            
        } catch (error) {
            console.log('❌ Enhanced STT health check failed:', error.message);
            return;
        }
        
        // Test 2: Models endpoint
        console.log('\n2. Testing models endpoint...');
        try {
            const modelsResponse = await axios.get(`${STT_SERVICE_URL}/models`);
            console.log('✅ Models endpoint passed:', JSON.stringify(modelsResponse.data, null, 2));
        } catch (error) {
            console.log('❌ Models endpoint failed:', error.message);
        }
        
        // Test 3: Enhanced transcription with file upload
        console.log('\n3. Testing enhanced transcription with file upload...');
        try {
            const mockAudio = createMockWavFile();
            
            const formData = new FormData();
            formData.append('file', mockAudio, {
                filename: 'test.wav',
                contentType: 'audio/wav'
            });
            formData.append('use_vad', 'true');
            formData.append('use_smart_turn', 'true');
            
            const transcriptionResponse = await axios.post(
                `${STT_SERVICE_URL}/transcribe_file`,
                formData,
                {
                    headers: {
                        ...formData.getHeaders()
                    },
                    timeout: 30000
                }
            );
            
            console.log('✅ Enhanced transcription test passed:');
            console.log('  Text:', transcriptionResponse.data.text);
            console.log('  Language:', transcriptionResponse.data.language);
            console.log('  Duration:', transcriptionResponse.data.duration);
            console.log('  VAD Used:', transcriptionResponse.data.vad_used);
            console.log('  Processing Time:', transcriptionResponse.data.processing_time_ms + 'ms');
            
            if (transcriptionResponse.data.vad_speech_ratio) {
                console.log('  Speech Ratio:', (transcriptionResponse.data.vad_speech_ratio * 100).toFixed(1) + '%');
            }
            
            if (transcriptionResponse.data.smart_turn_prediction) {
                console.log('  Smart Turn:', transcriptionResponse.data.smart_turn_prediction);
            }
            
        } catch (error) {
            console.log('❌ Enhanced transcription test failed:', error.message);
            if (error.response) {
                console.log('Response data:', error.response.data);
            }
        }
        
        // Test 4: Base64 transcription
        console.log('\n4. Testing base64 transcription...');
        try {
            const mockAudio = createMockWavFile();
            const base64Audio = mockAudio.toString('base64');
            
            const base64Response = await axios.post(
                `${STT_SERVICE_URL}/transcribe_base64`,
                {
                    audio_data: base64Audio,
                    use_vad: true,
                    use_smart_turn: true
                },
                {
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                }
            );
            
            console.log('✅ Base64 transcription test passed:');
            console.log('  Text:', base64Response.data.text);
            console.log('  Engine:', base64Response.data.engine);
            console.log('  Model Version:', base64Response.data.model_version);
            
        } catch (error) {
            console.log('❌ Base64 transcription test failed:', error.message);
            if (error.response) {
                console.log('Response data:', error.response.data);
            }
        }
        
        console.log('\n🎉 Enhanced STT service testing completed!');
        
    } catch (error) {
        console.error('💥 Test suite failed:', error.message);
        process.exit(1);
    }
}

async function testMLXService() {
    console.log('\n🍎 Testing Apple Silicon MLX Service');
    console.log('====================================');
    
    try {
        // Test MLX health check
        console.log('\n1. Testing MLX STT health endpoint...');
        try {
            const healthResponse = await axios.get(`${MLX_SERVICE_URL}/health`);
            console.log('✅ MLX STT health check passed:', JSON.stringify(healthResponse.data, null, 2));
        } catch (error) {
            console.log('⚠️ MLX STT service not available (expected if not on Apple Silicon):', error.message);
            return;
        }
        
        // Test MLX transcription
        console.log('\n2. Testing MLX transcription...');
        try {
            const mockAudio = createMockWavFile();
            
            const formData = new FormData();
            formData.append('file', mockAudio, {
                filename: 'test.wav',
                contentType: 'audio/wav'
            });
            
            const transcriptionResponse = await axios.post(
                `${MLX_SERVICE_URL}/transcribe_file`,
                formData,
                {
                    headers: {
                        ...formData.getHeaders()
                    },
                    timeout: 30000
                }
            );
            
            console.log('✅ MLX transcription test passed:');
            console.log('  Text:', transcriptionResponse.data.text);
            console.log('  Device:', transcriptionResponse.data.device);
            console.log('  Quantization:', transcriptionResponse.data.quantization);
            console.log('  Processing Time:', transcriptionResponse.data.processing_time_ms + 'ms');
            
        } catch (error) {
            console.log('❌ MLX transcription test failed:', error.message);
        }
        
    } catch (error) {
        console.log('⚠️ MLX testing failed (expected if not on Apple Silicon):', error.message);
    }
}

async function runAllTests() {
    console.log('🚀 Starting Enhanced STT Pipeline Tests');
    console.log('=======================================');
    
    await testEnhancedSTTService();
    await testMLXService();
    
    console.log('\n✅ All STT pipeline tests completed!');
}

// Run tests
if (require.main === module) {
    runAllTests().catch(error => {
        console.error('💥 Test runner failed:', error);
        process.exit(1);
    });
}

module.exports = { testEnhancedSTTService, testMLXService };
