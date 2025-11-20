# Converse Custom API - Complete Guide

## Quick Navigation
- [Overview](#overview)
- [Quick Start](#quick-start)
- [Complete API Reference](#complete-api-reference)
- [Response Format & Data Flow](#response-format--data-flow)
- [Client Implementation Guide](#client-implementation-guide)
- [Usage Examples](#usage-examples)
- [Use Cases & Patterns](#use-cases--patterns)
- [Troubleshooting](#troubleshooting)

---

## Overview

The `/api/voice/converse-custom` endpoint provides complete customization of ALFRED's conversation pipeline while maintaining all the well-tuned functionality of the voice processing system. This endpoint is designed for building custom AI applications with full control over behavior, models, output formats, and response characteristics.

### What Makes It Different

This endpoint differs from the standard `/converse` endpoint by providing:

| Feature | Standard `/converse` | `/converse-custom` |
|---------|---------------------|-------------------|
| **System Prompt** | Fixed ALFRED personality | ✅ Fully customizable |
| **LLM Selection** | Limited (RAG/LLM modes) | ✅ Full control + parallel racing |
| **Output Mode** | Voice only | ✅ Voice OR text-only |
| **Response Length** | Fixed | ✅ 5 presets + custom tokens |
| **Voice Selection** | Limited | ✅ All ElevenLabs voices |
| **Context Injection** | Via RAG search | ✅ Direct OIP record DID |
| **Best For** | General Q&A with data | Custom AI applications |

### Key Capabilities

- 🎭 **Custom AI Personalities** - Define exactly how the AI should behave
- ⚡ **Parallel Model Racing** - Get fastest response from 4 models simultaneously
- 📏 **Precise Length Control** - From 1-sentence answers to detailed essays
- 🎤 **Voice Customization** - Choose any ElevenLabs voice or use text-only
- 📚 **Direct Context Injection** - Provide specific OIP records as context
- 🔄 **Real-time Streaming** - SSE delivery of text and audio chunks
- 📊 **Performance Metrics** - Detailed timing information for optimization

---

## Quick Start

### Minimal Example (Text Response)

```javascript
// Step 1: Send request
const formData = new FormData();
formData.append('userPrompt', 'What is quantum computing?');
formData.append('model', 'parallel');
formData.append('outputMode', 'text');
formData.append('targetResponseLength', 'short');

const response = await fetch('http://localhost:3000/api/voice/converse-custom', {
    method: 'POST',
    body: formData
});

const { dialogueId } = await response.json();

// Step 2: Connect to SSE stream
const eventSource = new EventSource(
    `http://localhost:3000/api/voice/open-stream?dialogueId=${dialogueId}`
);

// Step 3: Handle streaming text
eventSource.addEventListener('textChunk', (event) => {
    const data = JSON.parse(event.data);
    if (data.role === 'assistant') {
        console.log(data.text); // Real-time text chunks
    }
});

// Step 4: Handle completion
eventSource.addEventListener('done', (event) => {
    const data = JSON.parse(event.data);
    console.log('Complete!', data.processing_metrics);
    eventSource.close();
});
```

### Response Time

- **Parallel text mode**: 2-10 seconds (typical: 3-5s)
- **Specific model text**: 3-20 seconds
- **Voice mode**: +2-5 seconds for TTS

---

## Complete API Reference

### Endpoint

```
POST /api/voice/converse-custom
Content-Type: multipart/form-data
```

### Request Parameters

#### Required (One of)

| Parameter | Type | Description |
|-----------|------|-------------|
| `userPrompt` | string | The user's input text. **Required if no audio file provided.** |
| `audio` | File | Audio file for speech-to-text transcription (webm, wav, mp3, ogg). **Required if no userPrompt provided.** Max size: 10MB. |

#### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `systemPrompt` | string | Default ALFRED prompt | Defines AI personality and behavior. Max 2000 characters recommended. |
| `model` | string | `"parallel"` | LLM to use. Options: `"parallel"`, `"gpt-4o-mini"`, `"gpt-4o"`, `"grok-beta"`, `"mistral:latest"`, `"llama3.2:3b"`, etc. |
| `outputMode` | string | `"voice"` | Output format. Options: `"voice"` (text + audio) or `"text"` (text only). |
| `targetResponseLength` | string | `"medium"` | Response length. Options: `"short"`, `"medium"`, `"long"`, `"detailed"`, `"custom"`. |
| `customMaxTokens` | number | - | Custom token limit (only used when `targetResponseLength="custom"`). |
| `oipRecordDid` | string | - | OIP record DID to inject as context (e.g., `"did:arweave:abc123..."`). Full record data will be provided to the LLM. |
| `elevenlabsVoiceId` | string | `"onwK4e9ZLuTAKqWW03F9"` | ElevenLabs voice ID to use for TTS (only used in voice mode with ElevenLabs). |
| `voiceConfig` | string (JSON) | Default config | Advanced voice configuration (JSON string). See [Voice Configuration](#voice-configuration) section. |
| `dialogueId` | string | Auto-generated | Optional custom dialogue ID. If not provided, one will be generated. |

### Parameter Details

#### `model` Options

**Parallel Mode (Recommended for Speed)**
```javascript
model: "parallel"
```
Races 4 models simultaneously - first to complete wins:
- ✅ OpenAI GPT-4o-mini (if `OPENAI_API_KEY` set)
- ✅ XAI Grok-beta (if `XAI_API_KEY` set)
- ✅ Ollama Mistral 7B
- ✅ Ollama LLaMA (configured via `DEFAULT_LLM_MODEL` env var)

**Specific Models**

OpenAI:
- `"gpt-4o-mini"` - Fast, cost-effective
- `"gpt-4o"` - Most capable
- `"gpt-4-turbo"` - Fast GPT-4

XAI/Grok:
- `"grok-beta"` - Latest Grok model
- `"grok-4"` - Grok-4 model

Ollama (local):
- `"llama3.2:3b"` - Fast, compact
- `"mistral:latest"` - Balanced performance
- `"llama2:7b"` - Alternative option
- Any other Ollama model name

#### `targetResponseLength` Options

| Value | Tokens | Sentences | Best For |
|-------|--------|-----------|----------|
| `"short"` | 150 | 1-2 | Quick answers, confirmations |
| `"medium"` | 512 | 2-4 | Standard conversation |
| `"long"` | 1500 | 5-10 | Detailed explanations |
| `"detailed"` | 2000 | 10-15 | Comprehensive analysis |
| `"custom"` | Your value | Variable | Specific requirements (set `customMaxTokens`) |

#### `elevenlabsVoiceId` Options

Popular ElevenLabs voices (requires `ELEVENLABS_API_KEY`):

**Male Voices:**
- `"onwK4e9ZLuTAKqWW03F9"` - Daniel (British, Professional) **[DEFAULT]**
- `"pNInz6obpgDQGcFmaJgB"` - Adam (Deep, Authoritative)
- `"VR6AewLTigWG4xSOukaG"` - Arnold (Crisp, Clear)
- `"rrnzWnb1k1hLVqzwuuGl"` - Jeremy (American, Casual)
- `"JBFqnCBsd6RMkjVDRZzb"` - George (Raspy, Character)

**Female Voices:**
- `"EXAVITQu4vr4xnSDxMaL"` - Bella (Sweet, Warm)
- `"pMsXgVXv3BLzUgSXRplE"` - Freya (Conversational, Friendly)
- `"cgSgspJ2msm6clMCkdW9"` - Jessica (Expressive, Versatile)
- `"YEUXwZHP2c25CNI7A3tf"` - Charlotte (Smooth, Professional)
- `"oWAxZDx7w5VEj9dCyTzz"` - Grace (Calm, Soothing)

See [ElevenLabs Voice Library](https://elevenlabs.io/voice-library) for complete list.

**Note**: If `ELEVENLABS_API_KEY` is not configured, the system will fall back to Edge TTS or local TTS engines.

#### `systemPrompt` Best Practices

The system prompt defines the AI's personality and behavior. Make it specific and clear:

**Good Examples:**
```
"You are a professional fitness coach. Provide motivational, practical advice 
with specific exercises and rep counts. Keep responses encouraging and actionable."

"You are a senior software engineer specializing in JavaScript. Explain concepts 
clearly with code examples. Use modern ES6+ syntax. Format code in plain text 
without markdown."

"You are a friendly librarian helping patrons find books. Ask clarifying questions 
about their interests and provide thoughtful recommendations. Keep responses warm 
and conversational."
```

**Structure Tips:**
1. Define role/expertise
2. Set tone (professional, friendly, technical, etc.)
3. Specify format preferences
4. Add behavioral guidelines
5. Note any constraints (no emojis, no markdown, etc.)

---

## Response Format & Data Flow

### Phase 1: Initial Response (Immediate)

The endpoint returns immediately with a dialogue ID:

```json
{
  "success": true,
  "dialogueId": "custom-dialogue-1699564321789-abc123def",
  "configuration": {
    "model": "parallel",
    "outputMode": "voice",
    "targetResponseLength": "medium",
    "maxTokens": 512
  }
}
```

**What to do with this:**
1. Extract the `dialogueId`
2. Use it to connect to the SSE stream
3. Store it if you need to reference this conversation later

### Phase 2: SSE Stream Connection

Connect to the Server-Sent Events stream:

```javascript
const eventSource = new EventSource(
    `http://localhost:3000/api/voice/open-stream?dialogueId=${dialogueId}`
);
```

**Important**: The stream connection must be established quickly (within ~5 seconds) after receiving the dialogueId, or you may miss early events.

### Phase 3: Streaming Events

The stream will send multiple event types. Here's the complete data flow:

#### Event 1: User Message Echo

First, your input is echoed back:

```javascript
{
  "type": "textChunk",
  "role": "user",
  "text": "What is quantum computing?"
}
```

**Purpose**: Confirms what was transcribed (if audio) or received (if text).

#### Event 2: Assistant Text Chunks (Multiple)

The AI's response streams in real-time, word by word:

```javascript
// Chunk 1
{
  "type": "textChunk",
  "role": "assistant",
  "text": "Quantum computing is"
}

// Chunk 2
{
  "type": "textChunk",
  "role": "assistant",
  "text": " a revolutionary technology"
}

// Chunk 3
{
  "type": "textChunk",
  "role": "assistant",
  "text": " that uses quantum"
}
// ... continues until complete
```

**How to handle:**
- Append each `text` value to build the full response
- Display in real-time for live streaming effect
- Or collect all chunks and display when complete

**Text Chunking Pattern**: Chunks typically contain 3 words + space, sent with 50ms delays for smooth streaming.

#### Event 3: Audio Chunks (Voice Mode Only)

If `outputMode: "voice"`, you'll also receive audio chunks:

```javascript
// Chunk 1
{
  "type": "audioChunk",
  "audio": "UklGRiQAAABXQVZFZm10IBAAA...", // Base64-encoded WAV audio
  "chunkIndex": 0,
  "text": "Quantum computing is a revolutionary technology",
  "isFinal": false,
  "adaptive": true
}

// Chunk 2
{
  "type": "audioChunk",
  "audio": "UklGRiQAAABXQVZFZm10IBAAA...",
  "chunkIndex": 1,
  "text": "that uses quantum mechanical phenomena",
  "isFinal": false,
  "adaptive": true
}

// Final chunk
{
  "type": "audioChunk",
  "audio": "UklGRiQAAABXQVZFZm10IBAAA...",
  "chunkIndex": 5,
  "text": "to process information.",
  "isFinal": true,
  "adaptive": true
}
```

**Audio Data Format:**
- `audio`: Base64-encoded string containing WAV audio data
- `chunkIndex`: Sequential index starting from 0
- `text`: The text that was synthesized into this audio chunk
- `isFinal`: Boolean indicating if this is the last audio chunk
- `adaptive`: Boolean indicating adaptive streaming was used

**How to Play Audio Chunks Correctly:**

```javascript
// Option 1: Sequential playback (RECOMMENDED)
const audioChunks = [];

eventSource.addEventListener('audioChunk', (event) => {
    const data = JSON.parse(event.data);
    
    // Store chunks in order
    audioChunks[data.chunkIndex] = data.audio;
    
    // Decode and play
    const audioData = atob(data.audio); // Decode base64
    const audioBuffer = new Uint8Array(audioData.length);
    for (let i = 0; i < audioData.length; i++) {
        audioBuffer[i] = audioData.charCodeAt(i);
    }
    
    // Create blob and play
    const blob = new Blob([audioBuffer], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    
    const audio = new Audio(url);
    audio.play();
    
    // Important: Wait for current audio to finish before playing next chunk
    audio.onended = () => {
        URL.revokeObjectURL(url); // Clean up
    };
});
```

```javascript
// Option 2: Queue-based playback (SMOOTHER)
class AudioQueue {
    constructor() {
        this.queue = [];
        this.isPlaying = false;
    }
    
    add(audioBase64) {
        this.queue.push(audioBase64);
        if (!this.isPlaying) {
            this.playNext();
        }
    }
    
    async playNext() {
        if (this.queue.length === 0) {
            this.isPlaying = false;
            return;
        }
        
        this.isPlaying = true;
        const audioBase64 = this.queue.shift();
        
        // Decode base64 to audio
        const audioData = atob(audioBase64);
        const audioBuffer = new Uint8Array(audioData.length);
        for (let i = 0; i < audioData.length; i++) {
            audioBuffer[i] = audioData.charCodeAt(i);
        }
        
        const blob = new Blob([audioBuffer], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        
        await new Promise((resolve) => {
            audio.onended = () => {
                URL.revokeObjectURL(url);
                resolve();
            };
            audio.play();
        });
        
        this.playNext(); // Play next chunk
    }
}

// Usage
const audioQueue = new AudioQueue();

eventSource.addEventListener('audioChunk', (event) => {
    const data = JSON.parse(event.data);
    audioQueue.add(data.audio);
});
```

**Critical Audio Playback Rules:**

1. **Preserve Order**: Always use `chunkIndex` to ensure correct order
2. **Sequential Playback**: Play chunks one at a time, waiting for each to finish
3. **No Overlap**: Don't play multiple chunks simultaneously
4. **Clean Up**: Revoke object URLs after playback to prevent memory leaks
5. **Handle isFinal**: Use `isFinal: true` to know when all audio is complete

#### Event 4: Completion

Final event with metrics and summary:

```javascript
{
  "type": "done",
  "data": "Custom conversation complete",
  "processing_metrics": {
    "stt_time_ms": 850,      // Speech-to-text (if audio input)
    "llm_time_ms": 3200,     // LLM processing
    "tts_time_ms": 1500,     // Text-to-speech (if voice mode)
    "total_time_ms": 5550    // Total pipeline time
  },
  "configuration": {
    "model": "parallel",
    "outputMode": "voice",
    "targetResponseLength": "medium",
    "maxTokens": 512
  },
  "response_length": 342,    // Total characters in response
  "timestamp": "2025-11-09T12:34:56.789Z"
}
```

**What to do:**
- Close the EventSource connection
- Display completion status to user
- Log metrics for performance monitoring
- Clean up any resources

#### Event 5: Errors (If Any)

```javascript
{
  "type": "error",
  "data": {
    "message": "Failed to get response from gpt-4o-mini"
  }
}
```

**Error Handling:**
```javascript
eventSource.addEventListener('error', (event) => {
    const data = JSON.parse(event.data);
    console.error('Error:', data.message);
    eventSource.close();
    // Show error UI to user
});
```

### Complete Data Flow Diagram

```
Client                              Server
  │                                   │
  ├─── POST /converse-custom ────────>│
  │    (userPrompt, model, etc)       │
  │                                   │
  │<─── {dialogueId, config} ─────────┤ (Immediate)
  │                                   │
  ├─── GET /open-stream?id=... ──────>│
  │                                   │
  │<─── type: textChunk (user) ───────┤
  │<─── type: textChunk (assistant) ──┤ (Streaming)
  │<─── type: textChunk (assistant) ──┤ (Multiple)
  │<─── type: audioChunk (0) ─────────┤ (If voice mode)
  │<─── type: audioChunk (1) ─────────┤ (Sequential)
  │<─── type: audioChunk (2) ─────────┤
  │<─── type: done (metrics) ─────────┤ (Final)
  │                                   │
  └─── close connection ──────────────┤
```

---

## Client Implementation Guide

### Complete JavaScript/TypeScript Example

```typescript
interface ConversationConfig {
    userPrompt?: string;
    audio?: File;
    systemPrompt?: string;
    model?: string;
    outputMode?: 'voice' | 'text';
    targetResponseLength?: 'short' | 'medium' | 'long' | 'detailed' | 'custom';
    customMaxTokens?: number;
    oipRecordDid?: string;
    elevenlabsVoiceId?: string;
}

interface TextChunk {
    type: 'textChunk';
    role: 'user' | 'assistant';
    text: string;
}

interface AudioChunk {
    type: 'audioChunk';
    audio: string;
    chunkIndex: number;
    text: string;
    isFinal: boolean;
    adaptive: boolean;
}

interface DoneEvent {
    type: 'done';
    data: string;
    processing_metrics: {
        stt_time_ms: number;
        llm_time_ms: number;
        tts_time_ms: number;
        total_time_ms: number;
    };
    configuration: any;
    response_length: number;
    timestamp: string;
}

class CustomConversationClient {
    private baseUrl: string;
    private eventSource: EventSource | null = null;
    
    constructor(baseUrl: string = 'http://localhost:3000') {
        this.baseUrl = baseUrl;
    }
    
    async startConversation(config: ConversationConfig): Promise<string> {
        // Build form data
        const formData = new FormData();
        
        if (config.userPrompt) {
            formData.append('userPrompt', config.userPrompt);
        } else if (config.audio) {
            formData.append('audio', config.audio);
        } else {
            throw new Error('Either userPrompt or audio is required');
        }
        
        if (config.systemPrompt) {
            formData.append('systemPrompt', config.systemPrompt);
        }
        
        formData.append('model', config.model || 'parallel');
        formData.append('outputMode', config.outputMode || 'text');
        formData.append('targetResponseLength', config.targetResponseLength || 'medium');
        
        if (config.customMaxTokens) {
            formData.append('customMaxTokens', config.customMaxTokens.toString());
        }
        
        if (config.oipRecordDid) {
            formData.append('oipRecordDid', config.oipRecordDid);
        }
        
        if (config.elevenlabsVoiceId) {
            formData.append('elevenlabsVoiceId', config.elevenlabsVoiceId);
        }
        
        // Send request
        const response = await fetch(`${this.baseUrl}/api/voice/converse-custom`, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Request failed');
        }
        
        const result = await response.json();
        
        if (!result.success) {
            throw new Error('Request was not successful');
        }
        
        return result.dialogueId;
    }
    
    connectToStream(
        dialogueId: string,
        callbacks: {
            onText?: (text: string, role: 'user' | 'assistant') => void;
            onAudio?: (audio: AudioChunk) => void;
            onComplete?: (metrics: DoneEvent) => void;
            onError?: (error: string) => void;
        }
    ): EventSource {
        this.eventSource = new EventSource(
            `${this.baseUrl}/api/voice/open-stream?dialogueId=${dialogueId}`
        );
        
        // Handle text chunks
        this.eventSource.addEventListener('textChunk', (event: MessageEvent) => {
            const data: TextChunk = JSON.parse(event.data);
            if (callbacks.onText) {
                callbacks.onText(data.text, data.role);
            }
        });
        
        // Handle audio chunks
        this.eventSource.addEventListener('audioChunk', (event: MessageEvent) => {
            const data: AudioChunk = JSON.parse(event.data);
            if (callbacks.onAudio) {
                callbacks.onAudio(data);
            }
        });
        
        // Handle completion
        this.eventSource.addEventListener('done', (event: MessageEvent) => {
            const data: DoneEvent = JSON.parse(event.data);
            if (callbacks.onComplete) {
                callbacks.onComplete(data);
            }
            this.eventSource?.close();
        });
        
        // Handle errors
        this.eventSource.addEventListener('error', (event: MessageEvent) => {
            try {
                const data = JSON.parse(event.data);
                if (callbacks.onError) {
                    callbacks.onError(data.message);
                }
            } catch (e) {
                if (callbacks.onError) {
                    callbacks.onError('Connection error');
                }
            }
            this.eventSource?.close();
        });
        
        return this.eventSource;
    }
    
    disconnect() {
        this.eventSource?.close();
        this.eventSource = null;
    }
}

// Usage Example
async function example() {
    const client = new CustomConversationClient();
    
    // Start conversation
    const dialogueId = await client.startConversation({
        userPrompt: 'Explain neural networks',
        systemPrompt: 'You are a computer science professor. Explain clearly with examples.',
        model: 'parallel',
        outputMode: 'voice',
        targetResponseLength: 'long',
        elevenlabsVoiceId: 'onwK4e9ZLuTAKqWW03F9' // Daniel voice
    });
    
    // Audio queue for smooth playback
    const audioQueue = new AudioQueue();
    let fullText = '';
    
    // Connect to stream
    client.connectToStream(dialogueId, {
        onText: (text, role) => {
            if (role === 'assistant') {
                fullText += text;
                displayText(text); // Your display function
            }
        },
        
        onAudio: (audioChunk) => {
            audioQueue.add(audioChunk.audio);
        },
        
        onComplete: (metrics) => {
            console.log('Complete!', metrics);
            console.log('Full response:', fullText);
        },
        
        onError: (error) => {
            console.error('Error:', error);
        }
    });
}
```

### Python Implementation

```python
import requests
import sseclient
import json
import base64
from typing import Callable, Optional

class CustomConversationClient:
    def __init__(self, base_url: str = "http://localhost:3000"):
        self.base_url = base_url
    
    def start_conversation(
        self,
        user_prompt: Optional[str] = None,
        audio_file: Optional[str] = None,
        system_prompt: Optional[str] = None,
        model: str = "parallel",
        output_mode: str = "text",
        target_response_length: str = "medium",
        custom_max_tokens: Optional[int] = None,
        oip_record_did: Optional[str] = None,
        elevenlabs_voice_id: str = "onwK4e9ZLuTAKqWW03F9"
    ) -> str:
        """Start a custom conversation and return dialogue ID"""
        
        # Build request data
        data = {
            'model': model,
            'outputMode': output_mode,
            'targetResponseLength': target_response_length,
            'elevenlabsVoiceId': elevenlabs_voice_id
        }
        
        files = {}
        
        if user_prompt:
            data['userPrompt'] = user_prompt
        elif audio_file:
            files['audio'] = open(audio_file, 'rb')
        else:
            raise ValueError("Either user_prompt or audio_file is required")
        
        if system_prompt:
            data['systemPrompt'] = system_prompt
        
        if custom_max_tokens:
            data['customMaxTokens'] = custom_max_tokens
        
        if oip_record_did:
            data['oipRecordDid'] = oip_record_did
        
        # Send request
        response = requests.post(
            f"{self.base_url}/api/voice/converse-custom",
            data=data,
            files=files if files else None
        )
        
        response.raise_for_status()
        result = response.json()
        
        if not result.get('success'):
            raise Exception("Request was not successful")
        
        return result['dialogueId']
    
    def stream_conversation(
        self,
        dialogue_id: str,
        on_text: Optional[Callable[[str, str], None]] = None,
        on_audio: Optional[Callable[[dict], None]] = None,
        on_complete: Optional[Callable[[dict], None]] = None,
        on_error: Optional[Callable[[str], None]] = None
    ):
        """Connect to SSE stream and handle events"""
        
        stream_url = f"{self.base_url}/api/voice/open-stream?dialogueId={dialogue_id}"
        messages = sseclient.SSEClient(stream_url)
        
        try:
            for msg in messages:
                if not msg.data:
                    continue
                
                data = json.loads(msg.data)
                event_type = data.get('type')
                
                if event_type == 'textChunk' and on_text:
                    on_text(data['text'], data['role'])
                
                elif event_type == 'audioChunk' and on_audio:
                    on_audio(data)
                
                elif event_type == 'done' and on_complete:
                    on_complete(data)
                    break
                
                elif event_type == 'error' and on_error:
                    on_error(data.get('data', {}).get('message', 'Unknown error'))
                    break
        
        except Exception as e:
            if on_error:
                on_error(str(e))

# Usage Example
if __name__ == "__main__":
    client = CustomConversationClient()
    
    # Start conversation
    dialogue_id = client.start_conversation(
        user_prompt="Explain quantum computing",
        system_prompt="You are a physics professor. Use simple analogies.",
        model="parallel",
        output_mode="text",
        target_response_length="medium"
    )
    
    print(f"Started conversation: {dialogue_id}")
    print("\nResponse:")
    
    full_text = []
    
    # Stream the response
    client.stream_conversation(
        dialogue_id,
        on_text=lambda text, role: (
            full_text.append(text) if role == 'assistant' else None,
            print(text, end='', flush=True)
        ),
        on_complete=lambda metrics: print(f"\n\nComplete! Metrics: {metrics['processing_metrics']}"),
        on_error=lambda error: print(f"\nError: {error}")
    )
```

---

## Usage Examples

### Example 1: Quick Text Answer

```javascript
const formData = new FormData();
formData.append('userPrompt', 'What is quantum computing in one sentence?');
formData.append('model', 'parallel');
formData.append('outputMode', 'text');
formData.append('targetResponseLength', 'short');

// Typical response time: 2-5 seconds
// Typical response: 1-2 sentences (~50-100 chars)
```

### Example 2: Custom AI Character (Pirate)

```javascript
const formData = new FormData();
formData.append('userPrompt', 'Tell me about sailing');
formData.append('systemPrompt', 
    'You are Captain Blackbeard, a legendary pirate. ' +
    'Speak in pirate dialect with "arr" and nautical terms. ' +
    'Be friendly but maintain pirate character. No emojis.'
);
formData.append('model', 'gpt-4o-mini');
formData.append('outputMode', 'voice');
formData.append('targetResponseLength', 'medium');
formData.append('elevenlabsVoiceId', 'JBFqnCBsd6RMkjVDRZzb'); // George - Raspy voice
```

### Example 3: Detailed Technical Explanation

```javascript
const formData = new FormData();
formData.append('userPrompt', 'Explain how React hooks work');
formData.append('systemPrompt',
    'You are a senior React developer. Provide detailed technical ' +
    'explanations with code examples in plain text. Use modern React ' +
    'patterns and best practices.'
);
formData.append('model', 'parallel');
formData.append('outputMode', 'text');
formData.append('targetResponseLength', 'detailed');
```

### Example 4: OIP Record Analysis

```javascript
const formData = new FormData();
formData.append('userPrompt', 'Summarize the key points of this article');
formData.append('systemPrompt',
    'You are a professional content curator. Provide concise summaries ' +
    'highlighting main themes, key facts, and conclusions.'
);
formData.append('oipRecordDid', 'did:arweave:YOUR_RECORD_DID');
formData.append('model', 'gpt-4o-mini');
formData.append('outputMode', 'text');
formData.append('targetResponseLength', 'medium');
```

### Example 5: Voice with Audio Input

```javascript
// User records audio question
const audioBlob = await recordAudio(); // Your recording function

const formData = new FormData();
formData.append('audio', audioBlob, 'question.webm');
formData.append('systemPrompt', 'You are a helpful voice assistant.');
formData.append('model', 'parallel');
formData.append('outputMode', 'voice');
formData.append('targetResponseLength', 'medium');
formData.append('elevenlabsVoiceId', 'EXAVITQu4vr4xnSDxMaL'); // Bella - Female voice
```

### Example 6: Custom Length Control

```javascript
const formData = new FormData();
formData.append('userPrompt', 'Write a haiku about AI');
formData.append('systemPrompt', 'You are a poet. Write beautiful, meaningful haiku.');
formData.append('model', 'grok-beta');
formData.append('outputMode', 'text');
formData.append('targetResponseLength', 'custom');
formData.append('customMaxTokens', '100');
```

---

## Use Cases & Patterns

### 1. Custom AI Characters

Perfect for creating distinct AI personalities:

**Fitness Coach**
```javascript
systemPrompt: "You are an enthusiastic fitness coach named Alex. Provide motivational, practical advice with specific exercises and rep counts. Keep responses encouraging and actionable. End with a motivational quote."
```

**Medieval Scholar**
```javascript
systemPrompt: "You are a learned scholar from medieval times. Speak in formal, archaic English. Explain modern concepts through the lens of medieval knowledge and philosophy."
```

**Debugging Assistant**
```javascript
systemPrompt: "You are a debugging expert. When shown code, methodically analyze it for bugs, explain what's wrong, why it's wrong, and provide the corrected version with explanations."
```

### 2. Domain-Specific Assistants

Inject domain knowledge via OIP records or system prompts:

**Legal Document Analyzer**
```javascript
systemPrompt: "You are a legal assistant specializing in contract analysis. Review documents for key terms, obligations, risks, and unusual clauses. Provide clear, structured analysis."
oipRecordDid: "did:arweave:contract-123"
```

**Medical Information Assistant**
```javascript
systemPrompt: "You are a medical information assistant. Provide accurate health information based on medical records. Always recommend consulting healthcare professionals. Use clear, patient-friendly language."
oipRecordDid: "did:arweave:medical-record-456"
```

**Recipe Analyzer**
```javascript
systemPrompt: "You are a professional chef. Analyze recipes for techniques, ingredient substitutions, difficulty level, and provide cooking tips."
oipRecordDid: "did:arweave:recipe-789"
```

### 3. Content Generation

Optimize for different content types:

**Blog Post Writer**
```javascript
systemPrompt: "You are a professional blog writer. Create engaging, SEO-optimized content with clear structure, compelling headlines, and natural keyword integration."
targetResponseLength: "detailed"
```

**Social Media Captions**
```javascript
systemPrompt: "You are a social media expert. Write catchy, engaging captions with relevant hashtags. Keep tone upbeat and conversational."
targetResponseLength: "short"
```

**Product Descriptions**
```javascript
systemPrompt: "You are a copywriter. Write compelling product descriptions highlighting features, benefits, and emotional appeal. Use persuasive language."
targetResponseLength: "medium"
```

### 4. Educational Applications

**Interactive Tutor**
```javascript
systemPrompt: "You are a patient tutor. Break down complex concepts into simple steps. Ask clarifying questions. Provide examples and analogies. Adjust explanations based on understanding."
model: "gpt-4o-mini" // Consistent model for better conversation flow
```

**Language Learning**
```javascript
systemPrompt: "You are a Spanish language teacher. Respond in Spanish with English translations in parentheses. Correct grammar mistakes gently. Provide pronunciation tips."
```

**Quiz Generator**
```javascript
systemPrompt: "You are a quiz creator. Generate questions based on the topic. Include multiple choice, true/false, and short answer questions. Provide answer key at the end."
targetResponseLength: "long"
```

### 5. Voice Interfaces

**Smart Home Assistant**
```javascript
systemPrompt: "You are a smart home assistant. Provide quick, actionable responses for home automation. Confirm actions clearly. Ask for clarification when needed."
outputMode: "voice"
targetResponseLength: "short"
elevenlabsVoiceId: "onwK4e9ZLuTAKqWW03F9"
```

**Podcast Summarizer**
```javascript
systemPrompt: "You are a podcast analyst. Summarize episodes highlighting key topics, insights, and actionable takeaways. Maintain the host's tone and style."
outputMode: "voice"
targetResponseLength: "medium"
```

**Interactive Storyteller**
```javascript
systemPrompt: "You are an interactive storyteller. Create immersive narratives that respond to user choices. Use vivid descriptions and maintain consistent characters."
outputMode: "voice"
targetResponseLength: "long"
elevenlabsVoiceId: "pNInz6obpgDQGcFmaJgB" // Adam - Dramatic voice
```

---

## Voice Configuration

### Basic Voice Selection

Simply specify the ElevenLabs voice ID:

```javascript
formData.append('elevenlabsVoiceId', 'EXAVITQu4vr4xnSDxMaL'); // Bella
```

### Advanced Voice Configuration

For fine-tuned control, use the `voiceConfig` parameter:

```javascript
formData.append('voiceConfig', JSON.stringify({
    engine: 'elevenlabs',
    elevenlabs: {
        selectedVoice: 'onwK4e9ZLuTAKqWW03F9',
        speed: 1.0,           // 0.5-2.0 (slower-faster)
        stability: 0.5,       // 0.0-1.0 (variable-stable)
        similarity_boost: 0.75 // 0.0-1.0 (less-more like original)
    }
}));
```

### Fallback Engines

If ElevenLabs is unavailable, the system automatically falls back:

```
ElevenLabs (Premium)
    ↓ (if API key missing)
Edge TTS (Microsoft)
    ↓ (if rate limited)
Local TTS (Chatterbox/Silero)
    ↓ (if unavailable)
eSpeak (Basic, Always Available)
```

---

## Performance & Optimization

### Response Time Breakdown

**Parallel Text Mode** (Fastest)
- Request processing: 100-200ms
- LLM racing: 2-8 seconds (first to finish wins)
- Streaming delivery: Real-time
- **Total**: 3-10 seconds typically

**Specific Model Text Mode**
- Request processing: 100-200ms
- LLM processing: 3-20 seconds (model-dependent)
- Streaming delivery: Real-time
- **Total**: 4-25 seconds

**Voice Mode** (Adds TTS)
- Text processing: As above
- TTS synthesis: 2-5 seconds
- Audio streaming: Concurrent with text
- **Total**: +2-5 seconds

### Optimization Tips

1. **Use Parallel for Speed**: Racing 4 models simultaneously gives fastest results
2. **Text Mode for APIs**: Skip TTS when you only need text responses
3. **Short Length for Chat**: Use `"short"` for quick back-and-forth
4. **Specific Models for Quality**: Use `gpt-4o` when quality matters more than speed
5. **OIP Context Over RAG**: Direct context injection is faster than RAG search
6. **Reuse Connections**: Keep EventSource connections open for multiple turns

### Performance Comparison

| Configuration | Avg Response Time | Best For |
|--------------|------------------|----------|
| parallel + text + short | 2-5s | Quick answers, chat |
| parallel + text + medium | 3-10s | Standard conversation |
| gpt-4o-mini + text + long | 8-15s | Quality detailed responses |
| parallel + voice + short | 5-10s | Voice chat |
| gpt-4o + voice + detailed | 20-40s | Premium voice content |

---

## Troubleshooting

### Common Issues

#### Issue: "All parallel requests timed out"

**Cause**: No LLM models are available or all failed.

**Solution**:
1. Check Ollama is running: `docker ps | grep ollama`
2. Verify API keys: `echo $OPENAI_API_KEY $XAI_API_KEY`
3. Try specific model instead: `model: "mistral:latest"`

#### Issue: No audio in voice mode

**Cause**: TTS service unavailable or ElevenLabs key missing.

**Solution**:
1. Check `outputMode: "voice"` is set
2. Verify TTS service: `curl http://localhost:5002/health`
3. Check ElevenLabs key: `echo $ELEVENLABS_API_KEY`
4. System will fallback to Edge TTS or eSpeak automatically

#### Issue: Short responses when expecting long

**Cause**: Model hitting token limit.

**Solution**:
1. Check `targetResponseLength` setting
2. Increase with `customMaxTokens` if using `"custom"`
3. Some models may not respect token limits perfectly

#### Issue: Audio chunks play out of order

**Cause**: Not respecting `chunkIndex` order.

**Solution**:
```javascript
// Always sort by chunkIndex before playing
audioChunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
```

#### Issue: Stream disconnects early

**Cause**: Client not connecting to SSE stream fast enough.

**Solution**:
1. Connect to stream immediately after getting dialogueId
2. Ensure network stability
3. Check for firewall/proxy issues

#### Issue: OIP record context not working

**Cause**: Invalid DID format or record doesn't exist.

**Solution**:
1. Verify DID format: `did:arweave:...`
2. Check record exists: `curl http://localhost:3000/api/records/{DID}`
3. Ensure API can access record

### Error Messages

| Error | Meaning | Solution |
|-------|---------|----------|
| "Either audio file or userPrompt is required" | Missing input | Provide either `userPrompt` (text) or `audio` (file) |
| "outputMode must be \"voice\" or \"text\"" | Invalid mode | Use `"voice"` or `"text"` exactly |
| "Failed to get response from {model}" | Model unavailable | Try `"parallel"` or different model |
| "All LLM requests failed" | All models failed | Check model services are running |
| "Failed to fetch OIP record context" | Invalid DID | Verify DID exists and is accessible |

### Debug Logging

Enable verbose logging in browser console:

```javascript
eventSource.addEventListener('textChunk', (event) => {
    console.log('[Text]', event.data);
});

eventSource.addEventListener('audioChunk', (event) => {
    console.log('[Audio]', JSON.parse(event.data).chunkIndex);
});
```

---

## API Comparison Chart

| Feature | `/converse` | `/converse-custom` |
|---------|------------|-------------------|
| **Input** | Audio/Text | ✅ Audio/Text |
| **System Prompt** | Fixed | ✅ Custom |
| **Model Selection** | RAG/LLM modes | ✅ Full control + parallel |
| **Output Mode** | Voice only | ✅ Voice OR text |
| **Response Length** | Fixed | ✅ 5 presets + custom |
| **Voice Selection** | Limited | ✅ All ElevenLabs voices |
| **Context** | RAG search or pinnedDidTx | ✅ Direct OIP DID injection |
| **Streaming** | ✅ SSE | ✅ SSE |
| **Performance Metrics** | ✅ Yes | ✅ Yes |
| **Best For** | General Q&A with your data | Custom AI applications |

---

## Summary

The `/api/voice/converse-custom` endpoint provides:

✅ **Maximum Flexibility** - Full control over prompts, models, and output  
✅ **Fast Performance** - Parallel racing typically delivers in 3-10 seconds  
✅ **Voice Customization** - All ElevenLabs voices plus automatic fallbacks  
✅ **Precise Control** - 5 response length presets + custom token limits  
✅ **Direct Context** - Inject OIP records without RAG search overhead  
✅ **Real-time Streaming** - SSE delivery of text and audio chunks  
✅ **Production Ready** - Comprehensive error handling and metrics  

Perfect for building custom AI characters, voice interfaces, domain-specific assistants, content generation systems, and any application requiring fine-tuned AI behavior.

---

## Quick Reference

```javascript
// Minimal text request
POST /api/voice/converse-custom
{
  userPrompt: "Your question",
  model: "parallel",
  outputMode: "text",
  targetResponseLength: "short"
}

// Full-featured voice request
POST /api/voice/converse-custom
{
  userPrompt: "Your question",
  systemPrompt: "Custom AI personality",
  model: "gpt-4o-mini",
  outputMode: "voice",
  targetResponseLength: "long",
  oipRecordDid: "did:arweave:...",
  elevenlabsVoiceId: "onwK4e9ZLuTAKqWW03F9"
}

// Connect to stream
GET /api/voice/open-stream?dialogueId={id}

// Event types: textChunk, audioChunk, done, error
```

---

**Version**: 1.0  
**Last Updated**: November 9, 2025  
**Status**: Production Ready
