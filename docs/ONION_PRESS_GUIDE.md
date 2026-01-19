# The Onion Press - Complete Guide

## What is Onion Press?

**Onion Press** is a decentralized publishing platform built on the **Open Index Protocol (OIP)**. It provides permanent, censorship-resistant storage of content on the Arweave blockchain, with optional peer-to-peer synchronization via GUN and anonymous submission to the Internet Archive via TOR.

### Key Features

| Feature | Description |
|---------|-------------|
| **Permanent Storage** | Content stored on Arweave is immutable and lasts forever |
| **Decentralized Identity** | DID-based identity using HD wallet key derivation |
| **Login-less Publishing** | Publish without creating an account - just use your mnemonic |
| **TOR Integration** | Anonymous access and publishing via `.onion` hidden service |
| **WordPress Integration** | Familiar authoring via OP Publisher WordPress plugin |
| **Multi-Destination** | Publish to Arweave, GUN, and Internet Archive simultaneously |

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Installation](#installation)
3. [Publishing Modes](#publishing-modes)
4. [Web Interface](#web-interface)
5. [WordPress Integration](#wordpress-integration)
6. [TOR Hidden Service](#tor-hidden-service)
7. [API Reference](#api-reference)
8. [Identity & Cryptography](#identity--cryptography)
9. [Configuration](#configuration)
10. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ONION PRESS STACK                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   AUTHORING OPTIONS                                                          │
│   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐ │
│   │   WordPress     │  │  Web Publisher  │  │      Direct API            │ │
│   │ + OP Publisher  │  │  /publish       │  │   /api/records/publish     │ │
│   │    Plugin       │  │                 │  │                            │ │
│   └────────┬────────┘  └────────┬────────┘  └─────────────┬──────────────┘ │
│            │                    │                          │                │
│            └────────────────────┼──────────────────────────┘                │
│                                 │                                           │
│                                 ▼                                           │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │                    ONION-PRESS-SERVICE (:3007)                       │  │
│   │  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────────┐ │  │
│   │  │   Browsing   │  │   Admin      │  │   Multi-Destination        │ │  │
│   │  │   Interface  │  │   Settings   │  │   Publisher                │ │  │
│   │  └──────────────┘  └──────────────┘  └────────────────────────────┘ │  │
│   │                                              │                        │  │
│   │  ┌────────────────────────────────────────────────────────────────┐ │  │
│   │  │                    INTEGRATED TOR DAEMON                        │ │  │
│   │  │   • Hidden Service: youraddress.onion                          │ │  │
│   │  │   • SOCKS Proxy: 127.0.0.1:9050                                │ │  │
│   │  └────────────────────────────────────────────────────────────────┘ │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                 │                                           │
│                                 ▼                                           │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │                    OIP-DAEMON-SERVICE (:3005)                        │  │
│   │   • Elasticsearch indexing                                           │  │
│   │   • Arweave transaction submission                                   │  │
│   │   • GUN synchronization                                              │  │
│   │   • DID resolution                                                   │  │
│   │   • Signature verification                                           │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                 │                                           │
│                                 ▼                                           │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│   │   Arweave    │  │     GUN      │  │ Elasticsearch│  │   Internet   │  │
│   │  Blockchain  │  │    Network   │  │    Index     │  │   Archive    │  │
│   └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Services

| Service | Port | Description |
|---------|------|-------------|
| `onion-press-service` | 3007 | Browsing UI, admin settings, TOR integration |
| `oip-daemon-service` | 3005 | Core OIP functionality, blockchain interaction |
| `wordpress` | 8080 | WordPress CMS with OP Publisher plugin |
| `wordpress-db` | 3306 | MariaDB database for WordPress |
| `elasticsearch` | 9200 | Search and indexing |

---

## Installation

### Prerequisites

- Docker and Docker Compose
- At least 8GB RAM
- 50GB+ disk space (for Elasticsearch and data)

### Quick Start

```bash
# Clone the repository
git clone https://github.com/oipwg/oip-arweave-indexer.git
cd oip-arweave-indexer

# Copy environment file
cp "example env" .env

# Edit .env to configure your settings
nano .env

# Start Onion Press Server profile
make -f Makefile.split onion-press-server
```

### Profiles

| Profile | Command | Includes |
|---------|---------|----------|
| `onion-press-server` | `make -f Makefile.split onion-press-server` | OIP + WordPress + TOR |
| `alexandria-decentralized` | `make -f Makefile.split alexandria-decentralized` | Full stack + AI services |

### Verify Installation

```bash
# Check service status
make -f Makefile.split status

# View logs
make -f Makefile.split logs-onion-press

# Test health
curl http://localhost:3007/health
```

---

## Publishing Modes

Onion Press supports **two publishing modes**, giving you flexibility in how you authenticate and sign content.

### 🔑 Mnemonic Mode (Login-less Publishing)

**How it works:**
1. You provide a 24-word BIP-39 mnemonic phrase
2. Your identity (DID) is derived from the mnemonic
3. Signing happens entirely in your browser
4. The signed record is sent to the server
5. Server pays the Arweave transaction fee
6. **Your mnemonic never leaves your device**

**Best for:**
- Privacy-conscious authors
- Anonymous or pseudonymous publishing
- Individual creators who want their own identity
- Users who don't trust the server with their keys

**Security:**
```
┌─────────────────────────────────────────────────────────────────────┐
│                        YOUR BROWSER                                  │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │  Mnemonic → HD Keys → Sign Record → Signed Payload          │   │
│   │  (never leaves browser)                                      │   │
│   └─────────────────────────────────────────────────────────────┘   │
│                              │                                       │
│     ⚠️ SECURITY BOUNDARY      │  (mnemonic stays here)               │
│                              ▼                                       │
└─────────────────────────────────────────────────────────────────────┘
                               │
                   Signed payload only
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         SERVER                                       │
│   Receives signed payload → Creates Arweave TX → Pays fee → Submit  │
└─────────────────────────────────────────────────────────────────────┘
```

### 👤 Account Mode (Server-Signed Publishing)

**How it works:**
1. You authenticate with an API token
2. You submit your content to the server
3. Server signs the record with its own identity
4. Server submits to Arweave and pays the fee

**Best for:**
- Publications and organizations
- Teams with shared publishing identity
- Simplified workflow (no mnemonic management)
- Users who trust the server

**Flow:**
```
┌─────────────────────────────────────────────────────────────────────┐
│                        YOUR BROWSER                                  │
│   Content + API Token → POST /api/publish                           │
└─────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         SERVER                                       │
│   Receives content → Signs with server identity → Submit to Arweave │
└─────────────────────────────────────────────────────────────────────┘
```

### Comparison

| Aspect | Mnemonic Mode | Account Mode |
|--------|---------------|--------------|
| **Authentication** | 24-word mnemonic | API token |
| **Identity** | Your own DID | Server's DID |
| **Signing Location** | Browser (client) | Server |
| **Privacy** | Maximum | Moderate |
| **Convenience** | Less (manage mnemonic) | More (just login) |
| **Trust Model** | Trustless | Trust server |

---

## Web Interface

### Main Browsing Interface

Access at: `http://localhost:3007/` or `http://youraddress.onion/`

Features:
- Browse all indexed OIP records
- Filter by record type (post, image, video, etc.)
- Search by title, description, tags
- View publication sources (Arweave ✓, GUN ✓, IA ✓)
- Admin settings panel (if logged in)

### Anonymous Publisher

Access at: `http://localhost:3007/publish`

The anonymous publisher page allows anyone to publish OIP v0.9 records without creating an account:

1. **Generate or enter mnemonic** - Click "Generate Test Mnemonic" or enter your own
2. **Load identity** - Derive your DID from the mnemonic
3. **Fill in content** - Title, description, body text, tags
4. **Select destinations** - Arweave, GUN, Internet Archive
5. **Sign & Publish** - Client-side signing, then submit

### Cryptographic Debugger

Access at: `http://localhost:3007/debug` (or `/debug/v09` on OIP daemon)

For developers - step through the cryptographic process:
1. Identity derivation from mnemonic
2. Payload digest computation
3. Key index derivation
4. Signature generation
5. Signature verification
6. Final transaction format

---

## WordPress Integration

### OP Publisher Plugin

The **OP Publisher** WordPress plugin provides a seamless integration for publishing WordPress content to OIP.

#### Installation

1. The plugin is auto-mounted when running Onion Press:
   ```
   wordpress-plugin/op-publisher → /var/www/html/wp-content/plugins/op-publisher
   ```

2. Activate in WordPress Admin → Plugins → OP Publisher → Activate

3. Configure in Settings → OP Publisher

#### Configuration

| Setting | Description |
|---------|-------------|
| **Onion Press URL** | URL of your onion-press-service (default: `http://onion-press-service:3007`) |
| **OIP Daemon URL** | URL of your oip-daemon-service (default: `http://oip-daemon-service:3005`) |
| **Default Mode** | Mnemonic or Account |
| **API Token** | For Account mode authentication |
| **Mnemonic Storage** | Allow encrypted browser storage of mnemonic |
| **Default Destinations** | Which destinations to enable by default |

#### Publishing from WordPress

1. **Create/edit a post** in WordPress
2. **Open the 🧅 OP Publisher sidebar** (right side of Gutenberg editor)
3. **Choose your mode:**
   - **Mnemonic Mode**: Click "Load Identity" and enter your 24-word phrase
   - **Account Mode**: Ensure API token is configured in settings
4. **Select destinations:** Arweave, GUN, Internet Archive
5. **Click "📤 Publish to OIP"**
6. **View results:** Transaction ID, DID, and destination status

#### Field Mapping

WordPress fields are automatically mapped to OIP templates:

| WordPress Field | OIP Field |
|-----------------|-----------|
| Post Title | `basic.name` |
| Excerpt/Content | `basic.description` |
| Post Date | `basic.date` |
| Categories + Tags | `basic.tagItems` |
| Post Content | `post.articleText` |
| Author Display Name | `post.bylineWriter` |
| Featured Image | `basic.thumbnail` (URL) |

#### Mnemonic Mode in WordPress

When using mnemonic mode:

1. **Enter your mnemonic** in the modal dialog
2. **Identity loads** showing your DID
3. **Optionally save** (encrypted with password) for convenience
4. **Sign & publish** - signing happens in your browser
5. **Server receives** pre-signed payload and submits to Arweave

```
┌─────────────────────────────────────────────────────────────────────┐
│                    WORDPRESS + OP PUBLISHER                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   1. Author writes post in Gutenberg                                │
│   2. Opens 🧅 OP Publisher sidebar                                  │
│   3. Chooses Mnemonic Mode                                          │
│   4. Enters 24-word mnemonic (processed locally)                    │
│   5. Plugin builds OIP record from post fields                      │
│   6. Signs record in browser with derived key                       │
│   7. Sends signed payload to server                                 │
│   8. Server submits to Arweave (pays fee)                           │
│   9. Author sees transaction ID and DID                             │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## TOR Hidden Service

Onion Press includes an integrated TOR daemon that provides:

1. **Incoming access** via a unique `.onion` address
2. **Outgoing anonymity** when publishing to Internet Archive

### Finding Your .onion Address

```bash
# Method 1: Docker logs
docker logs alexandria-onion-press-service-1 | grep -A2 "HIDDEN SERVICE"

# Method 2: Makefile command
make -f Makefile.split status

# Method 3: API endpoint
curl http://localhost:3007/api/tor/status
```

### Accessing via TOR

Anyone using TOR Browser can access your Onion Press at:
```
http://your56characteronionaddresshere.onion/
```

This provides:
- Anonymous browsing of published records
- Censorship-resistant access
- No IP exposure for visitors

### Persisting Your .onion Address

Your `.onion` address is generated from cryptographic keys stored in the `tor-hidden-service` Docker volume. The address persists across container restarts.

**Backup your hidden service keys:**
```bash
docker run --rm \
  -v oip-arweave-indexer_tor-hidden-service:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/tor-backup.tar.gz -C /data .
```

⚠️ **Security Warning:** Anyone with these keys can impersonate your `.onion` address.

### Publishing via TOR to Internet Archive

When `PUBLISH_TO_INTERNETARCHIVE=true`, records are submitted anonymously via TOR:

1. Record is assembled
2. TOR SOCKS proxy routes request through the TOR network
3. Request reaches Internet Archive's `.onion` gateway
4. Your IP is never exposed

---

## API Reference

### Publishing Endpoints

#### POST /api/publish (Account Mode)

Submit a record for multi-destination publishing (server signs).

**Request:**
```json
{
  "record": {
    "basic": {
      "name": "My Article",
      "description": "Article summary",
      "date": 1705689600,
      "tagItems": ["news", "technology"]
    },
    "post": {
      "articleText": "Full article content...",
      "bylineWriter": "John Doe"
    }
  },
  "destinations": {
    "arweave": true,
    "gun": true,
    "internetArchive": false
  }
}
```

**Response:**
```json
{
  "submissionId": "sub_abc123",
  "status": "processing",
  "results": {
    "arweave": { "status": "pending" },
    "gun": { "status": "pending" },
    "internetArchive": { "status": "skipped" }
  }
}
```

#### POST /api/records/publishSigned (Mnemonic Mode)

Submit a pre-signed OIP v0.9 payload.

**Request:**
```json
{
  "payload": {
    "@context": "did:arweave:abc123...",
    "tags": [
      { "name": "Index-Method", "value": "OIP" },
      { "name": "Ver", "value": "0.9.0" },
      { "name": "Creator", "value": "did:arweave:abc123..." },
      { "name": "PayloadDigest", "value": "..." },
      { "name": "KeyIndex", "value": "12345678" },
      { "name": "CreatorSig", "value": "..." }
    ],
    "fragments": [...]
  },
  "verifySignature": true,
  "destinations": {
    "arweave": true
  }
}
```

**Response:**
```json
{
  "success": true,
  "transactionId": "arweave-tx-id-here",
  "did": "did:arweave:tx-id",
  "creator": "did:arweave:abc123...",
  "version": "0.9.0"
}
```

### Status Endpoints

#### GET /api/publish/:id/status

Check submission status.

#### GET /api/publish/destinations

Get available destinations and their status.

### TOR Endpoints

#### GET /api/tor/status

```json
{
  "connected": true,
  "onionAddress": "abc123...xyz.onion",
  "socksHost": "127.0.0.1",
  "socksPort": 9050
}
```

#### GET /api/tor/test

Test TOR connectivity.

### Admin Endpoints

#### GET /api/admin/settings

Get current admin settings (requires authentication).

#### POST /api/admin/settings

Update admin settings (requires authentication).

---

## Identity & Cryptography

### OIP v0.9 Identity

Onion Press uses **OIP v0.9** for identity and signing, which is based on:

- **BIP-39**: 24-word mnemonic phrases
- **BIP-32/SLIP-0043**: HD key derivation
- **secp256k1**: Elliptic curve cryptography
- **W3C DID**: Decentralized identifier standard

### DID Generation

```
Mnemonic (24 words)
        │
        ▼
    Master Seed (PBKDF2)
        │
        ▼
    Master Key (secp256k1)
        │
        ▼
    SHA256(masterPubKey)
        │
        ▼
    Base64URL encode
        │
        ▼
    did:arweave:{hash}
```

### Key Derivation Path

```
m / 176800' / sub-purpose' / account' / index

Where:
  176800     = OIP custom purpose (SLIP-0043)
  sub-purpose = 0 (identity.sign)
  account    = User's account index (usually 0)
  index      = Derived from payload digest (uint31)
```

### Signing Process

1. **Build payload** without signature tags
2. **Canonical JSON** serialization (sorted keys, no whitespace)
3. **SHA-256 hash** of canonical JSON = payload digest
4. **Derive key index**: `uint31(SHA256("oip:" + payloadDigest))`
5. **Derive child key** from signing base key
6. **ECDSA sign** the payload hash
7. **Add tags**: PayloadDigest, KeyIndex, CreatorSig

### Verification

At indexing time, each v0.9 record is verified:

1. Extract signature data from tags
2. Resolve creator's DID document
3. Get signing xpub from verification method
4. Recompute payload digest
5. Verify key index derivation
6. Derive verification key from xpub
7. Verify ECDSA signature
8. **Valid → index**, **Invalid → reject**

---

## Configuration

### Environment Variables

Add to your `.env` file:

```bash
# ═══════════════════════════════════════════════════════════════════════════
# ONION PRESS CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════

# Service Ports
ONION_PRESS_PORT=3007
OIP_DAEMON_PORT=3005
WORDPRESS_PORT=8080

# Publishing Destinations
PUBLISH_TO_ARWEAVE=true
PUBLISH_TO_GUN=true
PUBLISH_TO_INTERNETARCHIVE=false

# WordPress Database
WORDPRESS_DB_USER=wordpress
WORDPRESS_DB_PASSWORD=your-secure-password
WORDPRESS_DB_NAME=wordpress

# Internet Archive Organization (for TOR publishing)
IA_ORGANIZATION_HANDLE=internetarchive

# Public API URL (for DID document context)
PUBLIC_API_BASE_URL=https://your-domain.com
```

### Service URLs

When running inside Docker, services communicate via container names:

| From | To | URL |
|------|-----|-----|
| WordPress Plugin | Onion Press | `http://onion-press-service:3007` |
| WordPress Plugin | OIP Daemon | `http://oip-daemon-service:3005` |
| Onion Press | OIP Daemon | `http://oip-daemon-service:3005` |
| External | Onion Press | `http://localhost:3007` or `https://your-domain.com` |

---

## Troubleshooting

### Common Issues

#### "Connection refused" to Onion Press

```bash
# Check if service is running
docker ps | grep onion-press

# Check logs
docker logs alexandria-onion-press-service-1

# Restart service
docker compose -f docker-compose-split.yml restart onion-press-service
```

#### TOR not connecting

```bash
# Check TOR bootstrap status
docker logs alexandria-onion-press-service-1 2>&1 | grep -i tor

# TOR needs 30-60 seconds to bootstrap on first start
# Wait and check again

# Check .onion address file
docker compose -f docker-compose-split.yml exec onion-press-service \
  cat /var/lib/tor/hidden_service/hostname
```

#### WordPress can't connect to Onion Press

1. Check the Onion Press URL in plugin settings
2. Inside Docker, use `http://onion-press-service:3007` (not localhost)
3. Test connection using the "Test Connection" button

#### Mnemonic not working

1. Ensure exactly 12, 15, 18, 21, or 24 words
2. Words should be lowercase, separated by spaces
3. Check browser console for JavaScript errors
4. Ensure `oip-crypto-bundle.js` is loading

#### Publishing fails with "signature verification failed"

1. Ensure you're using the correct mnemonic
2. Check that the payload format is correct
3. Verify the OIP daemon can resolve your DID
4. Check daemon logs for detailed error messages

### Logs

```bash
# All logs
make -f Makefile.split logs

# Specific service
docker logs -f alexandria-onion-press-service-1
docker logs -f alexandria-oip-daemon-service-1
docker logs -f alexandria-wordpress-1

# TOR-specific logs
docker logs alexandria-onion-press-service-1 2>&1 | grep -E "(TOR|tor|onion)"
```

### Health Checks

```bash
# Onion Press
curl http://localhost:3007/health

# OIP Daemon
curl http://localhost:3005/health

# TOR status
curl http://localhost:3007/api/tor/status

# WordPress
curl http://localhost:8080/wp-json/
```

---

## Security Considerations

### Mnemonic Safety

1. **Never share** your mnemonic phrase
2. **Never enter** your mnemonic on untrusted sites
3. **Use HTTPS** or TOR for transport encryption
4. **Consider using** a dedicated mnemonic for publishing (not your main wallet)
5. **Browser storage** is convenient but less secure than hardware wallets

### Server Trust

In **Account Mode**, you trust the server to:
- Sign records honestly
- Not modify your content
- Protect your API token

In **Mnemonic Mode**, you only trust the server to:
- Submit your pre-signed transaction
- Pay the Arweave fee

The server **cannot**:
- Sign as you without your mnemonic
- Modify your signed content
- Access your private keys

### TOR Security

TOR protects:
- Your IP from visitors accessing your `.onion`
- Your IP when publishing to Internet Archive
- Content from network observers (encrypted)

TOR does **not** protect:
- Content of your records (they're public)
- Metadata timing attacks (advanced adversaries)
- Application-level identity leaks

---

## Related Documentation

- [OIP v0.9 Login-less Publishing](./OIP_V09_LOGINLESS_PUBLISHING.md)
- [OIP v0.9 Implementation Plan](./toBuild/oip-09-js-implementation-plan.md)
- [OIP v0.9 Bootstrap Guide](./OIP_V09_BOOTSTRAP_GUIDE.md)
- [TOR Hidden Service Guide](./TOR_HIDDEN_SERVICE_GUIDE.md)
- [Onion Press Implementation Plan](./toBuild/onion-press-server-implementation-plan.md)

---

## Quick Reference

### Commands

```bash
# Start Onion Press
make -f Makefile.split onion-press-server

# View status
make -f Makefile.split status

# View logs
make -f Makefile.split logs-onion-press

# Restart
docker compose -f docker-compose-split.yml restart onion-press-service

# Get .onion address
curl http://localhost:3007/api/tor/status | jq .onionAddress
```

### URLs

| URL | Description |
|-----|-------------|
| `http://localhost:3007/` | Onion Press browsing interface |
| `http://localhost:3007/publish` | Anonymous publisher |
| `http://localhost:3007/debug` | Cryptographic debugger |
| `http://localhost:8080/` | WordPress admin |
| `http://localhost:3005/` | OIP Daemon (API only) |

### API Quick Reference

| Method | Endpoint | Mode | Description |
|--------|----------|------|-------------|
| POST | `/api/publish` | Account | Server-signed publishing |
| POST | `/api/records/publishSigned` | Mnemonic | Pre-signed publishing |
| GET | `/api/publish/:id/status` | Both | Check submission status |
| GET | `/api/tor/status` | - | TOR daemon status |
| GET | `/api/admin/settings` | - | Admin settings |

---

**Document Version:** 2.0.0  
**Last Updated:** January 2026  
**Author:** OIP Team
