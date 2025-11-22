# GUN Sync JSON Response Memory Leak Fix

**Date:** November 22, 2025  
**Issue:** External memory growing ~50MB/min leading to system crash  
**Root Cause:** JSON response buffers from GUN sync accumulating in external memory  

## Problem Discovery

### Initial Symptoms
- External memory growing from ~25MB to 1238MB in 1 hour (~50MB/min)
- External/Heap ratio reaching 641% (should be <50%)
- Memory leak occurred on ALL deployments, not just FitnessAlly
- Leak present even with NO active user connections

### Key Investigation Findings

1. **Comparison Testing Revealed Common Factor**
   - FitnessAlly deployment (standard-gpu): 50MB/min leak
   - Max-decentralized-gpu deployment: 62MB/min leak
   - **Common factor:** GUN sync service running on both

2. **GUN Sync Activity Pattern**
   - Runs every 4-5 minutes automatically
   - Makes 40+ HTTP requests per cycle:
     - 1 request per record type per peer (checking registry indices)
     - Additional requests to fetch actual records
   - All requests return JSON data (not arraybuffer)

3. **Axios Response Interceptor Gap**
   ```javascript
   // ONLY handled arraybuffer responses!
   if (response.config.responseType === 'arraybuffer' && response.data) {
     // ... cleanup code ...
   }
   // JSON responses were NOT being cleaned up!
   ```

## Root Cause Analysis

### Primary Issue: JSON Response Accumulation

The axios response interceptor in `index.js` only cleaned up `arraybuffer` responses (for TTS/images), but **completely ignored JSON responses** from:
- GUN sync peer requests (40+ per cycle)
- Gun relay proxy requests (high volume from FitnessAlly)
- Registry index lookups

**Impact:** JSON response buffers were accumulating in external memory (outside V8 heap) and not being garbage collected promptly.

### Secondary Issues

1. **Missing Explicit Agent Specification**
   - `gunSyncService.js` axios calls didn't explicitly specify `httpAgent/httpsAgent`
   - Relied on `axios.defaults` which may not always apply correctly
   - Gun relay proxy routes also lacked explicit agents

2. **Response Object References**
   - `fetchedData = recordResponse.data.data` created lingering references
   - Full response objects kept in memory even after data extraction
   - Prevented garbage collection of underlying buffers

## The Fix

### 1. Updated Axios Response Interceptor (`index.js`)

Added JSON response tracking and cleanup:

```javascript
} else if (response.data && typeof response.data === 'object') {
  // MEMORY LEAK FIX: Also track and cleanup JSON responses from GUN sync
  try {
    const dataSize = JSON.stringify(response.data).length;
    if (dataSize > 100 * 1024) { // Log JSON responses > 100KB
      console.log(`📦 [Axios] Large JSON response: ${(dataSize / 1024).toFixed(1)}KB from ${response.config.url || 'unknown'}`);
    }
    
    // Add cleanup helper to force GC after response is processed
    setTimeout(() => {
      if (response.data) {
        response.data = null;
        if (global.gc && dataSize > 1024 * 1024) {
          setImmediate(() => {
            global.gc();
            console.log(`🧹 [Axios] Released ${(dataSize / 1024).toFixed(1)}KB JSON response`);
          });
        }
      }
    }, 2000); // 2 second delay to allow processing
  } catch (e) {
    // Circular reference or other JSON issue, skip tracking
  }
}
```

### 2. Explicit Agent Specification (`gunSyncService.js`)

Updated both axios calls to explicitly use global agents:

```javascript
const response = await axios.get(`${peerUrl}/get`, {
    params: { soul: indexSoul },
    timeout: 5000,
    // MEMORY LEAK FIX: Explicitly use global HTTP agents
    httpAgent: axios.defaults.httpAgent,
    httpsAgent: axios.defaults.httpsAgent
});

const recordResponse = await axios.get(`${peerUrl}/get`, {
    params: { soul: recordSoul },
    timeout: 10000,
    // MEMORY LEAK FIX: Explicitly use global HTTP agents
    httpAgent: axios.defaults.httpAgent,
    httpsAgent: axios.defaults.httpsAgent
});
```

### 3. Deep Clone and Nullify Response Data (`gunSyncService.js`)

Extract data with deep clone and immediately nullify response reference:

```javascript
// MEMORY LEAK FIX: Extract data and nullify response reference
const peerIndex = JSON.parse(JSON.stringify(response.data.data));
response.data = null; // Allow GC to reclaim response buffer

// ...later for record responses:
// MEMORY LEAK FIX: Deep clone data and nullify response reference
const fetchedData = JSON.parse(JSON.stringify(recordResponse.data.data));
recordResponse.data = null; // Allow GC to reclaim response buffer
```

### 4. Gun Relay Proxy Routes (`index.js`)

Added explicit agents to proxy routes:

```javascript
const response = await axios.get(`${gunRelayUrl}/get?soul=${encodeURIComponent(soul)}`, {
    timeout: 10000,
    // MEMORY LEAK FIX: Explicitly use global HTTP agents
    httpAgent: httpAgent,
    httpsAgent: httpsAgent
});

const response = await axios.post(`${gunRelayUrl}/put`, req.body, {
    timeout: 30000,
    headers: { 'Content-Type': 'application/json' },
    // MEMORY LEAK FIX: Explicitly use global HTTP agents
    httpAgent: httpAgent,
    httpsAgent: httpsAgent
});
```

## Expected Results

### Memory Behavior
- External memory should stabilize instead of growing linearly
- External/Heap ratio should remain under 100% (ideally <50%)
- Garbage collection should reclaim JSON response buffers within 2-5 seconds

### Monitoring
Watch for these log messages:
```
📦 [Axios] Large JSON response: XXX KB from [URL]
🧹 [Axios] Released XXX KB JSON response
```

### Testing Recommendations

1. **Rebuild and restart:**
   ```bash
   make rebuild-standard-gpu
   ```

2. **Monitor memory for 1-2 hours:**
   ```bash
   # In docker container
   node --expose-gc index.js
   ```
   
3. **Check memory metrics:**
   - External memory should NOT grow >100MB from baseline
   - External/Heap ratio should stay <200%
   - RSS growth should be minimal (<500MB over 2 hours)

4. **Load test (optional):**
   - Open FitnessAlly interface
   - Trigger multiple calendar/shopping list requests
   - External memory should spike but then stabilize/drop

## Files Modified

1. `/helpers/gunSyncService.js` - Added explicit agents and response cleanup
2. `/index.js` - Extended axios interceptor to handle JSON responses, added agents to gun-relay proxies

## Additional Notes

### Why This Wasn't Caught Earlier

1. Previous fixes focused on arraybuffer responses (TTS/images)
2. JSON responses are smaller individually but accumulate over time
3. GUN sync runs constantly in background (every 5 min)
4. External memory is harder to track than heap memory

### Related Issues

This fix addresses the memory leak but there are other potential optimizations:

1. **Gun Relay Server In-Memory Index** (`gun-relay-server.js` line 15)
   - `publisherIndex` Map never clears old entries
   - Could grow unbounded over time
   - Consider implementing LRU cache or periodic cleanup

2. **Other Axios Calls**
   - Found 61 axios calls across 12 helper files
   - Most should use axios.defaults, but consider auditing:
     - `helpers/generators.js` (27 calls)
     - `helpers/alfred.js` (10 calls)
     - Others if memory issues persist

### Verification Commands

```bash
# Check current memory
docker exec -it <container> node -e "console.log(process.memoryUsage())"

# Force garbage collection (if --expose-gc enabled)
docker exec -it <container> node -e "global.gc && global.gc(); console.log(process.memoryUsage())"

# Monitor over time
watch -n 60 'docker exec <container> node -e "console.log(process.memoryUsage())"'
```

## Success Criteria

- [ ] External memory stabilizes after initial growth
- [ ] External/Heap ratio stays under 200%
- [ ] System runs for 24+ hours without crash
- [ ] Memory usage returns to baseline after GC
- [ ] No accumulation of socket handles (should stay <50)

## Rollback Plan

If this fix causes issues:

1. Revert changes to both files
2. Restart services
3. Re-investigate with additional logging

```bash
git diff HEAD~1 helpers/gunSyncService.js index.js
git checkout HEAD~1 -- helpers/gunSyncService.js index.js
make rebuild-standard-gpu
```

