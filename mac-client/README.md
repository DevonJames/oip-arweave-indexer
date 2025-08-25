# Enhanced Voice Pipeline - Mac Client

Apple Silicon optimized client for distributed voice processing with STT, VAD, and Smart Turn running locally while leveraging backend RAG/LLM/TTS processing.

## 🍎 Architecture Overview

```
┌─────────────────────────┐    ┌──────────────────────────┐
│     Apple Silicon Mac   │    │    PC Backend (RTX 4090) │
│                         │    │                          │
│  ┌─────────────────┐   │    │  ┌─────────────────────┐ │
│  │   Audio Input   │   │    │  │      RAG/LLM       │ │
│  └─────────────────┘   │    │  │    Processing      │ │
│           │             │    │  └─────────────────────┘ │
│  ┌─────────────────┐   │    │  ┌─────────────────────┐ │
│  │   Silero VAD    │   │    │  │   Kokoro TTS +      │ │
│  └─────────────────┘   │    │  │    Fallbacks       │ │
│           │             │    │  └─────────────────────┘ │
│  ┌─────────────────┐   │    │  ┌─────────────────────┐ │
│  │ MLX Whisper STT │   │    │  │   Elasticsearch     │ │
│  └─────────────────┘   │    │  │     + Ollama        │ │
│           │             │    │  └─────────────────────┘ │
│  ┌─────────────────┐   │    │                          │
│  │   Smart Turn    │   │────┼──┤   HTTP API           │
│  │   Detection     │   │    │                          │
│  └─────────────────┘   │    │                          │
│           │             │    │                          │
│  ┌─────────────────┐   │    │                          │
│  │ Client Coordinator │  │                          │
│  └─────────────────┘   │    │                          │
└─────────────────────────┘    └──────────────────────────┘
```

## 🚀 Features

### Apple Silicon Optimizations
- **MLX Framework**: Optimized Whisper inference using Apple's MLX
- **Metal Performance Shaders**: GPU acceleration for VAD processing
- **Unified Memory Architecture**: Efficient memory usage
- **Neural Engine**: Automatic utilization when available
- **Power Efficiency**: Optimized for Mac battery life

### Voice Processing Pipeline
- **Silero VAD**: Neural voice activity detection with preprocessing
- **MLX Whisper Large v3 Turbo**: High-performance speech-to-text
- **Smart Turn v2**: Intelligent conversation endpoint detection
- **Distributed Processing**: Client-side voice, backend RAG/TTS

### Communication Protocol
- **HTTP API**: RESTful communication with backend
- **Real-time Processing**: Low-latency voice pipeline
- **Fallback Handling**: Graceful degradation on network issues
- **Health Monitoring**: Continuous service health checks

## 📋 Prerequisites

- **macOS**: 12.0+ (Monterey or later)
- **Hardware**: Apple Silicon Mac (M1/M2/M3/M4) - 8GB+ RAM recommended
- **Python**: 3.11+
- **Node.js**: 16+
- **Network**: Access to backend PC for RAG/TTS processing

## 🛠️ Installation

### 1. Run Setup Script
```bash
cd mac-client/
./setup_mac_client.sh
```

This will:
- Install Homebrew (if needed)
- Install Python 3.11 and Node.js
- Create Python virtual environment
- Install all dependencies
- Set up configuration files

### 2. Configure Backend Connection
**Option A: Use the configuration utility (Recommended):**
```bash
cd ..  # Go to main project directory
./configure_backend.sh  # Interactive configuration (updates both main and mac-client .env)
```

**Option B: Manual configuration:**
Edit the Mac client's `.env` file:
```bash
# Copy from example if .env doesn't exist
cp example.env .env

# Edit .env file
vim .env

# Update these values:
BACKEND_HOST=YOUR_PC_IP_ADDRESS
BACKEND_PORT=3000
BACKEND_PROTOCOL=http
```

### 3. Download Models (Optional)
```bash
./download_models.sh
```

Models will auto-download on first use if not pre-downloaded.

### 4. Test Installation
```bash
./test_mac_client.sh
```

## 🚀 Usage

### Start Services
```bash
./start_mac_client.sh
```

This starts:
- **STT Service** on port 8013
- **Smart Turn Service** on port 8014
- **Health monitoring** and coordination

### Test Pipeline
```bash
# Health check
node mac_client_coordinator.js health

# Test complete pipeline
node mac_client_coordinator.js test

# Start monitoring
node mac_client_coordinator.js monitor
```

### Stop Services
Press `Ctrl+C` in the terminal running `start_mac_client.sh`

## 🔧 Configuration

### Environment Configuration: `.env`
Copy from `example.env` and update with your backend settings:
```bash
cp example.env .env
vim .env  # Update BACKEND_HOST, BACKEND_PORT, etc.
```

### Main Configuration: `config/mac_client_config.json`
```json
{
  "client": {
    "services": {
      "stt": {
        "enabled": true,
        "port": 8013,
        "model": "large-v3-turbo",
        "device": "mps",
        "quantization": "int4"
      },
      "smart_turn": {
        "enabled": true,
        "port": 8014
      },
      "vad": {
        "enabled": true,
        "threshold": 0.5,
        "min_speech_ms": 200,
        "min_silence_ms": 300
      }
    },
    "backend": {
      "host": "100.124.42.82",
      "port": 3000,
      "protocol": "http"
    }
  }
}
```

### Environment Variables: `.env`
```bash
# Mac Client Configuration
CLIENT_MODE=true
STT_PORT=8013
SMART_TURN_PORT=8014

# Apple Silicon Optimization
MLX_DEVICE=mps
WHISPER_MODEL=large-v3-turbo
MLX_QUANTIZATION=int4

# VAD Configuration
VAD_ENABLED=true
VAD_THRESHOLD=0.5

# Backend Configuration
BACKEND_HOST=192.168.1.100
BACKEND_PORT=3000
```

## 📊 Performance

### Expected Performance (Apple Silicon)
- **STT Speed**: 10-20x real-time
- **VAD Latency**: <50ms
- **Smart Turn**: <100ms
- **Total Local Processing**: <200ms
- **Memory Usage**: ~1-2GB
- **Power Consumption**: Low (optimized for battery)

### Optimization Features
- **Quantization**: INT4 for reduced memory usage
- **Metal GPU**: Hardware-accelerated processing
- **Batch Processing**: Efficient VAD preprocessing
- **Memory Management**: Unified memory architecture
- **Model Caching**: Persistent model loading

## 🔍 Monitoring & Debugging

### Health Checks
```bash
# Check all services
node mac_client_coordinator.js health

# Monitor continuously
node mac_client_coordinator.js monitor 10000
```

### Log Files
- **STT Service**: `logs/stt_service.log`
- **Smart Turn**: `logs/smart_turn_service.log`
- **Client**: `logs/mac_client.log`

### Service Endpoints
- **STT Health**: `http://localhost:8013/health`
- **Smart Turn Health**: `http://localhost:8014/health`
- **STT Models**: `http://localhost:8013/models`
- **Smart Turn Info**: `http://localhost:8014/info`

## 🐛 Troubleshooting

### Common Issues

**1. MLX Not Available**
```
⚠️  MLX Whisper not available, will use mock implementation
```
- **Solution**: MLX Whisper is still in development. Mock implementation provides realistic testing.

**2. Backend Connection Failed**
```
❌ Backend not reachable at 192.168.1.100:3000
```
- **Solution**: Update `BACKEND_HOST` in `.env` with correct IP address
- Ensure backend services are running
- Check network connectivity

**3. VAD Model Download Failed**
```
❌ Failed to download Silero VAD
```
- **Solution**: Check internet connection
- Model will download on first use
- Restart services after network is restored

**4. Port Already in Use**
```
❌ STT Service failed to start
```
- **Solution**: Check if ports 8013/8014 are available
- Update ports in configuration if needed
- Kill existing processes: `lsof -ti:8013 | xargs kill`

### Performance Issues

**Low STT Performance**
- Ensure Apple Silicon Mac (M1/M2/M3/M4)
- Check available memory (8GB+ recommended)
- Verify MPS device availability

**High Memory Usage**
- Reduce `MLX_QUANTIZATION` to `int4` (default)
- Close unnecessary applications
- Monitor with Activity Monitor

## 🔄 Updates & Maintenance

### Update Models
```bash
./download_models.sh
```

### Update Dependencies
```bash
# Python dependencies
source mac-client-env/bin/activate
pip install --upgrade -r requirements.txt

# Node.js dependencies  
npm update
```

### Reset Installation
```bash
# Remove and recreate environment
rm -rf mac-client-env node_modules
./setup_mac_client.sh
```

## 🤝 Integration with Backend

### Communication Flow
1. **Audio Capture** → Mac client
2. **VAD Processing** → Extract speech segments
3. **STT Processing** → Generate transcript
4. **Smart Turn** → Detect conversation endpoint
5. **Backend Request** → Send to PC for RAG/LLM
6. **TTS Response** → Receive audio from backend
7. **Audio Playback** → Play response

### API Endpoints Used
- **Backend RAG**: `POST /api/alfred/query`
- **Backend TTS**: `POST /api/voice/synthesize`
- **Backend Health**: `GET /api/voice/health`

## 📈 Roadmap

### Current Status (Week 5)
- ✅ Mac client foundation
- ✅ MLX STT service (mock implementation)
- ✅ Smart Turn service
- ✅ Distributed architecture
- ✅ Configuration management

### Upcoming Features
- 🔄 Real MLX Whisper integration (when available)
- 🔄 Neural Engine optimization
- 🔄 Offline verification framework
- 🔄 Performance monitoring dashboard
- 🔄 Audio streaming improvements

## 📞 Support

For issues or questions:
1. Check logs in `logs/` directory
2. Run diagnostic: `./test_mac_client.sh`
3. Verify backend connectivity
4. Review configuration files

## 🏗️ Development

### Project Structure
```
mac-client/
├── setup_mac_client.sh       # Installation script
├── start_mac_client.sh       # Service startup
├── download_models.sh        # Model management
├── test_mac_client.sh        # Testing script
├── mac_stt_service.py        # MLX STT service
├── mac_smart_turn_service.py # Smart Turn service
├── mac_client_coordinator.js # Communication coordinator
├── config/                   # Configuration files
├── models/                   # AI models
├── logs/                     # Service logs
└── README.md                 # This file
```

### Adding New Features
1. Update service files
2. Modify configuration schema
3. Update coordinator logic
4. Add tests to test script
5. Update documentation

---

**Enhanced Voice Pipeline v2.0 - Apple Silicon Optimized**  
*Distributed voice processing for maximum performance and efficiency*
