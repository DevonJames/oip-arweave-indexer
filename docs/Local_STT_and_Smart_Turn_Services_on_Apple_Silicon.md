# Local STT and Smart Turn Services on Apple Silicon

## Overview

The OIP Arweave system includes specialized local services designed to run on Apple Silicon Macs, providing high-performance speech-to-text (STT) and conversation endpoint detection capabilities. These services leverage Apple's Metal Performance Shaders (MPS) and optimized ML frameworks to deliver real-time voice processing with minimal latency.

## Architecture

The local Mac services work in conjunction with the remote backend services to create a distributed voice processing pipeline:

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Mac Client    │    │  Remote Backend  │    │   Mac Services  │
│                 │    │  (RTX 4090)      │    │                 │
│ • Voice UI      │◄──►│ • LLM/RAG        │    │ • STT Service   │
│ • Audio Capture │    │ • TTS (ElevenLabs│    │ • Smart Turn    │
│ • Playback      │    │ • Response Gen   │    │ • VAD           │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## Services

### 1. STT Service (Speech-to-Text)

**Purpose**: Converts speech audio to text using Apple Silicon optimized models.

**Port**: `8013`

**Model**: MLX Whisper Large V3 (4-bit quantized)
- **Framework**: MLX (Apple's ML framework optimized for Apple Silicon)
- **Model Path**: `mlx-community/whisper-large-v3-mlx-4bit`
- **Device**: Metal Performance Shaders (MPS)
- **Quantization**: 4-bit for optimal performance/quality balance

**Features**:
- ✅ **VAD Integration**: Uses Silero VAD to filter out background noise
- ✅ **Phantom Detection Prevention**: Skips transcription when no speech detected
- ✅ **WebM Audio Support**: Handles browser audio format natively
- ✅ **Corruption Detection**: Validates audio data integrity
- ✅ **Apple Silicon Optimized**: Leverages Metal GPU acceleration

**Endpoints**:
- `POST /transcribe_file` - Transcribe audio file to text
- `GET /health` - Service health check

### 2. Smart Turn Service (Endpoint Detection)

**Purpose**: Detects when a user has finished speaking to trigger response processing.

**Port**: `8012`

**Model**: Custom endpoint detection model
- **Algorithm**: Probabilistic speech endpoint detection
- **Threshold**: 0.5 (configurable)
- **Response Time**: ~100-200ms detection latency

**Features**:
- ✅ **Real-time Processing**: Analyzes audio chunks as they arrive
- ✅ **Confidence Scoring**: Returns probability scores for endpoint detection
- ✅ **Adaptive Thresholds**: Adjusts sensitivity based on audio characteristics
- ✅ **Low Latency**: Optimized for conversational response times

**Endpoints**:
- `POST /detect_endpoint` - Analyze audio for conversation endpoints
- `GET /health` - Service health check

### 3. Voice Interface Server (Proxy & Coordination)

**Purpose**: Coordinates between the Mac voice interface and remote backend services.

**Port**: `3001`

**Features**:
- ✅ **Backend Proxy**: Routes requests to remote RTX 4090 backend
- ✅ **Service Coordination**: Manages STT and Smart Turn service communication
- ✅ **WebSocket Streaming**: Handles real-time audio/text streaming
- ✅ **Error Handling**: Provides fallback mechanisms for service failures

**Endpoints**:
- `GET /` - Voice interface web application
- `POST /api/backend/*` - Proxy to remote backend services
- Various health and status endpoints

## Installation & Setup

### Prerequisites

1. **Apple Silicon Mac** (M1, M2, M3, or newer)
2. **Python 3.11+** with virtual environment
3. **Node.js 18+** for interface server
4. **Required Python packages** (installed via requirements)

### Environment Setup

```bash
# Navigate to mac-client directory
cd mac-client

# Create Python virtual environment
python3 -m venv mac-client-env

# Activate virtual environment
source mac-client-env/bin/activate

# Install Python dependencies
pip install -r requirements.txt
```

### Model Installation

The STT service will automatically download and cache the required models on first run:

- **MLX Whisper Large V3 (4-bit)**: ~1.5GB download
- **Silero VAD Model**: ~50MB download
- **Models Cache**: `~/.cache/torch/hub/` and MLX cache directories

## Usage

### Quick Start (Recommended)

Use the integrated Makefile commands for easy service management:

```bash
# Start all Mac STT services with logging
make mac-stt-services

# Check service status
make mac-status

# Stop all services
make mac-stop
```

### Manual Service Management

If you prefer to run services individually:

#### Start Services Manually

**Terminal 1 - Smart Turn Service:**
```bash
cd mac-client
source mac-client-env/bin/activate
python mac_smart_turn_service.py
```

**Terminal 2 - STT Service:**
```bash
cd mac-client
python mac_stt_service.py
```

**Terminal 3 - Interface Server:**
```bash
cd mac-client
node voice_interface_server.js
```

#### Stop Services Manually

Press `Ctrl+C` in each terminal window, or use:

```bash
# Find and kill processes
pkill -f mac_smart_turn_service.py
pkill -f mac_stt_service.py
pkill -f voice_interface_server.js
```

## Service Management Commands

### Core Management

| Command | Description |
|---------|-------------|
| `make mac-stt-services` | Start all Mac STT services with logging |
| `make mac-stop` | Stop all Mac STT services cleanly |
| `make mac-status` | Check status of all services + port availability |
| `make mac-restart` | Restart all services (stop + start) |

### Log Monitoring

| Command | Description |
|---------|-------------|
| `make mac-logs-stt` | Monitor STT service logs (`tail -f`) |
| `make mac-logs-smart-turn` | Monitor Smart Turn service logs |
| `make mac-logs-interface` | Monitor Interface server logs |
| `make mac-logs-all` | Monitor all service logs simultaneously |

### Service Status Examples

**Healthy Services:**
```bash
$ make mac-status
Mac STT Services Status:
🧠 Smart Turn Service: ✅ Running (PID: 12345)
🎤 STT Service: ✅ Running (PID: 12346)  
🌐 Interface Server: ✅ Running (PID: 12347)

Port Status:
  Port 8012 (Smart Turn): ✅ Active
  Port 8013 (STT): ✅ Active
  Port 3001 (Interface): ✅ Active
```

**Service Issues:**
```bash
$ make mac-status
Mac STT Services Status:
🧠 Smart Turn Service: ❌ Stopped
🎤 STT Service: ✅ Running (PID: 12346)
🌐 Interface Server: ✅ Running (PID: 12347)

Port Status:
  Port 8012 (Smart Turn): ❌ Free
  Port 8013 (STT): ✅ Active  
  Port 3001 (Interface): ✅ Active
```

## Log Files

All service logs are automatically saved to the `logs/` directory:

### Log Locations

- **STT Service**: `logs/stt-service.log`
- **Smart Turn Service**: `logs/smart-turn-service.log`
- **Interface Server**: `logs/interface-server.log`

### Log Monitoring Examples

**Monitor STT Service:**
```bash
make mac-logs-stt
# or manually:
tail -f logs/stt-service.log
```

**Monitor All Services:**
```bash
make mac-logs-all
# Shows multiplexed logs from all services
```

### Sample Log Output

**STT Service Log:**
```
INFO:__main__:🚀 Starting Apple Silicon MLX STT Service...
INFO:__main__:Configuration: Model=mlx-community/whisper-large-v3-mlx-4bit, Device=mps, VAD=True
INFO:__main__:✅ MLX Whisper model loaded successfully
INFO:__main__:✅ Silero VAD model loaded successfully
INFO:__main__:✅ Apple Silicon MLX STT Service started successfully
INFO:     Uvicorn running on http://0.0.0.0:8013
INFO:__main__:Received audio data: 45231 bytes
INFO:__main__:VAD detected 2 speech segments, 45.67% speech
INFO:__main__:Transcription: "Hello, how are you today?"
```

**Smart Turn Service Log:**
```
INFO:__main__:🚀 Starting Smart Turn Detection Service...
INFO:__main__:✅ Smart Turn service started on port 8012
INFO:__main__:Endpoint detection request: 23456 bytes audio
INFO:__main__:Smart Turn probability: 0.85 (threshold: 0.5)
INFO:__main__:✅ Endpoint detected - user finished speaking
```

## Performance Characteristics

### Apple Silicon Optimization

- **STT Processing**: ~2-5x faster than CPU-only implementations
- **Memory Usage**: ~2-4GB RAM during active transcription
- **GPU Utilization**: Efficient Metal Performance Shaders usage
- **Power Efficiency**: Optimized for laptop battery life

### Latency Metrics

- **STT Latency**: 200-800ms (depending on audio length)
- **Smart Turn Detection**: 100-200ms
- **End-to-End Response**: <1 second from speech end to backend processing

### Resource Requirements

- **RAM**: 4GB minimum, 8GB recommended
- **Storage**: 2GB for models and cache
- **Network**: Stable connection to remote backend required

## Troubleshooting

### Common Issues

**1. Services Won't Start**
```bash
# Check if ports are in use
lsof -i :8012 :8013 :3001

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

### Debug Mode

Enable verbose logging by setting environment variables:

```bash
export DEBUG=1
export LOG_LEVEL=DEBUG
make mac-stt-services
```

### Health Checks

Test individual services:

```bash
# STT Service Health
curl http://localhost:8013/health

# Smart Turn Service Health  
curl http://localhost:8012/health

# Interface Server Health
curl http://localhost:3001/health
```

## Integration with Remote Backend

The Mac services work seamlessly with the remote RTX 4090 backend:

1. **Audio Capture**: Mac interface captures microphone input
2. **Local Processing**: STT and Smart Turn services process audio locally
3. **Text Transmission**: Transcribed text sent to remote backend
4. **LLM Processing**: Remote backend processes with RAG + LLM
5. **TTS Generation**: Remote backend generates audio with ElevenLabs
6. **Audio Playback**: Mac interface plays response audio

This architecture provides the best of both worlds:
- **Low-latency local processing** for speech recognition
- **High-performance remote processing** for AI responses
- **Optimized resource utilization** across both systems

## Configuration

### Environment Variables

```bash
# STT Service Configuration
STT_MODEL="mlx-community/whisper-large-v3-mlx-4bit"
STT_DEVICE="mps"
STT_PORT="8013"

# Smart Turn Service Configuration  
SMART_TURN_PORT="8012"
SMART_TURN_THRESHOLD="0.5"

# Interface Server Configuration
INTERFACE_PORT="3001"
BACKEND_URL="https://api.oip.onl/api"
```

### Model Configuration

Edit `mac-client/mac_stt_service.py` to modify model settings:

```python
# Model configuration
MODEL_NAME = "mlx-community/whisper-large-v3-mlx-4bit"
DEVICE = "mps"  # Metal Performance Shaders
QUANTIZATION = "int4"  # 4-bit quantization for efficiency
```

## Advanced Usage

### Custom Audio Processing Pipeline

The services can be extended for custom audio processing:

```python
# Example: Custom VAD threshold
vad_threshold = 0.3  # More sensitive detection
vad_speech_ratio = len(speech_segments) / total_segments

if vad_speech_ratio < vad_threshold:
    # Skip transcription for low speech content
    return empty_response
```

### Integration with Other Systems

The services expose REST APIs that can be integrated with other voice applications:

```javascript
// Example: Direct STT API usage
const formData = new FormData();
formData.append('audio', audioBlob);

const response = await fetch('http://localhost:8013/transcribe_file', {
    method: 'POST',
    body: formData
});

const result = await response.json();
console.log('Transcription:', result.text);
```

## Future Enhancements

- **Multi-language Support**: Extended language model support
- **Custom Wake Words**: Local wake word detection
- **Speaker Identification**: Multi-speaker conversation support
- **Noise Cancellation**: Advanced audio preprocessing
- **Model Fine-tuning**: Domain-specific model optimization

---

For more information about the overall OIP Arweave system, see the main documentation in the `docs/` directory.
