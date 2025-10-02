/**
 * OIP GUN Record Registry
 * Manages a distributed registry of OIP records across GUN network
 * Enables efficient discovery of OIP records from other nodes
 */

const { GunHelper } = require('./gun');
const { elasticClient } = require('./elasticsearch');

class OIPGunRegistry {
    constructor() {
        this.gunHelper = new GunHelper();
        this.registryRoot = process.env.GUN_REGISTRY_ROOT || 'oip:registry';
        this.nodeId = this.generateNodeId();
        this.lastSyncTimestamp = 0;
        
        console.log('🏗️ OIP GUN Registry initialized:', {
            registryRoot: this.registryRoot,
            nodeId: this.nodeId
        });
    }
    
    generateNodeId() {
        // Generate unique node identifier based on server config
        const crypto = require('crypto');
        
        // Use override if provided
        if (process.env.GUN_NODE_ID_OVERRIDE) {
            return process.env.GUN_NODE_ID_OVERRIDE;
        }
        
        // Generate based on server info
        const serverInfo = `${process.env.HOSTNAME || 'unknown'}:${process.env.PORT || 3005}:${Date.now()}`;
        return crypto.createHash('sha256').update(serverInfo).digest('hex').slice(0, 16);
    }
    
    /**
     * Register a new OIP record in the distributed registry
     * @param {string} recordDid - The DID of the record
     * @param {string} soul - The GUN soul identifier
     * @param {string} recordType - The type of record (post, conversationSession, etc.)
     * @param {string} creatorPubKey - Creator's public key
     */
    async registerOIPRecord(recordDid, soul, recordType, creatorPubKey) {
        try {
            console.log(`📝 Registering OIP record in GUN registry: ${recordDid}`);
            
            const registryEntry = {
                did: recordDid,
                soul: soul,
                recordType: recordType,
                creatorPubKey: creatorPubKey,
                nodeId: this.nodeId,
                timestamp: Date.now(),
                oipVersion: '0.8.0'
            };
            
            // Register in node-specific registry
            const nodeRegistryKey = `${this.registryRoot}:nodes:${this.nodeId}`;
            await this.gunHelper.putRecord(registryEntry, `${nodeRegistryKey}:${soul}`);
            
            // Register in global index for discovery
            const globalIndexKey = `${this.registryRoot}:index:${recordType}`;
            const indexEntry = {
                soul: soul,
                nodeId: this.nodeId,
                timestamp: Date.now()
            };
            await this.gunHelper.putRecord(indexEntry, `${globalIndexKey}:${soul}`);
            
            console.log('✅ Registered OIP record in GUN registry:', recordDid);
            
        } catch (error) {
            console.error('❌ Failed to register OIP record in registry:', error);
            throw error;
        }
    }
    
    /**
     * Discover OIP records from other nodes
     * @returns {Array} Array of discovered records with metadata
     */
    async discoverOIPRecords() {
        try {
            // console.log('🔍 Discovering OIP records from other nodes...'); // Commented out - too verbose
            const discoveredRecords = [];
            
            // Scan all record types in the global registry
            const recordTypes = [
                'post', 'image', 'video', 'audio', 'text', 'recipe', 'workout', 'exercise',
                'conversationSession', 'media', 'creatorRegistration', 'organization'
            ];
            
            for (const recordType of recordTypes) {
                const typeRecords = await this.discoverRecordsOfType(recordType);
                discoveredRecords.push(...typeRecords);
            }
            
            // Only log if we discovered new records
            if (discoveredRecords.length > 0) {
                console.log(`🔍 Discovered ${discoveredRecords.length} new OIP records from other nodes`);
            }
            return discoveredRecords;
            
        } catch (error) {
            console.error('❌ Error discovering OIP records:', error);
            return [];
        }
    }
    
    /**
     * Discover records of a specific type
     * @param {string} recordType - The type of records to discover
     * @returns {Array} Array of discovered records of this type
     */
    async discoverRecordsOfType(recordType) {
        const typeRecords = [];
        
        try {
            const globalIndexKey = `${this.registryRoot}:index:${recordType}`;
            
            // Get all records of this type from registry
            const typeIndex = await this.gunHelper.getRecord(globalIndexKey);
            if (!typeIndex) {
                return typeRecords;
            }
            
            for (const [soulKey, indexEntry] of Object.entries(typeIndex)) {
                // Skip metadata entries
                if (soulKey.startsWith('oip:') || soulKey.startsWith('_') || !indexEntry.soul) {
                    continue;
                }
                
                // Skip records from our own node
                if (indexEntry.nodeId === this.nodeId) {
                    continue;
                }
                
                // Check if we already have this record
                const recordExists = await this.checkRecordExists(indexEntry.soul);
                if (recordExists) {
                    continue;
                }
                
                // Fetch the actual record data
                const recordData = await this.gunHelper.getRecord(indexEntry.soul);
                if (this.isValidOIPRecord(recordData)) {
                    typeRecords.push({
                        soul: indexEntry.soul,
                        data: recordData,
                        sourceNodeId: indexEntry.nodeId,
                        discoveredAt: Date.now()
                    });
                    
                    console.log(`📥 Discovered ${recordType} record: ${recordData.oip?.did} from node ${indexEntry.nodeId}`);
                } else {
                    console.warn(`⚠️ Invalid OIP record structure for soul: ${indexEntry.soul}`);
                }
            }
            
        } catch (error) {
            console.error(`❌ Error discovering ${recordType} records:`, error);
        }
        
        return typeRecords;
    }
    
    /**
     * Validate that a record conforms to OIP structure
     * @param {Object} record - The record to validate
     * @returns {boolean} True if valid OIP record
     */
    isValidOIPRecord(record) {
        // Check basic OIP structure
        if (!record || !record.oip || !record.data) {
            return false;
        }
        
        // Check required OIP fields
        const oip = record.oip;
        if (!oip.ver || !oip.recordType || !oip.creator) {
            return false;
        }
        
        // Check version compatibility
        if (typeof oip.ver !== 'string' || !oip.ver.startsWith('0.8')) {
            return false;
        }
        
        // Check creator structure
        if (!oip.creator.publicKey || !oip.creator.didAddress) {
            return false;
        }
        
        return true;
    }
    
    /**
     * Check if we already have a record indexed locally
     * @param {string} soul - The GUN soul to check
     * @returns {boolean} True if record exists locally
     */
    async checkRecordExists(soul) {
        try {
            const did = `did:gun:${soul}`;
            const exists = await elasticClient.exists({
                index: 'records',
                id: did
            });
            return exists.body;
        } catch (error) {
            console.error(`Error checking if record exists for soul ${soul}:`, error);
            return false;
        }
    }
    
    /**
     * Get registry statistics for monitoring
     * @returns {Object} Registry statistics
     */
    async getRegistryStats() {
        try {
            const stats = {
                nodeId: this.nodeId,
                registryRoot: this.registryRoot,
                totalRecordsRegistered: 0,
                recordsByType: {}
            };
            
            // Count records by type
            const recordTypes = ['post', 'image', 'video', 'audio', 'conversationSession', 'media'];
            
            for (const recordType of recordTypes) {
                const globalIndexKey = `${this.registryRoot}:index:${recordType}`;
                const typeIndex = await this.gunHelper.getRecord(globalIndexKey);
                
                if (typeIndex) {
                    const count = Object.keys(typeIndex).filter(key => 
                        !key.startsWith('oip:') && !key.startsWith('_')
                    ).length;
                    
                    stats.recordsByType[recordType] = count;
                    stats.totalRecordsRegistered += count;
                }
            }
            
            return stats;
            
        } catch (error) {
            console.error('Error getting registry stats:', error);
            return {
                nodeId: this.nodeId,
                error: error.message
            };
        }
    }
}

module.exports = { OIPGunRegistry };
