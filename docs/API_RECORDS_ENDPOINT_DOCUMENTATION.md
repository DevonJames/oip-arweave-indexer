# API Records Endpoint Documentation

## Overview


The `/api/records` endpoint provides powerful search and filtering capabilities for retrieving records from the OIP Arweave Indexer. This endpoint uses the `getRecords()` function and supports a wide variety of query parameters for precise data retrieval, including **media files with BitTorrent distribution**. The endpoint now supports **optional authentication** for accessing private records.

**Base URL:** `/api/records`  
**Method:** `GET`  
**Authentication:** Optional (required for private records)  

**Returns:** JSON object containing filtered and paginated records with authentication status

## Authentication

### Optional Authentication Header
```http
Authorization: Bearer <jwt-token>
```

### Authentication Behavior
- **Without Token**: Only public records are returned
- **With Valid Token**: Public records + user's private records are returned
- **With Invalid Token**: Treated as unauthenticated (public records only)

### Private Record Access
- **Private GUN Records**: Accessible only by authenticated record owners
- **Conversation Sessions**: Private by default, require user authentication
- **Access Control**: Uses `accessControl.access_level` and `owner_public_key` for filtering

## Storage Sources

### `source` Parameter
- **Type:** String
- **Description:** Filter records by storage source
- **Values:**
  - `all` (default) - Records from all storage systems
  - `arweave` - Only Arweave-stored records
  - `gun` - Only GUN-stored records (includes private conversation sessions)
- **Example:** `source=gun&recordType=conversationSession`

### GUN Records (Private Storage)
- **Conversation Sessions**: Private encrypted storage in GUN network
- **User Ownership**: Records owned by individual HD wallet public keys
- **Privacy**: Only accessible by authenticated owners
- **Array Limitation**: GUN cannot handle complex nested arrays
- **JSON String Format**: Arrays stored as JSON strings, converted back to arrays in API responses

#### GUN Array Format Handling
Due to GUN's limitations with arrays, certain fields are stored differently:

**Storage Format (in GUN)**:
```json
{
  "conversationSession": {
    "messages": "[\"Hello\",\"Hi there\"]",           // JSON string
    "message_timestamps": "[1757789559348,1757789564040]", // JSON string  
    "message_roles": "[\"user\",\"assistant\"]",     // JSON string
    "model_provider": "did:arweave:provider_id"      // String not array
  }
}
```

**API Response Format (converted back)**:
```json
{
  "conversationSession": {
    "messages": ["Hello", "Hi there"],               // Actual array
    "message_timestamps": [1757789559348, 1757789564040], // Actual array
    "message_roles": ["user", "assistant"],          // Actual array
    "model_provider": "did:arweave:provider_id"      // String maintained
  }
}
```

**Important for Developers**: When consuming GUN records via API, you receive properly formatted arrays. The JSON string conversion is handled automatically by the backend.

#### Publishing GUN Records with Arrays
When publishing records to GUN storage (e.g., via `/api/records/newRecord?storage=gun`), you must format array data as JSON strings:

**Correct GUN Publishing Format**:
```json
{
  "conversationSession": {
    "messages": "",                    // Empty string initially
    "message_timestamps": "",          // Empty string initially
    "message_roles": "",              // Empty string initially
    "model_provider": "did:arweave:..." // String, not array
  }
}
```

**When Updating with Data**:
```json
{
  "conversationSession": {
    "messages": "[\"Hello\",\"Hi there\"]",              // JSON.stringify(array)
    "message_timestamps": "[1757789559348,1757789564040]", // JSON.stringify(array)
    "message_roles": "[\"user\",\"assistant\"]"          // JSON.stringify(array)
  }
}
```

**Backend Processing**: The system automatically converts these JSON strings back to proper arrays for Elasticsearch indexing and API responses.

## Authentication

### Optional Authentication Header
```http
Authorization: Bearer <jwt-token>
```

### Authentication Behavior
- **Without Token**: Only public records are returned
- **With Valid Token**: Public records + user's private records are returned
- **With Invalid Token**: Treated as unauthenticated (public records only)

### Private Record Access
- **Private GUN Records**: Accessible only by authenticated record owners
- **Conversation Sessions**: Private by default, require user authentication
- **Media Files**: Private media accessible only to owners
- **Access Control**: Uses `accessControl.access_level` and `owner_public_key` for filtering

## Storage Sources

### `source` Parameter
- **Type:** String
- **Description:** Filter records by storage source
- **Values:**
  - `all` (default) - Records from all storage systems
  - `arweave` - Only Arweave-stored records
  - `gun` - Only GUN-stored records (private/encrypted)

### Arweave Records (Public Storage)
- **Conversation History**: Public conversations and interactions
- **Blog Posts**: Articles, news, and written content
- **Media Content**: Images, videos, audio files
- **Templates**: Schema definitions and data structures

### GUN Records (Private Storage)
- **Conversation Sessions**: Private encrypted storage in GUN network
- **Media Files**: Private media with BitTorrent distribution
- **User Ownership**: Records owned by individual HD wallet public keys
- **Privacy**: Only accessible by authenticated owners
- **Array Limitation**: GUN cannot handle complex nested arrays
- **JSON String Format**: Arrays stored as JSON strings, converted back to arrays in API responses

#### GUN Array Format Handling
Due to GUN's limitations with arrays, certain fields are stored differently:

**Storage Format (in GUN)**:
```json
{
  "conversationSession": {
    "messages": "[\"Hello\",\"World\"]",           // JSON string
    "message_timestamps": "[1757789559348]",      // JSON string
    "message_roles": "[\"user\",\"assistant\"]"   // JSON string
  },
  "media": {
    "transport": {
      "trackers": "[\"wss://tracker1.com\",\"wss://tracker2.com\"]",  // JSON string
      "http": "[\"https://api.oip.onl/media/abc123\"]"                // JSON string
    }
  }
}
```

**API Response Format (converted back)**:
```json
{
  "conversationSession": {
    "messages": ["Hello", "World"],               // Proper array
    "message_timestamps": [1757789559348],        // Proper array
    "message_roles": ["user", "assistant"]        // Proper array
  },
  "media": {
    "transport": {
      "trackers": ["wss://tracker1.com", "wss://tracker2.com"],  // Proper array
      "http": ["https://api.oip.onl/media/abc123"]                // Proper array
    }
  }
}
```

**Important for Developers**: When consuming GUN records via API, you receive properly formatted arrays. The JSON string conversion is handled automatically by the backend.

## Query Parameters

### 📄 **Basic Filtering**

#### `recordType`
- **Type:** String
- **Description:** Filter records by their specific type
- **Example:** `recordType=post`
- **Common Values:** `post`, `image`, `audio`, `video`, `text`, `recipe`, `workout`, `exercise`, `deleteMessage`, `creatorRegistration`, `conversationSession`, `media`


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
  - Splits on spaces to separate search terms
  - Searches name, description, and tags fields
  - Default: Returns records matching ALL search terms (AND behavior)
  - Can be modified with `searchMatchMode` parameter
  - Automatically sorts by match relevance
  - Adds `matchCount` field to records showing number of search terms matched

#### `searchMatchMode`
- **Type:** String
- **Description:** Controls search matching behavior
- **Values:** 
  - `AND` (default) - Records must match ALL search terms
  - `OR` - Records can match ANY search terms
- **Example:** `search=fitness workout&searchMatchMode=OR`
- **Behavior:**
  - Works with the `search` parameter
  - AND mode: More restrictive, fewer results, all terms must be present
  - OR mode: More inclusive, more results, any term can match
  - `matchCount` field shows how many terms matched (useful for OR mode ranking)

### 🏋️ **Exercise Filtering (Workouts)**

#### `exerciseNames`
- **Type:** String (comma-separated)
- **Description:** Filter workout records by exercise names they contain
- **Example:** `exerciseNames=Deadlifts,Plank,High%20Knees`
- **Behavior:** 
  - Only works with `recordType=workout`
  - Requires `resolveDepth=1` or higher (or `resolveNamesOnly=true`)
  - Searches the `data.workout.exercise` array for exercise names
  - Handles various data structures (strings, resolved objects, or simple objects)
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

### 🍳 **Ingredient Filtering (Recipes)**

#### `ingredientNames`
- **Type:** String (comma-separated)
- **Description:** Filter recipe records by ingredient names they contain
- **Example:** `ingredientNames=chicken,garlic,olive%20oil`
- **Behavior:** 
  - Only works with `recordType=recipe`
  - Requires `resolveDepth=1` or higher (or `resolveNamesOnly=true`)
  - Searches the resolved `data.recipe.ingredient` array for ingredient names at `data.basic.name`
  - Handles various data structures (strings, resolved objects, or simple objects)
  - Returns recipes that contain ANY of the specified ingredients
  - Automatically sorts by order similarity (how closely the ingredient order matches the request)
  - Adds `ingredientScore` and `ingredientMatchedCount` fields to matching records

#### `sortBy=ingredientScore`
- **Type:** String
- **Description:** Sort results by ingredient matching score
- **Values:** 
  - `ingredientScore:desc` (default) - Best matches first
  - `ingredientScore:asc` - Worst matches first
- **Example:** `ingredientNames=chicken,garlic&sortBy=ingredientScore:desc`
- **Note:** Only works when `ingredientNames` parameter is provided

### 🍽️ **Cuisine Filtering (Recipes)**

#### `cuisine`
- **Type:** String (comma-separated)
- **Description:** Filter recipe records by their cuisine type
- **Example:** `cuisine=Mediterranean,Italian,Greek`
- **Behavior:** 
  - Only works with `recordType=recipe`
  - Default behavior: Returns recipes that match ANY of the specified cuisines (OR behavior)
  - Searches the `data.recipe.cuisine` field for partial matches
  - Uses case-insensitive matching
  - Automatically sorts by cuisine match score (best matches first)
  - Adds `cuisineScore` and `cuisineMatchedCount` fields to matching records

#### `cuisineMatchMode`
- **Type:** String
- **Description:** Controls cuisine matching behavior
- **Values:** 
  - `OR` (default) - Recipes that match ANY of the specified cuisines
  - `AND` - Recipes that match ALL of the specified cuisines (unusual for single cuisine field)
- **Example:** `cuisine=Mediterranean,Italian&cuisineMatchMode=OR`

#### `sortBy=cuisineScore`
- **Type:** String
- **Description:** Sort results by cuisine matching score
- **Values:** 
  - `cuisineScore:desc` (default) - Best matches first
  - `cuisineScore:asc` - Worst matches first
- **Example:** `cuisine=Mediterranean,Italian&sortBy=cuisineScore:desc`
- **Note:** Only works when `cuisine` parameter is provided

### 🏋️ **Equipment Filtering (Exercises)**

#### `equipmentRequired`
- **Type:** String (comma-separated)
- **Description:** Filter exercise records by equipment they require
- **Example:** `equipmentRequired=dumbbells,barbell,bench`
- **Behavior:** 
  - Only works with `recordType=exercise`
  - Default behavior: Returns exercises that require ALL of the specified equipment (AND behavior)
  - Searches both `data.exercise.equipmentRequired` (array) and `data.exercise.equipment` (string/array)
  - Uses fuzzy matching (partial string matching) for equipment names
  - Automatically sorts by equipment match score (best matches first)
  - Adds `equipmentScore` and `equipmentMatchedCount` fields to matching records

#### `equipmentMatchMode`
- **Type:** String
- **Description:** Controls equipment matching behavior
- **Values:** 
  - `AND` (default) - Exercises that require ALL of the specified equipment
  - `OR` - Exercises that require ANY of the specified equipment
- **Example:** `equipmentRequired=dumbbells,barbell&equipmentMatchMode=OR`

#### `sortBy=equipmentScore`
- **Type:** String
- **Description:** Sort results by equipment matching score
- **Values:** 
  - `equipmentScore:desc` (default) - Best matches first
  - `equipmentScore:asc` - Worst matches first
- **Example:** `equipmentRequired=dumbbells,barbell&sortBy=equipmentScore:desc`
- **Note:** Only works when `equipmentRequired` parameter is provided

### 🏃 **Exercise Type Filtering (Exercises)**

#### `exerciseType`
- **Type:** String (comma-separated)
- **Description:** Filter exercise records by their type (enum values)
- **Example:** `exerciseType=warmup,main` or `exerciseType=Warm-Up,Main`
- **Valid Values:** 
  - `warmup` or `Warm-Up` - Warm-up exercises
  - `main` or `Main` - Main workout exercises  
  - `cooldown` or `Cool-Down` - Cool-down exercises
- **Behavior:** 
  - Only works with `recordType=exercise`
  - Default behavior: Returns exercises that are ANY of the specified types (OR behavior)
  - Searches by both enum codes (`warmup`) and display names (`Warm-Up`)
  - Case-insensitive matching
  - Automatically sorts by exercise type match score (best matches first)
  - Adds `exerciseTypeScore` and `exerciseTypeMatchedCount` fields to matching records

#### `exerciseTypeMatchMode`
- **Type:** String
- **Description:** Controls exercise type matching behavior
- **Values:** 
  - `OR` (default) - Exercises that are ANY of the specified types
  - `AND` - Exercises that are ALL of the specified types (unusual for enum fields)
- **Example:** `exerciseType=warmup,main&exerciseTypeMatchMode=OR`

#### `sortBy=exerciseTypeScore`
- **Type:** String
- **Description:** Sort results by exercise type matching score
- **Values:** 
  - `exerciseTypeScore:desc` (default) - Best matches first
  - `exerciseTypeScore:asc` - Worst matches first
- **Example:** `exerciseType=warmup,main&sortBy=exerciseTypeScore:desc`
- **Note:** Only works when `exerciseType` parameter is provided

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

### 🔍 **Advanced Filtering**

#### `exactMatch`
- **Type:** String (JSON)
- **Description:** Filter records by exact field matches using JSON object notation
- **Example:** `exactMatch={"data.basic.language":"en","oip.recordType":"post"}`
- **Note:** Uses dot notation to navigate nested object structures

#### `noDuplicates`
- **Type:** Boolean
- **Description:** Filter out duplicate records based on their `data.basic.name` field, keeping only one record per unique name
- **Default:** `false`
- **Values:**
  - `true` - Remove duplicates, keep only one record per unique name
  - `false` - Return all records including duplicates (default behavior)
- **Example:** `noDuplicates=true&recordType=fitnessEquipment`
- **Behavior:**
  - Groups records by their `data.basic.name` field
  - For each group with multiple records, keeps only the best record based on sorting criteria
  - Uses the `sortBy` parameter to determine which duplicate to keep
  - If no `sortBy` is specified, defaults to `sortBy=inArweaveBlock:desc` for duplicate resolution
  - Records without a `data.basic.name` field are always included
  - Useful for getting a list of unique items by name within a record type

### 📅 **Date Filtering**

#### `dateStart`
- **Type:** Date
- **Description:** Filter records created on or after this date
- **Example:** `dateStart=2024-01-01`
- **Format:** ISO date string or Unix timestamp
- **Note:** Filters on `data.basic.date` field

#### `dateEnd`
- **Type:** Date
- **Description:** Filter records created on or before this date
- **Example:** `dateEnd=2024-12-31`
- **Format:** ISO date string or Unix timestamp
- **Note:** Filters on `data.basic.date` field

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
- **Note:** Searches for audio in `audioItems` arrays and `webUrl` fields

### 📁 **Media File Filtering**

#### `recordType=media`
- **Type:** String
- **Description:** Filter for media file records with BitTorrent distribution
- **Example:** `recordType=media`
- **Features:**
  - Private media files with HD wallet ownership
  - BitTorrent magnet URIs for P2P distribution
  - HTTP streaming with range request support
  - Seeding status and peer information

#### Media File Properties
When retrieving media records, additional fields are available:
- **`media.id`**: SHA256 hash of file content (mediaId)
- **`media.did`**: GUN DID for the media file
- **`media.mime`**: MIME type (video/mp4, image/jpeg, etc.)
- **`media.size`**: File size in bytes
- **`media.transport.bittorrent.magnetURI`**: BitTorrent magnet link
- **`media.transport.bittorrent.infoHash`**: BitTorrent info hash
- **`media.transport.http`**: Array of HTTP download URLs
- **`accessControl.access_level`**: Privacy level (private/public)
- **`accessControl.owner_public_key`**: Owner's HD wallet public key

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
  - `date` - Record creation date (from `data.basic.date`)
  - `score` - Match score (for search/tag queries)
  - `matchCount` - Number of search terms matched (only works with `search` parameter)
  - `tags` - Tag match score (only works with `tags` parameter)
  - `exerciseScore` - Exercise match score (only works with `exerciseNames` parameter)
  - `ingredientScore` - Ingredient match score (only works with `ingredientNames` parameter)
  - `equipmentScore` - Equipment match score (only works with `equipmentRequired` parameter)
  - `exerciseTypeScore` - Exercise type match score (only works with `exerciseType` parameter)
  - `cuisineScore` - Cuisine match score (only works with `cuisine` parameter)
- **Examples:**
  - `sortBy=date:desc` - Newest first
  - `sortBy=inArweaveBlock:asc` - Oldest block first
  - `sortBy=matchCount:desc` - Most search term matches first (requires `search` parameter)
  - `sortBy=tags:desc` - Best tag matches first (requires `tags` parameter)
  - `sortBy=exerciseScore:desc` - Best exercise matches first (requires `exerciseNames` parameter)
  - `sortBy=ingredientScore:desc` - Best ingredient matches first (requires `ingredientNames` parameter)
  - `sortBy=equipmentScore:desc` - Best equipment matches first (requires `equipmentRequired` parameter)
  - `sortBy=exerciseTypeScore:desc` - Best exercise type matches first (requires `exerciseType` parameter)
  - `sortBy=cuisineScore:desc` - Best cuisine matches first (requires `cuisine` parameter)

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
- **Note:** When enabled, returns tag counts and filters records to match the paginated tag summary

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
- **Description:** How deeply to resolve referenced records (dref fields)
- **Default:** `2`
- **Range:** `1-5`
- **Example:** `resolveDepth=3`
- **Note:** 
  - Higher values provide more complete data but slower responses
  - Required for `exerciseNames` and `ingredientNames` filtering

#### `resolveNamesOnly`
- **Type:** Boolean | String
- **Description:** Whether to resolve only record names instead of full record data
- **Values:** `true`, `false`, `"true"`, `"false"`
- **Default:** `false`
- **Example:** `resolveNamesOnly=true`
- **Note:** Faster than full resolution, suitable for exercise and ingredient name filtering

### 🍳 **Recipe Features**

#### `summarizeRecipe`
- **Type:** Boolean | String
- **Description:** Whether to calculate and include nutritional summaries for recipe records
- **Values:** `true`, `false`, `"true"`, `"false"`
- **Default:** `false`
- **Example:** `summarizeRecipe=true`
- **Behavior:**
  - Only works with recipe records that have ingredient data
  - Calculates total nutritional values based on resolved ingredient records
  - Adds `summaryNutritionalInfo` and `summaryNutritionalInfoPerServing` fields
  - Requires ingredients to have nutritional information
  - Handles unit conversions (grams, ounces, cups, etc.)

### 🎨 **Display Options**

#### `hideDateReadable`
- **Type:** Boolean | String
- **Description:** Whether to exclude human-readable date formatting
- **Values:** `true`, `false`, `"true"`, `"false"`
- **Default:** `false`
- **Example:** `hideDateReadable=true`
- **Note:** By default, adds `dateReadable` field to records with timestamp dates

#### `hideNullValues`
- **Type:** Boolean | String
- **Description:** Whether to remove null values from response data
- **Values:** `true`, `false`, `"true"`, `"false"`
- **Default:** `false`
- **Example:** `hideNullValues=true`
- **Note:** Recursively removes null values from all record data structures

### 🛡️ **Security & Privacy**

#### `includeSigs`
- **Type:** Boolean | String
- **Description:** Whether to include cryptographic signatures
- **Values:** `true`, `false`, `"true"`, `"false"`
- **Default:** `true`
- **Example:** `includeSigs=false`

#### `includePubKeys`
- **Type:** Boolean | String
- **Description:** Whether to include public keys
- **Values:** `true`, `false`, `"true"`, `"false"`
- **Default:** `true`
- **Example:** `includePubKeys=false`

#### `includeDeleteMessages`
- **Type:** Boolean | String
- **Description:** Whether to include delete message records
- **Values:** `true`, `false`, `"true"`, `"false"`
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

### Search with AND Mode (Default)
```
GET /api/records?search=fitness workout&searchMatchMode=AND&limit=10
```

### Search with OR Mode
```
GET /api/records?search=fitness workout&searchMatchMode=OR&limit=10&sortBy=matchCount:desc
```

### Switch Back to Match Count Sorting
```
# After sorting by date, switch back to relevance sorting
GET /api/records?search=fitness workout&searchMatchMode=OR&sortBy=matchCount:desc&limit=10
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

### Ingredient Search in Recipes
```
GET /api/records?recordType=recipe&ingredientNames=chicken,garlic,olive%20oil&resolveDepth=2&resolveNamesOnly=true&limit=10
```

### Ingredient Search with Custom Sorting
```
GET /api/records?recordType=recipe&ingredientNames=tomatoes,basil&sortBy=ingredientScore:desc&resolveDepth=1&limit=5
```

### Recipe with Nutritional Summary
```
GET /api/records?recordType=recipe&summarizeRecipe=true&resolveDepth=2&limit=10
```

### Cuisine Search in Recipes (OR behavior)
```
GET /api/records?recordType=recipe&cuisine=Mediterranean,Italian,Greek&limit=10
```

### Cuisine Search with AND Behavior
```
GET /api/records?recordType=recipe&cuisine=Mediterranean,healthy&cuisineMatchMode=AND&sortBy=cuisineScore:desc
```

### Cuisine Search with Custom Sorting
```
GET /api/records?recordType=recipe&cuisine=Asian,Italian&sortBy=cuisineScore:desc&limit=5
```

### Equipment Search in Exercises (AND behavior)
```
GET /api/records?recordType=exercise&equipmentRequired=dumbbells,barbell&limit=10
```

### Equipment Search with OR Behavior
```
GET /api/records?recordType=exercise&equipmentRequired=dumbbells,barbell&equipmentMatchMode=OR&limit=10
```

### Equipment Search with Custom Sorting
```
GET /api/records?recordType=exercise&equipmentRequired=bench,dumbbells&sortBy=equipmentScore:desc&limit=5
```

### Exercise Type Search
```
GET /api/records?recordType=exercise&exerciseType=warmup,main&limit=10
```

### Exercise Type Search with Display Names
```
GET /api/records?recordType=exercise&exerciseType=Warm-Up,Cool-Down&exerciseTypeMatchMode=OR&limit=10
```

### Exercise Type Search with Custom Sorting
```
GET /api/records?recordType=exercise&exerciseType=main&sortBy=exerciseTypeScore:desc&limit=5
```

### Exact Match Filtering
```
GET /api/records?exactMatch={"data.basic.language":"en","oip.recordType":"post"}&limit=20
```

### Complex Query with Multiple Filters
```
GET /api/records?search=mediterranean healthy&searchMatchMode=OR&tags=healthy,diet&tagsMatchMode=AND&recordType=recipe&cuisine=Mediterranean,Italian&cuisineMatchMode=OR&hasAudio=false&sortBy=date:desc&limit=25&resolveDepth=3&summarizeRecipe=true
```

### Tag Summary for Analytics
```
GET /api/records?summarizeTags=true&tagCount=100&recordType=post
```

### Clean Display Format
```
GET /api/records?hideNullValues=true&hideDateReadable=false&includeSigs=false&includePubKeys=false&limit=10
```

### Unique Fitness Equipment Records
```
GET /api/records?recordType=fitnessEquipment&noDuplicates=true&limit=50
```

### Unique Fitness Equipment with Custom Sorting
```
GET /api/records?recordType=fitnessEquipment&noDuplicates=true&sortBy=date:desc&limit=50
```

### Unique Records by Name (All Types)
```
GET /api/records?noDuplicates=true&sortBy=inArweaveBlock:desc&limit=100
```

### Private Media Files (Authenticated)
```
GET /api/records?source=gun&recordType=media&limit=10&sortBy=date:desc
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Private Media Files (Unauthenticated)
```
GET /api/records?source=gun&recordType=media&limit=10&sortBy=date:desc
# Returns empty results - private media filtered out
```

### Specific Media File by DID
```
GET /api/records?source=gun&did=did:gun:media:a1b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789a&limit=1
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Cross-User Privacy Test (Media)
```
# User A's token trying to access User B's media
GET /api/records?source=gun&did=did:gun:media:other_user_media_id&limit=1
Authorization: Bearer USER_A_TOKEN
# Returns empty results - cross-user privacy enforced
```

### Media Files with Size Filtering
```
# Find large video files (would require custom Elasticsearch query)
GET /api/records?recordType=media&exactMatch={"data.media.mime":"video/mp4"}&limit=10
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
=======
### Private GUN Records (Authenticated)
```
GET /api/records?source=gun&recordType=conversationSession&limit=15&sortBy=date:desc
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Private GUN Records (Unauthenticated)
```
GET /api/records?source=gun&recordType=conversationSession&limit=15&sortBy=date:desc
# Returns empty results - private records filtered out
```

### Specific GUN Record by DID
```
GET /api/records?source=gun&did=did:gun:647f79c2a338:session_1757789557773&limit=1
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Cross-User Privacy Test
```
# User A's token accessing User B's record - should be filtered out
GET /api/records?source=gun&did=did:gun:647f79c2a338:session_other_user&limit=1
Authorization: Bearer user_a_token
# Returns empty results due to ownership filtering
```

## Response Format

### Standard Response Structure

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
  "auth": {
    "authenticated": true,
    "user": {
      "email": "user@example.com",
      "userId": "elasticsearch_user_id",
      "publicKey": "0349b2160ea3117a90a1fcbbf198ef53bf325b604157cbcf81693f0f476006c9e1"
    }
  },
  "records": [ /* array of record objects */ ]
}
```

### Media Record Response Format

When retrieving media records (`recordType=media`), the response includes BitTorrent and streaming information:

```json
{
  "message": "Records retrieved successfully",
  "searchResults": 1,
  "auth": {
    "authenticated": true,
    "user": {
      "email": "user@example.com",
      "publicKey": "0349b2160ea3117a90a1fcbbf198ef53bf325b604157cbcf81693f0f476006c9e1"
    }
  },
  "records": [
    {
      "data": {
        "basic": {
          "name": "My Private Video",
          "description": "Media file: my_video.mp4",
          "date": 1757789558,
          "language": "en"
        },
        "media": {
          "id": "a1b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789a",
          "did": "did:gun:media:a1b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789a",
          "mime": "video/mp4",
          "size": 1048576,
          "originalName": "my_video.mp4",
          "createdAt": "2025-09-13T18:52:38.199Z",
          "transport": {
            "bittorrent": {
              "magnetURI": "magnet:?xt=urn:btih:abc123def456...",
              "infoHash": "abc123def456789abcdef0123456789abcdef01",
              "trackers": ["wss://tracker.openwebtorrent.com", "wss://tracker.btorrent.xyz"]
            },
            "http": ["https://api.oip.onl/api/media/a1b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789a"]
          },
          "version": 1
        },
        "accessControl": {
          "access_level": "private",
          "owner_public_key": "0349b2160ea3117a90a1fcbbf198ef53bf325b604157cbcf81693f0f476006c9e1",
          "created_by": "0349b2160ea3117a90a1fcbbf198ef53bf325b604157cbcf81693f0f476006c9e1",
          "created_timestamp": 1757789558199,
          "last_modified_timestamp": 1757789558199,
          "version": "1.0.0"
        }
      },
      "oip": {
        "did": "did:gun:media:a1b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789a",
        "recordType": "media",
        "storage": "gun",
        "indexedAt": "2025-09-13T18:52:38.413Z",
        "ver": "0.8.0",
        "creator": {
          "didAddress": "did:arweave:u4B6d5ddggsotOiG86D-KPkeW23qQNdqaXo_ZcdI3k0",
          "publicKey": "0349b2160ea3117a90a1fcbbf198ef53bf325b604157cbcf81693f0f476006c9e1"
        }
      }
    }
  ]
}
```

### Authentication Status in Response
- **`auth.authenticated`**: Boolean indicating if request was authenticated
- **`auth.user`**: User information (only present if authenticated)
  - **`email`**: User's email address
  - **`userId`**: User's database ID
  - **`publicKey`**: User's HD wallet public key (for ownership verification)

### Tag Summary Response (when summarizeTags=true)

```json
{
  "message": "Records retrieved successfully",
  "latestArweaveBlockInDB": 1234567,
  "indexingProgress": "85%",
  "totalRecords": 50000,
  "searchResults": 150,
  "tagSummary": [
    { "tag": "cooking", "count": 1250 },
    { "tag": "recipe", "count": 890 },
    { "tag": "healthy", "count": 670 }
  ],
  "tagCount": 245,
  "pageSize": 20,
  "currentPage": 1,
  "totalPages": 8,
  "records": [ /* filtered records matching paginated tag summary */ ]
}
```

### Exercise Search Response Fields

When using the `exerciseNames` parameter with workout records, the response includes additional fields:

```json
{
  "records": [
    {
      "data": { /* workout data with resolved exercise information */ },
      "oip": { /* metadata */ },
      "exerciseScore": 0.85,
      "exerciseMatchedCount": 3
    }
  ]
}
```

### Ingredient Search Response Fields

When using the `ingredientNames` parameter with recipe records, the response includes additional fields:

```json
{
  "records": [
    {
      "data": { /* recipe data with resolved ingredient names */ },
      "oip": { /* metadata */ },
      "ingredientScore": 0.92,
      "ingredientMatchedCount": 4
    }
  ]
}
```

### Equipment Search Response Fields

When using the `equipmentRequired` parameter with exercise records, the response includes additional fields:

```json
{
  "records": [
    {
      "data": { /* exercise data */ },
      "oip": { /* metadata */ },
      "equipmentScore": 1.0,
      "equipmentMatchedCount": 2
    }
  ]
}
```

### Exercise Type Search Response Fields

When using the `exerciseType` parameter with exercise records, the response includes additional fields:

```json
{
  "records": [
    {
      "data": { /* exercise data */ },
      "oip": { /* metadata */ },
      "exerciseTypeScore": 1.0,
      "exerciseTypeMatchedCount": 2
    }
  ]
}
```

### Cuisine Search Response Fields

When using the `cuisine` parameter with recipe records, the response includes additional fields:

```json
{
  "records": [
    {
      "data": { /* recipe data */ },
      "oip": { /* metadata */ },
      "cuisineScore": 1.0,
      "cuisineMatchedCount": 2
    }
  ]
}
```

### Recipe Nutritional Summary Fields

When using `summarizeRecipe=true` with recipe records, the response includes nutritional summary fields:

```json
{
  "records": [
    {
      "data": {
        "recipe": { /* recipe data */ },
        "summaryNutritionalInfo": {
          "calories": 450,
          "proteinG": 28.5,
          "fatG": 18.2,
          "cholesterolMg": 85,
          "sodiumMg": 920,
          "carbohydratesG": 42.1,
          "ingredientsProcessed": 8,
          "totalIngredients": 10
        },
        "summaryNutritionalInfoPerServing": {
          "calories": 113,
          "proteinG": 7.1,
          "fatG": 4.6,
          "cholesterolMg": 21,
          "sodiumMg": 230,
          "carbohydratesG": 10.5,
          "ingredientsProcessed": 8,
          "totalIngredients": 10
        }
      },
      "oip": { /* metadata */ }
    }
  ]
}
```

## Performance Tips

1. **Use appropriate `limit`** - Smaller limits = faster responses
2. **Optimize `resolveDepth`** - Lower values = faster processing
3. **Use `resolveNamesOnly=true`** - For exercise/ingredient filtering when full data isn't needed
4. **Combine filters strategically** - More specific filters reduce processing load
5. **Use `includeSigs=false` and `includePubKeys=false`** for lighter responses
6. **Use `hideNullValues=true`** to reduce response size
7. **Tag filtering is more efficient than full-text search** for known categories
8. **Search AND mode is more efficient than OR mode** - use AND mode for precise queries, OR mode for discovery
9. **Exercise search requires resolution** - Use `resolveDepth=1` minimum for exercise filtering
10. **Ingredient search requires resolution** - Use `resolveDepth=1` minimum for ingredient filtering
11. **Equipment search is efficient** - No resolution required, searches existing exercise record data
12. **Equipment OR mode is more flexible** - Use `equipmentMatchMode=OR` to find exercises with any of the specified equipment
13. **Exercise type search is enum-aware** - Supports both codes (`warmup`) and display names (`Warm-Up`)
14. **Recipe nutritional summaries require resolution** - Use `resolveDepth=1` minimum with `summarizeRecipe=true`
15. **Cuisine search is efficient** - No resolution required, searches existing recipe record data directly
16. **Cuisine OR mode is more flexible** - Use `cuisineMatchMode=OR` to find recipes with any of the specified cuisines
17. **Media records are lightweight** - Metadata only, actual files served via `/api/media/:mediaId`
18. **Private media requires authentication** - Always include Authorization header for private media
19. **Media search by MIME type** - Use `exactMatch` for filtering by file type
20. **GUN source filtering** - Use `source=gun` to focus on private records only
21. **Duplicate filtering is efficient** - `noDuplicates=true` processes records in-memory after all other filters
22. **Combine noDuplicates with recordType** - Most effective when used with specific record types for unique item lists

## Advanced Features

### Search Match Modes and Scoring
When using the `search` parameter, you can control matching behavior with `searchMatchMode`:

#### AND Mode (Default)
- **Behavior**: Records must contain ALL search terms
- **Use Case**: Precise searches requiring all terms to be present
- **Example**: `search=fitness workout&searchMatchMode=AND` - finds records containing both "fitness" AND "workout"
- **Results**: Fewer, more targeted results

#### OR Mode 
- **Behavior**: Records can contain ANY search terms
- **Use Case**: Broader searches to find related content
- **Example**: `search=fitness workout&searchMatchMode=OR` - finds records containing "fitness" OR "workout" OR both
- **Results**: More inclusive results, sorted by relevance

#### Match Count Scoring
All search results include a `matchCount` field showing how many search terms matched:
- **AND Mode**: All results have the same matchCount (all terms matched)
- **OR Mode**: Results with higher matchCount appear first (more terms matched = higher relevance)
- **Sorting**: Use `sortBy=matchCount:desc` to prioritize records with more term matches

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

### Ingredient Match Scoring
When using the `ingredientNames` parameter with recipe records, records receive:
- **ingredientScore**: Combination of match ratio and order similarity (0-1 scale)
- **ingredientMatchedCount**: Number of requested ingredients found in the recipe

The scoring algorithm:
1. Calculates the ratio of matched ingredients to requested ingredients
2. Adds bonus points for ingredients appearing in the same order as requested
3. Automatically sorts by best matches first
4. Searches resolved ingredient records at `data.basic.name` for ingredient names

### Equipment Match Scoring
When using the `equipmentRequired` parameter with exercise records, records receive:
- **equipmentScore**: Ratio of matched equipment to requested equipment (0-1 scale)
- **equipmentMatchedCount**: Number of requested equipment items found in the exercise

The scoring algorithm:
1. Calculates the ratio of matched equipment to requested equipment
2. Uses fuzzy matching to handle partial equipment name matches
3. Automatically sorts by best matches first
4. Supports both AND and OR matching modes via `equipmentMatchMode`
5. Searches both `data.exercise.equipmentRequired` and `data.exercise.equipment` fields

**AND Mode (default):** Only returns exercises that have ALL specified equipment
**OR Mode:** Returns exercises that have ANY of the specified equipment

### Exercise Type Match Scoring
When using the `exerciseType` parameter with exercise records, records receive:
- **exerciseTypeScore**: Ratio of matched types to requested types (0-1 scale)
- **exerciseTypeMatchedCount**: Number of requested exercise types found

The scoring algorithm:
1. Calculates the ratio of matched types to requested types
2. Normalizes enum codes and display names (e.g., `warmup` = `Warm-Up`)
3. Performs case-insensitive matching
4. Supports both AND and OR matching modes via `exerciseTypeMatchMode`
5. Searches the `data.exercise.exercise_type` field

**OR Mode (default):** Returns exercises that match ANY of the specified types
**AND Mode:** Returns exercises that match ALL of the specified types (unusual for enum fields)

### Cuisine Match Scoring
When using the `cuisine` parameter with recipe records, records receive:
- **cuisineScore**: Ratio of matched cuisine terms to requested cuisine terms (0-1 scale)
- **cuisineMatchedCount**: Number of requested cuisine terms found in the recipe

The scoring algorithm:
1. Calculates the ratio of matched cuisine terms to requested cuisine terms
2. Uses partial string matching for cuisine types (e.g., "Mediterranean" matches recipes with "Mediterranean-style")
3. Performs case-insensitive matching
4. Automatically sorts by best matches first
5. Supports both AND and OR matching modes via `cuisineMatchMode`
6. Searches the `data.recipe.cuisine` field directly

**OR Mode (default):** Returns recipes that match ANY of the specified cuisines
**AND Mode:** Returns recipes that match ALL of the specified cuisines (unusual for single cuisine field)

### Recipe Nutritional Summary
When using `summarizeRecipe=true` with recipe records, the system:
1. Resolves ingredient references to get nutritional data
2. Calculates total nutritional values based on recipe amounts and units
3. Handles unit conversions (grams, ounces, cups, ml, etc.)
4. Provides both total recipe nutrition and per-serving nutrition
5. Includes metadata about ingredient processing success
6. Only processes recipes with sufficient ingredient data (minimum 25% or 1 ingredient)

### Data Structure Handling
Exercise, ingredient, and equipment search functions handle various data structures robustly:
- **String values**: Direct string matching (e.g., `"Push-ups"`)
- **Resolved objects**: Extracts names from `data.basic.name` (e.g., `{data: {basic: {name: "Push-ups"}}}`)
- **Simple objects**: Extracts names from `name` property (e.g., `{name: "Push-ups"}`)
- **Mixed arrays**: Handles combinations of the above structures in the same array
- **Error handling**: Logs warnings for unexpected data structures and continues processing

### Reference Resolution
The `resolveDepth` parameter controls how deeply the system follows references (drefs) to other records, providing rich, interconnected data. The `resolveNamesOnly` parameter provides a lightweight alternative that only resolves record names.

### Flexible Search Modes
- **Full-text search** (`search`) - Searches across name, description, and tags with AND/OR matching modes via `searchMatchMode`
- **Tag filtering** (`tags`) - Precise tag-based filtering with AND/OR modes via `tagsMatchMode`
- **Exercise filtering** (`exerciseNames`) - Search workouts by exercise content
- **Ingredient filtering** (`ingredientNames`) - Search recipes by ingredient content
- **Equipment filtering** (`equipmentRequired`) - Search exercises by equipment requirements with AND/OR modes
- **Exercise type filtering** (`exerciseType`) - Search exercises by type (warmup/main/cooldown) with enum code/name support
- **Cuisine filtering** (`cuisine`) - Search recipes by cuisine type with OR/AND modes
- **Exact field matching** (`exactMatch`) - Precise filtering by field values using JSON notation
- **Combined approach** - Use multiple parameters for maximum precision

## Media File Access Patterns

### Discovery and Streaming Workflow
1. **Search for Media**: Use `/api/records?recordType=media` to find media files
2. **Get Metadata**: Media records contain magnet URIs and HTTP URLs
3. **Stream Content**: Use `/api/media/:mediaId` for direct HTTP streaming
4. **P2P Download**: Use `magnetURI` for BitTorrent distribution

### Media Integration Examples

#### Video Player Integration
```javascript
// 1. Find user's private videos
const mediaRecords = await fetch('/api/records?source=gun&recordType=media&exactMatch={"data.media.mime":"video/mp4"}', {
  headers: { 'Authorization': `Bearer ${token}` }
});

// 2. Create video player with streaming URL
const video = document.createElement('video');
video.src = `https://api.oip.onl/api/media/${mediaRecord.data.media.id}`;
video.controls = true;

// 3. Optional: Use magnet URI for P2P distribution
const magnetURI = mediaRecord.data.media.transport.bittorrent.magnetURI;
// Integrate with WebTorrent for P2P streaming
```

#### Audio Streaming
```javascript
// Find audio files and stream
const audioRecords = await fetch('/api/records?recordType=media&exactMatch={"data.media.mime":"audio/mp3"}', {
  headers: { 'Authorization': `Bearer ${token}` }
});

// Stream with range requests for seeking
const audio = new Audio();
audio.src = `https://api.oip.onl/api/media/${audioRecord.data.media.id}`;
audio.preload = 'metadata'; // Only load metadata initially
```

#### Image Gallery
```javascript
// Get user's private images
const imageRecords = await fetch('/api/records?source=gun&recordType=media&search=image', {
  headers: { 'Authorization': `Bearer ${token}` }
});

// Display thumbnails with full-size links
imageRecords.data.records.forEach(record => {
  const img = document.createElement('img');
  img.src = `https://api.oip.onl/api/media/${record.data.media.id}`;
  img.alt = record.data.basic.name;
  gallery.appendChild(img);
});
```

### BitTorrent Integration
```javascript
// Use WebTorrent for P2P distribution
import WebTorrent from 'webtorrent';

const client = new WebTorrent();

// Download via magnet URI
const magnetURI = mediaRecord.data.media.transport.bittorrent.magnetURI;
client.add(magnetURI, (torrent) => {
  console.log('Downloading:', torrent.name);
  
  // Stream while downloading
  const file = torrent.files[0];
  file.createReadStream().pipe(videoElement);
});
```

---

*This documentation reflects the current implementation as of the latest update. For the most up-to-date information, refer to the source code in `helpers/elasticsearch.js`.*
