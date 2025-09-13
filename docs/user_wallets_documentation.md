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
npm install bip39 bip32 secp256k1
```

### User Registration Flow

#### 1. HD Wallet Generation

```javascript
// Generate 12-word mnemonic
const mnemonic = bip39.generateMnemonic();

// Convert to seed
const seed = await bip39.mnemonicToSeed(mnemonic);

// Create master key
const masterKey = bip32.fromSeed(seed);

// Derive user's signing key
const userKey = masterKey.derivePath("m/44'/0'/0'/0/0");
const publicKey = userKey.publicKey.toString('hex');
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

New records created by users include comprehensive access control:

```json
{
  "accessControl": {
    "access_level": "private",
    "owner_public_key": "02a1b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789a",
    "encryption_method": "AES-256-GCM",
    "created_by": "02a1b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789a",
    "created_timestamp": 1757784839759,
    "last_modified_timestamp": 1757784839759,
    "version": "1.0.0"
  }
}
```

### Conversation Session Ownership

```json
{
  "conversationSession": {
    "session_id": "session_1757784839759",
    "owner_public_key": "02a1b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789a",
    "messages": [...],
    "is_private": true,
    // ... other fields
  }
}
```

## Security Features

### Encryption at Rest

- **Private Keys**: Encrypted with user's password using PBKDF2 (100,000 iterations)
- **Mnemonics**: Encrypted with user's password using PBKDF2 (100,000 iterations)
- **Public Keys**: Stored in plaintext (safe to expose)

### Key Derivation Security

- **PBKDF2**: 100,000 iterations with SHA-256
- **Salt**: User's password (unique per user)
- **Output**: 32-byte derived keys for AES-256 encryption

### Record Privacy

- **Ownership Verification**: Records include `owner_public_key` for cryptographic ownership
- **Access Control**: `access_level` field controls visibility (public/private/shared)
- **GUN Encryption**: Private records encrypted with AES-256-GCM before GUN storage

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
    session_id: "session_1757784839759",
    owner_public_key: user.publicKey, // User's HD wallet public key
    is_private: true,
    messages: [...]
  },
  accessControl: {
    access_level: "private",
    owner_public_key: user.publicKey,    // User's HD wallet public key
    created_by: user.publicKey,          // User's HD wallet public key
    encryption_method: "AES-256-GCM"
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
✅ **Future Extensibility**: Supports message signing, selective sharing  
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

## Security Considerations

### Key Storage
- Private keys never stored in plaintext
- Mnemonics encrypted with user passwords
- Public keys safe to expose and index

### Password Security
- Passwords used for key encryption (not just authentication)
- Lost passwords = lost access to encrypted keys
- Consider key escrow for enterprise deployments

### Network Security
- All API calls use HTTPS in production
- JWT tokens include user's public key for ownership verification
- Private records encrypted before network transmission

This HD wallet system provides the cryptographic foundation for true user ownership in the ALFRED ecosystem.
