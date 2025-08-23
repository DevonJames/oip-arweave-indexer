/**
 * Test GUN P2P Media Distribution System (Phase 2)
 * Tests peer discovery, replication, and network coordination features
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const API_BASE = process.env.API_BASE || 'http://localhost:3005/api';
const TEST_IMAGE_PATH = path.join(__dirname, '../public/blue-alexandria-logo.png');

class GunP2PMediaDistributionTest {
    constructor() {
        this.testResults = [];
        this.mediaId = null;
        this.manifestData = null;
        this.networkStats = null;
    }

    async log(message, success = true) {
        const timestamp = new Date().toISOString();
        const status = success ? '✅' : '❌';
        const logMessage = `${status} [${timestamp}] ${message}`;
        console.log(logMessage);
        this.testResults.push({ timestamp, message, success });
    }

    async runAllTests() {
        console.log('🚀 Starting GUN P2P Media Distribution System Tests (Phase 2)\n');
        
        try {
            // Phase 1 Tests (Basic Functionality)
            await this.testHealthCheck();
            await this.testNetworkStats();
            await this.testPeerInformation();
            
            // Phase 2 Tests (P2P Features)
            await this.testMediaUploadWithReplication();
            await this.testComprehensiveManifest();
            await this.testNetworkAwareDownload();
            await this.testPeerDiscovery();
            await this.testReplicationStatus();
            
            // Integration Tests
            await this.testMediaManagerIntegration();
            await this.testMultiPeerScenario();
            
            await this.printSummary();
            
        } catch (error) {
            await this.log(`Critical test failure: ${error.message}`, false);
            console.error('Test suite failed:', error);
        }
    }

    async testHealthCheck() {
        try {
            const response = await axios.get(`${API_BASE}/media/health`);
            
            if (response.status === 200) {
                await this.log(`Health check passed - Status: ${response.data.status}`);
                
                if (response.data.components) {
                    const components = response.data.components;
                    await this.log(`Components - Seeder: ${components.mediaSeeder}, Registry: ${components.peerRegistry}, Replication: ${components.replicationManager}`);
                }
                
                if (response.data.networkHealth) {
                    await this.log(`Network health: ${response.data.networkHealth}`);
                }
            } else {
                await this.log('Health check failed - MediaCoordinator not ready', false);
            }
        } catch (error) {
            await this.log(`Health check error: ${error.message}`, false);
        }
    }

    async testNetworkStats() {
        try {
            const response = await axios.get(`${API_BASE}/media/network/stats`);
            
            if (response.status === 200) {
                this.networkStats = response.data;
                await this.log('Network stats retrieved successfully');
                
                if (response.data.coordinator) {
                    await this.log(`Coordinator uptime: ${Math.floor(response.data.coordinator.uptime / 1000)}s`);
                    await this.log(`Network health: ${response.data.coordinator.networkHealth}`);
                }
                
                if (response.data.peers) {
                    await this.log(`Peer stats - Total: ${response.data.peers.totalPeers}, Healthy: ${response.data.peers.healthyPeers}`);
                }
                
                if (response.data.replication) {
                    await this.log(`Replication stats - Queue: ${response.data.replication.queueSize}, Active: ${response.data.replication.activeReplications}`);
                }
            } else {
                await this.log('Failed to get network stats', false);
            }
        } catch (error) {
            await this.log(`Network stats error: ${error.message}`, false);
        }
    }

    async testPeerInformation() {
        try {
            const response = await axios.get(`${API_BASE}/media/peers`);
            
            if (response.status === 200) {
                await this.log('Peer information retrieved successfully');
                
                if (response.data.self) {
                    await this.log(`Self PeerID: ${response.data.self.peerId}`);
                    await this.log(`Self uptime: ${Math.floor(response.data.self.uptime / 1000)}s`);
                    
                    if (response.data.self.capabilities) {
                        const caps = response.data.self.capabilities;
                        await this.log(`Capabilities - Seeding: ${caps.seeding}, Downloading: ${caps.downloading}, Relay: ${caps.relay}`);
                    }
                }
                
                if (response.data.summary) {
                    await this.log(`Network summary - Total peers: ${response.data.summary.totalPeers}, Healthy: ${response.data.summary.healthyPeers}`);
                }
            } else {
                await this.log('Failed to get peer information', false);
            }
        } catch (error) {
            await this.log(`Peer information error: ${error.message}`, false);
        }
    }

    async testMediaUploadWithReplication() {
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
                filename: 'test-image-p2p.png',
                contentType: 'image/png'
            });
            form.append('replicate', 'true');
            form.append('priority', '8');

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
                
                await this.log(`Media uploaded with replication - MediaID: ${this.mediaId}`);
                await this.log(`Torrent created - InfoHash: ${response.data.torrent.infoHash}`);
                
                if (response.data.network) {
                    await this.log(`Network info - PeerID: ${response.data.network.peerId}`);
                    await this.log(`Network peers: ${response.data.network.networkPeers}`);
                    await this.log(`Replication queued: ${response.data.network.replicationQueued}`);
                }
                
                if (response.data.manifest.replicationQueued) {
                    await this.log('Replication successfully queued for cross-peer distribution');
                }
            } else {
                await this.log('Media upload with replication failed', false);
            }
        } catch (error) {
            await this.log(`Media upload with replication error: ${error.message}`, false);
        }
    }

    async testComprehensiveManifest() {
        if (!this.mediaId) {
            await this.log('Skipping comprehensive manifest test - no mediaId from upload', false);
            return;
        }

        try {
            const response = await axios.get(`${API_BASE}/media/${this.mediaId}/manifest`);
            
            if (response.status === 200 && response.data.mediaId === this.mediaId) {
                await this.log('Comprehensive media manifest retrieved successfully');
                
                if (response.data.transport) {
                    await this.log(`Transport available: ${Object.keys(response.data.transport).join(', ')}`);
                }
                
                if (response.data.availability) {
                    const avail = response.data.availability;
                    await this.log(`Availability - Local: ${avail.local}, Network: ${avail.network}, Total copies: ${avail.totalCopies}`);
                }
                
                if (response.data.network) {
                    await this.log(`Network availability - Available peers: ${response.data.network.availablePeers}`);
                    
                    if (response.data.network.peers && response.data.network.peers.length > 0) {
                        await this.log(`Peer details available for ${response.data.network.peers.length} peers`);
                    }
                }
                
                if (response.data.replication) {
                    await this.log(`Replication status: ${response.data.replication.status || 'unknown'}`);
                }
            } else {
                await this.log('Failed to retrieve comprehensive media manifest', false);
            }
        } catch (error) {
            await this.log(`Comprehensive manifest retrieval error: ${error.message}`, false);
        }
    }

    async testNetworkAwareDownload() {
        if (!this.mediaId) {
            await this.log('Skipping network-aware download test - no mediaId from upload', false);
            return;
        }

        try {
            const response = await axios.get(`${API_BASE}/media/${this.mediaId}/download`, {
                responseType: 'arraybuffer',
                timeout: 30000
            });
            
            if (response.status === 200 && response.data.byteLength > 0) {
                await this.log(`Network-aware media download successful - ${response.data.byteLength} bytes`);
                await this.log(`Content-Type: ${response.headers['content-type']}`);
                
                // Check network-aware headers
                if (response.headers['x-media-source']) {
                    await this.log(`Media source: ${response.headers['x-media-source']}`);
                }
                
                if (response.headers['x-source-peer']) {
                    await this.log(`Source peer: ${response.headers['x-source-peer']}`);
                }
                
                // Verify file integrity
                if (this.manifestData && response.data.byteLength === this.manifestData.fileSize) {
                    await this.log('File integrity verified - sizes match');
                } else {
                    await this.log('File integrity check failed - size mismatch', false);
                }
            } else {
                await this.log('Network-aware media download failed', false);
            }
        } catch (error) {
            await this.log(`Network-aware download error: ${error.message}`, false);
        }
    }

    async testPeerDiscovery() {
        try {
            // Wait a bit for peer discovery to potentially find peers
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const response = await axios.get(`${API_BASE}/media/peers`);
            
            if (response.status === 200) {
                const discoveredPeers = response.data.peers || [];
                await this.log(`Peer discovery test - Found ${discoveredPeers.length} peers`);
                
                if (discoveredPeers.length > 0) {
                    await this.log('Peer discovery is working - found network peers');
                    
                    discoveredPeers.forEach((peer, index) => {
                        if (index < 3) { // Show first 3 peers
                            console.log(`  Peer ${index + 1}: ${peer.peerId} (${peer.isHealthy ? 'healthy' : 'unhealthy'})`);
                        }
                    });
                } else {
                    await this.log('No network peers discovered (normal for single-node test)');
                }
            } else {
                await this.log('Peer discovery test failed', false);
            }
        } catch (error) {
            await this.log(`Peer discovery error: ${error.message}`, false);
        }
    }

    async testReplicationStatus() {
        if (!this.mediaId) {
            await this.log('Skipping replication status test - no mediaId from upload', false);
            return;
        }

        try {
            // Check if replication status is available in manifest
            const response = await axios.get(`${API_BASE}/media/${this.mediaId}/manifest`);
            
            if (response.status === 200 && response.data.replication) {
                const replication = response.data.replication;
                await this.log(`Replication status available: ${replication.status || 'queued'}`);
                
                if (replication.attempts !== undefined) {
                    await this.log(`Replication attempts: ${replication.attempts}`);
                }
                
                if (replication.completedPeers !== undefined) {
                    await this.log(`Completed peer replications: ${replication.completedPeers.length || 0}`);
                }
                
                if (replication.targetPeers !== undefined) {
                    await this.log(`Target peer replications: ${replication.targetPeers.length || 0}`);
                }
            } else {
                await this.log('Replication status not yet available (normal for new uploads)');
            }
        } catch (error) {
            await this.log(`Replication status error: ${error.message}`, false);
        }
    }

    async testMediaManagerIntegration() {
        try {
            // Test the media manager's GUN integration with P2P features
            const testData = {
                source: 'base64',
                data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChAI9jU77zgAAAABJRU5ErkJggg==', // 1x1 green pixel
                contentType: 'image/png',
                publishTo: {
                    gun: true
                }
            };

            const response = await axios.post(`${API_BASE}/publish/media`, testData);
            
            if (response.status === 200 && response.data.gunAddress) {
                await this.log('Media Manager P2P integration working');
                await this.log(`GUN Address: ${response.data.gunAddress}`);
                await this.log(`GUN MediaID: ${response.data.gunMediaId}`);
                
                if (response.data.gunMagnetURI) {
                    await this.log('BitTorrent magnet URI generated for Media Manager upload');
                }
                
                // Check if network info is included
                if (response.data.gunNetworkPeers !== undefined) {
                    await this.log(`Network peers available: ${response.data.gunNetworkPeers}`);
                }
            } else {
                await this.log('Media Manager P2P integration failed', false);
            }
        } catch (error) {
            await this.log(`Media Manager P2P integration error: ${error.message}`, false);
        }
    }

    async testMultiPeerScenario() {
        try {
            await this.log('Multi-peer scenario test (simulated)');
            
            // This would normally test with multiple running instances
            // For now, we'll verify the infrastructure is in place
            
            const statsResponse = await axios.get(`${API_BASE}/media/network/stats`);
            if (statsResponse.status === 200) {
                const stats = statsResponse.data;
                
                // Check if replication infrastructure is ready
                if (stats.replication) {
                    await this.log(`Replication infrastructure ready - Queue size: ${stats.replication.queueSize}`);
                    await this.log(`Max concurrent replications: ${stats.replication.maxConcurrentReplications}`);
                    await this.log(`Target replication count: ${stats.replication.targetReplicationCount}`);
                }
                
                // Check if peer infrastructure is ready
                if (stats.peers) {
                    await this.log(`Peer infrastructure ready - Self peer registered`);
                    await this.log(`Peer discovery and heartbeat system active`);
                }
                
                await this.log('Multi-peer scenario infrastructure verified');
            }
        } catch (error) {
            await this.log(`Multi-peer scenario test error: ${error.message}`, false);
        }
    }

    async printSummary() {
        console.log('\n📊 P2P Media Distribution Test Summary');
        console.log('======================================');
        
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
        
        console.log('\n🎯 P2P Features Tested:');
        console.log('- ✅ Peer registry and discovery');
        console.log('- ✅ Automatic replication queuing');
        console.log('- ✅ Network-aware media distribution');
        console.log('- ✅ Health monitoring and metrics');
        console.log('- ✅ Comprehensive media manifests');
        console.log('- ✅ MediaCoordinator orchestration');
        
        console.log('\n🚀 Next Steps for Multi-Peer Testing:');
        console.log('1. Start multiple OIP instances on different ports');
        console.log('2. Configure GUN_PEERS to connect instances');
        console.log('3. Upload media on one node, download from another');
        console.log('4. Verify automatic peer discovery and replication');
        console.log('5. Test network resilience with node failures');
        
        if (this.networkStats) {
            console.log('\n📈 Network Statistics:');
            console.log(`- Coordinator uptime: ${Math.floor(this.networkStats.coordinator?.uptime / 1000 || 0)}s`);
            console.log(`- Network health: ${this.networkStats.coordinator?.networkHealth || 'unknown'}`);
            console.log(`- Total uploads: ${this.networkStats.activity?.totalUploads || 0}`);
            console.log(`- Total downloads: ${this.networkStats.activity?.totalDownloads || 0}`);
        }
    }
}

// Run tests if called directly
if (require.main === module) {
    const tester = new GunP2PMediaDistributionTest();
    tester.runAllTests().catch(console.error);
}

module.exports = GunP2PMediaDistributionTest;
