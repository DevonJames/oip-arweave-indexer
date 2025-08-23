/**
 * Encryption Manager
 * Handles per-asset encryption, key management, and access control
 */

const crypto = require('crypto');
const { GunHelper } = require('../helpers/gun');

class EncryptionManager {
    constructor() {
        this.gunHelper = new GunHelper();
        this.keyCache = new Map(); // mediaId -> decryption key (memory only)
        this.accessControlCache = new Map(); // mediaId -> access control info
        
        // Encryption configuration
        this.algorithm = 'aes-256-gcm';
        this.keyLength = 32; // 256 bits
        this.ivLength = 16; // 128 bits
        this.tagLength = 16; // 128 bits
        this.keyDerivationIterations = 100000;
        
        // Key rotation settings
        this.keyRotationInterval = 7 * 24 * 60 * 60 * 1000; // 7 days
        this.maxKeyAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    }

    /**
     * Generate a new encryption key for a media asset
     * @param {string} mediaId - Content-addressable media ID
     * @param {Object} options - Encryption options
     * @returns {Promise<Object>} - Key information
     */
    async generateMediaKey(mediaId, options = {}) {
        try {
            const {
                recipients = [], // Array of public keys that can decrypt
                accessLevel = 'private', // 'public', 'private', 'restricted'
                expiresAt = null, // Optional expiration timestamp
                keyRotation = true // Enable automatic key rotation
            } = options;

            // Generate master key for this media
            const masterKey = crypto.randomBytes(this.keyLength);
            const keyId = crypto.createHash('sha256').update(masterKey).digest('hex').slice(0, 16);
            
            // Generate key metadata
            const keyMetadata = {
                keyId,
                mediaId,
                algorithm: this.algorithm,
                accessLevel,
                recipients: recipients.map(pubKey => this.hashPublicKey(pubKey)),
                createdAt: Date.now(),
                expiresAt,
                keyRotation,
                version: 1,
                status: 'active'
            };

            // Store encrypted key for each recipient
            const encryptedKeys = {};
            for (const recipientPubKey of recipients) {
                const recipientKeyHash = this.hashPublicKey(recipientPubKey);
                encryptedKeys[recipientKeyHash] = await this.encryptForRecipient(masterKey, recipientPubKey);
            }

            // Store key metadata in GUN (without the actual key)
            await this.storeKeyMetadata(mediaId, keyMetadata, encryptedKeys);
            
            // Cache the key temporarily
            this.keyCache.set(mediaId, {
                masterKey,
                metadata: keyMetadata,
                cachedAt: Date.now()
            });

            console.log(`🔐 Generated encryption key for ${mediaId} (keyId: ${keyId})`);
            
            return {
                keyId,
                mediaId,
                accessLevel,
                recipients: recipients.length,
                expiresAt,
                encrypted: true
            };

        } catch (error) {
            console.error('Failed to generate media key:', error);
            throw error;
        }
    }

    /**
     * Encrypt media buffer with per-asset key
     * @param {Buffer} mediaBuffer - Raw media data
     * @param {string} mediaId - Media identifier
     * @param {Object} keyInfo - Key information from generateMediaKey
     * @returns {Promise<Object>} - Encrypted data and metadata
     */
    async encryptMedia(mediaBuffer, mediaId, keyInfo) {
        try {
            const cachedKey = this.keyCache.get(mediaId);
            if (!cachedKey) {
                throw new Error(`Encryption key not found for ${mediaId}`);
            }

            const { masterKey } = cachedKey;
            
            // Generate IV for this encryption
            const iv = crypto.randomBytes(this.ivLength);
            
            // Create cipher
            const cipher = crypto.createCipheriv(this.algorithm, masterKey, iv);
            
            // Encrypt the media
            const encryptedChunks = [];
            encryptedChunks.push(cipher.update(mediaBuffer));
            encryptedChunks.push(cipher.final());
            
            const encryptedBuffer = Buffer.concat(encryptedChunks);
            const authTag = cipher.getAuthTag();
            
            // Create encrypted package
            const encryptedPackage = {
                version: 1,
                algorithm: this.algorithm,
                keyId: keyInfo.keyId,
                iv: iv.toString('base64'),
                authTag: authTag.toString('base64'),
                encryptedData: encryptedBuffer.toString('base64'),
                originalSize: mediaBuffer.length,
                encryptedAt: Date.now()
            };

            console.log(`🔒 Encrypted media ${mediaId} (${mediaBuffer.length} → ${encryptedBuffer.length} bytes)`);
            
            return {
                encryptedBuffer: Buffer.from(JSON.stringify(encryptedPackage)),
                encryptionInfo: {
                    encrypted: true,
                    keyId: keyInfo.keyId,
                    algorithm: this.algorithm,
                    originalSize: mediaBuffer.length,
                    encryptedSize: encryptedBuffer.length
                }
            };

        } catch (error) {
            console.error('Failed to encrypt media:', error);
            throw error;
        }
    }

    /**
     * Decrypt media buffer
     * @param {Buffer} encryptedBuffer - Encrypted media package
     * @param {string} mediaId - Media identifier  
     * @param {string} recipientPrivateKey - Private key for decryption
     * @returns {Promise<Buffer>} - Decrypted media data
     */
    async decryptMedia(encryptedBuffer, mediaId, recipientPrivateKey = null) {
        try {
            // Parse encrypted package
            const encryptedPackage = JSON.parse(encryptedBuffer.toString());
            
            if (encryptedPackage.version !== 1) {
                throw new Error(`Unsupported encryption version: ${encryptedPackage.version}`);
            }

            // Get decryption key
            let masterKey = null;
            
            // Try cached key first
            const cachedKey = this.keyCache.get(mediaId);
            if (cachedKey) {
                masterKey = cachedKey.masterKey;
            } else if (recipientPrivateKey) {
                // Retrieve and decrypt key for recipient
                masterKey = await this.retrieveKeyForRecipient(mediaId, recipientPrivateKey);
            } else {
                throw new Error('No decryption key available');
            }

            // Decrypt the media
            const iv = Buffer.from(encryptedPackage.iv, 'base64');
            const authTag = Buffer.from(encryptedPackage.authTag, 'base64');
            const encryptedData = Buffer.from(encryptedPackage.encryptedData, 'base64');
            
            const decipher = crypto.createDecipheriv(encryptedPackage.algorithm, masterKey, iv);
            decipher.setAuthTag(authTag);
            
            const decryptedChunks = [];
            decryptedChunks.push(decipher.update(encryptedData));
            decryptedChunks.push(decipher.final());
            
            const decryptedBuffer = Buffer.concat(decryptedChunks);
            
            console.log(`🔓 Decrypted media ${mediaId} (${encryptedData.length} → ${decryptedBuffer.length} bytes)`);
            
            return decryptedBuffer;

        } catch (error) {
            console.error('Failed to decrypt media:', error);
            throw error;
        }
    }

    /**
     * Check if user has access to encrypted media
     * @param {string} mediaId - Media identifier
     * @param {string} userPublicKey - User's public key
     * @returns {Promise<boolean>} - Access granted
     */
    async checkAccess(mediaId, userPublicKey) {
        try {
            const keyMetadata = await this.getKeyMetadata(mediaId);
            if (!keyMetadata) {
                return false; // No encryption metadata = no access
            }

            // Check if key has expired
            if (keyMetadata.expiresAt && Date.now() > keyMetadata.expiresAt) {
                console.log(`Access denied for ${mediaId}: key expired`);
                return false;
            }

            // Check if user is in recipients list
            const userKeyHash = this.hashPublicKey(userPublicKey);
            const hasAccess = keyMetadata.recipients.includes(userKeyHash);
            
            if (hasAccess) {
                console.log(`✅ Access granted for ${mediaId} to user ${userKeyHash.slice(0, 8)}...`);
            } else {
                console.log(`❌ Access denied for ${mediaId} to user ${userKeyHash.slice(0, 8)}...`);
            }
            
            return hasAccess;

        } catch (error) {
            console.error('Access check failed:', error);
            return false;
        }
    }

    /**
     * Add recipient to existing encrypted media
     * @param {string} mediaId - Media identifier
     * @param {string} newRecipientPubKey - New recipient's public key
     * @param {string} granterPrivateKey - Current recipient's private key (for authorization)
     * @returns {Promise<boolean>} - Success status
     */
    async addRecipient(mediaId, newRecipientPubKey, granterPrivateKey) {
        try {
            // Verify granter has access
            const granterPubKey = this.derivePublicKey(granterPrivateKey);
            const hasAccess = await this.checkAccess(mediaId, granterPubKey);
            
            if (!hasAccess) {
                throw new Error('Granter does not have access to this media');
            }

            // Retrieve master key
            const masterKey = await this.retrieveKeyForRecipient(mediaId, granterPrivateKey);
            
            // Get current metadata
            const keyMetadata = await this.getKeyMetadata(mediaId);
            const encryptedKeys = await this.getEncryptedKeys(mediaId);
            
            // Add new recipient
            const newRecipientHash = this.hashPublicKey(newRecipientPubKey);
            encryptedKeys[newRecipientHash] = await this.encryptForRecipient(masterKey, newRecipientPubKey);
            
            // Update metadata
            keyMetadata.recipients.push(newRecipientHash);
            keyMetadata.version += 1;
            
            // Store updated metadata
            await this.storeKeyMetadata(mediaId, keyMetadata, encryptedKeys);
            
            console.log(`➕ Added recipient ${newRecipientHash.slice(0, 8)}... to ${mediaId}`);
            return true;

        } catch (error) {
            console.error('Failed to add recipient:', error);
            return false;
        }
    }

    /**
     * Rotate encryption key for a media asset
     * @param {string} mediaId - Media identifier
     * @returns {Promise<boolean>} - Success status
     */
    async rotateKey(mediaId) {
        try {
            const keyMetadata = await this.getKeyMetadata(mediaId);
            if (!keyMetadata || !keyMetadata.keyRotation) {
                return false; // Key rotation not enabled
            }

            // Check if rotation is needed
            const keyAge = Date.now() - keyMetadata.createdAt;
            if (keyAge < this.keyRotationInterval) {
                return false; // Too early for rotation
            }

            console.log(`🔄 Rotating encryption key for ${mediaId}...`);
            
            // Generate new key but keep same recipients
            const recipients = await this.getRecipientsPublicKeys(keyMetadata.recipients);
            const newKeyInfo = await this.generateMediaKey(mediaId, {
                recipients,
                accessLevel: keyMetadata.accessLevel,
                expiresAt: keyMetadata.expiresAt,
                keyRotation: keyMetadata.keyRotation
            });

            // Mark old key as rotated
            keyMetadata.status = 'rotated';
            keyMetadata.rotatedAt = Date.now();
            keyMetadata.rotatedTo = newKeyInfo.keyId;
            
            await this.storeKeyMetadata(`${mediaId}_old_${keyMetadata.keyId}`, keyMetadata, {});
            
            console.log(`✅ Key rotated for ${mediaId}: ${keyMetadata.keyId} → ${newKeyInfo.keyId}`);
            return true;

        } catch (error) {
            console.error('Key rotation failed:', error);
            return false;
        }
    }

    // Helper methods
    hashPublicKey(publicKey) {
        return crypto.createHash('sha256').update(publicKey).digest('hex').slice(0, 16);
    }

    async encryptForRecipient(masterKey, recipientPubKey) {
        // Simplified encryption for recipient (in production, use proper public key encryption)
        const recipientHash = this.hashPublicKey(recipientPubKey);
        const derivedKey = crypto.pbkdf2Sync(recipientHash, 'salt', this.keyDerivationIterations, this.keyLength, 'sha256');
        
        const iv = crypto.randomBytes(this.ivLength);
        const cipher = crypto.createCipheriv(this.algorithm, derivedKey, iv);
        
        const encrypted = Buffer.concat([cipher.update(masterKey), cipher.final()]);
        const authTag = cipher.getAuthTag();
        
        return {
            iv: iv.toString('base64'),
            authTag: authTag.toString('base64'),
            encryptedKey: encrypted.toString('base64')
        };
    }

    async retrieveKeyForRecipient(mediaId, recipientPrivateKey) {
        const recipientPubKey = this.derivePublicKey(recipientPrivateKey);
        const recipientHash = this.hashPublicKey(recipientPubKey);
        
        const encryptedKeys = await this.getEncryptedKeys(mediaId);
        const encryptedKeyData = encryptedKeys[recipientHash];
        
        if (!encryptedKeyData) {
            throw new Error('No encrypted key found for recipient');
        }

        // Decrypt the master key
        const derivedKey = crypto.pbkdf2Sync(recipientHash, 'salt', this.keyDerivationIterations, this.keyLength, 'sha256');
        const iv = Buffer.from(encryptedKeyData.iv, 'base64');
        const authTag = Buffer.from(encryptedKeyData.authTag, 'base64');
        const encryptedKey = Buffer.from(encryptedKeyData.encryptedKey, 'base64');
        
        const decipher = crypto.createDecipheriv(this.algorithm, derivedKey, iv);
        decipher.setAuthTag(authTag);
        
        return Buffer.concat([decipher.update(encryptedKey), decipher.final()]);
    }

    derivePublicKey(privateKey) {
        // Simplified public key derivation (in production, use proper cryptographic methods)
        return crypto.createHash('sha256').update(privateKey).digest('hex');
    }

    async storeKeyMetadata(mediaId, metadata, encryptedKeys) {
        const keyData = {
            metadata,
            encryptedKeys,
            storedAt: Date.now()
        };
        
        await this.gunHelper.putRecord(keyData, `encryption:${mediaId}`, {
            localId: `enc_${mediaId}`
        });
    }

    async getKeyMetadata(mediaId) {
        try {
            const keyData = await this.gunHelper.getRecord(`encryption:${mediaId}`);
            return keyData?.data?.metadata || null;
        } catch (error) {
            console.warn('Failed to get key metadata:', error);
            return null;
        }
    }

    async getEncryptedKeys(mediaId) {
        try {
            const keyData = await this.gunHelper.getRecord(`encryption:${mediaId}`);
            return keyData?.data?.encryptedKeys || {};
        } catch (error) {
            console.warn('Failed to get encrypted keys:', error);
            return {};
        }
    }

    async getRecipientsPublicKeys(recipientHashes) {
        // In production, this would retrieve actual public keys from a key registry
        // For now, return the hashes as placeholders
        return recipientHashes;
    }

    getEncryptionStats() {
        return {
            cachedKeys: this.keyCache.size,
            algorithm: this.algorithm,
            keyLength: this.keyLength,
            keyRotationInterval: this.keyRotationInterval,
            maxKeyAge: this.maxKeyAge
        };
    }

    clearKeyCache() {
        this.keyCache.clear();
        console.log('🗑️ Encryption key cache cleared');
    }
}

module.exports = EncryptionManager;
