# OIP Arweave Deployment Guide

This guide explains the different deployment options available for the OIP Arweave stack, including Docker Compose profiles and Dockerfile variants.

## 🚀 Quick Start

### Using the Deploy Script
```bash
# Make script executable (first time only)
chmod +x deploy.sh

# Start core services only (minimal setup)
./deploy.sh up minimal

# Start distributed full stack (recommended for most users)
./deploy.sh up standard

# Start monolithic deployment (all services in one container)
./deploy.sh up full

# Start GPU-optimized deployment
./deploy.sh up gpu
```

### Using Make
```bash
# Start core services only
make minimal

# Start distributed full stack
make standard

# Start monolithic deployment
make full

# Start GPU-optimized deployment
make gpu
```

### Using Docker Compose Directly
```bash
# Start with specific profile
docker-compose --profile minimal up -d
docker-compose --profile standard up -d
docker-compose --profile full up -d
docker-compose --profile gpu up -d
```

## 📋 Deployment Profiles

### `minimal` - Core Services Only
**Use Case**: Lightweight deployments, development without extra services, basic OIP functionality

**Services Included**:
- ✅ Elasticsearch + Kibana
- ✅ OIP main service only
- ❌ No IPFS
- ❌ No Speech Synthesizer
- ❌ No Text Generator
- ❌ No Ngrok

**Dockerfile**: Uses `Dockerfile` (lightweight, focused on main OIP service)

**Advantages**:
- Fastest startup time
- Lowest resource usage
- Perfect for development/testing
- Ideal when you only need the core OIP API

**Disadvantages**:
- No media storage (IPFS)
- No AI/ML capabilities
- No public access tunneling

### `standard` - Distributed Full Stack (Recommended)
**Use Case**: Production deployments, development, most common use case

**Services Included**:
- ✅ Elasticsearch + Kibana
- ✅ IPFS
- ✅ OIP main service (separate container)
- ✅ Speech Synthesizer (separate container)
- ✅ Ngrok (separate container)

**Dockerfile**: Uses `Dockerfile` (lightweight, focused on main OIP service)

**Advantages**:
- Better resource isolation
- Easier to scale individual services
- Faster builds and updates
- Better for debugging specific services

### `full` - Monolithic Deployment
**Use Case**: Simple deployments, testing, resource-constrained environments

**Services Included**:
- ✅ Elasticsearch + Kibana
- ✅ IPFS
- ✅ All OIP services in ONE container (oip-full)
  - Main OIP service
  - Text Generator (LLaMA2)
  - Speech Synthesizer (Coqui TTS)
  - Ngrok

**Dockerfile**: Uses `Dockerfile-full` (includes all Python ML dependencies)

**Advantages**:
- Simpler deployment (fewer containers)
- All services start together
- Good for development/testing

**Disadvantages**:
- Larger container size
- Resource competition between services
- Harder to debug individual services

### `gpu` - GPU-Optimized
**Use Case**: Machines with RTX 4090 or other CUDA GPUs, connecting to existing Elasticsearch

**Services Included**:
- ✅ OIP service optimized for GPU (connects to external network)
- ✅ Text Generator with GPU support

**Dockerfile**: Uses `Dockerfile` but connects to external `oiparweave_oip-network`

**Requirements**:
- Existing Elasticsearch running (from another stack)
- External Docker network `oiparweave_oip-network`

### `gpu-only` - Minimal GPU Service
**Use Case**: Adding GPU capabilities to existing full stack

**Services Included**:
- ✅ Only the GPU-optimized OIP service

**Requirements**:
- Existing full stack running elsewhere
- External Docker network `oiparweave_oip-network`

### `full-gpu` - Distributed with GPU
**Use Case**: Full distributed stack with GPU text generation

**Services Included**:
- ✅ All services from `standard` profile
- ✅ GPU-enabled Text Generator

## 🔧 Dockerfile Variants

### `Dockerfile` (Standard)
- **Base**: Node 18-alpine
- **Purpose**: Lightweight OIP service
- **Includes**: 
  - OpenSSL dependencies for node-datachannel
  - Basic system packages
  - Node.js dependencies only
- **Size**: Smaller (~500MB-1GB)
- **Build Time**: Faster
- **Use Cases**: Distributed deployments, GPU deployments

### `Dockerfile-full` (Monolithic)
- **Base**: Node 20.11.1-alpine
- **Purpose**: All-in-one container
- **Includes**:
  - All packages from standard Dockerfile
  - Python ML packages (torch, transformers, TTS)
  - Puppeteer for web scraping
  - Built-in services startup
- **Size**: Larger (~2-3GB)
- **Build Time**: Slower
- **Use Cases**: Simple deployments, testing, monolithic architecture

## 📖 Command Reference

### Deploy Script (`./deploy.sh`)
```bash
./deploy.sh [COMMAND] [PROFILE]

Commands:
  up      - Start services
  down    - Stop services  
  build   - Build and start services
  logs    - Show logs
  status  - Show service status
  help    - Show help

Examples:
  ./deploy.sh up minimal
  ./deploy.sh up standard
  ./deploy.sh build gpu
  ./deploy.sh logs oip-gpu
  ./deploy.sh down
```

### Makefile
```bash
make [target] [PROFILE=profile_name]

Quick Targets:
  make minimal     # Core services only
  make standard    # Distributed full stack
  make full        # Monolithic deployment
  make gpu         # GPU-optimized
  make gpu-only    # Minimal GPU service
  
Detailed Targets:
  make up PROFILE=minimal
  make up PROFILE=standard
  make build PROFILE=full
  make rebuild PROFILE=minimal    # Force rebuild with --no-cache
  make logs SERVICE=oip
  make status
  make clean       # Stop and remove everything
```

### Direct Docker Compose
```bash
# Start specific profile
docker-compose --profile [PROFILE] up -d

# Build and start
docker-compose --profile [PROFILE] up -d --build

# Force rebuild without cache
docker-compose --profile [PROFILE] build --no-cache
docker-compose --profile [PROFILE] up -d

# Stop all
docker-compose down

# View logs
docker-compose logs -f [SERVICE]
```

## 🔄 Rebuild Commands

When you need a completely fresh build (useful after code changes, dependency updates, or troubleshooting):

### Using Make (Recommended)
```bash
# Rebuild minimal profile with no cache
make rebuild PROFILE=minimal

# Rebuild standard profile with no cache  
make rebuild PROFILE=standard

# Rebuild GPU profile with no cache
make rebuild PROFILE=full-gpu

# Default profile (standard) rebuild
make rebuild
```

### Using Deploy Script
```bash
# The deploy script doesn't have a rebuild command yet
# Use make or docker-compose directly for rebuilds
```

### Using Docker Compose Directly
```bash
# Manual rebuild process
docker-compose --profile minimal build --no-cache
docker-compose --profile minimal up -d
```

**When to use rebuild:**
- After updating Docker files
- When dependencies have been updated  
- If you're experiencing build-related issues
- When switching between different system architectures
- After significant code changes

## 🌐 Network Configuration

### Standard/Full Profiles
- **Network**: `oiparweave_oip-network` (created automatically)
- **External Access**: No special requirements

### GPU Profiles
- **Network**: `oiparweave_oip-network` (must exist externally)
- **Setup**: Network created automatically if missing
- **Purpose**: Connect to existing Elasticsearch from another stack

## 🚨 Common Use Cases

### 1. Lightweight Development/Testing
```bash
./deploy.sh up minimal
```

### 2. Fresh Installation (No GPU)
```bash
./deploy.sh up standard
```

### 3. Simple Development Setup
```bash
./deploy.sh up full
```

### 4. Adding GPU to Existing Stack
```bash
# On machine with existing stack running
./deploy.sh up gpu-only
```

### 5. Full GPU Development Environment
```bash
./deploy.sh up full-gpu
```

### 6. Production with Separate Services
```bash
./deploy.sh build standard
```

## 🔍 Troubleshooting

### Port Conflicts
Different profiles expose different ports:
- `minimal`: 3005, 9229, 9200, 5601
- `standard`: 3005, 9229, 9200, 5601, 8082, 4040
- `full`: 3005, 9229, 9200, 5601, 8081, 8082, 4040 (all in oip-full)
- `gpu`: 3005, 9229, 8081
- `gpu-only`: 3005, 9229

### Network Issues
```bash
# Check if external network exists
docker network ls | grep oip

# Create network manually if needed
docker network create oiparweave_oip-network
```

### Service Health
```bash
# Check all services
make status

# Check specific service logs
./deploy.sh logs oip
./deploy.sh logs oip-full
./deploy.sh logs oip-gpu
```

### Environment Variables
Ensure your `.env` file includes:
```env
ELASTICSEARCHHOST=http://elasticsearch:9200
FIRECRAWL=your_firecrawl_token
NGROK_AUTH_TOKEN=your_ngrok_token
```

## 🧹 Cleanup

### Stop Services
```bash
./deploy.sh down
# or
make down
```

### Complete Cleanup (Removes Volumes)
```bash
make clean
```

### Remove Networks
```bash
docker network rm oiparweave_oip-network
```

This deployment system gives you flexibility to choose the right architecture for your needs while maintaining consistency across different environments. 