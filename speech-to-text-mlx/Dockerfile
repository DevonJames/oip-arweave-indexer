FROM python:3.11-slim

# Install system dependencies for Apple Silicon
RUN apt-get update && apt-get install -y \
    ffmpeg \
    curl \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Create directories
RUN mkdir -p /app/models/whisper-mlx

# Copy service files
COPY . .

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Expose port
EXPOSE 8000

# Run the MLX service
CMD ["uvicorn", "whisper_service_mlx:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
