#!/bin/bash

# Wait for Elasticsearch to be ready
./wait-for-it.sh elasticsearch:9200 --timeout=90 --strict

echo "Starting OIP services..."

# Start Next.js frontend in background
echo "Starting Next.js frontend..."
cd frontend && npm start &
FRONTEND_PID=$!

# Return to main directory
cd ..

# Start Express API
echo "Starting Express API..."
node --inspect=0.0.0.0:9229 index.js --keepDBUpToDate 10 10 &
API_PID=$!

# Wait for both processes
wait $FRONTEND_PID $API_PID 