/**
 * Maintenance Service
 * Handles cleanup, optimization, backup, and system maintenance tasks
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class MaintenanceService {
    constructor(mediaCoordinator, monitoringService) {
        this.mediaCoordinator = mediaCoordinator;
        this.monitoringService = monitoringService;
        
        // Maintenance configuration
        this.cleanupInterval = 24 * 60 * 60 * 1000; // 24 hours
        this.optimizationInterval = 6 * 60 * 60 * 1000; // 6 hours
        this.backupInterval = 12 * 60 * 60 * 1000; // 12 hours
        this.healthCheckInterval = 5 * 60 * 1000; // 5 minutes
        
        // Cleanup thresholds
        this.maxFileAge = 30 * 24 * 60 * 60 * 1000; // 30 days
        this.maxLogSize = 100 * 1024 * 1024; // 100MB
        this.maxCacheSize = 500 * 1024 * 1024; // 500MB
        this.minDiskSpaceGB = 5; // 5GB minimum free space
        
        // Optimization settings
        this.defragmentThreshold = 0.3; // 30% fragmentation
        this.compressionThreshold = 10 * 1024 * 1024; // 10MB
        this.indexRebuildThreshold = 1000; // After 1000 operations
        
        this.maintenanceTasks = new Map();
        this.lastMaintenanceRun = new Map();
        this.maintenanceHistory = [];
        
        this.initializeMaintenanceTasks();
        this.startMaintenanceScheduler();
    }

    initializeMaintenanceTasks() {
        // Register maintenance tasks
        this.registerTask('cleanup_old_files', {
            interval: this.cleanupInterval,
            priority: 'medium',
            description: 'Remove old and unused media files',
            task: () => this.cleanupOldFiles()
        });

        this.registerTask('cleanup_logs', {
            interval: this.cleanupInterval,
            priority: 'low',
            description: 'Rotate and compress old log files',
            task: () => this.cleanupLogs()
        });

        this.registerTask('optimize_storage', {
            interval: this.optimizationInterval,
            priority: 'medium',
            description: 'Optimize storage and defragment if needed',
            task: () => this.optimizeStorage()
        });

        this.registerTask('backup_metadata', {
            interval: this.backupInterval,
            priority: 'high',
            description: 'Backup critical metadata and configurations',
            task: () => this.backupMetadata()
        });

        this.registerTask('health_diagnostics', {
            interval: this.healthCheckInterval,
            priority: 'high',
            description: 'Run comprehensive system health diagnostics',
            task: () => this.runHealthDiagnostics()
        });

        this.registerTask('peer_cleanup', {
            interval: this.cleanupInterval,
            priority: 'medium',
            description: 'Clean up stale peer connections and data',
            task: () => this.cleanupPeers()
        });

        this.registerTask('replication_maintenance', {
            interval: this.optimizationInterval,
            priority: 'medium',
            description: 'Maintain replication queues and optimize distribution',
            task: () => this.maintainReplication()
        });

        console.log(`🔧 Initialized ${this.maintenanceTasks.size} maintenance tasks`);
    }

    registerTask(name, config) {
        this.maintenanceTasks.set(name, {
            name,
            ...config,
            lastRun: null,
            runCount: 0,
            totalDuration: 0,
            failures: 0,
            enabled: true
        });
    }

    startMaintenanceScheduler() {
        console.log('🔄 Starting maintenance scheduler...');
        
        // Check for due tasks every minute
        setInterval(() => {
            this.runDueMaintenanceTasks();
        }, 60000);
        
        // Register monitoring health checks
        if (this.monitoringService) {
            this.monitoringService.registerHealthCheck('maintenance_system', async () => {
                const recentFailures = this.maintenanceHistory
                    .filter(h => h.timestamp > Date.now() - 60000 && !h.success)
                    .length;
                
                return {
                    status: recentFailures > 3 ? 'unhealthy' : 'healthy',
                    message: `${recentFailures} maintenance failures in last minute`,
                    data: {
                        recentFailures,
                        totalTasks: this.maintenanceTasks.size,
                        enabledTasks: Array.from(this.maintenanceTasks.values()).filter(t => t.enabled).length
                    }
                };
            });
        }
        
        console.log('✅ Maintenance scheduler started');
    }

    async runDueMaintenanceTasks() {
        const now = Date.now();
        const dueTasks = [];
        
        for (const [name, task] of this.maintenanceTasks) {
            if (!task.enabled) continue;
            
            const timeSinceLastRun = task.lastRun ? now - task.lastRun : Infinity;
            if (timeSinceLastRun >= task.interval) {
                dueTasks.push(task);
            }
        }
        
        if (dueTasks.length === 0) return;
        
        // Sort by priority (high > medium > low)
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        dueTasks.sort((a, b) => priorityOrder[b.priority] - priorityOrder[a.priority]);
        
        console.log(`🔧 Running ${dueTasks.length} due maintenance tasks`);
        
        for (const task of dueTasks) {
            await this.runMaintenanceTask(task);
        }
    }

    async runMaintenanceTask(task) {
        const startTime = Date.now();
        let success = false;
        let error = null;
        
        try {
            console.log(`🔄 Running maintenance task: ${task.name}`);
            
            if (this.monitoringService) {
                const timer = this.monitoringService.startTimer('maintenance_task_duration_seconds');
                await task.task();
                timer.end({ task_name: task.name });
            } else {
                await task.task();
            }
            
            success = true;
            console.log(`✅ Completed maintenance task: ${task.name}`);
            
        } catch (err) {
            error = err;
            task.failures++;
            console.error(`❌ Maintenance task failed: ${task.name}`, err);
        }
        
        const duration = Date.now() - startTime;
        
        // Update task statistics
        task.lastRun = startTime;
        task.runCount++;
        task.totalDuration += duration;
        
        // Record in history
        this.maintenanceHistory.push({
            taskName: task.name,
            timestamp: startTime,
            duration,
            success,
            error: error?.message || null
        });
        
        // Keep only last 100 history entries
        if (this.maintenanceHistory.length > 100) {
            this.maintenanceHistory.splice(0, this.maintenanceHistory.length - 100);
        }
        
        if (this.monitoringService) {
            this.monitoringService.incrementCounter('maintenance_tasks_total', 1, { 
                task_name: task.name, 
                success: success.toString() 
            });
        }
    }

    // Maintenance task implementations
    async cleanupOldFiles() {
        const mediaDir = path.join(__dirname, '../data/media');
        let cleanedFiles = 0;
        let freedSpace = 0;
        
        try {
            const files = await fs.readdir(mediaDir);
            const now = Date.now();
            
            for (const file of files) {
                const filePath = path.join(mediaDir, file);
                const stats = await fs.stat(filePath);
                
                // Skip if file is too new
                if (now - stats.mtime.getTime() < this.maxFileAge) {
                    continue;
                }
                
                // Check if file is still being seeded
                const mediaId = file.split('.')[0];
                const mediaInfo = this.mediaCoordinator?.mediaSeeder?.getMediaInfo(mediaId);
                
                if (!mediaInfo || mediaInfo.peers === 0) {
                    // File is old and not being seeded, safe to remove
                    await fs.unlink(filePath);
                    cleanedFiles++;
                    freedSpace += stats.size;
                    console.log(`🗑️ Cleaned up old file: ${file} (${stats.size} bytes)`);
                }
            }
            
            console.log(`🧹 Cleanup completed: ${cleanedFiles} files removed, ${Math.round(freedSpace / 1024 / 1024)}MB freed`);
            
        } catch (error) {
            console.warn('File cleanup failed:', error);
            throw error;
        }
    }

    async cleanupLogs() {
        // Rotate and compress old logs
        const logsDir = path.join(__dirname, '../logs');
        
        try {
            await fs.mkdir(logsDir, { recursive: true });
            const files = await fs.readdir(logsDir);
            
            for (const file of files) {
                if (!file.endsWith('.log')) continue;
                
                const filePath = path.join(logsDir, file);
                const stats = await fs.stat(filePath);
                
                // Compress large log files
                if (stats.size > this.maxLogSize) {
                    console.log(`📦 Compressing large log file: ${file}`);
                    // In production, implement actual compression
                    const compressedName = `${file}.${Date.now()}.gz`;
                    await fs.rename(filePath, path.join(logsDir, compressedName));
                }
            }
            
        } catch (error) {
            console.warn('Log cleanup failed:', error);
        }
    }

    async optimizeStorage() {
        console.log('⚡ Running storage optimization...');
        
        try {
            // Check disk space
            const diskUsage = await this.checkDiskSpace();
            
            if (diskUsage.freeGB < this.minDiskSpaceGB) {
                console.warn(`⚠️ Low disk space: ${diskUsage.freeGB}GB free`);
                // Trigger aggressive cleanup
                await this.aggressiveCleanup();
            }
            
            // Optimize seeder state file
            if (this.mediaCoordinator?.mediaSeeder) {
                await this.mediaCoordinator.mediaSeeder.saveState();
            }
            
            // Defragment if needed (platform-specific)
            await this.checkAndDefragment();
            
            console.log('✅ Storage optimization completed');
            
        } catch (error) {
            console.error('Storage optimization failed:', error);
            throw error;
        }
    }

    async backupMetadata() {
        console.log('💾 Creating metadata backup...');
        
        try {
            const backupDir = path.join(__dirname, '../backups');
            await fs.mkdir(backupDir, { recursive: true });
            
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupFile = path.join(backupDir, `metadata-backup-${timestamp}.json`);
            
            // Collect metadata
            const metadata = {
                timestamp: Date.now(),
                version: '1.0',
                mediaSeeder: this.mediaCoordinator?.mediaSeeder?.getStats() || null,
                peerRegistry: this.mediaCoordinator?.peerRegistry?.getPeerStats() || null,
                replicationManager: this.mediaCoordinator?.replicationManager?.getReplicationStats() || null,
                monitoringMetrics: this.monitoringService?.getMetrics() || null
            };
            
            await fs.writeFile(backupFile, JSON.stringify(metadata, null, 2));
            console.log(`💾 Metadata backup created: ${backupFile}`);
            
            // Keep only last 7 backups
            await this.cleanupOldBackups(backupDir, 7);
            
        } catch (error) {
            console.error('Metadata backup failed:', error);
            throw error;
        }
    }

    async runHealthDiagnostics() {
        const diagnostics = {
            timestamp: Date.now(),
            system: await this.checkSystemHealth(),
            network: await this.checkNetworkHealth(),
            storage: await this.checkStorageHealth(),
            performance: await this.checkPerformanceHealth()
        };
        
        // Update monitoring metrics based on diagnostics
        if (this.monitoringService) {
            const overallScore = this.calculateHealthScore(diagnostics);
            this.monitoringService.setGauge('network_health_score', overallScore);
        }
        
        // Log critical issues
        const criticalIssues = this.findCriticalIssues(diagnostics);
        if (criticalIssues.length > 0) {
            console.warn('🚨 Critical health issues detected:', criticalIssues);
        }
        
        return diagnostics;
    }

    async cleanupPeers() {
        if (!this.mediaCoordinator?.peerRegistry) return;
        
        console.log('🌐 Cleaning up stale peers...');
        
        try {
            const peerStats = this.mediaCoordinator.peerRegistry.getPeerStats();
            const allPeers = this.mediaCoordinator.peerRegistry.getAllPeers();
            
            let cleanedPeers = 0;
            const cutoffTime = Date.now() - (2 * 60 * 60 * 1000); // 2 hours
            
            for (const peer of allPeers) {
                if (peer.lastSeen < cutoffTime) {
                    // Remove stale peer data
                    this.mediaCoordinator.peerRegistry.discoveredPeers.delete(peer.peerId);
                    this.mediaCoordinator.peerRegistry.healthyPeers.delete(peer.peerId);
                    cleanedPeers++;
                }
            }
            
            console.log(`🧹 Cleaned up ${cleanedPeers} stale peers`);
            
        } catch (error) {
            console.error('Peer cleanup failed:', error);
            throw error;
        }
    }

    async maintainReplication() {
        if (!this.mediaCoordinator?.replicationManager) return;
        
        console.log('🔄 Maintaining replication system...');
        
        try {
            const stats = this.mediaCoordinator.replicationManager.getReplicationStats();
            
            // Clear completed replications older than 24 hours
            const oldReplications = [];
            for (const [mediaId, replication] of this.mediaCoordinator.replicationManager.replicationHistory) {
                if (Date.now() - replication.completedAt > 24 * 60 * 60 * 1000) {
                    oldReplications.push(mediaId);
                }
            }
            
            oldReplications.forEach(mediaId => {
                this.mediaCoordinator.replicationManager.replicationHistory.delete(mediaId);
            });
            
            console.log(`🧹 Cleaned up ${oldReplications.length} old replication records`);
            
        } catch (error) {
            console.error('Replication maintenance failed:', error);
            throw error;
        }
    }

    // Helper methods
    async checkDiskSpace() {
        // Simplified disk space check
        try {
            const { execSync } = require('child_process');
            const output = execSync('df -h .', { encoding: 'utf8' });
            const lines = output.trim().split('\n');
            const data = lines[1].split(/\s+/);
            
            return {
                total: data[1],
                used: data[2],
                available: data[3],
                freeGB: parseInt(data[3].replace('G', '')) || 0
            };
        } catch (error) {
            return { freeGB: 10 }; // Default safe value
        }
    }

    async aggressiveCleanup() {
        console.log('🚨 Running aggressive cleanup due to low disk space...');
        
        // Reduce cache sizes
        if (this.mediaCoordinator?.mediaSeeder) {
            // Clear non-essential cached data
        }
        
        // Force cleanup of temporary files
        const tempDir = path.join(__dirname, '../temp');
        try {
            const files = await fs.readdir(tempDir);
            for (const file of files) {
                await fs.unlink(path.join(tempDir, file));
            }
        } catch (error) {
            // Temp directory might not exist
        }
    }

    async checkAndDefragment() {
        // Platform-specific defragmentation check
        // This would implement actual defragmentation logic in production
        console.log('🔧 Checking for fragmentation...');
    }

    async cleanupOldBackups(backupDir, keepCount) {
        try {
            const files = await fs.readdir(backupDir);
            const backupFiles = files
                .filter(f => f.startsWith('metadata-backup-'))
                .map(f => ({ name: f, path: path.join(backupDir, f) }))
                .sort((a, b) => b.name.localeCompare(a.name)); // Newest first
            
            if (backupFiles.length > keepCount) {
                const toDelete = backupFiles.slice(keepCount);
                for (const file of toDelete) {
                    await fs.unlink(file.path);
                }
                console.log(`🗑️ Cleaned up ${toDelete.length} old backups`);
            }
        } catch (error) {
            console.warn('Backup cleanup failed:', error);
        }
    }

    async checkSystemHealth() {
        return {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            cpu: process.cpuUsage(),
            platform: process.platform,
            nodeVersion: process.version
        };
    }

    async checkNetworkHealth() {
        const peerStats = this.mediaCoordinator?.peerRegistry?.getPeerStats();
        return {
            activePeers: peerStats?.healthyPeers || 0,
            totalPeers: peerStats?.totalPeers || 0,
            uptime: peerStats?.uptime || 0
        };
    }

    async checkStorageHealth() {
        const diskSpace = await this.checkDiskSpace();
        const seederStats = this.mediaCoordinator?.mediaSeeder?.getStats();
        
        return {
            diskSpace,
            seedingTorrents: seederStats?.totalTorrents || 0,
            totalUploaded: seederStats?.totalUploaded || 0,
            totalDownloaded: seederStats?.totalDownloaded || 0
        };
    }

    async checkPerformanceHealth() {
        return this.monitoringService?.getPerformanceStats() || {};
    }

    calculateHealthScore(diagnostics) {
        let score = 100;
        
        // Deduct points for issues
        if (diagnostics.storage.diskSpace.freeGB < 5) score -= 30;
        if (diagnostics.network.activePeers === 0) score -= 20;
        if (diagnostics.system.memory.heapUsed > 500 * 1024 * 1024) score -= 10;
        
        return Math.max(0, score);
    }

    findCriticalIssues(diagnostics) {
        const issues = [];
        
        if (diagnostics.storage.diskSpace.freeGB < 1) {
            issues.push('Critical: Less than 1GB disk space remaining');
        }
        
        if (diagnostics.system.memory.heapUsed > 1024 * 1024 * 1024) {
            issues.push('Critical: Memory usage exceeds 1GB');
        }
        
        return issues;
    }

    // API methods
    getMaintenanceStatus() {
        const tasks = Array.from(this.maintenanceTasks.values()).map(task => ({
            name: task.name,
            description: task.description,
            priority: task.priority,
            enabled: task.enabled,
            lastRun: task.lastRun,
            runCount: task.runCount,
            failures: task.failures,
            averageDuration: task.runCount > 0 ? Math.round(task.totalDuration / task.runCount) : 0
        }));
        
        return {
            tasks,
            recentHistory: this.maintenanceHistory.slice(-10),
            nextDueTask: this.getNextDueTask(),
            timestamp: Date.now()
        };
    }

    getNextDueTask() {
        let nextTask = null;
        let earliestDue = Infinity;
        
        for (const task of this.maintenanceTasks.values()) {
            if (!task.enabled) continue;
            
            const nextDue = (task.lastRun || 0) + task.interval;
            if (nextDue < earliestDue) {
                earliestDue = nextDue;
                nextTask = {
                    name: task.name,
                    dueAt: nextDue,
                    overdue: Date.now() > nextDue
                };
            }
        }
        
        return nextTask;
    }

    async runTaskNow(taskName) {
        const task = this.maintenanceTasks.get(taskName);
        if (!task) {
            throw new Error(`Task not found: ${taskName}`);
        }
        
        await this.runMaintenanceTask(task);
        return true;
    }

    enableTask(taskName, enabled = true) {
        const task = this.maintenanceTasks.get(taskName);
        if (task) {
            task.enabled = enabled;
            console.log(`${enabled ? '✅' : '⏸️'} Task ${taskName} ${enabled ? 'enabled' : 'disabled'}`);
            return true;
        }
        return false;
    }
}

module.exports = MaintenanceService;
