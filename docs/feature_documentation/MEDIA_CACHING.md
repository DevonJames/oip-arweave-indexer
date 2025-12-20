# Media Caching System

## Overview

The media serving route (`GET /api/media/:mediaId`) includes a multi-layer caching system designed to minimize disk I/O, reduce bandwidth usage, and improve response times for frequently accessed media files.

## Key Insight: Content-Addressed Storage

Media files in OIP are stored using **content-addressed hashing** (SHA256). The `mediaId` is the hash of the file content, which means:

- The same `mediaId` will **always** return the same content
- Media files are effectively **immutable**
- This makes aggressive caching safe and reliable

---

## Caching Layers

### 1. HTTP Caching Headers (Browser/CDN Layer)

Every media response includes HTTP caching headers that enable browsers and CDN edge servers to cache responses:

```http
Cache-Control: public, max-age=31536000, immutable
ETag: "beb14aaf3061867bddd3fca049770b09d3aa9c76239d0fa1e73514537fd83928"
Last-Modified: Thu, 19 Dec 2024 10:30:00 GMT
```

| Header | Value | Purpose |
|--------|-------|---------|
| `Cache-Control` | `public, max-age=31536000, immutable` | Cache for 1 year, content never changes |
| `ETag` | The mediaId (hash) | Perfect entity tag since hash = content |
| `Last-Modified` | File modification time | Fallback for older clients |

#### Conditional Requests (304 Not Modified)

When a client sends a request with `If-None-Match: "<mediaId>"`, the server returns:

```http
HTTP/1.1 304 Not Modified
```

No body is sent, saving bandwidth entirely.

### 2. In-Memory Manifest Cache (Server Layer)

Each media file has an associated `manifest.json` containing metadata (MIME type, access level, owner, etc.). To avoid repeated disk reads:

```javascript
const MANIFEST_CACHE_MAX_SIZE = 1000;  // Max cached manifests
const MANIFEST_CACHE_TTL = 300000;     // 5 minutes TTL
```

| Feature | Value | Purpose |
|---------|-------|---------|
| Max entries | 1,000 | Prevent unbounded memory growth |
| TTL | 5 minutes | Balance freshness vs. performance |
| Eviction | LRU-style | Oldest entries removed when full |

#### Cache Invalidation

The manifest cache is automatically invalidated when a manifest is updated:

- After IPFS upload (`POST /api/media/ipfs-upload`)
- After web setup (`POST /api/media/web-setup`)
- After Arweave upload (`POST /api/media/arweave-upload`)

---

## Request Flow

```
Client Request
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. Check If-None-Match header                               │
│    └── If matches mediaId → Return 304 (no body)            │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Load manifest from cache                                 │
│    └── Cache hit → Use cached manifest                      │
│    └── Cache miss → Read from disk, cache for 5 min         │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Check access control (if private)                        │
│    └── Verify user authentication and ownership             │
└─────────────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Stream file with caching headers                         │
│    └── Set Cache-Control, ETag, Last-Modified               │
│    └── Stream file to response (supports range requests)    │
└─────────────────────────────────────────────────────────────┘
```

---

## Performance Impact

### Before Caching

| Scenario | Disk Reads | Network Transfer |
|----------|------------|------------------|
| Same file requested 100x | 100 manifest reads + 100 file streams | 100 full transfers |

### After Caching

| Scenario | Disk Reads | Network Transfer |
|----------|------------|------------------|
| Same file requested 100x (same client) | 1 manifest read + 1 file stream | 1 full transfer + 99 × 0 bytes |
| Same file requested 100x (different clients) | 1 manifest read + 100 file streams | 100 full transfers (but CDN can cache) |
| Same file with CDN | 1 manifest read + 1 file stream | 1 full transfer to CDN, 0 to origin |

---

## Configuration

### Environment Variables

Currently, cache settings are hardcoded but can be exposed as environment variables if needed:

```bash
# Future configuration options
MANIFEST_CACHE_MAX_SIZE=1000
MANIFEST_CACHE_TTL_MS=300000
```

### Monitoring

The manifest cache can be monitored by checking the Map size:

```javascript
// In routes/daemon/media.js
console.log('Manifest cache size:', manifestCache.size);
```

---

## Memory Safety

### Stream Handling

All file streams include proper cleanup handlers:

```javascript
stream.on('error', () => stream.destroy());
stream.on('end', () => { /* GC trigger for large files */ });
res.on('close', () => stream.destroy());  // Client disconnect
```

### Cache Bounds

The manifest cache:
- Has a maximum size (1,000 entries)
- Evicts oldest entries when full
- Entries expire after 5 minutes
- Is invalidated on manifest updates

---

## Related Files

- `routes/daemon/media.js` - Main implementation
- `data/media/<mediaId>/manifest.json` - Manifest files
- `data/media/<mediaId>/original` - Actual media files

---

## Changelog

| Date | Change |
|------|--------|
| 2024-12-19 | Added HTTP caching headers (Cache-Control, ETag, Last-Modified) |
| 2024-12-19 | Added in-memory manifest cache with LRU eviction |
| 2024-12-19 | Added 304 Not Modified support for conditional requests |
| 2024-12-19 | Added cache invalidation on manifest updates |

