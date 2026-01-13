# Alfred's Notes Mac Client - Technical Documentation

**Date:** January 10, 2026  
**File:** `mac-client/alfreds-notes-mac.html`

This document describes the implementation details of key features in the Alfred's Notes Mac client, including endpoints, request composition, and response handling.

---

## Table of Contents

1. [Live Transcription While Recording](#1-live-transcription-while-recording)
2. [Adding Meeting Participants](#2-adding-meeting-participants)
3. [Upload Audio](#3-upload-audio)
4. [Refresh Notes](#4-refresh-notes)
5. [Fill Missing Analysis](#5-fill-missing-analysis)
6. [Re-Analyze (Overwrite)](#6-re-analyze-overwrite)
7. [Changing a Note's Name](#7-changing-a-notes-name)
8. [Chat with Alfred about a Specific Note](#8-chat-with-alfred-about-a-specific-note)
9. [Chat with Alfred about All Notes](#9-chat-with-alfred-about-all-notes)
10. [Note Layout and Fields](#10-note-layout-and-fields)

---

## 1. Live Transcription While Recording

### Description
Real-time speech-to-text transcription using a local MLX Whisper voice processor running on Mac's M-series hardware.

### Endpoint
```
POST ${config.voiceProcessorUrl}/process_frame
GET  ${config.voiceProcessorUrl}/session/{sessionId}
```

### Flow

1. **Start Recording** - Initializes recording state and creates a voice processor session
2. **Audio Streaming** - Audio chunks are sent every 200ms via `process_frame` endpoint
3. **Live Updates** - The response includes:
   - `accumulated_transcript` - Full accumulated text so far
   - `partial_text` - Current partial speech segment (not yet finalized)
   - `final_text` - Completed speech segments
4. **Display** - Transcript shown in `#liveTranscript` element with partial text in italics

### Request Composition
```javascript
const formData = new FormData();
formData.append('audio', audioChunk, 'chunk.webm');  // 200ms audio chunk
formData.append('session_id', sessionId);
```

### Response Handling
```javascript
// Response from /process_frame
{
    accumulated_transcript: "Full text so far...",  // Use this to update UI
    partial_text: "current partial...",              // Show in italics
    final_text: "finalized segment",                 // Added to accumulated
    is_speech: true/false                            // Voice activity detection
}

// State updates
if (result.accumulated_transcript.length > this.state.liveTranscript.length) {
    this.state.liveTranscript = result.accumulated_transcript;
}
```

### UI Display
- Container: `<div class="live-transcript" id="liveTranscript">`
- Shows accumulated transcript with optional partial text in italics
- Scrolls automatically to show latest content

---

## 2. Adding Meeting Participants

### Description
Users can add participant names and roles before or during recording. This data is included when the note is submitted.

### State Management
```javascript
state: {
    participants: [],  // Array of { id, name, role }
}
```

### Functions

| Function | Purpose |
|----------|---------|
| `addParticipant()` | Adds new participant entry with unique ID |
| `removeParticipant(id)` | Removes participant by ID |
| `updateParticipant(id, field, value)` | Updates name or role for participant |
| `renderParticipants()` | Renders participant list in UI |
| `getParticipantsData()` | Returns `{ names: [], roles: [] }` for submission |
| `clearParticipants()` | Clears all participants (called after note creation) |

### UI Structure
```html
<div class="participants-section" id="participantsSection">
    <div class="template-title">Participants (Optional)</div>
    <div id="participantsList">
        <!-- Dynamically rendered participant entries -->
    </div>
    <button class="add-participant-btn" onclick="alfredNotesApp.addParticipant()">
        + Add Participant
    </button>
</div>
```

### Data Submission
Participants are appended to FormData when submitting notes:
```javascript
const { names, roles } = this.getParticipantsData();
if (names.length > 0) {
    formData.append('participant_display_names', JSON.stringify(names));
}
if (roles.length > 0) {
    formData.append('participant_roles', JSON.stringify(roles));
}
```

---

## 3. Upload Audio

### Description
Upload pre-recorded audio files for transcription and analysis.

### Endpoints

| Mode | Endpoint |
|------|----------|
| Short (<60 min) | `POST ${config.backendUrl}/api/notes/from-audio` |
| Long (60+ min) | `POST ${config.backendUrl}/api/notes/from-audio-async` |

### Request Composition
```javascript
const formData = new FormData();
formData.append('audio', this.state.selectedAudioFile);
formData.append('start_time', new Date(startTime).toISOString());
formData.append('end_time', new Date(endTime).toISOString());
formData.append('note_type', this.state.selectedNoteType);       // MEETING, ONE_ON_ONE, etc.
formData.append('device_type', deviceType);                       // MAC, IPHONE, etc.
formData.append('model', aiModel);                                // e.g., grok-4-fast-reasoning
formData.append('addToWebServer', addToWebServer ? 'true' : 'false');
formData.append('queue_enhanced_transcript', queueEnhanced ? 'true' : 'false');

// Optional participants
if (participantNames.trim()) {
    formData.append('participant_display_names', JSON.stringify([...]));
}
if (participantRoles.trim()) {
    formData.append('participant_roles', JSON.stringify([...]));
}
```

### Response Handling
```javascript
// Sync endpoint response
{
    success: true,
    noteHash: "abc123...",
    noteDid: "did:gun:..."
}

// Async endpoint response (long meetings)
{
    success: true,
    jobId: "job_123...",  // Used for polling progress
    message: "Job queued"
}

// On success:
this.clearAudioFile();
this.switchCaptureMode('record');
this.loadNotes();
```

### Supported Formats
MP3, M4A, WAV, WebM, FLAC, OGG

---

## 4. Refresh Notes

### Description
Fetches notes from GUN storage on the backend and merges with locally cached notes.

### Endpoint
```
GET ${config.backendUrl}/api/records?recordType=notes&source=gun&sortBy=date:desc
```

### Request
```javascript
const response = await fetch(endpoint, {
    headers: {
        'Authorization': `Bearer ${this.config.token}`
    }
});
```

### Response Handling
```javascript
const data = await response.json();
// data.records contains array of note objects

// Merge logic:
const existingDids = new Set(this.state.notes.map(note => note.oip?.did || note.did));
const newNotes = data.records.filter(note => {
    const noteDid = note.oip?.did || note.did;
    return noteDid && !existingDids.has(noteDid);
});

// Add new notes and re-render
this.state.notes = [...newNotes, ...this.state.notes];
this.renderNotesList();
this.saveNotesToStorage();  // Cache in localStorage
```

### Two Loading Functions

| Function | Purpose |
|----------|---------|
| `loadNotes()` | Uses `GET /api/notes?limit=50` (faster, cached) |
| `refreshNotesFromBackend()` | Uses `GET /api/records?...&source=gun` (authoritative, slower) |

---

## 5. Fill Missing Analysis

### Description
Uses LLM (grok-4-fast-reasoning) to fill in empty analysis fields for a note, then persists changes to GUN.

### Endpoints

| Step | Endpoint |
|------|----------|
| 1. Fetch Transcript | `GET ${config.backendUrl}/api/records?recordType=text&source=gun&did=${transcriptDid}` |
| 2. LLM Analysis | `POST ${config.backendUrl}/api/alfred/generate` |
| 3. Save Updated Note | `POST ${config.backendUrl}/api/records/newRecord?recordType=notes&storage=gun&localId=${localId}` |

### Request to `/api/alfred/generate`
```javascript
{
    prompt: "Analyze this transcript...\n\nTRANSCRIPT:\n${transcriptText}\n...",
    model: 'grok-4-fast-reasoning',
    json_schema: {
        name: "transcript_analysis",
        schema: {
            type: "object",
            properties: {
                summary_key_points: { type: "array", items: { type: "string" } },
                summary_decisions: { type: "array", items: { type: "string" } },
                summary_action_item_texts: { type: "array", items: { type: "string" } },
                summary_action_item_assignees: { type: "array", items: { type: "string" } },
                summary_open_questions: { type: "array", items: { type: "string" } },
                topics_auto: { type: "array", items: { type: "string" } },
                keywords_auto: { type: "array", items: { type: "string" } }
            },
            required: ["summary_key_points", "topics_auto", "keywords_auto"]
        }
    },
    temperature: 0.3,
    max_tokens: 14000
}
```

### Fields Checked (Only fills if empty)
- `summary_key_points`
- `summary_decisions`
- `summary_action_item_texts`
- `summary_action_item_assignees`
- `summary_open_questions`
- `topics_auto`
- `keywords_auto`

### GUN Save Pattern
Uses `localId` (extracted from DID) to update existing record rather than creating duplicate:
```javascript
const noteDid = this.state.currentNote.oip?.did || this.state.currentNote.did;
const localId = noteDid.split(':').pop();  // e.g., "2c6fa7ebe009d9b8..."

// POST to /api/records/newRecord?recordType=notes&storage=gun&localId=${localId}
```

---

## 6. Re-Analyze (Overwrite)

### Description
Similar to Fill Missing Analysis, but **overwrites ALL analysis fields** regardless of current content. Includes confirmation prompt.

### Endpoint
Same as Fill Missing Analysis:
```
POST ${config.backendUrl}/api/alfred/generate
POST ${config.backendUrl}/api/records/newRecord?recordType=notes&storage=gun&localId=${localId}
```

### Key Differences from Fill Missing

| Aspect | Fill Missing | Re-Analyze |
|--------|--------------|------------|
| Fields affected | Only empty fields | All analysis fields |
| Confirmation | No | Yes (confirm dialog) |
| Includes sentiment | No | Yes (`sentiment_overall`) |
| Includes due dates | No | Yes (`summary_action_item_due_texts`) |

### Extended JSON Schema
```javascript
{
    name: "transcript_full_analysis",
    schema: {
        type: "object",
        properties: {
            // ... all fields from Fill Missing, plus:
            summary_action_item_due_texts: { type: "array", items: { type: "string" } },
            sentiment_overall: { type: "string", enum: ["positive", "negative", "neutral", "mixed"] }
        },
        required: ["summary_key_points", "topics_auto", "keywords_auto", "sentiment_overall"]
    }
}
```

---

## 7. Changing a Note's Name

### Description
Editable title input that persists changes to GUN on blur.

### Endpoint
```
POST ${config.backendUrl}/api/records/newRecord?recordType=notes&storage=gun&localId=${localId}
```

### UI Element
```html
<input type="text" 
       class="note-title-input" 
       id="noteDetailTitle"
       onblur="alfredNotesApp.saveNoteName()" 
       onkeydown="if(event.key === 'Enter') this.blur()" />
```

### Request Composition
```javascript
const noteUpdate = {
    basic: {
        ...this.state.currentNote.data.basic,
        name: newName,
        date: Math.floor(Date.now() / 1000)  // Update timestamp
    },
    notes: {
        ...this.state.currentNote.data.notes,
        last_modified: new Date().toISOString()
    }
};

// Preserve audio and accessControl if present
if (this.state.currentNote.data.audio) {
    noteUpdate.audio = this.state.currentNote.data.audio;
}
```

### Change Detection
```javascript
// Only save if name actually changed
if (!newName || newName === this.state.originalNoteName) {
    return;
}
```

---

## 8. Chat with Alfred about a Specific Note

### Description
Opens chat view with context set to a specific note. Uses note-specific RAG.

### Setup Function
```javascript
chatAboutNote() {
    const noteDid = this.state.currentNote.oip?.did || this.state.currentNote.did;
    const noteTitle = this.state.currentNote.data?.basic?.name || 'Untitled Note';
    
    this.setNoteContext(noteDid, noteTitle);  // Sets selectedNoteDid
    this.showView('chat');
    this.setChatMode('noteSpecific');
}
```

### Endpoints

| Mode | Endpoint |
|------|----------|
| Sync (text) | `POST ${config.backendUrl}/api/notes/converse` |
| Streaming (voice) | `POST ${config.backendUrl}/api/notes/converse-stream-inline` |

### Request Composition
```javascript
{
    question: message,
    model: "grok-4-fast-reasoning",
    noteDid: this.state.selectedNoteDid,    // Key for note-specific RAG
    conversationHistory: [...last10Messages],
    
    // For voice mode:
    return_audio: true,
    engine: "elevenlabs",
    voice_id: "onwK4e9ZLuTAKqWW03F9",
    speed: 1
}
```

### Backend RAG Processing
When `noteDid` is provided:
1. Fetches note with `resolveDepth=1` to embed transcript and chunks
2. Builds context string with title, date, type, participants, key points, decisions, actions, and full transcript
3. Passes context to LLM via `existingContext` parameter

---

## 9. Chat with Alfred about All Notes

### Description
Searches across all user notes using grok-4-fast-reasoning's 2M token context window.

### Setup
```javascript
this.setChatMode('allNotes');
```

### Request Composition
```javascript
{
    question: message,
    model: "grok-4-fast-reasoning",
    allNotes: true,  // Key flag for all-notes RAG
    conversationHistory: [...last10Messages],
    
    // Voice config if enabled
    return_audio: true,
    engine: "elevenlabs",
    voice_id: "onwK4e9ZLuTAKqWW03F9"
}
```

### Backend Processing
When `allNotes: true`:
1. Fetches ALL user notes with `resolveDepth=1` and `resolveFieldName=notes.transcript_full_text`
2. Builds comprehensive context string from all notes
3. Includes for each note: title, date, type, participants, key points, decisions, actions, transcript
4. Sends entire context to grok-4-fast-reasoning (utilizes 2M token context)

---

## 10. Note Layout and Fields

### Data Structure
```javascript
{
    oip: { did: "did:gun:..." },
    data: {
        basic: {
            name: "Meeting Title",
            description: "Description text",
            date: 1736456400  // Unix timestamp in seconds
        },
        notes: {
            note_type: "MEETING",           // MEETING, ONE_ON_ONE, STANDUP, IDEA, REFLECTION, INTERVIEW
            device_type: "MAC",             // MAC, IPHONE, WATCH, OTHER
            transcription_status: "enhanced", // initial, enhanced
            created_at: "2026-01-09T16:30:00.000Z",
            ended_at: "2026-01-09T17:30:00.000Z",
            last_modified: "2026-01-10T10:00:00.000Z",
            
            // Transcript
            transcript_full_text: "did:gun:...:transcript",  // DID reference
            
            // Participants
            participant_display_names: ["John Doe", "Jane Smith"],
            participant_roles: ["CEO", "CTO"],
            
            // Analysis (filled by LLM)
            summary_key_points: ["Point 1", "Point 2"],
            summary_decisions: ["Decision 1"],
            summary_action_item_texts: ["Action 1", "Action 2"],
            summary_action_item_assignees: ["John", "Jane"],
            summary_action_item_due_texts: ["Friday", "Next week"],
            summary_open_questions: ["Question 1"],
            topics_auto: ["Topic A", "Topic B"],
            keywords_auto: ["keyword1", "keyword2"],
            sentiment_overall: "positive"  // positive, negative, neutral, mixed
        },
        audio: {
            durationSec: 3600  // Duration in seconds
        },
        accessControl: {
            last_modified_timestamp: 1736456400
        }
    }
}
```

### UI Layout (4-Quadrant Grid)

```
┌──────────────────────────────────────────────────────────────────┐
│  [Title Input - Editable]                                        │
│  📅 Date at Time  ⏱️ Duration  📄 Type  💻 Device  ✓ Status  😊  │
├──────────────────────────────────────────────────────────────────┤
│  Participants: [John (CEO)] [Jane (CTO)]                         │
├────────────────────────────────────┬─────────────────────────────┤
│  KEY SUMMARY (70%)                 │  DECISIONS MADE (30%)       │
│  • Key point 1                     │  • Decision 1               │
│  • Key point 2                     │  • Decision 2               │
│  • Key point 3                     │                             │
├────────────────────────────────────┼─────────────────────────────┤
│  ACTION ITEMS (50%)                │  OPEN QUESTIONS (50%)       │
│  • Action 1 👤 John 📅 Friday     │  • Question 1               │
│  • Action 2 👤 Jane               │  • Question 2               │
├────────────────────────────────────┴─────────────────────────────┤
│  Topics & Keywords                                               │
│  [Topic A] [Topic B] [keyword1] [keyword2]                       │
├──────────────────────────────────────────────────────────────────┤
│  ▶ Transcript (click to expand)                    (1,234 words) │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Full transcript text appears here when expanded...         │  │
│  │ Lazy-loaded from GUN storage.                              │  │
│  └────────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────┤
│  [Fill Missing Analysis] [Re-Analyze (Overwrite)]                │
│  [💬 Chat with Alfred about this note]                           │
└──────────────────────────────────────────────────────────────────┘
```

### Fields Displayed

| Section | Fields |
|---------|--------|
| **Header** | Title (editable), Date/Time, Duration, Note Type, Device Type, Transcription Status, Sentiment |
| **Participants** | Names with roles in chips |
| **Key Summary** | `summary_key_points` as bullet list |
| **Decisions Made** | `summary_decisions` as bullet list |
| **Action Items** | `summary_action_item_texts` with assignees and due dates |
| **Open Questions** | `summary_open_questions` as bullet list |
| **Topics & Keywords** | `topics_auto` (cyan) and `keywords_auto` (gray) as chips |
| **Transcript** | Collapsible, lazy-loaded from `transcript_full_text` DID |

### Duration Calculation Priority
1. `audio.durationSec` (most accurate)
2. `notes.created_at` / `notes.ended_at`
3. `notes.start_time` / `notes.end_time` (legacy)

---

## Configuration

### Config Object
```javascript
config: {
    backendUrl: 'https://alexandria.io',      // Main API endpoint
    voiceProcessorUrl: 'http://localhost:8765', // Local MLX Whisper
    token: localStorage.getItem('alfred_jwt_token')
}
```

### State Management
All UI state is managed in the `alfredNotesApp.state` object, including:
- `notes[]` - Cached notes list
- `currentNote` - Currently viewed note
- `participants[]` - Participants being added to a recording
- `liveTranscript` - Real-time transcription text
- `conversationHistory[]` - Chat history for context
- `chatMode` - 'general' | 'noteSpecific' | 'allNotes'
- `selectedNoteDid` - DID of note for note-specific chat

### Authentication
All API requests include JWT token:
```javascript
headers: {
    'Authorization': `Bearer ${this.config.token}`,
    'Content-Type': 'application/json'
}
```
