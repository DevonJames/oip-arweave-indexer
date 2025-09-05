#!/bin/bash

# Stop WebRTC-Enhanced ALFRED Interface
echo "🛑 Stopping WebRTC-Enhanced ALFRED Interface..."

# Kill processes by name
echo "🔄 Stopping WebRTC Signaling Server..."
pkill -f "webrtc_signaling_server.js" || true

echo "🔄 Stopping Enhanced Voice Interface Server..."
pkill -f "enhanced_voice_interface_server.js" || true

echo "🔄 Stopping Unified Voice Processor..."
pkill -f "unified_voice_processor.py" || true

# Kill processes by PID if available
if [ -f "/tmp/webrtc_server.pid" ]; then
    WEBRTC_PID=$(cat /tmp/webrtc_server.pid)
    kill $WEBRTC_PID 2>/dev/null || true
    rm -f /tmp/webrtc_server.pid
    echo "   Stopped WebRTC server (PID: $WEBRTC_PID)"
fi

if [ -f "/tmp/interface_server.pid" ]; then
    INTERFACE_PID=$(cat /tmp/interface_server.pid)
    kill $INTERFACE_PID 2>/dev/null || true
    rm -f /tmp/interface_server.pid
    echo "   Stopped Interface server (PID: $INTERFACE_PID)"
fi

if [ -f "/tmp/unified_voice_processor.pid" ]; then
    PROCESSOR_PID=$(cat /tmp/unified_voice_processor.pid)
    kill $PROCESSOR_PID 2>/dev/null || true
    rm -f /tmp/unified_voice_processor.pid
    echo "   Stopped Unified Voice Processor (PID: $PROCESSOR_PID)"
fi

# Double-check ports are freed
sleep 2

if lsof -Pi :3001 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "⚠️  Port 3001 still in use, force killing..."
    lsof -ti:3001 | xargs kill -9 2>/dev/null || true
fi

if lsof -Pi :3002 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "⚠️  Port 3002 still in use, force killing..."
    lsof -ti:3002 | xargs kill -9 2>/dev/null || true
fi

if lsof -Pi :8015 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "⚠️  Port 8015 still in use, force killing..."
    lsof -ti:8015 | xargs kill -9 2>/dev/null || true
fi

echo "✅ All WebRTC-Enhanced ALFRED services stopped"
echo "📊 Ports 3001, 3002, and 8015 are now available"
