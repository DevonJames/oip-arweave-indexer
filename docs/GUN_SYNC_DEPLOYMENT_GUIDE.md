# GUN Record Sync Deployment Guide

## Overview

This guide covers deploying the GUN record synchronization system for OIP nodes. The system enables automatic discovery and synchronization of GUN records (including private encrypted records) between multiple OIP instances.

## Quick Start

### 1. Environment Configuration

Copy the updated environment template:
```bash
cp "example env" .env
```

Configure the GUN sync settings in `.env`:
```bash
# GUN Sync Configuration
GUN_SYNC_ENABLED=true                    # Enable sync service
GUN_SYNC_INTERVAL=30000                  # Sync every 30 seconds
GUN_REGISTRY_ROOT=oip:registry           # Registry namespace
GUN_NODE_ID_OVERRIDE=node-production-1   # Optional: custom node ID
GUN_SYNC_PRIVATE_RECORDS=true            # Enable private record sync
GUN_SYNC_TRUSTED_NODES=                  # Optional: comma-separated trusted node IDs
GUN_EXTERNAL_PEERS=                      # Optional: external GUN peers for wider sync
```

### 2. Deploy Services

```bash
# Start with GUN sync enabled
docker-compose --profile standard up -d

# Verify services are running
docker-compose ps
```

### 3. Migrate Existing Records

Run the migration script to register existing GUN records:
```bash
# Dry run first (see what would be migrated)
node scripts/migrate-existing-gun-records.js --dry-run

# Perform actual migration
node scripts/migrate-existing-gun-records.js

# Migrate only records (skip users)
node scripts/migrate-existing-gun-records.js --records-only

# Migrate only users (skip records)  
node scripts/migrate-existing-gun-records.js --users-only
```

### 4. Verify Sync Status

Check sync service health:
```bash
curl http://localhost:3005/api/health/gun-sync
```

Expected response:
```json
{
  "service": "gun-sync",
  "status": "healthy",
  "running": true,
  "nodeId": "node-production-1",
  "metrics": {
    "totalDiscovered": 15,
    "totalSynced": 15,
    "successRate": "100%",
    "lastSyncAgo": "25s ago"
  },
  "registry": {
    "totalRecordsRegistered": 42,
    "recordsByType": {
      "conversationSession": 28,
      "media": 8,
      "post": 6
    }
  }
}
```

## Multi-Node Setup

### Node A Configuration (Production)

```bash
# .env for Node A
GUN_NODE_ID_OVERRIDE=node-production-main
GUN_EXTERNAL_PEERS=wss://gun-us.herokuapp.com/gun,wss://gun-eu.herokuapp.com/gun
GUN_SYNC_TRUSTED_NODES=node-production-backup,node-staging
```

### Node B Configuration (Backup)

```bash
# .env for Node B  
GUN_NODE_ID_OVERRIDE=node-production-backup
GUN_EXTERNAL_PEERS=wss://gun-us.herokuapp.com/gun,wss://gun-eu.herokuapp.com/gun
GUN_SYNC_TRUSTED_NODES=node-production-main,node-staging
```

### Shared GUN Network

For reliable cross-node sync, configure shared GUN peers:

```yaml
# docker-compose.override.yml
services:
  gun-relay:
    environment:
      - GUN_EXTERNAL_PEERS=wss://your-shared-gun-relay.com/gun
    # Optionally expose to external network
    ports:
      - "8765:8765"  # Make accessible to other nodes
```

## Sync Process Flow

### 1. Record Publishing (Local Node)

```
User publishes record → Arrays converted to JSON strings → Stored in GUN → 
Indexed in Elasticsearch (strings → arrays) → Registered in GUN registry
```

### 2. Record Discovery (Remote Node)

```
Sync service scans registry → Discovers new records → Fetches from GUN → 
Validates OIP structure → Decrypts if private → Converts format → 
Indexes in Elasticsearch
```

### 3. Private Record Handling

```
Encrypted record discovered → OIP metadata visible → Decryption attempted → 
If successful: format converted and indexed → If failed: skipped with warning
```

## Monitoring and Troubleshooting

### Health Monitoring

**Check sync status:**
```bash
curl http://localhost:3005/api/health/gun-sync
```

**Force immediate sync:**
```bash
curl -X POST http://localhost:3005/api/health/gun-sync/force
```

**Check registry statistics:**
```bash
# The health endpoint includes registry stats showing:
# - Total records registered by this node
# - Records by type (conversationSession, media, etc.)
# - Node ID and configuration
```

### Common Issues

#### **Sync Service Not Starting**
```bash
# Check logs
docker-compose logs oip

# Verify GUN relay is accessible
curl http://localhost:8765/health

# Check environment configuration
grep GUN_SYNC .env
```

#### **Records Not Syncing**
```bash
# Check if records are registered in registry
curl http://localhost:3005/api/health/gun-sync

# Verify GUN peers are connected
docker-compose logs gun-relay

# Check for sync errors in logs
docker-compose logs oip | grep "SYNC"
```

#### **Private Records Not Decrypting**
```bash
# Check encryption configuration
grep GUN_ENABLE_ENCRYPTION .env

# Verify trusted nodes configuration
grep GUN_SYNC_TRUSTED_NODES .env

# Check decryption logs
docker-compose logs oip | grep "decrypt"
```

### Performance Tuning

#### **Sync Interval Adjustment**
```bash
# For high-frequency sync (every 10 seconds)
GUN_SYNC_INTERVAL=10000

# For low-frequency sync (every 5 minutes)
GUN_SYNC_INTERVAL=300000
```

#### **Trusted Nodes Configuration**
```bash
# Only sync with specific trusted nodes
GUN_SYNC_TRUSTED_NODES=node-prod-1,node-prod-2,node-staging

# Disable private record sync for security
GUN_SYNC_PRIVATE_RECORDS=false
```

## Security Considerations

### **Current Security Model**

⚠️ **Important Security Notes:**

1. **Shared Encryption Key**: All OIP nodes use the same encryption key
   - Any OIP node can decrypt any private record
   - This is a design limitation, not a bug

2. **Metadata Visibility**: Private records expose metadata
   - Record type, creator, timestamps are visible
   - Only the actual content (`data` field) is encrypted

3. **Trusted Nodes**: Configure trusted nodes to limit sync scope
   - Use `GUN_SYNC_TRUSTED_NODES` to restrict which nodes you sync with
   - Use `GUN_SYNC_PRIVATE_RECORDS=false` to disable private record sync

### **Recommended Production Settings**

```bash
# Conservative security settings
GUN_SYNC_PRIVATE_RECORDS=false           # Disable private record sync
GUN_SYNC_TRUSTED_NODES=known-node-1      # Only sync with known nodes
GUN_DECRYPT_FOREIGN_RECORDS=false        # Don't decrypt records from other nodes
```

```bash
# Full sync settings (for trusted environments)
GUN_SYNC_PRIVATE_RECORDS=true            # Enable private record sync
GUN_SYNC_TRUSTED_NODES=                  # Trust all nodes (empty = trust all)
GUN_EXTERNAL_PEERS=wss://your-gun-relay.com/gun  # Connect to shared relay
```

## Testing the Sync System

### 1. Single Node Test

```bash
# Start services
docker-compose --profile standard up -d

# Publish a test record
curl -X POST 'http://localhost:3005/api/records/newRecord?recordType=post&storage=gun&localId=sync-test-001' \
  -H 'Content-Type: application/json' \
  -d '{"basic":{"name":"Sync Test Post","description":"Testing sync system"},"post":{"articleText":"Hello from sync test!"}}'

# Check it appears in health stats
curl http://localhost:3005/api/health/gun-sync
```

### 2. Multi-Node Test

**Setup two nodes with different configurations:**

**Node A:**
```bash
# Terminal 1 - Node A
export GUN_NODE_ID_OVERRIDE=test-node-a
export PORT=3005
docker-compose --profile standard up
```

**Node B:**
```bash
# Terminal 2 - Node B  
export GUN_NODE_ID_OVERRIDE=test-node-b
export PORT=3006
export ELASTICSEARCH_PORT=9201
docker-compose --profile standard up
```

**Test sync between nodes:**
```bash
# Publish on Node A
curl -X POST 'http://localhost:3005/api/records/newRecord?recordType=post&storage=gun&localId=multi-node-test' \
  -H 'Content-Type: application/json' \
  -d '{"basic":{"name":"Multi-Node Test"},"post":{"articleText":"Testing cross-node sync"}}'

# Wait 30 seconds for sync cycle

# Check if record appears on Node B
curl 'http://localhost:3006/api/records?source=gun&search=Multi-Node%20Test'
```

## Troubleshooting Guide

### **Logs to Monitor**

```bash
# General sync activity
docker-compose logs oip | grep "\[SYNC\]"

# Registry operations
docker-compose logs oip | grep "Registry"

# Private record operations  
docker-compose logs oip | grep "private"

# GUN relay connectivity
docker-compose logs gun-relay
```

### **Common Error Patterns**

#### **"Failed to register record in GUN registry"**
- **Cause**: GUN relay not accessible or network issues
- **Solution**: Check `docker-compose logs gun-relay` and verify `GUN_PEERS` configuration

#### **"Failed to decrypt private record"**
- **Cause**: Wrong encryption key or corrupted data
- **Solution**: Verify `GUN_ENABLE_ENCRYPTION=true` and check encryption key consistency

#### **"Invalid OIP record structure"**
- **Cause**: Non-OIP data in GUN network or corrupted records
- **Solution**: This is normal - the system filters out invalid records automatically

#### **"Sync service not running"**
- **Cause**: `GUN_SYNC_ENABLED=false` or startup failure
- **Solution**: Check environment config and server startup logs

## Performance Monitoring

### **Key Metrics to Watch**

1. **Success Rate**: Should be >90% for healthy sync
2. **Sync Latency**: Average sync time should be <5 seconds
3. **Error Rate**: Should be <10 errors per hour
4. **Registry Size**: Monitor growth of registry for capacity planning

### **Performance Optimization**

```bash
# Reduce sync frequency for lower load
GUN_SYNC_INTERVAL=60000  # 1 minute

# Limit to specific record types (future enhancement)
GUN_SYNC_RECORD_TYPES=conversationSession,media

# Disable private record sync for better performance
GUN_SYNC_PRIVATE_RECORDS=false
```

## Migration Scenarios

### **Scenario 1: New Node Joining Network**

1. Deploy new node with sync enabled
2. Run migration script to register existing records
3. Sync service automatically discovers records from other nodes
4. Users can access their records from any node

### **Scenario 2: Existing Node Migration**

1. Deploy new node with same configuration
2. Copy user data manually (for security)
3. Run migration script on both nodes
4. Verify sync between nodes
5. Switch traffic to new node

### **Scenario 3: Development/Staging Sync**

1. Configure staging node with production GUN peers
2. Set trusted nodes to production only
3. Enable read-only sync (don't publish from staging)
4. Test with production data in staging environment

This comprehensive sync system provides robust, automatic synchronization of GUN records between OIP nodes while maintaining data format consistency and supporting both public and private encrypted records.
