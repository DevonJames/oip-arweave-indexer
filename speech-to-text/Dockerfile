FROM python:3.10-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Install Python dependencies
RUN pip install --no-cache-dir \
    fastapi==0.104.1 \
    uvicorn==0.24.0 \
    faster-whisper==0.9.0 \
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