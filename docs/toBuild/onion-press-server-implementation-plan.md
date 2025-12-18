# Onion Press Server Implementation Plan

## Executive Summary

**Onion Press Server** is a new OIP profile that provides anonymous publishing capabilities using WordPress as the authoring interface, TOR for anonymity, and OIP for persistent decentralized storage. It sits between the `oip-only` and `alexandria` profiles in the stack hierarchy.

**Profile Hierarchy:**
```
oip-only < onion-press-server < alexandria
```

**Core Components:**
- WordPress container with LO Publisher plugin for authoring
- TOR daemon for onion service (each instance gets its own .onion address)
- Enhanced browsing interface with admin settings
- Multi-destination publishing (Arweave, GUN, Internet Archive)

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Profile Definition](#profile-definition)
3. [Service Components](#service-components)
4. [LO Publisher WordPress Plugin](#lo-publisher-wordpress-plugin)
5. [Publishing Flow](#publishing-flow)
6. [Browsing Interface](#browsing-interface)
7. [Admin Interface](#admin-interface)
8. [TOR Integration](#tor-integration)
9. [Internet Archive Publishing](#internet-archive-publishing)
10. [Environment Variables](#environment-variables)
11. [Docker Configuration](#docker-configuration)
12. [Implementation Phases](#implementation-phases)
13. [File Structure](#file-structure)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ONION PRESS SERVER STACK                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    AUTHORING LAYER (New)                              │   │
│  │                                                                        │   │
│  │  ┌────────────────┐       ┌─────────────────┐                         │   │
│  │  │   WordPress    │       │  LO Publisher   │                         │   │
│  │  │   Container    │◄─────►│    Plugin       │                         │   │
│  │  │   (port 8080)  │       │                 │                         │   │
│  │  └────────────────┘       └────────┬────────┘                         │   │
│  │                                    │                                   │   │
│  │                           Field Mapping UI                            │   │
│  │                           Template Selection                          │   │
│  │                           Record Assembly                             │   │
│  └────────────────────────────────────┼──────────────────────────────────┘   │
│                                       │                                      │
│                                       ▼                                      │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                  ONION-PRESS-SERVICE (New - port 3007)                │   │
│  │                                                                        │   │
│  │  ┌────────────────┐  ┌─────────────────┐  ┌─────────────────────┐    │   │
│  │  │   Publishing   │  │    Browsing     │  │   Admin Settings    │    │   │
│  │  │   Router       │  │    Interface    │  │   Interface         │    │   │
│  │  └───────┬────────┘  └─────────────────┘  └─────────────────────┘    │   │
│  │          │                                                            │   │
│  │          ▼                                                            │   │
│  │  ┌────────────────────────────────────────────────────────────────┐  │   │
│  │  │              MULTI-DESTINATION PUBLISHER                        │  │   │
│  │  │                                                                  │  │   │
│  │  │   ┌──────────┐    ┌──────────┐    ┌──────────────────────┐    │  │   │
│  │  │   │ Arweave  │    │   GUN    │    │  Internet Archive    │    │  │   │
│  │  │   │ (via OIP)│    │ (via OIP)│    │  (via TOR → IA OIP)  │    │  │   │
│  │  │   └──────────┘    └──────────┘    └──────────────────────┘    │  │   │
│  │  └────────────────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                       │                                      │
│                                       ▼                                      │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                         TOR DAEMON (New)                              │   │
│  │                                                                        │   │
│  │  ┌────────────────────────┐    ┌─────────────────────────────────┐   │   │
│  │  │   Onion Service        │    │   Outbound TOR Client           │   │   │
│  │  │   (receive anonymous   │    │   (publish to IA .onion)        │   │   │
│  │  │    submissions)        │    │                                  │   │   │
│  │  └────────────────────────┘    └─────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                       │                                      │
│                                       ▼                                      │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    OIP-DAEMON-SERVICE (Existing)                      │   │
│  │                         (port 3005)                                   │   │
│  │                                                                        │   │
│  │    Elasticsearch │ GUN Sync │ Arweave │ Media │ Templates │ Auth     │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Profile Definition

### Profile Hierarchy

| Profile | Includes | Use Case |
|---------|----------|----------|
| `oip-only` | Core OIP infrastructure | Pure indexing, no publishing UI |
| `onion-press-server` | `oip-only` + WordPress + TOR + Publishing/Browsing UI | Anonymous publishing platform |
| `alexandria` | `onion-press-server` + AI/Voice/Content Generation | Full-featured AI assistant |

### Profile Service Matrix

```
                          oip-    onion-press-  alexandria
Service                   only    server        
───────────────────────────────────────────────────────────
elasticsearch              ✓         ✓              ✓
kibana                     ✓         ✓              ✓
oip-daemon-service         ✓         ✓              ✓
gun-relay                  ✓         ✓              ✓
ipfs                       ✓         ✓              ✓
ngrok                      ✓         ✓              ✓
onion-press-service        ✗         ✓              ✓
wordpress                  ✗         ✓              ✓
tor-daemon                 ✗         ✓              ✓
alexandria-service         ✗         ✗              ✓
ollama                     ✗         ✗              ✓
tts-service                ✗         ✗              ✓
stt-service                ✗         ✗              ✓
```

---

## Service Components

### 1. onion-press-service (New)

**Purpose:** Third service in the OIP architecture that provides:
- Publishing interface that receives records from WordPress
- Enhanced browsing interface for viewing records
- Admin settings interface for configuration
- Multi-destination publishing logic (Arweave, GUN, Internet Archive)
- TOR-based publishing to Internet Archive

**Port:** 3007

**Entry Point:** `index-onion-press.js`

**Dependencies:**
- oip-daemon-service (for all data operations)
- tor-daemon (for .onion publishing)
- wordpress (for authoring interface)

### 2. WordPress Container

**Purpose:** Familiar authoring interface with LO Publisher plugin

**Image:** `wordpress:latest` or custom image with plugin pre-installed

**Port:** 8080 (internal), exposed via reverse proxy

**Components:**
- WordPress core
- LO Publisher plugin
- MariaDB/MySQL database

### 3. TOR Daemon Container

**Purpose:** Provides both onion service (inbound) and TOR client (outbound)

**Image:** Custom or `dperson/torproxy` variant

**Capabilities:**
- Onion service for this instance (generates .onion address)
- SOCKS5 proxy for outbound TOR connections
- Automatic .onion address generation on first run

---

## LO Publisher WordPress Plugin

### What is LO Publisher?

**LO Publisher** (Library of Obscura Publisher / Lapis Obscura Publisher) is a WordPress plugin that transforms WordPress into an OIP publishing client. It allows authors to:

1. **Write content** using the familiar WordPress Gutenberg editor
2. **Map WordPress fields** to OIP template fields
3. **Select record types** (post, image, video, etc.)
4. **Preview OIP records** before publishing
5. **Publish to multiple destinations** (Arweave, GUN, Internet Archive)
6. **Track submission status** and receive DIDs

### Plugin Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     LO PUBLISHER PLUGIN                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐     ┌──────────────────────────────────┐  │
│  │  Gutenberg      │     │      Field Mapping Engine         │  │
│  │  Sidebar Panel  │────►│                                    │  │
│  │                 │     │  WordPress Field → OIP Template    │  │
│  │  - Template     │     │                                    │  │
│  │    selector     │     │  title        → basic.name         │  │
│  │  - Field mapper │     │  content      → post.articleText   │  │
│  │  - Publish btn  │     │  excerpt      → basic.description  │  │
│  │  - Status view  │     │  featured_img → image reference    │  │
│  └─────────────────┘     │  categories   → basic.tagItems     │  │
│                          │  author       → bylineWriter       │  │
│                          └──────────────────────────────────────┘  │
│                                         │                         │
│                                         ▼                         │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │                   RECORD ASSEMBLER                            ││
│  │                                                                ││
│  │  1. Extract mapped fields from WordPress post                 ││
│  │  2. Validate against OIP template schema                      ││
│  │  3. Handle media attachments (generate references)            ││
│  │  4. Assemble OIP-formatted record JSON                        ││
│  │  5. Preview before submission                                 ││
│  └──────────────────────────────────────────────────────────────┘│
│                                         │                         │
│                                         ▼                         │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │                   OIP SUBMISSION CLIENT                       ││
│  │                                                                ││
│  │  POST to onion-press-service:3007/api/publish                 ││
│  │                                                                ││
│  │  Request: { record: {...}, destinations: [...] }              ││
│  │  Response: { submissionId, status, dids: {...} }              ││
│  └──────────────────────────────────────────────────────────────┘│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Supported Templates

| Template | WordPress Post Type | Key Fields |
|----------|---------------------|------------|
| `basic` + `post` | Post | title, content, excerpt, tags, author |
| `basic` + `image` | Attachment (image) | title, description, image file |
| `basic` + `video` | Attachment (video) | title, description, video file |
| `basic` + `recipe` | Custom Post Type | title, ingredients, instructions |
| `basic` + `exercise` | Custom Post Type | title, description, muscle groups |

### Field Mapping UI

The plugin provides a visual field mapping interface:

```
┌─────────────────────────────────────────────────────────────┐
│  📝 LO Publisher - Field Mapping                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Template: [post ▼]                                          │
│                                                              │
│  ┌─────────────────────┬─────────────────────────────────┐  │
│  │ WordPress Field     │ OIP Template Field               │  │
│  ├─────────────────────┼─────────────────────────────────┤  │
│  │ Post Title          │ basic.name                ✓     │  │
│  │ Post Content        │ post.articleText          ✓     │  │
│  │ Excerpt             │ basic.description         ✓     │  │
│  │ Categories/Tags     │ basic.tagItems            ✓     │  │
│  │ Featured Image      │ [image dref]              ✓     │  │
│  │ Author Display Name │ post.bylineWriter         ✓     │  │
│  │ Custom Field: _date │ basic.date                ✓     │  │
│  └─────────────────────┴─────────────────────────────────┘  │
│                                                              │
│  [Save Mapping] [Reset to Default]                          │
└─────────────────────────────────────────────────────────────┘
```

### Plugin Settings Page

```
┌─────────────────────────────────────────────────────────────┐
│  ⚙️ LO Publisher Settings                                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Onion Press Server URL: [http://onion-press:3007    ]      │
│                                                              │
│  Default Publishing Destinations:                            │
│  ☑ Arweave (permanent storage)                              │
│  ☑ GUN (real-time sync)                                     │
│  ☐ Internet Archive (via TOR)                               │
│                                                              │
│  Authentication:                                             │
│  API Token: [••••••••••••••••] [Regenerate]                 │
│                                                              │
│  [Save Settings]                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Publishing Flow

### End-to-End Publishing Process

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
│  WordPress   │     │ LO Publisher │     │ onion-press-     │
│  Gutenberg   │────►│   Plugin     │────►│ service          │
│  Editor      │     │              │     │                  │
└──────────────┘     └──────────────┘     └────────┬─────────┘
                                                    │
                     ┌──────────────────────────────┼──────────────────────────────┐
                     │                              │                               │
                     ▼                              ▼                               ▼
              ┌──────────────┐              ┌──────────────┐              ┌──────────────┐
              │   Arweave    │              │     GUN      │              │ Internet     │
              │   (via OIP   │              │   (via OIP   │              │ Archive      │
              │   daemon)    │              │   daemon)    │              │ (via TOR)    │
              └──────────────┘              └──────────────┘              └──────────────┘
```

### Multi-Destination Publishing Logic

```javascript
// onion-press-service publishing logic
async function publishRecord(record, destinations, userToken) {
    const results = {};
    const oipClient = new OIPClient(userToken);
    
    // 1. Publish to Arweave (if enabled)
    if (destinations.arweave && process.env.PUBLISH_TO_ARWEAVE === 'true') {
        results.arweave = await oipClient.publishRecord(record, {
            storage: 'arweave'
        });
    }
    
    // 2. Publish to GUN (if enabled)
    if (destinations.gun && process.env.PUBLISH_TO_GUN === 'true') {
        results.gun = await oipClient.publishRecord(record, {
            storage: 'gun'
        });
    }
    
    // 3. Publish to Internet Archive via TOR (if enabled)
    if (destinations.internetArchive && process.env.PUBLISH_TO_INTERNETARCHIVE === 'true') {
        results.internetArchive = await publishToInternetArchiveViaTor(record);
    }
    
    return results;
}
```

---

## Browsing Interface

### Enhanced Reference Client

The browsing interface is an **enhanced version of the existing `public/reference-client.html`** with additional features for Onion Press Server.

### New Features

| Feature | Description |
|---------|-------------|
| **Template Filtering** | Filter by post, image, video templates |
| **Publishing Status** | Show which destinations a record was published to |
| **TOR Status Badge** | Indicate records published via TOR |
| **Admin Tab** | Settings interface (admin-only) |
| **Multi-Gateway View** | Show records from multiple sources |

### Interface Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│  🧅 Onion Press                                    [🔍 Search] [👤 Admin] │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  Filters:  [All Types ▼] [All Sources ▼] [Date Range ▼] [Tags...] │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                                                                     │ │
│  │  📰 Article Title Here                                              │ │
│  │  ─────────────────────────────────────────────────────────────────  │ │
│  │  Article excerpt or description appears here...                     │ │
│  │                                                                     │ │
│  │  🏷️ tag1, tag2, tag3                                                │ │
│  │  📅 Dec 18, 2025  │  ✍️ Anonymous  │  🔗 Arweave ✓  GUN ✓  IA ✓    │ │
│  │                                                                     │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                                                                     │ │
│  │  🖼️ Image Record Title                                              │ │
│  │  ─────────────────────────────────────────────────────────────────  │ │
│  │  [Thumbnail Preview]                                                │ │
│  │                                                                     │ │
│  │  🏷️ photography, nature                                             │ │
│  │  📅 Dec 17, 2025  │  ✍️ Creator  │  🔗 Arweave ✓  GUN ✗  IA ✗      │ │
│  │                                                                     │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  [Load More...]                                                          │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Admin Interface

### Access Control

- **Visibility:** Admin tab only visible to logged-in admin accounts
- **Authentication:** Uses existing OIP JWT authentication
- **Authorization:** Checks admin role from user record

### Admin Settings Panel

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ⚙️ Admin Settings                                         [Logout 👤]  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  📤 PUBLISHING DESTINATIONS                                       │   │
│  │  ────────────────────────────────────────────────────────────────  │   │
│  │                                                                    │   │
│  │  ☑ Publish to Arweave                                             │   │
│  │    Permanent blockchain storage                                    │   │
│  │                                                                    │   │
│  │  ☑ Publish to GUN                                                 │   │
│  │    Real-time peer synchronization                                  │   │
│  │                                                                    │   │
│  │  ☐ Publish to Internet Archive (via TOR)                          │   │
│  │    Anonymous submission to IA gateway                              │   │
│  │    IA Gateway: [Loading .onion address...]                         │   │
│  │                                                                    │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  🔄 GUN SYNCHRONIZATION SETTINGS                                  │   │
│  │  ────────────────────────────────────────────────────────────────  │   │
│  │                                                                    │   │
│  │  External Peers (comma-separated):                                 │   │
│  │  ┌────────────────────────────────────────────────────────────┐   │   │
│  │  │ https://gun-relay.example.com/gun, http://peer2:8765/gun   │   │   │
│  │  └────────────────────────────────────────────────────────────┘   │   │
│  │                                                                    │   │
│  │  Sync Interval (ms): [30000        ]                              │   │
│  │                                                                    │   │
│  │  Trusted Nodes (comma-separated public keys):                      │   │
│  │  ┌────────────────────────────────────────────────────────────┐   │   │
│  │  │ pubkey1..., pubkey2...                                      │   │   │
│  │  └────────────────────────────────────────────────────────────┘   │   │
│  │                                                                    │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  🧅 TOR STATUS                                                    │   │
│  │  ────────────────────────────────────────────────────────────────  │   │
│  │                                                                    │   │
│  │  Status: 🟢 Connected                                              │   │
│  │  Your .onion address: abcd1234efgh5678.onion                      │   │
│  │  [Copy Address] [View QR Code]                                     │   │
│  │                                                                    │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  [💾 Save Settings] [↺ Reset to Defaults]                               │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Settings Persistence

Settings are stored in a local configuration file and apply to the Docker container via environment variable updates or a settings API:

```javascript
// POST /api/admin/settings
{
    "publishToArweave": true,
    "publishToGun": true,
    "publishToInternetArchive": false,
    "gunExternalPeers": "https://peer1.example.com/gun,https://peer2.example.com/gun",
    "gunSyncInterval": 30000,
    "gunSyncTrustedNodes": "pubkey1,pubkey2"
}
```

---

## TOR Integration

### TOR Daemon Configuration

Each Onion Press Server instance runs a TOR daemon that provides:

1. **Onion Service (Inbound):** Generates a unique `.onion` address for receiving anonymous submissions
2. **SOCKS5 Proxy (Outbound):** For publishing to Internet Archive's .onion gateway

### Docker Container

```dockerfile
# Dockerfile.tor-daemon
FROM alpine:latest

RUN apk add --no-cache tor

# Copy torrc configuration
COPY torrc /etc/tor/torrc

# Create directories for hidden service
RUN mkdir -p /var/lib/tor/hidden_service && \
    chown -R tor:tor /var/lib/tor

USER tor

EXPOSE 9050 9051

CMD ["tor", "-f", "/etc/tor/torrc"]
```

### TOR Configuration (torrc)

```
# /etc/tor/torrc

# SOCKS proxy for outbound connections
SocksPort 0.0.0.0:9050

# Control port for status queries
ControlPort 9051

# Hidden service for this instance
HiddenServiceDir /var/lib/tor/hidden_service/
HiddenServicePort 80 onion-press-service:3007

# Data directory
DataDirectory /var/lib/tor
```

### .onion Address Generation

On first startup, TOR generates a unique `.onion` address stored in `/var/lib/tor/hidden_service/hostname`. The onion-press-service reads this address and exposes it via API:

```javascript
// GET /api/tor/status
{
    "connected": true,
    "onionAddress": "abcd1234efgh5678ijkl9012mnop3456.onion",
    "socksPort": 9050
}
```

---

## Internet Archive Publishing

### Overview

When `PUBLISH_TO_INTERNETARCHIVE=true`, records are also pushed to the Internet Archive's OIP gateway via TOR. The IA gateway's `.onion` address is stored in their organization record.

### Organization Template Field

**New field in organization template:** `gateway_onion_address`

This field stores the `.onion` address of an organization's OIP gateway, enabling TOR-based publishing.

```json
{
    "organization": {
        "org_handle": "internetarchive",
        "org_public_key": "...",
        "gateway_onion_address": "ia1234567890abcdef.onion",
        "membership_policy": "Open Join"
    }
}
```

### Publishing Flow to Internet Archive

```javascript
async function publishToInternetArchiveViaTor(record) {
    // 1. Look up Internet Archive organization record
    const iaOrg = await oipClient.getRecords({
        recordType: 'organization',
        search: 'internetarchive'
    });
    
    if (!iaOrg.records?.length) {
        throw new Error('Internet Archive organization not found');
    }
    
    const iaOnionAddress = iaOrg.records[0].data.gatewayOnionAddress;
    
    if (!iaOnionAddress) {
        throw new Error('Internet Archive gateway_onion_address not configured');
    }
    
    // 2. Create TOR-proxied HTTP client
    const torClient = createTorProxiedClient();
    
    // 3. Submit record via TOR to IA's .onion gateway
    const response = await torClient.post(
        `http://${iaOnionAddress}/api/records/newRecord`,
        record,
        {
            proxy: {
                host: 'tor-daemon',
                port: 9050,
                protocol: 'socks5'
            }
        }
    );
    
    return {
        success: true,
        did: response.data.did,
        gateway: 'internet-archive',
        via: 'tor'
    };
}
```

### TOR Client Helper

```javascript
// helpers/torClient.js
const SocksProxyAgent = require('socks-proxy-agent');
const axios = require('axios');

function createTorProxiedClient() {
    const proxyUrl = `socks5h://${process.env.TOR_PROXY_HOST || 'tor-daemon'}:${process.env.TOR_PROXY_PORT || 9050}`;
    const agent = new SocksProxyAgent(proxyUrl);
    
    return axios.create({
        httpAgent: agent,
        httpsAgent: agent,
        timeout: 60000 // TOR is slower, allow more time
    });
}

module.exports = { createTorProxiedClient };
```

---

## Environment Variables

### New Variables for onion-press-service

```bash
# ═══════════════════════════════════════════════════════════════════════════
# ONION PRESS SERVER CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════

# Publishing Destinations (booleans)
PUBLISH_TO_ARWEAVE=true
PUBLISH_TO_GUN=true
PUBLISH_TO_INTERNETARCHIVE=false

# GUN Sync Settings
GUN_EXTERNAL_PEERS=https://gun-relay1.example.com/gun,https://gun-relay2.example.com/gun
GUN_SYNC_INTERVAL=30000
GUN_SYNC_TRUSTED_NODES=pubkey1,pubkey2

# TOR Configuration
TOR_PROXY_HOST=tor-daemon
TOR_PROXY_PORT=9050
TOR_CONTROL_PORT=9051

# WordPress Connection
WORDPRESS_URL=http://wordpress:80
WORDPRESS_API_TOKEN=

# Internet Archive Organization Handle (for gateway lookup)
IA_ORGANIZATION_HANDLE=internetarchive

# Service URLs
OIP_DAEMON_URL=http://oip-daemon-service:3005
ONION_PRESS_PORT=3007
```

### Updated example.env

Add section for Onion Press Server:

```bash
# ═══════════════════════════════════════════════════════════════════════════
# ONION PRESS SERVER (onion-press-server profile)
# ═══════════════════════════════════════════════════════════════════════════

# Publishing destinations - control where records are published
PUBLISH_TO_ARWEAVE=true          # Publish to permanent Arweave storage
PUBLISH_TO_GUN=true              # Publish to GUN for real-time sync
PUBLISH_TO_INTERNETARCHIVE=false # Publish to IA via TOR (requires IA gateway)

# WordPress Configuration
WORDPRESS_PORT=8080              # WordPress web interface port
WORDPRESS_DB_HOST=wordpress-db   # Database host
WORDPRESS_DB_USER=wordpress      # Database user
WORDPRESS_DB_PASSWORD=wordpress  # Database password
WORDPRESS_DB_NAME=wordpress      # Database name

# TOR Configuration
TOR_SOCKS_PORT=9050              # SOCKS5 proxy port
TOR_CONTROL_PORT=9051            # Control port for status
```

---

## Docker Configuration

### docker-compose-split.yml Additions

```yaml
services:
  # ════════════════════════════════════════════════════════════════
  # ONION PRESS SERVER SERVICES
  # ════════════════════════════════════════════════════════════════
  
  onion-press-service:
    build:
      context: .
      dockerfile: Dockerfile.onion-press
    ports:
      - "${ONION_PRESS_PORT:-3007}:3007"
    environment:
      - OIP_DAEMON_URL=http://oip-daemon-service:3005
      - PUBLISH_TO_ARWEAVE=${PUBLISH_TO_ARWEAVE:-true}
      - PUBLISH_TO_GUN=${PUBLISH_TO_GUN:-true}
      - PUBLISH_TO_INTERNETARCHIVE=${PUBLISH_TO_INTERNETARCHIVE:-false}
      - GUN_EXTERNAL_PEERS=${GUN_EXTERNAL_PEERS:-}
      - GUN_SYNC_INTERVAL=${GUN_SYNC_INTERVAL:-30000}
      - GUN_SYNC_TRUSTED_NODES=${GUN_SYNC_TRUSTED_NODES:-}
      - TOR_PROXY_HOST=tor-daemon
      - TOR_PROXY_PORT=9050
      - JWT_SECRET=${JWT_SECRET}
    depends_on:
      - oip-daemon-service
      - tor-daemon
    volumes:
      - ./data/onion-press:/usr/src/app/data
      - ./public/onion-press:/usr/src/app/public
    networks:
      - oip-network
    profiles:
      - onion-press-server
      - alexandria
      - alexandria-gpu
      - alexandria-macMseries
      - alexandria-decentralized
      - alexandria-decentralized-gpu
      - alexandria-decentralized-macMseries

  wordpress:
    image: wordpress:latest
    ports:
      - "${WORDPRESS_PORT:-8080}:80"
    environment:
      - WORDPRESS_DB_HOST=wordpress-db
      - WORDPRESS_DB_USER=${WORDPRESS_DB_USER:-wordpress}
      - WORDPRESS_DB_PASSWORD=${WORDPRESS_DB_PASSWORD:-wordpress}
      - WORDPRESS_DB_NAME=${WORDPRESS_DB_NAME:-wordpress}
    depends_on:
      - wordpress-db
    volumes:
      - wordpress-data:/var/www/html
      - ./wordpress-plugin:/var/www/html/wp-content/plugins/lo-publisher
    networks:
      - oip-network
    profiles:
      - onion-press-server
      - alexandria
      - alexandria-gpu
      - alexandria-macMseries
      - alexandria-decentralized
      - alexandria-decentralized-gpu
      - alexandria-decentralized-macMseries

  wordpress-db:
    image: mariadb:latest
    environment:
      - MYSQL_ROOT_PASSWORD=${WORDPRESS_DB_ROOT_PASSWORD:-rootpassword}
      - MYSQL_DATABASE=${WORDPRESS_DB_NAME:-wordpress}
      - MYSQL_USER=${WORDPRESS_DB_USER:-wordpress}
      - MYSQL_PASSWORD=${WORDPRESS_DB_PASSWORD:-wordpress}
    volumes:
      - wordpress-db-data:/var/lib/mysql
    networks:
      - oip-network
    profiles:
      - onion-press-server
      - alexandria
      - alexandria-gpu
      - alexandria-macMseries
      - alexandria-decentralized
      - alexandria-decentralized-gpu
      - alexandria-decentralized-macMseries

  tor-daemon:
    build:
      context: ./tor-daemon
      dockerfile: Dockerfile
    volumes:
      - tor-hidden-service:/var/lib/tor/hidden_service
    ports:
      - "${TOR_SOCKS_PORT:-9050}:9050"
    networks:
      - oip-network
    profiles:
      - onion-press-server
      - alexandria
      - alexandria-gpu
      - alexandria-macMseries
      - alexandria-decentralized
      - alexandria-decentralized-gpu
      - alexandria-decentralized-macMseries

volumes:
  wordpress-data:
  wordpress-db-data:
  tor-hidden-service:
```

### Makefile.split Additions

```makefile
# ════════════════════════════════════════════════════════════════
# ONION PRESS SERVER PROFILE
# ════════════════════════════════════════════════════════════════

onion-press-server:            ## Deploy: OIP + WordPress + TOR anonymous publishing
	@make up PROFILE=onion-press-server
	@echo "🧅 Onion Press Server starting..."
	@echo "   WordPress: http://localhost:${WORDPRESS_PORT:-8080}"
	@echo "   Browsing:  http://localhost:${ONION_PRESS_PORT:-3007}"
	@echo "   OIP API:   http://localhost:${OIP_DAEMON_PORT:-3005}"

# ════════════════════════════════════════════════════════════════
# ONION PRESS SERVICE-SPECIFIC OPERATIONS
# ════════════════════════════════════════════════════════════════

logs-onion-press:              ## Show onion-press-service logs
	docker-compose logs -f onion-press-service

logs-wordpress:                ## Show WordPress logs
	docker-compose logs -f wordpress

logs-tor:                      ## Show TOR daemon logs
	docker-compose logs -f tor-daemon

restart-onion-press:           ## Restart onion-press-service
	docker-compose restart onion-press-service

shell-onion-press:             ## Shell into onion-press-service
	docker-compose exec onion-press-service /bin/sh

tor-status:                    ## Check TOR status and show .onion address
	@echo "TOR Status:"
	@docker-compose exec tor-daemon cat /var/lib/tor/hidden_service/hostname 2>/dev/null || echo "TOR not running or hidden service not ready"
```

---

## Implementation Phases

### Phase 1: Core Infrastructure (Week 1-2)

**Deliverables:**
- [ ] `Dockerfile.onion-press` - Service container
- [ ] `index-onion-press.js` - Entry point with Express server
- [ ] `helpers/onionPressClient.js` - HTTP client for OIP daemon
- [ ] `helpers/torClient.js` - TOR-proxied HTTP client
- [ ] Docker Compose service definitions
- [ ] Makefile targets

**Files to Create:**
```
Dockerfile.onion-press
index-onion-press.js
helpers/torClient.js
routes/onion-press/publish.js
routes/onion-press/admin.js
routes/onion-press/tor.js
tor-daemon/
├── Dockerfile
└── torrc
```

### Phase 2: Publishing System (Week 2-3)

**Deliverables:**
- [ ] Multi-destination publishing logic
- [ ] Arweave publishing (via OIP daemon)
- [ ] GUN publishing (via OIP daemon)
- [ ] TOR-based Internet Archive publishing
- [ ] Publishing status tracking
- [ ] API endpoints for WordPress plugin

**API Endpoints:**
```
POST /api/publish              # Submit record for multi-destination publishing
GET  /api/publish/:id/status   # Check publishing status
GET  /api/destinations         # Get available publishing destinations
POST /api/admin/settings       # Update publishing settings (admin only)
GET  /api/admin/settings       # Get current settings (admin only)
GET  /api/tor/status           # TOR daemon status and .onion address
```

### Phase 3: WordPress Plugin (Week 3-5)

**Deliverables:**
- [ ] LO Publisher plugin structure
- [ ] Gutenberg sidebar panel
- [ ] Field mapping engine
- [ ] Template selection UI
- [ ] Record preview functionality
- [ ] Publishing submission
- [ ] Status tracking UI
- [ ] Plugin settings page

**Plugin Structure:**
```
wordpress-plugin/lo-publisher/
├── lo-publisher.php           # Main plugin file
├── includes/
│   ├── class-field-mapper.php
│   ├── class-record-assembler.php
│   ├── class-oip-client.php
│   └── class-admin-settings.php
├── assets/
│   ├── js/
│   │   ├── gutenberg-sidebar.js
│   │   └── admin-settings.js
│   └── css/
│       ├── gutenberg-sidebar.css
│       └── admin-settings.css
├── templates/
│   └── settings-page.php
└── readme.txt
```

### Phase 4: Browsing Interface (Week 5-6)

**Deliverables:**
- [ ] Enhanced reference client
- [ ] Template-based filtering
- [ ] Publishing status indicators
- [ ] Admin tab (hidden for non-admins)
- [ ] Settings interface
- [ ] TOR status display
- [ ] Multi-source view

**Files to Modify/Create:**
```
public/onion-press/
├── index.html                 # Enhanced browsing interface
├── admin.html                 # Admin settings (or tab in index.html)
├── css/
│   └── onion-press.css
└── js/
    ├── browse.js
    ├── admin.js
    └── api.js
```

### Phase 5: Integration & Testing (Week 6-7)

**Deliverables:**
- [ ] End-to-end publishing flow testing
- [ ] TOR connectivity testing
- [ ] Multi-destination publishing verification
- [ ] Admin settings persistence testing
- [ ] WordPress plugin testing
- [ ] Profile hierarchy verification
- [ ] Documentation

**Tests:**
```
test/
├── onion-press/
│   ├── publishing.test.js
│   ├── tor-client.test.js
│   ├── admin-settings.test.js
│   └── browsing-interface.test.js
```

---

## File Structure

### New Files

```
oip-arweave-indexer/
├── Dockerfile.onion-press           # Onion Press service container
├── index-onion-press.js             # Entry point
├── package-onion-press.json         # Dependencies
│
├── routes/
│   └── onion-press/                 # New route directory
│       ├── publish.js               # Publishing endpoints
│       ├── admin.js                 # Admin settings endpoints
│       ├── browse.js                # Browsing API endpoints
│       └── tor.js                   # TOR status endpoints
│
├── helpers/
│   └── onion-press/                 # New helpers directory
│       ├── multiDestinationPublisher.js
│       ├── torClient.js
│       └── settingsManager.js
│
├── public/
│   └── onion-press/                 # New static files
│       ├── index.html               # Browsing interface
│       ├── css/
│       │   └── onion-press.css
│       └── js/
│           ├── browse.js
│           ├── admin.js
│           └── api.js
│
├── tor-daemon/                      # TOR daemon container
│   ├── Dockerfile
│   └── torrc
│
├── wordpress-plugin/                # LO Publisher plugin
│   └── lo-publisher/
│       ├── lo-publisher.php
│       ├── includes/
│       ├── assets/
│       └── templates/
│
├── scripts/
│   └── docker-entrypoint-onion-press.sh
│
└── docs/
    └── toBuild/
        └── onion-press-server-implementation-plan.md  # This document
```

---

## API Reference

### Publishing Endpoints

#### POST /api/publish

Submit a record for multi-destination publishing.

**Request:**
```json
{
    "record": {
        "basic": {
            "name": "Article Title",
            "description": "Article summary",
            "date": 1734567890,
            "tagItems": ["news", "politics"]
        },
        "post": {
            "articleText": "Full article content...",
            "bylineWriter": "Anonymous"
        }
    },
    "destinations": {
        "arweave": true,
        "gun": true,
        "internetArchive": false
    },
    "wordpress": {
        "postId": 42,
        "postType": "post"
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
        "internetArchive": { "status": "skipped", "reason": "destination disabled" }
    }
}
```

#### GET /api/publish/:submissionId/status

Check publishing status.

**Response:**
```json
{
    "submissionId": "sub_abc123",
    "status": "completed",
    "results": {
        "arweave": {
            "status": "success",
            "did": "did:arweave:abc123...",
            "txId": "abc123..."
        },
        "gun": {
            "status": "success",
            "did": "did:gun:def456..."
        },
        "internetArchive": {
            "status": "skipped"
        }
    },
    "completedAt": "2025-12-18T12:34:56Z"
}
```

### Admin Endpoints

#### GET /api/admin/settings

Get current admin settings (requires admin auth).

**Response:**
```json
{
    "publishToArweave": true,
    "publishToGun": true,
    "publishToInternetArchive": false,
    "gunExternalPeers": ["https://peer1.example.com/gun"],
    "gunSyncInterval": 30000,
    "gunSyncTrustedNodes": ["pubkey1", "pubkey2"],
    "torStatus": {
        "connected": true,
        "onionAddress": "abcd1234.onion"
    }
}
```

#### POST /api/admin/settings

Update admin settings (requires admin auth).

**Request:**
```json
{
    "publishToArweave": true,
    "publishToGun": true,
    "publishToInternetArchive": true,
    "gunExternalPeers": "https://peer1.example.com/gun,https://peer2.example.com/gun",
    "gunSyncInterval": 60000,
    "gunSyncTrustedNodes": "pubkey1,pubkey2"
}
```

### TOR Endpoints

#### GET /api/tor/status

Get TOR daemon status and .onion address.

**Response:**
```json
{
    "connected": true,
    "onionAddress": "abcd1234efgh5678ijkl9012mnop3456.onion",
    "socksPort": 9050,
    "controlPort": 9051,
    "uptime": "2h 34m"
}
```

---

## Success Criteria

### Functional Requirements

- [ ] WordPress plugin successfully maps fields to OIP templates
- [ ] Records publish to Arweave via OIP daemon
- [ ] Records publish to GUN via OIP daemon
- [ ] Records publish to Internet Archive via TOR
- [ ] Browsing interface displays records with source indicators
- [ ] Admin settings persist and control publishing behavior
- [ ] TOR daemon generates and exposes .onion address
- [ ] Profile hierarchy works correctly (oip-only < onion-press-server < alexandria)

### Performance Requirements

- [ ] Publishing to local destinations (Arweave/GUN) < 5 seconds
- [ ] Publishing via TOR < 60 seconds (TOR is slower)
- [ ] Browsing interface loads records < 2 seconds
- [ ] WordPress plugin responsive in Gutenberg editor

### Security Requirements

- [ ] Admin endpoints require authentication
- [ ] TOR client properly proxies all IA-bound requests
- [ ] No IP leakage when publishing via TOR
- [ ] JWT tokens properly validated

---

## Dependencies

### New npm Packages

```json
{
    "dependencies": {
        "socks-proxy-agent": "^8.0.2",
        "express": "^4.19.2",
        "axios": "^1.7.9"
    }
}
```

### Docker Images

- `wordpress:latest` - WordPress container
- `mariadb:latest` - WordPress database
- Custom TOR daemon image (Alpine + Tor)

---

## References

- [DWeb Server PRD](./dweb-server/DWEB_SERVER_PRD.md)
- [OIP Daemon/Alexandria Split Plan](./oip-daemon-and-alexandria-service-split-plan.md)
- [OIP v0.9 Implementation Plan](./oip-09-js-implementation-plan.md)
- [Organizations Documentation](../ORGANIZATIONS.md)
- [OIP Technical Overview](../OIP_TECHNICAL_OVERVIEW.md)

---

**Document Status:** Draft  
**Created:** December 18, 2025  
**Author:** Implementation Planning  
**Next Steps:** Review and begin Phase 1 implementation

