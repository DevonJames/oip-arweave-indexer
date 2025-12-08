#!/bin/bash

# Test script to verify the 404 fix is deployed
# This checks if the fix is present in the running container

echo "Testing if GUN 404 fix is deployed..."
echo ""

# Check if Docker is running
if ! docker ps &> /dev/null; then
    echo "❌ Docker is not running. Please start Docker Desktop or connect to the remote server."
    exit 1
fi

# Try common container names
CONTAINERS=("fitnessally-oip-gpu-1" "oip-main-oip-1" "rockhoppers-oip-1" "oip-1")

FOUND=false
for CONTAINER in "${CONTAINERS[@]}"; do
    if docker ps --format "{{.Names}}" | grep -q "^${CONTAINER}$"; then
        echo "✅ Found running container: $CONTAINER"
        echo ""
        
        # Check if the fix is present
        echo "Checking for fix in container..."
        if docker exec "$CONTAINER" grep -q "CRITICAL FIX: Check status code BEFORE nulling response" /app/helpers/gun.js 2>/dev/null; then
            echo "✅ Fix is present in container code!"
            echo ""
            
            # Check if cache initialization exists
            if docker exec "$CONTAINER" grep -q "missing404Cache = new Map()" /app/helpers/gun.js 2>/dev/null; then
                echo "✅ 404 cache initialization found!"
                echo ""
                echo "🔄 The fix is in the code. Now restart the container to load it:"
                echo ""
                echo "   docker-compose restart $CONTAINER"
                echo ""
                echo "   OR if that doesn't work:"
                echo ""
                echo "   docker-compose down $CONTAINER"
                echo "   docker-compose up -d $CONTAINER"
            else
                echo "⚠️  Cache initialization not found. Container may need rebuild."
            fi
        else
            echo "❌ Fix NOT found in container. Container needs rebuild:"
            echo ""
            echo "   cd /path/to/oip-arweave-indexer"
            echo "   docker-compose down $CONTAINER"
            echo "   docker-compose up -d --build $CONTAINER"
        fi
        
        echo ""
        echo "After restart, watch for cache stats:"
        echo "   docker logs -f $CONTAINER | grep 'GUN 404 Cache'"
        echo ""
        
        FOUND=true
        break
    fi
done

if [ "$FOUND" = false ]; then
    echo "❌ No OIP containers found running."
    echo ""
    echo "Searched for: ${CONTAINERS[*]}"
    echo ""
    echo "Run 'docker ps' to see running containers."
fi

