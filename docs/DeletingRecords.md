# OIP Record Deletion Documentation

## Overview

The OIP Arweave Indexer provides several CLI commands for deleting records from Elasticsearch indices during development and maintenance. These commands are useful for cleaning up test data, removing problematic records, or performing bulk deletions based on various criteria.

## Prerequisites

- Access to the OIP server environment
- Elasticsearch running and accessible
- Appropriate permissions to modify indices

## CLI Commands

### Basic Syntax

```bash
node index.js [deletion_command] [parameters]
```

### Available Deletion Commands

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
