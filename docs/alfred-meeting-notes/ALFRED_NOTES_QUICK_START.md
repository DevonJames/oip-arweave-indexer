# Alfred Meeting Notes - Quick Start Guide

## Quick Test (Copy-Paste Ready)

### 1. Register a Test User
```bash
curl -X POST http://localhost:3005/api/user/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "notes-test@example.com",
    "password": "TestPass123!"
  }'
```

**Save the token** from the response!

### 2. Upload a Meeting Note
```bash
# Replace YOUR_JWT_TOKEN with token from step 1
# Replace recording.mp3 with your audio file

curl -X POST http://localhost:3005/api/notes/from-audio \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "audio=@recording.mp3" \
  -F "start_time=2025-11-20T10:00:00Z" \
  -F "end_time=2025-11-20T10:30:00Z" \
  -F "note_type=MEETING" \
  -F "device_type=IPHONE" \
  -F "transcription_engine_id=whisper_default" \
  -F "chunking_strategy=BY_TIME_30S" \
  -F 'participant_display_names=["Alice Johnson", "Bob Smith"]' \
  -F 'participant_roles=["Manager", "Developer"]'
```

**Save the noteHash** from the response!

### 3. List All Notes
```bash
curl -X GET "http://localhost:3005/api/notes?limit=10&sortBy=date:desc" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 4. Get Specific Note
```bash
# Replace NOTE_HASH with noteHash from step 2
curl -X GET "http://localhost:3005/api/notes/NOTE_HASH" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Available Note Types
- `MEETING` - Team meetings, client calls
- `ONE_ON_ONE` - 1:1 conversations
- `STANDUP` - Daily standups
- `IDEA` - Brainstorming, idea capture
- `REFLECTION` - Personal reflections
- `INTERVIEW` - Job interviews, user interviews
- `OTHER` - Everything else

## Available Device Types
- `IPHONE` - iPhone recordings
- `MAC` - Mac recordings
- `WATCH` - Apple Watch recordings
- `OTHER` - Other devices

## Chunking Strategies
- `BY_TIME_15S` - 15-second chunks (very granular)
- `BY_TIME_30S` - 30-second chunks (default, balanced)
- `BY_TIME_60S` - 60-second chunks (broader context)
- `BY_SENTENCE` - Sentence-based chunks
- `BY_PARAGRAPH` - Paragraph-based chunks
- `BY_SPEAKER` - Speaker change-based chunks

## Audio Formats Supported
- MP3 (`audio/mpeg`)
- M4A/AAC (`audio/mp4`, `audio/x-m4a`)
- WAV/PCM (`audio/wav`)
- WebM/Opus (`audio/webm`)
- FLAC (`audio/flac`)
- OGG/Vorbis (`audio/ogg`)

## Query Parameters for Listing

```bash
# Filter by note type
curl "http://localhost:3005/api/notes?note_type=MEETING" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Date range
curl "http://localhost:3005/api/notes?from=2025-11-01&to=2025-11-30" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Search
curl "http://localhost:3005/api/notes?search=project%20discussion" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Pagination
curl "http://localhost:3005/api/notes?limit=20&page=2" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Sort
curl "http://localhost:3005/api/notes?sortBy=date:desc" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Response Format

### Successful Upload
```json
{
  "success": true,
  "noteHash": "abc123def456...",
  "noteDid": "did:gun:647f79c2a338:abc123def456...",
  "transcriptionStatus": "COMPLETE",
  "chunkCount": 12,
  "summary": {
    "keyPoints": 5,
    "decisions": 3,
    "actionItems": 4,
    "openQuestions": 2
  }
}
```

### Note Retrieval
```json
{
  "success": true,
  "note": {
    "data": {
      "basic": {
        "name": "Meeting with ACME Corp",
        "date": 1700654321,
        "language": "en"
      },
      "notes": {
        "note_type": "MEETING",
        "created_at": "2025-11-20T10:00:00Z",
        "ended_at": "2025-11-20T10:30:00Z",
        "transcription_status": "COMPLETE",
        "summary_key_points": [
          "Discussed Q4 roadmap",
          "Reviewed budget allocation",
          "Agreed on timeline"
        ],
        "summary_decisions": [
          "Launch in January",
          "Hire 2 more engineers"
        ],
        "summary_action_item_texts": [
          "Prepare proposal",
          "Schedule follow-up"
        ],
        "summary_action_item_assignees": [
          "Alice Johnson",
          "Bob Smith"
        ],
        "participant_display_names": ["Alice Johnson", "Bob Smith"],
        "chunk_count": 12
      }
    },
    "oip": {
      "did": "did:gun:...",
      "storage": "gun",
      "recordType": "notes"
    }
  },
  "transcript": { /* transcript text record */ },
  "chunks": {
    "count": 12,
    "strategy": "BY_TIME_30S"
  }
}
```

## Common Errors

### 400 - Bad Request
```json
{
  "success": false,
  "error": "Missing required field: note_type"
}
```
**Fix**: Include all required fields in request

### 401 - Unauthorized
```json
{
  "success": false,
  "error": "User public key not available"
}
```
**Fix**: Ensure you're logged in and using valid JWT token

### 422 - Engine Not Found
```json
{
  "success": false,
  "error": "Transcription engine not configured: whisper_default"
}
```
**Fix**: Create a transcriptionEngine record or use existing engine_id

### 502 - STT Service Failed
```json
{
  "success": false,
  "error": "Speech-to-text processing failed"
}
```
**Fix**: Ensure STT service is running at `STT_SERVICE_URL`

## Troubleshooting

### Check if server is running
```bash
curl http://localhost:3005/api/health
```

### Check Elasticsearch indices
```bash
curl -X GET "localhost:9200/_cat/indices?v" | grep -E "notes|note_chunks"
```

### Verify authentication
```bash
curl -X GET http://localhost:3005/api/user/me \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Check logs
```bash
# Look for emoji-prefixed logs:
# 🎙️ Audio ingestion
# 🎤 STT processing
# 📝 Summarization
# ✅ Success
# ❌ Errors
```

## Environment Variables

Required:
- `PORT` - Server port (default: 3005)
- `STT_SERVICE_URL` - Speech-to-text service (default: http://localhost:3010)
- `JWT_SECRET` - JWT signing secret
- `ELASTICSEARCHHOST` - Elasticsearch host

Optional:
- `OPENAI_API_KEY` - For GPT models in summarization
- `XAI_API_KEY` - For Grok models in summarization
- `OLLAMA_HOST` - For local LLM models (default: http://ollama:11434)

## Next Steps

1. **iOS Integration**: Use these endpoints from iOS app
2. **Create Transcription Engines**: Set up transcriptionEngine records
3. **Test RAG**: Query notes through ALFRED with context
4. **Monitor Performance**: Check processing times and optimize
5. **Add Audio Storage**: Implement S3/IPFS upload for audio files

## Support

For detailed documentation, see:
- `ALFRED_NOTES_IMPLEMENTATION_SUMMARY.md` - Complete technical overview
- `alfred-meetingNotes-backendFunctionality.md` - Original specification
- `Alfred-MeetingNotes-prd.md` - Product requirements

For issues:
1. Check logs for emoji-prefixed errors (❌)
2. Verify all services are running (STT, Elasticsearch, GUN)
3. Confirm JWT token is valid
4. Test with small audio file first (< 1 minute)

