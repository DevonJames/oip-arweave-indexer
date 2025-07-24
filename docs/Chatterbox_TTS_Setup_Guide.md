# Chatterbox TTS Setup Guide - Resemble AI Integration

## 🎯 **IMPORTANT: Real Chatterbox TTS Implementation**

Your system should be using the **actual Chatterbox TTS from Resemble AI**, not pyttsx3. This guide shows how to properly implement the state-of-the-art neural TTS model with advanced features like emotion control and voice cloning.

<img width="600" alt="chatterbox-logo" src="https://github.com/user-attachments/assets/bd8c5f03-e91d-4ee5-b680-57355da204d1" />

---

## 🏗️ **Architecture Overview**

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Main API      │    │   TTS Service   │    │ Resemble AI     │
│   Port 8000     │───▶│   Port 8005     │───▶│ Chatterbox      │
│                 │    │   (Neural TTS)  │    │ (GPU/CUDA)      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                                       │
                                               ┌───────▼───────┐
                                               │   Features    │
                                               │               │
                                               │ • 0.5B Llama  │
                                               │ • Voice Clone │
                                               │ • Emotion Ctrl│
                                               │ • Watermarked │
                                               │ • Sub-200ms   │
                                               └───────────────┘
```

---

## 1. 🚀 **Prerequisites & Installation**

### **Hardware Requirements (Recommended)**
- ✅ **NVIDIA RTX 3090/4090** (5-8GB VRAM for inference)
- ✅ **16GB+ RAM** (more for larger batches)
- ✅ **CUDA 11.8+** compatible drivers
- ✅ **50GB+ disk space** (for model weights)

### **Software Requirements**
- ✅ **Python 3.11** (tested and recommended)
- ✅ **CUDA-enabled PyTorch**
- ✅ **Git LFS** (for model downloads)

### **Install Chatterbox TTS**

**File: `requirements-chatterbox.txt`**
```txt
# Core Chatterbox TTS (Resemble AI)
chatterbox-tts
torchaudio>=2.0.0
torch>=2.0.0

# Additional dependencies for integration
fastapi==0.95.1
uvicorn==0.22.0
pydantic==1.10.22
requests==2.31.0
python-multipart==0.0.6
soundfile>=0.12.1
librosa>=0.10.0
numpy>=1.24.0

# Watermark detection (optional)
perth
```

**Installation Commands:**
```bash
# Create conda environment (recommended)
conda create -n chatterbox python=3.11
conda activate chatterbox

# Install from PyPI (easiest)
pip install chatterbox-tts

# OR install from source (for development)
git clone https://github.com/resemble-ai/chatterbox.git
cd chatterbox
pip install -e .

# Install additional requirements
pip install -r requirements-chatterbox.txt
```

---

## 2. 🎯 **TTS Service Implementation**

### **Enhanced Chatterbox Service**

**File: `services/chatterbox_tts_service.py`**
```python
import os
import io
import asyncio
import tempfile
import logging
from typing import Optional, Dict, Any
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import torch
import torchaudio as ta
from chatterbox.tts import ChatterboxTTS

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Resemble AI Chatterbox TTS Service", version="1.0.0")

# Global model instance
chatterbox_model = None

class TTSRequest(BaseModel):
    text: str
    voice_id: str = "default"
    speed: float = 1.0
    exaggeration: float = 0.5  # Emotion control (0.0-1.0+)
    cfg_weight: float = 0.5    # Pacing control (0.3-0.7)
    audio_prompt_path: Optional[str] = None  # For voice cloning

class VoiceCloneRequest(BaseModel):
    text: str
    reference_audio: bytes  # Base64 encoded audio
    exaggeration: float = 0.5
    cfg_weight: float = 0.5

@app.on_event("startup")
async def startup_event():
    """Initialize the Chatterbox TTS model on startup"""
    global chatterbox_model
    
    logger.info("🚀 Loading Resemble AI Chatterbox TTS model...")
    
    try:
        # Determine device (CUDA preferred)
    device = "cuda" if torch.cuda.is_available() else "cpu"
        logger.info(f"Using device: {device}")
    
        # Load Chatterbox model
        chatterbox_model = ChatterboxTTS.from_pretrained(device=device)
        
        logger.info("✅ Chatterbox TTS model loaded successfully!")
        
        # Log GPU info if available
        if torch.cuda.is_available():
            gpu_name = torch.cuda.get_device_name(0)
            gpu_memory = torch.cuda.get_device_properties(0).total_memory / 1e9
            logger.info(f"GPU: {gpu_name} ({gpu_memory:.1f}GB)")
        
    except Exception as e:
        logger.error(f"❌ Failed to load Chatterbox model: {e}")
        raise

@app.get("/health")
async def health_check():
    """Enhanced health check with GPU info"""
    gpu_info = {}
    if torch.cuda.is_available():
        gpu_info = {
            "gpu_available": True,
            "gpu_name": torch.cuda.get_device_name(0),
            "cuda_version": torch.version.cuda,
            "gpu_memory_gb": torch.cuda.get_device_properties(0).total_memory / 1e9
        }
    else:
        gpu_info = {"gpu_available": False}
    
    return {
        "status": "healthy",
        "service": "resemble-ai-chatterbox-tts",
        "model_loaded": chatterbox_model is not None,
        "gpu_info": gpu_info,
        "features": [
            "neural_synthesis",
            "emotion_control", 
            "voice_cloning",
            "watermarking",
            "sub_200ms_latency"
        ]
    }

@app.get("/voices")
async def list_voices():
    """List available voice options and features"""
    return {
        "voices": [
            {
                "id": "default",
                "name": "Chatterbox Default",
                "description": "High-quality neural voice",
                "features": ["emotion_control", "speed_control"]
            },
            {
                "id": "expressive",
                "name": "Chatterbox Expressive",
                "description": "More emotional and dynamic",
                "features": ["high_exaggeration", "emotion_control"]
            },
            {
                "id": "calm",
                "name": "Chatterbox Calm",
                "description": "Slower, more measured delivery",
                "features": ["low_cfg_weight", "relaxed_pacing"]
            },
            {
                "id": "voice_clone",
                "name": "Voice Cloning",
                "description": "Clone any voice from reference audio",
                "features": ["zero_shot_cloning", "reference_audio"]
            }
        ],
        "advanced_features": {
            "exaggeration_control": {
                "description": "Control emotion and intensity",
                "range": "0.0 (normal) to 1.0+ (very expressive)",
                "default": 0.5
            },
            "cfg_weight_control": {
                "description": "Control pacing and flow",
                "range": "0.3 (slower) to 0.7 (faster)",
                "default": 0.5
            },
            "voice_cloning": {
                "description": "Zero-shot voice cloning from reference",
                "requirements": "5-10 second clean audio sample"
            }
        }
    }

@app.post("/synthesize")
async def synthesize_speech(request: TTSRequest):
    """Synthesize speech using Chatterbox TTS with advanced controls"""
    if chatterbox_model is None:
        raise HTTPException(status_code=503, detail="Chatterbox model not loaded")
    
    try:
        logger.info(f"🎵 Synthesizing: '{request.text[:50]}...' with voice='{request.voice_id}'")
        
        # Apply voice-specific configurations
        exaggeration = request.exaggeration
        cfg_weight = request.cfg_weight
        
        if request.voice_id == "expressive":
            exaggeration = min(request.exaggeration + 0.2, 1.0)  # More expressive
            cfg_weight = max(request.cfg_weight - 0.1, 0.3)      # Slower pacing
        elif request.voice_id == "calm":
            exaggeration = max(request.exaggeration - 0.2, 0.0)  # Less expressive
            cfg_weight = max(request.cfg_weight - 0.2, 0.3)      # Much slower
        
        # Generate audio
        if request.audio_prompt_path and os.path.exists(request.audio_prompt_path):
            # Voice cloning mode
            logger.info(f"🎭 Voice cloning with reference: {request.audio_prompt_path}")
            wav = chatterbox_model.generate(
                request.text,
                audio_prompt_path=request.audio_prompt_path,
                exaggeration=exaggeration,
                cfg_weight=cfg_weight
            )
        else:
            # Standard synthesis
            wav = chatterbox_model.generate(
                request.text,
                exaggeration=exaggeration,
                cfg_weight=cfg_weight
            )
        
        # Convert to bytes
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
            ta.save(tmp_file.name, wav, chatterbox_model.sr)
            
            with open(tmp_file.name, 'rb') as f:
                audio_data = f.read()
            
            os.unlink(tmp_file.name)
        
        logger.info(f"✅ Synthesis complete: {len(audio_data)} bytes")
        
        return {
            "audio_data": audio_data,
            "sample_rate": chatterbox_model.sr,
            "format": "wav",
            "engine": "chatterbox",
            "parameters": {
                "exaggeration": exaggeration,
                "cfg_weight": cfg_weight,
                "voice_id": request.voice_id
            }
        }
        
    except Exception as e:
        logger.error(f"❌ Synthesis failed: {e}")
        raise HTTPException(status_code=500, detail=f"Synthesis failed: {str(e)}")

@app.post("/clone_voice")
async def clone_voice(request: VoiceCloneRequest):
    """Clone a voice from reference audio"""
    if chatterbox_model is None:
        raise HTTPException(status_code=503, detail="Chatterbox model not loaded")
    
    try:
        # Save reference audio to temporary file
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as ref_file:
            ref_file.write(request.reference_audio)
            ref_path = ref_file.name
        
        logger.info(f"🎭 Voice cloning with {len(request.reference_audio)} byte reference")
        
        # Generate cloned voice
        wav = chatterbox_model.generate(
            request.text,
            audio_prompt_path=ref_path,
            exaggeration=request.exaggeration,
            cfg_weight=request.cfg_weight
        )
        
        # Clean up reference file
        os.unlink(ref_path)
        
        # Convert to bytes
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as out_file:
            ta.save(out_file.name, wav, chatterbox_model.sr)
            
            with open(out_file.name, 'rb') as f:
                audio_data = f.read()
            
            os.unlink(out_file.name)
        
        logger.info(f"✅ Voice cloning complete: {len(audio_data)} bytes")
        
        return {
            "audio_data": audio_data,
            "sample_rate": chatterbox_model.sr,
            "format": "wav",
            "engine": "chatterbox_clone",
            "cloned": True
        }
        
    except Exception as e:
        logger.error(f"❌ Voice cloning failed: {e}")
        raise HTTPException(status_code=500, detail=f"Voice cloning failed: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8005)
```

---

## 3. 🐳 **Docker Configuration**

### **Chatterbox TTS Container**

**File: `Dockerfile.chatterbox`**
```dockerfile
FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    git-lfs \
    build-essential \
    gcc \
    g++ \
    cmake \
    libsndfile1 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements
COPY requirements-chatterbox.txt .

# Install Python dependencies
RUN pip install --upgrade pip
RUN pip install --no-cache-dir -r requirements-chatterbox.txt

# Copy the Chatterbox service
COPY services/chatterbox_tts_service.py .

# Create directories
RUN mkdir -p /tmp/tts /app/cache

# Set environment variables
ENV PYTHONPATH=/app
ENV TMPDIR=/tmp/tts
ENV HF_HOME=/app/cache
ENV TORCH_HOME=/app/cache

# Expose port
EXPOSE 8005

# Pre-download the model (optional, for faster startup)
RUN python -c "from chatterbox.tts import ChatterboxTTS; ChatterboxTTS.from_pretrained(device='cpu')"

# Run the service
CMD ["python", "-m", "uvicorn", "chatterbox_tts_service:app", "--host", "0.0.0.0", "--port", "8005"]
```

### **GPU-Enabled Version**

**File: `Dockerfile.chatterbox-gpu`**
```dockerfile
FROM nvidia/cuda:11.8-devel-ubuntu22.04

# Install Python 3.11
RUN apt-get update && apt-get install -y \
    software-properties-common \
    && add-apt-repository ppa:deadsnakes/ppa \
    && apt-get update && apt-get install -y \
    python3.11 \
    python3.11-pip \
    python3.11-dev \
    git \
    git-lfs \
    build-essential \
    libsndfile1 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Set Python 3.11 as default
RUN ln -sf /usr/bin/python3.11 /usr/bin/python
RUN ln -sf /usr/bin/pip3.11 /usr/bin/pip

# Set working directory
WORKDIR /app

# Copy requirements
COPY requirements-chatterbox.txt .

# Install PyTorch with CUDA support
RUN pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu118

# Install other dependencies
RUN pip install --no-cache-dir -r requirements-chatterbox.txt

# Copy service
COPY services/chatterbox_tts_service.py .

# Create directories
RUN mkdir -p /tmp/tts /app/cache

# Environment variables
ENV PYTHONPATH=/app
ENV CUDA_VISIBLE_DEVICES=0
ENV HF_HOME=/app/cache
ENV TORCH_HOME=/app/cache

# Expose port
EXPOSE 8005

# Pre-download model with GPU
RUN python -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}'); from chatterbox.tts import ChatterboxTTS; ChatterboxTTS.from_pretrained(device='cuda' if torch.cuda.is_available() else 'cpu')"

# Run with GPU support
CMD ["python", "-m", "uvicorn", "chatterbox_tts_service:app", "--host", "0.0.0.0", "--port", "8005"]
```

---

## 4. 🎛️ **Advanced Features**

### **Emotion and Expression Control**

```python
# Basic usage
wav = model.generate("Hello world!")

# Expressive speech (higher emotion)
wav = model.generate(
    "This is amazing news!",
    exaggeration=0.8,  # More emotional
    cfg_weight=0.3     # Slower for emphasis
)

# Calm, measured speech
wav = model.generate(
    "Let me explain this carefully.",
    exaggeration=0.2,  # Less emotional
    cfg_weight=0.6     # Faster, more efficient
)

# Dramatic storytelling
wav = model.generate(
    "It was a dark and stormy night...",
    exaggeration=1.0,  # Maximum drama
    cfg_weight=0.2     # Very slow, deliberate
)
```

### **Zero-Shot Voice Cloning**

```python
# Clone any voice from a reference sample
reference_audio = "path/to/reference_voice.wav"  # 5-10 seconds recommended

cloned_wav = model.generate(
    "This text will be spoken in the cloned voice.",
    audio_prompt_path=reference_audio,
    exaggeration=0.5,
    cfg_weight=0.4
)
```

### **Watermark Detection**

```python
import perth
import librosa

# Check if audio is watermarked
audio, sr = librosa.load("generated_audio.wav", sr=None)
watermarker = perth.PerthImplicitWatermarker()
watermark = watermarker.get_watermark(audio, sample_rate=sr)

print(f"Watermark detected: {watermark}")  # 1.0 = watermarked, 0.0 = not watermarked
```

---

## 5. 🔧 **Integration & Testing**

### **Test Script**

**File: `test_chatterbox_real.py`**
```python
#!/usr/bin/env python3
"""
Test script for actual Resemble AI Chatterbox TTS
"""
import torch
import torchaudio as ta
from chatterbox.tts import ChatterboxTTS

def test_chatterbox():
    print("🚀 Testing Resemble AI Chatterbox TTS...")
    
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Using device: {device}")
    
    try:
        # Load model
        print("Loading Chatterbox model...")
        model = ChatterboxTTS.from_pretrained(device=device)
        print("✅ Model loaded successfully!")
        
        # Test 1: Basic synthesis
        print("\n🎵 Test 1: Basic synthesis")
        text = "Hello! I am the real Chatterbox TTS from Resemble AI. This is neural synthesis with emotion control."
        wav = model.generate(text)
        ta.save("test_basic.wav", wav, model.sr)
        print("✅ Basic synthesis saved to test_basic.wav")
        
        # Test 2: Expressive synthesis
        print("\n🎭 Test 2: Expressive synthesis")
        text = "This is absolutely incredible! I'm so excited to show you these amazing features!"
        wav = model.generate(text, exaggeration=0.8, cfg_weight=0.3)
        ta.save("test_expressive.wav", wav, model.sr)
        print("✅ Expressive synthesis saved to test_expressive.wav")
        
        # Test 3: Calm synthesis
        print("\n😌 Test 3: Calm synthesis")
        text = "Let me speak in a calm, measured tone. This demonstrates precise control over pacing and emotion."
        wav = model.generate(text, exaggeration=0.2, cfg_weight=0.6)
        ta.save("test_calm.wav", wav, model.sr)
        print("✅ Calm synthesis saved to test_calm.wav")
        
        print("\n🎉 All tests completed successfully!")
        print("🎧 Play the generated .wav files to hear the results")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        return False
    
    return True

if __name__ == "__main__":
    test_chatterbox()
```

### **API Testing**

```bash
# Test health endpoint
curl http://localhost:8005/health | jq

# Test basic synthesis
curl -X POST http://localhost:8005/synthesize \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Testing Resemble AI Chatterbox TTS with emotion control!",
    "voice_id": "expressive", 
    "exaggeration": 0.7,
    "cfg_weight": 0.4
  }' \
  --output test_chatterbox.wav

# Test voice listing
curl http://localhost:8005/voices | jq
```

---

## 6. 🚀 **Deployment Commands**

### **Local Development**
```bash
# Install and test
pip install chatterbox-tts
python test_chatterbox_real.py

# Run service locally
python services/chatterbox_tts_service.py
```

### **Docker Deployment**
```bash
# Build GPU container
docker build -f Dockerfile.chatterbox-gpu -t chatterbox-tts-gpu .

# Run with GPU support
docker run --gpus all -p 8005:8005 chatterbox-tts-gpu

# Or via docker-compose
docker-compose up chatterbox-tts-gpu
```

### **Docker Compose Configuration**
```yaml
services:
  chatterbox-tts:
    build:
      context: .
      dockerfile: Dockerfile.chatterbox-gpu
    ports:
      - "8005:8005"
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    volumes:
      - ./cache:/app/cache
    environment:
      - CUDA_VISIBLE_DEVICES=0
      - HF_HOME=/app/cache
```

---

## 7. 🎯 **Performance & Optimization**

### **Expected Performance (RTX 4090)**
- **Latency**: Sub-200ms for short texts
- **VRAM Usage**: 5-8GB during inference
- **Quality**: Production-grade neural synthesis
- **Features**: Emotion control, voice cloning, watermarking

### **Optimization Tips**
- Use **float16** precision for GPU inference
- **Batch multiple** short texts together
- **Cache model** in memory between requests
- **Pre-warm** model on service startup
- Use **faster sampling** for real-time applications

---

## 🎉 **Summary**

You now have the **real Resemble AI Chatterbox TTS** with:

- 🧠 **0.5B Llama backbone** for intelligent synthesis
- 🎭 **Emotion/exaggeration control** (unique feature)
- 🗣️ **Zero-shot voice cloning** from any reference
- ⚡ **GPU acceleration** with sub-200ms latency
- 🔒 **Built-in watermarking** for AI safety
- 🎯 **Production-grade quality** that outperforms ElevenLabs

This is a massive upgrade from the previous pyttsx3-based system that was incorrectly labeled as "Chatterbox"! 