# GUN Sync Debug Steps

## The Issue

You're querying `oip:registry:index:post:647f79c2a338:post001` directly, but GUN stores data hierarchically. The registry entry might not exist at that exact path, or it might be stored differently.

## Correct Way to Check

### Step 1: Check the Parent Registry Index

Instead of querying the specific entry, query the parent index to see all entries:

```bash
# On rockhoppers (where record was published)
curl 'http://localhost:8865/get?soul=oip:registry:index:post' | jq

# On fitnessally (should sync)
curl 'http://localhost:8785/get?soul=oip:registry:index:post' | jq

# On oip-main (should sync)
curl 'http://localhost:8765/get?soul=oip:registry:index:post' | jq
```

**Expected:** The parent path should return an object with all child entries. If it's empty on remote nodes, the registry isn't syncing.

### Step 2: Check the Actual Record

Check if the actual record (not registry entry) exists:

```bash
# On rockhoppers
curl 'http://localhost:8865/get?soul=647f79c2a338:post001' | jq

# On fitnessally (should sync automatically via GUN WebSocket)
curl 'http://localhost:8785/get?soul=647f79c2a338:post001' | jq

# On oip-main
curl 'http://localhost:8765/get?soul=647f79c2a338:post001' | jq
```

**Expected:** The record itself should sync automatically via GUN's WebSocket protocol (within seconds). If it doesn't, GUN peer connections aren't working.

### Step 3: Check Registry Entry Format

The registry entry is stored at `oip:registry:index:post:647f79c2a338:post001`, but the `/get` endpoint expects `data`, `meta`, `oip` structure. Registry entries might be stored directly.

Try checking what's actually stored:

```bash
# Check rockhoppers GUN relay logs when you query
docker logs -f rockhoppers-gun-relay-1

# Then query the registry entry
curl 'http://localhost:8865/get?soul=oip:registry:index:post:647f79c2a338:post001' | jq
```

Look at the logs to see what GUN actually returns.

## The Real Problem

Based on your logs showing "No data found" for registry indexes, the issue is likely:

1. **Registry indexes aren't syncing** - GUN's WebSocket sync might not be syncing nested graph paths properly
2. **Registry entries aren't being created** - The registration might be failing silently
3. **Sync service can't discover records** - Because registry indexes are empty

## Quick Test: Verify Registry Registration

Check if registry entries are being created on the publishing node:

```bash
# On rockhoppers, check if registry entry exists
docker exec rockhoppers-oip-gpu-1 node -e "
const { GunHelper } = require('./helpers/gun');
const gun = new GunHelper();
// Check parent index
gun.getRecord('oip:registry:index:post').then(r => {
  if (r) {
    console.log('Registry index keys:', Object.keys(r));
    console.log('Sample entry:', JSON.stringify(r, null, 2));
  } else {
    console.log('Registry index is empty');
  }
}).catch(e => console.error('Error:', e.message));
"
```

## Alternative: Check GUN Data Directory

If GUN is using radisk (file storage), check what's actually stored:

```bash
# Check rockhoppers GUN data
docker exec rockhoppers-gun-relay-1 ls -la /app/data/

# Look for registry-related files
docker exec rockhoppers-gun-relay-1 find /app/data -name '*registry*' -o -name '*post*'
```

## Most Likely Solution

The issue is that **GUN's nested graph paths aren't syncing properly**. The registry stores entries at paths like:
- `oip:registry:index:post:647f79c2a338:post001`

But when you query the parent `oip:registry:index:post`, GUN should return all children. If it doesn't sync, the sync service can't discover records.

**Potential fixes:**
1. Ensure GUN WebSocket connections are actually working (test with `wscat`)
2. Check if GUN's radisk is syncing properly
3. Consider storing registry entries differently (flat structure instead of nested)
4. Add explicit sync triggers for registry data

