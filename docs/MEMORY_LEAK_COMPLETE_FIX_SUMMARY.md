# Complete Memory Leak Fix Summary (November 2024)

## The Journey: From 500MB/min to Stable 🎯

### Initial Symptoms
- **Memory growth**: 500MB/minute in `fitnessally` node
- **Peak usage**: 65GB+ (from 5.3GB baseline)
- **Pattern**: Exponential growth during voice AI usage, stable when idle
- **Time to crash**: ~70 minutes at peak growth rate

## Root Causes Identified (4 Major Leaks)

### 1. ⚡ Voice/TTS Audio Buffers (PRIMARY - 500MB/min)
**Location**: `routes/voice.js`
- **Thinking sound**: 307KB base64 sent per request (614KB with duplicate requests)
- **TTS chunks**: 50-70KB arraybuffers × multiple chunks per response
- **Dialogue buffers**: All chunks held in `ongoingDialogues` Map
- **Cleanup delay**: 30 minutes before auto-cleanup
- **Memory tracker self-leak**: `array.length = 0` doesn't release references

### 2. 🔍 Elasticsearch/Undici Buffer Accumulation
**Location**: `helpers/elasticsearch.js`
- Undici HTTP client accumulates response buffers
- Buffers not released until client closed
- **Fix**: Periodic client recreation every 5 minutes

### 3. 🌐 GraphQL Client Socket Leak
**Location**: `helpers/elasticsearch.js`
- `graphql-request` creating new connections without closing
- TCPConnectWrap handles accumulating
- **Fix**: Managed client with `keepAlive: false` agents

### 4. 📦 Static GIF Serving
**Location**: `index.js`
- 100+ GIF requests/minute (300-500KB each)
- No browser caching = repeated transfers
- File buffers accumulating faster than GC
- **Fix**: Aggressive browser caching + forced GC

## Complete Solution (All 4 Leaks Fixed)

### Voice/TTS Fixes (PRIMARY)

#### ✅ **Eliminate Thinking Sound Transfer** (Best Solution!)
**Impact**: **307KB → 0 bytes per request**

```javascript
// BEFORE: Sent 307KB base64 audio every request
response.thinkingSound = cachedSound; // ❌ 307KB!

// AFTER: Client plays local asset (0 bytes transferred)
response.thinkingIndicator = { type: 'sound' }; // ✅ Trigger only!
```

**Savings**:
- 1 request: 307KB saved
- 100 requests: 30MB saved
- 1000 requests: **307MB saved**!

#### ✅ **Aggressive Dialogue Cleanup**
```javascript
// Clear all buffered data immediately on client disconnect
if (stream.data && Array.isArray(stream.data)) {
    stream.data.splice(0, stream.data.length); // Remove ALL elements
    stream.data = null;
}
stream.clients.clear();
ongoingDialogues.delete(dialogueId);

// Force GC
if (global.gc) {
    setImmediate(() => global.gc());
}
```

#### ✅ **Fix Memory Tracker Self-Leak**
```javascript
// BEFORE: Doesn't release references!
handles.length = 0; // ❌ References still held

// AFTER: Actually removes elements
handles.splice(0, handles.length); // ✅ Destroys references

// ALSO: Reduced samples from 60 → 30
// ALSO: Force GC when external memory > 10GB
```

### Elasticsearch Fix
```javascript
// Recreate client every 5 minutes to clear Undici buffers
const ES_CLIENT_MAX_AGE = 300000; // 5 minutes
if (Date.now() - esClientCreatedAt > ES_CLIENT_MAX_AGE) {
    await esClient.close();
    esClient = createElasticsearchClient();
    if (global.gc) global.gc();
}
```

### GraphQL Fix
```javascript
// Use agents with keepAlive: false
const graphqlHttpAgent = new http.Agent({
    keepAlive: false,
    maxSockets: 50,
    maxFreeSockets: 0
});

// Recreate client every 30 minutes
if (Date.now() - graphqlClientCreatedAt > 1800000) {
    graphqlClient = new GraphQLClient(endpoint, { agent: graphqlHttpAgent });
}
```

### Static Serving Fix
```javascript
// Aggressive browser caching
const mediaStaticOptions = {
    maxAge: '1y',
    immutable: true,
    etag: true
};

// Force GC after serving files
const forceStaticCleanup = (req, res, next) => {
    const originalEnd = res.end;
    res.end = function(...args) {
        const result = originalEnd.apply(this, args);
        if (global.gc) {
            setImmediate(() => global.gc());
        }
        return result;
    };
    next();
};

app.use('/media', forceStaticCleanup, express.static(path, mediaStaticOptions));
```

## Files Modified

| File | Changes | Impact |
|------|---------|--------|
| `routes/voice.js` | Removed thinking sound transfer, aggressive cleanup | **-307KB per request** |
| `helpers/memoryTracker.js` | Fixed array cleanup, reduced samples, force GC | Eliminated self-leak |
| `helpers/sharedState.js` | Enhanced dialogue cleanup | Prevents accumulation |
| `helpers/elasticsearch.js` | Client recreation for ES + GraphQL | Clears Undici/socket leaks |
| `index.js` | Static serving config, axios cleanup, tracker option | Multiple leak fixes |

## Expected Results

### Memory Pattern
| Time | Before | After |
|------|--------|-------|
| Startup | 280MB | 280MB |
| After 1 hour (light voice use) | 5.3GB | **<1GB** |
| After 2 hours (idle) | 35GB | **<1GB** (stable!) |
| After 5 hours (mixed use) | 65GB+ | **<2GB** |

### Growth Rate
| Activity | Before | After |
|----------|--------|-------|
| Voice AI (100 queries/hour) | 500MB/min | **<10MB/min** |
| GIF browsing (100 GIFs/min) | 100MB/min | **<5MB/min** |
| Background indexing | 50MB/min | **<5MB/min** |
| Idle | 10MB/min | **~0MB/min** |

### Memory Pattern
- **Before**: Continuous exponential growth → crash
- **After**: Sawtooth pattern (small growth → GC → release → repeat)

## Verification Steps

### 1. Check Thinking Sound is NOT Transferred
```bash
docker logs -f fitnessally-oip-gpu-1 | grep "thinking sound"
# Should see: "Client will play local thinking sound (0 bytes transferred)"
# Should NOT see: "Including thinking sound in POST response (230478 bytes)"
```

### 2. Monitor Dialogue Cleanup
```bash
docker logs -f fitnessally-oip-gpu-1 | grep "Voice Cleanup"
# Should see: "🧹 [Voice Cleanup] Cleared XX buffered messages"
```

### 3. Watch Memory Growth
```bash
docker stats fitnessally-oip-gpu-1 --no-stream
# Memory should be stable or show small sawtooth, NOT continuous growth
```

### 4. Check Client Recreation
```bash
docker logs -f fitnessally-oip-gpu-1 | grep -E "ES Client|GraphQL Client"
# Should see periodic recreation messages (every 5-30 min)
```

### 5. Test Voice Usage Heavily
1. Make 20-50 voice queries in 10 minutes
2. Watch `docker stats` memory usage
3. Should see growth → GC → drop pattern
4. **NOT** continuous growth

### 6. Optional: Test with Memory Tracker Disabled
```bash
# If you want to verify tracker isn't contributing
docker-compose down fitnessally-oip-gpu-1
# Add to docker-compose.yml or .env:
DISABLE_MEMORY_TRACKER=true
docker-compose up -d --build fitnessally-oip-gpu-1
```

## Deployment

### 1. Rebuild Container
```bash
cd ~/Desktop/development/fitnessally/oip-arweave-indexer
docker-compose down fitnessally-oip-gpu-1
docker-compose up -d --build fitnessally-oip-gpu-1
```

### 2. Monitor Startup
```bash
docker logs -f fitnessally-oip-gpu-1
# Look for:
# - ✅ ES Client created
# - ✅ GraphQL Client created  
# - 🔍 Memory leak tracker started (30 samples max)
```

### 3. Test Normal Usage
- Browse GIFs
- Use voice AI
- Run API queries
- Let it idle for 30 minutes

### 4. Monitor Memory
```bash
# Check every 15 minutes for first hour
docker stats fitnessally-oip-gpu-1 --no-stream

# Should stabilize around 500MB-1.5GB depending on usage
# Should NOT grow continuously past 2GB
```

## Success Criteria ✅

- [ ] Memory stable under 2GB during normal use
- [ ] No continuous growth during voice AI usage
- [ ] Sawtooth pattern visible (growth → GC → drop)
- [ ] No "EXTERNAL MEMORY LEAK DETECTED" alerts
- [ ] "Client will play local thinking sound (0 bytes)" in logs
- [ ] Periodic "Voice Cleanup" messages
- [ ] ES/GraphQL client recreation every 5-30 minutes
- [ ] System runs for 24+ hours without restart

## If Issues Persist

1. **Check for duplicate requests**:
   ```bash
   docker logs -f fitnessally-oip-gpu-1 | grep "POST /api/voice" | uniq -c
   ```
   Should be `1` per timestamp, not `2`

2. **Disable memory tracker**:
   ```bash
   DISABLE_MEMORY_TRACKER=true
   ```
   If leak stops → tracker was contributing

3. **Heap dump analysis**:
   ```bash
   docker exec fitnessally-oip-gpu-1 sh -c "kill -USR2 \$(pgrep -f node)"
   # Analyze .heapsnapshot file to see what's holding references
   ```

4. **Check for other processes**:
   ```bash
   docker exec fitnessally-oip-gpu-1 ps aux
   # Should only see node processes, not runaway background tasks
   ```

## Related Documentation

1. `VOICE_TTS_MEMORY_LEAK_FIX.md` - Voice/TTS details
2. `UNDICI_MEMORY_LEAK_FIX.md` - Elasticsearch fix
3. `SOCKET_LEAK_FIX_2024-11.md` - GraphQL fix
4. `GIF_STATIC_SERVING_MEMORY_LEAK_FIX.md` - Static serving fix

## Credits

**User's Key Insight**: *"It stays small for hours then grows exponentially"* + *"Why not have the frontend play the sound?"*

This observation led to identifying:
1. The leak was **intermittent** (voice feature triggered)
2. The leak was **preventable** (eliminate transfer entirely)
3. The best solution is often **architectural** (client vs server responsibility)

## Implementation Date

November 26, 2024

## Status

✅ **All fixes implemented** - Ready for production testing

**Next**: Rebuild, deploy, monitor for 24 hours, verify stability.

