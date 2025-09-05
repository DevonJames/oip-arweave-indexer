#!/bin/bash

# Simple WebRTC Test Script
echo "🧪 Testing WebRTC Audio Streaming..."

# Check if unified voice processor is running
if ! curl -s http://127.0.0.1:8015/health >/dev/null 2>&1; then
    echo "❌ Unified Voice Processor not running on port 8015"
    echo "   Start it first with: ./start_interface_only.sh"
    exit 1
fi

echo "✅ Unified Voice Processor is running"

# Start WebRTC signaling server
echo "📡 Starting WebRTC signaling server..."
node webrtc_signaling_server.js &
WEBRTC_PID=$!

# Wait for startup
sleep 2

# Check if WebRTC server started
if curl -s http://localhost:3002/health >/dev/null 2>&1; then
    echo "✅ WebRTC signaling server is healthy"
else
    echo "❌ WebRTC signaling server failed to start"
    kill $WEBRTC_PID 2>/dev/null || true
    exit 1
fi

echo ""
echo "🎤 WebRTC Test Ready!"
echo "================================"
echo "🌐 Open: http://localhost:3001/enhanced"
echo "🧪 Or test: http://localhost:3001/test_webrtc.html"
echo ""
echo "Expected behavior:"
echo "✅ WebRTC connects to signaling server"
echo "✅ Audio streaming starts when you press spacebar"
echo "✅ Real-time STT processing"
echo "✅ No 'connection refused' errors"
echo ""
echo "Press Ctrl+C to stop WebRTC signaling server"

# Cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Stopping WebRTC signaling server..."
    kill $WEBRTC_PID 2>/dev/null || true
    echo "✅ WebRTC test stopped"
}

trap cleanup SIGINT SIGTERM
wait $WEBRTC_PID
