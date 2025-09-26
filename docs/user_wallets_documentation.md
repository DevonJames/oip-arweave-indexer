# User HD Wallet System Documentation

## Overview

The ALFRED system implements a hierarchical deterministic (HD) wallet system for user cryptographic identity. This provides true user ownership of records through individual public/private key pairs, enabling secure authentication and record ownership verification.

## HD Wallet Standards

### BIP Standards Used

- **BIP-39**: Mnemonic code for generating deterministic keys
  - Generates 12-word seed phrases for wallet recovery
  - Standard entropy: 128 bits (12 words)
  - Language: English wordlist

- **BIP-32**: Hierarchical Deterministic Wallets
  - Enables derivation of multiple keys from single seed
  - Provides deterministic key generation
  - Supports key tree structures

- **secp256k1**: Elliptic curve cryptography
  - Same curve used by Bitcoin and Ethereum
  - Provides ECDSA digital signatures
  - 256-bit private keys, 33-byte compressed public keys

### Key Derivation Path

```
m/44'/0'/0'/0/0
```

- `m`: Master key
- `44'`: Purpose (BIP-44 standard)
- `0'`: Coin type (Bitcoin/generic)
- `0'`: Account index
- `0`: Change (external chain)
- `0`: Address index

This path generates the user's primary signing key for ALFRED records.

## Implementation Details

### Dependencies

```bash
npm install --save bip39 bip32 tiny-secp256k1
```

**Note**: The `tiny-secp256k1` library is required by the modern `bip32` package which uses a factory pattern.

### User Registration Flow

#### 1. HD Wallet Generation

```javascript
// Import dependencies
const bip39 = require('bip39');
const { BIP32Factory } = require('bip32');
const ecc = require('tiny-secp256k1');
const bip32 = BIP32Factory(ecc);

// Generate 12-word mnemonic
const mnemonic = bip39.generateMnemonic();

// Convert to seed
const seed = await bip39.mnemonicToSeed(mnemonic);

// Create master key
const masterKey = bip32.fromSeed(seed);

// Derive user's signing key
const userKey = masterKey.derivePath("m/44'/0'/0'/0/0");

// Ensure public key is properly converted to hex string (handle Buffer/Uint8Array)
const publicKeyBuffer = userKey.publicKey;
const publicKey = Buffer.isBuffer(publicKeyBuffer) 
    ? publicKeyBuffer.toString('hex')
    : Array.from(publicKeyBuffer).map(b => b.toString(16).padStart(2, '0')).join('');

const privateKey = userKey.privateKey.toString('hex');
```

#### 2. Secure Key Storage

```javascript
// Encrypt private key with user's password
const encryptedPrivateKey = crypto.pbkdf2Sync(
  privateKey, 
  password, 
  100000, 
  32, 
  'sha256'
).toString('hex');

// Encrypt mnemonic with user's password
const encryptedMnemonic = crypto.pbkdf2Sync(
  mnemonic, 
  password, 
  100000, 
  32, 
  'sha256'
).toString('hex');
```

#### 3. Database Storage

```javascript
const userDoc = {
  email: email,
  passwordHash: passwordHash,
  // Cryptographic identity
  publicKey: publicKey,                    // Hex-encoded public key
  encryptedPrivateKey: encryptedPrivateKey, // PBKDF2-encrypted private key
  encryptedMnemonic: encryptedMnemonic,     // PBKDF2-encrypted mnemonic
  encryptedGunSalt: encryptedGunSalt,       // AES-256-GCM encrypted GUN salt
  keyDerivationPath: "m/44'/0'/0'/0/0",     // BIP-32 derivation path
  createdAt: new Date(),
  waitlistStatus: 'registered',
  subscriptionStatus: 'inactive',
  paymentMethod: null
};
```

## API Endpoints

### User Registration

**Endpoint**: `POST /api/user/register`

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "secure_password"
}
```

**Response**:
```json
{
  "success": true,
  "message": "User registered successfully",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "publicKey": "02a1b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789a"
}
```

**JWT Payload**:
```json
{
  "userId": "elasticsearch_user_id",
  "email": "user@example.com", 
  "publicKey": "02a1b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789a",
  "isAdmin": false,
  "iat": 1757784839,
  "exp": 1761672839
}
```

### User Login

**Endpoint**: `POST /api/user/login`

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "secure_password"
}
```

**Response**:
```json
{
  "success": true,
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "publicKey": "02a1b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789a"
}
```

## Record Ownership

### AccessControl Template Structure

New records created by users include simplified access control (compatible with GUN limitations):

```json
{
  "accessControl": {
    "access_level": "private",
    "owner_public_key": "0349b2160ea3117a90a1fcbbf198ef53bf325b604157cbcf81693f0f476006c9e1",
    "created_by": "0349b2160ea3117a90a1fcbbf198ef53bf325b604157cbcf81693f0f476006c9e1"
  }
}
```

**Note**: The structure is simplified to work with GUN's limitations on complex nested objects. Additional fields like timestamps, encryption_method, and permissions can be added when GUN supports more complex structures.

### Conversation Session Ownership

```json
{
  "conversationSession": {
    "session_id": "session_1757789557773",
    "owner_public_key": "0349b2160ea3117a90a1fcbbf198ef53bf325b604157cbcf81693f0f476006c9e1",
    "messages": "[]",  // JSON string for GUN compatibility
    "message_timestamps": "[]",  // JSON string for GUN compatibility
    "message_roles": "[]",  // JSON string for GUN compatibility
    "model_provider": "did:arweave:...",  // String not array for GUN compatibility
    "is_private": true,
    // ... other fields
  }
}
```

**Note**: Arrays are stored as JSON strings for GUN compatibility, then converted back to arrays for Elasticsearch indexing.

## Security Features

### Encryption at Rest

- **Private Keys**: Encrypted with user's password using PBKDF2 (100,000 iterations)
- **Mnemonics**: Encrypted with user's password using PBKDF2 (100,000 iterations)
- **GUN Encryption Salt**: User-specific salt encrypted with password using AES-256-GCM
- **Public Keys**: Stored in plaintext (safe to expose)

### Key Derivation Security

- **PBKDF2**: 100,000 iterations with SHA-256
- **Salt**: User's password (unique per user)
- **Output**: 32-byte derived keys for AES-256 encryption

### Record Privacy

- **Ownership Verification**: Records include `owner_public_key` for cryptographic ownership
- **Access Control**: `access_level` field controls visibility (public/private/shared)
- **Per-User GUN Encryption**: Private records encrypted with user-specific keys derived from HD wallet + unique salt

## Authentication Flow

### 1. User Registration
```
User → Frontend → POST /api/user/register → HD Wallet Generation → Encrypted Storage → JWT with publicKey
```

### 2. User Login  
```
User → Frontend → POST /api/user/login → Database Lookup → JWT with publicKey
```

### 3. Record Creation
```
Authenticated User → Create Record → Include user.publicKey in accessControl → Encrypted GUN Storage
```

### 4. Record Access
```
API Request → Optional Auth Middleware → Check user.publicKey ownership → Filter private records
```

## Ownership Verification Priority

The system checks ownership in this priority order:

1. **AccessControl Template**: `accessControl.owner_public_key`
2. **Conversation Session**: `conversationSession.owner_public_key` 
3. **AccessControl Created By**: `accessControl.created_by`
4. **GUN Soul Hash**: Hash of user's public key in DID
5. **Creator Fallback**: `oip.creator.publicKey` (legacy server-signed records)

## Migration Strategy

### New Users (HD Wallets)
- Generate unique public/private key pairs
- Records owned by user's `publicKey`
- Full cryptographic ownership

### Existing Users (Legacy)
- Continue using server's `publisherPubKey` 
- Gradual migration as users re-authenticate
- Backward compatibility maintained

### Record Compatibility
- **New Records**: Use user's `publicKey` for ownership
- **Legacy Records**: Use server's `publisherPubKey` for ownership
- **Mixed Support**: System handles both ownership models

## Example Usage

### Creating a Private Conversation Session

```javascript
// Frontend (mac-client/alfred.html)
const sessionData = {
  basic: {
    name: "My Private Session",
    description: "Alfred conversation session"
  },
  conversationSession: {
    session_id: "session_1757789557773",
    owner_public_key: user.publicKey, // User's HD wallet public key
    messages: '',  // Empty string initially, JSON string when updated
    message_timestamps: '',  // Empty string initially, JSON string when updated  
    message_roles: '',  // Empty string initially, JSON string when updated
    model_provider: 'did:arweave:...',  // String not array
    is_private: true
  },
  accessControl: {
    access_level: "private",
    owner_public_key: user.publicKey,    // User's HD wallet public key
    created_by: user.publicKey          // User's HD wallet public key
  }
};
```

### Verifying Record Ownership

```javascript
// Backend (helpers/utils.js)
const userOwnsRecord = (record, user) => {
  const userPubKey = user.publicKey; // User's HD wallet key
  const recordOwner = record.data?.accessControl?.owner_public_key;
  
  return recordOwner === userPubKey; // Cryptographic ownership verification
};
```

## Benefits

✅ **True User Ownership**: Each user has unique cryptographic identity  
✅ **Cross-Device Identity**: 12-word mnemonic enables account recovery  
✅ **Secure Storage**: Private keys encrypted with user's password  
✅ **Standard Compliance**: Uses established BIP standards  
✅ **GUN Compatibility**: Data structures optimized for GUN's limitations  
✅ **Elasticsearch Integration**: JSON strings converted to arrays for proper indexing  
✅ **Cross-User Privacy**: Users can only access their own private records  
✅ **Backward Compatibility**: Legacy records continue to work  
✅ **Privacy Protection**: Only record owners can access private data  

## Future Enhancements

### Message Signing
Users can sign their messages for authenticity verification.

### Selective Sharing
Users can encrypt records for specific recipients using their public keys.

### Account Recovery
Users can restore accounts using their 12-word mnemonic phrase.

### Multi-Device Support
Same HD wallet works across multiple devices with mnemonic import.

## Technical Implementation Notes

### GUN Database Limitations
- **No Complex Objects**: GUN cannot handle nested objects with arrays
- **JSON String Workaround**: Arrays stored as JSON strings in GUN
- **Elasticsearch Conversion**: JSON strings parsed back to arrays for proper indexing
- **Dual Format Support**: System handles both string and array formats seamlessly

### Data Flow Architecture
1. **Frontend**: Creates records with user's HD wallet public key
2. **GUN Storage**: Arrays converted to JSON strings for compatibility
3. **Elasticsearch Indexing**: JSON strings converted back to arrays
4. **API Retrieval**: Returns proper array format to clients
5. **Privacy Filtering**: Uses user's public key for ownership verification

## Security Considerations

### Key Storage
- Private keys never stored in plaintext
- Mnemonics encrypted with user passwords using PBKDF2 (100,000 iterations)
- Public keys stored as 66-character hex strings (compressed format)

### Password Security
- Passwords used for key encryption (not just authentication)
- Lost passwords = lost access to encrypted keys
- Consider key escrow for enterprise deployments

### Network Security
- All API calls use HTTPS in production
- JWT tokens include user's public key for ownership verification
- Private records encrypted before network transmission

### Cross-User Privacy
- **User Isolation**: Each user can only access their own private records
- **Ownership Verification**: Multiple fallback methods for checking record ownership
- **Legacy Support**: Old records using server keys still work during migration

## Per-User GUN Encryption System

### Overview

The ALFRED system implements per-user encryption for GUN records, ensuring that private records can only be decrypted by their original creator. This provides true privacy and security for sensitive data like conversation sessions.

### Encryption Key Generation

#### 1. User-Specific Salt Generation
During registration, each user gets a unique 32-byte encryption salt:

```javascript
// Generate unique salt for each user
const gunEncryptionSalt = crypto.randomBytes(32).toString('hex');

// Encrypt salt with user's password using AES-256-GCM
const encryptedGunSalt = encryptSaltWithPassword(gunEncryptionSalt, password);
```

#### 2. Per-User Encryption Key Derivation
For each GUN record encryption/decryption:

```javascript
// Combine user's public key with their unique salt
const keyMaterial = userPublicKey + ':' + gunSalt;
const encryptionKey = crypto.pbkdf2Sync(keyMaterial, 'oip-gun-encryption', 100000, 32, 'sha256');
```

### Encryption Process

#### 1. Record Encryption (Publishing)
```javascript
// User publishes private record
const recordData = { /* user's private data */ };

// Get user's encryption key
const userSalt = await getUserGunEncryptionSalt(userPublicKey, userPassword);
const encryptionKey = generateUserEncryptionKey(userPublicKey, userSalt);

// Encrypt with AES-256-GCM
const encrypted = encryptWithUserKey(recordData, encryptionKey);

// Store with ownership metadata
const gunRecord = {
  data: encrypted,
  meta: {
    encrypted: true,
    encryptionMethod: 'aes-256-gcm',
    encryptedBy: userPublicKey  // Track who encrypted it
  },
  oip: { /* record metadata */ }
};
```

#### 2. Record Decryption (Retrieval)
```javascript
// User retrieves their private record
const encryptedRecord = await gunHelper.getRecord(soul, {
  userPublicKey: userPublicKey,
  userPassword: userPassword
});

// System checks ownership
if (encryptedRecord.meta.encryptedBy !== userPublicKey) {
  throw new Error('Cannot decrypt: not your record');
}

// Decrypt with user's key
const userSalt = await getUserGunEncryptionSalt(userPublicKey, userPassword);
const decryptionKey = generateUserEncryptionKey(userPublicKey, userSalt);
const decryptedData = decryptWithUserKey(encryptedRecord, decryptionKey);
```

### Security Benefits

✅ **True Privacy**: Only the record creator can decrypt their private records  
✅ **Unique Keys**: Each user has different encryption keys derived from their HD wallet  
✅ **Salt Security**: User-specific salts prevent rainbow table attacks  
✅ **Cross-User Isolation**: Users cannot decrypt each other's private records  
✅ **Password Protection**: Encryption salt is protected by user's password  
✅ **Key Rotation**: New users get fresh salts, existing users can regenerate  

### Migration and Compatibility

#### Legacy Record Support
The system maintains backward compatibility with existing records:

```javascript
// Legacy records (encrypted with shared key)
if (!encryptedRecord.meta.encryptedBy) {
  // Use old shared key for decryption
  const legacyKey = crypto.pbkdf2Sync('gun-encryption-key', 'salt', 100000, 32, 'sha256');
  return decryptLegacyRecord(encryptedRecord, legacyKey);
}

// New records (per-user encryption)
const userKey = generateUserEncryptionKey(userPublicKey, userSalt);
return decryptUserRecord(encryptedRecord, userKey);
```

#### Existing User Migration
When existing users log in, the system automatically:

1. **Detects Missing Salt**: Checks if user has `encryptedGunSalt` field
2. **Generates Salt**: Creates new 32-byte salt if missing
3. **Encrypts Salt**: Encrypts salt with user's password using AES-256-GCM
4. **Updates Database**: Stores encrypted salt in user record
5. **Enables Per-User Encryption**: Future records use user-specific keys

#### Migration Script
For bulk migration of existing users:

```bash
# Check what users need salt migration
node scripts/migrate-users-gun-salt.js --dry-run

# Perform migration (creates placeholder salts)
node scripts/migrate-users-gun-salt.js

# Users must re-authenticate to properly encrypt their salts
```

### Encryption Metadata

#### Record Structure with Per-User Encryption
```javascript
{
  data: {
    encrypted: "base64_encrypted_content",  // 🔒 User's private data
    iv: "base64_iv",                       // 🔓 Initialization vector
    tag: "base64_auth_tag"                 // 🔓 Authentication tag
  },
  meta: {
    encrypted: true,                       // 🔓 Encryption flag
    encryptionMethod: "aes-256-gcm",       // 🔓 Encryption algorithm
    encryptedBy: "user_public_key_hex"     // 🔓 NEW: Owner identification
  },
  oip: {
    did: "did:gun:soul",                   // 🔓 Record identifier
    recordType: "conversationSession",     // 🔓 Record type
    creator: { publicKey: "..." }          // 🔓 Creator info
  }
}
```

### User Database Schema Updates

#### New Fields Added to Users Index
```javascript
{
  // Existing fields
  email: "user@example.com",
  passwordHash: "bcrypt_hash",
  publicKey: "hex_public_key",
  encryptedPrivateKey: "pbkdf2_encrypted_private_key",
  encryptedMnemonic: "pbkdf2_encrypted_mnemonic",
  
  // NEW: GUN encryption fields
  encryptedGunSalt: "aes_256_gcm_encrypted_salt",     // User's unique encryption salt
  gunSaltGeneratedAt: "2025-01-13T...",               // When salt was created
  gunSaltUpgradedAt: "2025-01-13T...",                // When migrated from placeholder
  
  // Existing fields
  keyDerivationPath: "m/44'/0'/0'/0/0",
  createdAt: "2025-01-13T...",
  waitlistStatus: "registered"
}
```

### API Integration

#### Publishing Private Records
```javascript
// Frontend publishes private record
const response = await fetch('/api/records/newRecord?recordType=conversationSession&storage=gun', {
  headers: {
    'Authorization': `Bearer ${jwtToken}`,  // Contains user's public key
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    basic: { name: "My Private Session" },
    conversationSession: { messages: ["Hello", "World"] },
    accessControl: { 
      access_level: "private",
      owner_public_key: userPublicKey 
    }
  })
});

// Backend extracts user info from JWT and encrypts with user's key
const userPublicKey = req.user.publicKey;  // From JWT
const userSalt = await getUserGunEncryptionSalt(userPublicKey, userPassword);
const encryptionKey = generateUserEncryptionKey(userPublicKey, userSalt);
```

#### Retrieving Private Records
```javascript
// Frontend requests private records
const response = await fetch('/api/records?source=gun&recordType=conversationSession', {
  headers: {
    'Authorization': `Bearer ${jwtToken}`  // System uses this to decrypt user's records
  }
});

// Backend automatically decrypts records owned by the authenticated user
// Returns decrypted data for user's records, encrypted data remains encrypted for others
```

### Cross-Node Synchronization

#### Per-User Encryption in Sync
The GUN sync system handles per-user encryption intelligently:

1. **Legacy Records**: Synced and decrypted with shared key (backward compatibility)
2. **Per-User Records**: Synced but remain encrypted unless user authenticates
3. **Ownership Tracking**: `encryptedBy` field identifies record owner
4. **Selective Decryption**: Only decrypt records when user provides credentials

#### Sync Behavior
```javascript
// During sync discovery
if (encryptedRecord.meta.encryptedBy) {
  // Per-user encrypted - store encrypted, mark as needing user decryption
  syncRecord({
    ...record,
    needsUserDecryption: true,
    encryptedBy: encryptedRecord.meta.encryptedBy
  });
} else {
  // Legacy encrypted - attempt shared key decryption
  const decrypted = await decryptLegacyRecord(encryptedRecord);
  syncRecord(decrypted);
}
```

This enhanced encryption system provides true privacy for GUN records while maintaining backward compatibility and enabling secure cross-node synchronization.
