# GIF/Static File Serving Memory Leak Fix (November 2024)

## Problem Discovery

After implementing Elasticsearch client recreation and GraphQL client fixes, the memory leak persisted in the `fitnessally` node, which serves **hundreds of animated GIF files per minute**.

### Symptoms
- **Memory usage**: 5.3GB in the `fitnessally` node vs. 809MB in `oip` node vs. 167MB in `rockhoppers` node
- **Request volume**: 300+ GIF requests in 3 minutes (~100 GIFs/minute)
- **External memory growth**: Slower than initial leak (~600MB/min), but still present
- **Pattern**: Only the node serving fitness GIFs had the leak

### Evidence from Logs
```
GET /media/fitnessally/04631301-Front-Plank_waist-FIX_360.gif (public)
GET /media/fitnessally/02891301-Dumbbell-Bench-Press_Chest_360.gif (public)
GET /media/fitnessally/35561301-High-Knee-Run_Cardio_360.gif (public)
...
(300+ similar requests in 3 minutes)
```

**Key Finding**: These requests go through `express.static()` middleware, NOT axios, so the axios interceptor cleanup had no effect.

### Root Cause

The Express `static()` middleware was configured without proper caching or memory management:

```javascript
// BEFORE - No caching, no cleanup
app.use('/media', express.static(path.join(__dirname, 'data', 'media', 'web')));
```

**What was happening**:
1. Each GIF request creates a file read stream
2. Node.js buffers the entire GIF file in memory (360 GIFs are typically 500KB-2MB each)
3. Buffer is sent to client
4. **Buffer stays in memory until garbage collection**
5. With 100+ requests/minute, buffers accumulate faster than GC runs
6. External memory grows continuously

**Why it's worse for GIFs**:
- Animated GIFs are large (500KB-2MB each)
- Frontend loads many GIFs simultaneously for exercise demonstrations
- No browser caching = same GIFs requested repeatedly
- High frame rate scrolling = constant GIF loading

## Solution

### 1. Aggressive Browser Caching

Configure `express.static()` with proper cache headers:

```javascript
const mediaStaticOptions = {
    etag: true,              // Enable ETags for browser caching
    lastModified: true,      // Enable Last-Modified header
    maxAge: '1y',           // Cache for 1 year (GIFs don't change)
    immutable: true,        // Tell browsers these files never change
    setHeaders: (res, filePath) => {
        // Aggressive caching for images/GIFs
        if (filePath.endsWith('.gif') || filePath.endsWith('.jpg') || 
            filePath.endsWith('.png') || filePath.endsWith('.svg')) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
    }
};

app.use('/media', express.static(path.join(__dirname, 'data', 'media', 'web'), mediaStaticOptions));
```

**Benefits**:
- Browser caches GIFs for 1 year
- Subsequent visits don't hit the server
- `immutable` flag tells browser the file will never change
- `ETag` enables 304 Not Modified responses

### 2. Force Garbage Collection After Each Response

Add middleware to force buffer cleanup after serving files:

```javascript
const forceStaticCleanup = (req, res, next) => {
    const originalEnd = res.end;
    let bufferReleased = false;
    
    // Wrap res.end to force cleanup
    res.end = function(...args) {
        const result = originalEnd.apply(this, args);
        
        // Force buffer release after response is sent
        if (!bufferReleased && global.gc) {
            bufferReleased = true;
            setImmediate(() => {
                global.gc();
                // Only log occasionally to avoid log spam
                if (Math.random() < 0.01) { // 1% of requests
                    console.log(`🧹 [Static] Forced GC after serving ${req.path}`);
                }
            });
        }
        
        return result;
    };
    
    next();
};

app.use('/media', forceStaticCleanup, express.static(...));
```

**How it works**:
- Wraps `res.end()` to detect when response is complete
- Forces garbage collection via `setImmediate()` to avoid blocking
- Only logs 1% of requests to prevent log spam
- Uses `bufferReleased` flag to prevent multiple GC calls

## Implementation Details

### Files Modified

**`index.js`** (lines 395-425)
- Added `mediaStaticOptions` configuration object
- Added `forceStaticCleanup` middleware
- Applied to both `/media` and `/api/generate/media` routes

### Configuration Options

**Cache Control Headers**:
- `max-age=31536000` = 1 year in seconds
- `immutable` = file content will never change
- `public` = can be cached by any cache (CDN, browser, proxy)

**Why 1 year?**:
- Fitness GIF filenames include exercise IDs (e.g., `04631301-Front-Plank_waist-FIX_360.gif`)
- If the GIF changes, the filename changes
- Safe to cache "forever" (1 year is HTTP maximum)

## Expected Results

### Immediate Benefits
1. **Reduced server requests**: After first load, browser serves GIFs from cache
2. **Lower bandwidth**: No repeated transfers of same GIFs
3. **Faster page loads**: Instant GIF display from cache

### Memory Impact
1. **First-time visitors**: Still create buffers, but GC runs more frequently
2. **Return visitors**: Near-zero server requests = near-zero buffer creation
3. **External memory**: Should stabilize instead of growing continuously

### Monitoring

Look for these indicators:
```bash
# Should see occasional GC logs (1% of requests)
🧹 [Static] Forced GC after serving /media/fitnessally/...gif

# Memory should stabilize
[Memory Monitor] External: XXXmb (should not grow continuously)

# Network tab should show "304 Not Modified" or "(from cache)"
```

## Performance Characteristics

### Before Fix
- **Every GIF request**: Full file read + buffer allocation
- **Memory pattern**: Continuous growth
- **Network**: Full file transfer every time

### After Fix
- **First request**: Full file read + buffer allocation + GC
- **Subsequent requests**: 304 Not Modified (or from browser cache)
- **Memory pattern**: Sawtooth (grows slightly, GC releases, repeats)
- **Network**: Minimal (only cache validation)

## Alternative Approaches Considered

### 1. CDN/Edge Caching
**Pros**: Offloads serving to edge servers  
**Cons**: Requires infrastructure changes  
**Decision**: Good for production, but this fix works for self-hosted

### 2. In-Memory Cache (e.g., node-cache)
**Pros**: Faster than disk reads  
**Cons**: Increases memory usage deliberately  
**Decision**: Defeats the purpose of fixing memory leak

### 3. Nginx/Apache for Static Files
**Pros**: More efficient static serving  
**Cons**: Requires additional service  
**Decision**: Overkill for this use case, browser caching sufficient

### 4. Lazy Loading GIFs
**Pros**: Reduces simultaneous requests  
**Cons**: Frontend change, doesn't fix server leak  
**Decision**: Good UX improvement, but server still needs fixing

## Related Documentation

- **Axios Buffer Cleanup**: `index.js` lines 72-169
- **Elasticsearch Client Recreation**: `docs/UNDICI_MEMORY_LEAK_FIX.md`
- **GraphQL Client Fix**: `docs/SOCKET_LEAK_FIX_2024-11.md`
- **Media Serving Guide**: `docs/OIP_MEDIA_FILES_COMPREHENSIVE_GUIDE.md`

## Frontend Improvements (Recommended)

While not required for the fix, these frontend improvements will further reduce load:

### 1. Lazy Loading
```javascript
<img 
    src="placeholder.gif" 
    data-src="/media/fitnessally/exercise.gif"
    loading="lazy"
/>
```

### 2. Intersection Observer
```javascript
const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.src = entry.target.dataset.src;
            observer.unobserve(entry.target);
        }
    });
});
```

### 3. Thumbnail Previews
- Show static thumbnail image first
- Load GIF only when user hovers/clicks
- Reduces initial load by ~80%

## Testing & Verification

### 1. Check Browser Caching
```bash
# First request - should be 200 OK with full size
curl -I https://oip.fitnessally.io/media/fitnessally/test.gif

# Second request - should be 304 Not Modified
curl -I https://oip.fitnessally.io/media/fitnessally/test.gif \
    -H "If-None-Match: \"<etag-from-first-request>\""
```

### 2. Monitor Memory Growth
```bash
# Watch external memory over time
docker logs -f fitnessally-oip-gpu-1 | grep "Memory Monitor"

# Should see stable or sawtooth pattern, not continuous growth
```

### 3. Check GC Frequency
```bash
# Should see occasional GC logs
docker logs -f fitnessally-oip-gpu-1 | grep "\[Static\] Forced GC"
```

### 4. Browser DevTools
1. Open Network tab
2. Load page with GIFs
3. Reload page (Cmd+R, not hard reload)
4. Should see "(from disk cache)" or "304" for GIFs

## Implementation Date

November 25, 2024

## Status

✅ **Implemented** - Awaiting production verification

## Notes

- Requires `node --expose-gc` flag for forced garbage collection
- Already set in `docker-compose.yml` and startup scripts
- Without `--expose-gc`, caching still works but GC is less aggressive
- Frontend improvements (lazy loading) are optional but recommended

