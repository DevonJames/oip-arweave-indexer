# Elasticsearch Client Recreation (Memory Leak Mitigation)

## Overview

The Elasticsearch client (v8+) uses Undici for internal HTTP connection management. Over time, Undici accumulates ArrayBuffers from connection pooling, leading to external memory leaks (~400MB/minute in idle systems).

**Solution**: Periodically recreate the Elasticsearch client to force connection pool cleanup and buffer release.

## Implementation

### Automatic Recreation

The ES client is automatically recreated on a schedule:

- **Default interval**: 30 minutes (1800000ms)
- **Check frequency**: Every 5 minutes
- **Configurable via**: `ES_CLIENT_RECREATION_INTERVAL` environment variable

```bash
# In .env file
ES_CLIENT_RECREATION_INTERVAL=1800000  # 30 minutes (default)
```

### Manual Recreation

You can manually trigger client recreation via API:

```bash
curl -X POST http://localhost:3015/api/health/elasticsearch/recreate-client
```

**Response:**
```json
{
  "message": "Elasticsearch client recreated successfully",
  "memory": {
    "before": {
      "heapUsedMB": 2534,
      "externalMB": 47731
    },
    "after": {
      "heapUsedMB": 2512,
      "externalMB": 1245
    },
    "freed": {
      "heapMB": 22,
      "externalMB": 46486
    }
  },
  "timestamp": "2025-11-01T21:45:00.000Z"
}
```

## How It Works

### 1. Client Lifecycle Management

```javascript
let elasticClient = null;
let elasticClientCreatedAt = null;

function createElasticsearchClient() {
    // Close old client if exists
    if (elasticClient) {
        elasticClient.close();
    }
    
    // Create new client
    elasticClient = new Client({ ... });
    elasticClientCreatedAt = Date.now();
    
    return elasticClient;
}
```

### 2. Automatic Age-Based Recreation

```javascript
// Check every 5 minutes if client needs recreation
setInterval(() => {
    const clientAge = Date.now() - elasticClientCreatedAt;
    if (clientAge > ES_CLIENT_RECREATION_INTERVAL) {
        createElasticsearchClient(); // Recreate if too old
    }
}, 300000);
```

### 3. Connection Pool Cleanup

When the client is recreated:
1. Old client connections are closed
2. Undici connection pool is destroyed
3. ArrayBuffers are marked for garbage collection
4. New client starts with fresh connection pool

## Expected Results

### Before Recreation
```
External Memory: 47731MB
ArrayBuffer Growth: +400MB/min
Memory Leak: Active
```

### After Recreation
```
External Memory: ~1200MB (freed 46000MB)
ArrayBuffer Growth: Stopped temporarily
Memory Leak: Mitigated
```

### Long-term Behavior
- **Memory growth**: Gradual increase between recreations
- **Peak memory**: ~10-15GB at 30-minute mark (vs 200GB+ without recreation)
- **Memory pattern**: Sawtooth (grows → drops → grows → drops)

## Configuration Tuning

### Aggressive Recreation (High Traffic)
```bash
ES_CLIENT_RECREATION_INTERVAL=900000  # 15 minutes
```
- More frequent cleanup
- Lower peak memory
- Higher connection overhead

### Conservative Recreation (Low Traffic)
```bash
ES_CLIENT_RECREATION_INTERVAL=3600000  # 60 minutes
```
- Less frequent cleanup
- Higher peak memory
- Lower connection overhead

### Recommended Settings

| Traffic Level | Interval | Peak Memory | Connection Overhead |
|---------------|----------|-------------|---------------------|
| High (>100 req/min) | 15 min | ~5GB | Moderate |
| Medium (20-100 req/min) | 30 min (default) | ~10GB | Low |
| Low (<20 req/min) | 60 min | ~20GB | Minimal |

## Monitoring

### Logs to Watch

**Client creation:**
```
✅ [ES Client] Created new Elasticsearch client (will recreate every 30 minutes)
```

**Periodic recreation:**
```
🔄 [ES Client] Recreating client (age: 31 minutes, threshold: 30 minutes)
🔄 [ES Client] Closed old Elasticsearch client
✅ [ES Client] Created new Elasticsearch client (will recreate every 30 minutes)
```

### Memory Monitoring

Watch external memory via health endpoint:
```bash
curl http://localhost:3015/api/health | jq '.memory.external'
```

Expected pattern:
- **Minutes 0-30**: Gradual increase (1GB → 10GB)
- **Minute 30**: Sharp drop (10GB → 1GB)
- **Minutes 30-60**: Gradual increase again
- **Repeat...**

## Troubleshooting

### Issue: Client recreation not happening

**Check:**
1. Verify `ES_CLIENT_RECREATION_INTERVAL` is set
2. Check logs for creation messages
3. Ensure interval check is running (should log every 5 minutes)

**Fix:**
```bash
# Manually trigger recreation
curl -X POST http://localhost:3015/api/health/elasticsearch/recreate-client
```

### Issue: Memory still growing after recreation

**Possible causes:**
1. Other services also leaking (Axios, GUN, etc.)
2. Recreation interval too long
3. Query volume overwhelming recreation

**Fix:**
1. Check other services' memory usage
2. Reduce `ES_CLIENT_RECREATION_INTERVAL`
3. Scale horizontally (multiple instances)

### Issue: Too many recreations causing connection errors

**Symptom:**
```
Error: Connection refused (ECONNREFUSED)
Error: Socket hang up
```

**Fix:**
Increase `ES_CLIENT_RECREATION_INTERVAL`:
```bash
ES_CLIENT_RECREATION_INTERVAL=3600000  # 60 minutes
```

## Related Fixes

This is part of a comprehensive memory leak mitigation strategy:

1. ✅ **Axios ArrayBuffer cleanup** (index.js)
2. ✅ **HTTP Agent keepAlive: false** (index.js, gun.js)
3. ✅ **ES client recreation** (elasticsearch.js) ← **This fix**
4. ✅ **LRU caching** (elasticsearch.js, alfred.js)
5. ✅ **GUN sync interval reduction** (gunSyncService.js)
6. ✅ **Dialogue timeout cleanup** (sharedState.js)

## References

- **Implementation**: `helpers/elasticsearch.js` lines 51-112
- **Manual endpoint**: `routes/health.js` lines 266-309
- **Configuration**: `example env` lines 33-37
- **Elasticsearch v8 docs**: https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/current/
- **Undici docs**: https://undici.nodejs.org/

## Version History

- **v1.0** (2025-11-01): Initial implementation with 30-minute default interval

