# GUN 404 Fix - Deployment Guide

## Quick Reference

**Problem:** 404 errors were being retried 2x (3 total attempts) due to bug in retry logic, causing massive external memory leaks.

**Solution:** Check 404 status BEFORE nulling response, add 404 cache to skip known-missing souls.

**Expected impact:** 67-100% reduction in HTTP requests for missing records, external memory stabilization.

---

## Deployment Steps

### Step 1: Stop the Container
```bash
cd /Users/devon/Documents/CODE-local/oip-arweave-indexer

# For FitnessAlly
docker-compose stop fitnessally-oip-gpu-1

# For oip-main
docker-compose stop oip-main-oip-1
```

### Step 2: Rebuild with Fix
```bash
# The changes are already in the codebase (helpers/gun.js)
# Just rebuild the container

# For FitnessAlly
docker-compose up -d --build fitnessally-oip-gpu-1

# For oip-main
docker-compose up -d --build oip-main-oip-1
```

### Step 3: Monitor Startup
```bash
# Watch for successful startup
docker logs -f fitnessally-oip-gpu-1

# Look for:
# - ✅ Server initialization messages
# - 📡 GUN helper initialized
# - No immediate errors
```

---

## Immediate Verification (First 5 Minutes)

### 1. Check for 404 Cache Initialization
```bash
# Should see cache stats logging after ~100 getRecord calls
docker logs -f fitnessally-oip-gpu-1 | grep "GUN 404 Cache"
```

**Expected output (after some API activity):**
```
📊 [GUN 404 Cache] 45/100 hits (45.0% cache hit rate, 55 cached souls)
📊 [GUN 404 Cache] 78/200 hits (39.0% cache hit rate, 122 cached souls)
```

### 2. Verify 404s Return Immediately (No Retries)
```bash
# Should see ZERO or very few "after 2 retries" messages
docker logs -f fitnessally-oip-gpu-1 | grep "Error in getRecord after 2 retries"
```

**Expected:** No output (404s now return immediately without retries)

### 3. Check Memory Baseline
```bash
docker stats fitnessally-oip-gpu-1 --no-stream
```

**Expected initial memory:** 500MB - 1.5GB (depending on services)

---

## Short-Term Verification (1-2 Hours)

### 1. Monitor Cache Effectiveness
```bash
# Watch cache hit rate increase over time
docker logs fitnessally-oip-gpu-1 | grep "📊 \[GUN 404 Cache\]" | tail -20
```

**Expected progression:**
- After 30 min: 30-40% hit rate
- After 1 hour: 50-70% hit rate
- After 2 hours: 70-90% hit rate

### 2. Check Memory Growth Pattern
```bash
# Check memory every 15 minutes
watch -n 900 "docker stats fitnessally-oip-gpu-1 --no-stream"
```

**Expected pattern:**
- ✅ **Sawtooth:** Memory grows slowly → GC drops it → repeats
- ✅ **Stable:** Memory stays around baseline (500MB - 2GB)
- ❌ **Linear growth:** NOT expected (would indicate leak still present)

### 3. Check for External Memory Warnings
```bash
docker logs fitnessally-oip-gpu-1 | grep "EXTERNAL MEMORY LEAK"
```

**Expected:** No warnings (or ratio < 150%)

---

## Long-Term Verification (24-48 Hours)

### 1. Memory Stability Check
```bash
# Check memory once per hour for 24 hours
for i in {1..24}; do
  echo "Hour $i:"
  docker stats fitnessally-oip-gpu-1 --no-stream
  sleep 3600
done
```

**Success criteria:**
- Memory stays under 5GB
- No continuous growth trend
- No heap allocation failures

### 2. Cache Size Monitoring
```bash
# Check cache cleanup is working
docker logs fitnessally-oip-gpu-1 | grep "GUN 404 Cache.*Cleaned"
```

**Expected (every hour):**
```
🧹 [GUN 404 Cache] Cleaned 45 expired entries, 500 remain
```

### 3. Application Health
```bash
# Check for any crashes or restarts
docker ps -a | grep fitnessally-oip-gpu-1
```

**Expected:** Status "Up" for 24+ hours

---

## Testing Under Load

### Test 1: Workout with Missing Exercises (resolveDepth=2)
```bash
# This should trigger multiple getRecord calls
curl "http://localhost:3005/api/records?recordType=workout&resolveDepth=2&limit=5"
```

**Watch logs for:**
```bash
docker logs -f fitnessally-oip-gpu-1 | grep -E "(GUN 404|Error in getRecord)"
```

**Expected:**
- First query: Some 404s cached (1 request per missing exercise)
- Subsequent queries: Cache hits (0 requests for known-missing exercises)
- NO "after 2 retries" messages

### Test 2: Meal Plans (resolveDepth=1)
```bash
curl "http://localhost:3005/api/records?recordType=mealPlan&resolveDepth=1&limit=10"
```

**Expected:** Similar cache behavior

### Test 3: Heavy Load (Multiple Concurrent Requests)
```bash
# Run 10 concurrent requests
for i in {1..10}; do
  curl "http://localhost:3005/api/records?recordType=workout&resolveDepth=2&limit=5" &
done
wait

# Check memory after load
docker stats fitnessally-oip-gpu-1 --no-stream
```

**Expected:**
- Memory spike during requests
- Memory drops after GC
- No continuous growth

---

## Troubleshooting

### Issue: Still seeing "after 2 retries" for 404s

**Check:**
```bash
# Verify the fix is actually deployed
docker exec fitnessally-oip-gpu-1 cat /app/helpers/gun.js | grep -A 5 "const is404"
```

**Should see:**
```javascript
const is404 = error.response && error.response.status === 404;
```

**If not present:** Rebuild didn't work, try:
```bash
docker-compose down fitnessally-oip-gpu-1
docker-compose up -d --build --force-recreate fitnessally-oip-gpu-1
```

### Issue: Cache hit rate staying at 0%

**Check logs:**
```bash
docker logs fitnessally-oip-gpu-1 | grep "GUN 404" | tail -50
```

**Possible causes:**
1. No 404s happening (check if all records exist)
2. Different souls being requested each time (less cacheable)
3. Cache cleared by restart

**Not necessarily a problem** if no 404s are occurring.

### Issue: Memory still growing continuously

**Check:**
1. External memory ratio:
   ```bash
   docker logs fitnessally-oip-gpu-1 | grep "Memory Leak Tracker" | tail -20
   ```

2. If external memory ratio > 200%, there may be another leak source

3. Check for other error patterns:
   ```bash
   docker logs fitnessally-oip-gpu-1 | grep -E "(Error|Exception)" | sort | uniq -c | sort -rn | head -20
   ```

**Action:** If memory still leaking after fix:
- Check for socket/connection leaks
- Look for other retry loops
- Review any custom axios instances not using global agents

### Issue: Cache growing too large (> 50,000 entries)

**Check cache size:**
```bash
docker logs fitnessally-oip-gpu-1 | grep "GUN 404 Cache" | tail -5
```

**If cache > 50,000 entries:**
- Reduce cache size limit in `helpers/gun.js` (currently 10,000)
- Reduce cache TTL (currently 1 hour)

---

## Rollback Plan (If Needed)

### If fix causes issues:

1. **Immediate rollback:**
   ```bash
   git checkout HEAD~1 helpers/gun.js
   docker-compose restart fitnessally-oip-gpu-1
   ```

2. **Report issue:**
   - Capture logs showing the problem
   - Note any error messages
   - Check memory pattern before/after

3. **Investigate:**
   - Was the fix properly deployed?
   - Are there other retry loops?
   - Is there a different memory leak source?

---

## Success Checklist

After 24 hours, verify:

- [ ] Memory stable under 5GB
- [ ] No "after 2 retries" for 404s
- [ ] Cache hit rate > 50%
- [ ] No heap allocation failures
- [ ] No external memory warnings
- [ ] Application healthy and responsive
- [ ] Can query workouts with resolveDepth=2 without memory spike

After 7 days:

- [ ] FitnessAlly runs without restart
- [ ] Memory pattern remains stable
- [ ] No performance degradation
- [ ] Cache cleanup working (periodic "Cleaned X entries" logs)

---

## Next Steps After Success

1. **Deploy to other nodes:**
   - oip-main (same process)
   - rockhoppers (preventative, already stable)

2. **Consider optimizations:**
   - Reduce default resolveDepth to 1
   - Implement bulk record fetching
   - Add metrics endpoint for cache stats

3. **Update monitoring:**
   - Add cache hit rate to Grafana/monitoring
   - Alert on cache size > threshold
   - Track 404 volume trends

---

## Contact / Support

**Documentation:**
- Fix details: `docs/GUN_404_RETRY_BUG_FIX.md`
- Architecture: `docs/OIP_TECHNICAL_OVERVIEW.md`
- Previous fixes: `docs/MEMORY_LEAK_RULED_OUT_THEORIES.md`

**Modified files:**
- `helpers/gun.js` (lines 9-50, 262-490)

**Deployment date:** December 8, 2024  
**Expected completion:** December 9-10, 2024 (after 24-48 hour verification)

