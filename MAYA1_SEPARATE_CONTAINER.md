# Maya1 TTS Separate Container Setup

## Overview

Maya1 TTS has been set up as a **separate Docker container** to avoid PyTorch version conflicts with other services. This provides better isolation and ensures PyTorch 2.1+ is available for SNAC codec compatibility.

## Architecture

```
┌─────────────────┐
│  tts-service-gpu│  (PyTorch 2.0 - Silero, Chatterbox)
│   Port: 5002    │
└────────┬────────┘
         │ Proxies Maya1 requests
         ↓
┌─────────────────┐
│ maya1-tts-service│  (PyTorch 2.1+ - Maya1 only)
│   Port: 5003    │
└─────────────────┘
```

## Files Created

1. **`maya1-tts-service/Dockerfile`**
   - PyTorch 2.1.0 with CUDA 11.8 support
   - Maya1 model and SNAC codec
   - Dedicated service on port 5003

2. **`maya1-tts-service/maya1_service.py`**
   - Standalone FastAPI service
   - Only handles Maya1 TTS synthesis
   - Clean, isolated implementation

3. **`maya1-tts-service/download_maya1_model.py`**
   - Pre-downloads models during build

## Setup Instructions

### Option 1: Use Separate Container (Recommended)

1. **Build and start Maya1 service:**
   ```bash
   docker-compose --profile standard-gpu build maya1-tts-service
   docker-compose --profile standard-gpu up -d maya1-tts-service
   ```

2. **Update main TTS service to proxy Maya1 requests:**
   - The main `tts-service-gpu` can proxy requests to `maya1-tts-service` when `engine=maya1`
   - Or call Maya1 service directly: `http://maya1-tts-service:5003/synthesize`

3. **Verify Maya1 service:**
   ```bash
   curl http://localhost:5003/health | jq .
   ```

### Option 2: Fix Existing Container (Simpler)

If you prefer to keep everything in one container:

1. **Sync updated Dockerfile to server:**
   ```bash
   # From local machine
   scp text-to-speech/Dockerfile.gpu user@server:~/path/to/text-to-speech/Dockerfile.gpu
   
   # On server, rebuild
   make rebuild-standard-gpu
   ```

2. **The updated Dockerfile.gpu already has PyTorch 2.1.0**

## Benefits of Separate Container

✅ **Isolation**: PyTorch version conflicts avoided  
✅ **Cleaner**: Maya1-specific dependencies only  
✅ **Easier debugging**: Separate logs and health checks  
✅ **Flexible**: Can scale Maya1 independently  
✅ **No conflicts**: Other TTS engines unaffected  

## Service Endpoints

### Maya1 Service (Port 5003)

- `POST /synthesize` - Synthesize speech
  ```bash
  curl -X POST http://localhost:5003/synthesize \
    -F "text=Hello from Maya1" \
    -F "voice=female_expressive"
  ```

- `GET /voices` - List available voices
- `GET /health` - Health check

### Main TTS Service (Port 5002)

- Can proxy to Maya1 service or use internal implementation
- Falls back to other engines if Maya1 unavailable

## Configuration

Add to `.env`:
```bash
MAYA1_TTS_PORT=5003
```

## Troubleshooting

### Maya1 service not starting

```bash
# Check logs
docker logs fitnessally-maya1-tts-service-1

# Check PyTorch version
docker exec fitnessally-maya1-tts-service-1 python3 -c "import torch; print(torch.__version__)"

# Verify weight_norm import
docker exec fitnessally-maya1-tts-service-1 python3 -c "from torch.nn.utils.parametrizations import weight_norm; print('OK')"
```

### PyTorch version conflicts

If you see PyTorch version errors, ensure:
1. Maya1 service uses PyTorch 2.1+
2. Other services can use different PyTorch versions
3. They're in separate containers (no conflicts)

## Next Steps

1. **Choose approach**: Separate container or fix existing?
2. **If separate**: Update main TTS service to proxy Maya1 requests
3. **Test**: Verify Maya1 synthesis works
4. **Deploy**: Update production configuration

