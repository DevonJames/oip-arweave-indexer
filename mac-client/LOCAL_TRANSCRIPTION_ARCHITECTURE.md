# Local Transcription Architecture

This document explains how Alfred's voice interface performs speech-to-text (STT) transcription locally on Mac hardware, without sending audio to cloud services.

## Overview

Alfred uses **MLX Whisper** - Apple's optimized machine learning framework - to run OpenAI's Whisper speech recognition models directly on Mac hardware. This provides:

- **Privacy**: Audio never leaves your device
- **Speed**: Optimized for Apple Silicon (M1/M2/M3/M4)
- **Offline capability**: Works without internet connection
- **Low latency**: Real-time partial transcription

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Mac Client                                   │
│                                                                      │
│  ┌──────────────┐    ┌──────────────────────────────────────────┐  │
│  │   Browser    │    │     Unified Voice Processor (Python)      │  │
│  │              │    │                                           │  │
│  │ MediaRecorder├───►│  ┌─────────┐  ┌─────────┐  ┌───────────┐ │  │
│  │   (WebM)     │    │  │ Silero  │  │   MLX   │  │   Smart   │ │  │
│  │              │    │  │   VAD   ├─►│ Whisper ├─►│   Turn    │ │  │
│  │ alfred-speaks│    │  │         │  │         │  │           │ │  │
│  │    .html     │◄───┤  │ (Voice  │  │  (STT)  │  │(Interrupt)│ │  │
│  │              │    │  │ Detect) │  │         │  │           │ │  │
│  └──────────────┘    │  └─────────┘  └─────────┘  └───────────┘ │  │
│                      │                                           │  │
│   Port 3001          │               Port 8015                   │  │
│   (Interface)        └──────────────────────────────────────────┘  │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   │ TEXT (not audio)
                                   ▼
                    ┌──────────────────────────┐
                    │     Remote Backend       │
                    │    (alexandria.io)       │
                    │                          │
                    │  LLM → Response → TTS    │
                    │   (Grok)    (ElevenLabs) │
                    └──────────────────────────┘
```

## Key Principle

**Audio stays local. Only text travels to the cloud.**

The browser captures your voice and sends audio to the local Python service running on your Mac. That service transcribes it locally using Whisper. Only the resulting text is sent to the remote backend for AI processing.

---

## Components

### 1. Browser Audio Capture (`alfred-speaks.html`)

The browser uses the Web Audio API to capture microphone input:

```javascript
// Request microphone access
const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
        channelCount: 1,
        sampleRate: 16000,        // 16kHz for Whisper
        echoCancellation: true,
        noiseSuppression: true
    }
});

// Create MediaRecorder
const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
    ? 'audio/webm;codecs=opus' : 'audio/webm';
const mediaRecorder = new MediaRecorder(stream, { mimeType });
```

The audio is recorded in WebM/Opus format and sent to the local voice processor.

### 2. Unified Voice Processor (`unified_voice_processor.py`)

A FastAPI Python service that runs three processing stages:

#### Stage 1: Voice Activity Detection (VAD)

Uses **Silero VAD** to detect when speech is present:

```python
# Load Silero VAD model
self.vad_model, utils = torch.hub.load(
    repo_or_dir='snakers4/silero-vad',
    model='silero_vad',
    force_reload=False,
    onnx=False
)

# Process audio frame
audio_tensor = torch.FloatTensor(audio_data).unsqueeze(0)
speech_prob = self.vad_model(audio_tensor, self.sample_rate).item()
has_speech = speech_prob > 0.5
```

This prevents transcribing silence and optimizes resource usage.

#### Stage 2: Speech-to-Text (STT)

Uses **MLX Whisper** with a dual-model strategy:

| Model | Use Case | Speed | Quality |
|-------|----------|-------|---------|
| `whisper-tiny-mlx` | Real-time partials | ~10x faster | Good |
| `whisper-large-v3-mlx-4bit` | Final transcription | Slower | Excellent |

```python
# Load models on startup
self.whisper_model_fast = load_model("mlx-community/whisper-tiny-mlx")
self.whisper_model = load_model("mlx-community/whisper-large-v3-mlx-4bit")

# Fast partial transcription (every 200ms)
def _get_partial_transcription(self, audio_buffer):
    result = transcribe(
        audio_data,
        path_or_hf_repo="mlx-community/whisper-tiny-mlx",  # FAST
        language="en",
        temperature=0.0,
        fp16=True
    )
    return result.get('text', '').strip()

# High-quality final transcription
def _get_final_transcription(self, audio_buffer):
    result = transcribe(
        audio_data,
        path_or_hf_repo="mlx-community/whisper-large-v3-mlx-4bit",  # QUALITY
        language="en",
        temperature=0.0,
        condition_on_previous_text=True,
        fp16=True
    )
    return result.get('text', '').strip()
```

#### Stage 3: Smart Turn Detection

Analyzes interruption intent to enable natural conversation flow:

- Energy analysis (sudden volume increases)
- Speech pattern analysis (sustained speaking)
- Keyword detection ("wait", "stop", "excuse me")

---

## MLX: Why It's Fast on Mac

**MLX** is Apple's machine learning framework optimized for Apple Silicon:

1. **Unified Memory**: Shares memory between CPU and GPU - no data copying
2. **Metal Backend**: Uses Apple's GPU compute API
3. **Lazy Evaluation**: Computes only what's needed
4. **4-bit Quantization**: `whisper-large-v3-mlx-4bit` uses 4-bit weights, reducing memory by ~4x while maintaining quality

### Performance on Apple Silicon

| Mac | Whisper Large (30s audio) | Tiny (real-time) |
|-----|---------------------------|------------------|
| M1 | ~5-8 seconds | Real-time |
| M2 | ~3-5 seconds | Real-time |
| M3 | ~2-4 seconds | Real-time |
| M3 Max/Ultra | ~1-2 seconds | Real-time |

---

## API Endpoints

### POST `/transcribe_file`

Transcribe a complete audio file.

**Request:**
```bash
curl -X POST http://localhost:8015/transcribe_file \
  -F "file=@recording.webm" \
  -F "language=en" \
  -F "task=transcribe"
```

**Response:**
```json
{
  "text": "Hello, this is what I said.",
  "language": "en",
  "duration": 3.45,
  "confidence": 0.92,
  "has_speech": true,
  "processing_time_ms": 847
}
```

### POST `/process_frame`

Process a single audio frame (for real-time streaming).

**Request:**
```bash
curl -X POST http://localhost:8015/process_frame \
  -F "session_id=abc123" \
  -F "audio_file=@frame.raw"
```

**Response:**
```json
{
  "status": "processed",
  "has_speech": true,
  "speech_confidence": 0.87,
  "speech_state": "speech_continue",
  "partial_text": "Hello this is",
  "final_text": "",
  "transcription_complete": false,
  "accumulated_transcript": "Hello this is what I was saying earlier. ",
  "processing_time_ms": 23
}
```

### GET `/health`

Check service health.

```json
{
  "status": "healthy",
  "service": "Unified Voice Processor",
  "version": "4.0.0",
  "pipeline": {
    "pipeline_state": {
      "frames_processed": 1523,
      "sessions_active": 1,
      "processing_load": 45.2,
      "pipeline_health": "healthy"
    },
    "models_loaded": {
      "whisper": true,
      "vad": true
    }
  }
}
```

---

## Data Flow for a Voice Message

1. **User speaks** → Browser captures audio via MediaRecorder
2. **Recording stops** → Browser sends WebM audio to `http://localhost:8015/transcribe_file`
3. **Audio preprocessing** → Python converts WebM to raw PCM using ffmpeg
4. **VAD check** → Silero VAD confirms speech is present
5. **Transcription** → MLX Whisper Large converts audio to text
6. **Response** → Text returned to browser
7. **Send to backend** → Browser sends TEXT (not audio) to Alexandria backend
8. **AI response** → Backend generates response with LLM
9. **TTS** → Backend converts response to audio (ElevenLabs)
10. **Playback** → Browser plays audio response

---

## Installation Requirements

### Python Dependencies

```bash
pip install mlx-whisper silero-vad torch numpy fastapi uvicorn python-multipart
```

### System Requirements

- **macOS 12.3+** (for MLX)
- **Apple Silicon** (M1/M2/M3/M4) - Intel Macs not supported for MLX
- **ffmpeg** (for WebM to WAV conversion)

```bash
brew install ffmpeg
```

### First-Time Model Download

Models are downloaded automatically on first use:

```python
# This downloads ~75MB for tiny, ~3GB for large-v3-4bit
from mlx_whisper.load_models import load_model
model = load_model("mlx-community/whisper-large-v3-mlx-4bit")
```

Models are cached in `~/.cache/huggingface/`.

---

## Configuration

### Audio Settings

```python
sample_rate = 16000       # Required for Whisper
frame_duration_ms = 20    # 20ms frames
frame_size = 320          # 320 samples per frame
```

### VAD Settings

```python
interruption_config = {
    'energy_threshold': 0.02,           # Minimum energy to consider speech
    'confidence_threshold': 0.7,         # VAD probability threshold
    'silence_frames_for_endpoint': 10,   # ~200ms of silence = speech end
}
```

### Service Port

Default port is 8015, configurable via command line:

```bash
python unified_voice_processor.py --port 8015 --host 0.0.0.0
```

---

## Troubleshooting

### "No speech detected"

- Check microphone permissions in browser
- Ensure audio isn't too quiet (energy threshold is 0.02)
- Try speaking louder or closer to mic

### Slow transcription

- First transcription is slow (model loading)
- Subsequent transcriptions are faster
- Use `whisper-tiny` for real-time, `whisper-large` for final

### "ffmpeg not found"

```bash
brew install ffmpeg
```

### High memory usage

- The large Whisper model uses ~3GB RAM
- The 4-bit quantized version reduces this significantly
- Close other apps if memory is tight

### Models not loading

Check Hugging Face cache:

```bash
ls ~/.cache/huggingface/hub/models--mlx-community--whisper*
```

Re-download if corrupt:

```python
from mlx_whisper.load_models import load_model
model = load_model("mlx-community/whisper-large-v3-mlx-4bit", force_download=True)
```

---

## Security & Privacy

| Data Type | Where Processed | Where Stored |
|-----------|-----------------|--------------|
| Raw Audio | Local Mac only | Never stored |
| Transcript | Local Mac | Sent to backend |
| Models | Local Mac | ~/.cache/huggingface |

**Key guarantees:**

- Audio never leaves your Mac
- No cloud STT services used
- Models run locally with MLX
- Only text is transmitted to backend

---

## Files Reference

| File | Purpose |
|------|---------|
| `unified_voice_processor.py` | Main Python service |
| `alfred-speaks.html` | Browser voice interface |
| `start_interface_only.sh` | Start both services |
| `stop_interface_only.sh` | Stop both services |
| `mac-client-env/` | Python virtual environment |
| `models/silero_vad/` | Silero VAD model files |
