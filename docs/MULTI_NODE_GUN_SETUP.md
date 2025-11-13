# Multi-Node GUN Setup Guide

## Overview

When running multiple OIP nodes on the same machine, each node has its own isolated Docker network and GUN relay service. This guide explains how to connect them for cross-node synchronization.

## Architecture

Each OIP node has:
- **Docker Network**: `${COMPOSE_PROJECT_NAME}_oip-network`
- **GUN Relay Container**: `${COMPOSE_PROJECT_NAME}-gun-relay-1`
- **GUN Relay Port**: Configurable via `GUN_RELAY_PORT` (default: 8765)

## Connecting Multiple Nodes

### Option 1: Localhost with Exposed Ports (Recommended)

**Best for**: Development and testing on same machine

```bash
# Node 1 (.env)
COMPOSE_PROJECT_NAME=fitnessally
GUN_RELAY_PORT=8765
GUN_EXTERNAL_PEERS=wss://localhost:8765/gun

# Node 2 (.env)
COMPOSE_PROJECT_NAME=other-project
GUN_RELAY_PORT=8865
GUN_EXTERNAL_PEERS=wss://localhost:8765/gun,wss://localhost:8865/gun
```

**How it works**:
- Each node exposes its GUN relay port to the host
- `GUN_EXTERNAL_PEERS` uses `localhost` to reference other nodes' exposed ports
- WebSocket protocol (`wss://`) is used for GUN peer synchronization

### Option 2: Docker Container Names (Advanced)

**Best for**: Containers on shared Docker network

```bash
# Requires containers to be on same Docker network
# Or use Docker's default bridge network

# Node 1
GUN_EXTERNAL_PEERS=wss://fitnessally-gun-relay-1:8765/gun

# Node 2  
GUN_EXTERNAL_PEERS=wss://other-project-gun-relay-1:8765/gun
```

**Note**: Docker networks are isolated by default. Containers need to be on the same network or use host networking.

### Option 3: External GUN Relays

**Best for**: Production multi-server deployments

```bash
# Connect to external GUN relays
GUN_EXTERNAL_PEERS=wss://gun-us.herokuapp.com/gun,wss://gun-eu.herokuapp.com/gun
```

## Port Configuration

### Recommended Port Allocation

| Node | GUN_RELAY_PORT | Main API Port | Notes |
|------|----------------|---------------|-------|
| Node 1 | 8765 | 3005 | Default |
| Node 2 | 8865 | 3105 | +100 offset |
| Node 3 | 8965 | 3205 | +200 offset |

### Example Multi-Node Setup

```bash
# ~/projects/fitnessally/oip-arweave-indexer/.env
COMPOSE_PROJECT_NAME=fitnessally
PORT=3005
GUN_RELAY_PORT=8765
GUN_EXTERNAL_PEERS=wss://localhost:8865/gun  # Reference Node 2

# ~/projects/other-project/oip-arweave-indexer/.env
COMPOSE_PROJECT_NAME=other-project
PORT=3105
GUN_RELAY_PORT=8865
GUN_EXTERNAL_PEERS=wss://localhost:8765/gun  # Reference Node 1
```

## Important Notes

### GUN_PEERS vs GUN_EXTERNAL_PEERS

- **`GUN_PEERS`**: HTTP API endpoint for OIP→GUN communication (internal)
  - Format: `http://gun-relay:8765`
  - Used by `GunHelper` class for HTTP API calls
  - Stays as `http://gun-relay:8765` (internal Docker network)

- **`GUN_EXTERNAL_PEERS`**: WebSocket URLs for GUN peer protocol (external sync)
  - Format: `wss://host:port/gun` or `ws://host:port/gun`
  - Used by GUN relay for peer-to-peer synchronization
  - Can reference other nodes' relays

### Network Isolation

Docker Compose creates isolated networks per project:
- `fitnessally_oip-network` (Node 1)
- `other-project_oip-network` (Node 2)

Containers in different networks **cannot** communicate directly. Use:
- **Localhost**: Expose ports and use `localhost` in `GUN_EXTERNAL_PEERS`
- **Shared Network**: Connect containers to a shared Docker network
- **Host Network**: Use `network_mode: host` (not recommended)

## Verification

### Check GUN Relay Status

```bash
# Check if GUN relay is accessible
curl http://localhost:8765/get?soul=test

# Check GUN sync status
curl http://localhost:3005/api/health/gun-sync
```

### Test Cross-Node Sync

1. **Publish record on Node 1**:
   ```bash
   curl -X POST 'http://localhost:3005/api/records/newRecord?storage=gun&recordType=post' \
     -H 'Authorization: Bearer YOUR_TOKEN' \
     -H 'Content-Type: application/json' \
     -d '{"basic":{"name":"Test Sync"}}'
   ```

2. **Check Node 2** (wait 5 minutes for sync):
   ```bash
   curl 'http://localhost:3105/api/records?source=gun&search=Test%20Sync'
   ```

## Troubleshooting

### Records Not Syncing

1. **Check GUN_EXTERNAL_PEERS**:
   ```bash
   docker exec fitnessally-oip-gpu-1 env | grep GUN_EXTERNAL_PEERS
   ```

2. **Check GUN Relay Logs**:
   ```bash
   docker logs fitnessally-gun-relay-1 | tail -50
   ```

3. **Verify Port Exposure**:
   ```bash
   docker ps | grep gun-relay
   # Should show: 0.0.0.0:8765->8765/tcp
   ```

### Connection Refused

- Ensure `GUN_RELAY_PORT` is exposed in `docker-compose.yml`
- Verify port is not already in use: `lsof -i :8765`
- Check firewall settings

### WebSocket Connection Failed

- Use `wss://` (secure) or `ws://` (insecure) protocol
- Include `/gun` path suffix
- Verify port matches `GUN_RELAY_PORT` setting

