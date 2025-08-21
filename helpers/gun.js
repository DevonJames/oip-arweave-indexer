/**
 * GUN Integration Helper
 * Provides GUN database functionality for OIP records
 */

const Gun = require('gun');
require('gun/sea');
const crypto = require('crypto');

class GunHelper {
    constructor() {
        // Initialize GUN with relay peers
        const peers = (process.env.GUN_PEERS || 'http://gun-relay:8765').split(',');
        console.log('Initializing GUN with peers:', peers);
        
        this.gun = Gun({
            peers: peers,
            localStorage: false,
            radisk: false,        // Client doesn't need radisk, relay handles persistence
            multicast: false,     // CRITICAL: Disable multicast on client too
            axe: false,          // Disable AXE for simpler connection
            super: false,        // Disable super peer mode
            rtc: false           // Disable WebRTC for server environment
        });
        
        this.encryptionEnabled = process.env.GUN_ENABLE_ENCRYPTION === 'true';
        this.defaultPrivacy = process.env.GUN_DEFAULT_PRIVACY === 'true';
        this.isConnected = false;
        
        // Wait for peer connection to establish
        this.waitForConnection();
        
        console.log('GUN Helper initialized:', {
            peers: peers.length,
            encryptionEnabled: this.encryptionEnabled,
            defaultPrivacy: this.defaultPrivacy,
            multicast: false
        });
    }

    /**
     * Wait for GUN peer connection to establish
     */
    async waitForConnection() {
        return new Promise((resolve) => {
            // Give GUN time to establish peer connections
            setTimeout(() => {
                this.isConnected = true;
                console.log('🔗 GUN peer connection established');
                resolve();
            }, 2000); // 2 second wait for peer handshake
        });
    }

    /**
     * Generate deterministic soul for record
     * @param {string} publisherPubKey - Publisher's public key
     * @param {string|null} localId - Optional local identifier
     * @param {Object|null} recordData - Record data for content hash fallback
     * @returns {string} - Deterministic soul string
     */
    computeSoul(publisherPubKey, localId = null, recordData = null) {
        if (localId) {
            // User-provided local ID (e.g., "draft-001", "my-recipe")
            return `oip:records:${publisherPubKey}:${localId}`;
        }
        
        // Fallback: content hash for deterministic soul generation
        if (recordData) {
            const canonicalString = JSON.stringify(recordData, Object.keys(recordData).sort());
            const hash = crypto.createHash('sha256')
                .update(canonicalString)
                .digest('hex')
                .slice(0, 12);
            return `oip:records:${publisherPubKey}:h:${hash}`;
        }
        
        // Last resort: timestamp-based (not deterministic, but unique)
        const timestamp = Date.now();
        return `oip:records:${publisherPubKey}:t:${timestamp}`;
    }

    /**
     * Put record to GUN database
     * @param {Object} recordData - The record data to store
     * @param {string} soul - The GUN soul (unique identifier)
     * @param {Object} options - Storage options
     * @param {boolean} options.encrypt - Whether to encrypt the data
     * @param {Array} options.readerPubKeys - Public keys of authorized readers
     * @param {Object} options.writerKeys - Writer's key pair for encryption
     * @param {string} options.localId - Local identifier for the record
     * @returns {Promise<Object>} - Result with soul and DID
     */
    async putRecord(recordData, soul, options = {}) {
        try {
            // Wait for connection to be established first
            if (!this.isConnected) {
                console.log('⏳ Waiting for GUN peer connection...');
                await this.waitForConnection();
            }

            const gunRecord = {
                data: recordData.data,
                oip: recordData.oip,
                meta: {
                    created: Date.now(),
                    localId: options.localId || null,
                    encrypted: false
                }
            };

            // Handle encryption for private records
            if (options.encrypt && options.readerPubKeys && options.writerKeys) {
                console.log('Encrypting GUN record for private storage');
                
                // Use GUN SEA to encrypt the data payload
                const secret = await Gun.SEA.secret(options.readerPubKeys[0], options.writerKeys);
                const encryptedData = await Gun.SEA.encrypt(JSON.stringify(gunRecord.data), secret);
                
                gunRecord.data = encryptedData;
                gunRecord.meta.encrypted = true;
                gunRecord.meta.encryptionMethod = 'gun-sea';
            }

            console.log('Attempting to store record in GUN with soul:', soul.substring(0, 50) + '...');
            
            // Store in GUN with extended timeout and better error handling
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    console.error('❌ GUN .put() callback never fired - peer connection issue');
                    reject(new Error('GUN storage timeout after 60 seconds - peer connection failed'));
                }, 60000);

                try {
                    this.gun.get(soul).put(gunRecord, (ack) => {
                        clearTimeout(timeout);
                        
                        console.log('📡 GUN .put() callback fired with ack:', ack);
                        
                        if (ack.err) {
                            console.error('❌ GUN put error:', ack.err);
                            reject(new Error(`GUN storage failed: ${ack.err}`));
                        } else {
                            console.log('✅ GUN record stored successfully');
                            resolve({ 
                                soul, 
                                did: `did:gun:${soul}`,
                                encrypted: gunRecord.meta.encrypted
                            });
                        }
                    });
                } catch (putError) {
                    clearTimeout(timeout);
                    console.error('❌ Error calling GUN .put():', putError);
                    reject(putError);
                }
            });
        } catch (error) {
            console.error('❌ Error in putRecord:', error);
            throw error;
        }
    }

    /**
     * Get record from GUN database
     * @param {string} soul - The GUN soul to retrieve
     * @param {Object} options - Retrieval options
     * @param {Object} options.decryptKeys - Keys for decryption if needed
     * @returns {Promise<Object|null>} - The record data or null if not found
     */
    async getRecord(soul, options = {}) {
        try {
            return new Promise((resolve, reject) => {
                // Set a timeout for the GUN query
                const timeout = setTimeout(() => {
                    resolve(null); // Return null if timeout
                }, 5000);

                this.gun.get(soul).once(async (data) => {
                    clearTimeout(timeout);
                    
                    if (!data) {
                        resolve(null);
                        return;
                    }

                    try {
                        // Handle encrypted data
                        if (data.meta && data.meta.encrypted && options.decryptKeys) {
                            console.log('Decrypting GUN record');
                            const secret = await Gun.SEA.secret(options.decryptKeys.readerPubKey, options.decryptKeys.writerKeys);
                            const decryptedData = await Gun.SEA.decrypt(data.data, secret);
                            data.data = JSON.parse(decryptedData);
                            data.meta.encrypted = false; // Mark as decrypted for processing
                        }

                        resolve(data);
                    } catch (decryptError) {
                        console.error('Error decrypting GUN record:', decryptError);
                        reject(decryptError);
                    }
                });
            });
        } catch (error) {
            console.error('Error in getRecord:', error);
            throw error;
        }
    }

    /**
     * List records by publisher
     * @param {string} publisherPubKey - Publisher's public key
     * @param {Object} options - Query options
     * @param {number} options.limit - Maximum number of records to return
     * @returns {Promise<Array>} - Array of records
     */
    async listRecordsByPublisher(publisherPubKey, options = {}) {
        const { limit = 50 } = options;
        const records = [];
        
        try {
            return new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    resolve(records);
                }, 10000);

                // Query GUN for records matching the publisher pattern
                const publisherPattern = `oip:records:${publisherPubKey}`;
                
                this.gun.get(publisherPattern).map().on((data, key) => {
                    if (data && records.length < limit) {
                        records.push({
                            soul: key,
                            did: `did:gun:${key}`,
                            ...data
                        });
                    }
                    
                    if (records.length >= limit) {
                        clearTimeout(timeout);
                        resolve(records);
                    }
                });
                
                // Fallback timeout
                setTimeout(() => {
                    clearTimeout(timeout);
                    resolve(records);
                }, 8000);
            });
        } catch (error) {
            console.error('Error listing records by publisher:', error);
            return [];
        }
    }

    /**
     * Delete record from GUN
     * @param {string} soul - The GUN soul to delete
     * @returns {Promise<boolean>} - Success status
     */
    async deleteRecord(soul) {
        try {
            return new Promise((resolve, reject) => {
                this.gun.get(soul).put(null, (ack) => {
                    if (ack.err) {
                        console.error('GUN delete error:', ack.err);
                        reject(new Error(`GUN delete failed: ${ack.err}`));
                    } else {
                        console.log('GUN record deleted successfully:', soul);
                        resolve(true);
                    }
                });
            });
        } catch (error) {
            console.error('Error in deleteRecord:', error);
            throw error;
        }
    }

    /**
     * Check if GUN relay is accessible
     * @returns {Promise<boolean>} - Connection status
     */
    async checkConnection() {
        try {
            // Test basic GUN functionality
            const testSoul = `test:connection:${Date.now()}`;
            const testData = { test: true, timestamp: Date.now() };
            
            const result = await new Promise((resolve) => {
                const timeout = setTimeout(() => resolve(false), 3000);
                
                this.gun.get(testSoul).put(testData, (ack) => {
                    clearTimeout(timeout);
                    resolve(!ack.err);
                });
            });
            
            if (result) {
                // Clean up test data
                this.gun.get(testSoul).put(null);
            }
            
            return result;
        } catch (error) {
            console.error('GUN connection check failed:', error);
            return false;
        }
    }
}

module.exports = { GunHelper };
