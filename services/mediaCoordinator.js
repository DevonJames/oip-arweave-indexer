/**
 * Media Coordination Service
 * Orchestrates peer discovery, replication, and media availability across the network
 */

const crypto = require('crypto');
const MediaSeeder = require('./mediaSeeder');
const PeerRegistry = require('./peerRegistry');
const ReplicationManager = require('./replicationManager');
const EncryptionManager = require('./encryptionManager');
const MonitoringService = require('./monitoringService');
const MaintenanceService = require('./maintenanceService');

class MediaCoordinator {
    constructor() {
        this.mediaSeeder = new MediaSeeder();
        this.peerRegistry = new PeerRegistry();
        this.replicationManager = new ReplicationManager(this.mediaSeeder, this.peerRegistry);
        this.encryptionManager = new EncryptionManager();
        this.monitoringService = new MonitoringService();
        this.maintenanceService = null; // Initialized after other services
        
        this.initialized = false;
        this.stats = {
            startTime: Date.now(),
            totalUploads: 0,
            totalDownloads: 0,
            totalReplications: 0,
            totalEncryptions: 0,
            networkHealth: 'unknown'
        };
        
        // Event handlers
        this.setupEventHandlers();
    }

    async initialize() {
        try {
            console.log('🚀 Initializing Media Coordinator...');
            
            // Initialize components in order
            const seederReady = await this.mediaSeeder.initialize();
            if (!seederReady) {
                throw new Error('MediaSeeder failed to initialize');
            }
            
            const registryReady = await this.peerRegistry.initialize();
            if (!registryReady) {
                throw new Error('PeerRegistry failed to initialize');
            }
            
            const replicationReady = await this.replicationManager.initialize();
            if (!replicationReady) {
                throw new Error('ReplicationManager failed to initialize');
            }
            
            // Initialize maintenance service (depends on other services)
            this.maintenanceService = new MaintenanceService(this, this.monitoringService);
            
            this.initialized = true;
            this.stats.networkHealth = 'healthy';
            
            console.log('✅ Media Coordinator initialized successfully');
            
            // Start monitoring and setup health checks
            this.setupMonitoringIntegration();
            this.startHealthMonitoring();
            
            return true;
        } catch (error) {
            console.error('❌ Failed to initialize Media Coordinator:', error);
            this.stats.networkHealth = 'error';
            return false;
        }
    }

    setupEventHandlers() {
        // Handle graceful shutdown
        process.on('SIGTERM', () => this.shutdown());
        process.on('SIGINT', () => this.shutdown());
    }

    /**
     * Upload and seed media with automatic replication and optional encryption
     */
    async uploadMedia(fileBuffer, originalName, contentType, options = {}) {
        const uploadTimer = this.monitoringService.startTimer('upload_duration_seconds');
        
        try {
            if (!this.initialized) {
                throw new Error('Media Coordinator not initialized');
            }

            console.log(`📤 Uploading media: ${originalName} (${fileBuffer.length} bytes)`);
            
            let processedBuffer = fileBuffer;
            let encryptionInfo = null;
            
            // Handle encryption if requested
            if (options.encrypt && options.recipients && options.recipients.length > 0) {
                console.log('🔐 Encrypting media before upload...');
                
                const keyInfo = await this.encryptionManager.generateMediaKey(
                    crypto.createHash('sha256').update(fileBuffer).digest('hex'),
                    {
                        recipients: options.recipients,
                        accessLevel: options.accessLevel || 'private',
                        expiresAt: options.expiresAt
                    }
                );
                
                const encryptedData = await this.encryptionManager.encryptMedia(
                    fileBuffer, 
                    keyInfo.mediaId, 
                    keyInfo
                );
                
                processedBuffer = encryptedData.encryptedBuffer;
                encryptionInfo = encryptedData.encryptionInfo;
                
                this.stats.totalEncryptions++;
                this.monitoringService.incrementCounter('encryption_operations_total');
            }
            
            // Add to local seeder
            const mediaInfo = await this.mediaSeeder.addMedia(processedBuffer, originalName, contentType);
            this.stats.totalUploads++;
            this.monitoringService.incrementCounter('media_uploads_total');
            this.monitoringService.observeHistogram('file_size_bytes', fileBuffer.length);
            
            // Auto-replicate if enabled (default: true)
            const shouldReplicate = options.replicate !== false;
            const replicationPriority = options.priority || 5;
            
            if (shouldReplicate) {
                await this.replicationManager.queueForReplication(
                    mediaInfo.mediaId,
                    {
                        mediaId: mediaInfo.mediaId,
                        fileName: originalName,
                        contentType,
                        fileSize: encryptionInfo ? encryptionInfo.originalSize : mediaInfo.fileSize,
                        encrypted: !!encryptionInfo,
                        encryptionInfo,
                        transport: {
                            bittorrent: {
                                infoHash: mediaInfo.infoHash,
                                magnetURI: mediaInfo.magnetURI,
                                trackers: mediaInfo.trackers
                            }
                        },
                        createdAt: new Date().toISOString()
                    },
                    replicationPriority
                );
            }
            
            const duration = uploadTimer.end();
            console.log(`✅ Upload completed in ${duration.toFixed(2)}s`);
            
            return {
                ...mediaInfo,
                replicationQueued: shouldReplicate,
                encrypted: !!encryptionInfo,
                encryptionInfo,
                coordinator: {
                    peerId: this.peerRegistry.peerId,
                    networkPeers: this.peerRegistry.getAllPeers().length
                }
            };
            
        } catch (error) {
            uploadTimer.end();
            console.error('Upload media error:', error);
            throw error;
        }
    }

    /**
     * Download media with peer fallback
     */
    async downloadMedia(mediaId) {
        try {
            if (!this.initialized) {
                throw new Error('Media Coordinator not initialized');
            }

            console.log(`📥 Downloading media: ${mediaId}`);
            
            // Try local first
            const localFile = await this.mediaSeeder.getMediaFile(mediaId);
            if (localFile) {
                this.stats.totalDownloads++;
                return {
                    ...localFile,
                    source: 'local',
                    peerId: this.peerRegistry.peerId
                };
            }
            
            // Find peers that have this media
            const availablePeers = await this.peerRegistry.requestMediaFromPeers(mediaId);
            
            if (availablePeers.length === 0) {
                throw new Error(`Media ${mediaId} not found on any peer`);
            }
            
            console.log(`🔍 Found ${availablePeers.length} peers with media ${mediaId}`);
            
            // Try downloading from the first available peer
            for (const peer of availablePeers) {
                try {
                    const magnetURI = peer.manifest.transport?.bittorrent?.magnetURI;
                    if (magnetURI) {
                        console.log(`⬇️ Downloading from peer ${peer.peerId} via BitTorrent`);
                        
                        const downloadResult = await this.mediaSeeder.downloadFromPeer(magnetURI);
                        const fileData = await this.mediaSeeder.getMediaFile(downloadResult.mediaId);
                        
                        if (fileData) {
                            this.stats.totalDownloads++;
                            return {
                                ...fileData,
                                source: 'peer',
                                sourcePeerId: peer.peerId,
                                downloadedMediaId: downloadResult.mediaId
                            };
                        }
                    }
                } catch (peerError) {
                    console.warn(`Failed to download from peer ${peer.peerId}:`, peerError.message);
                    continue;
                }
            }
            
            throw new Error(`Failed to download ${mediaId} from any peer`);
            
        } catch (error) {
            console.error('Download media error:', error);
            throw error;
        }
    }

    /**
     * Get comprehensive media information including network availability
     */
    async getMediaInfo(mediaId) {
        try {
            // Get local info
            const localInfo = this.mediaSeeder.getMediaInfo(mediaId);
            
            // Get peer availability
            const availablePeers = await this.peerRegistry.requestMediaFromPeers(mediaId);
            
            // Get replication status
            const replicationStatus = this.replicationManager.getReplicationStatus(mediaId);
            
            return {
                mediaId,
                local: localInfo ? {
                    ...localInfo,
                    peerId: this.peerRegistry.peerId
                } : null,
                network: {
                    availablePeers: availablePeers.length,
                    peers: availablePeers.map(p => ({
                        peerId: p.peerId,
                        apiEndpoint: p.apiEndpoint,
                        lastSeen: p.lastSeen
                    }))
                },
                replication: replicationStatus || null,
                availability: {
                    local: !!localInfo,
                    network: availablePeers.length > 0,
                    totalCopies: (localInfo ? 1 : 0) + availablePeers.length
                }
            };
            
        } catch (error) {
            console.error('Get media info error:', error);
            throw error;
        }
    }

    setupMonitoringIntegration() {
        // Register health checks
        this.monitoringService.registerHealthCheck('media_seeder', async () => {
            const stats = this.mediaSeeder.getStats();
            return {
                status: stats.totalTorrents >= 0 ? 'healthy' : 'unhealthy',
                message: `Seeding ${stats.totalTorrents} torrents`,
                data: stats
            };
        });

        this.monitoringService.registerHealthCheck('peer_registry', async () => {
            const stats = this.peerRegistry.getPeerStats();
            return {
                status: stats.totalPeers >= 0 ? 'healthy' : 'unhealthy',
                message: `${stats.healthyPeers}/${stats.totalPeers} healthy peers`,
                data: stats
            };
        });

        this.monitoringService.registerHealthCheck('replication_manager', async () => {
            const stats = this.replicationManager.getReplicationStats();
            return {
                status: stats.queueSize < 100 ? 'healthy' : 'degraded',
                message: `${stats.queueSize} items in replication queue`,
                data: stats
            };
        });

        // Create monitoring alerts
        this.monitoringService.createAlert('high_replication_queue', {
            condition: () => this.replicationManager.getReplicationStats().queueSize > 50,
            message: 'Replication queue is backing up',
            severity: 'warning',
            cooldownMs: 600000 // 10 minutes
        });

        this.monitoringService.createAlert('no_healthy_peers', {
            condition: () => this.peerRegistry.getPeerStats().healthyPeers === 0,
            message: 'No healthy peers available for replication',
            severity: 'error',
            cooldownMs: 300000 // 5 minutes
        });

        console.log('📊 Monitoring integration configured');
    }

    startHealthMonitoring() {
        // Monitor network health every minute
        setInterval(() => {
            this.updateNetworkHealth();
            this.updateMonitoringMetrics();
        }, 60000);
        
        console.log('💊 Started health monitoring');
    }

    updateMonitoringMetrics() {
        // Update gauge metrics
        const peerStats = this.peerRegistry.getPeerStats();
        const replicationStats = this.replicationManager.getReplicationStats();
        const seederStats = this.mediaSeeder.getStats();
        
        this.monitoringService.setGauge('active_peers', peerStats.healthyPeers);
        this.monitoringService.setGauge('seeding_torrents', seederStats.totalTorrents);
        this.monitoringService.setGauge('replication_queue_size', replicationStats.queueSize);
    }

    updateNetworkHealth() {
        try {
            const peerStats = this.peerRegistry.getPeerStats();
            const replicationStats = this.replicationManager.getReplicationStats();
            const seederStats = this.mediaSeeder.getStats();
            
            // Simple health calculation
            let healthScore = 100;
            
            // Deduct points for issues
            if (peerStats.healthyPeers === 0) healthScore -= 30;
            if (replicationStats.queueSize > 10) healthScore -= 20;
            if (seederStats.totalTorrents === 0) healthScore -= 10;
            
            // Determine health status
            if (healthScore >= 80) this.stats.networkHealth = 'healthy';
            else if (healthScore >= 60) this.stats.networkHealth = 'degraded';
            else this.stats.networkHealth = 'unhealthy';
            
        } catch (error) {
            console.warn('Health monitoring error:', error);
            this.stats.networkHealth = 'unknown';
        }
    }

    getNetworkStats() {
        if (!this.initialized) {
            return { error: 'Not initialized' };
        }

        const peerStats = this.peerRegistry.getPeerStats();
        const replicationStats = this.replicationManager.getReplicationStats();
        const seederStats = this.mediaSeeder.getStats();
        
        return {
            coordinator: {
                initialized: this.initialized,
                uptime: Date.now() - this.stats.startTime,
                networkHealth: this.stats.networkHealth
            },
            peers: peerStats,
            replication: replicationStats,
            seeder: seederStats,
            activity: {
                totalUploads: this.stats.totalUploads,
                totalDownloads: this.stats.totalDownloads,
                totalReplications: this.stats.totalReplications
            }
        };
    }

    getHealthStatus() {
        return {
            status: this.initialized ? 'healthy' : 'initializing',
            networkHealth: this.stats.networkHealth,
            components: {
                mediaSeeder: this.mediaSeeder ? 'ready' : 'not_ready',
                peerRegistry: this.peerRegistry ? 'ready' : 'not_ready',
                replicationManager: this.replicationManager ? 'ready' : 'not_ready',
                encryptionManager: this.encryptionManager ? 'ready' : 'not_ready',
                monitoringService: this.monitoringService ? 'ready' : 'not_ready',
                maintenanceService: this.maintenanceService ? 'ready' : 'not_ready'
            },
            timestamp: new Date().toISOString()
        };
    }

    getMonitoringMetrics() {
        return this.monitoringService ? this.monitoringService.getMetrics() : {};
    }

    getPrometheusMetrics() {
        return this.monitoringService ? this.monitoringService.generatePrometheusMetrics() : '';
    }

    getActiveAlerts() {
        return this.monitoringService ? this.monitoringService.getActiveAlerts() : [];
    }

    getMaintenanceStatus() {
        return this.maintenanceService ? this.maintenanceService.getMaintenanceStatus() : {};
    }

    getEncryptionStats() {
        return this.encryptionManager ? this.encryptionManager.getEncryptionStats() : {};
    }

    async runMaintenanceTask(taskName) {
        if (!this.maintenanceService) {
            throw new Error('Maintenance service not available');
        }
        return await this.maintenanceService.runTaskNow(taskName);
    }

    async checkMediaAccess(mediaId, userPublicKey) {
        if (!this.encryptionManager) {
            return true; // No encryption = public access
        }
        return await this.encryptionManager.checkAccess(mediaId, userPublicKey);
    }

    async shutdown() {
        console.log('🔄 Shutting down Media Coordinator...');
        
        if (this.replicationManager) {
            await this.replicationManager.shutdown();
        }
        
        if (this.peerRegistry) {
            await this.peerRegistry.shutdown();
        }
        
        if (this.mediaSeeder) {
            await this.mediaSeeder.shutdown();
        }
        
        this.initialized = false;
        console.log('✅ Media Coordinator shutdown complete');
    }
}

module.exports = MediaCoordinator;
