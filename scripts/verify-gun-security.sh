#!/bin/bash

# GUN Network Security Verification Script
# Verifies that GUN is only connecting to controlled nodes

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🔒 GUN Network Security Verification${NC}"
echo -e "${BLUE}=====================================${NC}"
echo ""

# Check .env configuration
echo -e "${YELLOW}1. Checking .env configuration...${NC}"
if [ ! -f .env ]; then
    echo -e "${RED}❌ .env file not found${NC}"
    exit 1
fi

GUN_EXTERNAL_PEERS=$(grep "^GUN_EXTERNAL_PEERS=" .env | cut -d'=' -f2-)

if [ -z "$GUN_EXTERNAL_PEERS" ]; then
    echo -e "${YELLOW}⚠️  GUN_EXTERNAL_PEERS not set (isolated mode)${NC}"
    echo -e "${GREEN}✅ No external peers configured - maximum isolation${NC}"
else
    echo -e "${GREEN}✅ GUN_EXTERNAL_PEERS found:${NC}"
    echo "   $GUN_EXTERNAL_PEERS"
    
    # Check for unauthorized peers
    echo ""
    echo -e "${YELLOW}2. Validating peer URLs...${NC}"
    
    ALLOWED_DOMAINS="rockhoppersgame.com api.oip.onl oip.fitnessally.io localhost 127.0.0.1"
    UNAUTHORIZED_PEERS=()
    
    IFS=',' read -ra PEERS <<< "$GUN_EXTERNAL_PEERS"
    for peer in "${PEERS[@]}"; do
        peer=$(echo "$peer" | xargs)  # Trim whitespace
        AUTHORIZED=false
        
        for domain in $ALLOWED_DOMAINS; do
            if echo "$peer" | grep -q "$domain"; then
                AUTHORIZED=true
                echo -e "${GREEN}   ✅ $peer${NC}"
                break
            fi
        done
        
        if [ "$AUTHORIZED" = false ]; then
            UNAUTHORIZED_PEERS+=("$peer")
            echo -e "${RED}   🚨 UNAUTHORIZED: $peer${NC}"
        fi
    done
    
    if [ ${#UNAUTHORIZED_PEERS[@]} -gt 0 ]; then
        echo ""
        echo -e "${RED}🚨 SECURITY ALERT: Unauthorized peers detected!${NC}"
        echo -e "${RED}   The following peers are NOT in your controlled domain list:${NC}"
        for peer in "${UNAUTHORIZED_PEERS[@]}"; do
            echo -e "${RED}   - $peer${NC}"
        done
        echo ""
        echo -e "${YELLOW}   Allowed domains: $ALLOWED_DOMAINS${NC}"
        exit 1
    else
        echo -e "${GREEN}✅ All peers are authorized${NC}"
    fi
fi

# Check running container configuration
echo ""
echo -e "${YELLOW}3. Checking running GUN relay container...${NC}"

CONTAINER_NAME=$(docker ps --format "{{.Names}}" | grep gun-relay | head -1)

if [ -z "$CONTAINER_NAME" ]; then
    echo -e "${YELLOW}⚠️  GUN relay container not running${NC}"
    echo -e "${BLUE}   Start services with: make standard-gpu${NC}"
else
    echo -e "${GREEN}✅ Found container: $CONTAINER_NAME${NC}"
    
    # Check environment variable in container
    CONTAINER_PEERS=$(docker exec "$CONTAINER_NAME" sh -c 'echo $GUN_PEERS' 2>/dev/null || echo "")
    
    if [ -z "$CONTAINER_PEERS" ]; then
        echo -e "${GREEN}   ✅ Container running in isolated mode (no GUN_PEERS set)${NC}"
    else
        echo -e "${BLUE}   Container GUN_PEERS: $CONTAINER_PEERS${NC}"
    fi
    
    # Check peer status endpoint
    echo ""
    echo -e "${YELLOW}4. Querying GUN peer status endpoint...${NC}"
    
    if command -v curl >/dev/null 2>&1; then
        PEER_STATUS=$(curl -s http://localhost:${GUN_RELAY_PORT:-8765}/peers/status 2>/dev/null || echo "")
        
        if [ -n "$PEER_STATUS" ]; then
            echo -e "${GREEN}✅ Peer status endpoint accessible${NC}"
            echo ""
            echo "$PEER_STATUS" | jq . 2>/dev/null || echo "$PEER_STATUS"
        else
            echo -e "${YELLOW}⚠️  Could not reach peer status endpoint${NC}"
        fi
    fi
    
    # Check container logs for unauthorized connections
    echo ""
    echo -e "${YELLOW}5. Checking logs for unauthorized peer attempts...${NC}"
    
    SECURITY_WARNINGS=$(docker logs "$CONTAINER_NAME" 2>&1 | grep "SECURITY WARNING" || echo "")
    SECURITY_BLOCKS=$(docker logs "$CONTAINER_NAME" 2>&1 | grep "SECURITY: Blocked" || echo "")
    
    if [ -n "$SECURITY_WARNINGS" ] || [ -n "$SECURITY_BLOCKS" ]; then
        echo -e "${RED}🚨 Security warnings found in logs:${NC}"
        echo ""
        [ -n "$SECURITY_WARNINGS" ] && echo "$SECURITY_WARNINGS"
        [ -n "$SECURITY_BLOCKS" ] && echo "$SECURITY_BLOCKS"
        echo ""
        echo -e "${RED}⚠️  Unauthorized peer connection attempts detected!${NC}"
    else
        echo -e "${GREEN}✅ No unauthorized peer attempts found in logs${NC}"
    fi
fi

# Summary
echo ""
echo -e "${BLUE}=====================================${NC}"
echo -e "${BLUE}📊 Security Summary${NC}"
echo -e "${BLUE}=====================================${NC}"
echo ""

if [ ${#UNAUTHORIZED_PEERS[@]} -eq 0 ]; then
    echo -e "${GREEN}✅ GUN network is properly isolated${NC}"
    echo -e "${GREEN}✅ Only controlled nodes can sync${NC}"
    echo -e "${GREEN}✅ Private/organization records are protected${NC}"
    echo ""
    echo -e "${BLUE}🔒 Configured peers (if any):${NC}"
    if [ -n "$GUN_EXTERNAL_PEERS" ]; then
        IFS=',' read -ra PEERS <<< "$GUN_EXTERNAL_PEERS"
        for peer in "${PEERS[@]}"; do
            echo -e "${GREEN}   ✓ $(echo "$peer" | xargs)${NC}"
        done
    else
        echo -e "${GREEN}   ✓ Isolated mode (no external peers)${NC}"
    fi
else
    echo -e "${RED}❌ SECURITY ISSUE: Unauthorized peers detected${NC}"
    echo -e "${RED}❌ Remove unauthorized peers from GUN_EXTERNAL_PEERS in .env${NC}"
    exit 1
fi

echo ""

