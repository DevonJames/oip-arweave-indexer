const express = require('express');
const router = express.Router();

router.get('/', async (req, res) => {
    // console.log('GET /api/health');
    try {
        const timezone = process.env.LOG_TIMEZONE || process.env.TZ || 'UTC';
        const date = new Date();
        const localTimestamp = date.toLocaleString('en-US', { 
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            fractionalSecondDigits: 3
        });
        
        console.log(`Health check passed at: ${localTimestamp}`);
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

// Memory health check endpoint
router.get('/memory', async (req, res) => {
    try {
        const v8 = require('v8');
        const memUsage = process.memoryUsage();
        const heapStats = v8.getHeapStatistics();
        
        const heapUtilization = (heapStats.used_heap_size / heapStats.heap_size_limit) * 100;
        
        // Determine health status
        let status = 'healthy';
        let warnings = [];
        
        if (heapUtilization > 90) {
            status = 'critical';
            warnings.push('Heap utilization above 90% - OOM risk imminent');
        } else if (heapUtilization > 80) {
            status = 'warning';
            warnings.push('Heap utilization above 80% - consider investigating memory usage');
        }
        
        if (heapStats.number_of_detached_contexts > 10) {
            warnings.push(`${heapStats.number_of_detached_contexts} detached contexts detected - possible memory leak`);
        }
        
        const response = {
            status,
            warnings,
            timestamp: new Date().toISOString(),
            uptime: Math.round(process.uptime()),
            memory: {
                rss: {
                    bytes: memUsage.rss,
                    mb: Math.round(memUsage.rss / 1024 / 1024)
                },
                heapUsed: {
                    bytes: memUsage.heapUsed,
                    mb: Math.round(memUsage.heapUsed / 1024 / 1024)
                },
                heapTotal: {
                    bytes: memUsage.heapTotal,
                    mb: Math.round(memUsage.heapTotal / 1024 / 1024)
                },
                external: {
                    bytes: memUsage.external,
                    mb: Math.round(memUsage.external / 1024 / 1024)
                },
                arrayBuffers: {
                    bytes: memUsage.arrayBuffers || 0,
                    mb: Math.round((memUsage.arrayBuffers || 0) / 1024 / 1024)
                }
            },
            heap: {
                sizeLimit: {
                    bytes: heapStats.heap_size_limit,
                    mb: Math.round(heapStats.heap_size_limit / 1024 / 1024)
                },
                totalAvailable: {
                    bytes: heapStats.total_available_size,
                    mb: Math.round(heapStats.total_available_size / 1024 / 1024)
                },
                usedHeapSize: {
                    bytes: heapStats.used_heap_size,
                    mb: Math.round(heapStats.used_heap_size / 1024 / 1024)
                },
                utilization: parseFloat(heapUtilization.toFixed(2)) + '%'
            },
            contexts: {
                native: heapStats.number_of_native_contexts,
                detached: heapStats.number_of_detached_contexts
            }
        };
        
        // Add GUN sync memory info if available
        if (global.gunSyncService) {
            const gunStatus = global.gunSyncService.getStatus();
            response.gunSync = gunStatus.memory;
        }
        
        res.json(response);
        
    } catch (error) {
        console.error('Error getting memory health:', error);
        res.status(500).json({
            status: 'error',
            error: error.message
        });
    }
});

// Get memory leak tracker report
router.get('/memory/tracker', async (req, res) => {
    try {
        const { getTracker } = require('../helpers/memoryTracker');
        const tracker = getTracker();
        const report = tracker.getReport();
        
        res.json({
            status: 'ok',
            tracker: report,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error getting memory tracker report:', error);
        res.status(500).json({
            status: 'error',
            error: error.message
        });
    }
});

// Clear GUN sync cache manually
router.post('/memory/clear-cache', async (req, res) => {
    try {
        if (!global.gunSyncService) {
            return res.status(503).json({
                error: 'GUN Sync Service not available'
            });
        }
        
        const beforeSize = global.gunSyncService.processedRecords.size;
        global.gunSyncService.clearProcessedCache();
        
        // Force garbage collection if exposed (optional, not required)
        if (global.gc) {
            console.log('🗑️ Forcing garbage collection...');
            global.gc();
        } else {
            console.log('ℹ️ GC not exposed (optional feature, not required)');
        }
        
        const memUsage = process.memoryUsage();
        
        res.json({
            message: 'Cache cleared successfully',
            cacheSize: {
                before: beforeSize,
                after: global.gunSyncService.processedRecords.size
            },
            memoryAfterClear: {
                heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
                heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024)
            },
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Error clearing cache:', error);
        res.status(500).json({
            error: 'Failed to clear cache',
            details: error.message
        });
    }
});

// DISABLED: Elasticsearch client recreation endpoint
// This endpoint was removed because periodic ES client recreation caused connection failures
// and was not the source of the memory leak (GraphQL client was the real culprit)
// router.post('/elasticsearch/recreate-client', async (req, res) => { ... });

// Recreate GraphQL client (manual memory leak mitigation for Arweave queries)
router.post('/graphql/recreate-client', async (req, res) => {
    try {
        const { recreateGraphQLClient } = require('../helpers/elasticsearch');
        
        const beforeMem = process.memoryUsage();
        
        // Recreate the client
        recreateGraphQLClient();
        
        // Force garbage collection if available
        if (global.gc) {
            global.gc();
        }
        
        const afterMem = process.memoryUsage();
        
        res.json({
            message: 'GraphQL client recreated successfully',
            memory: {
                before: {
                    heapUsedMB: Math.round(beforeMem.heapUsed / 1024 / 1024),
                    externalMB: Math.round(beforeMem.external / 1024 / 1024)
                },
                after: {
                    heapUsedMB: Math.round(afterMem.heapUsed / 1024 / 1024),
                    externalMB: Math.round(afterMem.external / 1024 / 1024)
                },
                freed: {
                    heapMB: Math.round((beforeMem.heapUsed - afterMem.heapUsed) / 1024 / 1024),
                    externalMB: Math.round((beforeMem.external - afterMem.external) / 1024 / 1024)
                }
            },
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Error recreating GraphQL client:', error);
        res.status(500).json({
            error: 'Failed to recreate GraphQL client',
            details: error.message
        });
    }
});

module.exports = router;