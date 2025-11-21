# Start OIP Backend with Ollama

## Quick Start

```bash
cd /Users/devon/Documents/CODE-local/oip-arweave-indexer

# Start the full backend (includes Ollama for AI)
make backend-only

# Or if you prefer the standard stack:
make standard
```

## Verify Ollama is Running

After starting, verify Ollama is accessible:

```bash
# Check Docker containers
docker ps | grep ollama

# Test Ollama API (note the port 11404, not 11434)
curl http://localhost:11404/api/tags

# List available models
curl http://localhost:11404/api/tags | jq '.models[].name'
```

## Install llama3.2:3b Model

If Ollama is running but the model isn't installed:

```bash
# Pull the model
docker exec -it fitnessally-ollama-1 ollama pull llama3.2:3b

# Verify it's installed
docker exec -it fitnessally-ollama-1 ollama list
```

## Troubleshooting

If you see "Docker daemon not running":
1. Open Docker Desktop
2. Wait for it to start
3. Run `make backend-only` again

