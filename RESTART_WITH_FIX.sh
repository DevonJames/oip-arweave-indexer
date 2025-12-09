#!/bin/bash

# Quick restart script for applying the GUN 404 fix
# Run this after the code changes have been made

echo "🔄 Restarting OIP containers to apply GUN 404 fix..."
echo ""

cd /Users/devon/Documents/CODE-local/oip-arweave-indexer

# Find and restart all OIP containers
for container in $(docker ps --format "{{.Names}}" | grep -E "(oip|fitnessally|rockhoppers)"); do
    echo "Restarting $container..."
    docker-compose restart "$container"
    echo "✅ $container restarted"
    echo ""
done

echo "✅ All OIP containers restarted!"
echo ""
echo "Watch for 404 cache stats:"
echo "  docker logs -f <container-name> | grep 'GUN 404 Cache'"
echo ""
echo "Expected output after ~100 requests:"
echo "  📊 [GUN 404 Cache] 45/100 hits (45.0% cache hit rate, 55 cached souls)"
echo ""
echo "If you still see 'Error in getRecord after 2 retries: 404', the fix didn't load."
echo "In that case, do a full rebuild:"
echo "  docker-compose down <container-name>"
echo "  docker-compose up -d --build <container-name>"

