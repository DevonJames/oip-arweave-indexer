#!/bin/bash

# Start Mac Client Services
# Starts STT, Smart Turn, and coordinator services

set -e

echo "🍎 Starting Enhanced Voice Pipeline - Mac Client"
echo "=============================================="

# Check if we're in the right directory
if [ ! -f "mac_stt_service.py" ] || [ ! -f "mac_smart_turn_service.py" ]; then
    echo "❌ Error: Mac client files not found"
    echo "   Please run this script from the mac-client directory"
    exit 1
fi

# Load environment
if [ -f ".env" ]; then
    source .env
    echo "✅ Environment loaded"
else
    echo "⚠️  Warning: .env file not found, using defaults"
fi

# Activate Python virtual environment
if [ -d "mac-client-env" ]; then
    source mac-client-env/bin/activate
    echo "✅ Python virtual environment activated"
else
    echo "❌ Error: Python virtual environment not found"
    echo "   Please run ./setup_mac_client.sh first"
    exit 1
fi

# Create logs directory
mkdir -p logs

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Shutting down Mac client services..."
    
    # Kill background processes
    if [ ! -z "$STT_PID" ]; then
        kill $STT_PID 2>/dev/null || true
        echo "   STT service stopped"
    fi
    
    if [ ! -z "$SMART_TURN_PID" ]; then
        kill $SMART_TURN_PID 2>/dev/null || true
        echo "   Smart Turn service stopped"
    fi
    
    echo "✅ Mac client shutdown complete"
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

# Start STT service
echo "🚀 Starting Apple Silicon MLX STT Service..."
python mac_stt_service.py > logs/stt_service.log 2>&1 &
STT_PID=$!
echo "   STT Service PID: $STT_PID"

# Wait a moment for STT to start
sleep 3

# Check if STT service is responding
STT_PORT=${STT_PORT:-8013}
if curl -s "http://localhost:$STT_PORT/health" > /dev/null; then
    echo "✅ STT Service started successfully on port $STT_PORT"
else
    echo "❌ STT Service failed to start"
    kill $STT_PID 2>/dev/null || true
    exit 1
fi

# Start Smart Turn service
echo "🚀 Starting Mac Smart Turn Service..."
python mac_smart_turn_service.py > logs/smart_turn_service.log 2>&1 &
SMART_TURN_PID=$!
echo "   Smart Turn Service PID: $SMART_TURN_PID"

# Wait a moment for Smart Turn to start
sleep 3

# Check if Smart Turn service is responding
SMART_TURN_PORT=${SMART_TURN_PORT:-8014}
if curl -s "http://localhost:$SMART_TURN_PORT/health" > /dev/null; then
    echo "✅ Smart Turn Service started successfully on port $SMART_TURN_PORT"
else
    echo "❌ Smart Turn Service failed to start"
    cleanup
    exit 1
fi

echo ""
echo "🎉 Mac Client Services Started Successfully!"
echo ""
echo "📊 Service Status:"
echo "   🔊 STT Service:        http://localhost:$STT_PORT"
echo "   🤖 Smart Turn Service: http://localhost:$SMART_TURN_PORT"
echo "   📝 Logs Directory:     ./logs/"
echo ""
echo "🔧 Backend Configuration:"
echo "   🖥️  Backend Host: ${BACKEND_HOST:-100.124.42.82}"
echo "   🔌 Backend Port: ${BACKEND_PORT:-3000}"
echo ""
echo "📋 Available Commands:"
echo "   Health Check:  node mac_client_coordinator.js health"
echo "   Test Pipeline: node mac_client_coordinator.js test"
echo "   Monitor:       node mac_client_coordinator.js monitor"
echo ""
echo "🔍 Service Health Check:"

# Run initial health check
node mac_client_coordinator.js health

echo ""
echo "✅ Mac Client is ready for distributed voice processing!"
echo "   Press Ctrl+C to stop all services"
echo ""

# Keep the script running and monitor services
while true; do
    sleep 5
    
    # Check if services are still running
    if ! kill -0 $STT_PID 2>/dev/null; then
        echo "❌ STT Service died unexpectedly"
        cleanup
        exit 1
    fi
    
    if ! kill -0 $SMART_TURN_PID 2>/dev/null; then
        echo "❌ Smart Turn Service died unexpectedly"
        cleanup
        exit 1
    fi
done
