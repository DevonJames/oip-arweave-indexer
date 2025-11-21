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

## API Endpoint

### POST `/api/notes/from-audio`

Upload an audio recording and create a complete note with AI processing.

**Base URL:** `https://api.oip.onl/api/notes/from-audio`

**Content-Type:** `multipart/form-data`

---

## Request Parameters

### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `audio` | File | Audio file (formats: .m4a, .wav, .mp3, .webm, .ogg) |
| `start_time` | String (ISO 8601) | Recording start timestamp (e.g., "2025-11-20T10:00:00Z") |
| `end_time` | String (ISO 8601) | Recording end timestamp |
| `note_type` | String | Type of note: "meeting", "lecture", "interview", "voice_memo", "other" |
| `device_type` | String | Device used: "mobile", "web", "desktop" |

### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `title` | String | Auto-generated | Custom title for the note |
| `model` | String | `llama3.2:3b` | LLM model for summarization (see options below) |
| `addToWebServer` | Boolean | `false` | Upload audio to web server for HTTP access |
| `addToBitTorrent` | Boolean | `false` | Seed audio via BitTorrent |
| `addToIPFS` | Boolean | `false` | Upload audio to IPFS |
| `addToArweave` | Boolean | `false` | Upload audio to Arweave (permanent storage) |
| `participant_names` | String (CSV) | `[]` | Comma-separated participant names (e.g., "John Smith,Jane Doe") |
| `participant_roles` | String (CSV) | `[]` | Comma-separated roles (e.g., "CEO,CTO") - same order as names |
| `calendar_event_id` | String | `null` | Calendar event ID if linked |
| `calendar_start_time` | String (ISO 8601) | `null` | Calendar event start time |
| `calendar_end_time` | String (ISO 8601) | `null` | Calendar event end time |
| `capture_location` | String | `null` | Location where recorded |
| `chunking_strategy` | String | `BY_TIME_30S` | Chunking strategy: "BY_TIME_15S", "BY_TIME_30S", "BY_TIME_60S", "BY_SENTENCE", "BY_PARAGRAPH", "BY_SPEAKER" |

### Available LLM Models

- `llama3.2:3b` - Fast, good quality (default)
- `llama3.2:1b` - Fastest, lower quality
- `llama3.1:8b` - Slower, best quality
- `gemma2:2b` - Alternative lightweight model
- `parallel` - Race multiple models, use fastest response

---

## JavaScript Example Request

```javascript
// Using Fetch API
async function uploadMeetingNote(audioFile, jwtToken) {
  const formData = new FormData();
  
  // Required fields
  formData.append('audio', audioFile);
  formData.append('start_time', '2025-11-20T10:00:00Z');
  formData.append('end_time', '2025-11-20T11:30:00Z');
  formData.append('note_type', 'meeting');
  formData.append('device_type', 'mobile');
  
  // Optional fields
  formData.append('model', 'llama3.2:3b');
  formData.append('addToWebServer', 'true');
  formData.append('addToBitTorrent', 'false');
  formData.append('addToIPFS', 'false');
  formData.append('participant_names', 'John Smith,Jane Doe,Bob Wilson');
  formData.append('participant_roles', 'Product Manager,Lead Engineer,Designer');
  
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
      "note_type": "meeting",
      "created_at": 1732104000000,
      "ended_at": 1732109400000,
      "device_type": "mobile",
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
    formData.append('note_type', options.noteType || 'meeting');
    formData.append('device_type', options.deviceType || 'mobile');
    
    // Optional
    if (options.model) formData.append('model', options.model);
    if (options.addToWebServer) formData.append('addToWebServer', 'true');
    if (options.participantNames) formData.append('participant_names', options.participantNames);
    if (options.participantRoles) formData.append('participant_roles', options.participantRoles);
    
    const response = await fetch(`${this.baseUrl}/api/notes/from-audio`, {
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
}

// Usage
const client = new AlfredNotesClient('your-jwt-token');

// Upload audio
const uploadResult = await client.uploadAudioNote(audioFile, {
  startTime: '2025-11-20T10:00:00Z',
  endTime: '2025-11-20T11:30:00Z',
  noteType: 'meeting',
  deviceType: 'mobile',
  model: 'llama3.2:3b',
  addToWebServer: true,
  participantNames: 'John Smith,Jane Doe',
  participantRoles: 'PM,Engineer'
});

// Get complete note with transcript and chunks
const completeNote = await client.getCompleteNote(uploadResult.noteDid);

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

## Notes

1. **Processing Time:** Audio processing typically takes 10-30 seconds depending on audio length and LLM model selected
2. **File Size Limits:** Maximum audio file size is 50MB
3. **Supported Formats:** .m4a, .wav, .mp3, .webm, .ogg, .flac
4. **Rate Limiting:** No specific rate limits currently, but avoid excessive concurrent uploads
5. **Privacy:** All notes are private by default (`access_level: "private"`) and only accessible by the owner
6. **DIDs:** All records use Decentralized Identifiers (DIDs) in the format `did:gun:{pubkey_prefix}:{localId}`
7. **Tags:** All tags (note and chunk tags) are AI-generated based on content analysis

---

## Support

For questions or issues, contact the backend team or refer to:
- Main API Documentation: `/docs/API_RECORDS_ENDPOINT_DOCUMENTATION.md`
- OIP Technical Overview: `/docs/OIP_TECHNICAL_OVERVIEW.md`

