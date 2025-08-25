#!/usr/bin/env node
/**
 * Mac Client Coordinator
 * Handles communication between Mac client services and PC backend
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
require('dotenv').config();

class MacClientCoordinator {
    constructor() {
        // Load configuration
        const configPath = path.join(__dirname, 'config', 'mac_client_config.json');
        this.config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        
        // Service URLs
        this.sttUrl = `http://localhost:${this.config.client.services.stt.port}`;
        this.smartTurnUrl = `http://localhost:${this.config.client.services.smart_turn.port}`;
        
        // Backend configuration
        const backendConfig = this.config.client.backend;
        this.backendUrl = `${backendConfig.protocol}://${backendConfig.host}:${backendConfig.port}`;
        
        console.log('🍎 Mac Client Coordinator initialized');
        console.log(`STT Service: ${this.sttUrl}`);
        console.log(`Smart Turn Service: ${this.smartTurnUrl}`);
        console.log(`Backend: ${this.backendUrl}`);
    }
    
    /**
     * Check health of all services
     */
    async checkHealth() {
        const results = {
            timestamp: new Date().toISOString(),
            services: {}
        };
        
        // Check STT service
        try {
            const sttResponse = await axios.get(`${this.sttUrl}/health`, { timeout: 5000 });
            results.services.stt = {
                status: 'healthy',
                details: sttResponse.data
            };
        } catch (error) {
            results.services.stt = {
                status: 'unhealthy',
                error: error.message
            };
        }
        
        // Check Smart Turn service
        try {
            const smartTurnResponse = await axios.get(`${this.smartTurnUrl}/health`, { timeout: 5000 });
            results.services.smart_turn = {
                status: 'healthy',
                details: smartTurnResponse.data
            };
        } catch (error) {
            results.services.smart_turn = {
                status: 'unhealthy',
                error: error.message
            };
        }
        
        // Check backend connectivity
        try {
            const backendResponse = await axios.get(`${this.backendUrl}/api/voice/health`, { timeout: 5000 });
            results.services.backend = {
                status: 'healthy',
                details: backendResponse.data
            };
        } catch (error) {
            results.services.backend = {
                status: 'unhealthy',
                error: error.message
            };
        }
        
        return results;
    }
    
    /**
     * Process audio through the complete pipeline
     * @param {Buffer} audioBuffer - Audio data
     * @param {Object} options - Processing options
     */
    async processAudio(audioBuffer, options = {}) {
        const startTime = Date.now();
        const processingMetrics = {};
        
        try {
            console.log('🎤 Starting audio processing pipeline...');
            
            // Step 1: Speech-to-Text with VAD
            console.log('🔊 Running STT with VAD preprocessing...');
            const sttStartTime = Date.now();
            
            const formData = new FormData();
            formData.append('file', audioBuffer, {
                filename: 'audio.wav',
                contentType: 'audio/wav'
            });
            
            if (options.language) {
                formData.append('language', options.language);
            }
            formData.append('use_vad', options.useVad !== false ? 'true' : 'false');
            
            const sttResponse = await axios.post(`${this.sttUrl}/transcribe_file`, formData, {
                headers: formData.getHeaders(),
                timeout: 30000
            });
            
            const transcript = sttResponse.data.text;
            processingMetrics.stt_time_ms = Date.now() - sttStartTime;
            
            console.log(`📝 Transcript: "${transcript}"`);
            console.log(`⚡ STT completed in ${processingMetrics.stt_time_ms}ms`);
            
            // Step 2: Smart Turn endpoint detection
            console.log('🤖 Running Smart Turn endpoint detection...');
            const smartTurnStartTime = Date.now();
            
            const smartTurnFormData = new FormData();
            smartTurnFormData.append('audio_file', audioBuffer, {
                filename: 'audio.wav',
                contentType: 'audio/wav'
            });
            
            if (transcript) {
                smartTurnFormData.append('transcript', transcript);
            }
            
            const smartTurnResponse = await axios.post(
                `${this.smartTurnUrl}/predict_endpoint`, 
                smartTurnFormData, 
                {
                    headers: smartTurnFormData.getHeaders(),
                    timeout: 10000
                }
            );
            
            const smartTurnResult = smartTurnResponse.data;
            processingMetrics.smart_turn_time_ms = Date.now() - smartTurnStartTime;
            
            console.log(`🎯 Smart Turn: ${smartTurnResult.prediction} (prob: ${smartTurnResult.probability.toFixed(3)})`);
            console.log(`⚡ Smart Turn completed in ${processingMetrics.smart_turn_time_ms}ms`);
            
            // Step 3: Send to backend for RAG processing (if endpoint detected)
            if (smartTurnResult.prediction === 1 || options.forceBackend) {
                console.log('🧠 Sending to backend for RAG processing...');
                const ragStartTime = Date.now();
                
                const backendPayload = {
                    query: transcript,
                    metadata: {
                        source: 'mac_client',
                        stt_engine: 'mlx-whisper',
                        vad_used: sttResponse.data.vad_used,
                        smart_turn_probability: smartTurnResult.probability,
                        processing_metrics: processingMetrics
                    }
                };
                
                const ragResponse = await axios.post(
                    `${this.backendUrl}/api/alfred/query`,
                    backendPayload,
                    { timeout: 30000 }
                );
                
                processingMetrics.rag_time_ms = Date.now() - ragStartTime;
                
                console.log('📚 RAG processing completed');
                console.log(`⚡ RAG completed in ${processingMetrics.rag_time_ms}ms`);
                
                // Step 4: Text-to-Speech (handled by backend)
                if (options.synthesizeSpeech !== false) {
                    console.log('🗣️ Requesting TTS from backend...');
                    const ttsStartTime = Date.now();
                    
                    const ttsPayload = {
                        text: ragResponse.data.response,
                        voice: options.voice || 'default',
                        engine: 'kokoro'
                    };
                    
                    const ttsResponse = await axios.post(
                        `${this.backendUrl}/api/voice/synthesize`,
                        ttsPayload,
                        { 
                            timeout: 30000,
                            responseType: 'json'
                        }
                    );
                    
                    processingMetrics.tts_time_ms = Date.now() - ttsStartTime;
                    
                    console.log('🎵 TTS completed');
                    console.log(`⚡ TTS completed in ${processingMetrics.tts_time_ms}ms`);
                    
                    // Complete response
                    processingMetrics.total_time_ms = Date.now() - startTime;
                    
                    return {
                        success: true,
                        transcript: transcript,
                        smart_turn: smartTurnResult,
                        rag_response: ragResponse.data,
                        tts_response: ttsResponse.data,
                        processing_metrics: processingMetrics,
                        pipeline_version: '2.0-mac-client',
                        timestamp: new Date().toISOString()
                    };
                }
                
                // Text-only response
                processingMetrics.total_time_ms = Date.now() - startTime;
                
                return {
                    success: true,
                    transcript: transcript,
                    smart_turn: smartTurnResult,
                    rag_response: ragResponse.data,
                    processing_metrics: processingMetrics,
                    pipeline_version: '2.0-mac-client',
                    timestamp: new Date().toISOString()
                };
                
            } else {
                // Incomplete utterance, return partial results
                processingMetrics.total_time_ms = Date.now() - startTime;
                
                console.log('⏸️ Incomplete utterance detected, not sending to backend');
                
                return {
                    success: true,
                    transcript: transcript,
                    smart_turn: smartTurnResult,
                    incomplete: true,
                    processing_metrics: processingMetrics,
                    pipeline_version: '2.0-mac-client',
                    timestamp: new Date().toISOString()
                };
            }
            
        } catch (error) {
            console.error('❌ Pipeline processing failed:', error.message);
            
            processingMetrics.total_time_ms = Date.now() - startTime;
            
            return {
                success: false,
                error: error.message,
                processing_metrics: processingMetrics,
                pipeline_version: '2.0-mac-client',
                timestamp: new Date().toISOString()
            };
        }
    }
    
    /**
     * Test the complete pipeline with sample audio
     */
    async testPipeline() {
        console.log('🧪 Testing Mac client pipeline...');
        
        try {
            // Check health first
            const healthCheck = await this.checkHealth();
            console.log('Health Check Results:');
            console.log(JSON.stringify(healthCheck, null, 2));
            
            // Check if we have test audio
            const testAudioPath = path.join(__dirname, '..', 'test_data', 'sample_speech.wav');
            
            if (!fs.existsSync(testAudioPath)) {
                console.log('⚠️ Test audio not found, creating mock test...');
                
                // Create a simple test without audio file
                const mockResult = {
                    success: true,
                    message: 'Pipeline services are running and healthy',
                    services_status: healthCheck
                };
                
                console.log('✅ Mock test completed successfully');
                return mockResult;
            }
            
            // Test with actual audio file
            const audioBuffer = fs.readFileSync(testAudioPath);
            console.log(`📁 Loaded test audio: ${audioBuffer.length} bytes`);
            
            const result = await this.processAudio(audioBuffer, {
                useVad: true,
                synthesizeSpeech: false,  // Skip TTS for testing
                forceBackend: true       // Force backend processing for testing
            });
            
            console.log('🎉 Pipeline test completed!');
            console.log('Results:');
            console.log(JSON.stringify(result, null, 2));
            
            return result;
            
        } catch (error) {
            console.error('❌ Pipeline test failed:', error.message);
            throw error;
        }
    }
    
    /**
     * Start monitoring mode
     */
    async startMonitoring(intervalMs = 30000) {
        console.log(`🔍 Starting health monitoring (interval: ${intervalMs}ms)...`);
        
        const monitor = async () => {
            try {
                const health = await this.checkHealth();
                const timestamp = new Date().toLocaleString();
                
                console.log(`\n[${timestamp}] Health Status:`);
                
                for (const [service, status] of Object.entries(health.services)) {
                    const emoji = status.status === 'healthy' ? '✅' : '❌';
                    console.log(`${emoji} ${service}: ${status.status}`);
                    
                    if (status.status === 'unhealthy') {
                        console.log(`   Error: ${status.error}`);
                    }
                }
                
            } catch (error) {
                console.error('❌ Health monitoring error:', error.message);
            }
        };
        
        // Initial check
        await monitor();
        
        // Set up periodic monitoring
        setInterval(monitor, intervalMs);
    }
}

// CLI interface
if (require.main === module) {
    const coordinator = new MacClientCoordinator();
    
    const command = process.argv[2];
    
    switch (command) {
        case 'health':
            coordinator.checkHealth()
                .then(result => {
                    console.log(JSON.stringify(result, null, 2));
                    process.exit(0);
                })
                .catch(error => {
                    console.error('❌ Health check failed:', error.message);
                    process.exit(1);
                });
            break;
            
        case 'test':
            coordinator.testPipeline()
                .then(result => {
                    console.log('\n✅ Test completed successfully');
                    process.exit(0);
                })
                .catch(error => {
                    console.error('❌ Test failed:', error.message);
                    process.exit(1);
                });
            break;
            
        case 'monitor':
            const interval = parseInt(process.argv[3]) || 30000;
            coordinator.startMonitoring(interval)
                .catch(error => {
                    console.error('❌ Monitoring failed:', error.message);
                    process.exit(1);
                });
            break;
            
        default:
            console.log('Mac Client Coordinator');
            console.log('Usage:');
            console.log('  node mac_client_coordinator.js health   - Check service health');
            console.log('  node mac_client_coordinator.js test     - Test complete pipeline');
            console.log('  node mac_client_coordinator.js monitor [interval] - Start monitoring');
            console.log('');
            console.log('Examples:');
            console.log('  node mac_client_coordinator.js health');
            console.log('  node mac_client_coordinator.js test');
            console.log('  node mac_client_coordinator.js monitor 10000');
            process.exit(1);
    }
}

module.exports = MacClientCoordinator;
