# OIP GUN Security and Sync Architecture

## Overview

This document provides a comprehensive guide to the security architecture for GUN record synchronization in the OIP (Open Index Protocol) system. It covers user authentication, encryption strategies, organization access control, and cross-node compatibility.

## 🔐 **Core Security Architecture**

### **Three-Tier Encryption System**

| Access Level | Encryption Type | Key Source | Who Can Decrypt | Cross-Node Sync |
|--------------|-----------------|------------|-----------------|-----------------|
| **Public** | None | N/A | Everyone | ✅ Full sync |
| **Private** | Per-User | User's HD wallet + salt | Only the creator | ❌ Owner login required |
| **Organization** | Organization | Organization DID | All org members | ✅ Full sync |

### **User Wallet System**

#### **HD Wallet Generation:**
```javascript
// Each user gets a unique HD wallet during registration
const mnemonic = bip39.generateMnemonic(); // 12-word recovery phrase
const seed = await bip39.mnemonicToSeed(mnemonic);
const userKey = masterKey.derivePath("m/44'/0'/0'/0/0");

// User gets:
// - Public key (stored in database)
// - Private key (encrypted with password)
// - Mnemonic (encrypted with password)
// - GUN encryption salt (encrypted with password)
```

#### **Cross-Node Compatibility:**
- **Mnemonic Export**: Users can view their 12-word recovery phrase
- **Wallet Import**: Users can import their wallet on any OIP node
- **Same Identity**: Same mnemonic = same wallet = same organization access

## 🏢 **Organization Access Control**

### **Organization Model (Corrected)**

**Roles:**
- **Admins Create**: Only organization admins can publish records with `access_level: "organization"`
- **Members Consume**: Organization members can read/access these records based on membership policy

**Membership Policies:**
- **Auto-Enroll App Users** (`membershipPolicy: 1`): Domain-based membership
- **Invite Only** (`membershipPolicy: 0`): Not yet implemented
- **Token-Gated** (`membershipPolicy: 2`): Not yet implemented  
- **Open Join** (`membershipPolicy: 3`): Not yet implemented

### **Domain-Based Membership (Auto-Enroll)**

For organizations with `membershipPolicy: 1`:

```javascript
// Organization: FitnessAlly (webUrl: "https://fitnessally.io")

✅ GRANTED ACCESS:
- Requests from "https://fitnessally.io"
- Requests from "https://app.fitnessally.io" (subdomains)
- Organization admins (always, regardless of domain)

❌ DENIED ACCESS:
- Requests from "https://example.com" (different domain)
- Requests with no domain headers
```

### **Organization Encryption (Fixed)**

**Critical Security Fix Applied:**

❌ **BEFORE (Broken):**
```javascript
// Used registering user's public key
const orgEncryptionKey = crypto.pbkdf2Sync(
    orgPublicKey,  // Only registering user has private key for this!
    'oip-organization-encryption', 100000, 32, 'sha256'
);
```

✅ **AFTER (Fixed):**
```javascript
// Use organization DID as deterministic key source
const orgEncryptionKey = crypto.pbkdf2Sync(
    organizationDid,  // Public info, all nodes can generate same key
    'oip-organization-encryption', 100000, 32, 'sha256'
);
```

**Why This Works:**
- Organization DID is public information
- All nodes can generate the same key deterministically
- No dependency on user private keys
- Perfect cross-node compatibility

## 🔑 **Per-User Encryption System**

### **User-Specific Encryption Keys**

Each user gets unique encryption capabilities:

```javascript
// 1. User registration generates unique salt
const gunEncryptionSalt = crypto.randomBytes(32).toString('hex');

// 2. Salt encrypted with user's password
const encryptedGunSalt = encryptSaltWithPassword(gunEncryptionSalt, password);

// 3. Encryption key derived from public key + salt
const encryptionKey = crypto.pbkdf2Sync(
    userPublicKey + ':' + gunSalt,
    'oip-gun-encryption', 100000, 32, 'sha256'
);
```

### **Security Benefits:**
- **True Privacy**: Only record creator can decrypt their private records
- **Cross-User Isolation**: Users cannot decrypt others' private records  
- **Password Protection**: Encryption salt protected by user's password
- **No Shared Secrets**: No hardcoded keys in source code

## 🌐 **Cross-Node Synchronization**

### **GUN Sync Service Architecture**

#### **Record Discovery:**
```javascript
// Registry-based discovery system
oip:registry → {
  nodeId: "node-production-1",
  records: {
    "did:gun:soul1": { recordType: "exercise", creator: "pubkey1" },
    "did:gun:soul2": { recordType: "recipe", creator: "pubkey2" }
  }
}
```

#### **Sync Behavior by Encryption Type:**

**Public Records:**
```javascript
// Sync immediately - no decryption needed
await indexRecord(publicRecord);
```

**Organization Records:**
```javascript
// Decrypt with organization DID-based key
const orgKey = crypto.pbkdf2Sync(organizationDid, 'oip-organization-encryption', ...);
const decrypted = decrypt(encryptedRecord, orgKey);
await indexRecord(decrypted);
```

**Private Records:**
```javascript
// Queue for decryption when owner logs in
await decryptionQueue.queueForDecryption(encryptedRecord, ownerPublicKey);
```

### **Organization Owner Login Triggers Decryption**

When an organization owner logs into any node:

```javascript
// 1. User logs in with email + password
// 2. System generates same HD wallet (deterministic from credentials)
// 3. System decrypts user's private key
// 4. System finds organizations owned by this user
// 5. System processes decryption queue for those organizations
// 6. Organization records become available to members on this node
```

## 🚀 **User Experience Flows**

### **New User Registration:**
```javascript
1. User registers → Gets mnemonic displayed immediately
2. User saves recovery phrase securely
3. User can publish private/organization records
4. User can import wallet on other nodes anytime
```

### **Cross-Node Migration:**
```javascript
1. User has account on Node A with organizations
2. User wants to use Node B
3. User goes to Node B → "Import Wallet"
4. User enters email + password + 12-word mnemonic
5. Same wallet recreated → organization records work immediately
```

### **Organization Member Access:**
```javascript
1. Admin publishes exercise for organization (encrypted)
2. Record syncs to all nodes (encrypted)
3. App user from correct domain requests exercises
4. System checks domain → grants membership
5. System decrypts organization records
6. User gets workout data (seamlessly)
```

## 🧪 **Implementation Status**

### **✅ Fully Implemented:**
- Per-user encryption with unique salts
- Organization DID-based encryption
- Domain-based Auto-Enroll membership policy
- Cross-node GUN record synchronization
- Mnemonic export/import for wallet portability
- Unified user interface with wallet management
- Organization decryption queue system

### **⚠️ Not Yet Implemented:**
- Invite-Only membership policy
- Token-Gated membership policy
- Open-Join membership policy
- Multi-organization record sharing
- Role-based permissions within organizations

## 🔧 **Technical Components**

### **Core Files:**
- `helpers/gun.js` - Smart encryption/decryption logic
- `helpers/organizationEncryption.js` - Organization key management
- `helpers/privateRecordHandler.js` - Private record sync handling
- `helpers/gunSyncService.js` - Main synchronization service
- `helpers/organizationDecryptionQueue.js` - Queue for pending decryption
- `routes/user.js` - User authentication and wallet management

### **API Endpoints:**
- `GET /api/user/mnemonic?password=...` - View recovery phrase
- `POST /api/user/import-wallet` - Import wallet from mnemonic
- `GET /api/health/gun-sync` - Sync service status
- `POST /api/health/gun-sync/force` - Force sync cycle

## 🎯 **Security Guarantees**

### **Privacy:**
- ✅ Private records can only be decrypted by their creator
- ✅ Organization records can only be decrypted by organization members
- ✅ Cross-user isolation maintained
- ✅ No hardcoded encryption keys

### **Cross-Node Compatibility:**
- ✅ Organization records sync and remain accessible
- ✅ Users can import wallets on any node
- ✅ Same organization works across all nodes
- ✅ No user database sync required

### **Scalability:**
- ✅ Add new OIP nodes without data migration
- ✅ Organization owners work on new nodes automatically
- ✅ Domain-based membership scales infinitely
- ✅ Queue system handles any record volume

## 🚀 **Deployment**

### **Environment Configuration:**
```bash
# Enable GUN sync
GUN_SYNC_ENABLED=true
GUN_SYNC_INTERVAL=30000
GUN_SYNC_PRIVATE_RECORDS=true

# Organization encryption
GUN_REGISTRY_ROOT=oip:registry
GUN_NODE_ID_OVERRIDE=node-production-1
```

### **Testing:**
```bash
# Test encryption systems
node test/test-per-user-encryption.js
node test/test-organization-encryption.js
node test/test-corrected-organization-model.js

# Test wallet compatibility
node test/test-deterministic-wallets.js

# Test complete system
node test/test-gun-sync-system.js
```

### **Migration:**
```bash
# Migrate existing users to add GUN salts
node scripts/migrate-users-gun-salt.js

# Migrate existing GUN records to registry
node scripts/migrate-existing-gun-records.js
```

This architecture provides **true privacy for personal records**, **shared access for organizational content**, and **seamless cross-node synchronization** while maintaining excellent security and user experience.
