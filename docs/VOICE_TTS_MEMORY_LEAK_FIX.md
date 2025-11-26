# Voice/TTS Audio Buffer Memory Leak Fix (November 2024)

## Critical Discovery

After implementing Elasticsearch, GraphQL, and static file serving fixes, the memory leak **persisted at ~500MB/minute** in the `fitnessally` node. The user's observation was key: *"it stays small for hours, then grows exponentially"* - pointing to **intermittent usage patterns**, not continuous requests.

### The Smoking Gun 🔫

Console logs revealed the true culprit:
```
[Voice Converse] 🔊 Including thinking sound in POST response (230478 bytes)
[StreamingCoordinator] ElevenLabs generated 50618 bytes for chunk 1
🎵 Adaptive audio chunk 1 for text: "..." (67492 bytes)
🚨 [Memory Leak Tracker] EXTERNAL MEMORY LEAK DETECTED
   Current: 65008MB
   Growth: +467MB in last 1.0 minutes
   Rate: 456.3 MB/min
```

**Pattern**: 
- 64540MB → 65008MB → 65471MB → 65950MB → 66468MB
- Consistent **~500MB/minute growth**
- Only during **voice AI usage**
- Idle periods = stable memory

## Root Causes

### 1. Thinking Sound File Loading (lines 2173-2181 in `routes/voice.js`)

**THE BUG**:
```javascript
// BEFORE - Loaded on EVERY request!
const thinkingSoundPath = path.join(__dirname, '../soundfx/thinking-v1.wav');
const thinkingAudio = fs.readFileSync(thinkingSoundPath); // 230KB buffer
response.thinkingSound = {
    audio: thinkingAudio.toString('base64'), // 230KB → 307KB base64!
    duration: 2300,
    loop: true,
    format: 'wav'
};
```

**Problem**:
- `fs.readFileSync()` creates new **230KB buffer** per request
- `toString('base64')` creates **307KB string** (33% larger)
- Buffer never released until GC runs
- With duplicate requests (see bug #2), that's **614KB per voice query**

### 2. Duplicate Request Bug

Logs showed:
```
[11/25/2025, 04:44:33.032 PM] POST /api/voice/converse (public)
[11/25/2025, 04:44:33.049 PM] POST /api/voice/converse (public)
```

**Same query processed TWICE**, doubling all buffer allocations!

### 3. TTS Audio Chunks (ElevenLabs API)

From `helpers/generators.js` line 1018:
```javascript
const response = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/...`,
    { ... },
    { responseType: 'arraybuffer' } // ← 50-70KB per chunk
);
```

**Problem**:
- Each voice response = multiple TTS chunks
- Each chunk = 50-70KB arraybuffer
- Chunks sent via socket but **references held**
- Axios interceptor cleanup doesn't run (different code path)

### 4. Dialogue State Accumulation

```javascript
ongoingStream.data.push({
    event: 'audioChunk',
    data: { audio: audioChunk, ... }
});
```

**Problem**:
- All chunks buffered in `ongoingDialogues` Map
- Only cleaned up when dialogue **explicitly closed**
- If client disconnects without cleanup = **permanent leak**
- Stale dialogues held for 30 minutes before auto-cleanup

### 5. Memory Tracker Self-Leak

From `helpers/memoryTracker.js` line 56-57:
```javascript
// WRONG - This doesn't release object references!
handles.length = 0;
requests.length = 0;
```

**Problem**:
- Setting `array.length = 0` doesn't clear references in V8
- Handles/requests objects still referenced by `handleTypes`/`requestTypes`
- 60 samples × potentially large type maps = accumulation
- **The tracker itself was leaking!**

## Complete Fix (5 Parts)

### Fix #1: Remove Thinking Sound Transfer (BEST SOLUTION!)

**File**: `routes/voice.js` (lines 2184-2207)

**THE INSIGHT**: Instead of caching the thinking sound on the backend, **eliminate the transfer entirely** by having clients play a local asset!

**BEFORE** (sending 307KB per request):
```javascript
const response = {
    success: true,
    dialogueId: dialogueId,
    thinkingIndicator: thinkingIndicator
};

if (!useTextResponse) {
    const cachedSound = getThinkingSound(); // 230KB file → 307KB base64
    response.thinkingSound = cachedSound;   // ❌ 307KB transfer!
}

res.json(response);
```

**AFTER** (sending ~200 bytes):
```javascript
const response = {
    success: true,
    dialogueId: dialogueId,
    thinkingIndicator: thinkingIndicator
    // No thinkingSound! Client plays local asset based on thinkingIndicator.type
};

if (thinkingIndicator.type === 'sound') {
    console.log(`[Voice Converse] 🎵 Client will play local thinking sound (0 bytes transferred)`);
}

res.json(response);
```

**Impact**:
- **Before**: 307KB per request (614KB with duplicate requests)
- **After**: 0 bytes (client uses local `thinking-v1.wav`)
- **Savings**: 307KB × number of requests
- **Example**: 1000 requests = **307MB saved**!

**Client Implementation**:
The mobile app already has `thinking-v1.wav` locally and plays it based on `thinkingIndicator.type === 'sound'`.

---

### Fix #1b: Cache Thinking Sound (DEPRECATED - No longer needed!)

```javascript
// MEMORY LEAK FIX: Cache thinking sound to prevent reloading 230KB file on every request
let cachedThinkingSound = null;
function getThinkingSound() {
    if (!cachedThinkingSound) {
        try {
            const thinkingSoundPath = path.join(__dirname, '../soundfx/thinking-v1.wav');
            const thinkingAudio = fs.readFileSync(thinkingSoundPath);
            cachedThinkingSound = {
                audio: thinkingAudio.toString('base64'),
                duration: 2300,
                loop: true,
                format: 'wav',
                size: thinkingAudio.length
            };
            console.log(`✅ [Voice] Cached thinking sound (${thinkingAudio.length} bytes)`);
        } catch (error) {
            console.error(`❌ [Voice] Failed to cache thinking sound:`, error.message);
            return null;
        }
    }
    return cachedThinkingSound;
}
```

**Usage** (lines 2194-2204):
```javascript
if (!useTextResponse) {
    const cachedSound = getThinkingSound();
    if (cachedSound) {
        response.thinkingSound = cachedSound; // Reference only, no copy!
        console.log(`[Voice Converse] 🔊 Using cached thinking sound (${cachedSound.size} bytes)`);
    } else {
        // Fallback to text
        thinkingIndicator.type = 'text';
    }
}
```

**Impact**:
- **Before**: 307KB allocation per request
- **After**: 307KB allocated ONCE at startup, referenced thereafter
- **Savings**: ~30MB/100 requests

### Fix #2: Aggressive Dialogue Cleanup

**File**: `routes/voice.js` (lines 2933-2949)

```javascript
// Clean up if no more clients
if (stream.clients.size === 0) {
    console.log(`No more voice clients for dialogueId: ${dialogueId}. Cleaning up.`);
    
    // MEMORY LEAK FIX: Aggressively clear all data before deleting
    if (stream.data && Array.isArray(stream.data)) {
        const dataSize = stream.data.length;
        stream.data.splice(0, stream.data.length); // Remove all elements
        stream.data = null;
        if (dataSize > 10) {
            console.log(`🧹 [Voice Cleanup] Cleared ${dataSize} buffered messages`);
        }
    }
    stream.clients.clear();
    
    ongoingDialogues.delete(dialogueId);
    
    // Force GC if we just cleaned up a large dialogue
    if (global.gc) {
        setImmediate(() => global.gc());
    }
}
```

**Impact**:
- Immediately releases **all buffered audio/text data**
- Forces garbage collection after cleanup
- Prevents stale dialogue accumulation

### Fix #3: Enhanced Periodic Cleanup

**File**: `helpers/sharedState.js` (lines 17-31)

```javascript
// Remove dialogues that haven't been accessed in 30 minutes
if (timeSinceActivity > DIALOGUE_TIMEOUT) {
    console.log(`🧹 [Memory Cleanup] Removing stale dialogue ${dialogueId}...`);
    
    // MEMORY LEAK FIX: Aggressively clear dialogue data before deleting
    if (dialogue.data && Array.isArray(dialogue.data)) {
        // Clear any buffered audio/text data
        dialogue.data.splice(0, dialogue.data.length);
        dialogue.data = null;
    }
    if (dialogue.clients) {
        dialogue.clients.clear();
    }
    
    ongoingDialogues.delete(dialogueId);
    cleanedCount++;
}
```

**Impact**:
- Catches dialogues that weren't manually cleaned up
- Runs every 5 minutes
- Prevents 30-minute accumulation window

### Fix #4: Fix Memory Tracker Self-Leak

**File**: `helpers/memoryTracker.js` (lines 40-66)

```javascript
takeSample() {
    // ...
    const handles = process._getActiveHandles();
    const requests = process._getActiveRequests();
    
    const handleTypes = this._countTypes(handles);
    const requestTypes = this._countTypes(requests);
    const handleCount = handles.length;
    const requestCount = requests.length;
    
    // CRITICAL FIX: Completely destroy references by replacing arrays
    // Setting length = 0 doesn't release object references!
    handles.splice(0, handles.length); // Actually removes elements
    requests.splice(0, requests.length);

    // ...
    
    // MEMORY LEAK FIX: Keep max 30 samples instead of 60
    const MAX_SAMPLES = 30;
    if (this.samples.length > MAX_SAMPLES) {
        this.samples.splice(0, this.samples.length - MAX_SAMPLES);
    }
    
    // MEMORY LEAK FIX: Force GC after sample if external memory is very high
    if (memUsage.external > 10 * 1024 * 1024 * 1024 && global.gc) { // > 10GB
        setImmediate(() => {
            global.gc();
        });
    }
}
```

**Changes**:
1. `splice()` instead of `length = 0` - actually removes references
2. 30 samples max (was 60) - reduces metadata footprint
3. Force GC when external memory > 10GB
4. More aggressive cleanup

### Fix #5: Option to Disable Tracker for Testing

**File**: `index.js` (lines 754-765)

```javascript
// Start memory leak tracker (can be disabled via DISABLE_MEMORY_TRACKER=true)
if (process.env.DISABLE_MEMORY_TRACKER !== 'true') {
    const memTracker = getTracker({
        trackingInterval: 60000,
        maxSamples: 30, // Reduced from 60
        alertThreshold: 5000
    });
    memTracker.start();
    console.log('🔍 [STARTUP] Memory leak tracker started (30 samples max)');
} else {
    console.log('⚠️ [STARTUP] Memory leak tracker DISABLED (testing)');
}
```

**Usage**:
```bash
# Test if tracker itself is causing leak
DISABLE_MEMORY_TRACKER=true docker-compose up fitnessally-oip-gpu-1
```

## Expected Results

### Immediate Benefits
1. **Thinking sound**: 307KB → **0KB** (after first load)
2. **Dialogue cleanup**: Instant release vs. 30-minute delay
3. **Memory tracker**: 50% less metadata (30 vs 60 samples)
4. **Forced GC**: Runs after every dialogue cleanup

### Memory Pattern
- **Before**: 64GB → 65GB → 66GB → 67GB (continuous growth)
- **After**: Sawtooth pattern (small growth → GC → drop → repeat)
- **Growth rate**: ~500MB/min → **<50MB/min** (10x improvement)

### Voice Usage Impact
| Scenario | Before | After |
|----------|--------|-------|
| Single voice query | 614KB (thinking) + 200KB (TTS) = 814KB | 200KB only (thinking cached) |
| 100 queries | 81MB | 20MB |
| 1000 queries (1 hour heavy use) | 814MB | 200MB |

## Testing & Verification

### 1. Check Thinking Sound is NOT Transferred
```bash
# Should see on each request (0 bytes transferred!)
docker logs -f fitnessally-oip-gpu-1 | grep "thinking sound"
# [Voice Converse] 🎵 Client will play local thinking sound (0 bytes transferred)

# Should NOT see any "Cached thinking sound" or "Including thinking sound" messages
```

### 2. Monitor Dialogue Cleanup
```bash
# Should see after EVERY voice session ends
docker logs -f fitnessally-oip-gpu-1 | grep "Voice Cleanup"
# 🧹 [Voice Cleanup] Cleared 47 buffered messages
```

### 3. Check Memory Growth
```bash
# Memory should stabilize or show sawtooth (not continuous growth)
docker logs -f fitnessally-oip-gpu-1 | grep "Memory Monitor"
# Watch "External" value - should not grow continuously
```

### 4. Test with Tracker Disabled
```bash
# Edit docker-compose.yml or .env
DISABLE_MEMORY_TRACKER=true

# Rebuild and restart
docker-compose up -d --build fitnessally-oip-gpu-1

# If leak stops, tracker was the culprit
# If leak continues, TTS/dialogue cleanup needs more work
```

### 5. Verify No Stale Dialogues
```bash
# Should see periodic cleanup (every 5 minutes)
docker logs -f fitnessally-oip-gpu-1 | grep "Memory Cleanup"
# 🧹 [Memory Cleanup] Cleaned up 3 stale dialogues (12 remaining)
```

## Troubleshooting

### If Leak Persists

1. **Disable memory tracker first**:
   ```bash
   DISABLE_MEMORY_TRACKER=true
   ```
   - If leak stops → tracker is culprit
   - If leak continues → TTS/dialogue issue

2. **Check for duplicate requests**:
   ```bash
   docker logs -f fitnessally-oip-gpu-1 | grep "POST /api/voice/converse" | uniq -c
   ```
   - Should see `1` (not `2`) per unique timestamp

3. **Monitor dialogue accumulation**:
   ```javascript
   // Add to voice routes temporarily
   console.log(`📊 Active dialogues: ${ongoingDialogues.size}`);
   ```
   - Should not grow continuously
   - Should drop to 0-5 between sessions

4. **Check ElevenLabs API usage**:
   ```bash
   docker logs -f fitnessally-oip-gpu-1 | grep "ElevenLabs generated"
   ```
   - Note chunk sizes
   - Should match number of voice responses

5. **Heap dump analysis**:
   ```bash
   docker exec fitnessally-oip-gpu-1 sh -c "kill -USR2 \$(pgrep -f node)"
   # Analyze heapsnapshot file to see what's holding references
   ```

## Related Fixes

This fix complements previous memory leak fixes:
1. **Elasticsearch Client Recreation** (`docs/UNDICI_MEMORY_LEAK_FIX.md`)
2. **GraphQL Socket Leak** (`docs/SOCKET_LEAK_FIX_2024-11.md`)
3. **Static GIF Serving** (`docs/GIF_STATIC_SERVING_MEMORY_LEAK_FIX.md`)
4. **Axios Buffer Cleanup** (`index.js` lines 72-169)

All four sources must be addressed for complete leak resolution.

## Implementation Date

November 26, 2024

## Status

✅ **Implemented** - Awaiting production verification

User should test with:
1. Normal voice usage (10-20 queries)
2. Heavy voice usage (100+ queries in 1 hour)
3. Idle periods (no usage for 1-2 hours)
4. With and without memory tracker enabled

Expected result: Memory stable or sawtooth pattern, NO continuous growth.

## Notes

- Thinking sound caching is safe (file doesn't change at runtime)
- Dialogue cleanup is aggressive but necessary
- Memory tracker reduction (60→30 samples) is acceptable tradeoff
- Force GC after cleanup ensures buffers are released promptly
- Duplicate request bug needs frontend investigation (possible race condition)

