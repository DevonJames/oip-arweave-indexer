# Quick Start: Applying Timeout Fixes

**Date:** November 25, 2025

---

## What Was Fixed

Three critical timeout issues preventing 35-minute meetings from processing:

1. ✅ **LLM timeouts** - increased from 60s to 5 minutes
2. ✅ **GUN registry timeouts** - increased from 10s to 30 seconds  
3. ✅ **Chunk tagging** - made optional with batching to reduce load

---

## Step 1: Update Your `.env` File

Add these new configuration options to your `.env` file:

```bash
# LLM Timeout Configuration (5 minutes for long meetings)
LLM_TIMEOUT_MS=300000

# GUN Registry Timeout (30 seconds for high-load operations)
GUN_REGISTRY_TIMEOUT_MS=30000

# Chunk Tagging Configuration (batched processing)
CHUNK_TAG_BATCH_SIZE=10
CHUNK_TAG_BATCH_DELAY_MS=1000
```

**Note:** These are the default values. No need to add them unless you want different values.

---

## Step 2: Restart Your Services

```bash
# Stop services
docker-compose down

# Rebuild (code changes were made)
docker-compose build oip-indexer

# Start services
docker-compose up -d

# Watch logs
docker-compose logs -f oip-indexer
```

---

## Step 3: Test with a Long Meeting

### Test WITHOUT Chunk Tags (Recommended, Faster)

```bash
curl -X POST http://localhost:3005/api/notes/from-audio \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "audio=@your_35min_meeting.webm" \
  -F "start_time=2025-11-25T10:00:00Z" \
  -F "end_time=2025-11-25T10:35:00Z" \
  -F "note_type=MEETING" \
  -F "device_type=IPHONE" \
  -F "model=parallel"
```

**Expected:**
- ✅ Transcription completes (~10-11 minutes)
- ✅ Summary generation succeeds (within 5 minutes)
- ✅ 80 chunks created successfully
- ✅ All GUN registry updates succeed
- ⏱️ Total time: ~12-13 minutes

### Test WITH Chunk Tags (Optional, Slower)

```bash
curl -X POST http://localhost:3005/api/notes/from-audio \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "audio=@your_35min_meeting.webm" \
  -F "start_time=2025-11-25T10:00:00Z" \
  -F "end_time=2025-11-25T10:35:00Z" \
  -F "note_type=MEETING" \
  -F "device_type=IPHONE" \
  -F "model=parallel" \
  -F "generateChunkTags=true"
```

**Expected:**
- ✅ Transcription completes (~10-11 minutes)
- ✅ Summary generation succeeds
- ✅ Chunk tags generated in 8 batches (~3-4 minutes)
- ✅ 80 chunks created with tags
- ⏱️ Total time: ~16-17 minutes

---

## Step 4: Monitor the Logs

Watch for these success indicators:

```bash
# Good signs:
✅ [Step 4] Transcription complete
✅ [Step 8] Summary generated
✅ [Step 9] Chunk tags generated (or skipped if disabled)
✅ [Step 11] Created 80 chunk records
✅ [POST /api/notes/from-audio] Ingestion complete

# Bad signs (should NOT see these anymore):
❌ [Summarization] LLM call failed: timeout of 60000ms exceeded
❌ Failed to put simple data to GUN: timeout of 10000ms exceeded
⚠️ [Summarization] Chunk tag generation failed: timeout exceeded
```

---

## Troubleshooting

### If You Still See Timeouts

**LLM Timeouts:**
```bash
# Increase timeout even more (10 minutes)
LLM_TIMEOUT_MS=600000
```

**GUN Registry Timeouts:**
```bash
# Increase timeout even more (60 seconds)
GUN_REGISTRY_TIMEOUT_MS=60000
```

**System Under Heavy Load:**
```bash
# Reduce batch size and add more delay
CHUNK_TAG_BATCH_SIZE=5
CHUNK_TAG_BATCH_DELAY_MS=2000
```

### If Memory Issues Occur

Check the memory monitor logs:

```bash
docker-compose logs oip-indexer | grep "Memory Monitor"

# Look for:
⚠️ CRITICAL: External memory 12GB is 558% of RSS - possible buffer leak
```

If you see this, the Elasticsearch client will automatically recreate itself every 30 minutes to clear buffers.

---

## What Changed (Technical)

### Files Modified:

1. **`services/summarizationService.js`**
   - Lines 222, 235, 407, 439, 472, 504: Changed `timeout: 60000` to use `LLM_TIMEOUT_MS` env var (default 300000)

2. **`helpers/gun.js`**
   - Line 32: Changed `timeout: 10000` to use `GUN_REGISTRY_TIMEOUT_MS` env var (default 30000)

3. **`routes/notes.js`**
   - Added `generateChunkTags` parameter (default: false)
   - Implemented batched chunk tag generation with configurable batch size and delay
   - Added error handling to prevent individual chunk failures from breaking the entire process

4. **`example env`**
   - Added documentation for all new environment variables

---

## Production Recommendations

### For Most Users:
```bash
# Use defaults (no need to add to .env)
# - LLM_TIMEOUT_MS: 300000 (5 minutes)
# - GUN_REGISTRY_TIMEOUT_MS: 30000 (30 seconds)
# - CHUNK_TAG_BATCH_SIZE: 10
# - CHUNK_TAG_BATCH_DELAY_MS: 1000
```

### For High-Performance Servers:
```bash
# More aggressive settings
LLM_TIMEOUT_MS=180000          # 3 minutes
CHUNK_TAG_BATCH_SIZE=20        # Larger batches
CHUNK_TAG_BATCH_DELAY_MS=500   # Faster batching
```

### For Resource-Constrained Environments:
```bash
# Conservative settings
LLM_TIMEOUT_MS=600000          # 10 minutes
CHUNK_TAG_BATCH_SIZE=5         # Smaller batches
CHUNK_TAG_BATCH_DELAY_MS=2000  # More delay between batches
```

---

## API Changes

### New Optional Parameter: `generateChunkTags`

**Before (implicit, always enabled):**
```javascript
// Chunk tagging was always done, causing timeouts
POST /api/notes/from-audio
```

**After (explicit, disabled by default):**
```javascript
// Fast mode (recommended for long meetings)
POST /api/notes/from-audio
Body: { generateChunkTags: 'false' }  // Default

// Detailed mode (slower, generates tags for each chunk)
POST /api/notes/from-audio
Body: { generateChunkTags: 'true' }  // Optional
```

---

## Need More Help?

See the full documentation: [TIMEOUT_FIXES_SUMMARY.md](./TIMEOUT_FIXES_SUMMARY.md)

Or check related guides:
- [Alfred Notes Implementation Summary](./ALFRED_NOTES_IMPLEMENTATION_SUMMARY.md)
- [Backend Functionality Guide](./alfred-meetingNotes-backendFunctionality.md)
- [Memory Management Guide](../MEMORY_MANAGEMENT_GUIDE.md)

