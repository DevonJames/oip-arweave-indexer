#!/bin/bash

# Stop ALFRED Voice Agent - Simplified Version

set -e

echo "🛑 Stopping ALFRED Voice Agent..."
echo "================================="

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
            
            # Wait for process to stop gracefully
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

echo -e "${BLUE}🔍 Stopping ALFRED services...${NC}"

# Stop main services
stop_service "logs/unified-voice-processor.pid" "Unified Voice Processor"
stop_service "logs/enhanced-stt-service.pid" "Enhanced STT Service"
stop_service "logs/interface-server.pid" "Enhanced Interface Server"

# Stop any remaining processes on our ports
echo -e "${BLUE}🔌 Freeing ports...${NC}"

for port in 8015 3001 3002; do
    pid=$(lsof -ti:$port 2>/dev/null || true)
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

# Clean up
echo -e "${BLUE}🧹 Cleaning up...${NC}"
rm -f logs/*.pid

echo ""
echo -e "${GREEN}🎉 ALFRED Voice Agent Stopped Successfully!${NC}"
echo "=========================================="
echo ""
echo -e "${BLUE}📊 Final Status:${NC}"

# Check if ports are now free
for port in 8015 3001 3002; do
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo -e "   Port $port: ${RED}❌ Still in use${NC}"
    else
        echo -e "   Port $port: ${GREEN}✅ Free${NC}"
    fi
done

echo ""
echo -e "${BLUE}📝 Log Files Preserved:${NC}"
echo "   Voice Processor:    logs/unified-voice-processor.log"
echo "   Interface Server:   logs/interface-server.log"
echo ""
echo -e "${YELLOW}💡 To restart ALFRED:${NC}"
echo "   Run: ./start_alfred_simple.sh"
echo ""
