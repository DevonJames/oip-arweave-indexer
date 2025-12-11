# Undici Memory Leak Fix

## Problem

The OIP application was experiencing a critical external memory leak characterized by:

- External memory growing at ~600MB/min on nodes with heavy API traffic
- External memory reaching 196%+ of RSS (Resident Set Size)
- Leak directly correlated with `/api/records` endpoint usage
- ArrayBuffer and External Memory accumulation in non-V8 space

**Root Cause:** Elasticsearch client v8+ uses Undici as its HTTP client. Undici aggressively caches response buffers in external memory (outside V8's heap) to optimize performance. In long-running applications with frequent Elasticsearch queries, these buffers accumulate and are not properly garbage collected, even when response objects are explicitly nulled.

## Solution

**Periodic Elasticsearch Client Recreation**

The fix implements a mechanism to periodically recreate the Elasticsearch client, which forces closure of Undici's connection pool and releases accumulated response buffers.

### Implementation Details

1. **Client Age Tracking:** The Elasticsearch client tracks its creation time and age
2. **Automatic Recreation:** When the client exceeds `ES_CLIENT_RECREATION_INTERVAL` milliseconds (default: 5 minutes), it is automatically recreated
3. **Connection Cleanup:** The old client's connections are properly closed before creating a new one
4. **Forced Garbage Collection:** If available, `global.gc()` is triggered after client recreation to ensure buffers are freed

### Configuration

Set the environment variable `ES_CLIENT_RECREATION_INTERVAL` to control how often the client is recreated:

```bash
# Default: 300000ms (5 minutes)
ES_CLIENT_RECREATION_INTERVAL=300000

# More aggressive (2 minutes) - use if leak is severe
ES_CLIENT_RECREATION_INTERVAL=120000

# Less aggressive (10 minutes) - use if leak is minimal
ES_CLIENT_RECREATION_INTERVAL=600000
```

### Code Changes

**File:** `helpers/elasticsearch.js`

All internal Elasticsearch operations now use `getElasticsearchClient()` instead of direct `elasticClient` access. This function:

1. Checks if the current client has exceeded its maximum age
2. If so, closes the old client and creates a new one
3. Returns the current (fresh or existing) client

```javascript
function getElasticsearchClient() {
    const clientAge = Date.now() - clientCreatedAt;
    
    // Recreate client if it's too old (to clear Undici's connection pool)
    if (clientAge > CLIENT_MAX_AGE) {
        console.log(`🔄 [ES Client] Client is ${Math.round(clientAge/1000)}s old, recreating...`);
        
        // Close old client's connections
        if (elasticClient) {
            try {
                elasticClient.close();
                console.log(`🔒 [ES Client] Closed old client connections`);
            } catch (error) {
                console.warn(`⚠️  [ES Client] Error closing old client:`, error.message);
            }
        }
        
        elasticClient = createElasticsearchClient();
        
        // Force GC to clean up old Undici buffers
        if (global.gc) {
            setImmediate(() => {
                global.gc();
                console.log(`🧹 [ES Client] Forced GC after client recreation`);
            });
        }
    }
    
    return elasticClient;
}
```

### Expected Behavior

After implementing this fix, you should observe:

1. **Sawtooth Memory Pattern:** External memory will grow gradually, then drop sharply when the client is recreated (every 5 minutes by default)
2. **Log Messages:** Look for these logs to confirm the fix is working:
   - `✅ [ES Client] Created new Elasticsearch client (will recreate in XXXs)`
   - `🔄 [ES Client] Client is XXXs old, recreating to clear Undici buffers...`
   - `🔒 [ES Client] Closed old client connections`
   - `🧹 [ES Client] Forced GC after client recreation`
3. **Stable Memory Usage:** Over time, external memory should stabilize at a much lower level instead of continuously growing

### Monitoring

Monitor the fix with these commands:

```bash
# Watch Docker container memory in real-time
docker stats

# Tail logs to see client recreation messages
docker logs -f <container-name> | grep "ES Client"

# Check memory leak tracker output
docker logs -f <container-name> | grep "Memory Leak Tracker"
```

### Additional Optimizations

The fix also includes these Elasticsearch client optimizations:

- `compression: false` - Disables compression to reduce memory overhead
- `enableMetaHeader: false` - Disables telemetry to reduce overhead
- `maxResponseSize: 100MB` - Limits individual response sizes to prevent massive allocations

## Related Issues

- Elasticsearch client v8+ uses Undici instead of the older `http`/`https` modules
- Undici's aggressive caching is designed for short-lived applications, not long-running servers
- This is a known limitation of Undici in long-running Node.js applications

## Further Reading

- [Elasticsearch JS Client v8 Documentation](https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/current/index.html)
- [Undici Documentation](https://undici.nodejs.org/)
- [Node.js External Memory Management](https://nodejs.org/api/process.html#processmemoryusage)
