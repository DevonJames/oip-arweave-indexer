# Elasticsearch Comprehensive Guide

## Overview

This comprehensive guide covers all aspects of working with Elasticsearch in the OIP Arweave Indexer system, including storage management, field mapping, record deletion, and template cleanup. The system has evolved to provide robust data management capabilities with proper type safety, flexible storage options, and comprehensive cleanup tools.

## Table of Contents

1. [Storage Management](#storage-management)
2. [Field Mapping from Templates](#field-mapping-from-templates)
3. [Record Deletion Methods](#record-deletion-methods)
4. [Template Cleanup System](#template-cleanup-system)
5. [Best Practices](#best-practices)
6. [Troubleshooting](#troubleshooting)

---

## Storage Management

### Overview

Elasticsearch storage has been migrated from **Docker-managed volumes** to **host filesystem bind mounts**. This change prevents hitting Docker's disk image space limits and gives you direct access to Elasticsearch data on your host filesystem.

### What Changed?

#### Before (Docker-managed volume)
```yaml
volumes:
  - esdata:/usr/share/elasticsearch/data
```
- Data stored in Docker's internal volume: `/var/lib/docker/volumes/`
- Limited by Docker's disk image size
- Not directly accessible on host

#### After (Host bind mount)
```yaml
volumes:
  - ${ELASTICSEARCH_DATA_PATH:-./elasticsearch_data}:/usr/share/elasticsearch/data
```
- Data stored on your host filesystem
- Full access to host disk space (1.1+ TB typically)
- Directly accessible and manageable

### Configuration

#### Environment Variable

Add to your `.env` file:

```bash
# Default: stores in project directory
ELASTICSEARCH_DATA_PATH=./elasticsearch_data

# Or use absolute path for more space:
ELASTICSEARCH_DATA_PATH=/data/elasticsearch

# Or custom location:
ELASTICSEARCH_DATA_PATH=/mnt/storage/elasticsearch
```

#### Choosing a Location

**Option 1: Project Directory (Default)**
```bash
ELASTICSEARCH_DATA_PATH=./elasticsearch_data
```
- ✅ Simple, keeps everything together
- ✅ Easy to backup with project
- ⚠️  Limited by project partition space

**Option 2: Dedicated Data Directory**
```bash
ELASTICSEARCH_DATA_PATH=/data/elasticsearch
```
- ✅ Can use separate partition with more space
- ✅ Independent of project location
- ✅ Better for production deployments
- ⚠️  Requires creating `/data` directory first

**Option 3: Custom Path**
```bash
ELASTICSEARCH_DATA_PATH=/mnt/bigdisk/elasticsearch
```
- ✅ Maximum flexibility
- ✅ Can use external drives or NFS mounts
- ⚠️  Make sure path exists and has correct permissions

### Migration Process

#### Check Current Storage Status

```bash
make check-es-storage
```

This shows:
- Current storage location
- Disk space available
- Whether old Docker volume exists
- Data size

#### Migrate Existing Data

If you have existing Elasticsearch data in a Docker volume:

```bash
# 1. Stop services
make down

# 2. Migrate data to host filesystem
make migrate-elasticsearch-data

# 3. Start services with your profile
make up PROFILE=standard
```

The migration tool will:
- ✅ Automatically detect your old Docker volume
- ✅ Copy all data to the new location
- ✅ Set correct permissions (elasticsearch user: 1000:1000)
- ✅ Verify data integrity

#### Clean Up Old Volume

After verifying the migration worked:

```bash
# Remove old Docker volume to free space
make clean-old-es-volume
```

⚠️  **Wait 10 seconds before confirming** - this is destructive!

### Fresh Installation

For new installations, no migration is needed:

```bash
# 1. Configure path in .env (optional)
echo "ELASTICSEARCH_DATA_PATH=/data/elasticsearch" >> .env

# 2. Create directory with correct permissions
sudo mkdir -p /data/elasticsearch
sudo chown -R 1000:1000 /data/elasticsearch

# 3. Start services
make up PROFILE=standard
```

Elasticsearch will automatically initialize the data directory.

### Benefits

✅ **More Space**: Access full host disk space, not limited by Docker's disk image

✅ **Better Performance**: Direct filesystem access, no Docker volume layer

✅ **Easy Backup**: Data is directly accessible on host for backup tools

✅ **Easy Migration**: Can move data directory between systems easily

✅ **Monitoring**: Can monitor disk usage with standard tools (`du`, `df`)

✅ **Flexibility**: Can use network mounts, external drives, etc.

---

## Field Mapping from Templates

### Problem

Elasticsearch uses **dynamic mapping** - it infers field types from the first value it sees. This causes issues when OIP templates define field types that don't match what Elasticsearch auto-detects:

#### Example Issue:
```javascript
// Template defines:
{
  "item_amounts": {
    "type": "repeated float",  // Should be float array
    "index": 6
  }
}

// But if first value happens to be [1, 2, 3], Elasticsearch maps it as long
// Future values like [1.5, 2.3] will fail!
```

### Solution

The system now **automatically generates Elasticsearch mappings from OIP template field types**.

#### How It Works

1. **Template Field Types** → **Elasticsearch Types**:
   ```
   string         → text with keyword subfield
   float          → float
   repeated float → float (ES handles arrays automatically)
   long/uint64    → long
   bool           → boolean
   dref           → text with keyword subfield
   enum           → text with keyword subfield
   ```

2. **Auto-generation**: When a new template is published, the system automatically:
   - Reads the `fieldsInTemplate` from the template
   - Converts OIP types to Elasticsearch types
   - Updates the records index mapping
   - Logs the update for verification

3. **Manual Update**: For existing templates, run:
   ```bash
   node config/updateElasticsearchMappings.js
   ```

### Usage

#### For New Templates

**Automatic** - No action needed! When you publish a new template via:
```bash
POST /api/templates/newTemplate
```

The system will automatically:
1. Index the template
2. Generate Elasticsearch mapping from field types
3. Update the records index
4. Log the mapping update

#### For Existing Templates

##### Local Execution (Development)

```bash
# From project root - update ALL templates
node config/updateElasticsearchMappings.js

# Update single template (test first!)
node config/updateElasticsearchMappings.js shoppingList

# Update single template and reindex its records
node config/updateElasticsearchMappings.js shoppingList --reindex
```

##### Docker Execution (Production)

```bash
# Make sure container is running
docker ps | grep oip-gpu

# Update ALL templates
docker exec -it fitnessally-oip-gpu-1 \
  node config/updateElasticsearchMappings.js

# Update single template (safer for testing)
docker exec -it fitnessally-oip-gpu-1 \
  node config/updateElasticsearchMappings.js shoppingList

# Update single template with reindex
docker exec -it fitnessally-oip-gpu-1 \
  node config/updateElasticsearchMappings.js shoppingList --reindex

# For other deployments, use appropriate container name:
# oip-arweave-indexer-oip-1 (standard)
# rockhoppers-oip-minimal-1 (rockhoppers)
# etc.
```

#### After Migration

If you've just migrated Elasticsearch data, run:

```bash
# 1. Update mappings from templates (Docker)
docker exec -it fitnessally-oip-gpu-1 \
  node config/updateElasticsearchMappings.js

# 2. Restart your application
docker-compose restart oip-gpu
```

#### Testing Workflow

**Recommended approach** - test on one template first:

```bash
# 1. Test on a single template
docker exec -it fitnessally-oip-gpu-1 \
  node config/updateElasticsearchMappings.js shoppingList

# 2. Verify the mapping
curl -s 'http://localhost:9210/records/_mapping' | \
  jq '.records.mappings.properties.data.properties.shoppingList'

# 3. If it looks good, update all templates
docker exec -it fitnessally-oip-gpu-1 \
  node config/updateElasticsearchMappings.js
```

This will:
- ✅ Process all 55+ templates in your system
- ✅ Generate mappings for each template's fields
- ✅ Update the records index
- ✅ Reindex existing records to apply mappings
- ✅ Show summary of what was updated

### Field Type Mapping Reference

| OIP Type | Elasticsearch Type | Notes |
|----------|-------------------|-------|
| `string` | `text` + `.keyword` | Full-text search + exact match |
| `float` | `float` | Decimal numbers |
| `repeated float` | `float` | ES handles arrays automatically |
| `long` | `long` | Integers |
| `uint64` | `long` | Large integers |
| `bool` | `boolean` | true/false |
| `repeated bool` | `boolean` | Array of booleans |
| `dref` | `text` + `.keyword` | Record references |
| `repeated dref` | `text` + `.keyword` | Array of references |
| `enum` | `text` + `.keyword` | Enumerated values |
| `repeated string` | `text` + `.keyword` | Array of strings |

### Integration Points

#### 1. Template Publishing (Automatic)

In `helpers/elasticsearch.js` → `processNewTemplate()`:
```javascript
// After template is indexed (line 4363-4370)
const { updateMappingForNewTemplate } = require('./generateElasticsearchMappings');
await updateMappingForNewTemplate(templateName, fieldsInTemplate);
```

#### 2. Manual Updates

```bash
node config/updateElasticsearchMappings.js
```

#### 3. Docker Integration

Can be added to container startup or Makefile:

```makefile
update-es-mappings: ## Update Elasticsearch mappings from templates
	docker-compose exec oip-gpu node config/updateElasticsearchMappings.js
```

### Benefits

✅ **Type Safety**: Fields maintain correct types regardless of first value  
✅ **Automatic**: New templates automatically get correct mappings  
✅ **Retroactive**: Existing templates can be fixed with one command  
✅ **Consistent**: All nodes use same mappings from shared templates  
✅ **Documented**: Template types serve as mapping documentation  

### Example: Shopping List Template

**Template Definition**:
```json
{
  "item_amounts": {
    "type": "repeated float",
    "index": 6
  },
  "total_cost": {
    "type": "float",
    "index": 3
  }
}
```

**Generated Elasticsearch Mapping**:
```json
{
  "properties": {
    "data": {
      "properties": {
        "shoppingList": {
          "properties": {
            "item_amounts": {
              "type": "float"
            },
            "total_cost": {
              "type": "float"
            }
          }
        }
      }
    }
  }
}
```

**Result**: First value can be `[1, 2, 3]` OR `[1.5, 2.3]` - both work correctly!

---

## Record Deletion Methods

### Overview

The OIP Arweave Indexer provides multiple methods for deleting records:

1. **API Endpoint Deletion**: Direct API calls for authenticated users to delete their own records from local Elasticsearch indices
2. **CLI Commands**: Direct server commands for deleting records from local Elasticsearch indices
3. **Blockchain-Based Deletion**: Publishing delete messages to Arweave that are processed by all OIP nodes

These methods are useful for cleaning up test data, removing problematic records, or performing bulk deletions based on various criteria.

### Method Comparison

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

### Method 1: API Endpoint Deletion (Single Server, User-Owned Records)

#### Overview

The API endpoint deletion method allows authenticated users to delete their own records directly from the local server's Elasticsearch indices. This method provides immediate deletion with proper ownership verification, ensuring users can only delete records they created.

#### Authentication Required

This method requires a valid JWT token obtained through the OIP authentication system. The token must contain the user's public key for ownership verification.

#### Delete Record Format

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

#### API Endpoint

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

#### How API Deletion Works

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

#### Examples

##### Delete a GUN Record
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

##### Delete an Arweave Record
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

##### JavaScript/Frontend Example
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

#### Security Features

- **Owner-Only Deletion**: Users can only delete records they created/own
- **Server Admin Privilege**: Users with email domains matching the server domain can delete server-created records
- **Authentication Required**: Valid JWT token required for all requests
- **Ownership Verification**: Multiple fallback methods for verifying record ownership
- **Immediate Effect**: Deletion takes effect immediately on the local server
- **Blockchain Propagation**: Arweave records automatically publish delete messages to blockchain
- **Audit Trail**: All deletion attempts are logged with user and record information

#### Server Admin Privilege

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

### Method 2: Blockchain-Based Deletion (Network-Wide)

#### Overview

Blockchain-based deletion publishes delete messages to the Arweave blockchain that are automatically processed by all OIP nodes during their blockchain synchronization. This ensures records are deleted across the entire OIP network, not just on a single server.

#### Delete Message Format

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

#### Publishing Delete Messages

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

#### How Blockchain Deletion Works

1. **Publish Delete Message**: Client sends delete message to `/api/records/newRecord`
2. **Blockchain Storage**: Delete message is stored on Arweave with `recordType: "deleteMessage"`
3. **Network Discovery**: All OIP nodes discover the delete message during blockchain sync (`keepDBUpToDate`)
4. **Authorization Check**: Each node verifies the delete message creator matches the original record creator
5. **Multi-Index Deletion**: Nodes search and delete from multiple indices:
   - `records` index (standard records)
   - `organizations` index (organization records)
   - `templates` index (template records - requires `deleteTemplate` format)
6. **Network-Wide Effect**: Record is deleted from all OIP nodes automatically

#### Supported Record Types

##### Standard Records (records index)
- `post`, `image`, `video`, `audio`, `recipe`, `workout`, `exercise`, `text`, etc.
- **Format**: `{"delete": {"didTx": "did:arweave:record_id"}}`

##### Organization Records (organizations index)
- `organization` records
- **Format**: `{"delete": {"didTx": "did:arweave:organization_id"}}`
- **Note**: Organizations are stored in a separate `organizations` index but deletion works seamlessly
- **Recent Fix**: Enhanced `deleteRecordFromDB()` to search both `records` and `organizations` indices

##### Template Records (templates index)
- Template deletion requires a different format (covered in separate section)

#### Authorization and Security

- **Creator Verification**: Only the original creator can delete their records
- **DID Matching**: Delete message creator must match `oip.creator.didAddress` of target record
- **Cross-Node Consistency**: All nodes enforce the same authorization rules
- **Immutable Audit Trail**: Delete messages are permanently stored on blockchain

#### Examples

##### Delete a Blog Post
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

##### Delete an Organization
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

##### Delete a Media File
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

### Method 3: CLI Commands (Single Server)

#### Overview

CLI commands directly delete records from a single server's Elasticsearch indices. These are useful for development, maintenance, and emergency cleanup but only affect the local server.

#### Basic Syntax

```bash
node index.js [deletion_command] [parameters]
```

#### Available CLI Deletion Commands

##### 1. Delete Records by DID

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

##### 2. Delete Records by Arweave Block Threshold

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

##### 3. Delete Records by Indexed Timestamp

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

##### 4. Delete All Records from Index

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

##### 5. Delete Entire Index

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

**⚠️ Warning:** This completely removes the index. You'll need to recreate it before adding new records.

#### Docker Usage

When the OIP system is running in Docker containers, you can execute deletion commands using `docker exec`.

##### Docker Command Structure

```bash
# Start the container (if not running)
docker start oip-arweave-indexer-oip-1

# Execute deletion command inside the container
docker exec -it oip-arweave-indexer-oip-1 \
  node index.js [deletion_command] [parameters]
```

##### Docker Examples

**Delete by DID**
```bash
docker start oip-arweave-indexer-oip-1
docker exec -it oip-arweave-indexer-oip-1 \
  node index.js --deleteRecords --index records --did did:gun:647f79c2a338:profile_kr8xZJkBTH4awdmcABRy
```

**Delete by Block Threshold**
```bash
docker start oip-arweave-indexer-oip-1
docker exec -it oip-arweave-indexer-oip-1 \
  node index.js --deleteRecords --index records --blockThreshold 1580628
```

**Delete by Timestamp**
```bash
docker start oip-arweave-indexer-oip-1
docker exec -it oip-arweave-indexer-oip-1 \
  node index.js --deleteRecords --index records --indexedAt "2024-01-15T10:00:00.000Z"
```

**Delete All Records**
```bash
docker start oip-arweave-indexer-oip-1
docker exec -it oip-arweave-indexer-oip-1 \
  node index.js --deleteAllRecords --index records
```

**Delete Entire Index**
```bash
docker start oip-arweave-indexer-oip-1
docker exec -it oip-arweave-indexer-oip-1 \
  node index.js --deleteIndex --index old_test_index
```

#### Command Priority

If multiple deletion parameters are provided, they are processed in this order:

1. **DID deletion** (`--did`) - Highest priority
2. **Block threshold** (`--blockThreshold`)
3. **Indexed timestamp** (`--indexedAt`)
4. **Delete all records** (`--deleteAllRecords`)
5. **Delete index** (`--deleteIndex`)

Only the first matching command will be executed.

---

## Template Cleanup System

### Overview

The Template Cleanup system provides tools to identify and delete unused templates to resolve Elasticsearch field limit issues. When your system hits the default 1000-field limit per index, cleaning up unused templates is often a better solution than simply increasing limits.

### Problem Background

#### The Field Limit Issue
Elasticsearch has a default limit of **1000 fields per index** to prevent performance issues. Complex templates with many fields (especially those with enums, nested objects, and dynamic mappings) can quickly consume this limit.

**Common Error:**
```
illegal_argument_exception: Limit of total fields [1000] has been exceeded while adding new fields [14]
```

#### Why Templates Accumulate
- **Development iterations**: Creating multiple versions while refining templates
- **Mistakes and corrections**: Publishing templates with errors, then creating corrected versions
- **Testing**: Creating templates for testing that are never used in production
- **Complex field structures**: Fitness templates, organization templates, etc. with many enum values

### Solution Architecture

#### Core Components

1. **Analysis Engine** (`/api/cleanup/analyze-templates`)
   - Scans all templates in the database
   - Checks record usage for each template
   - Calculates field usage and potential savings

2. **Deletion System** (`/api/cleanup/delete-unused-templates`)
   - Safely removes unused templates
   - Publishes proper delete messages to Arweave
   - Provides detailed operation results

3. **Web Interface** (`/template-cleanup.html`)
   - User-friendly dashboard for template management
   - Real-time analysis with visual statistics
   - Secure JWT-based authentication

#### Safety Mechanisms

##### Usage Verification
```javascript
async function checkTemplateUsage(templateTxId) {
    // Gets all records and templates
    const result = await getRecordsInDB();
    const templatesData = await getTemplatesInDB();
    
    // Finds template by TxId
    const targetTemplate = templates.find(t => t.data.TxId === templateTxId);
    const templateName = targetTemplate.data.template;
    
    // Filters records that use this template
    const recordsUsingTemplate = records.filter(record => {
        return Object.keys(record.data).includes(templateName);
    });
    
    return recordsUsingTemplate.length > 0;
}
```

##### Authorization Checks
- Only template creators can delete their templates
- JWT authentication required for all operations
- Creator DID verification: `creatorDid === 'did:arweave:' + transaction.creator`

##### Delete Message Publishing
Templates are deleted by publishing delete messages to Arweave:
```json
{
    "delete": {
        "didTx": "did:arweave:TEMPLATE_TRANSACTION_ID"
    }
}
```

### API Reference

#### Authentication
All cleanup endpoints require JWT authentication:
```http
Authorization: Bearer YOUR_JWT_TOKEN
```

#### GET /api/cleanup/analyze-templates

Analyzes template usage and identifies unused templates.

**Response:**
```json
{
    "success": true,
    "message": "Template analysis completed",
    "analysis": {
        "totalTemplates": 45,
        "usedTemplates": 12,
        "unusedTemplates": 33,
        "totalFields": 1247,
        "unusedFields": 892,
        "potentialSavings": "892 fields (72% reduction)",
        "templates": {
            "used": [...],
            "unused": [
                {
                    "name": "organization",
                    "txId": "ABC123...",
                    "did": "did:arweave:ABC123...",
                    "creator": "Librarian7",
                    "createdAt": "2025-01-15T10:30:00Z",
                    "fieldCount": 14,
                    "blockHeight": 1754285
                }
            ]
        }
    }
}
```

#### POST /api/cleanup/delete-unused-templates

Deletes all unused templates (requires confirmation).

**Request:**
```json
{
    "confirm": true,
    "maxToDelete": 10  // Optional: limit deletions
}
```

**Response:**
```json
{
    "success": true,
    "message": "Template deletion process completed. 8/10 templates deleted.",
    "results": {
        "totalUnused": 33,
        "attempted": 10,
        "successful": 8,
        "totalFieldsFreed": 156,
        "deletions": [
            {
                "template": "organization",
                "did": "did:arweave:ABC123...",
                "fieldCount": 14,
                "deleteTransactionId": "XYZ789...",
                "status": "success"
            }
        ]
    }
}
```

#### POST /api/cleanup/delete-template

Deletes a specific template by DID.

**Request:**
```json
{
    "templateDid": "did:arweave:TEMPLATE_DID_HERE",
    "confirm": true
}
```

**Response:**
```json
{
    "success": true,
    "message": "Template deletion message published successfully",
    "templateDid": "did:arweave:TEMPLATE_DID_HERE",
    "deleteTransactionId": "DELETE_TX_ID"
}
```

### Web Interface Guide

#### Accessing the Interface

Navigate to: `https://your-server.com/template-cleanup.html`

#### Step-by-Step Usage

##### 1. Authentication
- Enter your JWT token in the authentication section
- Click "Set Token" to enable cleanup features
- Status indicator shows authentication success

##### 2. Template Analysis
- Click "🔍 Analyze Templates" to scan your database
- Review the statistics dashboard:
  - **Total Templates**: All templates in database
  - **Unused Templates**: Templates with no records
  - **Unused Fields**: Total fields that can be freed
  - **Potential Savings**: Percentage reduction possible

##### 3. Review Template Lists
- **Unused Templates**: Red-tagged templates safe to delete
- **Used Templates**: Green-tagged templates currently in use
- Each template shows:
  - Template name and creator
  - Creation date and DID
  - Field count contribution

##### 4. Cleanup Options

**Bulk Deletion:**
- Delete all unused templates at once
- Optional: Set maximum number to delete per batch
- Confirmation dialog prevents accidents

**Individual Deletion:**
- Enter specific template DID
- Useful for targeted cleanup
- Immediate confirmation required

#### Interface Features

##### Real-time Statistics
```
┌─────────────────┬─────────────────┬─────────────────┬─────────────────┐
│ Total Templates │ Unused Templates│  Unused Fields  │ Potential Savings│
│       45        │       33        │      892        │       72%       │
└─────────────────┴─────────────────┴─────────────────┴─────────────────┘
```

##### Template Status Indicators
- 🗑️ **UNUSED**: Safe to delete, no records using it
- ✅ **IN USE**: Has records, cannot be deleted
- Field count badges show impact of each template

##### Operation Results
- Real-time progress updates
- Detailed transaction IDs for audit trail
- Success/failure status for each operation
- Total field savings calculations

### Best Practices

#### When to Run Cleanup

1. **Before hitting field limits**: Proactive maintenance
2. **After development cycles**: Clean up test/development templates
3. **Regular maintenance**: Monthly or quarterly cleanup
4. **Before major deployments**: Ensure clean slate for new templates

#### Recommended Workflow

1. **Start Small**: Delete 5-10 templates first to test
2. **Monitor Results**: Check that indexing errors stop
3. **Gradual Scaling**: Increase batch sizes as confidence grows
4. **Document Changes**: Keep track of what was deleted

#### Safety Guidelines

- ✅ **Always run analysis first** to understand impact
- ✅ **Review unused template list** before bulk deletion
- ✅ **Start with small batches** (5-10 templates)
- ✅ **Monitor system logs** during and after cleanup
- ✅ **Keep audit trail** of deletion transaction IDs
- ❌ **Don't delete templates without analysis**
- ❌ **Don't ignore confirmation dialogs**
- ❌ **Don't run cleanup during high-traffic periods**

---

## Best Practices

### Storage Management

1. **Choose Appropriate Storage Location**:
   - Use project directory for development
   - Use dedicated data directory for production
   - Monitor disk space regularly

2. **Migration Safety**:
   - Always backup before migration
   - Test migration on non-production systems first
   - Verify data integrity after migration

3. **Permission Management**:
   - Ensure correct ownership (1000:1000 for elasticsearch user)
   - Monitor permission changes after system updates

### Field Mapping

1. **Template Design**:
   - Use consistent field types across templates
   - Avoid overly complex nested structures
   - Document field purposes and types

2. **Mapping Updates**:
   - Test mapping changes on single templates first
   - Monitor for field limit issues
   - Keep mapping documentation up to date

3. **Type Safety**:
   - Use explicit field types in templates
   - Avoid relying on dynamic mapping
   - Test with various data types

### Record Deletion

1. **Choose Appropriate Method**:
   - Use API endpoints for user self-service
   - Use blockchain deletion for network-wide cleanup
   - Use CLI commands for maintenance and development

2. **Security Considerations**:
   - Always verify ownership before deletion
   - Use authentication for all deletion operations
   - Keep audit trails of deletion activities

3. **Testing and Verification**:
   - Test deletion methods in development first
   - Verify deletions are complete and correct
   - Monitor system logs for errors

### Template Cleanup

1. **Regular Maintenance**:
   - Run analysis before hitting field limits
   - Clean up unused templates regularly
   - Monitor field usage patterns

2. **Safe Cleanup Practices**:
   - Always analyze before deleting
   - Start with small batches
   - Keep records of what was deleted

3. **Prevention**:
   - Design templates carefully to avoid field bloat
   - Use consistent naming conventions
   - Remove test templates promptly

---

## Troubleshooting

### Storage Issues

#### Permission Issues

If Elasticsearch fails to start with permission errors:

```bash
# Fix permissions (elasticsearch runs as user 1000)
sudo chown -R 1000:1000 /path/to/elasticsearch_data
```

#### Disk Space Issues

Check available space:

```bash
df -h /path/to/elasticsearch_data
```

If low on space, change `ELASTICSEARCH_DATA_PATH` to a location with more space:

```bash
# 1. Stop services
make down

# 2. Update .env
ELASTICSEARCH_DATA_PATH=/new/location/with/more/space

# 3. Move existing data (if any)
sudo mv ./elasticsearch_data /new/location/with/more/space/elasticsearch_data

# 4. Fix permissions
sudo chown -R 1000:1000 /new/location/with/more/space/elasticsearch_data

# 5. Start services
make up PROFILE=standard
```

#### Container Won't Start

Check Elasticsearch logs:

```bash
docker-compose logs elasticsearch
```

Common issues:
- **Permission denied**: Run `sudo chown -R 1000:1000 /path/to/data`
- **Directory not found**: Make sure `ELASTICSEARCH_DATA_PATH` directory exists
- **Disk full**: Check `df -h` and move to larger partition

### Field Mapping Issues

#### Mapping Update Fails

```bash
# Check Elasticsearch logs
docker logs fitnessally-elasticsearch-1 --tail 50

# Verify template has fieldsInTemplate
curl -s 'http://localhost:9210/templates/_search?q=template:shoppingList' | \
  jq '.hits.hits[0]._source.data.fieldsInTemplate'
```

#### Types Still Wrong After Update

```bash
# Reindex to apply mapping changes
curl -X POST 'http://localhost:9210/records/_update_by_query?refresh=true&conflicts=proceed'
```

#### Check Current Mapping

```bash
# Check a specific template's mapping
curl -s 'http://localhost:9210/records/_mapping' | \
  jq '.records.mappings.properties.data.properties.shoppingList'
```

### Record Deletion Issues

#### Common Errors

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

#### Troubleshooting Steps

1. **Elasticsearch not running**: Ensure Elasticsearch is accessible
2. **Invalid index**: Check that the target index exists
3. **Permission issues**: Ensure proper access rights
4. **Docker issues**: Verify container is running and accessible

### Template Cleanup Issues

#### Common Issues

##### "Template is in use" Error
```json
{
    "error": "Template is in use by existing records and cannot be deleted"
}
```
**Solution**: This is working correctly - the template has records using it and should not be deleted.

##### Authentication Failures
```json
{
    "error": "Unauthorized: only the template creator can delete this template"
}
```
**Solution**: Ensure you're using the JWT token of the template creator.

##### Network Timeouts
**Solution**: 
- Reduce batch size (`maxToDelete` parameter)
- Wait between operations
- Check server logs for processing status

#### Verification Steps

After cleanup, verify success:

1. **Check Elasticsearch logs** for field limit errors
2. **Monitor template indexing** for new templates
3. **Run analysis again** to confirm field reduction
4. **Test new template creation** to ensure system works

#### Recovery Procedures

If templates are accidentally deleted:
- **Templates cannot be recovered** once delete messages are processed
- **Recreate templates** from backup or source definitions
- **Re-publish any records** that used the deleted templates

### General Troubleshooting

#### Check System Status

```bash
# Check Elasticsearch status
curl -s 'http://localhost:9210/_cluster/health'

# Check indices
curl -s 'http://localhost:9210/_cat/indices'

# Check field count
curl -s 'http://localhost:9210/records/_mapping' | jq '.records.mappings.properties | keys | length'
```

#### Monitor Logs

```bash
# Elasticsearch logs
docker-compose logs elasticsearch

# Application logs
docker-compose logs oip-gpu

# System logs
tail -f logs/interface-server.log
```

#### Performance Issues

1. **High Memory Usage**: Check for memory leaks in application
2. **Slow Queries**: Optimize Elasticsearch queries and mappings
3. **Field Limit**: Use template cleanup to reduce field count
4. **Disk Space**: Monitor storage usage and clean up old data

---

## Related Files

### Core Implementation Files

- `helpers/elasticsearch.js` - Core Elasticsearch operations
- `helpers/generateElasticsearchMappings.js` - Mapping generation logic
- `config/updateElasticsearchMappings.js` - CLI mapping update script
- `routes/cleanup.js` - Template cleanup API endpoints
- `index.js` - CLI deletion commands and route registration

### Configuration Files

- `docker-compose.yml` - Main Docker configuration
- `docker-compose-backend-only.yml` - Backend-only deployment
- `docker-compose-voice-enhanced.yml` - Voice-enhanced stack
- `.env` - Environment configuration

### Documentation Files

- `docs/OIP_TECHNICAL_OVERVIEW.md` - Template system documentation
- `docs/API_RECORDS_ENDPOINT_DOCUMENTATION.md` - API documentation
- `docs/MEMORY_MANAGEMENT_GUIDE.md` - Memory management

---

## Conclusion

This comprehensive guide covers all aspects of working with Elasticsearch in the OIP Arweave Indexer system. The system provides robust data management capabilities with:

- **Flexible Storage**: Host filesystem bind mounts for better performance and space management
- **Type Safety**: Automatic mapping generation from template field types
- **Multiple Deletion Methods**: API, blockchain, and CLI options for different use cases
- **Template Cleanup**: Tools to manage field limits and maintain system performance

Regular maintenance using these tools will keep your OIP deployment running smoothly and prevent common issues like field limits and storage problems. Always test changes in development environments before applying to production systems.
