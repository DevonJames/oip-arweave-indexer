#!/bin/bash

###############################################################################
# Memory Configuration Script for OIP Arweave Indexer
#
# Sets NODE_OPTIONS in .env file for persistent memory allocation
# After running this, use your normal 'make' commands to start services
#
# Usage:
#   ./set-memory.sh [heap_size_mb]
#   ./set-memory.sh 16384    # Set to 16GB
#   ./set-memory.sh 32768    # Set to 32GB
#
# Or use make targets:
#   make set-memory-8gb      # Set to 8GB
#   make set-memory-16gb     # Set to 16GB
#   make set-memory-32gb     # Set to 32GB
#   make set-memory-64gb     # Set to 64GB
###############################################################################

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Default to 16GB for high-memory systems
HEAP_SIZE=${1:-16384}

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}   OIP Arweave - Memory Configuration${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${RED}❌ Error: .env file not found${NC}"
    echo -e "${YELLOW}Please copy 'example env' to '.env' first${NC}"
    echo -e "${YELLOW}Command: cp \"example env\" .env${NC}"
    exit 1
fi

# Calculate GB
HEAP_SIZE_GB=$(echo "scale=2; $HEAP_SIZE / 1024" | bc)

echo -e "${GREEN}✓${NC} Setting heap size to: ${HEAP_SIZE}MB (${HEAP_SIZE_GB}GB)"

# Check available system memory
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    TOTAL_MEM=$(free -m | awk '/^Mem:/{print $2}')
    echo -e "${GREEN}✓${NC} System memory: ${TOTAL_MEM}MB"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    TOTAL_MEM=$(sysctl -n hw.memsize | awk '{print int($1/1024/1024)}')
    echo -e "${GREEN}✓${NC} System memory: ${TOTAL_MEM}MB"
fi

# Validate heap size isn't too large
if [ ! -z "$TOTAL_MEM" ]; then
    if [ $HEAP_SIZE -gt $((TOTAL_MEM * 3 / 4)) ]; then
        echo -e "${YELLOW}⚠️  Warning: Heap size is more than 75% of system memory${NC}"
        echo -e "${YELLOW}   Recommended: $((TOTAL_MEM * 3 / 4))MB or less${NC}"
        read -p "Continue anyway? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo -e "${RED}Cancelled${NC}"
            exit 1
        fi
    fi
fi

# Backup .env
cp .env .env.backup
echo -e "${BLUE}ℹ️  Backed up .env to .env.backup${NC}"

# Remove existing NODE_OPTIONS if present
sed -i.tmp '/^NODE_OPTIONS=/d' .env && rm -f .env.tmp

# Add new NODE_OPTIONS at the end
echo "" >> .env
echo "# Memory Configuration (set by set-memory.sh)" >> .env
echo "NODE_OPTIONS=--max-old-space-size=${HEAP_SIZE}" >> .env

echo -e "${GREEN}✅ Memory configuration updated in .env${NC}"
echo ""
echo -e "${BLUE}Configuration Details:${NC}"
echo -e "  Heap Size:         ${HEAP_SIZE}MB (${HEAP_SIZE_GB}GB)"
echo -e "  Node Options:      --max-old-space-size=${HEAP_SIZE}"
echo -e "  Note:              --expose-gc removed (not allowed in NODE_OPTIONS)"
echo ""
echo -e "${GREEN}✅ Ready to start services!${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo -e "  1. Start your services with make:"
echo -e "     ${BLUE}make standard${NC}              # Standard profile"
echo -e "     ${BLUE}make backend-only${NC}          # Backend only"
echo -e "     ${BLUE}make standard-gpu${NC}          # With GPU"
echo -e "     ${BLUE}make minimal${NC}               # Minimal profile"
echo ""
echo -e "  2. Monitor memory usage:"
echo -e "     ${BLUE}curl http://localhost:3005/api/health/memory | jq${NC}"
echo ""
echo -e "  3. To change memory allocation later:"
echo -e "     ${BLUE}./set-memory.sh 32768${NC}     # Set to 32GB"
echo -e "     ${BLUE}make set-memory-32gb${NC}      # Same, using make"
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

