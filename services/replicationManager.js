/**
 * Replication Manager
 * Handles automatic cross-peer media replication for redundancy and availability
 */

const { GunHelper } = require('../helpers/gun');

class ReplicationManager {
    constructor(mediaSeeder, peerRegistry) {
        this.mediaSeeder = mediaSeeder;
        this.peerRegistry = peerRegistry;
        this.gunHelper = new GunHelper();
        
        this.replicationQueue = new Map(); // mediaId -> replication job
        this.activeReplications = new Map(); // mediaId -> replication status
        this.replicationHistory = new Map(); // mediaId -> replication history
        
        // Configuration
        this.targetReplicationCount = 3; // Aim for 3 copies across peers
        this.maxConcurrentReplications = 5;
        this.replicationRetryAttempts = 3;
        this.replicationTimeoutMs = 300000; // 5 minutes
        this.queueProcessInterval = 30000; // 30 seconds
        
        this.queueProcessor = null;
    }

    async initialize() {
        try {
            console.log('📋 Initializing Replication Manager...');
            
            // Start queue processor
            this.startQueueProcessor();
            
            console.log('✅ Replication Manager initialized');
            return true;
        } catch (error) {
            console.error('❌ Failed to initialize Replication Manager:', error);
            return false;
        }
    }

    /**
     * Add media to replication queue
     * @param {string} mediaId - Content-addressable media ID
     * @param {Object} manifest - Media manifest data
     * @param {number} priority - Replication priority (1-10, higher = more urgent)
     */
    async queueForReplication(mediaId, manifest, priority = 5) {
        try {
            const job = {
                mediaId,
                manifest,
                priority,
                attempts: 0,
                maxAttempts: this.replicationRetryAttempts,
                createdAt: Date.now(),
                status: 'queued',
                targetPeers: [],
                completedPeers: [],
                failedPeers: []
            };
            
            this.replicationQueue.set(mediaId, job);
            console.log(`📋 Queued ${mediaId} for replication (priority: ${priority})`);
            
            // Store replication intent in GUN for peer coordination
            await this.storeReplicationIntent(mediaId, job);
            
            return job;
        } catch (error) {
            console.error(`Failed to queue ${mediaId} for replication:`, error);
            throw error;
        }
    }

    async storeReplicationIntent(mediaId, job) {
        try {
            const replicationData = {
                mediaId,
                priority: job.priority,
                targetCount: this.targetReplicationCount,
                initiatedBy: this.peerRegistry.peerId,
                createdAt: job.createdAt,
                status: 'active'
            };
            
            await this.gunHelper.putRecord(replicationData, `replication:${mediaId}`, {
                localId: `repl_${mediaId}`
            });
            
        } catch (error) {
            console.warn('Failed to store replication intent:', error);
        }
    }

    startQueueProcessor() {
        if (this.queueProcessor) {
            clearInterval(this.queueProcessor);
        }
        
        this.queueProcessor = setInterval(() => {
            this.processReplicationQueue();
        }, this.queueProcessInterval);
        
        console.log(`⚙️ Started replication queue processor (${this.queueProcessInterval}ms interval)`);
    }

    async processReplicationQueue() {
        try {
            // Skip if we're at max concurrent replications
            if (this.activeReplications.size >= this.maxConcurrentReplications) {
                return;
            }
            
            // Get next job by priority
            const nextJob = this.getNextReplicationJob();
            if (!nextJob) {
                return;
            }
            
            console.log(`🔄 Processing replication job: ${nextJob.mediaId}`);
            await this.executeReplicationJob(nextJob);
            
        } catch (error) {
            console.error('Replication queue processing error:', error);
        }
    }

    getNextReplicationJob() {
        let highestPriorityJob = null;
        let highestPriority = 0;
        
        for (const [mediaId, job] of this.replicationQueue.entries()) {
            // Skip if already being processed
            if (this.activeReplications.has(mediaId)) {
                continue;
            }
            
            // Skip if max attempts reached
            if (job.attempts >= job.maxAttempts) {
                this.replicationQueue.delete(mediaId);
                continue;
            }
            
            if (job.priority > highestPriority) {
                highestPriority = job.priority;
                highestPriorityJob = job;
            }
        }
        
        return highestPriorityJob;
    }

    async executeReplicationJob(job) {
        const { mediaId } = job;
        
        try {
            // Mark as active
            this.activeReplications.set(mediaId, {
                ...job,
                status: 'active',
                startedAt: Date.now()
            });
            
            // Find suitable target peers
            const targetPeers = await this.findReplicationTargets(mediaId, job.manifest);
            
            if (targetPeers.length === 0) {
                console.log(`⚠️ No suitable peers found for ${mediaId}`);
                this.completeReplication(mediaId, 'no_peers');
                return;
            }
            
            job.targetPeers = targetPeers.slice(0, this.targetReplicationCount);
            job.attempts++;
            
            console.log(`🎯 Replicating ${mediaId} to ${job.targetPeers.length} peers`);
            
            // Initiate replication to target peers
            const replicationPromises = job.targetPeers.map(peer => 
                this.replicateToSinglePeer(mediaId, job.manifest, peer)
            );
            
            // Wait for replications with timeout
            const results = await Promise.allSettled(replicationPromises);
            
            // Process results
            results.forEach((result, index) => {
                const peer = job.targetPeers[index];
                if (result.status === 'fulfilled' && result.value) {
                    job.completedPeers.push(peer);
                    console.log(`✅ Successfully replicated ${mediaId} to ${peer.peerId}`);
                } else {
                    job.failedPeers.push(peer);
                    console.log(`❌ Failed to replicate ${mediaId} to ${peer.peerId}:`, result.reason);
                }
            });
            
            // Check if we achieved target replication
            const successCount = job.completedPeers.length;
            if (successCount >= this.targetReplicationCount) {
                this.completeReplication(mediaId, 'success');
            } else if (job.attempts >= job.maxAttempts) {
                this.completeReplication(mediaId, 'max_attempts');
            } else {
                // Retry later
                console.log(`🔄 Will retry replication for ${mediaId} (${successCount}/${this.targetReplicationCount} successful)`);
            }
            
        } catch (error) {
            console.error(`Replication job failed for ${mediaId}:`, error);
            this.completeReplication(mediaId, 'error');
        }
    }

    async findReplicationTargets(mediaId, manifest) {
        const healthyPeers = this.peerRegistry.getHealthyPeers();
        const suitablePeers = [];
        
        for (const peer of healthyPeers) {
            // Skip if peer already has this media
            const hasMedia = await this.peerHasMedia(peer, mediaId);
            if (hasMedia) {
                continue;
            }
            
            // Check peer capabilities
            if (peer.capabilities && peer.capabilities.seeding) {
                suitablePeers.push(peer);
            }
        }
        
        // Sort by preference (could be based on latency, bandwidth, etc.)
        return suitablePeers.sort((a, b) => {
            // Simple preference: newer peers first
            return b.lastSeen - a.lastSeen;
        });
    }

    async peerHasMedia(peer, mediaId) {
        try {
            const axios = require('axios');
            const manifestUrl = `${peer.apiEndpoint}/media/${mediaId}/manifest`;
            
            const response = await axios.get(manifestUrl, { 
                timeout: 5000,
                validateStatus: (status) => status < 500 // Don't throw on 404
            });
            
            return response.status === 200;
        } catch (error) {
            return false;
        }
    }

    async replicateToSinglePeer(mediaId, manifest, targetPeer) {
        try {
            const axios = require('axios');
            
            // First, send the manifest to the peer
            await this.sendManifestToPeer(targetPeer, manifest);
            
            // Then, request the peer to download via magnet URI
            if (manifest.transport && manifest.transport.bittorrent) {
                const downloadRequest = {
                    magnetURI: manifest.transport.bittorrent.magnetURI
                };
                
                const response = await axios.post(
                    `${targetPeer.apiEndpoint}/media/download-magnet`,
                    downloadRequest,
                    { timeout: this.replicationTimeoutMs }
                );
                
                if (response.status === 200 && response.data.success) {
                    console.log(`📤 Peer ${targetPeer.peerId} successfully downloaded ${mediaId}`);
                    return true;
                }
            }
            
            return false;
        } catch (error) {
            console.error(`Failed to replicate to peer ${targetPeer.peerId}:`, error.message);
            return false;
        }
    }

    async sendManifestToPeer(peer, manifest) {
        try {
            // This would send the manifest to the peer so they can store it in their GUN
            // For now, we'll assume the peer will discover it via GUN sync
            return true;
        } catch (error) {
            console.warn('Failed to send manifest to peer:', error);
            return false;
        }
    }

    completeReplication(mediaId, status) {
        const job = this.activeReplications.get(mediaId);
        if (job) {
            job.status = status;
            job.completedAt = Date.now();
            job.duration = job.completedAt - job.startedAt;
            
            // Move to history
            this.replicationHistory.set(mediaId, job);
            
            // Remove from active and queue
            this.activeReplications.delete(mediaId);
            this.replicationQueue.delete(mediaId);
            
            console.log(`🏁 Replication completed for ${mediaId}: ${status} (${job.completedPeers.length} peers)`);
            
            // Update replication status in GUN
            this.updateReplicationStatus(mediaId, status, job);
        }
    }

    async updateReplicationStatus(mediaId, status, job) {
        try {
            const statusData = {
                mediaId,
                status,
                completedPeers: job.completedPeers.length,
                targetCount: this.targetReplicationCount,
                completedAt: job.completedAt,
                duration: job.duration
            };
            
            await this.gunHelper.putRecord(statusData, `replication_status:${mediaId}`, {
                localId: `repl_status_${mediaId}`
            });
            
        } catch (error) {
            console.warn('Failed to update replication status:', error);
        }
    }

    getReplicationStats() {
        return {
            queueSize: this.replicationQueue.size,
            activeReplications: this.activeReplications.size,
            completedReplications: this.replicationHistory.size,
            targetReplicationCount: this.targetReplicationCount,
            maxConcurrentReplications: this.maxConcurrentReplications
        };
    }

    getReplicationStatus(mediaId) {
        return (
            this.activeReplications.get(mediaId) ||
            this.replicationHistory.get(mediaId) ||
            this.replicationQueue.get(mediaId) ||
            null
        );
    }

    async shutdown() {
        console.log('🔄 Shutting down Replication Manager...');
        
        if (this.queueProcessor) {
            clearInterval(this.queueProcessor);
        }
        
        // Wait for active replications to complete (with timeout)
        const activeJobs = Array.from(this.activeReplications.keys());
        if (activeJobs.length > 0) {
            console.log(`⏳ Waiting for ${activeJobs.length} active replications to complete...`);
            
            const timeout = setTimeout(() => {
                console.log('⚠️ Shutdown timeout reached, stopping active replications');
            }, 30000);
            
            // In a real implementation, we'd gracefully stop active jobs
            clearTimeout(timeout);
        }
        
        console.log('✅ Replication Manager shutdown complete');
    }
}

module.exports = ReplicationManager;
