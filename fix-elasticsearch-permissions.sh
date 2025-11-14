#!/bin/bash
# Fix Elasticsearch permissions for host-mounted data directory
# Elasticsearch runs as UID 1000 (elasticsearch user)

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🔧 Fixing Elasticsearch permissions...${NC}"

# Check if .env file exists to get ELASTICSEARCH_DATA_PATH
if [ -f .env ]; then
    # Try to read ELASTICSEARCH_DATA_PATH from .env
    ES_DATA_PATH=$(grep "^ELASTICSEARCH_DATA_PATH=" .env | cut -d'=' -f2 | tr -d '"' | tr -d "'")
    
    if [ -z "$ES_DATA_PATH" ]; then
        ES_DATA_PATH="./elasticsearch_data"
        echo -e "${YELLOW}   Using default path: ${ES_DATA_PATH}${NC}"
    else
        echo -e "${YELLOW}   Found ELASTICSEARCH_DATA_PATH: ${ES_DATA_PATH}${NC}"
    fi
else
    ES_DATA_PATH="./elasticsearch_data"
    echo -e "${YELLOW}   No .env file found, using default path: ${ES_DATA_PATH}${NC}"
fi

# Expand relative paths
if [[ "$ES_DATA_PATH" == ./* ]]; then
    ES_DATA_PATH="$(pwd)/${ES_DATA_PATH#./}"
fi

echo -e "${YELLOW}   Target directory: ${ES_DATA_PATH}${NC}"

# Check if directory exists
if [ ! -d "$ES_DATA_PATH" ]; then
    echo -e "${YELLOW}   Creating directory: ${ES_DATA_PATH}${NC}"
    sudo mkdir -p "$ES_DATA_PATH"
fi

# Get current user info
CURRENT_USER=$(whoami)
CURRENT_UID=$(id -u)
CURRENT_GID=$(id -g)

echo -e "${YELLOW}   Current user: ${CURRENT_USER} (UID: ${CURRENT_UID}, GID: ${CURRENT_GID})${NC}"
echo -e "${YELLOW}   Elasticsearch runs as UID 1000, GID 0 (elasticsearch:root)${NC}"

# Elasticsearch runs as UID 1000, GID 0 (root group)
echo -e "${YELLOW}   Changing ownership to UID 1000:GID 0 (elasticsearch user)...${NC}"
sudo chown -R 1000:0 "$ES_DATA_PATH"

# Set permissions: owner (1000) gets rwx, group (0) gets rwx, others get rx
echo -e "${YELLOW}   Setting permissions (775 - owner and group writable)...${NC}"
sudo chmod -R 775 "$ES_DATA_PATH"

# Verify permissions
if [ -d "$ES_DATA_PATH" ]; then
    OWNER=$(stat -c '%U:%G' "$ES_DATA_PATH" 2>/dev/null || stat -f '%Su:%Sg' "$ES_DATA_PATH" 2>/dev/null)
    PERMS=$(stat -c '%a' "$ES_DATA_PATH" 2>/dev/null || stat -f '%OLp' "$ES_DATA_PATH" 2>/dev/null)
    echo -e "${GREEN}✅ Permissions fixed!${NC}"
    echo -e "${GREEN}   Directory: ${ES_DATA_PATH}${NC}"
    echo -e "${GREEN}   Owner: ${OWNER}${NC}"
    echo -e "${GREEN}   Permissions: ${PERMS}${NC}"
    echo ""
    echo -e "${YELLOW}💡 You can now restart Elasticsearch:${NC}"
    echo -e "   docker restart oip-elasticsearch-1"
else
    echo -e "${RED}❌ Error: Directory not found or not accessible${NC}"
    exit 1
fi

