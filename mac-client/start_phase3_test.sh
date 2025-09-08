#!/bin/bash

# Start Phase 3: Real-Time Interruption System Test Environment for ALFRED Voice Agent

set -e

echo "🚀 Starting ALFRED Phase 3: Real-Time Interruption System Test Environment..."
echo "=========================================================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
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

echo -e "${CYAN}🎯 Phase 3: Real-Time Interruption System${NC}"
echo "Features:"
echo "   🚨 Smart-Turn v2 Equivalent Interruption Detection"
echo "   ⚡ <200ms Interruption Response Time"
echo "   🎵 Audio Crossfading for Smooth Transitions"
echo "   🔄 Conversation Flow Management"
echo "   🛡️ Self-Interruption Prevention"
echo ""

echo -e "${BLUE}🔍 Checking port availability...${NC}"

# Check required ports
ports_ok=true
check_port 8013 "Enhanced STT Service" || ports_ok=false
check_port 8014 "Enhanced Smart Turn Service" || ports_ok=false
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
    
    # Install additional dependencies for Phase 3
    echo -e "${BLUE}📦 Installing Phase 3 Python dependencies...${NC}"
    pip install -q fastapi uvicorn numpy torch mlx-whisper
    echo -e "${GREEN}✅ Phase 3 dependencies installed${NC}"
else
    echo -e "${YELLOW}⚠️  Python virtual environment not found${NC}"
    echo "   Run: python3 -m venv mac-client-env && source mac-client-env/bin/activate && pip install -r requirements.txt"
    exit 1
fi

echo ""
echo -e "${PURPLE}🎯 Phase 3 Features:${NC}"
echo "   🚨 Real-time interruption detection"
echo "   ⚡ <200ms interruption response time"
echo "   🎵 Audio crossfading for smooth transitions"
echo "   🔄 Turn-taking state machine"
echo "   🛡️ Echo cancellation prevents self-interruption"
echo "   📊 Interruption metrics and success tracking"
echo ""

echo -e "${BLUE}🚀 Starting Phase 3 services...${NC}"

# Start Enhanced STT Service (Phase 2+)
if [ -f "enhanced_stt_service.py" ]; then
    start_service "python enhanced_stt_service.py --port 8013" "Enhanced STT Service" "logs/enhanced-stt-service.log" "logs/enhanced-stt-service.pid"
else
    echo -e "${RED}❌ Enhanced STT Service not found${NC}"
    exit 1
fi

# Start Enhanced Smart Turn Service (Phase 3)
if [ -f "enhanced_smart_turn_service.py" ]; then
    start_service "python enhanced_smart_turn_service.py --port 8014" "Enhanced Smart Turn Service" "logs/enhanced-smart-turn-service.log" "logs/enhanced-smart-turn-service.pid"
else
    echo -e "${YELLOW}⚠️  Enhanced Smart Turn Service not found, falling back to regular Smart Turn...${NC}"
    if [ -f "mac_smart_turn_service.py" ]; then
        start_service "python mac_smart_turn_service.py" "Smart Turn Service" "logs/smart-turn-service.log" "logs/smart-turn-service.pid"
    else
        echo -e "${RED}❌ No Smart Turn service found${NC}"
        exit 1
    fi
fi

# Start Enhanced Voice Interface Server with Phase 3 Support
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
check_service_health "http://localhost:8013/health" "Enhanced STT Service"

# Check Enhanced Smart Turn service
check_service_health "http://localhost:8014/health" "Enhanced Smart Turn Service"

# Check Interface server
check_service_health "http://localhost:3001/health" "Interface Server"

# Check WebRTC signaling
check_service_health "http://localhost:3001/api/webrtc/status" "WebRTC Signaling"

# Check Phase 3 specific endpoints
echo -e "${BLUE}📊 Checking Phase 3 specific endpoints...${NC}"

# Check Enhanced Smart Turn metrics
if curl -s "http://localhost:8014/metrics" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Enhanced Smart Turn metrics endpoint available${NC}"
else
    echo -e "${YELLOW}⚠️  Enhanced Smart Turn metrics endpoint not responding${NC}"
fi

# Check interruption test interface
if curl -s "http://localhost:3001/interruption" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Interruption test interface available${NC}"
else
    echo -e "${YELLOW}⚠️  Interruption test interface not responding${NC}"
fi

echo ""
echo -e "${GREEN}🎉 ALFRED Phase 3: Real-Time Interruption System Started!${NC}"
echo "=========================================================================="
echo ""
echo -e "${PURPLE}🎯 Phase 3 Features Active:${NC}"
echo "   🚨 Real-Time Interruption Detection"
echo "   ⚡ <200ms Interruption Response Time"
echo "   🎵 Audio Crossfading for Smooth Transitions"
echo "   🔄 Turn-Taking State Machine"
echo "   🛡️ Self-Interruption Prevention"
echo "   📊 Conversation Flow Management"
echo ""
echo -e "${BLUE}📱 Available Interfaces:${NC}"
echo "   🌐 Main Interface:        http://localhost:3001"
echo "   🎤 WebRTC Test:           http://localhost:3001/webrtc"
echo "   🚨 Interruption Test:     http://localhost:3001/interruption"
echo "   🚀 Enhanced Interface:    http://localhost:3001/enhanced"
echo ""
echo -e "${BLUE}🔧 API Endpoints:${NC}"
echo "   📊 Health Check:          http://localhost:3001/health"
echo "   📈 WebRTC Status:         http://localhost:3001/api/webrtc/status"
echo "   🎯 Service Status:        http://localhost:3001/api/status"
echo "   📊 STT Metrics:           http://localhost:8013/metrics"
echo "   🚨 Smart Turn Metrics:    http://localhost:8014/metrics"
echo ""
echo -e "${BLUE}📝 Log Files:${NC}"
echo "   Enhanced STT Service:     logs/enhanced-stt-service.log"
echo "   Enhanced Smart Turn:      logs/enhanced-smart-turn-service.log"
echo "   Interface Server:         logs/interface-server.log"
echo ""
echo -e "${BLUE}🛑 To Stop Services:${NC}"
echo "   Run: ./stop_webrtc_test.sh"
echo ""
echo -e "${PURPLE}💡 Phase 3 Testing Instructions:${NC}"
echo ""
echo -e "${CYAN}🧪 Interruption Testing:${NC}"
echo "1. Open http://localhost:3001/interruption in your browser"
echo "2. Click 'Connect' and allow microphone access"
echo "3. Click 'Simulate Agent Speech' to start AI speaking"
echo "4. Try interrupting by speaking during AI speech"
echo "5. Monitor interruption metrics and response times"
echo ""
echo -e "${CYAN}🎯 Test Scenarios:${NC}"
echo "• Basic Interruption: Interrupt after 1+ seconds of agent speech"
echo "• Temporal Threshold: Try interrupting in first 500ms (should fail)"
echo "• Keyword Interruption: Say 'wait', 'stop', 'excuse me' during speech"
echo "• False Positive Test: Make noise/say 'um' (should not interrupt)"
echo ""
echo -e "${CYAN}📊 Metrics to Monitor:${NC}"
echo "• Interruption Latency: Should be <200ms"
echo "• Success Rate: Should be >90% for valid interruptions"
echo "• False Positives: Should be <10% for background noise"
echo "• Audio Quality: No artifacts during crossfading"
echo ""
echo -e "${GREEN}🎤 Ready for Phase 3: Real-Time Interruption testing!${NC}"

# Optionally open the interruption test interface
if command -v open &> /dev/null; then
    echo -e "${BLUE}🌐 Opening interruption test interface in 3 seconds...${NC}"
    sleep 3
    open "http://localhost:3001/interruption"
fi
