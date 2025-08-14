## Implementing Alfred (Text and Voice Chat)

This guide explains how to integrate Alfred, the OIP RAG system, into another application for both text chat and voice chat. The other app can provide a record DID (didTx) to ask questions about that specific record; Alfred will fetch it with resolveDepth=2 and include all resolved sub‑records in the context (e.g., recipe ingredients → nutritional info, workouts → exercises).

### What Alfred Provides

- Intelligent question analysis and follow‑up understanding (uses conversation history)
- Record retrieval and context building (dynamic template schema + record‑type specific context)
- Single‑record mode via `pinnedDidTx` (bypasses search; uses resolveDepth=2)
- Optional TTS/STT endpoints for a full voice pipeline

### Prerequisites

- This OIP backend running (Node.js service) with:
  - Elasticsearch connected and loaded with templates/records
  - LLM service configured (Ollama via `OLLAMA_HOST`, or cloud keys via `OPENAI_API_KEY`/`XAI_API_KEY`)
- The following server endpoints available from this repository:
  - `POST /api/voice/chat` (primary, supports text, optional audio output)
  - `POST /api/voice/rag` (text-only RAG convenience, optional)
  - `POST /api/voice/transcribe` (optional STT)
  - `POST /api/voice/synthesize` (optional TTS)
  - `GET  /api/voice/voices` (optional voice list for TTS UI)

## API Overview

### 1) Chat (text, optional audio)

POST `/api/voice/chat`

Body (JSON):

```json
{
  "text": "Your question",
  "model": "llama3.2:3b",
  "return_audio": false,
  "include_filter_analysis": true,
  "pinnedDidTx": "did:arweave:...",              
  "conversationHistory": [                         
    {"role":"user","content":"..."},
    {"role":"assistant","content":"..."}
  ],
  "searchParams": {                                
    "recordType": "recipe",
    "limit": 10
  },
  "existingContext": [ /* optional pre-filtered records */ ],
  "voice_id": "female_expressive",                
  "speed": 1.0                                     
}
```

Notes:
- Provide `pinnedDidTx` for single‑record mode. The server will bypass search and answer about that record using `resolveDepth=2` and its resolved sub‑records.
- Always pass `conversationHistory` (last N messages) to improve follow‑up understanding (e.g., “how do I do that one?”). Shape: `{ role: 'user'|'assistant', content: string }`.
- Set `return_audio: true` to get base64 WAV audio in the response using the server’s TTS. Supply `voice_id` (get available voices via `/api/voice/voices`). If not set, text-only is returned.
- If you already know filters, pass `searchParams`. If a record is pinned, set `include_filter_analysis` to false (the server already forces this when `pinnedDidTx` is provided).

Response (JSON):

```json
{
  "success": true,
  "input_text": "...",
  "response_text": "...",                          
  "model_used": "llama3.2:3b",
  "has_audio": false,                               
  "engine_used": "chatterbox|espeak-fallback",    
  "audio_data": "BASE64_WAV_IF_has_audio",
  "sources": [ { "type":"record", "title":"...", "didTx":"...", "recordType":"recipe", ... } ],
  "context_used": true,
  "search_results_count": 1,
  "search_results": [ /* raw record objects */ ],
  "applied_filters": { "search":"...", "recordType":"...", ... }
}
```

### 2) Text-only RAG (simple)

POST `/api/voice/rag`

Same core behavior as `/chat` but no TTS handling. Use this if your app handles TTS/STT itself.

### 3) Optional STT and TTS

- STT: `POST /api/voice/transcribe` with a file form field named `file` (webm/mp3/wav/ogg). Returns `{ text, language, duration }`.
- TTS: `POST /api/voice/synthesize` with `{ text, voice_id, speed, gender, emotion, exaggeration, cfg_weight }` (Chatterbox service). Returns WAV audio bytes.
- Voices: `GET /api/voice/voices` → list of normalized voices you can show in a UI. Use one of these voice IDs as `voice_id` in `/chat` or `/synthesize`.

## Integration Patterns

### A) Single‑record Q&A (known didTx)

Use single‑record mode. Alfred loads the record with `resolveDepth=2`, then builds rich, type‑specific context (e.g., workout exercises, recipe nutrition, etc.).

```bash
curl -X POST http://localhost:3000/api/voice/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "What is the second exercise?",
    "pinnedDidTx": "did:arweave:Bg51hPL...",
    "include_filter_analysis": false,
    "conversationHistory": [
      {"role":"user","content":"Load the Lower Pull Strength Training workout"},
      {"role":"assistant","content":"Loaded. Ask me about it."}
    ]
  }'
```

If you need audio back, add `"return_audio": true, "voice_id": "en-GB-RyanNeural"`.

### B) General search + answer (no didTx)

```bash
curl -X POST http://localhost:3000/api/voice/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "Show me a grilled chicken recipe",
    "include_filter_analysis": true,
    "conversationHistory": [],
    "searchParams": { "recordType": "recipe", "limit": 10 }
  }'
```

### C) Full voice pipeline (client controls STT/TTS)

1) Transcribe microphone audio:

```bash
curl -X POST http://localhost:3000/api/voice/transcribe \
  -F "file=@/path/to/audio.webm"
```

2) Send recognized text to Alfred (no audio return):

```bash
curl -X POST http://localhost:3000/api/voice/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "how do i do the roll lat foam rolling?",
    "pinnedDidTx": "did:arweave:Bg51hPL...",
    "include_filter_analysis": false,
    "conversationHistory": [ {"role":"user","content":"What is the first exercise?"}, {"role":"assistant","content":"The first exercise is Roll Lat Foam Rolling."} ]
  }'
```

3) Synthesize TTS in your app (optional) using the returned text and your own engine—or call the server TTS:

```bash
curl -X POST http://localhost:3000/api/voice/synthesize \
  -H 'Content-Type: application/json' \
  -d '{ "text": "<answer from step 2>", "voice_id": "female_expressive", "speed": 1.0 }' \
  --output reply.wav
```

## Conversation History

- Always include recent turns in `conversationHistory` to support pronoun‑based follow‑ups. Example shape:

```json
[
  {"role":"user","content":"Does it include a warmup?"},
  {"role":"assistant","content":"Yes, it includes a warmup."},
  {"role":"user","content":"what's the first exercise?"},
  {"role":"assistant","content":"The first exercise is Roll Lat Foam Rolling."},
  {"role":"user","content":"how do i do that one?"}
]
```

Alfred uses this history during question analysis and response generation so the follow‑up “that one” resolves correctly.

## Record Context and Templates

- In single‑record mode Alfred:
  - Fetches the record with `resolveDepth=2`
  - Includes resolved sub‑records in the context (recipes → ingredient nutrition; workouts → exercise details)
  - Looks up the record type’s template schema (dynamic `fieldsInTemplate`) so the LLM understands field meanings
  - Adds record‑type specific context via `addRecordTypeSpecificContext()`

No extra work is needed client‑side beyond passing `pinnedDidTx` and `conversationHistory`.

## Minimal Client Code (Text)

```javascript
async function askAlfredText({ baseUrl, text, didTx, history }) {
  const body = {
    text,
    pinnedDidTx: didTx || undefined,
    include_filter_analysis: !didTx,
    conversationHistory: history || []
  };
  const res = await fetch(`${baseUrl}/api/voice/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Chat failed: ${res.status}`);
  return await res.json();
}
```

## Minimal Client Code (Voice with server TTS)

```javascript
async function askAlfredVoice({ baseUrl, text, didTx, history, voiceId = 'female_expressive' }) {
  const body = {
    text,
    pinnedDidTx: didTx || undefined,
    include_filter_analysis: !didTx,
    conversationHistory: history || [],
    return_audio: true,
    voice_id: voiceId
  };
  const res = await fetch(`${baseUrl}/api/voice/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Chat failed: ${res.status}`);
  const data = await res.json();
  if (data.has_audio && data.audio_data) {
    const audio = new Audio(`data:audio/wav;base64,${data.audio_data}`);
    audio.play();
  }
  return data;
}
```

## Error Handling Tips

- 408/504 on `/chat`: retry; service might be busy.
- If TTS fails, the response will still include text (`has_audio: false`).
- For STT/TTS services, timeouts are longer; handle AbortErrors on the client.

## Checklist

- Backend is up with Elasticsearch and LLM configured (Ollama or cloud keys)
- Your app knows the `didTx` for single‑record answers (optional but recommended)
- Always pass `conversationHistory` (last 4–8 messages)
- For audio replies, fetch available `voice_id`s from `/api/voice/voices`
- Use `/api/voice/chat` for both text and voice flows; or `/api/voice/rag` for text‑only

With these steps, your application can ask Alfred natural questions—by text or voice—and receive detailed, accurate answers grounded in the specific OIP record (and its resolved sub‑records) identified by the provided `didTx`.



## Voice UX Reference Implementation Details (from `public/reference-client.html`)

This section documents the exact reference implementation so you can replicate the same microphone → STT → ALFRED → TTS flow.

### Microphone capture and VAD (auto‑stop)

- User clicks the mic button, which toggles `startRecording()` / `stopRecording()`.
- `getUserMedia` constraints used:

```javascript
navigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    sampleRate: 16000
  }
});
```

- The stream is fed into a `MediaRecorder`:

```javascript
const mediaRecorder = new MediaRecorder(stream, {
  mimeType: 'audio/webm;codecs=opus'
});
```

- Chunks are collected in `ondataavailable`, and on `onstop` they are combined into a Blob:

```javascript
const audioBlob = new Blob(chunks, { type: 'audio/webm' });
```

- Voice Activity Detection (VAD) is implemented with a Web Audio `AnalyserNode` and simple RMS energy:
  - FFT size: 512
  - Polling interval: 100ms
  - Thresholds:
    - `minRecordingMs = 1500` (require at least 1.5s of audio before stopping on silence)
    - `silenceTimeoutMs = 2000` (silence duration to trigger stop)
    - `volumeThreshold = 0.12` (RMS threshold, 0–1, above means speech / below means silence)
  - Pseudocode:

```javascript
if (rms > volumeThreshold) {
  lastSpeechTime = Date.now();
  listening = true; clear silence timeout;
} else {
  if (Date.now() - (lastSpeechTime || Date.now()) > minRecordingMs) {
    if (!silenceTimeout) silenceTimeout = setTimeout(stopRecording, silenceTimeoutMs);
  }
  listening = false;
}
```

Result: The recorder auto‑stops shortly after the user stops speaking.

### STT request (speech to text)

- After recording stops, the client posts the captured audio to the server’s STT endpoint.
- Request content type: `multipart/form-data`.
- Fields:
  - `audio`: file Blob of type `audio/webm` (Opus codec)
  - `language` (optional): two‑letter code or `auto`
- Example:

```http
POST /api/voice/transcribe
Content-Type: multipart/form-data

audio=@recording.webm;type=audio/webm
language=en
```

- Response JSON:

```json
{
  "success": true,
  "text": "transcribed text",
  "language": "en",
  "duration": 3.25,
  "segments": [ ]
}
```

The client immediately displays the text, places it in the chat input, and sends it to `/api/voice/chat` (see Chat section above).

### Chat call (reference client usage)

- For both typed and transcribed text, the client calls `/api/voice/chat` with JSON.
- In the reference client, `return_audio` is set to `false` and TTS is done in a separate call (see below). You can also set `return_audio: true` and skip the separate TTS step.
- Follow‑ups (when one record is loaded) send:

```json
{
  "text": "...",
  "model": "llama3.2:3b",
  "return_audio": false,
  "include_filter_analysis": false,
  "is_follow_up": true,
  "conversation_context": [ {"role":"user","content":"..."}, ... ],
  "existing_search_results": [ /* 1 record or prior results */ ],
  "pinnedDidTx": "did:arweave:..."
}
```

- New questions (no pin) send:

```json
{
  "text": "...",
  "model": "llama3.2:3b",
  "return_audio": false,
  "include_filter_analysis": true,
  "is_follow_up": false,
  "searchParams": { "recordType": "recipe" }
}
```

Recommendation: Prefer `conversationHistory` (array) on all `/chat` calls. The server accepts both.

### TTS synthesis (three engines)

The reference client synthesizes speech after it gets the AI answer, using the selected engine. All engines ultimately play an `audio/wav` or browser‑compatible audio Blob.

#### Chatterbox engine

- Endpoint: `POST /api/voice/synthesize`
- Request: `multipart/form-data`
- Fields:
  - `text`: answer string
  - `voice_id`: one of the Chatterbox voice IDs (see `/api/voice/voices`)
  - `engine`: `chatterbox`
  - `exaggeration`: float 0–1 (emotion)
  - `cfg_weight`: float 0–1 (pacing)
- Response: `audio/wav` bytes (Blob in the browser)

```javascript
const fd = new FormData();
fd.append('text', answer);
fd.append('voice_id', selectedVoiceId);
fd.append('exaggeration', String(emotion));
fd.append('cfg_weight', String(pacing));
fd.append('engine', 'chatterbox');
const res = await fetch('/api/voice/synthesize', { method: 'POST', body: fd });
const audioBlob = await res.blob();
```

#### Edge TTS engine

- Endpoint: `POST /api/voice/synthesize`
- Request: `multipart/form-data`
- Fields:
  - `text`
  - `voice_id`: e.g., `en-GB-RyanNeural`
  - `engine`: `edge_tts`
  - `speed`: float (e.g., `1.0`)
  - `exaggeration` and `cfg_weight` are passed for compatibility; server maps to pitch/volume where applicable
- Response: `audio/wav` bytes

```javascript
const fd = new FormData();
fd.append('text', answer);
fd.append('engine', 'edge_tts');
fd.append('voice_id', voiceConfig.edge.selectedVoice);
fd.append('speed', String(voiceConfig.edge.speed));
// Compatibility fields (server maps):
fd.append('exaggeration', String(voiceConfig.edge.pitch / 10 + 0.5));
fd.append('cfg_weight', String(voiceConfig.edge.volume / 20 + 0.5));
```

#### ElevenLabs engine

- Endpoint: `POST /api/voice/elevenlabs/:voiceId/synthesize`
- Request: JSON

```json
{
  "text": "...",
  "voice_settings": {
    "stability": 0.5,
    "similarity_boost": 0.75,
    "style": 0.0,
    "use_speaker_boost": true
  },
  "model_id": "eleven_turbo_v2"
}
```

- Response: MP3 bytes (the route returns audio/mp3)

### Voice list

- `GET /api/voice/voices` returns a normalized list combining engines. Example item:

```json
{ "id": "en-GB-RyanNeural", "name": "Edge Ryan (UK Male)", "engine": "Edge TTS", "gender": "male", "language": "en-GB" }
```

Use this list to populate your voice selector; send the selected `id` as `voice_id` for Chatterbox/Edge flows, or as the `:voiceId` path segment for ElevenLabs.

### Playback

- Reference client converts the response body to a Blob and plays it via an `Audio` element:

```javascript
const audioUrl = URL.createObjectURL(audioBlob);
const audio = new Audio(audioUrl);
await audio.play();
```

Alternatively, when using `/api/voice/chat` with `return_audio: true`, the server responds with base64 WAV in `audio_data`; you can create a data URL and play it.

### Error/timeout handling

- STT: if the request fails, UI shows “Speech transcription failed.”
- TTS: if the selected engine fails, the client falls back to Chatterbox when possible.
- Chat: treat 408/504 as temporary; retry.

### End‑to‑end sequence (reference)

1. User clicks mic; `MediaRecorder` starts with `audio/webm;codecs=opus`.
2. VAD monitors RMS; after silence ≥ 2s (and recording ≥ 1.5s), `MediaRecorder.stop()` fires.
3. Blob `audio/webm` is posted as `audio` to `/api/voice/transcribe` → JSON `{ text, language, duration }`.
4. The transcribed text is added to the conversation and sent to `/api/voice/chat` (with `pinnedDidTx` if provided, and conversation context/history).
5. The answer text is then synthesized via the selected TTS engine (Chatterbox/Edge/ElevenLabs) and played.

This mirrors the behavior in `public/reference-client.html` so your app will match the demo UX exactly.

