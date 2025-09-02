#!/usr/bin/env node

/**
 * Test script for ALFRED's adaptive streaming functionality
 * Run this to verify the streaming system works correctly
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3005';

async function testAdaptiveStreaming() {
    console.log('🧪 Testing ALFRED Adaptive Streaming System');
    console.log('===========================================\n');

    try {
        // Test 1: Health check
        console.log('1️⃣ Testing service health...');
        const healthResponse = await axios.get(`${BASE_URL}/api/voice/health`);
        console.log('✅ Health check passed:', healthResponse.data.status);
        
        // Test 2: Start a voice conversation
        console.log('\n2️⃣ Starting voice conversation...');
        const conversationResponse = await axios.post(`${BASE_URL}/api/voice/converse`, {
            text: "Hello, can you tell me about yourself in detail?",
            voiceConfig: JSON.stringify({
                engine: 'local', // Force local TTS to avoid ElevenLabs issues
                chatterbox: {
                    selectedVoice: 'female_expressive',
                    gender: 'female',
                    emotion: 'expressive',
                    exaggeration: 0.6,
                    cfg_weight: 0.7,
                    voiceCloning: { enabled: false }
                }
            })
        });
        
        if (!conversationResponse.data.success) {
            throw new Error('Failed to start conversation');
        }
        
        const dialogueId = conversationResponse.data.dialogueId;
        console.log('✅ Conversation started, dialogueId:', dialogueId);
        
        // Test 3: Monitor the SSE stream
        console.log('\n3️⃣ Monitoring SSE stream for audio chunks...');
        
        return new Promise((resolve, reject) => {
            const EventSource = require('eventsource');
            const eventSource = new EventSource(`${BASE_URL}/api/voice/open-stream?dialogueId=${dialogueId}`);
            
            let audioChunksReceived = 0;
            let textChunksReceived = 0;
            let totalAudioBytes = 0;
            
            const timeout = setTimeout(() => {
                eventSource.close();
                resolve({
                    audioChunksReceived,
                    textChunksReceived,
                    totalAudioBytes,
                    status: 'timeout'
                });
            }, 30000); // 30 second timeout
            
            eventSource.onmessage = function(event) {
                console.log('📨 Received event:', event.type);
            };
            
            eventSource.addEventListener('textChunk', function(event) {
                textChunksReceived++;
                const data = JSON.parse(event.data);
                console.log(`📝 Text chunk ${textChunksReceived}: "${data.text?.substring(0, 30)}..."`);
            });
            
            eventSource.addEventListener('audioChunk', function(event) {
                audioChunksReceived++;
                const data = JSON.parse(event.data);
                const audioSize = data.audio ? data.audio.length : 0;
                totalAudioBytes += audioSize;
                
                console.log(`🎵 Audio chunk ${data.chunkIndex}: ${audioSize} bytes, text: "${data.text?.substring(0, 30)}...", final: ${data.isFinal}, adaptive: ${data.adaptive}`);
                
                // Test audio format
                if (data.audio && audioSize > 0) {
                    try {
                        // Decode base64 to check format
                        const binaryString = Buffer.from(data.audio, 'base64');
                        const firstFourBytes = binaryString.slice(0, 4).toString();
                        const format = firstFourBytes === 'RIFF' ? 'WAV' : 'MP3';
                        console.log(`   📊 Audio format detected: ${format}, size: ${binaryString.length} bytes`);
                    } catch (e) {
                        console.error('   ❌ Failed to decode audio:', e.message);
                    }
                }
            });
            
            eventSource.addEventListener('done', function(event) {
                clearTimeout(timeout);
                eventSource.close();
                
                const data = JSON.parse(event.data);
                console.log('\n✅ Conversation completed');
                console.log('📊 Final metrics:', data.processing_metrics);
                
                resolve({
                    audioChunksReceived,
                    textChunksReceived,
                    totalAudioBytes,
                    status: 'completed',
                    metrics: data
                });
            });
            
            eventSource.onerror = function(event) {
                clearTimeout(timeout);
                eventSource.close();
                reject(new Error('SSE connection failed'));
            };
        });
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        return { status: 'failed', error: error.message };
    }
}

async function testDiagnostics() {
    console.log('\n4️⃣ Testing diagnostics endpoint...');
    
    try {
        // Use a recent dialogue ID from logs
        const testDialogueId = 'voice-dialogue-1756846437028-ehk1kupbr4';
        const diagnosticsResponse = await axios.get(`${BASE_URL}/api/voice/adaptive-diagnostics/${testDialogueId}`);
        
        if (diagnosticsResponse.data.success) {
            console.log('✅ Diagnostics retrieved successfully');
            console.log('📊 Session metrics:', diagnosticsResponse.data.diagnostics.metrics);
        } else {
            console.log('ℹ️ Session not found (expected if cleaned up)');
        }
    } catch (error) {
        console.log('ℹ️ Diagnostics test skipped:', error.response?.status || error.message);
    }
}

// Run tests
async function runTests() {
    const startTime = Date.now();
    
    const result = await testAdaptiveStreaming();
    await testDiagnostics();
    
    const totalTime = Date.now() - startTime;
    
    console.log('\n🎯 Test Results Summary');
    console.log('======================');
    console.log(`Status: ${result.status}`);
    console.log(`Audio chunks received: ${result.audioChunksReceived}`);
    console.log(`Text chunks received: ${result.textChunksReceived}`);
    console.log(`Total audio bytes: ${result.totalAudioBytes}`);
    console.log(`Test duration: ${totalTime}ms`);
    
    if (result.audioChunksReceived > 0) {
        console.log('\n✅ ADAPTIVE STREAMING IS WORKING!');
        console.log('🎵 Audio chunks are being generated and sent to client');
        console.log('🔍 If you can\'t hear audio, check:');
        console.log('   - Browser audio permissions');
        console.log('   - Audio codec support (MP3 vs WAV)');
        console.log('   - Client-side audio playback logic');
        console.log('   - Browser console for audio errors');
    } else {
        console.log('\n❌ NO AUDIO CHUNKS RECEIVED');
        console.log('🔍 Check backend TTS service configuration');
    }
}

if (require.main === module) {
    runTests().catch(console.error);
}

module.exports = { testAdaptiveStreaming, testDiagnostics };
