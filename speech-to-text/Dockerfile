FROM python:3.10-slim

# Install system dependencies (pkg-config and libav* needed to build PyAV for faster-whisper)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    pkg-config \
    libavformat-dev \
    libavcodec-dev \
    libavdevice-dev \
    libavutil-dev \
    libswscale-dev \
    libswresample-dev \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Upgrade pip first
RUN pip install --upgrade pip

# Pre-install av separately (most problematic package - use prebuilt wheel)
RUN pip install --no-cache-dir --timeout=300 --retries=5 'av>=11.0.0,<13.0.0'

# Pre-install tokenizers
RUN pip install --no-cache-dir 'tokenizers>=0.13,<0.20'

# Install faster-whisper (newer version that works with av 11+)
RUN pip install --no-cache-dir \
    --timeout=300 \
    --retries=5 \
    faster-whisper

# Install remaining Python dependencies
RUN pip install --no-cache-dir \
    fastapi==0.104.1 \
    uvicorn==0.24.0 \
    python-multipart==0.0.6 \
    httpx==0.25.2

# Create models directory
RUN mkdir -p /app/models

# Copy service files
COPY . .

# Expose port
EXPOSE 8003

# Run the service
CMD ["uvicorn", "whisper_service:app", "--host", "0.0.0.0", "--port", "8003"]
