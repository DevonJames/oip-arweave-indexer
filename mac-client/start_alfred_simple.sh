#!/bin/bash

# Start ALFRED Voice Agent - Simplified Version (No problematic dependencies)

set -e

echo "🚀 Starting ALFRED Voice Agent (Simplified)..."
echo "=============================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
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

# Function to start a service in the background
start_service() {
    local command=$1
    local service_name=$2
    local log_file=$3
    local pid_file=$4
    
    echo -e "${BLUE}📡 Starting $service_name...${NC}"
    
    # Start the service and capture PID
    $command > "$log_file" 2>&1 &
    local pid=$!
    echo $pid > "$pid_file"
    
    # Wait a moment and check if it's still running
    sleep 3
    if kill -0 $pid 2>/dev/null; then
        echo -e "${GREEN}✅ $service_name started successfully (PID: $pid)${NC}"
        echo "   Log: $log_file"
        return 0
    else
        echo -e "${RED}❌ $service_name failed to start${NC}"
        echo "   Check log: $log_file"
        return 1
    fi
}

# Function to check service health
check_service_health() {
    local url=$1
    local service_name=$2
    local max_attempts=15
    local attempt=1
    
    echo -e "${BLUE}🔍 Waiting for $service_name to be ready...${NC}"
    
    while [ $attempt -le $max_attempts ]; do
        if curl -s "$url" > /dev/null 2>&1; then
            echo -e "${GREEN}✅ $service_name is healthy${NC}"
            return 0
        fi
        
        echo "   Attempt $attempt/$max_attempts..."
        sleep 2
        ((attempt++))
    done
    
    echo -e "${RED}❌ $service_name failed to become healthy${NC}"
    return 1
}

# Create logs directory
mkdir -p logs

echo -e "${BOLD}${PURPLE}🎯 ALFRED Voice Agent Features:${NC}"
echo "   🎨 Beautiful, intuitive user interface"
echo "   📊 Real-time audio visualization"
echo "   💬 Streaming conversation interface"
echo "   🔄 Automatic error recovery"
echo "   📱 Responsive design"
echo "   🎤 Enhanced voice processing"
echo ""

echo -e "${BLUE}🔍 Checking port availability...${NC}"

# Check required ports
ports_ok=true
check_port 8015 "Unified Voice Processor" || ports_ok=false
check_port 3001 "Enhanced Interface Server" || ports_ok=false
check_port 3002 "WebRTC Signaling" || ports_ok=false

if [ "$ports_ok" = false ]; then
    echo -e "${RED}❌ Required ports are in use. Please free them and try again.${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}📦 Checking dependencies...${NC}"

# Check if npm install was successful
if [ -d "node_modules" ]; then
    echo -e "${GREEN}✅ Node.js dependencies are installed${NC}"
else
    echo -e "${BLUE}Installing Node.js dependencies...${NC}"
    npm install
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Node.js dependencies installed successfully${NC}"
    else
        echo -e "${RED}❌ Failed to install Node.js dependencies${NC}"
        exit 1
    fi
fi

# Check Python environment
echo -e "${BLUE}🐍 Checking Python environment...${NC}"
if [ -d "mac-client-env" ]; then
    source mac-client-env/bin/activate
    echo -e "${GREEN}✅ Python virtual environment activated${NC}"
    
    # Install Python dependencies
    echo -e "${BLUE}📦 Installing Python dependencies...${NC}"
    pip install -q fastapi uvicorn numpy torch mlx-whisper psutil 2>/dev/null || echo -e "${YELLOW}⚠️ Some Python packages may need manual installation${NC}"
    echo -e "${GREEN}✅ Python dependencies checked${NC}"
else
    echo -e "${YELLOW}⚠️  Python virtual environment not found${NC}"
    echo "   Run: python3 -m venv mac-client-env && source mac-client-env/bin/activate"
    echo "   Then: pip install fastapi uvicorn numpy torch mlx-whisper psutil"
    exit 1
fi

echo ""
echo -e "${PURPLE}🚀 Starting ALFRED services...${NC}"

# Start Unified Voice Processor (if available)
if [ -f "unified_voice_processor.py" ]; then
    start_service "python unified_voice_processor.py --port 8015" "Unified Voice Processor" "logs/unified-voice-processor.log" "logs/unified-voice-processor.pid"
elif [ -f "enhanced_stt_service.py" ]; then
    echo -e "${YELLOW}⚠️  Unified processor not found, using enhanced STT service${NC}"
    start_service "python enhanced_stt_service.py --port 8015" "Enhanced STT Service" "logs/enhanced-stt-service.log" "logs/enhanced-stt-service.pid"
else
    echo -e "${RED}❌ No voice processing service found${NC}"
    exit 1
fi

# Start Enhanced Interface Server
if [ -f "enhanced_voice_interface_server.js" ]; then
    start_service "node enhanced_voice_interface_server.js" "Enhanced Interface Server" "logs/interface-server.log" "logs/interface-server.pid"
else
    echo -e "${RED}❌ Enhanced Interface Server not found${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}🔍 Checking service health...${NC}"

# Wait for services to be ready
sleep 5

# Check voice processor
check_service_health "http://localhost:8015/health" "Voice Processor"

# Check interface server
check_service_health "http://localhost:3001/health" "Interface Server"

echo ""
echo -e "${BOLD}${GREEN}🎉 ALFRED Voice Agent Started Successfully!${NC}"
echo "=============================================="
echo ""
echo -e "${PURPLE}🎯 Available Interfaces:${NC}"
echo "   🚀 ALFRED Voice Interface:  http://localhost:3001/enhanced"
echo "   📊 Pipeline Monitor:        http://localhost:3001/monitor"
echo "   🎤 WebRTC Test:             http://localhost:3001/webrtc"
echo "   🔧 System Health:           http://localhost:3001/health"
echo ""
echo -e "${BLUE}📊 API Endpoints:${NC}"
echo "   📊 Voice Processor Health:  http://localhost:8015/health"
echo "   📈 Pipeline Status:         http://localhost:8015/pipeline/status"
echo "   🎯 Processing Metrics:      http://localhost:8015/metrics"
echo ""
echo -e "${BLUE}📝 Log Files:${NC}"
echo "   Voice Processor:            logs/unified-voice-processor.log"
echo "   Interface Server:           logs/interface-server.log"
echo ""
echo -e "${BLUE}🛑 To Stop Services:${NC}"
echo "   Run: ./stop_alfred_simple.sh"
echo ""
echo -e "${BOLD}${CYAN}💡 How to Use ALFRED:${NC}"
echo ""
echo -e "${CYAN}🎤 Voice Interaction:${NC}"
echo "1. Open http://localhost:3001/enhanced"
echo "2. Click 'Connect to ALFRED'"
echo "3. Allow microphone access when prompted"
echo "4. Click the microphone button or press spacebar to talk"
echo "5. Watch real-time transcription and audio visualization"
echo "6. ALFRED responds with natural typewriter effect"
echo "7. Interrupt anytime by speaking during ALFRED's response"
echo ""
echo -e "${CYAN}📊 Features to Experience:${NC}"
echo "• Real-time audio waveform visualization"
echo "• Streaming transcription as you speak"
echo "• Natural conversation with interruption capability"
echo "• Automatic error recovery and fallbacks"
echo "• Performance monitoring and optimization"
echo ""
echo -e "${GREEN}🎤 ALFRED Voice Agent is Ready!${NC}"

# Optionally open the interface
if command -v open &> /dev/null; then
    echo -e "${BLUE}🌐 Opening ALFRED Voice Interface in 3 seconds...${NC}"
    sleep 3
    open "http://localhost:3001/enhanced"
fi
