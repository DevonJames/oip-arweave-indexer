# OIP v0.9.0 JavaScript Implementation Plan

## Executive Summary

This document provides the JavaScript implementation plan for OIP v0.9.0, porting the C# reference implementation to the Node.js indexer. The upgrade introduces DID-based identity with HD key derivation, replacing Arweave-based signatures for new records while maintaining backward compatibility with v0.8 records.

### Key Architecture Decisions

| Decision | Resolution |
|----------|------------|
| **Signing Location** | Client-side only (HD wallet never leaves user's device) |
| **Transaction Payment** | Hybrid: client signs record, server signs Arweave tx (pays fees) |
| **Key Publication** | xpub goes in DID document, only signature goes in record |
| **Derivation Anchor** | Payload digest (not txId) - deterministic before submission |
| **Verification Timing** | At indexing time; failed verification = not indexed |
| **Key Rollover** | BlockHeight-based validity windows per verification method |
| **Verification Access** | Both daemon and Alexandria can verify signatures |

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Phase 1: Core Crypto Infrastructure](#phase-1-core-crypto-infrastructure)
3. [Phase 2: Signing & Verification Services](#phase-2-signing--verification-services)
4. [Phase 3: Hardcoded v0.9 Templates](#phase-3-hardcoded-v09-templates)
5. [Phase 4: Client SDK](#phase-4-client-sdk)
6. [Phase 5: Indexer Integration](#phase-5-indexer-integration)
7. [Phase 6: API Endpoints](#phase-6-api-endpoints)
8. [Phase 7: Migration & Backward Compatibility](#phase-7-migration--backward-compatibility)
9. [Implementation Timeline](#implementation-timeline)
10. [File Structure](#file-structure)

---

## Architecture Overview

### Signing Flow (Client → Server → Arweave)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (Browser/App)                            │
├─────────────────────────────────────────────────────────────────────────────┤
│  1. User has HD wallet (mnemonic → master key)                              │
│  2. Derive signing key: m/176800'/0'/account'/index                         │
│     where index = uint31(sha256("oip:" + payloadDigest))                    │
│  3. Build DataForSignature (without CreatorSig/KeyIndex)                    │
│  4. Compute payloadDigest = sha256(canonical_json(payload))                 │
│  5. Sign payloadDigest with derived key                                     │
│  6. Add CreatorSig + PayloadDigest tags                                     │
│  7. Send signed payload to server                                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SERVER (oip-daemon-service)                        │
├─────────────────────────────────────────────────────────────────────────────┤
│  1. Receive signed payload from client                                      │
│  2. Verify creator signature (optional pre-check)                           │
│  3. Create Arweave transaction with payload as data                         │
│  4. Sign transaction with SERVER wallet (pays AR fee)                       │
│  5. Submit to Arweave network                                               │
│  6. Return txId to client                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              ARWEAVE NETWORK                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  Transaction contains:                                                      │
│  - Tags: Index-Method=OIP, Ver=0.9.0, Creator=did:..., CreatorSig=...      │
│  - Data: JSON payload with fragments                                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           INDEXER (sync process)                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  1. Fetch transaction from Arweave                                          │
│  2. Check Ver tag:                                                          │
│     - < 0.9: Use legacy verification                                        │
│     - >= 0.9: Use v0.9 verification                                         │
│  3. Verify creator signature using xpub from creator's DID document         │
│  4. If valid: index to Elasticsearch                                        │
│  5. If invalid: reject, do not index                                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Payload Digest Derivation (Replaces txId)

```javascript
// Before signing:
const payloadWithoutSig = {
  "@context": "did:arweave:...",
  "tags": [
    { "name": "Index-Method", "value": "OIP" },
    { "name": "Ver", "value": "0.9.0" },
    { "name": "Content-Type", "value": "application/json" },
    { "name": "Creator", "value": "did:arweave:..." }
    // NO CreatorSig, NO KeyIndex, NO PayloadDigest yet
  ],
  "fragments": [...]
};

// 1. Canonical JSON (deterministic serialization)
const payloadBytes = canonicalJson(payloadWithoutSig);

// 2. Compute digest
const payloadDigest = base64url(sha256(payloadBytes));

// 3. Derive key index
const index = uint31(sha256("oip:" + payloadDigest));

// 4. Sign with derived key
const signature = sign(sha256(payloadBytes), derivedKey);

// 5. Add tags for verification
payload.tags.push({ name: "PayloadDigest", value: payloadDigest });
payload.tags.push({ name: "KeyIndex", value: index.toString() });
payload.tags.push({ name: "CreatorSig", value: base64url(signature) });
```

### Key Validity Windows (BlockHeight-Based)

```
Creator: did:arweave:abc123
Sub-purpose: 0 (identity.sign)
Account: 0

┌──────────────────────────────────────────────────────────────────────────┐
│  Verification Methods Timeline                                            │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  VM #1 (xpub: xpub6ABC...)                                              │
│  ├─ validFromBlock: 1000                                                │
│  └─ revokedFromBlock: 5000                                              │
│      │◄──────── VALID ────────►│                                        │
│                                                                          │
│  VM #2 (xpub: xpub6DEF...)                                              │
│  ├─ validFromBlock: 5000                                                │
│  └─ revokedFromBlock: null (current)                                    │
│                                │◄──────── VALID ────────────────►       │
│                                                                          │
│  Block: 1000        5000        10000                                   │
│         │           │           │                                        │
│         ▼           ▼           ▼                                        │
│  Record at 3000 → verify with VM #1                                     │
│  Record at 7000 → verify with VM #2                                     │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Core Crypto Infrastructure

### 1.1 HD Key Derivation Module

**File: `helpers/core/oip-crypto.js`**

```javascript
/**
 * OIP v0.9.0 Cryptographic Infrastructure
 * 
 * Implements SLIP-0043 custom derivation paths for OIP identity keys.
 * Uses secp256k1 for signing (BIP-32 compatible).
 */

const { HDKey } = require('@scure/bip32');
const { sha256 } = require('@noble/hashes/sha256');
const { secp256k1 } = require('@noble/curves/secp256k1');
const { bytesToHex, hexToBytes } = require('@noble/hashes/utils');
const base64url = require('base64url');

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * OIP custom purpose under SLIP-0043
 */
const OIP_PURPOSE = 176800;

/**
 * Sub-purpose indices for different key uses
 */
const SubPurpose = {
    IDENTITY_SIGN: 0,      // DID assertion/authentication keys (xpub mode)
    IDENTITY_ENCRYPT: 1,   // DID keyAgreement - x25519 (binding mode)
    DELEGATION: 2,         // Delegate capability keys (binding mode)
    REVOCATION: 3,         // Revoke/expire other keys (binding mode)
    JWT: 4,                // App/API tokens (xpub or binding)
    SSH: 5,                // SSH login keys (binding mode)
    BACKUP: 6,             // Rolling backup encryption (hardened only, never publish)
    ONION: 7,              // Tor onion service identity (hardened only)
    EXPERIMENTAL: 8        // Future expansion (binding mode default)
};

/**
 * Verification mode policies per sub-purpose
 */
const VerificationPolicy = {
    [SubPurpose.IDENTITY_SIGN]: 'xpub',      // Third parties can derive pubkey from xpub
    [SubPurpose.IDENTITY_ENCRYPT]: 'binding', // Explicit pubkey with JWS proof
    [SubPurpose.DELEGATION]: 'binding',       // Auditable authorization chains
    [SubPurpose.REVOCATION]: 'binding',       // Explicit revocation authority
    [SubPurpose.JWT]: 'xpub',                 // Third-party token verification
    [SubPurpose.SSH]: 'binding',              // SSH expects explicit keys
    [SubPurpose.BACKUP]: 'none',              // Never publish
    [SubPurpose.ONION]: 'none',               // Never publish
    [SubPurpose.EXPERIMENTAL]: 'binding'      // Safe default
};

// ═══════════════════════════════════════════════════════════════════════════
// KEY DERIVATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Builds derivation path: m / 176800' / sub-purpose' / account' / index[']
 * 
 * @param {number} subPurpose - Sub-purpose index (0-8)
 * @param {number} account - Account index
 * @param {number} index - Leaf index
 * @param {boolean} hardened - Whether leaf is hardened
 * @returns {string} Derivation path string
 */
function getDerivationPath(subPurpose, account, index, hardened = false) {
    const leafSuffix = hardened ? "'" : "";
    return `m/${OIP_PURPOSE}'/${subPurpose}'/${account}'/${index}${leafSuffix}`;
}

/**
 * Gets the xpub derivation base path: m / 176800' / sub-purpose' / account'
 * This is the path at which the xpub is published in creator DID documents.
 * 
 * @param {number} subPurpose - Sub-purpose index
 * @param {number} account - Account index
 * @returns {string} Base derivation path
 */
function getXpubBasePath(subPurpose, account) {
    return `m/${OIP_PURPOSE}'/${subPurpose}'/${account}'`;
}

/**
 * Derives key index from payload digest per OIP v0.9 spec.
 * 
 * Algorithm: uint31(SHA256("oip:" + payloadDigest))
 * 
 * @param {string} payloadDigest - Base64URL-encoded payload digest
 * @returns {number} Derived index (31-bit unsigned integer)
 */
function deriveIndexFromPayloadDigest(payloadDigest) {
    const input = `oip:${payloadDigest}`;
    const hash = sha256(new TextEncoder().encode(input));
    // Take first 4 bytes as uint32, mask to uint31 (clear high bit)
    const view = new DataView(hash.buffer);
    return view.getUint32(0, false) & 0x7FFFFFFF;
}

/**
 * Computes the payload digest for a DataForSignature object.
 * This is computed BEFORE adding CreatorSig, KeyIndex, PayloadDigest tags.
 * 
 * @param {object} payload - DataForSignature without signature tags
 * @returns {string} Base64URL-encoded SHA256 digest
 */
function computePayloadDigest(payload) {
    // Canonical JSON serialization (sorted keys, no whitespace)
    const canonical = canonicalJson(payload);
    const hash = sha256(new TextEncoder().encode(canonical));
    return base64url.encode(Buffer.from(hash));
}

/**
 * Canonical JSON serialization for deterministic digests.
 * Sorts keys alphabetically, removes whitespace.
 * 
 * @param {object} obj - Object to serialize
 * @returns {string} Canonical JSON string
 */
function canonicalJson(obj) {
    return JSON.stringify(obj, (key, value) => {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return Object.keys(value).sort().reduce((sorted, k) => {
                sorted[k] = value[k];
                return sorted;
            }, {});
        }
        return value;
    });
}

/**
 * Creates an OIP identity from a BIP-39 mnemonic.
 * 
 * @param {string} mnemonic - BIP-39 mnemonic phrase
 * @param {number} account - Account index (default 0)
 * @returns {object} OIP identity with signing keys
 */
function createIdentityFromMnemonic(mnemonic, account = 0) {
    const { mnemonicToSeedSync } = require('@scure/bip39');
    const seed = mnemonicToSeedSync(mnemonic);
    const masterKey = HDKey.fromMasterSeed(seed);
    
    // Derive signing xpub at m/176800'/0'/account'
    const signingBasePath = getXpubBasePath(SubPurpose.IDENTITY_SIGN, account);
    const signingKey = masterKey.derive(signingBasePath);
    
    // Generate DID from master public key
    const did = generateDidFromPubKey(masterKey.publicKey);
    
    return {
        did,
        signingXpub: signingKey.publicExtendedKey,
        signingXprv: signingKey.privateExtendedKey,
        signingKey: signingKey,
        account
    };
}

/**
 * Generates did:arweave identifier from public key.
 * Uses SHA256 hash of public key, base64url encoded.
 * 
 * @param {Uint8Array} publicKey - Compressed public key bytes
 * @returns {string} DID identifier
 */
function generateDidFromPubKey(publicKey) {
    const hash = sha256(publicKey);
    const address = base64url.encode(Buffer.from(hash));
    return `did:arweave:${address}`;
}

/**
 * Derives a child signing key for a specific payload.
 * 
 * @param {HDKey} signingKey - Base signing key at xpub path
 * @param {string} payloadDigest - Payload digest for index derivation
 * @returns {HDKey} Derived child key
 */
function deriveSigningKeyForPayload(signingKey, payloadDigest) {
    const index = deriveIndexFromPayloadDigest(payloadDigest);
    return signingKey.deriveChild(index);
}

/**
 * Derives child public key from xpub for verification.
 * 
 * @param {string} xpub - Extended public key string
 * @param {string} payloadDigest - Payload digest for index derivation
 * @returns {Uint8Array} Derived public key
 */
function deriveVerificationKey(xpub, payloadDigest) {
    const hdKey = HDKey.fromExtendedKey(xpub);
    const index = deriveIndexFromPayloadDigest(payloadDigest);
    return hdKey.deriveChild(index).publicKey;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
    // Constants
    OIP_PURPOSE,
    SubPurpose,
    VerificationPolicy,
    
    // Key Derivation
    getDerivationPath,
    getXpubBasePath,
    deriveIndexFromPayloadDigest,
    computePayloadDigest,
    canonicalJson,
    createIdentityFromMnemonic,
    generateDidFromPubKey,
    deriveSigningKeyForPayload,
    deriveVerificationKey
};
```

### 1.2 Dependencies

Add to `package.json`:

```json
{
  "dependencies": {
    "@scure/bip32": "^1.3.3",
    "@scure/bip39": "^1.2.2",
    "@noble/hashes": "^1.3.3",
    "@noble/curves": "^1.3.0",
    "base64url": "^3.0.1"
  }
}
```

---

## Phase 2: Signing & Verification Services

### 2.1 Signing Service

**File: `helpers/core/oip-signing.js`**

```javascript
/**
 * OIP v0.9.0 Signing Service
 * 
 * Handles record signing with HD-derived keys.
 * Note: This is primarily for SERVER-SIDE operations.
 * Client-side signing uses the SDK (Phase 4).
 */

const { sha256 } = require('@noble/hashes/sha256');
const { secp256k1 } = require('@noble/curves/secp256k1');
const base64url = require('base64url');
const {
    computePayloadDigest,
    deriveIndexFromPayloadDigest,
    deriveSigningKeyForPayload,
    canonicalJson
} = require('./oip-crypto');

// ═══════════════════════════════════════════════════════════════════════════
// SIGNING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Signs a DataForSignature payload with HD key derivation.
 * 
 * Process:
 * 1. Compute payload digest (before sig tags)
 * 2. Derive key index from digest
 * 3. Sign the digest
 * 4. Add CreatorSig, KeyIndex, PayloadDigest tags
 * 
 * @param {object} payload - DataForSignature object (without sig tags)
 * @param {HDKey} signingKey - Base signing key (at xpub path)
 * @returns {object} Payload with signature tags added
 */
function signPayload(payload, signingKey) {
    // 1. Compute payload digest
    const payloadDigest = computePayloadDigest(payload);
    
    // 2. Derive key index and child key
    const index = deriveIndexFromPayloadDigest(payloadDigest);
    const childKey = signingKey.deriveChild(index);
    
    // 3. Sign the payload hash
    const payloadBytes = canonicalJson(payload);
    const messageHash = sha256(new TextEncoder().encode(payloadBytes));
    const signature = secp256k1.sign(messageHash, childKey.privateKey);
    const signatureBase64 = base64url.encode(Buffer.from(signature.toCompactRawBytes()));
    
    // 4. Add signature tags
    const signedPayload = JSON.parse(JSON.stringify(payload)); // Deep clone
    signedPayload.tags.push({ name: 'PayloadDigest', value: payloadDigest });
    signedPayload.tags.push({ name: 'KeyIndex', value: index.toString() });
    signedPayload.tags.push({ name: 'CreatorSig', value: signatureBase64 });
    
    return signedPayload;
}

/**
 * Extracts signature components from a signed payload.
 * 
 * @param {object} payload - Signed DataForSignature object
 * @returns {object} Extracted signature data
 */
function extractSignatureData(payload) {
    const tags = payload.tags || [];
    const getTag = (name) => tags.find(t => t.name === name)?.value;
    
    return {
        creator: getTag('Creator'),
        creatorSig: getTag('CreatorSig'),
        keyIndex: getTag('KeyIndex'),
        payloadDigest: getTag('PayloadDigest'),
        version: getTag('Ver') || '0.8'
    };
}

/**
 * Removes signature tags from payload for verification.
 * 
 * @param {object} payload - Signed payload
 * @returns {object} Payload without signature tags
 */
function removeSignatureTags(payload) {
    const signatureTags = ['CreatorSig', 'KeyIndex', 'PayloadDigest'];
    const cleaned = JSON.parse(JSON.stringify(payload));
    cleaned.tags = cleaned.tags.filter(t => !signatureTags.includes(t.name));
    return cleaned;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
    signPayload,
    extractSignatureData,
    removeSignatureTags
};
```

### 2.2 Verification Service

**File: `helpers/core/oip-verification.js`**

```javascript
/**
 * OIP v0.9.0 Verification Service
 * 
 * Verifies record signatures using creator's xpub.
 * Supports both v0.9 (xpub derivation) and legacy (v0.8) verification.
 * 
 * Used by both oip-daemon-service and alexandria-service.
 */

const { sha256 } = require('@noble/hashes/sha256');
const { secp256k1 } = require('@noble/curves/secp256k1');
const { HDKey } = require('@scure/bip32');
const base64url = require('base64url');
const {
    deriveIndexFromPayloadDigest,
    canonicalJson,
    computePayloadDigest
} = require('./oip-crypto');
const { extractSignatureData, removeSignatureTags } = require('./oip-signing');

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICATION MODES
// ═══════════════════════════════════════════════════════════════════════════

const VerificationMode = {
    XPUB: 'xpub',           // Non-hardened leaf, verify from xpub
    BINDING: 'binding',      // Hardened leaf with JWS binding proof
    LEGACY: 'legacy'         // v0.8 Arweave-based verification
};

/**
 * Verification result structure
 */
class VerificationResult {
    constructor(isValid, mode, error = null, details = {}) {
        this.isValid = isValid;
        this.mode = mode;
        this.error = error;
        this.keyIndex = details.keyIndex || null;
        this.creatorDid = details.creatorDid || null;
        this.blockHeight = details.blockHeight || null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verifies a record's signature.
 * Automatically detects version and uses appropriate verification method.
 * 
 * @param {object} payload - The signed record payload
 * @param {function} creatorResolver - Async function to resolve creator DID → verification data
 * @param {number} blockHeight - Block height where record was confirmed
 * @returns {Promise<VerificationResult>}
 */
async function verifyRecord(payload, creatorResolver, blockHeight) {
    try {
        const sigData = extractSignatureData(payload);
        
        // Determine version
        const version = parseVersion(sigData.version);
        
        if (version < 0.9) {
            // Legacy verification (v0.8 and earlier)
            return await verifyLegacy(payload, sigData, creatorResolver);
        }
        
        // v0.9+ verification
        return await verifyV09(payload, sigData, creatorResolver, blockHeight);
        
    } catch (error) {
        return new VerificationResult(false, null, error.message);
    }
}

/**
 * Verifies a v0.9 record using xpub mode.
 * 
 * @param {object} payload - Signed payload
 * @param {object} sigData - Extracted signature data
 * @param {function} creatorResolver - Creator resolution function
 * @param {number} blockHeight - Block height for validity check
 * @returns {Promise<VerificationResult>}
 */
async function verifyV09(payload, sigData, creatorResolver, blockHeight) {
    const { creator, creatorSig, keyIndex, payloadDigest } = sigData;
    
    // 1. Resolve creator to get verification method
    const creatorData = await creatorResolver(creator);
    if (!creatorData) {
        return new VerificationResult(false, VerificationMode.XPUB, 
            `Creator not found: ${creator}`);
    }
    
    // 2. Find valid verification method for this blockHeight
    const vm = findValidVerificationMethod(creatorData.verificationMethods, blockHeight);
    if (!vm) {
        return new VerificationResult(false, VerificationMode.XPUB,
            `No valid verification method for block ${blockHeight}`);
    }
    
    // 3. Verify payload digest matches
    const payloadWithoutSig = removeSignatureTags(payload);
    const computedDigest = computePayloadDigest(payloadWithoutSig);
    
    if (computedDigest !== payloadDigest) {
        return new VerificationResult(false, VerificationMode.XPUB,
            'Payload digest mismatch');
    }
    
    // 4. Verify key index matches
    const expectedIndex = deriveIndexFromPayloadDigest(payloadDigest);
    if (parseInt(keyIndex) !== expectedIndex) {
        return new VerificationResult(false, VerificationMode.XPUB,
            `Key index mismatch: expected ${expectedIndex}, got ${keyIndex}`);
    }
    
    // 5. Derive verification key from xpub
    const hdKey = HDKey.fromExtendedKey(vm.xpub);
    const childKey = hdKey.deriveChild(expectedIndex);
    const publicKey = childKey.publicKey;
    
    // 6. Verify signature
    const payloadBytes = canonicalJson(payloadWithoutSig);
    const messageHash = sha256(new TextEncoder().encode(payloadBytes));
    const signatureBytes = base64url.toBuffer(creatorSig);
    
    const isValid = secp256k1.verify(signatureBytes, messageHash, publicKey);
    
    return new VerificationResult(isValid, VerificationMode.XPUB, 
        isValid ? null : 'Signature verification failed',
        { keyIndex: expectedIndex, creatorDid: creator, blockHeight });
}

/**
 * Verifies a v0.8 (legacy) record.
 * Uses Arweave-based signature verification.
 * 
 * @param {object} payload - Signed payload
 * @param {object} sigData - Extracted signature data
 * @param {function} creatorResolver - Creator resolution function
 * @returns {Promise<VerificationResult>}
 */
async function verifyLegacy(payload, sigData, creatorResolver) {
    // TODO: Implement legacy verification
    // For now, pass through (existing records are already indexed)
    console.log('[Verification] Legacy v0.8 record - using passthrough');
    return new VerificationResult(true, VerificationMode.LEGACY, null, {
        creatorDid: sigData.creator
    });
}

/**
 * Verifies using binding mode (hardened keys with JWS proof).
 * Used for delegation, revocation, and other sensitive operations.
 * 
 * @param {object} payload - Signed payload
 * @param {string} publicKeyMultibase - Published public key
 * @param {string} bindingProofJws - JWS binding proof
 * @param {string} parentXpub - Parent key that authorized this binding
 * @returns {Promise<VerificationResult>}
 */
async function verifyBinding(payload, publicKeyMultibase, bindingProofJws, parentXpub) {
    // TODO: Implement binding verification
    // This is used for hardened keys that can't be derived from xpub
    throw new Error('Binding mode verification not yet implemented');
}

// ═══════════════════════════════════════════════════════════════════════════
// KEY VALIDITY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Finds the valid verification method for a given block height.
 * 
 * Rule: Key K is valid for records with blockHeight in [K.validFromBlock, K.revokedFromBlock)
 * 
 * @param {Array} verificationMethods - Array of verification methods
 * @param {number} blockHeight - Block height to check
 * @returns {object|null} Valid verification method or null
 */
function findValidVerificationMethod(verificationMethods, blockHeight) {
    if (!verificationMethods || verificationMethods.length === 0) {
        return null;
    }
    
    // Filter to methods valid at this blockHeight
    const validMethods = verificationMethods.filter(vm => {
        const validFrom = vm.validFromBlock || 0;
        const revokedFrom = vm.revokedFromBlock || Infinity;
        return blockHeight >= validFrom && blockHeight < revokedFrom;
    });
    
    if (validMethods.length === 0) {
        return null;
    }
    
    // Return the most recently created valid method
    return validMethods.reduce((newest, vm) => {
        return (vm.validFromBlock || 0) > (newest.validFromBlock || 0) ? vm : newest;
    });
}

/**
 * Checks if a verification method is currently valid.
 * 
 * @param {object} vm - Verification method
 * @param {number} blockHeight - Block height to check
 * @returns {boolean}
 */
function isVerificationMethodValid(vm, blockHeight) {
    const validFrom = vm.validFromBlock || 0;
    const revokedFrom = vm.revokedFromBlock || Infinity;
    return blockHeight >= validFrom && blockHeight < revokedFrom;
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parses version string to number.
 * 
 * @param {string} version - Version string (e.g., "0.9.0")
 * @returns {number} Major.minor as float (e.g., 0.9)
 */
function parseVersion(version) {
    if (!version) return 0.8;
    const parts = version.split('.');
    return parseFloat(`${parts[0]}.${parts[1] || 0}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
    // Main verification
    verifyRecord,
    verifyV09,
    verifyLegacy,
    verifyBinding,
    
    // Key validity
    findValidVerificationMethod,
    isVerificationMethodValid,
    
    // Types
    VerificationMode,
    VerificationResult,
    
    // Utilities
    parseVersion
};
```

---

## Phase 3: Hardcoded v0.9 Templates

### 3.1 Template Definitions

**File: `config/templates-v09.js`**

```javascript
/**
 * OIP v0.9.0 Hardcoded Template Definitions
 * 
 * These templates are hardcoded for bootstrap. The first v0.9 records published
 * will be the actual template definitions that others can use.
 * 
 * Similar to how creatorRegistration was hardcoded in v0.8.
 */

// ═══════════════════════════════════════════════════════════════════════════
// TEMPLATE DIDs (To be replaced with actual txIds after publishing)
// ═══════════════════════════════════════════════════════════════════════════

const TEMPLATE_DIDS = {
    // Existing v0.8 templates (keep for backward compatibility)
    basic: 'did:arweave:-9DirnjVO1FlbEW1lN8jITBESrTsQKEM_BoZ1ey_0mk',
    creatorRegistration: 'did:arweave:LEGACY_CREATOR_TEMPLATE', // v0.8 legacy
    image: 'did:arweave:AkZnE1VckJJlRamgNJuIGE7KrYwDcCciWOMrMh68V4o',
    post: 'did:arweave:op6y-d_6bqivJ2a2oWQnbylD4X_LH6eQyR6rCGqtVZ8',
    
    // New v0.9 templates (placeholder DIDs until first publish)
    didDocument: 'did:arweave:V09_DID_DOCUMENT_TEMPLATE',
    didVerificationMethod: 'did:arweave:V09_DID_VM_TEMPLATE',
    socialMedia: 'did:arweave:V09_SOCIAL_MEDIA_TEMPLATE',
    communication: 'did:arweave:V09_COMMUNICATION_TEMPLATE'
};

// ═══════════════════════════════════════════════════════════════════════════
// TEMPLATE SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * didVerificationMethod Template
 * W3C DID Verification Method with OIP derivation extensions.
 */
const didVerificationMethodSchema = {
    templateDid: TEMPLATE_DIDS.didVerificationMethod,
    recordType: 'didVerificationMethod',
    fields: {
        0: { name: 'vmId', type: 'string', description: 'VM fragment ID (e.g., "#sign-0")' },
        1: { name: 'vmType', type: 'string', description: 'Key type (e.g., "oip:XpubDerivation2025")' },
        2: { name: 'controller', type: 'dref', description: 'DID that controls this key' },
        3: { name: 'publicKeyMultibase', type: 'string', description: 'Public key (multibase encoded)' },
        4: { name: 'publicKeyJwk', type: 'json', description: 'Public key (JWK format)' },
        5: { name: 'xpub', type: 'string', description: 'Extended public key for derivation' },
        6: { name: 'derivationSubPurpose', type: 'string', description: 'Sub-purpose identifier' },
        7: { name: 'derivationAccount', type: 'uint32', description: 'Account index' },
        8: { name: 'derivationPathPrefix', type: 'string', description: 'Full derivation path prefix' },
        9: { name: 'leafIndexPolicy', type: 'string', description: '"txid_hash" | "sequential" | "fixed"' },
        10: { name: 'leafIndexFixed', type: 'uint32', description: 'Fixed index if policy is "fixed"' },
        11: { name: 'leafHardened', type: 'bool', description: 'Whether leaf derivation is hardened' },
        12: { name: 'validFromBlock', type: 'uint64', description: 'Block height when key becomes valid' },
        13: { name: 'revokedFromBlock', type: 'uint64', description: 'Block height when key is revoked' },
        14: { name: 'bindingProofJws', type: 'string', description: 'JWS binding proof for hardened keys' },
        15: { name: 'bindingProofPurpose', type: 'string', description: 'Purpose of binding proof' }
    }
};

/**
 * didDocument Template
 * W3C DID Document with OIP profile extension.
 */
const didDocumentSchema = {
    templateDid: TEMPLATE_DIDS.didDocument,
    recordType: 'didDocument',
    fields: {
        0: { name: 'did', type: 'string', description: 'The DID subject' },
        1: { name: 'controller', type: 'dref', description: 'DID that controls this document' },
        2: { name: 'verificationMethod', type: 'repeated dref', description: 'List of verification methods' },
        3: { name: 'authentication', type: 'repeated string', description: 'Authentication method refs' },
        4: { name: 'assertionMethod', type: 'repeated string', description: 'Assertion method refs' },
        5: { name: 'keyAgreement', type: 'repeated string', description: 'Key agreement method refs' },
        6: { name: 'service', type: 'json', description: 'Service endpoints (JSON array)' },
        7: { name: 'alsoKnownAs', type: 'repeated string', description: 'Alternative identifiers' },
        // OIP Profile fields
        8: { name: 'oipHandleRaw', type: 'string', description: 'Handle as entered (preserves case)' },
        9: { name: 'oipHandle', type: 'string', description: 'Normalized handle (lowercase)' },
        10: { name: 'oipName', type: 'string', description: 'Display name' },
        11: { name: 'oipSurname', type: 'string', description: 'Surname/family name' },
        12: { name: 'oipLanguage', type: 'string', description: 'Preferred language (ISO 639-1)' },
        13: { name: 'oipSocialX', type: 'string', description: 'X/Twitter handle' },
        14: { name: 'oipSocialYoutube', type: 'string', description: 'YouTube channel' },
        15: { name: 'oipSocialInstagram', type: 'string', description: 'Instagram handle' },
        16: { name: 'oipSocialTiktok', type: 'string', description: 'TikTok handle' },
        17: { name: 'anchorArweaveTxid', type: 'string', description: 'Anchor transaction ID' },
        18: { name: 'keyBindingPolicy', type: 'string', description: '"xpub" | "binding"' }
    }
};

/**
 * socialMedia Template
 */
const socialMediaSchema = {
    templateDid: TEMPLATE_DIDS.socialMedia,
    recordType: 'socialMedia',
    fields: {
        0: { name: 'website', type: 'repeated dref', description: 'Website URLs' },
        1: { name: 'youtube', type: 'repeated dref', description: 'YouTube channel refs' },
        2: { name: 'x', type: 'string', description: 'X/Twitter handle' },
        3: { name: 'instagram', type: 'repeated string', description: 'Instagram handles' },
        4: { name: 'tiktok', type: 'repeated string', description: 'TikTok handles' }
    }
};

/**
 * communication Template
 */
const communicationSchema = {
    templateDid: TEMPLATE_DIDS.communication,
    recordType: 'communication',
    fields: {
        0: { name: 'phone', type: 'repeated string', description: 'Phone numbers' },
        1: { name: 'email', type: 'repeated string', description: 'Email addresses' },
        2: { name: 'signal', type: 'repeated string', description: 'Signal identifiers' }
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// TEMPLATE REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

const V09_TEMPLATES = {
    didDocument: didDocumentSchema,
    didVerificationMethod: didVerificationMethodSchema,
    socialMedia: socialMediaSchema,
    communication: communicationSchema
};

/**
 * Gets template schema by record type.
 * 
 * @param {string} recordType - Record type name
 * @returns {object|null} Template schema
 */
function getTemplateSchema(recordType) {
    return V09_TEMPLATES[recordType] || null;
}

/**
 * Gets field name by index for a record type.
 * 
 * @param {string} recordType - Record type name
 * @param {number} fieldIndex - Field index
 * @returns {string|null} Field name
 */
function getFieldName(recordType, fieldIndex) {
    const schema = V09_TEMPLATES[recordType];
    if (!schema) return null;
    return schema.fields[fieldIndex]?.name || null;
}

/**
 * Expands a compressed record using template schema.
 * Converts { "0": value, "1": value } to { fieldName: value, ... }
 * 
 * @param {object} compressedRecord - Record with numeric field indices
 * @param {string} recordType - Record type name
 * @returns {object} Expanded record with field names
 */
function expandRecord(compressedRecord, recordType) {
    const schema = V09_TEMPLATES[recordType];
    if (!schema) return compressedRecord;
    
    const expanded = { t: compressedRecord.t };
    for (const [index, value] of Object.entries(compressedRecord)) {
        if (index === 't') continue;
        const fieldName = schema.fields[parseInt(index)]?.name || index;
        expanded[fieldName] = value;
    }
    return expanded;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
    TEMPLATE_DIDS,
    V09_TEMPLATES,
    didDocumentSchema,
    didVerificationMethodSchema,
    socialMediaSchema,
    communicationSchema,
    getTemplateSchema,
    getFieldName,
    expandRecord
};
```

---

## Phase 4: Client SDK

### 4.1 Browser/Client SDK

**File: `sdk/oip-client-sdk.js`** (for browser/client-side use)

```javascript
/**
 * OIP v0.9.0 Client SDK
 * 
 * Client-side library for signing records with user's HD wallet.
 * The signed payload is then sent to the server for Arweave transaction submission.
 * 
 * IMPORTANT: This runs in the browser. The user's mnemonic/private key NEVER leaves the client.
 */

import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { sha256 } from '@noble/hashes/sha256';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const OIP_PURPOSE = 176800;
const SubPurpose = { IDENTITY_SIGN: 0 };
const OIP_VERSION = '0.9.0';

// ═══════════════════════════════════════════════════════════════════════════
// IDENTITY CLASS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * OIP Identity - manages user's HD wallet for signing.
 */
class OIPIdentity {
    constructor(mnemonic, account = 0) {
        if (!validateMnemonic(mnemonic, wordlist)) {
            throw new Error('Invalid mnemonic phrase');
        }
        
        this.account = account;
        this.seed = mnemonicToSeedSync(mnemonic);
        this.masterKey = HDKey.fromMasterSeed(this.seed);
        
        // Derive signing key at m/176800'/0'/account'
        const signingPath = `m/${OIP_PURPOSE}'/${SubPurpose.IDENTITY_SIGN}'/${account}'`;
        this.signingKey = this.masterKey.derive(signingPath);
        
        // Generate DID from master public key
        const pubKeyHash = sha256(this.masterKey.publicKey);
        this.did = `did:arweave:${base64urlEncode(pubKeyHash)}`;
        
        // Public xpub (safe to share/publish)
        this.signingXpub = this.signingKey.publicExtendedKey;
    }
    
    /**
     * Signs a record payload.
     * 
     * @param {object} payload - DataForSignature without sig tags
     * @returns {object} Signed payload ready for server submission
     */
    sign(payload) {
        // Ensure payload has required tags
        const payloadToSign = this._preparePayload(payload);
        
        // 1. Compute payload digest
        const payloadBytes = canonicalJson(payloadToSign);
        const payloadHash = sha256(new TextEncoder().encode(payloadBytes));
        const payloadDigest = base64urlEncode(payloadHash);
        
        // 2. Derive key index
        const indexInput = `oip:${payloadDigest}`;
        const indexHash = sha256(new TextEncoder().encode(indexInput));
        const index = new DataView(indexHash.buffer).getUint32(0, false) & 0x7FFFFFFF;
        
        // 3. Derive child key and sign
        const childKey = this.signingKey.deriveChild(index);
        const signature = secp256k1.sign(payloadHash, childKey.privateKey);
        const signatureBase64 = base64urlEncode(signature.toCompactRawBytes());
        
        // 4. Add signature tags
        const signedPayload = JSON.parse(JSON.stringify(payloadToSign));
        signedPayload.tags.push({ name: 'PayloadDigest', value: payloadDigest });
        signedPayload.tags.push({ name: 'KeyIndex', value: index.toString() });
        signedPayload.tags.push({ name: 'CreatorSig', value: signatureBase64 });
        
        return signedPayload;
    }
    
    /**
     * Prepares payload with required OIP tags.
     */
    _preparePayload(payload) {
        const prepared = JSON.parse(JSON.stringify(payload));
        
        // Ensure @context
        if (!prepared['@context']) {
            prepared['@context'] = this.did;
        }
        
        // Ensure required tags
        if (!prepared.tags) prepared.tags = [];
        
        const hasTag = (name) => prepared.tags.some(t => t.name === name);
        
        if (!hasTag('Index-Method')) {
            prepared.tags.unshift({ name: 'Index-Method', value: 'OIP' });
        }
        if (!hasTag('Ver')) {
            prepared.tags.push({ name: 'Ver', value: OIP_VERSION });
        }
        if (!hasTag('Content-Type')) {
            prepared.tags.push({ name: 'Content-Type', value: 'application/json' });
        }
        if (!hasTag('Creator')) {
            prepared.tags.push({ name: 'Creator', value: this.did });
        }
        
        return prepared;
    }
    
    /**
     * Creates a DID Document payload for this identity.
     */
    createDidDocument(profile = {}) {
        const vmId = crypto.randomUUID();
        const didDocId = crypto.randomUUID();
        
        return {
            '@context': this.did,
            tags: [],
            fragments: [
                {
                    id: vmId,
                    dataType: 'Record',
                    recordType: 'didVerificationMethod',
                    records: [{
                        t: 'did:arweave:V09_DID_VM_TEMPLATE',
                        0: '#sign',                                    // vmId
                        1: 'oip:XpubDerivation2025',                  // vmType
                        2: this.did,                                   // controller
                        5: this.signingXpub,                          // xpub
                        6: 'identity.sign',                           // derivationSubPurpose
                        7: this.account,                              // derivationAccount
                        8: `m/${OIP_PURPOSE}'/0'/${this.account}'`,   // derivationPathPrefix
                        9: 'payload_digest',                          // leafIndexPolicy
                        11: false                                      // leafHardened
                    }]
                },
                {
                    id: didDocId,
                    dataType: 'Record',
                    recordType: 'didDocument',
                    records: [{
                        t: 'did:arweave:V09_DID_DOCUMENT_TEMPLATE',
                        0: this.did,                                   // did
                        1: this.did,                                   // controller
                        2: [`#${vmId}`],                              // verificationMethod
                        3: ['#sign'],                                  // authentication
                        4: ['#sign'],                                  // assertionMethod
                        8: profile.handleRaw || profile.handle,        // oipHandleRaw
                        9: (profile.handle || '').toLowerCase(),       // oipHandle
                        10: profile.name,                              // oipName
                        11: profile.surname,                           // oipSurname
                        18: 'xpub'                                     // keyBindingPolicy
                    }]
                }
            ]
        };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Canonical JSON serialization.
 */
function canonicalJson(obj) {
    return JSON.stringify(obj, (key, value) => {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return Object.keys(value).sort().reduce((sorted, k) => {
                sorted[k] = value[k];
                return sorted;
            }, {});
        }
        return value;
    });
}

/**
 * Base64URL encoding.
 */
function base64urlEncode(bytes) {
    const base64 = btoa(String.fromCharCode(...new Uint8Array(bytes)));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export { OIPIdentity, canonicalJson, base64urlEncode };
```

---

## Phase 5: Indexer Integration

### 5.1 Sync Process Updates

**File: `helpers/core/sync-verification.js`**

```javascript
/**
 * Sync Process Verification Integration
 * 
 * Integrates v0.9 signature verification into the Arweave sync process.
 * Records that fail verification are NOT indexed.
 */

const { verifyRecord, parseVersion, VerificationMode } = require('./oip-verification');
const { getRecords } = require('./elasticsearch');

// ═══════════════════════════════════════════════════════════════════════════
// CREATOR RESOLVER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resolves a creator DID to their verification data.
 * Used during signature verification.
 * 
 * @param {string} creatorDid - Creator's DID
 * @returns {Promise<object|null>} Creator verification data
 */
async function resolveCreator(creatorDid) {
    try {
        // Try to find DID document
        const didDocResults = await getRecords({
            recordType: 'didDocument',
            fieldName: 'oip.data.did',
            fieldSearch: creatorDid,
            limit: 1
        });
        
        if (didDocResults.records && didDocResults.records.length > 0) {
            const didDoc = didDocResults.records[0];
            
            // Get verification methods
            const vmRefs = didDoc.oip?.data?.verificationMethod || [];
            const verificationMethods = await resolveVerificationMethods(vmRefs);
            
            return {
                did: creatorDid,
                didDocument: didDoc,
                verificationMethods,
                isV09: true
            };
        }
        
        // Fall back to legacy creatorRegistration
        const legacyResults = await getRecords({
            recordType: 'creatorRegistration',
            fieldName: 'oip.creator.didAddress',
            fieldSearch: creatorDid,
            limit: 1
        });
        
        if (legacyResults.records && legacyResults.records.length > 0) {
            const legacy = legacyResults.records[0];
            return {
                did: creatorDid,
                legacyRecord: legacy,
                signingXpub: legacy.oip?.data?.signingXpub,
                isV09: false
            };
        }
        
        return null;
        
    } catch (error) {
        console.error(`[CreatorResolver] Error resolving ${creatorDid}:`, error);
        return null;
    }
}

/**
 * Resolves verification method references to full data.
 * 
 * @param {Array<string>} vmRefs - Array of verification method drefs
 * @returns {Promise<Array>} Resolved verification methods
 */
async function resolveVerificationMethods(vmRefs) {
    const methods = [];
    
    for (const ref of vmRefs) {
        try {
            // Handle local fragment refs (#sign-0) vs full drefs
            const vmResults = await getRecords({
                recordType: 'didVerificationMethod',
                did: ref.replace(/^#/, ''),
                limit: 1
            });
            
            if (vmResults.records && vmResults.records.length > 0) {
                const vm = vmResults.records[0];
                methods.push({
                    vmId: vm.oip?.data?.vmId,
                    vmType: vm.oip?.data?.vmType,
                    xpub: vm.oip?.data?.xpub,
                    validFromBlock: vm.oip?.data?.validFromBlock || vm.oip?.blockHeight,
                    revokedFromBlock: vm.oip?.data?.revokedFromBlock
                });
            }
        } catch (error) {
            console.error(`[CreatorResolver] Error resolving VM ${ref}:`, error);
        }
    }
    
    return methods;
}

// ═══════════════════════════════════════════════════════════════════════════
// SYNC VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verifies a record before indexing.
 * 
 * @param {object} record - Record to verify
 * @param {number} blockHeight - Block height where record was confirmed
 * @returns {Promise<{shouldIndex: boolean, verificationResult: object}>}
 */
async function verifyBeforeIndex(record, blockHeight) {
    try {
        // Get version from record
        const version = record.oip?.version || 
                       record.tags?.find(t => t.name === 'Ver')?.value ||
                       '0.8';
        
        const parsedVersion = parseVersion(version);
        
        // For v0.8 and earlier, use legacy passthrough
        if (parsedVersion < 0.9) {
            console.log(`[SyncVerification] v${version} record - legacy passthrough`);
            return {
                shouldIndex: true,
                verificationResult: {
                    isValid: true,
                    mode: VerificationMode.LEGACY,
                    version
                }
            };
        }
        
        // For v0.9+, verify signature
        console.log(`[SyncVerification] v${version} record - verifying signature`);
        
        const result = await verifyRecord(record, resolveCreator, blockHeight);
        
        if (!result.isValid) {
            console.error(`[SyncVerification] ❌ Verification failed: ${result.error}`);
            console.error(`[SyncVerification] Record will NOT be indexed`);
        } else {
            console.log(`[SyncVerification] ✅ Signature verified (mode: ${result.mode})`);
        }
        
        return {
            shouldIndex: result.isValid,
            verificationResult: result
        };
        
    } catch (error) {
        console.error(`[SyncVerification] Error during verification:`, error);
        // On error, don't index (fail safe)
        return {
            shouldIndex: false,
            verificationResult: {
                isValid: false,
                error: error.message
            }
        };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
    resolveCreator,
    resolveVerificationMethods,
    verifyBeforeIndex
};
```

### 5.2 Elasticsearch Schema Updates

**File: `config/elasticsearch-mappings-v09.js`**

```javascript
/**
 * Elasticsearch mappings for v0.9 record types
 */

const didDocumentMapping = {
    properties: {
        'oip.data.did': { type: 'keyword' },
        'oip.data.controller': { type: 'keyword' },
        'oip.data.oipHandle': { type: 'keyword' },
        'oip.data.oipHandleRaw': { type: 'text' },
        'oip.data.oipName': { type: 'text' },
        'oip.data.oipSurname': { type: 'text' },
        'oip.data.keyBindingPolicy': { type: 'keyword' },
        'oip.data.verificationMethod': { type: 'keyword' },
        'oip.data.authentication': { type: 'keyword' },
        'oip.data.assertionMethod': { type: 'keyword' },
        'oip.data.alsoKnownAs': { type: 'keyword' }
    }
};

const didVerificationMethodMapping = {
    properties: {
        'oip.data.vmId': { type: 'keyword' },
        'oip.data.vmType': { type: 'keyword' },
        'oip.data.controller': { type: 'keyword' },
        'oip.data.xpub': { type: 'keyword' },
        'oip.data.derivationSubPurpose': { type: 'keyword' },
        'oip.data.derivationAccount': { type: 'integer' },
        'oip.data.leafIndexPolicy': { type: 'keyword' },
        'oip.data.validFromBlock': { type: 'long' },
        'oip.data.revokedFromBlock': { type: 'long' }
    }
};

module.exports = {
    didDocumentMapping,
    didVerificationMethodMapping
};
```

---

## Phase 6: API Endpoints

### 6.1 DID Resolution Endpoints

**File: `routes/daemon/did.js`**

```javascript
/**
 * DID Resolution API Endpoints
 * 
 * Provides W3C DID Document resolution and verification endpoints.
 */

const express = require('express');
const router = express.Router();
const { resolveCreator } = require('../../helpers/core/sync-verification');
const { verifyRecord } = require('../../helpers/core/oip-verification');
const { getRecords } = require('../../helpers/core/elasticsearch');

/**
 * GET /api/did/:did
 * Resolves a DID to its W3C DID Document.
 */
router.get('/:did', async (req, res) => {
    try {
        const { did } = req.params;
        
        const creatorData = await resolveCreator(did);
        
        if (!creatorData) {
            return res.status(404).json({
                success: false,
                error: 'DID not found'
            });
        }
        
        // Format as W3C DID Document
        const didDocument = formatAsW3C(creatorData);
        
        res.json({
            success: true,
            didDocument,
            metadata: {
                isV09: creatorData.isV09,
                resolvedAt: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('[DID API] Resolution error:', error);
        res.status(500).json({
            success: false,
            error: 'DID resolution failed'
        });
    }
});

/**
 * POST /api/did/verify
 * Verifies a signed record payload.
 */
router.post('/verify', async (req, res) => {
    try {
        const { payload, blockHeight } = req.body;
        
        if (!payload) {
            return res.status(400).json({
                success: false,
                error: 'payload is required'
            });
        }
        
        const result = await verifyRecord(
            payload,
            resolveCreator,
            blockHeight || 0
        );
        
        res.json({
            success: true,
            verification: {
                isValid: result.isValid,
                mode: result.mode,
                error: result.error,
                keyIndex: result.keyIndex,
                creatorDid: result.creatorDid
            }
        });
        
    } catch (error) {
        console.error('[DID API] Verification error:', error);
        res.status(500).json({
            success: false,
            error: 'Verification failed'
        });
    }
});

/**
 * Formats OIP creator data as W3C DID Document.
 */
function formatAsW3C(creatorData) {
    if (creatorData.isV09 && creatorData.didDocument) {
        const doc = creatorData.didDocument.oip?.data || {};
        return {
            '@context': ['https://www.w3.org/ns/did/v1', 'https://oip.dev/ns/v1'],
            id: doc.did,
            controller: doc.controller,
            verificationMethod: creatorData.verificationMethods?.map(vm => ({
                id: `${doc.did}${vm.vmId}`,
                type: vm.vmType,
                controller: doc.did,
                'oip:xpub': vm.xpub
            })),
            authentication: doc.authentication,
            assertionMethod: doc.assertionMethod,
            'oip:profile': {
                handle: doc.oipHandle,
                name: doc.oipName,
                surname: doc.oipSurname
            }
        };
    }
    
    // Legacy format
    const legacy = creatorData.legacyRecord?.oip?.data || {};
    return {
        '@context': ['https://www.w3.org/ns/did/v1'],
        id: creatorData.did,
        verificationMethod: [{
            id: `${creatorData.did}#legacy`,
            type: 'EcdsaSecp256k1VerificationKey2019',
            controller: creatorData.did,
            'oip:signingXpub': creatorData.signingXpub
        }],
        'oip:profile': {
            handle: legacy.handle,
            surname: legacy.surname
        },
        'oip:isLegacy': true
    };
}

module.exports = router;
```

---

## Phase 7: Migration & Backward Compatibility

### 7.1 Version Detection

```javascript
/**
 * Detects record version and routes to appropriate handler.
 */
function detectVersion(record) {
    // Check for Ver tag
    const verTag = record.tags?.find(t => t.name === 'Ver');
    if (verTag) {
        return verTag.value;
    }
    
    // Check for version in oip object
    if (record.oip?.version) {
        return record.oip.version;
    }
    
    // Default to v0.8 for legacy records
    return '0.8.0';
}
```

### 7.2 Legacy Compatibility Layer

```javascript
/**
 * Handles legacy v0.8 records during indexing.
 * Preserves existing verification logic.
 */
async function handleLegacyRecord(record, blockHeight) {
    // Use existing Arweave-based verification
    // (no changes to current indexing logic for v0.8 records)
    return {
        shouldIndex: true,
        version: '0.8',
        verificationMode: 'legacy'
    };
}
```

---

## Implementation Timeline

| Phase | Duration | Priority | Dependencies |
|-------|----------|----------|--------------|
| **Phase 1**: Core Crypto | 1 week | 🔴 Critical | None |
| **Phase 2**: Sign/Verify | 1 week | 🔴 Critical | Phase 1 |
| **Phase 3**: Templates | 3 days | 🔴 Critical | None |
| **Phase 4**: Client SDK | 1 week | 🟡 High | Phase 1-2 |
| **Phase 5**: Indexer | 1 week | 🔴 Critical | Phase 2-3 |
| **Phase 6**: API | 3 days | 🟡 High | Phase 5 |
| **Phase 7**: Migration | 3 days | 🟢 Medium | Phase 5-6 |

**Total: ~5-6 weeks**

---

## File Structure

```
oip-arweave-indexer/
├── helpers/
│   ├── core/
│   │   ├── oip-crypto.js           # HD key derivation (Phase 1)
│   │   ├── oip-signing.js          # Signing service (Phase 2)
│   │   ├── oip-verification.js     # Verification service (Phase 2)
│   │   └── sync-verification.js    # Indexer integration (Phase 5)
│   └── shared/                      # Shared between daemon & Alexandria
│       └── verification.js          # Verification utilities
├── config/
│   ├── templates-v09.js            # Hardcoded v0.9 templates (Phase 3)
│   └── elasticsearch-mappings-v09.js
├── routes/
│   └── daemon/
│       └── did.js                   # DID resolution endpoints (Phase 6)
├── sdk/
│   └── oip-client-sdk.js           # Browser SDK (Phase 4)
└── docs/
    └── toBuild/
        └── oip-09-js-implementation-plan.md
```

---

## Security Considerations

1. **Client-Side Key Isolation**: User's mnemonic/private keys NEVER leave the client
2. **Server Transaction Signing**: Server only signs Arweave transactions (pays fees), not record content
3. **Payload Digest**: Deterministic before signing, included in record for verification
4. **BlockHeight Validity**: Keys have explicit validity windows based on blockchain ordering
5. **Failed Verification = No Index**: Invalid signatures are rejected at sync time

---

## Testing Strategy

### Unit Tests
- Key derivation path generation
- Payload digest computation
- Index derivation from digest
- Signature generation/verification round-trip
- Canonical JSON serialization

### Integration Tests  
- Full sign → publish → sync → verify cycle
- Legacy v0.8 passthrough
- Key validity window enforcement
- Creator resolution chain

### E2E Tests
- Client SDK signing
- Server transaction submission
- Indexer verification
- DID resolution API

---

## References

- [OIP v0.9.0 Implementation Plan (C# Reference)](./oip-09-implementation-plan.md)
- [W3C DID Core](https://www.w3.org/TR/did-core/)
- [SLIP-0043](https://github.com/satoshilabs/slips/blob/master/slip-0043.md)
- [BIP-32](https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki)
- [@scure/bip32](https://github.com/paulmillr/scure-bip32)
- [@noble/curves](https://github.com/paulmillr/noble-curves)

