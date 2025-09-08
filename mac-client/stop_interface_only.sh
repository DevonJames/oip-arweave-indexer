#!/bin/bash

# Stop ALFRED Voice Interface

set -e

echo "🛑 Stopping ALFRED Voice Interface..."
echo "====================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Stop interface server
if [ -f "logs/interface-server.pid" ]; then
    pid=$(cat "logs/interface-server.pid")
    
    if kill -0 $pid 2>/dev/null; then
        echo -e "${BLUE}🛑 Stopping Interface Server (PID: $pid)...${NC}"
        kill $pid
        
        # Wait for graceful shutdown
        sleep 2
        if kill -0 $pid 2>/dev/null; then
            echo -e "${YELLOW}⚠️  Force killing Interface Server...${NC}"
            kill -9 $pid
        fi
        
        echo -e "${GREEN}✅ Interface Server stopped${NC}"
    else
        echo -e "${YELLOW}⚠️  Interface Server was not running${NC}"
    fi
    
    rm -f "logs/interface-server.pid"
else
    echo -e "${YELLOW}⚠️  Interface Server PID file not found${NC}"
fi

# Free port 3001 if anything is still using it
pid=$(lsof -ti:3001 2>/dev/null || true)
if [ -n "$pid" ]; then
    echo -e "${BLUE}🛑 Freeing port 3001 (PID: $pid)...${NC}"
    kill $pid 2>/dev/null || true
    sleep 1
    if kill -0 $pid 2>/dev/null; then
        kill -9 $pid 2>/dev/null || true
    fi
    echo -e "${GREEN}✅ Port 3001 freed${NC}"
fi

echo ""
echo -e "${GREEN}🎉 ALFRED Voice Interface Stopped!${NC}"
echo "=================================="
echo ""
echo -e "${BLUE}📊 Status:${NC}"
if lsof -Pi :3001 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "   Port 3001: ${RED}❌ Still in use${NC}"
else
    echo -e "   Port 3001: ${GREEN}✅ Free${NC}"
fi

echo ""
echo -e "${BLUE}📝 Log File Preserved:${NC}"
echo "   Interface Server: logs/interface-server.log"
echo ""
echo -e "${YELLOW}💡 To restart:${NC}"
echo "   Run: ./start_interface_only.sh"
echo ""
