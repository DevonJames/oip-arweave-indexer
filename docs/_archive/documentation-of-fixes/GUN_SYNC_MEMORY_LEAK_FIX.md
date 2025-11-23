# GUN Sync Memory Leak Fix - Frequency Test

**Date:** November 22, 2025  
**Issue:** External memory growing ~26MB/min (~1.6GB/hour) leading to system crash  
**Approach:** Reduce sync frequency and add aggressive memory cleanup WITHOUT changing functionality  

## Problem Analysis

### Memory Growth Pattern
- External memory: 2155MB → 3595MB in 1 hour (~24MB/min)
- External/Heap ratio: 957% → 1206% (should be <50%)
- RSS growth: 540MB → 761MB

### GUN Sync Timing
- Each cycle takes 5-7 minutes (245-397 seconds)
- Runs every 5 minutes
- Processes 0-26 records per cycle
- Most cycles find 0 new records but still take 5+ minutes

### Hypothesis
If GUN sync frequency correlates with memory growth:
- Reducing from 5min → 15min should reduce leak rate by ~66%
- Memory growth should drop from 24MB/min → 8MB/min
- If correlation exists, we know sync is the culprit

## The Fix - Frequency Test + Memory Cleanup

### Changes Made

#### 1. Increased Sync Interval (`helpers/gunSyncService.js`)
```javascript
// Changed from 5 minutes to 15 minutes
this.syncInterval = parseInt(process.env.GUN_SYNC_INTERVAL) || 900000; // 15 minutes default
```

**Impact:** 
- Syncs will run 3x less often
- If memory leak correlates, growth rate should reduce by ~66%
- All functionality remains intact

#### 2. Added Aggressive Memory Cleanup After Sync
```javascript
// MEMORY LEAK FIX: Aggressive cleanup after sync completes
discoveredRecords = null;

// Force garbage collection if available and sync took >1 minute
if (global.gc && duration > 60000) {
    setImmediate(() => {
        global.gc();
        console.log(`🧹 [GUN Sync] Forced GC after ${Math.round(duration/1000)}s sync cycle`);
    });
}
```

**Impact:**
- Nullifies large arrays immediately after use
- Forces GC for long sync cycles
- Does NOT change how records are processed

#### 3. Added GC After HTTP Sync Processing
```javascript
// MEMORY LEAK FIX: Force GC after HTTP sync if we processed many records
if (global.gc && discoveredRecords.length > 20) {
    setImmediate(() => global.gc());
}
```

**Impact:**
- Triggers GC after processing batches of records
- Helps clean up response buffers from axios calls
- No functional changes

#### 4. Elasticsearch Client Optimization
```javascript
compression: false, // Disable compression to reduce memory overhead
enableMetaHeader: false // Disable telemetry to reduce overhead
```

**Impact:**
- Less CPU overhead for decompression
- Fewer metadata headers
- May reduce Undici buffer accumulation

## Expected Results

### If Sync Frequency Correlates with Leak:
- Memory growth rate drops from 24MB/min to ~8MB/min
- External memory stabilizes or grows much slower
- System lasts 3x longer before potential crash

### If No Correlation:
- Memory continues growing at ~24MB/min
- Leak source is elsewhere (Elasticsearch queries, other processes)
- Need to investigate other sources

### What to Monitor:

1. **GUN Sync Frequency:**
   ```
   Should see: ✅ GUN sync complete: X successful, 0 failed (XXXXXms)
   Every 15 minutes instead of 5 minutes
   ```

2. **Memory Growth Rate:**
   ```
   Before: 24MB/min external memory growth
   Target: <10MB/min external memory growth
   ```

3. **GC Messages:**
   ```
   Should see: 🧹 [GUN Sync] Forced GC after XXs sync cycle
   After long sync cycles
   ```

## Testing Instructions

1. **Rebuild and deploy:**
   ```bash
   make rebuild-standard-gpu
   ```

2. **Monitor for 2 hours:**
   ```bash
   # Watch memory every 3 minutes
   docker exec -it <container> sh -c 'while true; do node -e "console.log(new Date().toISOString(), process.memoryUsage())"; sleep 180; done'
   ```

3. **Calculate growth rate:**
   ```
   Growth rate = (External_end - External_start) / minutes_elapsed
   
   Before fix: ~24 MB/min
   Target: <10 MB/min (if correlation exists)
   ```

4. **Check sync timing:**
   ```bash
   # Should see syncs every 15 minutes, not 5
   docker logs <container> | grep "GUN sync complete"
   ```

## Next Steps Based on Results

### If Growth Rate Drops Significantly (Success):
1. Confirms GUN sync is the primary leak source
2. Investigate `discoverOIPRecords()` function for memory leaks
3. Add pagination/chunking to avoid full DB scans
4. Consider increasing interval further if needed

### If Growth Rate Unchanged (Leak Elsewhere):
1. Add explicit cleanup after each Elasticsearch query
2. Profile `keepDBUpToDate` function
3. Investigate `graphql-request` library buffers
4. Check `gun-relay-server.js` publisherIndex Map
5. Consider heap snapshot comparison

## Environment Variable Override

To test different intervals without rebuild:
```bash
# In .env file
GUN_SYNC_INTERVAL=1800000  # 30 minutes
GUN_SYNC_INTERVAL=600000   # 10 minutes (original was 300000 = 5 min)
```

## Success Criteria

- [ ] GUN sync runs every 15 minutes (not 5)
- [ ] Memory growth rate drops proportionally to frequency change
- [ ] All records still get discovered and indexed
- [ ] No functional regressions
- [ ] GC messages appear after long sync cycles

## Rollback if Needed

If this breaks anything:
```bash
git diff HEAD~1 helpers/gunSyncService.js helpers/elasticsearch.js
git checkout HEAD~1 -- helpers/gunSyncService.js helpers/elasticsearch.js
make rebuild-standard-gpu
```

## Files Modified

1. `/helpers/gunSyncService.js` - Increased sync interval, added cleanup
2. `/helpers/elasticsearch.js` - Disabled compression/telemetry

## Mathematical Analysis

If leak is sync-related:
```
Current: 5 min interval = 12 syncs/hour × 2 MB/sync = 24 MB/min growth
Changed: 15 min interval = 4 syncs/hour × 2 MB/sync = 8 MB/min growth

Expected reduction: 66%
```

If we see ~66% reduction in memory growth rate, we've confirmed the source.

