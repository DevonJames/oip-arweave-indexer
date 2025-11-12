FROM nvidia/cuda:11.7.1-runtime-ubuntu20.04

# Set timezone to avoid interactive prompts
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3-dev \
    python3-pip \
    build-essential \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Install Python dependencies
RUN pip3 install --upgrade pip setuptools wheel

# Install PyTorch 2.1+ FIRST (required for SNAC codec)
# CUDA 11.8 wheels are backward compatible with CUDA 11.7 runtime
RUN pip3 install --no-cache-dir \
    torch==2.1.0 torchvision==0.16.0 torchaudio==2.1.0 \
    --extra-index-url https://download.pytorch.org/whl/cu118 && \
    python3 -c "import torch; version=torch.__version__; assert version.startswith('2.1'), f'PyTorch version {version} is not 2.1.x - SNAC will fail!'; print(f'✅ PyTorch {version} installed successfully'); from torch.nn.utils.parametrizations import weight_norm; print('✅ weight_norm import successful')"

# Install Maya1 TTS dependencies (requires PyTorch 2.1+)
RUN pip3 install --no-cache-dir \
    transformers>=4.35.0 \
    snac \
    accelerate \
    sentencepiece \
    protobuf \
    fastapi==0.104.1 \
    uvicorn==0.24.0 \
    python-multipart==0.0.6 \
    soundfile==0.12.1 \
    numpy>=1.24.0

# Copy service files
COPY . .

# Create cache directories
RUN mkdir -p /root/.cache/torch/hub
RUN mkdir -p /root/.cache/huggingface

# Pre-download Maya1 model and SNAC codec
RUN python3 download_maya1_model.py || echo "Failed to pre-load Maya1 models, will download on first use"

# Expose port
EXPOSE 5003

# Set environment variables for GPU
ENV CUDA_VISIBLE_DEVICES=0
ENV TTS_GPU_ENABLED=true
ENV MAYA1_SERVICE_PORT=5003

# Run the service
CMD ["python3", "maya1_service.py"]

