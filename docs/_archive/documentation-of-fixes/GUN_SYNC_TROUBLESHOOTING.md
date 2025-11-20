# GUN Sync Troubleshooting Guide

## Problem: Records Not Syncing Between Nodes

If records are published on one node but don't appear on other nodes after 10+ minutes, follow these steps:

## Step 1: Verify GUN Sync Service is Running

The GUN sync service runs in the **main OIP application**, not in the gun-relay-server. Check if it's running:

```bash
# Check main OIP service logs for sync service startup
docker logs fitnessally-oip-gpu-1 | grep -i "GUN Sync Service"

# Should see:
# 🚀 GUN Sync Service initialized: { syncInterval: 300000, ... }
# ✅ GUN Record Sync Service started successfully
```

If you don't see these messages, the sync service isn't running. Check:
- `GUN_SYNC_ENABLED` is not set to `false` in `.env`
- The main OIP service is running (not just gun-relay)

## Step 2: Verify GUN Peer Connections

The gun-relay-server connects to peers via WebSocket. Check if connections are established:

```bash
# Check gun-relay logs for peer connection status
docker logs fitnessally-gun-relay-1 | grep -i "peer\|connected"

# Should see:
# 🌐 GUN peers configured: ws://localhost:8785/gun, ws://localhost:8765/gun
# 🔗 Connected to 2 external peer(s) for synchronization
```

**Important:** The "Connected" message means the configuration is correct, but doesn't guarantee WebSocket connections are actually working.

## Step 3: Test WebSocket Connectivity

Test if WebSocket connections are actually working:

```bash
# Install wscat if needed
npm install -g wscat

# Test connection to each peer
wscat -c ws://localhost:8785/gun
wscat -c ws://localhost:8765/gun
wscat -c ws://localhost:8865/gun
```

If connections fail, check:
- Ports are exposed in `docker-compose.yml`
- Firewall isn't blocking WebSocket connections
- Services are running on correct ports

## Step 4: Check Registry Index Sync

The sync service reads from registry indexes. Check if indexes are being populated:

```bash
# Query registry index directly via GUN API
curl 'http://localhost:8785/get?soul=oip:registry:index:post' | jq

# Should return data if records exist
```

If indexes are empty on remote nodes, the registry isn't syncing.

## Step 5: Verify Record Storage

Check if records are actually stored in GUN:

```bash
# On the node where you published (rockhoppers)
curl 'http://localhost:8865/get?soul=647f79c2a338:post001' | jq

# On other nodes (should sync automatically)
curl 'http://localhost:8785/get?soul=647f79c2a338:post001' | jq
curl 'http://localhost:8765/get?soul=647f79c2a338:post001' | jq
```

## Step 6: Check Sync Service Logs

The sync service logs when it discovers records:

```bash
# Watch sync service logs
docker logs -f fitnessally-oip-gpu-1 | grep -i "sync\|discover"

# Should see messages like:
# 🔍 Discovered X new OIP records from other nodes
# 📥 Discovered post record: did:gun:... from node ...
# ✅ GUN sync: X/Y records synced
```

If you don't see discovery messages, the sync service isn't finding records.

## Step 7: Force a Sync Cycle

Manually trigger a sync to see what happens:

```bash
# Via health endpoint (if available)
curl -X POST 'http://localhost:3015/api/health/gun-sync/force' | jq

# Or check sync status
curl 'http://localhost:3015/api/health/gun-sync' | jq
```

## Common Issues and Fixes

### Issue 1: GUN_PEERS vs GUN_EXTERNAL_PEERS Confusion

**Problem:** Environment variable mismatch

**Fix:** 
- `GUN_EXTERNAL_PEERS` is set in `.env` (for documentation)
- `docker-compose.yml` maps it to `GUN_PEERS` for gun-relay service
- Both should use WebSocket URLs: `ws://localhost:PORT/gun`

### Issue 2: Registry Indexes Not Syncing

**Problem:** Records are stored but registry indexes aren't syncing to peers

**Possible Causes:**
1. GUN's radisk (file storage) isn't syncing registry data
2. Registry indexes are stored locally but not replicated
3. WebSocket connections aren't actually working

**Debug Steps:**
```bash
# Check if registry data exists locally
docker exec fitnessally-gun-relay-1 ls -la /app/data/

# Query registry directly
curl 'http://localhost:8785/get?soul=oip:registry:index:post' | jq
```

### Issue 3: Sync Service Not Discovering Records

**Problem:** Sync service runs but doesn't find records from other nodes

**Possible Causes:**
1. Registry indexes are empty on remote nodes
2. Records aren't being registered in registry
3. Node ID filtering is skipping records

**Debug Steps:**
```bash
# Check what the sync service sees
docker logs fitnessally-oip-gpu-1 | grep -i "registry\|discover"

# Check registry stats
curl 'http://localhost:3015/api/health/gun-sync' | jq '.registry'
```

### Issue 4: WebSocket Connections Not Working

**Problem:** Peers configured but not actually connected

**Symptoms:**
- Logs show "Connected to X peer(s)" but no data syncs
- WebSocket test fails

**Fix:**
1. Verify ports are exposed correctly in `docker-compose.yml`
2. Check if services are on same network (Docker Compose creates shared network)
3. Try using service names instead of `localhost`:
   ```bash
   GUN_EXTERNAL_PEERS=ws://fitnessally-gun-relay-1:8765/gun,ws://oip-gun-relay-1:8765/gun
   ```
   **Note:** This might not work if services are in different Docker Compose projects

## Step 8: Verify Complete Setup

Check all components are configured correctly:

```bash
# 1. GUN relay has peers configured
docker exec fitnessally-gun-relay-1 env | grep GUN_PEERS

# 2. Main OIP service has sync enabled
docker exec fitnessally-oip-gpu-1 env | grep GUN_SYNC

# 3. Sync service is running
docker logs fitnessally-oip-gpu-1 | grep "GUN Sync Service started"

# 4. Registry can access GUN
docker logs fitnessally-oip-gpu-1 | grep "OIP GUN Registry initialized"
```

## Expected Behavior

When everything works correctly:

1. **Publish record on rockhoppers:**
   - Record stored in rockhoppers GUN
   - Registry entry created in rockhoppers
   - Registry index updated in rockhoppers

2. **GUN WebSocket sync (automatic, within seconds):**
   - Record data synced to fitnessally GUN
   - Record data synced to oip-main GUN
   - Registry indexes synced to both nodes

3. **Sync service discovery (every 5 minutes):**
   - fitnessally sync service reads registry index
   - Discovers record from rockhoppers node
   - Fetches record data from local GUN
   - Indexes in fitnessally Elasticsearch

4. **Result:**
   - Record appears in fitnessally API
   - Record appears in oip-main API

## Quick Test

Run this complete test:

```bash
# 1. Publish test record on rockhoppers
curl -X POST 'http://localhost:3000/api/records/newRecord?storage=gun&recordType=post' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"basic":{"name":"Sync Test '$(date +%s)'"}}'

# 2. Note the DID from response
DID="did:gun:..."

# 3. Wait 30 seconds, then check GUN directly
curl "http://localhost:8865/get?soul=..." | jq  # rockhoppers (should work)
curl "http://localhost:8785/get?soul=..." | jq  # fitnessally (should sync)
curl "http://localhost:8765/get?soul=..." | jq  # oip-main (should sync)

# 4. Wait 5 minutes, then check APIs
curl 'http://localhost:3000/api/records?source=gun&search=Sync%20Test' | jq  # rockhoppers
curl 'http://localhost:3015/api/records?source=gun&search=Sync%20Test' | jq  # fitnessally
curl 'http://localhost:3005/api/records?source=gun&search=Sync%20Test' | jq  # oip-main
```

## Still Not Working?

If sync still doesn't work after following all steps:

1. **Check GUN version compatibility** - Ensure all nodes use same GUN version
2. **Check network isolation** - Docker networks might be isolated
3. **Check GUN radisk sync** - File-based sync might have issues
4. **Enable verbose logging** - Add debug logs to sync service
5. **Consider using GUN's public relays** - Test with known-working peers

## Alternative: Direct HTTP API Sync

If WebSocket sync isn't working, you could implement direct HTTP API calls between nodes, but this defeats the purpose of using GUN's P2P sync.

