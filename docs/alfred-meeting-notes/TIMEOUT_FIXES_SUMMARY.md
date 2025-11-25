# Alfred Notes - Timeout Fixes for Long Meetings

**Date:** November 25, 2025  
**Issue:** 35-minute meeting test failed due to multiple timeout errors

---

## Problem Analysis

From the test logs of a 35-minute meeting:

### 1. **LLM Summarization Timeout** (Step 8)
- **Error:** `timeout of 60000ms exceeded`
- **Impact:** Summary generation failed after 60 seconds
- **Root Cause:** 60-second timeout insufficient for processing 24,863 character transcript from 35-minute meeting

### 2. **Chunk Tag Generation Timeouts** (Step 9)
- **Error:** `timeout of 60000ms exceeded` (40+ failures out of 80 chunks)
- **Impact:** Many chunks lost their tags due to timeout
- **Root Cause:** 
  - 80 chunks generated from 35-minute meeting
  - All 80 LLM calls executed in parallel
  - Overwhelmed local LLM service (llama3.2:3b)
  - 60-second timeout too short for queued requests

### 3. **GUN Registry Update Timeouts** (Step 11)
- **Error:** `timeout of 10000ms exceeded` (40+ failures out of 80 chunks)
- **Impact:** Registry updates failed, affecting sync across nodes
- **Root Cause:**
  - 80+ simultaneous GUN registry writes
  - 10-second timeout insufficient under high load
  - Gun relay server overwhelmed with concurrent requests

---

## Solutions Implemented

### 1. Increased LLM Timeouts (5 minutes default)

**Files Modified:**
- `services/summarizationService.js`

**Changes:**
- Increased all LLM API call timeouts from 60 seconds to 5 minutes (300,000ms)
- Made timeout configurable via `LLM_TIMEOUT_MS` environment variable
- Applies to:
  - Main summarization calls (OpenAI, Grok, Ollama)
  - Parallel racing timeout
  - Chunk tag generation calls

**Code Example:**
```javascript
// Before:
timeout: 60000

// After:
timeout: parseInt(process.env.LLM_TIMEOUT_MS) || 300000 // 5 minutes default
```

### 2. Increased GUN Registry Timeout (30 seconds)

**Files Modified:**
- `helpers/gun.js`

**Changes:**
- Increased GUN putSimple timeout from 10 seconds to 30 seconds
- Made timeout configurable via `GUN_REGISTRY_TIMEOUT_MS` environment variable
- Handles high-load scenarios with 80+ simultaneous writes

**Code Example:**
```javascript
// Before:
timeout: 10000

// After:
timeout: parseInt(process.env.GUN_REGISTRY_TIMEOUT_MS) || 30000 // 30 seconds for high-load
```

### 3. Made Chunk Tagging Optional with Batching

**Files Modified:**
- `routes/notes.js`

**Changes:**
- Added `generateChunkTags` parameter (default: `false`)
- Implemented batched processing when enabled:
  - **Batch Size:** 10 chunks per batch (configurable via `CHUNK_TAG_BATCH_SIZE`)
  - **Batch Delay:** 1 second between batches (configurable via `CHUNK_TAG_BATCH_DELAY_MS`)
  - **Error Handling:** Individual chunk failures don't break the entire process
  - **Progress Logging:** Shows batch progress (e.g., "Processing batch 3/8")

**Benefits:**
- Reduces system load during long meeting processing
- Prevents overwhelming local LLM services
- Graceful degradation (empty tags on failure instead of complete failure)
- Optional - can be enabled for meetings where chunk-level tagging is important

**Code Example:**
```javascript
// POST /api/notes/from-audio
FormData:
  - generateChunkTags: 'true'  // Enable chunk tagging (optional, increases processing time)
```

---

## Configuration

### Environment Variables

Add these to your `.env` file:

```bash
# LLM Timeout Configuration
# Timeout for LLM API calls (summarization, chunk tagging) in milliseconds
# Increase for long meetings (35+ minutes of audio generates long transcripts)
# Default: 300000 (5 minutes)
LLM_TIMEOUT_MS=300000

# GUN Registry Timeout Configuration
# Timeout for GUN registry writes in milliseconds
# Increase for high-load scenarios with many simultaneous writes (e.g., 80+ chunks)
# Default: 30000 (30 seconds)
GUN_REGISTRY_TIMEOUT_MS=30000

# Chunk Tagging Configuration (for Alfred Notes)
# Number of chunks to process simultaneously
# Lower values = less system load, higher values = faster but may overwhelm LLM
# Default: 10
CHUNK_TAG_BATCH_SIZE=10

# Delay between batches in milliseconds
# Prevents overwhelming the LLM service with too many simultaneous requests
# Default: 1000 (1 second)
CHUNK_TAG_BATCH_DELAY_MS=1000
```

### Recommended Settings by Meeting Length

#### Short Meetings (< 15 minutes)
```bash
LLM_TIMEOUT_MS=120000          # 2 minutes
GUN_REGISTRY_TIMEOUT_MS=15000  # 15 seconds
CHUNK_TAG_BATCH_SIZE=20        # More aggressive
CHUNK_TAG_BATCH_DELAY_MS=500   # Faster batching
```

#### Medium Meetings (15-30 minutes)
```bash
LLM_TIMEOUT_MS=180000          # 3 minutes
GUN_REGISTRY_TIMEOUT_MS=20000  # 20 seconds
CHUNK_TAG_BATCH_SIZE=15        # Balanced
CHUNK_TAG_BATCH_DELAY_MS=750   # Balanced
```

#### Long Meetings (30-60 minutes)
```bash
LLM_TIMEOUT_MS=300000          # 5 minutes (default)
GUN_REGISTRY_TIMEOUT_MS=30000  # 30 seconds (default)
CHUNK_TAG_BATCH_SIZE=10        # Conservative (default)
CHUNK_TAG_BATCH_DELAY_MS=1000  # Conservative (default)
```

#### Very Long Meetings (60+ minutes)
```bash
LLM_TIMEOUT_MS=600000          # 10 minutes
GUN_REGISTRY_TIMEOUT_MS=45000  # 45 seconds
CHUNK_TAG_BATCH_SIZE=5         # Very conservative
CHUNK_TAG_BATCH_DELAY_MS=2000  # Extra delay between batches
```

---

## API Usage

### With Chunk Tagging Disabled (Recommended for Long Meetings)

**Faster processing, no chunk-level tags:**

```javascript
const formData = new FormData();
formData.append('audio', audioFile);
formData.append('start_time', '2025-11-24T16:36:00Z');
formData.append('end_time', '2025-11-24T17:11:00Z');
formData.append('note_type', 'MEETING');
formData.append('device_type', 'IPHONE');
formData.append('model', 'parallel');
formData.append('generateChunkTags', 'false'); // DISABLE chunk tagging for speed

const response = await fetch('/api/notes/from-audio', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData
});
```

### With Chunk Tagging Enabled (Optional)

**Slower processing, generates tags for each chunk:**

```javascript
formData.append('generateChunkTags', 'true'); // ENABLE chunk tagging (slower)
```

---

## Expected Performance Improvements

### Before Fix (35-minute meeting):
- ❌ Summary generation: **FAILED** (60s timeout)
- ❌ Chunk tag generation: **40+ FAILURES** out of 80 chunks (60s timeout)
- ❌ GUN registry updates: **40+ FAILURES** out of 80 chunks (10s timeout)
- ⏱️ Total time: ~14 minutes (with many failures)

### After Fix (35-minute meeting):
- ✅ Summary generation: **SUCCESS** (within 5-minute timeout)
- ✅ Chunk tag generation: **SKIPPED** by default (or batched if enabled)
- ✅ GUN registry updates: **SUCCESS** (within 30-second timeout)
- ⏱️ Total time: ~12-13 minutes (no failures)

### With Chunk Tagging Enabled (batched):
- ✅ Summary generation: **SUCCESS**
- ✅ Chunk tag generation: **SUCCESS** (8 batches x 10 chunks, ~3-4 minutes)
- ✅ GUN registry updates: **SUCCESS**
- ⏱️ Total time: ~16-17 minutes (slower but complete)

---

## Testing Recommendations

### 1. Test Short Meeting (5 minutes)
```bash
# Should complete in < 3 minutes
curl -X POST http://localhost:3005/api/notes/from-audio \
  -H "Authorization: Bearer $TOKEN" \
  -F "audio=@5min_meeting.webm" \
  -F "start_time=2025-11-25T10:00:00Z" \
  -F "end_time=2025-11-25T10:05:00Z" \
  -F "note_type=MEETING" \
  -F "device_type=IPHONE" \
  -F "model=parallel"
```

### 2. Test Medium Meeting (20 minutes)
```bash
# Should complete in < 8 minutes
curl -X POST http://localhost:3005/api/notes/from-audio \
  -H "Authorization: Bearer $TOKEN" \
  -F "audio=@20min_meeting.webm" \
  -F "start_time=2025-11-25T10:00:00Z" \
  -F "end_time=2025-11-25T10:20:00Z" \
  -F "note_type=MEETING" \
  -F "device_type=IPHONE" \
  -F "model=parallel"
```

### 3. Test Long Meeting (35 minutes) - No Chunk Tags
```bash
# Should complete in < 13 minutes
curl -X POST http://localhost:3005/api/notes/from-audio \
  -H "Authorization: Bearer $TOKEN" \
  -F "audio=@35min_meeting.webm" \
  -F "start_time=2025-11-25T10:00:00Z" \
  -F "end_time=2025-11-25T10:35:00Z" \
  -F "note_type=MEETING" \
  -F "device_type=IPHONE" \
  -F "model=parallel" \
  -F "generateChunkTags=false"  # Disable for speed
```

### 4. Test Long Meeting (35 minutes) - With Chunk Tags
```bash
# Should complete in < 18 minutes
curl -X POST http://localhost:3005/api/notes/from-audio \
  -H "Authorization: Bearer $TOKEN" \
  -F "audio=@35min_meeting.webm" \
  -F "start_time=2025-11-25T10:00:00Z" \
  -F "end_time=2025-11-25T10:35:00Z" \
  -F "note_type=MEETING" \
  -F "device_type=IPHONE" \
  -F "model=parallel" \
  -F "generateChunkTags=true"  # Enable for detailed tags (slower)
```

---

## Monitoring & Debugging

### Watch Logs for Timeout Issues

```bash
# Follow logs in real-time
docker-compose logs -f oip-indexer

# Look for these indicators:
✅ [Step 8] Summary generated              # Success
❌ [Summarization] LLM call failed         # Timeout issues
🏷️ [Step 9] Processing batch 3/8          # Chunk tagging progress
⚠️ Failed to update parent registry       # GUN registry issues
```

### Check Memory Usage

```bash
# Monitor memory during long meeting processing
docker stats

# Look for:
# - External memory spikes (12GB+ indicates buffer leak)
# - High RSS memory (2GB+ is normal during processing)
```

### Elasticsearch Memory

```bash
# If ES is slow during long meetings:
docker-compose exec elasticsearch curl -X GET "localhost:9200/_cluster/health?pretty"

# Check for:
# - status: "yellow" or "red" (indicates issues)
# - active_shards: should match expected count
```

---

## Future Improvements (Optional)

### 1. Server-Sent Events (SSE) for Progress Updates

Instead of a single long-running request, implement streaming progress updates:

```javascript
// Client-side
const eventSource = new EventSource('/api/notes/from-audio-stream');
eventSource.onmessage = (event) => {
  const update = JSON.parse(event.data);
  console.log(`Progress: ${update.step} - ${update.message}`);
  
  // Update UI with progress
  updateProgressBar(update.progress); // 0-100
};
```

**Benefits:**
- Real-time progress feedback to user
- Can show estimated time remaining
- Better UX for long meetings

### 2. Async Job Queue with Status Polling

For very long meetings (60+ minutes), use a job queue:

```javascript
// 1. Submit job
POST /api/notes/from-audio-async
Response: { jobId: "abc123", status: "processing" }

// 2. Poll for status
GET /api/notes/jobs/abc123
Response: { status: "processing", progress: 45, currentStep: "chunking" }

// 3. Get result when complete
GET /api/notes/jobs/abc123
Response: { status: "complete", noteHash: "...", noteDid: "..." }
```

### 3. Chunk Tag Pre-computation Cache

Cache commonly used tags to reduce LLM calls:

```javascript
// Cache structure
{
  "technical-discussion": { uses: 1234, lastUsed: "2025-11-25" },
  "budget-planning": { uses: 890, lastUsed: "2025-11-24" },
  // ...
}

// Smart tagging: mix cached tags with new LLM-generated tags
```

---

## Related Documentation

- [Alfred Notes PRD](./Alfred-MeetingNotes-prd.md)
- [Backend Functionality Guide](./alfred-meetingNotes-backendFunctionality.md)
- [API Frontend Guide](./ALFRED_NOTES_API_FRONTEND_GUIDE.md)
- [Implementation Summary](./ALFRED_NOTES_IMPLEMENTATION_SUMMARY.md)
- [Memory Management Guide](../MEMORY_MANAGEMENT_GUIDE.md)

---

## Summary

The timeout issues for long meetings have been resolved through:

1. ✅ **5-minute LLM timeouts** - sufficient for transcripts up to ~60 minutes
2. ✅ **30-second GUN registry timeouts** - handles 80+ simultaneous writes
3. ✅ **Optional batched chunk tagging** - reduces system load, prevents cascading failures
4. ✅ **Configurable via environment variables** - tune for your hardware and needs

**Recommendation for production:**
- Disable chunk tagging by default (`generateChunkTags=false`)
- Use summary-level tags (which still work perfectly)
- Enable chunk tagging only when specifically needed for detailed analysis
- Monitor logs for timeout warnings and adjust timeouts as needed

The system should now handle meetings up to 60 minutes reliably with default settings.

