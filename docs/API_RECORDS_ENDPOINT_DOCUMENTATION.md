# API Records Endpoint Documentation

## Overview

The `/api/records` endpoint provides powerful search and filtering capabilities for retrieving records from the OIP Arweave Indexer. This endpoint uses the `getRecords()` function and supports a wide variety of query parameters for precise data retrieval.

**Base URL:** `/api/records`  
**Method:** `GET`  
**Returns:** JSON object containing filtered and paginated records

## Query Parameters

### 📄 **Basic Filtering**

#### `recordType`
- **Type:** String
- **Description:** Filter records by their specific type
- **Example:** `recordType=post`
- **Common Values:** `post`, `image`, `audio`, `video`, `text`, `recipe`, `workout`, `deleteMessage`

#### `template`
- **Type:** String
- **Description:** Filter records by template name (case-insensitive partial match)
- **Example:** `template=basic`
- **Note:** Searches both object keys and array elements in record data

#### `search`
- **Type:** String
- **Description:** Full-text search across record name, description, and tags
- **Example:** `search=news politics`
- **Behavior:** 
  - Splits on spaces and commas
  - Searches name, description, and tags fields
  - Returns records matching ALL search terms (AND behavior)
  - Automatically sorts by match relevance

### 🏋️ **Exercise Filtering (Workouts)**

#### `exerciseNames`
- **Type:** String (comma-separated)
- **Description:** Filter workout records by exercise names they contain
- **Example:** `exerciseNames=Deadlifts,Plank,High%20Knees`
- **Behavior:** 
  - Only works with `recordType=workout`
  - Requires `resolveDepth=1` or higher (or `resolveNamesOnly=true`)
  - Searches the `data.workout.exercise` array for exercise names
  - Returns workouts that contain ANY of the specified exercises
  - Automatically sorts by order similarity (how closely the exercise order matches the request)
  - Adds `exerciseScore` and `exerciseMatchedCount` fields to matching records

#### `sortBy=exerciseScore`
- **Type:** String
- **Description:** Sort results by exercise matching score
- **Values:** 
  - `exerciseScore:desc` (default) - Best matches first
  - `exerciseScore:asc` - Worst matches first
- **Example:** `exerciseNames=Deadlifts,Plank&sortBy=exerciseScore:desc`
- **Note:** Only works when `exerciseNames` parameter is provided

### 🏷️ **Tag Filtering**

#### `tags`
- **Type:** String (comma-separated)
- **Description:** Filter records by tags
- **Example:** `tags=greek,grilling,cooking`
- **Default Behavior:** OR matching (records with ANY of the specified tags)
- **Scoring:** Automatically adds match scores based on tag overlap

#### `tagsMatchMode`
- **Type:** String
- **Description:** Controls tag matching behavior
- **Values:** 
  - `OR` (default) - Records with ANY of the specified tags
  - `AND` - Records with ALL of the specified tags
- **Example:** `tags=greek,grilling&tagsMatchMode=AND`

### 👤 **Creator Filtering**

#### `creatorHandle`
- **Type:** String
- **Description:** Filter by exact creator handle
- **Example:** `creatorHandle=john_creator`

#### `creator_name`
- **Type:** String
- **Description:** Filter by creator name (case-insensitive)
- **Example:** `creator_name=John Smith`

#### `creator_did_address`
- **Type:** String (URL-encoded)
- **Description:** Filter by creator's DID address
- **Example:** `creator_did_address=did%3Aarweave%3Asample123`

### 🔗 **Reference Filtering**

#### `didTx`
- **Type:** String
- **Description:** Filter by specific DID transaction ID
- **Example:** `didTx=did:arweave:abc123def456`

#### `didTxRef`
- **Type:** String
- **Description:** Filter records that reference a specific DID transaction
- **Example:** `didTxRef=did:arweave:ref123`
- **Note:** Recursively searches through all record data fields

#### `url`
- **Type:** String
- **Description:** Filter by URL (checks both `url` and `webUrl` fields)
- **Example:** `url=https://example.com/article`

### 📅 **Date Filtering**

#### `dateStart`
- **Type:** Date
- **Description:** Filter records created on or after this date
- **Example:** `dateStart=2024-01-01`
- **Format:** ISO date string or Unix timestamp

#### `dateEnd`
- **Type:** Date
- **Description:** Filter records created on or before this date
- **Example:** `dateEnd=2024-12-31`
- **Format:** ISO date string or Unix timestamp

### ⛓️ **Blockchain Filtering**

#### `inArweaveBlock`
- **Type:** Number | String
- **Description:** Filter by Arweave block number
- **Values:**
  - Number: Exact block number
  - `"bad"`: Records with invalid/missing block numbers
- **Example:** `inArweaveBlock=1234567`

### 🎵 **Media Filtering**

#### `hasAudio`
- **Type:** Boolean | String
- **Description:** Filter records by audio content presence
- **Values:**
  - `true`: Only records with audio content
  - `false`: Only records without audio content
- **Example:** `hasAudio=true`

### 📊 **Sorting**

#### `sortBy`
- **Type:** String
- **Description:** Sort results by specified field and order
- **Format:** `field:order` where order is `asc` or `desc`
- **Available Fields:**
  - `inArweaveBlock` - Arweave block number
  - `indexedAt` - When record was indexed
  - `ver` - Record version
  - `recordType` - Record type
  - `creatorHandle` - Creator handle
  - `date` - Record creation date
  - `score` - Match score (for search/tag queries)
  - `tags` - Tag match score (only works with `tags` parameter)
  - `exerciseScore` - Exercise match score (only works with `exerciseNames` parameter)
- **Examples:**
  - `sortBy=date:desc` - Newest first
  - `sortBy=inArweaveBlock:asc` - Oldest block first
  - `sortBy=tags:desc` - Best tag matches first (requires `tags` parameter)
  - `sortBy=exerciseScore:desc` - Best exercise matches first (requires `exerciseNames` parameter)

### 📄 **Pagination**

#### `limit`
- **Type:** Number
- **Description:** Number of records per page
- **Default:** `20`
- **Example:** `limit=50`

#### `page`
- **Type:** Number
- **Description:** Page number (1-based)
- **Default:** `1`
- **Example:** `page=3`

### 🏷️ **Tag Summary**

#### `summarizeTags`
- **Type:** String
- **Description:** Whether to include tag summary in response
- **Values:** `"true"` or `"false"`
- **Example:** `summarizeTags=true`

#### `tagCount`
- **Type:** Number
- **Description:** Number of top tags to include in summary
- **Default:** `25`
- **Example:** `tagCount=50`

#### `tagPage`
- **Type:** Number
- **Description:** Page number for tag summary pagination
- **Default:** `1`
- **Example:** `tagPage=2`

### 🔧 **Data Resolution**

#### `resolveDepth`
- **Type:** Number
- **Description:** How deeply to resolve referenced records
- **Default:** `2`
- **Range:** `1-5`
- **Example:** `resolveDepth=3`
- **Note:** Higher values provide more complete data but slower responses

### 🛡️ **Security & Privacy**

#### `includeSigs`
- **Type:** Boolean
- **Description:** Whether to include cryptographic signatures
- **Default:** `true`
- **Example:** `includeSigs=false`

#### `includePubKeys`
- **Type:** Boolean
- **Description:** Whether to include public keys
- **Default:** `true`
- **Example:** `includePubKeys=false`

#### `includeDeleteMessages`
- **Type:** Boolean
- **Description:** Whether to include delete message records
- **Default:** `false`
- **Example:** `includeDeleteMessages=true`

## Usage Examples

### Basic Record Retrieval
```
GET /api/records?limit=10&page=1
```

### Search for News Articles
```
GET /api/records?search=news&recordType=post&sortBy=date:desc
```

### Tag Filtering (OR behavior)
```
GET /api/records?tags=cooking,recipe,food&limit=20
```

### Tag Filtering (AND behavior)
```
GET /api/records?tags=greek,grilling&tagsMatchMode=AND&sortBy=tags:desc
```

### Creator-Specific Records
```
GET /api/records?creatorHandle=chef_alex&recordType=recipe
```

### Date Range with Audio Filter
```
GET /api/records?dateStart=2024-01-01&dateEnd=2024-06-30&hasAudio=true
```

### Exercise Search in Workouts
```
GET /api/records?recordType=workout&exerciseNames=Deadlifts,Plank,High%20Knees&resolveDepth=2&resolveNamesOnly=true&limit=10
```

### Exercise Search with Custom Sorting
```
GET /api/records?recordType=workout&exerciseNames=Squats,Push-ups&sortBy=exerciseScore:desc&resolveDepth=1&limit=5
```

### Complex Query with Multiple Filters
```
GET /api/records?search=mediterranean&tags=healthy,diet&tagsMatchMode=AND&recordType=recipe&hasAudio=false&sortBy=date:desc&limit=25&resolveDepth=3
```

### Tag Summary for Analytics
```
GET /api/records?summarizeTags=true&tagCount=100&recordType=post
```

## Response Format

```json
{
  "message": "Records retrieved successfully",
  "latestArweaveBlockInDB": 1234567,
  "indexingProgress": "85%",
  "totalRecords": 50000,
  "searchResults": 150,
  "pageSize": 20,
  "currentPage": 1,
  "totalPages": 8,
  "queryParams": { /* original query parameters */ },
  "records": [ /* array of record objects */ ],
  "tagSummary": [ /* array of tag objects with counts (if summarizeTags=true) */ ],
  "tagCount": 245 /* total unique tags (if summarizeTags=true) */
}
```

### Exercise Search Response Fields

When using the `exerciseNames` parameter with workout records, the response includes additional fields:

```json
{
  "records": [
    {
      "data": { /* workout data */ },
      "oip": { /* metadata */ },
      "exerciseScore": 0.85,
      "exerciseMatchedCount": 3
    }
  ]
}
```

## Performance Tips

1. **Use appropriate `limit`** - Smaller limits = faster responses
2. **Optimize `resolveDepth`** - Lower values = faster processing
3. **Combine filters strategically** - More specific filters reduce processing load
4. **Use `includeSigs=false` and `includePubKeys=false`** for lighter responses
5. **Tag filtering is more efficient than full-text search** for known categories
6. **Exercise search requires resolution** - Use `resolveDepth=1` minimum for exercise filtering

## Advanced Features

### Tag Match Scoring
When using the `tags` parameter, records automatically receive a score based on how many of the specified tags they match. This score can be used for sorting with `sortBy=tags:desc`.

### Exercise Match Scoring
When using the `exerciseNames` parameter with workout records, records receive:
- **exerciseScore**: Combination of match ratio and order similarity (0-1 scale)
- **exerciseMatchedCount**: Number of requested exercises found in the workout

The scoring algorithm:
1. Calculates the ratio of matched exercises to requested exercises
2. Adds bonus points for exercises appearing in the same order as requested
3. Automatically sorts by best matches first

### Reference Resolution
The `resolveDepth` parameter controls how deeply the system follows references (drefs) to other records, providing rich, interconnected data.

### Flexible Search Modes
- **Full-text search** (`search`) - Searches across name, description, and tags
- **Tag filtering** (`tags`) - Precise tag-based filtering with AND/OR modes
- **Exercise filtering** (`exerciseNames`) - Search workouts by exercise content
- **Combined approach** - Use multiple parameters for maximum precision

---

*This documentation reflects the current implementation as of the latest update. For the most up-to-date information, refer to the source code in `helpers/elasticsearch.js`.*
