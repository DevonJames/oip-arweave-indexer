#!/bin/bash

# Wait for Elasticsearch to be ready
./wait-for-it.sh elasticsearch:9200 --timeout=90 --strict

echo "Starting OIP services..."

# Start Next.js frontend in background (on port 3000)
echo "Starting Next.js frontend on port 3000..."
cd frontend && PORT=3000 npm start &
FRONTEND_PID=$!

# Return to main directory
cd ..

# Start Express API (on port 3005) with correct path
echo "Starting Express API on port 3005..."
node --inspect=0.0.0.0:9229 /usr/src/app/index.js --keepDBUpToDate 10 10 &
API_PID=$!

# Wait for both processes
wait $FRONTEND_PID $API_PID 