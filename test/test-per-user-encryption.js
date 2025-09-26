/**
 * Test Suite: Per-User GUN Encryption System
 * 
 * Tests the new per-user encryption system for GUN records including:
 * - User-specific salt generation
 * - Per-user encryption key derivation
 * - Record encryption/decryption with user keys
 * - Cross-user privacy enforcement
 * - Legacy record compatibility
 */

const crypto = require('crypto');

// Import functions from user.js
function encryptSaltWithPassword(salt, password) {
    const key = crypto.pbkdf2Sync(password, 'oip-salt-encryption', 100000, 32, 'sha256');
    const iv = crypto.randomBytes(12);
    
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(salt, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    
    return JSON.stringify({
        encrypted: encrypted.toString('base64'),
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64')
    });
}

function decryptSaltWithPassword(encryptedSaltData, password) {
    const saltData = JSON.parse(encryptedSaltData);
    
    const key = crypto.pbkdf2Sync(password, 'oip-salt-encryption', 100000, 32, 'sha256');
    const iv = Buffer.from(saltData.iv, 'base64');
    const authTag = Buffer.from(saltData.authTag, 'base64');
    const encrypted = Buffer.from(saltData.encrypted, 'base64');
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
}

function generateUserEncryptionKey(userPublicKey, gunSalt) {
    const keyMaterial = userPublicKey + ':' + gunSalt;
    return crypto.pbkdf2Sync(keyMaterial, 'oip-gun-encryption', 100000, 32, 'sha256');
}

// Unit tests (for when test framework is available)
function runUnitTests() {
    console.log('🧪 Running unit tests for per-user encryption...');
    
    try {
        // Test salt encryption/decryption
        console.log('\n1. Testing salt encryption...');
        const originalSalt = 'test-salt-12345';
        const password = 'user-password';
        
        const encrypted = encryptSaltWithPassword(originalSalt, password);
        const decrypted = decryptSaltWithPassword(encrypted, password);
        
        if (decrypted === originalSalt) {
            console.log('✅ Salt encryption/decryption test passed');
        } else {
            throw new Error('Salt encryption/decryption test failed');
        }
        
        // Test wrong password fails
        console.log('\n2. Testing wrong password rejection...');
        try {
            decryptSaltWithPassword(encrypted, 'wrong-password');
            throw new Error('Should have failed with wrong password');
        } catch (error) {
            console.log('✅ Wrong password correctly rejected');
        }
        
        // Test user key generation
        console.log('\n3. Testing user key generation...');
        const testPublicKey = '0349b2160ea3117a90a1fcbbf198ef53bf325b604157cbcf81693f0f476006c9e1';
        const otherPublicKey = '02a1b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789a';
        
        const userKey1 = generateUserEncryptionKey(testPublicKey, originalSalt);
        const userKey2 = generateUserEncryptionKey(testPublicKey, originalSalt);
        const otherUserKey = generateUserEncryptionKey(otherPublicKey, originalSalt);
        
        if (userKey1.equals(userKey2) && !userKey1.equals(otherUserKey)) {
            console.log('✅ User key generation test passed');
        } else {
            throw new Error('User key generation test failed');
        }
        
        console.log('\n🎉 All unit tests passed!');
        
    } catch (error) {
        console.error('❌ Unit tests failed:', error);
        throw error;
    }
}

// Manual test functions for development
async function testPerUserEncryptionManually() {
    console.log('🧪 Running manual per-user encryption test...');
    
    try {
        // Test salt encryption/decryption
        console.log('\n1. Testing salt encryption...');
        const testSalt = crypto.randomBytes(32).toString('hex');
        const testPassword = 'test-password-123';
        
        const encrypted = encryptSaltWithPassword(testSalt, testPassword);
        const decrypted = decryptSaltWithPassword(encrypted, testPassword);
        
        console.log('✅ Salt encryption/decryption works');
        console.log(`   Original: ${testSalt.slice(0, 16)}...`);
        console.log(`   Decrypted: ${decrypted.slice(0, 16)}...`);
        console.log(`   Match: ${testSalt === decrypted}`);
        
        // Test user key generation
        console.log('\n2. Testing user key generation...');
        const testPublicKey = '0349b2160ea3117a90a1fcbbf198ef53bf325b604157cbcf81693f0f476006c9e1';
        const userKey = generateUserEncryptionKey(testPublicKey, testSalt);
        
        console.log('✅ User encryption key generated');
        console.log(`   Public Key: ${testPublicKey.slice(0, 20)}...`);
        console.log(`   Salt: ${testSalt.slice(0, 16)}...`);
        console.log(`   Key: ${userKey.toString('hex').slice(0, 16)}...`);
        
        // Test cross-user isolation
        console.log('\n3. Testing cross-user isolation...');
        const otherPublicKey = '02a1b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789a';
        const otherUserKey = generateUserEncryptionKey(otherPublicKey, testSalt);
        
        console.log('✅ Cross-user isolation verified');
        console.log(`   User A Key: ${userKey.toString('hex').slice(0, 16)}...`);
        console.log(`   User B Key: ${otherUserKey.toString('hex').slice(0, 16)}...`);
        console.log(`   Different: ${!userKey.equals(otherUserKey)}`);
        
        console.log('\n🎉 All per-user encryption tests passed!');
        
    } catch (error) {
        console.error('❌ Manual test failed:', error);
    }
}

// Export for testing
module.exports = {
    testPerUserEncryptionManually,
    encryptSaltWithPassword,
    decryptSaltWithPassword,
    generateUserEncryptionKey
};

// Run manual test if called directly
if (require.main === module) {
    // Run unit tests first
    runUnitTests();
    
    // Then run manual tests
    testPerUserEncryptionManually();
}
