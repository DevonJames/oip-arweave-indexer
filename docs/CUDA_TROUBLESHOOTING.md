# 🔧 CUDA Base Image Troubleshooting

## Issue: CUDA Base Image Not Found

If you're getting errors like:
```
nvidia/cuda:11.8-runtime-ubuntu22.04: not found
```

## 🚀 Quick Fixes

### **Step 1: Check Your CUDA Version**
```bash
# Check NVIDIA drivers and CUDA version
nvidia-smi

# Check Docker GPU support  
docker run --rm --gpus all nvidia/cuda:11.7.1-runtime-ubuntu20.04 nvidia-smi
```

### **Step 2: Try Alternative Base Images**

#### **Option A: Use CUDA 11.7 (More Compatible)**
```bash
# Use the fallback Dockerfiles
cp speech-to-text/Dockerfile.gpu.fallback speech-to-text/Dockerfile.gpu
cp text-to-speech/Dockerfile.gpu.fallback text-to-speech/Dockerfile.gpu

# Deploy
make full-gpu
```

#### **Option B: Update to Match Your CUDA Version**
Edit `Dockerfile.gpu` files and change the first line to match your system:

**For CUDA 11.7:**
```dockerfile
FROM nvidia/cuda:11.7.1-runtime-ubuntu20.04
```

**For CUDA 11.6:**
```dockerfile
FROM nvidia/cuda:11.6.2-runtime-ubuntu20.04
```

**For CUDA 11.2:**
```dockerfile
FROM nvidia/cuda:11.2.2-runtime-ubuntu20.04
```

### **Step 3: Update PyTorch Installation**
Match the PyTorch installation to your CUDA version:

**For CUDA 11.7:**
```dockerfile
RUN pip3 install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu117
```

**For CUDA 11.6:**
```dockerfile
RUN pip3 install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu116
```

**For CUDA 11.3:**
```dockerfile
RUN pip3 install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu113
```

## 🔍 Available CUDA Images

Check what CUDA images are available:
```bash
# Search for available CUDA runtime images
docker search nvidia/cuda

# Check NVIDIA's official registry
curl -s https://registry.hub.docker.com/v2/repositories/nvidia/cuda/tags/ | jq '.results[].name' | grep runtime | head -20
```

## 🛠️ Alternative Approach: CPU-Only Fallback

If GPU images continue to fail, temporarily use CPU-only services:

```bash
# Use CPU profile instead
make voice

# This gives you:
# - CPU-based Whisper STT
# - CPU-based LLaMA (slower but works)
# - Multi-engine TTS (still great quality)
```

## 🎯 Recommended Solution

**For RTX 4090 systems, try this order:**

1. **CUDA 11.7** (most compatible):
   ```bash
   cp speech-to-text/Dockerfile.gpu.fallback speech-to-text/Dockerfile.gpu
   cp text-to-speech/Dockerfile.gpu.fallback text-to-speech/Dockerfile.gpu
   make full-gpu
   ```

2. **Check your driver compatibility**:
   ```bash
   nvidia-smi | grep "CUDA Version"
   ```

3. **If needed, update drivers**:
   ```bash
   # Ubuntu
   sudo apt update
   sudo apt install nvidia-driver-535  # Latest stable
   sudo reboot
   ```

## 📋 What Each Fix Does

| Fix | CUDA Version | PyTorch | Compatibility |
|-----|--------------|---------|---------------|
| Original | 11.8 | cu118 | Latest (may not be available) |
| Fallback | 11.7 | cu117 | High (recommended) |
| Legacy | 11.2-11.6 | cu113-cu116 | Older systems |

## 🚀 Quick Recovery Commands

```bash
# Try the fallback versions
cp speech-to-text/Dockerfile.gpu.fallback speech-to-text/Dockerfile.gpu
cp text-to-speech/Dockerfile.gpu.fallback text-to-speech/Dockerfile.gpu

# Rebuild
make rebuild PROFILE=full-gpu

# If that fails, use CPU version temporarily
make voice
``` 