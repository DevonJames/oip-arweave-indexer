/**
 * Media Routes for GUN-based P2P Media Distribution
 * Handles upload, download, and torrent management
 */

const express = require('express');
const multer = require('multer');
const MediaCoordinator = require('../services/mediaCoordinator');
const gunHelper = require('../helpers/gun');

const router = express.Router();

// Initialize MediaCoordinator
const mediaCoordinator = new MediaCoordinator();
let coordinatorReady = false;

// Initialize coordinator on startup
mediaCoordinator.initialize().then((success) => {
    coordinatorReady = success;
    if (success) {
        console.log('MediaCoordinator ready for requests');
    } else {
        console.error('MediaCoordinator failed to initialize');
    }
});

// Configure multer for file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB limit
    }
});

/**
 * Upload media file and create torrent
 * POST /media/upload
 */
router.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!coordinatorReady) {
            return res.status(503).json({ error: 'MediaCoordinator not ready' });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'No file provided' });
        }

        const { buffer, originalname, mimetype } = req.file;
        const { 
            encrypt, 
            recipients, 
            replicate = true, 
            priority = 5,
            accessLevel = 'private',
            expiresAt
        } = req.body;

        // Upload through coordinator (handles seeding + replication + encryption)
        const uploadOptions = {
            replicate: replicate !== 'false' && replicate !== false,
            priority: parseInt(priority) || 5,
            encrypt: !!encrypt,
            recipients: recipients ? JSON.parse(recipients) : null,
            accessLevel: accessLevel || 'private',
            expiresAt: expiresAt ? new Date(expiresAt).getTime() : null
        };

        const mediaInfo = await mediaCoordinator.uploadMedia(buffer, originalname, mimetype, uploadOptions);

        // Create media manifest for GUN storage
        const manifest = {
            mediaId: mediaInfo.mediaId,
            fileName: originalname,
            contentType: mimetype,
            fileSize: mediaInfo.fileSize,
            transport: {
                bittorrent: {
                    infoHash: mediaInfo.infoHash,
                    magnetURI: mediaInfo.magnetURI,
                    trackers: mediaInfo.trackers
                }
            },
            createdAt: new Date().toISOString(),
            encrypted: !!encrypt,
            replicationQueued: mediaInfo.replicationQueued
        };

        // Store manifest in GUN
        try {
            await gunHelper.storeMediaManifest(mediaInfo.mediaId, manifest);
            console.log(`Stored media manifest in GUN: ${mediaInfo.mediaId}`);
        } catch (gunError) {
            console.warn('Failed to store manifest in GUN:', gunError);
            // Continue anyway - local seeding still works
        }

        res.json({
            success: true,
            mediaId: mediaInfo.mediaId,
            manifest,
            torrent: {
                infoHash: mediaInfo.infoHash,
                magnetURI: mediaInfo.magnetURI
            },
            network: {
                peerId: mediaInfo.coordinator.peerId,
                networkPeers: mediaInfo.coordinator.networkPeers,
                replicationQueued: mediaInfo.replicationQueued
            }
        });

    } catch (error) {
        console.error('Media upload error:', error);
        res.status(500).json({ 
            error: 'Upload failed',
            details: error.message 
        });
    }
});

/**
 * Get media manifest
 * GET /media/:mediaId/manifest
 */
router.get('/:mediaId/manifest', async (req, res) => {
    try {
        const { mediaId } = req.params;

        if (!coordinatorReady) {
            return res.status(503).json({ error: 'MediaCoordinator not ready' });
        }

        // Get comprehensive media info from coordinator
        const mediaInfo = await mediaCoordinator.getMediaInfo(mediaId);
        
        if (!mediaInfo.local && mediaInfo.network.availablePeers === 0) {
            // Try to get from GUN network as fallback
            try {
                const gunManifest = await gunHelper.getMediaManifest(mediaId);
                if (gunManifest) {
                    return res.json({
                        ...gunManifest,
                        availability: {
                            local: false,
                            network: false,
                            gun: true
                        }
                    });
                }
            } catch (gunError) {
                console.warn('Failed to get manifest from GUN:', gunError);
            }
            
            return res.status(404).json({ error: 'Media not found' });
        }

        // Build comprehensive manifest
        const manifest = {
            mediaId,
            fileName: mediaInfo.local?.fileName || `media_${mediaId}`,
            contentType: mediaInfo.local?.contentType || 'application/octet-stream',
            fileSize: mediaInfo.local?.fileSize || 0,
            transport: mediaInfo.local ? {
                bittorrent: {
                    infoHash: mediaInfo.local.infoHash,
                    magnetURI: mediaInfo.local.magnetURI,
                    trackers: mediaInfo.local.trackers || []
                }
            } : null,
            availability: mediaInfo.availability,
            network: {
                availablePeers: mediaInfo.network.availablePeers,
                peers: mediaInfo.network.peers
            },
            replication: mediaInfo.replication
        };

        res.json(manifest);

    } catch (error) {
        console.error('Get manifest error:', error);
        res.status(500).json({ 
            error: 'Failed to get manifest',
            details: error.message 
        });
    }
});

/**
 * Download media file
 * GET /media/:mediaId/download
 */
router.get('/:mediaId/download', async (req, res) => {
    try {
        const { mediaId } = req.params;

        if (!coordinatorReady) {
            return res.status(503).json({ error: 'MediaCoordinator not ready' });
        }

        // Download through coordinator (handles local + peer fallback)
        const fileData = await mediaCoordinator.downloadMedia(mediaId);
        
        if (!fileData) {
            return res.status(404).json({ error: 'Media not found or unavailable' });
        }

        res.set({
            'Content-Type': fileData.contentType,
            'Content-Length': fileData.buffer.length,
            'Content-Disposition': `attachment; filename="${fileData.fileName}"`,
            'X-Media-Source': fileData.source,
            'X-Source-Peer': fileData.sourcePeerId || fileData.peerId
        });
        
        return res.send(fileData.buffer);

    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ 
            error: 'Download failed',
            details: error.message 
        });
    }
});

/**
 * List locally seeded media
 * GET /media/seeding
 */
router.get('/seeding', async (req, res) => {
    try {
        if (!seederReady) {
            return res.status(503).json({ error: 'MediaSeeder not ready' });
        }

        const seedingList = mediaSeeder.listSeeding();
        const stats = mediaSeeder.getStats();

        res.json({
            stats,
            seeding: seedingList
        });

    } catch (error) {
        console.error('List seeding error:', error);
        res.status(500).json({ 
            error: 'Failed to list seeding',
            details: error.message 
        });
    }
});

/**
 * Download media from magnet URI
 * POST /media/download-magnet
 */
router.post('/download-magnet', async (req, res) => {
    try {
        if (!seederReady) {
            return res.status(503).json({ error: 'MediaSeeder not ready' });
        }

        const { magnetURI } = req.body;
        if (!magnetURI) {
            return res.status(400).json({ error: 'magnetURI required' });
        }

        const downloadResult = await mediaSeeder.downloadFromPeer(magnetURI);
        
        res.json({
            success: true,
            mediaId: downloadResult.mediaId,
            fileSize: downloadResult.fileSize,
            infoHash: downloadResult.infoHash
        });

    } catch (error) {
        console.error('Magnet download error:', error);
        res.status(500).json({ 
            error: 'Magnet download failed',
            details: error.message 
        });
    }
});

/**
 * Health check for media service
 * GET /media/health
 */
router.get('/health', async (req, res) => {
    try {
        if (!coordinatorReady) {
            return res.json({
                status: 'initializing',
                coordinator: false,
                timestamp: new Date().toISOString()
            });
        }

        const healthStatus = mediaCoordinator.getHealthStatus();
        res.json(healthStatus);

    } catch (error) {
        console.error('Health check error:', error);
        res.status(500).json({ 
            status: 'error',
            error: error.message 
        });
    }
});

/**
 * Get network statistics
 * GET /media/network/stats
 */
router.get('/network/stats', async (req, res) => {
    try {
        if (!coordinatorReady) {
            return res.status(503).json({ error: 'MediaCoordinator not ready' });
        }

        const networkStats = mediaCoordinator.getNetworkStats();
        res.json(networkStats);

    } catch (error) {
        console.error('Network stats error:', error);
        res.status(500).json({ 
            error: 'Failed to get network stats',
            details: error.message 
        });
    }
});

/**
 * Get peer information
 * GET /media/peers
 */
router.get('/peers', async (req, res) => {
    try {
        if (!coordinatorReady) {
            return res.status(503).json({ error: 'MediaCoordinator not ready' });
        }

        const peers = mediaCoordinator.peerRegistry.getAllPeers();
        const stats = mediaCoordinator.peerRegistry.getPeerStats();
        
        res.json({
            self: {
                peerId: stats.selfPeerId,
                uptime: stats.uptime,
                capabilities: stats.capabilities
            },
            peers: peers,
            summary: {
                totalPeers: stats.totalPeers,
                healthyPeers: stats.healthyPeers,
                lastHeartbeat: stats.lastHeartbeat
            }
        });

    } catch (error) {
        console.error('Get peers error:', error);
        res.status(500).json({ 
            error: 'Failed to get peers',
            details: error.message 
        });
    }
});

/**
 * Get Prometheus metrics
 * GET /media/metrics
 */
router.get('/metrics', async (req, res) => {
    try {
        if (!coordinatorReady) {
            return res.status(503).json({ error: 'MediaCoordinator not ready' });
        }

        const prometheusMetrics = mediaCoordinator.getPrometheusMetrics();
        res.set('Content-Type', 'text/plain');
        res.send(prometheusMetrics);

    } catch (error) {
        console.error('Metrics error:', error);
        res.status(500).json({ 
            error: 'Failed to get metrics',
            details: error.message 
        });
    }
});

/**
 * Get monitoring metrics (JSON format)
 * GET /media/monitoring/metrics
 */
router.get('/monitoring/metrics', async (req, res) => {
    try {
        if (!coordinatorReady) {
            return res.status(503).json({ error: 'MediaCoordinator not ready' });
        }

        const metrics = mediaCoordinator.getMonitoringMetrics();
        res.json(metrics);

    } catch (error) {
        console.error('Monitoring metrics error:', error);
        res.status(500).json({ 
            error: 'Failed to get monitoring metrics',
            details: error.message 
        });
    }
});

/**
 * Get active alerts
 * GET /media/monitoring/alerts
 */
router.get('/monitoring/alerts', async (req, res) => {
    try {
        if (!coordinatorReady) {
            return res.status(503).json({ error: 'MediaCoordinator not ready' });
        }

        const alerts = mediaCoordinator.getActiveAlerts();
        res.json({
            alerts,
            count: alerts.length,
            timestamp: Date.now()
        });

    } catch (error) {
        console.error('Alerts error:', error);
        res.status(500).json({ 
            error: 'Failed to get alerts',
            details: error.message 
        });
    }
});

/**
 * Get maintenance status
 * GET /media/maintenance/status
 */
router.get('/maintenance/status', async (req, res) => {
    try {
        if (!coordinatorReady) {
            return res.status(503).json({ error: 'MediaCoordinator not ready' });
        }

        const maintenanceStatus = mediaCoordinator.getMaintenanceStatus();
        res.json(maintenanceStatus);

    } catch (error) {
        console.error('Maintenance status error:', error);
        res.status(500).json({ 
            error: 'Failed to get maintenance status',
            details: error.message 
        });
    }
});

/**
 * Run maintenance task
 * POST /media/maintenance/run/:taskName
 */
router.post('/maintenance/run/:taskName', async (req, res) => {
    try {
        if (!coordinatorReady) {
            return res.status(503).json({ error: 'MediaCoordinator not ready' });
        }

        const { taskName } = req.params;
        const result = await mediaCoordinator.runMaintenanceTask(taskName);
        
        res.json({
            success: true,
            taskName,
            result,
            timestamp: Date.now()
        });

    } catch (error) {
        console.error('Run maintenance task error:', error);
        res.status(500).json({ 
            error: 'Failed to run maintenance task',
            details: error.message 
        });
    }
});

/**
 * Get encryption statistics
 * GET /media/encryption/stats
 */
router.get('/encryption/stats', async (req, res) => {
    try {
        if (!coordinatorReady) {
            return res.status(503).json({ error: 'MediaCoordinator not ready' });
        }

        const encryptionStats = mediaCoordinator.getEncryptionStats();
        res.json(encryptionStats);

    } catch (error) {
        console.error('Encryption stats error:', error);
        res.status(500).json({ 
            error: 'Failed to get encryption stats',
            details: error.message 
        });
    }
});

/**
 * Check media access permission
 * POST /media/:mediaId/check-access
 */
router.post('/:mediaId/check-access', async (req, res) => {
    try {
        if (!coordinatorReady) {
            return res.status(503).json({ error: 'MediaCoordinator not ready' });
        }

        const { mediaId } = req.params;
        const { userPublicKey } = req.body;

        if (!userPublicKey) {
            return res.status(400).json({ error: 'userPublicKey required' });
        }

        const hasAccess = await mediaCoordinator.checkMediaAccess(mediaId, userPublicKey);
        
        res.json({
            mediaId,
            hasAccess,
            userPublicKey: userPublicKey.slice(0, 16) + '...', // Partial key for security
            timestamp: Date.now()
        });

    } catch (error) {
        console.error('Check access error:', error);
        res.status(500).json({ 
            error: 'Failed to check access',
            details: error.message 
        });
    }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    if (coordinatorReady) {
        await mediaCoordinator.shutdown();
    }
});

process.on('SIGINT', async () => {
    if (coordinatorReady) {
        await mediaCoordinator.shutdown();
    }
});

module.exports = router;
