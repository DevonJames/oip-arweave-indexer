/**
 * Test GUN Media Distribution System
 * Tests the complete workflow: upload -> manifest -> download -> peer replication
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const API_BASE = process.env.API_BASE || 'http://localhost:3005/api';
const TEST_IMAGE_PATH = path.join(__dirname, '../public/blue-alexandria-logo.png');

class GunMediaDistributionTest {
    constructor() {
        this.testResults = [];
        this.mediaId = null;
        this.manifestData = null;
    }

    async log(message, success = true) {
        const timestamp = new Date().toISOString();
        const status = success ? '✅' : '❌';
        const logMessage = `${status} [${timestamp}] ${message}`;
        console.log(logMessage);
        this.testResults.push({ timestamp, message, success });
    }

    async runAllTests() {
        console.log('🚀 Starting GUN Media Distribution System Tests\n');
        
        try {
            // Test 1: Health Check
            await this.testHealthCheck();
            
            // Test 2: Upload Media
            await this.testMediaUpload();
            
            // Test 3: Get Manifest
            await this.testGetManifest();
            
            // Test 4: Download Media
            await this.testDownloadMedia();
            
            // Test 5: List Seeding
            await this.testListSeeding();
            
            // Test 6: Media Manager Integration
            await this.testMediaManagerIntegration();
            
            await this.printSummary();
            
        } catch (error) {
            await this.log(`Critical test failure: ${error.message}`, false);
            console.error('Test suite failed:', error);
        }
    }

    async testHealthCheck() {
        try {
            const response = await axios.get(`${API_BASE}/media/health`);
            
            if (response.status === 200 && response.data.status) {
                await this.log(`Health check passed - Status: ${response.data.status}`);
                if (response.data.stats) {
                    await this.log(`MediaSeeder stats: ${response.data.stats.totalTorrents} torrents seeding`);
                }
            } else {
                await this.log('Health check failed - MediaSeeder not ready', false);
            }
        } catch (error) {
            await this.log(`Health check error: ${error.message}`, false);
        }
    }

    async testMediaUpload() {
        try {
            // Check if test image exists
            try {
                await fs.access(TEST_IMAGE_PATH);
            } catch {
                await this.log(`Test image not found at ${TEST_IMAGE_PATH}`, false);
                return;
            }

            const imageBuffer = await fs.readFile(TEST_IMAGE_PATH);
            
            const FormData = require('form-data');
            const form = new FormData();
            form.append('file', imageBuffer, {
                filename: 'test-image.png',
                contentType: 'image/png'
            });

            const response = await axios.post(`${API_BASE}/media/upload`, form, {
                headers: {
                    ...form.getHeaders(),
                    'Content-Length': form.getLengthSync()
                },
                timeout: 30000
            });

            if (response.status === 200 && response.data.success) {
                this.mediaId = response.data.mediaId;
                this.manifestData = response.data.manifest;
                
                await this.log(`Media uploaded successfully - MediaID: ${this.mediaId}`);
                await this.log(`Torrent created - InfoHash: ${response.data.torrent.infoHash}`);
                await this.log(`File size: ${this.manifestData.fileSize} bytes`);
            } else {
                await this.log('Media upload failed', false);
            }
        } catch (error) {
            await this.log(`Media upload error: ${error.message}`, false);
        }
    }

    async testGetManifest() {
        if (!this.mediaId) {
            await this.log('Skipping manifest test - no mediaId from upload', false);
            return;
        }

        try {
            const response = await axios.get(`${API_BASE}/media/${this.mediaId}/manifest`);
            
            if (response.status === 200 && response.data.mediaId === this.mediaId) {
                await this.log('Media manifest retrieved successfully');
                await this.log(`Transport available: ${Object.keys(response.data.transport).join(', ')}`);
                
                if (response.data.availability) {
                    await this.log(`Availability - Local: ${response.data.availability.local}, Peers: ${response.data.availability.peers || 0}`);
                }
            } else {
                await this.log('Failed to retrieve media manifest', false);
            }
        } catch (error) {
            await this.log(`Manifest retrieval error: ${error.message}`, false);
        }
    }

    async testDownloadMedia() {
        if (!this.mediaId) {
            await this.log('Skipping download test - no mediaId from upload', false);
            return;
        }

        try {
            const response = await axios.get(`${API_BASE}/media/${this.mediaId}/download`, {
                responseType: 'arraybuffer',
                timeout: 30000
            });
            
            if (response.status === 200 && response.data.byteLength > 0) {
                await this.log(`Media downloaded successfully - ${response.data.byteLength} bytes`);
                await this.log(`Content-Type: ${response.headers['content-type']}`);
                
                // Verify file integrity by comparing size
                if (this.manifestData && response.data.byteLength === this.manifestData.fileSize) {
                    await this.log('File integrity verified - sizes match');
                } else {
                    await this.log('File integrity check failed - size mismatch', false);
                }
            } else {
                await this.log('Media download failed', false);
            }
        } catch (error) {
            await this.log(`Media download error: ${error.message}`, false);
        }
    }

    async testListSeeding() {
        try {
            const response = await axios.get(`${API_BASE}/media/seeding`);
            
            if (response.status === 200) {
                const seedingCount = response.data.seeding ? response.data.seeding.length : 0;
                await this.log(`Currently seeding ${seedingCount} files`);
                
                if (response.data.stats) {
                    await this.log(`Total peers: ${response.data.stats.totalPeers}`);
                    await this.log(`Total uploaded: ${response.data.stats.totalUploaded} bytes`);
                }
                
                // Check if our uploaded file is in the seeding list
                if (this.mediaId && response.data.seeding) {
                    const ourFile = response.data.seeding.find(item => 
                        item.mediaId === this.mediaId || item.fileName.includes(this.mediaId)
                    );
                    if (ourFile) {
                        await this.log('Our uploaded file is being seeded');
                    } else {
                        await this.log('Our uploaded file not found in seeding list', false);
                    }
                }
            } else {
                await this.log('Failed to list seeding files', false);
            }
        } catch (error) {
            await this.log(`List seeding error: ${error.message}`, false);
        }
    }

    async testMediaManagerIntegration() {
        try {
            // Test the media manager's GUN integration
            const testData = {
                source: 'base64',
                data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', // 1x1 red pixel
                contentType: 'image/png',
                publishTo: {
                    gun: true
                }
            };

            const response = await axios.post(`${API_BASE}/publish/media`, testData);
            
            if (response.status === 200 && response.data.gunAddress) {
                await this.log('Media Manager GUN integration working');
                await this.log(`GUN Address: ${response.data.gunAddress}`);
                await this.log(`GUN MediaID: ${response.data.gunMediaId}`);
                
                if (response.data.gunMagnetURI) {
                    await this.log('BitTorrent magnet URI generated');
                }
            } else {
                await this.log('Media Manager GUN integration failed', false);
            }
        } catch (error) {
            await this.log(`Media Manager integration error: ${error.message}`, false);
        }
    }

    async printSummary() {
        console.log('\n📊 Test Summary');
        console.log('================');
        
        const totalTests = this.testResults.length;
        const passedTests = this.testResults.filter(r => r.success).length;
        const failedTests = totalTests - passedTests;
        
        console.log(`Total Tests: ${totalTests}`);
        console.log(`✅ Passed: ${passedTests}`);
        console.log(`❌ Failed: ${failedTests}`);
        console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
        
        if (failedTests > 0) {
            console.log('\n❌ Failed Tests:');
            this.testResults
                .filter(r => !r.success)
                .forEach(r => console.log(`  - ${r.message}`));
        }
        
        console.log('\n🎯 Next Steps:');
        console.log('- Ensure GUN relay server is running');
        console.log('- Start the main OIP server with: npm start');
        console.log('- Test P2P replication with multiple nodes');
        console.log('- Implement Phase 2: Peer discovery and auto-replication');
    }
}

// Run tests if called directly
if (require.main === module) {
    const tester = new GunMediaDistributionTest();
    tester.runAllTests().catch(console.error);
}

module.exports = GunMediaDistributionTest;
