# ALFRED: Complete Technical Guide

**Autonomous Linguistic Framework for Retrieval & Enhanced Dialogue**

## Table of Contents

1. [Overview](#overview)
2. [Core Architecture](#core-architecture)
3. [Voice Processing Pipeline](#voice-processing-pipeline)
4. [RAG System](#rag-system)
5. [Multi-LLM Backend](#multi-llm-backend)
6. [Conversation Session History](#conversation-session-history)
7. [API Endpoints](#api-endpoints)
8. [Advanced Features](#advanced-features)
9. [Configuration](#configuration)
10. [Performance & Optimization](#performance--optimization)
11. [Troubleshooting](#troubleshooting)
12. [Integration Examples](#integration-examples)

---

## Overview

ALFRED is a sophisticated AI assistant system that combines voice processing, intelligent content retrieval (RAG), and multiple LLM backends to provide contextual, conversational responses. The system supports both streaming voice conversations and traditional chat interactions with automatic conversation history management.

### Key Capabilities

- **🎤 Voice Processing**: Real-time speech-to-text and text-to-speech with multiple engines
- **🧠 Intelligent RAG**: Context-aware content retrieval from indexed OIP records
- **⚡ Multi-LLM Support**: Parallel processing across local and cloud models
- **💬 Conversation Memory**: Automatic session history with encryption
- **🔍 Smart Search**: Advanced question analysis and content filtering
- **🌐 Multi-Network Storage**: Integration with Arweave, GUN, IPFS, and BitTorrent
- **🎯 Follow-up Detection**: Maintains conversation context across multiple turns

---

## Core Architecture

### System Components

```
User Input (Voice/Text)
     ↓
[Authentication & Session Management]
     ↓
[Processing Mode Router]
     ↓
┌─────────────┬──────────────┬─────────────────┐
│ RAG Mode    │ LLM Parallel  │ LLM Specific    │
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

### Processing Modes

#### 1. **RAG Mode** (Default)
- **Process**: Question Analysis → Database Search → Content Retrieval → LLM Response
- **Benefits**: Contextual, accurate answers from indexed content
- **Response Time**: 5-30 seconds
- **Use Cases**: Questions about your specific data, recipes, exercises, articles

#### 2. **Parallel LLM Mode**
- **Process**: Simultaneous requests to OpenAI + Grok-4 + Mistral 7B + LLaMA 2 7B
- **Benefits**: Fastest response time, general knowledge questions
- **Response Time**: 2-15 seconds
- **Use Cases**: General knowledge, math, science, creative writing

#### 3. **Specific Model Mode**
- **Process**: Direct call to specified model
- **Benefits**: Consistent model personality, testing capabilities
- **Response Time**: 3-20 seconds
- **Use Cases**: When you want a particular model's "personality"

---

## Voice Processing Pipeline

### Speech-to-Text (STT)

**Whisper-based transcription service** with multiple configurations:

#### **Remote STT Service (RTX 4090)**
```javascript
// Remote STT Service Configuration
{
  service_url: "http://localhost:8003",
  model: "whisper-large-v3",
  language: "en",
  temperature: 0.0,
  beam_size: 5,
  best_of: 5,
  patience: 1.0,
  length_penalty: 1.0,
  suppress_tokens: "-1",
  initial_prompt: "The following is a conversation with ALFRED, an AI assistant.",
  condition_on_previous_text: true,
  fp16: true,
  compression_ratio_threshold: 2.4,
  logprob_threshold: -1.0,
  no_speech_threshold: 0.6
}
```

#### **Apple Silicon STT Service (Local Mac)**
```javascript
// Apple Silicon STT Service Configuration
{
  service_url: "http://localhost:8013",
  model: "mlx-community/whisper-large-v3-mlx-4bit",
  device: "mps", // Metal Performance Shaders
  quantization: "int4", // 4-bit quantization
  vad_enabled: true, // Voice Activity Detection
  phantom_detection: true, // Skip transcription when no speech
  webm_support: true, // Native WebM audio support
  corruption_detection: true // Audio data integrity validation
}
```

### Text-to-Speech (TTS)

**Multiple TTS engines** with comprehensive fallback hierarchy:

#### **TTS Service Architecture**
```
Browser → /api/alfred/synthesize → routes/voice.js → TTS Service GPU (port 5002) → Audio Response
```

#### **API Endpoints**

**Synthesis Endpoint:**
```javascript
POST /api/alfred/synthesize
Content-Type: application/x-www-form-urlencoded

// Required Parameters
{
  text: "Text to synthesize",
  engine: "kokoro", // TTS engine to use
  voice_id: "en", // Voice identifier
  speed: 1.0, // Speech speed (default: 1.0)
  gender: "female", // Voice gender (default: "female")
  emotion: "neutral", // Emotional tone (default: "neutral")
  exaggeration: 0.5, // Emotion intensity 0.0-1.0 (default: 0.5)
  cfg_weight: 0.5, // Configuration weight 0.0-1.0 (default: 0.5)
  voice_cloning: false // Enable voice cloning (default: false)
}

// Response Format
{
  "audio_data": "base64_encoded_wav_audio",
  "engine": "engine_used",
  "voice": "voice_used", 
  "processing_time_ms": 1250,
  "cached": false
}
```

**Health Endpoint:**
```javascript
GET /api/alfred/health

// Response
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

#### **Available TTS Engines**

##### **1. Kokoro TTS** (Primary - GPU-Accelerated)
```javascript
{
  engine: "kokoro",
  voice_id: "en", // Language-based voices
  // Available voices:
  // "en" / "a" - American English
  // "en-gb" / "b" - British English  
  // "es" / "e" - Spanish
  // "fr" / "f" - French
  // "de" / "d" - German
  // "it" / "i" - Italian
  // "pt" / "p" - Portuguese
  // "ja" / "j" - Japanese
  // "ko" / "k" - Korean
  // "zh" / "z" - Chinese
  // "default" - American English
}
```
- **Status**: ✅ Available (Official Python package)
- **Quality**: High neural synthesis with 82M parameters
- **Speed**: Fast (GPU-accelerated when available)
- **Sample Rate**: 24kHz
- **Models**: Auto-downloaded on first use

##### **2. Silero Neural TTS** (GPU-Accelerated)
```javascript
{
  engine: "silero",
  voice_id: "chatterbox", // Available voices:
  // "chatterbox" - Default voice
  // "female_1" - Female voice variant 1
  // "female_2" - Female voice variant 2
  // "male_1" - Male voice variant 1
  // "male_2" - Male voice variant 2
  // "expressive" - Expressive voice
  // "calm" - Calm voice
  // "announcer" - Announcer style
  // "storyteller" - Storytelling voice
}
```
- **Status**: ✅ Available (GPU-accelerated)
- **Quality**: High neural synthesis
- **Speed**: Fast (CUDA-accelerated)
- **Sample Rate**: 48000Hz

##### **3. ElevenLabs TTS** (Premium)
```javascript
{
  engine: "elevenlabs",
  voice_id: "pNInz6obpgDQGcFmaJgB", // Available voices:
  // "pNInz6obpgDQGcFmaJgB" - Adam (Male, Deep)
  // "EXAVITQu4vr4xnSDxMaL" - Bella (Female, Sweet)
  // "VR6AewLTigWG4xSOukaG" - Arnold (Male, Crisp)
  // "pMsXgVXv3BLzUgSXRplE" - Freya (Female, Conversational)
  // "onwK4e9ZLuTAKqWW03F9" - Daniel (Male, British)
  // "rrnzWnb1k1hLVqzwuuGl" - Jeremy (Male, American)
  // "cgSgspJ2msm6clMCkdW9" - Jessica (Female, Expressive)
  // "JBFqnCBsd6RMkjVDRZzb" - George (Male, Raspy)
  // "YEUXwZHP2c25CNI7A3tf" - Charlotte (Female, Seductive)
  // "oWAxZDx7w5VEj9dCyTzz" - Grace (Female, Calm)
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0.2,
  use_speaker_boost: true
}
```
- **Status**: ✅ Available (API key required)
- **Quality**: Excellent (premium)
- **Speed**: Fast
- **Requires**: ELEVENLABS_API_KEY environment variable

##### **4. Edge TTS** (Microsoft)
```javascript
{
  engine: "edge_tts",
  voice_id: "en-GB-RyanNeural", // Available voices:
  // "en-GB-RyanNeural" - British male
  // "en-GB-GeorgeNeural" - British male (older)
  // "en-GB-SoniaNeural" - British female
  // "en-US-GuyNeural" - American male
  // "en-US-JennyNeural" - American female
  rate: "+0%",
  pitch: "+0Hz"
}
```
- **Status**: ⚠️ Intermittent (403 rate limiting)
- **Quality**: High neural voices
- **Speed**: Fast
- **Quirks**: Microsoft rate limiting, IP-based restrictions possible

##### **5. Google Text-to-Speech (gTTS)**
```javascript
{
  engine: "gtts",
  voice_id: "en", // Language-based voices
  // "en", "es", "fr", "de", "it", "pt", "ja", "ko", "zh", etc.
}
```
- **Status**: ✅ Available
- **Quality**: Good
- **Speed**: Moderate (network dependent)
- **Requires**: Internet connection

##### **6. eSpeak TTS** (Fallback)
```javascript
{
  engine: "espeak",
  voice_id: "en", // System eSpeak voices (language-based)
}
```
- **Status**: ✅ Available (Offline)
- **Quality**: Low (robotic but reliable)
- **Speed**: Very fast
- **Quirks**: Completely offline, robotic sound quality, very reliable fallback

#### **Engine Selection Logic**

The system attempts engines in this order:

1. **Requested Engine** - Try the specifically requested engine first
2. **Fallback Chain** - If primary fails:
   - Kokoro → Silero → Edge TTS → gTTS → eSpeak
3. **Final Fallback** - Browser TTS if all engines fail

#### **Performance Characteristics**

| Engine | Processing Time | Quality | Network Required |
|--------|----------------|---------|------------------|
| Kokoro | 1-3 seconds | High | No |
| Silero | 1-3 seconds | High | No |
| ElevenLabs | 2-5 seconds | Excellent | Yes |
| Edge TTS | 2-5 seconds | High | Yes |
| gTTS | 2-5 seconds | Good | Yes |
| eSpeak | <1 second | Low | No |

**Audio Format**: WAV, 48kHz sample rate (Silero), variable for other engines

### Smart Turn Detection

**AI-powered endpoint detection** for natural conversations:

#### **Remote Smart Turn Service (RTX 4090)**
```javascript
// Remote Smart Turn Service Configuration
{
  service_url: "http://localhost:8004",
  model_path: "./models/smart_turn/",
  min_probability: 0.55,
  window_size: 1024,
  hop_length: 512
}
```

#### **Apple Silicon Smart Turn Service (Local Mac)**
```javascript
// Apple Silicon Smart Turn Service Configuration
{
  service_url: "http://localhost:8014",
  algorithm: "probabilistic_endpoint_detection",
  threshold: 0.5,
  response_time: "100-200ms",
  real_time_processing: true,
  confidence_scoring: true,
  adaptive_thresholds: true,
  low_latency_optimized: true
}
```

### Adaptive Streaming

**Real-time audio generation** with chunked responses:

- **Natural Breaks**: Sentence-based chunking for natural speech
- **Multiple Engines**: Fallback hierarchy (ElevenLabs → Edge TTS → Chatterbox)
- **Voice Cloning**: Support for custom voice training
- **Performance Optimization**: Cached TTS results per session

---

## Apple Silicon Services

### Local Mac Services Architecture

ALFRED supports **Apple Silicon-optimized local services** that provide high-performance speech processing on Mac hardware:

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Mac Client    │    │  Remote Backend  │    │   Mac Services  │
│                 │    │  (RTX 4090)      │    │                 │
│ • Voice UI      │◄──►│ • LLM/RAG        │    │ • STT Service   │
│ • Audio Capture │    │ • TTS (ElevenLabs│    │ • Smart Turn    │
│ • Playback      │    │ • Response Gen   │    │ • VAD           │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### Service Management

#### **Quick Start Commands**
```bash
# Start all Mac STT services with logging
make mac-stt-services

# Check service status
make mac-status

# Stop all services
make mac-stop

# Restart all services
make mac-restart
```

#### **Service Status Monitoring**
```bash
# Monitor individual service logs
make mac-logs-stt              # STT Service logs
make mac-logs-smart-turn       # Smart Turn Service logs  
make mac-logs-interface        # Interface Server logs
make mac-logs-all              # All services simultaneously
```

#### **Health Check Examples**
```bash
# Healthy Services
$ make mac-status
Mac STT Services Status:
🧠 Smart Turn Service: ✅ Running (PID: 12345)
🎤 STT Service: ✅ Running (PID: 12346)  
🌐 Interface Server: ✅ Running (PID: 12347)

Port Status:
  Port 8014 (Smart Turn): ✅ Active
  Port 8013 (STT): ✅ Active
  Port 3001 (Interface): ✅ Active
```

### Apple Silicon STT Service

#### **MLX Whisper Integration**
```javascript
// Apple Silicon STT Configuration
{
  model: "mlx-community/whisper-large-v3-mlx-4bit",
  device: "mps", // Metal Performance Shaders
  quantization: "int4", // 4-bit quantization for efficiency
  vad_enabled: true, // Silero VAD integration
  phantom_detection: true, // Skip transcription when no speech
  webm_support: true, // Native WebM audio support
  corruption_detection: true // Audio data integrity validation
}
```

#### **Performance Characteristics**
- **Processing Speed**: 2-5x faster than CPU-only implementations
- **Memory Usage**: 2-4GB RAM during active transcription
- **GPU Utilization**: Efficient Metal Performance Shaders usage
- **Latency**: 200-800ms (depending on audio length)
- **Power Efficiency**: Optimized for laptop battery life

#### **Model Installation**
```bash
# Navigate to mac-client directory
cd mac-client

# Create Python virtual environment
python3 -m venv mac-client-env
source mac-client-env/bin/activate

# Install dependencies
pip install -r requirements.txt

# Models auto-download on first run:
# - MLX Whisper Large V3 (4-bit): ~1.5GB
# - Silero VAD Model: ~50MB
```

### Apple Silicon Smart Turn Service

#### **Endpoint Detection Features**
```javascript
// Smart Turn Service Features
{
  algorithm: "probabilistic_endpoint_detection",
  threshold: 0.5, // Configurable detection threshold
  response_time: "100-200ms", // Detection latency
  real_time_processing: true, // Analyzes audio chunks as they arrive
  confidence_scoring: true, // Returns probability scores
  adaptive_thresholds: true, // Adjusts sensitivity based on audio
  low_latency_optimized: true // Optimized for conversational response times
}
```

### Voice Interface Server

#### **Service Coordination**
```javascript
// Interface Server Configuration
{
  port: 3001,
  backend_proxy: true, // Routes requests to remote RTX 4090 backend
  service_coordination: true, // Manages STT and Smart Turn communication
  websocket_streaming: true, // Handles real-time audio/text streaming
  error_handling: true, // Provides fallback mechanisms
  health_endpoints: true // Service health monitoring
}
```

### Troubleshooting Apple Silicon Services

#### **Common Issues & Solutions**

**1. Services Won't Start**
```bash
# Check if ports are in use
lsof -i :8014 :8013 :3001

# Kill conflicting processes
make mac-stop

# Restart services
make mac-stt-services
```

**2. STT Model Download Issues**
```bash
# Check internet connection and try manual download
cd mac-client
source mac-client-env/bin/activate
python -c "import mlx_whisper; mlx_whisper.load_model('mlx-community/whisper-large-v3-mlx-4bit')"
```

**3. Audio Processing Errors**
```bash
# Check STT service logs for audio format issues
make mac-logs-stt

# Common issues: corrupted WebM data, unsupported formats
```

**4. Smart Turn Detection Not Working**
```bash
# Check Smart Turn service logs
make mac-logs-smart-turn

# Verify audio is reaching the service
# Check threshold settings (default: 0.5)
```

#### **Debug Mode**
```bash
# Enable verbose logging
export DEBUG=1
export LOG_LEVEL=DEBUG
make mac-stt-services
```

#### **Health Checks**
```bash
# Test individual services
curl http://localhost:8013/health  # STT Service
curl http://localhost:8014/health  # Smart Turn Service  
curl http://localhost:3001/health  # Interface Server
```

### Integration Benefits

The Apple Silicon services provide:

1. **Low-latency local processing** for speech recognition
2. **High-performance remote processing** for AI responses  
3. **Optimized resource utilization** across both systems
4. **Battery efficiency** for laptop usage
5. **Native WebM support** for browser audio capture

### Configuration

#### **Environment Variables**
```bash
# STT Service Configuration
STT_MODEL="mlx-community/whisper-large-v3-mlx-4bit"
STT_DEVICE="mps"
STT_PORT="8013"

# Smart Turn Service Configuration  
SMART_TURN_PORT="8014"
SMART_TURN_THRESHOLD="0.5"

# Interface Server Configuration
INTERFACE_PORT="3001"
BACKEND_URL="https://api.oip.onl/api"
```

---

## RAG System

### Vector Search Architecture

ALFRED uses **Elasticsearch** as its primary vector search engine, combined with sophisticated content retrieval strategies:

```javascript
// Elasticsearch Configuration
{
  base_url: "http://elasticsearch:9200",
  index_name: "oip_records",
  search_params: {
    resolveDepth: 2,           // Resolve linked records
    summarizeTags: true,       // Enable tag summarization
    tagCount: 15,              // Number of tags to analyze
    limit: 20,                 // Max results to return
    sortBy: "matchCount:desc"  // Relevance-based sorting
  }
}
```

### Question Analysis Pipeline

#### 1. **LLM-Powered Analysis**
```javascript
// Question analysis result
{
  isFollowUp: false,
  category: "news", // "recipe", "exercise", "news", "podcast"
  primaryEntity: "president",
  modifiers: ["current", "United States"],
  secondEntity: ""
}
```

#### 2. **Advanced Search Strategy**
- **Initial Search**: Broad search with primary entity
- **Tag Refinement**: Uses tag summarization for precise filtering
- **Cuisine/Category Filtering**: Specialized filters for recipes/exercises
- **Semantic Matching**: Elasticsearch's full-text search with relevance scoring
- **Multi-Record Resolution**: Resolves linked records (resolveDepth=2)

#### 3. **Content Extraction & Processing**
- **Full Text Retrieval**: Fetches complete article content from web URLs
- **Media Processing**: Extracts images, audio, video with metadata
- **Nutritional Analysis**: Recipe-specific data (prep time, ingredients, calories)
- **Exercise Details**: Instructions, muscle groups, equipment, sets/reps
- **Template Field Mapping**: Dynamic field extraction based on record types

### Follow-up Detection

**Context-aware conversation management**:

```javascript
// Context indicators for follow-up detection
- Pronouns: "they", "it", "this", "that"
- Definite articles: "the recipe", "the person"  
- Category matching: Question category must match loaded records
- Single record mode: Questions without clear subjects when 1-3 records loaded
```

### Advanced RAG Features

#### **Tag Summarization & Refinement**
```javascript
// Tag-based search refinement
async refineSearchWithTags(question, subject, modifiers, recordType, options = {}) {
  // Get tag summary for current results
  const tagSummaryFilters = {
    search: subject,
    recordType: recordType,
    summarizeTags: true,
    tagCount: recordType === 'recipe' ? 10 : this.maxTagsToAnalyze,
    limit: this.maxRecordsForTagAnalysis
  };
  
  // Find matching tags for modifiers
  const matchingTags = this.findMatchingTags(modifiers, tagResults.tagSummary);
  
  // Perform refined search with tags
  const refinedFilters = {
    search: subject,
    recordType: recordType,
    tags: matchingTags.join(','),
    tagsMatchMode: 'AND',
    sortBy: 'matchCount:desc'
  };
}
```

#### **Content Caching & Memory Management**
```javascript
// LRU Cache with automatic eviction
class ALFRED {
  constructor() {
    this.fullTextCache = new Map();
    this.maxCacheSize = parseInt(process.env.ALFRED_CACHE_MAX_SIZE) || 1000;
    this.cacheAccessOrder = [];
    this.cacheMaxAge = parseInt(process.env.ALFRED_CACHE_MAX_AGE) || 1800000; // 30 minutes
  }
  
  setCacheItem(key, value) {
    // Remove if already exists (to update access order)
    if (this.fullTextCache.has(key)) {
      const index = this.cacheAccessOrder.indexOf(key);
      if (index > -1) {
        this.cacheAccessOrder.splice(index, 1);
      }
    }
    
    // Add to cache and track access
    this.fullTextCache.set(key, value);
    this.cacheAccessOrder.push(key);
    
    // Evict oldest if cache exceeds max size
    while (this.fullTextCache.size > this.maxCacheSize) {
      const oldestKey = this.cacheAccessOrder.shift();
      this.fullTextCache.delete(oldestKey);
    }
  }
}
```

#### **Template Field Mapping**
```javascript
// Dynamic template field extraction
async getTemplateFieldsForRecordType(recordType) {
  try {
    const tx = getTemplateTxidByName(recordType);
    if (!tx) return null;
    const template = await searchTemplateByTxId(tx);
    if (!template || !template.data) return null;
    
    if (template.data.fieldsInTemplate) return template.data.fieldsInTemplate;
    
    // Parse raw JSON string if necessary
    if (template.data.fields) {
      const raw = typeof template.data.fields === 'string' ? 
        JSON.parse(template.data.fields) : template.data.fields;
      const map = {};
      Object.keys(raw || {}).forEach(k => {
        if (k.startsWith('index_')) {
          const fieldName = k.replace('index_', '');
          map[fieldName] = { type: raw[fieldName] || 'string', index: raw[k] };
        }
      });
      return map;
    }
  } catch (e) {
    console.warn('[ALFRED] Template fields lookup failed:', e.message);
  }
  return null;
}
```

### Record Type Support

- **Posts/News**: Full text articles with web URLs
- **Recipes**: Ingredients, instructions, nutrition, timing
- **Exercises**: Step-by-step instructions, muscle groups, equipment
- **Workouts**: Exercise sequences with sets/reps
- **Podcasts**: Episode transcripts, citations, show information
- **Videos/Images**: Media content with metadata

### Content Processing Examples

#### Recipe Processing
```javascript
// Enhanced recipe data extraction
{
  prepTimeMinutes: 15,
  cookTimeMinutes: 25,
  totalTimeMinutes: 40,
  servings: 4,
  difficulty: "Easy",
  cuisine: "Mediterranean",
  ingredients: ["2 lbs chicken breast", "1/4 cup olive oil", "..."],
  instructions: ["Step 1: Marinate chicken...", "Step 2: Heat grill..."],
  nutrition: {
    calories: 320,
    proteinG: 28.5,
    fatG: 18.2,
    carbohydratesG: 8.1
  }
}
```

#### Exercise Processing
```javascript
// Comprehensive exercise data
{
  muscleGroups: ["Chest", "Shoulders", "Triceps"],
  equipmentRequired: ["Barbell", "Bench"],
  difficulty: "Intermediate",
  category: "Strength",
  instructions: ["Lie on bench...", "Lower bar to chest...", "Press up..."],
  recommendedSets: 3,
  recommendedReps: 8-12,
  estimatedDurationMinutes: 5
}
```

---

## Multi-LLM Backend

### Cloud Models

#### OpenAI Integration
```javascript
// OpenAI API Configuration
{
  api_key: process.env.OPENAI_API_KEY,
  models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
  base_url: "https://api.openai.com/v1/chat/completions",
  timeout: 15000,
  temperature: 0.4,
  max_tokens: 700
}
```

#### XAI (Grok) Integration
```javascript
// XAI API Configuration
{
  api_key: process.env.XAI_API_KEY,
  models: ["grok-4", "grok-4-fast", "grok-beta"],
  base_url: "https://api.x.ai/v1/chat/completions",
  timeout: 15000,
  temperature: 0.4,
  max_tokens: 700
}
```

### Local Models (Ollama)

```javascript
// Ollama Configuration
{
  base_url: process.env.OLLAMA_HOST || "http://ollama:11434",
  models: [
    "llama3.2:3b",    // Default for RAG analysis
    "mistral:7b",     // Fast parallel processing
    "llama2:7b",      // Alternative local model
    "tinyllama"       // Ultra-fast responses
  ],
  timeout: 25000,
  options: {
    temperature: 0.3,
    top_p: 0.9,
    top_k: 40,
    repeat_penalty: 1.1,
    num_predict: 512
  }
}
```

### Parallel Processing

**Racing strategy** for optimal performance:

```javascript
// Parallel LLM Race Configuration
const requests = [
  // Local Ollama (25s timeout)
  ollamaRequest,
  
  // Cloud models (15s timeout each)
  openaiRequest,    // if OPENAI_API_KEY available
  xaiRequest,       // if XAI_API_KEY available
  xaiFastRequest    // if XAI_API_KEY available
];

// First response wins
const winner = await Promise.race(requests);
```

### Model Selection Strategy

| Use Case | Recommended Model | Response Time | Quality |
|----------|------------------|---------------|---------|
| RAG Analysis | `llama3.2:3b` | 5-15s | High |
| Fast General | `processing_mode: "llm"` | 2-15s | High |
| Premium Quality | `llm-grok-4` | 3-20s | Very High |
| Ultra Fast | `llm-tinyllama` | 1-5s | Good |

---

## Conversation Session History

### Complete Session Management System

ALFRED implements a comprehensive conversation session history system using **GUN encrypted storage** with user authentication and privacy controls.

#### **Session Template Schema**

The `conversationSession` template provides rich metadata tracking:

```javascript
{
  "conversationSession": {
    "session_id": "string",
    "index_session_id": 0,
    "start_timestamp": "uint64",
    "index_start_timestamp": 1,
    "last_activity_timestamp": "uint64",
    "index_last_activity_timestamp": 2,
    "last_modified_timestamp": "uint64",
    "index_last_modified_timestamp": 3,
    "message_count": "uint64",
    "index_message_count": 4,
    "messages": "repeated string",
    "index_messages": 5,
    "message_timestamps": "repeated uint64",
    "index_message_timestamps": 6,
    "message_roles": "repeated string",
    "index_message_roles": 7,
    "model_name": "string",
    "index_model_name": 8,
    "model_provider": "repeated dref",
    "index_model_provider": 9,
    "total_tokens": "uint64",
    "index_total_tokens": 10,
    "input_tokens": "uint64",
    "index_input_tokens": 11,
    "output_tokens": "uint64",
    "index_output_tokens": 12,
    "processing_mode": "enum",
    "processingModeValues": [
      { "code": "rag", "name": "RAG (Retrieval Augmented Generation)" },
      { "code": "llm", "name": "LLM (Large Language Model)" },
      { "code": "hybrid", "name": "Hybrid (RAG + LLM)" }
    ],
    "index_processing_mode": 13,
    "conversation_type": "enum",
    "conversationTypeValues": [
      { "code": "voice", "name": "Voice Conversation" },
      { "code": "text", "name": "Text Conversation" },
      { "code": "mixed", "name": "Mixed Voice/Text" }
    ],
    "index_conversation_type": 14,
    "is_archived": "bool",
    "index_is_archived": 15,
    "audio_quality_score": "float",
    "index_audio_quality_score": 16,
    "response_time_avg_ms": "uint64",
    "index_response_time_avg_ms": 17,
    "error_count": "uint64",
    "index_error_count": 18,
    "is_private": "bool",
    "index_is_private": 19,
    "owner_pubkey": "string",
    "index_owner_pubkey": 20,
    "shared_with": "repeated string",
    "index_shared_with": 21,
    "version": "string",
    "index_version": 22,
    "device_info": "string",
    "index_device_info": 23,
    "folder_id": "dref",
    "index_folder_id": 24,
    "is_pinned": "bool",
    "index_is_pinned": 25,
    "metadata": "string",
    "index_metadata": 26
  }
}
```

### Authentication & Security

#### **Enhanced Authentication Middleware**

```javascript
// helpers/utils.js - Enhanced authenticateToken
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    try {
        const verified = jwt.verify(token, process.env.JWT_SECRET);
        req.user = verified;

        // For GUN record requests, verify user owns the record
        if (req.params.soul || req.query.soul) {
            const soul = req.params.soul || req.query.soul;
            const userPubKey = verified.publisherPubKey; // Extract from JWT

            // Verify soul belongs to authenticated user
            if (!soul.startsWith(userPubKey.substring(0, 12))) {
                return res.status(403).json({ error: 'Access denied to this record' });
            }
        }

        next();
    } catch (error) {
        return res.status(403).json({ error: 'Invalid token' });
    }
};
```

#### **GUN Record API Endpoints**

```javascript
// routes/records.js - GUN record management
// GET /api/records/gun/:soul - Get specific GUN record
router.get('/gun/:soul', authenticateToken, async (req, res) => {
    try {
        const { soul } = req.params;
        const { decrypt = true } = req.query;

        const gunHelper = new GunHelper();
        const record = await gunHelper.getRecord(soul, { decrypt });

        if (!record) {
            return res.status(404).json({ error: 'Record not found' });
        }

        res.status(200).json({
            message: 'GUN record retrieved successfully',
            record: {
                ...record,
                oip: {
                    ...record.oip,
                    did: `did:gun:${soul}`,
                    storage: 'gun'
                }
            }
        });
    } catch (error) {
        console.error('Error retrieving GUN record:', error);
        res.status(500).json({ error: 'Failed to retrieve GUN record' });
    }
});

// GET /api/records/gun - List user's GUN records
router.get('/gun', authenticateToken, async (req, res) => {
    try {
        const { limit = 20, offset = 0 } = req.query;
        const userPubKey = req.user.publisherPubKey;

        const gunHelper = new GunHelper();
        const records = await gunHelper.listUserRecords(userPubKey, { limit, offset });

        res.status(200).json({
            message: 'GUN records retrieved successfully',
            records: records.map(record => ({
                ...record,
                oip: {
                    ...record.oip,
                    did: `did:gun:${record.soul}`,
                    storage: 'gun'
                }
            })),
            pagination: { limit, offset, total: records.length }
        });
    } catch (error) {
        console.error('Error retrieving GUN records:', error);
        res.status(500).json({ error: 'Failed to retrieve GUN records' });
    }
});
```

### Frontend Session Management

#### **Authentication Manager**

```javascript
// mac-client/alfred.html - AuthManager class
class AuthManager {
  constructor() {
    this.token = localStorage.getItem('alfred_token');
    this.user = null;
    this.setupEventListeners();
  }

  async login() {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    try {
      const response = await fetch(`${this.backendUrl}/api/user/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (data.success) {
        this.token = data.token;
        this.user = jwt_decode(data.token); // Decode JWT to get user info
        localStorage.setItem('alfred_token', this.token);

        document.getElementById('auth-modal').close();
        this.onAuthenticated();
      } else {
        alert(data.error || 'Login failed');
      }
    } catch (error) {
      alert('Login failed: ' + error.message);
    }
  }

  isAuthenticated() {
    return !!this.token;
  }

  logout() {
    this.token = null;
    this.user = null;
    localStorage.removeItem('alfred_token');
    this.showAuthModal();
  }
}
```

#### **Session Manager**

```javascript
// mac-client/alfred.html - SessionManager class
class SessionManager {
  constructor(authManager) {
    this.authManager = authManager;
    this.currentSession = null;
    this.sessions = [];
    this.modelProviderCache = {}; // Cache for model provider lookups
  }

  // Lookup model provider DID by model name
  async lookupModelProviderDID(modelName) {
    // Check cache first
    if (this.modelProviderCache[modelName]) {
      return this.modelProviderCache[modelName];
    }

    try {
      const response = await fetch(`https://api.oip.onl/api/records?recordType=modelProvider&model=${encodeURIComponent(modelName)}&sortBy=inArweaveBlock:desc&limit=1`);

      if (!response.ok) {
        console.warn(`Failed to lookup model provider for ${modelName}`);
        return null;
      }

      const data = await response.json();

      if (data.records && data.records.length > 0) {
        const providerDID = data.records[0].oip.didTx;

        // Cache the result
        this.modelProviderCache[modelName] = providerDID;

        console.log(`Found model provider DID for ${modelName}: ${providerDID}`);
        return providerDID;
      }

      console.warn(`No model provider found for ${modelName}`);
      return null;
    } catch (error) {
      console.error(`Error looking up model provider for ${modelName}:`, error);
      return null;
    }
  }

  async createNewSession(title = null, modelName = 'llama3.2:3b') {
    if (!this.authManager.isAuthenticated()) return null;

    const sessionId = `session_${Date.now()}`;

    // Lookup the model provider DID for the specified model
    const modelProviderDID = await this.lookupModelProviderDID(modelName);

    const sessionData = {
      basic: {
        name: title || `Session ${this.sessions.length + 1}`,
        description: 'Alfred conversation session',
        date: Date.now(),
        language: 'en'
      },
      conversationSession: {
        session_id: sessionId,
        start_timestamp: Date.now(),
        last_activity_timestamp: Date.now(),
        last_modified_timestamp: Date.now(),
        message_count: 0,
        messages: [],
        message_timestamps: [],
        message_roles: [],
        model_name: modelName,
        model_provider: modelProviderDID ? [modelProviderDID] : [], // Reference to model provider
        total_tokens: 0,
        input_tokens: 0,
        output_tokens: 0,
        processing_mode: 'rag',
        conversation_type: 'voice',
        is_archived: false,
        is_private: true,
        owner_pubkey: this.authManager.user.publisherPubKey,
        version: '1.0.0'
      }
    };

    try {
      const response = await fetch(`${this.backendUrl}/api/records/newRecord?recordType=conversationSession&storage=gun&localId=${sessionId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.authManager.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(sessionData)
      });

      const data = await response.json();

      if (data.transactionId || data.did) {
        this.currentSession = {
          ...sessionData,
          oip: {
            did: data.did || data.transactionId,
            storage: 'gun'
          }
        };

        this.sessions.unshift(this.currentSession);
        this.updateHistoryUI();
        return this.currentSession;
      }
    } catch (error) {
      console.error('Failed to create session:', error);
    }

    return null;
  }

  async updateCurrentSession(messages, model, tokens, processingMode = 'rag', conversationType = 'voice') {
    if (!this.currentSession) return;

    const endTime = Date.now();

    // Extract messages, timestamps, and roles from the conversation
    const messageTexts = [];
    const messageTimestamps = [];
    const messageRoles = [];

    messages.forEach(msg => {
      if (typeof msg === 'object') {
        messageTexts.push(msg.content || msg.text || '');
        messageTimestamps.push(msg.timestamp || Date.now());
        messageRoles.push(msg.role || 'user');
      } else {
        // Handle string messages
        messageTexts.push(msg);
        messageTimestamps.push(Date.now());
        messageRoles.push('user');
      }
    });

    // Lookup model provider DID if model changed
    let modelProviderDID = this.currentSession.conversationSession.model_provider?.[0];
    if (model !== this.currentSession.conversationSession.model_name) {
      modelProviderDID = await this.lookupModelProviderDID(model);
    }

    this.currentSession.conversationSession.last_activity_timestamp = endTime;
    this.currentSession.conversationSession.last_modified_timestamp = endTime;
    this.currentSession.conversationSession.message_count = messageTexts.length;
    this.currentSession.conversationSession.messages = messageTexts;
    this.currentSession.conversationSession.message_timestamps = messageTimestamps;
    this.currentSession.conversationSession.message_roles = messageRoles;
    this.currentSession.conversationSession.model_name = model;
    this.currentSession.conversationSession.model_provider = modelProviderDID ? [modelProviderDID] : [];
    this.currentSession.conversationSession.total_tokens = tokens || 0;
    this.currentSession.conversationSession.processing_mode = processingMode;
    this.currentSession.conversationSession.conversation_type = conversationType;

    try {
      const response = await fetch(`${this.backendUrl}/api/records/newRecord?recordType=conversationSession&storage=gun&localId=${this.currentSession.conversationSession.session_id}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.authManager.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(this.currentSession)
      });

      const data = await response.json();
      console.log('Session updated:', data);
    } catch (error) {
      console.error('Failed to update session:', error);
    }
  }

  async loadSession(sessionDid) {
    try {
      const response = await fetch(`${this.backendUrl}/api/records/gun/${sessionDid.split(':')[2]}`, {
        headers: {
          'Authorization': `Bearer ${this.authManager.token}`
        }
      });

      const data = await response.json();

      if (data.record) {
        // Load session messages into conversation
        if (data.record.conversationSession && data.record.conversationSession.messages) {
          const messages = [];
          for (let i = 0; i < data.record.conversationSession.messages.length; i++) {
            messages.push({
              role: data.record.conversationSession.message_roles[i] || 'user',
              content: data.record.conversationSession.messages[i],
              timestamp: data.record.conversationSession.message_timestamps[i] || Date.now()
            });
          }
          // Note: You would need to call alfred.loadSessionMessages(messages) here
        }
      }

      return data.record;
    } catch (error) {
      console.error('Failed to load session:', error);
      return null;
    }
  }
}
```

### Integration with ALFRED Voice Processing

#### **ALFREDInterface Integration**

```javascript
// mac-client/alfred.html - ALFREDInterface updates
class ALFREDInterface {
  constructor() {
    // ... existing constructor code ...

    // Add session management
    this.sessionManager = window.sessionManager;
    this.conversationMessages = [];
  }

  async initializeInterface() {
    // ... existing code ...
    this.sessionManager.loadUserSessions();
  }

  async sendToALFREDBackend(audioBlob) {
    // ... existing code ...

    // Create session if this is the first message
    if (this.conversationMessages.length === 0 && this.sessionManager) {
      await this.sessionManager.createNewSession(null, model); // Pass the current model
    }

    // Add user message to conversation
    this.conversationMessages.push({
      role: 'user',
      content: transcribedText,
      timestamp: Date.now()
    });

    // ... existing backend communication ...

    // Add assistant response to conversation
    this.conversationMessages.push({
      role: 'assistant',
      content: fullResponse,
      timestamp: Date.now()
    });

    // Update session with new messages and current parameters
    if (this.sessionManager && this.sessionManager.currentSession) {
      this.sessionManager.updateCurrentSession(
        this.conversationMessages,
        model, // Current model name
        0, // Token count (would be provided by backend)
        processingMode, // 'rag' or 'llm'
        'voice' // Conversation type
      );
    }
  }

  addMessage(role, text) {
    // ... existing code ...

    // Add to conversation messages for session tracking
    this.conversationMessages.push({
      role: role === 'system' ? 'user' : role,
      content: text,
      timestamp: Date.now()
    });
  }
}
```

### Encryption & Security

**AES-256-GCM encryption** for privacy:

```javascript
// Backend Encryption (Node.js)
const key = crypto.pbkdf2Sync('gun-encryption-key', 'salt', 100000, 32, 'sha256');
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

const encryptedBuf = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const authTag = cipher.getAuthTag();

const encryptedData = {
  encrypted: encryptedBuf.toString('base64'),
  iv: iv.toString('base64'),
  tag: authTag.toString('base64')
};
```

### Data Structure & Example

#### **Complete Conversation Session Record**

```javascript
{
  "basic": {
    "name": "Morning Chat with Alfred",
    "description": "Daily conversation session",
    "language": "en",
    "nsfw": false,
    "tagItems": ["productivity", "planning", "morning"]
  },
  "conversationSession": {
    "session_id": "session_1703123456789",
    "start_timestamp": 1703123456789,
    "last_activity_timestamp": 1703123567890,
    "last_modified_timestamp": 1703123567890,
    "message_count": 6,
    "messages": [
      "Good morning Alfred, what's on the agenda today?",
      "Good morning! Based on your recent activity...",
      "Can you help me organize my priorities for today?",
      "Certainly! Here's your prioritized task list...",
      "That looks good. Can you set a reminder for the team meeting?",
      "Reminder set for 2:00 PM team meeting. I'll notify you 15 minutes before."
    ],
    "message_timestamps": [
      1703123456789,
      1703123458901,
      1703123460123,
      1703123461456,
      1703123566789,
      1703123567890
    ],
    "message_roles": [
      "user", "assistant", "user", "assistant", "user", "assistant"
    ],
    "model_name": "llama3.2:3b",
    "model_provider": ["did:arweave:GOXsTqwMTlDwQN2AT-oCjSy_yrwJ7V0Qg7sGX4vzloY"],
    "total_tokens": 1247,
    "input_tokens": 892,
    "output_tokens": 355,
    "processing_mode": "rag",
    "conversation_type": "voice",
    "is_archived": false,
    "audio_quality_score": 0.95,
    "response_time_avg_ms": 850,
    "error_count": 0,
    "is_private": true,
    "owner_pubkey": "user_public_key_hash",
    "version": "1.0.0",
    "folder_id": null,
    "is_pinned": false
  },
  "oip": {
    "did": "did:gun:userhash123:session_1703123456789",
    "storage": "gun",
    "encrypted": true
  }
}
```

### Security Considerations

1. **Private Records**: All conversation sessions are stored as encrypted GUN records
2. **User Verification**: `authenticateToken` middleware verifies user ownership of records
3. **Access Control**: Only authenticated users can access their own sessions
4. **Encryption**: GUN SEA encryption for sensitive conversation data
5. **Soul Ownership**: Records are tied to user's public key for access control

### Implementation Progress

#### ✅ **Phase 1: Backend Infrastructure - COMPLETED**
- **Phase 1.1**: Enhanced Authentication Middleware - Updated `authenticateToken` in `helpers/utils.js` to verify user ownership of GUN records by extracting `publisherPubKey` from Arweave wallet and validating soul ownership
- **Phase 1.2**: New API Endpoints for GUN Records - Added `/api/records/gun/:soul` and `/api/records/gun` routes in `routes/records.js` with authentication and user verification

#### ✅ **Phase 2: Frontend Authentication - COMPLETED**  
- Added authentication modal with login/register forms to `mac-client/alfred.html`
- Implemented `AuthManager` class with JWT token handling and user authentication
- Added CSS styling for authentication modal

#### ✅ **Phase 3: Session Management - COMPLETED**
- Implemented `SessionManager` class with conversation session creation, updating, and loading
- Added model provider DID lookup and caching functionality
- Integrated session history UI updates

#### ✅ **Phase 4: Integration with Alfred Voice Processing - COMPLETED**
- Updated `ALFREDInterface` class to create sessions automatically on first message
- Added session updates after each conversation turn (both voice and text)
- Implemented `loadSessionMessages` method to restore previous conversations
- Connected session manager to conversation tracking

### Testing & Deployment

#### **Testing Plan**
1. **Authentication Testing**
   - User registration and login
   - JWT token validation
   - Access control for GUN records

2. **Session Management Testing**
   - Create new conversation sessions
   - Update sessions with messages
   - Load and display session history
   - Switch between sessions

3. **Integration Testing**
   - Voice processing creates/updates sessions
   - Session data persists across browser sessions
   - Multiple users have isolated session data

#### **Files Modified/Created**
1. `helpers/utils.js` - Enhanced authenticateToken
2. `routes/records.js` - New GUN record endpoints
3. `config/templates.config.js` - Conversation session template
4. `mac-client/alfred.html` - Authentication UI and session management
5. `helpers/gun.js` - Enhanced GUN helper methods (if needed)

### Querying Session Records

Once records exist on-chain, you can query them via:

```bash
# Query all conversation sessions
https://api.oip.onl/api/records?recordType=conversationSession&sortBy=inArweaveBlock:desc

# Query user's private sessions (requires authentication)
GET /api/records/gun?limit=20&offset=0
Authorization: Bearer <jwt_token>
```

This implementation provides a secure, private conversation history system that integrates seamlessly with ALFRED's existing voice processing capabilities while maintaining user privacy through GUN's encrypted storage.

---

## API Endpoints

### `/api/voice/converse` (Streaming)

**Real-time streaming voice conversation** with adaptive audio generation:

```javascript
// Request
POST /api/voice/converse
Content-Type: multipart/form-data

{
  // Audio input (optional - either audio OR text required)
  audio: File, // Audio file (webm, wav, mp3, etc.)
  
  // Text input (optional - either audio OR text required)  
  text: "Your question here",
  
  // Processing mode
  processing_mode: "rag" | "llm" | "llm-{model}", // Default: "rag"
  
  // Model selection
  model: "llama3.2:3b",
  
  // Voice configuration
  voiceConfig: JSON.stringify({
    engine: "elevenlabs",
    elevenlabs: {
      selectedVoice: "onwK4e9ZLuTAKqWW03F9",
      stability: 0.5,
      similarity_boost: 0.75
    }
  }),
  
  // Context
  conversationHistory: JSON.stringify([...]),
  existing_search_results: [...],
  pinnedDidTx: "did:arweave:..."
}

// Response
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

**Traditional request-response chat** with optional audio synthesis:

```javascript
// Request
POST /api/voice/chat
Content-Type: application/json

{
  text: "Your question",
  processing_mode: "rag", // or "llm" or "llm-{model}"
  model: "llama3.2:3b",
  voice_id: "female_1",
  return_audio: true,
  engine: "edge_tts",
  conversationHistory: JSON.stringify([...]),
  existing_search_results: [...],
  pinnedDidTx: "did:arweave:..."
}

// Response
{
  success: true,
  input_text: "Who is the president?",
  response_text: "Donald Trump is the current president.",
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
  }
}
```

---

## Advanced Features

### Single Record Mode

**Pin a specific record** for detailed Q&A:

```javascript
{
  text: "How do I make this recipe?",
  processing_mode: "rag",
  pinnedDidTx: "did:arweave:abc123...",
  include_filter_analysis: false
}
```

### Voice Engine Control

**Fine-tuned voice synthesis**:

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

**Automatic endpoint detection**:

```javascript
// AI analyzes speech patterns to determine when user finished speaking
{
  audio: audioFile,
  // Smart Turn automatically determines endpoint
}
```

### TTS Text Preprocessing

**Enhanced pronunciation** for better speech synthesis:

```javascript
// ALFRED preprocesses text for optimal TTS
preprocessTextForTTS(text) {
  // Replace number-dash-number patterns with "number to number"
  text = text.replace(/(\d+)-(\d+)/g, '$1 to $2');
  
  // Expand common abbreviations
  text = text.replace(/\btbsp\b/gi, 'tablespoons');
  text = text.replace(/\btsp\b/gi, 'teaspoons');
  
  // Convert decimal fractions to spoken form
  text = text.replace(/\b1\.5\b/g, '1 and one half');
  text = text.replace(/\b0\.5\b/g, 'one half');
  
  return text;
}
```

---

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

# TTS Engine Configuration
KOKORO_MODEL_PATH=/app/models/kokoro
SILERO_MODEL_PATH=/app/models/silero
ESPEAK_VOICE_PATH=/usr/share/espeak-ng-data

# Smart Turn Service
SMART_TURN_SERVICE_URL=http://localhost:8004
SMART_TURN_ENABLED=true
SMART_TURN_MIN_PROB=0.55

# GUN Database
GUN_RELAY_URL=http://gun-relay:8765
GUN_ENCRYPTION_KEY=gun-encryption-key

# Performance
ALFRED_CACHE_MAX_SIZE=1000
ALFRED_CACHE_MAX_AGE=1800000
```

### Model Configuration

```javascript
// ALFRED class configuration
class ALFRED {
  constructor() {
    this.ollamaBaseUrl = process.env.OLLAMA_HOST || 'http://ollama:11434';
    this.defaultModel = process.env.DEFAULT_LLM_MODEL || 'llama3.2:3b';
    
    // Cloud model configurations
    this.xaiApiKey = process.env.XAI_API_KEY;
    this.openaiApiKey = process.env.OPENAI_API_KEY;
    
    // Processing limits
    this.maxRecordsForTagAnalysis = 50;
    this.maxTagsToAnalyze = 30;
    this.maxContextLength = 8000;
    this.maxResults = 5;
    
    // Caching
    this.fullTextCache = new Map();
    this.maxCacheSize = parseInt(process.env.ALFRED_CACHE_MAX_SIZE) || 1000;
    this.cacheMaxAge = parseInt(process.env.ALFRED_CACHE_MAX_AGE) || 1800000;
  }
}
```

### TTS Installation & Setup

#### **Kokoro TTS Installation**
```bash
# Package Installation (already done in Dockerfile)
pip install kokoro==0.3.1 soundfile

# Dependencies
# ✅ kokoro Python package (0.3.1)
# ✅ soundfile for audio I/O
# ✅ Models automatically downloaded on first use

# No manual setup required:
# - Models are downloaded automatically by the package
# - No ONNX files needed
# - No manual configuration required

# Note: The first synthesis request may take longer as the model downloads automatically
```

#### **ElevenLabs Setup**
```bash
# Add your ElevenLabs API key to environment variables
export ELEVENLABS_API_KEY=your_api_key_here

# Verify API key works
curl -H "xi-api-key: $ELEVENLABS_API_KEY" https://api.elevenlabs.io/v1/voices
```

#### **TTS Service Health Monitoring**
```bash
# Check TTS service status
curl http://localhost:5002/health

# Monitor TTS service logs
docker logs -f oip-arweave-indexer-tts-service-gpu-1

# Test individual engines
curl -X POST http://localhost:5002/synthesize \
  -d "text=Hello world&engine=kokoro&voice_id=en"
```

---

## Performance & Optimization

### Parallel Processing

**Racing strategy** for optimal performance:

```javascript
// Multiple models race for fastest response
const requests = [
  // Local Ollama (25s timeout)
  ollamaRequest,
  
  // Cloud models (15s timeout each)
  openaiRequest,    // if OPENAI_API_KEY available
  xaiRequest,       // if XAI_API_KEY available
  xaiFastRequest    // if XAI_API_KEY available
];

// First response wins
const winner = await Promise.race(requests);
```

### Advanced Caching Strategy

**Multi-layer caching** with intelligent eviction:

```javascript
// Full-text content caching with LRU eviction
setCacheItem(key, value) {
  // Remove if already exists (to update access order)
  if (this.fullTextCache.has(key)) {
    const index = this.cacheAccessOrder.indexOf(key);
    if (index > -1) {
      this.cacheAccessOrder.splice(index, 1);
    }
  }

  // Add to cache and track access
  this.fullTextCache.set(key, value);
  this.cacheAccessOrder.push(key);

  // Evict oldest if cache exceeds max size
  while (this.fullTextCache.size > this.maxCacheSize) {
    const oldestKey = this.cacheAccessOrder.shift();
    this.fullTextCache.delete(oldestKey);
  }
}

// Cache expiration management
clearCacheIfNeeded() {
  const timeSinceLastClear = Date.now() - this.lastCacheClear;
  if (timeSinceLastClear >= this.cacheMaxAge) {
    const cacheSize = this.fullTextCache.size;
    this.fullTextCache.clear();
    this.cacheAccessOrder = [];
    this.lastCacheClear = Date.now();
    console.log(`[ALFRED Cache] Auto-cleared cache (${cacheSize} entries) after ${Math.round(timeSinceLastClear / 60000)} minutes`);
  }
}
```

### Search Optimization

**Elasticsearch performance tuning**:

```javascript
// Optimized search parameters
const searchParams = {
  search: question,
  limit: this.maxResults * 2,     // Get more results for filtering
  resolveDepth: 3,               // Resolve linked records
  summarizeTags: true,            // Enable tag summarization
  tagCount: 5,                   // Top 5 tags for context
  sortBy: 'date:desc',           // Sort by relevance
  searchMatchMode: 'OR',         // Broader matching for posts
  searchMatchMode: 'AND'         // Precise matching for recipes
};
```

### Context Management

**Intelligent context building** with length limits:

```javascript
// Context length management
async buildContext(searchResults) {
  const contextParts = [];
  let currentLength = 0;

  // Add record content with clear numbering
  if (searchResults.records && searchResults.records.length > 0) {
    contextParts.push("📚 RELEVANT INFORMATION FROM YOUR DATA:");
    contextParts.push("");
    
    for (let i = 0; i < searchResults.records.length; i++) {
      const record = searchResults.records[i];
      const recordContext = await this.extractRecordContext(record);
      
      if (currentLength + recordContext.length < this.maxContextLength) {
        contextParts.push(`RECORD ${i + 1}:`);
        contextParts.push(recordContext);
        contextParts.push("");
        currentLength += recordContext.length;
      } else {
        break; // Stop adding context to prevent overflow
      }
    }
  }

  return contextParts.join('\n');
}
```

### Performance Metrics

| Mode | Response Time | Accuracy | Use Case |
|------|---------------|----------|----------|
| RAG | 5-30 seconds | Very High | Your data questions |
| LLM Parallel | 2-15 seconds | High | General knowledge |
| LLM Specific | 3-20 seconds | High | Model-specific needs |

### Advanced Performance Features

#### **Memory Leak Prevention**
```javascript
// MEMORY LEAK FIX: LRU cache with size limits instead of unbounded Map
this.fullTextCache = new Map();
this.maxCacheSize = parseInt(process.env.ALFRED_CACHE_MAX_SIZE) || 1000;
this.cacheAccessOrder = [];
this.lastCacheClear = Date.now();
this.cacheMaxAge = parseInt(process.env.ALFRED_CACHE_MAX_AGE) || 1800000; // 30 minutes
```

#### **Intelligent Content Truncation**
```javascript
// Limit full text content to prevent memory overflow
if (fullText) {
  content.fullText = fullText.substring(0, 8000); // Limit to prevent overflow
}

// Smart context building with length limits
if (currentLength + recordContext.length < this.maxContextLength) {
  contextParts.push(recordContext);
  currentLength += recordContext.length;
} else {
  break; // Stop adding context
}
```

#### **Timeout Management**
- **Question Analysis**: 20 seconds (increased for reliability)
- **Main Generation**: 25 seconds for Ollama, 15 seconds for cloud
- **Full Text Fetching**: 15 seconds
- **TTS Synthesis**: 30 seconds
- **Cache Expiration**: 30 minutes automatic cleanup

#### **Resource Monitoring**
```javascript
// Performance monitoring
const memUsage = process.memoryUsage();
console.log(`Memory: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);

// Cache efficiency tracking
const cacheHitRate = this.fullTextCache.size > 0 ? 
  (cacheHits / (cacheHits + cacheMisses)) * 100 : 0;
console.log(`Cache hit rate: ${cacheHitRate.toFixed(1)}%`);
```

---

## Troubleshooting

### Common Issues

#### 1. **Slow RAG Responses**
- **Solution**: Try `processing_mode: "llm"` for general questions
- **Check**: Local LLM models loaded (`docker exec -it ollama ollama list`)
- **Verify**: Database has relevant content for your questions

#### 2. **No Audio Output**
- **Check**: TTS service health (`curl http://localhost:5002/health`)
- **Verify**: ElevenLabs API key if using premium voices
- **Fallback**: Edge TTS → Chatterbox → eSpeak

#### **TTS-Specific Troubleshooting**

**1. "All TTS engines failed"**
```bash
# Check if TTS service is running on port 5002
curl http://localhost:5002/health

# Verify Docker containers are healthy
docker ps | grep tts

# Check network connectivity for cloud engines
curl -I https://api.elevenlabs.io
```

**2. "Invalid response from Kokoro TTS service"**
```bash
# Check TTS service logs for detailed errors
docker logs -f oip-arweave-indexer-tts-service-gpu-1

# Usually indicates TTS service returned wrong response format
```

**3. Edge TTS 403 Errors**
```bash
# Microsoft rate limiting - try again later
# Or use different engine in fallback chain
```

**4. Robotic voice on all engines**
```bash
# Likely falling back to eSpeak
# Check individual engine availability in health endpoint
curl http://localhost:5002/health | jq '.services.tts.details.engines'
```

**5. ElevenLabs API Issues**
```bash
# Verify API key is set
echo $ELEVENLABS_API_KEY

# Check API key validity
curl -H "xi-api-key: $ELEVENLABS_API_KEY" https://api.elevenlabs.io/v1/voices
```

#### 3. **Model Timeouts**
- **Cloud models**: Verify API keys are valid
- **Local models**: Check Ollama service status
- **Alternative**: Use `processing_mode: "llm"` for faster responses

#### 4. **Poor Voice Quality**
- **ElevenLabs**: Adjust stability/similarity settings
- **Edge TTS**: Try different voice selections
- **Chatterbox**: Tune emotion/exaggeration parameters

### Health Checking

```bash
# Check all voice services
curl http://localhost:3000/api/voice/health

# Check specific services
curl http://localhost:8003/health  # STT
curl http://localhost:5002/health  # TTS  
curl http://ollama:11434/api/tags  # Ollama models
```

### Debug Logging

```bash
# Key log patterns to monitor
[ALFRED] Generated response using {source} # Which model won
[Voice Converse] Processing mode: {mode}   # Mode selection
[Direct LLM] First response from {model}   # Parallel race winner
🎉 Adaptive streaming completed           # Streaming success
```

### RAG-Specific Debugging

#### **Search Pipeline Debugging**
```javascript
// RAG pipeline logging
console.log(`[ALFRED] 🔍 Processing query: "${question}"`);
console.log(`[ALFRED] 🎯 Extracted - Subject: "${subject}", Modifiers: [${modifiers.join(', ')}]`);
console.log(`[ALFRED] 📊 Initial search found ${results.length} records`);
console.log(`[ALFRED] ✅ Successfully refined from ${initialResults.records.length} to ${refinedResult.search_results_count} results`);
```

#### **Content Extraction Debugging**
```javascript
// Content extraction monitoring
console.log(`[ALFRED] Processing record: ${basicData.name || 'Untitled'} (type: ${recordType})`);
console.log(`[ALFRED] Retrieved ${fullText.length} characters of full text for: ${content.title}`);
console.log(`[ALFRED] Enhanced recipe data for: ${content.title} (prep: ${content.prepTimeMinutes}min, cook: ${content.cookTimeMinutes}min)`);
```

#### **Cache Performance Monitoring**
```javascript
// Cache efficiency tracking
console.log(`[ALFRED Cache] Evicted oldest entry: ${oldestKey.substring(0, 50)}...`);
console.log(`[ALFRED Cache] Auto-cleared cache (${cacheSize} entries) after ${Math.round(timeSinceLastClear / 60000)} minutes`);
console.log(`[RAG] Using cached full text for: ${recordTitle}`);
```

#### **Model Performance Tracking**
```javascript
// Model race results
console.log(`[ALFRED] 🏆 FIRST TO FINISH: ${result.source} in ${completionTime}ms with ${result.answer.length} chars`);
console.log(`[ALFRED] 🏁 Racing ${requests.length} parallel LLM requests...`);
console.log(`[ALFRED] 🏁 All ${results.length} requests completed - Final results:`, results.map(r => `${r.status === 'fulfilled' ? '✅' : '❌'}`).join(', '));
```

---

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

### Session Management

```javascript
class SessionManager {
  constructor(authManager) {
    this.authManager = authManager;
    this.currentSession = null;
    this.sessions = [];
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
}
```

---

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

*This comprehensive guide covers ALFRED v2.1 with conversation session history, enhanced processing modes, parallel LLM support, and multi-network storage integration. For implementation details, see the source code in `helpers/alfred.js`, `routes/voice.js`, `helpers/gun.js`, and `mac-client/alfred.html`.*
