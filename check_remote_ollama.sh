#!/bin/bash

echo "=== OLLAMA SERVICE DIAGNOSTICS ==="
echo ""

# Check if Ollama service is running
echo "1. Checking Docker services:"
docker ps | grep ollama

echo ""
echo "2. Checking Ollama service health:"
docker exec ollama-gpu ollama list 2>/dev/null || echo "❌ ollama-gpu container not found or not running"

echo ""
echo "3. Checking Ollama API endpoint:"
curl -s http://localhost:11434/api/tags 2>/dev/null | head -20 || echo "❌ Cannot reach Ollama API on port 11434"

echo ""
echo "4. Checking network connectivity:"
docker exec ollama-gpu curl -s http://ollama-gpu:11434/api/tags | head -10 || echo "❌ ollama-gpu cannot reach itself"

echo ""
echo "5. Checking container logs:"
echo "Recent ollama-gpu logs:"
docker logs ollama-gpu --tail 10 2>/dev/null || echo "❌ Cannot read ollama-gpu logs"

echo ""
echo "6. Checking environment variables:"
echo "OLLAMA_HOST in your application:"
docker exec $(docker ps -q -f name=oip) env | grep OLLAMA 2>/dev/null || echo "❌ No OIP container found"

echo ""
echo "7. Testing model API calls:"
echo "Testing llama3.2:3b:"
docker exec ollama-gpu curl -s "http://localhost:11434/api/show" -d '{"name":"llama3.2:3b"}' | head -5 || echo "❌ llama3.2:3b not available"

echo "Testing llama2:7b:"
docker exec ollama-gpu curl -s "http://localhost:11434/api/show" -d '{"name":"llama2:7b"}' | head -5 || echo "❌ llama2:7b not available"

echo ""
echo "=== DIAGNOSTICS COMPLETE ==="
