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
        this.syncInterval = parseInt(process.env.GUN_SYNC_INTERVAL) || 30000; // 30 seconds default
        this.processedRecords = new Set(); // Track processed records to avoid duplicates
        this.healthMonitor = new SyncHealthMonitor();
        
        console.log('🚀 GUN Sync Service initialized:', {
            syncInterval: this.syncInterval,
            nodeId: this.registry.nodeId
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
            // console.log('🔄 Starting GUN record sync cycle...'); // Commented out - too verbose
            
            // Discover records from other nodes (includes both public and private)
            const discoveredRecords = await this.privateHandler.discoverPrivateRecords();
            
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
            const records = existingGunRecords.hits.hits;
            
            for (const hit of records) {
                const record = hit._source;
                const did = record.oip.did || record.oip.didTx;
                const soul = did.replace('did:gun:', '');
                
                try {
                    // Register in the GUN registry for discovery by other nodes
                    await this.registry.registerOIPRecord(
                        did,
                        soul,
                        record.oip.recordType,
                        record.oip.creator.publicKey
                    );
                    
                    registeredCount++;
                    
                } catch (error) {
                    console.error(`❌ Failed to register existing record ${did}:`, error);
                }
            }
            
            console.log(`✅ Migrated ${registeredCount}/${records.length} existing GUN records to registry`);
            
        } catch (error) {
            console.error('❌ Error migrating existing records:', error);
        }
    }
    
    /**
     * Get sync service status and health information
     * @returns {Object} Status information
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            syncInterval: this.syncInterval,
            nodeId: this.registry.nodeId,
            processedRecordsCount: this.processedRecords.size,
            health: this.healthMonitor.getHealthStatus(),
            configuration: {
                privateRecordsEnabled: this.privateHandler.decryptionEnabled,
                trustedNodes: this.privateHandler.trustedNodes
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
