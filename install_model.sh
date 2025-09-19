#!/bin/bash

# Install required Ollama models for GPU deployment
echo "Installing Ollama models for GPU deployment..."

# Install the default model (llama3.2:3b)
echo "Pulling llama3.2:3b..."
docker exec ollama-gpu ollama pull llama3.2:3b

# Install mistral model (also used in the code)
echo "Pulling mistral:7b..."
docker exec ollama-gpu ollama pull mistral:7b

# Verify models are installed
echo "Verifying installed models:"
docker exec ollama-gpu ollama list

echo "Model installation complete!"
