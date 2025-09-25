# Multi-Stack OIP Deployment Guide

## Overview

You can now run multiple completely separate OIP stacks on the same machine without conflicts! This guide shows you how to set up and manage multiple isolated OIP deployments.

## Conflict Resolution

The OIP stack has been updated to prevent all Docker conflicts:

### ✅ **Fixed Conflicts**
- **🌐 Network Names**: Now use `${COMPOSE_PROJECT_NAME}_oip-network`
- **📦 Volume Names**: Now use `${COMPOSE_PROJECT_NAME}_volumename`
- **🔌 Port Conflicts**: All service ports are configurable via environment variables
- **📁 Container Names**: Automatically prefixed with project name

## Multi-Stack Setup

### **Scenario: Running RockHoppersGame and SpaceAdventure simultaneously**

```bash
# Project structure:
~/projects/
├── RockHoppersGame/
│   ├── oip-arweave-indexer/
│   └── public/
└── SpaceAdventure/
    ├── oip-arweave-indexer/
    └── public/
```

### **1. Configure RockHoppersGame (Stack 1)**

`RockHoppersGame/oip-arweave-indexer/.env`:
```bash
# Project Configuration
COMPOSE_PROJECT_NAME=rockhoppers-game
CUSTOM_PUBLIC_PATH=true

# Main API Port
PORT=3005

# Service Ports (Stack 1 - Default ports)
ELASTICSEARCH_PORT=9200
ELASTICSEARCH_TRANSPORT_PORT=9300
KIBANA_PORT=5601
IPFS_SWARM_PORT=4001
IPFS_API_PORT=5001
IPFS_GATEWAY_PORT=8080
OLLAMA_PORT=11434
TEXT_GENERATOR_PORT=8081
STT_SERVICE_PORT=8003
TTS_SERVICE_PORT=8005
SPEECH_SYNTHESIZER_PORT=8082
GUN_RELAY_PORT=8765
NGROK_DASHBOARD_PORT=4040
DEBUG_PORT=9229
NEXT_FRONTEND_PORT=3000

# Other OIP configuration...
JWT_SECRET=rockhoppers_jwt_secret
ELASTICSEARCHHOST=http://elasticsearch:9200
```

### **2. Configure SpaceAdventure (Stack 2)**

`SpaceAdventure/oip-arweave-indexer/.env`:
```bash
# Project Configuration
COMPOSE_PROJECT_NAME=space-adventure
CUSTOM_PUBLIC_PATH=true

# Main API Port (different from Stack 1)
PORT=3105

# Service Ports (Stack 2 - Offset by +100)
ELASTICSEARCH_PORT=9300
ELASTICSEARCH_TRANSPORT_PORT=9400
KIBANA_PORT=5701
IPFS_SWARM_PORT=4101
IPFS_API_PORT=5101
IPFS_GATEWAY_PORT=8180
OLLAMA_PORT=11534
TEXT_GENERATOR_PORT=8181
STT_SERVICE_PORT=8103
TTS_SERVICE_PORT=8105
SPEECH_SYNTHESIZER_PORT=8182
GUN_RELAY_PORT=8865
NGROK_DASHBOARD_PORT=4140
DEBUG_PORT=9329
NEXT_FRONTEND_PORT=3100

# Other OIP configuration...
JWT_SECRET=space_adventure_jwt_secret
ELASTICSEARCHHOST=http://elasticsearch:9300  # Note: Use Stack 2's Elasticsearch port
```

### **3. Deploy Both Stacks**

**Terminal 1 - RockHoppersGame:**
```bash
cd ~/projects/RockHoppersGame/oip-arweave-indexer
make standard
# Runs on ports 3005, 9200, 5601, etc.
```

**Terminal 2 - SpaceAdventure:**
```bash
cd ~/projects/SpaceAdventure/oip-arweave-indexer  
make standard
# Runs on ports 3105, 9300, 5701, etc.
```

### **4. Access Your Applications**

- **RockHoppersGame**: `http://localhost:3005` (or ngrok domain)
- **SpaceAdventure**: `http://localhost:3105` (or different ngrok domain)
- **RockHoppers Kibana**: `http://localhost:5601`
- **SpaceAdventure Kibana**: `http://localhost:5701`

## Docker Resource Isolation

### **Networks Created**
```bash
# Stack 1
rockhoppers-game_oip-network

# Stack 2  
space-adventure_oip-network
```

### **Volumes Created**
```bash
# Stack 1
rockhoppers-game_esdata
rockhoppers-game_ipfsdata
rockhoppers-game_whisper_models
rockhoppers-game_gundata

# Stack 2
space-adventure_esdata
space-adventure_ipfsdata
space-adventure_whisper_models
space-adventure_gundata
```

### **Container Names**
```bash
# Stack 1
rockhoppers-game-oip-1
rockhoppers-game-elasticsearch-1
rockhoppers-game-ollama-1
# etc.

# Stack 2
space-adventure-oip-1
space-adventure-elasticsearch-1
space-adventure-ollama-1
# etc.
```

## Port Allocation Strategy

### **Recommended Port Ranges**

| Project | Port Range | Main API | Elasticsearch | Kibana | Example |
|---------|------------|----------|---------------|--------|---------|
| Stack 1 | 3000-3099  | 3005     | 9200          | 5601   | RockHoppersGame |
| Stack 2 | 3100-3199  | 3105     | 9300          | 5701   | SpaceAdventure |
| Stack 3 | 3200-3299  | 3205     | 9400          | 5801   | PuzzleQuest |
| Stack 4 | 3300-3399  | 3305     | 9500          | 5901   | RPGWorld |

### **Port Offset Pattern (+100)**
```bash
# Base ports (Stack 1)
PORT=3005
ELASTICSEARCH_PORT=9200
KIBANA_PORT=5601

# Stack 2 (+100)
PORT=3105  
ELASTICSEARCH_PORT=9300
KIBANA_PORT=5701

# Stack 3 (+200)
PORT=3205
ELASTICSEARCH_PORT=9400
KIBANA_PORT=5801
```

## Quick Setup Script

Create `scripts/setup-multi-stack.sh`:

```bash
#!/bin/bash

# Multi-Stack Setup Helper
PROJECT_NAME=$1
PORT_OFFSET=${2:-0}

if [ -z "$PROJECT_NAME" ]; then
    echo "Usage: $0 <project-name> [port-offset]"
    echo "Example: $0 rockhoppers-game 0"
    echo "Example: $0 space-adventure 100"
    exit 1
fi

BASE_PORT=$((3005 + PORT_OFFSET))
ES_PORT=$((9200 + PORT_OFFSET))
KIBANA_PORT=$((5601 + PORT_OFFSET))

echo "🚀 Setting up OIP stack: $PROJECT_NAME"
echo "📊 Port configuration:"
echo "   Main API: $BASE_PORT"
echo "   Elasticsearch: $ES_PORT"
echo "   Kibana: $KIBANA_PORT"

# Create .env file
cat > .env << EOF
# Project Configuration
COMPOSE_PROJECT_NAME=$PROJECT_NAME
CUSTOM_PUBLIC_PATH=true

# Main API Port
PORT=$BASE_PORT

# Service Ports
ELASTICSEARCH_PORT=$ES_PORT
ELASTICSEARCH_TRANSPORT_PORT=$((ES_PORT + 100))
KIBANA_PORT=$KIBANA_PORT
IPFS_SWARM_PORT=$((4001 + PORT_OFFSET))
IPFS_API_PORT=$((5001 + PORT_OFFSET))
IPFS_GATEWAY_PORT=$((8080 + PORT_OFFSET))
OLLAMA_PORT=$((11434 + PORT_OFFSET))
TEXT_GENERATOR_PORT=$((8081 + PORT_OFFSET))
STT_SERVICE_PORT=$((8003 + PORT_OFFSET))
TTS_SERVICE_PORT=$((8005 + PORT_OFFSET))
SPEECH_SYNTHESIZER_PORT=$((8082 + PORT_OFFSET))
GUN_RELAY_PORT=$((8765 + PORT_OFFSET))
NGROK_DASHBOARD_PORT=$((4040 + PORT_OFFSET))
DEBUG_PORT=$((9229 + PORT_OFFSET))
NEXT_FRONTEND_PORT=$((3000 + PORT_OFFSET))

# Other Configuration
JWT_SECRET=${PROJECT_NAME}_jwt_secret
ELASTICSEARCHHOST=http://elasticsearch:9200
# Add your other configuration here...
EOF

echo "✅ Configuration created: .env"
echo "🎯 Ready to deploy with: make standard"
```

Usage:
```bash
# Setup Stack 1
cd RockHoppersGame/oip-arweave-indexer
../scripts/setup-multi-stack.sh rockhoppers-game 0

# Setup Stack 2
cd SpaceAdventure/oip-arweave-indexer
../scripts/setup-multi-stack.sh space-adventure 100
```

## Management Commands

### **Check All Running Stacks**
```bash
# List all OIP-related containers
docker ps --filter "name=oip" --format "table {{.Names}}\t{{.Ports}}\t{{.Status}}"

# List all OIP networks
docker network ls | grep oip

# List all OIP volumes
docker volume ls | grep -E "(esdata|ipfsdata|whisper|gundata)"
```

### **Stop Specific Stack**
```bash
cd ~/projects/RockHoppersGame/oip-arweave-indexer
make down  # Only stops RockHoppersGame stack
```

### **Monitor Specific Stack**
```bash
cd ~/projects/SpaceAdventure/oip-arweave-indexer
make status  # Only shows SpaceAdventure stack status
```

## Resource Considerations

### **Memory Usage**
Each full OIP stack uses approximately:
- **Elasticsearch**: ~1GB RAM
- **Ollama**: ~2-4GB RAM (depending on model)
- **Other services**: ~500MB RAM
- **Total per stack**: ~4-6GB RAM

### **Disk Usage**
Each stack creates separate volumes:
- **Elasticsearch data**: ~100MB-10GB (depending on records)
- **Ollama models**: ~2-7GB per model
- **IPFS data**: ~100MB-1GB
- **Total per stack**: ~3-20GB disk

### **CPU Usage**
- **Development**: Light CPU usage
- **AI Processing**: Heavy CPU/GPU usage when generating content

## Best Practices

### **1. Resource Planning**
```bash
# Check available resources
free -h                    # Memory
df -h                     # Disk space
docker system df          # Docker space usage
```

### **2. Selective Profiles**
Use lighter profiles for additional stacks:
```bash
# Stack 1: Full features
make standard

# Stack 2: Minimal features (less resource usage)
make minimal
```

### **3. Shared Resources** (Advanced)
For efficiency, you can share some services between stacks:

```bash
# Stack 1: Full stack
COMPOSE_PROJECT_NAME=shared-infrastructure

# Stack 2: Connect to Stack 1's services
ELASTICSEARCHHOST=http://localhost:9200  # Use Stack 1's Elasticsearch
GUN_PEERS=http://localhost:8765           # Use Stack 1's GUN relay
```

## Troubleshooting

### **Port Conflicts**
```bash
# Check what's using a port
lsof -i :3005
netstat -tulpn | grep 3005

# Find available ports
for port in {3005..3010}; do ! lsof -i:$port && echo "Port $port is free"; done
```

### **Network Conflicts**
```bash
# List Docker networks
docker network ls

# Remove conflicting network
docker network rm conflicting-network-name
```

### **Volume Conflicts**
```bash
# List Docker volumes
docker volume ls

# Remove specific project volumes
docker volume rm rockhoppers-game_esdata rockhoppers-game_ipfsdata
```

### **Container Name Conflicts**
```bash
# List containers by project
docker ps -a --filter "name=rockhoppers-game"

# Remove stopped containers
docker container prune
```

## Example: Three Simultaneous Stacks

```bash
# Stack 1: RockHoppersGame (ports 3005, 9200, 5601)
cd ~/projects/RockHoppersGame/oip-arweave-indexer
COMPOSE_PROJECT_NAME=rockhoppers-game PORT=3005 make minimal

# Stack 2: SpaceAdventure (ports 3105, 9300, 5701)  
cd ~/projects/SpaceAdventure/oip-arweave-indexer
COMPOSE_PROJECT_NAME=space-adventure PORT=3105 ELASTICSEARCH_PORT=9300 KIBANA_PORT=5701 make minimal

# Stack 3: PuzzleQuest (ports 3205, 9400, 5801)
cd ~/projects/PuzzleQuest/oip-arweave-indexer
COMPOSE_PROJECT_NAME=puzzle-quest PORT=3205 ELASTICSEARCH_PORT=9400 KIBANA_PORT=5801 make minimal
```

## Summary

✅ **Network Isolation**: Each stack gets its own Docker network  
✅ **Volume Isolation**: Each stack gets its own data volumes  
✅ **Port Flexibility**: All ports configurable via environment variables  
✅ **Container Isolation**: Each stack gets unique container names  
✅ **Resource Management**: Independent scaling and resource allocation  
✅ **Independent Deployment**: Each stack can use different profiles  

The system now fully supports running multiple isolated OIP stacks simultaneously on the same machine!
