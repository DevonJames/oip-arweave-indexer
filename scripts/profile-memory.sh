#!/bin/bash

# Memory Profiling Script for OIP Arweave Indexer
# Runs diagnostic tool inside the Docker container

CONTAINER_NAME="fitnessally-oip-gpu-1"

echo "🔍 Running memory diagnostic in container: $CONTAINER_NAME"
echo ""

# Run the diagnostic script
docker exec $CONTAINER_NAME node /usr/src/app/scripts/diagnose-memory-leak.js "$@"

echo ""
echo "📊 For heap snapshot analysis:"
echo "   1. Copy snapshot from container: docker cp $CONTAINER_NAME:/usr/src/app/scripts/memory-snapshots ./memory-snapshots"
echo "   2. Open Chrome DevTools > Memory > Load snapshot"
echo "   3. Look for Detached DOM nodes, Arrays, and Buffers"

