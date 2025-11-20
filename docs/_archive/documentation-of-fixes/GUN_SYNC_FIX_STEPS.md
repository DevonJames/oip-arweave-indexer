# GUN Sync Fix Steps

## Current Issues

1. **Registry index doesn't exist** - `oip:registry:index:post` returns "Not found"
2. **Record DID is null** - Record stored in GUN has `oip.did: null`
3. **Records don't sync** - Other nodes timeout when querying records

## Step 1: Check Rockhoppers Logs

Check if registry registration succeeded:

```bash
# Check rockhoppers OIP service logs for registry registration
docker logs rockhoppers-oip-gpu-1 | grep -i "registry\|register\|GUN Sync"

# Look for:
# - "📝 Record registered in GUN registry for sync"
# - "❌ Failed to register OIP record"
# - "⚠️ Global gunSyncService not available"
```

## Step 2: Check if Sync Service is Running

```bash
# Check if GUN sync service started
docker logs rockhoppers-oip-gpu-1 | grep "GUN Sync Service started"

# Should see:
# 🚀 GUN Sync Service initialized
# ✅ GUN Record Sync Service started successfully
```

## Step 3: Fix DID Issue

The record is stored in GUN BEFORE the DID is set. We need to set the DID BEFORE storing.

**Fix:** Update `helpers/templateHelper.js` to set DID before publishing:

```javascript
// BEFORE publishing, set the DID
const soul = gunHelper.computeSoul(myPublicKey, options.localId, gunRecordData);
gunRecordData.oip.did = `did:gun:${soul}`;
gunRecordData.oip.didTx = `did:gun:${soul}`;

// THEN publish
const publishResult = await publisherManager.publish(gunRecordData, {...});
```

## Step 4: Verify GUN Peer Connections

Check if WebSocket connections are actually working:

```bash
# Test WebSocket connectivity
wscat -c ws://localhost:8865/gun
wscat -c ws://localhost:8785/gun
wscat -c ws://localhost:8765/gun
```

If connections fail, GUN sync won't work.

## Step 5: Check GUN Relay Configuration

Verify peer configuration is correct:

```bash
# Check rockhoppers GUN relay env
docker exec rockhoppers-gun-relay-1 env | grep GUN_PEERS

# Should show WebSocket URLs:
# GUN_PEERS=ws://localhost:8785/gun,ws://localhost:8765/gun
```

## Step 6: Test Registry Registration Manually

After fixing the DID issue, test if registry registration works:

```bash
# Publish a new test record
curl -X POST 'http://localhost:3000/api/records/newRecord?storage=gun&recordType=post' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"basic":{"name":"Registry Test"}}'

# Check if registry index exists
curl 'http://localhost:8865/get?soul=oip:registry:index:post' | jq
```

## Most Likely Root Causes

1. **DID is null** - Record stored before DID is set, so registry registration might fail
2. **GUN WebSocket sync not working** - Peers configured but not actually connected
3. **Registry registration failing silently** - Errors caught but not logged properly

## Quick Fixes to Try

1. **Set DID before storing** - Fix the order of operations
2. **Check GUN relay logs** - See if WebSocket connections are established
3. **Verify sync service is running** - Check if `global.gunSyncService` exists
4. **Test WebSocket connections** - Use `wscat` to verify connectivity

