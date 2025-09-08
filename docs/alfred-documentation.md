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

## Future Enhancements

- **True Streaming RAG**: Real-time content retrieval and generation
- **Voice Cloning**: Custom voice training for personalized TTS
- **Multi-language Support**: Expanded language detection and synthesis
- **Context Memory**: Long-term conversation memory across sessions
- **Custom RAG Sources**: User-defined knowledge base integration

---

*This documentation covers ALFRED v2.0 with enhanced processing modes and parallel LLM support. For implementation details, see the source code in `routes/voice.js` and `helpers/alfred.js`.*
