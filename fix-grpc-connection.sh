#!/bin/bash

# Script to fix gRPC connection issues with Bisq daemon

echo "=== Bisq gRPC Connection Fix ==="
echo "This script will install required dependencies and configure your system to connect to Bisq's gRPC API"

# Install required dependencies
echo -e "\n=== Installing required dependencies ==="
npm install @grpc/grpc-js @grpc/proto-loader --save

# Rebuild Docker container
echo -e "\n=== Rebuilding Bisq Docker container ==="
docker-compose build --no-cache bisq

# Start container
echo -e "\n=== Starting Bisq Docker container ==="
docker-compose up -d bisq

# Wait for Bisq daemon to start
echo -e "\n=== Waiting for Bisq daemon to start (30 seconds) ==="
sleep 30

# If running locally, set environment variable
echo -e "\n=== Setting up environment variables ==="
export RUNNING_IN_DOCKER=false

echo -e "\n=== Configuration complete ==="
echo "You can now restart your Node.js application with: node index.js"
echo "If you need these environment variables to persist, add them to your .env file:"
echo "RUNNING_IN_DOCKER=false" 