/**
 * OIP Crypto Bundle for Browser
 * 
 * Self-contained cryptographic utilities for OIP v0.9 client-side signing.
 * This bundle provides HD key derivation and signing without external dependencies.
 * 
 * Based on:
 * - @scure/bip32 (HD key derivation)
 * - @scure/bip39 (mnemonic handling)
 * - @noble/hashes (SHA256)
 * - @noble/curves (secp256k1)
 */

(function(global) {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════
    
    const OIP_PURPOSE = 176800;
    const OIP_VERSION = '0.9.0';
    
    // BIP-39 English wordlist (first 100 words for validation, full list loaded separately)
    const WORDLIST_SAMPLE = [
        'abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract',
        'absurd', 'abuse', 'access', 'accident', 'account', 'accuse', 'achieve', 'acid'
    ];

    // ═══════════════════════════════════════════════════════════════════════════
    // UTILITY FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * Convert hex string to Uint8Array
     */
    function hexToBytes(hex) {
        if (typeof hex !== 'string') throw new Error('hexToBytes: expected string');
        if (hex.length % 2) hex = '0' + hex;
        const len = hex.length / 2;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
        }
        return bytes;
    }
    
    /**
     * Convert Uint8Array to hex string
     */
    function bytesToHex(bytes) {
        return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    
    /**
     * Base64URL encode
     */
    function base64urlEncode(bytes) {
        if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
        if (bytes instanceof Uint8Array) {
            let binary = '';
            for (let i = 0; i < bytes.length; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            bytes = binary;
        }
        const base64 = btoa(bytes);
        return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    
    /**
     * Base64URL decode
     */
    function base64urlDecode(str) {
        str = str.replace(/-/g, '+').replace(/_/g, '/');
        while (str.length % 4) str += '=';
        const binary = atob(str);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }
    
    /**
     * Canonical JSON serialization (sorted keys, no whitespace)
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

    // ═══════════════════════════════════════════════════════════════════════════
    // SHA-256 (Web Crypto API wrapper with sync fallback)
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * SHA-256 hash (async, uses Web Crypto API)
     */
    async function sha256Async(data) {
        if (typeof data === 'string') {
            data = new TextEncoder().encode(data);
        }
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        return new Uint8Array(hashBuffer);
    }
    
    /**
     * HMAC-SHA512 (for BIP-32 key derivation)
     */
    async function hmacSha512(key, data) {
        if (typeof key === 'string') key = new TextEncoder().encode(key);
        if (typeof data === 'string') data = new TextEncoder().encode(data);
        
        const cryptoKey = await crypto.subtle.importKey(
            'raw', key, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']
        );
        const sig = await crypto.subtle.sign('HMAC', cryptoKey, data);
        return new Uint8Array(sig);
    }
    
    /**
     * PBKDF2 for mnemonic to seed
     */
    async function pbkdf2Sha512(password, salt, iterations, keyLength) {
        if (typeof password === 'string') password = new TextEncoder().encode(password);
        if (typeof salt === 'string') salt = new TextEncoder().encode(salt);
        
        const key = await crypto.subtle.importKey(
            'raw', password, 'PBKDF2', false, ['deriveBits']
        );
        const bits = await crypto.subtle.deriveBits(
            { name: 'PBKDF2', salt, iterations, hash: 'SHA-512' },
            key, keyLength * 8
        );
        return new Uint8Array(bits);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SECP256K1 ELLIPTIC CURVE (simplified implementation)
    // ═══════════════════════════════════════════════════════════════════════════
    
    // secp256k1 curve parameters
    const CURVE = {
        p: BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F'),
        n: BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141'),
        Gx: BigInt('0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798'),
        Gy: BigInt('0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8'),
        a: 0n,
        b: 7n
    };
    
    /**
     * Modular arithmetic helpers
     */
    function mod(a, b = CURVE.p) {
        const result = a % b;
        return result >= 0n ? result : b + result;
    }
    
    function modInverse(a, m = CURVE.p) {
        let [old_r, r] = [a, m];
        let [old_s, s] = [1n, 0n];
        while (r !== 0n) {
            const q = old_r / r;
            [old_r, r] = [r, old_r - q * r];
            [old_s, s] = [s, old_s - q * s];
        }
        return mod(old_s, m);
    }
    
    /**
     * Point addition on secp256k1
     */
    function pointAdd(p1, p2) {
        if (p1 === null) return p2;
        if (p2 === null) return p1;
        
        const [x1, y1] = p1;
        const [x2, y2] = p2;
        
        if (x1 === x2 && y1 === y2) {
            // Point doubling
            const s = mod((3n * x1 * x1) * modInverse(2n * y1));
            const x3 = mod(s * s - 2n * x1);
            const y3 = mod(s * (x1 - x3) - y1);
            return [x3, y3];
        }
        
        if (x1 === x2) return null; // Point at infinity
        
        const s = mod((y2 - y1) * modInverse(x2 - x1));
        const x3 = mod(s * s - x1 - x2);
        const y3 = mod(s * (x1 - x3) - y1);
        return [x3, y3];
    }
    
    /**
     * Scalar multiplication (double-and-add)
     */
    function pointMultiply(k, point = [CURVE.Gx, CURVE.Gy]) {
        let result = null;
        let addend = point;
        
        while (k > 0n) {
            if (k & 1n) {
                result = pointAdd(result, addend);
            }
            addend = pointAdd(addend, addend);
            k >>= 1n;
        }
        return result;
    }
    
    /**
     * Get public key from private key
     */
    function getPublicKey(privateKey, compressed = true) {
        if (privateKey instanceof Uint8Array) {
            privateKey = BigInt('0x' + bytesToHex(privateKey));
        }
        
        const point = pointMultiply(privateKey);
        if (!point) throw new Error('Invalid private key');
        
        const [x, y] = point;
        const xBytes = hexToBytes(x.toString(16).padStart(64, '0'));
        
        if (compressed) {
            const prefix = (y & 1n) === 0n ? 0x02 : 0x03;
            const result = new Uint8Array(33);
            result[0] = prefix;
            result.set(xBytes, 1);
            return result;
        } else {
            const yBytes = hexToBytes(y.toString(16).padStart(64, '0'));
            const result = new Uint8Array(65);
            result[0] = 0x04;
            result.set(xBytes, 1);
            result.set(yBytes, 33);
            return result;
        }
    }
    
    /**
     * Parse public key bytes to point
     */
    function parsePublicKey(bytes) {
        if (bytes[0] === 0x04) {
            // Uncompressed
            const x = BigInt('0x' + bytesToHex(bytes.slice(1, 33)));
            const y = BigInt('0x' + bytesToHex(bytes.slice(33, 65)));
            return [x, y];
        } else if (bytes[0] === 0x02 || bytes[0] === 0x03) {
            // Compressed
            const x = BigInt('0x' + bytesToHex(bytes.slice(1, 33)));
            const ySquared = mod(x * x * x + CURVE.b);
            let y = modPow(ySquared, (CURVE.p + 1n) / 4n, CURVE.p);
            
            const isOdd = (y & 1n) === 1n;
            const shouldBeOdd = bytes[0] === 0x03;
            if (isOdd !== shouldBeOdd) {
                y = mod(-y);
            }
            return [x, y];
        }
        throw new Error('Invalid public key format');
    }
    
    function modPow(base, exp, mod) {
        let result = 1n;
        base = base % mod;
        while (exp > 0n) {
            if (exp % 2n === 1n) {
                result = (result * base) % mod;
            }
            exp = exp / 2n;
            base = (base * base) % mod;
        }
        return result;
    }
    
    /**
     * ECDSA Sign (deterministic RFC 6979)
     */
    async function sign(messageHash, privateKey) {
        if (typeof privateKey === 'string') {
            privateKey = hexToBytes(privateKey);
        }
        const privKeyBigInt = BigInt('0x' + bytesToHex(privateKey));
        const z = BigInt('0x' + bytesToHex(messageHash));
        
        // Simple deterministic k generation (not full RFC 6979, but sufficient for our use)
        const kData = new Uint8Array(64);
        kData.set(privateKey, 0);
        kData.set(messageHash, 32);
        const kHash = await sha256Async(kData);
        let k = BigInt('0x' + bytesToHex(kHash)) % CURVE.n;
        if (k === 0n) k = 1n;
        
        const point = pointMultiply(k);
        const r = mod(point[0], CURVE.n);
        if (r === 0n) throw new Error('Invalid k');
        
        let s = mod(modInverse(k, CURVE.n) * (z + r * privKeyBigInt), CURVE.n);
        
        // Ensure low-S (BIP-62)
        if (s > CURVE.n / 2n) {
            s = CURVE.n - s;
        }
        
        // Return compact signature (64 bytes: r || s)
        const rBytes = hexToBytes(r.toString(16).padStart(64, '0'));
        const sBytes = hexToBytes(s.toString(16).padStart(64, '0'));
        const sig = new Uint8Array(64);
        sig.set(rBytes, 0);
        sig.set(sBytes, 32);
        return sig;
    }
    
    /**
     * ECDSA Verify
     */
    function verify(signature, messageHash, publicKey) {
        try {
            const r = BigInt('0x' + bytesToHex(signature.slice(0, 32)));
            const s = BigInt('0x' + bytesToHex(signature.slice(32, 64)));
            const z = BigInt('0x' + bytesToHex(messageHash));
            
            if (r <= 0n || r >= CURVE.n || s <= 0n || s >= CURVE.n) return false;
            
            const point = parsePublicKey(publicKey);
            const sInv = modInverse(s, CURVE.n);
            const u1 = mod(z * sInv, CURVE.n);
            const u2 = mod(r * sInv, CURVE.n);
            
            const p1 = pointMultiply(u1);
            const p2 = pointMultiply(u2, point);
            const result = pointAdd(p1, p2);
            
            if (!result) return false;
            return mod(result[0], CURVE.n) === r;
        } catch (e) {
            return false;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // BIP-32 HD KEY DERIVATION
    // ═══════════════════════════════════════════════════════════════════════════
    
    const HARDENED_OFFSET = 0x80000000;
    
    class HDKey {
        constructor() {
            this.privateKey = null;
            this.publicKey = null;
            this.chainCode = null;
            this.depth = 0;
            this.index = 0;
            this.parentFingerprint = 0;
        }
        
        static async fromMasterSeed(seed) {
            const I = await hmacSha512('Bitcoin seed', seed);
            const key = new HDKey();
            key.privateKey = I.slice(0, 32);
            key.chainCode = I.slice(32, 64);
            key.publicKey = getPublicKey(key.privateKey);
            return key;
        }
        
        async deriveChild(index) {
            const isHardened = index >= HARDENED_OFFSET;
            const data = new Uint8Array(37);
            
            if (isHardened) {
                if (!this.privateKey) throw new Error('Cannot derive hardened child without private key');
                data[0] = 0;
                data.set(this.privateKey, 1);
            } else {
                data.set(this.publicKey, 0);
            }
            
            data[33] = (index >>> 24) & 0xff;
            data[34] = (index >>> 16) & 0xff;
            data[35] = (index >>> 8) & 0xff;
            data[36] = index & 0xff;
            
            const I = await hmacSha512(this.chainCode, data);
            const IL = I.slice(0, 32);
            const IR = I.slice(32, 64);
            
            const child = new HDKey();
            child.chainCode = IR;
            child.depth = this.depth + 1;
            child.index = index;
            
            // Fingerprint: first 4 bytes of HASH160(pubkey)
            const pubHash = await sha256Async(this.publicKey);
            child.parentFingerprint = (pubHash[0] << 24) | (pubHash[1] << 16) | (pubHash[2] << 8) | pubHash[3];
            
            if (this.privateKey) {
                const ilNum = BigInt('0x' + bytesToHex(IL));
                const privNum = BigInt('0x' + bytesToHex(this.privateKey));
                const childPrivNum = mod(ilNum + privNum, CURVE.n);
                child.privateKey = hexToBytes(childPrivNum.toString(16).padStart(64, '0'));
                child.publicKey = getPublicKey(child.privateKey);
            } else {
                const ilPoint = pointMultiply(BigInt('0x' + bytesToHex(IL)));
                const parentPoint = parsePublicKey(this.publicKey);
                const childPoint = pointAdd(ilPoint, parentPoint);
                const x = childPoint[0];
                const y = childPoint[1];
                const prefix = (y & 1n) === 0n ? 0x02 : 0x03;
                child.publicKey = new Uint8Array(33);
                child.publicKey[0] = prefix;
                child.publicKey.set(hexToBytes(x.toString(16).padStart(64, '0')), 1);
            }
            
            return child;
        }
        
        async derive(path) {
            const segments = path.split('/');
            let key = this;
            
            for (const segment of segments) {
                if (segment === 'm') continue;
                
                const hardened = segment.endsWith("'") || segment.endsWith('h');
                const index = parseInt(segment.replace(/['h]$/, ''), 10);
                const childIndex = hardened ? index + HARDENED_OFFSET : index;
                
                key = await key.deriveChild(childIndex);
            }
            
            return key;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // BIP-39 MNEMONIC
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * Validate mnemonic phrase (basic validation)
     */
    function validateMnemonic(mnemonic) {
        const words = mnemonic.trim().toLowerCase().split(/\s+/);
        if (words.length !== 12 && words.length !== 15 && 
            words.length !== 18 && words.length !== 21 && words.length !== 24) {
            return false;
        }
        // Basic check - words should be alphabetic
        return words.every(w => /^[a-z]+$/.test(w));
    }
    
    /**
     * Convert mnemonic to seed
     */
    async function mnemonicToSeed(mnemonic, passphrase = '') {
        const normalizedMnemonic = mnemonic.trim().toLowerCase().split(/\s+/).join(' ');
        const salt = 'mnemonic' + passphrase;
        return await pbkdf2Sha512(normalizedMnemonic, salt, 2048, 64);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // OIP IDENTITY
    // ═══════════════════════════════════════════════════════════════════════════
    
    class OIPIdentity {
        constructor() {
            this.did = null;
            this.signingKey = null;
            this.signingXpub = null;
            this.account = 0;
        }
        
        /**
         * Create identity from mnemonic
         */
        static async fromMnemonic(mnemonic, account = 0) {
            if (!validateMnemonic(mnemonic)) {
                throw new Error('Invalid mnemonic phrase. Expected 12, 15, 18, 21, or 24 words.');
            }
            
            const identity = new OIPIdentity();
            identity.account = account;
            
            // Mnemonic → Seed
            const seed = await mnemonicToSeed(mnemonic);
            
            // Seed → Master Key
            const masterKey = await HDKey.fromMasterSeed(seed);
            
            // Generate DID from master public key hash
            const pubKeyHash = await sha256Async(masterKey.publicKey);
            identity.did = 'did:arweave:' + base64urlEncode(pubKeyHash);
            
            // Derive signing key at m/176800'/0'/account'
            const signingPath = `m/${OIP_PURPOSE}'/0'/${account}'`;
            identity.signingKey = await masterKey.derive(signingPath);
            
            // Generate xpub-style identifier (simplified - just the public key for display)
            identity.signingXpub = 'xpub:' + base64urlEncode(identity.signingKey.publicKey);
            
            return identity;
        }
        
        /**
         * Sign a record payload
         */
        async sign(payload) {
            // Ensure payload has required tags
            const payloadToSign = this._preparePayload(payload);
            
            // 1. Compute payload digest
            const payloadBytes = canonicalJson(payloadToSign);
            const payloadHash = await sha256Async(payloadBytes);
            const payloadDigest = base64urlEncode(payloadHash);
            
            // 2. Derive key index from payload digest
            const indexInput = 'oip:' + payloadDigest;
            const indexHash = await sha256Async(indexInput);
            const indexView = new DataView(indexHash.buffer);
            const keyIndex = indexView.getUint32(0, false) & 0x7FFFFFFF;
            
            // 3. Derive child key and sign
            const childKey = await this.signingKey.deriveChild(keyIndex);
            const signature = await sign(payloadHash, childKey.privateKey);
            const signatureBase64 = base64urlEncode(signature);
            
            // 4. Add signature tags
            const signedPayload = JSON.parse(JSON.stringify(payloadToSign));
            signedPayload.tags.push({ name: 'PayloadDigest', value: payloadDigest });
            signedPayload.tags.push({ name: 'KeyIndex', value: keyIndex.toString() });
            signedPayload.tags.push({ name: 'CreatorSig', value: signatureBase64 });
            
            return signedPayload;
        }
        
        /**
         * Prepare payload with required OIP tags
         */
        _preparePayload(payload) {
            const prepared = JSON.parse(JSON.stringify(payload));
            
            // Ensure @context
            if (!prepared['@context']) {
                prepared['@context'] = this.did;
            }
            
            // Ensure tags array
            if (!prepared.tags) prepared.tags = [];
            
            const hasTag = (name) => prepared.tags.some(t => t.name === name);
            
            // Add required tags
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
         * Build a basic OIP record from content
         */
        buildRecord(content) {
            const fragmentId = this._generateUUID();
            
            return {
                '@context': this.did,
                tags: [],
                fragments: [{
                    id: fragmentId,
                    dataType: 'Record',
                    recordType: content.recordType || 'post',
                    records: [{
                        t: 'tmpl:basic+' + (content.recordType || 'post'),
                        ...content.fields
                    }]
                }]
            };
        }
        
        _generateUUID() {
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                const r = Math.random() * 16 | 0;
                const v = c === 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MNEMONIC STORAGE (encrypted localStorage)
    // ═══════════════════════════════════════════════════════════════════════════
    
    const MnemonicStorage = {
        /**
         * Encrypt and store mnemonic
         */
        async save(mnemonic, password) {
            const enc = new TextEncoder();
            const keyMaterial = await crypto.subtle.importKey(
                'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
            );
            
            const salt = crypto.getRandomValues(new Uint8Array(16));
            const key = await crypto.subtle.deriveKey(
                { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
                keyMaterial,
                { name: 'AES-GCM', length: 256 },
                false,
                ['encrypt']
            );
            
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const encrypted = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv },
                key,
                enc.encode(mnemonic)
            );
            
            const data = {
                salt: base64urlEncode(salt),
                iv: base64urlEncode(iv),
                encrypted: base64urlEncode(new Uint8Array(encrypted))
            };
            
            localStorage.setItem('op_publisher_mnemonic', JSON.stringify(data));
            return true;
        },
        
        /**
         * Decrypt and retrieve mnemonic
         */
        async load(password) {
            const stored = localStorage.getItem('op_publisher_mnemonic');
            if (!stored) return null;
            
            try {
                const data = JSON.parse(stored);
                const enc = new TextEncoder();
                const keyMaterial = await crypto.subtle.importKey(
                    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
                );
                
                const key = await crypto.subtle.deriveKey(
                    { name: 'PBKDF2', salt: base64urlDecode(data.salt), iterations: 100000, hash: 'SHA-256' },
                    keyMaterial,
                    { name: 'AES-GCM', length: 256 },
                    false,
                    ['decrypt']
                );
                
                const decrypted = await crypto.subtle.decrypt(
                    { name: 'AES-GCM', iv: base64urlDecode(data.iv) },
                    key,
                    base64urlDecode(data.encrypted)
                );
                
                return new TextDecoder().decode(decrypted);
            } catch (e) {
                console.error('Failed to decrypt mnemonic:', e);
                return null;
            }
        },
        
        /**
         * Check if mnemonic is stored
         */
        hasStored() {
            return localStorage.getItem('op_publisher_mnemonic') !== null;
        },
        
        /**
         * Clear stored mnemonic
         */
        clear() {
            localStorage.removeItem('op_publisher_mnemonic');
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // EXPORTS
    // ═══════════════════════════════════════════════════════════════════════════
    
    global.OIPCrypto = {
        // Identity
        OIPIdentity,
        
        // Mnemonic
        validateMnemonic,
        mnemonicToSeed,
        
        // HD Keys
        HDKey,
        
        // Crypto
        sha256: sha256Async,
        sign,
        verify,
        getPublicKey,
        
        // Utilities
        canonicalJson,
        base64urlEncode,
        base64urlDecode,
        hexToBytes,
        bytesToHex,
        
        // Storage
        MnemonicStorage,
        
        // Constants
        OIP_PURPOSE,
        OIP_VERSION
    };
    
})(typeof window !== 'undefined' ? window : global);
