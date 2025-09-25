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
node --inspect=0.0.0.0:9229 index.js --keepDBUpToDate 10 10 &
API_PID=$!

# Wait for both processes
wait $FRONTEND_PID $API_PID 