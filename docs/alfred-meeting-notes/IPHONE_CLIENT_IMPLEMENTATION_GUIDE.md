# Alfred's Notes - iPhone Client Implementation Guide

This document details the technical implementation of the Alfred's Notes Mac Client, intended as a reference for building an equivalent iPhone client.

---

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [API Endpoints](#api-endpoints)
3. [Authentication](#authentication)
4. [Real-Time Voice Recording & Transcription](#real-time-voice-recording--transcription)
5. [Chat with Alfred](#chat-with-alfred)
6. [Voice Visualization (Soundwave Animation)](#voice-visualization-soundwave-animation)
7. [Audio Playback](#audio-playback)
8. [Note Management](#note-management)
9. [LLM Prompts](#llm-prompts)
10. [Data Models](#data-models)
11. [Configuration](#configuration)

---

## Architecture Overview

The client uses a **hybrid architecture**:

```
┌─────────────────┐     ┌─────────────────────┐     ┌─────────────────┐
│  iPhone Client  │────▶│  Voice Processor    │     │  OIP Backend    │
│  (Swift/UIKit)  │     │  (Local Python)     │     │  (alexandria.io)│
└─────────────────┘     └─────────────────────┘     └─────────────────┘
        │                        │                          │
        │  Audio frames (256ms)  │                          │
        │───────────────────────▶│                          │
        │  Partial transcripts   │                          │
        │◀───────────────────────│                          │
        │                                                   │
        │  Notes CRUD, Chat, Auth                           │
        │──────────────────────────────────────────────────▶│
        │  JWT, Note data, Streaming responses              │
        │◀──────────────────────────────────────────────────│
```

### Two Main Services

1. **Voice Processor** (Local, runs on device or Mac)
   - URL: `http://localhost:8765`
   - Purpose: Real-time speech-to-text using MLX Whisper
   - Runs: `python unified_voice_processor.py`

2. **OIP Backend** (Remote)
   - URL: `https://alexandria.io` or `https://api.oip.onl`
   - Purpose: Note storage, LLM chat, authentication, TTS

---

## API Endpoints

### Voice Processor Endpoints (Local)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Check if voice processor is running |
| `/process_frame` | POST | Send audio frame for real-time transcription |
| `/transcribe_file` | POST | Transcribe complete audio file |
| `/session/{session_id}/status` | GET | Get accumulated transcript from session |

#### POST `/process_frame`
```
FormData:
- audio_file: Blob (raw audio, Int16 PCM)
- session_id: String (e.g., "capture_1768011419598")

Response:
{
  "status": "processed",
  "has_speech": true,
  "speech_state": "active" | "speech_end" | "silence",
  "partial_text": "current partial transcription...",
  "final_text": "",  // Only set when speech_state === "speech_end"
  "accumulated_transcript": "full session transcript so far...",
  "stt_confidence": 0.8,
  "processing_time_ms": 45
}
```

#### POST `/transcribe_file`
```
FormData:
- file: Blob (audio file, WebM/WAV/MP3)
- language: "en"
- task: "transcribe"

Response:
{
  "text": "full transcription...",
  "language": "en",
  "duration": 12.5
}
```

### OIP Backend Endpoints (Remote)

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/health` | GET | No | Check backend connectivity |
| `/api/user/login` | POST | No | User authentication |
| `/api/user/register` | POST | No | User registration |
| `/api/notes` | GET | JWT | List all notes |
| `/api/notes/from-audio-hybrid` | POST | JWT | Create note with real-time transcript |
| `/api/notes/from-audio` | POST | JWT | Create note (audio only, backend transcribes) |
| `/api/notes/converse` | POST | JWT | Chat with Alfred (sync, returns audio) |
| `/api/notes/converse-stream-inline` | POST | JWT | Chat with Alfred (streaming SSE) |
| `/api/notes/jobs/{jobId}` | GET | JWT | Poll enhancement job status |
| `/api/records` | GET | JWT | Fetch note details by DID |
| `/api/voice/chat` | POST | JWT | Direct LLM call (for analysis) |

---

## Authentication

### Login
```javascript
POST /api/user/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}

Response:
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",  // JWT token
  "user": { "email": "user@example.com" }
}
```

### Using JWT
All authenticated requests include:
```
Authorization: Bearer <jwt_token>
```

Store token in:
- iOS: Keychain
- Web: localStorage as `alfred_jwt_token`

---

## Real-Time Voice Recording & Transcription

### Flow Overview

```
1. User taps Record
2. Start MediaRecorder (captures WebM for upload)
3. Start ScriptProcessor (sends 256ms frames to voice processor)
4. Voice processor returns partial_text and accumulated_transcript
5. Update live transcript UI
6. User taps Stop
7. Wait for transcript processing to complete (poll until stable)
8. Submit to /api/notes/from-audio-hybrid with:
   - Audio blob (WebM)
   - Real-time transcript
   - Metadata (note_type, participants, etc.)
```

### Audio Capture Settings

```javascript
// MediaStream constraints
{
  audio: {
    channelCount: 1,
    sampleRate: 16000,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  }
}

// ScriptProcessor buffer
bufferSize: 4096  // ~256ms at 16kHz
```

### Streaming Audio Frames

```javascript
// Convert Float32 to Int16 PCM
const int16Data = new Int16Array(inputData.length);
for (let i = 0; i < inputData.length; i++) {
    int16Data[i] = Math.max(-32768, Math.min(32767, 
        Math.floor(inputData[i] * 32768)));
}

// Send to voice processor
const formData = new FormData();
const blob = new Blob([int16Data.buffer], { type: 'audio/raw' });
formData.append('audio_file', blob, 'frame.raw');
formData.append('session_id', sessionId);

const response = await fetch('http://localhost:8765/process_frame', {
    method: 'POST',
    body: formData
});
```

### Handling Voice Processor Response

```javascript
if (result.accumulated_transcript && result.accumulated_transcript.length > 0) {
    // Use accumulated_transcript as the primary source (most reliable)
    if (result.accumulated_transcript.length > liveTranscript.length) {
        liveTranscript = result.accumulated_transcript;
    }
}

// Also track partial_text for UI display
if (result.partial_text) {
    lastPartialText = result.partial_text;
    // Display: liveTranscript + " " + lastPartialText (in italics)
}
```

### Waiting for Processing to Complete

After user stops recording, wait for transcript to stop growing:

```javascript
const maxWaitTime = 120000; // 2 minutes max
const checkInterval = 1000; // Check every 1 second
const stableThreshold = 3000; // Stable if no growth for 3 seconds

let lastLength = 0;
let lastGrowthTime = Date.now();

while (Date.now() - startTime < maxWaitTime) {
    const currentLength = liveTranscript.length;
    
    if (currentLength > lastLength) {
        lastLength = currentLength;
        lastGrowthTime = Date.now();
    }
    
    // Check if stable
    if (currentLength > 50 && (Date.now() - lastGrowthTime) >= stableThreshold) {
        break; // Ready to submit
    }
    
    await sleep(checkInterval);
}
```

### Submitting the Note

```javascript
POST /api/notes/from-audio-hybrid
Content-Type: multipart/form-data
Authorization: Bearer <jwt>

FormData:
- audio: File (WebM blob)
- start_time: ISO string
- end_time: ISO string
- note_type: "MEETING" | "ONE_ON_ONE" | "STANDUP" | "IDEA" | "REFLECTION" | "INTERVIEW"
- device_type: "MAC" | "IPHONE" | "WEB"
- initial_transcript: String (the accumulated transcript)
- initial_transcript_source: "mlx_whisper_realtime"
- model: "grok-2-mini" | "grok-2" | "gpt-4o-mini" | "llama3.2:3b"
- queue_enhanced_transcript: "true" | "false"
- participant_display_names: JSON array (optional)
- participant_roles: JSON array (optional)

Response:
{
  "success": true,
  "noteId": "8bd9e9b072315a65...",
  "did": "did:gun:647f79c2a338:8bd9e9b072315a65...",
  "jobId": "job_1768011424697_b6o8fk7zv"  // For polling enhancement status
}
```

---

## Chat with Alfred

### Two Methods

1. **Sync (with audio response)**: `POST /api/notes/converse`
2. **Streaming SSE**: `POST /api/notes/converse-stream-inline`

### Sync Chat Request

```javascript
POST /api/notes/converse
Content-Type: application/json
Authorization: Bearer <jwt>

{
  "question": "What was discussed in the meeting?",
  "model": "grok-2-mini",
  "conversationHistory": [
    { "role": "user", "content": "previous message" },
    { "role": "assistant", "content": "previous response" }
  ],
  "return_audio": true,
  "engine": "elevenlabs",
  "voice_id": "onwK4e9ZLuTAKqWW03F9",
  "speed": 1,
  // Optional: context from specific note
  "noteDid": "did:gun:647f79c2a338:...",
  // Or search all notes
  "allNotes": true
}

Response:
{
  "success": true,
  "answer": "The meeting covered...",
  "has_audio": true,
  "audio_data": "base64_encoded_mp3...",
  "engine_used": "elevenlabs"
}
```

### Streaming Chat Request

```javascript
POST /api/notes/converse-stream-inline
Content-Type: application/json
Authorization: Bearer <jwt>

{
  "question": "What was discussed?",
  "noteDid": null,
  "allNotes": false,
  "model": "grok-2-mini",
  "voice_mode": true,
  "voice_config": {
    "engine": "elevenlabs",
    "voice_id": "onwK4e9ZLuTAKqWW03F9"
  }
}

Response: Server-Sent Events (SSE) stream
```

### SSE Event Types

```javascript
// Text chunks (streaming response)
{ "type": "textChunk", "text": "partial text", "accumulated": "full so far", "final": false }

// Audio generation starting
{ "type": "audioGenerating" }

// Audio chunk (base64 encoded)
{ "type": "audioChunk", "audio_data": "base64...", "format": "mp3" }

// Stream complete
{ "type": "complete" }

// Error
{ "type": "error", "error": "error message" }
```

### Processing SSE Stream (JavaScript example)

```javascript
const response = await fetch(url, { method: 'POST', headers, body });
const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = '';

while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // Keep incomplete line
    
    for (const line of lines) {
        if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));
            
            switch (data.type) {
                case 'textChunk':
                    updateChatMessage(data.accumulated);
                    break;
                case 'audioGenerating':
                    startSoundwaveVisualization();
                    break;
                case 'audioChunk':
                    playAudioChunk(data.audio_data, data.format);
                    break;
                case 'complete':
                    // Done
                    break;
            }
        }
    }
}
```

---

## Voice Visualization (Soundwave Animation)

The soundwave animation shows 16 bars that react to audio frequency data.

### Setup Audio Analyser

```javascript
const audioContext = new AudioContext();
const analyser = audioContext.createAnalyser();
analyser.fftSize = 64;
analyser.smoothingTimeConstant = 0.8;

// Connect audio source to analyser
const source = audioContext.createMediaElementSource(audioElement);
source.connect(analyser);
analyser.connect(audioContext.destination);
```

### Animation Loop (16 bars, center-weighted)

```javascript
const totalBars = 16;
const bufferLength = analyser.frequencyBinCount;
const dataArray = new Uint8Array(bufferLength);

// Center-weighted frequency mapping
const maxFreqBin = Math.floor(bufferLength * 0.5);
const frequencyMap = [];
const centerBar = (totalBars - 1) / 2;
for (let i = 0; i < totalBars; i++) {
    const distFromCenter = Math.abs(i - centerBar) / centerBar;
    frequencyMap[i] = Math.floor(distFromCenter * maxFreqBin);
}

function animate() {
    analyser.getByteFrequencyData(dataArray);
    
    for (let i = 0; i < totalBars; i++) {
        const dataIndex = frequencyMap[i];
        const value = dataArray[dataIndex];
        const normalizedHeight = value / 255;
        const height = normalizedHeight * canvasHeight * 0.8 + canvasHeight * 0.15;
        
        // Draw bar with gradient (gray tones)
        // Position: center vertically, distribute horizontally
    }
    
    requestAnimationFrame(animate);
}
```

### Visual States

| State | Overlay Opacity | Status Text |
|-------|-----------------|-------------|
| Idle | 0 | "Ready to speak" |
| Speaking | 1 | "Speaking..." |

---

## Audio Playback

### Decoding Base64 Audio

```javascript
function playAudioChunk(base64Data, format = 'mp3') {
    // Decode base64
    const audioBytes = atob(base64Data);
    const audioBuffer = new Uint8Array(audioBytes.length);
    for (let i = 0; i < audioBytes.length; i++) {
        audioBuffer[i] = audioBytes.charCodeAt(i);
    }
    
    // Create blob and URL
    const blob = new Blob([audioBuffer], { type: `audio/${format}` });
    const audioUrl = URL.createObjectURL(blob);
    
    // Play
    const audio = new Audio(audioUrl);
    audio.play();
    
    // Cleanup when done
    audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        // Auto-restart voice input if enabled
        if (autoPlayEnabled) {
            startVoiceInput();
        }
    };
}
```

### TTS Engines & Voices

| Engine | Voice ID | Description |
|--------|----------|-------------|
| elevenlabs | onwK4e9ZLuTAKqWW03F9 | Adam (default) |
| elevenlabs | 21m00Tcm4TlvDq8ikWAM | Rachel |
| kokoro | af_heart | Heart |
| kokoro | bf_emma | Emma |

---

## Note Management

### Listing Notes

```javascript
GET /api/notes?limit=50
Authorization: Bearer <jwt>

Response:
{
  "notes": [
    {
      "did": "did:gun:647f79c2a338:...",
      "data": {
        "basic": {
          "name": "Meeting Notes",
          "date": 1768011419,
          "description": "Discussion about..."
        },
        "notes": {
          "note_type": "MEETING",
          "transcription_status": "complete",
          "summary_key_points": ["point 1", "point 2"],
          "summary_action_item_texts": ["action 1"],
          "summary_open_questions": ["question 1"],
          "topics_auto": ["topic1", "topic2"],
          "keywords_auto": ["keyword1", "keyword2"]
        }
      }
    }
  ]
}
```

### Fetching Note Details

```javascript
GET /api/records?source=gun&did=<note_did>
Authorization: Bearer <jwt>
```

### Refresh from Backend

```javascript
GET /api/records?recordType=notes&source=gun&sortBy=date:desc
Authorization: Bearer <jwt>
```

---

## LLM Prompts

### Fill Missing Analysis Prompt

Used when a note is missing summary/action items/etc:

```
Analyze this transcript and provide the following missing fields as a JSON object.

TRANSCRIPT:
${transcriptText}

${participantsFormatted ? `PARTICIPANTS: ${participantsFormatted}` : ''}

MISSING FIELDS TO FILL: summary_key_points, summary_decisions, summary_action_item_texts, summary_action_item_assignees, summary_open_questions, topics_auto, keywords_auto

Provide a JSON object with ONLY these fields:
- summary_key_points: array of key discussion points (3-7 items)
- summary_decisions: array of decisions made (if any)
- summary_action_item_texts: array of action items identified
- summary_action_item_assignees: array of assignees (parallel to action_item_texts, use "unassigned" if unclear)
- summary_open_questions: array of unresolved questions
- topics_auto: array of topics discussed (3-5 items)
- keywords_auto: array of keywords (5-10 items)

Return ONLY the JSON object, nothing else:
```

### LLM API Call for Analysis

```javascript
POST /api/voice/chat
Content-Type: application/json
Authorization: Bearer <jwt>

{
  "text": "<prompt>",
  "processing_mode": "llm-grok-2-mini",  // or "llm-gpt-4o-mini", "llm-llama3.2:3b"
  "return_audio": false
}

Response:
{
  "success": true,
  "response_text": "{ JSON response }"
}
```

---

## Data Models

### Note Types
```
MEETING | ONE_ON_ONE | STANDUP | IDEA | REFLECTION | INTERVIEW
```

### Note Data Structure
```typescript
interface Note {
  did: string;
  data: {
    basic: {
      name: string;
      date: number; // Unix timestamp
      description: string;
    };
    notes: {
      note_type: string;
      transcription_status: "initial" | "enhancing" | "complete" | "failed";
      transcript_full_text: string; // DID reference to transcript
      duration_seconds: number;
      summary_key_points: string[];
      summary_decisions: string[];
      summary_action_item_texts: string[];
      summary_action_item_assignees: string[];
      summary_open_questions: string[];
      topics_auto: string[];
      keywords_auto: string[];
      participant_display_names: string[];
      participant_roles: string[];
    };
  };
}
```

### Enhancement Job Status
```typescript
interface JobStatus {
  status: "pending" | "transcribing_enhanced" | "summarizing" | "complete" | "failed";
  progress: number; // 0-100
  message: string;
}
```

---

## Configuration

### Required Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Backend URL | https://api.oip.onl | OIP backend server |
| Voice Processor URL | http://localhost:8765 | Local voice processor |
| LLM Model | grok-2-mini | Default model for summarization |
| TTS Engine | elevenlabs | Text-to-speech engine |
| Voice ID | onwK4e9ZLuTAKqWW03F9 | ElevenLabs voice |

### Local Storage Keys

```javascript
localStorage.setItem('backend_url', 'https://alexandria.io');
localStorage.setItem('voice_processor_url', 'http://localhost:8765');
localStorage.setItem('alfred_jwt_token', '<jwt>');
localStorage.setItem('alfred_user_email', 'user@example.com');
```

---

## iOS-Specific Considerations

### Audio Session

```swift
// Configure for recording
let audioSession = AVAudioSession.sharedInstance()
try audioSession.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
try audioSession.setActive(true)
```

### Microphone Permission

```xml
<!-- Info.plist -->
<key>NSMicrophoneUsageDescription</key>
<string>Alfred needs microphone access to record your meetings and voice commands.</string>
```

### Background Audio

If you want recording to continue in background:
```xml
<key>UIBackgroundModes</key>
<array>
    <string>audio</string>
</array>
```

### Voice Processor on iOS

Options:
1. Run on-device using CoreML + Whisper (heavy, requires model conversion)
2. Connect to Mac running voice processor over local network
3. Use cloud-based STT (e.g., OpenAI Whisper API, Google Speech-to-Text)

For best real-time performance, recommend option 2 (Mac as voice processor) or option 3 (cloud STT).

---

## Notes Caching (Browser/Local Storage)

Notes are cached locally for instant display and offline access.

### Storage Keys

| Key | Purpose |
|-----|---------|
| `alfred_notes_cache` | JSON array of cached notes (max 200) |
| `alfred_notes_cache_time` | Timestamp of last cache update |

### Save Notes to Storage

```javascript
function saveNotesToStorage(notes) {
    const notesToSave = notes.slice(0, 200); // Limit to avoid storage issues
    localStorage.setItem('alfred_notes_cache', JSON.stringify(notesToSave));
    localStorage.setItem('alfred_notes_cache_time', Date.now().toString());
}
```

### Load Notes from Storage

```javascript
function loadNotesFromStorage() {
    const cached = localStorage.getItem('alfred_notes_cache');
    if (cached) {
        return JSON.parse(cached);
    }
    return [];
}
```

### Merge Notes (Dedupe by DID)

```javascript
function mergeNotes(existingNotes, newNotes) {
    const didSet = new Set(existingNotes.map(n => n.oip?.did || n.did).filter(Boolean));
    const merged = [...existingNotes];
    
    for (const note of newNotes) {
        const noteDid = note.oip?.did || note.did;
        if (noteDid && !didSet.has(noteDid)) {
            merged.push(note);
            didSet.add(noteDid);
        }
    }
    
    // Sort by date descending
    merged.sort((a, b) => {
        const dateA = a.data?.basic?.date || 0;
        const dateB = b.data?.basic?.date || 0;
        return dateB - dateA;
    });
    
    return merged;
}
```

### Load Flow

```
1. Load notes from local storage (instant display)
2. Fetch notes from backend
3. Merge backend notes with cached notes
4. Save merged notes back to storage
5. Re-render the list
```

### Clear on Logout

When user logs out, clear the notes cache:
```javascript
localStorage.removeItem('alfred_notes_cache');
localStorage.removeItem('alfred_notes_cache_time');
```

### iOS Implementation

For iOS, use `UserDefaults` or Core Data:

```swift
// UserDefaults (simple)
let encoder = JSONEncoder()
if let data = try? encoder.encode(notes) {
    UserDefaults.standard.set(data, forKey: "alfred_notes_cache")
}

// Load
if let data = UserDefaults.standard.data(forKey: "alfred_notes_cache"),
   let notes = try? JSONDecoder().decode([Note].self, from: data) {
    // Use cached notes
}
```

For larger datasets, consider Core Data or SQLite for better performance.

---

## Summary: Minimum Viable Implementation

1. **Authentication**: Login/register → store JWT in Keychain
2. **Note List**: Load from cache first, then fetch from `/api/notes`, merge & save
3. **Recording**: Capture audio, send to voice processor, display live transcript
4. **Save Note**: Submit to `/api/notes/from-audio-hybrid`, update cache
5. **Chat**: Send messages to `/api/notes/converse`, play audio response
6. **Visualization**: 16-bar frequency visualizer during playback
7. **Offline**: Display cached notes when backend unavailable

The voice processor (whisper-tiny for real-time, whisper-large for final) is the key component that enables near real-time transcription on Apple Silicon.
