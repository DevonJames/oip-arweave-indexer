# ALFRED Voice & Chat System Documentation

## Overview

ALFRED (Autonomous Linguistic Framework for Retrieval & Enhanced Dialogue) is an advanced AI assistant that combines voice processing, intelligent content retrieval (RAG), and multiple LLM backends to provide contextual, conversational responses. The system supports both streaming voice conversations and traditional chat interactions.

## Core Components

### 1. Voice Processing Pipeline
- **STT (Speech-to-Text)**: Whisper-based transcription service
- **TTS (Text-to-Speech)**: Multiple engines (ElevenLabs, Edge TTS, Chatterbox)
- **Smart Turn Detection**: AI-powered endpoint detection for natural conversations
- **Adaptive Streaming**: Real-time audio generation with chunked responses

### 2. ALFRED RAG System
- **Intelligent Question Analysis**: LLM-powered question parsing and intent detection
- **Content Retrieval**: Searches indexed records (posts, recipes, exercises, etc.)
- **Context-Aware Responses**: Provides direct answers using retrieved content
- **Follow-up Detection**: Maintains conversation context across multiple turns

### 3. Multi-LLM Backend
- **Local Models**: Ollama (LLaMA 3.2 3B, Mistral 7B, LLaMA 2 7B, TinyLLaMA)
- **Cloud Models**: OpenAI GPT-4o-mini, XAI Grok-4
- **Parallel Processing**: Multiple models race for fastest response
- **Automatic Fallback**: Graceful degradation if models fail

## API Endpoints

### `/api/voice/converse` (Streaming)

**Purpose**: Real-time streaming voice conversation with adaptive audio generation

**Method**: `POST`

**Content-Type**: `multipart/form-data` (for audio) or `application/json` (for text)

#### Request Parameters:

```javascript
{
  // Audio input (optional - either audio OR text required)
  audio: File, // Audio file (webm, wav, mp3, etc.)
  
  // Text input (optional - either audio OR text required)  
  text: "Your question here",
  userInput: "Alternative text field", // Legacy support
  
  // Processing mode (NEW FEATURE)
  processing_mode: "rag" | "llm" | "llm-{model}", // Default: "rag"
  
  // Model selection
  model: "llama3.2:3b", // Default LLM model for RAG analysis
  
  // Voice configuration
  voice_id: "onwK4e9ZLuTAKqWW03F9", // ElevenLabs voice ID
  voiceConfig: JSON.stringify({
    engine: "elevenlabs", // "elevenlabs" | "edge_tts" | "chatterbox"
    enabled: true,
    elevenlabs: {
      selectedVoice: "onwK4e9ZLuTAKqWW03F9",
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0.0,
      use_speaker_boost: true
    }
  }),
  
  // Search filters (for RAG mode)
  creator_filter: null,
  record_type_filter: null,
  tag_filter: null,
  
  // Context (optional)
  conversationHistory: JSON.stringify([
    { role: "user", content: "Previous message" },
    { role: "assistant", content: "Previous response" }
  ]),
  existing_search_results: [], // Previous search results for context
  pinnedDidTx: "did:arweave:...", // Force single-record mode
  
  // Advanced options
  include_filter_analysis: true, // Enable intelligent filtering
  dialogueId: "voice-dialogue-12345" // Session identifier
}
```

#### Processing Modes:

##### 1. **RAG Mode** (`processing_mode: "rag"`) - Default
```javascript
{
  text: "Who is the current president?",
  processing_mode: "rag"
}
```
- **Process**: Question Analysis → Database Search → Content Retrieval → LLM Response
- **Benefits**: Contextual, accurate answers from your indexed content
- **Response Time**: 5-30 seconds (depending on content complexity)
- **Immediate Feedback**: "Let me check that for you..." (while processing)

##### 2. **Parallel LLM Mode** (`processing_mode: "llm"`)
```javascript
{
  text: "What's the capital of France?",
  processing_mode: "llm"
}
```
- **Process**: Parallel requests to OpenAI + Grok-4 + Mistral 7B + LLaMA 2 7B
- **Benefits**: Fastest response time, general knowledge questions
- **Response Time**: 2-15 seconds (first model to respond wins)
- **Immediate Feedback**: "Let me think about that..." (while processing)

##### 3. **Specific Model Mode** (`processing_mode: "llm-{model}"`)
```javascript
{
  text: "Explain quantum physics",
  processing_mode: "llm-grok-4"
}
```

**Available Models**:
- **Cloud**: `llm-gpt-4o-mini`, `llm-grok-4`
- **Local**: `llm-llama3.2:3b`, `llm-mistral:7b`, `llm-llama2:7b`, `llm-tinyllama`

#### Response Format:

```javascript
{
  success: true,
  dialogueId: "voice-dialogue-12345"
}
```

**Real-time data via Server-Sent Events** at `/api/voice/open-stream?dialogueId={dialogueId}`:

```javascript
// Text chunks
{
  type: "textChunk",
  role: "assistant",
  text: "Donald Trump is"
}

// Audio chunks (adaptive streaming)
{
  type: "audioChunk", 
  audio: "base64-encoded-audio-data",
  chunkIndex: 1,
  text: "Donald Trump is",
  isFinal: false,
  adaptive: true
}

// Completion
{
  type: "done",
  processing_metrics: {
    stt_time_ms: 850,
    rag_time_ms: 12500,
    total_time_ms: 15200
  },
  rag_metadata: {
    sources: [...],
    search_results_count: 3,
    applied_filters: {...}
  }
}
```

### `/api/voice/chat` (Non-Streaming)

**Purpose**: Traditional request-response chat with optional audio synthesis

**Method**: `POST`

**Content-Type**: `multipart/form-data` or `application/json`

#### Request Parameters:

```javascript
{
  // Input (either audio file or text)
  audio: File, // Optional audio file
  text: "Your question", // Optional text input
  
  // Processing mode (NEW FEATURE)
  processing_mode: "rag" | "llm" | "llm-{model}", // Default: "rag"
  
  // Model and voice settings
  model: "llama3.2:3b",
  voice_id: "female_1",
  speed: 1.0,
  return_audio: true, // Whether to synthesize audio response
  engine: "edge_tts", // TTS engine to use
  
  // Search filters
  creator_filter: null,
  record_type_filter: null, 
  tag_filter: null,
  
  // Context
  conversationHistory: JSON.stringify([...]),
  existing_search_results: [...],
  pinnedDidTx: "did:arweave:..."
}
```

#### Response Format:

```javascript
{
  success: true,
  input_text: "Who is the president?",
  response_text: "Donald Trump is the current president.",
  response: "Donald Trump is the current president.", // Mac client compatibility
  answer: "Donald Trump is the current president.", // Fallback compatibility
  
  // Model information
  model_used: "gpt-4o-mini",
  
  // Audio (if return_audio: true)
  has_audio: true,
  engine_used: "edge_tts",
  audio_data: "base64-encoded-audio",
  audio_url: "/api/voice/audio/12345.wav",
  
  // RAG metadata (if processing_mode: "rag")
  sources: [
    {
      type: "record",
      title: "Article Title",
      creator: "author",
      didTx: "did:arweave:...",
      recordType: "post"
    }
  ],
  context_used: true,
  search_results_count: 3,
  search_results: [...], // Full search results
  applied_filters: {
    search: "president",
    recordType: "post",
    rationale: "Found 3 relevant records"
  },
  
  // Performance metrics
  processing_metrics: {
    stt_time_ms: 850,
    rag_time_ms: 12500,
    tts_time_ms: 2100,
    total_time_ms: 15450
  },
  
  // Pipeline information
  pipeline_version: "2.0",
  timestamp: "2025-01-07T10:30:00.000Z"
}
```

## RAG System Deep Dive

### Question Analysis Pipeline

1. **LLM-Powered Analysis**: Uses local/cloud LLM to parse questions
   ```javascript
   {
     isFollowUp: false,
     category: "news", // "recipe", "exercise", "news", "podcast"
     primaryEntity: "president",
     modifiers: ["current", "United States"],
     secondEntity: ""
   }
   ```

2. **Search Strategy**: 
   - **Initial Search**: Broad search with primary entity
   - **Refinement**: Tag-based filtering with modifiers
   - **Cuisine/Category Filtering**: Specialized filters for recipes/exercises

3. **Content Extraction**:
   - **Full Text Retrieval**: Fetches complete article content
   - **Media Processing**: Extracts images, audio, video
   - **Nutritional Analysis**: Recipe-specific data (prep time, ingredients)
   - **Exercise Details**: Instructions, muscle groups, equipment

### Follow-up Detection

ALFRED maintains conversation context and detects follow-up questions:

```javascript
// Context indicators
- Pronouns: "they", "it", "this", "that"
- Definite articles: "the recipe", "the person"  
- Category matching: Question category must match loaded records
- Single record mode: Questions without clear subjects when 1-3 records loaded
```

### Record Type Support

- **Posts/News**: Full text articles with web URLs
- **Recipes**: Ingredients, instructions, nutrition, timing
- **Exercises**: Step-by-step instructions, muscle groups, equipment
- **Workouts**: Exercise sequences with sets/reps
- **Podcasts**: Episode transcripts, citations, show information
- **Videos/Images**: Media content with metadata

## Direct LLM Processing

### Parallel Mode (`processing_mode: "llm"`)

**Models Queried Simultaneously**:
1. **OpenAI GPT-4o-mini** (if `OPENAI_API_KEY` set)
2. **XAI Grok-4** (if `XAI_API_KEY` set)  
3. **Ollama Mistral 7B** (local)
4. **Ollama LLaMA 2 7B** (local)

**Configuration**:
```javascript
// Cloud models (15s timeout)
temperature: 0.7,
max_tokens: 500

// Ollama models (20s timeout)  
temperature: 0.7,
top_p: 0.9,
top_k: 40,
repeat_penalty: 1.1,
num_predict: 500
```

### Specific Model Mode (`processing_mode: "llm-{model}"`)

**Cloud Models**:
- `llm-gpt-4o-mini` → OpenAI GPT-4o-mini
- `llm-grok-4` → XAI Grok-4

**Local Models**:
- `llm-llama3.2:3b` → Ollama LLaMA 3.2 3B  
- `llm-mistral:7b` → Ollama Mistral 7B
- `llm-llama2:7b` → Ollama LLaMA 2 7B
- `llm-tinyllama` → Ollama TinyLLaMA

## Performance Optimizations

### Parallel Processing
- **RAG System**: Local LLM + OpenAI + Grok-4 race for analysis/generation
- **Direct LLM**: Up to 4 models racing simultaneously
- **First Response Wins**: Dramatically reduces latency

### Timeout Management
- **Question Analysis**: 20 seconds (increased for reliability)
- **Main Generation**: 25 seconds for Ollama, 15 seconds for cloud
- **Full Text Fetching**: 15 seconds
- **TTS Synthesis**: 30 seconds

### Caching
- **Full Text Cache**: Avoids re-downloading article content
- **Template Cache**: Dynamic template field mappings
- **Voice Cache**: TTS results cached per session

## Error Handling & Fallbacks

### RAG Mode Fallbacks
1. **Local LLM timeout** → Cloud models (OpenAI/Grok)
2. **All LLMs fail** → Intelligent content extraction from retrieved articles
3. **No records found** → General knowledge response with disclaimer

### LLM Mode Fallbacks
1. **Parallel mode**: If all models fail → Error message
2. **Specific model**: If target model fails → Error with suggestion to try parallel mode

### TTS Fallbacks
1. **ElevenLabs** → Edge TTS → Chatterbox → eSpeak
2. **Service unavailable** → Text-only response with error metadata

## Voice Features

### Adaptive Streaming TTS
- **Real-time Generation**: Audio generated as text is produced
- **Natural Breaks**: Sentence-based chunking for natural speech
- **Multiple Engines**: ElevenLabs (premium), Edge TTS (fast), Chatterbox (local)
- **Voice Cloning**: Support for custom voice training

### Smart Turn Detection
- **Endpoint Prediction**: AI determines when user has finished speaking
- **Probability Threshold**: Configurable confidence levels
- **Fallback**: Traditional silence detection if AI unavailable

### Voice Activity Detection (VAD)
- **Real-time Monitoring**: Audio level analysis
- **Automatic Stopping**: Silence-based recording termination
- **Noise Suppression**: Echo cancellation and gain control

## Configuration

### Environment Variables

```bash
# LLM APIs
OLLAMA_HOST=http://ollama:11434
DEFAULT_LLM_MODEL=llama3.2:3b
OPENAI_API_KEY=sk-...
XAI_API_KEY=xai-...

# Voice Services  
STT_SERVICE_URL=http://localhost:8003
TTS_SERVICE_URL=http://localhost:5002
ELEVENLABS_API_KEY=... # Optional for premium TTS

# Enhanced Pipeline
SMART_TURN_ENABLED=true
SMART_TURN_MIN_PROB=0.55
VAD_ENABLED=true
```

### Model Selection

**For Speed**: `llm-tinyllama` or `processing_mode: "llm"`
**For Quality**: `processing_mode: "rag"` or `llm-grok-4`  
**For Context**: `processing_mode: "rag"` (always)

## Usage Examples

### Basic Voice Conversation

```javascript
// Start streaming conversation
const response = await fetch('/api/voice/converse', {
  method: 'POST',
  body: formData // Contains audio file
});

const { dialogueId } = await response.json();

// Connect to real-time stream
const eventSource = new EventSource(`/api/voice/open-stream?dialogueId=${dialogueId}`);

eventSource.addEventListener('textChunk', (event) => {
  const data = JSON.parse(event.data);
  console.log('Text:', data.text);
});

eventSource.addEventListener('audioChunk', (event) => {
  const data = JSON.parse(event.data);
  playAudio(data.audio); // Base64 audio data
});
```

### RAG-Powered Question

```javascript
const response = await fetch('/api/voice/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    text: "What's in my Mediterranean chicken recipe?",
    processing_mode: "rag", // Use knowledge base
    return_audio: true
  })
});

const result = await response.json();
// result.answer: "The marinade includes olive oil, lemon juice, garlic..."
// result.sources: [{ title: "Mediterranean Chicken Recipe", ... }]
// result.context_used: true
```

### Fast General Knowledge

```javascript
const response = await fetch('/api/voice/chat', {
  method: 'POST', 
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    text: "What's the square root of 144?",
    processing_mode: "llm", // Skip RAG, use fastest LLM
    return_audio: false
  })
});

const result = await response.json();
// result.answer: "The square root of 144 is 12."
// result.model_used: "openai-gpt-4o-mini" (or whichever responded first)
```

### Specific Model Request

```javascript
const response = await fetch('/api/voice/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    text: "Explain machine learning in simple terms",
    processing_mode: "llm-grok-4", // Force Grok-4
    return_audio: true,
    voice_id: "en-GB-RyanNeural"
  })
});
```

### Context-Aware Follow-up

```javascript
// First question (establishes context)
{
  text: "Show me chicken recipes",
  processing_mode: "rag"
}
// Response: Shows 5 chicken recipes

// Follow-up (uses existing context)
{
  text: "How long does the first one take to cook?", 
  processing_mode: "rag",
  existing_search_results: [...] // Previous results
}
// Response: "The Mediterranean Grilled Chicken takes 25 minutes to cook."
```

## Advanced Features

### Single Record Mode

Pin a specific record for detailed Q&A:

```javascript
{
  text: "How do I make this recipe?",
  processing_mode: "rag",
  pinnedDidTx: "did:arweave:abc123...",
  include_filter_analysis: false
}
```

### Voice Engine Control

```javascript
{
  text: "Tell me about the weather",
  voiceConfig: JSON.stringify({
    engine: "elevenlabs",
    elevenlabs: {
      selectedVoice: "pNInz6obpgDQGcFmaJgB", // Adam voice
      stability: 0.8,
      similarity_boost: 0.9,
      style: 0.2
    }
  })
}
```

### Smart Turn Integration

```javascript
// Automatic endpoint detection
{
  audio: audioFile, // AI analyzes speech patterns
  // Smart Turn automatically determines when user finished speaking
}
```

## Response Metadata

### RAG Responses Include:

- **Sources**: Detailed information about retrieved records
- **Applied Filters**: What search criteria were used
- **Search Results**: Full record data for analysis
- **Context Usage**: Whether knowledge base was utilized
- **Processing Metrics**: Timing breakdown for each pipeline stage

### LLM Responses Include:

- **Model Used**: Which specific model generated the response
- **Processing Mode**: Confirmation of bypass mode
- **Timing**: How long the direct LLM call took
- **Fallback Info**: If any fallbacks were triggered

## Error Handling

### Common Scenarios

1. **Model Timeouts**: 
   - RAG mode: Falls back to cloud models, then content extraction
   - LLM mode: Uses whichever models respond successfully

2. **API Key Missing**:
   - Cloud models gracefully skipped
   - Local models continue working

3. **Service Unavailable**:
   - TTS: Falls back through engine hierarchy
   - STT: Returns clear error message
   - LLM: Uses available models only

4. **Invalid Parameters**:
   - Unknown processing_mode: Falls back to RAG
   - Invalid model names: Uses default model
   - Malformed requests: Clear error responses

## Performance Guidelines

### When to Use Each Mode:

**RAG Mode** (`processing_mode: "rag"`):
- ✅ Questions about your specific content/data
- ✅ Recipe instructions, exercise details, article facts
- ✅ When accuracy and context matter most
- ❌ Simple math, general knowledge, creative writing

**Parallel LLM** (`processing_mode: "llm"`):
- ✅ General knowledge questions
- ✅ Math, science, explanations
- ✅ When speed is critical
- ✅ Creative writing, brainstorming
- ❌ Questions about your specific data

**Specific Model** (`processing_mode: "llm-{model}"`):
- ✅ When you want a particular model's "personality"
- ✅ Testing different model capabilities
- ✅ Consistent model for conversation continuity
- ❌ When you just want the fastest response

### Performance Expectations:

| Mode | Response Time | Accuracy | Use Case |
|------|---------------|----------|----------|
| RAG | 5-30 seconds | Very High | Your data questions |
| LLM Parallel | 2-15 seconds | High | General knowledge |
| LLM Specific | 3-20 seconds | High | Model-specific needs |

## System Architecture

```
User Question
     ↓
[Self-Referential Check] → Direct LLM (always)
     ↓
[Processing Mode Router]
     ↓
┌─────────────┬──────────────┬─────────────────┐
│ RAG Mode    │ LLM Parallel │ LLM Specific    │
│             │              │                 │
│ Question    │ OpenAI       │ Target Model    │
│ Analysis    │ Grok-4       │ Direct Call     │
│ ↓           │ Mistral 7B   │                 │
│ Search      │ LLaMA 2 7B   │                 │
│ ↓           │              │                 │
│ Content     │ First Win    │ Single Response │
│ Retrieval   │              │                 │
│ ↓           │              │                 │
│ LLM Gen     │              │                 │
└─────────────┴──────────────┴─────────────────┘
     ↓
[Response Streaming]
     ↓
[Adaptive TTS] → Real-time Audio
```

## Integration Examples

### Frontend Integration

```javascript
class AlfredClient {
  async askQuestion(text, options = {}) {
    const {
      processingMode = 'rag',
      returnAudio = true,
      voiceEngine = 'elevenlabs'
    } = options;
    
    const response = await fetch('/api/voice/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        processing_mode: processingMode,
        return_audio: returnAudio,
        engine: voiceEngine
      })
    });
    
    return await response.json();
  }
  
  // Fast general knowledge
  async quickQuestion(text) {
    return this.askQuestion(text, { 
      processingMode: 'llm', 
      returnAudio: false 
    });
  }
  
  // Detailed research
  async researchQuestion(text) {
    return this.askQuestion(text, { 
      processingMode: 'rag', 
      returnAudio: true 
    });
  }
}
```

### Voice Streaming Integration

```javascript
class VoiceStreaming {
  async startConversation(audioBlob, options = {}) {
    const formData = new FormData();
    formData.append('audio', audioBlob);
    formData.append('processing_mode', options.mode || 'rag');
    formData.append('voiceConfig', JSON.stringify(options.voice || {}));
    
    const response = await fetch('/api/voice/converse', {
      method: 'POST',
      body: formData
    });
    
    const { dialogueId } = await response.json();
    
    // Connect to stream
    const eventSource = new EventSource(`/api/voice/open-stream?dialogueId=${dialogueId}`);
    
    return {
      dialogueId,
      eventSource,
      onText: (callback) => eventSource.addEventListener('textChunk', callback),
      onAudio: (callback) => eventSource.addEventListener('audioChunk', callback),
      onComplete: (callback) => eventSource.addEventListener('done', callback)
    };
  }
}
```

## Troubleshooting

### Common Issues

1. **Slow RAG Responses**:
   - Try `processing_mode: "llm"` for general questions
   - Check if local LLM models are loaded (`docker exec -it ollama ollama list`)
   - Verify database has relevant content for your questions

2. **No Audio Output**:
   - Check TTS service health: `curl http://localhost:5002/health`
   - Verify ElevenLabs API key if using premium voices
   - Fallback engines: Edge TTS → Chatterbox → eSpeak

3. **Model Timeouts**:
   - Cloud models: Verify API keys are valid
   - Local models: Check Ollama service status
   - Consider using `processing_mode: "llm"` for faster responses

4. **Poor Voice Quality**:
   - ElevenLabs: Adjust stability/similarity settings
   - Edge TTS: Try different voice selections
   - Chatterbox: Tune emotion/exaggeration parameters

### Health Checking

```bash
# Check all voice services
curl http://localhost:3000/api/voice/health

# Check specific services
curl http://localhost:8003/health  # STT
curl http://localhost:5002/health  # TTS  
curl http://ollama:11434/api/tags  # Ollama models
```

### Logs to Monitor

```bash
# Key log patterns
[ALFRED] Generated response using {source} # Which model won
[Voice Converse] Processing mode: {mode}   # Mode selection
[Direct LLM] First response from {model}   # Parallel race winner
🎉 Adaptive streaming completed           # Streaming success
```

## Conversation Session History

### Overview

ALFRED now includes a comprehensive conversation session history system that automatically saves all conversations as encrypted, private records in GUN database. This allows users to:

- **Automatically save** all voice and text conversations
- **Browse conversation history** in the sidebar
- **Resume previous conversations** by clicking on any session
- **Secure encryption** ensures privacy using AES-256-GCM
- **JWT authentication** protects access to user's private sessions

### Session Management API

#### Session Creation

Sessions are automatically created when users start new conversations:

```javascript
// Automatic session creation (triggered before first user message)
const sessionData = {
  basic: {
    name: "Session 1", // Auto-numbered
    description: "Alfred conversation session",
    date: Math.floor(Date.now() / 1000), // Unix timestamp
    language: "en"
  },
  conversationSession: {
    session_id: "session_1757701093397",
    start_timestamp: 1757701093397,
    last_activity_timestamp: 1757701093397,
    last_modified_timestamp: 1757701093397,
    message_count: 0,
    messages: [],
    message_timestamps: [],
    message_roles: [],
    model_name: "llama3.2:3b",
    model_provider: ["did:arweave:model_provider_did"],
    total_tokens: 0,
    input_tokens: 0,
    output_tokens: 0,
    processing_mode: "rag",
    conversation_type: "voice", // or "text"
    is_archived: false,
    is_private: true,
    owner_pubkey: "user_public_key",
    version: "1.0.0"
  },
  accessControl: {
    private: true
  }
}
```

#### Session Storage Endpoint

**POST** `/api/records/newRecord?recordType=conversationSession&storage=gun&localId={sessionId}`

```javascript
// Headers
{
  'Authorization': 'Bearer JWT_TOKEN',
  'Content-Type': 'application/json'
}

// Body: sessionData (as shown above)
```

**Response:**
```javascript
{
  recordToIndex: { /* session data */ },
  storage: "gun",
  did: "did:gun:647f79c2a338:session_1757701093397",
  soul: "647f79c2a338:session_1757701093397", 
  encrypted: true
}
```

#### Session Retrieval

**GET** `/api/records?source=gun&recordType=conversationSession&limit=15&sortBy=date:desc`

Lists user's conversation sessions (most recent first):

```javascript
// Headers
{
  'Authorization': 'Bearer JWT_TOKEN'
}

// Response
{
  message: "Records retrieved successfully",
  records: [
    {
      data: {
        basic: { name: "Session 1", description: "...", date: 1757701093, language: "en" },
        conversationSession: {
          session_id: "session_1757701093397",
          message_count: 6,
          messages: ["Hello, who are you?", "I am ALFRED...", "..."],
          message_roles: ["user", "assistant", "user", "assistant", "..."],
          message_timestamps: [1757701093493, 1757701093524, "..."],
          model_name: "llama3.2:3b",
          conversation_type: "voice",
          // ... other fields
        },
        accessControl: { private: true }
      },
      oip: {
        did: "did:gun:647f79c2a338:session_1757701093397",
        recordType: "conversationSession",
        storage: "gun",
        indexedAt: "2025-09-12T18:18:06.909Z"
      }
    }
    // ... more sessions
  ]
}
```

#### Individual Session Loading

**GET** `/api/records?source=gun&did={sessionDid}&limit=1`

Loads a specific conversation session with full message history:

```javascript
// Example: GET /api/records?source=gun&did=did:gun:647f79c2a338:session_1757701093397&limit=1

// Response: Same structure as above, but with single record containing full conversation
```

### Frontend Session Management

#### SessionManager Class

The `SessionManager` class handles all session operations:

```javascript
class SessionManager {
  constructor(authManager) {
    this.authManager = authManager;
    this.currentSession = null;
    this.sessions = [];
    this.modelProviderCache = {}; // Cache for model provider lookups
    this.backendUrl = 'https://api.oip.onl';
  }

  // Create new session automatically before first message
  async createNewSession(title = null, modelName = 'llama3.2:3b')
  
  // Update session with new messages (debounced during streaming)
  async updateCurrentSession(messages, model, tokens, processingMode, conversationType)
  
  // Load user's session list
  async loadUserSessions()
  
  // Load specific session and display messages
  async selectSession(sessionDid)
  
  // Load session data from backend
  async loadSession(sessionDid)
}
```

#### Automatic Session Creation

Sessions are created automatically when users start conversations:

```javascript
// Triggered before first user message in both voice and text input
if (!this.sessionManager.currentSession && this.sessionManager && this.sessionManager.authManager.isAuthenticated()) {
  await this.sessionManager.createNewSession(null, this.settings.selectedModel);
}
```

#### Message Persistence

Messages are saved automatically with debouncing to handle streaming responses:

```javascript
// Debounced save triggered on assistant messages
if (role === 'assistant' && this.sessionManager && this.sessionManager.currentSession) {
  clearTimeout(this._saveSessionTimeout);
  this._saveSessionTimeout = setTimeout(() => {
    this.sessionManager.updateCurrentSession(
      this.conversationMessages,
      this.settings.selectedModel,
      0,
      this.settings.processingMode,
      this.settings.outputMode === 'spoken' ? 'voice' : 'text'
    );
  }, 400);
}
```

### Security & Encryption

#### AES-256-GCM Encryption

All conversation sessions are encrypted before storage using AES-256-GCM:

**Backend Encryption** (`helpers/gun.js`):
```javascript
// Key derivation using PBKDF2 (matches frontend)
const key = crypto.pbkdf2Sync('gun-encryption-key', 'salt', 100000, 32, 'sha256');
const iv = crypto.randomBytes(12); // 12-byte IV for GCM
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

// Encrypt and store auth tag
const encryptedBuf = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const authTag = cipher.getAuthTag();

const encryptedData = {
  encrypted: encryptedBuf.toString('base64'),
  iv: iv.toString('base64'),
  tag: authTag.toString('base64')
};
```

**Frontend Decryption** (Web Crypto API):
```javascript
async function decryptSessionData(encryptedData, iv, tag) {
  // Derive key using PBKDF2
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('gun-encryption-key'),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );

  const key = await window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode('salt'),
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  // Decrypt data
  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBuffer },
    key,
    combinedData
  );

  return JSON.parse(new TextDecoder().decode(decrypted));
}
```

#### Authentication & Authorization

**JWT Token Verification**:
- All session operations require valid JWT token
- Backend verifies user ownership of sessions
- Sessions are tied to user's `publisherPubKey` from JWT

**Soul Generation**:
```javascript
// GUN soul format: {publisherHash}:{sessionId}
const soul = `647f79c2a338:session_1757701093397`;
```

### User Interface Features

#### History Sidebar

- **Independent scrolling**: History scrolls separately from conversation
- **Session metadata**: Shows date, message count, and model used
- **Click to load**: Instantly loads full conversation history
- **Real-time updates**: New sessions appear immediately

#### Conversation Loading

```javascript
// When user clicks a session
async selectSession(sessionDid) {
  const session = await this.loadSession(sessionDid);
  
  // Reconstruct messages from stored data
  const messages = [];
  for (let i = 0; i < session.data.conversationSession.messages.length; i++) {
    messages.push({
      role: session.data.conversationSession.message_roles[i],
      content: session.data.conversationSession.messages[i],
      timestamp: session.data.conversationSession.message_timestamps[i]
    });
  }
  
  // Load into conversation interface
  window.alfred.loadSessionMessages(messages);
}
```

#### Bulk Message Loading

```javascript
loadSessionMessages(messages) {
  // Clear current conversation
  this.conversationMessages = [];
  this.conversation = [];
  
  // Disable auto-scrolling during bulk load
  this._bulkLoading = true;
  
  // Load all messages
  messages.forEach(msg => {
    this.addMessage(msg.role, msg.content);
  });
  
  // Re-enable scrolling and scroll to bottom
  this._bulkLoading = false;
  conversation.scrollTop = conversation.scrollHeight;
}
```

### Performance Optimizations

#### Debounced Saves

- **Streaming responses**: Messages saved every 500ms during streaming
- **Final save**: Triggered on SSE completion
- **User messages**: No save until assistant responds (avoids incomplete turns)

#### Efficient UI Updates

- **DocumentFragment**: History UI built off-DOM to prevent reflow
- **Independent scrolling**: Each area scrolls separately
- **Canvas scroll prevention**: Waveform drawing doesn't trigger page scroll

#### Limited History

- **15 sessions max**: Prevents UI performance issues
- **Sorted by date**: Most recent conversations first
- **Lazy loading**: Sessions loaded on demand when clicked

### Data Flow

```
User Input (Voice/Text)
     ↓
[Session Creation] (if first message)
     ↓
[Message Addition] → conversationMessages[]
     ↓
[Assistant Response] (streaming)
     ↓
[Debounced Save] → updateCurrentSession()
     ↓
[Backend Storage] → /api/records/newRecord
     ↓
[GUN Encryption] → AES-256-GCM
     ↓
[GUN Database] → Persistent storage
     ↓
[History UI Update] → Real-time sidebar refresh
```

### Configuration

#### Environment Variables

```bash
# GUN Database
GUN_RELAY_URL=http://gun-relay:8765

# Session encryption
GUN_ENCRYPTION_KEY=gun-encryption-key  # Used for PBKDF2 key derivation
```

#### Frontend Settings

```javascript
// Session limits
const SESSION_LIMIT = 15; // Max sessions to load in history

// Debounce timing
const SAVE_DEBOUNCE_MS = 400; // Assistant message save delay
const STREAM_SAVE_DEBOUNCE_MS = 500; // Streaming update save delay
```

### Usage Examples

#### Automatic Session Management

```javascript
// User starts conversation (automatic)
user: "Hello, who are you?"
// → Creates new session automatically
// → Saves user message + assistant response
// → Updates history sidebar

// User continues conversation
user: "What's an LLM?"
// → Updates existing session
// → Saves to same session record
// → Updates message count in sidebar

// User loads previous conversation
// → Clicks session in sidebar
// → Loads full message history
// → Can continue conversation seamlessly
```

#### Manual Session Operations

```javascript
// Create new session
const session = await sessionManager.createNewSession("Custom Title", "gpt-4o-mini");

// Update session with messages
await sessionManager.updateCurrentSession(
  conversationMessages,    // Array of {role, content, timestamp}
  "llama3.2:3b",          // Model name
  150,                     // Token count
  "rag",                   // Processing mode
  "voice"                  // Conversation type
);

// Load session history
await sessionManager.loadUserSessions();

// Load specific session
const session = await sessionManager.loadSession("did:gun:647f79c2a338:session_123");
```

## Future Enhancements

- **Session Search**: Full-text search across conversation history
- **Session Export**: Download conversations as text/JSON
- **Session Sharing**: Share specific conversations with others
- **Session Analytics**: Conversation insights and statistics
- **True Streaming RAG**: Real-time content retrieval and generation
- **Voice Cloning**: Custom voice training for personalized TTS
- **Multi-language Support**: Expanded language detection and synthesis
- **Context Memory**: Long-term conversation memory across sessions
- **Custom RAG Sources**: User-defined knowledge base integration

---

*This documentation covers ALFRED v2.1 with conversation session history, enhanced processing modes, and parallel LLM support. For implementation details, see the source code in `routes/voice.js`, `helpers/alfred.js`, `helpers/gun.js`, and `mac-client/alfred.html`.*
