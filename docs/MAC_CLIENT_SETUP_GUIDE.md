# Mac Client Setup Guide

## Overview

The Mac Client provides a local voice interface for Alfred, the AI conversational assistant. This guide covers the complete setup and usage process for running Alfred on macOS.

## Prerequisites

- **macOS** (tested on macOS 12.0+)
- **Python 3.8+** 
- **Node.js 16+**
- **Backend Services** running (OIP Arweave Indexer)

## Initial Setup

### Step 1: Navigate to Mac Client Directory
```bash
cd mac-client
```

### Step 2: Activate Virtual Environment
```bash
source mac-client-env/bin/activate
```

### Step 3: Run Setup Script
```bash
./setup_mac_client.sh
```

This script will:
- Install Python dependencies
- Set up the virtual environment
- Configure local services
- Prepare the voice interface

### Step 4: Download Required Models
```bash
./download_models.sh
```

This downloads:
- **Whisper MLX models** for speech-to-text
- **Silero VAD model** for voice activity detection
- **Smart Turn models** for conversation management

### Step 5: Start the Interface
```bash
./start_interface_only.sh
```

This starts the Alfred voice interface server on `http://localhost:3001`.

## Usage

### Starting Alfred
Once setup is complete, you only need to run:
```bash
cd mac-client
source mac-client-env/bin/activate
./start_interface_only.sh
```

### Accessing Alfred
- **Web Interface**: Open `http://localhost:3001` in your browser
- **Local HTML**: Open `mac-client/alfred.html` directly

### Stopping Alfred
```bash
./stop_interface_only.sh
```

## Features

### Voice Capabilities
- **Speech Recognition**: Local Whisper MLX processing
- **Voice Activity Detection**: Silero VAD for turn detection
- **Smart Turn Management**: Intelligent conversation flow
- **Text-to-Speech**: Integration with backend TTS services

### Conversation Management
- **Private Sessions**: Encrypted conversation storage using GUN
- **Session History**: Persistent conversation memory
- **HD Wallet Integration**: User-owned conversation data
- **Real-time Sync**: Live conversation updates

### AI Integration
- **Multiple LLM Support**: Works with various language models
- **Context Awareness**: Maintains conversation context
- **Intelligent Responses**: Advanced AI conversation capabilities

## Configuration

### Environment Configuration
The Mac client uses configuration from:
- `mac-client/config/mac_client_config.json`
- Backend `.env` file settings
- Local model configurations

### Model Configuration
Models are stored in:
- `mac-client/models/whisper-mlx/` - Speech recognition models
- `mac-client/models/silero_vad/` - Voice activity detection
- `mac-client/models/smart_turn/` - Turn management models

### Service Ports
- **Interface Server**: 3001
- **Backend API**: 3005 (OIP services)
- **GUN Relay**: 8765
- **STT Service**: 8003 (if using distributed setup)

## Troubleshooting

### Common Issues

#### Virtual Environment Not Found
```bash
# Recreate the virtual environment
python3 -m venv mac-client-env
source mac-client-env/bin/activate
./setup_mac_client.sh
```

#### Models Not Downloaded
```bash
# Re-download models
./download_models.sh
```

#### Port Conflicts
```bash
# Check what's using port 3001
lsof -i :3001
# Kill conflicting processes if needed
```

#### Permission Issues
```bash
# Make scripts executable
chmod +x setup_mac_client.sh
chmod +x download_models.sh
chmod +x start_interface_only.sh
chmod +x stop_interface_only.sh
```

### Service Dependencies

#### Backend Services Required
Ensure these backend services are running:
- **OIP API**: `http://localhost:3005`
- **GUN Relay**: `http://localhost:8765`
- **Elasticsearch**: `http://localhost:9200`

#### Check Backend Status
```bash
# From project root
make status
# Or check specific services
docker ps
```

### Logs and Debugging

#### Interface Logs
```bash
# View interface server logs
tail -f logs/interface-server.log
```

#### Model Information
```bash
# Check model status
cat models/model_info.json
```

#### Service Status
```bash
# Check if interface is running
curl http://localhost:3001/health
```

## Advanced Configuration

### Custom Model Paths
Edit `mac-client/config/mac_client_config.json` to specify custom model locations:
```json
{
  "whisper_model_path": "models/whisper-mlx/",
  "vad_model_path": "models/silero_vad/",
  "smart_turn_model_path": "models/smart_turn/"
}
```

### Backend Connection
Configure backend connection in the config file:
```json
{
  "backend_url": "http://localhost:3005",
  "gun_relay_url": "http://localhost:8765"
}
```

### Performance Tuning
For better performance on Apple Silicon:
- Use MLX-optimized models
- Enable GPU acceleration where available
- Adjust batch sizes in model configuration

## Development

### Development Mode
```bash
# Start in development mode with hot reload
cd mac-client
source mac-client-env/bin/activate
node voice_interface_server.js --dev
```

### Testing Voice Pipeline
```bash
# Test the complete voice pipeline
python test_voice_pipeline.py
```

### Model Updates
```bash
# Update to latest models
./download_models.sh --force
```

## Integration with Backend

### GUN Storage
- **Private Conversations**: Stored in GUN database
- **User Authentication**: HD wallet-based ownership
- **Encryption**: Client-side encryption for privacy

### API Integration
- **Record Publishing**: Create conversation records
- **Template Usage**: Uses `conversationSession` template
- **Media Support**: Voice recordings and transcripts

### Real-time Features
- **WebSocket Connection**: Live conversation updates
- **Streaming Responses**: Real-time AI responses
- **Voice Streaming**: Continuous audio processing

## Security

### Privacy Features
- **Local Processing**: Speech recognition runs locally
- **Encrypted Storage**: Conversations encrypted before storage
- **User Ownership**: HD wallet controls data access
- **No Cloud Dependencies**: Fully local voice processing

### Data Protection
- **Private Keys**: Stored locally and encrypted
- **Session Isolation**: Each conversation is separately encrypted
- **Access Control**: Template-based permission system

---

## Quick Reference

### Complete Setup (First Time)
```bash
cd mac-client
source mac-client-env/bin/activate
./setup_mac_client.sh
./download_models.sh
./start_interface_only.sh
```

### Daily Usage
```bash
cd mac-client
source mac-client-env/bin/activate
./start_interface_only.sh
```

### Shutdown
```bash
./stop_interface_only.sh
```

### Status Check
```bash
curl http://localhost:3001/health
```

This setup provides a complete local voice interface for Alfred with privacy-focused conversation management and seamless integration with the OIP backend services.
