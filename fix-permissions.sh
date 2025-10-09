#!/bin/bash
# Fix permissions for data directory after Docker creates files as root
# This is needed on Linux servers where Docker runs as root by default

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Fixing permissions for data directory...${NC}"

# Get the current user and group
CURRENT_USER=$(whoami)
CURRENT_GROUP=$(id -gn)

# Check if data directory exists
if [ ! -d "data" ]; then
    echo -e "${YELLOW}Creating data directory structure...${NC}"
    mkdir -p data/media/web
fi

# Fix ownership
echo -e "${YELLOW}Changing ownership to ${CURRENT_USER}:${CURRENT_GROUP}...${NC}"
sudo chown -R ${CURRENT_USER}:${CURRENT_GROUP} ./data

# Set proper permissions
echo -e "${YELLOW}Setting proper permissions...${NC}"
sudo chmod -R 755 ./data

echo -e "${GREEN}✅ Permissions fixed successfully!${NC}"
echo -e "${GREEN}   Owner: ${CURRENT_USER}:${CURRENT_GROUP}${NC}"
echo -e "${GREEN}   Permissions: 755 (rwxr-xr-x)${NC}"

