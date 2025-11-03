# GraphQL Client Memory Leak Fix

## Problem

The application was experiencing a **severe external memory leak** (~365 MB/min) even when idle, with continuous accumulation of:
- **TCP connections** (TCPConnectWrap: 4 → 146 in minutes)
- **Socket handles** (255 → 387 in minutes)
- **ArrayBuffer objects** (growing by hundreds of MB per minute)
- **External memory** reaching 494GB+ (using 77GB RSS of 128GB system RAM)

The Elasticsearch client recreation (implemented earlier) **did not fix this leak**, indicating the leak was from a different source.

### Root Cause

The `graphql-request` library used for Arweave GraphQL queries was creating HTTP connections that were:
1. **Not managed by our global HTTP agents** (which have `keepAlive: false`)
2. **Not being properly closed** after each request
3. **Accumulating sockets and buffers** on every `keepDBUpToDate` cycle (every 10 minutes)

Each Arweave query (pagination, transaction fetching) created new connections that persisted indefinitely.

## Solution

Implemented a **managed GraphQL client** with periodic recreation, similar to the Elasticsearch client fix:

### Key Changes

1. **GraphQL Client Instance**
   - Created a `GraphQLClient` instance with custom HTTP/HTTPS agents
   - Configured agents with `keepAlive: false` to prevent connection pooling
   - Set `maxSockets: 50`, `maxFreeSockets: 0`, `timeout: 30000`

2. **Periodic Recreation**
   - Client is recreated every 30 minutes (configurable via `GRAPHQL_CLIENT_RECREATION_INTERVAL`)
   - Forces release of accumulated sockets and buffers
   - Automatic recreation via `setInterval` (checks every 5 minutes)

3. **Manual Trigger**
   - New endpoint: `POST /api/health/graphql/recreate-client`
   - Allows immediate client recreation if needed
   - Returns memory metrics (before/after/freed)

## Implementation Details

### Files Modified

1. **`helpers/elasticsearch.js`**
   - Added `GraphQLClient` import from `graphql-request`
   - Created `createGraphQLClient()` function
   - Created `checkAndRecreateGraphQLClient()` function
   - Replaced `request(endpoint, query)` with `graphQLClient.request(query)`
   - Exported `recreateGraphQLClient` for manual trigger

2. **`routes/health.js`**
   - Added `POST /api/health/graphql/recreate-client` endpoint
   - Returns memory metrics before/after recreation

3. **`example env`**
   - Added `GRAPHQL_CLIENT_RECREATION_INTERVAL` configuration

## Configuration

### Environment Variable

```bash
# GraphQL Client Recreation Interval (milliseconds)
# Periodically recreates the GraphQL client used for Arweave queries to prevent socket/buffer leaks
# Default: 1800000 (30 minutes)
# Lower values = more frequent recreation, reducing connection accumulation
GRAPHQL_CLIENT_RECREATION_INTERVAL=1800000
```

### Tuning Recommendations

- **Default (30 min)**: Good for production, balances memory vs connection overhead
- **15 min (900000)**: For high-load systems with frequent Arweave queries
- **60 min (3600000)**: For low-traffic systems with infrequent queries

## Manual Client Recreation

Force immediate GraphQL client recreation:

```bash
curl -X POST http://localhost:3015/api/health/graphql/recreate-client
```

Response:
```json
{
  "message": "GraphQL client recreated successfully",
  "memory": {
    "before": {
      "heapUsedMB": 2534,
      "externalMB": 495328
    },
    "after": {
      "heapUsedMB": 2512,
      "externalMB": 1234
    },
    "freed": {
      "heapMB": 22,
      "externalMB": 494094
    }
  },
  "timestamp": "2025-11-03T06:25:00.000Z"
}
```

## Monitoring

### Automatic Recreation Logs

```
✅ [GraphQL Client] Created new GraphQL client (will recreate every 30 minutes)
```

Every 30 minutes:
```
🔄 [GraphQL Client] Recreating client (age: 30 minutes, threshold: 30 minutes)
🔄 [GraphQL Client] Disposing old GraphQL client
✅ [GraphQL Client] Created new GraphQL client (will recreate every 30 minutes)
```

### Expected Memory Pattern

**Before Fix:**
- External memory: Grows ~365 MB/min continuously
- Sockets: Grow ~5/min indefinitely
- RSS: Reaches 77GB+ of 128GB system RAM
- TCPConnectWrap: 4 → 146 in minutes

**After Fix:**
- External memory: Should stabilize or grow very slowly
- Sockets: Should stay relatively constant (< 100)
- RSS: Should stabilize at reasonable levels (< 10GB for typical workload)
- TCPConnectWrap: Should stay low (< 20)

### Memory Leak Detection

If external memory continues growing after this fix:
1. Check `keepDBUpToDate` frequency (should be every 10+ minutes)
2. Check if other services (GUN, Elasticsearch) are leaking
3. Run memory profiler: `npm run profile-memory`
4. Check active handles: `curl http://localhost:3015/api/health/memory/tracker`

## Related Fixes

This fix is part of a series of memory leak mitigations:

1. **Axios ArrayBuffer Cleanup** (`index.js`) - Fixed image/media buffer leaks
2. **Elasticsearch Client Recreation** (`helpers/elasticsearch.js`) - Fixed Undici buffer leaks
3. **HTTP Agent Configuration** (`index.js`) - Fixed global socket leaks
4. **GUN Sync Interval** (`helpers/gunSyncService.js`) - Reduced request frequency
5. **GraphQL Client Recreation** (this fix) - Fixed Arweave query socket leaks

## Testing

After deploying this fix:

1. **Monitor for 1 hour** after restart:
   ```bash
   watch -n 60 'curl -s http://localhost:3015/api/health/memory | jq ".memory.external.mb"'
   ```

2. **Check socket count**:
   ```bash
   docker exec <container> sh -c 'lsof -p $(pgrep -f "node.*index.js") | grep -c socket'
   ```
   Should stay below 100.

3. **Check TCPConnectWrap**:
   ```bash
   curl http://localhost:3015/api/health/memory/tracker | jq ".tracker.handles"
   ```
   Should stay relatively stable.

4. **Force manual recreation** (should see immediate external memory drop):
   ```bash
   curl -X POST http://localhost:3015/api/health/graphql/recreate-client
   ```

## Expected Results

- **Immediate**: No more continuous socket/connection accumulation
- **30 minutes**: First automatic client recreation, should see external memory drop
- **1-2 hours**: External memory should stabilize at < 5GB
- **24 hours**: System should remain stable without OOM crashes

## Rollback Plan

If this fix causes issues:

1. **Revert `helpers/elasticsearch.js`**:
   - Change `graphQLClient.request(query)` back to `request(endpoint, query)`
   - Remove GraphQL client management code

2. **Remove endpoint** from `routes/health.js`

3. **Remove env var** from `example env`

## Notes

- The `graphql-request` library doesn't expose a `.close()` method, so we rely on dereferencing (`graphQLClient = null`) and garbage collection to clean up connections
- The HTTP agents are created fresh with each client to ensure clean state
- This fix complements the earlier Elasticsearch client fix - both are necessary for complete memory leak mitigation

