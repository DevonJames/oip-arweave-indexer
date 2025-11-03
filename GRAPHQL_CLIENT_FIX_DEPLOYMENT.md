# GraphQL Client Memory Leak Fix - Deployment Guide

## What This Fix Does

This fix addresses the **most severe remaining memory leak** in the OIP Arweave Indexer:
- **365 MB/min external memory growth** (was reaching 494GB+)
- **Socket accumulation** (255 → 387 in minutes)
- **TCP connection leak** (4 → 146 in minutes)

The root cause was the `graphql-request` library used for Arweave queries creating persistent connections that were never closed.

## Changes Made

### Files Modified
1. **`helpers/elasticsearch.js`**
   - Added managed GraphQL client with `keepAlive: false`
   - Periodic recreation every 30 minutes
   - Replaced `request()` with `graphQLClient.request()`
   - **REMOVED ES client periodic recreation** (caused connection failures, wasn't the leak source)

2. **`routes/health.js`**
   - Added `POST /api/health/graphql/recreate-client` endpoint
   - **REMOVED ES client recreation endpoint** (no longer needed)

3. **`example env`**
   - Added `GRAPHQL_CLIENT_RECREATION_INTERVAL` configuration
   - `ES_CLIENT_RECREATION_INTERVAL` is now ignored (can be removed)

4. **`docs/GRAPHQL_CLIENT_MEMORY_FIX.md`**
   - Complete documentation of the fix

5. **`docs/MEMORY_LEAK_FIXES_SUMMARY.md`**
   - Summary of all memory leak fixes

6. **`docs/ELASTICSEARCH_CLIENT_RECREATION.md`**
   - Updated to reflect that ES client recreation is disabled

## Deployment Steps

### 1. Update Environment Variables (Optional)

Add to your `.env` file (or use default 30 minutes):
```bash
GRAPHQL_CLIENT_RECREATION_INTERVAL=1800000
```

### 2. Rebuild and Restart

```bash
# Stop services
make stop

# Rebuild (to pick up code changes)
make rebuild-standard-gpu  # or your profile

# Start services
make start-standard-gpu  # or your profile
```

### 3. Verify Startup

Check logs for GraphQL client initialization:
```bash
docker logs -f fitnessally-oip-gpu-1 | grep "GraphQL Client"
```

You should see:
```
✅ [GraphQL Client] Created new GraphQL client (will recreate every 30 minutes)
```

### 4. Monitor for 30 Minutes

Watch external memory:
```bash
watch -n 60 'curl -s http://localhost:3015/api/health/memory | jq ".memory.external.mb"'
```

Check socket count:
```bash
watch -n 60 'docker exec fitnessally-oip-gpu-1 sh -c "lsof -p \$(pgrep -f \"node.*index.js\") | grep -c socket"'
```

### 5. Verify First Recreation (at 30 minutes)

Watch logs for:
```
🔄 [GraphQL Client] Recreating client (age: 30 minutes, threshold: 30 minutes)
🔄 [GraphQL Client] Disposing old GraphQL client
✅ [GraphQL Client] Created new GraphQL client (will recreate every 30 minutes)
```

External memory should **drop significantly** at this point.

## Testing

### Manual Recreation Test

Force immediate client recreation to test:
```bash
curl -X POST http://localhost:3015/api/health/graphql/recreate-client
```

Expected response:
```json
{
  "message": "GraphQL client recreated successfully",
  "memory": {
    "freed": {
      "externalMB": <large number, hopefully several GB>
    }
  }
}
```

### Memory Tracker

Check leak detection:
```bash
curl http://localhost:3015/api/health/memory/tracker | jq
```

Should show:
- Reduced ArrayBuffer growth
- Stable or decreasing external memory
- Lower socket/handle counts

## Expected Results

### Before Fix
```
External Memory: 494GB+ (growing 365 MB/min)
Sockets: 387 (growing ~5/min)
TCP Connections: 146 (growing continuously)
RSS: 77GB (of 128GB system RAM)
```

### After Fix (2-4 hours)
```
External Memory: < 5GB (growth < 10 MB/min)
Sockets: < 100 (stable)
TCP Connections: < 20 (stable)
RSS: < 10GB (stable)
```

## Rollback Plan

If issues occur:

### Quick Rollback
```bash
# Checkout previous commit
git checkout HEAD~1

# Rebuild
make rebuild-standard-gpu
make start-standard-gpu
```

### Code-Only Rollback

In `helpers/elasticsearch.js`, revert this change:
```javascript
// FROM (new):
checkAndRecreateGraphQLClient();
response = await graphQLClient.request(query);

// TO (old):
response = await request(endpoint, query);
```

And remove the GraphQL client management code (lines ~116-175).

## Monitoring Checklist

- [ ] GraphQL client creation log appears on startup
- [ ] External memory not growing rapidly (< 50 MB/min)
- [ ] Socket count stays below 100
- [ ] First recreation happens at 30 minutes
- [ ] External memory drops after recreation
- [ ] Application remains responsive
- [ ] keepDBUpToDate continues working
- [ ] No new errors in logs

## What to Watch For

### Good Signs ✅
- External memory drops at 30-minute intervals
- Socket count stays stable
- No OOM crashes
- Application responsive

### Bad Signs ⚠️
- External memory continues growing > 50 MB/min
- Socket count continues increasing
- OOM crashes
- GraphQL errors in logs

## Troubleshooting

### If External Memory Still Growing

1. **Check other HTTP clients**:
   ```bash
   docker exec fitnessally-oip-gpu-1 sh -c 'lsof -p $(pgrep -f "node.*index.js") | grep socket'
   ```

2. **Take heap snapshot**:
   ```bash
   npm run profile-memory -- --snapshot
   ```

3. **Check if it's a different source**:
   - IPFS client
   - LIT Protocol
   - Payment services

### If GraphQL Client Not Recreating

1. **Check logs** for recreation messages
2. **Verify env var** is loaded:
   ```bash
   docker exec fitnessally-oip-gpu-1 env | grep GRAPHQL
   ```
3. **Manual trigger** to test:
   ```bash
   curl -X POST http://localhost:3015/api/health/graphql/recreate-client
   ```

## Success Criteria

Deploy is successful if after **4 hours**:
1. ✅ External memory < 10GB
2. ✅ Socket count < 100
3. ✅ No OOM crashes
4. ✅ Memory growth < 10 MB/min
5. ✅ keepDBUpToDate working normally

## Timeline

- **0-30 min**: Verify startup, watch for rapid growth
- **30 min**: First recreation, should see memory drop
- **2-4 hours**: Memory should stabilize
- **24-48 hours**: Long-term stability confirmation

## Support

If issues persist after this fix, gather:
1. Memory tracker output
2. Socket count over time
3. Heap snapshot
4. `lsof` output
5. Full logs from last 30 minutes

And provide to the team for analysis.

---

**Note**: This fix is the culmination of 14 different memory leak fixes. It should finally eliminate the major external memory leak that has been plaguing the system. Monitor closely for the first 4 hours after deployment.

