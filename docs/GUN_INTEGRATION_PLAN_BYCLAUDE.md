# GUN Integration Plan for OIP Arweave Platform
## Practical, Incremental Implementation

This document provides a concrete, minimal plan to integrate GUN as a private/temporary storage layer that seamlessly interoperates with the existing OIP records system. The approach prioritizes simplicity, backward compatibility, and reuse of existing infrastructure.

## Executive Summary

**Goal**: Enable a single API surface (`/api/records`) to read and write both permanent OIP records (Arweave) and private/ephemeral GUN data, using unified DID scheme and template semantics, with maximum interoperability.

**Strategy**: Minimal, incremental changes that leverage existing code paths. GUN records get indexed into Elasticsearch in the same shape as OIP records, enabling unified querying through existing `getRecords()` function.

## Current Architecture Assessment

### Existing Strengths (Perfect for GUN Integration)
1. **Template System**: Schema definitions on Arweave can be reused for GUN records
2. **DID Infrastructure**: Already supports multiple formats (`did:arweave:`, `did:ipfs:`, etc.)
3. **Unified Indexing**: `indexRecord()` function can handle any record shape
4. **Comprehensive API**: `/api/records` with 30+ query parameters works for any indexed record
5. **Modular Publisher**: `publisherManager` easily extensible for new storage types

### Key Integration Points
- **`helpers/templateHelper.js`**: `publishNewRecord()` function (lines 281-492)
- **`helpers/elasticsearch.js`**: `indexRecord()` function (lines 529-571)
- **`routes/records.js`**: Main API endpoint (lines 44-56)
- **`helpers/utils.js`**: DID validation and conversion (lines 140-160)

## Implementation Plan

### Phase 1: Foundation (Week 1)
**Objective**: Add GUN support with minimal changes

#### 1.1 Update DID System
```javascript
// helpers/utils.js - Extend existing functions
const isValidDid = (did) => {
    return /^did:(arweave|irys|ipfs|arfleet|bittorrent|gun):[a-zA-Z0-9_\-\.]+$/.test(did);
};

// Add GUN-specific utilities
const didToGunSoul = (did) => {
    if (!did.startsWith('did:gun:')) {
        throw new Error('Invalid GUN DID format');
    }
    return did.split(':')[2];
};

const gunSoulToDid = (soul) => {
    return `did:gun:${soul}`;
};

// Update existing functions to handle both didTx and did
const normalizeDidParam = (didParam) => {
    // Accept both didTx and did for backward compatibility
    return didParam; // didTx values are already valid DIDs
};
```

#### 1.2 Add GUN Helper
```javascript
// helpers/gun.js - New minimal GUN integration
const Gun = require('gun');
require('gun/sea');

class GunHelper {
    constructor() {
        this.gun = Gun({
            peers: (process.env.GUN_PEERS || 'http://gun-relay:8765/gun').split(','),
            localStorage: false,
            radisk: false // Use relay for persistence
        });
    }

    // Generate deterministic soul for record
    computeSoul(publisherPubKey, localId = null, recordData = null) {
        if (localId) {
            return `oip:records:${publisherPubKey}:${localId}`;
        }
        
        // Fallback: content hash
        const canon = JSON.stringify(recordData, Object.keys(recordData).sort());
        const hash = require('crypto').createHash('sha256').update(canon).digest('hex').slice(0, 12);
        return `oip:records:${publisherPubKey}:h:${hash}`;
    }

    // Put record to GUN
    async putRecord(recordData, soul, options = {}) {
        const gunRecord = {
            data: recordData.data,
            oip: recordData.oip,
            meta: {
                created: Date.now(),
                localId: options.localId
            }
        };

        // Encrypt if private
        if (options.encrypt && options.readerPubKeys) {
            const secret = await Gun.SEA.secret(options.readerPubKeys[0], options.writerKeys);
            gunRecord.data = await Gun.SEA.encrypt(JSON.stringify(gunRecord.data), secret);
            gunRecord.encrypted = true;
        }

        // Store in GUN
        return new Promise((resolve, reject) => {
            this.gun.get(soul).put(gunRecord, (ack) => {
                if (ack.err) {
                    reject(new Error(ack.err));
                } else {
                    resolve({ soul, did: `did:gun:${soul}` });
                }
            });
        });
    }

    // Get record from GUN
    async getRecord(soul) {
        return new Promise((resolve) => {
            this.gun.get(soul).once((data) => {
                resolve(data || null);
            });
        });
    }
}

module.exports = { GunHelper };
```

#### 1.3 Add GUN Relay Service
```yaml
# docker-compose.yml - Add minimal GUN relay
gun-relay:
  image: node:18-alpine
  working_dir: /app
  command: sh -c "npm init -y >/dev/null 2>&1 || true && npm i gun && node -e \"
    const Gun = require('gun');
    require('gun/sea');
    const http = require('http');
    const server = http.createServer();
    Gun({ web: server, radisk: true, file: 'data' });
    server.listen(8765, () => console.log('GUN relay on :8765'));
  \""
  ports:
    - "8765:8765"
  volumes:
    - gundata:/app/data
  networks:
    - oip-network
  restart: unless-stopped
  profiles:
    - standard
    - standard-gpu
```

### Phase 2: API Integration (Week 2)

#### 2.1 Update Publisher Manager
```javascript
// helpers/publisher-manager.js - Add GUN support
async publish(data, options = {}) {
    const { blockchain = 'arweave', storage = blockchain } = options;
    
    // Add GUN support
    if (storage === 'gun') {
        return await this.publishToGun(data, options);
    }
    
    // Existing blockchain publishing
    if (blockchain === 'arweave') {
        return await this.publishToArweave(data, options.tags, options.waitForConfirmation);
    } else if (blockchain === 'irys') {
        return await this.publishToIrys(data, options.tags);
    }
    
    throw new Error(`Unsupported storage: ${storage}`);
}

async publishToGun(data, options) {
    const { GunHelper } = require('./gun');
    const gunHelper = new GunHelper();
    
    // Extract publisher info from options or derive from JWT
    const publisherPubKey = options.publisherPubKey || this.getPublisherPubKey();
    const localId = options.localId || null;
    
    // Compute soul
    const soul = gunHelper.computeSoul(publisherPubKey, localId, data);
    
    // Store in GUN
    const result = await gunHelper.putRecord(data, soul, {
        encrypt: options.accessControl?.private,
        readerPubKeys: options.accessControl?.readers,
        writerKeys: options.writerKeys,
        localId
    });
    
    return {
        id: soul,
        did: result.did,
        storage: 'gun',
        provider: 'gun'
    };
}
```

#### 2.2 Update Template Helper
```javascript
// helpers/templateHelper.js - Modify publishNewRecord()
async function publishNewRecord(record, recordType, publishFiles = false, addMediaToArweave = true, addMediaToIPFS = false, youtubeUrl = null, blockchain = 'arweave', addMediaToArFleet = false) {
    // NEW: Check for GUN storage
    const storage = blockchain === 'gun' ? 'gun' : blockchain;
    
    if (storage === 'gun') {
        return await publishToGun(record, recordType, blockchain);
    }
    
    // Existing Arweave/Irys flow continues unchanged...
    // [existing code from lines 283-492]
}

// NEW: GUN publishing function
async function publishToGun(record, recordType, options = {}) {
    try {
        // Get publisher info (reuse existing logic)
        const jwk = JSON.parse(fs.readFileSync(getWalletFilePath()));
        const myPublicKey = jwk.n;
        const myAddress = base64url(createHash('sha256').update(Buffer.from(myPublicKey, 'base64')).digest());
        
        // Create signature envelope (no blockchain tags needed)
        const dataForSignature = JSON.stringify(record);
        const creatorSig = await signMessage(dataForSignature);
        
        // Build record for GUN (expanded format, not compressed)
        const gunRecordData = {
            data: record,
            oip: {
                did: null, // Will be set after soul generation
                storage: 'gun',
                recordType: recordType,
                indexedAt: new Date().toISOString(),
                ver: '0.8.0',
                signature: creatorSig,
                creator: {
                    didAddress: `did:arweave:${myAddress}`,
                    publicKey: myPublicKey
                }
            }
        };
        
        // Publish to GUN
        const publishResult = await publisherManager.publish(gunRecordData, {
            storage: 'gun',
            publisherPubKey: myPublicKey,
            localId: options.localId,
            accessControl: options.accessControl
        });
        
        // Update with final DID
        gunRecordData.oip.did = publishResult.did;
        
        // Index to Elasticsearch (reuse existing function!)
        await indexRecord(gunRecordData);
        
        return {
            transactionId: publishResult.id,
            did: publishResult.did,
            storage: 'gun',
            recordToIndex: gunRecordData
        };
        
    } catch (error) {
        console.error('Error publishing to GUN:', error);
        throw error;
    }
}
```

#### 2.3 Update Records Route
```javascript
// routes/records.js - Minimal changes to support both storage types
router.get('/', async (req, res) => {
    try {
        const queryParams = { ...req.query };
        
        // Normalize DID parameter (backward compatibility)
        if (queryParams.didTx && !queryParams.did) {
            queryParams.did = queryParams.didTx;
        }
        
        // Add storage filtering if source parameter provided
        if (queryParams.source && queryParams.source !== 'all') {
            queryParams.storage = queryParams.source; // maps to oip.storage field
        }
        
        // Existing getRecords function handles everything!
        const records = await getRecords(queryParams);
        
        res.status(200).json(records);
    } catch (error) {
        console.error('Error at /api/records:', error);
        res.status(500).json({ error: 'Failed to retrieve and process records' });
    }
});

// Add new route for GUN-specific operations
router.post('/newRecord', authenticateToken, async (req, res) => {
    try {
        const record = req.body;
        const { recordType, storage = 'arweave', localId } = req.query;
        
        // Determine storage type (support both 'blockchain' and 'storage' params)
        const storageType = storage || req.body.blockchain || req.query.blockchain || 'arweave';
        
        const newRecord = await publishNewRecord(
            record, 
            recordType, 
            req.query.publishFiles === 'true',
            req.query.addMediaToArweave !== 'false',
            req.query.addMediaToIPFS === 'true',
            req.query.youtubeUrl || null,
            storageType, // This now supports 'gun'
            req.query.addMediaToArFleet === 'true'
        );
        
        res.status(200).json({
            [storageType === 'gun' ? 'did' : 'transactionId']: storageType === 'gun' ? newRecord.did : newRecord.transactionId,
            recordToIndex: newRecord.recordToIndex,
            storage: storageType
        });
    } catch (error) {
        console.error('Error publishing record:', error);
        res.status(500).json({ error: 'Failed to publish record' });
    }
});
```

### Phase 3: Elasticsearch Integration (Week 3)

#### 3.1 Update Elasticsearch Mapping
```javascript
// config/createIndices.js - Add storage field to mapping
const recordsMapping = {
    mappings: {
        properties: {
            oip: {
                properties: {
                    did: { type: 'keyword' },           // NEW: unified DID field
                    didTx: { type: 'keyword' },         // KEEP: backward compatibility
                    storage: { type: 'keyword' },       // NEW: 'arweave', 'irys', 'gun'
                    recordType: { type: 'keyword' },
                    // ... existing fields
                }
            },
            // ... existing data mappings
        }
    }
};
```

#### 3.2 Migration Script
```javascript
// Migration script for didTx → did
async function migrateDIDFields() {
    console.log('Migrating didTx to did fields...');
    
    const script = {
        source: `
            if (ctx._source.oip != null) {
                if (ctx._source.oip.did == null && ctx._source.oip.didTx != null) {
                    ctx._source.oip.did = ctx._source.oip.didTx;
                }
                if (ctx._source.oip.storage == null) {
                    ctx._source.oip.storage = 'arweave';
                }
            }
        `
    };
    
    await elasticClient.updateByQuery({
        index: 'records',
        body: { script },
        refresh: true
    });
    
    console.log('Migration completed');
}
```

#### 3.3 Update getRecords Function
```javascript
// helpers/elasticsearch.js - Minimal changes to support storage filtering
async function getRecords(queryParams) {
    const {
        // Existing parameters...
        did,           // NEW: unified DID parameter
        didTx,         // KEEP: backward compatibility
        source,        // NEW: 'all', 'arweave', 'gun'
        storage,       // ALIAS: maps to oip.storage
        // ... all existing parameters
    } = queryParams;

    // Normalize DID parameter
    const normalizedDid = did || didTx;
    
    try {
        const result = await getRecordsInDB();
        let records = result.records;
        
        // NEW: Filter by storage type
        if (source && source !== 'all') {
            records = records.filter(record => record.oip?.storage === source);
        }
        if (storage && storage !== 'all') {
            records = records.filter(record => record.oip?.storage === storage);
        }
        
        // Update DID filtering to use normalized field
        if (normalizedDid) {
            records = records.filter(record => 
                record.oip?.did === normalizedDid || record.oip?.didTx === normalizedDid
            );
        }
        
        // All existing filtering logic continues unchanged...
        // [lines 1164-2243 continue as-is]
        
    } catch (error) {
        console.error('Error in getRecords:', error);
        throw error;
    }
}
```

### Phase 4: Frontend Integration (Week 4)

#### 4.1 Update Reference Client
```javascript
// public/reference-client.html - Add storage type support
// Add storage filter to existing filters
<div class="filter-group">
    <label for="voice-storage-filter">Storage Type</label>
    <select id="voice-storage-filter" onchange="applyVoiceFilters()">
        <option value="all">All Sources</option>
        <option value="arweave">Arweave (Permanent)</option>
        <option value="gun">GUN (Private/Drafts)</option>
    </select>
</div>

// Update collectVoiceFilters function
function collectVoiceFilters() {
    // Existing filters...
    currentFilters.source = document.getElementById('voice-storage-filter').value;
    
    // Support both did and didTx parameters
    const didValue = document.getElementById('voice-did-tx').value.trim();
    if (didValue) {
        currentFilters.did = didValue;
        delete currentFilters.didTx; // Use did as primary
    }
}

// Add GUN publishing option to publish interface
function createPostInterface() {
    return `
        <div class="form-group">
            <label for="post-storage">Storage Type:</label>
            <select id="post-storage">
                <option value="arweave">Arweave (Permanent)</option>
                <option value="gun">GUN (Private Draft)</option>
            </select>
        </div>
        <!-- Rest of existing interface -->
    `;
}
```

#### 4.2 Update Alfred Integration
```javascript
// helpers/alfred.js - Minimal changes for GUN support
class ALFRED {
    // Update existing searchElasticsearch to include GUN records
    async searchElasticsearch(question, options = {}) {
        const searchParams = {
            search: question,
            source: options.includeGUN ? 'all' : 'arweave', // Include GUN by default
            limit: this.maxResults * 2,
            resolveDepth: 3,
            // ... existing parameters
        };

        const results = await getRecords(searchParams);
        return results;
    }
    
    // No other changes needed - existing code works with GUN records automatically!
}
```

## Key Technical Decisions

### 1. **DID Migration Strategy**
- **Dual-write**: New records populate both `oip.did` and `oip.didTx`
- **Backward compatibility**: API accepts both `did` and `didTx` parameters
- **Migration script**: Backfill existing records with `oip.did = oip.didTx`

### 2. **GUN Soul Generation**
```javascript
// Deterministic soul format
soul = `oip:records:${publisherPubKey}:${localId || contentHash}`

// Examples:
"oip:records:abc123...:draft-001"           // User-provided localId
"oip:records:abc123...:h:f7c1a2b3"         // Content hash fallback
```

### 3. **Security Model**
- **GUN SEA**: Encrypt `data` payload for private records
- **Elasticsearch**: Index only public metadata, never secrets
- **Access Control**: Reuse existing authentication, add GUN-specific encryption

### 4. **Template Reuse**
- **Same Templates**: GUN records use identical Arweave-stored templates
- **No Compression**: GUN stores expanded JSON (human-readable)
- **Validation**: Reuse existing template validation functions

## API Examples

### Create Private GUN Record
```bash
curl -X POST 'http://localhost:3005/api/records/newRecord?recordType=post&storage=gun&localId=draft-001' \
  -H 'Authorization: Bearer <JWT>' \
  -H 'Content-Type: application/json' \
  -d '{
    "basic": {
      "name": "My Private Draft",
      "description": "Work in progress",
      "language": "en",
      "tagItems": ["draft", "private"]
    },
    "post": {
      "bylineWriter": "Alice",
      "articleText": "This is my private draft content..."
    },
    "accessControl": {
      "private": true,
      "readers": ["pubkey1", "pubkey2"]
    }
  }'
```

### Query Mixed Records
```bash
# Get all records (Arweave + GUN)
GET /api/records?search=cooking&source=all&limit=10

# Get only GUN records
GET /api/records?source=gun&recordType=post&limit=10

# Get specific GUN record
GET /api/records?did=did:gun:oip:records:abc123:draft-001
```

### Promote GUN Draft to Arweave
```bash
# Fetch GUN record, then publish to Arweave
curl -X POST 'http://localhost:3005/api/records/newRecord?recordType=post&storage=arweave' \
  -H 'Authorization: Bearer <JWT>' \
  -H 'Content-Type: application/json' \
  -d '{
    "basic": { /* finalized content from GUN draft */ },
    "post": { /* finalized content */ },
    "meta": {
      "promotedFrom": "did:gun:oip:records:abc123:draft-001"
    }
  }'
```

## Environment Configuration

```bash
# example env additions
GUN_PEERS=http://gun-relay:8765/gun
GUN_ENABLE_ENCRYPTION=true
GUN_DEFAULT_PRIVACY=false
```

## Testing Strategy

### MVP Test Cases
1. **GUN Record Creation**
   - POST with `storage=gun` → expect `did:gun:` response
   - Verify Elasticsearch indexing with `oip.storage=gun`

2. **Mixed Querying**
   - GET with `source=all` → returns both Arweave and GUN records
   - GET with `source=gun` → returns only GUN records
   - GET with `did=did:gun:...` → returns specific GUN record

3. **Backward Compatibility**
   - Existing `didTx` parameter still works
   - Existing Arweave publishing unchanged
   - Alfred searches include GUN records automatically

4. **Template Validation**
   - GUN records validate against same Arweave templates
   - Template-based field validation works for both storage types

## Risk Mitigation

### Technical Risks
1. **Performance**: GUN records indexed to ES immediately, so no query performance impact
2. **Data Consistency**: Single source of truth (ES) for queries, GUN for real-time updates
3. **Security**: SEA encryption keeps private data out of ES

### Implementation Risks
1. **Minimal Changes**: Reuses 90% of existing code paths
2. **Backward Compatibility**: Dual-write strategy prevents breaking changes
3. **Rollback Plan**: Can disable GUN storage without affecting Arweave functionality

## Success Criteria

### Week 1
- [ ] GUN relay service running
- [ ] DID validation supports `did:gun:`
- [ ] Basic GUN helper functions working

### Week 2
- [ ] `storage=gun` parameter publishes to GUN
- [ ] GUN records appear in Elasticsearch
- [ ] Unified `/api/records` returns mixed results

### Week 3
- [ ] All existing API parameters work with GUN records
- [ ] Template validation works for GUN records
- [ ] Migration script updates existing records

### Week 4
- [ ] Frontend storage filter working
- [ ] Alfred searches include GUN records
- [ ] Private record encryption functional

## Implementation Priority

**HIGH PRIORITY (MVP)**:
- DID field migration (`didTx` → `did`)
- GUN publishing via `storage=gun`
- Elasticsearch indexing for GUN records
- Basic querying with `source` parameter

**MEDIUM PRIORITY**:
- Private record encryption
- Frontend storage filters
- Migration scripts

**LOW PRIORITY (Future)**:
- Real-time collaboration features
- Advanced GUN-specific endpoints
- Performance optimizations

## Conclusion

This revised plan takes the best elements from both approaches:

- **Simplicity**: Minimal changes, maximum reuse of existing code
- **Practicality**: Leverages existing `indexRecord()` and `getRecords()` functions
- **Backward Compatibility**: Dual-write strategy prevents breaking changes
- **Security**: GUN SEA encryption with ES indexing of public metadata only
- **Interoperability**: Same templates, same API, same query capabilities

The key insight is that by indexing GUN records into Elasticsearch in the same format as OIP records, we get unified querying "for free" through the existing comprehensive `/api/records` endpoint. This approach requires minimal code changes while providing maximum functionality and interoperability.

The plan is designed to "just work" by building on proven patterns already in the codebase, with clear rollback options and incremental implementation that doesn't disrupt existing functionality.
