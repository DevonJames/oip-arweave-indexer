#!/usr/bin/env node

/**
 * Smart Turn Service Test Script
 * Tests the Smart Turn v2 service functionality
 */

const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

const SMART_TURN_URL = process.env.SMART_TURN_URL || 'http://localhost:8010';

async function testSmartTurnService() {
    console.log('🧪 Testing Smart Turn v2 Service');
    console.log('=================================');
    
    try {
        // Test 1: Health check
        console.log('\n1. Testing health endpoint...');
        try {
            const healthResponse = await axios.get(`${SMART_TURN_URL}/health`);
            console.log('✅ Health check passed:', healthResponse.data);
        } catch (error) {
            console.log('❌ Health check failed:', error.message);
            return;
        }
        
        // Test 2: Service info
        console.log('\n2. Testing info endpoint...');
        try {
            const infoResponse = await axios.get(`${SMART_TURN_URL}/info`);
            console.log('✅ Info check passed:', JSON.stringify(infoResponse.data, null, 2));
        } catch (error) {
            console.log('❌ Info check failed:', error.message);
        }
        
        // Test 3: Prediction with base64 audio (mock data)
        console.log('\n3. Testing prediction with mock audio...');
        try {
            // Create mock audio data (simple sine wave)
            const sampleRate = 16000;
            const duration = 2; // 2 seconds
            const frequency = 440; // A4 note
            const samples = sampleRate * duration;
            
            const audioBuffer = Buffer.alloc(samples * 2); // 16-bit samples
            for (let i = 0; i < samples; i++) {
                const sample = Math.sin(2 * Math.PI * frequency * i / sampleRate) * 32767;
                audioBuffer.writeInt16LE(sample, i * 2);
            }
            
            const base64Audio = audioBuffer.toString('base64');
            
            const predictionResponse = await axios.post(`${SMART_TURN_URL}/predict_endpoint`, {
                audio_base64: base64Audio,
                transcript: "This is a test sentence."
            }, {
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            console.log('✅ Prediction test passed:', predictionResponse.data);
            
        } catch (error) {
            console.log('❌ Prediction test failed:', error.message);
            if (error.response) {
                console.log('Response data:', error.response.data);
            }
        }
        
        // Test 4: Prediction with FormData (if we have a test file)
        console.log('\n4. Testing prediction with file upload...');
        try {
            // Create a simple WAV header + mock data
            const wavHeader = Buffer.alloc(44);
            const audioData = Buffer.alloc(32000); // 1 second of 16-bit mono at 16kHz
            
            // Write WAV header
            wavHeader.write('RIFF', 0);
            wavHeader.writeUInt32LE(36 + audioData.length, 4);
            wavHeader.write('WAVE', 8);
            wavHeader.write('fmt ', 12);
            wavHeader.writeUInt32LE(16, 16); // PCM header size
            wavHeader.writeUInt16LE(1, 20);  // PCM format
            wavHeader.writeUInt16LE(1, 22);  // Mono
            wavHeader.writeUInt32LE(16000, 24); // Sample rate
            wavHeader.writeUInt32LE(32000, 28); // Byte rate
            wavHeader.writeUInt16LE(2, 32);  // Block align
            wavHeader.writeUInt16LE(16, 34); // Bits per sample
            wavHeader.write('data', 36);
            wavHeader.writeUInt32LE(audioData.length, 40);
            
            // Fill audio data with sine wave
            for (let i = 0; i < audioData.length / 2; i++) {
                const sample = Math.sin(2 * Math.PI * 440 * i / 16000) * 16000;
                audioData.writeInt16LE(sample, i * 2);
            }
            
            const wavFile = Buffer.concat([wavHeader, audioData]);
            
            const formData = new FormData();
            formData.append('audio_file', wavFile, {
                filename: 'test.wav',
                contentType: 'audio/wav'
            });
            formData.append('transcript', 'Hello, how are you today?');
            
            const uploadResponse = await axios.post(`${SMART_TURN_URL}/predict_endpoint`, formData, {
                headers: {
                    ...formData.getHeaders()
                }
            });
            
            console.log('✅ File upload test passed:', uploadResponse.data);
            
        } catch (error) {
            console.log('❌ File upload test failed:', error.message);
            if (error.response) {
                console.log('Response data:', error.response.data);
            }
        }
        
        console.log('\n🎉 Smart Turn service testing completed!');
        
    } catch (error) {
        console.error('💥 Test suite failed:', error.message);
        process.exit(1);
    }
}

// Run tests
if (require.main === module) {
    testSmartTurnService().catch(error => {
        console.error('💥 Test runner failed:', error);
        process.exit(1);
    });
}

module.exports = { testSmartTurnService };
