#!/bin/bash

# Start WebRTC-Enhanced ALFRED Interface
# Phase 1.1: WebRTC Audio Streaming Implementation

echo "🚀 Starting WebRTC-Enhanced ALFRED Interface..."
echo "=================================================================="
echo "🎯 Phase 1.1 Features:"
echo "📡 WebRTC signaling server for ultra-low latency audio"
echo "🎤 Real-time audio streaming (500ms → <100ms)"
echo "🔄 Automatic fallback to MediaRecorder if WebRTC unavailable"
echo "🛡️ Uses your RTX 4090 backend for LLM/RAG/TTS"
echo ""

# Check if ports are available
echo "🔍 Checking port availability..."
if lsof -Pi :3001 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "❌ Port 3001 (Interface Server) is already in use"
    echo "   Killing existing process..."
    pkill -f "enhanced_voice_interface_server.js" || true
    sleep 2
fi

if lsof -Pi :3002 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "❌ Port 3002 (WebRTC Signaling) is already in use"
    echo "   Killing existing process..."
    pkill -f "webrtc_signaling_server.js" || true
    sleep 2
fi

echo "✅ Ports are available"

# Check dependencies
echo ""
echo "📦 Checking dependencies..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js"
    exit 1
fi

if [ ! -f "package.json" ]; then
    echo "❌ package.json not found. Please run from mac-client directory"
    exit 1
fi

if [ ! -d "node_modules" ]; then
    echo "📦 Installing Node.js dependencies..."
    npm install
fi

echo "✅ Node.js dependencies are ready"

# Check if unified voice processor is running
echo ""
echo "🔍 Checking local speech processing services..."
if curl -s http://localhost:8015/health >/dev/null 2>&1; then
    echo "✅ Unified Voice Processor is already running"
else
    echo "❌ Unified Voice Processor not running"
    echo "   Please start it first:"
    echo "   cd /Users/devon/Documents/CODE-local/oip-arweave-indexer/mac-client"
    echo "   source mac-client-env/bin/activate"
    echo "   python unified_voice_processor.py"
    echo ""
    echo "   Or use: ./start_interface_only.sh"
    exit 1
fi

# Start services
echo ""
echo "🚀 Starting services..."

# Start WebRTC signaling server
echo "📡 Starting WebRTC Signaling Server..."
node webrtc_signaling_server.js &
WEBRTC_PID=$!
echo "   WebRTC Signaling Server PID: $WEBRTC_PID"

# Wait for WebRTC server to start
sleep 3

# Check if WebRTC server is running
if curl -s http://localhost:3002/health >/dev/null 2>&1; then
    echo "✅ WebRTC Signaling Server is healthy"
else
    echo "❌ WebRTC Signaling Server failed to start"
    kill $WEBRTC_PID 2>/dev/null || true
    exit 1
fi

# Start interface server (disable its internal WebRTC signaling)
echo "🖥️  Starting Enhanced Voice Interface Server..."
DISABLE_INTERNAL_WEBRTC=true node enhanced_voice_interface_server.js &
INTERFACE_PID=$!
echo "   Interface Server PID: $INTERFACE_PID"

# Wait for interface server to start
sleep 2

# Check if interface server is running
if curl -s http://localhost:3001/health >/dev/null 2>&1; then
    echo "✅ Interface Server is healthy"
else
    echo "❌ Interface Server failed to start"
    kill $WEBRTC_PID $INTERFACE_PID 2>/dev/null || true
    exit 1
fi

echo ""
echo "🎉 WebRTC-Enhanced ALFRED Interface is ready!"
echo "=================================================================="
echo "🌐 Main Interface: http://localhost:3001/enhanced"
echo "🧪 WebRTC Test Page: http://localhost:3001/test_webrtc.html"
echo "📡 WebRTC Signaling: http://localhost:3002"
echo "🔧 WebRTC Health: http://localhost:3002/health"
echo ""
echo "🎤 Features Active:"
echo "   • Ultra-low latency WebRTC audio streaming"
echo "   • Automatic fallback to MediaRecorder"
echo "   • Real-time STT processing on Mac"
echo "   • Remote LLM/RAG/TTS on RTX 4090"
echo ""
echo "Press Ctrl+C to stop all services"
echo "=================================================================="

# Save PIDs for cleanup
echo "$WEBRTC_PID" > /tmp/webrtc_server.pid
echo "$INTERFACE_PID" > /tmp/interface_server.pid

# Wait for services and handle cleanup
cleanup() {
    echo ""
    echo "🛑 Shutting down services..."
    kill $WEBRTC_PID $INTERFACE_PID 2>/dev/null || true
    rm -f /tmp/webrtc_server.pid /tmp/interface_server.pid
    echo "✅ All services stopped"
    exit 0
}

trap cleanup SIGINT SIGTERM

# Keep script running
wait
