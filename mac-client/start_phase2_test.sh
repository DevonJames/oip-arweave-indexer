#!/bin/bash

# Start Phase 2: Frame-Based Processing Test Environment for ALFRED Voice Agent

set -e

echo "🚀 Starting ALFRED Phase 2: Frame-Based Processing Test Environment..."
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

echo -e "${BLUE}🔍 Checking port availability...${NC}"

# Check required ports
ports_ok=true
check_port 8013 "Enhanced STT Service" || ports_ok=false
check_port 8014 "Smart Turn Service" || ports_ok=false
check_port 3001 "Interface Server" || ports_ok=false
check_port 3002 "WebRTC Signaling" || ports_ok=false

if [ "$ports_ok" = false ]; then
    echo -e "${RED}❌ Some required ports are in use. Please free them and try again.${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}📦 Installing/updating dependencies...${NC}"

# Install Node.js dependencies
if [ -f "package.json" ]; then
    npm install
    echo -e "${GREEN}✅ Node.js dependencies installed${NC}"
else
    echo -e "${RED}❌ package.json not found${NC}"
    exit 1
fi

# Check Python environment
echo -e "${BLUE}🐍 Checking Python environment...${NC}"
if [ -d "mac-client-env" ]; then
    source mac-client-env/bin/activate
    echo -e "${GREEN}✅ Python virtual environment activated${NC}"
    
    # Install additional dependencies for Phase 2
    echo -e "${BLUE}📦 Installing Phase 2 Python dependencies...${NC}"
    pip install -q fastapi uvicorn numpy torch mlx-whisper
    echo -e "${GREEN}✅ Phase 2 dependencies installed${NC}"
else
    echo -e "${YELLOW}⚠️  Python virtual environment not found${NC}"
    echo "   Run: python3 -m venv mac-client-env && source mac-client-env/bin/activate && pip install -r requirements.txt"
    exit 1
fi

echo ""
echo -e "${PURPLE}🎯 Phase 2 Features:${NC}"
echo "   📊 20ms frame-based audio processing"
echo "   🔄 Real-time STT with partial results"
echo "   🎤 Enhanced VAD with Silero model"
echo "   📈 Frame-level metrics and monitoring"
echo ""

echo -e "${BLUE}🚀 Starting Phase 2 services...${NC}"

# Start Enhanced STT Service (Phase 2)
if [ -f "enhanced_stt_service.py" ]; then
    start_service "python enhanced_stt_service.py --port 8013" "Enhanced STT Service" "logs/enhanced-stt-service.log" "logs/enhanced-stt-service.pid"
else
    echo -e "${YELLOW}⚠️  Enhanced STT Service not found, falling back to regular STT...${NC}"
    if [ -f "mac_stt_service.py" ]; then
        start_service "python mac_stt_service.py" "STT Service" "logs/stt-service.log" "logs/stt-service.pid"
    else
        echo -e "${RED}❌ No STT service found${NC}"
        exit 1
    fi
fi

# Start Smart Turn Service
if [ -f "mac_smart_turn_service.py" ]; then
    start_service "python mac_smart_turn_service.py" "Smart Turn Service" "logs/smart-turn-service.log" "logs/smart-turn-service.pid"
else
    echo -e "${YELLOW}⚠️  Smart Turn Service not found, skipping...${NC}"
fi

# Start Enhanced Voice Interface Server with Frame Processing
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

# Check Enhanced STT service
check_service_health "http://localhost:8013/health" "STT Service"

# Check Smart Turn service
if [ -f "logs/smart-turn-service.pid" ]; then
    check_service_health "http://localhost:8014/health" "Smart Turn Service"
fi

# Check Interface server
check_service_health "http://localhost:3001/health" "Interface Server"

# Check WebRTC signaling
check_service_health "http://localhost:3001/api/webrtc/status" "WebRTC Signaling"

# Check Enhanced STT metrics
echo -e "${BLUE}📊 Checking Phase 2 specific endpoints...${NC}"
if curl -s "http://localhost:8013/metrics" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Enhanced STT metrics endpoint available${NC}"
else
    echo -e "${YELLOW}⚠️  Enhanced STT metrics endpoint not responding${NC}"
fi

echo ""
echo -e "${GREEN}🎉 ALFRED Phase 2: Frame-Based Processing Environment Started!${NC}"
echo "=================================================================="
echo ""
echo -e "${PURPLE}🎯 Phase 2 Features Active:${NC}"
echo "   📊 20ms Audio Frame Processing"
echo "   🔄 Streaming STT with Partial Results"
echo "   🎤 Enhanced VAD with Speech Detection"
echo "   📈 Real-time Frame Metrics"
echo ""
echo -e "${BLUE}📱 Available Interfaces:${NC}"
echo "   🌐 Main Interface:     http://localhost:3001"
echo "   🎤 WebRTC Test:        http://localhost:3001/webrtc"
echo "   🚀 Enhanced Interface: http://localhost:3001/enhanced"
echo ""
echo -e "${BLUE}🔧 API Endpoints:${NC}"
echo "   📊 Health Check:       http://localhost:3001/health"
echo "   📈 WebRTC Status:      http://localhost:3001/api/webrtc/status"
echo "   🎯 Service Status:     http://localhost:3001/api/status"
echo "   📊 STT Metrics:        http://localhost:8013/metrics"
echo ""
echo -e "${BLUE}📝 Log Files:${NC}"
echo "   Enhanced STT Service:  logs/enhanced-stt-service.log"
echo "   Smart Turn Service:    logs/smart-turn-service.log"
echo "   Interface Server:      logs/interface-server.log"
echo ""
echo -e "${BLUE}🛑 To Stop Services:${NC}"
echo "   Run: ./stop_webrtc_test.sh"
echo ""
echo -e "${PURPLE}💡 Phase 2 Testing Instructions:${NC}"
echo "1. Open http://localhost:3001/webrtc in your browser"
echo "2. Click 'Connect' to establish WebRTC connection"
echo "3. Allow microphone access when prompted"
echo "4. Start speaking and watch for:"
echo "   • Real-time speech detection indicator"
echo "   • Frame processing metrics"
echo "   • Partial transcription results"
echo "   • Frame-level audio analysis"
echo "5. Monitor the enhanced metrics:"
echo "   • Frames processed per second"
echo "   • Speech frame detection"
echo "   • Partial result generation"
echo "   • Processing latency"
echo ""
echo -e "${GREEN}🎤 Ready for Phase 2: Frame-Based Processing testing!${NC}"

# Optionally open the test interface
if command -v open &> /dev/null; then
    echo -e "${BLUE}🌐 Opening WebRTC test interface in 3 seconds...${NC}"
    sleep 3
    open "http://localhost:3001/webrtc"
fi
