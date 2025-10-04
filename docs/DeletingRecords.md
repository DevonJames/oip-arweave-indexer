# OIP Record Deletion Documentation

## Overview

The OIP Arweave Indexer provides multiple methods for deleting records:

1. **API Endpoint Deletion**: Direct API calls for authenticated users to delete their own records from local Elasticsearch indices
2. **CLI Commands**: Direct server commands for deleting records from local Elasticsearch indices
3. **Blockchain-Based Deletion**: Publishing delete messages to Arweave that are processed by all OIP nodes

These methods are useful for cleaning up test data, removing problematic records, or performing bulk deletions based on various criteria.

## Method Comparison

| Feature | API Endpoint | Blockchain-Based | CLI Commands |
|---------|-------------|------------------|--------------|
| **Scope** | Single server | Network-wide | Single server |
| **Authentication** | JWT required | JWT optional | Server access |
| **Ownership Check** | Yes (strict) | Yes (creator only) | No |
| **Immediate Effect** | Yes | No (sync delay) | Yes |
| **User Access** | Any authenticated user | Any user | Admin/developer |
| **Record Types** | User-owned only | Creator-owned only | Any record |
| **Audit Trail** | Logged | Blockchain permanent | Logged |
| **Undo Possible** | No | No | No |
| **Best For** | User self-service | Production cleanup | Development/maintenance |

## Prerequisites

- Access to the OIP server environment
- Elasticsearch running and accessible
- Appropriate permissions to modify indices

## Method 1: API Endpoint Deletion (Single Server, User-Owned Records)

### Overview

The API endpoint deletion method allows authenticated users to delete their own records directly from the local server's Elasticsearch indices. This method provides immediate deletion with proper ownership verification, ensuring users can only delete records they created.

### Authentication Required

This method requires a valid JWT token obtained through the OIP authentication system. The token must contain the user's public key for ownership verification.

### Delete Record Format

**Standard Record Deletion:**
```json
{
    "delete": {
        "did": "did:gun:647f79c2a338:meal_1765213200_breakfast_tp8e47onl"
    }
}
```

**Supported DID Types:**
- GUN records: `did:gun:hash:record_id`
- Arweave records: `did:arweave:transaction_id`
- Any record type with proper ownership verification

### API Endpoint

**Endpoint:** `POST /api/records/deleteRecord`

**Headers:**
```http
Content-Type: application/json
Authorization: Bearer <jwt-token>  # Required for authentication and ownership verification
```

**Request Body:**
```json
{
    "delete": {
        "did": "did:gun:647f79c2a338:meal_1765213200_breakfast_tp8e47onl"
    }
}
```

**Success Response:**
```json
{
    "success": true,
    "message": "Record deleted successfully",
    "did": "did:gun:647f79c2a338:meal_1765213200_breakfast_tp8e47onl",
    "deletedCount": 1
}
```

**Error Responses:**
```json
// Invalid request format
{
    "error": "Invalid request format. Expected: {\"delete\": {\"did\": \"did:gun:...\"}}"
}

// Record not found
{
    "error": "Record not found",
    "did": "did:gun:647f79c2a338:meal_1765213200_breakfast_tp8e47onl"
}

// Access denied (not owner)
{
    "error": "Access denied. You can only delete records that you own.",
    "did": "did:gun:647f79c2a338:meal_1765213200_breakfast_tp8e47onl"
}

// Authentication required
{
    "error": "Access denied. Authentication required."
}
```

### How API Deletion Works

1. **Authentication Check**: Verify JWT token and extract user's public key
2. **Request Validation**: Validate JSON format and DID structure
3. **Record Lookup**: Search for the record in Elasticsearch using `searchRecordInDB`
4. **Ownership Verification**: Verify user owns the record using the ownership priority system:
   - AccessControl Template: `accessControl.owner_public_key`
   - Conversation Session: `conversationSession.owner_public_key`
   - **Server Admin Privilege**: Email domain matches server domain AND record was created by server wallet
   - GUN Soul Hash: Hash of user's public key in DID
   - Creator Fallback: `oip.creator.publicKey` (legacy server-signed records)
5. **Blockchain Delete Message**: For Arweave records, publish a delete message to the blockchain (signed by server wallet)
6. **Local Deletion**: Use `deleteRecordsByDID('records', did)` to remove from local index
7. **Response**: Return success/failure with blockchain propagation status

### Examples

#### Delete a GUN Record
```bash
curl -X POST https://api.oip.onl/api/records/deleteRecord \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "delete": {
      "did": "did:gun:647f79c2a338:meal_1765213200_breakfast_tp8e47onl"
    }
  }'
```

#### Delete an Arweave Record
```bash
curl -X POST https://api.oip.onl/api/records/deleteRecord \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "delete": {
      "did": "did:arweave:abc123def456789"
    }
  }'
```

#### JavaScript/Frontend Example
```javascript
const deleteRecord = async (did, jwtToken) => {
  try {
    const response = await fetch('/api/records/deleteRecord', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`
      },
      body: JSON.stringify({
        delete: {
          did: did
        }
      })
    });
    
    const result = await response.json();
    
    if (response.ok) {
      console.log('Record deleted successfully:', result);
    } else {
      console.error('Failed to delete record:', result.error);
    }
    
    return result;
  } catch (error) {
    console.error('Error deleting record:', error);
    throw error;
  }
};

// Usage
await deleteRecord('did:gun:647f79c2a338:meal_1765213200_breakfast_tp8e47onl', userJwtToken);
```

### Security Features

- **Owner-Only Deletion**: Users can only delete records they created/own
- **Server Admin Privilege**: Users with email domains matching the server domain can delete server-created records
- **Authentication Required**: Valid JWT token required for all requests
- **Ownership Verification**: Multiple fallback methods for verifying record ownership
- **Immediate Effect**: Deletion takes effect immediately on the local server
- **Blockchain Propagation**: Arweave records automatically publish delete messages to blockchain
- **Audit Trail**: All deletion attempts are logged with user and record information

### Limitations

- **Owner-Only**: Users cannot delete records created by others (except server admins can delete server-created records)
- **Authentication Required**: Anonymous deletion not supported
- **No Undo**: Deletion is immediate and irreversible
- **Domain-Based Admin**: Admin privilege requires email domain to match `PUBLIC_API_BASE_URL` configuration

### Server Admin Privilege

**NEW FEATURE**: Users with email domains matching the server domain can delete server-created records.

**How It Works:**
1. User authenticates with JWT token containing their email
2. System extracts domain from user's email (e.g., `user@fitnessally.io` → `fitnessally.io`)
3. System extracts base domain from `PUBLIC_API_BASE_URL` (e.g., `https://oip.fitnessally.io` → `fitnessally.io`)
4. If email domain matches server base domain AND record was created by server's wallet, deletion is authorized
5. Delete message is signed with server's wallet (not user's) for blockchain verification

**Configuration:**
Set `PUBLIC_API_BASE_URL` in your environment:
```bash
# In .env file
PUBLIC_API_BASE_URL=https://oip.fitnessally.io
# or
PUBLIC_API_BASE_URL=https://api.fitnessally.io
# Both work - the system extracts the base domain (fitnessally.io)
```

**Example:**
```bash
# User admin@fitnessally.io can delete records created by oip.fitnessally.io server
curl -X POST https://oip.fitnessally.io/api/records/deleteRecord \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "delete": {
      "did": "did:arweave:5KMJavCBFR6rXGr1li2gFW-WukGxyGOz6ErV_F1VG5o"
    }
  }'
```

**Response with Blockchain Propagation:**
```json
{
    "success": true,
    "message": "Record deleted successfully",
    "did": "did:arweave:5KMJavCBFR6rXGr1li2gFW-WukGxyGOz6ErV_F1VG5o",
    "deletedCount": 1,
    "deleteMessageTxId": "new_delete_message_transaction_id",
    "blockchainDeletion": true,
    "propagationNote": "Delete message published to blockchain. Deletion will propagate to all nodes during sync."
}
```

**Security Notes:**
- Only works for records created by the server's wallet (checked via `oip.creator.publicKey`)
- Email domain must exactly match server's base domain (last two parts of hostname)
  - Examples: `oip.fitnessally.io` → `fitnessally.io`, `api.example.com` → `example.com`
- Delete message is signed by server wallet, ensuring network-wide deletion authorization
- All deletion attempts are logged with user email and record information
- Detailed admin check logging helps troubleshoot domain matching issues

### Verification

After deletion, you can verify the record was removed:

```bash
# Check if record still exists
curl "https://api.oip.onl/api/records?did=DELETED_RECORD_DID" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Should return empty results or 404

# For blockchain-propagated deletions, check the delete message
curl "https://api.oip.onl/api/records?didTx=DELETE_MESSAGE_TXID&recordType=deleteMessage"
```

---

## Method 2: Blockchain-Based Deletion (Network-Wide)

### Overview

Blockchain-based deletion publishes delete messages to the Arweave blockchain that are automatically processed by all OIP nodes during their blockchain synchronization. This ensures records are deleted across the entire OIP network, not just on a single server.

### Delete Message Format

**Standard Record Deletion:**
```json
{
    "delete": {
        "didTx": "did:arweave:21CFWdPPblqaF9f5yKH3Cqs4k32oaWyY7dQop-JLDsE"
    }
}
```

**Alternative DID Format (also supported):**
```json
{
    "delete": {
        "did": "did:arweave:21CFWdPPblqaF9f5yKH3Cqs4k32oaWyY7dQop-JLDsE"
    }
}
```

### Publishing Delete Messages

**Endpoint:** `POST /api/records/newRecord`

**Headers:**
```http
Content-Type: application/json
Authorization: Bearer <jwt-token>  # Optional but recommended for creator verification
```

**Request Body:**
```json
{
    "delete": {
        "didTx": "did:arweave:TARGET_RECORD_DID"
    }
}
```

**Response:**
```json
{
    "transactionId": "new_delete_message_txid",
    "didTx": "did:arweave:new_delete_message_txid",
    "message": "Delete message published successfully"
}
```

### How Blockchain Deletion Works

1. **Publish Delete Message**: Client sends delete message to `/api/records/newRecord`
2. **Blockchain Storage**: Delete message is stored on Arweave with `recordType: "deleteMessage"`
3. **Network Discovery**: All OIP nodes discover the delete message during blockchain sync (`keepDBUpToDate`)
4. **Authorization Check**: Each node verifies the delete message creator matches the original record creator
5. **Multi-Index Deletion**: Nodes search and delete from multiple indices:
   - `records` index (standard records)
   - `organizations` index (organization records)
   - `templates` index (template records - requires `deleteTemplate` format)
6. **Network-Wide Effect**: Record is deleted from all OIP nodes automatically

### Supported Record Types

#### Standard Records (records index)
- `post`, `image`, `video`, `audio`, `recipe`, `workout`, `exercise`, `text`, etc.
- **Format**: `{"delete": {"didTx": "did:arweave:record_id"}}`

#### Organization Records (organizations index)
- `organization` records
- **Format**: `{"delete": {"didTx": "did:arweave:organization_id"}}`
- **Note**: Organizations are stored in a separate `organizations` index but deletion works seamlessly
- **Recent Fix**: Enhanced `deleteRecordFromDB()` to search both `records` and `organizations` indices

#### Template Records (templates index)
- Template deletion requires a different format (covered in separate section)

### Authorization and Security

- **Creator Verification**: Only the original creator can delete their records
- **DID Matching**: Delete message creator must match `oip.creator.didAddress` of target record
- **Cross-Node Consistency**: All nodes enforce the same authorization rules
- **Immutable Audit Trail**: Delete messages are permanently stored on blockchain

### Examples

#### Delete a Blog Post
```bash
curl -X POST https://api.oip.onl/api/records/newRecord \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "delete": {
      "didTx": "did:arweave:blog_post_transaction_id"
    }
  }'
```

#### Delete an Organization
```bash
curl -X POST https://api.oip.onl/api/records/newRecord \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "delete": {
      "didTx": "did:arweave:yUzIZdeCYOoHG1iZpL-pTsKmR-QDwunnCUkCVmeWB7E"
    }
  }'
```

#### Delete a Media File
```bash
curl -X POST https://api.oip.onl/api/records/newRecord \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "delete": {
      "didTx": "did:arweave:media_record_transaction_id"
    }
  }'
```

### Verification

After publishing a delete message, you can verify deletion by:

1. **Check Target Record**: Query the target record to confirm it's deleted
   ```bash
   curl "https://api.oip.onl/api/records?didTx=TARGET_RECORD_DID"
   ```

2. **Check Delete Message**: Verify the delete message was indexed
   ```bash
   curl "https://api.oip.onl/api/records?recordType=deleteMessage&didTx=DELETE_MESSAGE_DID"
   ```

3. **Organization-Specific Check**: For organizations, check the organizations endpoint
   ```bash
   curl "https://api.oip.onl/api/organizations"
   ```

### Limitations

- **Creator-Only**: Only record creators can delete their records
- **Irreversible**: Once processed by the network, deletion cannot be undone
- **Propagation Time**: Delete messages take time to propagate across all nodes
- **Template Deletion**: Requires different format (`deleteTemplate` instead of `delete`)

---

## Method 3: CLI Commands (Single Server)

### Overview

CLI commands directly delete records from a single server's Elasticsearch indices. These are useful for development, maintenance, and emergency cleanup but only affect the local server.

### Basic Syntax

```bash
node index.js [deletion_command] [parameters]
```

### Available CLI Deletion Commands

#### 1. Delete Records by DID

Delete specific records by their Decentralized Identifier (DID). Works for both Arweave and GUN records.

**Syntax:**
```bash
node index.js --deleteRecords --index <index_name> --did <did_value>
```

**Parameters:**
- `--deleteRecords`: Flag to enable record deletion mode
- `--index`: Target Elasticsearch index name (e.g., `records`, `templates`)
- `--did`: The DID of the record(s) to delete

**Examples:**
```bash
# Delete a GUN record
node index.js --deleteRecords --index records --did did:gun:647f79c2a338:profile_kr8xZJkBTH4awdmcABRy

# Delete an Arweave record
node index.js --deleteRecords --index records --did did:arweave:abc123def456789

# Delete a template
node index.js --deleteRecords --index templates --did did:arweave:template_id_123
```

**Use Cases:**
- Remove problematic GUN records during development
- Clean up specific test records
- Delete individual records without affecting others
- Works with both legacy `didTx` and new unified `did` fields

---

#### 2. Delete Records by Arweave Block Threshold

Delete all records from a specific Arweave block number onwards. Only works for Arweave records (GUN records don't have block numbers).

**Syntax:**
```bash
node index.js --deleteRecords --index <index_name> --blockThreshold <block_number>
```

**Parameters:**
- `--deleteRecords`: Flag to enable record deletion mode
- `--index`: Target Elasticsearch index name
- `--blockThreshold`: Arweave block number (records with `inArweaveBlock >= blockThreshold` will be deleted)

**Examples:**
```bash
# Delete all records from block 1580628 onwards
node index.js --deleteRecords --index records --blockThreshold 1580628

# Delete templates from a specific block
node index.js --deleteRecords --index templates --blockThreshold 1600000
```

**Use Cases:**
- Roll back to a specific point in blockchain history
- Remove records added after a certain date/block
- Clean up after problematic blockchain syncing

---

#### 3. Delete Records by Indexed Timestamp

Delete all records indexed after a specific timestamp.

**Syntax:**
```bash
node index.js --deleteRecords --index <index_name> --indexedAt <timestamp>
```

**Parameters:**
- `--deleteRecords`: Flag to enable record deletion mode
- `--index`: Target Elasticsearch index name
- `--indexedAt`: ISO timestamp (records with `indexedAt >= timestamp` will be deleted)

**Examples:**
```bash
# Delete records indexed after a specific date
node index.js --deleteRecords --index records --indexedAt "2024-01-15T10:00:00.000Z"

# Delete recent test records
node index.js --deleteRecords --index records --indexedAt "2024-12-01T00:00:00.000Z"
```

**Use Cases:**
- Remove records added during a specific time period
- Clean up after testing sessions
- Remove records indexed after a known good state

---

#### 4. Delete All Records from Index

Delete all records from a specified index while keeping the index structure intact.

**Syntax:**
```bash
node index.js --deleteAllRecords --index <index_name>
```

**Parameters:**
- `--deleteAllRecords`: Flag to delete all records (different from `--deleteRecords`)
- `--index`: Target Elasticsearch index name

**Examples:**
```bash
# Delete all records but keep the index
node index.js --deleteAllRecords --index records

# Clear all templates
node index.js --deleteAllRecords --index templates
```

**Use Cases:**
- Complete data reset while preserving index mapping
- Clear test data before production deployment
- Reset during development

---

#### 5. Delete Entire Index

Delete an entire Elasticsearch index including its mapping and all data.

**Syntax:**
```bash
node index.js --deleteIndex --index <index_name>
```

**Parameters:**
- `--deleteIndex`: Flag to delete the entire index
- `--index`: Target Elasticsearch index name

**Examples:**
```bash
# Delete the entire records index
node index.js --deleteIndex --index records

# Delete a test index
node index.js --deleteIndex --index test_records
```

**Use Cases:**
- Complete index removal and recreation
- Remove obsolete indices
- Clean slate for major schema changes

**⚠️ Warning:** This completely removes the index. You'll need to recreate it before adding new records.

## Docker Usage

When the OIP system is running in Docker containers, you can execute deletion commands using `docker exec`.

### Docker Command Structure

```bash
# Start the container (if not running)
docker start oip-arweave-indexer-oip-1

# Execute deletion command inside the container
docker exec -it oip-arweave-indexer-oip-1 \
  node index.js [deletion_command] [parameters]
```

### Docker Examples

#### Delete by DID
```bash
docker start oip-arweave-indexer-oip-1
docker exec -it oip-arweave-indexer-oip-1 \
  node index.js --deleteRecords --index records --did did:gun:647f79c2a338:profile_kr8xZJkBTH4awdmcABRy
```

#### Delete by Block Threshold
```bash
docker start oip-arweave-indexer-oip-1
docker exec -it oip-arweave-indexer-oip-1 \
  node index.js --deleteRecords --index records --blockThreshold 1580628
```

#### Delete by Timestamp
```bash
docker start oip-arweave-indexer-oip-1
docker exec -it oip-arweave-indexer-oip-1 \
  node index.js --deleteRecords --index records --indexedAt "2024-01-15T10:00:00.000Z"
```

#### Delete All Records
```bash
docker start oip-arweave-indexer-oip-1
docker exec -it oip-arweave-indexer-oip-1 \
  node index.js --deleteAllRecords --index records
```

#### Delete Entire Index
```bash
docker start oip-arweave-indexer-oip-1
docker exec -it oip-arweave-indexer-oip-1 \
  node index.js --deleteIndex --index old_test_index
```

## Command Priority

If multiple deletion parameters are provided, they are processed in this order:

1. **DID deletion** (`--did`) - Highest priority
2. **Block threshold** (`--blockThreshold`)
3. **Indexed timestamp** (`--indexedAt`)
4. **Delete all records** (`--deleteAllRecords`)
5. **Delete index** (`--deleteIndex`)

Only the first matching command will be executed.

## Safety Features

### Input Validation
- **DID validation**: Must be a non-empty string
- **Block threshold**: Must be a valid integer
- **Timestamp**: Must be a valid date string
- **Index name**: Must be a valid string

### Confirmation Output
All commands provide detailed output showing:
- What operation was performed
- How many records were affected
- Success/failure status
- Error details if something goes wrong

### Example Output
```bash
$ node index.js --deleteRecords --index records --did did:gun:test:123
Deleting records from index 'records' with DID 'did:gun:test:123'...
Deleted 1 records from index 'records' with DID 'did:gun:test:123'.
Deletion completed successfully: { took: 5, deleted: 1, ... }
```

## Common Use Cases

### Development Workflow
```bash
# 1. Delete problematic GUN record
node index.js --deleteRecords --index records --did did:gun:647f79c2a338:profile_kr8xZJkBTH4awdmcABRy

# 2. Clean up test records from today
node index.js --deleteRecords --index records --indexedAt "2024-12-22T00:00:00.000Z"

# 3. Reset for fresh testing
node index.js --deleteAllRecords --index records
```

### Blockchain Rollback
```bash
# Roll back to block 1580000
node index.js --deleteRecords --index records --blockThreshold 1580000
node index.js --deleteRecords --index templates --blockThreshold 1580000
```

### Index Maintenance
```bash
# Remove old test index
node index.js --deleteIndex --index old_test_records

# Clear and reset main index
node index.js --deleteAllRecords --index records
```

## Error Handling

### Common Errors

**Invalid Parameters:**
```bash
$ node index.js --deleteRecords --index records --blockThreshold abc
Invalid blockThreshold value. Please provide a valid number.
```

**Missing Parameters:**
```bash
$ node index.js --deleteRecords --index records
# No deletion performed - missing required parameter (did, blockThreshold, or indexedAt)
```

**Elasticsearch Connection:**
```bash
Error occurred during deletion: ConnectionError: getaddrinfo ENOTFOUND elasticsearch
```

### Troubleshooting

1. **Elasticsearch not running**: Ensure Elasticsearch is accessible
2. **Invalid index**: Check that the target index exists
3. **Permission issues**: Ensure proper access rights
4. **Docker issues**: Verify container is running and accessible

## Best Practices

### Before Deletion
1. **Backup important data** if working with production
2. **Test commands** with small datasets first
3. **Verify target index** and parameters
4. **Check record counts** before and after deletion

### During Development
1. Use **DID deletion** for specific problematic records
2. Use **timestamp deletion** for cleaning up test sessions
3. Use **block threshold** for blockchain-related issues
4. Keep track of deleted records for potential restoration

### Production Safety
1. **Never run deletion commands on production** without proper authorization
2. **Always backup** before bulk deletions
3. **Test in staging** environment first
4. **Document** what was deleted and why

## Technical Details

### Elasticsearch Queries

The deletion commands use these Elasticsearch query patterns:

**DID Query:**
```json
{
  "query": {
    "bool": {
      "should": [
        { "term": { "oip.did": "target_did" } },
        { "term": { "oip.didTx": "target_did" } }
      ]
    }
  }
}
```

**Block Threshold:**
```json
{
  "query": {
    "range": {
      "oip.inArweaveBlock": { "gte": 1580628 }
    }
  }
}
```

**Timestamp:**
```json
{
  "query": {
    "range": {
      "oip.indexedAt": { "gte": "2024-01-15T10:00:00.000Z" }
    }
  }
}
```

### Implementation Files

- **CLI Logic**: `index.js` (lines 212-287)
- **Deletion Functions**: `helpers/elasticsearch.js`
  - `deleteRecordsByDID()`
  - `deleteRecordsByBlock()`
  - `deleteRecordsByIndexedAt()`
  - `deleteRecordsByIndex()`
  - `deleteIndex()`

---

**⚠️ Important:** Always exercise caution when deleting records. These operations are irreversible unless you have backups. Test thoroughly in development environments before using in production.
