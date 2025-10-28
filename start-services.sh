#!/usr/bin/env bash

# Wait for Elasticsearch to be ready
./wait-for-it.sh elasticsearch:9200 --timeout=90 --strict

echo "Starting OIP services..."

# Start Next.js frontend in background (on configured port)
echo "Starting Next.js frontend on port ${NEXT_FRONTEND_PORT:-3000}..."

# Extract heap size for frontend (use smaller size since frontend is less memory-intensive)
if [ -n "$NODE_OPTIONS" ]; then
    FRONTEND_HEAP_SIZE=$(echo "$NODE_OPTIONS" | sed -n 's/.*max-old-space-size=\([0-9]*\).*/\1/p')
fi
FRONTEND_HEAP_SIZE=${FRONTEND_HEAP_SIZE:-4096}
echo "Setting frontend heap size to: ${FRONTEND_HEAP_SIZE}MB"

# Call node directly with heap size instead of npm start (npm doesn't pass NODE_OPTIONS correctly)
cd /usr/src/app/frontend && PORT=${NEXT_FRONTEND_PORT:-3000} node --max-old-space-size=${FRONTEND_HEAP_SIZE} ./node_modules/.bin/next start &
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

# Configure keepDBUpToDate arguments from environment variables (default: 10 10)
KEEP_DB_DELAY=${KEEP_DB_DELAY:-10}  # Delay in seconds before first check
KEEP_DB_REFRESH=${KEEP_DB_REFRESH:-10}  # How often to refresh cache (every N keepDB cycles)
echo "Configuring keepDBUpToDate: delay=${KEEP_DB_DELAY}s, refresh every ${KEEP_DB_REFRESH} cycles"

node --inspect=0.0.0.0:9229 --max-old-space-size=${HEAP_SIZE} index.js --keepDBUpToDate $KEEP_DB_DELAY $KEEP_DB_REFRESH &
API_PID=$!

# Wait for both processes
wait $FRONTEND_PID $API_PID 