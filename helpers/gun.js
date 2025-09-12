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
                
                // AES-256-GCM with auth tag persisted
                const algorithm = 'aes-256-gcm';
                // Use PBKDF2 for key derivation (matches frontend Web Crypto API)
                const key = crypto.pbkdf2Sync('gun-encryption-key', 'salt', 100000, 32, 'sha256');
                const iv = crypto.randomBytes(12); // 12-byte IV recommended for GCM
                const cipher = crypto.createCipheriv(algorithm, key, iv);

                const plaintext = Buffer.from(JSON.stringify(gunRecord.data), 'utf8');
                const encryptedBuf = Buffer.concat([cipher.update(plaintext), cipher.final()]);
                const authTag = cipher.getAuthTag();

                gunRecord.data = {
                    encrypted: encryptedBuf.toString('base64'),
                    iv: iv.toString('base64'),
                    tag: authTag.toString('base64')
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

                    // Use PBKDF2 for key derivation (matches frontend Web Crypto API)
                    const key = crypto.pbkdf2Sync('gun-encryption-key', 'salt', 100000, 32, 'sha256');
                    const iv = Buffer.from(data.data.iv, 'base64');
                    const tag = Buffer.from(data.data.tag, 'base64');
                    const encryptedBuf = Buffer.from(data.data.encrypted, 'base64');
                    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
                    decipher.setAuthTag(tag);

                    const dec = Buffer.concat([decipher.update(encryptedBuf), decipher.final()]);
                    const decryptedData = JSON.parse(dec.toString('utf8'));

                    // Replace the entire data structure with the decrypted content
                    data.data = decryptedData;
                    data.meta.encrypted = false;
                    data.meta.wasEncrypted = true; // Mark that it was decrypted
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
     * List user records (alias for listRecordsByPublisher for API compatibility)
     * @param {string} publisherPubKey - Publisher's public key
     * @param {Object} options - Query options
     * @param {number} options.limit - Maximum number of records to return
     * @param {number} options.offset - Offset for pagination
     * @param {string} options.recordType - Filter by record type
     * @returns {Promise<Array>} - Array of records
     */
    async listUserRecords(publisherPubKey, options = {}) {
        return this.listRecordsByPublisher(publisherPubKey, options);
    }

    /**
     * List records by publisher
     * @param {string} publisherPubKey - Publisher's public key
     * @param {Object} options - Query options
     * @param {number} options.limit - Maximum number of records to return
     * @param {number} options.offset - Offset for pagination
     * @param {string} options.recordType - Filter by record type
     * @returns {Promise<Array>} - Array of records
     */
    async listRecordsByPublisher(publisherPubKey, options = {}) {
        const { limit = 50, offset = 0, recordType } = options;
        
        try {
            console.log('📡 Listing user records via HTTP API...');
            
            // Create hash of the public key (first 12 chars) to match GUN soul format
            const pubKeyHash = crypto.createHash('sha256')
                .update(publisherPubKey)
                .digest('hex')
                .slice(0, 12);

            const response = await axios.get(`${this.apiUrl}/list`, {
                params: { 
                    publisherHash: pubKeyHash,
                    limit,
                    offset,
                    recordType
                },
                timeout: 10000,
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (response.data.success) {
                const records = response.data.records || [];
                
                // Process and decrypt records as needed
                const processedRecords = await Promise.all(records.map(async (record) => {
                    // Handle encrypted data if present
                    if (record.meta && record.meta.encrypted && record.meta.encryptionMethod === 'aes-256-gcm') {
                        console.log('🔓 Decrypting GUN record');
                        
                        const key = crypto.scryptSync('gun-encryption-key', 'salt', 32);
                        const iv = Buffer.from(record.data.iv, 'hex');
                        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
                        
                        let decrypted = decipher.update(record.data.encrypted, 'hex', 'utf8');
                        decrypted += decipher.final('utf8');
                        
                        record.data = JSON.parse(decrypted);
                        record.meta.encrypted = false;
                    }
                    
                    return {
                        soul: record.soul,
                        did: `did:gun:${record.soul}`,
                        ...record
                    };
                }));

                console.log('✅ Retrieved', processedRecords.length, 'GUN records via HTTP API');
                return processedRecords;
            } else {
                console.log('No records found for publisher');
                return [];
            }

        } catch (error) {
            if (error.code === 'ECONNREFUSED') {
                console.error('GUN relay not accessible - check if gun-relay service is running');
                return [];
            } else if (error.code === 'ETIMEDOUT') {
                console.error('GUN relay timeout - service may be overloaded');
                return [];
            } else {
                console.error('❌ Error listing records by publisher:', error.message);
                return [];
            }
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
