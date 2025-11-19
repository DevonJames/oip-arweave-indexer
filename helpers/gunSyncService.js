/**
 * GUN Record Synchronization Service
 * Handles discovery, format conversion, and indexing of GUN records from other OIP nodes
 * Supports both public and private (encrypted) records
 */

const { OIPGunRegistry } = require('./oipGunRegistry');
const { PrivateRecordHandler } = require('./privateRecordHandler');
const { processRecordForElasticsearch, indexRecord, elasticClient } = require('./elasticsearch');

class GunSyncService {
    constructor() {
        this.registry = new OIPGunRegistry();
        this.privateHandler = new PrivateRecordHandler();
        this.isRunning = false;
        this.syncInterval = parseInt(process.env.GUN_SYNC_INTERVAL) || 300000; // 5 minutes default (was 30s - too aggressive)
        this.processedRecords = new Set(); // Track processed records to avoid duplicates
        this.healthMonitor = new SyncHealthMonitor();
        
        // Memory management: Clear cache every hour to prevent memory leaks
        this.cacheMaxAge = parseInt(process.env.GUN_CACHE_MAX_AGE) || 3600000; // 1 hour default
        this.lastCacheClear = Date.now();
        
        // HTTP-based peer sync configuration (since WebSocket sync doesn't work reliably)
        this.peerNodes = this.parsePeerNodes();
        this.httpSyncEnabled = this.peerNodes.length > 0;
        
        console.log('🚀 GUN Sync Service initialized:', {
            syncInterval: this.syncInterval,
            cacheMaxAge: this.cacheMaxAge,
            nodeId: this.registry.nodeId,
            httpSyncEnabled: this.httpSyncEnabled,
            peerCount: this.peerNodes.length
        });
    }
    
    /**
     * Parse peer nodes from environment variables for HTTP-based sync
     * Converts WebSocket URLs to HTTP URLs
     */
    parsePeerNodes() {
        const gunPeers = process.env.GUN_EXTERNAL_PEERS || process.env.GUN_PEERS || '';
        if (!gunPeers) {
            return [];
        }
        
        return gunPeers.split(',')
            .map(peer => peer.trim())
            .filter(peer => peer)
            .map(peer => {
                // If peer already has /gun-relay path (for public API proxy), use as-is
                if (peer.includes('/gun-relay')) {
                    return peer
                        .replace('ws://', 'http://')
                        .replace('wss://', 'https://');
                }
                
                // Convert ws://host:port/gun to http://host:port/gun-relay (for proxy)
                const httpUrl = peer
                    .replace('ws://', 'http://')
                    .replace('wss://', 'https://')
                    .replace('/gun', '/gun-relay');
                return httpUrl;
            });
    }
    
    /**
     * Start the sync service
     */
    async start() {
        if (this.isRunning) {
            console.log('⚠️ GUN Sync Service is already running');
            return;
        }
        
        console.log('🚀 Starting GUN Record Sync Service...');
        this.isRunning = true;
        
        try {
            // Initial discovery and migration of existing records
            await this.migrateExistingRecords();
            
            // Perform initial sync
            await this.performSync();
            
            // Set up periodic sync
            this.syncTimer = setInterval(async () => {
                await this.performSync();
            }, this.syncInterval);
            
            console.log('✅ GUN Record Sync Service started successfully');
            
        } catch (error) {
            console.error('❌ Failed to start GUN Sync Service:', error);
            this.isRunning = false;
            throw error;
        }
    }
    
    /**
     * Stop the sync service
     */
    stop() {
        if (!this.isRunning) {
            console.log('⚠️ GUN Sync Service is not running');
            return;
        }
        
        console.log('🛑 Stopping GUN Record Sync Service...');
        this.isRunning = false;
        
        if (this.syncTimer) {
            clearInterval(this.syncTimer);
            this.syncTimer = null;
        }
        
        console.log('✅ GUN Record Sync Service stopped');
    }
    
    /**
     * Perform a sync cycle
     */
    async performSync() {
        const startTime = Date.now();
        
        try {
            // Memory management: Periodically clear the cache to prevent memory leaks
            const timeSinceLastClear = Date.now() - this.lastCacheClear;
            if (timeSinceLastClear >= this.cacheMaxAge) {
                const cacheSize = this.processedRecords.size;
                this.clearProcessedCache();
                this.lastCacheClear = Date.now();
                console.log(`🗑️ Auto-cleared GUN cache (${cacheSize} records) after ${Math.round(timeSinceLastClear / 60000)} minutes`);
            }
            
            // console.log('🔄 Starting GUN record sync cycle...'); // Commented out - too verbose
            
            let discoveredRecords = [];
            
            // Try HTTP-based sync first if enabled (more reliable than WebSocket)
            if (this.httpSyncEnabled) {
                const httpRecords = await this.syncFromPeersViaHTTP();
                discoveredRecords = discoveredRecords.concat(httpRecords);
            }
            
            // Also try WebSocket-based discovery (fallback)
            const wsRecords = await this.privateHandler.discoverPrivateRecords();
            discoveredRecords = discoveredRecords.concat(wsRecords);
            
            // Deduplicate by soul
            const seenSouls = new Set();
            discoveredRecords = discoveredRecords.filter(record => {
                if (seenSouls.has(record.soul)) {
                    return false;
                }
                seenSouls.add(record.soul);
                return true;
            });
            
            let syncedCount = 0;
            let errorCount = 0;
            
            for (const discoveredRecord of discoveredRecords) {
                try {
                    const success = await this.processDiscoveredRecord(discoveredRecord);
                    if (success) {
                        syncedCount++;
                    } else {
                        errorCount++;
                    }
                } catch (error) {
                    console.error('❌ Error processing individual record:', error);
                    errorCount++;
                }
            }
            
            const duration = Date.now() - startTime;
            this.healthMonitor.recordSyncCycle(discoveredRecords.length, syncedCount, errorCount, duration);
            
            // Only log if records were actually discovered or synced
            if (discoveredRecords.length > 0 || syncedCount > 0 || errorCount > 0) {
                console.log(`✅ GUN sync: ${syncedCount}/${discoveredRecords.length} records synced (${errorCount} errors) in ${duration}ms`);
            }
            
        } catch (error) {
            console.error('❌ Error in sync cycle:', error);
            this.healthMonitor.recordSyncCycle(0, 0, 1, Date.now() - startTime);
        }
    }
    
    /**
     * Sync records from peer nodes via HTTP (bypassing unreliable WebSocket sync)
     * @returns {Array} Array of discovered records
     */
    async syncFromPeersViaHTTP() {
        const axios = require('axios');
        const discoveredRecords = [];
        
        // Record types to check
        const recordTypes = ['image', 'post', 'video', 'audio', 'text', 'recipe', 'workout', 'exercise'];
        
        for (const peerUrl of this.peerNodes) {
            try {
                console.log(`🔍 Polling peer for records: ${peerUrl}`);
                
                for (const recordType of recordTypes) {
                    try {
                        // Fetch registry index for this record type from peer
                        const indexSoul = `oip:registry:index:${recordType}`;
                        const response = await axios.get(`${peerUrl}/get`, {
                            params: { soul: indexSoul },
                            timeout: 5000
                        });
                        
                        if (response.data && response.data.success && response.data.data) {
                            const peerIndex = response.data.data;
                            
                            // Process each entry in the peer's registry index
                            for (const [soul, entry] of Object.entries(peerIndex)) {
                                // Skip GUN metadata
                                if (soul.startsWith('_') || soul.startsWith('#') || !entry.soul) {
                                    continue;
                                }
                                
                                const recordSoul = entry.soul;
                                const did = `did:gun:${recordSoul}`;
                                
                                // Skip if we already have this record
                                if (this.processedRecords.has(did)) {
                                    continue;
                                }
                                
                                // Check if we already have this record in Elasticsearch
                                const exists = await this.checkRecordExists(did);
                                if (exists) {
                                    this.processedRecords.add(did);
                                    continue;
                                }
                                
                                // Fetch the actual record from peer
                                console.log(`📥 Fetching record from peer: ${did}`);
                                const recordResponse = await axios.get(`${peerUrl}/get`, {
                                    params: { soul: recordSoul },
                                    timeout: 10000
                                });
                                
                                if (recordResponse.data && recordResponse.data.success && recordResponse.data.data) {
                                    discoveredRecords.push({
                                        soul: recordSoul,
                                        data: recordResponse.data.data,
                                        sourceNodeId: entry.nodeId || 'unknown',
                                        wasEncrypted: false // HTTP sync is for public records
                                    });
                                }
                            }
                        }
                    } catch (typeError) {
                        // Silently skip record types that don't exist on peer
                        if (typeError.response && typeError.response.status === 404) {
                            continue;
                        }
                        console.error(`⚠️ Error syncing ${recordType} from ${peerUrl}:`, typeError.message);
                    }
                }
            } catch (peerError) {
                console.error(`❌ Error syncing from peer ${peerUrl}:`, peerError.message);
            }
        }
        
        return discoveredRecords;
    }
    
    /**
     * Check if a record already exists in Elasticsearch
     */
    async checkRecordExists(did) {
        try {
            const result = await elasticClient.exists({
                index: 'records',
                id: did
            });
            return result;
        } catch (error) {
            return false;
        }
    }
    
    /**
     * Process a discovered record: convert format and index to Elasticsearch
     * @param {Object} discoveredRecord - The discovered record with metadata
     * @returns {boolean} True if successfully processed
     */
    async processDiscoveredRecord(discoveredRecord) {
        try {
            const { soul, data, sourceNodeId, wasEncrypted } = discoveredRecord;
            const did = `did:gun:${soul}`;
            
            // Skip if already processed in this session
            if (this.processedRecords.has(did)) {
                return false;
            }
            
            console.log(`📥 Processing ${wasEncrypted ? 'private' : 'public'} record: ${did} from node ${sourceNodeId}`);
            
            // Validate the record structure
            if (!this.registry.isValidOIPRecord(data)) {
                console.warn(`⚠️ Invalid OIP record structure, skipping: ${did}`);
                return false;
            }
            
            // Convert GUN record format to Elasticsearch format
            const elasticsearchRecord = this.convertGunRecordForElasticsearch(data, did, wasEncrypted, sourceNodeId);
            
            // Check if record already exists (avoid duplicates)
            const exists = await elasticClient.exists({
                index: 'records',
                id: did
            });
            
            if (exists.body) {
                console.log(`⏭️ Record already exists in Elasticsearch: ${did}`);
                this.processedRecords.add(did);
                return false;
            }
            
            // Index to Elasticsearch using existing indexRecord function
            await indexRecord(elasticsearchRecord);
            
            // Mark as processed
            this.processedRecords.add(did);
            
            console.log(`✅ Successfully synced and indexed ${wasEncrypted ? 'private' : 'public'} record: ${did}`);
            return true;
            
        } catch (error) {
            console.error('❌ Error processing discovered record:', error);
            return false;
        }
    }
    
    /**
     * Convert GUN record format to Elasticsearch-compatible format
     * This handles the critical array conversion: JSON strings → actual arrays
     * @param {Object} gunRecord - The GUN record data
     * @param {string} did - The record DID
     * @param {boolean} wasEncrypted - Whether the record was encrypted
     * @param {string} sourceNodeId - Source node identifier
     * @returns {Object} Elasticsearch-compatible record
     */
    convertGunRecordForElasticsearch(gunRecord, did, wasEncrypted = false, sourceNodeId = null) {
        // Deep clone the record
        const elasticsearchRecord = JSON.parse(JSON.stringify(gunRecord));
        
        // Set the unified DID and storage metadata
        elasticsearchRecord.oip.did = did;
        elasticsearchRecord.oip.didTx = did; // Backward compatibility
        elasticsearchRecord.oip.storage = 'gun';
        
        // Reconstruct nested creator object from flattened format (if needed)
        if (elasticsearchRecord.oip.creator_publicKey && elasticsearchRecord.oip.creator_didAddress) {
            elasticsearchRecord.oip.creator = {
                publicKey: elasticsearchRecord.oip.creator_publicKey,
                didAddress: elasticsearchRecord.oip.creator_didAddress
            };
            // Clean up flattened fields
            delete elasticsearchRecord.oip.creator_publicKey;
            delete elasticsearchRecord.oip.creator_didAddress;
        }
        
        // Add sync metadata
        if (wasEncrypted) {
            elasticsearchRecord.oip.wasEncrypted = true;
            elasticsearchRecord.oip.syncedFromNode = sourceNodeId;
            elasticsearchRecord.oip.syncedAt = new Date().toISOString();
        }
        
        // Convert JSON string arrays back to actual arrays using existing function
        // This is critical for maintaining data format consistency
        const processedRecord = processRecordForElasticsearch(elasticsearchRecord);
        
        console.log(`🔄 Converted GUN record format for Elasticsearch: ${did}`);
        return processedRecord;
    }
    
    /**
     * Register a locally created record in the registry
     * @param {string} recordDid - The record DID
     * @param {string} soul - The GUN soul
     * @param {string} recordType - The record type
     * @param {string} creatorPubKey - Creator's public key
     */
    async registerLocalRecord(recordDid, soul, recordType, creatorPubKey) {
        try {
            await this.registry.registerOIPRecord(recordDid, soul, recordType, creatorPubKey);
            console.log('📝 Registered local record in GUN registry:', recordDid);
        } catch (error) {
            console.error('❌ Failed to register local record:', error);
        }
    }
    
    /**
     * Migrate existing GUN records to the registry system
     */
    async migrateExistingRecords() {
        try {
            console.log('🔄 Migrating existing GUN records to registry...');
            
            // Wait for gun-relay to be ready before attempting migration
            console.log('⏳ Waiting for gun-relay to be ready...');
            let gunReady = false;
            let attempts = 0;
            const maxAttempts = 30; // 30 seconds max wait
            
            while (!gunReady && attempts < maxAttempts) {
                try {
                    await this.registry.gunHelper.getRecord('test:startup');
                    gunReady = true;
                    console.log('✅ Gun-relay is ready, starting migration...');
                } catch (error) {
                    attempts++;
                    if (attempts < maxAttempts) {
                        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
                    } else {
                        console.warn('⚠️ Gun-relay not ready after 30s, skipping migration');
                        return;
                    }
                }
            }
            
            // Get all existing GUN records from local Elasticsearch
            const existingGunRecords = await elasticClient.search({
                index: 'records',
                body: {
                    query: {
                        bool: {
                            should: [
                                { prefix: { "oip.did": "did:gun:" } },
                                { prefix: { "oip.didTx": "did:gun:" } }
                            ]
                        }
                    }
                },
                size: 10000
            });
            
            let registeredCount = 0;
            let skippedCount = 0;
            const records = existingGunRecords.hits.hits;
            
            for (const hit of records) {
                const record = hit._source;
                
                // Validate record structure before attempting to register
                // Skip records with missing or invalid OIP metadata
                if (!record.oip || !record.oip.recordType || !record.oip.creator || !record.oip.creator.publicKey) {
                    skippedCount++;
                    continue;
                }
                
                const did = record.oip.did || record.oip.didTx;
                if (!did || !did.startsWith('did:gun:')) {
                    skippedCount++;
                    continue;
                }
                
                const soul = did.replace('did:gun:', '');
                if (!soul || soul.length === 0) {
                    skippedCount++;
                    continue;
                }
                
                try {
                    // IMPORTANT: Only register if the record actually exists in GUN
                    // (Migration should not register records that only exist in Elasticsearch)
                    const gunRecord = await this.registry.gunHelper.getRecord(soul);
                    if (!gunRecord || !gunRecord.data) {
                        // Record doesn't exist in GUN, skip registration
                        skippedCount++;
                        continue;
                    }
                    
                    // Register in the GUN registry for discovery by other nodes
                    await this.registry.registerOIPRecord(
                        did,
                        soul,
                        record.oip.recordType,
                        record.oip.creator.publicKey
                    );
                    
                    registeredCount++;
                    
                } catch (error) {
                    console.error(`❌ Failed to register existing record ${did}:`, error.message);
                    skippedCount++;
                }
            }
            
            console.log(`✅ Migration complete: ${registeredCount} registered, ${skippedCount} skipped (${records.length} total)`);
            
        } catch (error) {
            console.error('❌ Error migrating existing records:', error);
        }
    }
    
    /**
     * Get sync service status and health information
     * @returns {Object} Status information
     */
    getStatus() {
        const memUsage = process.memoryUsage();
        const timeSinceLastClear = Date.now() - this.lastCacheClear;
        
        return {
            isRunning: this.isRunning,
            syncInterval: this.syncInterval,
            nodeId: this.registry.nodeId,
            processedRecordsCount: this.processedRecords.size,
            health: this.healthMonitor.getHealthStatus(),
            configuration: {
                privateRecordsEnabled: this.privateHandler.decryptionEnabled,
                trustedNodes: this.privateHandler.trustedNodes,
                cacheMaxAge: this.cacheMaxAge,
                cacheMaxAgeMinutes: Math.round(this.cacheMaxAge / 60000)
            },
            memory: {
                heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
                heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
                rssMB: Math.round(memUsage.rss / 1024 / 1024),
                externalMB: Math.round(memUsage.external / 1024 / 1024),
                cacheSize: this.processedRecords.size,
                timeSinceLastClearMinutes: Math.round(timeSinceLastClear / 60000),
                nextClearInMinutes: Math.round((this.cacheMaxAge - timeSinceLastClear) / 60000)
            }
        };
    }
    
    /**
     * Get health monitor instance for external access
     * @returns {SyncHealthMonitor} Health monitor instance
     */
    getHealthMonitor() {
        return this.healthMonitor;
    }
    
    /**
     * Force a sync cycle (for manual triggering)
     */
    async forceSync() {
        if (!this.isRunning) {
            throw new Error('Sync service is not running');
        }
        
        console.log('🔄 Forcing immediate sync cycle...');
        await this.performSync();
    }
    
    /**
     * Clear processed records cache (for testing or reset)
     */
    clearProcessedCache() {
        const previousSize = this.processedRecords.size;
        this.processedRecords.clear();
        console.log(`🗑️ Cleared processed records cache (${previousSize} records)`);
    }
}

/**
 * Sync service health monitoring
 */
class SyncHealthMonitor {
    constructor() {
        this.metrics = {
            totalDiscovered: 0,
            totalSynced: 0,
            totalErrors: 0,
            lastSyncTime: null,
            averageSyncTime: 0,
            syncCycles: 0
        };
    }
    
    recordSyncCycle(discovered, synced, errors, duration) {
        this.metrics.totalDiscovered += discovered;
        this.metrics.totalSynced += synced;
        this.metrics.totalErrors += errors;
        this.metrics.lastSyncTime = new Date();
        this.metrics.syncCycles++;
        
        // Update average sync time (exponential moving average)
        if (this.metrics.averageSyncTime === 0) {
            this.metrics.averageSyncTime = duration;
        } else {
            this.metrics.averageSyncTime = (this.metrics.averageSyncTime * 0.7) + (duration * 0.3);
        }
    }
    
    getHealthStatus() {
        const successRate = this.metrics.totalDiscovered > 0 
            ? (this.metrics.totalSynced / this.metrics.totalDiscovered) * 100 
            : 100;
            
        const isHealthy = successRate > 90 && 
                         this.metrics.totalErrors < 10 && 
                         this.metrics.lastSyncTime && 
                         (Date.now() - this.metrics.lastSyncTime.getTime()) < 120000; // Within last 2 minutes
            
        return {
            ...this.metrics,
            successRate: parseFloat(successRate.toFixed(2)),
            isHealthy,
            lastSyncAgo: this.metrics.lastSyncTime 
                ? Date.now() - this.metrics.lastSyncTime.getTime() 
                : null
        };
    }
    
    reset() {
        this.metrics = {
            totalDiscovered: 0,
            totalSynced: 0,
            totalErrors: 0,
            lastSyncTime: null,
            averageSyncTime: 0,
            syncCycles: 0
        };
        console.log('📊 Health monitor metrics reset');
    }
}

module.exports = { GunSyncService, SyncHealthMonitor };
