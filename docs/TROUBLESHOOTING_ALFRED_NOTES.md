# Troubleshooting: ALFRED Notes RAG Not Responding

## Problem Summary

When querying the `/api/notes/converse` endpoint, the request hangs and never returns a response. The logs show:

```
[ALFRED Notes RAG] Step 6: Calling ALFRED for response...
[ALFRED] 🎯 Using specific model (no racing): llama3.2:3b
(then nothing...)
```

## Root Cause

**Ollama service is not running.** The code tries to connect to Ollama at `http://localhost:11404` (or internally at `http://ollama:11434`), but the service is unavailable, causing the axios request to hang.

## Solution 1: Start Ollama Service (Recommended)

### Quick Start

```bash
cd /Users/devon/Documents/CODE-local/oip-arweave-indexer

# Option A: Backend only (for Mac/iOS clients)
make backend-only

# Option B: Full stack with AI services
make standard

# Option C: If Docker Desktop is not running
# 1. Open Docker Desktop application
# 2. Wait for it to start
# 3. Run one of the make commands above
```

### Verify Ollama is Running

After starting the services:

```bash
# Check Docker containers
docker ps | grep ollama

# Should show something like:
# fitnessally-ollama-1   Up 2 minutes   0.0.0.0:11404->11434/tcp

# Test Ollama API
curl http://localhost:11404/api/tags

# Should return JSON with available models
```

### Verify llama3.2:3b Model is Installed

```bash
# List installed models
docker exec -it fitnessally-ollama-1 ollama list

# If llama3.2:3b is not listed, install it:
docker exec -it fitnessally-ollama-1 ollama pull llama3.2:3b

# Verify it's now available
docker exec -it fitnessally-ollama-1 ollama list | grep llama3.2
```

## Solution 2: Code Improvements (Already Applied)

The code has been improved to:

1. **Faster failure detection**: Reduced timeout from 25s to 15s
2. **Better error messages**: Specific messages for:
   - Ollama not running (`ECONNREFUSED`)
   - Ollama timeout (`ETIMEDOUT`)
   - Connection issues
3. **User-friendly responses**: Instead of hanging, returns helpful error messages

### Changes Made

**File: `helpers/alfred.js`**
- Added connection logging before Ollama calls
- Reduced timeout from 25s to 15s for faster failure
- Added specific error handling for `ECONNREFUSED` and `ETIMEDOUT`
- Improved error messages in top-level query catch block

**File: `routes/notes.js`**
- Enhanced error response to include error codes
- Added specific error messages for Ollama unavailability
- Returns errors in response body (not just logs)

## Testing the Fix

### Test 1: With Ollama Running

```bash
# Start services
make backend-only

# Wait 30 seconds for Ollama to initialize

# Test the endpoint
curl -X POST http://api.oip.onl/api/notes/converse \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "noteDid": "did:gun:647f79c2a338:72aa9736fa968ac2dbdecd7753dece2035a9c30cf527b58a47ed6406fc3ffdea",
    "question": "why can'\''t matty goto grandmas house tomorrow?",
    "model": "llama3.2:3b"
  }'

# Expected: Should return answer within 15-30 seconds
```

### Test 2: With Ollama Not Running

```bash
# Stop Ollama
docker stop fitnessally-ollama-1

# Test the endpoint (same curl command as above)

# Expected: Should return error within 15 seconds:
# {
#   "success": true,
#   "answer": "⚠️ The AI service (Ollama) is not running. Please start it with: `make backend-only`...",
#   "error": "Ollama service is not running...",
#   "error_code": "ECONNREFUSED"
# }
```

## Common Issues

### Issue 1: Docker Desktop Not Running

**Symptom:**
```
Cannot connect to the Docker daemon at unix:///Users/devon/.docker/run/docker.sock
```

**Solution:**
1. Open Docker Desktop application
2. Wait for it to fully start (check menu bar icon)
3. Try `make backend-only` again

### Issue 2: Ollama Takes Time to Start

**Symptom:** First request fails with timeout, then subsequent requests work

**Solution:**
- Ollama needs 20-30 seconds to initialize after container starts
- Wait before sending requests
- Or use the error message to retry

### Issue 3: Wrong Ollama Port

**Symptom:** Connection refused on localhost:11434

**Solution:**
- Check `.env` file: `OLLAMA_PORT=11404` (not 11434)
- Use correct port: `http://localhost:11404`
- Internal Docker: `http://ollama:11434` (this is correct for internal communication)

### Issue 4: Model Not Installed

**Symptom:** Ollama responds with "model not found" or similar error

**Solution:**
```bash
# Pull the model
docker exec -it fitnessally-ollama-1 ollama pull llama3.2:3b

# Verify
docker exec -it fitnessally-ollama-1 ollama list
```

## Architecture Notes

### Ollama Configuration

From `.env`:
```bash
OLLAMA_HOST=http://ollama:11434      # Internal Docker network
COMPOSE_PROJECT_NAME=fitnessally     # Container prefix
OLLAMA_PORT=11404                     # External port (localhost access)
```

### Request Flow

1. iOS app → API Gateway (api.oip.onl) → `/api/notes/converse`
2. `routes/notes.js` → Fetches note record with transcript
3. `routes/notes.js` → Calls `alfred.query()` with context
4. `helpers/alfred.js` → Detects `pinnedJsonData`, calls `answerQuestionAboutPinnedData()`
5. `helpers/alfred.js` → Calls `extractAndFormatContent()`
6. `helpers/alfred.js` → Calls `generateRAGResponse()` with context
7. `helpers/alfred.js` → **Makes axios POST to Ollama** at `http://localhost:11404`
8. Ollama → Returns response → Back through the stack → iOS app

### Timeout Strategy

- **Ollama timeout**: 15 seconds (was 25s)
- **Total request timeout**: Should be < 30 seconds
- **Fallback**: If Ollama fails, system now returns error immediately instead of hanging

## Monitoring

### Check Ollama Health

```bash
# Container status
docker ps | grep ollama

# Container logs
docker logs fitnessally-ollama-1 --tail 50

# Test API directly
curl http://localhost:11404/api/tags

# Check resource usage
docker stats fitnessally-ollama-1 --no-stream
```

### Check Application Logs

```bash
# Follow application logs
docker logs fitnessally-oip-1 -f

# Look for these log messages:
# [ALFRED] 📡 Calling Ollama at http://ollama:11434 with model llama3.2:3b...
# [ALFRED] ✅ Ollama responded with 245 chars
# [ALFRED] ❌ Ollama request timed out after 15 seconds
# [ALFRED] ❌ Ollama is not running! Cannot connect to http://ollama:11434
```

## Summary

1. **Immediate fix**: Start Ollama with `make backend-only` or `make standard`
2. **Code improvements**: Better error handling prevents hanging (already applied)
3. **Future prevention**: Monitor Ollama health, ensure it starts with the stack
4. **User experience**: Clear error messages guide users to start the service

## Related Documentation

- [OIP Technical Overview](./OIP_TECHNICAL_OVERVIEW.md)
- [ALFRED Complete Guide](./ALFRED_COMPLETE_GUIDE.md)
- [ALFRED Notes API Guide](./ALFRED_NOTES_API_FRONTEND_GUIDE.md)
- [Start Backend Guide](../START_BACKEND.md)

