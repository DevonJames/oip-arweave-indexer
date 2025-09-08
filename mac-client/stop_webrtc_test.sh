#!/bin/bash

# Stop WebRTC Test Environment for ALFRED Voice Agent

set -e

echo "🛑 Stopping ALFRED WebRTC Test Environment..."
echo "=============================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to stop a service by PID file
stop_service() {
    local pid_file=$1
    local service_name=$2
    
    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file")
        
        if kill -0 $pid 2>/dev/null; then
            echo -e "${BLUE}🛑 Stopping $service_name (PID: $pid)...${NC}"
            kill $pid
            
            # Wait for process to stop
            local attempts=0
            while kill -0 $pid 2>/dev/null && [ $attempts -lt 10 ]; do
                sleep 1
                ((attempts++))
            done
            
            if kill -0 $pid 2>/dev/null; then
                echo -e "${YELLOW}⚠️  Force killing $service_name...${NC}"
                kill -9 $pid
            fi
            
            echo -e "${GREEN}✅ $service_name stopped${NC}"
        else
            echo -e "${YELLOW}⚠️  $service_name was not running${NC}"
        fi
        
        rm -f "$pid_file"
    else
        echo -e "${YELLOW}⚠️  $service_name PID file not found${NC}"
    fi
}

# Function to stop processes by name
stop_by_name() {
    local process_name=$1
    local service_name=$2
    
    local pids=$(pgrep -f "$process_name" 2>/dev/null || true)
    
    if [ -n "$pids" ]; then
        echo -e "${BLUE}🛑 Stopping $service_name processes...${NC}"
        echo $pids | xargs kill 2>/dev/null || true
        sleep 2
        
        # Force kill if still running
        local remaining_pids=$(pgrep -f "$process_name" 2>/dev/null || true)
        if [ -n "$remaining_pids" ]; then
            echo -e "${YELLOW}⚠️  Force killing $service_name...${NC}"
            echo $remaining_pids | xargs kill -9 2>/dev/null || true
        fi
        
        echo -e "${GREEN}✅ $service_name stopped${NC}"
    else
        echo -e "${YELLOW}⚠️  No $service_name processes found${NC}"
    fi
}

echo -e "${BLUE}🔍 Checking for running services...${NC}"

# Stop services by PID files
stop_service "logs/interface-server.pid" "Interface Server"
stop_service "logs/stt-service.pid" "STT Service"
stop_service "logs/smart-turn-service.pid" "Smart Turn Service"

# Stop any remaining processes by name (fallback)
echo ""
echo -e "${BLUE}🧹 Cleaning up any remaining processes...${NC}"

stop_by_name "enhanced_voice_interface_server.js" "Enhanced Interface Server"
stop_by_name "mac_stt_service.py" "STT Service"
stop_by_name "mac_smart_turn_service.py" "Smart Turn Service"

# Stop any Node.js processes on our ports
echo -e "${BLUE}🔌 Checking for processes on specific ports...${NC}"

for port in 3001 3002 8013 8014; do
    local pid=$(lsof -ti:$port 2>/dev/null || true)
    if [ -n "$pid" ]; then
        echo -e "${BLUE}🛑 Stopping process on port $port (PID: $pid)...${NC}"
        kill $pid 2>/dev/null || true
        sleep 1
        
        # Force kill if still there
        if kill -0 $pid 2>/dev/null; then
            kill -9 $pid 2>/dev/null || true
        fi
        echo -e "${GREEN}✅ Port $port freed${NC}"
    fi
done

# Clean up log files (optional)
echo ""
echo -e "${BLUE}🧹 Cleaning up...${NC}"

# Remove PID files
rm -f logs/*.pid

# Optionally truncate log files (uncomment if desired)
# echo -e "${BLUE}📝 Truncating log files...${NC}"
# > logs/stt-service.log 2>/dev/null || true
# > logs/smart-turn-service.log 2>/dev/null || true
# > logs/interface-server.log 2>/dev/null || true

echo ""
echo -e "${GREEN}🎉 ALFRED WebRTC Test Environment Stopped Successfully!${NC}"
echo "=============================================="
echo ""
echo -e "${BLUE}📊 Final Status:${NC}"

# Check if ports are now free
for port in 3001 3002 8013 8014; do
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo -e "   Port $port: ${RED}❌ Still in use${NC}"
    else
        echo -e "   Port $port: ${GREEN}✅ Free${NC}"
    fi
done

echo ""
echo -e "${BLUE}📝 Log Files Preserved:${NC}"
echo "   STT Service:          logs/stt-service.log"
echo "   Smart Turn Service:   logs/smart-turn-service.log"
echo "   Interface Server:     logs/interface-server.log"
echo ""
echo -e "${YELLOW}💡 To restart the test environment:${NC}"
echo "   Run: ./start_webrtc_test.sh"
echo ""
