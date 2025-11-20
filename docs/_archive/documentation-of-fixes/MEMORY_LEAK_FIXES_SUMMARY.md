# Memory Leak Fixes - Complete Summary

## Overview

This document summarizes all memory leak fixes implemented for the OIP Arweave Indexer, culminating in the GraphQL client socket leak fix that addressed the most severe remaining leak (365 MB/min external memory growth).

## Timeline of Fixes

### 1. Axios ArrayBuffer Leak (First Discovery)
**Problem**: Images and media causing heap OOM (60GB+ external memory)  
**Fix**: Added Axios interceptor to clean up arraybuffer responses  
**File**: `index.js`  
**Impact**: Reduced media-related memory leaks

### 2. Elasticsearch Query Caching
**Problem**: Continuous ES queries consuming memory  
**Fix**: Implemented 5-minute LRU cache for `getRecordsInDB`  
**File**: `helpers/elasticsearch.js`  
**Impact**: Reduced duplicate queries, but still had leak

### 3. keepDBUpToDate Cache Optimization
**Problem**: Cache bypass every cycle causing 383GB external memory  
**Fix**: Cache used by default, refresh every 10 cycles (50 min)  
**File**: `helpers/elasticsearch.js`  
**Impact**: Massive reduction in query frequency

### 4. Memory Monitor Calculation Fix
**Problem**: Misleading heap utilization (95% vs actual 0.52%)  
**Fix**: Corrected calculation to use `heap_size_limit`  
**File**: `index.js`  
**Impact**: Accurate memory monitoring

### 5. Shared State Cleanup
**Problem**: OOM after 48 hours of voice chats  
**Fix**: Timeout-based cleanup for `ongoingDialogues`  
**File**: `helpers/sharedState.js`  
**Impact**: Prevented dialogue accumulation

### 6. GUN Sync Service Instance Leak
**Problem**: Multiple GUN instances, 17GB+ external memory growth  
**Fix**: Reuse global `gunSyncService` instance  
**File**: `helpers/templateHelper.js`  
**Impact**: Single GUN instance, reduced duplication

### 7. Organization Records Aggregation
**Problem**: Memory growth from organization queries  
**Fix**: Refactored to use ES aggregations with `size: 0`  
**File**: `helpers/elasticsearch.js`  
**Impact**: Reduced organization query overhead

### 8. HTTP Agent Configuration (Major Fix)
**Problem**: 1033 open file descriptors, 200GB+ external memory  
**Fix**: Global agents with `keepAlive: false`  
**Files**: `index.js`, `helpers/gun.js`, `helpers/elasticsearch.js`  
**Impact**: Prevented socket accumulation from all HTTP requests

### 9. Arweave Rate Limit Handling
**Problem**: Hundreds of 429 retries causing connection spam  
**Fix**: 30-minute backoff on rate limit  
**File**: `helpers/elasticsearch.js`  
**Impact**: Reduced Arweave API pressure

### 10. Transaction Processing Optimization
**Problem**: Massive `allTransactions` array accumulation  
**Fix**: Process transactions page-by-page immediately  
**File**: `helpers/elasticsearch.js`  
**Impact**: Constant memory usage during indexing

### 11. GUN Relay Error Suppression
**Problem**: Pages of 404/timeout logs cluttering output  
**Fix**: Suppressed expected 404s, concise error logging  
**Files**: `index.js`, `helpers/gun.js`, `helpers/oipGunRegistry.js`  
**Impact**: Cleaner logs, easier debugging

### 12. GUN Sync Interval Reduction
**Problem**: 30-second sync causing continuous socket creation  
**Fix**: Increased interval to 5 minutes (300000ms)  
**File**: `helpers/gunSyncService.js`  
**Impact**: 10x reduction in GUN request frequency

### 13. Elasticsearch Client Periodic Recreation
**Problem**: Undici ArrayBuffer accumulation (~400 MB/min idle)  
**Fix**: Recreate ES client every 30 minutes  
**File**: `helpers/elasticsearch.js`  
**Impact**: Periodic release of Undici buffers

### 14. GraphQL Client Socket Leak (This Fix - Most Critical)
**Problem**: 365 MB/min external memory growth, 494GB total, socket accumulation (255 → 387), TCP connections (4 → 146)  
**Fix**: Managed GraphQL client with `keepAlive: false` and periodic recreation  
**Files**: `helpers/elasticsearch.js`, `routes/health.js`, `example env`  
**Impact**: **MAJOR** - Should eliminate the primary remaining leak

## Current Status (Post GraphQL Client Fix)

### What We Fixed
✅ Axios buffer leaks  
✅ ES query caching  
✅ GUN sync service leaks  
✅ HTTP socket leaks (global agents)  
✅ ES client buffer leaks (Undici)  
✅ **GraphQL client socket leaks (Arweave)**

### Expected Behavior After This Fix

**Memory Metrics:**
- **External Memory**: Should stabilize at < 5GB (was 494GB+)
- **RSS**: Should stay at < 10GB (was 77GB+)
- **Heap**: Should stay at < 2GB (was 25GB)
- **Sockets**: Should stay at < 100 (was 387+)
- **TCP Connections**: Should stay at < 20 (was 146+)

**Memory Growth:**
- **External**: < 10 MB/min (was 365 MB/min)
- **Heap**: < 5 MB/min (was steady but high)
- **Sockets**: 0-1 /min (was 5+/min)

### Monitoring Commands

```bash
# Watch external memory
watch -n 60 'curl -s http://localhost:3015/api/health/memory | jq ".memory.external.mb"'

# Check socket count
docker exec <container> sh -c 'lsof -p $(pgrep -f "node.*index.js") | grep -c socket'

# Check handles/requests
curl http://localhost:3015/api/health/memory/tracker | jq ".tracker.handles"

# Manual GraphQL client recreation (test)
curl -X POST http://localhost:3015/api/health/graphql/recreate-client
```

## Architecture Changes

### HTTP Connection Management

**Before:**
- Every HTTP library created its own connections
- `keepAlive: true` by default (connection pooling)
- No connection cleanup
- Sockets accumulated indefinitely

**After:**
- Global HTTP/HTTPS agents with `keepAlive: false`
- Explicit agent configuration for all clients:
  - `axios` (global defaults)
  - `elasticClient` (managed via Undici, recreated periodically)
  - `graphQLClient` (managed, recreated periodically)
  - GUN relay calls (explicit agent usage)
- Periodic client recreation (ES: 30min, GraphQL: 30min)

### Client Lifecycle Management

```
┌─────────────────────────────────────────┐
│  Application Startup                    │
├─────────────────────────────────────────┤
│  1. Configure global HTTP agents        │
│  2. Create Elasticsearch client         │
│  3. Create GraphQL client               │
│  4. Start setInterval checks (5 min)    │
└─────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────┐
│  Every 5 Minutes (Lifecycle Check)      │
├─────────────────────────────────────────┤
│  • Check ES client age (>30min?)        │
│  • Check GraphQL client age (>30min?)   │
│  • Recreate if threshold exceeded       │
└─────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────┐
│  Manual Trigger (Optional)              │
├─────────────────────────────────────────┤
│  POST /api/health/elasticsearch/...     │
│  POST /api/health/graphql/...           │
└─────────────────────────────────────────┘
```

## Configuration

### Environment Variables

```bash
# Elasticsearch client recreation (30 minutes)
ES_CLIENT_RECREATION_INTERVAL=1800000

# GraphQL client recreation (30 minutes)
GRAPHQL_CLIENT_RECREATION_INTERVAL=1800000

# GUN sync interval (5 minutes)
GUN_SYNC_INTERVAL=300000

# keepDBUpToDate (10 minutes)
KEEP_DB_DELAY=600
```

## Debugging Tools

### Real-Time Monitoring
- **Memory Tracker**: `GET /api/health/memory/tracker`
- **Memory Health**: `GET /api/health/memory`
- **GUN Sync Status**: `GET /api/health/gun-sync`

### Manual Interventions
- **Clear Cache**: `POST /api/health/memory/clear-cache`
- **Recreate ES Client**: `POST /api/health/elasticsearch/recreate-client`
- **Recreate GraphQL Client**: `POST /api/health/graphql/recreate-client`

### Diagnostic Scripts
- **Memory Profiler**: `npm run profile-memory`
- **Heap Snapshot**: `npm run profile-memory -- --snapshot`

## Testing Plan

### Phase 1: Immediate (0-30 minutes)
- [ ] Deploy changes
- [ ] Check startup logs for GraphQL client creation
- [ ] Monitor external memory (should not grow rapidly)
- [ ] Check socket count (should stay low)

### Phase 2: First Recreation (30 minutes)
- [ ] Watch for GraphQL client recreation log
- [ ] Verify external memory drops significantly
- [ ] Confirm sockets are released
- [ ] Check ES client also recreates

### Phase 3: Short-Term Stability (2-4 hours)
- [ ] External memory should stabilize at < 5GB
- [ ] Sockets should stay at < 100
- [ ] No OOM crashes
- [ ] Application remains responsive

### Phase 4: Long-Term Stability (24-48 hours)
- [ ] Memory remains stable
- [ ] No gradual growth
- [ ] keepDBUpToDate continues working
- [ ] All features functional

## Expected Outcomes

### Success Criteria
1. **External memory < 5GB** after 2 hours
2. **Socket count < 100** consistently
3. **No OOM crashes** for 48+ hours
4. **Memory growth rate < 10 MB/min**

### If Issues Persist

If external memory still grows after this fix:

1. **Take heap snapshot**:
   ```bash
   npm run profile-memory -- --snapshot
   ```

2. **Analyze ArrayBuffers**:
   - Load snapshot in Chrome DevTools
   - Search for `ArrayBuffer` objects
   - Check retention paths

3. **Check other HTTP clients**:
   - IPFS client
   - LIT Protocol
   - Payment services

4. **Profile native modules**:
   ```bash
   docker exec <container> sh -c 'lsof -p $(pgrep -f "node.*index.js") | head -200'
   ```

## Documentation

- **Memory Management Guide**: `docs/MEMORY_MANAGEMENT_GUIDE.md`
- **Memory Leak Debugging**: `docs/MEMORY_LEAK_DEBUGGING.md`
- **ES Client Recreation**: `docs/ELASTICSEARCH_CLIENT_RECREATION.md`
- **GraphQL Client Fix**: `docs/GRAPHQL_CLIENT_MEMORY_FIX.md` (this fix)

## Lessons Learned

1. **HTTP client libraries are leak-prone**
   - Always configure custom agents
   - Disable `keepAlive` unless specifically needed
   - Implement periodic recreation for problematic clients

2. **External memory is the real problem**
   - Heap OOM is less common than external buffer leaks
   - Monitor `memUsage.external` and `memUsage.arrayBuffers`
   - RSS shows actual RAM usage, external shows virtual memory

3. **Socket accumulation is a red flag**
   - `lsof` and `netstat` are your friends
   - Watch for `TCPConnectWrap` and socket counts
   - Proper cleanup requires explicit agent management

4. **Periodic recreation is a valid strategy**
   - When libraries don't expose proper cleanup methods
   - Trade-off: slight connection overhead vs memory safety
   - 30-minute intervals work well for most workloads

5. **Systematic debugging beats trial-and-error**
   - Real-time tracker caught the pattern
   - Socket counts identified the culprit
   - Targeted fix vs shotgun approach

## Next Steps

1. **Monitor for 48 hours** to confirm fix
2. **Adjust intervals if needed** based on memory patterns
3. **Consider additional client management** (IPFS, LIT) if issues persist
4. **Update production runbooks** with new endpoints and procedures
5. **Implement automated alerts** for memory thresholds

