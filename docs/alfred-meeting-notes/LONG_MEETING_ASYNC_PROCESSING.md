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

## The Solution: Async Job-Based Processing

### New Endpoints

#### 1. `POST /api/notes/from-audio-async`
Starts processing in the background and returns immediately with a job ID.

**Request:** Same as `/from-audio` (multipart form with audio file or transcript)

**Response (HTTP 202 Accepted):**
```json
{
  "success": true,
  "jobId": "job_m5abc123_xyz789",
  "message": "Processing started for 240 minute recording",
  "estimatedProcessingTime": "360-720 minutes",
  "statusUrl": "/api/notes/jobs/job_m5abc123_xyz789"
}
```

#### 2. `GET /api/notes/jobs/:jobId`
Poll for processing status.

**Response:**
```json
{
  "success": true,
  "id": "job_m5abc123_xyz789",
  "status": "transcribing",
  "progress": 25,
  "currentStep": "Transcription in progress (this may take a while for long recordings)",
  "createdAt": 1702800000000,
  "updatedAt": 1702801500000,
  "durationSec": 14400,
  "estimatedTimeRemaining": 5400,
  "result": null,
  "error": null
}
```

**Job Statuses:**
- `queued` - Waiting to start
- `transcribing` - Converting audio to text
- `chunking` - Splitting transcript into chunks
- `summarizing` - Generating summary with LLM
- `creating_records` - Creating OIP records
- `complete` - Done! Result contains noteHash and noteDid
- `failed` - Processing failed (error field contains details)

#### 3. `GET /api/notes/jobs`
List user's processing jobs.

**Query Parameters:**
- `limit` - Max jobs to return (default: 10)
- `status` - Filter by status (optional)

**Response:**
```json
{
  "success": true,
  "jobs": [...],
  "stats": {
    "total": 5,
    "queued": 0,
    "processing": 1,
    "complete": 3,
    "failed": 1
  }
}
```

#### 4. `DELETE /api/notes/jobs/:jobId`
Cancel a processing job (only works for queued/in-progress jobs).

---

## When to Use Async vs Sync

| Meeting Length | Recommended Endpoint |
|----------------|---------------------|
| < 30 minutes | `/api/notes/from-audio` (sync) |
| 30-60 minutes | Either works |
| > 60 minutes | `/api/notes/from-audio-async` (async) |
| > 2 hours | **Must use async** |

---

## Client Implementation

### Basic Polling Pattern

```javascript
async function processLongMeeting(audioFile, params) {
  // 1. Start async processing
  const formData = new FormData();
  formData.append('audio', audioFile);
  formData.append('note_type', params.noteType);
  formData.append('start_time', params.startTime);
  formData.append('end_time', params.endTime);
  formData.append('device_type', 'MAC');
  
  const startResponse = await fetch('/api/notes/from-audio-async', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData
  });
  
  const { jobId } = await startResponse.json();
  console.log(`Job started: ${jobId}`);
  
  // 2. Poll for completion
  while (true) {
    const statusResponse = await fetch(`/api/notes/jobs/${jobId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const status = await statusResponse.json();
    
    // Update UI with progress
    updateProgressBar(status.progress);
    updateStatusText(status.currentStep);
    
    if (status.status === 'complete') {
      console.log('Processing complete!', status.result);
      return status.result;
    }
    
    if (status.status === 'failed') {
      throw new Error(status.error);
    }
    
    // Wait 10 seconds before next poll
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
}
```

### iOS Implementation (Swift)

```swift
class MeetingProcessor: ObservableObject {
    @Published var progress: Double = 0
    @Published var currentStep: String = "Starting..."
    @Published var isProcessing = false
    
    func processLongMeeting(audioURL: URL, params: MeetingParams) async throws -> NoteResult {
        isProcessing = true
        defer { isProcessing = false }
        
        // Start async job
        let jobId = try await startAsyncJob(audioURL: audioURL, params: params)
        
        // Poll for completion
        while true {
            let status = try await getJobStatus(jobId: jobId)
            
            await MainActor.run {
                self.progress = Double(status.progress) / 100.0
                self.currentStep = status.currentStep
            }
            
            switch status.status {
            case "complete":
                return status.result!
            case "failed":
                throw MeetingError.processingFailed(status.error ?? "Unknown error")
            default:
                try await Task.sleep(nanoseconds: 10_000_000_000) // 10 seconds
            }
        }
    }
}
```

---

## Configuration

### Environment Variables

```bash
# LLM Timeout (base: 10 min, dynamic for long transcripts, max: 30 min)
LLM_TIMEOUT_MS=600000

# STT Max Duration (5 hours to support 4-hour meetings with overhead)
STT_MAX_DURATION_SECONDS=18000

# HTTP Server Timeouts (for sync endpoint)
HTTP_SERVER_TIMEOUT_MS=1800000       # 30 minutes
HTTP_KEEPALIVE_TIMEOUT_MS=2100000    # 35 minutes
HTTP_HEADERS_TIMEOUT_MS=2100000      # 35 minutes

# Chunk Processing
CHUNK_TAG_BATCH_SIZE=10
CHUNK_TAG_BATCH_DELAY_MS=1000
```

### Recommended Settings by Meeting Length

#### Short Meetings (< 30 min)
```bash
LLM_TIMEOUT_MS=300000          # 5 minutes
CHUNK_TAG_BATCH_SIZE=15        # More aggressive
```

#### Medium Meetings (30-90 min)
```bash
LLM_TIMEOUT_MS=600000          # 10 minutes
CHUNK_TAG_BATCH_SIZE=10        # Default
```

#### Long Meetings (90+ min)
```bash
LLM_TIMEOUT_MS=900000          # 15 minutes
CHUNK_TAG_BATCH_SIZE=5         # Conservative
# Use async endpoint!
```

#### Very Long Meetings (4+ hours)
```bash
LLM_TIMEOUT_MS=1200000         # 20 minutes
STT_MAX_DURATION_SECONDS=21600 # 6 hours
CHUNK_TAG_BATCH_SIZE=5         # Conservative
# MUST use async endpoint!
```

---

## Processing Time Estimates

Approximate processing times (varies by hardware):

| Meeting Length | Chunks | Transcription | Summary | Total |
|----------------|--------|---------------|---------|-------|
| 30 min | 60 | 5-10 min | 2-3 min | 10-15 min |
| 60 min | 120 | 10-20 min | 3-5 min | 15-30 min |
| 90 min | 180 | 15-30 min | 5-8 min | 25-45 min |
| 2 hours | 240 | 20-40 min | 8-12 min | 35-60 min |
| 4 hours | 480 | 40-80 min | 15-25 min | 70-120 min |

---

## Troubleshooting

### Job Stuck in "transcribing"
- **Cause:** Very long audio, or STT service under load
- **Solution:** Check STT service logs, increase `STT_MAX_DURATION_SECONDS`

### Job Stuck in "summarizing"  
- **Cause:** Very long transcript overwhelming LLM
- **Solution:** Increase `LLM_TIMEOUT_MS`, check LLM service logs

### Job Failed with Timeout
- **Cause:** Processing exceeded configured timeout
- **Solution:** Use environment variables to increase timeouts

### "All parallel LLM requests failed"
- **Cause:** All LLM providers timed out
- **Solution:** Increase `LLM_TIMEOUT_MS`, check network/API connectivity

---

## API Reference

### POST /api/notes/from-audio-async

**Request Body (multipart/form-data):**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| audio | File | Yes* | Audio file (or provide transcript) |
| transcript | String | Yes* | Pre-existing transcript (or provide audio) |
| start_time | ISO 8601 | Yes | Recording start time |
| end_time | ISO 8601 | Yes | Recording end time |
| note_type | String | Yes | MEETING, ONE_ON_ONE, STANDUP, IDEA, REFLECTION, INTERVIEW, OTHER |
| device_type | String | Yes | IPHONE, MAC, WATCH, OTHER |
| chunking_strategy | String | No | BY_TIME_15S, BY_TIME_30S (default), BY_TIME_60S |
| model | String | No | LLM model (default: parallel) |

**Response (202 Accepted):**
```json
{
  "success": true,
  "jobId": "job_xxx_yyy",
  "message": "Processing started for X minute recording",
  "estimatedProcessingTime": "X-Y minutes",
  "statusUrl": "/api/notes/jobs/job_xxx_yyy"
}
```

### GET /api/notes/jobs/:jobId

**Response (200 OK):**
```json
{
  "success": true,
  "id": "job_xxx_yyy",
  "status": "processing|complete|failed",
  "progress": 0-100,
  "currentStep": "Human-readable status",
  "createdAt": 1702800000000,
  "updatedAt": 1702801500000,
  "durationSec": 14400,
  "estimatedTimeRemaining": 5400,
  "result": { /* present when complete */ },
  "error": "string|null",
  "errorDetails": "string|null"
}
```

---

## Related Documentation

- [Alfred Notes PRD](./Alfred-MeetingNotes-prd.md)
- [Backend Functionality Guide](./alfred-meetingNotes-backendFunctionality.md)
- [Timeout Fixes Summary](./TIMEOUT_FIXES_SUMMARY.md)
- [API Frontend Guide](./ALFRED_NOTES_API_FRONTEND_GUIDE.md)

