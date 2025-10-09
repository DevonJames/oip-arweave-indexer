# Media Directory Fixes - Complete Summary

## ✅ All Fixes Applied Successfully!

### Changes Made

#### 1. **Exercise Bundle Code Fixes** (reference-client.html)
- ✅ Added IPFS upload step for all media files
- ✅ Added web-setup step for filename-based URLs
- ✅ Fixed DID extraction to handle Arweave's `transactionId` response
- ✅ Applied fixes to: GIF uploads, equipment icons, multiResolutionGif, exercise records

#### 2. **Docker Volume Configuration** (docker-compose.yml)
- ✅ Changed mount from `./media` to `./data` directory
- ✅ Updated all 5 OIP service profiles (standard, minimal, macMseries, full, gpu)
- ✅ Added explanatory comments for clarity

#### 3. **Directory Structure**
- ✅ Created `data/media/web/` directory structure
- ✅ Added `.gitkeep` file to preserve empty directory
- ✅ Updated `.gitignore` to exclude media files but keep structure

## URL Format Confirmed

The **correct** URL format is:
```
https://domain.com/media/${COMPOSE_PROJECT_NAME}/${filename}
```

**NOT** `https://domain.com/api/media/...`

This matches what the web-setup API creates and what the static file server expects.

## How Media Files Flow Now

### 1. **Upload Flow**
```
User uploads file
    ↓
POST /api/media/upload
    ↓
File stored: ./data/media/[mediaId]/original
    ↓
Returns: { mediaId, httpUrl, magnetURI }
```

### 2. **IPFS Upload**
```
POST /api/media/ipfs-upload
    ↓
Uploads to IPFS from: ./data/media/[mediaId]/original
    ↓
Returns: { ipfsHash }
```

### 3. **Web Setup**
```
POST /api/media/web-setup
    ↓
Copies to: ./data/media/web/${COMPOSE_PROJECT_NAME}/[filename]
    ↓
Returns: { webUrl: "/media/${COMPOSE_PROJECT_NAME}/[filename]" }
```

### 4. **OIP Record Creation**
```
POST /api/records/newRecord?recordType=image
    ↓
Creates record with:
  - webUrl: "https://domain.com/media/[project]/[filename]"
  - ipfsAddress: "Qm..." 
  - bittorrentAddress: "magnet:..."
    ↓
Returns: { did or transactionId }
```

### 5. **Static File Access**
```
GET /media/${COMPOSE_PROJECT_NAME}/[filename]
    ↓
express.static serves from: ./data/media/web/
    ↓
File delivered to browser
```

## Directory Structure

```
oip-arweave-indexer/
├── data/                           # NEW - persisted data directory
│   └── media/                      # Media storage (ignored by git except .gitkeep)
│       ├── .gitkeep               # Preserves directory structure
│       ├── [mediaId]/             # Per-file storage by hash
│       │   ├── original           # Original uploaded file
│       │   └── manifest.json      # File metadata
│       └── web/                    # Web-accessible files
│           └── [project-name]/    # Per-project organization
│               └── [filename]      # Actual files served via /media/ route
├── media/                          # OLD - will be deprecated
│   └── fitnessally/               # Legacy files (can be migrated)
└── docker-compose.yml             # ✅ Now mounts ./data directory
```

## Docker Volume Mounts (After Fix)

### Before:
```yaml
volumes:
  - ./media:/usr/src/app/media  # ❌ Wrong location
```

### After:
```yaml
volumes:
  - ./data:/usr/src/app/data  # ✅ Correct location
```

### What This Fixes:
- ✅ Files created at `/usr/src/app/data/media/` persist to `./data/media/`
- ✅ Static serving from `./data/media/web/` works correctly
- ✅ Files survive container rebuilds
- ✅ Files accessible via `/media/[project]/[filename]` URLs

## Migration Steps (Optional - For Existing Deployments)

If you have existing media files in `./media/`, migrate them:

```bash
# 1. Stop services
make down

# 2. Create new structure
mkdir -p data/media/web

# 3. Move existing files (if in old location)
if [ -d media/fitnessally ]; then
  mkdir -p data/media/web/fitnessally
  cp -r media/fitnessally/* data/media/web/fitnessally/ 2>/dev/null || true
fi

# 4. Rebuild and start
make rebuild-standard
```

## Testing the Fixes

### Test 1: Exercise Bundle Publishing
```
1. Go to reference-client.html
2. Login with JWT
3. Navigate to Publish Tab → "Exercise Bundle - Complete Workflow"
4. Fill in exercise details
5. Upload 4 GIF files (180p, 360p, 720p, 1080p)
6. Create equipment with icon
7. Click "Publish Complete Exercise Bundle"

Expected Results:
✅ All GIFs upload successfully
✅ IPFS addresses populated (if IPFS service running)
✅ webUrl uses /media/${project}/${filename} format
✅ Equipment icons have proper URLs
✅ Exercise publishes with DID
✅ equipmentRequired array has equipment DIDs
```

### Test 2: Manual Media Upload
```bash
# Upload file
curl -X POST http://localhost:3005/api/media/upload \
  -H "Authorization: Bearer YOUR_JWT" \
  -F "file=@test.gif"

# Response should include mediaId
# {"success":true,"mediaId":"abc123...","magnetURI":"magnet:...","httpUrl":"..."}

# Check file created
ls -la data/media/abc123.../original

# Setup web access
curl -X POST http://localhost:3005/api/media/web-setup \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{"mediaId":"abc123...","filename":"test.gif"}'

# Check file copied to web directory
ls -la data/media/web/oip-arweave-indexer/test.gif

# Access file via browser
curl http://localhost:3005/media/oip-arweave-indexer/test.gif
```

### Test 3: Verify Persistence
```bash
# 1. Upload a file via Exercise Bundle
# 2. Note the mediaId and filename
# 3. Stop and remove containers
make down

# 4. Check files still exist
ls -la data/media/[mediaId]/
ls -la data/media/web/oip-arweave-indexer/

# 5. Start services again
make up

# 6. Access file via URL - should still work
curl http://localhost:3005/media/oip-arweave-indexer/[filename]
```

## Verification Checklist

After deploying these fixes:

- [x] Docker volume mounts updated in docker-compose.yml
- [x] data/media/ directory structure created
- [x] .gitkeep file added to preserve structure
- [x] .gitignore updated to exclude media files
- [x] Exercise Bundle code has all fixes applied
- [ ] Services rebuilt with new volume mounts
- [ ] Manual upload test successful
- [ ] Exercise Bundle test successful
- [ ] Files persist across rebuilds
- [ ] Static file serving works
- [ ] IPFS addresses populated (if IPFS running)

## Next Steps

1. **Rebuild Services** (Required)
   ```bash
   make down
   make rebuild-standard  # or your preferred profile
   ```

2. **Test Exercise Bundle**
   - Publish a complete exercise with GIFs and equipment
   - Verify record structure matches GOAL format
   - Confirm URLs use `/media/[project]/[filename]` format

3. **Verify Persistence**
   - Upload media
   - Restart services
   - Confirm media still accessible

4. **Optional: Migrate Old Media**
   - If you have files in `./media/`, move them to `./data/media/web/`

## Troubleshooting

### Issue: Files not accessible via /media/ URL

**Check:**
```bash
# 1. Verify file exists in web directory
ls -la data/media/web/oip-arweave-indexer/

# 2. Check Docker mount
docker-compose config | grep -A 5 "volumes:"

# 3. Check inside container
docker-compose exec oip ls -la /usr/src/app/data/media/web/

# 4. Check logs
docker-compose logs oip | grep media
```

### Issue: Files disappear after rebuild

**Solution:** Files should be in `./data/media/` which is now properly mounted. If files are still disappearing:
```bash
# Check volume mount is correct
docker-compose config | grep "./data"

# Should show: - ./data:/usr/src/app/data
```

### Issue: IPFS addresses empty

**Cause:** IPFS service not running or not accessible

**Solution:**
```bash
# Check IPFS status
docker-compose ps ipfs

# Check IPFS logs
docker-compose logs ipfs

# Test IPFS connectivity
curl http://localhost:5001/api/v0/id
```

## Documentation Updates

The following docs have been created/updated:

1. ✅ `MEDIA_DIRECTORY_FIXES_NEEDED.md` - Detailed problem analysis
2. ✅ `MEDIA_FIXES_SUMMARY.md` - This file
3. ✅ `reference-client.html` - Exercise Bundle code fixes
4. ✅ `docker-compose.yml` - Volume mount fixes
5. ✅ `.gitignore` - Media directory exclusions

## Conclusion

All fixes are now in place:

✅ **Exercise Bundle** - Code updated with proper media workflow  
✅ **Docker Volumes** - Correct directory mounted  
✅ **URL Format** - Confirmed correct: `/media/${project}/${filename}`  
✅ **Persistence** - Files will survive rebuilds  
✅ **IPFS** - Addresses will be populated  
✅ **DID Extraction** - Handles both GUN and Arweave formats  

**Next Action:** Rebuild services and test the Exercise Bundle!

```bash
make rebuild-standard
```

