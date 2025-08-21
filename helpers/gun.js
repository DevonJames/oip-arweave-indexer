/**
 * GUN Integration Helper
 * Provides GUN database functionality for OIP records via HTTP API
 */

const crypto = require('crypto');
const axios = require('axios');

class GunHelper {
    constructor() {
        // Use HTTP API instead of GUN peer protocol
        const gunApiUrl = process.env.GUN_PEERS || 'http://gun-relay:8765';
        this.apiUrl = gunApiUrl.split(',')[0]; // Use first peer as API endpoint
        
        this.encryptionEnabled = process.env.GUN_ENABLE_ENCRYPTION === 'true';
        this.defaultPrivacy = process.env.GUN_DEFAULT_PRIVACY === 'true';
        
        console.log('GUN Helper initialized with HTTP API:', {
            apiUrl: this.apiUrl,
            encryptionEnabled: this.encryptionEnabled,
            defaultPrivacy: this.defaultPrivacy
        });
    }

    /**
     * Generate deterministic soul for record (shortened format)
     * @param {string} publisherPubKey - Publisher's public key
     * @param {string|null} localId - Optional local identifier
     * @param {Object|null} recordData - Record data for content hash fallback
     * @returns {string} - Deterministic soul string (much shorter)
     */
    computeSoul(publisherPubKey, localId = null, recordData = null) {
        // Create a shorter hash of the public key (first 12 chars)
        const pubKeyHash = crypto.createHash('sha256')
            .update(publisherPubKey)
            .digest('hex')
            .slice(0, 12);
            
        if (localId) {
            // User-provided local ID: pubKeyHash:localId
            return `${pubKeyHash}:${localId}`;
        }
        
        // Fallback: content hash for deterministic soul generation
        if (recordData) {
            const canonicalString = JSON.stringify(recordData, Object.keys(recordData).sort());
            const contentHash = crypto.createHash('sha256')
                .update(canonicalString)
                .digest('hex')
                .slice(0, 8); // Short content hash
            return `${pubKeyHash}:h:${contentHash}`;
        }
        
        // Last resort: timestamp-based (not deterministic, but unique)
        const timestamp = Date.now().toString(36); // Base36 for shorter format
        return `${pubKeyHash}:t:${timestamp}`;
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
            const gunRecord = {
                data: recordData.data,
                oip: recordData.oip,
                meta: {
                    created: Date.now(),
                    localId: options.localId || null,
                    encrypted: false
                }
            };

            // Handle encryption for private records (simplified for HTTP API)
            if (options.encrypt) {
                console.log('🔒 Encrypting GUN record for private storage');
                
                // Modern encryption using crypto module
                const algorithm = 'aes-256-gcm';
                const key = crypto.scryptSync('gun-encryption-key', 'salt', 32);
                const iv = crypto.randomBytes(16);
                const cipher = crypto.createCipheriv(algorithm, key, iv);
                
                let encrypted = cipher.update(JSON.stringify(gunRecord.data), 'utf8', 'hex');
                encrypted += cipher.final('hex');
                
                gunRecord.data = {
                    encrypted: encrypted,
                    iv: iv.toString('hex')
                };
                gunRecord.meta.encrypted = true;
                gunRecord.meta.encryptionMethod = algorithm;
            }

            console.log('📡 Sending HTTP PUT request to GUN API...');
            
            // Use HTTP API instead of GUN peer protocol
            const response = await axios.post(`${this.apiUrl}/put`, {
                soul: soul,
                data: gunRecord
            }, {
                timeout: 10000, // 10 second HTTP timeout
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (response.data.success) {
                console.log('✅ GUN record stored successfully via HTTP API');
                return { 
                    soul, 
                    did: `did:gun:${soul}`,
                    encrypted: gunRecord.meta.encrypted
                };
            } else {
                throw new Error(`GUN API error: ${response.data.error}`);
            }

        } catch (error) {
            if (error.code === 'ECONNREFUSED') {
                throw new Error('GUN relay not accessible - check if gun-relay service is running');
            } else if (error.code === 'ETIMEDOUT') {
                throw new Error('GUN relay timeout - service may be overloaded');
            } else {
                console.error('❌ Error in putRecord:', error.message);
                throw error;
            }
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
            console.log('📡 Sending HTTP GET request to GUN API...');
            
            const response = await axios.get(`${this.apiUrl}/get`, {
                params: { soul },
                timeout: 5000,
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (response.data.success) {
                let data = response.data.data;
                
                // Handle encrypted data
                if (data.meta && data.meta.encrypted && data.meta.encryptionMethod === 'aes-256-gcm') {
                    console.log('🔓 Decrypting GUN record');
                    
                    const key = crypto.scryptSync('gun-encryption-key', 'salt', 32);
                    const iv = Buffer.from(data.data.iv, 'hex');
                    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
                    
                    let decrypted = decipher.update(data.data.encrypted, 'hex', 'utf8');
                    decrypted += decipher.final('utf8');
                    
                    data.data = JSON.parse(decrypted);
                    data.meta.encrypted = false;
                }

                console.log('✅ GUN record retrieved successfully via HTTP API');
                return data;
            } else {
                return null; // Record not found
            }

        } catch (error) {
            if (error.response && error.response.status === 404) {
                return null; // Record not found
            }
            
            console.error('❌ Error in getRecord:', error.message);
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
