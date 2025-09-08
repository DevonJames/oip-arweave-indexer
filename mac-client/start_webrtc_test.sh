#!/bin/bash

# Start WebRTC Test Environment for ALFRED Voice Agent
# This script starts all necessary services for testing Phase 1 WebRTC implementation

set -e

echo "🚀 Starting ALFRED WebRTC Test Environment..."
echo "=================================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
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
    sleep 2
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
    local max_attempts=10
    local attempt=1
    
    echo -e "${BLUE}🔍 Waiting for $service_name to be ready...${NC}"
    
    while [ $attempt -le $max_attempts ]; do
        if curl -s "$url" > /dev/null 2>&1; then
            echo -e "${GREEN}✅ $service_name is healthy${NC}"
            return 0
        fi
        
        echo "   Attempt $attempt/$max_attempts..."
        sleep 1
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
check_port 8013 "STT Service" || ports_ok=false
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
else
    echo -e "${YELLOW}⚠️  Python virtual environment not found${NC}"
    echo "   Run: python3 -m venv mac-client-env && source mac-client-env/bin/activate && pip install -r requirements.txt"
fi

echo ""
echo -e "${BLUE}🚀 Starting services...${NC}"

# Start STT Service
if [ -f "mac_stt_service.py" ]; then
    start_service "python mac_stt_service.py" "STT Service" "logs/stt-service.log" "logs/stt-service.pid"
else
    echo -e "${YELLOW}⚠️  STT Service not found, skipping...${NC}"
fi

# Start Smart Turn Service
if [ -f "mac_smart_turn_service.py" ]; then
    start_service "python mac_smart_turn_service.py" "Smart Turn Service" "logs/smart-turn-service.log" "logs/smart-turn-service.pid"
else
    echo -e "${YELLOW}⚠️  Smart Turn Service not found, skipping...${NC}"
fi

# Start Enhanced Voice Interface Server
if [ -f "enhanced_voice_interface_server.js" ]; then
    start_service "node enhanced_voice_interface_server.js" "Enhanced Interface Server" "logs/interface-server.log" "logs/interface-server.pid"
else
    echo -e "${RED}❌ Enhanced Interface Server not found${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}🔍 Checking service health...${NC}"

# Wait for services to be ready
sleep 3

# Check STT service
if [ -f "logs/stt-service.pid" ]; then
    check_service_health "http://localhost:8013/health" "STT Service"
fi

# Check Smart Turn service
if [ -f "logs/smart-turn-service.pid" ]; then
    check_service_health "http://localhost:8014/health" "Smart Turn Service"
fi

# Check Interface server
check_service_health "http://localhost:3001/health" "Interface Server"

# Check WebRTC signaling
check_service_health "http://localhost:3001/api/webrtc/status" "WebRTC Signaling"

echo ""
echo -e "${GREEN}🎉 ALFRED WebRTC Test Environment Started Successfully!${NC}"
echo "=================================================="
echo ""
echo -e "${BLUE}📱 Available Interfaces:${NC}"
echo "   🌐 Main Interface:    http://localhost:3001"
echo "   🎤 WebRTC Test:       http://localhost:3001/webrtc"
echo "   🚀 Enhanced Interface: http://localhost:3001/enhanced"
echo ""
echo -e "${BLUE}🔧 API Endpoints:${NC}"
echo "   📊 Health Check:      http://localhost:3001/health"
echo "   📈 WebRTC Status:     http://localhost:3001/api/webrtc/status"
echo "   🎯 Service Status:    http://localhost:3001/api/status"
echo ""
echo -e "${BLUE}📝 Log Files:${NC}"
echo "   STT Service:          logs/stt-service.log"
echo "   Smart Turn Service:   logs/smart-turn-service.log"
echo "   Interface Server:     logs/interface-server.log"
echo ""
echo -e "${BLUE}🛑 To Stop Services:${NC}"
echo "   Run: ./stop_webrtc_test.sh"
echo "   Or:  make mac-stop"
echo ""
echo -e "${YELLOW}💡 Testing Instructions:${NC}"
echo "1. Open http://localhost:3001/webrtc in your browser"
echo "2. Click 'Connect' to establish WebRTC connection"
echo "3. Allow microphone access when prompted"
echo "4. Monitor audio levels and connection status"
echo "5. Click 'Test Audio' to send a test message"
echo ""
echo -e "${GREEN}🎤 Ready for WebRTC voice testing!${NC}"

# Optionally open the test interface
if command -v open &> /dev/null; then
    echo -e "${BLUE}🌐 Opening WebRTC test interface...${NC}"
    sleep 2
    open "http://localhost:3001/webrtc"
fi
