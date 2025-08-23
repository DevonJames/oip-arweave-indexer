# Using GUN in OIP: Complete Guide

## 📖 Overview

This guide covers the complete integration of GUN (Graph Universal Network) with the Open Index Protocol (OIP). GUN provides decentralized, real-time database capabilities for private and temporary data storage, complementing OIP's permanent Arweave storage.

## 🎯 What is GUN?

GUN is a decentralized database that enables:
- **Real-time synchronization** across peers
- **Offline-first** data storage
- **Conflict-free data merging**
- **Cryptographic security** with encryption
- **Temporary/private** data storage (vs. OIP's permanent public storage)

## 🏗️ Architecture Overview

### System Components

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   OIP Client    │───▶│  OIP API Server │───▶│   GUN Relay     │
│ (Frontend/App)  │    │  (Express.js)   │    │ (HTTP API)      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       ▼                       ▼
         │              ┌─────────────────┐    ┌─────────────────┐
         │              │  Elasticsearch  │    │  GUN Database   │
         │              │   (Indexing)    │    │ (Local Storage) │
         └──────────────▶└─────────────────┘    └─────────────────┘
```

### Data Flow

1. **Publishing**: Client → OIP API → GUN Relay → GUN Database → Elasticsearch (indexing)
2. **Retrieval**: Client → OIP API → Elasticsearch (search) + GUN Relay (data)
3. **Real-time**: GUN Relay ↔ GUN Database (peer-to-peer sync)

## 🔧 Technical Implementation

### 1. GUN Relay Server (`gun-relay-server.js`)

The GUN relay acts as an HTTP API wrapper around the GUN database:

```javascript
// Core functionality
const gun = Gun({
    web: server,           // Attach to HTTP server
    radisk: true,         // Persistent storage
    file: 'data',         // Storage directory
    localStorage: false,   // Disable browser storage
    multicast: false      // Disable multicast for containers
});
```

**Endpoints:**
- `POST /put` - Store data in GUN
- `GET /get?soul=<key>` - Retrieve data from GUN

### 2. GUN Helper (`helpers/gun.js`)

Provides abstraction layer for GUN operations:

```javascript
class GunHelper {
    constructor() {
        this.apiUrl = process.env.GUN_PEERS || 'http://gun-relay:8765';
        this.encryptionEnabled = process.env.GUN_ENABLE_ENCRYPTION === 'true';
    }
    
    async putRecord(soul, data, options = {}) {
        // Encrypts data if private
        // Sends HTTP request to gun-relay
        // Returns success/failure
    }
    
    async getRecord(soul) {
        // Retrieves data from gun-relay
        // Decrypts if encrypted
        // Returns data or null
    }
}
```

### 3. DID System Integration

GUN records use Decentralized Identifiers (DIDs):

**Format:** `did:gun:<soul>`

**Soul Generation:**
```javascript
computeSoul(pubKeyHash, localId) {
    // Creates shortened soul to fit Elasticsearch limits
    return `${pubKeyHash.substring(0, 64)}:${localId}`;
}
```

**Example DID:**
```
did:gun:oip:records:v2LPUKrpSnmzQzPr7Cfjb_vh9FD6GbRXQNqUk9miFmiWA6PtKj6g:my-draft
```

## 📝 Publishing Records to GUN

### 1. Via API Endpoint

**POST** `/api/records/newRecord`

```json
{
    "basic": {
        "name": "My Private Draft",
        "description": "Work in progress"
    },
    "post": {
        "articleText": "Draft content..."
    },
    "accessControl": {
        "private": true
    },
    "storage": "gun",
    "localId": "my-draft-001"
}
```

### 2. Via Reference Client

The web interface (`public/reference-client.html`) includes:
- **Storage Type** selector (Arweave/GUN)
- **Local ID** field for GUN records
- **Private** checkbox for encryption
- **Real-time** status updates

### 3. Publishing Process

```javascript
// 1. Validate input data
const recordData = validateRecordData(input);

// 2. Generate GUN soul
const soul = gunHelper.computeSoul(pubKeyHash, localId);

// 3. Create OIP record structure
const oipRecord = {
    data: recordData,
    oip: {
        did: `did:gun:${soul}`,
        storage: 'gun',
        recordType: 'post',
        indexedAt: new Date().toISOString(),
        ver: '0.8.0',
        signature: generateSignature(recordData)
    }
};

// 4. Store in GUN (with encryption if private)
await gunHelper.putRecord(soul, oipRecord, {
    encrypt: accessControl.private
});

// 5. Index in Elasticsearch for searchability
await elasticsearch.indexRecord(oipRecord);
```

## 🔍 Querying GUN Records

### 1. Search Parameters

**GET** `/api/records?storage=gun&source=gun`

- `storage=gun` - Filter by GUN storage type
- `source=gun` - Filter by GUN source (DID prefix)
- Standard OIP filters (recordType, limit, etc.)

### 2. Response Format

```json
{
    "message": "Records retrieved successfully",
    "totalRecords": 5,
    "searchResults": 3,
    "records": [
        {
            "data": {
                "basic": { "name": "Draft Post" },
                "post": { "articleText": "Content..." }
            },
            "oip": {
                "did": "did:gun:oip:records:abc123:my-draft",
                "storage": "gun",
                "recordType": "post",
                "indexedAt": "2025-01-21T19:45:47.747Z"
            }
        }
    ]
}
```

### 3. Direct GUN Queries

For real-time data access:

```javascript
// Get specific record
const record = await gunHelper.getRecord(soul);

// Subscribe to changes (future feature)
gun.get(soul).on((data, key) => {
    console.log('Record updated:', data);
});
```

## 🔐 Privacy and Encryption

### 1. Encryption Process

When `accessControl.private = true`:

```javascript
// Encrypt data using AES-256-GCM
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex') + 
                 cipher.final('hex');

// Store with encryption metadata
const encryptedRecord = {
    encrypted: true,
    data: encrypted,
    authTag: cipher.getAuthTag().toString('hex'),
    iv: iv.toString('hex')
};
```

### 2. Access Control

- **Private Records**: Encrypted, only accessible with proper keys
- **Public Records**: Stored in plaintext, searchable via Elasticsearch
- **Local-only**: Stored in GUN but not indexed in Elasticsearch

### 3. Key Management

Currently uses deterministic keys based on:
- User authentication token
- Record soul
- System salt (configurable)

## 🌐 Network and Deployment

### 1. Docker Configuration

**docker-compose.yml**:
```yaml
gun-relay:
  build:
    context: .
    dockerfile: Dockerfile-minimal
  command: ["node", "gun-relay-server.js"]
  ports:
    - "8765:8765"
  volumes:
    - gun_data:/usr/src/app/data
  networks:
    - oip-network
  profiles:
    - minimal
    - standard
    - standard-gpu
```

### 2. Environment Variables

```bash
# GUN Configuration
GUN_PEERS=http://gun-relay:8765
GUN_ENABLE_ENCRYPTION=false
GUN_DEFAULT_PRIVACY=false
```

### 3. Health Monitoring

The gun-relay includes health checks:
- Self-test on startup
- HTTP API endpoint validation
- Persistent storage verification

## 🔄 Data Synchronization

### 1. Elasticsearch Integration

GUN records are indexed in Elasticsearch for:
- **Searchability**: Find records by content/metadata
- **Filtering**: Query by storage type, privacy, etc.
- **Analytics**: Usage statistics and trends

### 2. Index Mapping

```json
{
    "records": {
        "properties": {
            "oip.did": { "type": "keyword" },
            "oip.storage": { "type": "keyword" },
            "oip.recordType": { "type": "keyword" },
            "data.basic.name": { "type": "text" },
            "data.post.articleText": { "type": "text" }
        }
    }
}
```

### 3. Conflict Resolution

GUN handles conflicts automatically through:
- **CRDT** (Conflict-free Replicated Data Types)
- **Vector clocks** for ordering
- **Merge strategies** for concurrent updates

## 🧪 Testing and Debugging

### 1. Test Suite

**test/test-gun-integration.js** includes:
- Connection testing
- Record storage/retrieval
- Encryption/decryption
- Error handling
- Performance benchmarks

### 2. Debug Tools

```bash
# Check gun-relay status
docker logs oip-arweave-indexer-gun-relay-1

# Test HTTP API directly
curl -X POST http://localhost:8765/put \
  -H "Content-Type: application/json" \
  -d '{"soul": "test:123", "data": {"test": true}}'

# Query Elasticsearch for GUN records
curl "http://localhost:9200/records/_search?q=oip.storage:gun"
```

### 3. Common Issues

**Container Exits:**
- Check for uncaught exceptions
- Verify server initialization order
- Monitor memory usage

**Timeout Errors:**
- Verify gun-relay is running
- Check network connectivity
- Increase timeout values

**Encryption Failures:**
- Verify crypto module compatibility
- Check key generation
- Validate IV/authTag handling

## 🚀 Usage Examples

### 1. Publishing a Draft Post

```javascript
// Client-side JavaScript
const draftData = {
    basic: { name: "My Draft", description: "Work in progress" },
    post: { articleText: "Draft content..." },
    accessControl: { private: true }
};

fetch('/api/records/newRecord', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
        ...draftData,
        storage: 'gun',
        localId: 'draft-' + Date.now()
    })
});
```

### 2. Searching Private Records

```javascript
// Find user's private drafts
const response = await fetch('/api/records?storage=gun&recordType=post&private=true');
const { records } = await response.json();

records.forEach(record => {
    console.log('Draft:', record.data.basic.name);
});
```

### 3. Real-time Collaboration (Future)

```javascript
// Subscribe to record changes
const gun = Gun(['http://localhost:8765']);
gun.get('collaborative:doc:123').on((data, key) => {
    updateEditor(data);
});

// Update document
gun.get('collaborative:doc:123').put({
    content: editorContent,
    lastModified: Date.now()
});
```

## 🔮 Future Enhancements

### 1. Real-time Features
- Live collaboration on documents
- Real-time notifications
- Peer-to-peer synchronization

### 2. Advanced Encryption
- Multi-user access control
- Key rotation
- Forward secrecy

### 3. Performance Optimizations
- Connection pooling
- Batch operations
- Caching strategies

### 4. Mobile Support
- React Native integration
- Offline synchronization
- Background sync

## 📚 Additional Resources

- **GUN Documentation**: https://gun.eco/docs/
- **OIP Technical Overview**: `docs/OIP_TECHNICAL_OVERVIEW.md`
- **API Documentation**: `docs/API_RECORDS_ENDPOINT_DOCUMENTATION.md`
- **Implementation Progress**: `docs/GUN_IMPLEMENTATION_PROGRESS.md`

## 🆘 Support and Troubleshooting

For issues with GUN integration:
1. Check the gun-relay container logs
2. Verify Elasticsearch indexing
3. Test HTTP API endpoints directly
4. Review encryption/decryption processes
5. Consult the test suite for examples

The GUN integration provides a powerful complement to OIP's permanent storage, enabling private, temporary, and real-time data capabilities while maintaining the decentralized philosophy of the platform.
