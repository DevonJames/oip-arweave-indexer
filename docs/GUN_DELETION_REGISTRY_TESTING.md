# GUN Deletion Registry - Testing Guide

## Overview

The GUN Deletion Registry is a distributed system that tracks deleted GUN records across all OIP nodes. When a GUN record is deleted on one node, it's marked in the deletion registry, which syncs to all other nodes. During sync operations, if a node discovers a record that's marked as deleted, it will:

1. Skip indexing the record
2. Remove it from local storage (Elasticsearch, GUN, and OIP registry)
3. Prevent it from reappearing

This solves the problem where deleted GUN records would reappear after cross-node synchronization.

## Architecture Components

### 1. GunDeletionRegistry (`helpers/gunDeletionRegistry.js`)
- **markDeleted(did, deletedBy)**: Marks a record as deleted in the distributed registry
- **isDeleted(did)**: Checks if a record is marked as deleted
- **processLocalDeletion(did)**: Removes a record from local storage
- **getAllDeletedDIDs()**: Gets all deleted DIDs (for debugging)
- **getDeletionDetails(did)**: Gets deletion metadata (timestamp, deleted by, etc.)

### 2. Modified Delete Endpoint (`routes/records.js`)
- For `did:arweave:*` records: Uses blockchain delete messages (unchanged)
- For `did:gun:*` records: Marks in deletion registry instead of blockchain
- Returns `gunRegistryDeletion: true` to indicate registry-based deletion

### 3. Modified Sync Service (`helpers/gunSyncService.js`)
- Before processing discovered records, checks deletion registry
- Filters out any records marked as deleted
- Calls `processLocalDeletion()` on any deleted records found locally

### 4. OIP Registry Updates (`helpers/oipGunRegistry.js`)
- Added `unregisterOIPRecord(did)`: Removes record from node and global indexes

## Testing Scenarios

### Scenario 1: Delete a GUN Record and Verify Registry Entry

**Setup:**
- Multiple OIP nodes running (e.g., FitnessAlly, DevNode1, DevNode2)
- At least one GUN record exists on FitnessAlly

**Steps:**

1. **Create a test record (or use existing):**
```bash
# Assuming you have a record with DID: did:gun:647f79c2a338:workout_1763737200_y730bsfyh
curl -X GET "http://localhost:3000/api/records?did=did:gun:647f79c2a338:workout_1763737200_y730bsfyh" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

2. **Delete the record:**
```bash
curl -X POST "http://localhost:3000/api/records/deleteRecord" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "delete": {
      "did": "did:gun:647f79c2a338:workout_1763737200_y730bsfyh"
    }
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Record deleted successfully",
  "did": "did:gun:647f79c2a338:workout_1763737200_y730bsfyh",
  "deletedCount": 1,
  "blockchainDeletion": false,
  "gunRegistryDeletion": true,
  "propagationNote": "GUN deletion registry updated. Deletion will propagate to all nodes during sync."
}
```

3. **Verify deletion registry entry:**
```bash
# Use the CLI tool (see below) or check logs
# During next sync cycle, you should see:
# "📝 Marking did:gun:647f79c2a338:workout_1763737200_y730bsfyh as deleted in GUN deletion registry..."
# "✅ Deletion entry created in GUN registry: oip:deleted:records:did:gun:647f79c2a338:workout_1763737200_y730bsfyh"
```

4. **Verify record is deleted locally:**
```bash
curl -X GET "http://localhost:3000/api/records?did=did:gun:647f79c2a338:workout_1763737200_y730bsfyh" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Should return 404 or empty results
```

---

### Scenario 2: Verify Deletion Propagates to Other Nodes

**Setup:**
- Record deleted on Node A (FitnessAlly)
- Node B (DevNode1) still has the record

**Steps:**

1. **Before sync - Check Node B has the record:**
```bash
# On Node B (DevNode1)
curl -X GET "http://localhost:3001/api/records?did=did:gun:647f79c2a338:workout_1763737200_y730bsfyh" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Should return the record
```

2. **Wait for sync cycle (or trigger manually if you have a sync endpoint):**
```bash
# Sync happens automatically every 15 minutes (configurable via GUN_SYNC_INTERVAL)
# Watch Node B logs for:
# "🗑️ Checking X records against deletion registry..."
# "⚠️ Skipping deleted record: did:gun:647f79c2a338:workout_1763737200_y730bsfyh"
# "🗑️ Processing local deletion for did:gun:647f79c2a338:workout_1763737200_y730bsfyh..."
```

3. **After sync - Verify Node B no longer has the record:**
```bash
# On Node B (DevNode1)
curl -X GET "http://localhost:3001/api/records?did=did:gun:647f79c2a338:workout_1763737200_y730bsfyh" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Should return 404 or empty results
```

**Expected Behavior:**
- Node B discovers the deletion registry entry during sync
- Node B filters out the deleted record from sync
- Node B removes the record from local storage
- Record stays deleted on Node B even if other nodes haven't synced yet

---

### Scenario 3: Verify Record Doesn't Reappear After Multiple Sync Cycles

**Setup:**
- Record deleted on all nodes
- Multiple sync cycles occur

**Steps:**

1. **Delete record on Node A**
2. **Wait for sync cycle 1** - Node B removes record
3. **Wait for sync cycle 2** - Verify record still gone on both nodes
4. **Wait for sync cycle 3** - Verify record still gone on both nodes

**Expected Behavior:**
- Record stays deleted permanently
- Deletion registry persists across restarts
- No "resurrection" of deleted records

---

### Scenario 4: Verify Deletion Registry Syncs Across Nodes

**Setup:**
- 3+ nodes (FitnessAlly, DevNode1, DevNode2)
- Record exists on all nodes

**Steps:**

1. **Delete record on Node A (FitnessAlly)**
2. **Wait for Node B to sync** - Should discover deletion and remove locally
3. **Wait for Node C to sync** - Should also discover deletion and remove locally
4. **Verify deletion registry exists on all nodes:**

```bash
# Check logs on all nodes for:
# "✅ Deletion entry created in GUN registry: oip:deleted:records:did:gun:..."
```

**Expected Behavior:**
- Deletion registry syncs across all nodes via GUN
- All nodes eventually have the deletion entry
- All nodes eventually remove the record

---

## CLI Tools for Debugging

### Check Deletion Registry Status

```bash
# Add to package.json scripts or run directly:
node -e "
const { GunDeletionRegistry } = require('./helpers/gunDeletionRegistry');
const { GunHelper } = require('./helpers/gun');

const gunHelper = new GunHelper();
const registry = new GunDeletionRegistry(gunHelper);

(async () => {
  const stats = await registry.getStats();
  console.log('Deletion Registry Stats:', JSON.stringify(stats, null, 2));
})();
"
```

### Check if a Specific Record is Deleted

```bash
node -e "
const { GunDeletionRegistry } = require('./helpers/gunDeletionRegistry');
const { GunHelper } = require('./helpers/gun');

const did = 'did:gun:647f79c2a338:workout_1763737200_y730bsfyh';
const gunHelper = new GunHelper();
const registry = new GunDeletionRegistry(gunHelper);

(async () => {
  const isDeleted = await registry.isDeleted(did);
  const details = await registry.getDeletionDetails(did);
  console.log('Is Deleted:', isDeleted);
  console.log('Details:', JSON.stringify(details, null, 2));
})();
"
```

### List All Deleted DIDs

```bash
node -e "
const { GunDeletionRegistry } = require('./helpers/gunDeletionRegistry');
const { GunHelper } = require('./helpers/gun');

const gunHelper = new GunHelper();
const registry = new GunDeletionRegistry(gunHelper);

(async () => {
  const deletedDIDs = await registry.getAllDeletedDIDs();
  console.log('Deleted DIDs:', deletedDIDs);
  console.log('Total:', deletedDIDs.length);
})();
"
```

### Unmark a Record (For Testing/Recovery)

```bash
node -e "
const { GunDeletionRegistry } = require('./helpers/gunDeletionRegistry');
const { GunHelper } = require('./helpers/gun');

const did = 'did:gun:647f79c2a338:workout_1763737200_y730bsfyh';
const gunHelper = new GunHelper();
const registry = new GunDeletionRegistry(gunHelper);

(async () => {
  const success = await registry.unmarkDeleted(did);
  console.log('Unmark Success:', success);
})();
"
```

---

## Log Messages to Watch For

### Successful Deletion
```
📝 Marking did:gun:647f79c2a338:workout_1763737200_y730bsfyh as deleted in GUN deletion registry...
✅ Deletion entry created in GUN registry: oip:deleted:records:did:gun:647f79c2a338:workout_1763737200_y730bsfyh
✅ GUN record marked as deleted in registry
✅ Deletion will propagate to all nodes during sync
```

### Sync Filtering
```
🗑️ Checking 50 records against deletion registry...
⚠️ Skipping deleted record: did:gun:647f79c2a338:workout_1763737200_y730bsfyh
🗑️ Processing local deletion for did:gun:647f79c2a338:workout_1763737200_y730bsfyh...
  ✓ Removed from Elasticsearch
  ✓ Removed from local GUN storage
  ✓ Removed from OIP registry
✅ Local deletion processed for did:gun:647f79c2a338:workout_1763737200_y730bsfyh
✅ Filtered out 1 deleted records
```

### Sync Initialization
```
🚀 GUN Sync Service initialized: {
  syncInterval: 900000,
  cacheMaxAge: 3600000,
  nodeId: 'node-abc123',
  httpSyncEnabled: true,
  peerCount: 2,
  deletionRegistryEnabled: true
}
```

---

## Troubleshooting

### Problem: Record still reappears after deletion

**Check:**
1. Verify deletion registry entry exists:
   ```bash
   # Use CLI tool to check if DID is marked as deleted
   ```

2. Check if sync service is running:
   ```bash
   # Look for "🚀 GUN Sync Service initialized" in logs
   ```

3. Verify sync cycle is occurring:
   ```bash
   # Look for "🔄 Starting GUN sync cycle" every 15 minutes
   ```

4. Check for errors during deletion:
   ```bash
   # Look for "❌ Failed to mark record in deletion registry"
   ```

### Problem: Deletion not propagating to other nodes

**Check:**
1. Verify GUN peers are configured correctly:
   ```bash
   # Check GUN_PEERS environment variable
   echo $GUN_PEERS
   ```

2. Verify HTTP sync is working:
   ```bash
   # Look for "📡 Syncing from peer via HTTP" in logs
   ```

3. Check network connectivity between nodes:
   ```bash
   # Test HTTP connectivity
   curl http://other-node:8765/list?publisherHash=647f79c2a338
   ```

### Problem: Memory leak concerns

**Check:**
1. Verify cache clearing is happening:
   ```bash
   # Look for "🧹 Clearing processed records cache" every hour
   ```

2. Monitor process memory:
   ```bash
   # Use process monitoring tools
   pm2 monit
   # or
   docker stats
   ```

---

## Performance Considerations

1. **Deletion Registry Lookups**: The `isDeleted()` method first checks an in-memory index before querying GUN, making it fast.

2. **Sync Performance**: Filtering happens before processing, so deleted records don't incur the cost of Elasticsearch checks or indexing.

3. **Memory Management**: Deletion registry uses the same cache clearing strategy as the sync service (hourly cache clears).

4. **Network Traffic**: Deletion entries are small (just metadata), so they don't significantly impact sync bandwidth.

---

## Migration Notes

### Existing Deleted Records

If you have records that were deleted before implementing the deletion registry, they might reappear during sync. To handle this:

1. **Option A**: Re-delete them using the API (they'll be added to the deletion registry)
2. **Option B**: Manually add them to the deletion registry:

```bash
node -e "
const { GunDeletionRegistry } = require('./helpers/gunDeletionRegistry');
const { GunHelper } = require('./helpers/gun');

const dids = [
  'did:gun:647f79c2a338:workout_1',
  'did:gun:647f79c2a338:workout_2'
];

const gunHelper = new GunHelper();
const registry = new GunDeletionRegistry(gunHelper);

(async () => {
  for (const did of dids) {
    await registry.markDeleted(did, 'migration-script');
    console.log('Marked:', did);
  }
})();
"
```

---

## Comparison: Before vs After

### Before (Problem)
1. User deletes GUN record on Node A
2. Record removed from local Elasticsearch and GUN
3. Node B syncs and discovers the record from Node C
4. Node B indexes the record
5. Node A syncs and discovers the record from Node B
6. Record reappears on Node A ❌

### After (Solution)
1. User deletes GUN record on Node A
2. Record removed from local storage AND marked in deletion registry
3. Node B syncs and discovers the record from Node C
4. Node B checks deletion registry, finds it's deleted
5. Node B skips the record and removes it locally
6. Node A syncs - no records to discover (all nodes respect deletion)
7. Record stays deleted everywhere ✅

---

## Future Enhancements

1. **Deletion TTL**: Optionally expire deletion entries after a certain time (e.g., 90 days) to prevent the registry from growing indefinitely

2. **Deletion Audit Log**: Store more detailed deletion metadata (reason, IP address, etc.)

3. **Bulk Deletion API**: Endpoint to delete multiple records at once

4. **Deletion Recovery**: API endpoint to "undelete" records (remove from deletion registry)

5. **Admin Dashboard**: UI to view and manage deletion registry

---

## Security Considerations

1. **Ownership Verification**: Deletion still requires authentication and ownership verification (handled by `userOwnsRecord()` in the delete endpoint)

2. **Deletion Registry Security**: The deletion registry is stored in GUN using the same security model as other GUN data

3. **No Blockchain Bloat**: GUN deletions don't create blockchain transactions, reducing cost and complexity

4. **Cross-Node Trust**: Nodes trust each other's deletion registries (this is consistent with the existing trust model for GUN sync)

