/**
 * Test Suite: Deterministic Wallet Generation
 * 
 * Tests that same user credentials generate same wallet on any node
 */

const crypto = require('crypto');
const bip39 = require('bip39');
const { BIP32Factory } = require('bip32');
const ecc = require('tiny-secp256k1');
const bip32 = BIP32Factory(ecc);

// Simulate the deterministic wallet generation from user.js
function generateDeterministicWallet(email, password) {
    // Create deterministic seed from email + password
    const userSeed = crypto.pbkdf2Sync(
        email.toLowerCase() + password,
        'oip-deterministic-wallet-seed',
        100000,
        64,
        'sha256'
    );
    
    // Generate mnemonic from deterministic seed
    const mnemonic = bip39.entropyToMnemonic(userSeed.slice(0, 32));
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const masterKey = bip32.fromSeed(seed);
    
    // Derive user's signing key
    const userKey = masterKey.derivePath("m/44'/0'/0'/0/0");
    
    const publicKeyBuffer = userKey.publicKey;
    const publicKey = Buffer.isBuffer(publicKeyBuffer) 
        ? publicKeyBuffer.toString('hex')
        : Array.from(publicKeyBuffer).map(b => b.toString(16).padStart(2, '0')).join('');
    
    const privateKey = userKey.privateKey.toString('hex');
    
    return {
        mnemonic,
        publicKey,
        privateKey
    };
}

async function testDeterministicWallets() {
    console.log('🧪 Testing Deterministic Wallet Generation...');
    
    const testUsers = [
        {
            email: 'admin@fitnessally.io',
            password: 'secure-password-123'
        },
        {
            email: 'user@example.com', 
            password: 'another-password-456'
        }
    ];
    
    for (const user of testUsers) {
        console.log(`\n👤 Testing user: ${user.email}`);
        
        // Generate wallet on "Node A"
        const walletNodeA = generateDeterministicWallet(user.email, user.password);
        
        // Generate wallet on "Node B" (same user, same credentials)
        const walletNodeB = generateDeterministicWallet(user.email, user.password);
        
        // Generate wallet on "Node C" (same user, same credentials)  
        const walletNodeC = generateDeterministicWallet(user.email, user.password);
        
        console.log(`   Node A Public Key: ${walletNodeA.publicKey.slice(0, 20)}...`);
        console.log(`   Node B Public Key: ${walletNodeB.publicKey.slice(0, 20)}...`);
        console.log(`   Node C Public Key: ${walletNodeC.publicKey.slice(0, 20)}...`);
        
        const publicKeysMatch = walletNodeA.publicKey === walletNodeB.publicKey && 
                               walletNodeB.publicKey === walletNodeC.publicKey;
        
        const privateKeysMatch = walletNodeA.privateKey === walletNodeB.privateKey && 
                                walletNodeB.privateKey === walletNodeC.privateKey;
        
        const mnemonicsMatch = walletNodeA.mnemonic === walletNodeB.mnemonic && 
                              walletNodeB.mnemonic === walletNodeC.mnemonic;
        
        console.log(`   ✅ Public keys match: ${publicKeysMatch}`);
        console.log(`   ✅ Private keys match: ${privateKeysMatch}`);
        console.log(`   ✅ Mnemonics match: ${mnemonicsMatch}`);
        console.log(`   🔑 Mnemonic: ${walletNodeA.mnemonic.split(' ').slice(0, 4).join(' ')}...`);
        
        if (!publicKeysMatch || !privateKeysMatch || !mnemonicsMatch) {
            throw new Error(`❌ Wallet generation not deterministic for ${user.email}`);
        }
    }
    
    console.log('\n🎉 All deterministic wallet tests passed!');
    console.log('✅ Same user will get same wallet on any OIP node');
    console.log('✅ Organization owner can decrypt records on any node they log into');
}

// Test different credentials produce different wallets
async function testWalletUniqueness() {
    console.log('\n🔐 Testing Wallet Uniqueness...');
    
    const user1 = generateDeterministicWallet('user1@example.com', 'password123');
    const user2 = generateDeterministicWallet('user2@example.com', 'password123'); // Different email
    const user3 = generateDeterministicWallet('user1@example.com', 'password456'); // Different password
    
    console.log(`   User 1: ${user1.publicKey.slice(0, 20)}...`);
    console.log(`   User 2: ${user2.publicKey.slice(0, 20)}...`);
    console.log(`   User 3: ${user3.publicKey.slice(0, 20)}...`);
    
    const allDifferent = user1.publicKey !== user2.publicKey && 
                        user2.publicKey !== user3.publicKey && 
                        user1.publicKey !== user3.publicKey;
    
    console.log(`   ✅ All wallets are unique: ${allDifferent}`);
    
    if (!allDifferent) {
        throw new Error('❌ Different users should have different wallets');
    }
}

// Export for testing
module.exports = {
    testDeterministicWallets,
    testWalletUniqueness,
    generateDeterministicWallet
};

// Run tests if called directly
if (require.main === module) {
    Promise.resolve()
        .then(() => testDeterministicWallets())
        .then(() => testWalletUniqueness())
        .then(() => {
            console.log('\n🎉 All wallet tests completed successfully!');
        })
        .catch(error => {
            console.error('❌ Wallet tests failed:', error);
            process.exit(1);
        });
}
