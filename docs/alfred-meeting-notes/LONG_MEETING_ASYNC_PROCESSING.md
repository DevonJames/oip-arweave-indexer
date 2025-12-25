# Alfred Notes: Async Processing for Long Meetings

**Date:** December 2024  
**Purpose:** Handle meetings up to 4+ hours without timeout failures

---

## Overview

For meetings longer than 60 minutes, the synchronous `/api/notes/from-audio` endpoint may time out before processing completes. This guide explains the async processing system designed to handle meetings of any length, including 4+ hour recordings.

---

## The Problem

Long meeting processing involves several time-intensive steps:

| Step | Typical Time (4-hour meeting) |
|------|------------------------------|
| Audio transcription | 30-60 minutes |
| Summary generation | 10-20 minutes |
| Creating 480 chunks | 20-30 minutes |
| **Total** | **60-110+ minutes** |

This exceeds typical HTTP connection timeouts (2-5 minutes), causing failures for long recordings.

---

## Solution: Async Job-Based Processing

### New Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/notes/from-audio-async` | POST | Start async processing, returns job ID immediately |
| `/api/notes/jobs/:jobId` | GET | Poll for job status and progress |
| `/api/notes/jobs` | GET | List user's processing jobs |
| `/api/notes/jobs/:jobId` | DELETE | Cancel a processing job |

### Workflow

```
1. Client uploads audio → /api/notes/from-audio-async
                              ↓
2. Server returns jobId immediately (HTTP 202)
                              ↓
3. Background processing starts (transcription → summarization → records)
                              ↓
4. Client polls /api/notes/jobs/:jobId every 10-30 seconds
                              ↓
5. When status='complete', result contains noteHash and noteDid
```

---

## API Usage Examples

### 1. Start Async Processing

```bash
curl -X POST "https://api.example.com/api/notes/from-audio-async" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "audio=@long_meeting.m4a" \
  -F "start_time=2024-12-25T10:00:00Z" \
  -F "end_time=2024-12-25T14:00:00Z" \
  -F "note_type=MEETING" \
  -F "device_type=MAC"
```

**Response (202 Accepted):**
```json
{
  "success": true,
  "jobId": "job_1703505600000_abc123xyz",
  "message": "Processing started for 240 minute recording",
  "estimatedProcessingTime": "60-120 minutes",
  "statusUrl": "/api/notes/jobs/job_1703505600000_abc123xyz"
}
```

### 2. Poll for Status

```bash
curl "https://api.example.com/api/notes/jobs/job_1703505600000_abc123xyz" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response (in progress):**
```json
{
  "success": true,
  "jobId": "job_1703505600000_abc123xyz",
  "status": "transcribing",
  "progress": 35,
  "currentStep": "Transcribing audio (this may take a while for long recordings)",
  "createdAt": "2024-12-25T10:00:00Z",
  "updatedAt": "2024-12-25T10:15:00Z",
  "audioFilename": "long_meeting.m4a",
  "durationSec": 14400
}
```

**Response (complete):**
```json
{
  "success": true,
  "jobId": "job_1703505600000_abc123xyz",
  "status": "complete",
  "progress": 100,
  "currentStep": "Processing complete",
  "result": {
    "noteHash": "abc123def456...",
    "noteDid": "did:gun:...",
    "transcriptionStatus": "COMPLETE",
    "chunkCount": 480,
    "summary": {
      "keyPoints": 12,
      "decisions": 5,
      "actionItems": 8,
      "openQuestions": 3
    }
  }
}
```

### 3. List Jobs

```bash
curl "https://api.example.com/api/notes/jobs?limit=10" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 4. Cancel a Job

```bash
curl -X DELETE "https://api.example.com/api/notes/jobs/job_1703505600000_abc123xyz" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## Job Status Values

| Status | Description |
|--------|-------------|
| `queued` | Job created, waiting to start |
| `uploading` | Processing audio file |
| `transcribing` | Speech-to-text in progress |
| `chunking` | Splitting transcript into chunks |
| `summarizing` | Generating AI summary |
| `creating_records` | Publishing OIP records |
| `complete` | Processing finished successfully |
| `failed` | Processing failed (check error) |
| `cancelled` | Cancelled by user |

---

## Timeout Configuration

### Environment Variables

```bash
# STT Max Duration (5 hours = 18000 seconds)
STT_MAX_DURATION_SECONDS=18000

# LLM Timeout (10 minutes base, scales with text length)
LLM_TIMEOUT_MS=600000

# HTTP Server Timeouts (for sync endpoint)
HTTP_SERVER_TIMEOUT_MS=1800000      # 30 minutes
HTTP_KEEPALIVE_TIMEOUT_MS=2100000   # 35 minutes
HTTP_HEADERS_TIMEOUT_MS=2100000     # 35 minutes
```

### Dynamic LLM Timeout Calculation

For very long transcripts (100k+ characters from 4+ hour meetings), the LLM timeout is calculated dynamically:

```
timeout = min(BASE_TIMEOUT + (text_length / 10000) * 60000, 30 minutes)
```

Example:
- 50k chars → 10 min + 5 min = 15 min timeout
- 100k chars → 10 min + 10 min = 20 min timeout
- 200k chars → 10 min + 20 min = 30 min timeout (capped)

---

## Client Implementation

### iOS/Swift Example

```swift
class MeetingUploader {
    func uploadLongMeeting(audioURL: URL, metadata: MeetingMetadata) async throws -> String {
        // 1. Start async processing
        let jobId = try await startAsyncProcessing(audioURL: audioURL, metadata: metadata)
        
        // 2. Poll for completion
        while true {
            let status = try await checkJobStatus(jobId: jobId)
            
            switch status.status {
            case "complete":
                return status.result.noteDid
            case "failed":
                throw MeetingError.processingFailed(status.error)
            case "cancelled":
                throw MeetingError.cancelled
            default:
                // Update UI with progress
                await updateProgress(status.progress, step: status.currentStep)
                try await Task.sleep(nanoseconds: 15_000_000_000) // 15 seconds
            }
        }
    }
}
```

### JavaScript/React Example

```javascript
async function processLongMeeting(audioFile, metadata) {
    // Start async processing
    const startResponse = await fetch('/api/notes/from-audio-async', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: createFormData(audioFile, metadata)
    });
    
    const { jobId } = await startResponse.json();
    
    // Poll for completion
    return new Promise((resolve, reject) => {
        const poll = setInterval(async () => {
            const status = await fetch(`/api/notes/jobs/${jobId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            }).then(r => r.json());
            
            if (status.status === 'complete') {
                clearInterval(poll);
                resolve(status.result);
            } else if (status.status === 'failed') {
                clearInterval(poll);
                reject(new Error(status.error));
            } else {
                // Update progress UI
                updateProgressBar(status.progress, status.currentStep);
            }
        }, 15000); // Poll every 15 seconds
    });
}
```

---

## Best Practices

### When to Use Async Processing

| Meeting Length | Recommended Endpoint |
|----------------|---------------------|
| < 60 minutes | `/api/notes/from-audio` (sync) |
| 60-120 minutes | Either (async recommended) |
| > 120 minutes | `/api/notes/from-audio-async` (required) |

### Polling Interval

- **First 5 minutes:** Poll every 10 seconds (transcription starting)
- **During transcription:** Poll every 30 seconds
- **After transcription:** Poll every 15 seconds

### Error Handling

1. Always check `status` field first
2. If `status === 'failed'`, check `error.message` and `error.code`
3. Retry on network errors, not on processing errors
4. Implement exponential backoff for polling

### Job Cleanup

- Jobs are automatically cleaned up after 24 hours
- Cancelled jobs are also cleaned up after 24 hours
- You can manually cancel jobs that are no longer needed

---

## Troubleshooting

### Job Stuck in "transcribing" Status

Long meetings take longer to transcribe:
- 2-hour meeting: ~30-60 minutes transcription time
- 4-hour meeting: ~60-120 minutes transcription time

This is expected - the async system is designed to handle this.

### "Transcription timed out" Error

The STT service timeout may need adjustment:
```bash
STT_MAX_DURATION_SECONDS=21600  # Increase to 6 hours
```

### "All parallel LLM requests failed" Error

For very long transcripts, LLM timeout may need adjustment:
```bash
LLM_TIMEOUT_MS=1200000  # Increase to 20 minutes base
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Client                                │
│  (iOS App, Web App, etc.)                                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ POST /from-audio-async
┌─────────────────────────────────────────────────────────────┐
│                     OIP API Server                           │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              NotesJobService (In-Memory)                ││
│  │  - Job queue management                                  ││
│  │  - Status tracking                                       ││
│  │  - Auto-cleanup (24h)                                    ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ Background processing
┌─────────────────────────────────────────────────────────────┐
│                   Processing Pipeline                        │
│                                                              │
│  ┌─────────┐   ┌────────────┐   ┌────────────┐   ┌────────┐│
│  │  STT    │ → │ Chunking   │ → │ Summarize  │ → │ Publish ││
│  │ Service │   │  Service   │   │  Service   │   │ Records ││
│  └─────────┘   └────────────┘   └────────────┘   └────────┘│
│     (async)       (sync)          (async)         (async)   │
└─────────────────────────────────────────────────────────────┘
```

---

## Related Files

- `services/notesJobService.js` - Job management service
- `services/sttService.js` - Speech-to-text with extended timeouts
- `services/summarizationService.js` - Dynamic timeout calculation
- `routes/notes.js` - API endpoints including async handlers

