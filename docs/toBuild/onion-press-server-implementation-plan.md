# Onion Press Server Implementation Plan

## Executive Summary

**Onion Press Server** is a new OIP profile that provides anonymous publishing capabilities using WordPress as the authoring interface, TOR for anonymity, and OIP for persistent decentralized storage.

**Profile Hierarchy:**
```
oip-only < onion-press-server < alexandria-decentralized
```

> **Note:** As of December 2025, onion-press is included only in `onion-press-server` and `alexandria-decentralized-*` profiles. Basic `alexandria` profiles do NOT include onion-press to keep them lightweight.

**Core Components:**
- WordPress container with LO Publisher plugin for authoring
- Integrated TOR daemon (runs inside onion-press-service container)
- Enhanced browsing interface with admin settings
- Multi-destination publishing (Arweave, GUN, Internet Archive)

---

## Implementation Status

### ✅ Completed

| Component | Status | Notes |
|-----------|--------|-------|
| `Dockerfile.onion-press` | ✅ Done | Includes TOR daemon |
| `index-onion-press.js` | ✅ Done | Entry point with Express server |
| `package-onion-press.json` | ✅ Done | Dependencies |
| `scripts/docker-entrypoint-onion-press.sh` | ✅ Done | Starts TOR then Node |
| `tor-daemon/torrc` | ✅ Done | TOR config (integrated) |
| `helpers/onion-press/torClient.js` | ✅ Done | SOCKS5 proxy client |
| `helpers/onion-press/settingsManager.js` | ✅ Done | Settings persistence |
| `helpers/onion-press/multiDestinationPublisher.js` | ✅ Done | Multi-dest logic |
| `routes/onion-press/publish.js` | ✅ Done | Publishing API |
| `routes/onion-press/admin.js` | ✅ Done | Admin settings API |
| `routes/onion-press/browse.js` | ✅ Done | Browse proxy to OIP daemon |
| `routes/onion-press/tor.js` | ✅ Done | TOR status API |
| `public/onion-press/*` | ✅ Done | Browsing/admin interface |
| Docker Compose integration | ✅ Done | Profiles configured |
| Makefile.split targets | ✅ Done | Deploy commands |
| Environment variables | ✅ Done | In example env |
| TOR Hidden Service Guide | ✅ Done | `docs/TOR_HIDDEN_SERVICE_GUIDE.md` |
| OIP Daemon browse proxy | ✅ Done | `/onion-press/` routes in daemon |

### 🚧 Partially Implemented

| Component | Status | Notes |
|-----------|--------|-------|
| WordPress LO Publisher plugin | 🚧 Skeleton | Basic structure exists, needs full field mapping |
| Field mapping UI | 🚧 Basic | Gutenberg sidebar placeholder |

### ❌ Not Yet Implemented

| Component | Status | Notes |
|-----------|--------|-------|
| Organization template `gateway_onion_address` field | ❌ Pending | Needed for IA publishing |
| Internet Archive organization record | ❌ Pending | IA needs to publish their .onion |
| Full WordPress → OIP field mapping | ❌ Pending | Plugin needs completion |
| Publishing status persistence | ❌ Pending | Currently in-memory only |
| End-to-end integration tests | ❌ Pending | Manual testing done |

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

### Profile Hierarchy (Actual Implementation)

| Profile | Includes | Use Case |
|---------|----------|----------|
| `oip-only` | Core OIP infrastructure | Pure indexing, no publishing UI |
| `onion-press-server` | `oip-only` + WordPress + TOR + Publishing/Browsing UI | Anonymous publishing platform |
| `alexandria` | `oip-only` + AI/Voice services | Lightweight AI assistant (NO onion-press) |
| `alexandria-decentralized` | `alexandria` + `onion-press-server` + AR.IO gateway | Full decentralized stack |

> **Design Decision:** Basic `alexandria` profiles are kept lightweight without WordPress/TOR overhead. Only `alexandria-decentralized-*` variants include the full onion-press stack.

### Profile Service Matrix (Actual)

```
                          oip-    onion-press  alexandria  alexandria-
Service                   only    -server                  decentralized
────────────────────────────────────────────────────────────────────────
elasticsearch              ✓         ✓            ✓             ✓
kibana                     ✓         ✓            ✓             ✓
oip-daemon-service         ✓         ✓            ✓             ✓
gun-relay                  ✓         ✗            ✓             ✓
ipfs                       ✓         ✓            ✓             ✓
onion-press-service        ✗         ✓            ✗             ✓
wordpress                  ✗         ✓            ✗             ✓
wordpress-db               ✗         ✓            ✗             ✓
alexandria-service         ✗         ✗            ✓             ✓
ollama                     ✗         ✗            ✓             ✓
tts-service                ✗         ✗            ✓             ✓
stt-service                ✗         ✗            ✓             ✓
ario-gateway               ✗         ✗            ✗             ✓
```

> **Note:** TOR daemon is integrated INTO `onion-press-service` container (not a separate service).

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

### 3. Integrated TOR Daemon

**Purpose:** Provides both onion service (inbound) and TOR client (outbound)

**Location:** Runs INSIDE `onion-press-service` container (not separate)

**Capabilities:**
- Onion service for this instance (generates unique .onion address)
- SOCKS5 proxy on `127.0.0.1:9050` for outbound TOR connections
- Automatic .onion address generation on first run
- Address persists across restarts via Docker volumes

**Why Integrated:**
- Hidden service needs to route to `127.0.0.1:3007` (same container)
- Simpler architecture - no cross-container DNS resolution issues
- Single container manages both TOR and the Node.js app

**Documentation:** See `docs/TOR_HIDDEN_SERVICE_GUIDE.md` for detailed usage

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

### Architecture (Actual Implementation)

TOR runs **inside** the `onion-press-service` container, started by the entrypoint script before the Node.js app. This provides:

1. **Onion Service (Inbound):** Unique `.onion` address for receiving anonymous submissions
2. **SOCKS5 Proxy (Outbound):** For publishing to Internet Archive's .onion gateway

### TOR Configuration (torrc)

Located at `tor-daemon/torrc`, copied into container at build:

```
# TOR runs in same container as onion-press-service

# SOCKS proxy for outbound connections (localhost only)
SocksPort 127.0.0.1:9050

# Control port for status queries
ControlPort 127.0.0.1:9051

# Hidden service - routes to Node.js app in same container
HiddenServiceDir /var/lib/tor/hidden_service/
HiddenServicePort 80 127.0.0.1:3007

# Data directory
DataDirectory /var/lib/tor/data

# Only accept SOCKS from localhost
SocksPolicy accept 127.0.0.1
SocksPolicy reject *

# Run as tor user
User tor
```

### Entrypoint Flow

The `docker-entrypoint-onion-press.sh` script:

1. Cleans up stale TOR lock files
2. Sets correct permissions on TOR directories
3. Starts TOR daemon in background
4. Waits for TOR to bootstrap (~30-60 seconds)
5. Reads and exports `.onion` address
6. Starts Node.js application

### .onion Address

- Generated on first startup
- Persisted in `tor-hidden-service` Docker volume
- Available via API and environment variable:

```javascript
// GET /api/tor/status
{
    "connected": true,
    "onionAddress": "pczapevxiipkq5shr47k3fc7m6myh2uahiea3cunn6f62tr32yddgbqd.onion",
    "socksHost": "127.0.0.1",
    "socksPort": 9050
}
```

### Full Documentation

See `docs/TOR_HIDDEN_SERVICE_GUIDE.md` for:
- Finding your .onion address
- Backing up hidden service keys
- Troubleshooting TOR issues
- Security considerations

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

### docker-compose-split.yml (Actual Implementation)

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
      - "${ONION_PRESS_PORT:-3007}:${ONION_PRESS_PORT:-3007}"
    environment:
      - NODE_ENV=production
      - PORT=${ONION_PRESS_PORT:-3007}
      - OIP_DAEMON_URL=http://oip-daemon-service:${OIP_DAEMON_PORT:-3005}
      - PUBLISH_TO_ARWEAVE=${PUBLISH_TO_ARWEAVE:-true}
      - PUBLISH_TO_GUN=${PUBLISH_TO_GUN:-true}
      - PUBLISH_TO_INTERNETARCHIVE=${PUBLISH_TO_INTERNETARCHIVE:-false}
      - GUN_EXTERNAL_PEERS=${GUN_EXTERNAL_PEERS:-}
      - GUN_SYNC_INTERVAL=${GUN_SYNC_INTERVAL:-30000}
      - GUN_SYNC_TRUSTED_NODES=${GUN_SYNC_TRUSTED_NODES:-}
      - TOR_PROXY_HOST=127.0.0.1      # TOR runs in same container
      - TOR_PROXY_PORT=9050
      - JWT_SECRET=${JWT_SECRET}
      - IA_ORGANIZATION_HANDLE=${IA_ORGANIZATION_HANDLE:-internetarchive}
    depends_on:
      oip-daemon-service:
        condition: service_healthy
    volumes:
      - ./data/onion-press:/usr/src/app/data
      - ./public/onion-press:/usr/src/app/public/onion-press
      - tor-hidden-service:/var/lib/tor/hidden_service   # Persist .onion address
      - tor-data:/var/lib/tor/data
    networks:
      - oip-network
    profiles:
      - onion-press-server
      - alexandria-decentralized
      - alexandria-decentralized-gpu
      - alexandria-decentralized-macMseries
      - alexandria-noSTT-decentralized

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
      - ./wordpress-plugin/lo-publisher:/var/www/html/wp-content/plugins/lo-publisher:ro
    networks:
      - oip-network
    profiles:
      - onion-press-server
      - alexandria-decentralized
      - alexandria-decentralized-gpu
      - alexandria-decentralized-macMseries
      - alexandria-noSTT-decentralized

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
      - alexandria-decentralized
      - alexandria-decentralized-gpu
      - alexandria-decentralized-macMseries
      - alexandria-noSTT-decentralized

volumes:
  wordpress-data:
  wordpress-db-data:
  tor-hidden-service:    # Persists .onion address keys
  tor-data:              # TOR runtime data
```

> **Note:** There is NO separate `tor-daemon` service. TOR runs integrated inside `onion-press-service`.

### Makefile.split Commands (Actual)

```makefile
# ════════════════════════════════════════════════════════════════
# ONION PRESS SERVER PROFILE
# ════════════════════════════════════════════════════════════════

onion-press-server:            ## Deploy: OIP + WordPress + TOR anonymous publishing
	@$(MAKE) up PROFILE=onion-press-server
	@echo "🧅 Onion Press Server starting..."

rebuild-onion-press-server:    ## Rebuild and deploy onion-press-server
	docker-compose -f $(COMPOSE_FILE) --profile onion-press-server up -d --build

logs-onion-press:              ## Show onion-press-service logs
	docker-compose -f $(COMPOSE_FILE) logs -f onion-press-service

logs-wordpress:                ## Show WordPress logs
	docker-compose -f $(COMPOSE_FILE) logs -f wordpress

logs-tor:                      ## Show TOR logs (integrated in onion-press-service)
	docker-compose -f $(COMPOSE_FILE) logs -f onion-press-service | grep -E "(TOR|tor|onion|bootstrap)"

restart-onion-press:           ## Restart onion-press-service
	docker-compose -f $(COMPOSE_FILE) restart onion-press-service

shell-onion-press:             ## Shell into onion-press-service
	docker-compose -f $(COMPOSE_FILE) exec onion-press-service /bin/sh

test-onion-press:              ## Test onion-press-service health
	@curl -sf http://localhost:$${ONION_PRESS_PORT:-3007}/health && echo "✅ Onion Press healthy" || echo "❌ Onion Press not responding"
```

---

## Implementation Phases

### Phase 1: Core Infrastructure ✅ COMPLETE

**Deliverables:**
- [x] `Dockerfile.onion-press` - Service container with integrated TOR
- [x] `index-onion-press.js` - Entry point with Express server
- [x] `helpers/onion-press/torClient.js` - TOR-proxied HTTP client
- [x] `helpers/onion-press/settingsManager.js` - Settings persistence
- [x] Docker Compose service definitions
- [x] Makefile targets

**Files Created:**
```
Dockerfile.onion-press
index-onion-press.js
package-onion-press.json
scripts/docker-entrypoint-onion-press.sh
helpers/onion-press/torClient.js
helpers/onion-press/settingsManager.js
helpers/onion-press/multiDestinationPublisher.js
routes/onion-press/publish.js
routes/onion-press/admin.js
routes/onion-press/browse.js
routes/onion-press/tor.js
tor-daemon/torrc                    # TOR config (integrated into container)
```

### Phase 2: Publishing System ✅ COMPLETE

**Deliverables:**
- [x] Multi-destination publishing logic
- [x] Arweave publishing (via OIP daemon)
- [x] GUN publishing (via OIP daemon)
- [x] TOR-based publishing infrastructure
- [x] API endpoints for WordPress plugin

**API Endpoints (Implemented):**
```
POST /api/publish              # Submit record for multi-destination publishing
GET  /api/publish/destinations # Get available publishing destinations
POST /api/admin/settings       # Update publishing settings (admin only)
GET  /api/admin/settings       # Get current settings (admin only)
GET  /api/tor/status           # TOR daemon status and .onion address
GET  /api/tor/test             # Test TOR connectivity
GET  /api/browse/records       # Browse records (proxies to OIP daemon)
GET  /api/browse/types         # Get record types
GET  /api/browse/templates     # Get templates
```

**Pending:**
- [ ] Internet Archive publishing (requires IA to publish organization record with `gateway_onion_address`)
- [ ] Publishing status persistence (currently in-memory)

### Phase 3: WordPress Plugin 🚧 PARTIAL

**Completed:**
- [x] Basic plugin structure
- [x] Main plugin file (`lo-publisher.php`)
- [x] Gutenberg sidebar placeholder
- [x] Admin settings page skeleton
- [x] CSS/JS asset files

**Pending:**
- [ ] Full field mapping engine
- [ ] Template schema fetching from OIP
- [ ] Record preview before publishing
- [ ] Publishing status UI in editor
- [ ] Custom post type support (recipe, exercise)

**Current Plugin Structure:**
```
wordpress-plugin/lo-publisher/
├── lo-publisher.php           # Main plugin file ✅
├── assets/
│   ├── js/
│   │   ├── gutenberg-sidebar.js  # Basic ✅
│   │   └── admin-settings.js     # Basic ✅
│   └── css/
│       ├── gutenberg-sidebar.css ✅
│       └── admin-settings.css    ✅
└── readme.txt                    ✅
```

### Phase 4: Browsing Interface ✅ COMPLETE

**Deliverables:**
- [x] Enhanced browsing interface
- [x] Record type filtering
- [x] Publishing source indicators (Arweave/GUN badges)
- [x] Admin tab (visible only to logged-in admins)
- [x] Settings interface
- [x] TOR status display
- [x] Record detail modal with raw data view

**Files Created:**
```
public/onion-press/
├── index.html                 # Browsing interface ✅
├── css/
│   └── onion-press.css        # Dark theme styling ✅
└── js/
    ├── browse.js              # Record browsing logic ✅
    ├── admin.js               # Admin settings UI ✅
    └── api.js                 # API client ✅
```

### Phase 5: Integration & Testing 🚧 PARTIAL

**Completed:**
- [x] TOR connectivity verification
- [x] Profile hierarchy (onion-press in decentralized profiles only)
- [x] OIP daemon proxy routes (`/onion-press/` path)
- [x] TOR Hidden Service Guide documentation

**Pending:**
- [ ] End-to-end WordPress → OIP publishing test
- [ ] Internet Archive publishing test (blocked on IA setup)
- [ ] Automated integration tests
- [ ] Load testing

---

## File Structure

### Files Created (Actual)

```
oip-arweave-indexer/
├── Dockerfile.onion-press           # ✅ Service container (includes TOR)
├── index-onion-press.js             # ✅ Entry point
├── package-onion-press.json         # ✅ Dependencies
│
├── routes/
│   └── onion-press/                 # ✅ Route directory
│       ├── publish.js               # ✅ Publishing endpoints
│       ├── admin.js                 # ✅ Admin settings endpoints
│       ├── browse.js                # ✅ Browsing API (proxies to OIP daemon)
│       └── tor.js                   # ✅ TOR status endpoints
│
├── helpers/
│   └── onion-press/                 # ✅ Helpers directory
│       ├── multiDestinationPublisher.js  # ✅ Multi-dest logic
│       ├── torClient.js             # ✅ SOCKS5 proxy client
│       └── settingsManager.js       # ✅ Settings persistence
│
├── public/
│   └── onion-press/                 # ✅ Static files (served by OIP daemon too)
│       ├── index.html               # ✅ Browsing interface
│       ├── css/
│       │   └── onion-press.css      # ✅ Dark theme
│       └── js/
│           ├── browse.js            # ✅ Record browsing
│           ├── admin.js             # ✅ Admin settings UI
│           └── api.js               # ✅ API client
│
├── tor-daemon/                      # ✅ TOR config (NO separate Dockerfile)
│   └── torrc                        # ✅ Copied into onion-press container
│
├── wordpress-plugin/                # 🚧 LO Publisher plugin (partial)
│   └── lo-publisher/
│       ├── lo-publisher.php         # ✅ Main file
│       ├── assets/
│       │   ├── js/
│       │   │   ├── gutenberg-sidebar.js   # 🚧 Basic
│       │   │   └── admin-settings.js      # 🚧 Basic
│       │   └── css/
│       │       ├── gutenberg-sidebar.css  # ✅
│       │       └── admin-settings.css     # ✅
│       └── readme.txt               # ✅
│
├── scripts/
│   └── docker-entrypoint-onion-press.sh  # ✅ Starts TOR then Node
│
└── docs/
    ├── TOR_HIDDEN_SERVICE_GUIDE.md  # ✅ TOR usage documentation
    └── toBuild/
        └── onion-press-server-implementation-plan.md  # This document
```

### OIP Daemon Integration

The OIP daemon (`index-daemon.js`) also includes onion-press routes:
- `/onion-press/` - Serves static files from `public/onion-press/`
- `/onion-press/api/browse/*` - Handled locally (queries Elasticsearch directly)
- `/onion-press/api/publish/*`, `/onion-press/api/admin/*`, `/onion-press/api/tor/*` - Proxied to onion-press-service

This allows accessing Onion Press at `https://yourdomain.com/onion-press/` even when running basic alexandria profile (browse-only mode).

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

## Next Steps

### Immediate (to complete MVP)
1. **Complete WordPress plugin** - Full field mapping from WP posts to OIP templates
2. **Test end-to-end flow** - WordPress → LO Publisher → onion-press-service → OIP daemon → Arweave/GUN

### Blocked (waiting on external)
3. **Internet Archive integration** - Requires IA to:
   - Run an OIP node with TOR hidden service
   - Publish organization record with `gateway_onion_address` field

### Future Enhancements
4. **Publishing status persistence** - Store submission status in database
5. **Custom post types** - Recipe/Exercise WordPress post types with pre-mapped fields
6. **Automated tests** - Integration test suite

---

**Document Status:** Implementation In Progress  
**Created:** December 18, 2025  
**Last Updated:** December 21, 2025  
**Author:** Implementation Planning  

**Implementation Status:**
- ✅ Phase 1: Core Infrastructure - COMPLETE
- ✅ Phase 2: Publishing System - COMPLETE (except IA)
- 🚧 Phase 3: WordPress Plugin - PARTIAL
- ✅ Phase 4: Browsing Interface - COMPLETE
- 🚧 Phase 5: Integration Testing - PARTIAL

