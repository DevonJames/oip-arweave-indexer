#!/bin/bash

# Deploy Backend-Only Services
# For distributed architecture with Mac client handling STT/VAD/Smart Turn

set -e

echo "🖥️  Enhanced Voice Pipeline - Backend-Only Deployment"
echo "===================================================="
echo ""
echo "This deployment is optimized for distributed architecture:"
echo "  🍎 Mac Client: STT, VAD, Smart Turn (Apple Silicon)"
echo "  🖥️  PC Backend: RAG, LLM, TTS (RTX 4090)"
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Check for NVIDIA GPU support
echo "🔍 Checking GPU support..."
if command -v nvidia-smi &> /dev/null; then
    echo "✅ NVIDIA GPU detected:"
    nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits
else
    echo "⚠️  NVIDIA GPU not detected. Some services may run on CPU only."
fi

# Stop any existing containers
echo "🛑 Stopping existing containers..."
docker-compose -f docker-compose-backend-only.yml down --remove-orphans

# Clean up old images (optional)
read -p "🗑️  Remove old Docker images? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🧹 Cleaning up old images..."
    docker system prune -f
fi

# Build and start services
echo "🏗️  Building and starting backend services..."
echo ""

# Build services
echo "📦 Building Kokoro TTS service..."
docker-compose -f docker-compose-backend-only.yml build kokoro-tts

echo "📦 Building main application..."
docker-compose -f docker-compose-backend-only.yml build main-app

# Start infrastructure services first
echo "🚀 Starting infrastructure services..."
docker-compose -f docker-compose-backend-only.yml up -d elasticsearch ollama

# Wait for Elasticsearch to be ready
echo "⏳ Waiting for Elasticsearch to be ready..."
timeout 60s bash -c 'until curl -s http://localhost:9200/_cluster/health | grep -q "yellow\|green"; do sleep 2; done'

if curl -s http://localhost:9200/_cluster/health | grep -q "yellow\|green"; then
    echo "✅ Elasticsearch is ready"
else
    echo "❌ Elasticsearch failed to start properly"
    docker-compose -f docker-compose-backend-only.yml logs elasticsearch
    exit 1
fi

# Wait for Ollama to be ready
echo "⏳ Waiting for Ollama to be ready..."
timeout 60s bash -c 'until curl -s http://localhost:11434/api/tags > /dev/null; do sleep 2; done'

if curl -s http://localhost:11434/api/tags > /dev/null; then
    echo "✅ Ollama is ready"
    
    # Check if model is available
    echo "🤖 Checking Ollama model availability..."
    if curl -s http://localhost:11434/api/tags | grep -q "llama3.1:8b"; then
        echo "✅ Llama3.1:8b model is available"
    else
        echo "📥 Downloading Llama3.1:8b model..."
        docker-compose -f docker-compose-backend-only.yml exec ollama ollama pull llama3.1:8b
    fi
else
    echo "❌ Ollama failed to start properly"
    docker-compose -f docker-compose-backend-only.yml logs ollama
    exit 1
fi

# Start TTS service
echo "🚀 Starting Kokoro TTS service..."
docker-compose -f docker-compose-backend-only.yml up -d kokoro-tts

# Wait for TTS service to be ready
echo "⏳ Waiting for Kokoro TTS service..."
timeout 60s bash -c 'until curl -s http://localhost:8012/health > /dev/null; do sleep 2; done'

if curl -s http://localhost:8012/health > /dev/null; then
    echo "✅ Kokoro TTS service is ready"
else
    echo "❌ Kokoro TTS service failed to start"
    docker-compose -f docker-compose-backend-only.yml logs kokoro-tts
    exit 1
fi

# Start main application
echo "🚀 Starting main application..."
docker-compose -f docker-compose-backend-only.yml up -d main-app

# Wait for main app to be ready
echo "⏳ Waiting for main application..."
timeout 60s bash -c 'until curl -s http://localhost:3000/api/voice/health > /dev/null; do sleep 2; done'

if curl -s http://localhost:3000/api/voice/health > /dev/null; then
    echo "✅ Main application is ready"
else
    echo "❌ Main application failed to start"
    docker-compose -f docker-compose-backend-only.yml logs main-app
    exit 1
fi

# Display service status
echo ""
echo "🎉 Backend Services Started Successfully!"
echo ""
echo "📊 Service Status:"
echo "  🔍 Elasticsearch:  http://localhost:9200"
echo "  🤖 Ollama:         http://localhost:11434"
echo "  🗣️  Kokoro TTS:     http://localhost:8012"
echo "  🌐 Main App:       http://localhost:3000"
echo ""

# Test services
echo "🧪 Testing backend services..."

# Test Elasticsearch
echo "Testing Elasticsearch..."
ES_HEALTH=$(curl -s http://localhost:9200/_cluster/health | jq -r '.status' 2>/dev/null || echo "unknown")
echo "  ✅ Elasticsearch: $ES_HEALTH"

# Test Ollama
echo "Testing Ollama..."
if curl -s http://localhost:11434/api/tags > /dev/null; then
    echo "  ✅ Ollama: healthy"
else
    echo "  ❌ Ollama: unhealthy"
fi

# Test Kokoro TTS
echo "Testing Kokoro TTS..."
TTS_STATUS=$(curl -s http://localhost:8012/health | jq -r '.status' 2>/dev/null || echo "unknown")
echo "  ✅ Kokoro TTS: $TTS_STATUS"

# Test Main App
echo "Testing Main Application..."
MAIN_STATUS=$(curl -s http://localhost:3000/api/voice/health | jq -r '.status' 2>/dev/null || echo "unknown")
echo "  ✅ Main App: $MAIN_STATUS"

echo ""
echo "🔧 Backend Configuration:"
echo "  📡 Distributed Mode: Enabled"
echo "  🍎 External Client Services: Expected"
echo "  🎯 TTS Engine: Kokoro + Fallbacks"
echo "  🧠 LLM Model: Llama3.1:8b"
echo "  🔍 Search Engine: Elasticsearch"
echo ""

# Show network configuration
echo "🌐 Network Configuration:"
echo "  Backend Network: 172.20.0.0/16"
echo "  Main App Port: 3000"
echo "  Expected Mac Client: External connection"
echo ""

# Display next steps
echo "📋 Next Steps for Mac Client:"
echo ""
echo "1. On your Mac, update the backend configuration:"
echo "   cd mac-client/"
echo "   # Edit .env file:"
echo "   BACKEND_HOST=$(hostname -I | awk '{print $1}' || echo 'YOUR_PC_IP')"
echo "   BACKEND_PORT=3000"
echo ""
echo "2. Start Mac client services:"
echo "   ./start_mac_client.sh"
echo ""
echo "3. Test the distributed pipeline:"
echo "   node mac_client_coordinator.js test"
echo ""

# Show logs command
echo "📝 View Logs:"
echo "   docker-compose -f docker-compose-backend-only.yml logs -f [service-name]"
echo ""

# Show stop command
echo "🛑 Stop Services:"
echo "   docker-compose -f docker-compose-backend-only.yml down"
echo ""

echo "✅ Backend-only deployment complete!"
echo "   The backend is ready to receive requests from Mac clients"
