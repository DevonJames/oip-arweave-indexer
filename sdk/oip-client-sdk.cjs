/**
 * OIP v0.9.0 Client SDK (CommonJS)
 * 
 * Client-side library for signing records with user's HD wallet.
 * The signed payload is then sent to the server for Arweave transaction submission.
 * 
 * IMPORTANT: This runs in the browser. The user's mnemonic/private key NEVER leaves the client.
 * 
 * @module oip-client-sdk
 */

'use strict';

const { HDKey } = require('@scure/bip32');
const { mnemonicToSeedSync, validateMnemonic, generateMnemonic } = require('@scure/bip39');
const { wordlist } = require('@scure/bip39/wordlists/english');
const { sha256 } = require('@noble/hashes/sha256');
const { secp256k1 } = require('@noble/curves/secp256k1');

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const OIP_PURPOSE = 176800;
const SubPurpose = { 
    IDENTITY_SIGN: 0,
    IDENTITY_ENCRYPT: 1,
    DELEGATION: 2,
    REVOCATION: 3,
    JWT: 4,
    SSH: 5,
    BACKUP: 6,
    ONION: 7,
    EXPERIMENTAL: 8
};
const OIP_VERSION = '0.9.0';

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

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
 * Base64URL encoding (works in both Node.js and browser).
 * 
 * @param {Uint8Array|ArrayBuffer|Buffer} bytes - Bytes to encode
 * @returns {string} Base64URL encoded string
 */
function base64urlEncode(bytes) {
    let base64;
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(bytes)) {
        base64 = bytes.toString('base64');
    } else if (typeof Buffer !== 'undefined') {
        base64 = Buffer.from(bytes).toString('base64');
    } else {
        // Browser fallback
        const uint8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        base64 = btoa(String.fromCharCode(...uint8));
    }
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Base64URL decoding.
 * 
 * @param {string} str - Base64URL string
 * @returns {Uint8Array} Decoded bytes
 */
function base64urlDecode(str) {
    const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
    
    if (typeof Buffer !== 'undefined') {
        return new Uint8Array(Buffer.from(padded, 'base64'));
    } else {
        // Browser fallback
        const binary = atob(padded);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }
}

/**
 * Derives key index from payload digest per OIP v0.9 spec.
 * Algorithm: uint31(SHA256("oip:" + payloadDigest))
 * 
 * @param {string} payloadDigest - Base64URL-encoded payload digest
 * @returns {number} Derived index (31-bit unsigned integer)
 */
function deriveIndexFromPayloadDigest(payloadDigest) {
    const input = `oip:${payloadDigest}`;
    const hash = sha256(new TextEncoder().encode(input));
    const view = new DataView(hash.buffer, hash.byteOffset, hash.byteLength);
    return view.getUint32(0, false) & 0x7FFFFFFF;
}

// ═══════════════════════════════════════════════════════════════════════════
// IDENTITY CLASS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * OIP Identity - manages user's HD wallet for signing.
 * 
 * @example
 * ```javascript
 * const { OIPIdentity } = require('@oip/client-sdk');
 * 
 * const identity = new OIPIdentity('your twelve word mnemonic phrase here...');
 * console.log(identity.did); // did:arweave:...
 * 
 * const signedPayload = identity.sign({
 *   fragments: [{ id: 'abc', dataType: 'Record', recordType: 'post', records: [...] }]
 * });
 * 
 * // Send signedPayload to server for Arweave submission
 * ```
 */
class OIPIdentity {
    /**
     * Creates an OIP identity from a mnemonic phrase.
     * 
     * @param {string} mnemonic - BIP-39 mnemonic phrase (12 or 24 words)
     * @param {number} account - Account index (default 0)
     * @throws {Error} If mnemonic is invalid
     */
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
        const index = deriveIndexFromPayloadDigest(payloadDigest);
        
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
     * 
     * @private
     * @param {object} payload - Raw payload
     * @returns {object} Prepared payload
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
     * Use this for initial creator registration.
     * 
     * @param {object} profile - Profile information
     * @param {string} profile.handle - Unique handle/username
     * @param {string} profile.name - Display name
     * @param {string} profile.surname - Last name
     * @returns {object} Unsigned DID Document payload
     */
    createDidDocument(profile = {}) {
        const { randomUUID } = require('crypto');
        const vmId = randomUUID();
        const didDocId = randomUUID();
        
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
    
    /**
     * Creates and signs a DID Document for registration.
     * 
     * @param {object} profile - Profile information
     * @returns {object} Signed DID Document payload ready for server submission
     */
    createSignedDidDocument(profile = {}) {
        const didDoc = this.createDidDocument(profile);
        return this.sign(didDoc);
    }
    
    /**
     * Gets the derivation path for this identity's signing key.
     * 
     * @returns {string} Derivation path
     */
    getDerivationPath() {
        return `m/${OIP_PURPOSE}'/${SubPurpose.IDENTITY_SIGN}'/${this.account}'`;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// FACTORY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Creates a new OIP identity with a randomly generated mnemonic.
 * 
 * @param {number} strength - Entropy bits (128 = 12 words, 256 = 24 words)
 * @param {number} account - Account index
 * @returns {{ identity: OIPIdentity, mnemonic: string }}
 */
function createNewIdentity(strength = 256, account = 0) {
    const mnemonic = generateMnemonic(wordlist, strength);
    const identity = new OIPIdentity(mnemonic, account);
    return { identity, mnemonic };
}

/**
 * Validates a mnemonic phrase.
 * 
 * @param {string} mnemonic - Mnemonic to validate
 * @returns {boolean} True if valid
 */
function isValidMnemonic(mnemonic) {
    return validateMnemonic(mnemonic, wordlist);
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
    OIPIdentity,
    createNewIdentity,
    isValidMnemonic,
    canonicalJson,
    base64urlEncode,
    base64urlDecode,
    deriveIndexFromPayloadDigest,
    OIP_PURPOSE,
    SubPurpose,
    OIP_VERSION,
    default: OIPIdentity
};

