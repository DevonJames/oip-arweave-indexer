# Multi-Node GUN Configuration Guide

## Your Current Setup

Based on your `docker ps` output, you have **3 OIP nodes** running:

| Node | Container Name | GUN Relay Port (Host) | GUN Relay Port (Container) |
|------|---------------|------------------------|---------------------------|
| **fitnessally** | `fitnessally-gun-relay-1` | `8785` | `8765` |
| **rockhoppers** | `rockhoppers-gun-relay-1` | `8865` | `8765` |
| **oip** | `oip-gun-relay-1` | `8765` | `8765` |

## How GUN Peer Connections Work

GUN uses **WebSocket** protocol for peer-to-peer synchronization. When you set `web: server` in GUN configuration, it automatically exposes WebSocket endpoints at `/gun` path.

**Important**: GUN peers use WebSocket URLs (`ws://` or `wss://`), NOT HTTP URLs.

## Configuration

### For fitnessally Node

Edit `~/Desktop/development/fitnessally/oip-arweave-indexer/.env`:

```bash
# GUN Configuration
GUN_RELAY_PORT=8785
GUN_EXTERNAL_PEERS=ws://localhost:8865/gun,ws://localhost:8765/gun
```

This connects fitnessally to:
- rockhoppers node (port 8865)
- oip node (port 8765)

### For rockhoppers Node

Edit `~/Desktop/development/rockhoppers/oip-arweave-indexer/.env`:

```bash
# GUN Configuration
GUN_RELAY_PORT=8865
GUN_EXTERNAL_PEERS=ws://localhost:8785/gun,ws://localhost:8765/gun
```

This connects rockhoppers to:
- fitnessally node (port 8785)
- oip node (port 8765)

### For oip Node

Edit `~/Desktop/development/oip/oip-arweave-indexer/.env`:

```bash
# GUN Configuration
GUN_RELAY_PORT=8765
GUN_EXTERNAL_PEERS=ws://localhost:8785/gun,ws://localhost:8865/gun
```

This connects oip to:
- fitnessally node (port 8785)
- rockhoppers node (port 8865)

## WebSocket URL Format

GUN peer URLs follow this format:
```
ws://host:port/gun
```

Where:
- `ws://` = WebSocket protocol (use `wss://` for secure/HTTPS)
- `host` = `localhost` (for same-machine nodes) or IP address
- `port` = The **exposed host port** (not container port)
- `/gun` = GUN's WebSocket endpoint path

## Applying Configuration

After updating `.env` files:

1. **Restart GUN relay services**:
   ```bash
   # For fitnessally
   cd ~/Desktop/development/fitnessally/oip-arweave-indexer
   docker restart fitnessally-gun-relay-1
   
   # For rockhoppers
   cd ~/Desktop/development/rockhoppers/oip-arweave-indexer
   docker restart rockhoppers-gun-relay-1
   
   # For oip
   cd ~/Desktop/development/oip/oip-arweave-indexer
   docker restart oip-gun-relay-1
   ```

2. **Check GUN relay logs** to verify peer connections:
   ```bash
   docker logs fitnessally-gun-relay-1 | tail -20
   ```

   You should see:
   ```
   🌐 GUN peers configured: ws://localhost:8865/gun, ws://localhost:8765/gun
   🔗 Connected to 2 external peer(s) for synchronization
   ```

## Verification

### Test Peer Connection

1. **Publish a record on fitnessally**:
   ```bash
   curl -X POST 'http://localhost:3015/api/records/newRecord?storage=gun&recordType=post' \
     -H 'Authorization: Bearer YOUR_TOKEN' \
     -H 'Content-Type: application/json' \
     -d '{"basic":{"name":"Test Multi-Node Sync"}}'
   ```

2. **Check rockhoppers** (wait 5 minutes for sync):
   ```bash
   curl 'http://localhost:3000/api/records?source=gun&search=Test%20Multi-Node'
   ```

3. **Check oip**:
   ```bash
   curl 'http://localhost:3005/api/records?source=gun&search=Test%20Multi-Node'
   ```

## Troubleshooting

### Peers Not Connecting

1. **Check if ports are exposed**:
   ```bash
   docker ps | grep gun-relay
   # Should show: 0.0.0.0:8785->8765/tcp
   ```

2. **Test WebSocket connection** (from host):
   ```bash
   # Install wscat if needed: npm install -g wscat
   wscat -c ws://localhost:8785/gun
   ```

3. **Check GUN relay logs**:
   ```bash
   docker logs fitnessally-gun-relay-1 | grep -i peer
   ```

### Firewall Issues

If nodes are on different machines:
- Use `wss://` (secure WebSocket) if HTTPS is required
- Ensure firewall allows WebSocket connections on the exposed ports
- Use machine IP addresses instead of `localhost`:
  ```bash
  GUN_EXTERNAL_PEERS=ws://192.168.1.100:8785/gun
  ```

## Notes

- **Sync Delay**: Records sync every 5 minutes (configurable via `GUN_SYNC_INTERVAL`)
- **Network Isolation**: Docker networks are isolated per project, so use `localhost` with exposed ports
- **Data Redundancy**: With multiple peers, records are replicated across nodes automatically
- **Performance**: More peers = more network traffic, but better redundancy

