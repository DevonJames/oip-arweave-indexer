#!/bin/bash

# Simple script to check if the Bisq API is running

API_PORT=${API_PORT:-9998}
API_PASSWORD=${API_PASSWORD:-bisq}

echo "Checking Bisq API on port $API_PORT..."

# Try to access the API markets endpoint
response=$(curl -s -f -u bisq:$API_PASSWORD http://localhost:$API_PORT/api/markets 2>&1)
status=$?

if [ $status -eq 0 ]; then
  echo "✅ Bisq API is running and responding!"
  echo "Response: $response"
  exit 0
else
  echo "❌ Bisq API is not responding."
  echo "Error: $response"
  exit 1
fi 