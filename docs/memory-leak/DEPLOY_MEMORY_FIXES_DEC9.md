# Memory Leak Fixes - December 9, 2024

## Root Cause Analysis

From your logs, I identified **TWO major memory leaks**:

### 1. **Static GIF Serving Buffer Explosion**
- FitnessAlly app requests 100+ GIF files when browsing exercises
- `express.static()` opens file streams for all concurrent requests
- Buffers accumulate faster than garbage collection can clean them up
- **Growth rate: ~123 MB/minute (241MB → 4GB in 30 minutes)**

### 2. **GUN Deletion Retry Storm**
- Same 8-10 workout/shopping_list records fail deletion (GUN relay returns 500)
- System retries these deletions every sync cycle
- Each failed attempt accumulates error response buffers
- Buffers are never cleaned up, accumulating indefinitely

## Fixes Implemented

### Fix #1: Ultra-Aggressive GC + Stream Limiting for Static Files

**File**: `index.js`

**Changes**:
1. **Semaphore limiting**: Max 20 concurrent file streams (prevents buffer explosion)
2. **Ultra-aggressive GC**: Forces GC on EVERY GIF response (not throttled)
3. **Double GC**: Second GC after 100ms to catch stragglers
4. **Better logging**: Shows RSS growth, active streams, and GC effectiveness

**How it works**:
```
Request Queue: [GIF1, GIF2, ..., GIF100]
               ↓
Semaphore: Only 20 can have open file streams at once
               ↓
After each response: Immediate GC in process.nextTick()
               ↓
100ms later: Second GC to clean stragglers
```

### Fix #2: GUN Deletion Failure Cache

**File**: `helpers/gun.js`

**Changes**:
1. **Failure cache**: Tracks souls that have failed deletion 3+ times
2. **Skip silently**: Prevents log spam and repeated axios calls
3. **Buffer cleanup**: Immediately nulls error.response buffers
4. **Stats logging**: Reports cache effectiveness every 10 skips

**How it works**:
```
Attempt 1: workout_xyz fails with 500 → Cache it (count: 1), log once
Attempt 2: workout_xyz fails with 500 → Cache it (count: 2), no log
Attempt 3: workout_xyz fails with 500 → Cache it (count: 3), no log
Attempt 4+: workout_xyz → SKIP (cached), return true immediately
```

###  Fix #3: Memory Diagnostics Logging Improvements

**File**: `helpers/memoryDiagnostics.js`

**Changes**:
1. **Better error handling**: Logs why file writes fail
2. **Console fallback**: Always logs to console if file write fails
3. **More verbose initialization**: Shows log file path and status

## Deployment Instructions

### On your remote server:

```bash
cd /path/to/oip-arweave-indexer

# 1. Pull the latest code changes
git pull

# OR if you're using a local copy, rsync the changes:
# rsync -av /local/path/ server:/remote/path/

# 2. Verify MEMORY_DIAGNOSTICS_ENABLED is in .env
grep MEMORY_DIAGNOSTICS .env
# Should show: MEMORY_DIAGNOSTICS_ENABLED=true

# 3. Rebuild and restart the container
docker-compose down
docker-compose build
docker-compose up -d

# 4. Watch for diagnostic initialization
docker logs -f fitnessally-oip-gpu-1 | grep -E "(Memory Diagnostics|GIF|GUN Delete Stats)"
```

You should immediately see:
```
🔬 [Memory Diagnostics] ENABLED - Safe profiling active
📁 [Memory Diagnostics] Created log directories
🔬 [Memory Diagnostics] Initialized successfully - Monitoring every 60s
📝 [Memory Diagnostics] Log file: /app/logs/memory-diagnostics.log
💾 [Memory Diagnostics] Heap dumps: /app/logs/heap-dumps
```

## Monitoring

### 1. Watch Memory Growth (Docker Stats)
```bash
watch -n 10 'docker stats fitnessally-oip-gpu-1 --no-stream'
```

**Expected behavior**: Memory should stabilize around 500MB-1GB and NOT grow to 4GB+

### 2. Watch GIF Serving Effectiveness
```bash
docker logs -f fitnessally-oip-gpu-1 | grep "GIF"
```

**Look for**:
```
🧹 [GIF #50] GC #50 | 15ms | RSS: 650MB | Active: 12/20
```

- **RSS should stay < 2GB** even after hundreds of GIF requests
- **Active streams should stay ≤ 20**

### 3. Watch GUN Deletion Cache
```bash
docker logs -f fitnessally-oip-gpu-1 | grep "GUN Delete Stats"
```

**Look for**:
```
📊 [GUN Delete Stats] Attempts: 100, Skipped (cached failures): 80
```

- **Skipped count should grow** (proves cache is working)
- **Should stop seeing repeated deletion errors for the same souls**

### 4. Watch Memory Diagnostics Log
```bash
tail -f logs/memory-diagnostics.log
```

OR if file doesn't exist, watch console output:
```bash
docker logs -f fitnessally-oip-gpu-1 | grep "🔬"
```

**Look for**:
```
[PERIODIC] Growth rate: RSS 10.0 MB/min, External 5.0 MB/min
[SUMMARY] static_media: 150 operations, Total Growth: RSS +200MB
```

## Success Criteria

### ✅ Fixed if you see:

1. **Memory stabilizes** at < 2GB after 1 hour of use
2. **GIF serving logs** show RSS staying flat despite hundreds of requests
3. **GUN deletion errors** stop repeating after 3 attempts per soul
4. **Diagnostic log shows** low growth rates (< 20 MB/min)

### ❌ Still broken if you see:

1. **Memory grows** from 300MB → 4GB in < 1 hour
2. **RSS jumps** by 100+MB every few minutes
3. **Same GUN deletion errors** repeat endlessly
4. **Diagnostic log shows** high growth rates (> 50 MB/min)

## If Memory Still Grows

If memory still leaks after these fixes, the diagnostic log will tell us EXACTLY which operation category is responsible:

```
[SUMMARY] === OPERATION CATEGORY SUMMARY ===
[SUMMARY] api_records: 50 operations, Total Growth: External +5000MB  ← THIS IS THE CULPRIT
[SUMMARY] static_media: 150 operations, Total Growth: RSS +200MB     ← This is fine
```

Then we can target that specific operation for further fixes.

## Notes

- **Heap dumps will still freeze the app** at 2GB, 4GB thresholds (takes 5-10 min)
- **External memory counter is inaccurate** - ignore it, focus on RSS
- **GUN relay 500 errors** will appear 3 times per soul, then stop (cached)
- **Diagnostic log** might not exist if directory permissions fail (will fallback to console)

---

## Rollback (if needed)

If something breaks:

```bash
docker-compose down
git checkout HEAD~1  # Roll back to previous commit
docker-compose up -d
```

---

**Next Steps**: Let it run for 1-2 hours, then send me the output of these commands:

```bash
# 1. Memory usage
docker stats fitnessally-oip-gpu-1 --no-stream

# 2. Last 100 lines of diagnostic log
tail -100 logs/memory-diagnostics.log
# OR if file doesn't exist:
docker logs fitnessally-oip-gpu-1 | grep "🔬" | tail -50

# 3. GIF serving stats
docker logs fitnessally-oip-gpu-1 | grep "GIF" | tail -20

# 4. GUN deletion stats
docker logs fitnessally-oip-gpu-1 | grep "GUN Delete Stats" | tail -10
```

This will tell us if the fixes worked! 🎯

