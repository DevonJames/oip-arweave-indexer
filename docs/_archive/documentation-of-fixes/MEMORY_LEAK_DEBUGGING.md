# Memory Leak Debugging Guide

## Overview

We've implemented a systematic, data-driven memory profiling system with three complementary tools:

1. **Real-time Memory Tracker** - Automatic monitoring with alerts
2. **Manual Diagnostic Script** - On-demand detailed analysis  
3. **Heap Snapshot Tool** - Deep Chrome DevTools analysis

**Files:**
- `helpers/memoryTracker.js` - Real-time tracking system
- `scripts/diagnose-memory-leak.js` - Diagnostic tool
- `scripts/profile-memory.sh` - Convenience wrapper

**Modified:**
- `index.js` - Auto-start tracker, suppress GUN relay 404s
- `routes/health.js` - Add `/api/health/memory/tracker` endpoint

---

## Quick Start

### Monitor in Real-Time (Automatic)
The tracker runs automatically and alerts in logs:
```bash
docker logs -f fitnessally-oip-gpu-1
```

Look for:
```
🚨 [Memory Leak Tracker] EXTERNAL MEMORY LEAK DETECTED
   Rate: 2000.0 MB/min
   Time to crash: 16 minutes
   🔍 Likely culprits: ArrayBuffer +1800MB (Axios responses)
```

### Get Current Status
```bash
curl http://localhost:3000/api/health/memory/tracker
```

### Run Full Diagnostic
```bash
./scripts/profile-memory.sh
```

### Deep Analysis (Heap Snapshot)
```bash
./scripts/profile-memory.sh --snapshot
docker cp fitnessally-oip-gpu-1:/usr/src/app/scripts/memory-snapshots ./memory-snapshots
# Open in Chrome DevTools: F12 → Memory → Load
```

---

## Interpreting Results

### Critical Ratios

| Ratio | Status | Meaning |
|-------|--------|---------|
| **External/Heap < 50%** | ✅ Normal | Healthy |
| **External/Heap 50-200%** | ⚠️ Warning | Check Axios, Elasticsearch |
| **External/Heap > 200%** | 🚨 Critical | **Buffer leak** (Axios, streams) |
| **External/Heap > 600%** | 💀 Imminent crash | **Immediate action required** |

### Active Handles

| Count | Status | Meaning |
|-------|--------|---------|
| **< 100** | ✅ Normal | Healthy |
| **100-500** | ⚠️ Warning | Check unclosed resources |
| **> 500** | 🚨 Critical | **Socket/stream leak** |

### Growth Rate

| Rate | Status | Time to Crash |
|------|--------|---------------|
| **< 10 MB/min** | ✅ Normal | > 24 hours |
| **10-50 MB/min** | ⚠️ Slow leak | 10-24 hours |
| **50-500 MB/min** | 🚨 Active leak | 1-10 hours |
| **> 500 MB/min** | 💀 Critical | < 1 hour |

---

## Systematic Debugging Process

### Step 1: Detect (Automatic)
Real-time tracker alerts when leaks occur - no action needed.

### Step 2: Classify
```bash
./scripts/profile-memory.sh
```

**Look at ratios:**
- External/Heap > 50%? → **Buffer leak** (Axios, Elasticsearch)
- Active Handles growing? → **Resource leak** (sockets, streams)
- Heap growing without external? → **Object leak** (caches, closures)

### Step 3: Correlate
**Watch patterns:**
- Leak during `keepDBUpToDate`?
- During API requests?
- When idle?

**Check tracker:**
```bash
curl http://localhost:3000/api/health/memory/tracker | jq
```

### Step 4: Pinpoint (Heap Snapshots)
1. Take snapshot before activity
2. Perform suspected activity
3. Take another snapshot
4. Compare in Chrome DevTools (Comparison view)

### Step 5: Fix and Verify
1. Implement fix
2. Restart application
3. Monitor tracker for 30-60 minutes
4. Verify growth rate near zero
5. Check ratios are normal

---

## Common Leak Patterns & Fixes

### Pattern 1: Buffer Leak (External >> Heap)

**Symptoms:**
- External memory 500GB+
- External/Heap > 200%
- ArrayBuffers growing

**Cause:** Buffers not released

**Sources:**
- Axios `arraybuffer` responses
- Elasticsearch bulk operations
- Streams not destroyed

**Fix:**
```javascript
const response = await axios.get(url, { responseType: 'arraybuffer' });
// Use response.data...
response.data = null; // CRITICAL
if (global.gc) global.gc();
```

### Pattern 2: Socket Leak (Growing Handles)

**Symptoms:**
- Active handles > 500
- Mostly "Socket" type
- External growing

**Cause:** Connections not closing

**Sources:**
- `keepAlive: true` without limits
- Unclosed connections
- Missing socket timeouts

**Fix:**
```javascript
const agent = new http.Agent({
    keepAlive: false,
    maxSockets: 50,
    timeout: 30000
});
axios.defaults.httpAgent = agent;
```

### Pattern 3: Object Leak (Heap Growing)

**Symptoms:**
- Heap steadily growing
- GC doesn't help
- External/Heap normal

**Cause:** Cached objects never expire

**Sources:**
- LRU caches without limits
- Event listeners not removed
- Closures holding references

**Fix:**
```javascript
class LRUCache {
    constructor(maxSize = 1000, maxAge = 30 * 60 * 1000) {
        this.cache = new Map();
        this.maxSize = maxSize;
        this.maxAge = maxAge;
    }
    
    set(key, value) {
        // Evict oldest if over size
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(key, { value, timestamp: Date.now() });
    }
    
    get(key) {
        const entry = this.cache.get(key);
        if (!entry) return null;
        
        // Check expiration
        if (Date.now() - entry.timestamp > this.maxAge) {
            this.cache.delete(key);
            return null;
        }
        
        return entry.value;
    }
}
```

---

## Emergency Actions

### If Memory > 450GB (Near Crash)

1. **Force GC:**
```bash
docker exec fitnessally-oip-gpu-1 kill -USR2 $(pgrep -f "node.*index.js")
```

2. **Clear caches:**
```bash
curl -X POST http://localhost:3000/api/health/memory/clear-cache
```

3. **Diagnose NOW:**
```bash
./scripts/profile-memory.sh
```

4. **Get handle breakdown:**
```bash
docker exec fitnessally-oip-gpu-1 sh -c 'lsof -p $(pgrep -f "node.*index.js") | tail -n +2 | awk "{print \$5}" | sort | uniq -c | sort -rn'
```

---

## Diagnostic Script Output

### Sample Output
```
╔════════════════════════════════════════════════════════════════╗
║      MEMORY LEAK DIAGNOSTIC TOOL - OIP Arweave Indexer       ║
╚════════════════════════════════════════════════════════════════╝

🔍 ANALYZING EXTERNAL MEMORY SOURCES
════════════════════════════════════════════════════════════════

📊 V8 Heap Statistics:
  Total Heap Size: 27552.00 MB
  Used Heap Size: 26271.60 MB
  Heap Size Limit: 32768.00 MB
  External Memory: 494017.00 MB ⚠️

🔴 CRITICAL RATIOS:
  External/Heap: 1881.0% (normal: <50%)
  External/RSS: 637.8% (normal: <100%)

🚨 SMOKING GUN: External memory exceeds RSS!
   Likely culprits:
   - ArrayBuffers from Axios/HTTP responses
   - Elasticsearch bulk operations
   - Stream buffers not being destroyed

🔗 TRACKING LIVE HANDLES
════════════════════════════════════════════════════════════════

📍 Active Handles: 1033
  Breakdown:
    Socket: 987    ← LEAK DETECTED!
    Timer: 35
    Server: 11
```

### Tracker API Response
```json
{
  "status": "ok",
  "tracker": {
    "samples": 60,
    "timeSpan": "60.0",
    "current": {
      "rss": "77455MB",
      "heap": "26271MB",
      "external": "494017MB",
      "handles": 1033,
      "requests": 12
    },
    "growth": {
      "rss": "+5000MB",
      "heap": "+2000MB",
      "external": "+120000MB",
      "handles": 988
    },
    "growthRate": {
      "externalMBPerMin": "2000.0",
      "heapMBPerMin": "33.3"
    }
  }
}
```

---

## Heap Snapshot Analysis (Chrome DevTools)

### When to Use
When you need to identify **specific objects** being retained.

### Steps
1. Take snapshot: `./scripts/profile-memory.sh --snapshot`
2. Copy: `docker cp fitnessally-oip-gpu-1:/usr/src/app/scripts/memory-snapshots ./`
3. Load in Chrome: F12 → Memory → Load
4. Look for:
   - Large arrays
   - ArrayBuffers, Buffers
   - High "Retained Size"
   - Detached DOM nodes

### Comparison View
Take two snapshots (before/after activity) and compare to see what grew.

---

## Preventive Best Practices

### 1. Always Use LRU Caches
- Set `maxSize` (e.g., 1000 entries)
- Set `maxAge` (e.g., 30 minutes)
- Evict oldest on overflow

### 2. Always Nullify Large Buffers
```javascript
const data = response.data;
// Use data...
response.data = null;
data = null;
if (global.gc) global.gc();
```

### 3. Always Close Resources
```javascript
const stream = fs.createReadStream(file);
try {
    await processStream(stream);
} finally {
    stream.destroy(); // CRITICAL
}
```

### 4. Always Set HTTP Agent Limits
```javascript
const agent = new http.Agent({
    keepAlive: false,  // or true with aggressive limits
    maxSockets: 50,
    maxFreeSockets: 10,
    timeout: 30000
});
```

---

## Advanced Debugging

### Enable GC Tracing
```bash
node --trace-gc --trace-gc-verbose index.js
```
Look for excessive GC or "Scavenge" failures.

### Use Node.js Profiler
```bash
node --prof index.js
# After crash:
node --prof-process isolate-*.log > profile.txt
```

### Check File Descriptors
```bash
lsof -p $(pgrep -f "node.*index.js") | wc -l
```
If > 1000, you have a file/socket leak.

---

## API Endpoints

```bash
# Memory health status
GET /api/health/memory

# Tracker report (growth analysis)
GET /api/health/memory/tracker

# Force GC and clear caches
POST /api/health/memory/clear-cache
```

---

## Summary

**Stop guessing, use data:**

1. **Real-time tracker** detects leaks automatically
2. **Diagnostic script** classifies the leak type
3. **Heap snapshots** identify specific objects
4. **Systematic process** ensures fixes work

**Success metrics:**
- External/Heap < 50%
- External/RSS < 100%
- Active handles stable
- Growth rate ~0 when idle
