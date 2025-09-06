# TTS (Text-to-Speech) Service Documentation

## Overview

The OIP Arweave Indexer includes a comprehensive TTS service that supports multiple synthesis engines, both local and cloud-based. The service is built using FastAPI and runs on GPU-accelerated hardware for optimal performance.

## Service Architecture

### Main Components

1. **GPU TTS Service** (`text-to-speech/tts_service_gpu.py`) - Main synthesis service running on port 5002
2. **Voice Routes** (`routes/voice.js`) - Express.js middleware handling TTS requests
3. **Web Interface** (`public/index.html`) - Frontend with voice engine selection and controls

### Request Flow

```
Browser → /api/alfred/synthesize → routes/voice.js → TTS Service GPU (port 5002) → Audio Response
```

## API Endpoints

### Synthesis Endpoint

**URL:** `POST /api/alfred/synthesize`
**Content-Type:** `application/x-www-form-urlencoded`

**Required Parameters:**
- `text` (string) - Text to synthesize
- `engine` (string) - TTS engine to use
- `voice_id` (string) - Voice identifier
- `speed` (float) - Speech speed (default: 1.0)
- `gender` (string) - Voice gender (default: "female")
- `emotion` (string) - Emotional tone (default: "neutral")
- `exaggeration` (float) - Emotion intensity 0.0-1.0 (default: 0.5)
- `cfg_weight` (float) - Configuration weight 0.0-1.0 (default: 0.5)
- `voice_cloning` (boolean) - Enable voice cloning (default: false)

**Optional Parameters:**
- `audio_prompt` (file) - Audio file for voice cloning
- `language` (string) - Language code for some engines

**Response Format:**
```json
{
  "audio_data": "base64_encoded_wav_audio",
  "engine": "engine_used",
  "voice": "voice_used", 
  "processing_time_ms": 1250,
  "cached": false
}
```

### Health Endpoint

**URL:** `GET /api/alfred/health`

Returns service status and available engines:
```json
{
  "status": "healthy",
  "services": {
    "tts": {
      "status": "healthy",
      "details": {
        "engines": [
          {"name": "kokoro", "available": true, "primary": true},
          {"name": "chatterbox", "available": false, "primary": false},
          {"name": "silero", "available": true, "primary": false},
          {"name": "edge_tts", "available": true, "primary": false},
          {"name": "gtts", "available": true, "primary": false},
          {"name": "espeak", "available": true, "primary": false}
        ]
      }
    }
  }
}
```

## Available TTS Engines

### Local Engines (GPU-Accelerated)

#### 1. Kokoro TTS
- **Status:** ✅ Available (Official Python package)
- **Quality:** High neural synthesis with 82M parameters
- **Speed:** Fast (GPU-accelerated when available)
- **Voices:** Language-based voices
  - `en` / `a` - American English
  - `en-gb` / `b` - British English
  - `es` / `e` - Spanish  
  - `fr` / `f` - French
  - `de` / `d` - German
  - `it` / `i` - Italian
  - `pt` / `p` - Portuguese
  - `ja` / `j` - Japanese
  - `ko` / `k` - Korean
  - `zh` / `z` - Chinese
  - `default` - American English
- **Quirks:** 
  - Uses official `kokoro` Python package
  - Models auto-downloaded on first use
  - Supports multiple languages natively
  - Sample rate: 24kHz

#### 2. Chatterbox TTS
- **Status:** ❌ Not Available (Missing package)
- **Quality:** High (when available)
- **Features:** Voice cloning support
- **Voices:** Dynamic voice list when available
- **Quirks:** Requires `chatterbox` Python package installation

#### 3. Silero Neural TTS  
- **Status:** ✅ Available (GPU-accelerated)
- **Quality:** High neural synthesis
- **Speed:** Fast (CUDA-accelerated)
- **Voices:**
  - `chatterbox` - Default voice
  - `female_1` - Female voice variant 1
  - `female_2` - Female voice variant 2
  - `male_1` - Male voice variant 1
  - `male_2` - Male voice variant 2
  - `expressive` - Expressive voice
  - `calm` - Calm voice
  - `announcer` - Announcer style
  - `storyteller` - Storytelling voice
- **Quirks:**
  - Model loaded via torch.hub
  - Sample rate: 48000Hz
  - Requires GPU memory

#### 4. eSpeak TTS
- **Status:** ✅ Available (Offline)
- **Quality:** Low (robotic but reliable)
- **Speed:** Very fast
- **Voices:** System eSpeak voices (language-based)
- **Quirks:**
  - Completely offline
  - Robotic sound quality
  - Very reliable fallback option
  - Uses system eSpeak installation

### Cloud Engines

#### 5. Edge TTS (Microsoft)
- **Status:** ⚠️ Intermittent (403 rate limiting)
- **Quality:** High neural voices
- **Speed:** Fast
- **Voices:**
  - `en-GB-RyanNeural` - British male
  - `en-GB-GeorgeNeural` - British male (older)
  - `en-GB-SoniaNeural` - British female
  - `en-US-GuyNeural` - American male
  - `en-US-JennyNeural` - American female
- **Quirks:**
  - Microsoft rate limiting (403 errors)
  - IP-based restrictions possible
  - Free service, no API key required

#### 6. Google Text-to-Speech (gTTS)
- **Status:** ✅ Available
- **Quality:** Good
- **Speed:** Moderate (network dependent)
- **Voices:** Language-based (`en`, `es`, `fr`, etc.)
- **Quirks:**
  - Requires internet connection
  - Google's free TTS service
  - Limited voice options per language

#### 7. ElevenLabs TTS
- **Status:** ✅ Available (API key required)
- **Quality:** Excellent (premium)
- **Speed:** Fast
- **Voices:**
  - `pNInz6obpgDQGcFmaJgB` - Adam (Male, Deep)
  - `EXAVITQu4vr4xnSDxMaL` - Bella (Female, Sweet)
  - `VR6AewLTigWG4xSOukaG` - Arnold (Male, Crisp)
  - `pMsXgVXv3BLzUgSXRplE` - Freya (Female, Conversational)
  - `onwK4e9ZLuTAKqWW03F9` - Daniel (Male, British)
  - `rrnzWnb1k1hLVqzwuuGl` - Jeremy (Male, American)
  - `cgSgspJ2msm6clMCkdW9` - Jessica (Female, Expressive)
  - `JBFqnCBsd6RMkjVDRZzb` - George (Male, Raspy)
  - `YEUXwZHP2c25CNI7A3tf` - Charlotte (Female, Seductive)
  - `oWAxZDx7w5VEj9dCyTzz` - Grace (Female, Calm)
- **Quirks:**
  - Requires ElevenLabs API key
  - Premium service (usage costs)
  - Highest quality available

## Engine Selection Logic

The system attempts engines in this order:

1. **Requested Engine** - Try the specifically requested engine first
2. **Fallback Chain** - If primary fails:
   - Kokoro → Silero → Edge TTS → gTTS → eSpeak
3. **Final Fallback** - Browser TTS if all engines fail

## Installation & Setup

### Kokoro TTS Installation

**Current Status:** ✅ Fully installed and working

Kokoro TTS is installed using the official Python package:

1. **Package Installation (already done in Dockerfile):**
   ```bash
   pip install kokoro==0.3.1 soundfile
   ```

2. **Dependencies:**
   - ✅ `kokoro` Python package (0.3.1)
   - ✅ `soundfile` for audio I/O
   - ✅ Models automatically downloaded on first use

3. **No manual setup required:**
   - Models are downloaded automatically by the package
   - No ONNX files needed
   - No manual configuration required

**Note:** The first synthesis request may take longer as the model downloads automatically.

### ElevenLabs Setup

Add your ElevenLabs API key to environment variables:
```bash
ELEVENLABS_API_KEY=your_api_key_here
```

## Troubleshooting

### Common Issues

1. **"All TTS engines failed"**
   - Check if TTS service is running on port 5002
   - Verify Docker containers are healthy
   - Check network connectivity for cloud engines

2. **"Invalid response from Kokoro TTS service"** 
   - Usually indicates TTS service returned wrong response format
   - Check TTS service logs for detailed errors

3. **Edge TTS 403 Errors**
   - Microsoft rate limiting
   - Try again later or use different engine

4. **Robotic voice on all engines**
   - Likely falling back to eSpeak
   - Check individual engine availability in health endpoint

### Logging

Enable detailed logging by checking:
- TTS Service logs: `docker logs -f oip-arweave-indexer-tts-service-gpu-1`
- Backend logs: Check Express.js console output
- Browser console: Check for frontend errors

## Performance Notes

- **GPU Engines** (Kokoro, Silero): ~1-3 seconds synthesis time
- **Cloud Engines** (Edge, gTTS, ElevenLabs): ~2-5 seconds (network dependent)  
- **eSpeak**: <1 second (instant local synthesis)

Audio format: WAV, 48kHz sample rate (Silero), variable for other engines.
