# Project Split Outline: oip-daemon-service vs alexandria-service
## Microservices Architecture within Single Docker Compose

---

## ✅ **IMPLEMENTATION STATUS: COMPLETE**

> **Last Updated:** December 2024
> **Status:** File reorganization and service separation complete. Ready for build & test.

### What Was Implemented

| Component | Status | Notes |
|-----------|--------|-------|
| `Dockerfile.oip-daemon` | ✅ Complete | Optimized dependencies, memory leak fixes integrated |
| `Dockerfile.alexandria` | ✅ Complete | AI/voice dependencies, puppeteer support |
| `index-daemon.js` | ✅ Complete | Memory-safe entry point with all daemon routes |
| `index-alexandria.js` | ✅ Complete | oipClient integration, all Alexandria routes |
| `helpers/oipClient.js` | ✅ Complete | Full HTTP client with all needed methods |
| `routes/daemon/*` | ✅ Complete | All daemon routes reorganized |
| `routes/alexandria/*` | ✅ Complete | All Alexandria routes reorganized + refactored |
| `helpers/core/*` | ✅ Complete | Daemon helpers reorganized |
| `helpers/alexandria/*` | ✅ Complete | Alexandria helpers reorganized |
| `docker-compose-split.yml` | ✅ Complete | New service definitions with profiles |
| `Makefile.split` | ✅ Complete | New profile targets |
| Import path fixes | ✅ Complete | All imports audited and corrected |
| oipClient refactoring | ✅ Complete | Alexandria routes use oipClient for data ops |

### Changes From Original Plan

| Original Plan | Actual Implementation | Reason |
|---------------|----------------------|--------|
| Direct elasticsearch imports in Alexandria | Added daemon endpoints for `indexRecord` and `searchCreatorByAddress` | Proper service separation - Alexandria should not write directly to ES |
| `resolveRecipeIngredients` in recipes.js | Extracted to `helpers/core/recipe-resolver.js` | Shared helper needed by both daemon publish and Alexandria recipes |
| `/api/test-rag` in daemon api.js | Moved to `routes/alexandria/alfred.js` | AI functionality belongs in Alexandria |
| Basic oipClient | Enhanced with `indexRecord()`, `getCreatorByAddress()`, and `request()` methods | Additional daemon endpoints needed for Alexandria operations |

### New Daemon Endpoints Added (Not in Original Plan)

```
POST /api/records/index           # Index a record to Elasticsearch (for Alexandria)
GET  /api/records/creator/:did    # Look up creator by DID address (for Alexandria)
```

### Files Created/Modified

**New Files:**
- `Dockerfile.oip-daemon`
- `Dockerfile.alexandria`
- `index-daemon.js`
- `index-alexandria.js`
- `helpers/oipClient.js`
- `helpers/core/recipe-resolver.js`
- `docker-compose-split.yml`
- `Makefile.split`
- `package-daemon.json`
- `package-alexandria.json`
- `scripts/docker-entrypoint-daemon.sh`
- `scripts/docker-entrypoint-alexandria.sh`

**Route Reorganization:**
- `routes/daemon/` - api.js, records.js, templates.js, creators.js, user.js, wallet.js, publish.js, media.js, organizations.js, cleanup.js, health.js
- `routes/alexandria/` - alfred.js, voice.js, generate.js, narration.js, photo.js, scrape.js, recipes.js, workout.js, jfk.js, notes.js

### Remaining Tasks (Pre-Deployment)

| Task | Priority | Notes |
|------|----------|-------|
| Build Docker images | 🔴 Required | `docker build -f Dockerfile.oip-daemon -t oip-daemon .` |
| Test oip-only profile | 🔴 Required | `make -f Makefile.split oip-only` |
| Test alexandria profile | 🔴 Required | `make -f Makefile.split alexandria` |
| Verify all endpoints work | 🔴 Required | Run integration tests |
| Update original docker-compose.yml | 🟡 Optional | Can replace with docker-compose-split.yml |
| Update original Makefile | 🟡 Optional | Can replace with Makefile.split |

### Memory Leak Fixes Integrated

The following memory management best practices were integrated into the new entry points:

- `keepAlive: false` for HTTP agents (prevents connection pooling memory growth)
- Axios response interceptors for buffer cleanup
- Stream semaphores for concurrent stream limiting
- Aggressive GUN response cleanup
- Bounded LRU caches with TTL
- Periodic garbage collection hints

---

## 📊 **High-Level Philosophy**

**oip-daemon-service** = The complete library infrastructure - card catalog, shelves, and access control
**alexandria-service** = The librarian - helps you find things, creates content, talks to you

### 📚 **Library Card Catalog Analogy**

| Library Concept | OIP Equivalent | Service |
|-----------------|----------------|---------|
| **Books** | Content (videos, music, text, images) | Referenced by both |
| **Shelves/Stacks** | Distribution networks (Web, BitTorrent, IPFS, Arweave storage) | `oip-daemon-service` |
| **Dewey Decimal System** | DIDs for each record | `oip-daemon-service` |
| **Card Catalog (Public)** | Arweave index | `oip-daemon-service` |
| **Card Catalog (Private)** | GUN index | `oip-daemon-service` |
| **Card Format Standard** | OIP Protocol (templates, compression) | `oip-daemon-service` |
| **Library Membership** | Organizations, access control | `oip-daemon-service` |
| **The Librarian** | Alfred AI, RAG queries | `alexandria-service` |
| **Talking to Librarian** | Voice interface (STT/TTS) | `alexandria-service` |
| **Writing New Books** | Content generation, podcast creation | `alexandria-service` |
| **Book Appraisal** | Photo analysis, nutritional analysis | `alexandria-service` |
| **Acquiring Books** | Web scraping | `alexandria-service` |

> **Note**: This is NOT a split into separate repositories. Both services live in the same project, deployed via the same Docker Compose, sharing infrastructure.

---

## 🏗️ **Architecture Overview**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Docker Compose                                  │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                        oip-daemon-service                                ││
│  │                           (port 3005)                                    ││
│  │                                                                          ││
│  │  CARD CATALOG:              SHELVES:              ACCESS CONTROL:        ││
│  │  ├─ Arweave index           ├─ Media upload       ├─ Organizations       ││
│  │  ├─ GUN index               ├─ BitTorrent seed    ├─ Member management   ││
│  │  ├─ Templates               ├─ IPFS storage       ├─ Encryption          ││
│  │  ├─ DID resolution          ├─ HTTP streaming     └─ Domain policies     ││
│  │  ├─ Record CRUD             └─ Arweave storage                           ││
│  │  ├─ dref resolution                                                      ││
│  │  └─ User auth (HD wallets)                                               ││
│  └────────────────────────────────────┬────────────────────────────────────┘│
│                                       │                                      │
│                                       │ HTTP API calls                       │
│                                       ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                        alexandria-service                                ││
│  │                           (port 3006)                                    ││
│  │                                                                          ││
│  │  THE LIBRARIAN:             CONTENT CREATION:      INTERFACES:           ││
│  │  ├─ Alfred AI/RAG           ├─ Podcast generation  ├─ Voice (STT/TTS)    ││
│  │  ├─ Semantic search         ├─ Recipe images       ├─ WebSocket          ││
│  │  ├─ Conversation memory     ├─ Content generation  └─ Client apps        ││
│  │  └─ Context retrieval       └─ Photo analysis                            ││
│  │                                                                          ││
│  │  ACQUISITION:               SPECIALIZED FEATURES:                        ││
│  │  ├─ Web scraping            ├─ Recipe processing                         ││
│  │  └─ URL parsing             ├─ Workout processing                        ││
│  │                             └─ Nutritional lookup                        ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │ elasticsearch │  │  gun-relay   │  │   ollama     │  │   tts/stt       │ │
│  │   (shared)    │  │  (daemon)    │  │ (alexandria) │  │  (alexandria)   │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🎯 **Part 1: oip-daemon-service** 
### The Complete Library Infrastructure

#### **Purpose**
A comprehensive service for blockchain-indexed record storage, retrieval, and distribution using the Open Index Protocol. This includes all index storage (Arweave + GUN), all distribution networks (BitTorrent, IPFS, HTTP), and all access control (organizations, encryption).

#### **Core Responsibilities**

**Card Catalog (Index Storage):**
- Template-based record compression/decompression
- Blockchain publishing (Arweave) for public records
- GUN network for private/encrypted records
- Elasticsearch indexing and search
- Record retrieval with dref resolution

**Shelves (Distribution Networks):**
- Media file upload and storage
- BitTorrent/WebTorrent seeding
- IPFS publishing
- Arweave permanent storage
- HTTP streaming with range requests

**Access Control:**
- User authentication (HD wallet/DID-based)
- Organization registration and management
- Member enrollment and policies
- Organization-level encryption
- Private record encryption (per-user)

---

### **Files/Directories for oip-daemon-service**

#### **Configuration**
```
config/
├── arweave.config.js          # Arweave connection config
├── checkEnvironment.js        # Environment validation
├── createIndices.js           # Elasticsearch index setup
├── templates.config.js        # Template mappings
├── recordTypesToIndex.js      # Which record types to index
├── createAdmin.js             # Admin user creation
├── generateToken.js           # JWT token generation
├── generateWallet.js          # HD wallet generation
├── migrateGunSupport.js       # GUN migration utilities
└── updateElasticsearchMappings.js
```

#### **Core Helpers**
```
helpers/
├── arweave.js                 # Arweave blockchain integration
├── arweave-wallet.js          # Wallet management
├── elasticsearch.js           # ES indexing/search (CORE)
├── templateHelper.js          # Template expansion/compression
├── dref-resolver.js           # Reference resolution
├── generators.js              # Record ID generation
├── utils.js                   # Utility functions
├── file.js                    # File operations
├── urlHelper.js               # URL utilities
├── apiConfig.js               # API configuration
│
# GUN Network (Card Catalog - Private)
├── gun.js                     # GUN database integration
├── gunSyncService.js          # Cross-node sync
├── oipGunRegistry.js          # GUN record registry
├── privateRecordHandler.js    # Encrypted records
├── sharedState.js             # State management
│
# Media Distribution (Shelves)
├── media-manager.js           # Media file handling
├── ipfs.js                    # IPFS integration
│
# Access Control (Library Membership)
├── organizationEncryption.js  # Org-level encryption
└── organizationDecryptionQueue.js
```

#### **Services**
```
services/
├── mediaSeeder.js             # BitTorrent/WebTorrent seeding
└── (other background services)
```

#### **Core Routes**
```
routes/
├── api.js                     # Root API endpoint
├── records.js                 # Record CRUD operations (both Arweave + GUN)
├── templates.js               # Template management
├── creators.js                # Creator registration/lookup
├── user.js                    # User auth (register/login)
├── wallet.js                  # HD wallet operations
├── publish.js                 # Record publishing (Arweave)
├── media.js                   # Media upload/streaming/distribution
├── organizations.js           # Organization management
├── cleanup.js                 # Template/record cleanup
└── health.js                  # Health checks (ES, GUN, media seeder)
```

#### **Middleware**
```
middleware/
├── auth.js                    # JWT authentication
└── apiLogger.js               # Request logging
```

#### **GUN Relay**
```
gun-relay-server.js            # GUN relay HTTP API
```

---

### **API Surface (oip-daemon-service)**

```
═══════════════════════════════════════════════════════════════════
CARD CATALOG - Record Operations
═══════════════════════════════════════════════════════════════════
GET    /api/records                    # Query/search records (Arweave + GUN)
POST   /api/records/newRecord          # Publish record (?storage=arweave|gun)
GET    /api/records/recordTypes        # Get record type summary
POST   /api/records/deleteRecord       # Delete owned record
POST   /api/records/index              # Index record to ES (NEW - for Alexandria)
GET    /api/records/creator/:did       # Lookup creator by DID (NEW - for Alexandria)

Template Operations:
GET    /api/templates                  # Get all templates
GET    /api/templates/:name            # Get specific template
POST   /api/templates/new              # Publish new template

Publishing:
POST   /api/publish/newPost            # Publish post record
POST   /api/publish/newImage           # Publish image record
POST   /api/publish/newVideo           # Publish video record
POST   /api/publish/newTemplate        # Publish template
GET    /api/publish/schema             # Get schema for record type
GET    /api/publish/schemas            # List all schemas

Creator Operations:
GET    /api/creators                   # List creators
POST   /api/creators/register          # Register creator

═══════════════════════════════════════════════════════════════════
SHELVES - Media Distribution
═══════════════════════════════════════════════════════════════════
POST   /api/media/upload               # Upload media file
GET    /api/media/:mediaId             # Stream media (HTTP + range requests)
GET    /api/media/:mediaId/info        # Get media metadata
POST   /api/media/createRecord         # Create OIP record for media
POST   /api/media/ipfs-upload          # Upload to IPFS
POST   /api/media/arweave-upload       # Upload to Arweave
POST   /api/media/web-setup            # Setup web server access

═══════════════════════════════════════════════════════════════════
ACCESS CONTROL - Authentication & Organizations
═══════════════════════════════════════════════════════════════════
Authentication:
POST   /api/user/register              # Register user (HD wallet)
POST   /api/user/login                 # Login user
GET    /api/user/mnemonic              # Export mnemonic
POST   /api/user/import-wallet         # Import wallet from mnemonic

Wallet:
POST   /api/wallet/generate            # Generate HD wallet
POST   /api/wallet/import              # Import wallet from mnemonic

Organizations:
POST   /api/organizations/register     # Register organization
GET    /api/organizations              # List organizations
GET    /api/organizations/:id          # Get organization details
POST   /api/organizations/members      # Manage members

═══════════════════════════════════════════════════════════════════
MAINTENANCE
═══════════════════════════════════════════════════════════════════
Cleanup:
GET    /api/cleanup/analyze-templates  # Analyze unused templates
POST   /api/cleanup/delete-unused-templates  # Delete unused
POST   /api/cleanup/delete-template    # Delete specific template

Health:
GET    /health                         # Basic health check
GET    /api/health/elasticsearch       # ES connection status
GET    /api/health/gun-sync            # GUN sync status
POST   /api/health/gun-sync/force      # Force GUN sync cycle
GET    /api/health/media-seeder        # Media seeder status
POST   /api/health/memory/clear-cache  # Clear GUN cache
```

---

### **Key Dependencies (oip-daemon-service)**

```json
{
  "dependencies": {
    // Core
    "@elastic/elasticsearch": "^8.17.0",
    "arweave": "^1.15.5",
    "express": "^4.19.2",
    "body-parser": "^1.20.2",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    
    // Authentication
    "jsonwebtoken": "^9.0.2",
    "bcrypt": "^5.1.1",
    "bip39": "^3.1.0",
    "bip32": "^4.0.0",
    "tiny-secp256k1": "^2.2.3",
    
    // GUN Network (Private Card Catalog)
    "gun": "^0.2020.1240",
    
    // Media Distribution (Shelves)
    "webtorrent": "^1.9.7",
    "create-torrent": "^4.4.6",
    "parse-torrent": "^9.1.5",
    "ipfs-http-client": "^49.0.4",
    
    // Utilities
    "uuid": "^9.0.1",
    "multer": "^2.0.2",
    "axios": "^1.7.9"
  }
}
```

**EXCLUDED from oip-daemon-service:**
- AI/LLM packages (ollama, openai, gpt-tokenizer)
- Heavy media processing (sharp, canvas, fluent-ffmpeg)
- Voice processing
- Web scraping (puppeteer, cheerio, firecrawl)
- Socket.io (real-time features)

---

## 🌐 **Part 2: alexandria-service**
### The Librarian - AI, Voice, and Content Services

#### **Purpose**
The intelligent interface layer that helps users interact with the OIP library. Alexandria doesn't store or index anything itself - it calls `oip-daemon-service` for all data operations. It provides AI-powered search, voice interaction, content generation, and specialized processing.

#### **Core Responsibilities**

**The Librarian (AI/RAG):**
- Alfred AI assistant
- RAG (Retrieval-Augmented Generation) via oip-daemon-service
- Semantic search enhancement
- Conversation memory and context
- Multi-LLM support (Ollama, OpenAI, XAI)

**Content Creation:**
- Podcast generation from records
- Recipe image generation (DALL-E)
- Content summarization
- Audio narration

**Acquisition & Processing:**
- Web scraping and archiving
- Recipe ingredient processing
- Workout exercise resolution
- Photo analysis (Grok vision)
- Nutritional information lookup

**Interfaces:**
- Voice interface (STT/TTS integration)
- WebSocket real-time features
- Client application backends

---

### **Files/Directories for alexandria-service**

#### **AI & Voice Services**
```
Routes:
routes/
├── alfred.js                  # AI assistant
├── voice.js                   # Voice interface
├── generate.js                # Content generation (podcasts, etc.)
├── narration.js               # Audio narration
└── photo.js                   # Photo analysis

Helpers:
helpers/
├── alfred.js                  # AI/RAG core
├── adaptiveChunking.js        # Text chunking for AI
├── streamingCoordinator.js    # Streaming responses
├── podcast-generator.js       # Podcast creation
├── nutritional-helper.js      # AI nutritional analysis
└── nutritional-helper-openai.js
```

#### **Web Scraping & Acquisition**
```
Routes:
routes/
├── scrape.js                  # Web scraping

Helpers:
helpers/
├── playdl.js                  # YouTube/media download
└── (scraping utilities)
```

#### **Specialized Content Processing**
```
Routes:
routes/
├── recipes.js                 # Recipe processing + AI images
├── workout.js                 # Workout processing
└── jfk.js                     # Special content
```

#### **Real-time & WebSocket**
```
socket/
└── (socket.io files)

socket.js                      # WebSocket server
```

#### **Monitoring**
```
helpers/
├── memoryTracker.js           # Memory monitoring
├── processingState.js         # State tracking
└── notification.js            # Notifications
```

#### **Client Applications**
```
public/                        # Static web interface
mac-client/                    # macOS voice client
ios-client/                    # iOS app
frontend/                      # Next.js frontend (if exists)
```

#### **Configuration**
```
config/
└── recordTypesForRAG.js       # AI-specific config
```

---

### **API Surface (alexandria-service)**

All data operations go through `oip-daemon-service`. Alexandria provides these enhanced endpoints:

```
═══════════════════════════════════════════════════════════════════
THE LIBRARIAN - AI Assistant
═══════════════════════════════════════════════════════════════════
POST   /api/alfred/chat               # AI conversation
POST   /api/alfred/rag                # RAG query (calls daemon for records)
GET    /api/alfred/history            # Conversation history
POST   /api/alfred/context            # Set conversation context

═══════════════════════════════════════════════════════════════════
VOICE INTERFACE
═══════════════════════════════════════════════════════════════════
POST   /api/voice/transcribe          # Speech-to-text
POST   /api/voice/synthesize          # Text-to-speech
POST   /api/voice/process             # Full voice pipeline (STT→AI→TTS)

═══════════════════════════════════════════════════════════════════
CONTENT CREATION
═══════════════════════════════════════════════════════════════════
POST   /api/generate/podcast          # Generate podcast from records
POST   /api/generate/content          # AI content generation
POST   /api/recipes/generate-image    # AI recipe image (DALL-E)
GET    /api/recipes/images/:file      # Serve generated images
POST   /api/narration/create          # Create audio narration

═══════════════════════════════════════════════════════════════════
ACQUISITION & PROCESSING
═══════════════════════════════════════════════════════════════════
POST   /api/scrape/url                # Scrape web content
POST   /api/photo/upload              # Upload photo for analysis
POST   /api/photo/analyze             # AI photo analysis
POST   /api/photo/chat                # Photo + chat integration

Specialized Publishing (with AI processing):
POST   /api/publish/newRecipe         # Recipe with ingredient lookup
POST   /api/publish/newWorkout        # Workout with exercise lookup
POST   /api/publish/lookupNutritionalInfo  # Nutritional lookup preview

═══════════════════════════════════════════════════════════════════
REAL-TIME
═══════════════════════════════════════════════════════════════════
WS     /socket.io                     # WebSocket connection
GET    /api/health/websocket          # WebSocket status

═══════════════════════════════════════════════════════════════════
HEALTH
═══════════════════════════════════════════════════════════════════
GET    /health                        # Basic health check
GET    /api/health/ai                 # AI service status (ollama, etc.)
GET    /api/health/voice              # Voice services status (TTS/STT)
```

---

### **Key Dependencies (alexandria-service)**

```json
{
  "dependencies": {
    // HTTP client (for calling oip-daemon-service)
    "axios": "^1.7.9",
    "express": "^4.19.2",
    
    // AI/LLM
    "gpt-tokenizer": "^2.1.2",
    
    // Media Processing (for content creation)
    "fluent-ffmpeg": "^2.1.3",
    "sharp": "^0.33.5",
    "canvas": "^3.1.0",
    
    // Web Scraping
    "@mendable/firecrawl-js": "^1.15.7",
    "@postlight/parser": "^2.2.3",
    "cheerio": "^1.0.0",
    "puppeteer": "^23.3.0",
    
    // Real-time
    "socket.io": "^4.8.1",
    "ws": "^8.18.1",
    
    // Auth (for validating tokens from daemon)
    "jsonwebtoken": "^9.0.2",
    
    // Utilities
    "multer": "^2.0.2",
    "uuid": "^9.0.1",
    "dotenv": "^16.4.5",
    "cors": "^2.8.5"
  }
}
```

**NOT needed in alexandria-service:**
- `@elastic/elasticsearch` (all ES queries go through daemon)
- `arweave` (publishing goes through daemon)
- `gun` (GUN operations go through daemon)
- `webtorrent` (media seeding is in daemon)
- `bip39`, `bip32` (wallet operations in daemon)

---

## 🔄 **Integration: How Alexandria Calls the Daemon**

### **OIP Client Helper** ✅ IMPLEMENTED

Alexandria uses an HTTP client to call `oip-daemon-service`. The actual implementation is more comprehensive than originally planned:

```javascript
// helpers/oipClient.js - ACTUAL IMPLEMENTATION

const axios = require('axios');

const OIP_DAEMON_URL = process.env.OIP_DAEMON_URL || 'http://oip-daemon-service:3005';

class OIPClient {
    constructor(req = null) {
        this.baseURL = OIP_DAEMON_URL;
        // Extract token from request if provided (for authenticated operations)
        this.token = req?.headers?.authorization?.replace('Bearer ', '') || null;
        
        // Create axios instance with memory-safe defaults
        this.client = axios.create({
            baseURL: this.baseURL,
            timeout: 30000,
            httpAgent: new (require('http').Agent)({ keepAlive: false }),
            maxContentLength: 50 * 1024 * 1024,
            maxBodyLength: 50 * 1024 * 1024
        });
    }

    async request(method, endpoint, data = null, params = null) {
        const config = { method, url: endpoint, headers: {} };
        if (this.token) config.headers['Authorization'] = `Bearer ${this.token}`;
        if (data) config.data = data;
        if (params) config.params = params;
        
        const response = await this.client(config);
        const result = response.data;
        response.data = null; // MEMORY LEAK FIX
        return result;
    }

    // ═══════════════════════════════════════════════════════════
    // CARD CATALOG - Record Operations
    // ═══════════════════════════════════════════════════════════
    
    async getRecords(params) {
        return this.request('GET', '/api/records', null, params);
    }

    async publishRecord(recordData, options = {}) {
        const queryParams = new URLSearchParams();
        if (options.recordType) queryParams.append('recordType', options.recordType);
        if (options.storage) queryParams.append('storage', options.storage);
        if (options.blockchain) queryParams.append('blockchain', options.blockchain);
        const endpoint = `/api/records/newRecord?${queryParams.toString()}`;
        return this.request('POST', endpoint, recordData);
    }

    async deleteRecord(did) {
        return this.request('POST', '/api/records/deleteRecord', { did });
    }

    async getRecordTypes() {
        return this.request('GET', '/api/records/recordTypes');
    }

    // NEW: Added during implementation for Alexandria→Daemon indexing
    async indexRecord(record) {
        return this.request('POST', '/api/records/index', record);
    }

    // NEW: Added during implementation for creator lookup
    async getCreatorByAddress(didAddress) {
        return this.request('GET', `/api/records/creator/${encodeURIComponent(didAddress)}`);
    }

    // ═══════════════════════════════════════════════════════════
    // CARD CATALOG - Template Operations
    // ═══════════════════════════════════════════════════════════
    
    async getTemplates() {
        return this.request('GET', '/api/templates');
    }

    async getTemplate(name) {
        return this.request('GET', `/api/templates/${name}`);
    }

    async getPublishSchema(recordType) {
        return this.request('GET', `/api/publish/schema?recordType=${recordType}`);
    }

    // ═══════════════════════════════════════════════════════════
    // SHELVES - Media Operations
    // ═══════════════════════════════════════════════════════════
    
    async uploadMedia(formData) {
        return this.client.post('/api/media/upload', formData, {
            headers: { 
                ...formData.getHeaders?.() || {},
                'Authorization': this.token ? `Bearer ${this.token}` : undefined 
            }
        }).then(res => res.data);
    }

    async createMediaRecord(mediaData) {
        return this.request('POST', '/api/media/createRecord', mediaData);
    }

    async getMediaInfo(mediaId) {
        return this.request('GET', `/api/media/${mediaId}/info`);
    }

    // ═══════════════════════════════════════════════════════════
    // ACCESS CONTROL - Organizations
    // ═══════════════════════════════════════════════════════════
    
    async getOrganizations() {
        return this.request('GET', '/api/organizations');
    }

    async getOrganization(id) {
        return this.request('GET', `/api/organizations/${id}`);
    }
}

module.exports = OIPClient;
```

**Key Enhancements from Original Plan:**

1. **Request object constructor** - Can pass Express `req` to automatically extract auth token
2. **Memory-safe axios instance** - `keepAlive: false`, response buffer cleanup
3. **`indexRecord()` method** - For Alexandria helpers that need to index (e.g., podcast-generator)
4. **`getCreatorByAddress()` method** - For creator lookup without direct ES access
5. **Additional template/media methods** - More complete API coverage

### **Example: Alfred RAG Query**

```javascript
// In alexandria-service's alfred.js route

const OIPClient = require('../helpers/oipClient');

async function handleRAGQuery(req, res) {
  const { query, recordTypes, limit } = req.body;
  const userToken = req.headers.authorization?.split(' ')[1];
  
  // Create client with user's token for private record access
  const oip = new OIPClient(userToken);
  
  // Get relevant records from daemon
  const records = await oip.getRecords({
    search: query,
    recordType: recordTypes?.join(','),
    limit: limit || 10,
    resolveDepth: 2
  });
  
  // Use records for RAG context
  const context = records.records.map(r => ({
    did: r.oip.did,
    name: r.data.basic?.name,
    content: extractContent(r)
  }));
  
  // Generate AI response with context
  const aiResponse = await generateWithContext(query, context);
  
  res.json({
    response: aiResponse,
    sources: context.map(c => c.did)
  });
}
```

---

## 🐳 **Docker Services Configuration**

### **docker-compose.yml Structure**

```yaml
services:
  # ════════════════════════════════════════════════════════════════
  # INFRASTRUCTURE (All profiles)
  # ════════════════════════════════════════════════════════════════
  
  elasticsearch:
    image: elasticsearch:8.17.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
      - "ES_JAVA_OPTS=-Xms2g -Xmx2g"
    volumes:
      - ${ELASTICSEARCH_DATA_PATH:-./elasticsearch_data}:/usr/share/elasticsearch/data
    ports:
      - "${ES_PORT:-9200}:9200"
    networks:
      - oip-network
    profiles:
      - oip-only
      - alexandria
      - alexandria-gpu
      - alexandria-macMseries
      - alexandria-decentralized
      - alexandria-decentralized-gpu
      - alexandria-decentralized-macMseries
      - chatterbox
      - alexandria-noSTT
      - alexandria-noSTT-decentralized
    
  kibana:
    image: kibana:8.17.0
    environment:
      - ELASTICSEARCH_HOSTS=http://elasticsearch:9200
    ports:
      - "${KIBANA_PORT:-5601}:5601"
    depends_on:
      - elasticsearch
    networks:
      - oip-network
    profiles:
      - oip-only
      - alexandria
      - alexandria-gpu
      - alexandria-macMseries
      - alexandria-decentralized
      - alexandria-decentralized-gpu
      - alexandria-decentralized-macMseries
      - chatterbox

  # ════════════════════════════════════════════════════════════════
  # OIP DAEMON SERVICE (Library Infrastructure)
  # ════════════════════════════════════════════════════════════════
  
  oip-daemon-service:
    build:
      context: .
      dockerfile: Dockerfile.oip-daemon
    ports:
      - "${OIP_DAEMON_PORT:-3005}:3005"
    environment:
      - ELASTICSEARCH_HOST=elasticsearch
      - ELASTICSEARCH_PORT=9200
      - GUN_PEERS=http://gun-relay:8765/gun
      - IPFS_API_URL=http://ipfs:5001
      - JWT_SECRET=${JWT_SECRET}
      - ARWEAVE_KEY_FILE=${ARWEAVE_KEY_FILE}
      - TURBO_URL=${TURBO_URL:-https://turbo.ardrive.io}
    depends_on:
      - elasticsearch
      - gun-relay
      - ipfs
    volumes:
      - ./data:/usr/src/app/data
      - ./data/media:/usr/src/app/data/media
      - ./wallets:/usr/src/app/wallets
    networks:
      - oip-network
    profiles:
      - oip-only
      - alexandria
      - alexandria-gpu
      - alexandria-macMseries
      - alexandria-decentralized
      - alexandria-decentralized-gpu
      - alexandria-decentralized-macMseries
      - chatterbox
      - alexandria-noSTT
      - alexandria-noSTT-decentralized

  gun-relay:
    build:
      context: .
      dockerfile: Dockerfile.gun-relay
    ports:
      - "${GUN_RELAY_PORT:-8765}:8765"
    environment:
      - GUN_PEERS=${GUN_EXTERNAL_PEERS:-}
    volumes:
      - gun-data:/data
    networks:
      - oip-network
    profiles:
      - oip-only
      - alexandria
      - alexandria-gpu
      - alexandria-macMseries
      - alexandria-decentralized
      - alexandria-decentralized-gpu
      - alexandria-decentralized-macMseries
      - chatterbox
      - alexandria-noSTT
      - alexandria-noSTT-decentralized

  # ════════════════════════════════════════════════════════════════
  # ALEXANDRIA SERVICE (The Librarian)
  # ════════════════════════════════════════════════════════════════
  
  alexandria-service:
    build:
      context: .
      dockerfile: Dockerfile.alexandria
    ports:
      - "${ALEXANDRIA_PORT:-3006}:3006"
    environment:
      - OIP_DAEMON_URL=http://oip-daemon-service:3005
      - OLLAMA_HOST=http://ollama:11434
      - TTS_SERVICE_URL=http://tts-service:5500
      - STT_SERVICE_URL=http://stt-service:8013
      - JWT_SECRET=${JWT_SECRET}  # Same secret for token validation
      - OPENAI_API_KEY=${OPENAI_API_KEY:-}
      - XAI_API_KEY=${XAI_API_KEY:-}
    depends_on:
      - oip-daemon-service
    volumes:
      - ./data:/usr/src/app/data
    networks:
      - oip-network
    profiles:
      - alexandria
      - alexandria-gpu
      - alexandria-macMseries
      - alexandria-decentralized
      - alexandria-decentralized-gpu
      - alexandria-decentralized-macMseries
      - alexandria-noSTT
      - alexandria-noSTT-decentralized

  # ════════════════════════════════════════════════════════════════
  # AI SERVICES (Alexandria's Tools)
  # ════════════════════════════════════════════════════════════════
  
  ollama:
    image: ollama/ollama:latest
    ports:
      - "${OLLAMA_PORT:-11434}:11434"
    volumes:
      - ollama-data:/root/.ollama
    networks:
      - oip-network
    profiles:
      - alexandria
      - alexandria-macMseries
      - alexandria-decentralized
      - alexandria-decentralized-macMseries
      - chatterbox
      - alexandria-noSTT
      - alexandria-noSTT-decentralized

  ollama-gpu:
    image: ollama/ollama:latest
    ports:
      - "${OLLAMA_PORT:-11434}:11434"
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    volumes:
      - ollama-data:/root/.ollama
    networks:
      - oip-network
    profiles:
      - alexandria-gpu
      - alexandria-decentralized-gpu

  tts-service:
    build:
      context: ./text-to-speech
    ports:
      - "${TTS_PORT:-5500}:5500"
    networks:
      - oip-network
    profiles:
      - alexandria
      - alexandria-macMseries
      - alexandria-decentralized
      - alexandria-decentralized-macMseries
      - chatterbox
      - alexandria-noSTT
      - alexandria-noSTT-decentralized

  tts-service-gpu:
    build:
      context: ./text-to-speech
      dockerfile: Dockerfile.gpu
    ports:
      - "${TTS_PORT:-5500}:5500"
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    networks:
      - oip-network
    profiles:
      - alexandria-gpu
      - alexandria-decentralized-gpu

  stt-service:
    build:
      context: ./speech-to-text
    ports:
      - "${STT_PORT:-8013}:8013"
    networks:
      - oip-network
    profiles:
      - alexandria
      - alexandria-macMseries
      - alexandria-decentralized
      - alexandria-decentralized-macMseries
      - chatterbox

  stt-service-gpu:
    build:
      context: ./speech-to-text
      dockerfile: Dockerfile.gpu
    ports:
      - "${STT_PORT:-8013}:8013"
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    networks:
      - oip-network
    profiles:
      - alexandria-gpu
      - alexandria-decentralized-gpu

  speech-synthesizer:
    build:
      context: ./speech-synthesizer
    ports:
      - "${SPEECH_SYNTHESIZER_PORT:-8082}:8082"
    networks:
      - oip-network
    profiles:
      - alexandria
      - alexandria-macMseries
      - alexandria-decentralized
      - alexandria-decentralized-macMseries
      - chatterbox
      - alexandria-noSTT
      - alexandria-noSTT-decentralized

  text-generator:
    build:
      context: ./text-generator
    environment:
      - OLLAMA_HOST=http://ollama:11434
    ports:
      - "${TEXT_GENERATOR_PORT:-8081}:8081"
    depends_on:
      - ollama
    networks:
      - oip-network
    profiles:
      - alexandria
      - alexandria-macMseries
      - alexandria-decentralized
      - alexandria-decentralized-macMseries
      - chatterbox
      - alexandria-noSTT
      - alexandria-noSTT-decentralized

  # ════════════════════════════════════════════════════════════════
  # DISTRIBUTION NETWORK SERVICES (Part of oip-daemon infrastructure)
  # ════════════════════════════════════════════════════════════════
  
  ipfs:
    image: ipfs/kubo:latest
    ports:
      - "${IPFS_API_PORT:-5001}:5001"
      - "${IPFS_GATEWAY_PORT:-8080}:8080"
    volumes:
      - ipfs-data:/data/ipfs
    networks:
      - oip-network
    profiles:
      - oip-only
      - alexandria
      - alexandria-gpu
      - alexandria-macMseries
      - alexandria-decentralized
      - alexandria-decentralized-gpu
      - alexandria-decentralized-macMseries
      - chatterbox
      - alexandria-noSTT
      - alexandria-noSTT-decentralized

  # ════════════════════════════════════════════════════════════════
  # DECENTRALIZED INFRASTRUCTURE (Local Arweave Gateway)
  # ════════════════════════════════════════════════════════════════
  
  ario-gateway:
    image: ghcr.io/ar-io/ar-io-core:latest
    ports:
      - "${ARIO_GATEWAY_PORT:-4000}:4000"
    volumes:
      - ${ARIO_GATEWAY_DATA_PATH:-./ario_gateway_data}:/app/data
    environment:
      - PORT=4000
      - GRAPHQL_ENABLED=true
      - START_HEIGHT=${START_HEIGHT}
    networks:
      - oip-network
    profiles:
      - alexandria-decentralized
      - alexandria-decentralized-gpu
      - alexandria-decentralized-macMseries
      - alexandria-noSTT-decentralized

  # ════════════════════════════════════════════════════════════════
  # NETWORK ACCESS (ngrok tunnel)
  # ════════════════════════════════════════════════════════════════

  ngrok:
    image: ngrok/ngrok:latest
    command: http oip-daemon-service:3005 --domain=${NGROK_DOMAIN}
    environment:
      - NGROK_AUTHTOKEN=${NGROK_AUTH_TOKEN}
    depends_on:
      - oip-daemon-service
    ports:
      - "${NGROK_DASHBOARD_PORT:-4040}:4040"
    networks:
      - oip-network
    profiles:
      - oip-only
      - alexandria
      - alexandria-gpu
      - alexandria-macMseries
      - alexandria-decentralized
      - alexandria-decentralized-gpu
      - alexandria-decentralized-macMseries
      - chatterbox
      - alexandria-noSTT
      - alexandria-noSTT-decentralized

volumes:
  gun-data:
  ollama-data:
  ipfs-data:

networks:
  oip-network:
    name: ${COMPOSE_PROJECT_NAME:-oip-arweave-indexer}_oip-network
    driver: bridge
```

---

## 📋 **Profile Summary**

### **Profile Migration Map: Old → New**

This section explains exactly what happens to each existing profile.

#### **Profiles Being Renamed/Evolved**

| Old Profile | New Profile | Changes |
|-------------|-------------|---------|
| `minimal` | **`oip-only`** | + IPFS added, + ngrok added. Now includes full media distribution infrastructure. |
| `standard` | **`alexandria`** | Splits into oip-daemon-service + alexandria-service. Same functionality, microservices architecture. |
| `standard-gpu` | **`alexandria-gpu`** | Same as above with GPU acceleration. |
| `standard-macMseries` | **`alexandria-macMseries`** | Same as above optimized for Apple Silicon. |
| `max-decentralized` | **`alexandria-decentralized`** | Splits into microservices + keeps AR.IO gateway. |
| `max-decentralized-gpu` | **`alexandria-decentralized-gpu`** | Same as above with GPU. |
| `backend-only` | **`alexandria-noSTT`** | Renamed for clarity. Alexandria stack without STT service. |

#### **New Profiles Being Added**

| New Profile | Purpose |
|-------------|---------|
| **`alexandria-decentralized-macMseries`** | Full stack + AR.IO gateway optimized for Apple Silicon (didn't exist before) |
| **`alexandria-noSTT-decentralized`** | Alexandria-noSTT + AR.IO gateway (didn't exist before) |

#### **Profiles Being Removed**

| Old Profile | Reason for Removal | Migration Path |
|-------------|-------------------|----------------|
| `minimal-with-scrape` | No use case for lightweight + scraping | Use `oip-only` (no scraping) or `alexandria` (full stack with scraping) |
| `standard-monolithic` | Legacy single-container approach | Use `alexandria` (distributed microservices) |
| `gpu` | Intermediate GPU profile, redundant | Use `alexandria-gpu` |
| `oip-gpu-only` | Edge case, minimal GPU | Use `oip-only` (CPU) or `alexandria-gpu` (full GPU) |
| `chatterbox-gpu` | Doesn't work properly | Use `alexandria-gpu` with Chatterbox installed |

#### **Profiles Being Kept As-Is**

| Profile | Reason |
|---------|--------|
| `chatterbox` | Specific voice quality focus, still useful |

---

### **New Profile Structure**

| Profile | Based On | Services Included | Use Case |
|---------|----------|-------------------|----------|
| **`oip-only`** | minimal | elasticsearch, kibana, oip-daemon-service, gun-relay, ipfs, ngrok | Pure OIP daemon - indexing, publishing, media distribution only |
| **`alexandria`** | standard | oip-only + alexandria-service, ollama (CPU), tts, stt, speech-synthesizer, text-generator | Full stack with AI/voice (CPU) |
| **`alexandria-gpu`** | standard-gpu | oip-only + alexandria-service, ollama-gpu, tts-gpu, stt-gpu | Full stack with GPU acceleration |
| **`alexandria-macMseries`** | standard-macMseries | oip-only + alexandria-service, ollama (Metal), tts, stt | Full stack optimized for Apple Silicon |
| **`alexandria-decentralized`** | max-decentralized | alexandria + **ario-gateway** | Full stack + local Arweave gateway (CPU) |
| **`alexandria-decentralized-gpu`** | max-decentralized-gpu | alexandria-gpu + **ario-gateway** | Full stack + local Arweave gateway (GPU) |
| **`alexandria-decentralized-macMseries`** | (new) | alexandria-macMseries + **ario-gateway** | Full stack + local Arweave gateway (Apple Silicon) |
| **`alexandria-noSTT`** | backend-only | alexandria minus stt-service | For Mac/iOS clients with local STT |
| **`alexandria-noSTT-decentralized`** | (new) | alexandria-noSTT + **ario-gateway** | Alexandria-noSTT + local Arweave gateway |
| **`chatterbox`** | (unchanged) | Standard with Chatterbox TTS focus | Specific voice quality focus |

### **Profile Service Matrix**

```
                          oip-  alexan-  alexan-  alexan-  alexan-  alexan-  alexan-  chatter- alexan-  alexan-
Service                   only  dria     dria-gpu dria-mac decentr  decentr  decentr  box      dria-    dria-noSTT
                                                  Mseries           -gpu     -macM             noSTT    -decentr
───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
elasticsearch              ✓      ✓        ✓        ✓        ✓        ✓        ✓        ✓        ✓        ✓
kibana                     ✓      ✓        ✓        ✓        ✓        ✓        ✓        ✓        ✓        ✓
oip-daemon-service         ✓      ✓        ✓        ✓        ✓        ✓        ✓        ✓        ✓        ✓
gun-relay                  ✓      ✓        ✓        ✓        ✓        ✓        ✓        ✓        ✓        ✓
ipfs                       ✓      ✓        ✓        ✓        ✓        ✓        ✓        ✓        ✓        ✓
ngrok                      ✓      ✓        ✓        ✓        ✓        ✓        ✓        ✓        ✓        ✓
alexandria-service                ✓        ✓        ✓        ✓        ✓        ✓                 ✓        ✓
ollama (CPU)                      ✓                 ✓        ✓                 ✓        ✓        ✓        ✓
ollama-gpu                                 ✓                          ✓                          
tts-service                       ✓                 ✓        ✓                 ✓        ✓        ✓        ✓
tts-service-gpu                            ✓                          ✓                          
stt-service                       ✓                 ✓        ✓                 ✓        ✓        
stt-service-gpu                            ✓                          ✓                          
speech-synthesizer                ✓                 ✓        ✓                 ✓        ✓        ✓        ✓
text-generator                    ✓                 ✓        ✓                 ✓        ✓        ✓        ✓
ario-gateway                                                 ✓        ✓        ✓                          ✓
```

**Key difference for `alexandria-noSTT` profiles:**
- ❌ No `stt-service` - Speech-to-text runs on the native Mac/iOS client
- ✅ Has `alexandria-service` - Full AI/RAG capabilities
- ✅ Has `tts-service` - Server generates audio output for client playback

### **alexandria-noSTT Profile Details**

The `alexandria-noSTT` profile (formerly `backend-only`) is **alexandria without speech-to-text**:

**Server-side (Docker backend):**
- oip-daemon-service (full OIP functionality)
- alexandria-service (AI/RAG/content generation)
- Elasticsearch (records/search)
- Ollama (LLM for RAG queries)
- TTS service (text-to-speech output)
- All other alexandria services EXCEPT STT

**Client-side (Mac/iOS native):**
- STT (Speech-to-Text via Apple APIs)
- VAD (Voice Activity Detection)
- Smart Turn detection

**Use Case:** Mac/iOS clients with capable hardware that want to:
- Handle audio INPUT locally (better latency, privacy, Apple's optimized APIs)
- Use server for RAG/AI processing and content generation
- Receive TTS audio OUTPUT from server for playback

**Variants:**
- `alexandria-noSTT` - Standard (CPU-based AI)
- `alexandria-noSTT-decentralized` - Adds local AR.IO gateway

---

## 🔧 **BitTorrent Service Note**

**Current State:** BitTorrent functionality is embedded in the OIP daemon via the `webtorrent` npm package:
- `services/mediaSeeder.js` - WebTorrent client for persistent seeding
- `helpers/media-manager.js` - Creates torrents during media processing

**Future Enhancement:** Consider extracting to a separate `bittorrent-service` Docker container with HTTP API for better isolation and scalability. This would require:
1. New `bittorrent-service/` directory with dedicated WebTorrent server
2. HTTP API for seed/unseed/status operations
3. Addition to docker-compose.yml profiles

For now, WebTorrent runs inside the OIP daemon container, which works fine for most deployments.

---

## 📦 **Migration Strategy**

### **Phase 1: Create Dockerfiles** ✅ COMPLETE

1. **Create `Dockerfile.oip-daemon`** ✅
   - Node.js 20 Alpine image with native deps for GUN, WebTorrent
   - Optimized dependencies (package-daemon.json)
   - Memory leak fixes integrated in entrypoint
   - Entry point: `index-daemon.js`

2. **Create `Dockerfile.alexandria`** ✅
   - Node.js 20 with Puppeteer, canvas, sharp, ffmpeg
   - Separate dependency file (package-alexandria.json)
   - oipClient for daemon communication
   - Entry point: `index-alexandria.js`

3. **Existing `Dockerfile.gun-relay`** ✅
   - Already exists, no changes needed

### **Phase 2: Split Entry Points** ✅ COMPLETE

1. **Create `index-daemon.js`** ✅
   - Loads all daemon routes from `routes/daemon/`
   - Initializes GUN sync service
   - Starts media seeder
   - Memory-safe HTTP agent configuration
   - Listens on port 3005

2. **Create `index-alexandria.js`** ✅
   - Loads all Alexandria routes from `routes/alexandria/`
   - Initializes oipClient connection to daemon
   - Configures WebSocket server
   - Listens on port 3006

3. **Create `helpers/oipClient.js`** ✅
   - Full HTTP client for daemon communication
   - Methods: getRecords, publishRecord, deleteRecord, getTemplates, uploadMedia, indexRecord, getCreatorByAddress, and more
   - Memory leak prevention (response buffer cleanup)

### **Phase 3: Refactor Routes** ✅ COMPLETE

1. **Reorganize route files** ✅
   - Created `routes/daemon/` with: api.js, records.js, templates.js, creators.js, user.js, wallet.js, publish.js, media.js, organizations.js, cleanup.js, health.js
   - Created `routes/alexandria/` with: alfred.js, voice.js, generate.js, narration.js, photo.js, scrape.js, recipes.js, workout.js, jfk.js, notes.js

2. **Fix all import paths** ✅
   - Audited and corrected all relative imports
   - Updated helper paths for new directory structure

3. **Refactor Alexandria routes to use oipClient** ✅
   - workout.js: Uses oipClient.getRecords() and oipClient.publishRecord()
   - recipes.js: Uses oipClient.getRecords() for ingredient lookup
   - notes.js: Uses oipClient.getRecords() for record retrieval
   - jfk.js: Uses oipClient.getRecords() for record retrieval
   - scrape.js: Uses oipClient.request() for publishing operations

4. **Technical debt resolved** ✅
   - Extracted `resolveRecipeIngredients` to `helpers/core/recipe-resolver.js`
   - Moved `/test-rag` endpoint from daemon to Alexandria alfred.js
   - Added daemon endpoints for indexRecord and creator lookup

### **Phase 4: Update Docker Compose Profiles** ✅ COMPLETE

1. **Created `docker-compose-split.yml`** ✅
   - New service definitions for oip-daemon-service and alexandria-service
   - All profiles configured: oip-only, alexandria, alexandria-gpu, etc.
   - Proper dependency ordering

2. **Created `Makefile.split`** ✅
   - New profile targets matching docker-compose-split.yml
   - Service-specific operations (logs-daemon, restart-alexandria, etc.)
   - Testing targets (test-daemon, test-alexandria, test-integration)
   - Backwards compatibility aliases

### **Phase 5: Testing & Documentation** 🔄 PENDING

1. ⏳ Test daemon independently (oip-only profile)
2. ⏳ Test Alexandria with daemon
3. ⏳ Test full stack (alexandria-gpu)
4. ✅ Update API documentation (this document)
5. ✅ Create migration guide (included in this document)

---

## 🎯 **Benefits of This Architecture**

### **For oip-daemon-service:**
✅ **Complete Library**: All index + distribution + access control  
✅ **Self-Contained**: Can run alone for pure OIP use cases  
✅ **Stable API**: Core operations rarely need changes  
✅ **Network-Ready**: GUN sync, BitTorrent seeding built-in  

### **For alexandria-service:**
✅ **Focused**: Only AI, voice, and content processing  
✅ **Lightweight**: No blockchain/P2P complexity  
✅ **Flexible**: Easy to swap AI providers  
✅ **User-Facing**: All interactive features  

### **For Operations:**
✅ **Single Deployment**: One `make alexandria` command  
✅ **Profile Flexibility**: Run minimal for testing, full for production  
✅ **Clear Boundaries**: Know which service handles what  
✅ **Independent Scaling**: Scale AI services separately  

---

## 🚀 **Directory Structure After Split** ✅ IMPLEMENTED

```
oip-arweave-indexer/
├── config/                    # Shared configuration
├── helpers/
│   ├── core/                  # Daemon helpers ✅
│   │   ├── arweave.js
│   │   ├── arweave-wallet.js
│   │   ├── elasticsearch.js
│   │   ├── templateHelper.js
│   │   ├── gun.js
│   │   ├── gunSyncService.js
│   │   ├── media-manager.js
│   │   ├── organizationEncryption.js
│   │   ├── recipe-resolver.js     # NEW - shared helper for recipe ingredients
│   │   ├── sharedState.js
│   │   └── ...
│   ├── alexandria/            # Alexandria helpers ✅
│   │   ├── alfred.js
│   │   ├── podcast-generator.js   # Updated to use oipClient
│   │   ├── nutritional-helper.js
│   │   ├── nutritional-helper-openai.js
│   │   └── ...
│   ├── oipClient.js           # HTTP client for daemon ✅ (in helpers root)
│   └── utils.js               # Shared utilities
├── routes/
│   ├── daemon/                # Daemon routes ✅
│   │   ├── api.js
│   │   ├── records.js         # Includes new /index and /creator endpoints
│   │   ├── templates.js
│   │   ├── creators.js
│   │   ├── user.js
│   │   ├── wallet.js
│   │   ├── publish.js
│   │   ├── media.js
│   │   ├── organizations.js
│   │   ├── cleanup.js
│   │   └── health.js
│   └── alexandria/            # Alexandria routes ✅
│       ├── alfred.js          # Includes /test-rag moved from daemon
│       ├── voice.js
│       ├── generate.js
│       ├── narration.js
│       ├── photo.js
│       ├── scrape.js          # Refactored to use oipClient for publishing
│       ├── recipes.js         # Refactored to use oipClient
│       ├── workout.js         # Refactored to use oipClient
│       ├── jfk.js             # Refactored to use oipClient
│       └── notes.js           # Refactored to use oipClient
├── services/                  # Daemon background services
│   └── mediaSeeder.js
├── middleware/                # Shared middleware
│   └── auth.js
├── scripts/                   # NEW - Docker entrypoint scripts ✅
│   ├── docker-entrypoint-daemon.sh
│   └── docker-entrypoint-alexandria.sh
├── docs/
├── public/                    # Static web interface
├── mac-client/
├── text-to-speech/
├── speech-to-text/
│
├── index.js                   # Original monolithic entry (kept for reference)
├── index-daemon.js            # Daemon entry point ✅
├── index-alexandria.js        # Alexandria entry point ✅
├── gun-relay-server.js
│
├── Dockerfile                 # Original monolithic Dockerfile
├── Dockerfile.oip-daemon      # NEW - Daemon Dockerfile ✅
├── Dockerfile.alexandria      # NEW - Alexandria Dockerfile ✅
├── Dockerfile.gun-relay
├── docker-compose.yml         # Original docker-compose
├── docker-compose-split.yml   # NEW - Split services compose ✅
├── Makefile                   # Original Makefile
├── Makefile.split             # NEW - Split services Makefile ✅
├── package.json               # Original full dependencies
├── package-daemon.json        # NEW - Daemon dependencies ✅
├── package-alexandria.json    # NEW - Alexandria dependencies ✅
└── README.md
```

---

## 📋 **Makefile Commands**

```makefile
# ════════════════════════════════════════════════════════════════
# PRIMARY PROFILES
# ════════════════════════════════════════════════════════════════

oip-only:                   ## Deploy: Core OIP daemon only (indexing, publishing, media)
	@make up PROFILE=oip-only

alexandria:                 ## Deploy: Full stack with AI, voice (CPU)
	@make up PROFILE=alexandria
	@make install-models
	@make install-chatterbox

alexandria-gpu:             ## Deploy: Full stack with GPU acceleration
	@make up PROFILE=alexandria-gpu
	@make install-models
	@make install-chatterbox

alexandria-macMseries:      ## Deploy: Full stack optimized for Apple Silicon
	@make up PROFILE=alexandria-macMseries
	@make install-models
	@make install-chatterbox

# ════════════════════════════════════════════════════════════════
# DECENTRALIZED PROFILES (includes local AR.IO gateway)
# ════════════════════════════════════════════════════════════════

alexandria-decentralized:   ## Deploy: Full stack + local Arweave gateway (CPU)
	@make up PROFILE=alexandria-decentralized
	@make install-models
	@make install-chatterbox

alexandria-decentralized-gpu: ## Deploy: Full stack + local Arweave gateway (GPU)
	@make up PROFILE=alexandria-decentralized-gpu
	@make install-models
	@make install-chatterbox

alexandria-decentralized-macMseries: ## Deploy: Full stack + local Arweave gateway (Apple Silicon)
	@make up PROFILE=alexandria-decentralized-macMseries
	@make install-models
	@make install-chatterbox

# ════════════════════════════════════════════════════════════════
# SPECIALIZED PROFILES
# ════════════════════════════════════════════════════════════════

chatterbox:                 ## Deploy: Standard with Chatterbox TTS focus (CPU)
	@make up PROFILE=chatterbox
	@make install-chatterbox

alexandria-noSTT:           ## Deploy: Alexandria without STT (for Mac/iOS clients with local STT)
	@make up PROFILE=alexandria-noSTT
	@make install-models
	@make install-chatterbox

alexandria-noSTT-decentralized: ## Deploy: Alexandria-noSTT + local Arweave gateway
	@make up PROFILE=alexandria-noSTT-decentralized
	@make install-models
	@make install-chatterbox

# ════════════════════════════════════════════════════════════════
# SERVICE-SPECIFIC OPERATIONS
# ════════════════════════════════════════════════════════════════

logs-daemon:               ## Show oip-daemon-service logs
	docker-compose logs -f oip-daemon-service

logs-alexandria:           ## Show alexandria-service logs
	docker-compose logs -f alexandria-service

restart-daemon:            ## Restart oip-daemon-service
	docker-compose restart oip-daemon-service

restart-alexandria:        ## Restart alexandria-service
	docker-compose restart alexandria-service

shell-daemon:              ## Shell into oip-daemon-service
	docker-compose exec oip-daemon-service /bin/bash

shell-alexandria:          ## Shell into alexandria-service
	docker-compose exec alexandria-service /bin/bash

# ════════════════════════════════════════════════════════════════
# TESTING
# ════════════════════════════════════════════════════════════════

test-daemon:               ## Test oip-daemon-service endpoints
	@echo "Testing daemon health..."
	curl -s http://localhost:3005/health | jq .
	@echo "\nTesting records endpoint..."
	curl -s "http://localhost:3005/api/records?limit=1" | jq '.total'
	@echo "\nTesting GUN sync..."
	curl -s http://localhost:3005/api/health/gun-sync | jq '.status'
	@echo "\nTesting IPFS..."
	curl -s http://localhost:5001/api/v0/id | jq '.ID'

test-alexandria:           ## Test alexandria-service endpoints
	@echo "Testing alexandria health..."
	curl -s http://localhost:3006/health | jq .
	@echo "\nTesting AI status..."
	curl -s http://localhost:3006/api/health/ai | jq '.status'

test-integration:          ## Test daemon-alexandria integration
	@echo "Testing alexandria -> daemon communication..."
	curl -s -X POST http://localhost:3006/api/alfred/rag \
	  -H "Content-Type: application/json" \
	  -d '{"query": "test query", "limit": 1}' | jq '.sources'

# ════════════════════════════════════════════════════════════════
# BACKWARDS COMPATIBILITY (maps to new profiles)
# These aliases allow existing deployments to continue working
# ════════════════════════════════════════════════════════════════

minimal: oip-only           ## Alias: minimal -> oip-only
standard: alexandria        ## Alias: standard -> alexandria
standard-gpu: alexandria-gpu ## Alias: standard-gpu -> alexandria-gpu
standard-macMseries: alexandria-macMseries ## Alias: standard-macMseries -> alexandria-macMseries
max-decentralized: alexandria-decentralized ## Alias: max-decentralized -> alexandria-decentralized
max-decentralized-gpu: alexandria-decentralized-gpu ## Alias
```

---

## ⚠️ **Migration Notes for Existing Deployments**

### **Backwards Compatibility Aliases**

Old profile names are aliased to new names so existing deployments continue working:

| Old Command | Maps To | Notes |
|-------------|---------|-------|
| `make minimal` | `make oip-only` | ✅ Works, now includes IPFS |
| `make standard` | `make alexandria` | ✅ Works, same functionality |
| `make standard-gpu` | `make alexandria-gpu` | ✅ Works, same functionality |
| `make standard-macMseries` | `make alexandria-macMseries` | ✅ Works, same functionality |
| `make max-decentralized` | `make alexandria-decentralized` | ✅ Works, same functionality |
| `make max-decentralized-gpu` | `make alexandria-decentralized-gpu` | ✅ Works, same functionality |
| `make backend-only` | `make alexandria-noSTT` | ✅ Renamed for clarity |
| `make minimal-with-scrape` | ❌ Removed | Use `oip-only` or `alexandria` |
| `make standard-monolithic` | ❌ Removed | Use `alexandria` |
| `make gpu` | ❌ Removed | Use `alexandria-gpu` |
| `make oip-gpu-only` | ❌ Removed | Use `oip-only` or `alexandria-gpu` |
| `make chatterbox-gpu` | ❌ Removed | Use `alexandria-gpu` |
| `make chatterbox` | ✅ Unchanged | Still works as before |

### **Environment Variables**

New variables to add to `.env`:
```bash
# Service ports
OIP_DAEMON_PORT=3005
ALEXANDRIA_PORT=3006

# Internal service URL (Docker network)
OIP_DAEMON_URL=http://oip-daemon-service:3005
```

### **Data Migration**

No data migration required - both services share the same Elasticsearch instance and data volumes.

### **External API Access**

- **Port 3005** (`oip-daemon-service`): Core OIP operations, media streaming
- **Port 3006** (`alexandria-service`): AI chat, voice, content generation

For single-endpoint access, use ngrok pointed at port 3005 (daemon), and have Alexandria's AI features accessed directly or proxied through your frontend.

### **Summary: What Changed**

1. **Architecture**: Monolithic OIP → `oip-daemon-service` + `alexandria-service` microservices
2. **Profile Names**: `minimal` → `oip-only`, `standard*` → `alexandria*`, `max-decentralized*` → `alexandria-decentralized*`
3. **oip-only Improvements**: Now includes IPFS and ngrok (was missing in `minimal`)
4. **New Profiles**: `alexandria-decentralized-macMseries`, `alexandria-noSTT-decentralized`
5. **Removed Profiles**: `minimal-with-scrape`, `standard-monolithic`, `gpu`, `oip-gpu-only`, `chatterbox-gpu`
6. **Renamed**: `backend-only` → `alexandria-noSTT` (clearer name)
