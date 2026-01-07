# Alfred's Notes + Mac Client Integration Plan

## Executive Summary

This document outlines the plan to integrate Alfred's Notes meeting capture and RAG chat functionality into the Mac Client, leveraging the mac-client's superior real-time voice processing capabilities (MLX Whisper, interruption support, streaming TTS) while retaining all of Alfred's Notes' features.

## Current Architecture

### Mac Client (`mac-client/`)
- **Real-time STT**: MLX Whisper running natively on Apple Silicon (10-20x real-time)
- **Voice Activity Detection**: Silero VAD with preprocessing
- **Smart Turn Detection**: Intelligent conversation endpoint detection
- **Interruption Support**: User can interrupt Alfred mid-speech
- **Streaming TTS**: Chunked audio playback with real-time waveform visualization
- **Session Management**: Full conversation history persistence
- **Output Modes**: Spoken (TTS) or On-Screen (Spritz display)

### Alfred Avatar Visualization (`public/alfreds-notes.html`)
- **Visual Feedback**: Alfred robot avatar (`alfred.png`) displayed during conversations
- **Real-time Waveform**: Audio waveform visualization overlaid on Alfred's "mouth" area
- **Web Audio API**: Uses AnalyserNode for frequency data extraction
- **Center-weighted Bars**: 16-bar visualization with bass frequencies in center, higher frequencies at edges
- **Speaking State**: Visual status indicator ("Speaking..." / "Ready to speak")
- **Collapsible Panel**: Visualization panel can be collapsed to a glowing orb indicator

> **📄 See also**: [ALFRED_WAVEFORM_VISUALIZATION.md](./ALFRED_WAVEFORM_VISUALIZATION.md) for detailed technical documentation of the waveform implementation.

### Alfred's Notes (`public/alfreds-notes.html`)
- **Meeting Recording**: Template-based meeting capture
- **Audio Upload**: Support for pre-recorded files
- **Long Meeting Support**: Async processing for 60+ minute recordings
- **Note Library**: Browse and search all notes
- **Note Detail View**: Summary, action items, open questions
- **Chat Modes**: Direct LLM / All Notes Search / Selected Note RAG
- **Job Polling**: Progress tracking for async jobs

## End State Goals

1. **Dual Transcription Pipeline**
   - Real-time local transcription using mac-client's MLX Whisper during recording
   - High-accuracy backend transcription from full recording (post-meeting)

2. **Immediate Note Creation**
   - Generate first iteration of meeting note immediately after recording ends
   - Use real-time transcript for instant summary generation
   - Send both transcript AND audio to backend

3. **Background Enhancement**
   - Backend generates summary from initial transcript (fast)
   - Backend also processes full audio for more accurate transcript (slow)
   - Note automatically updates when better transcript is available

4. **High-Quality Voice Chat**
   - Use mac-client's voice infrastructure for chatting about notes
   - Full interruption support during Alfred's responses
   - Real-time waveform visualization during conversation

---

## Integration Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        MAC CLIENT (INTEGRATED)                                │
│                                                                               │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐   │
│  │   MEETING CAPTURE   │  │   NOTE LIBRARY      │  │   VOICE CHAT        │   │
│  │   - Record button   │  │   - Note list       │  │   - RAG/LLM toggle  │   │
│  │   - Template select │  │   - Search/filter   │  │   - Interruption    │   │
│  │   - Participants    │  │   - Detail view     │  │   - Stream TTS      │   │
│  │   - Real-time STT   │  │                     │  │   - Alfred avatar   │   │
│  │                     │  │                     │  │   - Mouth waveform  │   │
│  └─────────┬───────────┘  └─────────┬───────────┘  └─────────┬───────────┘   │
│            │                        │                         │               │
│            ▼                        ▼                         ▼               │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                    UNIFIED VOICE PROCESSOR                               │ │
│  │    MLX Whisper STT  │  Silero VAD  │  Smart Turn  │  Audio Analysis     │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                           OIP BACKEND                                         │
│                                                                               │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐   │
│  │  /api/notes/        │  │  /api/notes/        │  │  /api/notes/        │   │
│  │  from-audio-hybrid  │  │  converse           │  │  jobs/:id           │   │
│  │  NEW ENDPOINT       │  │  (UPDATED)          │  │  (existing)         │   │
│  │  - Accept audio     │  │  - Support voice    │  │  - Job status       │   │
│  │  - Accept transcript│  │  - Return streaming │  │  - Progress         │   │
│  │  - Immediate summary│  │  - Audio chunks     │  │                     │   │
│  │  - Queue background │  │                     │  │                     │   │
│  │    STT job          │  │                     │  │                     │   │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘   │
│                                                                               │
│  ┌─────────────────────┐  ┌─────────────────────┐                            │
│  │  Background Worker  │  │  TTS Service        │                            │
│  │  - High-accuracy    │  │  - ElevenLabs       │                            │
│  │    transcription    │  │  - Kokoro fallback  │                            │
│  │  - Update note      │  │  - Streaming chunks │                            │
│  └─────────────────────┘  └─────────────────────┘                            │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Backend API Updates

### 1.1 New Endpoint: `POST /api/notes/from-audio-hybrid`

This new endpoint accepts both audio and an initial transcript for hybrid processing.

**Request Parameters:**
```javascript
{
  // REQUIRED
  audio: File,              // Audio recording
  start_time: ISO8601,
  end_time: ISO8601,
  note_type: 'MEETING' | 'ONE_ON_ONE' | 'STANDUP' | ...,
  device_type: 'MAC' | ...,
  
  // NEW: Initial real-time transcript
  initial_transcript: String,        // From mac-client real-time STT
  initial_transcript_source: 'mlx_whisper_realtime',
  initial_transcript_language: 'en',
  
  // OPTIONAL
  participant_display_names: JSON,
  participant_roles: JSON,
  model: 'parallel' | 'gpt-4o-mini' | ...,
  chunking_strategy: 'BY_TIME_30S',
  
  // Processing flags
  skip_backend_stt: Boolean,        // If true, use only initial transcript
  queue_enhanced_transcript: Boolean // Default true - queue background job for better transcript
}
```

**Processing Flow:**
1. **Immediate Response Path (< 10 seconds):**
   - Use `initial_transcript` to generate summary immediately
   - Create note record with `transcription_status: 'INITIAL'`
   - Store audio file for later processing
   - Return note DID and job ID for enhanced transcript

2. **Background Enhancement Path:**
   - Queue job for high-accuracy backend transcription
   - When complete, update note with improved transcript
   - Regenerate summary if transcript significantly differs
   - Update `transcription_status: 'ENHANCED'`

**Response:**
```javascript
{
  success: true,
  noteHash: "abc123",
  noteDid: "did:gun:...",
  transcription_status: 'INITIAL',
  
  // Immediate summary (from initial transcript)
  summary: {
    keyPoints: [...],
    decisions: [...],
    actionItems: [...],
    openQuestions: [...]
  },
  
  // Background job for enhanced transcript
  enhancementJob: {
    jobId: "job_xyz",
    status: 'QUEUED',
    statusUrl: '/api/notes/jobs/job_xyz'
  }
}
```

### 1.2 Update `POST /api/notes/converse` for Voice Mode

Add streaming voice response support (similar to `/api/voice/converse`).

**New Request Parameters:**
```javascript
{
  // Existing
  noteDid: String,
  question: String,
  model: String,
  conversationHistory: Array,
  allNotes: Boolean,
  
  // NEW: Voice mode parameters
  voice_mode: Boolean,              // Enable streaming response
  voice_config: {
    engine: 'elevenlabs' | 'kokoro' | ...,
    voice_id: String,
    speed: Number
  }
}
```

**Streaming Response (when voice_mode=true):**
Return a `dialogueId` and use SSE stream similar to `/api/voice/converse`:
- `textChunk` events for streaming text
- `audioChunk` events for TTS audio
- `complete` event when done

### 1.3 Update Job Status for Enhanced Transcripts

Add transcript enhancement status to job responses:

```javascript
{
  status: 'transcribing_enhanced',
  progress: 45,
  transcript_comparison: {
    initial_word_count: 1523,
    current_word_count: 1612,
    estimated_improvement: 'moderate'  // 'minimal', 'moderate', 'significant'
  }
}
```

---

## Phase 2: Mac Client UI Integration

### 2.1 Navigation Structure

Add a tabbed interface or sidebar navigation:

```
┌────────────────────────────────────────────────────────────┐
│  ALFRED  │  💬 Chat  │  🎙️ Capture  │  📚 Library  │  ⚙️  │
└────────────────────────────────────────────────────────────┘
```

### 2.2 Meeting Capture View

New view component that combines recording with real-time transcription:

**UI Elements:**
```html
<!-- Meeting Capture View -->
<section id="captureView" class="view">
  <!-- Template Selection -->
  <div class="template-grid">
    <button data-template="MEETING" class="template-card selected">
      <span class="icon">👥</span>
      <span>Meeting</span>
    </button>
    <!-- ... other templates -->
  </div>
  
  <!-- Recording Area -->
  <div class="recording-area">
    <button id="captureBtn" class="capture-button">
      <span class="icon">🎙️</span>
    </button>
    <div class="recording-timer" id="captureTimer">00:00:00</div>
    <div class="recording-status" id="captureStatus">Ready to record</div>
  </div>
  
  <!-- Real-time Transcript -->
  <div class="live-transcript">
    <h4>Live Transcript</h4>
    <div id="liveTranscriptText" class="transcript-container">
      <!-- Real-time transcript appears here -->
    </div>
    <div class="transcript-stats">
      <span id="wordCount">0 words</span>
      <span id="speakerCount">1 speaker detected</span>
    </div>
  </div>
  
  <!-- Participants (optional) -->
  <div class="participants-section">
    <h4>Participants</h4>
    <div id="participantsList"></div>
    <button class="add-participant">+ Add</button>
  </div>
  
  <!-- Meeting Duration Toggle -->
  <div class="duration-toggle">
    <button data-duration="short" class="active">⚡ Short (&lt;60 min)</button>
    <button data-duration="long">🕐 Long (60+ min)</button>
  </div>
</section>
```

### 2.3 Note Library View

```html
<!-- Library View -->
<section id="libraryView" class="view">
  <div class="library-header">
    <input type="search" id="noteSearch" placeholder="Search notes...">
    <button class="filter-btn">🔽 Filters</button>
    <button class="refresh-btn">🔄 Refresh</button>
  </div>
  
  <div class="notes-list" id="notesList">
    <!-- Note cards rendered here -->
  </div>
</section>
```

### 2.4 Note Detail View

```html
<!-- Note Detail View -->
<section id="noteDetailView" class="view">
  <button class="back-btn">← Back to Library</button>
  
  <div class="note-header">
    <h2 id="noteTitle">Meeting Title</h2>
    <div class="note-meta">
      <span id="noteDate">Nov 20, 2025</span>
      <span id="noteDuration">45 min</span>
      <span id="noteType" class="badge">MEETING</span>
    </div>
  </div>
  
  <!-- Transcript Status -->
  <div id="transcriptStatus" class="transcript-status">
    <span class="status-badge initial">📝 Initial Transcript</span>
    <span class="enhancement-progress" hidden>
      🔄 Enhancing... <progress value="45" max="100"></progress>
    </span>
  </div>
  
  <!-- Summary Sections -->
  <div class="summary-section">
    <h3>Key Points</h3>
    <ul id="keyPoints"></ul>
  </div>
  
  <div class="summary-section">
    <h3>Action Items</h3>
    <ul id="actionItems"></ul>
  </div>
  
  <div class="summary-section">
    <h3>Open Questions</h3>
    <ul id="openQuestions"></ul>
  </div>
  
  <!-- Chat Button -->
  <button class="chat-about-note-btn" onclick="chatAboutNote()">
    💬 Chat with Alfred about this note
  </button>
</section>
```

### 2.5 Enhanced Chat View for Notes

Update the existing chat view to support note context:

```javascript
// Chat mode selector
const chatModes = {
  'direct': { label: 'Chat', description: 'Direct LLM conversation' },
  'allNotes': { label: 'All Notes', description: 'Search across all notes' },
  'selected': { label: 'Selected Note', description: 'Chat about specific note' }
};

// When in 'selected' mode, show context indicator
<div class="note-context-indicator" hidden>
  <span class="icon">📝</span>
  <span id="selectedNoteName">Meeting with Team</span>
  <button class="clear-context">✕</button>
</div>
```

---

## Phase 3: Real-Time Transcription During Recording

### 3.1 Recording Flow with Live STT

```javascript
class MeetingCapture {
  constructor() {
    this.isRecording = false;
    this.audioChunks = [];
    this.liveTranscript = '';
    this.transcriptSegments = [];
    this.localProcessorUrl = 'http://localhost:8015';
  }
  
  async startCapture() {
    // Start audio recording
    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.mediaRecorder = new MediaRecorder(this.localStream);
    this.audioChunks = [];
    
    this.mediaRecorder.ondataavailable = (e) => {
      this.audioChunks.push(e.data);
      
      // Every 5 seconds, send chunk for live transcription
      if (this.audioChunks.length % 5 === 0) {
        this.transcribeChunk();
      }
    };
    
    this.mediaRecorder.start(1000); // 1-second chunks
    this.isRecording = true;
    this.startTimer();
  }
  
  async transcribeChunk() {
    // Send recent audio to local MLX Whisper for real-time transcription
    const recentChunks = this.audioChunks.slice(-5);
    const audioBlob = new Blob(recentChunks, { type: 'audio/webm' });
    
    const formData = new FormData();
    formData.append('file', audioBlob, 'chunk.webm');
    formData.append('language', 'en');
    
    try {
      const response = await fetch(`${this.localProcessorUrl}/transcribe_file`, {
        method: 'POST',
        body: formData
      });
      
      const result = await response.json();
      if (result.text) {
        this.appendTranscript(result.text);
      }
    } catch (error) {
      console.warn('Live transcription chunk failed:', error);
    }
  }
  
  appendTranscript(text) {
    // Deduplicate and append to live transcript
    if (!this.liveTranscript.endsWith(text)) {
      this.liveTranscript += ' ' + text;
      this.updateLiveTranscriptUI();
    }
  }
  
  async stopCapture() {
    this.mediaRecorder.stop();
    this.isRecording = false;
    
    // Get final audio blob
    const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
    
    // Final transcription pass for complete audio
    await this.finalTranscription(audioBlob);
    
    // Submit to backend
    await this.submitToBackend(audioBlob);
  }
  
  async finalTranscription(audioBlob) {
    // Full transcription of complete recording
    const formData = new FormData();
    formData.append('file', audioBlob, 'recording.webm');
    formData.append('language', 'en');
    formData.append('task', 'transcribe');
    
    const response = await fetch(`${this.localProcessorUrl}/transcribe_file`, {
      method: 'POST',
      body: formData
    });
    
    const result = await response.json();
    this.liveTranscript = result.text;
    this.updateLiveTranscriptUI();
  }
  
  async submitToBackend(audioBlob) {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');
    formData.append('start_time', this.startTime.toISOString());
    formData.append('end_time', new Date().toISOString());
    formData.append('note_type', this.selectedTemplate);
    formData.append('device_type', 'MAC');
    formData.append('initial_transcript', this.liveTranscript);
    formData.append('initial_transcript_source', 'mlx_whisper_realtime');
    formData.append('model', this.settings.selectedModel);
    
    // Add participants if any
    if (this.participants.length > 0) {
      formData.append('participant_display_names', JSON.stringify(
        this.participants.map(p => p.name)
      ));
      formData.append('participant_roles', JSON.stringify(
        this.participants.map(p => p.role)
      ));
    }
    
    // Use hybrid endpoint
    const response = await fetch(`${this.backendUrl}/api/notes/from-audio-hybrid`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.token}` },
      body: formData
    });
    
    const result = await response.json();
    
    if (result.success) {
      // Show immediate summary
      this.showNoteSummary(result);
      
      // Start polling for enhanced transcript
      if (result.enhancementJob) {
        this.startEnhancementPolling(result.enhancementJob.jobId);
      }
    }
  }
}
```

---

## Phase 4: Voice Chat About Notes

### 4.0 Alfred Avatar Visualization (Required)

The mac-client integration **MUST** include the Alfred avatar visualization with real-time audio waveform overlay, as currently implemented in `public/alfreds-notes.html`. This provides essential visual feedback during voice conversations.

**Visual Design:**
- Display Alfred robot avatar (`alfred.png`) prominently during conversations
- Overlay a 16-bar audio waveform on Alfred's "mouth" area when speaking
- Bars animate in real-time based on actual audio frequency data
- Center-weighted frequency mapping (bass in center, treble at edges)
- Dark grey/black bar colors with subtle glow effect

**Implementation Reference (`alfreds-notes.html`):**
```javascript
// Key visualization parameters from existing implementation:
const totalBars = 16;
const analyser.fftSize = 64;
const analyser.smoothingTimeConstant = 0.8;

// Center-weighted frequency mapping:
// - Center bars (7-8) show bass frequencies (most active for voice)
// - Edge bars (0-1, 14-15) show higher frequencies
// - Y-axis mirror only (bars grow up/down from center line)
```

**UI Component:**
```html
<!-- Alfred Visualization Panel -->
<div id="alfredVizPanel" class="alfred-viz-panel">
  <div class="alfred-viz-header">
    <div class="alfred-viz-title">Alfred</div>
    <button class="alfred-viz-toggle">◐</button>
  </div>
  <div class="alfred-viz-content">
    <div class="alfred-avatar-container">
      <img src="/alfred.png" alt="Alfred" class="alfred-avatar-img">
      <canvas id="alfredSoundwave" class="alfred-soundwave-overlay" 
              width="84" height="24"></canvas>
    </div>
    <div id="alfredVizStatus" class="alfred-viz-status">Ready to speak</div>
  </div>
</div>
```

**States:**
| State | Avatar | Waveform | Status Text |
|-------|--------|----------|-------------|
| Idle | Visible | Hidden | "Ready to speak" |
| Listening | Visible | Hidden | "Listening..." |
| Processing | Visible | Hidden | "Thinking..." |
| Speaking | Visible | **Animated** | "Speaking..." |
| Collapsed | Hidden (orb) | N/A | Pulsing glow when speaking |

**CSS Positioning:**
```css
.alfred-soundwave-overlay {
  position: absolute;
  left: 50%;
  top: calc(33% + 45px);  /* Positioned over Alfred's mouth */
  transform: translate(-50%, -50%) scale(0.9);
}
```

> **📄 Full Technical Reference**: See [ALFRED_WAVEFORM_VISUALIZATION.md](./ALFRED_WAVEFORM_VISUALIZATION.md) for complete implementation details including the drawing algorithm, frequency mapping logic, and state management.

### 4.1 Integration with Existing Voice Infrastructure

```javascript
class NoteVoiceChat {
  constructor(alfredInterface) {
    this.alfred = alfredInterface;  // Existing ALFREDInterface
    this.currentNoteDid = null;
    this.chatMode = 'direct';  // 'direct', 'allNotes', 'selected'
  }
  
  setChatMode(mode, noteDid = null) {
    this.chatMode = mode;
    this.currentNoteDid = noteDid;
    this.alfred.settings.processingMode = mode === 'direct' ? 'llm' : 'rag';
  }
  
  // Override sendToALFREDBackend to use notes/converse endpoint
  async sendToBackend(transcribedText) {
    const requestBody = {
      question: transcribedText,
      model: this.alfred.settings.selectedModel,
      conversationHistory: this.alfred.getConversationHistory(),
      voice_mode: true,
      voice_config: {
        engine: this.alfred.settings.ttsEngine,
        voice_id: this.alfred.settings.voiceId,
        speed: this.alfred.settings.speechSpeed
      }
    };
    
    // Add note context based on chat mode
    if (this.chatMode === 'selected' && this.currentNoteDid) {
      requestBody.noteDid = this.currentNoteDid;
    } else if (this.chatMode === 'allNotes') {
      requestBody.allNotes = true;
    } else {
      requestBody.allNotes = false;  // Direct LLM mode
    }
    
    // Use notes/converse endpoint with streaming
    const initResponse = await fetch(`${this.alfred.backendUrl}/api/notes/converse-stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.alfred.token}`
      },
      body: JSON.stringify(requestBody)
    });
    
    const initData = await initResponse.json();
    const dialogueId = initData.dialogueId;
    
    // Use existing SSE streaming infrastructure
    const eventSource = new EventSource(
      `${this.alfred.backendUrl}/api/notes/stream?dialogueId=${dialogueId}`
    );
    
    // Reuse existing event handlers from ALFREDInterface
    this.alfred.handleStreamingResponse(eventSource);
  }
}
```

### 4.2 New Backend Endpoint: `POST /api/notes/converse-stream`

Similar to `/api/voice/converse` but with notes context:

```javascript
router.post('/converse-stream', authenticateToken, async (req, res) => {
  const {
    question,
    model,
    conversationHistory,
    noteDid,
    allNotes,
    voice_mode,
    voice_config
  } = req.body;
  
  // Generate dialogue ID for streaming
  const dialogueId = crypto.randomUUID();
  
  // Store dialogue context
  dialogueContexts.set(dialogueId, {
    question,
    model,
    conversationHistory,
    noteDid,
    allNotes,
    voice_config,
    chunks: [],
    complete: false
  });
  
  // Start background processing
  processNoteConversation(dialogueId);
  
  res.json({ dialogueId, statusUrl: `/api/notes/stream?dialogueId=${dialogueId}` });
});

// SSE endpoint for streaming
router.get('/stream', (req, res) => {
  const { dialogueId } = req.query;
  // ... SSE setup similar to /api/voice/open-stream
});
```

---

## Phase 5: Migration Path

### 5.1 Feature Flag Rollout

```javascript
// config/features.js
module.exports = {
  MAC_CLIENT_NOTES_INTEGRATION: {
    enabled: process.env.ENABLE_MAC_NOTES === 'true',
    phases: {
      HYBRID_UPLOAD: true,      // Phase 1: Backend API
      MEETING_CAPTURE: true,    // Phase 2: UI
      LIVE_TRANSCRIPTION: true, // Phase 3: Real-time STT
      VOICE_NOTES_CHAT: true    // Phase 4: Voice chat
    }
  }
};
```

### 5.2 Data Migration

No data migration required - existing notes remain compatible. New notes will have:
- `transcription_source: 'mlx_whisper_realtime'` for initial
- `transcription_status: 'INITIAL'` → `'ENHANCED'` when backend STT completes

---

## Implementation Tasks

### Backend Tasks
- [ ] Create `POST /api/notes/from-audio-hybrid` endpoint
- [ ] Add `initial_transcript` parameter to existing `/from-audio` endpoint
- [ ] Update `/api/notes/converse` to support voice mode
- [ ] Create `POST /api/notes/converse-stream` endpoint
- [ ] Create `GET /api/notes/stream` SSE endpoint
- [ ] Add background job for enhanced transcription
- [ ] Update job status API for transcript enhancement progress

### Mac Client Tasks
- [ ] Add navigation tabs (Chat, Capture, Library, Settings)
- [ ] Create Meeting Capture view component
- [ ] Implement real-time transcription during recording
- [ ] Create Note Library view component
- [ ] Create Note Detail view component
- [ ] Integrate chat modes with existing voice infrastructure
- [ ] Add note context indicator to chat view
- [ ] Implement enhancement job polling
- [ ] **Alfred Avatar Visualization** (from `alfreds-notes.html`):
  - [ ] Port Alfred avatar panel component
  - [ ] Implement Web Audio API waveform analysis
  - [ ] Add 16-bar center-weighted frequency visualization
  - [ ] Position waveform overlay on Alfred's mouth
  - [ ] Add collapsible panel with speaking indicator orb
  - [ ] Sync visualization with streaming audio playback

### Testing Tasks
- [ ] Test hybrid upload with real-time transcript
- [ ] Test background enhancement job
- [ ] Test voice chat with note context
- [ ] Test interruption during note chat
- [ ] Test long meeting async processing
- [ ] Performance testing for real-time STT + recording

---

## Timeline Estimate

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1: Backend APIs | 2-3 days | None |
| Phase 2: Mac Client UI | 3-4 days | Phase 1 |
| Phase 3: Live Transcription | 2-3 days | Phase 2 |
| Phase 4: Voice Chat | 2-3 days | Phases 1-3 |
| Phase 5: Testing & Polish | 2-3 days | All phases |

**Total Estimated Time: 11-16 days**

---

## Success Criteria

1. **Meeting Recording**: User can record a meeting and see real-time transcript
2. **Immediate Summary**: Note summary appears within 10 seconds of stopping recording
3. **Background Enhancement**: Transcript improves automatically in background
4. **Voice Chat**: User can ask questions about notes using voice with full interruption support
5. **Alfred Avatar Visualization**: Alfred robot avatar displays with real-time audio waveform over mouth during speech
6. **Seamless Experience**: All functionality works together without friction

