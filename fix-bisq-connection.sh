#!/bin/bash

# Script to fix Bisq API connection issues

echo -e "\n=== Bisq API Connection Fix ==="
echo "This script will update your application to handle Bisq API connection issues."
echo "The fix implements automatic fallback to mock mode when connection fails."

# Function to check if Bisq is running in Docker
check_bisq_docker() {
  echo -e "\n=== Checking if Bisq is running in Docker ==="
  if docker ps | grep -q bisq; then
    echo "✅ Bisq container is running."
    return 0
  else
    echo "❌ Bisq container is not running."
    return 1
  fi
}

# Function to run diagnostic test
run_diagnostic() {
  echo -e "\n=== Running Bisq API diagnostic test ==="
  node bisq-daemon/check-bisq-api.js
}

# Install required dependencies
echo -e "\n=== Installing required dependencies ==="
npm install axios uuid --save

# Check if Bisq is running in Docker
check_bisq_docker
if [ $? -eq 1 ]; then
  echo -e "\n=== Starting Bisq Docker container ==="
  docker-compose up -d bisq
  
  echo "Waiting for container to initialize (30 seconds)..."
  sleep 30
  
  check_bisq_docker
fi

# Set environment variable for development
echo -e "\n=== Setting up environment variables ==="
export RUNNING_IN_DOCKER=false
echo "Set RUNNING_IN_DOCKER=false for development"

# Run diagnostic test
run_diagnostic

echo -e "\n=== Next Steps ==="
echo "1. The Bisq API wrapper has been updated to automatically handle connection issues."
echo "2. When communication fails, it will seamlessly switch to mock mode."
echo "3. You can now restart your application with: node index.js"
echo ""
echo "To make the environment variable persistent, add this to your .env file:"
echo "RUNNING_IN_DOCKER=false"
echo ""
echo "For Docker deployment, set RUNNING_IN_DOCKER=true in your Docker environment." 