# Socket & TCP Connection Leak Fix (November 2024)

## Problem

After implementing the Undici/Elasticsearch client memory leak fix, a **persistent Socket/TCPConnectWrap leak** was observed:

### Symptoms
- **Socket handles**: 4 → 108 (+104 sockets) in ~hour
- **TCPConnectWrap requests**: 0 → 37 (+37) in ~1 hour
- **External memory growth**: ~50-150 MB/min during active use, ~400-500 MB/min during inactive use
- **Memory leak rate**: Reduced from ~600 MB/min to ~50-150 MB/min after ES client fix, but still problematic

### Evidence from Logs
```
⚠️  [Memory Leak Tracker] HANDLE/REQUEST LEAK DETECTED
   Active Handles: 110 (+105)
   Active Requests: 37 (+36)
   Handles growth by type:
     Socket: 4 → 108 (+104)
   Requests growth by type:
     TCPConnectWrap: 0 → 37 (+37)
```

### Root Cause

The `graphql-request` library's `request()` function was creating HTTP connections **without proper agent configuration**. Each call to Arweave GraphQL API (which happens every 10 minutes in `keepDBUpToDate`) was opening new sockets that weren't being closed.

Key issues:
1. **`request()` uses `cross-fetch`** which doesn't respect Node.js global HTTP agent settings
2. **No keepAlive control** - connections stayed open indefinitely
3. **Connection accumulation** - each query cycle added more unclosed sockets
4. **Background process leak** - `keepDBUpToDate` runs every 10 minutes, continuously accumulating connections

### Secondary Issue: organization_decrypt_queue Errors

Repeated `index_not_found_exception` errors for `organization_decrypt_queue` index were occurring on every login, potentially preventing proper resource cleanup.

## Solution

### 1. GraphQL Client with Managed HTTP Agents

**File:** `helpers/elasticsearch.js`

#### Changes Made:

1. **Replaced unmanaged `request()` with `GraphQLClient`**
   - Changed import from `{ gql, request }` to `{ gql, GraphQLClient }`
   - Created managed client instances with custom HTTP agents

2. **Created HTTP agents with proper configuration**
   ```javascript
   const graphqlHttpAgent = new http.Agent({
       keepAlive: false,       // Force socket closure after each request
       maxSockets: 25,         // Limit concurrent connections
       maxFreeSockets: 0,      // Don't cache free sockets
       timeout: 30000          // Socket timeout
   });
   
   const graphqlHttpsAgent = new https.Agent({
       keepAlive: false,
       maxSockets: 25,
       maxFreeSockets: 0,
       timeout: 30000
   });
   ```

3. **Created GraphQL client with custom fetch**
   ```javascript
   function createGraphQLClients() {
       const endpoints = getGraphQLEndpoints();
       const clients = new Map();
       
       endpoints.forEach(endpoint => {
           const isHttps = endpoint.startsWith('https://');
           const agent = isHttps ? graphqlHttpsAgent : graphqlHttpAgent;
           
           clients.set(endpoint, new GraphQLClient(endpoint, {
               fetch: (url, options = {}) => {
                   const nodeFetch = require('node-fetch');
                   return nodeFetch(url, {
                       ...options,
                       agent: agent
                   });
               },
               timeout: 30000
           }));
       });
       
       return clients;
   }
   ```

4. **Implemented periodic client recreation** (similar to ES client)
   - Clients recreated every 30 minutes (configurable via `GRAPHQL_CLIENT_RECREATION_INTERVAL`)
   - Forces cleanup of accumulated sockets/buffers
   - Triggers garbage collection after recreation

5. **Updated all GraphQL queries** to use managed clients
   - `queryBlockRange()` function (line ~5563)
   - `searchArweaveForNewTransactions()` function (line ~5667)

#### Before:
```javascript
response = await request(endpoint, query);
```

#### After:
```javascript
const clients = getGraphQLClients();
const client = clients.get(endpoint);
response = await client.request(query);
```

### 2. Organization Decryption Queue Error Handling

**File:** `helpers/organizationDecryptionQueue.js`

#### Changes Made:

1. **Graceful handling of missing index** in `decryptOrganizationRecords()`
   ```javascript
   try {
       queuedRecords = await elasticClient.search({
           index: 'organization_decrypt_queue',
           // ... query ...
       });
   } catch (indexError) {
       if (indexError.meta?.body?.error?.type === 'index_not_found_exception') {
           console.log(`ℹ️  No organization decryption queue exists yet (index not found)`);
           return;
       }
       throw indexError;
   }
   ```

2. **Graceful handling in `getQueueStatus()`**
   - Returns empty stats if index doesn't exist
   - No error logging for normal "index not found" case

## Configuration

### Environment Variables

- **`GRAPHQL_CLIENT_RECREATION_INTERVAL`** (default: 1800000ms / 30 minutes)
  - How often to recreate GraphQL clients
  - Lower values = more aggressive cleanup, more CPU overhead
  - Higher values = less overhead, but more socket accumulation risk

## Expected Results

### Memory Pattern
- **Sawtooth pattern**: Memory grows slowly between GraphQL client recreations, drops after recreation
- **Socket count**: Should remain stable or slowly decrease instead of continuously growing
- **External memory growth**: Reduced from ~400-500 MB/min (idle) to near-zero during idle periods

### Monitoring
Look for these log messages to confirm the fix is working:
```
✅ [GraphQL Client] Created GraphQL clients for N endpoint(s) (will recreate in XXXs)
🔄 [GraphQL Client] Clients are XXXs old, recreating to clear socket accumulation...
🧹 [GraphQL Client] Forced GC after client recreation
ℹ️  No organization decryption queue exists yet (index not found)
```

### Handle/Request Counts
- **Socket handles**: Should stabilize instead of growing
- **TCPConnectWrap requests**: Should stabilize instead of growing
- **Active handles/requests**: Should return to baseline after GraphQL queries complete

## Why Previous Approaches Failed

### Failed Approach 1: Global Axios Agents
- **Problem**: `graphql-request` uses `cross-fetch`, not Axios
- **Result**: Global Axios agent configuration had no effect on GraphQL requests

### Failed Approach 2: Undici Buffer Cleanup Only
- **Problem**: Fixed ES client leak but not GraphQL client leak  
- **Result**: Reduced leak rate but didn't eliminate socket accumulation

### Failed Approach 3: Managed GraphQL Client (Previous Attempt)
- **Problem**: Implementation had issues with DNS lookups creating leaked sockets
- **Result**: Made leak worse, was removed (see line 180-182 comment)
- **Current fix**: Uses `node-fetch` with explicit agent configuration, avoiding DNS issues

## Related Documentation

- **Undici Memory Leak Fix**: `docs/UNDICI_MEMORY_LEAK_FIX.md`
- **ES Client Recreation**: `helpers/elasticsearch.js` lines 123-175
- **Previous Socket Fixes**: `docs/_archive/documentation-of-fixes/SOCKET_LEAK_FIX.md`
- **GraphQL Client Memory Fix**: `docs/_archive/documentation-of-fixes/GRAPHQL_CLIENT_MEMORY_FIX.md`

## Testing & Verification

### 1. Monitor Socket Count
```bash
# Watch for Socket/TCPConnectWrap growth
docker logs -f fitnessally-oip-gpu-1 | grep "HANDLE/REQUEST LEAK"
```

### 2. Monitor GraphQL Client Recreation
```bash
# Should see recreation every 30 minutes
docker logs -f fitnessally-oip-gpu-1 | grep "GraphQL Client"
```

### 3. Monitor Memory Growth
```bash
# External memory should stabilize
docker logs -f fitnessally-oip-gpu-1 | grep "EXTERNAL MEMORY LEAK"
```

### 4. Check for organization_decrypt_queue Errors
```bash
# Should see "No organization decryption queue exists yet" instead of errors
docker logs -f fitnessally-oip-gpu-1 | grep "organization_decrypt_queue"
```

## Implementation Date

November 24-25, 2024

## Status

✅ **Implemented** - Awaiting production verification

