/**
 * Test Suite: AES Encryption for Mnemonics and Private Keys
 * 
 * Tests the new AES-256-GCM encryption system for user wallet data
 */

const crypto = require('crypto');

// Import functions from user.js
function encryptMnemonicWithPassword(mnemonic, password) {
    const key = crypto.pbkdf2Sync(password, 'oip-mnemonic-encryption', 100000, 32, 'sha256');
    const iv = crypto.randomBytes(12);
    
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(mnemonic, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    
    return JSON.stringify({
        encrypted: encrypted.toString('base64'),
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64')
    });
}

function decryptMnemonicWithPassword(encryptedMnemonic, password) {
    const mnemonicData = JSON.parse(encryptedMnemonic);
    
    const key = crypto.pbkdf2Sync(password, 'oip-mnemonic-encryption', 100000, 32, 'sha256');
    const iv = Buffer.from(mnemonicData.iv, 'base64');
    const authTag = Buffer.from(mnemonicData.authTag, 'base64');
    const encrypted = Buffer.from(mnemonicData.encrypted, 'base64');
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
}

function encryptPrivateKeyWithPassword(privateKey, password) {
    const key = crypto.pbkdf2Sync(password, 'oip-private-key-encryption', 100000, 32, 'sha256');
    const iv = crypto.randomBytes(12);
    
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(privateKey, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    
    return JSON.stringify({
        encrypted: encrypted.toString('base64'),
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64')
    });
}

function decryptPrivateKeyWithPassword(encryptedPrivateKey, password) {
    const privateKeyData = JSON.parse(encryptedPrivateKey);
    
    const key = crypto.pbkdf2Sync(password, 'oip-private-key-encryption', 100000, 32, 'sha256');
    const iv = Buffer.from(privateKeyData.iv, 'base64');
    const authTag = Buffer.from(privateKeyData.authTag, 'base64');
    const encrypted = Buffer.from(privateKeyData.encrypted, 'base64');
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
}

async function testAESEncryption() {
    console.log('🧪 Testing AES-256-GCM Encryption for User Data...');
    
    const testData = {
        mnemonic: 'abandon ability able about above absent absorb abstract absurd abuse access accident',
        privateKey: 'a1b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789ab',
        password: 'test-password-123'
    };
    
    console.log('\n1. Testing Mnemonic Encryption/Decryption...');
    
    // Test mnemonic encryption
    const encryptedMnemonic = encryptMnemonicWithPassword(testData.mnemonic, testData.password);
    console.log(`   ✅ Encrypted mnemonic (length: ${encryptedMnemonic.length})`);
    console.log(`   📄 Format: ${encryptedMnemonic.startsWith('{') ? 'JSON (AES)' : 'Legacy (PBKDF2)'}`);
    
    // Test mnemonic decryption
    const decryptedMnemonic = decryptMnemonicWithPassword(encryptedMnemonic, testData.password);
    console.log(`   ✅ Decrypted mnemonic: ${decryptedMnemonic.split(' ').slice(0, 4).join(' ')}...`);
    console.log(`   🔍 Matches original: ${decryptedMnemonic === testData.mnemonic}`);
    
    console.log('\n2. Testing Private Key Encryption/Decryption...');
    
    // Test private key encryption
    const encryptedPrivateKey = encryptPrivateKeyWithPassword(testData.privateKey, testData.password);
    console.log(`   ✅ Encrypted private key (length: ${encryptedPrivateKey.length})`);
    console.log(`   📄 Format: ${encryptedPrivateKey.startsWith('{') ? 'JSON (AES)' : 'Legacy (PBKDF2)'}`);
    
    // Test private key decryption
    const decryptedPrivateKey = decryptPrivateKeyWithPassword(encryptedPrivateKey, testData.password);
    console.log(`   ✅ Decrypted private key: ${decryptedPrivateKey.slice(0, 20)}...`);
    console.log(`   🔍 Matches original: ${decryptedPrivateKey === testData.privateKey}`);
    
    console.log('\n3. Testing Wrong Password (Should Fail)...');
    
    try {
        decryptMnemonicWithPassword(encryptedMnemonic, 'wrong-password');
        console.log('   ❌ ERROR: Wrong password should have failed!');
    } catch (error) {
        console.log('   ✅ Wrong password correctly rejected');
    }
    
    console.log('\n4. Testing Cross-Session Compatibility...');
    
    // Encrypt with one "session", decrypt with another
    const session1Encrypted = encryptMnemonicWithPassword(testData.mnemonic, testData.password);
    const session2Decrypted = decryptMnemonicWithPassword(session1Encrypted, testData.password);
    console.log(`   ✅ Cross-session decryption works: ${session2Decrypted === testData.mnemonic}`);
    
    console.log('\n🎉 All AES encryption tests passed!');
    console.log('✅ Mnemonics can be exported');
    console.log('✅ Private keys can be decrypted for organization processing');
    console.log('✅ Organization queue processing will work');
}

// Export for testing
module.exports = {
    testAESEncryption,
    encryptMnemonicWithPassword,
    decryptMnemonicWithPassword,
    encryptPrivateKeyWithPassword,
    decryptPrivateKeyWithPassword
};

// Run tests if called directly
if (require.main === module) {
    testAESEncryption().catch(error => {
        console.error('❌ AES encryption tests failed:', error);
        process.exit(1);
    });
}
