#!/bin/bash

###############################################################################
# OIP Arweave Indexer Startup Script with Memory Optimizations
#
# This script starts the application with appropriate memory settings
# to prevent out-of-memory crashes.
#
# Usage:
#   ./start-with-memory-opts.sh [heap_size_mb]
#
# Examples:
#   ./start-with-memory-opts.sh          # Use default (8GB)
#   ./start-with-memory-opts.sh 4096     # Use 4GB
#   ./start-with-memory-opts.sh 16384    # Use 16GB
###############################################################################

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default heap size (8GB)
HEAP_SIZE=${1:-8192}

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}   OIP Arweave Indexer - Starting with Memory Optimizations${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

# Check if node is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Error: Node.js is not installed${NC}"
    exit 1
fi

NODE_VERSION=$(node --version)
echo -e "${GREEN}✓${NC} Node.js version: ${NODE_VERSION}"

# Calculate heap size
HEAP_SIZE_GB=$(echo "scale=2; $HEAP_SIZE / 1024" | bc)
echo -e "${GREEN}✓${NC} Heap size set to: ${HEAP_SIZE}MB (${HEAP_SIZE_GB}GB)"

# Check available system memory
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    TOTAL_MEM=$(free -m | awk '/^Mem:/{print $2}')
    echo -e "${GREEN}✓${NC} System memory: ${TOTAL_MEM}MB"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    TOTAL_MEM=$(sysctl -n hw.memsize | awk '{print int($1/1024/1024)}')
    echo -e "${GREEN}✓${NC} System memory: ${TOTAL_MEM}MB"
fi

# Warn if heap size is too large
if [ ! -z "$TOTAL_MEM" ] && [ $HEAP_SIZE -gt $((TOTAL_MEM * 3 / 4)) ]; then
    echo -e "${YELLOW}⚠️  Warning: Heap size is more than 75% of system memory${NC}"
    echo -e "${YELLOW}   This may cause system instability${NC}"
fi

# Set Node.js options
export NODE_OPTIONS="--max-old-space-size=${HEAP_SIZE}"

echo ""
echo -e "${BLUE}Memory Management Settings:${NC}"
echo -e "  Max Old Space:     ${HEAP_SIZE}MB"
echo -e "  GC Exposed:        Yes"
echo -e "  Cache Max Age:     ${GUN_CACHE_MAX_AGE:-3600000}ms"
echo -e "  Sync Interval:     ${GUN_SYNC_INTERVAL:-30000}ms"

# Parse command line arguments for application
APP_ARGS=""
if [[ "$*" == *"--keepDBUpToDate"* ]]; then
    APP_ARGS="--keepDBUpToDate"
    echo -e "${GREEN}✓${NC} Keep DB up to date: Enabled"
fi

echo ""
echo -e "${BLUE}Starting application...${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""

# Start the application
if [ ! -z "$APP_ARGS" ]; then
    node index.js $APP_ARGS
else
    node index.js
fi

# Check exit code
EXIT_CODE=$?
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✓ Application exited cleanly${NC}"
else
    echo -e "${RED}❌ Application exited with code: ${EXIT_CODE}${NC}"
    
    # Check if it was OOM
    if [ $EXIT_CODE -eq 137 ]; then
        echo -e "${RED}   This typically indicates an out-of-memory error${NC}"
        echo -e "${YELLOW}   Suggestions:${NC}"
        echo -e "${YELLOW}   1. Increase heap size: $0 $((HEAP_SIZE * 2))${NC}"
        echo -e "${YELLOW}   2. Check memory usage: node scripts/diagnose-memory.js${NC}"
        echo -e "${YELLOW}   3. Review logs for memory leaks${NC}"
    fi
fi
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

exit $EXIT_CODE

