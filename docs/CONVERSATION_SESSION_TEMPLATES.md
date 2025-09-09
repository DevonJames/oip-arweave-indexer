# Conversation Session Templates Documentation

## Overview

This document describes the new templates created for Alfred's conversation session history system using GUN private encrypted records.

## Templates

### 1. `modelProvider` Template

**Purpose**: Defines AI model providers that can be referenced by conversation sessions.

**Structure**: Uses `basic` + `modelProvider` templates (OIP standard pattern)

**Basic Template Fields** (inherited from basic template):
- `name`: Human-readable provider name (string)
- `description`: Detailed description (string)
- `language`: Primary language (string)
- `nsfw`: Not safe for work flag (bool)
- `tagItems`: Array of tags (repeated string)

**ModelProvider Template Fields**:
- `provider_id`: Unique identifier (string)
- `provider_type`: Local/Cloud/Hybrid (enum)
- `api_endpoint`: API URL (string)
- `supported_models`: Array of model names (repeated string)
- `pricing_model`: Free/Pay-per-token/etc (enum)
- `price_per_1k_tokens`: Cost per 1000 tokens (float)
- `context_window`: Maximum context length (uint64)
- `max_tokens`: Maximum output tokens (uint64)
- `capabilities`: Array of capabilities (repeated string)
- `supported_languages`: Array of languages (repeated string)
- `is_active`: Whether provider is active (bool)
- `version`: Provider version (string)
- `documentation_url`: Documentation link (string)
- `contact_info`: Contact information (string)
- `metadata`: Additional JSON metadata (string)

### 2. `conversationSession` Template

**Purpose**: Stores individual conversation sessions between users and Alfred.

**Fields**:
- `session_id`: Unique session identifier (string)
- `title`: Session title (string)
- `description`: Session description (string)
- `start_timestamp`: When session started (uint64)
- `end_timestamp`: When session ended (uint64)
- `duration_seconds`: Session duration (uint64)
- `message_count`: Number of messages (uint64)
- `messages`: Array of message content (repeated string)
- `message_timestamps`: Array of message timestamps (repeated uint64)
- `message_roles`: Array of message roles (repeated string)
- `model_name`: Specific model used (string)
- `model_provider`: References to model provider records (repeated dref) ⭐
- `total_tokens`: Total tokens used (uint64)
- `input_tokens`: Input tokens (uint64)
- `output_tokens`: Output tokens (uint64)
- `processing_mode`: RAG/LLM/Hybrid (enum)
- `conversation_type`: Voice/Text/Mixed (enum)
- `language`: Primary language (string)
- `tags`: Array of tags (repeated string)
- `audio_quality_score`: Audio quality rating (float)
- `response_time_avg_ms`: Average response time (uint64)
- `interruption_count`: Number of interruptions (uint64)
- `error_count`: Number of errors (uint64)
- `is_private`: Privacy flag (bool)
- `owner_pubkey`: Owner's public key (string)
- `shared_with`: Array of shared user keys (repeated string)
- `version`: Session format version (string)
- `device_info`: Device information (string)
- `network_info`: Network information (string)
- `metadata`: Additional JSON metadata (string)

## Relationship Structure

```
conversationSession
    └── model_provider (repeated dref)
        └── modelProvider records
```

The `conversationSession` template uses `repeated dref` for `model_provider` to reference one or more `modelProvider` records. This allows:

1. **Dynamic Provider List**: New AI providers can be added without updating the template
2. **Rich Provider Data**: Each provider has detailed metadata
3. **Multiple Providers**: Sessions can reference multiple providers (e.g., hybrid setups)
4. **Provider Updates**: Provider information can be updated independently

## Usage Examples

### Creating Model Provider Records

```javascript
// Create Ollama provider record (using basic + modelProvider structure)
const ollamaProvider = {
  "basic": {
    "name": "Ollama (Local)",
    "description": "Run large language models locally on your machine with no internet required",
    "language": "en",
    "nsfw": false,
    "tagItems": ["local", "offline", "open-source", "privacy"]
  },
  "modelProvider": {
    "provider_id": "ollama",
    "provider_type": "local",
    "api_endpoint": "http://localhost:11434",
    "supported_models": ["llama3.2:3b", "mistral:7b", "llama2:7b"],
    "pricing_model": "free",
    "price_per_1k_tokens": 0.0,
    "context_window": 4096,
    "max_tokens": 2048,
    "capabilities": ["text_generation", "code_generation", "conversation", "offline_processing"],
    "supported_languages": ["en", "multilingual"],
    "is_active": true,
    "version": "0.3.12",
    "documentation_url": "https://github.com/ollama/ollama",
    "contact_info": "https://github.com/ollama/ollama"
  }
};

const result = await publishNewRecord(ollamaProvider, 'modelProvider');
// Result: { transactionId: "abc123...", did: "did:arweave:abc123..." }
```

### Creating Conversation Session Records

```javascript
// Create conversation session referencing the provider
const sessionData = {
  "conversationSession": {
    "session_id": "session_1703123456789",
    "title": "Morning Chat with Alfred",
    "messages": ["Hello Alfred", "Hello! How can I help?"],
    "message_timestamps": [1703123456789, 1703123456901],
    "message_roles": ["user", "assistant"],
    "model_name": "llama3.2:3b",
    "model_provider": ["did:arweave:abc123..."], // Reference to provider record
    "processing_mode": "rag",
    "conversation_type": "voice",
    "is_private": true,
    "owner_pubkey": "user_public_key_here"
  }
};

const result = await publishNewRecord(sessionData, 'conversationSession', false, false, false, 'arweave', false, {
  storage: 'gun',
  localId: sessionData.conversationSession.session_id,
  accessControl: { private: true }
});
```

## Publishing Templates

### 1. Publish Model Provider Template

```bash
node scripts/create_model_provider_template.js
```

### 2. Publish Conversation Session Template

```bash
node scripts/create_conversation_session_template.js
```

### 3. Create Model Provider Records

```bash
node examples/create_model_provider_records.js
```

### 4. Create Example Conversation Session

```bash
node examples/create_conversation_session_example.js create
```

## Querying Records

### Query Conversation Sessions

```javascript
const { getRecords } = require('../helpers/elasticsearch');

const sessions = await getRecords({
  recordType: 'conversationSession',
  storage: 'gun',
  limit: 10,
  sortBy: 'start_timestamp:desc'
});
```

### Query Model Providers

```javascript
const providers = await getRecords({
  recordType: 'modelProvider',
  limit: 50
});
```

### Query Sessions with Provider Resolution

```javascript
const sessions = await getRecords({
  recordType: 'conversationSession',
  storage: 'gun',
  resolveDepth: 1, // Resolve model provider references
  limit: 10
});

// Result includes resolved provider data:
// sessions.records[0].data.conversationSession.model_provider[0]
//   -> { provider_id: "ollama", display_name: "Ollama (Local)", ... }
```

## Security & Privacy

- **Private Sessions**: Conversation sessions can be marked as private
- **Access Control**: Only session owners can access their private records
- **Encryption**: GUN SEA encryption for sensitive data
- **User Verification**: JWT-based authentication required

## Benefits of dref Architecture

1. **Flexibility**: Add new model providers without template updates
2. **Rich Metadata**: Each provider has comprehensive information
3. **Decentralized**: Provider data is stored as separate records
4. **Updatable**: Provider information can be updated independently
5. **Reusable**: Same provider can be referenced by multiple sessions
6. **Query-able**: Providers can be queried and filtered separately

## Migration Notes

When upgrading from enum-based to dref-based model providers:

1. Publish the new templates to Arweave
2. Create model provider records for existing providers
3. Update conversation session creation to use provider DIDs
4. Existing sessions will continue to work with the old structure
5. New sessions will use the enhanced dref structure

This architecture provides maximum flexibility for future AI provider additions while maintaining backward compatibility.
