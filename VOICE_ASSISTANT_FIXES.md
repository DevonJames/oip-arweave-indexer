# Voice Assistant Fixes and Debugging Guide

## Issues Identified and Fixed

### Issue 1: TTS Voice Quality (eSpeak fallback instead of Chatterbox)

**Problem**: The voice assistant was using low-quality eSpeak voices instead of the intended Chatterbox TTS engine.

**Root Cause**: The Chatterbox TTS service (`tts-service-gpu`) may not be running properly or responding correctly, causing the system to fall back to eSpeak.

**Fixes Applied**:

1. **Improved Default Voice Selection** (`frontend/src/components/VoiceAssistant.tsx`):
   - Changed default voice from `'female_1'` to `'chatterbox'`
   - Added logic to prioritize Chatterbox voices when loading available voices
   - Enhanced voice selection to prefer Chatterbox over eSpeak

2. **Enhanced TTS Service Communication** (`routes/voice.js`):
   - Added explicit `engine: 'chatterbox'` parameter instead of `'auto'`
   - Improved error logging to identify TTS service issues
   - Added service URL logging for debugging
   - Enhanced fallback error messages with more detail

3. **Better Error Diagnostics**:
   - Added response status and data logging for TTS errors
   - Included fallback reason in response headers
   - More descriptive error messages showing both Chatterbox and eSpeak failure reasons

### Issue 2: RAG Search Not Finding Relevant Records

**Problem**: The voice assistant wasn't finding Iran-related records even though they exist in the database.

**Root Cause**: The RAG service was being too restrictive with record type filtering and the keyword matching wasn't comprehensive enough.

**Fixes Applied**:

1. **Enhanced Search Strategy** (`helpers/ragService.js`):
   - Added fallback to broader search when type-specific search yields no results
   - Improved to search without record type filter if initial search fails
   - Better handling of enabled record types after broad search

2. **Expanded Keyword Matching**:
   - Added more Iran-related keywords: `'iranian'`, `'tehran'`
   - Enhanced country and nationality keywords (e.g., `'chinese'`, `'russian'`, `'israeli'`)
   - Added military/political terms: `'nuclear'`, `'preemptive'`, `'enrichment'`, `'weapons'`
   - Included administration terms: `'biden'`, `'trump'`, `'administration'`

3. **Improved Search Logic**:
   - Better handling of search parameter passing
   - Maintains `summarizeTags: true` for relevance scoring
   - Preserves all critical search parameters like the working API call

## Debugging Tools Created

### 1. Service Health Check (`check_services.js`)

Run this to diagnose TTS and other service issues:

```bash
# Make sure you're in the project directory with dependencies installed
cd /path/to/oip-arweave-indexer
node check_services.js
```

**What it checks**:
- TTS service connectivity and health
- STT service status
- Text generator service status
- Available TTS voices
- TTS synthesis functionality

### 2. Iran Search Test (`test_iran_search.js`)

Run this to debug search functionality:

```bash
# Make sure you're in the project directory
cd /path/to/oip-arweave-indexer
node test_iran_search.js
```

**What it tests**:
- Record type analysis for "Iran" queries
- Direct Elasticsearch search functionality
- Full RAG pipeline with Iran search
- Shows exactly what's happening at each step

## Troubleshooting Steps

### For TTS Issues:

1. **Check if TTS service is running**:
   ```bash
   docker ps | grep tts
   ```

2. **Check TTS service logs**:
   ```bash
   docker logs <tts-container-name>
   ```

3. **Verify service health**:
   ```bash
   node check_services.js
   ```

4. **Manual TTS test**:
   ```bash
   curl -X POST http://localhost:5002/synthesize \
     -H "Content-Type: application/json" \
     -d '{"text":"Hello world","voice":"chatterbox","engine":"chatterbox"}' \
     --output test.wav
   ```

### For Search Issues:

1. **Test Iran search directly**:
   ```bash
   node test_iran_search.js
   ```

2. **Verify records exist manually**:
   ```bash
   curl "http://localhost:3005/api/records?search=iran&recordType=post&summarizeTags=true&limit=5"
   ```

3. **Check Elasticsearch status**:
   ```bash
   curl "http://localhost:9200/_cluster/health"
   ```

## Expected Behavior After Fixes

### TTS (Voice):
- Should default to Chatterbox voices in the dropdown
- Should use high-quality neural TTS instead of robotic eSpeak
- Should show detailed error messages if TTS service fails
- Should include service status information in responses

### RAG Search:
- Should find Iran-related records when they exist
- Should fall back to broader search if type-specific search fails
- Should include relevant record types in search results
- Should maintain proper search parameter passing

## Verification Steps

1. **Test TTS Quality**:
   - Open voice assistant
   - Check that default voice is a Chatterbox variant
   - Record a test message and verify audio quality
   - Check browser developer tools for any fallback headers

2. **Test Iran Search**:
   - Ask "What's the latest on Iran?" or similar
   - Should return relevant Iran-related articles
   - Check sources section for Iran-related content
   - Verify context is being used (green indicator)

3. **Monitor Logs**:
   - Check for "[TTS]" log messages indicating successful Chatterbox usage
   - Look for "[RAG]" messages showing successful record retrieval
   - Watch for any fallback indicators

## Configuration Notes

- **GPU Profile**: Ensure you're using the `gpu` or `full-gpu` docker-compose profile for Chatterbox TTS
- **Environment**: Check that `TTS_SERVICE_URL=http://tts-service-gpu:5002` is set correctly
- **Dependencies**: Verify all GPU services are running: `ollama`, `tts-service-gpu`, `stt-service-gpu`

## Next Steps

If issues persist:

1. Run the debugging tools to get detailed diagnostics
2. Check Docker container health and logs
3. Verify the correct docker-compose profile is being used
4. Ensure GPU services have proper GPU access if using GPU profile
5. Test individual services manually with curl commands 