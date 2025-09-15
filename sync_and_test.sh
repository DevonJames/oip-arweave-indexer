#!/bin/bash

echo "=== SYNCING CODE FIXES TO REMOTE ==="
echo ""

# Instructions for manual sync (since we can't directly access remote)
echo "📋 MANUAL SYNC REQUIRED:"
echo "1. Copy these updated files from your local machine to remote:"
echo "   - routes/voice.js (lines 357, 561 updated)"
echo "   - helpers/alfred.js (line 323 updated)"
echo ""

echo "2. Or if using git, commit and pull on remote:"
echo "   git add routes/voice.js helpers/alfred.js"
echo "   git commit -m 'Fix hardcoded model names to match installed models'"
echo "   git push"
echo "   # Then on remote: git pull"
echo ""

echo "=== TESTING THE FIX ==="
echo ""

# Test the corrected model names
echo "Testing available models:"
docker exec oip-arweave-indexer-ollama-gpu-1 curl -s "http://localhost:11434/api/show" -d '{"name":"llama3.2:3b"}' | head -3
docker exec oip-arweave-indexer-ollama-gpu-1 curl -s "http://localhost:11434/api/show" -d '{"name":"mistral:latest"}' | head -3

echo ""
echo "=== RESTART APPLICATION ==="
echo "After syncing files, restart your application:"
echo "make down PROFILE=gpu"
echo "make up PROFILE=gpu"

echo ""
echo "=== EXPECTED RESULT ==="
echo "✅ llama3.2:3b should work (default model)"
echo "✅ mistral:latest should work (updated from mistral:7b)"
echo "❌ llama2:7b will fail (only llama2:latest is installed)"
echo ""
echo "The fix ensures your app uses the correct installed model names!"
