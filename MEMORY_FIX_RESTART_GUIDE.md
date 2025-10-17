# 🚀 Memory Fix Restart Guide

## Quick Summary

Your application was crashing at **26.5 GB heap usage**. We've identified and fixed **THREE CRITICAL memory leaks**:

1. ✅ **ALFRED fullTextCache** - Unbounded Map → Now LRU cache with 1000 entry limit
2. ✅ **Elasticsearch keepDBUpToDate** - Large array accumulation → Now bounded with cleanup
3. ✅ **Memory monitoring** - None → Now automatic every 5 minutes with GC triggers

---

## 🔧 Step-by-Step Restart Instructions

### Step 1: Configure Memory (IMPORTANT - Includes --expose-gc)

```bash
# Navigate to your project directory
cd /Users/devon/Documents/CODE-local/oip-arweave-indexer

# Set memory to 16GB (recommended) - This automatically adds --expose-gc
make set-memory-16gb

# Or use the script directly
./set-memory.sh 16384
```

### Step 2: Verify Configuration

```bash
# Check that --expose-gc was added
make check-memory-config

# You should see:
# ✓ Heap Size: 16384 MB (16.00GB)
#   Full Options: --max-old-space-size=16384 --expose-gc
```

### Step 3: Start Services

```bash
# Start with your preferred profile
make standard              # Full stack
# OR
make backend-only         # Backend only
# OR
make minimal              # Core services only
```

### Step 4: Monitor Memory (First Hour)

Open a terminal and monitor memory usage:

```bash
# Watch memory monitor logs
docker logs oip -f | grep "Memory Monitor"
```

You should see output like:
```
[Memory Monitor] Heap: 523MB / 16384MB (3.19%), RSS: 1024MB
[Memory Monitor] Heap: 1245MB / 16384MB (7.60%), RSS: 1856MB
```

---

## 📊 What to Expect

### Healthy Memory Pattern

```
Time          Heap Usage    Notes
─────────────────────────────────────────────────────
Startup       ~500MB        Initial load
15 minutes    ~1.5GB        Normal operation
30 minutes    ~2.2GB        ALFRED cache fills
1 hour        ~2.8GB        Stable
1.5 hours     ~2.6GB        ALFRED cache cleared (30 min)
2 hours       ~2.8GB        GUN cache cleared (60 min)
3+ hours      ~2.5-3.0GB    Stable oscillation
```

### Warning Signs (Old Behavior - Should NOT happen now)

❌ If you see continuous growth above 4GB after 2 hours
❌ If heap utilization exceeds 80% consistently
❌ If memory never drops after cache clears

---

## 🔍 Verification Commands

### 1. Check Memory Monitor is Working

```bash
docker logs oip -f | grep "Memory Monitor"
```

**Expected:** Log every 5 minutes showing heap usage

### 2. Check Cache Cleanup

```bash
docker logs oip -f | grep -E "ALFRED Cache|GUN cache|Auto-cleared"
```

**Expected:** Cache clear messages every 30-60 minutes

### 3. Check API Health

```bash
# Memory health
curl http://localhost:3005/api/health/memory | jq

# GUN sync status
curl http://localhost:3005/api/health/gun-sync | jq
```

### 4. Continuous Monitoring (Run in separate terminal)

```bash
# Watch heap utilization every 30 seconds
watch -n 30 'curl -s http://localhost:3005/api/health/memory | jq ".heap.utilization, .memory.heapUsedMB"'
```

---

## 🎯 Success Criteria

After 24 hours, verify:

- [ ] ✅ Application still running (no crashes)
- [ ] ✅ Heap usage < 4GB consistently
- [ ] ✅ Memory monitor logs showing regular updates
- [ ] ✅ Cache cleanup messages appearing every 30-60 minutes
- [ ] ✅ Heap utilization staying below 30% (with 16GB heap)

---

## 🐛 Troubleshooting

### Issue: High Memory Usage (>80% heap)

**Check:**
```bash
# Verify --expose-gc is enabled
make check-memory-config

# Force manual cache clear
curl -X POST http://localhost:3005/api/health/memory/clear-cache
```

**Solution:**
If --expose-gc is missing, reconfigure:
```bash
make set-memory-16gb
make down
make standard
```

### Issue: Still Growing After Fixes

**Collect diagnostics:**
```bash
# Take heap snapshot
node scripts/diagnose-memory.js snapshot

# Check for other memory consumers
docker exec oip node -e "console.log(process.memoryUsage())"
```

**Then:** Review the snapshot in Chrome DevTools Memory tab

### Issue: Seeing "Ineffective mark-compacts" Again

**This means:**
- Either --expose-gc is not enabled, OR
- There's another memory leak we haven't found

**Action:**
```bash
# 1. Verify GC is enabled
docker exec oip node -e "console.log(typeof global.gc)"
# Should output: "function"

# 2. Check logs for GC triggers
docker logs oip | grep "Forcing garbage collection"

# 3. If no GC logs, restart with --expose-gc
```

---

## 📈 Performance Impact

### Before Fixes
- Runtime: 8-12 hours before crash
- Final heap: 26.5 GB
- Memory pattern: Continuous growth

### After Fixes (Expected)
- Runtime: ♾️ Indefinite
- Stable heap: 2.5-3.5 GB (with 16GB allocated)
- Memory pattern: Stable oscillation with periodic cleanup

### Resource Usage
- CPU: No significant change
- Disk I/O: Slightly reduced (less thrashing before OOM)
- Network: No change

---

## 🔄 Optional: Add Environment Variables

For more aggressive memory management, add to your `.env`:

```bash
# ALFRED Cache (more aggressive)
ALFRED_CACHE_MAX_SIZE=500           # Smaller cache
ALFRED_CACHE_MAX_AGE=900000         # Clear every 15 min

# Elasticsearch Indexing
MAX_TRANSACTIONS_PER_CYCLE=500      # Process fewer per cycle

# Memory Monitoring (more frequent)
MEMORY_MONITOR_INTERVAL=60000       # Monitor every minute
MEMORY_WARNING_THRESHOLD=70         # Earlier warning
```

Then restart:
```bash
make down
make standard
```

---

## 📞 Need Help?

If memory issues persist after 24 hours:

1. **Collect Full Diagnostics:**
   ```bash
   node scripts/diagnose-memory.js > memory-report.txt
   curl http://localhost:3005/api/health/memory > memory-health.json
   docker logs oip > oip-logs.txt 2>&1
   ```

2. **Check for patterns in logs:**
   ```bash
   grep -i "memory\|leak\|heap\|gc" oip-logs.txt
   ```

3. **Review files changed:**
   - `helpers/alfred.js` (ALFRED cache LRU)
   - `helpers/elasticsearch.js` (Elasticsearch cleanup)
   - `index.js` (Memory monitor)

---

## ✅ Files Modified

1. `helpers/alfred.js` - LRU cache implementation
2. `helpers/elasticsearch.js` - Array cleanup + transaction limits  
3. `index.js` - Automatic memory monitoring
4. `set-memory.sh` - Now adds --expose-gc automatically
5. `MEMORY_LEAK_FIX_SUMMARY.md` - Comprehensive documentation

---

**Created:** 2025-10-17  
**Status:** ✅ READY TO TEST  
**Estimated Test Duration:** 24-48 hours for full verification

**Expected Result:** Stable memory < 4GB with 16GB heap, running indefinitely ♾️

