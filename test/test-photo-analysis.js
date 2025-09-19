/**
 * Test Photo Analysis Integration
 * Tests the complete photo upload and analysis workflow
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

// Configuration
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3005';
const TEST_IMAGE_PATH = path.join(__dirname, '..', 'test_data', 'test-image.jpg');

// Test utilities
class PhotoAnalysisTest {
    constructor() {
        this.baseUrl = BASE_URL;
        this.testResults = [];
    }

    async runAllTests() {
        console.log('🧪 Starting Photo Analysis Integration Tests');
        console.log(`📡 Testing against: ${this.baseUrl}`);
        console.log('=' .repeat(60));

        try {
            await this.testHealthCheck();
            await this.testPhotoUpload();
            await this.testPhotoAnalysis();
            await this.testIntegratedChat();
            await this.testPhotoInfo();
            await this.testPhotoCleanup();

            this.printResults();
        } catch (error) {
            console.error('❌ Test suite failed:', error.message);
            process.exit(1);
        }
    }

    async testHealthCheck() {
        console.log('🔍 Testing photo service health...');
        
        try {
            const response = await axios.get(`${this.baseUrl}/api/photo/health`);
            
            if (response.status === 200 && response.data.status === 'healthy') {
                this.logSuccess('Health Check', 'Photo service is healthy');
            } else {
                throw new Error(`Unexpected health status: ${response.data.status}`);
            }
        } catch (error) {
            this.logError('Health Check', error.message);
            throw error;
        }
    }

    async testPhotoUpload() {
        console.log('📷 Testing photo upload...');
        
        try {
            // Create test image if it doesn't exist
            await this.ensureTestImage();
            
            const formData = new FormData();
            const imageBuffer = fs.readFileSync(TEST_IMAGE_PATH);
            formData.append('photo', imageBuffer, {
                filename: 'test-image.jpg',
                contentType: 'image/jpeg'
            });

            const response = await axios.post(`${this.baseUrl}/api/photo/upload`, formData, {
                headers: formData.getHeaders()
            });

            if (response.status === 200 && response.data.success && response.data.photoId) {
                this.testPhotoId = response.data.photoId;
                this.logSuccess('Photo Upload', `Photo uploaded with ID: ${this.testPhotoId}`);
            } else {
                throw new Error('Upload response missing required fields');
            }
        } catch (error) {
            this.logError('Photo Upload', error.message);
            throw error;
        }
    }

    async testPhotoAnalysis() {
        console.log('🔍 Testing photo analysis...');
        
        if (!this.testPhotoId) {
            throw new Error('No photo ID from upload test');
        }

        try {
            const analysisRequest = {
                photoId: this.testPhotoId,
                question: 'What do you see in this image? Please describe it in detail.',
                model: 'grok-4'
            };

            const response = await axios.post(`${this.baseUrl}/api/photo/analyze`, analysisRequest);

            if (response.status === 200 && response.data.success && response.data.analysis) {
                this.logSuccess('Photo Analysis', `Analysis completed: ${response.data.analysis.substring(0, 100)}...`);
                console.log(`📊 Processing time: ${response.data.processingTimeMs}ms`);
            } else {
                throw new Error('Analysis response missing required fields');
            }
        } catch (error) {
            // If Grok API is not configured, this is expected
            if (error.response?.status === 500 && error.response.data.message?.includes('API key')) {
                this.logWarning('Photo Analysis', 'Grok API key not configured - skipping analysis test');
            } else {
                this.logError('Photo Analysis', error.message);
                throw error;
            }
        }
    }

    async testIntegratedChat() {
        console.log('💬 Testing integrated photo chat...');
        
        if (!this.testPhotoId) {
            throw new Error('No photo ID from upload test');
        }

        try {
            const chatRequest = {
                photoId: this.testPhotoId,
                question: 'Can you tell me more about what you observe in this image?',
                model: 'grok-4',
                processing_mode: 'rag',
                return_audio: false
            };

            const response = await axios.post(`${this.baseUrl}/api/photo/chat`, chatRequest);

            if (response.status === 200 && response.data.success && response.data.response) {
                this.logSuccess('Integrated Chat', 'Photo chat integration working');
                console.log(`📝 Response preview: ${response.data.response.substring(0, 100)}...`);
            } else {
                throw new Error('Chat response missing required fields');
            }
        } catch (error) {
            // If Grok API is not configured, this is expected
            if (error.response?.status === 500 && error.response.data.message?.includes('API key')) {
                this.logWarning('Integrated Chat', 'Grok API key not configured - skipping chat test');
            } else {
                this.logError('Integrated Chat', error.message);
                throw error;
            }
        }
    }

    async testPhotoInfo() {
        console.log('ℹ️ Testing photo info retrieval...');
        
        if (!this.testPhotoId) {
            throw new Error('No photo ID from upload test');
        }

        try {
            const response = await axios.get(`${this.baseUrl}/api/photo/info/${this.testPhotoId}`);

            if (response.status === 200 && response.data.success && response.data.photo) {
                this.logSuccess('Photo Info', 'Photo metadata retrieved successfully');
                console.log(`📋 Photo info: ${response.data.photo.originalName} (${response.data.photo.size} bytes)`);
            } else {
                throw new Error('Photo info response missing required fields');
            }
        } catch (error) {
            this.logError('Photo Info', error.message);
            throw error;
        }
    }

    async testPhotoCleanup() {
        console.log('🧹 Testing photo cleanup...');
        
        if (!this.testPhotoId) {
            throw new Error('No photo ID from upload test');
        }

        try {
            const response = await axios.delete(`${this.baseUrl}/api/photo/${this.testPhotoId}`);

            if (response.status === 200 && response.data.success) {
                this.logSuccess('Photo Cleanup', 'Photo deleted successfully');
            } else {
                throw new Error('Cleanup response indicates failure');
            }
        } catch (error) {
            this.logError('Photo Cleanup', error.message);
            throw error;
        }
    }

    async ensureTestImage() {
        if (!fs.existsSync(TEST_IMAGE_PATH)) {
            console.log('📁 Creating test image...');
            
            // Create a simple test image (1x1 pixel JPEG)
            const testImageData = Buffer.from([
                0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
                0x00, 0x48, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
                0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
                0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20, 0x24, 0x2E, 0x27, 0x20,
                0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29, 0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27,
                0x39, 0x3D, 0x38, 0x32, 0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0x01,
                0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xFF, 0xC4, 0x00, 0x14,
                0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x08, 0xFF, 0xC4, 0x00, 0x14, 0x10, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xFF, 0xDA, 0x00, 0x0C, 0x03, 0x01, 0x00, 0x02,
                0x11, 0x03, 0x11, 0x00, 0x3F, 0x00, 0xB2, 0xC0, 0x07, 0xFF, 0xD9
            ]);

            // Ensure test_data directory exists
            const testDataDir = path.dirname(TEST_IMAGE_PATH);
            if (!fs.existsSync(testDataDir)) {
                fs.mkdirSync(testDataDir, { recursive: true });
            }

            fs.writeFileSync(TEST_IMAGE_PATH, testImageData);
            console.log(`✅ Test image created: ${TEST_IMAGE_PATH}`);
        }
    }

    logSuccess(test, message) {
        this.testResults.push({ test, status: 'PASS', message });
        console.log(`✅ ${test}: ${message}`);
    }

    logError(test, message) {
        this.testResults.push({ test, status: 'FAIL', message });
        console.log(`❌ ${test}: ${message}`);
    }

    logWarning(test, message) {
        this.testResults.push({ test, status: 'WARN', message });
        console.log(`⚠️  ${test}: ${message}`);
    }

    printResults() {
        console.log('\n' + '=' .repeat(60));
        console.log('📊 Test Results Summary');
        console.log('=' .repeat(60));

        const passed = this.testResults.filter(r => r.status === 'PASS').length;
        const failed = this.testResults.filter(r => r.status === 'FAIL').length;
        const warned = this.testResults.filter(r => r.status === 'WARN').length;

        this.testResults.forEach(result => {
            const emoji = result.status === 'PASS' ? '✅' : result.status === 'FAIL' ? '❌' : '⚠️';
            console.log(`${emoji} ${result.test}: ${result.status}`);
        });

        console.log('\n📈 Summary:');
        console.log(`   Passed: ${passed}`);
        console.log(`   Failed: ${failed}`);
        console.log(`   Warnings: ${warned}`);
        console.log(`   Total: ${this.testResults.length}`);

        if (failed > 0) {
            console.log('\n❌ Some tests failed. Check the logs above for details.');
            process.exit(1);
        } else {
            console.log('\n🎉 All tests passed successfully!');
            
            if (warned > 0) {
                console.log('⚠️  Note: Some tests were skipped due to configuration (e.g., missing Grok API key)');
            }
        }
    }
}

// Environment check
function checkEnvironment() {
    console.log('🔧 Environment Check:');
    console.log(`   Base URL: ${BASE_URL}`);
    console.log(`   Test Image: ${TEST_IMAGE_PATH}`);
    console.log(`   Grok API Key: ${process.env.GROK_API_KEY ? 'Configured' : 'Not configured'}`);
    console.log(`   XAI API Key: ${process.env.XAI_API_KEY ? 'Configured' : 'Not configured'}`);
    console.log('');
}

// Run tests if called directly
if (require.main === module) {
    checkEnvironment();
    
    const tester = new PhotoAnalysisTest();
    tester.runAllTests().catch(error => {
        console.error('💥 Test execution failed:', error);
        process.exit(1);
    });
}

module.exports = PhotoAnalysisTest;
