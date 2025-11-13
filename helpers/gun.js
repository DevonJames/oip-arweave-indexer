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
            // Create a more unique hash by including timestamp and random component
            const timestamp = Date.now();
            const randomComponent = Math.random().toString(36).slice(2, 8);
            
            // Include key identifying fields for better uniqueness
            const keyFields = {
                name: recordData.basic?.name || recordData.name,
                date: recordData.basic?.date || recordData.date,
                recordType: recordData.oip?.recordType || recordData.recordType,
                timestamp: timestamp,
                random: randomComponent
            };
            
            const canonicalString = JSON.stringify(keyFields, Object.keys(keyFields).sort());
            const contentHash = crypto.createHash('sha256')
                .update(canonicalString)
                .digest('hex')
                .slice(0, 12); // Longer hash for better uniqueness
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

            // Handle encryption for private records with smart encryption strategy
            if (options.encrypt) {
                console.log('🔒 Encrypting GUN record with smart encryption strategy');
                
                const userPublicKey = options.userPublicKey || options.publisherPubKey;
                const userPassword = options.userPassword;
                const accessControl = options.accessControl;
                
                if (!userPublicKey) {
                    throw new Error('User public key required for encryption');
                }
                
                // Determine encryption strategy based on access control
                const { OrganizationEncryption } = require('./organizationEncryption');
                const orgEncryption = new OrganizationEncryption();
                
                const encryptionStrategy = await orgEncryption.determineEncryptionStrategy(accessControl, userPublicKey);
                
                if (!encryptionStrategy.encrypt) {
                    console.log('🔓 No encryption needed for public record');
                    return; // Don't encrypt public records
                }
                
                let encryptionKey;
                let encryptionMetadata = {
                    encrypted: true,
                    encryptionMethod: 'aes-256-gcm'
                };
                
                if (encryptionStrategy.encryptionType === 'organization') {
                    // Use organization encryption key
                    encryptionKey = encryptionStrategy.encryptionKey;
                    encryptionMetadata.encryptionType = 'organization';
                    encryptionMetadata.encryptedForOrganization = encryptionStrategy.organizationDid;
                    encryptionMetadata.sharedWith = encryptionStrategy.sharedWith;
                    console.log(`🏢 Using organization encryption for: ${encryptionStrategy.organizationDid}`);
                    
                } else {
                    // Use per-user encryption (default for private records)
                    if (userPassword) {
                        try {
                            const { getUserGunEncryptionSalt, generateUserEncryptionKey } = require('../routes/user');
                            const userSalt = await getUserGunEncryptionSalt(userPublicKey, userPassword);
                            encryptionKey = generateUserEncryptionKey(userPublicKey, userSalt);
                            console.log('🔑 Using user-specific encryption key with personal salt');
                        } catch (error) {
                            console.warn('🔑 Failed to get user salt, falling back to public key only:', error.message);
                            encryptionKey = crypto.pbkdf2Sync(userPublicKey, 'oip-gun-fallback', 100000, 32, 'sha256');
                        }
                    } else {
                        encryptionKey = crypto.pbkdf2Sync(userPublicKey, 'oip-gun-fallback', 100000, 32, 'sha256');
                        console.log('🔑 Using public key only encryption (no password available)');
                    }
                    
                    encryptionMetadata.encryptionType = 'per-user';
                    encryptionMetadata.encryptedBy = userPublicKey;
                }
                
                // Perform AES-256-GCM encryption
                const algorithm = 'aes-256-gcm';
                const iv = crypto.randomBytes(12);
                const cipher = crypto.createCipheriv(algorithm, encryptionKey, iv);

                const plaintext = Buffer.from(JSON.stringify(gunRecord.data), 'utf8');
                const encryptedBuf = Buffer.concat([cipher.update(plaintext), cipher.final()]);
                const authTag = cipher.getAuthTag();

                gunRecord.data = {
                    encrypted: encryptedBuf.toString('base64'),
                    iv: iv.toString('base64'),
                    tag: authTag.toString('base64')
                };
                
                // Apply encryption metadata
                Object.assign(gunRecord.meta, encryptionMetadata);
                
                console.log(`✅ Encrypted record using ${encryptionStrategy.encryptionType} encryption`);
            }

            // console.log('📡 Sending HTTP PUT request to GUN API...');
            
            // Use HTTP API instead of GUN peer protocol
            const response = await axios.post(`${this.apiUrl}/put`, {
                soul: soul,
                data: gunRecord
            }, {
                timeout: 30000, // 30 second HTTP timeout (increased due to GUN radisk JSON parsing slowdowns)
                headers: {
                    'Content-Type': 'application/json'
                },
                // Explicitly use global agents (don't create new ones per request)
                httpAgent: axios.defaults.httpAgent,
                httpsAgent: axios.defaults.httpsAgent
            });

            if (response.data.success) {
                // console.log('✅ GUN record stored successfully via HTTP API');
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
                // Only log concise error message, full stack trace not needed
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
            // console.log('📡 Sending HTTP GET request to GUN API...'); // Commented out - too verbose
            
            // MEMORY LEAK FIX: Add retry with exponential backoff and socket cleanup for failed requests
            let lastError = null;
            let retryCount = 0;
            const maxRetries = 2;
            
            while (retryCount < maxRetries) {
                try {
                    const response = await axios.get(`${this.apiUrl}/get`, {
                        params: { soul },
                        timeout: 20000, // 20 second timeout (increased due to GUN radisk JSON parsing slowdowns)
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        // Explicitly use global agents (don't create new ones per request)
                        httpAgent: axios.defaults.httpAgent,
                        httpsAgent: axios.defaults.httpsAgent
                    });

            if (response.data.success) {
                let data = response.data.data;
                
                // Handle encrypted data with smart decryption strategy
                if (data.meta && data.meta.encrypted && data.meta.encryptionMethod === 'aes-256-gcm') {
                    console.log('🔓 Decrypting GUN record with smart decryption strategy');

                    const userPublicKey = options.userPublicKey;
                    const userPassword = options.userPassword;
                    const encryptionType = data.meta.encryptionType;
                    
                    if (!userPublicKey) {
                        throw new Error('User public key required for decryption');
                    }
                    
                    let decryptionResult;
                    
                    if (encryptionType === 'organization') {
                        // Use organization decryption
                        console.log('🏢 Attempting organization decryption');
                        const { OrganizationEncryption } = require('./organizationEncryption');
                        const orgEncryption = new OrganizationEncryption();
                        
                        try {
                            // For organization decryption, we need to pass request info for membership validation
                            decryptionResult = await orgEncryption.decryptWithOrganizationKey(data, userPublicKey);
                        } catch (orgError) {
                            console.warn('🏢 Organization decryption failed:', orgError.message);
                            throw new Error(`Organization decryption failed: ${orgError.message}`);
                        }
                        
                    } else if (encryptionType === 'per-user' || data.meta.encryptedBy) {
                        // Use per-user decryption
                        console.log('👤 Attempting per-user decryption');
                        const encryptedBy = data.meta.encryptedBy;
                        
                        if (encryptedBy && encryptedBy !== userPublicKey) {
                            throw new Error(`Cannot decrypt record: encrypted by ${encryptedBy.slice(0, 12)}..., but you are ${userPublicKey.slice(0, 12)}...`);
                        }
                        
                        let decryptionKey;
                        
                        if (userPassword) {
                            try {
                                const { getUserGunEncryptionSalt, generateUserEncryptionKey } = require('../routes/user');
                                const userSalt = await getUserGunEncryptionSalt(userPublicKey, userPassword);
                                decryptionKey = generateUserEncryptionKey(userPublicKey, userSalt);
                                console.log('🔑 Using user-specific decryption key with personal salt');
                            } catch (error) {
                                console.warn('🔑 Failed to get user salt for decryption, falling back to public key only:', error.message);
                                decryptionKey = crypto.pbkdf2Sync(userPublicKey, 'oip-gun-fallback', 100000, 32, 'sha256');
                            }
                        } else {
                            decryptionKey = crypto.pbkdf2Sync(userPublicKey, 'oip-gun-fallback', 100000, 32, 'sha256');
                            console.log('🔑 Using public key only decryption (no password available)');
                        }

                        const iv = Buffer.from(data.data.iv, 'base64');
                        const tag = Buffer.from(data.data.tag, 'base64');
                        const encryptedBuf = Buffer.from(data.data.encrypted, 'base64');
                        const decipher = crypto.createDecipheriv('aes-256-gcm', decryptionKey, iv);
                        decipher.setAuthTag(tag);

                        const dec = Buffer.concat([decipher.update(encryptedBuf), decipher.final()]);
                        const decryptedData = JSON.parse(dec.toString('utf8'));
                        
                        decryptionResult = {
                            data: decryptedData,
                            meta: {
                                ...data.meta,
                                encrypted: false,
                                wasEncrypted: true,
                                decryptedBy: userPublicKey
                            },
                            oip: data.oip
                        };
                        
                    } else {
                        // Legacy encryption without type metadata
                        console.log('🔄 Attempting legacy decryption');
                        const legacyKey = crypto.pbkdf2Sync('gun-encryption-key', 'salt', 100000, 32, 'sha256');
                        
                        const iv = Buffer.from(data.data.iv, 'base64');
                        const tag = Buffer.from(data.data.tag, 'base64');
                        const encryptedBuf = Buffer.from(data.data.encrypted, 'base64');
                        const decipher = crypto.createDecipheriv('aes-256-gcm', legacyKey, iv);
                        decipher.setAuthTag(tag);

                        const dec = Buffer.concat([decipher.update(encryptedBuf), decipher.final()]);
                        const decryptedData = JSON.parse(dec.toString('utf8'));
                        
                        decryptionResult = {
                            data: decryptedData,
                            meta: {
                                ...data.meta,
                                encrypted: false,
                                wasEncrypted: true,
                                isLegacyEncryption: true
                            },
                            oip: data.oip
                        };
                    }

                    console.log('🔍 Backend decrypted data structure:', decryptionResult.data);
                    console.log('🔍 Backend decrypted conversationSession:', decryptionResult.data?.conversationSession);

                    // Return the decrypted data with metadata
                    return {
                        ...decryptionResult,
                        _: data._ // Keep any other GUN metadata if needed
                    };
                }

                // console.log('✅ GUN record retrieved successfully via HTTP API');

                // Handle GUN reference objects - GUN sometimes returns { '#': 'path' } instead of actual data
                // This can happen with nested data structures or when data isn't fully loaded
                if (data.data && typeof data.data === 'object' && data.data['#'] && !data.meta?.wasEncrypted) {
                    console.log('🔍 Data contains GUN references, this indicates incomplete data retrieval');
                    console.log('🔍 Reference path:', data.data['#']);

                    // For now, return the data as-is since we can't easily resolve references via HTTP API
                    // The frontend will need to handle this case
                    return data;
                }

                return data;
            } else {
                return null; // Record not found
            }

                    // Success - exit retry loop
                    return response.data.success ? response.data.data : null;
                } catch (error) {
                    lastError = error;
                    retryCount++;
                    
                    // If 404, don't retry - record doesn't exist
                    if (error.response && error.response.status === 404) {
                        return null;
                    }
                    
                    // For other errors, retry with backoff
                    if (retryCount < maxRetries) {
                        const backoffMs = Math.pow(2, retryCount) * 100; // 200ms, 400ms
                        await new Promise(resolve => setTimeout(resolve, backoffMs));
                    }
                }
            }
            
            // If we exhausted retries, log but don't crash
            if (lastError) {
                console.error(`⚠️  Error in getRecord after ${maxRetries} retries:`, lastError.message);
                return null; // Return null instead of throwing
            }
            
        } catch (error) {
            console.error('❌ Unexpected error in getRecord:', error.message);
            return null; // Return null instead of throwing
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
                },
                // Explicitly use global agents (don't create new ones per request)
                httpAgent: axios.defaults.httpAgent,
                httpsAgent: axios.defaults.httpsAgent
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
