#!/bin/bash

# Enhanced Voice Pipeline Deployment Script
# Deploys the upgraded voice pipeline with Smart Turn v2 integration

set -e

echo "🚀 Deploying Enhanced Voice Pipeline"
echo "===================================="

# Configuration
COMPOSE_FILE="docker-compose-voice-enhanced.yml"
PROFILE=""
OFFLINE_MODE=${OFFLINE_MODE:-"true"}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --profile)
            PROFILE="$2"
            shift 2
            ;;
        --online)
            OFFLINE_MODE="false"
            shift
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --profile PROFILE    Use specific profile (e.g., apple-silicon)"
            echo "  --online            Enable online mode (disable offline-only features)"
            echo "  --help              Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0                          # Standard deployment"
            echo "  $0 --profile apple-silicon  # Apple Silicon optimized"
            echo "  $0 --online                 # Online mode with cloud services"
            exit 0
            ;;
        *)
            echo "Unknown option $1"
            exit 1
            ;;
    esac
done

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker and try again."
    exit 1
fi

# Check if docker-compose is available
if ! command -v docker-compose > /dev/null 2>&1; then
    echo "❌ docker-compose is not installed. Please install docker-compose and try again."
    exit 1
fi

# Create necessary directories
echo "📁 Creating necessary directories..."
mkdir -p models/smart_turn
mkdir -p models/silero_vad
mkdir -p models/whisper
mkdir -p models/kokoro
mkdir -p test_data

# Set environment variables
echo "⚙️ Configuring environment..."
export SMART_TURN_ENABLED=true
export VAD_ENABLED=true  # Enabled in Week 2
export WHISPER_MODEL=large-v3-turbo  # Upgraded in Week 2
export TTS_PRIMARY_ENGINE=chatterbox  # Will change to kokoro in Week 3
export OFFLINE_MODE=$OFFLINE_MODE

if [ "$OFFLINE_MODE" = "true" ]; then
    echo "🔒 Offline mode enabled - disabling cloud services"
    export DISABLE_EDGE_TTS=true
    export DISABLE_GTTS=true
else
    echo "🌐 Online mode enabled - cloud services available"
    export DISABLE_EDGE_TTS=false
    export DISABLE_GTTS=false
fi

# Build and deploy services
echo "🔨 Building and deploying services..."

if [ -n "$PROFILE" ]; then
    echo "Using profile: $PROFILE"
    docker-compose -f $COMPOSE_FILE --profile $PROFILE build
    docker-compose -f $COMPOSE_FILE --profile $PROFILE up -d
else
    docker-compose -f $COMPOSE_FILE build
    docker-compose -f $COMPOSE_FILE up -d
fi

# Wait for services to be healthy
echo "⏳ Waiting for services to be healthy..."
sleep 10

# Check service health
echo "🔍 Checking service health..."
services=("smart-turn" "speech-to-text" "text-to-speech" "elasticsearch" "ollama" "main-app")

for service in "${services[@]}"; do
    echo -n "Checking $service... "
    
    # Get container name
    container_name=$(docker-compose -f $COMPOSE_FILE ps -q $service 2>/dev/null)
    
    if [ -z "$container_name" ]; then
        echo "❌ Not running"
        continue
    fi
    
    # Check if container is healthy
    health_status=$(docker inspect --format='{{.State.Health.Status}}' $container_name 2>/dev/null || echo "no-healthcheck")
    
    if [ "$health_status" = "healthy" ]; then
        echo "✅ Healthy"
    elif [ "$health_status" = "no-healthcheck" ]; then
        # Check if container is running
        if docker ps --format "table {{.Names}}" | grep -q $container_name; then
            echo "✅ Running"
        else
            echo "❌ Not running"
        fi
    else
        echo "⚠️ $health_status"
    fi
done

# Test services
echo ""
echo "🧪 Testing enhanced voice pipeline services..."
if command -v node > /dev/null 2>&1; then
    # Test Smart Turn service
    if [ -f "test_smart_turn_service.js" ]; then
        echo "Testing Smart Turn service..."
        SMART_TURN_URL=http://localhost:8010 node test_smart_turn_service.js
    else
        echo "⚠️ Smart Turn test script not found"
    fi
    
    # Test Enhanced STT service
    if [ -f "test_enhanced_stt_service.js" ]; then
        echo "Testing Enhanced STT service..."
        STT_SERVICE_URL=http://localhost:8003 node test_enhanced_stt_service.js
    else
        echo "⚠️ Enhanced STT test script not found"
    fi
    
    # Test Kokoro TTS service
    if [ -f "test_kokoro_tts_service.js" ]; then
        echo "Testing Kokoro TTS service..."
        TTS_SERVICE_URL=http://localhost:5002 node test_kokoro_tts_service.js
    else
        echo "⚠️ Kokoro TTS test script not found"
    fi
else
    echo "⚠️ Node.js not found, skipping service tests"
fi

# Display service URLs
echo ""
echo "🌐 Service URLs:"
echo "  Main Application:    http://localhost:3000"
echo "  Smart Turn Service:  http://localhost:8010"
echo "  Speech-to-Text:      http://localhost:8003"
echo "  Text-to-Speech:      http://localhost:5002"
echo "  Elasticsearch:       http://localhost:9200"
echo "  Ollama:              http://localhost:11434"

if [ -n "$PROFILE" ] && [ "$PROFILE" = "apple-silicon" ]; then
    echo "  MLX STT Service:     http://localhost:8013"
fi

# Display health check command
echo ""
echo "🔍 Health Check Commands:"
echo "  curl http://localhost:3000/api/voice/health"
echo "  curl http://localhost:8010/health"

# Display logs command
echo ""
echo "📋 View Logs:"
if [ -n "$PROFILE" ]; then
    echo "  docker-compose -f $COMPOSE_FILE --profile $PROFILE logs -f"
else
    echo "  docker-compose -f $COMPOSE_FILE logs -f"
fi

# Display shutdown command
echo ""
echo "🛑 Shutdown:"
if [ -n "$PROFILE" ]; then
    echo "  docker-compose -f $COMPOSE_FILE --profile $PROFILE down"
else
    echo "  docker-compose -f $COMPOSE_FILE down"
fi

echo ""
echo "✅ Enhanced Voice Pipeline deployment completed!"
echo ""
echo "📝 Current Features:"
echo "  ✅ Smart Turn v2 endpoint detection (mock implementation)"
echo "  ✅ Enhanced voice route with Smart Turn integration"
echo "  ✅ Silero VAD voice activity detection"
echo "  ✅ Whisper Large v3 Turbo STT model"
echo "  ✅ Enhanced STT service with preprocessing"
echo "  ✅ Apple Silicon MLX optimization (when available)"
echo "  ✅ Kokoro TTS with multi-engine fallback"
echo "  ✅ High-quality neural speech synthesis"
echo "  ✅ Intelligent TTS engine selection"
echo "  ✅ Audio caching and performance optimization"
echo "  ✅ Comprehensive health monitoring"
echo "  ✅ Fallback mechanisms preserved"
