## Upgrading ALFRED's Conversational Functionality

This plan proposes upgrading the voice pipeline across VAD, turn-taking, STT, and TTS to improve responsiveness, accuracy, and naturalness, with minimal disruption to existing APIs. It references the current architecture in `docs/OIP_TECHNICAL_OVERVIEW.md`, `docs/ALFRED_COMPREHENSIVE_TECHNICAL_GUIDE.md`, and the implementation in `helpers/alfred.js` and `routes/voice.js`.

### TL;DR
- Add Silero VAD for accurate speech segmenting (server-side primary; keep client RMS VAD as fallback)
- Add Smart Turn v2 to robustly detect phrase endpoints and govern when to speak vs keep listening
- Offer Whisper Large v3 Turbo as an STT option, with Apple MLX Q4 quant for macOS dev and Faster-Whisper for Linux/GPU
- Add Kokoro TTS as a new high-quality TTS engine option; keep Edge TTS/Chatterbox/eSpeak as fallbacks
- Make all upgrades feature-flagged via env vars and expose health/engine endpoints

### Current Voice Stack (summary)
- Client VAD: simple RMS threshold in `frontend/src/components/VoiceAssistant.tsx` triggers stop after ~500 ms of silence
- STT: `routes/voice.js` posts recordings to `speech-to-text/whisper_service.py` (Faster-Whisper)
- Turn-taking: implicit (silence timeout) – no model-based endpoint detection
- TTS: `routes/voice.js` → `text-to-speech/tts_service.py` (prefers Chatterbox → Edge → gTTS → eSpeak)
- RAG + response: `helpers/alfred.js` orchestrates search and generation

### Target Engines
- Silero VAD: lightweight, accurate VAD for 16 kHz/8 kHz; Torch/ONNX runtimes. See `https://github.com/snakers4/silero-vad`
- Smart Turn v2: native audio turn/endpoint detection supporting 14 languages, fast inference. See `https://github.com/pipecat-ai/smart-turn`
- Whisper Large v3 Turbo (MLX Q4 for macOS; Faster-Whisper on Linux/GPU): high-quality, low-latency STT
  - Faster-Whisper project: `https://github.com/SYSTRAN/faster-whisper`
  - (Background article) Whisper Large v3 Turbo overview: `https://medium.com/axinc-ai/whisper-large-v3-turbo-high-accuracy-and-fast-speech-recognition-model-be2f6af77bdc`
- Kokoro TTS: fast, natural TTS (PyTorch/ONNX). Example resources: `https://github.com/hexgrad/Kokoro-onnx`, `https://huggingface.co/hexgrad/Kokoro-82M`

Note: Turn detection model use is complementary to VAD – VAD segments audio; Smart Turn predicts if a segment is a complete user turn.

---

## Architecture Changes

### 1) Voice Activity Detection (VAD)
Goal: Replace purely RMS-based client VAD with a reliable, model-based VAD server path while keeping the current client VAD as a UI aid.

- Server-side VAD micro-module inside STT service:
  - Add Silero VAD to `speech-to-text/whisper_service.py` to optionally pre-segment uploads (and future streams) into speech chunks before transcription.
  - Configurable via `VAD_ENABLED=true` and tunables: `VAD_THRESHOLD`, `VAD_MIN_SPEECH_MS`, `VAD_MIN_SILENCE_MS`.
  - Operation: when enabled, read uploaded audio, resample to 16 kHz mono, run Silero VAD, stitch speech chunks (or transcribe per-chunk and concatenate with timestamps).

- Client-side VAD (unchanged, fallback):
  - Keep analyzer RMS logic in `VoiceAssistant.tsx` for UX; reduce `silenceTimeoutMs` to responsiveness preference once Smart Turn is active.

Benefits: robust detection across noise conditions; fewer trailing silences sent to STT; better alignment for Smart Turn.

### 2) Turn Detection (Smart Turn v2)
Goal: Replace fixed “500 ms of silence” heuristic with model-based phrase endpoint detection to reduce early cutoffs and latency between user end and assistant start.

- New Python microservice (or module inside STT service): `smart_turn_service.py`
  - Implements `POST /predict_endpoint` accepting 16 kHz PCM mono WAV/bytes for the most recent turn (8–16 seconds recommended).
  - Wraps Smart Turn v2 `predict_endpoint(audio_array)` and returns `{ prediction: 0|1, probability }`.
  - Reference: `https://github.com/pipecat-ai/smart-turn` (repo README, `predict.py`, `inference.py`).

- Integration modes:
  - Client-governed (initial): keep current record-stop on silence; upon upload, server runs Smart Turn. If `prediction=0` (incomplete), client can keep mic open (conversation mode) and continue accumulating audio (front-end tweak).
  - Server-governed (advanced): stream audio to server via WebSocket; server applies VAD+Smart Turn; signals client when endpoint is detected. (Optional v2 milestone.)

Env/config:
```
SMART_TURN_URL=http://localhost:8010
SMART_TURN_ENABLED=true
SMART_TURN_MIN_PROB=0.55
```

### 3) Speech-to-Text (Whisper Large v3 Turbo)
Goal: Offer higher accuracy/latency STT variants depending on platform.

- Keep Faster-Whisper path (Linux/GPU, CPU) in `whisper_service.py` and add `WHISPER_MODEL=large-v3-turbo` support where available.
- macOS/Apple Silicon (developer machines): provide alternative MLX-backed service (separate `whisper_service_mlx.py`) with Q4 quantization for speed. Keep API identical: `/transcribe_file`, `/transcribe_base64`.

Suggested envs:
```
WHISPER_BACKEND=faster|mlx
WHISPER_MODEL=large-v3-turbo
WHISPER_DEVICE=cpu|cuda|mps
WHISPER_COMPUTE_TYPE=int8_float16|int8|float16
```

References:
- Faster-Whisper project: `https://github.com/SYSTRAN/faster-whisper`
- (Background) Whisper Large v3 Turbo: `https://medium.com/axinc-ai/whisper-large-v3-turbo-high-accuracy-and-fast-speech-recognition-model-be2f6af77bdc`

### 4) Text-to-Speech (Kokoro TTS)
Goal: Add a high-quality, fast TTS option while preserving existing engines as fallbacks.

- Implement a `KokoroEngine` in `text-to-speech/tts_service.py` alongside existing engines (`Chatterbox`, `edge_tts`, `gtts`, `espeak`).
  - Load Kokoro model once on startup (ONNX or PyTorch) and expose via `/synthesize` with same params (`text`, `voice_id`, `speed`).
  - Provide minimal voice set initially; map our `voice_id` to Kokoro speaker presets.
  - Return WAV bytes to match existing response handling in `routes/voice.js`.

- Engine retention policy (requested):
  - Keep both **Chatterbox-TTS** and **Edge TTS** implemented as optional fallback engines.
  - Prefer Kokoro; if unavailable, try Chatterbox → Edge → eSpeak in that order (configurable).
  - In offline mode, Edge TTS is disabled automatically (it requires internet), but remains in code and can be re-enabled when online.
  - Chatterbox remains available when locally packaged; if misconfigured, the service will fall through to the next engine.

- Env toggles:
```
TTS_PRIMARY_ENGINE=kokoro|chatterbox|edge_tts
KOKORO_MODEL_PATH=/models/kokoro.onnx
KOKORO_SAMPLE_RATE=22050
```

References:
- Kokoro ONNX: `https://github.com/hexgrad/Kokoro-onnx`
- Kokoro model (HF): `https://huggingface.co/hexgrad/Kokoro-82M`

---

## Changes by File

### Server APIs
- `routes/voice.js`
  - No breaking API changes; continue posting recorded blob to `/api/voice/transcribe` and `/api/voice/chat`.
  - Optional: include `smart_turn=true` to request endpoint prediction; the server can include `{ endpoint_complete: true|false, probability }` in STT response for client logic.

### STT Service: `speech-to-text/whisper_service.py`
- Add optional Silero VAD pre-segmentation path:
  - If `VAD_ENABLED`, run VAD, form speech-only audio (or per-segment transcriptions) before calling Whisper.
  - Return segments with timestamps (already supported); optionally add `endpoint_complete` if calling Smart Turn.
- Add support for `WHISPER_MODEL=large-v3-turbo` and stricter compute types; document expectations.
- (Optional) Create `whisper_service_mlx.py` for macOS MLX Q4, mirroring the same API.

### Smart Turn Microservice (new): `smart-turn-service/` (Python)
- Endpoints:
```
POST /predict_endpoint
  body: WAV/PCM or JSON { audio_base64 }
  resp: { prediction: 0|1, probability: float }
```
- Internals: use repo `predict.py`/`inference.py` pattern to load model once and run `predict_endpoint(audio_array)`.
- Link: `https://github.com/pipecat-ai/smart-turn`

### TTS Service: `text-to-speech/tts_service.py`
- Add `KokoroEngine` class implementing the existing `TTSEngine` interface:
  - Load model on startup; map `voice_id` to Kokoro speaker config; synthesize PCM; return as WAV.
- Update `/engines` and `/voices` to list `kokoro` if available.

### Frontend: `frontend/src/components/VoiceAssistant.tsx`
- Keep current analyzer-based VAD for UX responsiveness.
- When server returns `endpoint_complete=false`, keep conversation mode recording alive (no stop) to accumulate a longer turn before sending.
- If `endpoint_complete=true`, proceed to TTS promptly (reduces latency/overlap).

---

## Configuration Matrix

### Env Vars (new)
```
# VAD
VAD_ENABLED=true
VAD_THRESHOLD=0.5
VAD_MIN_SPEECH_MS=200
VAD_MIN_SILENCE_MS=300

# Smart Turn
SMART_TURN_ENABLED=true
SMART_TURN_URL=http://smart-turn:8010
SMART_TURN_MIN_PROB=0.55

# STT
WHISPER_BACKEND=faster
WHISPER_MODEL=large-v3-turbo
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8_float16

# TTS
TTS_PRIMARY_ENGINE=kokoro
KOKORO_MODEL_PATH=/models/kokoro.onnx
KOKORO_SAMPLE_RATE=22050
DISABLE_EDGE_TTS=false          # set true only in offline/airgapped mode
ENABLE_CHATTERBOX=true          # keep implemented; disable if not packaged locally
```

---

## Rollout Plan

1) Enable toggles only; ship binaries/models via optional containers
- Docker-compose services:
  - `smart-turn-service` (port 8010)
  - `stt-service` variants: existing Faster-Whisper (default); optional MLX for macOS development
  - `tts-service` with Kokoro packaged and lazily loaded

2) Non-breaking integration
- Keep all existing endpoints stable
- If `SMART_TURN_ENABLED=false`, behavior remains as today
- If `VAD_ENABLED=false`, server transcribes full blobs as today

3) Benchmarks before/after
- Metrics to record (server logs + optional Prometheus):
  - End-to-end latency (speech end → TTS start)
  - STT WER on a small validation set (English + accented speech)
  - False endpoint rate (Smart Turn) during conversation mode
  - CPU/GPU utilization and peak RSS for each service

4) A/B switches (per session) via query/body flags
- Frontend can toggle `smart_turn` and `engine` in `/chat` body for side-by-side testing

5) Gradual enablement
- Dev → staging → production; start with Smart Turn logging-only mode (`predict` but don’t act) to calibrate thresholds

---

## Testing Strategy

- Unit
  - Silero VAD: verify segment timestamps on synthetic audio
  - Smart Turn: ensure correct returns for complete vs incomplete phrases; test language coverage claims
  - Kokoro TTS: generate audio; validate WAV headers, duration, clipping

- Integration
  - Conversation mode loops: “speak → listen → endpoint → respond” without cutoffs/overlaps
  - Long utterances with hesitations (“um… I think… maybe…”) – Smart Turn should delay endpoint
  - Noisy environments – Silero VAD should trim trailing noise; Whisper quality unchanged or improved

- UX acceptance
  - Subjective MOS-like rating on Kokoro vs existing voices
  - Interruptions: user speaks while TTS is playing; Smart Turn should help resume listening quickly

---

## Risks & Mitigations

- Model load times (Smart Turn, Kokoro)
  - Mitigate with warmup on startup and lazy model loading
- Platform differences (MLX/macOS vs Linux/GPU)
  - Keep Faster-Whisper as default; MLX as dev-only path with identical API
- Latency spikes from server-side VAD
  - Use modest frame sizes; pre-segment before Whisper to often reduce total time
- False endpoints
  - Start with `SMART_TURN_MIN_PROB ~0.55–0.65`; log outcomes; tune per locale

---

## Offline / Airgapped Mode

Objective: Run end-to-end STT → VAD + Turn Detection → LLM/RAG → TTS with zero external network dependency.

Operational switches:
```
OFFLINE_MODE=true

# RAG/LLM
OLLAMA_HOST=http://ollama:11434
OPENAI_API_KEY=   # unset
XAI_API_KEY=      # unset
DISABLE_CLOUD_FALLBACKS=true

# TTS
TTS_PRIMARY_ENGINE=kokoro   # local
DISABLE_EDGE_TTS=true       # Edge uses online service
DISABLE_GTTS=true           # gTTS is online

# STT
WHISPER_BACKEND=faster|mlx
VAD_ENABLED=true
SMART_TURN_ENABLED=true
```

Implementation notes:
- Model weights must be pre-bundled and loaded from disk; no runtime downloads:
  - Silero VAD: vendor the `.pt` (or ONNX) into `/models/silero_vad/` and load from local path (do not use `torch.hub`). `https://github.com/snakers4/silero-vad`
  - Smart Turn v2: vendor model files referenced by `inference.py` into `/models/smart_turn/` and load locally. `https://github.com/pipecat-ai/smart-turn`
  - Whisper: ship CTranslate2 models (Faster-Whisper) or MLX checkpoints in container/image under `/app/models/whisper/`; no network fetch on startup
  - Kokoro: ship ONNX (or Torch) checkpoints in `/models/kokoro/`

- Disable all cloud fallbacks in `helpers/alfred.js` when `OFFLINE_MODE` or `DISABLE_CLOUD_FALLBACKS` is set:
  - Do not call OpenAI/XAI; use only Ollama local
  - For content fetching, skip external `webUrl` retrieval when offline; rely on record data already indexed

- TTS service `text-to-speech/tts_service.py`:
  - Do not register `EdgeTTSEngine` and `GTTSEngine` when `OFFLINE_MODE=true`
  - Register `KokoroEngine`, `ChatterboxEngine` (if locally packaged), and `ESpeakEngine`

- Frontend/UI remains unchanged; all endpoints point to local services (`/api/voice/*`).

Validation checklist:
- Boot in an isolated network namespace; confirm all models load without network
- Generate voice chat: microphone → STT (local) → ALFRED (Ollama local) → TTS (Kokoro/eSpeak) with audio output
- Confirm logs show zero attempts to reach external hosts

---

## Concrete Next Steps

1) Smart Turn microservice (Python)
- Create `smart-turn-service` dir; vendor `model.py` + `inference.py` from repo; add `/predict_endpoint` FastAPI

2) STT service updates
- Add Silero VAD option to `whisper_service.py`
- Add `WHISPER_MODEL=large-v3-turbo` support and config surface for compute types

3) TTS service updates
- Implement `KokoroEngine` in `text-to-speech/tts_service.py`; add to `/voices` and `/engines`

4) Frontend glue
- Honor `endpoint_complete` in conversation mode; keep mic open if incomplete

5) Benchmark + tune
- Establish small scripted test set; log timestamps across pipeline; adjust thresholds

---

## Citations
- Smart Turn v2: `https://github.com/pipecat-ai/smart-turn`
- Silero VAD: `https://github.com/snakers4/silero-vad`
- Faster-Whisper: `https://github.com/SYSTRAN/faster-whisper`
- Whisper Large v3 Turbo (overview): `https://medium.com/axinc-ai/whisper-large-v3-turbo-high-accuracy-and-fast-speech-recognition-model-be2f6af77bdc`
- Kokoro TTS (ONNX): `https://github.com/hexgrad/Kokoro-onnx`


