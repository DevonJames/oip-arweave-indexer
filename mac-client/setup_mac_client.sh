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

# Check if .env file exists, if not copy from example
if [ ! -f ".env" ]; then
    if [ -f "example.env" ]; then
        echo "📋 Creating .env from example.env..."
        cp example.env .env
        echo "⚠️  Please edit .env file to set your backend IP address!"
    else
        echo "❌ No .env or example.env found, creating default..."
    fi
fi

# Load configuration from local .env file
BACKEND_HOST_DEFAULT="192.168.1.100"
BACKEND_PORT_DEFAULT="3000" 
BACKEND_PROTOCOL_DEFAULT="http"

# Load from local .env if it exists
if [ -f ".env" ]; then
    echo "✅ Loading configuration from .env file..."
    # Source the .env file to get backend settings
    export $(grep -E "^(BACKEND_HOST|BACKEND_PORT|BACKEND_PROTOCOL)=" .env | xargs) 2>/dev/null || true
fi

# Use environment variables or defaults
BACKEND_HOST_CONFIG="${BACKEND_HOST:-$BACKEND_HOST_DEFAULT}"
BACKEND_PORT_CONFIG="${BACKEND_PORT:-$BACKEND_PORT_DEFAULT}"
BACKEND_PROTOCOL_CONFIG="${BACKEND_PROTOCOL:-$BACKEND_PROTOCOL_DEFAULT}"

echo "🔧 Backend configuration:"
echo "   Host: $BACKEND_HOST_CONFIG"
echo "   Port: $BACKEND_PORT_CONFIG"
echo "   Protocol: $BACKEND_PROTOCOL_CONFIG"

cat > config/mac_client_config.json << EOF
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
      "host": "$BACKEND_HOST_CONFIG",
      "port": $BACKEND_PORT_CONFIG,
      "protocol": "$BACKEND_PROTOCOL_CONFIG",
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

# Update .env file with detected configuration if needed
if [ -f ".env" ]; then
    echo "📝 Updating .env with detected configuration..."
    
    # Update backend configuration in existing .env file
    if grep -q "^BACKEND_HOST=" .env; then
        sed -i.bak "s/^BACKEND_HOST=.*/BACKEND_HOST=$BACKEND_HOST_CONFIG/" .env
    else
        echo "BACKEND_HOST=$BACKEND_HOST_CONFIG" >> .env
    fi
    
    if grep -q "^BACKEND_PORT=" .env; then
        sed -i.bak "s/^BACKEND_PORT=.*/BACKEND_PORT=$BACKEND_PORT_CONFIG/" .env
    else
        echo "BACKEND_PORT=$BACKEND_PORT_CONFIG" >> .env
    fi
    
    if grep -q "^BACKEND_PROTOCOL=" .env; then
        sed -i.bak "s/^BACKEND_PROTOCOL=.*/BACKEND_PROTOCOL=$BACKEND_PROTOCOL_CONFIG/" .env
    else
        echo "BACKEND_PROTOCOL=$BACKEND_PROTOCOL_CONFIG" >> .env
    fi
    
    # Clean up backup file
    rm -f .env.bak
fi

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
