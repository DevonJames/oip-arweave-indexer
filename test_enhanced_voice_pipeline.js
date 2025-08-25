#!/usr/bin/env node

/**
 * Enhanced Voice Pipeline Unit Test Suite
 * Comprehensive testing for Week 4 integration
 */

const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

// Service URLs
const MAIN_APP_URL = process.env.MAIN_APP_URL || 'http://localhost:3000';
const STT_SERVICE_URL = process.env.STT_SERVICE_URL || 'http://localhost:8003';
const TTS_SERVICE_URL = process.env.TTS_SERVICE_URL || 'http://localhost:5002';
const SMART_TURN_URL = process.env.SMART_TURN_URL || 'http://localhost:8010';

// Test configuration
const TEST_CONFIG = {
    timeout: 30000,
    retries: 3,
    verbose: process.env.VERBOSE === 'true'
};

class VoicePipelineTestSuite {
    constructor() {
        this.results = {
            passed: 0,
            failed: 0,
            total: 0,
            details: []
        };
        this.testAudio = null;
    }

    log(message, level = 'info') {
        const timestamp = new Date().toISOString();
        const prefix = {
            'info': '🔍',
            'success': '✅',
            'error': '❌',
            'warning': '⚠️'
        }[level] || 'ℹ️';
        
        console.log(`${prefix} [${timestamp}] ${message}`);
    }

    async runTest(testName, testFunction) {
        this.results.total++;
        try {
            this.log(`Starting test: ${testName}`);
            await testFunction();
            this.results.passed++;
            this.results.details.push({ test: testName, status: 'PASSED', error: null });
            this.log(`Test passed: ${testName}`, 'success');
        } catch (error) {
            this.results.failed++;
            this.results.details.push({ test: testName, status: 'FAILED', error: error.message });
            this.log(`Test failed: ${testName} - ${error.message}`, 'error');
        }
    }

    createMockWavFile() {
        /**
         * Create a mock WAV file for testing
         */
        const sampleRate = 16000;
        const duration = 2; // 2 seconds
        const frequency = 440; // A4 note
        const samples = sampleRate * duration;
        
        // WAV header (44 bytes)
        const header = Buffer.alloc(44);
        header.write('RIFF', 0);
        header.writeUInt32LE(36 + samples * 2, 4);
        header.write('WAVE', 8);
        header.write('fmt ', 12);
        header.writeUInt32LE(16, 16);
        header.writeUInt16LE(1, 20);
        header.writeUInt16LE(1, 22);
        header.writeUInt32LE(sampleRate, 24);
        header.writeUInt32LE(sampleRate * 2, 28);
        header.writeUInt16LE(2, 32);
        header.writeUInt16LE(16, 34);
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

    // Test 1: Service Health Checks
    async testServiceHealth() {
        const services = [
            { name: 'Main App', url: `${MAIN_APP_URL}/api/voice/health` },
            { name: 'Enhanced STT', url: `${STT_SERVICE_URL}/health` },
            { name: 'Kokoro TTS', url: `${TTS_SERVICE_URL}/health` },
            { name: 'Smart Turn', url: `${SMART_TURN_URL}/health` }
        ];

        for (const service of services) {
            try {
                const response = await axios.get(service.url, { timeout: 10000 });
                if (response.status !== 200) {
                    throw new Error(`${service.name} returned status ${response.status}`);
                }
                this.log(`${service.name} health check passed`, 'success');
            } catch (error) {
                throw new Error(`${service.name} health check failed: ${error.message}`);
            }
        }
    }

    // Test 2: Enhanced STT Service
    async testEnhancedSTT() {
        const formData = new FormData();
        formData.append('file', this.testAudio, {
            filename: 'test.wav',
            contentType: 'audio/wav'
        });

        const response = await axios.post(`${STT_SERVICE_URL}/transcribe_file`, formData, {
            headers: { ...formData.getHeaders() },
            timeout: TEST_CONFIG.timeout
        });

        if (!response.data || !response.data.text) {
            throw new Error('STT response missing text field');
        }

        // Check for enhanced features
        const expectedFields = ['processing_time_ms', 'model_version', 'engine'];
        for (const field of expectedFields) {
            if (!(field in response.data)) {
                this.log(`Warning: STT response missing ${field}`, 'warning');
            }
        }

        this.log(`STT transcribed: "${response.data.text}"`, 'info');
        
        // Check VAD integration
        if (response.data.vad_used !== undefined) {
            this.log(`VAD integration detected: ${response.data.vad_used}`, 'success');
        }
    }

    // Test 3: Kokoro TTS Service
    async testKokoroTTS() {
        const ttsRequest = {
            text: "This is a test of the enhanced Kokoro TTS service integration.",
            voice: "en_female_01",
            engine: "kokoro"
        };

        const response = await axios.post(`${TTS_SERVICE_URL}/synthesize`, ttsRequest, {
            headers: { 'Content-Type': 'application/json' },
            timeout: TEST_CONFIG.timeout
        });

        if (!response.data || !response.data.audio_data) {
            throw new Error('TTS response missing audio_data field');
        }

        // Check enhanced TTS features
        const expectedFields = ['processing_time_ms', 'engine', 'voice', 'cached'];
        for (const field of expectedFields) {
            if (!(field in response.data)) {
                throw new Error(`TTS response missing required field: ${field}`);
            }
        }

        this.log(`TTS synthesized with ${response.data.engine} (${response.data.processing_time_ms}ms)`, 'success');
        
        // Test audio data
        const audioBuffer = Buffer.from(response.data.audio_data, 'base64');
        if (audioBuffer.length === 0) {
            throw new Error('TTS returned empty audio data');
        }
    }

    // Test 4: Smart Turn Service
    async testSmartTurn() {
        const formData = new FormData();
        formData.append('audio_file', this.testAudio, {
            filename: 'test.wav',
            contentType: 'audio/wav'
        });
        formData.append('transcript', 'This is a test transcript for endpoint detection.');

        const response = await axios.post(`${SMART_TURN_URL}/predict_endpoint`, formData, {
            headers: { ...formData.getHeaders() },
            timeout: TEST_CONFIG.timeout
        });

        if (!response.data || response.data.prediction === undefined) {
            throw new Error('Smart Turn response missing prediction field');
        }

        const expectedFields = ['prediction', 'probability', 'processing_time_ms'];
        for (const field of expectedFields) {
            if (!(field in response.data)) {
                throw new Error(`Smart Turn response missing required field: ${field}`);
            }
        }

        this.log(`Smart Turn prediction: ${response.data.prediction} (prob: ${response.data.probability.toFixed(3)})`, 'success');
    }

    // Test 5: Enhanced Voice Chat Pipeline
    async testEnhancedVoiceChatPipeline() {
        const formData = new FormData();
        formData.append('audio', this.testAudio, {
            filename: 'test.wav',
            contentType: 'audio/wav'
        });
        formData.append('return_audio', 'true');
        formData.append('model', 'llama3.2:3b');

        const response = await axios.post(`${MAIN_APP_URL}/api/voice/chat`, formData, {
            headers: { ...formData.getHeaders() },
            timeout: 45000 // Longer timeout for full pipeline
        });

        if (!response.data || !response.data.success) {
            throw new Error('Voice chat pipeline failed');
        }

        // Check Week 4 enhanced response format
        const requiredFields = [
            'processing_metrics',
            'pipeline_version',
            'timestamp',
            'input_text',
            'response_text',
            'has_audio'
        ];

        for (const field of requiredFields) {
            if (!(field in response.data)) {
                throw new Error(`Voice chat response missing required field: ${field}`);
            }
        }

        // Check processing metrics
        const metrics = response.data.processing_metrics;
        const expectedMetrics = ['stt_time_ms', 'rag_time_ms', 'total_time_ms'];
        
        for (const metric of expectedMetrics) {
            if (!(metric in metrics)) {
                throw new Error(`Processing metrics missing: ${metric}`);
            }
        }

        this.log(`Voice chat pipeline completed in ${metrics.total_time_ms}ms`, 'success');
        this.log(`  - STT: ${metrics.stt_time_ms}ms`, 'info');
        this.log(`  - RAG: ${metrics.rag_time_ms}ms`, 'info');
        this.log(`  - TTS: ${metrics.tts_time_ms || 0}ms`, 'info');

        // Check enhanced pipeline features
        if (response.data.enhanced_pipeline) {
            this.log('Enhanced pipeline features detected:', 'success');
            this.log(`  - Smart Turn: ${response.data.enhanced_pipeline.smart_turn_enabled}`, 'info');
            this.log(`  - VAD: ${response.data.enhanced_pipeline.vad_enabled}`, 'info');
        }

        // Check Smart Turn integration
        if (response.data.smart_turn) {
            this.log(`Smart Turn endpoint detection: complete=${response.data.smart_turn.endpoint_complete}`, 'success');
        }

        // Validate pipeline version
        if (response.data.pipeline_version !== "2.0") {
            this.log(`Warning: Expected pipeline version 2.0, got ${response.data.pipeline_version}`, 'warning');
        }
    }

    // Test 6: Text-Only Voice Chat
    async testTextOnlyVoiceChat() {
        const response = await axios.post(`${MAIN_APP_URL}/api/voice/chat`, {
            text: "What is the latest news about artificial intelligence?",
            return_audio: false,
            model: 'llama3.2:3b'
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: TEST_CONFIG.timeout
        });

        if (!response.data || !response.data.success) {
            throw new Error('Text-only voice chat failed');
        }

        // Check enhanced response format
        if (!response.data.processing_metrics) {
            throw new Error('Text-only response missing processing_metrics');
        }

        // Should not have STT metrics for text-only
        if (response.data.processing_metrics.stt_time_ms > 0) {
            this.log('Warning: Text-only request has STT timing', 'warning');
        }

        this.log(`Text-only chat completed in ${response.data.processing_metrics.total_time_ms}ms`, 'success');
    }

    // Test 7: Error Handling and Fallbacks
    async testErrorHandling() {
        // Test with invalid audio format
        try {
            const formData = new FormData();
            formData.append('audio', Buffer.from('invalid audio data'), {
                filename: 'invalid.txt',
                contentType: 'text/plain'
            });

            const response = await axios.post(`${MAIN_APP_URL}/api/voice/chat`, formData, {
                headers: { ...formData.getHeaders() },
                timeout: TEST_CONFIG.timeout
            });

            // Should still get a response with error information
            if (response.data.success === false || response.data.error) {
                this.log('Error handling working correctly', 'success');
            } else {
                this.log('Warning: Expected error response for invalid audio', 'warning');
            }
        } catch (error) {
            // Expected to fail, but should be handled gracefully
            if (error.response && error.response.status < 500) {
                this.log('Error handling working correctly (client error)', 'success');
            } else {
                throw new Error('Server error handling not working properly');
            }
        }
    }

    // Test 8: Performance Benchmarks
    async testPerformanceBenchmarks() {
        const testCases = [
            { text: "Short test.", expectedTime: 3000 },
            { text: "This is a medium length sentence for testing performance.", expectedTime: 5000 },
            { text: "This is a much longer sentence that contains more words and should take longer to process, allowing us to test the performance characteristics of the enhanced voice pipeline under various load conditions.", expectedTime: 8000 }
        ];

        for (const testCase of testCases) {
            const startTime = Date.now();
            
            const response = await axios.post(`${MAIN_APP_URL}/api/voice/chat`, {
                text: testCase.text,
                return_audio: true,
                model: 'llama3.2:3b'
            }, {
                headers: { 'Content-Type': 'application/json' },
                timeout: testCase.expectedTime + 5000
            });

            const actualTime = Date.now() - startTime;
            
            if (!response.data.success) {
                throw new Error(`Performance test failed for: ${testCase.text}`);
            }

            this.log(`Performance test: ${testCase.text.length} chars processed in ${actualTime}ms`, 'info');
            
            if (actualTime > testCase.expectedTime) {
                this.log(`Warning: Processing took longer than expected (${actualTime}ms > ${testCase.expectedTime}ms)`, 'warning');
            }
        }
    }

    // Test 9: Configuration and Feature Flags
    async testConfigurationFlags() {
        // Test health endpoint for configuration
        const response = await axios.get(`${MAIN_APP_URL}/api/voice/health`, {
            timeout: 10000
        });

        if (!response.data) {
            throw new Error('Health endpoint returned no data');
        }

        // Check for enhanced pipeline status
        const expectedServices = ['stt', 'tts'];
        for (const service of expectedServices) {
            if (!(service in response.data)) {
                throw new Error(`Health response missing service: ${service}`);
            }
        }

        // Check for Smart Turn if enabled
        if (response.data.smart_turn) {
            this.log('Smart Turn service detected in health check', 'success');
        }

        this.log('Configuration flags validated', 'success');
    }

    // Test 10: Response Format Validation
    async testResponseFormatValidation() {
        const response = await axios.post(`${MAIN_APP_URL}/api/voice/chat`, {
            text: "Test response format validation",
            return_audio: false
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: TEST_CONFIG.timeout
        });

        // Validate Week 4 enhanced response format
        const requiredFields = {
            'success': 'boolean',
            'input_text': 'string',
            'response_text': 'string',
            'processing_metrics': 'object',
            'pipeline_version': 'string',
            'timestamp': 'string'
        };

        for (const [field, expectedType] of Object.entries(requiredFields)) {
            if (!(field in response.data)) {
                throw new Error(`Response missing required field: ${field}`);
            }
            
            const actualType = typeof response.data[field];
            if (actualType !== expectedType) {
                throw new Error(`Field ${field} has wrong type: expected ${expectedType}, got ${actualType}`);
            }
        }

        // Validate processing metrics structure
        const metricsFields = ['total_time_ms', 'rag_time_ms'];
        for (const field of metricsFields) {
            if (!(field in response.data.processing_metrics)) {
                throw new Error(`Processing metrics missing field: ${field}`);
            }
        }

        this.log('Response format validation passed', 'success');
    }

    async runAllTests() {
        this.log('🚀 Starting Enhanced Voice Pipeline Test Suite');
        this.log('===============================================');
        
        // Initialize test audio
        this.testAudio = this.createMockWavFile();
        
        // Run all tests
        await this.runTest('Service Health Checks', () => this.testServiceHealth());
        await this.runTest('Enhanced STT Service', () => this.testEnhancedSTT());
        await this.runTest('Kokoro TTS Service', () => this.testKokoroTTS());
        await this.runTest('Smart Turn Service', () => this.testSmartTurn());
        await this.runTest('Enhanced Voice Chat Pipeline', () => this.testEnhancedVoiceChatPipeline());
        await this.runTest('Text-Only Voice Chat', () => this.testTextOnlyVoiceChat());
        await this.runTest('Error Handling and Fallbacks', () => this.testErrorHandling());
        await this.runTest('Performance Benchmarks', () => this.testPerformanceBenchmarks());
        await this.runTest('Configuration and Feature Flags', () => this.testConfigurationFlags());
        await this.runTest('Response Format Validation', () => this.testResponseFormatValidation());
        
        // Generate report
        this.generateReport();
    }

    generateReport() {
        this.log('📊 Test Suite Results');
        this.log('====================');
        
        const passRate = (this.results.passed / this.results.total * 100).toFixed(1);
        
        this.log(`Total Tests: ${this.results.total}`, 'info');
        this.log(`Passed: ${this.results.passed}`, 'success');
        this.log(`Failed: ${this.results.failed}`, this.results.failed > 0 ? 'error' : 'info');
        this.log(`Pass Rate: ${passRate}%`, passRate >= 90 ? 'success' : 'warning');
        
        if (this.results.failed > 0) {
            this.log('\n❌ Failed Tests:', 'error');
            this.results.details
                .filter(test => test.status === 'FAILED')
                .forEach(test => {
                    this.log(`  - ${test.test}: ${test.error}`, 'error');
                });
        }
        
        if (this.results.passed === this.results.total) {
            this.log('\n🎉 All tests passed! Enhanced Voice Pipeline is ready for deployment.', 'success');
        } else {
            this.log('\n⚠️ Some tests failed. Please review and fix issues before deployment.', 'warning');
        }
        
        // Save detailed results
        const reportFile = `test_results_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        fs.writeFileSync(reportFile, JSON.stringify({
            summary: {
                total: this.results.total,
                passed: this.results.passed,
                failed: this.results.failed,
                pass_rate: passRate
            },
            details: this.results.details,
            timestamp: new Date().toISOString(),
            pipeline_version: "2.0"
        }, null, 2));
        
        this.log(`📄 Detailed results saved to: ${reportFile}`, 'info');
        
        // Exit with appropriate code
        process.exit(this.results.failed > 0 ? 1 : 0);
    }
}

// Run tests if called directly
if (require.main === module) {
    const testSuite = new VoicePipelineTestSuite();
    testSuite.runAllTests().catch(error => {
        console.error('💥 Test suite crashed:', error);
        process.exit(1);
    });
}

module.exports = VoicePipelineTestSuite;
