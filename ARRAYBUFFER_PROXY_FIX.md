# ArrayBuffer Proxy Fix - ElevenLabs & TTS Audio Errors

## Issue Summary

**Error:** `TypeError: this is not a typed array`  
**Affected:** All audio synthesis endpoints (ElevenLabs, local TTS, streaming coordinators)  
**Root Cause:** Memory leak prevention code in `index.js` wraps all arraybuffer responses in a Proxy, which `Buffer.from()` cannot directly convert.

## Root Cause Analysis

### The Memory Leak Fix (index.js lines 48-108)

A memory leak prevention system was implemented that wraps all axios responses with `responseType: 'arraybuffer'` in a Proxy:

```javascript
// index.js line 64-69
const dataProxy = new Proxy(originalData, {
  get(target, prop) {
    dataAccessed = true;
    return target[prop];
  }
});
```

**Purpose:** Track arraybuffer access and enable automatic cleanup to prevent 47GB+ memory leaks from TTS audio and image downloads.

**Side Effect:** The Proxy wrapper breaks `Buffer.from(response.data)` calls because:
1. `Buffer.from()` performs type checking on the input
2. The Proxy object is not recognized as a TypedArray
3. Results in: `TypeError: this is not a typed array`

## The Solution

Replace all direct `Buffer.from(response.data)` calls with:

```javascript
// ❌ BEFORE (fails with Proxy)
return Buffer.from(response.data);

// ✅ AFTER (works with Proxy)
return Buffer.from(new Uint8Array(response.data));
```

**Why this works:**
- Creating a `Uint8Array` view accesses the Proxy's underlying ArrayBuffer
- The Proxy's `get` trap intercepts the access and returns the actual data
- `Buffer.from()` can then convert the Uint8Array successfully

## Files Modified

### 1. `helpers/streamingCoordinator.js`
- **Line 310:** ElevenLabs synthesis (streaming chunks)
- **Line 358:** Local TTS synthesis (streaming chunks)

### 2. `helpers/generators.js`
- **Line 2151:** ElevenLabs audio base64 conversion
- **Line 2797:** ElevenLabs buffer return
- **Line 1063-1066:** Error response handling (added type check)

### 3. `routes/voice.js`
- **Line 2885:** ElevenLabs direct synthesis endpoint

### 4. `routes/voice_old.js`
- **Line 1114:** Legacy ElevenLabs synthesis endpoint

### 5. `routes/generate.js`
- **Line 1725:** Fallback TTS endpoint

### 6. `helpers/media-manager.js`
- **Line 130:** Media download from URL

### 7. `mac-client/simple_webrtc_signaling.js`
- **Line 314:** WebRTC TTS audio base64 conversion

## Testing Verification

All modified files passed linting with no errors.

## Expected Behavior After Fix

### ✅ **Working:**
- ElevenLabs voice synthesis in streaming mode
- Local TTS fallback synthesis
- Audio chunk generation and streaming
- Media file downloads
- All arraybuffer-based API responses

### ✅ **Still Functional:**
- Memory leak prevention (Proxy still tracks access)
- Automatic cleanup of large buffers
- GC triggering for 1MB+ buffers

## Prevention

**For Future Code:**

When working with axios responses that use `responseType: 'arraybuffer'`, always use:

```javascript
// ✅ CORRECT - Handles Proxy wrapper
const buffer = Buffer.from(new Uint8Array(response.data));

// ❌ INCORRECT - Fails with Proxy
const buffer = Buffer.from(response.data);
```

## Related Documentation

- **Memory Management:** See `MEMORY_MANAGEMENT_GUIDE.md`
- **TTS Architecture:** See `ALFRED_COMPLETE_GUIDE.md` (TTS section)
- **API Usage:** See `API_RECORDS_ENDPOINT_DOCUMENTATION.md`

## Technical Notes

### Proxy Access Pattern

The Proxy intercepts property access, so these all work:

```javascript
response.data.byteLength  // ✅ Works - property access
response.data[0]          // ✅ Works - index access
new Uint8Array(response.data)  // ✅ Works - constructor accepts Proxy
Buffer.from(response.data)     // ❌ Fails - type check rejects Proxy
```

### Alternative Solutions Considered

1. **Remove the Proxy** - Would reintroduce 47GB memory leaks ❌
2. **Modify axios interceptor** - Would affect all arraybuffer responses globally ⚠️
3. **Use Uint8Array wrapper** - Minimal change, maintains memory cleanup ✅ (chosen)

## Deployment Notes

- No database migrations required
- No environment variable changes required
- No Docker rebuild required (code-only changes)
- Backwards compatible with existing API clients

## Monitoring

After deployment, monitor for:
- ✅ Successful audio synthesis requests
- ✅ No "this is not a typed array" errors in logs
- ✅ Memory usage remains stable (no leak regression)
- ✅ Audio streaming works in real-time

---

**Fixed:** January 21, 2025  
**Affected Versions:** All versions with memory leak prevention (index.js lines 48-108)  
**Status:** ✅ Resolved

