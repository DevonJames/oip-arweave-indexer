# Socket & Memory Leak Fix - GUN Sync Service

## Problem Identified

Through systematic memory profiling, we discovered a **dual socket + external memory leak** caused by:

1. **GUN Sync Service** polling every 30 seconds (way too aggressive)
2. **Elasticsearch client** using default HTTP agent (no socket limits)
3. Both making HTTP requests that accumulated sockets without closing

### The Evidence

- **Socket growth:** 5 → 150+ sockets in 30 minutes (~5 sockets/min)
- **External memory growth:** ~80-150 MB/min continuously
- **Pattern:** Leak occurred **even when idle** (no Arweave transactions, minimal API activity)
- **Root cause:** GUN Sync Service's `discoverOIPRecords()` making **24 HTTP requests per minute** (12 record types × 2 requests/min)

## Fixes Applied

### 1. Elasticsearch Client - HTTP Agent Configuration

**File:** `helpers/elasticsearch.js`

**Before:**
```javascript
const elasticClient = new Client({
    node: process.env.ELASTICSEARCHHOST || 'http://elasticsearch:9200',
    auth: { ... },
    maxRetries: 3,
    requestTimeout: 30000
});
```

**After:**
```javascript
const http = require('http');
const elasticHttpAgent = new http.Agent({
    keepAlive: false,       // Force socket closure after each request
    maxSockets: 25,         // Limit concurrent ES connections
    maxFreeSockets: 5,      // Limit cached sockets
    timeout: 30000          // Socket timeout
});

const elasticClient = new Client({
    node: process.env.ELASTICSEARCHHOST || 'http://elasticsearch:9200',
    auth: { ... },
    maxRetries: 3,
    requestTimeout: 30000,
    agent: () => elasticHttpAgent  // Use custom agent
});
```

**Why:** Elasticsearch client has its own HTTP client that doesn't use the global Axios agent configuration. This forces it to close sockets after each request.

### 2. GUN Helper - Force Global HTTP Agent Usage

**File:** `helpers/gun.js`

**Problem:** Axios requests with per-request config can create new agent instances instead of using the global one.

**Before:**
```javascript
const response = await axios.get(`${this.apiUrl}/get`, {
    params: { soul },
    timeout: 5000,
    headers: { 'Content-Type': 'application/json' }
});
```

**After:**
```javascript
const response = await axios.get(`${this.apiUrl}/get`, {
    params: { soul },
    timeout: 5000,
    headers: { 'Content-Type': 'application/json' },
    // Explicitly use global agents (don't create new ones per request)
    httpAgent: axios.defaults.httpAgent,
    httpsAgent: axios.defaults.httpsAgent
});
```

**Applied to:** All 3 axios calls in gun.js (`POST /put`, `GET /get`, `GET /list`)

**Why:** Ensures every GUN request uses the global agent with `keepAlive: false`, forcing sockets to close after each request instead of accumulating.

### 3. GUN Sync Service - Reduce Polling Frequency

**File:** `helpers/gunSyncService.js`

**Before:**
```javascript
this.syncInterval = parseInt(process.env.GUN_SYNC_INTERVAL) || 30000; // 30 seconds
```

**After:**
```javascript
this.syncInterval = parseInt(process.env.GUN_SYNC_INTERVAL) || 300000; // 5 minutes
```

**Why:** 30 seconds was causing 24 HTTP requests per minute to GUN relay (12 record types checked every 30s). 5 minutes reduces this to 2.4 requests/min - a **10x reduction**. This is a **frequency mitigation**, while fix #2 is the **actual socket leak fix**.

### 4. Environment Configuration

**File:** `example env`

Added documentation:
```bash
# GUN_SYNC_INTERVAL: How often to check for new records from other nodes (milliseconds)
# Default: 300000 (5 minutes) - reduced from 30s to prevent socket/memory leaks
# Lower values = more frequent sync but higher resource usage
GUN_SYNC_INTERVAL=300000
```

## Expected Results

### Before Fix:
- **Sockets:** Growing at ~5/min (30 min = 150 sockets)
- **External Memory:** Growing at ~80-150 MB/min
- **Time to crash:** ~8-10 hours

### After Fix:
- **Sockets:** Stable at <50 (closed after each request)
- **External Memory:** Minimal growth (<10 MB/min from actual work)
- **Time to crash:** Indefinite (stable)

## Testing & Verification

### 1. Monitor Socket Count

```bash
docker exec fitnessally-oip-gpu-1 sh -c 'lsof -p $(pgrep -f "node.*index.js") | grep -c socket'
```

**Expected:** Should stay below 50 and not grow over time.

### 2. Monitor Memory Growth

```bash
curl http://localhost:3000/api/health/memory/tracker | jq '.tracker.growthRate'
```

**Expected:** 
- `externalMBPerMin` should be near 0 when idle (< 10 MB/min)
- Socket handles should stay stable

### 3. Check GUN Sync Logs

Look for:
```
🔄 Starting GUN record sync cycle...
```

**Expected:** Should appear every **5 minutes** instead of every 30 seconds.

## Configuration Tuning

If you need faster sync (e.g., for development), you can adjust in `.env`:

```bash
# Faster sync (2 minutes) - use with caution
GUN_SYNC_INTERVAL=120000

# Original aggressive sync (not recommended for production)
GUN_SYNC_INTERVAL=30000

# Very slow sync (10 minutes) - good for low-activity nodes
GUN_SYNC_INTERVAL=600000
```

**Note:** Lower intervals = more HTTP requests = higher socket/memory usage.

## Applies To All Profiles

These fixes work for **all deployment profiles** since they're in the core helpers:

- ✅ `standard` (your profile)
- ✅ `standard-gpu` (your current profile)
- ✅ `standard-macMseries`
- ✅ `minimal`
- ✅ `minimal-with-scrape`
- ✅ `gpu`
- ✅ `oip-gpu-only`
- ✅ `chatterbox`
- ✅ `chatterbox-gpu`
- ✅ `backend-only`

All profiles use the same `helpers/elasticsearch.js` and `helpers/gunSyncService.js`.

## Rollout

For `rebuild-standard-gpu` profile:

```bash
make rebuild-standard-gpu
```

This will:
1. Rebuild with the new HTTP agent configuration
2. Start with the 5-minute GUN sync interval
3. Install LLM models and Chatterbox TTS as usual

## Related Documentation

- `docs/MEMORY_LEAK_DEBUGGING.md` - Full memory profiling guide
- `MEMORY_DEBUGGING_TOOLS_ADDED.md` - Memory tracker implementation

## Summary

The leak was caused by **background polling without proper socket cleanup**. The fix has two parts:

1. **Socket Leak Fix (Critical):**
   - Elasticsearch: Custom HTTP agent with `keepAlive: false`
   - GUN Helper: Explicitly use global agent on all axios calls
   - **This forces sockets to close after each request**

2. **Frequency Mitigation (Bonus):**
   - Reduce GUN sync from 30s → 5min (10x reduction)
   - Fewer requests = less stress even if sockets leak

**The real fix is #1** - ensuring sockets actually close. The frequency reduction in #2 just reduces the attack surface.

