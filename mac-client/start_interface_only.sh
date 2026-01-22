#!/bin/bash

# Start ALFRED Voice Interface Only (connects to existing backend)
# This script only starts the interface server - no complex services needed

set -e

echo "🚀 Starting ALFRED Voice Interface (connects to existing backend)..."
echo "=================================================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

# Function to check if a port is in use
check_port() {
    local port=$1
    local service=$2
    
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo -e "${YELLOW}⚠️  Port $port ($service) is already in use${NC}"
        echo "   Use 'lsof -ti:$port | xargs kill' to free it if needed"
        return 1
    else
        echo -e "${GREEN}✅ Port $port ($service) is available${NC}"
        return 0
    fi
}

echo -e "${PURPLE}🎯 ALFRED Hybrid Voice Interface${NC}"
echo "Features:"
echo "   🎨 Advanced UI with audio visualization"
echo "   🎤 Real audio capture (MediaRecorder API)"
echo "   🔊 Echo cancellation and noise suppression"
echo "   📡 Direct integration with your existing backend"
echo "   ⚡ No complex WebRTC signaling needed"
echo "   🛡️ Uses your RTX 4090 backend for LLM/RAG/TTS"
echo ""

echo -e "${BLUE}🔍 Checking port availability...${NC}"

# Only need port 3001 for interface
if ! check_port 3001 "Interface Server"; then
    echo -e "${RED}❌ Port 3001 is in use. Please free it first.${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}📦 Checking dependencies...${NC}"

# Check Node.js dependencies
if [ -d "node_modules" ]; then
    echo -e "${GREEN}✅ Node.js dependencies are ready${NC}"
else
    echo -e "${BLUE}Installing Node.js dependencies...${NC}"
    npm install
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Node.js dependencies installed${NC}"
    else
        echo -e "${RED}❌ Failed to install dependencies${NC}"
        exit 1
    fi
fi

echo ""
echo -e "${PURPLE}🚀 Starting LOCAL speech processing services...${NC}"

# Check Python environment
echo -e "${BLUE}🐍 Checking Python environment...${NC}"
if [ -d "mac-client-env" ]; then
    source mac-client-env/bin/activate
    echo -e "${GREEN}✅ Python virtual environment activated${NC}"
else
    echo -e "${RED}❌ Python virtual environment not found${NC}"
    echo "   Run: python3 -m venv mac-client-env && source mac-client-env/bin/activate"
    exit 1
fi

# Start LOCAL Unified Voice Processor (does STT locally on Mac)
if [ -f "unified_voice_processor.py" ]; then
    echo -e "${BLUE}📡 Starting LOCAL Unified Voice Processor...${NC}"
    
    python unified_voice_processor.py --port 8015 > logs/unified-voice-processor.log 2>&1 &
    pid=$!
    echo $pid > logs/unified-voice-processor.pid
    
    sleep 4
    if kill -0 $pid 2>/dev/null; then
        echo -e "${GREEN}✅ LOCAL Voice Processor started (PID: $pid)${NC}"
        echo "   Log: logs/unified-voice-processor.log"
    else
        echo -e "${RED}❌ LOCAL Voice Processor failed to start${NC}"
        echo "   Check log: logs/unified-voice-processor.log"
        exit 1
    fi
else
    echo -e "${RED}❌ Unified Voice Processor not found${NC}"
    exit 1
fi

# Start interface server
if [ -f "enhanced_voice_interface_server.js" ]; then
    echo -e "${BLUE}📡 Starting Interface Server...${NC}"
    
    node enhanced_voice_interface_server.js > logs/interface-server.log 2>&1 &
    pid=$!
    echo $pid > logs/interface-server.pid
    
    # Wait and check if it started
    sleep 3
    if kill -0 $pid 2>/dev/null; then
        echo -e "${GREEN}✅ Interface Server started (PID: $pid)${NC}"
        echo "   Log: logs/interface-server.log"
    else
        echo -e "${RED}❌ Interface Server failed to start${NC}"
        echo "   Check log: logs/interface-server.log"
        exit 1
    fi
else
    echo -e "${RED}❌ Enhanced Interface Server not found${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}🔍 Checking interface health...${NC}"

# Wait for interface to be ready
sleep 3

# Check LOCAL voice processor health
if curl -s "http://localhost:8015/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ LOCAL Voice Processor is healthy${NC}"
else
    echo -e "${RED}❌ LOCAL Voice Processor not responding${NC}"
    exit 1
fi

# Check interface server health
if curl -s "http://localhost:3001/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Interface Server is healthy${NC}"
else
    echo -e "${YELLOW}⚠️  Interface Server not responding yet (may need more time)${NC}"
fi

# Check REMOTE backend health
echo -e "${BLUE}🔍 Testing REMOTE backend connection...${NC}"
if curl -s "https://api.oip.onl/api/voice/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ REMOTE backend is healthy${NC}"
else
    echo -e "${YELLOW}⚠️  REMOTE backend not responding (may be normal if not running)${NC}"
fi

echo ""
echo -e "${GREEN}🎉 ALFRED Voice Interface Ready!${NC}"
echo "=================================="
echo ""
echo -e "${PURPLE}🎯 Interface Features:${NC}"
echo "   🎨 Beautiful, responsive voice interface"
echo "   🎤 Real audio capture with advanced settings"
echo "   🔊 Echo cancellation prevents self-interruption"
echo "   📊 Real-time audio visualization"
echo "   📡 Direct connection to your existing ALFRED backend"
echo "   ⚡ No complex local services required"
echo ""
echo -e "${BLUE}📱 Available Interfaces:${NC}"
echo "   🚀 Alfred Speaks:           http://localhost:3001/alfred-speaks.html"
echo "   🎙️  Full Notes App:         http://localhost:3001/alfreds-notes-mac.html"
echo "   📊 System Health:           http://localhost:3001/health"
echo ""
echo -e "${BLUE}🔧 How It Works (Correct Architecture):${NC}"
echo "   1. Interface captures your REAL voice with advanced audio settings"
echo "   2. Sends audio to LOCAL Mac services for speech processing"
echo "   3. LOCAL Mac: VAD + STT (MLX Whisper) + Smart Turn → produces TEXT"
echo "   4. Sends TEXT to REMOTE RTX 4090 for LLM/RAG processing"
echo "   5. REMOTE RTX 4090: Generates response TEXT"
echo "   6. REMOTE RTX 4090: Converts response to TTS audio"
echo "   7. LOCAL Mac: Plays TTS with interruption handling"
echo ""
echo -e "${BLUE}🛑 To Stop:${NC}"
echo "   Run: ./stop_interface_only.sh"
echo ""
echo -e "${PURPLE}💡 Usage Instructions:${NC}"
echo "1. Open http://localhost:3001/enhanced"
echo "2. Click 'Test Backend' to verify your existing ALFRED is running"
echo "3. Click 'Connect to ALFRED' and allow microphone access"
echo "4. Click the microphone button or press spacebar"
echo "5. Speak normally - it will capture and process YOUR REAL VOICE"
echo "6. Watch for real transcription and ALFRED's response"
echo ""
echo -e "${GREEN}🎤 Ready to test with your REAL voice!${NC}"

# Optionally open the interface
if command -v open &> /dev/null; then
    echo -e "${BLUE}🌐 Opening ALFRED's Notes Interface...${NC}"
    sleep 2
    open "http://localhost:3001/alfreds-notes-mac.html"
fi
