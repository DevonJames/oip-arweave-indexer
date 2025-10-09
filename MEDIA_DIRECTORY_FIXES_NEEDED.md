# Media Directory Configuration Fixes Required

## Problem Summary

The media directory configuration has **critical mismatches** that will prevent the Exercise Bundle from working correctly:

1. **Code expects**: `/usr/src/app/data/media` (or env MEDIA_DIR)
2. **Docker mounts**: `./media` → `/usr/src/app/media`
3. **Static serving expects**: `./data/media/web/`
4. **Files created in**: `./data/media/web/${COMPOSE_PROJECT_NAME}/`

## Current State

### What Works
- ✅ URL format: `/media/${COMPOSE_PROJECT_NAME}/${filename}` is **CORRECT**
- ✅ Web-setup API creates proper URLs
- ✅ Exercise Bundle fixes use correct URL format

### What's Broken
- ❌ Docker volumes don't mount the directory the code expects
- ❌ Created files won't be accessible via static file serving
- ❌ Files won't persist across rebuilds in the right location

## Solutions

### Option 1: Fix Docker Mounts (Recommended)

Change all docker-compose.yml files to mount the correct directory:

```yaml
volumes:
  # OLD (wrong):
  - ./media:/usr/src/app/media
  
  # NEW (correct):
  - ./data:/usr/src/app/data  # Mount entire data directory
```

This ensures:
- Files created in `/usr/src/app/data/media/` are persisted to `./data/media/`
- Static serving from `./data/media/web/` works correctly
- All data persists across rebuilds

### Option 2: Set MEDIA_DIR Environment Variable

Add to all OIP service environment sections in docker-compose files:

```yaml
environment:
  - MEDIA_DIR=/usr/src/app/media/data/media
```

And change mount to:
```yaml
volumes:
  - ./data/media:/usr/src/app/media/data/media
```

**Cons**: More complex, harder to maintain

### Option 3: Fix the Code (Not Recommended)

Change the code to use `./media` instead of `./data/media`:

```javascript
// routes/media.js
const MEDIA_DIR = process.env.MEDIA_DIR || path.join(__dirname, '../media');

// index.js
app.use('/media', express.static(path.join(__dirname, 'media', 'web')));
```

**Cons**: 
- Requires code changes
- Breaks existing deployments
- Less organized structure

## Recommended Implementation

### Step 1: Update docker-compose.yml (all profiles)

Find all instances of:
```yaml
- ./media:/usr/src/app/media
```

Replace with:
```yaml
- ./data:/usr/src/app/data
```

**Files to update:**
- docker-compose.yml (5 services: oip, oip-minimal, oip-macMseries, oip-full, oip-gpu)
- docker-compose-backend-only.yml
- docker-compose-voice-enhanced.yml

### Step 2: Create data directory structure

```bash
mkdir -p data/media/web
```

### Step 3: Migrate existing media files (if any)

```bash
# If you have files in ./media/fitnessally/
mkdir -p data/media/web
mv media/* data/media/web/ 2>/dev/null || true
```

### Step 4: Update .gitignore

Add to .gitignore:
```
# Media files
data/media/
!data/media/.gitkeep
```

### Step 5: Test the changes

1. Rebuild containers: `make rebuild-standard`
2. Test media upload via Exercise Bundle
3. Verify files are created in `./data/media/`
4. Verify files are accessible via `/media/${COMPOSE_PROJECT_NAME}/${filename}`

## Verification Checklist

After implementing fixes:

- [ ] Files upload successfully via `/api/media/upload`
- [ ] Files are stored in `./data/media/[mediaId]/original`
- [ ] Web-setup copies files to `./data/media/web/${COMPOSE_PROJECT_NAME}/[filename]`
- [ ] Files are accessible via `http://localhost:3005/media/${COMPOSE_PROJECT_NAME}/[filename]`
- [ ] Files persist after `docker-compose down && docker-compose up`
- [ ] Files persist after `make rebuild-standard`
- [ ] Exercise Bundle publishes successfully with correct URLs
- [ ] Published records have correct webUrl and ipfsAddress

## Impact on Exercise Bundle

Once fixed, the Exercise Bundle will:
- ✅ Upload media files successfully
- ✅ Get proper filename-based URLs (not mediaId-based)
- ✅ Have IPFS addresses populated
- ✅ Work with both GUN and Arweave storage
- ✅ Preserve media files across rebuilds
- ✅ Serve media files correctly via static routes

## Additional Recommendations

1. **Add data directory to volume mounts in Makefile documentation**
2. **Update MEDIA_PUBLISHING.md with correct directory structure**
3. **Add migration script for existing deployments**
4. **Add health check endpoint that verifies media directory is writable**

## Files That Need Changes

### Required Changes
1. `docker-compose.yml` - Update all OIP service volumes
2. `docker-compose-backend-only.yml` - Update OIP service volumes  
3. `docker-compose-voice-enhanced.yml` - Update OIP service volumes

### Optional (for documentation)
4. `docs/MEDIA_PUBLISHING.md` - Document correct directory structure
5. `docs/EXERCISE_BUNDLE_FEATURE_GUIDE.md` - Add troubleshooting for directory issues
6. `.gitignore` - Add data/media/ exclusion

## Testing Commands

```bash
# Test file creation
curl -X POST http://localhost:3005/api/media/upload \
  -H "Authorization: Bearer YOUR_JWT" \
  -F "file=@test.gif"

# Check if file was created
ls -la data/media/

# Test web-setup
curl -X POST http://localhost:3005/api/media/web-setup \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{"mediaId":"MEDIA_ID","filename":"test.gif"}'

# Check if file was copied to web directory
ls -la data/media/web/${COMPOSE_PROJECT_NAME:-oip-arweave-indexer}/

# Test static serving
curl http://localhost:3005/media/${COMPOSE_PROJECT_NAME:-oip-arweave-indexer}/test.gif
```

## Conclusion

**The Exercise Bundle fixes are CORRECT**. The issue is with the Docker volume configuration, not the code. Once the volume mounts are fixed to use `./data` instead of `./media`, everything will work as expected.

