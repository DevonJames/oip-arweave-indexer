# OIP v0.9 Login-less Publishing

## Overview

OIP v0.9 introduces **login-less publishing** - a paradigm shift where users can publish records to the blockchain without creating an account, logging in, or trusting the server with their identity credentials.

Instead of username/password authentication, users sign records client-side using their **BIP-39 mnemonic phrase**. The server's only role is to pay the Arweave transaction fee and submit the pre-signed record to the blockchain.

---

## Key Principles

| Principle | Description |
|-----------|-------------|
| **Your mnemonic = your identity** | No accounts, no passwords, no email verification |
| **Client-side signing** | Your private keys never leave your browser |
| **Server pays fees** | Server's Arweave wallet covers transaction costs |
| **Deterministic identity** | Same mnemonic always produces same DID |
| **Censorship resistant** | Server cannot modify your signed content |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           USER'S BROWSER                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌─────────────────┐    ┌──────────────────┐    ┌────────────────────┐    │
│   │  BIP-39         │    │  HD Key          │    │  Record Signing    │    │
│   │  Mnemonic       │───▶│  Derivation      │───▶│  (secp256k1)       │    │
│   │  (24 words)     │    │  m/176800'/0'/0' │    │                    │    │
│   └─────────────────┘    └──────────────────┘    └────────────────────┘    │
│           │                      │                        │                │
│           │                      ▼                        ▼                │
│           │              ┌──────────────────┐    ┌────────────────────┐    │
│           │              │  DID             │    │  Signed Payload    │    │
│           │              │  did:arweave:... │    │  + CreatorSig      │    │
│           │              └──────────────────┘    │  + PayloadDigest   │    │
│           │                                      │  + KeyIndex        │    │
│           │                                      └────────────────────┘    │
│           │                                               │                │
│           │     ⚠️ SECURITY BOUNDARY - Keys stay here     │                │
│           │                                               │                │
└───────────┼───────────────────────────────────────────────┼────────────────┘
            │                                               │
            │ (mnemonic NEVER crosses this line)            ▼
            │                                      ┌────────────────────┐
            │                                      │  POST /api/records │
            │                                      │  /publishSigned    │
            │                                      └────────────────────┘
            │                                               │
┌───────────┼───────────────────────────────────────────────┼────────────────┐
│           │              OIP DAEMON SERVICE               │                │
├───────────┼───────────────────────────────────────────────┼────────────────┤
│           │                                               ▼                │
│           │                                      ┌────────────────────┐    │
│           │                                      │  Verify Signature  │    │
│           │                                      │  (optional)        │    │
│           │                                      └────────────────────┘    │
│           │                                               │                │
│           │                                               ▼                │
│           │    ┌──────────────────┐             ┌────────────────────┐    │
│           │    │  Server Arweave  │────────────▶│  Create & Sign     │    │
│           │    │  Wallet (JWK)    │             │  Arweave TX        │    │
│           │    └──────────────────┘             └────────────────────┘    │
│           │                                               │                │
│           │          💰 Server pays AR fee                │                │
│           │                                               ▼                │
│           │                                      ┌────────────────────┐    │
│           │                                      │  Submit to         │    │
│           │                                      │  Arweave Network   │    │
│           │                                      └────────────────────┘    │
│           │                                               │                │
└───────────┼───────────────────────────────────────────────┼────────────────┘
            │                                               │
            │                                               ▼
┌───────────┼───────────────────────────────────────────────────────────────┐
│           │                    ARWEAVE BLOCKCHAIN                          │
├───────────┼───────────────────────────────────────────────────────────────┤
│           │                                                                │
│           │    Transaction contains:                                       │
│           │    ├─ Data: User's signed JSON payload                        │
│           │    └─ Tags:                                                    │
│           │         ├─ Index-Method: OIP                                  │
│           │         ├─ Ver: 0.9.0                                         │
│           │         ├─ Creator: did:arweave:...                           │
│           │         ├─ CreatorSig: <base64url signature>                  │
│           │         ├─ PayloadDigest: <base64url SHA256>                  │
│           │         └─ KeyIndex: <derived index>                          │
│           │                                                                │
└───────────┴───────────────────────────────────────────────────────────────┘
```

---

## Identity Derivation

Your identity is derived deterministically from your mnemonic using BIP-32/SLIP-0043 HD key derivation:

```
Mnemonic (24 words)
        │
        ▼
    Master Seed
        │
        ▼
    Master Key (secp256k1)
        │
        ├───────────────────────────────────────┐
        ▼                                       ▼
    DID Generation                        Signing Key Derivation
    SHA256(masterPubKey)                  m/176800'/0'/account'
    base64url encode                            │
        │                                       ▼
        ▼                                   Signing xpub
    did:arweave:...                        (published in DID doc)
```

### Derivation Path

```
m / 176800' / sub-purpose' / account' / index

Where:
  176800     = OIP custom purpose (SLIP-0043)
  sub-purpose = 0 (identity.sign)
  account    = User's account index (usually 0)
  index      = Derived from payload digest (for each record)
```

---

## Signing Process

When signing a record, the following steps occur **entirely in your browser**:

### 1. Build Payload

```javascript
const payload = {
    '@context': 'did:arweave:YOUR_DID',
    tags: [
        { name: 'Index-Method', value: 'OIP' },
        { name: 'Ver', value: '0.9.0' },
        { name: 'Content-Type', value: 'application/json' },
        { name: 'Creator', value: 'did:arweave:YOUR_DID' }
    ],
    fragments: [{
        id: 'uuid',
        dataType: 'Record',
        recordType: 'post',
        records: [{ /* your record data */ }]
    }]
};
```

### 2. Compute Payload Digest

```javascript
// Canonical JSON (sorted keys, no whitespace)
const payloadBytes = canonicalJson(payload);

// SHA256 hash → base64url
const payloadDigest = base64url(sha256(payloadBytes));
```

### 3. Derive Key Index

```javascript
// Deterministic index from payload digest
const indexInput = `oip:${payloadDigest}`;
const indexHash = sha256(indexInput);
const keyIndex = uint31(indexHash);  // 31-bit unsigned integer
```

### 4. Derive Signing Key

```javascript
// From your signing base key at m/176800'/0'/0'
const childKey = signingKey.deriveChild(keyIndex);
```

### 5. Sign Payload

```javascript
// ECDSA signature over payload hash
const signature = secp256k1.sign(payloadHash, childKey.privateKey);
const creatorSig = base64url(signature.toCompactRawBytes());
```

### 6. Add Signature Tags

```javascript
payload.tags.push({ name: 'PayloadDigest', value: payloadDigest });
payload.tags.push({ name: 'KeyIndex', value: keyIndex.toString() });
payload.tags.push({ name: 'CreatorSig', value: creatorSig });
```

---

## API Endpoint

### `POST /api/records/publishSigned`

Submit a pre-signed v0.9 payload for publication on Arweave.

#### Request Body

```json
{
    "payload": {
        "@context": "did:arweave:...",
        "tags": [
            { "name": "Index-Method", "value": "OIP" },
            { "name": "Ver", "value": "0.9.0" },
            { "name": "Creator", "value": "did:arweave:..." },
            { "name": "PayloadDigest", "value": "..." },
            { "name": "KeyIndex", "value": "..." },
            { "name": "CreatorSig", "value": "..." }
        ],
        "fragments": [...]
    },
    "verifySignature": true,
    "destinations": {
        "arweave": true,
        "gun": false,
        "internetArchive": false
    }
}
```

#### Response (Success)

```json
{
    "success": true,
    "transactionId": "abc123...",
    "did": "did:arweave:abc123...",
    "creator": "did:arweave:...",
    "version": "0.9.0",
    "blockchain": "arweave",
    "message": "Record published successfully.",
    "explorerUrl": "https://viewblock.io/arweave/tx/abc123..."
}
```

#### Response (Error)

```json
{
    "error": "Signature verification failed",
    "message": "The signature could not be verified against the creator's published xpub",
    "creator": "did:arweave:...",
    "keyIndex": 12345678
}
```

---

## Publisher Interface

Access the anonymous publisher at:

| Environment | URL |
|-------------|-----|
| Local Development | `http://localhost:3007/publish` |
| Production | `https://your-domain.com/publish` |
| TOR Hidden Service | `http://your-onion.onion/publish` |

### Features

1. **Generate Test Mnemonic** - Creates a random 24-word mnemonic for testing
2. **Load Identity** - Derives DID and signing xpub from mnemonic
3. **Record Form** - Title, description, content, byline, tags
4. **Destination Selection** - Choose where to publish (Arweave, GUN, IA)
5. **Client-Side Signing** - Signs in browser before submission

---

## Security Considerations

### ✅ What's Protected

- **Mnemonic phrase** - Never sent to server, processed entirely in browser
- **Private keys** - Derived and used only in browser memory
- **Signing operation** - Happens client-side before any network request

### ⚠️ What to Be Aware Of

- **Browser security** - Ensure you're on a trusted device/browser
- **Network interception** - Use HTTPS or TOR for transport encryption
- **Mnemonic exposure** - Anyone with your mnemonic can publish as you
- **Payload visibility** - The signed content IS sent to the server (it's public anyway)

### 🔒 Best Practices

1. **Use TOR** for maximum anonymity
2. **Generate fresh mnemonics** for anonymous publishing
3. **Don't reuse mnemonics** across different identity contexts
4. **Verify the URL** before entering your mnemonic
5. **Use a clean browser** (private/incognito mode)

---

## Verification Flow

When records are indexed, the signature is verified:

```
┌─────────────────────────────────────────────────────────────────┐
│                      INDEXER VERIFICATION                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Extract signature data from record tags                      │
│     ├─ Creator DID                                               │
│     ├─ CreatorSig                                                │
│     ├─ PayloadDigest                                             │
│     └─ KeyIndex                                                  │
│                                                                  │
│  2. Resolve Creator's DID Document                               │
│     └─ Get signing xpub from verification method                 │
│                                                                  │
│  3. Verify PayloadDigest                                         │
│     └─ Recompute SHA256(canonical_json(payload)) == PayloadDigest│
│                                                                  │
│  4. Verify KeyIndex                                              │
│     └─ uint31(SHA256("oip:" + PayloadDigest)) == KeyIndex        │
│                                                                  │
│  5. Derive verification key from xpub                            │
│     └─ xpub.deriveChild(KeyIndex).publicKey                      │
│                                                                  │
│  6. Verify ECDSA signature                                       │
│     └─ secp256k1.verify(CreatorSig, PayloadHash, derivedPubKey)  │
│                                                                  │
│  7. Result                                                       │
│     ├─ ✅ Valid → Index the record                               │
│     └─ ❌ Invalid → Reject, do not index                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Comparison: Login-less vs Traditional

| Aspect | Traditional (v0.8) | Login-less (v0.9) |
|--------|-------------------|-------------------|
| **Authentication** | JWT token from login | Mnemonic-based signing |
| **Account Required** | Yes | No |
| **Key Storage** | Server-side | Client-side only |
| **Signing Location** | Server | Browser |
| **Fee Payment** | Server | Server |
| **Censorship** | Server can refuse | Server can refuse (but can't forge) |
| **Identity Portability** | Account-bound | Mnemonic-portable |
| **Privacy** | Email/password required | No PII needed |

---

## Use Cases

### 1. Anonymous Whistleblowing
Publish sensitive information without revealing your identity. Generate a fresh mnemonic, publish via TOR, discard the mnemonic.

### 2. Pseudonymous Journalism
Maintain a consistent pseudonymous identity across publications using the same mnemonic, without registering an account.

### 3. Decentralized Content Syndication
Publish once, syndicate everywhere. Your signed content can be verified by any OIP node.

### 4. Censorship-Resistant Publishing
Even if a server refuses your content, you can submit to any other OIP node. The signature proves authorship.

### 5. Cross-Platform Identity
Use the same mnemonic across different OIP publishers. Your DID remains consistent.

---

## Related Documentation

- [OIP v0.9 Implementation Plan](./toBuild/oip-09-js-implementation-plan.md)
- [OIP v0.9 Bootstrap Guide](./OIP_V09_BOOTSTRAP_GUIDE.md)
- [Onion Press Implementation](./toBuild/onion-press-server-implementation-plan.md)
- [W3C DID Core Specification](https://www.w3.org/TR/did-core/)
- [SLIP-0043: Purpose Field](https://github.com/satoshilabs/slips/blob/master/slip-0043.md)
- [BIP-32: HD Wallets](https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki)

---

## Quick Start

```bash
# 1. Access the publisher
open http://localhost:3007/publish

# 2. Generate a test mnemonic (click the button)
# 3. Click "Load Identity" to derive your DID
# 4. Fill in the record form
# 5. Select destinations
# 6. Click "Sign & Publish Record"
# 7. View your record on Arweave explorer
```

Your record is now permanently stored on the blockchain, cryptographically signed by your identity, without ever creating an account! 🎉
