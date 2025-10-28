# Memory Management Guide

This guide explains how to identify, prevent, and resolve memory issues in the OIP Arweave Indexer application.

## 🔍 The Memory Leak Issue

### Root Cause
The application was experiencing memory leaks primarily from the **GunSyncService**, which maintained an unbounded `processedRecords` Set that grew indefinitely without being cleared.

### Symptoms
- Node.js heap out of memory errors
- Application crashes after running for several hours
- Memory usage steadily increasing over time
- Garbage collection failures

```
<--- Last few GCs --->
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
```

## ✅ Fixes Implemented

### 1. Automatic Cache Clearing
The GunSyncService now automatically clears its internal cache every hour (configurable):

```javascript
// In helpers/gunSyncService.js
this.cacheMaxAge = parseInt(process.env.GUN_CACHE_MAX_AGE) || 3600000; // 1 hour default
```

**Environment Variable:**
```bash
GUN_CACHE_MAX_AGE=3600000  # Clear cache every hour (in milliseconds)
```

### 2. Axios Buffer Leak Fix
**CRITICAL FIX**: Fixed the major memory leak in axios arraybuffer responses that was causing 60GB+ external memory usage.

**The Problem:**
- Axios responses with `responseType: 'arraybuffer'` were not being properly cleaned up
- Each image download (several MB) was accumulating in external memory
- The 30-second timeout cleanup was unreliable

**The Solution:**
- Implemented immediate buffer cleanup using Proxy objects
- Added aggressive garbage collection for large buffers (>1MB)
- Reduced cleanup timeout from 30 seconds to 1 second
- Added immediate cleanup in image generation and media download functions

**Files Modified:**
- `index.js` - Fixed axios interceptor
- `helpers/generators.js` - Fixed image generation cleanup
- `helpers/media-manager.js` - Fixed media download cleanup

### 3. Elasticsearch Memory Leak Fix
**CRITICAL FIX**: Fixed the major memory leak in Elasticsearch queries that was causing steady heap growth.

**The Problem:**
- `getRecordsInDB()` was loading up to 5000 records on **every single API request**
- No caching mechanism - each request created new memory allocations
- Records were not being properly cleaned up between requests
- This caused steady memory growth even without image generation

**The Solution:**
- Added **30-second caching** to `getRecordsInDB()` function
- Prevents repeated loading of 5000 records on every API call
- Added cache clearing mechanism for memory management
- Integrated cache clearing into memory monitor and emergency cleanup

**Files Modified:**
- `helpers/elasticsearch.js` - Added caching and cache clearing
- `index.js` - Added cache clearing to memory monitor
- `scripts/emergency-memory-cleanup.js` - Added cache clearing to emergency cleanup

### 4. Critical keepDBUpToDate Memory Leak Fix
**CRITICAL FIX**: Fixed the most severe memory leak in `keepDBUpToDate` function that was bypassing cache completely.

**The Problem:**
- `keepDBUpToDate` was calling `getRecordsInDB(true)` with **force refresh** on every cycle
- This bypassed the cache completely and loaded 5000 records every 5 minutes
- External memory was growing by ~2GB every few minutes (383GB → 385GB → 387GB...)
- This was the primary cause of the 400GB+ memory usage

**The Solution:**
- Removed force refresh from `keepDBUpToDate` - now uses cache
- Extended cache duration from 30 seconds to **5 minutes**
- Added cycle counter to refresh cache only every **10 cycles (50 minutes)**
- Added logging to show when cache is refreshed

**Files Modified:**
- `helpers/elasticsearch.js` - Fixed keepDBUpToDate cache bypass

### 5. Memory Monitor Calculation Fix
**FIX**: Fixed misleading heap utilization calculation in memory monitor.

**The Problem:**
- Memory monitor was calculating utilization against current heap size (95%)
- Health endpoint was calculating against maximum heap size (0.52%)
- This caused confusion about actual memory usage

**The Solution:**
- Updated memory monitor to use V8 heap statistics like the health endpoint
- Now both endpoints show the same accurate utilization percentage
- True utilization is ~0.5% (very healthy) instead of misleading 95%

**Files Modified:**
- `index.js` - Fixed memory monitor calculation

### 6. Dialogue Timeout Cleanup Fix
**FIX**: Added automatic cleanup for stale voice conversation dialogues that don't properly disconnect.

**The Problem:**
- Voice conversations can accumulate in `ongoingDialogues` Map if clients don't properly disconnect
- Network issues or browser crashes can leave orphaned dialogues in memory
- These stale dialogues were never cleaned up, causing steady memory growth during voice chat sessions

**The Solution:**
- Added 30-minute timeout for inactive dialogues
- Automatic cleanup checks every 5 minutes
- Tracks `lastActivity` timestamp on each dialogue
- Removes any dialogue not accessed in 30+ minutes
- Logs cleanup actions for monitoring

**Files Modified:**
- `helpers/sharedState.js` - Added timeout cleanup mechanism
- `routes/voice.js` - Added lastActivity tracking

### 7. Cache Bypass Parameters
**FIX**: Added ability to bypass caching for fresh data when needed.

**Parameters Available:**
- `forceRefresh=true` - Bypass cache for immediate fresh data from Elasticsearch
- `POST /api/records/clear-cache` - Manually clear the entire records cache

**Use Cases:**
- After bulk deletes to see changes immediately
- When data has been modified and staleness is unacceptable
- Before critical operations requiring fresh data

**Files Modified:**
- `routes/records.js` - Added cache bypass parameter and clear-cache endpoint
- `helpers/elasticsearch.js` - Added forceRefresh parameter support

### 8. Emergency Memory Cleanup Script
Added a new emergency cleanup script for immediate memory relief:

```bash
# Run emergency cleanup
node scripts/emergency-memory-cleanup.js cleanup

# Monitor memory for 2 minutes
node scripts/emergency-memory-cleanup.js monitor 120

# Show current memory stats
node scripts/emergency-memory-cleanup.js stats
```

### 7. Memory Monitoring Endpoints

#### Check Memory Status
```bash
curl http://localhost:3005/api/health/memory
```

Response includes:
- Heap utilization percentage
- Memory usage breakdown (RSS, heap, external)
- Warnings when memory is above 80% or 90%
- GUN sync cache size and next clear time

#### Check GUN Sync Status
```bash
curl http://localhost:3005/api/health/gun-sync
```

#### Manually Clear Cache (Emergency)
```bash
curl -X POST http://localhost:3005/api/health/memory/clear-cache
```

### 3. Diagnostic Script

Run memory diagnostics:

```bash
# Quick memory check
node scripts/diagnose-memory.js

# Take heap snapshot for analysis
node scripts/diagnose-memory.js snapshot

# Monitor memory growth over time
node scripts/diagnose-memory.js monitor 10 120
# (checks every 10 seconds for 120 seconds)
```

## 🚀 Starting the Application with Increased Heap

### Default Heap Limit
Node.js defaults to ~1.7GB on 32-bit systems and ~4GB on 64-bit systems.

### Increase Heap Size

#### Option 1: Using NODE_OPTIONS Environment Variable
```bash
# Set to 8GB
export NODE_OPTIONS="--max-old-space-size=8192"
npm start
```

#### Option 2: Direct Node Flags
```bash
node --max-old-space-size=8192 index.js
```

#### Option 3: Update package.json
```json
{
  "scripts": {
    "start": "node --max-old-space-size=8192 index.js",
    "start:keepdb": "node --max-old-space-size=8192 index.js --keepDBUpToDate"
  }
}
```

#### Option 4: Using Docker
Update your docker-compose.yml:
```yaml
services:
  oip-arweave:
    environment:
      - NODE_OPTIONS=--max-old-space-size=8192
```

### Recommended Heap Sizes

| Scenario | Heap Size | Flag |
|----------|-----------|------|
| Development | 4GB | `--max-old-space-size=4096` |
| Production (Light) | 8GB | `--max-old-space-size=8192` |
| Production (Heavy) | 16GB | `--max-old-space-size=16384` |
| High-Volume Indexing | 32GB | `--max-old-space-size=32768` |

## 📊 Monitoring Best Practices

### 1. Set Up Regular Health Checks

Create a cron job or monitoring service:
```bash
*/5 * * * * curl -s http://localhost:3005/api/health/memory | jq '.status, .heap.utilization'
```

### 2. Alert Thresholds

Set up alerts when:
- Heap utilization > 80% (warning)
- Heap utilization > 90% (critical)
- Detached contexts > 10 (memory leak indicator)
- Cache size grows beyond expected bounds

### 3. Log Memory Metrics

Add to your monitoring/logging system:
```javascript
// Example: Log memory every 10 minutes
setInterval(() => {
    const mem = process.memoryUsage();
    console.log('Memory:', {
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
        rssMB: Math.round(mem.rss / 1024 / 1024)
    });
}, 600000);
```

## 🛠️ Troubleshooting

### Application Still Crashing?

1. **Check if GUN_SYNC_ENABLED is causing issues:**
   ```bash
   GUN_SYNC_ENABLED=false npm start
   ```

2. **Reduce cache max age:**
   ```bash
   GUN_CACHE_MAX_AGE=1800000 npm start  # 30 minutes
   ```

3. **Check for other memory leaks:**
   ```bash
   node --expose-gc scripts/diagnose-memory.js monitor 10 300
   ```

4. **Analyze heap snapshot:**
   - Take a snapshot: `node scripts/diagnose-memory.js snapshot`
   - Open Chrome DevTools → Memory tab
   - Load the .heapsnapshot file
   - Look for objects with high retained size

### Common Memory Leak Patterns

#### 1. Event Listeners
```javascript
// BAD: Creates memory leak
emitter.on('event', handler);

// GOOD: Clean up when done
emitter.on('event', handler);
// ... later
emitter.removeListener('event', handler);
```

#### 2. Timers
```javascript
// BAD: Timer never cleared
setInterval(() => { /* ... */ }, 1000);

// GOOD: Store reference and clear
const interval = setInterval(() => { /* ... */ }, 1000);
// ... later
clearInterval(interval);
```

#### 3. Closures Holding References
```javascript
// BAD: Large object held in closure
function createHandler(largeObject) {
    return () => {
        // largeObject is retained even if only using small part
        console.log(largeObject.smallProp);
    };
}

// GOOD: Only keep what you need
function createHandler(largeObject) {
    const smallProp = largeObject.smallProp;
    return () => {
        console.log(smallProp);
    };
}
```

#### 4. Unbounded Caches
```javascript
// BAD: Cache grows forever
const cache = new Map();
cache.set(key, value);

// GOOD: Use LRU cache or clear periodically
const LRU = require('lru-cache');
const cache = new LRU({ max: 500 });
```

## 🔬 Advanced Debugging

### Enable Garbage Collection Logging
```bash
node --trace-gc --trace-gc-verbose index.js 2>&1 | tee gc.log
```

### Memory Profiling with Clinic.js
```bash
npm install -g clinic
clinic doctor -- node index.js
```

### V8 Heap Profiler
```bash
node --prof index.js
# After stopping
node --prof-process isolate-*.log > processed.txt
```

## 📝 Configuration Reference

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GUN_SYNC_ENABLED` | `true` | Enable/disable GUN sync service |
| `GUN_SYNC_INTERVAL` | `30000` | Sync interval in ms (30 seconds) |
| `GUN_CACHE_MAX_AGE` | `3600000` | Cache clear interval in ms (1 hour) |
| `NODE_OPTIONS` | - | Node.js command-line options |

### Recommended Production Settings

```bash
# .env
GUN_SYNC_ENABLED=true
GUN_SYNC_INTERVAL=30000
GUN_CACHE_MAX_AGE=1800000  # 30 minutes for high-volume
NODE_OPTIONS=--max-old-space-size=8192
```

## 🎯 Prevention Checklist

- [ ] Set appropriate heap size for your workload
- [ ] Configure GUN_CACHE_MAX_AGE based on volume
- [ ] Set up memory monitoring alerts
- [ ] Review code for unbounded data structures
- [ ] Clean up event listeners and timers
- [ ] Use weak references for caches when appropriate
- [ ] Implement pagination for large data queries
- [ ] Stream large files instead of loading into memory
- [ ] Regularly test with memory profiling tools

## 📚 Additional Resources

- [Node.js Memory Management](https://nodejs.org/en/docs/guides/simple-profiling/)
- [V8 Heap Debugging](https://v8.dev/docs/memory-leaks)
- [Chrome DevTools Memory Profiling](https://developer.chrome.com/docs/devtools/memory-problems/)
- [Clinic.js Profiling](https://clinicjs.org/)

---

**Last Updated:** 2025-10-11  
**Version:** 1.0.0

## Configuration

### keepDBUpToDate Cache Refresh Parameters

You can now configure how often the Elasticsearch cache is refreshed during the `keepDBUpToDate` cycle by setting environment variables in your `.env` file:

```bash
# Delay before first cache check (in seconds) - default: 10
KEEP_DB_DELAY=10

# How often to refresh cache - every N keepDB cycles - default: 10
# With keepDB running every 5 minutes, refresh happens every 50 minutes
# (10 cycles × 5 minutes = 50 minutes between full refreshes)
KEEP_DB_REFRESH=10
```

**Examples:**

```bash
# Very aggressive refresh (refresh every cycle):
KEEP_DB_DELAY=10
KEEP_DB_REFRESH=1

# Conservative refresh (refresh every 20 cycles = ~100 minutes with 5min keepDB interval):
KEEP_DB_DELAY=10
KEEP_DB_REFRESH=20

# Default (refresh every 10 cycles = ~50 minutes):
KEEP_DB_DELAY=10
KEEP_DB_REFRESH=10
```

### How the Cache Refresh Works

1. **keepDBUpToDate runs every 5 minutes** in the background
2. **By default, it uses the 30-second cache** to avoid reloading data
3. **Every 10 cycles (~50 minutes)**, it does a **full refresh** of the cache
4. This ensures data freshness while maintaining excellent performance

The cache bypass also applies to API requests - you can add `?forceRefresh=true` to any `/api/records` request to bypass the cache immediately.

