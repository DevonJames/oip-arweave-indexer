# Heap Memory Leak Fix - December 2024

## Problem

After fixing the External memory leak (JSON.stringify in GUN relay), the node was still consuming ~20GB over 1.5 days. Memory diagnostics showed:

1. **Heap memory growing unboundedly** - RSS and Heap climbing 50-100MB/min at times
2. **External memory stable** - staying at ~15-20MB (previous fix working)
3. **Main culprit: `/api/records` with deep resolution** - each call adding 100-250MB to heap

## Root Cause Analysis

The logs showed patterns like:
```
[GROWTH] GET /api/records ({"recordType":"userFitnessProfile","source":"gun","limit":"1000"}): RSS +230.8MB, External +0.3MB
```

Even though `userFitnessProfile` typically has only 1 record per user, it can be deeply resolved with:
- Workout schedules (with exercises)
- Meal plans (with recipes, ingredients)
- Settings, preferences, etc.

This creates a deeply-nested JSON object of 100-200+ MB that was:
1. **Never being garbage collected** - references kept alive after response sent
2. **Being cached in `recordsInDB`** - adding resolved records to an unbounded cache

## Fixes Applied

### 1. `/api/records` Route Cleanup (`routes/daemon/records.js`)

Added explicit nulling of large objects after response is sent:

```javascript
router.get('/', optionalAuthenticateToken, enforceCalendarScope, async (req, res) => {
    let records = null;
    let response = null;
    
    try {
        // ... build response ...
        
        res.status(200).json(response);
        
        // MEMORY LEAK FIX: Explicitly null large objects after response is sent
        records = null;
        response = null;
        
        // Hint to GC if response was large (deeply resolved records)
        if (queryParams.resolveDepth && parseInt(queryParams.resolveDepth) > 0) {
            setImmediate(() => {
                if (global.gc) {
                    global.gc();
                }
            });
        }
    } finally {
        // Ensure cleanup happens even on error paths
        records = null;
        response = null;
    }
});
```

### 2. Stop Loading All Records for Resolution (`helpers/core/elasticsearch.js`)

Changed from loading 5000 records into memory on every API call to:

```javascript
// OLD (caused memory leak):
const { recordsInDB, qtyRecordsInDB, maxArweaveBlockInDB } = await getRecordsInDB(false);

// NEW (lightweight metadata query):
let recordsInDB = []; // Empty - will be populated lazily during resolution

const metadataResponse = await getElasticsearchClient().search({
    index: 'records',
    body: {
        size: 0, // Don't return any records, just aggregations
        aggs: {
            max_block: { max: { field: "oip.inArweaveBlock" } },
            total_records: { value_count: { field: "oip.did.keyword" } }
        }
    }
});
```

### 3. Stop Caching Resolved Records (`helpers/utils.js`)

The `resolveRecords` function was adding every resolved record to `recordsInDB`, causing unbounded growth:

```javascript
// OLD (caused unbounded cache growth):
if (recordsInDB.length < 7500) {
    recordsInDB.push(refRecord);
}

// NEW (on-demand fetching only):
refRecord = await searchRecordInDB(properties[key]);
// Don't add to recordsInDB - each resolution fetches on-demand
```

## Expected Impact

- **Before**: 20GB+ memory in 1.5 days, growing ~10-50MB/min
- **After**: Memory should stabilize as:
  - Large resolved objects are GC'd after each response
  - No more 5000-record cache loaded per API call
  - No more unbounded cache growth during resolution

## Deployment

1. Commit these changes
2. Rebuild Docker image
3. Restart container
4. Monitor with:
   ```bash
   docker exec fitnessally-oip-daemon-service-1 tail -f /usr/src/app/logs/memory-diagnostics.log
   ```

## Environment Variables

Run with `--expose-gc` flag to enable explicit GC hints:

```bash
node --expose-gc --max-old-space-size=16384 index-daemon.js
```

