# GUN Data Restore and Multi-Node Sync Guide

This guide walks you through:
1. Testing GUN data restore on your secondary node (oip)
2. Resetting GUN data on your main node (fitnessally)
3. Ensuring GUN network syncing works between nodes

## Prerequisites

- Both `fitnessally` and `oip` nodes are running
- You have a recent backup of GUN records from fitnessally
- Both nodes have Elasticsearch running and accessible

## Step 1: Verify Current Backup (if needed)

If you don't have a recent backup, create one from fitnessally:

```bash
cd ~/Desktop/development/fitnessally/oip-arweave-indexer
make backup-gun-records
```

This will create a file like `gun-backup-YYYY-MM-DDTHH-MM-SS.json` in your project directory.

**Note the filename** - you'll need it for the restore step.

## Step 2: Test Restore on oip Node

### 2.1: Navigate to oip project directory

```bash
cd ~/Desktop/development/oip/oip-arweave-indexer
```

### 2.2: Copy backup file to oip directory

```bash
# Replace with your actual backup filename
cp ~/Desktop/development/fitnessally/oip-arweave-indexer/data/gun-backup-*.json ./data/
```

Or if the backup is in the project root:
```bash
cp ~/Desktop/development/fitnessally/oip-arweave-indexer/gun-backup-*.json ./
```

### 2.3: Restore to Elasticsearch only (first test)

```bash
# Replace with your actual backup filename
make restore-gun-records FILE=./data/gun-backup-YYYY-MM-DDTHH-MM-SS.json
```

**Verify the restore worked:**
```bash
# Check oip Elasticsearch for GUN records
docker exec oip-elasticsearch-1 curl -s 'http://localhost:9200/records/_count?q=oip.storage:gun' | jq
```

You should see a count matching your backup.

### 2.4: Republish to GUN network (full restore)

Once Elasticsearch restore is verified, republish to GUN:

```bash
# Replace with your actual backup filename
make restore-gun-records FILE=./data/gun-backup-YYYY-MM-DDTHH-MM-SS.json REPUBLISH=true
```

**Verify records are in GUN:**
```bash
# Check oip GUN relay logs
docker logs oip-gun-relay-1 | tail -20

# Query oip API for GUN records
curl 'http://localhost:3005/api/records?source=gun&limit=10' | jq
```

## Step 3: Configure GUN Peer Syncing

### 3.1: Configure fitnessally to sync with oip

Edit `~/Desktop/development/fitnessally/oip-arweave-indexer/.env`:

```bash
# GUN Configuration
GUN_RELAY_PORT=8785
GUN_EXTERNAL_PEERS=ws://localhost:8765/gun
```

**Note:** Only connect to oip initially. We'll add rockhoppers later if needed.

### 3.2: Configure oip to sync with fitnessally

Edit `~/Desktop/development/oip/oip-arweave-indexer/.env`:

```bash
# GUN Configuration
GUN_RELAY_PORT=8765
GUN_EXTERNAL_PEERS=ws://localhost:8785/gun
```

### 3.3: Restart GUN relay services

```bash
# Restart fitnessally GUN relay
cd ~/Desktop/development/fitnessally/oip-arweave-indexer
docker restart fitnessally-gun-relay-1

# Restart oip GUN relay
cd ~/Desktop/development/oip/oip-arweave-indexer
docker restart oip-gun-relay-1
```

### 3.4: Verify peer connections

```bash
# Check fitnessally GUN relay logs
docker logs fitnessally-gun-relay-1 | tail -20
# Should see: 🌐 GUN peers configured: ws://localhost:8765/gun

# Check oip GUN relay logs
docker logs oip-gun-relay-1 | tail -20
# Should see: 🌐 GUN peers configured: ws://localhost:8785/gun
```

## Step 4: Test Syncing Before Reset

Before resetting fitnessally's GUN data, verify syncing works:

### 4.1: Create a test record on oip

```bash
# Use your actual auth token
curl -X POST 'http://localhost:3005/api/records/newRecord?storage=gun&recordType=post' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"basic":{"name":"Test Sync Before Reset","description":"Testing GUN sync"}}'
```

### 4.2: Wait for sync (5 minutes)

GUN sync runs every 5 minutes by default. Wait, then check fitnessally:

```bash
# Check fitnessally for the test record
curl 'http://localhost:3015/api/records?source=gun&search=Test%20Sync%20Before%20Reset' | jq
```

**If the record appears on fitnessally**, syncing is working! ✅

**If it doesn't appear**, check logs:
```bash
docker logs fitnessally-oip-gpu-1 | grep -i "gun\|sync" | tail -20
docker logs fitnessally-gun-relay-1 | tail -30
```

## Step 5: Reset GUN Data on fitnessally

**⚠️ WARNING: This will delete all GUN data on fitnessally. Make sure:**
- ✅ Backup is verified on oip
- ✅ Syncing is working (Step 4 passed)
- ✅ You have a backup file saved somewhere safe

### 5.1: Stop fitnessally GUN relay

```bash
cd ~/Desktop/development/fitnessally/oip-arweave-indexer
docker stop fitnessally-gun-relay-1
```

### 5.2: Clear GUN data volume

```bash
# Find the volume name
docker volume ls | grep fitnessally.*gundata

# Remove the volume (replace with actual volume name)
docker volume rm fitnessally_gundata

# Or if using named volume, remove it directly
docker volume rm fitnessally_gundata
```

**Alternative:** If the volume is mounted to a host directory, clear it:
```bash
# Check docker-compose.yml for volume mount path
# Then clear that directory
rm -rf /path/to/gun/data/*
```

### 5.3: Recreate GUN relay service

```bash
cd ~/Desktop/development/fitnessally/oip-arweave-indexer
docker-compose up -d gun-relay
```

### 5.4: Verify GUN data is empty

```bash
# Check GUN relay logs (should show empty/clean start)
docker logs fitnessally-gun-relay-1 | tail -20

# Check that no GUN records exist locally
docker exec fitnessally-gun-relay-1 ls -la /app/data/
# Should be empty or minimal
```

## Step 6: Verify Syncing Repopulates fitnessally

### 6.1: Wait for sync cycle (5 minutes)

GUN sync runs automatically. Wait 5 minutes for the sync cycle to complete.

### 6.2: Check if records synced from oip

```bash
# Check fitnessally Elasticsearch for GUN records
docker exec fitnessally-elasticsearch-1 curl -s 'http://localhost:9200/records/_count?q=oip.storage:gun' | jq

# Query fitnessally API
curl 'http://localhost:3015/api/records?source=gun&limit=10' | jq
```

**Expected:** Records should start appearing as they sync from oip.

### 6.3: Monitor sync progress

```bash
# Watch fitnessally GUN relay logs for sync activity
docker logs -f fitnessally-gun-relay-1

# Watch fitnessally OIP service logs
docker logs -f fitnessally-oip-gpu-1 | grep -i "gun\|sync"
```

### 6.4: Verify record count matches

After waiting 10-15 minutes (multiple sync cycles):

```bash
# Count on oip
docker exec oip-elasticsearch-1 curl -s 'http://localhost:9200/records/_count?q=oip.storage:gun' | jq

# Count on fitnessally
docker exec fitnessally-elasticsearch-1 curl -s 'http://localhost:9200/records/_count?q=oip.storage:gun' | jq
```

**Expected:** Counts should match (or be very close).

## Step 7: Test Bidirectional Sync

### 7.1: Create a record on fitnessally

```bash
curl -X POST 'http://localhost:3015/api/records/newRecord?storage=gun&recordType=post' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"basic":{"name":"Test Sync From Fitnessally","description":"Testing bidirectional sync"}}'
```

### 7.2: Wait and verify on oip

```bash
# Wait 5 minutes, then check
curl 'http://localhost:3005/api/records?source=gun&search=Test%20Sync%20From%20Fitnessally' | jq
```

**If the record appears on oip**, bidirectional syncing is working! ✅

## Troubleshooting

### Records Not Syncing

1. **Check GUN peer configuration:**
   ```bash
   docker exec fitnessally-gun-relay-1 env | grep GUN_PEERS
   docker exec oip-gun-relay-1 env | grep GUN_PEERS
   ```

2. **Check WebSocket connectivity:**
   ```bash
   # Install wscat if needed: npm install -g wscat
   wscat -c ws://localhost:8765/gun
   wscat -c ws://localhost:8785/gun
   ```

3. **Check GUN relay logs for errors:**
   ```bash
   docker logs fitnessally-gun-relay-1 | grep -i error
   docker logs oip-gun-relay-1 | grep -i error
   ```

4. **Verify ports are exposed:**
   ```bash
   docker ps | grep gun-relay
   # Should show: 0.0.0.0:8785->8765/tcp and 0.0.0.0:8765->8765/tcp
   ```

### Sync Delay

- GUN sync runs every 5 minutes by default
- Large datasets may take multiple sync cycles
- Check `GUN_SYNC_INTERVAL` environment variable if you want to adjust

### Volume Issues

If you can't remove the volume:
```bash
# Stop all containers using the volume
docker stop fitnessally-gun-relay-1 fitnessally-oip-gpu-1

# Remove volume
docker volume rm fitnessally_gundata

# Restart services
docker-compose up -d
```

## Summary Checklist

- [ ] Backup created from fitnessally
- [ ] Backup restored to oip Elasticsearch
- [ ] Backup republished to oip GUN network
- [ ] GUN peer configuration set on both nodes
- [ ] GUN relay services restarted
- [ ] Peer connections verified in logs
- [ ] Test record synced from oip → fitnessally
- [ ] fitnessally GUN data cleared
- [ ] Records syncing back from oip → fitnessally
- [ ] Bidirectional sync verified (fitnessally → oip)

## Next Steps

Once everything is working:
1. Monitor sync for 24 hours to ensure stability
2. Consider adding rockhoppers node to the sync network
3. Set up automated backups on a schedule
4. Document your GUN sync configuration for future reference

