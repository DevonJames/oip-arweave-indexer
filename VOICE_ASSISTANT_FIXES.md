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

3. **Better Error Diagnostics and Text Handling**:
   - **NEW**: Added text length limiting (1000 chars) to prevent TTS service overload
   - **NEW**: Added detection of 0-byte audio responses from Chatterbox
   - **NEW**: Fixed eSpeak fallback by safely accessing request parameters
   - Added response status and data logging for TTS errors
   - Included fallback reason in response headers
   - More descriptive error messages showing both Chatterbox and eSpeak failure reasons

### Issue 2: RAG Search Not Finding Relevant Records

**Problem**: The voice assistant wasn't finding Iran-related records even though they exist in the database.

**Root Cause**: The RAG service was being too restrictive with record type filtering and the keyword matching wasn't comprehensive enough.

**Fixes Applied**:

1. **Keyword Extraction** (`helpers/ragService.js`):
   - **NEW**: Added `extractSearchKeywords()` function to extract meaningful terms from questions
   - Removes stop words like "what", "is", "the", "latest", "news", "on"
   - Prioritizes important terms like country names, political figures, and key topics
   - Converts "What is the latest news on Iran?" to just "Iran" for search

2. **Enhanced Search Strategy**:
   - Uses extracted keywords instead of full question for database search
   - Added fallback to broader search when type-specific search yields no results
   - Better handling of enabled record types after broad search

3. **Expanded Keyword Matching**:
   - Added more Iran-related keywords: `'iranian'`, `'tehran'`
   - Enhanced country and nationality keywords (e.g., `'chinese'`, `'russian'`, `'israeli'`)
   - Added military/political terms: `'nuclear'`, `'preemptive'`, `'enrichment'`, `'weapons'`
   - Included administration terms: `'biden'`, `'trump'`, `'administration'`

4. **Improved Search Logic**:
   - Better handling of search parameter passing
   - Maintains `summarizeTags: true` for relevance scoring
   - Preserves all critical search parameters like the working API call

## Debugging Tools Created

### 0. Complete Test Suite (`run_all_tests.js`) - **RECOMMENDED**

Run all tests at once for comprehensive diagnostics:

```bash
# Make sure you're in the project directory with dependencies installed
cd /path/to/oip-arweave-indexer
node run_all_tests.js
```

**What it does**:
- Runs all tests below in sequence
- Provides comprehensive diagnosis of both issues
- Shows summary and next steps

### 1. Service Health Check (`check_services.js`)

Run this to diagnose TTS and other service issues:

```bash
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

### 3. Keyword Extraction Test (`test_keyword_extraction.js`)

Test the new keyword extraction functionality:

```bash
node test_keyword_extraction.js
```

**What it tests**:
- Extraction of key terms from natural language questions
- Removal of stop words and question phrases
- Prioritization of important terms like country names

### 4. TTS Direct Test (`test_tts_directly.js`)

Test the TTS service directly to diagnose audio issues:

```bash
node test_tts_directly.js
```

**What it tests**:
- TTS service health and voices endpoints
- Direct synthesis with different text lengths
- Identifies 0-byte audio responses
- Tests Chatterbox engine specifically

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

5. **Test TTS service directly**:
   ```bash
   node test_tts_directly.js
   ```

6. **Check for 0-byte audio responses**:
   - Look for "Successfully synthesized with Chatterbox: 0 bytes" in logs
   - This indicates Chatterbox is responding but not generating audio
   - May indicate GPU memory issues or service configuration problems

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
- Should handle long text by truncating to 1000 characters
- Should detect and handle 0-byte responses from Chatterbox
- Should fall back to eSpeak with proper error handling
- Should show detailed error messages if TTS service fails

### RAG Search:
- **NEW**: Should extract keywords from questions ("What's the latest on Iran?" → "Iran")
- Should find Iran-related records when they exist using keyword search
- Should fall back to broader search if type-specific search fails
- Should include relevant record types in search results
- Should maintain proper search parameter passing with `summarizeTags=true`

## Verification Steps

1. **Test TTS Quality**:
   - Open voice assistant
   - Check that default voice is a Chatterbox variant
   - Record a test message and verify audio quality
   - Check browser developer tools for any fallback headers

2. **Test Iran Search**:
   - Ask "What's the latest on Iran?" or similar natural language question
   - Should extract "Iran" from the question (check logs for keyword extraction)
   - Should return relevant Iran-related articles from your database
   - Check sources section for Iran-related content
   - Verify context is being used (green indicator)
   - Test the keyword extraction: `node test_keyword_extraction.js`

3. **Monitor Logs**:
   - Check for "[TTS]" log messages indicating successful Chatterbox usage
   - Look for "[RAG]" messages showing successful record retrieval
   - Watch for any fallback indicators

## Configuration Notes

- **GPU Profile**: Ensure you're using the `gpu` or `full-gpu` docker-compose profile for Chatterbox TTS
- **Environment**: Check that `TTS_SERVICE_URL=http://tts-service-gpu:5002` is set correctly
- **Dependencies**: Verify all GPU services are running: `ollama`, `tts-service-gpu`, `stt-service-gpu`

## Summary of Key Changes Made

### 🔍 **Search Issue - SOLVED**
**Problem**: System was searching for entire question "What is the latest news on Iran?"
**Solution**: Added keyword extraction that converts questions to key terms ("Iran")

**Files Modified**:
- `helpers/ragService.js`: Added `extractSearchKeywords()` function
- Extracts meaningful terms, removes stop words
- Prioritizes important terms like country names
- Now searches for "Iran" instead of full question

### 🎤 **TTS Issue - IMPROVED** 
**Problem**: Chatterbox returning 0 bytes, eSpeak fallback failing
**Solutions Applied**:
- Added text length limiting (1000 chars) to prevent service overload
- Added detection of 0-byte responses
- Fixed eSpeak fallback parameter access
- Added comprehensive error logging

**Files Modified**:
- `routes/voice.js`: Enhanced error handling, text truncation, fallback fixes
- `frontend/src/components/VoiceAssistant.tsx`: Better voice selection defaults

### 🛠️ **Debugging Tools Created**
- `test_keyword_extraction.js`: Test keyword extraction
- `test_tts_directly.js`: Test TTS service directly  
- `test_iran_search.js`: Test Iran search functionality
- `check_services.js`: Health check all services

## Next Steps

**To test the fixes**:
1. **Search**: Ask "What's the latest on Iran?" - should now find relevant records
2. **TTS**: Check logs for text truncation and 0-byte detection
3. **Debug**: Use the test scripts to verify functionality

**If issues persist**:
1. Run the debugging tools to get detailed diagnostics
2. Check Docker container health and logs  
3. Verify the correct docker-compose profile is being used
4. Ensure GPU services have proper GPU access if using GPU profile
5. For TTS 0-byte issues: Check GPU memory and restart TTS container 