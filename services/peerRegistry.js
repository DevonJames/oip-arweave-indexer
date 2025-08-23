/**
 * Peer Registry and Discovery Service
 * Manages peer registration, discovery, and health monitoring using GUN
 */

const { GunHelper } = require('../helpers/gun');
const crypto = require('crypto');
const os = require('os');

class PeerRegistry {
    constructor() {
        this.gunHelper = new GunHelper();
        this.peerId = this.generatePeerId();
        this.peerInfo = this.generatePeerInfo();
        this.discoveredPeers = new Map(); // peerId -> peerInfo
        this.heartbeatInterval = null;
        this.discoveryInterval = null;
        this.healthyPeers = new Set();
        
        // Configuration
        this.heartbeatIntervalMs = 30000; // 30 seconds
        this.discoveryIntervalMs = 60000; // 1 minute
        this.peerTimeoutMs = 120000; // 2 minutes
        this.maxPeers = 50; // Maximum peers to track
    }

    generatePeerId() {
        // Generate unique peer ID based on hostname and random data
        const hostname = os.hostname();
        const random = crypto.randomBytes(8).toString('hex');
        const timestamp = Date.now().toString(36);
        return `peer_${hostname}_${timestamp}_${random}`;
    }

    generatePeerInfo() {
        const networkInterfaces = os.networkInterfaces();
        const addresses = [];
        
        // Get all network addresses
        Object.values(networkInterfaces).forEach(interfaces => {
            interfaces.forEach(iface => {
                if (!iface.internal && iface.family === 'IPv4') {
                    addresses.push(iface.address);
                }
            });
        });

        return {
            peerId: this.peerId,
            hostname: os.hostname(),
            platform: os.platform(),
            arch: os.arch(),
            addresses: addresses,
            port: process.env.PORT || 3005,
            apiEndpoint: `http://${addresses[0] || 'localhost'}:${process.env.PORT || 3005}/api`,
            capabilities: {
                seeding: true,
                downloading: true,
                relay: true,
                encryption: true
            },
            version: '1.0.0',
            startedAt: Date.now(),
            lastSeen: Date.now(),
            status: 'online'
        };
    }

    async initialize() {
        try {
            console.log(`🌐 Initializing Peer Registry - PeerID: ${this.peerId}`);
            
            // Register ourselves in GUN
            await this.registerSelf();
            
            // Start heartbeat and discovery
            this.startHeartbeat();
            this.startDiscovery();
            
            console.log('✅ Peer Registry initialized successfully');
            return true;
        } catch (error) {
            console.error('❌ Failed to initialize Peer Registry:', error);
            return false;
        }
    }

    async registerSelf() {
        try {
            const result = await this.gunHelper.registerPeer(this.peerId, this.peerInfo);
            console.log(`📝 Registered peer in GUN: ${result.did}`);
            return result;
        } catch (error) {
            console.error('Failed to register peer:', error);
            throw error;
        }
    }

    async updateHeartbeat() {
        try {
            // Update our last seen timestamp
            this.peerInfo.lastSeen = Date.now();
            this.peerInfo.status = 'online';
            
            await this.gunHelper.registerPeer(this.peerId, this.peerInfo);
            
            // Clean up stale peer data
            await this.cleanupStalePeers();
            
        } catch (error) {
            console.warn('Heartbeat update failed:', error.message);
        }
    }

    async discoverPeers() {
        try {
            // Query GUN for all peers with recent activity
            const allPeers = await this.queryActivePeers();
            
            let newPeersFound = 0;
            for (const peerData of allPeers) {
                if (peerData.peerId !== this.peerId && !this.discoveredPeers.has(peerData.peerId)) {
                    this.discoveredPeers.set(peerData.peerId, peerData);
                    newPeersFound++;
                    
                    // Test connectivity to new peer
                    await this.testPeerConnectivity(peerData);
                }
            }
            
            if (newPeersFound > 0) {
                console.log(`🔍 Discovered ${newPeersFound} new peers`);
            }
            
        } catch (error) {
            console.warn('Peer discovery failed:', error.message);
        }
    }

    async queryActivePeers() {
        // This is a simplified implementation
        // In a real implementation, we'd query GUN for all peer: souls
        try {
            const activePeers = [];
            const cutoffTime = Date.now() - this.peerTimeoutMs;
            
            // For now, we'll simulate querying by checking known peer patterns
            // In production, this would use GUN's graph traversal capabilities
            
            return activePeers;
        } catch (error) {
            console.warn('Failed to query active peers:', error);
            return [];
        }
    }

    async testPeerConnectivity(peerData) {
        try {
            const axios = require('axios');
            const healthUrl = `${peerData.apiEndpoint}/media/health`;
            
            const response = await axios.get(healthUrl, { timeout: 5000 });
            
            if (response.status === 200) {
                this.healthyPeers.add(peerData.peerId);
                console.log(`✅ Peer ${peerData.peerId} is healthy`);
                return true;
            }
        } catch (error) {
            this.healthyPeers.delete(peerData.peerId);
            console.warn(`❌ Peer ${peerData.peerId} connectivity test failed:`, error.message);
            return false;
        }
    }

    async cleanupStalePeers() {
        const cutoffTime = Date.now() - this.peerTimeoutMs;
        const stalePeers = [];
        
        for (const [peerId, peerData] of this.discoveredPeers.entries()) {
            if (peerData.lastSeen < cutoffTime) {
                stalePeers.push(peerId);
            }
        }
        
        stalePeers.forEach(peerId => {
            this.discoveredPeers.delete(peerId);
            this.healthyPeers.delete(peerId);
        });
        
        if (stalePeers.length > 0) {
            console.log(`🧹 Cleaned up ${stalePeers.length} stale peers`);
        }
    }

    startHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        
        this.heartbeatInterval = setInterval(() => {
            this.updateHeartbeat();
        }, this.heartbeatIntervalMs);
        
        console.log(`💓 Started heartbeat (${this.heartbeatIntervalMs}ms interval)`);
    }

    startDiscovery() {
        if (this.discoveryInterval) {
            clearInterval(this.discoveryInterval);
        }
        
        this.discoveryInterval = setInterval(() => {
            this.discoverPeers();
        }, this.discoveryIntervalMs);
        
        console.log(`🔍 Started peer discovery (${this.discoveryIntervalMs}ms interval)`);
    }

    getHealthyPeers() {
        return Array.from(this.healthyPeers).map(peerId => {
            const peerData = this.discoveredPeers.get(peerId);
            return {
                peerId,
                ...peerData,
                isHealthy: true,
                lastChecked: Date.now()
            };
        });
    }

    getAllPeers() {
        return Array.from(this.discoveredPeers.entries()).map(([peerId, peerData]) => ({
            peerId,
            ...peerData,
            isHealthy: this.healthyPeers.has(peerId),
            lastChecked: Date.now()
        }));
    }

    getPeerStats() {
        return {
            selfPeerId: this.peerId,
            totalPeers: this.discoveredPeers.size,
            healthyPeers: this.healthyPeers.size,
            uptime: Date.now() - this.peerInfo.startedAt,
            lastHeartbeat: this.peerInfo.lastSeen,
            capabilities: this.peerInfo.capabilities
        };
    }

    async requestMediaFromPeers(mediaId) {
        const healthyPeers = this.getHealthyPeers();
        const availablePeers = [];
        
        for (const peer of healthyPeers) {
            try {
                const axios = require('axios');
                const manifestUrl = `${peer.apiEndpoint}/media/${mediaId}/manifest`;
                
                const response = await axios.get(manifestUrl, { timeout: 5000 });
                
                if (response.status === 200 && response.data.mediaId === mediaId) {
                    availablePeers.push({
                        ...peer,
                        manifest: response.data
                    });
                }
            } catch (error) {
                // Peer doesn't have this media, continue
            }
        }
        
        return availablePeers;
    }

    async shutdown() {
        console.log('🔄 Shutting down Peer Registry...');
        
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        
        if (this.discoveryInterval) {
            clearInterval(this.discoveryInterval);
        }
        
        // Mark ourselves as offline
        try {
            this.peerInfo.status = 'offline';
            this.peerInfo.lastSeen = Date.now();
            await this.gunHelper.registerPeer(this.peerId, this.peerInfo);
        } catch (error) {
            console.warn('Failed to update offline status:', error);
        }
        
        console.log('✅ Peer Registry shutdown complete');
    }
}

module.exports = PeerRegistry;
