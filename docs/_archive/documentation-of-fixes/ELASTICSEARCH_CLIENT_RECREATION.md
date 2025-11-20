# Elasticsearch Client Recreation (DISABLED)

**⚠️ THIS FIX HAS BEEN DISABLED**

This fix was initially implemented to address external memory leaks, but testing revealed:
1. **Caused connection failures**: The ES client occasionally failed to reconnect, breaking queries
2. **Not the real source**: The GraphQL client (Arweave queries) was the actual memory leak culprit
3. **Unnecessary complexity**: ES client recreation added complexity without solving the problem

**Current Status**: The ES client is now created once at startup and persists for the application lifetime. The GraphQL client periodic recreation is the active memory leak fix.

---

## Original Problem (For Reference)

The Elasticsearch client (v8+) uses Undici for internal HTTP connection management. Over time, Undici was suspected to accumulate ArrayBuffers from connection pooling, potentially leading to external memory leaks.

## Why It Was Disabled

### Testing Results
- External memory leak persisted at ~365 MB/min even with ES client recreation
- Memory dropped only when GraphQL client was recreated
- ES client recreation caused occasional query failures

### Root Cause Identification
- Socket count analysis showed connections to `arweave.net` accumulating
- `graphql-request` library was creating persistent connections
- GraphQL client recreation successfully stopped the leak

## Active Fix

The GraphQL client periodic recreation (every 30 minutes) is the active memory leak mitigation:
- See: `docs/GRAPHQL_CLIENT_MEMORY_FIX.md`
- Endpoint: `POST /api/health/graphql/recreate-client`
- Config: `GRAPHQL_CLIENT_RECREATION_INTERVAL`

## Code Changes

### `helpers/elasticsearch.js`
```javascript
// BEFORE (with recreation):
let elasticClient = null;
function createElasticsearchClient() { ... }
setInterval(() => { checkAndRecreateElasticsearchClient(); }, 300000);

// AFTER (disabled):
const elasticClient = new Client({ ... });
// Single instance, no recreation
```

### `routes/health.js`
```javascript
// Endpoint removed/disabled
// router.post('/elasticsearch/recreate-client', ...);
```

## Environment Variables

The `ES_CLIENT_RECREATION_INTERVAL` environment variable is now ignored and can be removed from `.env` files.

## Migration Notes

If you had scripts or monitoring that used the ES client recreation endpoint:
- Remove: `POST /api/health/elasticsearch/recreate-client`
- Use instead: `POST /api/health/graphql/recreate-client` (if needed)

## Rollback

If ES client issues occur (unlikely), the old recreation code is preserved in git history:
```bash
git log --all --grep="ES client" -- helpers/elasticsearch.js
```

The GraphQL client fix has proven to be sufficient for memory leak mitigation.
