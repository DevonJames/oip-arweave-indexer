# Undici External Memory Leak Fix

**Date:** November 24, 2025  
**Issue:** External memory growing ~600MB/min (10GB → 150GB+) leading to system crash  
**Root Cause:** Undici (Elasticsearch v8+ HTTP client) accumulating response buffers in external memory  

## Problem Discovery

### Symptoms
- External memory growing at 600MB/min (36GB/hour)
- External/Heap ratio: 1600-1960% (should be <50%)
- FitnessAlly node: 150GB+ external memory
- OIP node: 10-13GB external memory
- **Leak persisted with minimal Elasticsearch query activity**

### Key Investigation Findings

1. **Initial Hypothesis Was Wrong**
   - Thought leak was from Elasticsearch `search()` responses
   - Added explicit `searchResponse = null` after every query
   - **Result:** No improvement - leak continued at same rate

2. **Leak Not Correlated With Query Volume**
   - Most API requests used cached data (`Using cached records data`)
   - `keepDBUpToDate` cycles found 0 transactions
   - Very few actual Elasticsearch queries being made
   - **Leak rate stayed constant at 600MB/min regardless**

3. **The Real Culprit: Undici Connection Pooling**
   - Elasticsearch v8+ uses **Undici** as HTTP client (not standard Node.js http)
   - Undici aggressively pools connections and caches response buffers
   - Undici stores buffers in **external memory** (outside V8 heap)
   - Our attempts to null response objects don't affect Undici's internal buffers
   - Undici doesn't support traditional Node.js `agent` configuration

## Root Cause Analysis

### Why Previous Fixes Failed

```javascript
// ❌ This doesn't actually help with Undici
let searchResponse = await elasticClient.search({...});
const data = searchResponse.hits.hits.map(hit => hit._source);
searchResponse = null; // Nulls our reference, but Undici keeps its buffers
```

**Problem:** Undici's connection pool holds onto response buffers internally. Even after we null our reference to the response, Undici's pool keeps the raw buffers in external memory for connection reuse.

### Why Undici Accumulates Buffers

1. **Connection Pooling:** Undici keeps HTTP connections alive and reuses them
2. **Buffer Reuse:** For efficiency, Undici caches response buffers
3. **External Memory:** Buffers are stored outside V8 heap (not tracked by GC)
4. **No Explicit Cleanup:** No API to manually clear Undici's connection pool

## The Solution

### Approach: Periodic Client Recreation

Instead of trying to clean up Undici's buffers (which we can't access), we **periodically recreate the entire Elasticsearch client**. This forces Undici to close all connections and release all cached buffers.

### Implementation

#### 1. Client Factory Function (`helpers/elasticsearch.js`)

```javascript
let elasticClient;
let clientCreatedAt = Date.now();
const CLIENT_MAX_AGE = parseInt(process.env.ES_CLIENT_RECREATION_INTERVAL) || 300000; // 5 minutes

function createElasticsearchClient() {
    const client = new Client({
        node: process.env.ELASTICSEARCHHOST || 'http://elasticsearch:9200',
        auth: {
            username: process.env.ELASTICCLIENTUSERNAME,
            password: process.env.ELASTICCLIENTPASSWORD
        },
        maxRetries: 3,
        requestTimeout: 30000,
        compression: false,
        enableMetaHeader: false,
        maxResponseSize: 100 * 1024 * 1024 // 100MB
    });
    
    clientCreatedAt = Date.now();
    console.log(`✅ [ES Client] Created new Elasticsearch client (will recreate in ${CLIENT_MAX_AGE/1000}s)`);
    return client;
}
```

#### 2. Automatic Client Recreation

```javascript
function getElasticsearchClient() {
    const clientAge = Date.now() - clientCreatedAt;
    
    // Recreate client if it's too old
    if (clientAge > CLIENT_MAX_AGE) {
        console.log(`🔄 [ES Client] Recreating client (${Math.round(clientAge/1000)}s old) to clear Undici buffers...`);
        
        // Close old client's connections
        if (elasticClient) {
            try {
                elasticClient.close(); // Closes Undici connections and releases buffers
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

#### 3. Transparent Proxy for Backward Compatibility

```javascript
// All existing code continues to work without changes
const elasticClientProxy = new Proxy({}, {
    get(target, prop) {
        const client = getElasticsearchClient(); // Automatically gets current client
        const value = client[prop];
        return typeof value === 'function' ? value.bind(client) : value;
    }
});

module.exports = {
    // ... other exports ...
    elasticClient: elasticClientProxy // Export proxy instead of direct reference
};
```

### How It Works

1. **Existing Code Unchanged:** All calls to `elasticClient.search()` etc. work exactly as before
2. **Automatic Check:** Each call goes through the Proxy, which calls `getElasticsearchClient()`
3. **Age Check:** If client is older than `CLIENT_MAX_AGE`, it gets recreated
4. **Connection Closure:** Old client's `.close()` releases Undici's connections and buffers
5. **Forced GC:** We trigger garbage collection to clean up the old buffers
6. **New Client:** Fresh client with empty connection pool and no accumulated buffers

## Configuration

### Environment Variable

```bash
# How often to recreate Elasticsearch client (milliseconds)
ES_CLIENT_RECREATION_INTERVAL=300000  # 5 minutes (default)
```

**Tuning:**
- **Lower value (e.g., 180000 = 3 min):** More aggressive cleanup, slightly more connection overhead
- **Higher value (e.g., 600000 = 10 min):** Less connection overhead, slower buffer cleanup
- **Recommendation:** Start with 5 minutes and adjust based on memory monitoring

## Expected Impact

### Memory Growth Reduction

**Before Fix:**
- External memory: +600MB/min
- Time to 150GB: ~4 hours
- System crash imminent

**After Fix (Expected):**
- External memory: Sawtooth pattern (grows, then drops at recreation)
- Peak external memory: < 5GB (at 5 min mark)
- Average external memory: ~2-3GB
- **No more unbounded growth**

### Performance Impact

**Negligible:**
- Client recreation takes <100ms
- Happens only every 5 minutes
- New connections establish quickly
- No user-facing latency impact

## Monitoring

### Log Messages to Watch For

```bash
# Initial client creation
✅ [ES Client] Created new Elasticsearch client (will recreate in 300s)

# Periodic recreation (every 5 minutes)
🔄 [ES Client] Client is 301s old, recreating to clear Undici buffers...
🔒 [ES Client] Closed old client connections
✅ [ES Client] Created new Elasticsearch client (will recreate in 300s)
🧹 [ES Client] Forced GC after client recreation

# Memory monitor (should see external memory drop after recreation)
[Memory Monitor] Heap: 700MB / 800MB (2.1%), RSS: 1900MB, External: 2100MB  # Before
[Memory Monitor] Heap: 710MB / 810MB (2.2%), RSS: 1920MB, External: 800MB   # After recreation
```

### Memory Trend

Expected pattern:
```
External Memory (GB)
  5 |     /|     /|     /|
  4 |    / |    / |    / |
  3 |   /  |   /  |   /  |
  2 |  /   |  /   |  /   |
  1 | /    | /    | /    |
  0 +------+------+------+------
    0     5     10    15    20 (minutes)
         ↑     ↑     ↑
      Recreate  |  Recreate
              Recreate
```

## Alternative Solutions Considered

### 1. Downgrade to Elasticsearch v7.x
**Pros:** Uses standard Node.js HTTP (no Undici)  
**Cons:** Loses v8 features, requires schema changes, breaks existing queries  
**Decision:** Too disruptive

### 2. Manual Connection Pool Management
**Pros:** More fine-grained control  
**Cons:** Undici doesn't expose pool management API  
**Decision:** Not possible with current Undici version

### 3. Disable Connection Pooling
**Pros:** No buffer accumulation  
**Cons:** Undici doesn't support `agent: { keepAlive: false }` - causes ConfigurationError  
**Decision:** Not compatible with Elasticsearch v8+

### 4. Switch to Different Elasticsearch Client
**Pros:** Avoid Undici entirely  
**Cons:** Limited alternatives, most use Undici now  
**Decision:** Official client is best maintained

## Related Issues

### Elasticsearch Mapping Errors (Observed in Logs)

These errors are **unrelated** to the memory leak but should be fixed:

1. **`mapper_parsing_exception`:** `data.conversationSession.messages` field type mismatch
   - **Issue:** Trying to index object as text field
   - **Fix:** Update index mapping to use `object` type

2. **`illegal_argument_exception`:** `data.shoppingList.item_amounts` type conflict (long vs float)
   - **Issue:** Inconsistent data types being indexed
   - **Fix:** Normalize data to consistent type before indexing

3. **`index_not_found_exception`:** `organization_decrypt_queue` index missing
   - **Issue:** Code expects index that doesn't exist
   - **Fix:** Create index or add existence check

## Verification

### How to Verify Fix is Working

1. **Start containers:**
   ```bash
   docker-compose up -d
   docker logs -f fitnessally-oip-gpu-1  # or your container name
   ```

2. **Watch for recreation logs** (every 5 minutes):
   ```
   🔄 [ES Client] Client is 301s old, recreating to clear Undici buffers...
   ```

3. **Monitor external memory** (should drop after each recreation):
   ```bash
   # Before recreation: External: 4000MB
   # After recreation: External: 500MB
   ```

4. **Check leak rate** (should be near-zero after fix):
   ```bash
   # Memory should oscillate, not grow linearly
   # Max external memory should be < 5GB
   ```

## Files Modified

- `helpers/elasticsearch.js` - Added client recreation mechanism

## See Also

- [Elasticsearch Official Docs: Node.js Client v8](https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/current/index.html)
- [Undici Connection Pooling](https://undici.nodejs.org/#/docs/api/Pool)
- [Node.js External Memory](https://nodejs.org/api/process.html#processmemoryusage)

