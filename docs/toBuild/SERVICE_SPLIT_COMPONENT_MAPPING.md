# OIP Service Split - Component Mapping

## Overview

This document maps every file in the current monolithic application to its destination service in the split architecture. It also identifies memory leak patterns to fix during migration.

---

## 🎯 Service Destinations

### Legend
- 🔵 **DAEMON** → `oip-daemon-service` (port 3005)
- 🟣 **ALEXANDRIA** → `alexandria-service` (port 3006)
- ⚪ **SHARED** → Used by both services
- 🔴 **DEPRECATED** → Remove during migration
- ⚠️ **MEMORY LEAK** → Known memory leak pattern to fix

---

## 📁 Routes Mapping

### Core OIP Routes → DAEMON (🔵)

| File | Service | Endpoints | Notes |
|------|---------|-----------|-------|
| `routes/api.js` | 🔵 DAEMON | `GET /api` | Root API info |
| `routes/records.js` | 🔵 DAEMON | `GET /api/records`, `POST /api/records/newRecord`, etc. | Core CRUD operations |
| `routes/templates.js` | 🔵 DAEMON | `GET /api/templates`, `POST /api/templates/new` | Template management |
| `routes/creators.js` | 🔵 DAEMON | `GET /api/creators`, `POST /api/creators/register` | Creator management |
| `routes/organizations.js` | 🔵 DAEMON | `GET/POST /api/organizations/*` | Organization management |
| `routes/media.js` | 🔵 DAEMON | `POST /api/media/upload`, `GET /api/media/:id` | Media upload/streaming ⚠️ |
| `routes/publish.js` | 🔵 DAEMON | `POST /api/publish/newPost`, `newImage`, `newVideo`, etc. | Record publishing |
| `routes/user.js` | 🔵 DAEMON | `POST /api/user/register`, `login`, `import-wallet` | HD wallet auth |
| `routes/wallet.js` | 🔵 DAEMON | `POST /api/wallet/generate`, `import` | Wallet operations |
| `routes/cleanup.js` | 🔵 DAEMON | `GET/POST /api/cleanup/*` | Template cleanup |
| `routes/admin.js` | 🔵 DAEMON | `GET/POST /api/admin/*` | Admin operations |

### AI/Voice Routes → ALEXANDRIA (🟣)

| File | Service | Endpoints | Notes |
|------|---------|-----------|-------|
| `routes/alfred.js` | 🟣 ALEXANDRIA | Re-exports voice.js | Alias for voice routes |
| `routes/voice.js` | 🟣 ALEXANDRIA | `POST /api/voice/*`, `POST /api/alfred/*` | AI chat, STT/TTS ⚠️ |
| `routes/scrape.js` | 🟣 ALEXANDRIA | `POST /api/scrape/url` | Web scraping |
| `routes/generate.js` | 🟣 ALEXANDRIA | `POST /api/generate/podcast`, etc. | Content generation |
| `routes/photo.js` | 🟣 ALEXANDRIA | `POST /api/photo/upload`, `analyze` | Photo analysis (Grok) |
| `routes/recipes.js` | 🟣 ALEXANDRIA | `POST /api/recipes/generate-image` | AI recipe images |
| `routes/narration.js` | 🟣 ALEXANDRIA | `POST /api/narration/create` | Audio narration |
| `routes/workout.js` | 🟣 ALEXANDRIA | `POST /api/workout/*` | Workout processing |
| `routes/notes.js` | 🟣 ALEXANDRIA | `GET/POST /api/notes/*` | Alfred Meeting Notes |
| `routes/jfk.js` | 🟣 ALEXANDRIA | Special content | JFK content processing |
| `routes/documentation.js` | 🟣 ALEXANDRIA | `GET /api/documentation/*` | API docs serving |

### Health Routes → SPLIT (⚪)

| File | Current | Split Strategy |
|------|---------|----------------|
| `routes/health.js` | Monolithic | Split into daemon-health.js and alexandria-health.js |

**Daemon health endpoints:**
- `GET /health` - Basic health
- `GET /api/health/gun-sync` - GUN sync status
- `POST /api/health/gun-sync/force` - Force sync
- `GET /api/health/memory` - Memory status
- `POST /api/health/memory/clear-cache` - Clear GUN cache
- `GET /api/health/memory/analyze` - Memory analysis
- `POST /api/health/graphql/recreate-client` - GraphQL client

**Alexandria health endpoints:**
- `GET /health` - Basic health
- `GET /api/health/ai` - Ollama/LLM status
- `GET /api/health/voice` - TTS/STT services status

### Deprecated Routes (🔴)

| File | Reason |
|------|--------|
| `routes/scrape_old.js` | Old version, remove |
| `routes/voice_old.js` | Old version, remove |
| `routes/publish.mjs` | ESM duplicate, remove |
| `routes/lit.js` | Lit Protocol - not currently used |

---

## 📁 Helpers Mapping

### Core Helpers → DAEMON (🔵)

| File | Service | Purpose | Memory Notes |
|------|---------|---------|--------------|
| `helpers/arweave.js` | 🔵 DAEMON | Blockchain integration | |
| `helpers/arweave-wallet.js` | 🔵 DAEMON | Wallet management | |
| `helpers/elasticsearch.js` | 🔵 DAEMON | ES indexing/search | ⚠️ Needs periodic client recreation |
| `helpers/templateHelper.js` | 🔵 DAEMON | Template processing | |
| `helpers/dref-resolver.js` | 🔵 DAEMON | Reference resolution | |
| `helpers/generators.js` | 🔵 DAEMON | ID generation | |
| `helpers/gun.js` | 🔵 DAEMON | GUN database | ⚠️ 404 cache fix applied |
| `helpers/gunSyncService.js` | 🔵 DAEMON | Cross-node sync | ⚠️ Deletion loop fix |
| `helpers/gunDeletionRegistry.js` | 🔵 DAEMON | Deletion tracking | ⚠️ Reprocessing prevention |
| `helpers/oipGunRegistry.js` | 🔵 DAEMON | Record registry | |
| `helpers/privateRecordHandler.js` | 🔵 DAEMON | Encrypted records | |
| `helpers/organizationEncryption.js` | 🔵 DAEMON | Org encryption | |
| `helpers/organizationDecryptionQueue.js` | 🔵 DAEMON | Decryption queue | |
| `helpers/media-manager.js` | 🔵 DAEMON | Media processing | |
| `helpers/ipfs.js` | 🔵 DAEMON | IPFS integration | |
| `helpers/sharedState.js` | 🔵 DAEMON | State management | |
| `helpers/file.js` | 🔵 DAEMON | File operations | |
| `helpers/urlHelper.js` | 🔵 DAEMON | URL utilities | |
| `helpers/utils.js` | ⚪ SHARED | General utilities | Auth functions needed by both |
| `helpers/apiConfig.js` | 🔵 DAEMON | API configuration | |

### AI/Voice Helpers → ALEXANDRIA (🟣)

| File | Service | Purpose | Memory Notes |
|------|---------|---------|--------------|
| `helpers/alfred.js` | 🟣 ALEXANDRIA | AI/RAG core | ⚠️ Context accumulation |
| `helpers/adaptiveChunking.js` | 🟣 ALEXANDRIA | Text chunking | |
| `helpers/streamingCoordinator.js` | 🟣 ALEXANDRIA | Stream management | |
| `helpers/podcast-generator.js` | 🟣 ALEXANDRIA | Podcast creation | |
| `helpers/nutritional-helper.js` | 🟣 ALEXANDRIA | AI nutritional analysis | |
| `helpers/nutritional-helper-openai.js` | 🟣 ALEXANDRIA | OpenAI nutritional | |
| `helpers/playdl.js` | 🟣 ALEXANDRIA | YouTube download | |
| `helpers/memoryTracker.js` | ⚪ SHARED | Memory monitoring | ⚠️ Circuit breaker needed |
| `helpers/memoryDiagnostics.js` | ⚪ SHARED | Memory diagnostics | |
| `helpers/processingState.js` | 🔵 DAEMON | Processing flags | Used by keepDBUpToDate |
| `helpers/notification.js` | 🟣 ALEXANDRIA | Notifications | |
| `helpers/jobTracker.js` | 🟣 ALEXANDRIA | Job tracking | |

### Payment/Special Helpers → DAEMON (🔵)

| File | Service | Purpose | Notes |
|------|---------|---------|-------|
| `helpers/payment-manager.js` | 🔵 DAEMON | Payment processing | Future feature |
| `helpers/payment-verification.js` | 🔵 DAEMON | Payment verification | Future feature |
| `helpers/publisher-manager.js` | 🔵 DAEMON | Publisher management | |
| `helpers/lit-protocol.js` | 🔵 DAEMON | Lit Protocol | Not actively used |
| `helpers/mint-pkp.js` | 🔵 DAEMON | PKP minting | Not actively used |

### Deprecated Helpers (🔴)

| File | Reason |
|------|--------|
| `helpers/arweave-wallet 2.js` | Duplicate |
| `helpers/elasticsearch_fromOldServer.js` | Legacy |
| `helpers/elasticsearch.js.bak` | Backup |
| `helpers/templateHelper_fromOldServer.js` | Legacy |
| `helpers/test-nutritional-helper.js` | Test file |
| `helpers/migrate-nutritional-helper.js` | Migration script |
| `helpers/nutritional-helper.js.backup` | Backup |
| `helpers/generateElasticsearchMappings.js` | One-time script |

---

## 📁 Services Mapping

| File | Service | Purpose | Memory Notes |
|------|---------|---------|--------------|
| `services/mediaSeeder.js` | 🔵 DAEMON | BitTorrent/WebTorrent | Persistent seeding |
| `services/chunkingService.js` | 🟣 ALEXANDRIA | AI text chunking | |
| `services/notesRecordsService.js` | 🟣 ALEXANDRIA | Notes processing | |
| `services/sttService.js` | 🟣 ALEXANDRIA | STT integration | |
| `services/summarizationService.js` | 🟣 ALEXANDRIA | AI summarization | |
| `services/swapDataService.js` | 🔵 DAEMON | Swap data | Review needed |

---

## 📁 Config Mapping

| File | Service | Purpose |
|------|---------|---------|
| `config/arweave.config.js` | 🔵 DAEMON | Arweave connection |
| `config/checkEnvironment.js` | ⚪ SHARED | Environment validation |
| `config/createIndices.js` | 🔵 DAEMON | ES index setup |
| `config/templates.config.js` | 🔵 DAEMON | Template mappings |
| `config/recordTypesToIndex.js` | 🔵 DAEMON | Index config |
| `config/recordTypesForRAG.js` | 🟣 ALEXANDRIA | RAG config |
| `config/createAdmin.js` | 🔵 DAEMON | Admin creation |
| `config/generateToken.js` | 🔵 DAEMON | Token generation |
| `config/generateWallet.js` | 🔵 DAEMON | Wallet generation |
| `config/migrateGunSupport.js` | 🔵 DAEMON | GUN migration |
| `config/updateElasticsearchMappings.js` | 🔵 DAEMON | ES mappings |
| `config/testToken.js` | 🔴 DEPRECATED | Test utility |

---

## 📁 Middleware Mapping

| File | Service | Purpose |
|------|---------|---------|
| `middleware/auth.js` | ⚪ SHARED | JWT authentication |
| `middleware/apiLogger.js` | ⚪ SHARED | Request logging |
| `middleware/activityLogger.js` | ⚪ SHARED | Activity tracking |
| `middleware/memoryTrackingMiddleware.js` | ⚪ SHARED | Memory tracking |

---

## ⚠️ Memory Leak Patterns to Fix During Migration

### 1. Stream Cleanup (CRITICAL)
**Location**: All file streaming code
**Pattern**: `fs.createReadStream()` without cleanup handlers
**Fix**:
```javascript
const stream = fs.createReadStream(filePath);

// ALWAYS add these handlers
stream.on('error', (err) => {
    console.error('Stream error:', err);
    stream.destroy();
});

stream.on('end', () => {
    if (global.gc && fileSize > 100 * 1024) {
        setImmediate(() => global.gc());
    }
});

res.on('close', () => {
    if (!stream.destroyed) {
        stream.destroy();
    }
});

stream.pipe(res);
```

### 2. Axios Response Cleanup (CRITICAL)
**Location**: All axios calls
**Pattern**: Response buffers not cleaned up
**Fix**:
```javascript
try {
    const response = await axios.get(url);
    const data = response.data; // Copy what you need
    
    // Immediately null the response
    response.data = null;
    
    return data;
} catch (error) {
    if (error.response) {
        error.response.data = null;
        error.response = null;
    }
    throw error;
}
```

### 3. Map/Set Cache Cleanup (IMPORTANT)
**Location**: Any caching with Map/Set
**Pattern**: Unbounded cache growth
**Fix**:
```javascript
class BoundedCache {
    constructor(maxSize = 1000, ttlMs = 3600000) {
        this.cache = new Map();
        this.maxSize = maxSize;
        this.ttlMs = ttlMs;
    }
    
    set(key, value) {
        // Enforce size limit
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(key, { value, timestamp: Date.now() });
    }
    
    get(key) {
        const entry = this.cache.get(key);
        if (!entry) return undefined;
        
        // Check TTL
        if (Date.now() - entry.timestamp > this.ttlMs) {
            this.cache.delete(key);
            return undefined;
        }
        return entry.value;
    }
    
    cleanup() {
        const now = Date.now();
        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.timestamp > this.ttlMs) {
                this.cache.delete(key);
            }
        }
    }
}
```

### 4. HTTP Agent Configuration (IMPORTANT)
**Location**: All HTTP clients (axios, fetch)
**Pattern**: Keep-alive causing socket accumulation
**Fix**:
```javascript
const httpAgent = new http.Agent({
    keepAlive: false,      // Disable keep-alive
    maxSockets: 50,        // Limit concurrent
    maxFreeSockets: 10,    // Limit cached
    timeout: 30000         // Socket timeout
});

axios.defaults.httpAgent = httpAgent;
axios.defaults.httpsAgent = new https.Agent({ ...httpAgent });
```

### 5. Event Listener Cleanup (IMPORTANT)
**Location**: Socket.io, WebSocket handlers
**Pattern**: Listeners not removed on disconnect
**Fix**:
```javascript
socket.on('connection', (client) => {
    const handler = (data) => { /* ... */ };
    
    client.on('event', handler);
    
    client.on('disconnect', () => {
        client.removeListener('event', handler);
        // Clean up any client-specific state
    });
});
```

### 6. Timer Cleanup (IMPORTANT)
**Location**: setInterval, setTimeout in long-running operations
**Pattern**: Timers not cleared
**Fix**:
```javascript
class ManagedService {
    constructor() {
        this.timers = [];
    }
    
    start() {
        this.timers.push(setInterval(() => this.tick(), 30000));
    }
    
    stop() {
        this.timers.forEach(timer => clearInterval(timer));
        this.timers = [];
    }
}
```

---

## 🔄 API Routing Strategy

To maintain a single API URL, Alexandria will proxy requests to daemon endpoints it doesn't handle:

```javascript
// In index-alexandria.js
const OIPClient = require('./helpers/oipClient');

// Proxy daemon endpoints through Alexandria
app.use('/api/records', (req, res) => {
    const oip = new OIPClient(req.headers.authorization?.split(' ')[1]);
    return oip.proxy(req, res);
});

// Alexandria's own endpoints
app.use('/api/alfred', alfredRoutes);
app.use('/api/voice', voiceRoutes);
// etc.
```

For oip-only deployments, return a clear error:
```javascript
app.use('/api/alfred', (req, res) => {
    res.status(503).json({
        error: 'Alexandria service not available',
        message: 'This endpoint requires the alexandria profile. Current deployment: oip-only',
        hint: 'Deploy with: make alexandria'
    });
});
```

---

## 📋 Migration Checklist

### Phase 1: Dockerfiles
- [ ] Create `Dockerfile.oip-daemon`
- [ ] Create `Dockerfile.alexandria`
- [ ] Verify `Dockerfile.gun-relay` (existing)

### Phase 2: Entry Points
- [ ] Create `index-daemon.js`
- [ ] Create `index-alexandria.js`
- [ ] Create `helpers/oipClient.js`

### Phase 3: File Organization
- [ ] Move daemon routes to `routes/daemon/`
- [ ] Move alexandria routes to `routes/alexandria/`
- [ ] Move daemon helpers to `helpers/core/`
- [ ] Move alexandria helpers to `helpers/alexandria/`

### Phase 4: Memory Leak Fixes
- [ ] Apply stream cleanup pattern to all file serving
- [ ] Apply axios cleanup pattern to all HTTP calls
- [ ] Implement bounded caches with TTL
- [ ] Add proper event listener cleanup
- [ ] Review and fix all timers

### Phase 5: Docker Compose
- [ ] Update docker-compose.yml with new services
- [ ] Implement all profiles from split plan
- [ ] Test each profile independently

### Phase 6: Makefile
- [ ] Add new profile targets
- [ ] Add backward compatibility aliases
- [ ] Add service-specific operations

---

**Created**: December 2024
**Status**: Component mapping complete, ready for implementation

