# Alfred Meeting Notes API - Frontend Integration Guide

## Overview

The Alfred Meeting Notes API allows you to upload audio recordings and automatically receive:
- AI-generated transcription (via Whisper STT)
- Structured summary with key points, decisions, action items, and questions
- Searchable note chunks with AI-generated tags
- Full text transcript
- Audio storage on web server, IPFS, and/or BitTorrent

## Authentication

All API requests require JWT authentication:

```javascript
headers: {
  'Authorization': `Bearer ${jwtToken}`
}
```

Your JWT token should include:
- `userId` - User's unique ID
- `email` - User's email
- `publicKey` - User's HD wallet public key (for OIP record ownership)

---

## API Endpoints Overview

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/notes/from-audio` | POST | Sync audio ingestion (< 60 min meetings) |
| `/api/notes/from-audio-async` | POST | Async audio ingestion (60+ min meetings) |
| `/api/notes/jobs/:jobId` | GET | Poll async job status |
| `/api/notes/jobs` | GET | List user's processing jobs |
| `/api/notes/jobs/:jobId` | DELETE | Cancel a processing job |
| `/api/notes/:noteHash` | GET | Get single note with all data |
| `/api/notes/:noteHash/regenerate-summary` | POST | Regenerate summary for note |
| `/api/notes` | GET | List and search notes |
| `/api/notes/converse` | POST | RAG conversation about notes |

---

## Synchronous Audio Ingestion

### POST `/api/notes/from-audio`

Upload an audio recording and create a complete note with AI processing. **Best for meetings under 60 minutes.**

**Base URL:** `https://api.oip.onl/api/notes/from-audio`

**Content-Type:** `multipart/form-data`

---

## Request Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `audio` | File | Audio file (formats: .m4a, .wav, .mp3, .webm, .ogg, .flac) - **Optional if `transcript` provided** |
| `transcript` | String | Pre-existing transcript text - **Optional if `audio` provided** |
| `start_time` | String (ISO 8601) | Recording start timestamp (e.g., "2025-11-20T10:00:00Z") |
| `end_time` | String (ISO 8601) | Recording end timestamp |
| `note_type` | String | Type of note: "MEETING", "ONE_ON_ONE", "STANDUP", "IDEA", "REFLECTION", "INTERVIEW", "OTHER" |
| `device_type` | String | Device used: "IPHONE", "MAC", "WATCH", "OTHER" |

**Note**: Either `audio` OR `transcript` must be provided:
- If `audio` is provided: Audio will be uploaded, transcribed, and processed
- If `transcript` is provided: Transcription step will be skipped, provided text used directly  
- If both provided: Audio file is used and `transcript` is ignored

### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `title` | String | Auto-generated | Custom title for the note |
| `model` | String | `llama3.2:3b` | LLM model for summarization (see options below) |
| `addToWebServer` | Boolean | `false` | Upload audio to web server for HTTP access |
| `addToBitTorrent` | Boolean | `false` | Seed audio via BitTorrent |
| `addToIPFS` | Boolean | `false` | Upload audio to IPFS |
| `addToArweave` | Boolean | `false` | Upload audio to Arweave (permanent storage) |
| `participant_display_names` | JSON Array | `[]` | JSON array of participant names (e.g., `["John Smith","Jane Doe"]`) |
| `participant_roles` | JSON Array | `[]` | JSON array of roles (e.g., `["CEO","CTO"]`) - same order as names |
| `calendar_event_id` | String | `null` | Calendar event ID if linked |
| `calendar_start_time` | String (ISO 8601) | `null` | Calendar event start time |
| `calendar_end_time` | String (ISO 8601) | `null` | Calendar event end time |
| `capture_location` | String | `null` | Location where recorded |
| `chunking_strategy` | String | `BY_TIME_30S` | Chunking strategy: "BY_TIME_15S", "BY_TIME_30S", "BY_TIME_60S", "BY_SENTENCE", "BY_PARAGRAPH", "BY_SPEAKER" |

### Available LLM Models

| Model | Description |
|-------|-------------|
| `llama3.2:3b` | Fast, good quality (default) |
| `llama3.2:1b` | Fastest, lower quality |
| `llama3.1:8b` | Slower, best quality |
| `gemma2:2b` | Alternative lightweight model |
| `gpt-4o` | OpenAI GPT-4o (requires API key) |
| `gpt-4o-mini` | OpenAI faster model (requires API key) |
| `grok-beta` | xAI Grok model (requires API key) |
| `parallel` | Race multiple models, use fastest response |

---

## JavaScript Example Requests

### Example 1: With Audio File (Full Transcription)

```javascript
// Using Fetch API with audio file
async function uploadMeetingNote(audioFile, jwtToken) {
  const formData = new FormData();
  
  // Required fields
  formData.append('audio', audioFile);
  formData.append('start_time', '2025-11-20T10:00:00Z');
  formData.append('end_time', '2025-11-20T11:30:00Z');
  formData.append('note_type', 'MEETING');
  formData.append('device_type', 'IPHONE');
  
  // Optional fields
  formData.append('model', 'llama3.2:3b');
  formData.append('addToWebServer', 'true');
  formData.append('addToBitTorrent', 'false');
  formData.append('addToIPFS', 'false');
  formData.append('participant_display_names', JSON.stringify(['John Smith', 'Jane Doe', 'Bob Wilson']));
  formData.append('participant_roles', JSON.stringify(['Product Manager', 'Lead Engineer', 'Designer']));
  
  const response = await fetch('https://api.oip.onl/api/notes/from-audio', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwtToken}`
    },
    body: formData
  });
  
  const result = await response.json();
  return result;
}
```

### Example 2: With Pre-existing Transcript (Skip Transcription)

```javascript
// Using pre-existing transcript (no audio file needed)
async function createNoteFromTranscript(transcript, jwtToken) {
  const formData = new FormData();
  
  // Required fields
  formData.append('transcript', transcript); // Provide transcript instead of audio
  formData.append('start_time', '2025-11-20T10:00:00Z');
  formData.append('end_time', '2025-11-20T11:30:00Z');
  formData.append('note_type', 'MEETING');
  formData.append('device_type', 'MAC');
  
  // Optional fields
  formData.append('model', 'parallel'); // Use parallel model racing
  formData.append('participant_display_names', JSON.stringify(['Alice', 'Bob']));
  formData.append('participant_roles', JSON.stringify(['Manager', 'Developer']));
  
  const response = await fetch('https://api.oip.onl/api/notes/from-audio', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwtToken}`
    },
    body: formData
  });
  
  const result = await response.json();
  return result;
}

// Example usage
const sampleTranscript = `This is my meeting. I am meeting with Mr. Matthew James and we are talking about Legos and sweatshirts and sounds and going to Grandma's house and he would very much like to go to Grandma's house. That is what his goal is. But I think the decision is that that won't be happening today, but it will probably be happening soon but maybe not necessarily tomorrow because Grandma is going to be going on a trip.`;

const result = await createNoteFromTranscript(sampleTranscript, myJwtToken);
console.log('Note created:', result.noteDid);
```

**Benefits of Using Transcript Parameter:**
- ⚡ **Faster processing** - Skips speech-to-text step entirely
- 💰 **Lower costs** - No transcription API usage
- 🔒 **Privacy** - No need to upload audio file if you already have the transcript
- 🔄 **Flexibility** - Useful for importing notes from other sources

---

## Async Processing for Long Meetings (60+ Minutes)

For meetings longer than 60 minutes, use the async endpoint to avoid HTTP timeout issues.

### POST `/api/notes/from-audio-async`

Start async processing and receive a job ID for status polling.

**Same parameters as `/from-audio`**

**Response:**

```json
{
  "success": true,
  "message": "Processing job started",
  "jobId": "job_1703520000000_abc123xyz",
  "estimatedDuration": "Long meetings may take 30-60+ minutes to process"
}
```

### GET `/api/notes/jobs/:jobId`

Poll for job status and progress.

```javascript
async function pollJobStatus(jobId, jwtToken) {
  const response = await fetch(`https://api.oip.onl/api/notes/jobs/${jobId}`, {
    headers: {
      'Authorization': `Bearer ${jwtToken}`
    }
  });
  return await response.json();
}
```

**Response (Processing):**

```json
{
  "success": true,
  "job": {
    "jobId": "job_1703520000000_abc123xyz",
    "status": "transcribing",
    "progress": 45,
    "currentStep": "Transcribing audio (this may take a while for long meetings)...",
    "createdAt": "2025-12-25T10:00:00.000Z",
    "updatedAt": "2025-12-25T10:15:00.000Z",
    "audioFilename": "meeting-recording.m4a",
    "durationSec": 7200,
    "result": null,
    "error": null
  }
}
```

**Response (Complete):**

```json
{
  "success": true,
  "job": {
    "jobId": "job_1703520000000_abc123xyz",
    "status": "complete",
    "progress": 100,
    "currentStep": "Processing complete",
    "result": {
      "noteHash": "a3f8c9d2e1b4567890abcdef1234567890...",
      "noteDid": "did:gun:034d41b0c8bd:a3f8c9d2e1b4567890...",
      "chunkCount": 240,
      "summary": {
        "keyPoints": 15,
        "decisions": 5,
        "actionItems": 8,
        "openQuestions": 3
      }
    }
  }
}
```

**Job Statuses:**

| Status | Description |
|--------|-------------|
| `queued` | Job created, waiting to start |
| `uploading` | Uploading audio file |
| `transcribing` | Transcribing audio (longest step for long meetings) |
| `chunking` | Creating searchable chunks |
| `summarizing` | Generating summary and analysis |
| `creating_records` | Saving records to database |
| `complete` | Processing finished successfully |
| `failed` | Processing failed (check `error` field) |
| `cancelled` | Job was cancelled by user |

### GET `/api/notes/jobs`

List user's processing jobs.

```javascript
async function listMyJobs(jwtToken, limit = 10, status = null) {
  const params = new URLSearchParams({ limit });
  if (status) params.append('status', status);
  
  const response = await fetch(`https://api.oip.onl/api/notes/jobs?${params}`, {
    headers: {
      'Authorization': `Bearer ${jwtToken}`
    }
  });
  return await response.json();
}
```

### DELETE `/api/notes/jobs/:jobId`

Cancel a processing job (only works for queued or in-progress jobs).

```javascript
async function cancelJob(jobId, jwtToken) {
  const response = await fetch(`https://api.oip.onl/api/notes/jobs/${jobId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${jwtToken}`
    }
  });
  return await response.json();
}
```

### Complete Async Processing Example

```javascript
async function processLongMeeting(audioFile, jwtToken) {
  // 1. Start async processing
  const formData = new FormData();
  formData.append('audio', audioFile);
  formData.append('start_time', new Date().toISOString());
  formData.append('end_time', new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString());
  formData.append('note_type', 'MEETING');
  formData.append('device_type', 'MAC');
  formData.append('model', 'parallel');
  
  const startResponse = await fetch('https://api.oip.onl/api/notes/from-audio-async', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${jwtToken}` },
    body: formData
  });
  
  const { jobId } = await startResponse.json();
  console.log('Job started:', jobId);
  
  // 2. Poll for completion
  let job;
  do {
    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
    
    const statusResponse = await fetch(`https://api.oip.onl/api/notes/jobs/${jobId}`, {
      headers: { 'Authorization': `Bearer ${jwtToken}` }
    });
    const data = await statusResponse.json();
    job = data.job;
    
    console.log(`Status: ${job.status} (${job.progress}%) - ${job.currentStep}`);
    
  } while (job.status !== 'complete' && job.status !== 'failed' && job.status !== 'cancelled');
  
  // 3. Handle result
  if (job.status === 'complete') {
    console.log('Note created:', job.result.noteDid);
    return job.result;
  } else {
    throw new Error(job.error?.message || 'Processing failed');
  }
}
```

---

## Response Format

### Success Response (200 OK)

```json
{
  "success": true,
  "noteHash": "a3f8c9d2e1b4567890abcdef1234567890abcdef1234567890abcdef12345678",
  "noteDid": "did:gun:034d41b0c8bd:a3f8c9d2e1b4567890abcdef1234567890abcdef1234567890abcdef12345678",
  "transcriptionStatus": "COMPLETE",
  "chunkCount": 3,
  "summary": {
    "keyPoints": 5,
    "decisions": 2,
    "actionItems": 3,
    "openQuestions": 1
  }
}
```

### Error Response (400/500)

```json
{
  "success": false,
  "error": "Audio note ingestion failed",
  "details": "Transcription failed: socket hang up"
}
```

---

## Retrieving Records

### 1. Get the Main Note Record

Use the `noteDid` from the response to fetch the complete note record:

**Endpoint:** `GET /api/records?source=gun&did={noteDid}`

```javascript
async function getNote(noteDid, jwtToken) {
  const response = await fetch(
    `https://api.oip.onl/api/records?source=gun&did=${noteDid}`,
    {
      headers: {
        'Authorization': `Bearer ${jwtToken}`
      }
    }
  );
  
  const result = await response.json();
  return result.records[0]; // First record in array
}
```

**Example Note Record JSON:**

```json
{
  "did": "did:gun:034d41b0c8bd:a3f8c9d2e1b4567890abcdef1234567890abcdef1234567890abcdef12345678",
  "recordType": "notes",
  "source": "gun",
  "data": {
    "basic": {
      "name": "Team Standup - Nov 20",
      "description": "Alfred Notes capture",
      "date": 1732104000,
      "language": "en",
      "tagItems": [
        "product_roadmap",
        "sprint_planning",
        "feature_prioritization",
        "api_architecture"
      ]
    },
    "audio": {
      "webUrl": "https://api.oip.onl/media/oip/meeting-nov20.m4a",
      "arweaveAddress": "",
      "ipfsAddress": "",
      "bittorrentAddress": "magnet:?xt=urn:btih:23a4bf2d...",
      "filename": "meeting-nov20.m4a",
      "size": 2081024,
      "durationSec": 5428,
      "audioCodec": "AAC",
      "contentType": "audio/mp4",
      "thumbnails": [],
      "creator": "034d41b0c8bdbf3ad65e55624b554aa01533c7d2695fe91cb8a20febc99e63e92d"
    },
    "notes": {
      "note_type": "MEETING",
      "created_at": 1732104000000,
      "ended_at": 1732109400000,
      "device_type": "IPHONE",
      "capture_location": null,
      "audio_ref": null,
      "transcription_engine": "did:gun:system:whisper_stt_v1",
      "transcription_status": "COMPLETE",
      "transcript_full_text": "did:gun:034d41b0c8bd:a3f8c9d2e1b4567890abcdef1234567890abcdef1234567890abcdef12345678:transcript",
      "user_edits_present": false,
      "summary_key_points": [
        "Team agreed to prioritize feature X for next sprint",
        "Backend API needs refactoring before frontend integration",
        "Mobile app release scheduled for December 15th",
        "New designer joining team next week",
        "Budget approved for additional server capacity"
      ],
      "summary_decisions": [
        "Use GraphQL instead of REST for new API endpoints",
        "Postpone Android tablet support until Q1 2026"
      ],
      "summary_action_item_texts": [
        "Create technical spec for API refactoring",
        "Set up onboarding meeting for new designer",
        "Update release timeline in project management tool"
      ],
      "summary_action_item_assignees": [
        "Jane Doe",
        "Bob Wilson",
        "John Smith"
      ],
      "summary_action_item_due_texts": [
        "by Friday",
        "by Monday",
        "today"
      ],
      "summary_open_questions": [
        "Should we migrate existing data to new API or maintain backwards compatibility?"
      ],
      "summary_version": 1,
      "participant_display_names": [
        "John Smith",
        "Jane Doe",
        "Bob Wilson"
      ],
      "participant_person_refs": [],
      "participant_emails": [],
      "participant_roles": [
        "Product Manager",
        "Lead Engineer",
        "Designer"
      ],
      "calendar_event_id": null,
      "calendar_start_time": null,
      "calendar_end_time": null,
      "linked_projects": [],
      "topics_auto": [
        "product_roadmap",
        "sprint_planning",
        "api_architecture",
        "mobile_release"
      ],
      "keywords_auto": [
        "API",
        "GraphQL",
        "mobile app",
        "release",
        "sprint",
        "feature prioritization"
      ],
      "sentiment_overall": "POSITIVE",
      "chunking_strategy": "BY_TIME_30S",
      "chunk_count": 3,
      "chunk_ids": [
        "did:gun:034d41b0c8bd:a3f8c9d2e1b4567890abcdef1234567890abcdef1234567890abcdef12345678:0",
        "did:gun:034d41b0c8bd:a3f8c9d2e1b4567890abcdef1234567890abcdef1234567890abcdef12345678:1",
        "did:gun:034d41b0c8bd:a3f8c9d2e1b4567890abcdef1234567890abcdef1234567890abcdef12345678:2"
      ]
    },
    "accessControl": {
      "access_level": "private",
      "owner_public_key": "034d41b0c8bdbf3ad65e55624b554aa01533c7d2695fe91cb8a20febc99e63e92d",
      "created_by": "034d41b0c8bdbf3ad65e55624b554aa01533c7d2695fe91cb8a20febc99e63e92d",
      "created_timestamp": 1732104000000,
      "last_modified_timestamp": 1732104000000,
      "version": "1.0.0"
    }
  }
}
```

---

### 2. Get the Transcript Record

Extract the transcript DID from the note record:

```javascript
const transcriptDid = noteRecord.data.notes.transcript_full_text;
```

**Endpoint:** `GET /api/records?source=gun&did={transcriptDid}`

```javascript
async function getTranscript(transcriptDid, jwtToken) {
  const response = await fetch(
    `https://api.oip.onl/api/records?source=gun&did=${transcriptDid}`,
    {
      headers: {
        'Authorization': `Bearer ${jwtToken}`
      }
    }
  );
  
  const result = await response.json();
  return result.records[0];
}
```

**Example Transcript Record JSON:**

```json
{
  "did": "did:gun:034d41b0c8bd:a3f8c9d2e1b4567890abcdef1234567890abcdef1234567890abcdef12345678:transcript",
  "recordType": "text",
  "source": "gun",
  "data": {
    "basic": {
      "name": "Transcript for note a3f8c9d2...",
      "description": "Full transcript from Alfred Notes",
      "date": 1732104000,
      "language": "en",
      "tagItems": [
        "alfred_note_transcript"
      ]
    },
    "text": {
      "value": "Okay, let's get started with today's standup. John, do you want to go first? Sure. Yesterday I finished the user authentication flow and today I'm working on the API integration for the dashboard. I'm blocked on getting the GraphQL schema finalized. Jane, can we prioritize that? Yes, absolutely. I'll have the schema ready by end of day. Moving on to sprint planning..."
    },
    "accessControl": {
      "access_level": "private",
      "owner_public_key": "034d41b0c8bdbf3ad65e55624b554aa01533c7d2695fe91cb8a20febc99e63e92d",
      "created_by": "034d41b0c8bdbf3ad65e55624b554aa01533c7d2695fe91cb8a20febc99e63e92d",
      "created_timestamp": 1732104000000,
      "last_modified_timestamp": 1732104000000,
      "version": "1.0.0"
    }
  }
}
```

---

### 3. Get Note Chunk Records

Extract the chunk DIDs from the note record:

```javascript
const chunkDids = noteRecord.data.notes.chunk_ids;
```

**Fetch each chunk:**

```javascript
async function getChunk(chunkDid, jwtToken) {
  const response = await fetch(
    `https://api.oip.onl/api/records?source=gun&did=${chunkDid}`,
    {
      headers: {
        'Authorization': `Bearer ${jwtToken}`
      }
    }
  );
  
  const result = await response.json();
  return result.records[0];
}

// Fetch all chunks
async function getAllChunks(chunkDids, jwtToken) {
  const chunks = await Promise.all(
    chunkDids.map(did => getChunk(did, jwtToken))
  );
  return chunks;
}
```

**Example Note Chunk Record JSON:**

```json
{
  "did": "did:gun:034d41b0c8bd:a3f8c9d2e1b4567890abcdef1234567890abcdef1234567890abcdef12345678:0",
  "recordType": "noteChunks",
  "source": "gun",
  "data": {
    "basic": {
      "name": "Note chunk 0",
      "description": "Chunk from meeting note",
      "date": 1732104000,
      "language": "en",
      "tagItems": [
        "standup_updates",
        "authentication",
        "api_integration",
        "blockers"
      ]
    },
    "noteChunks": {
      "note_ref": "did:gun:034d41b0c8bd:a3f8c9d2e1b4567890abcdef1234567890abcdef1234567890abcdef12345678",
      "chunk_index": 0,
      "start_time_ms": 0,
      "end_time_ms": 30000,
      "text": "Okay, let's get started with today's standup. John, do you want to go first? Sure. Yesterday I finished the user authentication flow and today I'm working on the API integration for the dashboard. I'm blocked on getting the GraphQL schema finalized. Jane, can we prioritize that?",
      "speaker_label": null,
      "is_marked_important": false,
      "sentiment": null,
      "confidence_score": null
    },
    "accessControl": {
      "access_level": "private",
      "owner_public_key": "034d41b0c8bdbf3ad65e55624b554aa01533c7d2695fe91cb8a20febc99e63e92d",
      "created_by": "034d41b0c8bdbf3ad65e55624b554aa01533c7d2695fe91cb8a20febc99e63e92d",
      "created_timestamp": 1732104000000,
      "last_modified_timestamp": 1732104000000,
      "version": "1.0.0"
    }
  }
}
```

---

## Complete Workflow Example

```javascript
class AlfredNotesClient {
  constructor(jwtToken) {
    this.jwtToken = jwtToken;
    this.baseUrl = 'https://api.oip.onl';
  }
  
  async uploadAudioNote(audioFile, options = {}) {
    const formData = new FormData();
    
    // Required
    formData.append('audio', audioFile);
    formData.append('start_time', options.startTime);
    formData.append('end_time', options.endTime);
    formData.append('note_type', options.noteType || 'MEETING');
    formData.append('device_type', options.deviceType || 'OTHER');
    
    // Optional
    if (options.model) formData.append('model', options.model);
    if (options.addToWebServer) formData.append('addToWebServer', 'true');
    if (options.participantNames) {
      formData.append('participant_display_names', JSON.stringify(options.participantNames));
    }
    if (options.participantRoles) {
      formData.append('participant_roles', JSON.stringify(options.participantRoles));
    }
    
    // Choose sync or async based on expected duration
    const endpoint = options.async 
      ? `${this.baseUrl}/api/notes/from-audio-async`
      : `${this.baseUrl}/api/notes/from-audio`;
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.jwtToken}`
      },
      body: formData
    });
    
    return await response.json();
  }
  
  async getRecord(did) {
    const response = await fetch(
      `${this.baseUrl}/api/records?source=gun&did=${did}`,
      {
        headers: {
          'Authorization': `Bearer ${this.jwtToken}`
        }
      }
    );
    
    const result = await response.json();
    return result.records[0];
  }
  
  async getCompleteNote(noteDid) {
    // Get main note record
    const note = await this.getRecord(noteDid);
    
    // Get transcript
    const transcriptDid = note.data.notes.transcript_full_text;
    const transcript = transcriptDid ? await this.getRecord(transcriptDid) : null;
    
    // Get all chunks
    const chunkDids = note.data.notes.chunk_ids || [];
    const chunks = await Promise.all(
      chunkDids.map(did => this.getRecord(did))
    );
    
    return {
      note,
      transcript,
      chunks
    };
  }
  
  async pollJobUntilComplete(jobId, intervalMs = 5000) {
    while (true) {
      const response = await fetch(`${this.baseUrl}/api/notes/jobs/${jobId}`, {
        headers: { 'Authorization': `Bearer ${this.jwtToken}` }
      });
      const data = await response.json();
      
      if (data.job.status === 'complete') return data.job.result;
      if (data.job.status === 'failed') throw new Error(data.job.error?.message);
      if (data.job.status === 'cancelled') throw new Error('Job cancelled');
      
      await new Promise(r => setTimeout(r, intervalMs));
    }
  }
}

// Usage
const client = new AlfredNotesClient('your-jwt-token');

// Upload audio (sync for short meetings)
const uploadResult = await client.uploadAudioNote(audioFile, {
  startTime: '2025-11-20T10:00:00Z',
  endTime: '2025-11-20T11:30:00Z',
  noteType: 'MEETING',
  deviceType: 'IPHONE',
  model: 'llama3.2:3b',
  addToWebServer: true,
  participantNames: ['John Smith', 'Jane Doe'],
  participantRoles: ['PM', 'Engineer']
});

// For long meetings, use async
const asyncResult = await client.uploadAudioNote(longAudioFile, {
  startTime: '2025-11-20T09:00:00Z',
  endTime: '2025-11-20T13:00:00Z',
  noteType: 'MEETING',
  async: true // Use async endpoint
});

// Poll until complete
const noteResult = await client.pollJobUntilComplete(asyncResult.jobId);

// Get complete note with transcript and chunks
const completeNote = await client.getCompleteNote(noteResult.noteDid);

console.log('Note:', completeNote.note);
console.log('Transcript:', completeNote.transcript);
console.log('Chunks:', completeNote.chunks);
```

---

## Key Data Access Patterns

### Summary Data
- **Key Points:** `noteRecord.data.notes.summary_key_points`
- **Decisions:** `noteRecord.data.notes.summary_decisions`
- **Action Items:** Combine `summary_action_item_texts`, `summary_action_item_assignees`, `summary_action_item_due_texts`
- **Open Questions:** `noteRecord.data.notes.summary_open_questions`

### Metadata
- **Participants:** `noteRecord.data.notes.participant_display_names` + `participant_roles`
- **Topics:** `noteRecord.data.notes.topics_auto`
- **Keywords:** `noteRecord.data.notes.keywords_auto`
- **Sentiment:** `noteRecord.data.notes.sentiment_overall`
- **Tags:** `noteRecord.data.basic.tagItems`

### Audio Access
- **Web URL:** `noteRecord.data.audio.webUrl` (if `addToWebServer=true`)
- **IPFS:** `noteRecord.data.audio.ipfsAddress` (if `addToIPFS=true`)
- **BitTorrent:** `noteRecord.data.audio.bittorrentAddress` (if `addToBitTorrent=true`)
- **Arweave:** `noteRecord.data.audio.arweaveAddress` (if `addToArweave=true`)

### Chunk Data
- **Text:** `chunkRecord.data.noteChunks.text`
- **Time Range:** `start_time_ms` to `end_time_ms`
- **Tags:** `chunkRecord.data.basic.tagItems` (AI-generated)
- **Index:** `chunkRecord.data.noteChunks.chunk_index`

---

## Error Handling

```javascript
async function uploadWithErrorHandling(audioFile, options) {
  try {
    const result = await client.uploadAudioNote(audioFile, options);
    
    if (!result.success) {
      throw new Error(result.error || 'Upload failed');
    }
    
    return result;
  } catch (error) {
    if (error.response?.status === 401) {
      // Authentication failed - refresh token
      console.error('Authentication failed:', error);
    } else if (error.response?.status === 400) {
      // Bad request - check parameters
      console.error('Invalid request:', error);
    } else if (error.response?.status === 500) {
      // Server error - retry or show error to user
      console.error('Server error:', error);
    } else {
      // Network error or other issue
      console.error('Upload failed:', error);
    }
    
    throw error;
  }
}
```

---

## RAG (Conversational AI) Endpoint

### POST `/api/notes/converse`

Ask questions about notes using AI with full context retrieval.

**Authentication:** Required (JWT token)

**Request Body:**

```javascript
{
  // Note Context (one of these modes):
  "noteDid": "did:gun:034d41b0c8bd:a3f8c9d2...",  // Specific note (Selected Note mode)
  "allNotes": true,  // Search across all user's notes (All Notes mode)
  // If both are omitted/false: Direct LLM mode (no RAG)
  
  // Required
  "question": "What were the main action items from this meeting?",
  
  // Optional
  "model": "llama3.2:3b",  // LLM model (default: llama3.2:3b)
  "conversationHistory": [],  // Previous conversation messages
  "includeRelated": true,  // Include related notes/chunks (default: true)
  "maxRelated": 5,  // Max related items to include (default: 5)
  
  // Audio Response (Optional)
  "return_audio": true,  // Return TTS audio response
  "engine": "elevenlabs",  // TTS engine: "elevenlabs", "kokoro", "edge_tts"
  "voice_id": "onwK4e9ZLuTAKqWW03F9",  // Voice ID for TTS
  "speed": 1  // Speech speed multiplier
}
```

**Chat Modes:**

| Mode | Parameters | Description |
|------|------------|-------------|
| **Selected Note** | `noteDid` provided | Query about a specific note |
| **All Notes** | `allNotes: true` | Search across all user's notes |
| **Direct LLM** | Neither provided | Pure LLM chat, no RAG |

**Example Request:**

```javascript
async function askAboutNote(noteDid, question, jwtToken) {
  const response = await fetch('https://api.oip.onl/api/notes/converse', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwtToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      noteDid: noteDid,
      question: question,
      model: 'llama3.2:3b',
      includeRelated: true
    })
  });
  
  return await response.json();
}

// Usage
const result = await askAboutNote(
  'did:gun:034d41b0c8bd:a3f8c9d2...',
  'What decisions were made about the API architecture?',
  jwtToken
);

console.log(result.answer);
```

**Example with Audio Response:**

```javascript
async function askWithAudio(question, jwtToken) {
  const response = await fetch('https://api.oip.onl/api/notes/converse', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwtToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      allNotes: true,
      question: question,
      return_audio: true,
      engine: 'elevenlabs',
      voice_id: 'onwK4e9ZLuTAKqWW03F9'
    })
  });
  
  const result = await response.json();
  
  if (result.audio_data) {
    // Play audio response
    const audioBlob = new Blob(
      [Uint8Array.from(atob(result.audio_data), c => c.charCodeAt(0))],
      { type: 'audio/mpeg' }
    );
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    audio.play();
  }
  
  return result;
}
```

**Response Format:**

```json
{
  "success": true,
  "answer": "Based on the meeting, several key decisions were made about the API architecture: 1) The team decided to use GraphQL instead of REST for new endpoints...",
  "context": {
    "note": {
      "did": "did:gun:034d41b0c8bd:a3f8c9d2...",
      "title": "Team Standup - Nov 20",
      "type": "MEETING"
    },
    "chunks_count": 3,
    "related_content_count": 5,
    "transcript_length": 1523,
    "mode": "selected_note"  // or "all_notes" or "direct_llm"
  },
  "model": "llama3.2:3b",
  "sources": [
    {
      "type": "record",
      "title": "Note chunk 0",
      "recordType": "noteChunks"
    }
  ],
  // If return_audio was true:
  "audio_data": "base64-encoded-audio...",
  "has_audio": true,
  "engine_used": "elevenlabs"
}
```

**What Gets Included in Context:**

The RAG endpoint automatically retrieves and includes:

1. **Main Note Data:**
   - Title, type, date, participants
   - Summary (key points, decisions, action items, questions)
   - Topics, keywords, sentiment, tags

2. **Full Transcript:**
   - Complete transcription text for detailed context

3. **Note Chunks:**
   - All chunks with their text, timestamps, and tags
   - Allows AI to reference specific time segments

4. **Related Content:**
   - Other notes with matching tags
   - Chunks from other notes with similar topics
   - Limited to `maxRelated` items (default: 5)

**Use Cases:**

```javascript
// 1. Ask about specific details
await askAboutNote(noteDid, "Who was assigned the API refactoring task?", token);

// 2. Summarize portions
await askAboutNote(noteDid, "What did Jane say about the mobile release?", token);

// 3. Find connections
await askAboutNote(noteDid, "What other meetings discussed similar topics?", token);

// 4. Extract information
await askAboutNote(noteDid, "List all the action items with their assignees", token);

// 5. Search all notes
await fetch('https://api.oip.onl/api/notes/converse', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    allNotes: true,
    question: "What did we discuss about the API last week?"
  })
});

// 6. Contextual follow-ups (with conversation history)
const response1 = await askAboutNote(noteDid, "What was discussed about the API?", token);
const response2 = await fetch('https://api.oip.onl/api/notes/converse', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    noteDid: noteDid,
    question: "When is the deadline for that?",
    conversationHistory: [
      { role: 'user', content: "What was discussed about the API?" },
      { role: 'assistant', content: response1.answer }
    ]
  })
});
```

**Available LLM Models:**

| Model | Description |
|-------|-------------|
| `llama3.2:3b` | Fast, good quality (default) |
| `llama3.2:1b` | Fastest, lower quality |
| `llama3.1:8b` | Slower, best quality |
| `gemma2:2b` | Alternative lightweight model |
| `gpt-4o` | OpenAI GPT-4o (requires API key) |
| `gpt-4o-mini` | OpenAI faster model |
| `grok-beta` | xAI Grok model |
| `parallel` | Race multiple models, use fastest |

**Error Handling:**

```javascript
try {
  const result = await askAboutNote(noteDid, question, token);
  
  if (!result.success) {
    console.error('Error:', result.error);
  } else {
    console.log('Answer:', result.answer);
  }
} catch (error) {
  if (error.response?.status === 404) {
    console.error('Note not found');
  } else if (error.response?.status === 401) {
    console.error('Authentication failed');
  } else {
    console.error('Failed to get answer:', error.message);
  }
}
```

**Building a Chat Interface:**

```javascript
class NoteChatSession {
  constructor(noteDid, jwtToken) {
    this.noteDid = noteDid;
    this.jwtToken = jwtToken;
    this.history = [];
  }
  
  async ask(question, options = {}) {
    const response = await fetch('https://api.oip.onl/api/notes/converse', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.jwtToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        noteDid: this.noteDid,
        question: question,
        conversationHistory: this.history,
        includeRelated: true,
        return_audio: options.withAudio || false,
        engine: options.ttsEngine || 'elevenlabs',
        voice_id: options.voiceId
      })
    });
    
    const result = await response.json();
    
    // Update conversation history
    this.history.push({
      role: 'user',
      content: question
    });
    this.history.push({
      role: 'assistant',
      content: result.answer
    });
    
    return result;
  }
  
  clearHistory() {
    this.history = [];
  }
}

// Usage
const chat = new NoteChatSession(noteDid, jwtToken);
const response1 = await chat.ask("What was this meeting about?");
const response2 = await chat.ask("Who participated?");
const response3 = await chat.ask("What were their main concerns?", { withAudio: true });
```

---

## Regenerate Summary

### POST `/api/notes/:noteHash/regenerate-summary`

Regenerate the AI summary for an existing note using a different model.

```javascript
async function regenerateSummary(noteHash, model, jwtToken) {
  const response = await fetch(
    `https://api.oip.onl/api/notes/${noteHash}/regenerate-summary`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwtToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model })
    }
  );
  return await response.json();
}

// Usage
const result = await regenerateSummary('a3f8c9d2e1b4567890...', 'llama3.1:8b', jwtToken);
```

---

## Notes

1. **Processing Time:** Audio processing typically takes 10-30 seconds for short meetings, 30-60+ minutes for long meetings (2+ hours)
2. **File Size Limits:** Maximum audio file size is **500MB**
3. **Supported Formats:** .m4a, .wav, .mp3, .webm, .ogg, .flac
4. **Rate Limiting:** No specific rate limits currently, but avoid excessive concurrent uploads
5. **Privacy:** All notes are private by default (`access_level: "private"`) and only accessible by the owner
6. **DIDs:** All records use Decentralized Identifiers (DIDs) in the format `did:gun:{pubkey_prefix}:{localId}`
7. **Tags:** All tags (note and chunk tags) are AI-generated based on content analysis
8. **Long Meetings:** For meetings > 60 minutes, use the async endpoint (`/from-audio-async`) to avoid HTTP timeouts

---

## Environment Variables for Long Meetings

If you're self-hosting, ensure these are set for reliable long meeting processing:

```bash
# STT Max Duration (5 hours)
STT_MAX_DURATION_SECONDS=18000

# LLM Timeout (10 minutes base)
LLM_TIMEOUT_MS=600000

# HTTP Server Timeouts (30 minutes)
HTTP_SERVER_TIMEOUT_MS=1800000
HTTP_KEEPALIVE_TIMEOUT_MS=2100000
HTTP_HEADERS_TIMEOUT_MS=2100000
```

---

## Support

For questions or issues, contact the backend team or refer to:
- Main API Documentation: `/docs/API_RECORDS_ENDPOINT_DOCUMENTATION.md`
- OIP Technical Overview: `/docs/OIP_TECHNICAL_OVERVIEW.md`
- Long Meeting Processing: `/docs/alfred-meeting-notes/LONG_MEETING_ASYNC_PROCESSING.md`
