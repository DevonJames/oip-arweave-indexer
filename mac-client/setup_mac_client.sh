#!/bin/bash

# Enhanced Voice Pipeline - Mac Client Setup
# Sets up STT, VAD, and Smart Turn services on Apple Silicon Mac

set -e

echo "🍎 Enhanced Voice Pipeline - Mac Client Setup"
echo "=============================================="
echo ""

# Check if running on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo "❌ This script is designed for macOS only"
    exit 1
fi

# Check for Apple Silicon
ARCH=$(uname -m)
if [[ "$ARCH" != "arm64" ]]; then
    echo "⚠️  Warning: This script is optimized for Apple Silicon (M1/M2/M3/M4)"
    echo "   Detected architecture: $ARCH"
    echo "   Continue anyway? (y/n)"
    read -r response
    if [[ "$response" != "y" && "$response" != "Y" ]]; then
        exit 1
    fi
fi

echo "✅ Apple Silicon Mac detected"
echo ""

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Install Homebrew if not present
if ! command_exists brew; then
    echo "📦 Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    
    # Add Homebrew to PATH for Apple Silicon
    if [[ -f "/opt/homebrew/bin/brew" ]]; then
        echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
        eval "$(/opt/homebrew/bin/brew shellenv)"
    fi
else
    echo "✅ Homebrew already installed"
fi

# Install Python 3.11 if not present
echo "🐍 Setting up Python 3.11..."
if ! command_exists python3.11; then
    brew install python@3.11
else
    echo "✅ Python 3.11 already installed"
fi

# Install system dependencies
echo "📦 Installing system dependencies..."
brew install ffmpeg portaudio

# Install Node.js for client communication
if ! command_exists node; then
    echo "📦 Installing Node.js..."
    brew install node
else
    echo "✅ Node.js already installed"
fi

# Create virtual environment
echo "🔧 Creating Python virtual environment..."
python3.11 -m venv mac-client-env

# Activate virtual environment
source mac-client-env/bin/activate

# Upgrade pip
pip install --upgrade pip

# Install Python dependencies
echo "📦 Installing Python dependencies..."
pip install \
    fastapi==0.104.1 \
    uvicorn[standard]==0.24.0 \
    python-multipart==0.0.6 \
    pydantic==2.5.0 \
    httpx==0.25.2 \
    requests>=2.31.0 \
    numpy>=1.24.0 \
    librosa>=0.10.1 \
    soundfile>=0.12.1 \
    torch>=2.1.0 \
    torchaudio>=2.1.0

# Install MLX for Apple Silicon
echo "🚀 Installing MLX framework for Apple Silicon..."
pip install mlx>=0.5.0

# Try to install MLX Whisper (may not be available yet)
echo "🎯 Attempting to install MLX Whisper..."
pip install mlx-whisper>=0.1.0 || echo "⚠️  MLX Whisper not available, will use mock implementation"

# Create directories
echo "📁 Creating client directories..."
mkdir -p models/whisper-mlx
mkdir -p models/silero_vad
mkdir -p models/smart_turn
mkdir -p logs
mkdir -p config

# Create configuration file
echo "⚙️ Creating configuration..."
cat > config/mac_client_config.json << 'EOF'
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
        "port": 8014,
        "model_path": "models/smart_turn/"
      },
      "vad": {
        "enabled": true,
        "threshold": 0.5,
        "min_speech_ms": 200,
        "min_silence_ms": 300
      }
    },
    "backend": {
      "host": "192.168.1.100",
      "port": 3000,
      "protocol": "http",
      "endpoints": {
        "health": "/api/voice/health",
        "chat": "/api/voice/chat",
        "rag": "/api/alfred/query"
      }
    },
    "audio": {
      "sample_rate": 16000,
      "channels": 1,
      "format": "wav"
    },
    "logging": {
      "level": "INFO",
      "file": "logs/mac_client.log"
    }
  }
}
EOF

# Create environment file
echo "📝 Creating environment configuration..."
cat > .env << 'EOF'
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
VAD_MIN_SPEECH_MS=200
VAD_MIN_SILENCE_MS=300

# Backend Configuration (UPDATE THESE!)
BACKEND_HOST=192.168.1.100
BACKEND_PORT=3000
BACKEND_PROTOCOL=http

# Model Storage
MODEL_STORAGE_PATH=./models
CACHE_ENABLED=true

# Logging
LOG_LEVEL=INFO
LOG_FILE=logs/mac_client.log
EOF

# Install Node.js dependencies for client communication
echo "📦 Installing Node.js dependencies..."
cat > package.json << 'EOF'
{
  "name": "enhanced-voice-mac-client",
  "version": "1.0.0",
  "description": "Mac client for enhanced voice pipeline",
  "main": "client.js",
  "scripts": {
    "start": "node client.js",
    "dev": "nodemon client.js",
    "test": "node test_mac_client.js"
  },
  "dependencies": {
    "axios": "^1.6.0",
    "ws": "^8.14.0",
    "form-data": "^4.0.0",
    "dotenv": "^16.3.1"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  }
}
EOF

npm install

echo ""
echo "✅ Mac Client Setup Complete!"
echo ""
echo "📋 Next Steps:"
echo "1. Update backend configuration in .env file:"
echo "   - Set BACKEND_HOST to your PC's IP address"
echo "   - Set BACKEND_PORT to your backend port (default: 3000)"
echo ""
echo "2. Download models (optional, will auto-download on first use):"
echo "   ./download_models.sh"
echo ""
echo "3. Start the Mac client services:"
echo "   ./start_mac_client.sh"
echo ""
echo "4. Test the setup:"
echo "   ./test_mac_client.sh"
echo ""
echo "📁 Configuration files created:"
echo "   - config/mac_client_config.json"
echo "   - .env"
echo "   - package.json"
echo ""
echo "🔧 To activate Python environment later:"
echo "   source mac-client-env/bin/activate"
echo ""
echo "📖 See README.md for detailed usage instructions"
