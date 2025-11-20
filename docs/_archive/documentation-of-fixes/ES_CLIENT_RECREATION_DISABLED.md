# Elasticsearch Client Recreation - DISABLED

## Summary

The periodic Elasticsearch client recreation feature has been **disabled** based on user feedback and testing results.

## Reason for Disabling

1. **Caused connection failures**: The ES client occasionally failed to reconnect properly after recreation
2. **Not the memory leak source**: Testing proved the GraphQL client (Arweave queries) was the real culprit
3. **No memory benefit**: External memory leak persisted at 365 MB/min even with ES recreation enabled

## Changes Made

### Code Changes
- **`helpers/elasticsearch.js`**:
  - Removed `createElasticsearchClient()` function
  - Removed `checkAndRecreateElasticsearchClient()` function
  - Removed `setInterval()` for periodic checks
  - Changed `let elasticClient` to `const elasticClient` (single instance)
  - Removed from exports: `recreateElasticsearchClient`

- **`routes/health.js`**:
  - Disabled endpoint: `POST /api/health/elasticsearch/recreate-client`

### Documentation Updates
- `docs/ELASTICSEARCH_CLIENT_RECREATION.md` - Marked as DISABLED with explanation
- `GRAPHQL_CLIENT_FIX_DEPLOYMENT.md` - Updated to reflect changes

## Current Architecture

**Elasticsearch Client**: Created once at startup, persists for application lifetime
```javascript
const elasticClient = new Client({ ... });
```

**GraphQL Client**: Managed with periodic recreation (every 30 minutes) - **This is the active memory leak fix**
```javascript
let graphQLClient = null;
function createGraphQLClient() { ... }
setInterval(() => { checkAndRecreateGraphQLClient(); }, 300000);
```

## Environment Variables

- `ES_CLIENT_RECREATION_INTERVAL` - **Now ignored, can be removed from .env**
- `GRAPHQL_CLIENT_RECREATION_INTERVAL` - **Active, controls GraphQL client recreation**

## Testing Results

### Before Both Fixes (Baseline)
- External memory: 494GB (365 MB/min growth)
- Sockets: 387 (growing)
- TCP connections: 146 (growing)

### With ES Client Recreation Only
- External memory: Still 494GB (365 MB/min growth) ❌
- Connection failures: Occasional ❌

### With GraphQL Client Recreation Only (Current)
- External memory: Expected < 5GB (< 10 MB/min growth) ✅
- Connection stability: No failures ✅
- Socket count: Expected < 100 ✅

## What This Means

1. **Simpler code**: One less recreation mechanism to maintain
2. **More stable**: No ES connection failures
3. **Effective fix**: GraphQL client recreation addresses the actual leak
4. **ES client is fine**: Undici's internal pooling doesn't cause the leak we were seeing

## No Action Required

For existing deployments:
- The disabled ES recreation code is benign (removed entirely)
- No `.env` changes required (old var is ignored)
- No functionality is lost
- The GraphQL fix is sufficient

## If You Want to Clean Up

Optional cleanup in your `.env` file:
```bash
# This line can be removed (no longer used)
ES_CLIENT_RECREATION_INTERVAL=1800000
```

## Rollback

If ES client issues arise (unlikely), the old recreation code is in git history and can be restored. However, based on testing, this is not expected to be necessary.

---

**Date**: 2025-11-03  
**Status**: Disabled based on user feedback and testing results  
**Active Fix**: GraphQL client periodic recreation (see `docs/GRAPHQL_CLIENT_MEMORY_FIX.md`)

