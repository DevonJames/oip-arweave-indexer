#!/bin/bash

# OIP Arweave Startup Script
echo "===== Starting OIP Arweave with Docker ====="

# Set up environment variables
export NODE_ENV=development

echo "Setting up environment:"
echo "  NODE_ENV=$NODE_ENV"

# Check if .env file exists
if [ -f .env ]; then
  echo "Loading settings from .env file"
else
  echo "Warning: No .env file found. Using default settings."
fi

# Start all Docker containers
echo "Starting all Docker containers..."
docker-compose up -d
echo "✅ Docker containers started"

# Stop the OIP container specifically (because the latest version doesn't build correctly)
# echo "Stopping the OIP container..."
# docker stop oiparweave-oip-1
# echo "✅ OIP container stopped"

# # Check if ElasticSearch is running
# echo "Checking ElasticSearch connection..."
# curl -s http://localhost:9200 > /dev/null
# if [ $? -eq 0 ]; then
#   echo "✅ ElasticSearch is running"
# else
#   echo "⚠️ Warning: ElasticSearch doesn't appear to be running at http://localhost:9200"
#   echo "Applications that depend on ElasticSearch may not work correctly"
# fi

# echo "=========================================="
# echo "Starting application with Bisq routes disabled..."
# echo "This is a temporary workaround until the Bisq connection issues are fixed."
# echo "=========================================="

# # Make bypass-bisq.js executable
# chmod +x bypass-bisq.js

# # Run the application through the bypass script with keepDBUpToDate flag
# node bypass-bisq.js --keepDBUpToDate 