#!/usr/bin/env bash

# Wait for Elasticsearch to be ready
./wait-for-it.sh elasticsearch:9200 --timeout=90 --strict

echo "Starting OIP services..."

# Start Next.js frontend in background (on configured port)
echo "Starting Next.js frontend on port ${NEXT_FRONTEND_PORT:-3000}..."
cd /usr/src/app/frontend && PORT=${NEXT_FRONTEND_PORT:-3000} npm start &
FRONTEND_PID=$!

# Ensure we're in the correct directory for the API
cd /usr/src/app

# Start Express API (on configured port) with correct working directory
echo "Starting Express API on port ${PORT:-3005}..."

# Extract max-old-space-size from NODE_OPTIONS if set, otherwise use default
if [ -n "$NODE_OPTIONS" ]; then
    HEAP_SIZE=$(echo "$NODE_OPTIONS" | sed -n 's/.*max-old-space-size=\([0-9]*\).*/\1/p')
fi
HEAP_SIZE=${HEAP_SIZE:-4096}
echo "Setting heap size to: ${HEAP_SIZE}MB"

node --inspect=0.0.0.0:9229 --max-old-space-size=${HEAP_SIZE} index.js --keepDBUpToDate 10 10 &
API_PID=$!

# Wait for both processes
wait $FRONTEND_PID $API_PID 