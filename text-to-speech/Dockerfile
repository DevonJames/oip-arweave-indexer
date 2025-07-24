FROM python:3.10-slim

# Install system dependencies for TTS engines
RUN apt-get update && apt-get install -y \
    espeak \
    espeak-data \
    libespeak1 \
    libespeak-dev \
    festival \
    alsa-utils \
    portaudio19-dev \
    python3-dev \
    build-essential \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Install Python dependencies
RUN pip install --no-cache-dir \
    fastapi==0.104.1 \
    uvicorn==0.24.0 \
    pyttsx3==2.90 \
    gTTS==2.4.0 \
    edge-tts==6.1.9 \
    python-multipart==0.0.6 \
    httpx==0.25.2 \
    pydantic==2.5.0 \
    soundfile==0.12.1 \
    torch>=2.0.0 \
    numpy

# Install Chatterbox TTS (allow failures for containers without GPU support)
RUN pip install --no-cache-dir chatterbox-tts || echo "Chatterbox TTS installation failed - will fallback to other engines"

# Copy service files
COPY . .

# Expose port
EXPOSE 8005

# Run the service
CMD ["uvicorn", "tts_service:app", "--host", "0.0.0.0", "--port", "8005"] 