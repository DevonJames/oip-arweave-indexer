#!/bin/bash

# Start Unified Voice Processor for WebRTC
echo "🚀 Starting Unified Voice Processor for WebRTC..."

# Check if Python virtual environment exists
if [ ! -d "mac-client-env" ]; then
    echo "❌ Python virtual environment not found"
    echo "   Please create it first:"
    echo "   python -m venv mac-client-env"
    echo "   source mac-client-env/bin/activate"
    echo "   pip install -r requirements.txt"
    exit 1
fi

# Activate virtual environment
echo "🐍 Activating Python virtual environment..."
source mac-client-env/bin/activate

# Check if port is available
if lsof -Pi :8015 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "❌ Port 8015 already in use"
    echo "   Killing existing process..."
    lsof -ti:8015 | xargs kill -9 2>/dev/null || true
    sleep 2
fi

echo "✅ Port 8015 is available"

# Start unified voice processor
echo "📡 Starting Unified Voice Processor on port 8015..."
python unified_voice_processor.py &
PROCESSOR_PID=$!

# Wait for startup (longer wait for model loading)
echo "⏳ Waiting for models to load (this takes ~10 seconds)..."
sleep 10

# Check if it's running (try multiple times)
for i in {1..5}; do
    if curl -s http://localhost:8015/health >/dev/null 2>&1; then
        echo "✅ Unified Voice Processor is healthy"
        echo "🎤 Ready for WebRTC audio processing!"
        echo ""
        echo "Now you can run:"
        echo "   ./start_webrtc_interface.sh"
        echo ""
        echo "Press Ctrl+C to stop the processor"
        
        # Save PID for cleanup
        echo "$PROCESSOR_PID" > /tmp/unified_voice_processor.pid
        
        # Keep script running
        wait $PROCESSOR_PID
        exit 0
    else
        echo "⏳ Attempt $i/5: Still loading models..."
        sleep 2
    fi
done

echo "❌ Unified Voice Processor failed to start after 20 seconds"
kill $PROCESSOR_PID 2>/dev/null || true
exit 1
