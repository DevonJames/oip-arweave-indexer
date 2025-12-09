#!/bin/bash

# Complete Memory Leak Fix Deployment Script
# Fixes both 404 retry bug AND media stream buffer leaks
# December 8, 2024

echo "================================================"
echo "  FitnessAlly Memory Leak - Complete Fix"
echo "================================================"
echo ""
echo "Two critical fixes being deployed:"
echo "  1. GUN 404 Retry Bug - eliminates redundant HTTP requests"
echo "  2. Media Stream Leak - adds cleanup handlers to file streams"
echo ""

# Navigate to OIP directory
cd /Users/devon/Documents/CODE-local/oip-arweave-indexer || exit 1

echo "Step 1: Checking Docker status..."
if ! docker ps &> /dev/null; then
    echo "❌ Docker is not running. Please start Docker Desktop first."
    exit 1
fi
echo "✅ Docker is running"
echo ""

# Find FitnessAlly container
echo "Step 2: Finding FitnessAlly container..."
CONTAINER=$(docker ps --format "{{.Names}}" | grep -E "(fitnessally)" | head -1)

if [ -z "$CONTAINER" ]; then
    echo "❌ FitnessAlly container not found. Available containers:"
    docker ps --format "{{.Names}}"
    exit 1
fi

echo "✅ Found container: $CONTAINER"
echo ""

# Verify fixes are in code
echo "Step 3: Verifying fixes are present in code..."

if grep -q "CRITICAL FIX: Check status code BEFORE nulling response" helpers/gun.js; then
    echo "✅ 404 retry fix found in helpers/gun.js"
else
    echo "❌ 404 retry fix NOT found in helpers/gun.js"
    exit 1
fi

if grep -q "CRITICAL FIX: Add stream cleanup handlers" routes/media.js; then
    echo "✅ Media stream fix found in routes/media.js"
else
    echo "❌ Media stream fix NOT found in routes/media.js"
    exit 1
fi

if grep -q "CRITICAL FIX: Add stream cleanup handlers" routes/api.js; then
    echo "✅ Media stream fix found in routes/api.js"
else
    echo "❌ Media stream fix NOT found in routes/api.js"
    exit 1
fi

echo ""
echo "Step 4: Restarting container to apply fixes..."
docker-compose restart "$CONTAINER"

echo ""
echo "Step 5: Waiting for container to start..."
sleep 5

# Check if container is running
if docker ps | grep -q "$CONTAINER"; then
    echo "✅ Container restarted successfully"
else
    echo "❌ Container failed to start. Check logs:"
    echo "   docker logs $CONTAINER"
    exit 1
fi

echo ""
echo "================================================"
echo "  ✅ Deployment Complete!"
echo "================================================"
echo ""
echo "Next steps:"
echo ""
echo "1. Watch for 404 cache stats (after ~100 requests):"
echo "   docker logs -f $CONTAINER | grep 'GUN 404 Cache'"
echo ""
echo "2. Monitor memory growth:"
echo "   docker logs -f $CONTAINER | grep 'Memory Monitor'"
echo ""
echo "3. Check for stream errors:"
echo "   docker logs -f $CONTAINER | grep 'Stream error'"
echo ""
echo "4. Check current memory usage:"
echo "   docker stats $CONTAINER --no-stream"
echo ""
echo "Expected results:"
echo "  • 404 cache hit rate > 50% after 1 hour"
echo "  • External memory shows sawtooth pattern (not linear growth)"
echo "  • Memory stays under 5GB after 24 hours"
echo "  • No 'CRITICAL: External memory' warnings"
echo ""
echo "If issues persist, see:"
echo "  • docs/GUN_404_RETRY_BUG_FIX.md"
echo "  • docs/MEDIA_STREAM_LEAK_FIX_DEC_2024.md"
echo ""

