# OIP Ollama LLM Setup Guide

## Quick Start

Your OIP Voice Assistant now uses **Ollama** for local LLM management - the same proven architecture from the Local LLM Model Installation Guide!

### 1. Deploy Everything (One Command!)

```bash
# Start all GPU-accelerated services + install all LLM models automatically
make rebuild-full-gpu
```

This single command will:
1. Build and start all services (Ollama, STT, TTS, etc.)
2. Wait for Ollama to be ready
3. Automatically install all recommended models

This installs:
- **TinyLlama** (637 MB) - Ultra-fast responses
- **Mistral 7B** (4.1 GB) - Balanced performance  
- **LLaMA 2 7B** (3.8 GB) - Creative responses
- **LLaMA 3.2 3B** (2.0 GB) - Modern efficiency

### 2. Verify Installation

```bash
# Check service status
make status

# Test model availability
curl http://localhost:8081/models | jq

# Test text generation
curl -X POST http://localhost:8081/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Hello, how are you?", "model": "llama3.2:3b"}'
```

### 3. Use Voice Assistant

Open `http://localhost:3005` and start talking! The assistant will use your installed models.

## Architecture Benefits

✅ **No More Memory Issues** - Ollama manages model loading/unloading
✅ **Fast Model Switching** - Switch between models instantly  
✅ **Persistent Storage** - Models cached in `./ollama_data/`
✅ **GPU Acceleration** - Automatic CUDA support
✅ **Proven Reliability** - Same architecture as successful deployments

## Model Performance

| Model | Size | Speed | Use Case |
|-------|------|-------|----------|
| TinyLlama | 637 MB | ⚡⚡⚡ | Quick commands |
| Mistral | 4.1 GB | ⚡⚡ | General chat |
| LLaMA 2 | 3.8 GB | ⚡⚡ | Creative tasks |
| LLaMA 3.2 | 2.0 GB | ⚡⚡ | Modern responses |

## Manual Model Management

If you want to install additional models after the initial setup:

```bash
# Install more models manually
make install-models                # Re-run the installation script

# Or install specific models directly
docker exec $(docker-compose ps -q ollama) ollama pull codellama
docker exec $(docker-compose ps -q ollama) ollama pull phi

# List installed models
docker exec $(docker-compose ps -q ollama) ollama list

# Remove models to save space
docker exec $(docker-compose ps -q ollama) ollama rm old-model
```

## Troubleshooting

**🔴 Models not appearing:**
```bash
# Check Ollama service
curl http://localhost:11434/api/tags

# Restart text-generator
docker restart $(docker-compose ps -q text-generator)
```

**🔴 Out of storage:**
```bash
# Check usage
du -sh ./ollama_data/

# Remove unused models
docker exec $(docker-compose ps -q ollama) ollama rm unused-model
```

## Voice Integration

The Voice Assistant automatically uses your selected model:
1. **Record voice** → STT (Whisper)
2. **Process text** → LLM (your selected Ollama model) 
3. **Speak response** → TTS (Chatterbox → Silero → Edge TTS)

Switch models in the web interface for different response styles!

---

**🎉 Your local AI is now privacy-first, GPU-accelerated, and bulletproof!** 