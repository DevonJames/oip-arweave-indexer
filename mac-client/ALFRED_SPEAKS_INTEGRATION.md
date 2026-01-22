# Alfred Speaks - Voice Conversation Widget Integration Guide

This document explains how to integrate the Alfred voice conversation widget into your application, including required dependencies, API endpoints, and response formats.

## Overview

Alfred Speaks is a voice-enabled AI conversation widget that provides:
- **Voice Input**: Speech-to-text using local MLX Whisper processing
- **Voice Output**: Text-to-speech using ElevenLabs (or other TTS engines)
- **Visual Feedback**: Animated mouth visualization synced to audio
- **Continuous Conversation**: Auto-restarts listening after Alfred speaks

## Quick Start

```bash
# From the project root directory:
make -f Makefile-alfred start

# Then open:
# http://localhost:3001/alfred-speaks.html

# To stop:
make -f Makefile-alfred stop

# To check status:
make -f Makefile-alfred status
```

## Required Files

### Minimum Files for Standalone Alfred

To run Alfred Speaks standalone, you need these files from `mac-client/`:

| File | Purpose |
|------|---------|
| `alfred-speaks.html` | The standalone voice conversation widget |
| `alfred.png` | Alfred avatar image |
| `unified_voice_processor.py` | Local STT service (MLX Whisper) |
| `enhanced_voice_interface_server.js` | Node.js static file server |
| `package.json` | Node.js dependencies |
| `start_interface_only.sh` | Startup script |
| `stop_interface_only.sh` | Shutdown script |
| `mac-client-env/` | Python virtual environment |
| `models/` | ML models (Whisper, Silero VAD) |

### Setting Up the Python Environment

```bash
cd mac-client

# Create virtual environment (first time only)
python3 -m venv mac-client-env
source mac-client-env/bin/activate

# Install dependencies
pip install mlx-whisper silero-vad flask flask-cors numpy

# Download Whisper models (first time only)
python -c "import mlx_whisper; mlx_whisper.transcribe('test.wav', path_or_hf_repo='mlx-community/whisper-tiny-mlx')"
```

### Starting Manually (without Makefile)

```bash
cd mac-client
source mac-client-env/bin/activate

# Terminal 1: Start voice processor
python unified_voice_processor.py --port 8015

# Terminal 2: Start interface server
npm install  # first time only
node enhanced_voice_interface_server.js
```

Or use the convenience scripts:
```bash
cd mac-client
./start_interface_only.sh
# ... later ...
./stop_interface_only.sh
```

### Backend Server (Required for LLM + TTS)

The widget connects to an Alexandria/OIP backend that provides:
- LLM inference (Grok, GPT, Claude, etc.)
- Text-to-speech synthesis (ElevenLabs, Kokoro, etc.)
- Optional RAG over notes

Default backend: `https://alexandria.io` (configurable in settings panel)

---

## API Endpoints

### 1. Voice Processor Health Check

**Endpoint:** `GET /health`  
**URL:** `http://localhost:8015/health`

**Response:**
```json
{
  "status": "healthy",
  "service": "unified_voice_processor",
  "version": "1.0.0"
}
```

---

### 2. Transcribe Audio File

**Endpoint:** `POST /transcribe_file`  
**URL:** `http://localhost:8015/transcribe_file`

**Request:** `multipart/form-data`
| Field | Type | Description |
|-------|------|-------------|
| `file` | File | Audio file (webm, mp3, wav, etc.) |
| `language` | String | Language code (default: "en") |
| `task` | String | "transcribe" or "translate" |

**Response:**
```json
{
  "text": "The transcribed text from the audio",
  "language": "en",
  "duration": 3.45
}
```

---

### 3. Synchronous Conversation (with optional audio)

**Endpoint:** `POST /api/notes/converse`  
**URL:** `https://alexandria.io/api/notes/converse`

**Request Headers:**
```
Content-Type: application/json
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "question": "What is the weather today?",
  "model": "grok-2-mini",
  "conversationHistory": [
    { "role": "user", "content": "Hello" },
    { "role": "assistant", "content": "Hi! How can I help?" }
  ],
  "return_audio": true,
  "engine": "elevenlabs",
  "voice_id": "qXcNpxDCD6dKvASibF0r",
  "speed": 1
}
```

**Optional Fields for RAG:**
```json
{
  "noteDid": "did:gun:xyz123:noteid",  // Chat about specific note
  "allNotes": true                      // Chat about all notes
}
```

**Response:**
```json
{
  "success": true,
  "answer": "I don't have access to real-time weather data...",
  "model": "grok-2-mini",
  "audio_data": "base64_encoded_mp3_audio...",
  "has_audio": true,
  "engine_used": "elevenlabs"
}
```

---

### 4. Streaming Conversation (SSE with inline audio)

**Endpoint:** `POST /api/notes/converse-stream-inline`  
**URL:** `https://alexandria.io/api/notes/converse-stream-inline`

**Request Headers:**
```
Content-Type: application/json
Authorization: Bearer <jwt_token>
```

**Request Body:**
```json
{
  "question": "Tell me a story",
  "model": "grok-2-mini",
  "voice_mode": true,
  "voice_config": {
    "engine": "elevenlabs",
    "voice_id": "qXcNpxDCD6dKvASibF0r"
  },
  "conversationHistory": []
}
```

**Response:** Server-Sent Events (SSE) stream

Each event is formatted as `data: {json}\n\n`

**Event Types:**

1. **Stream Started**
```json
{ "type": "started" }
```

2. **Text Chunk**
```json
{
  "type": "textChunk",
  "text": "Once upon",
  "accumulated": "Once upon a time",
  "final": false
}
```

3. **Audio Generating**
```json
{ "type": "audioGenerating" }
```

4. **Audio Chunk**
```json
{
  "type": "audioChunk",
  "audio_data": "base64_encoded_mp3...",
  "format": "mp3"
}
```

5. **Complete**
```json
{ "type": "complete" }
```

6. **Error**
```json
{
  "type": "error",
  "error": "Error message"
}
```

---

## Configuration Options

### Voice IDs (ElevenLabs)

| Voice ID | Name | Description |
|----------|------|-------------|
| `qXcNpxDCD6dKvASibF0r` | Alfred | Default Alfred voice |
| `onwK4e9ZLuTAKqWW03F9` | Adam | Male, conversational |
| `21m00Tcm4TlvDq8ikWAM` | Rachel | Female, warm |

### TTS Engines

| Engine | Description |
|--------|-------------|
| `elevenlabs` | High-quality neural TTS (requires API key) |
| `kokoro` | Local TTS (requires Kokoro service) |
| `chatterbox` | Resemble AI TTS (requires setup) |

### LLM Models

| Model | Provider |
|-------|----------|
| `grok-2-mini` | xAI |
| `grok-4-fast-reasoning` | xAI |
| `gpt-4o-mini` | OpenAI |
| `claude-3-haiku` | Anthropic |
| `llama3.1` | Ollama (local) |

---

## Integration Steps

### 1. Minimal Integration

Copy `alfred-speaks.html` to your project and include it via iframe:

```html
<iframe src="alfred-speaks.html" width="400" height="700"></iframe>
```

### 2. Component Integration

Extract the relevant CSS, HTML, and JavaScript from `alfred-speaks.html`:

1. **CSS**: Copy the styles from `<style>` tag
2. **HTML**: Copy the Alfred panel, chat messages, and input area
3. **JavaScript**: Copy the `alfredSpeaks` object

### 3. Required State Variables

```javascript
state: {
  // Conversation
  conversationHistory: [],
  
  // Voice listening
  isVoiceListening: false,
  isMicMuted: false,
  voiceStream: null,
  voiceAudioContext: null,
  voiceAudioSource: null,
  voiceScriptProcessor: null,
  voiceMediaRecorder: null,
  voiceAudioChunks: [],
  voiceHadSpeech: false,
  voiceSilenceFrames: 0,
  
  // Audio playback
  isStreamingAudio: false,
  audioContext: null,
  audioAnalyser: null,
  audioSource: null,
  currentAudio: null,
  soundwaveAnimationId: null,
  
  // Connections
  backendConnected: false,
  voiceProcessorConnected: false
}
```

### 4. Key Functions to Implement

| Function | Purpose |
|----------|---------|
| `initVoiceStream()` | Request microphone access, set up MediaRecorder |
| `startVoiceInput()` | Begin listening with silence detection |
| `stopVoiceInput()` | Stop recording, trigger transcription |
| `transcribeAndSendVoice()` | Send audio to voice processor, get text |
| `sendMessage()` | Send text to backend, handle response |
| `playAudioChunk()` | Decode base64 audio, play with visualization |
| `startSoundwaveVisualization()` | Animate the mouth canvas |
| `stopSoundwaveVisualization()` | Stop animation, reset UI |

---

## Visualization Details

The mouth visualization uses:

1. **Canvas Element**: 84x24 pixels positioned over Alfred's mouth
2. **Web Audio API**: `AnalyserNode` for frequency data
3. **Two Visual Elements**:
   - **Tension Line**: Quadratic Bezier curve that waves with audio energy
   - **Micro Bars**: 12 vertical bars showing frequency distribution

### Color Scheme

- Center: Cyan `rgba(77,254,249,...)`
- Edges: Dark grey `rgba(70,70,70,...)`
- Glow: `rgba(77,254,249,0.25)`

---

## Troubleshooting

### "Voice processor not running"

1. Start the voice processor:
   ```bash
   cd mac-client
   source mac-client-env/bin/activate
   python unified_voice_processor.py --port 8015
   ```

2. Check it's running: `curl http://localhost:8015/health`

3. Or use the Makefile: `make -f Makefile-alfred start`

### "Microphone access denied"

- Ensure HTTPS or localhost (required for `getUserMedia`)
- Check browser permissions
- Try refreshing the page

### Audio not playing

- Check `audioContext.state` - may need to resume after user interaction
- Verify base64 audio data is valid
- Check browser console for errors

### "Thank you" hallucination

This happens when the microphone stream is destroyed and recreated too quickly. The fix is to keep the `MediaRecorder` and `MediaStream` persistent between recordings - don't destroy them in `stopVoiceInput()`.

---

## File Structure

```
mac-client/
├── alfred-speaks.html              # Standalone voice widget
├── alfred.png                      # Alfred avatar image
├── ALFRED_SPEAKS_INTEGRATION.md    # This documentation
├── unified_voice_processor.py      # Local STT service (port 8015)
├── enhanced_voice_interface_server.js  # Static file server (port 3001)
├── package.json                    # Node.js dependencies
├── start_interface_only.sh         # Start both services
├── stop_interface_only.sh          # Stop both services
├── mac-client-env/                 # Python virtual environment
├── models/                         # ML models directory
│   ├── silero_vad/                 # Voice activity detection
│   └── whisper-mlx/                # Whisper speech-to-text
└── logs/                           # Runtime logs (created on start)
    ├── unified-voice-processor.log
    └── interface-server.log

# From project root:
Makefile-alfred                     # Simplified makefile for Alfred only
```

## Ports Used

| Port | Service | Purpose |
|------|---------|---------|
| 3001 | Interface Server | Serves HTML/JS/CSS files |
| 8015 | Voice Processor | Local MLX Whisper STT |

---

## Example: Custom Implementation

```javascript
// Initialize
const alfred = {
  backendUrl: 'https://alexandria.io',
  voiceProcessorUrl: 'http://localhost:8015',
  voiceId: 'qXcNpxDCD6dKvASibF0r'
};

// Send a message
async function askAlfred(question) {
  const response = await fetch(`${alfred.backendUrl}/api/notes/converse`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      question,
      model: 'grok-2-mini',
      return_audio: true,
      engine: 'elevenlabs',
      voice_id: alfred.voiceId
    })
  });
  
  const data = await response.json();
  
  if (data.audio_data) {
    playAudio(data.audio_data);
  }
  
  return data.answer;
}
```
