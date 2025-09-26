const express = require('express');
const router = express.Router();

router.get('/', async (req, res) => {
    // console.log('GET /api/health');
    try {
        console.log(`Health check passed at: ${new Date().toISOString()}`);
        // add more checks here (e.g., database connection status)
        res.status(200).json({ status: 'OK' });
    } catch (error) {
        console.error('Health check failed:', error);
        res.status(500).json({ error: 'Health check failed' });
    }
});

// GUN Sync Service health check
router.get('/gun-sync', async (req, res) => {
    try {
        // Check if sync service is available
        if (!global.gunSyncService) {
            return res.status(503).json({
                service: 'gun-sync',
                status: 'unavailable',
                message: 'GUN Sync Service not initialized'
            });
        }
        
        const status = global.gunSyncService.getStatus();
        const healthMonitor = global.gunSyncService.getHealthMonitor();
        const healthStatus = healthMonitor.getHealthStatus();
        
        // Get registry statistics
        const registryStats = await global.gunSyncService.registry.getRegistryStats();
        
        const response = {
            service: 'gun-sync',
            status: healthStatus.isHealthy ? 'healthy' : 'unhealthy',
            running: status.isRunning,
            nodeId: status.nodeId,
            metrics: {
                totalDiscovered: healthStatus.totalDiscovered,
                totalSynced: healthStatus.totalSynced,
                totalErrors: healthStatus.totalErrors,
                successRate: healthStatus.successRate + '%',
                lastSyncTime: healthStatus.lastSyncTime,
                lastSyncAgo: healthStatus.lastSyncAgo ? `${Math.round(healthStatus.lastSyncAgo / 1000)}s ago` : 'never',
                averageSyncTime: Math.round(healthStatus.averageSyncTime) + 'ms',
                syncCycles: healthStatus.syncCycles
            },
            configuration: status.configuration,
            registry: registryStats
        };
        
        res.json(response);
        
    } catch (error) {
        console.error('Error getting GUN sync health:', error);
        res.status(500).json({
            service: 'gun-sync',
            status: 'error',
            error: error.message
        });
    }
});

// Force a sync cycle
router.post('/gun-sync/force', async (req, res) => {
    try {
        if (!global.gunSyncService) {
            return res.status(503).json({
                error: 'GUN Sync Service not available'
            });
        }
        
        if (!global.gunSyncService.isRunning) {
            return res.status(400).json({
                error: 'GUN Sync Service is not running'
            });
        }
        
        // Trigger immediate sync
        await global.gunSyncService.forceSync();
        
        res.json({
            message: 'Sync cycle triggered successfully',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Error forcing sync cycle:', error);
        res.status(500).json({
            error: 'Failed to trigger sync cycle',
            details: error.message
        });
    }
});

module.exports = router;