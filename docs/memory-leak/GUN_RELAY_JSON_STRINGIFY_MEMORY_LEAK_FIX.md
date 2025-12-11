# GUN Relay JSON.stringify Memory Leak Fix (December 2024)

## 🔥 Critical Discovery: Massive Memory Leak in Axios Interceptor

### The Smoking Gun

From the memory diagnostics, we found that **External memory was growing at 500-680 MB/min** primarily from `/gun-relay/get` requests:

```
[2025-12-11T20:01:56.265Z] [PERIODIC] Current: RSS: 57700.0MB, Heap: 18038.9MB, External: 354269.8MB
Growth rate: RSS 55.0 MB/min, External 450.0 MB/min

Top operations:
  1. GET /gun-relay/get ({"soul":"647f79c2a338:meal_..."}): External +125.3MB
  2. GET /gun-relay/get ({"soul":"oip:registry:index:organization"}): External +118.1MB
  3. GET /gun-relay/get ({"soul":"oip:registry:index:userFitnessAchievment"}): External +100.6MB
```

Each registry index request was adding **50-137 MB of External memory** that wasn't being released!

### Root Cause: JSON.stringify in Axios Interceptor

**Location**: `index.js` line 130 (before fix)

```javascript
// BEFORE: THIS WAS THE LEAK!
axios.interceptors.response.use((response) => {
  if (response.data && typeof response.data === 'object') {
    try {
      const dataSize = JSON.stringify(response.data).length;  // ❌ MEMORY LEAK!
      // ...
    }
  }
});
```

**Why This Leaks:**

1. **GUN registry indexes are HUGE** (contain all record references for a record type)
   - `oip:registry:index:post` - all posts → 100+ MB
   - `oip:registry:index:recipe` - all recipes → 50+ MB
   
2. **JSON.stringify creates a NEW string copy** of the entire object just to measure its size
   
3. **The string is never explicitly freed** - it relies on GC which can't keep up under load

4. **This happens for EVERY JSON response** from axios

**The Math**:
- ~10-20 GUN relay requests per minute from FitnessAlly frontend
- Each creates 50-137 MB temporary string via JSON.stringify
- V8's GC can't keep up → External memory accumulates
- **Result: 500-680 MB/min growth rate!**

### Double-Buffer Problem in /gun-relay/get Endpoint

**Additional Issue**: The proxy endpoint was also creating unnecessary buffers:

```javascript
// BEFORE: Double serialization!
const data = response.data;      // Axios already parsed JSON into object
response.data = null;
res.json(data);                  // Express RE-SERIALIZES to JSON string!
```

**Why This Wastes Memory**:
1. Axios receives JSON text from gun-relay service
2. Axios parses it into a JS object (memory allocation #1)
3. Express's `res.json()` re-serializes to JSON text (memory allocation #2)
4. **Both allocations exist simultaneously until response completes!**

## The Fix

### Fix #1: Remove JSON.stringify from Axios Interceptor

**Location**: `index.js` lines 126-171

```javascript
// AFTER: Size estimation WITHOUT allocating memory
} else if (response.data && typeof response.data === 'object') {
  // CRITICAL FIX: Do NOT use JSON.stringify to measure size!
  
  // Rough size estimation without allocating memory
  let estimatedSize = 0;
  const url = response.config.url || 'unknown';
  const isGunRequest = url.includes('gun-relay') || url.includes(':8765');
  
  if (isGunRequest && response.data.data) {
    // GUN responses have nested data - count keys as proxy for size
    const keyCount = Object.keys(response.data.data || {}).length;
    estimatedSize = keyCount * 500; // ~500 bytes per registry entry
  } else {
    estimatedSize = Object.keys(response.data).length * 100;
  }
  
  // AGGRESSIVE cleanup for GUN relay responses
  if (isGunRequest) {
    setImmediate(() => {
      response.data = null;
      if (global.gc && estimatedSize > 10000) {
        setImmediate(() => global.gc());
      }
    });
  } else {
    setTimeout(() => {
      if (response.data) {
        response.data = null;
        if (global.gc && estimatedSize > 100000) {
          setImmediate(() => global.gc());
        }
      }
    }, 500);
  }
}
```

### Fix #2: Use responseType 'text' in /gun-relay/get

**Location**: `index.js` /gun-relay/get endpoint

```javascript
// AFTER: Use responseType 'text' - avoids JSON parsing overhead AND double serialization
app.get('/gun-relay/get', async (req, res) => {
    let response = null;
    
    try {
        const soul = req.query.soul;
        if (!soul) {
            return res.status(400).json({ error: 'soul parameter required' });
        }
        
        const gunRelayUrl = process.env.GUN_PEERS || 'http://gun-relay:8765';
        
        // MEMORY LEAK FIX: Use responseType 'text' to get raw JSON string
        // This avoids: 1) axios JSON parsing overhead 2) res.json() re-serialization
        // We just pipe the raw JSON text straight through - only ONE copy in memory
        response = await axios.get(`${gunRelayUrl}/get?soul=${encodeURIComponent(soul)}`, {
            timeout: 10000,
            responseType: 'text', // Raw text - no parsing
            httpAgent: httpAgent,
            httpsAgent: httpsAgent
        });
        
        // Extract raw text and immediately null response to free axios buffers
        const rawText = response.data;
        response.data = null;
        response = null;
        
        // CRITICAL: Send raw JSON text directly - no parsing, no re-serialization
        res.setHeader('Content-Type', 'application/json');
        res.send(rawText);
        
        // Force GC after response is sent
        res.on('finish', () => {
            if (global.gc) {
                setImmediate(() => global.gc());
            }
        });
        
    } catch (error) {
        // ... error handling with cleanup ...
    }
});
```

### Fix #3: Same Pattern for /gun-relay/put

Applied the same `responseType: 'text'` pattern to the PUT endpoint for consistency.

## Expected Results

### Memory Impact

| Metric | Before Fix | After Fix |
|--------|------------|-----------|
| External memory per /gun-relay/get | 50-137 MB | ~0 MB (pass-through) |
| JSON.stringify allocation | 50-137 MB per response | 0 (eliminated) |
| Total memory per request | 100-274 MB | 50-137 MB |
| Growth rate | 500-680 MB/min | **<50 MB/min** |

### Expected Pattern

**Before**: Continuous exponential External memory growth → crash at 50+ GB
**After**: Stable External memory with occasional GC-driven drops

## Files Changed

| File | Change | Impact |
|------|--------|--------|
| `index.js` | Removed JSON.stringify from interceptor | **Eliminated 50-137 MB per request** |
| `index.js` | Use responseType 'text' in /gun-relay/get | **Eliminated double serialization** |
| `index.js` | Use responseType 'text' in /gun-relay/put | Consistency |

## Verification

### 1. Deploy and restart
```bash
cd ~/Desktop/development/fitnessally/oip-arweave-indexer
docker-compose down fitnessally-oip-gpu-1
docker-compose up -d --build fitnessally-oip-gpu-1
```

### 2. Monitor memory for 1 hour
```bash
docker stats fitnessally-oip-gpu-1 --no-stream
# Check every 10 minutes - External memory should NOT grow at 500+ MB/min
```

### 3. Check diagnostics log
```bash
docker exec fitnessally-oip-gpu-1 tail -50 /usr/src/app/logs/memory-diagnostics.log
# Growth rate should be < 50 MB/min for External memory
```

### 4. Success criteria
- [ ] External memory growth < 100 MB/min during normal use
- [ ] No 50-137 MB jumps per /gun-relay/get request
- [ ] System runs 24+ hours without crash
- [ ] Memory pattern shows sawtooth (growth → GC → drop) not continuous growth

## Why This Wasn't Caught Earlier

The axios interceptor was added as a "fix" for a previous leak, but the JSON.stringify was meant to be a diagnostic/logging feature. Under light load (rockhoppers, oip-main), the impact was minimal because:

1. Fewer requests per minute
2. Smaller registry indexes (less data)
3. GC could keep up with the smaller allocations

FitnessAlly with its heavy API usage (Alfred voice, meal planning, workout generation) was making 10-20x more requests, with larger registry indexes, overwhelming GC's ability to clean up the temporary strings.

## Related Documentation

- `CRITICAL_GUN_SYNC_MEMORY_LEAK_FIX.md` - GUN deletion loop fix
- `GUN_SYNC_ERROR_BUFFER_LEAK_FIX.md` - Failed record buffer cleanup
- `UNDICI_MEMORY_LEAK_FIX.md` - Elasticsearch client recreation
- `MEMORY_LEAK_COMPLETE_FIX_SUMMARY.md` - Overview of all memory fixes

## Implementation Date

December 11, 2025

## Status

✅ **Fix implemented** - Ready for deployment and testing

