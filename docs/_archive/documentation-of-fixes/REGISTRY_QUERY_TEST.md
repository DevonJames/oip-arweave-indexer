# Registry Query Test

## Test if Registry Entry Exists

After publishing a record, test if the registry entry was stored:

```bash
# Test the specific registry entry path
curl 'http://localhost:8865/get?soul=oip:registry:index:image:647f79c2a338:image001' | jq

# If that works, the entry exists but parent query doesn't return it
# This means GUN isn't creating parent-child relationships automatically
```

## The Real Issue

GUN stores nodes at full paths like `oip:registry:index:image:647f79c2a338:image001`, but the parent node `oip:registry:index:image` doesn't automatically have properties pointing to children.

## Solution Options

1. **Store references on parent node** - When registering, also update the parent node
2. **Use GUN's `.map()`** - Traverse all nodes under a path prefix
3. **Change storage structure** - Store registry entries differently

## Quick Fix: Check Direct Entry

```bash
# Check if the registry entry exists at full path
curl 'http://localhost:8865/get?soul=oip:registry:index:image:647f79c2a338:image001' | jq
```

If this returns data, the entry exists but parent query won't find it because GUN doesn't create parent-child relationships automatically.

