# OIP Publishing API Documentation

## Overview

The OIP (Open Index Protocol) publishing system supports multiple storage backends and privacy levels. This comprehensive guide covers publishing records to both **Arweave** (permanent, public) and **GUN** (private, encrypted) storage systems with user authentication and cryptographic ownership.

## Endpoint Authentication Summary

| Endpoint | Authentication | Required |
|----------|----------------|----------|
| `POST /api/publish/newPost` | ✅ Required | JWT token |
| `POST /api/publish/newRecipe` | ⚠️ Not Required | None |
| `POST /api/publish/newWorkout` | ⚠️ Not Required | None |
| `POST /api/publish/newVideo` | ✅ Required | JWT token |
| `POST /api/publish/newImage` | ✅ Required | JWT token |
| `POST /api/publish/newTemplate` | ✅ Required | JWT token |
| `POST /api/publish/newNutritionalInfo` | ✅ Required | JWT token |
| `POST /api/records/newRecord` | ✅ Required | JWT token |
| `GET /api/records` | ⭕ Optional | JWT token (for private records) |
| `POST /api/records/deleteRecord` | ✅ Required | JWT token |
| `POST /api/media/upload` | ✅ Required | JWT token |
| `GET /api/media/:mediaId` | ⭕ Optional | JWT token (for private media) |
| `POST /api/photo/upload` | ❌ Not Required | None |
| `POST /api/photo/analyze` | ❌ Not Required | None |
| `POST /api/photo/chat` | ❌ Not Required | None |
| `POST /api/recipes/generate-image` | ❌ Not Required | None |
| `POST /api/generate/podcast` | ❌ Not Required | None |

**Legend**:
- ✅ **Required** - Endpoint requires valid JWT token
- ⚠️ **Not Required** - No authentication (legacy endpoints, may change)
- ⭕ **Optional** - Works without auth, enhanced with auth
- ❌ **Not Required** - Designed to work without authentication

## Storage Systems

### Arweave Storage (Public/Permanent)
- **Endpoint**: `/api/publish/newPost`, `/api/publish/newImage`, etc.
- **Privacy**: Public by default
- **Permanence**: Immutable, permanent storage
- **Cost**: Requires Arweave tokens for storage
- **Authentication**: Varies by endpoint (see table above)

### GUN Storage (Private/Encrypted)
- **Endpoint**: `/api/records/newRecord?storage=gun`
- **Privacy**: Private by default, encrypted
- **Permanence**: Distributed but not permanent
- **Cost**: Free
- **Authentication**: Required for private records
- **Ownership**: Individual user HD wallets
- **Array Limitation**: Cannot handle complex nested arrays - use JSON strings instead

## Schema Discovery Endpoints

### List All Available Schemas
**Endpoint**: `GET /api/publish/schemas`

**Purpose**: Get a list of all available record type schemas and publishing endpoints

**Authentication**: Not required

**Response**:
```json
{
  "description": "Available JSON schemas for OIP publishing endpoints",
  "dynamic_schema_endpoint": {
    "url": "GET /api/publish/schema?recordType={recordType}",
    "description": "Dynamic schema generator that works with any record type",
    "usage": "GET /api/publish/schema?recordType=mealPlan",
    "supported_record_types": ["post", "recipe", "workout", "exercise", "nutritionalInfo", "mealPlan", "workoutSchedule", ...]
  },
  "specific_schemas": {
    "recipe": {
      "endpoint": "POST /api/publish/newRecipe",
      "schema_url": "GET /api/publish/newRecipe/schema",
      "description": "Publish recipe records with automatic ingredient processing"
    },
    "workout": {
      "endpoint": "POST /api/publish/newWorkout",
      "schema_url": "GET /api/publish/newWorkout/schema",
      "description": "Publish workout records with automatic exercise lookup"
    }
  }
}
```

### Get Dynamic Schema for Any Record Type
**Endpoint**: `GET /api/publish/schema?recordType={recordType}`

**Purpose**: Generate a complete schema for any record type dynamically from templates

**Authentication**: Not required

**Example**: `GET /api/publish/schema?recordType=mealPlan`

**Response**:
```json
{
  "description": "Complete JSON schema for publishing...",
  "template_info": {
    "template_name": "mealPlan",
    "template_txid": "did:arweave:template_tx_id",
    "fields_count": 15
  },
  "example": {
    "basic": { "name": "...", ... },
    "mealPlan": { ... }
  },
  "field_descriptions": { ... },
  "endpoint_info": {
    "publishing_endpoint": "/api/records/newRecord?recordType=mealPlan&storage=arweave",
    "publishing_endpoint_gun": "/api/records/newRecord?recordType=mealPlan&storage=gun",
    "method": "POST",
    "authentication": "Optional for Arweave, Required for GUN storage"
  }
}
```

### Get Specific Endpoint Schemas
- `GET /api/publish/newRecipe/schema` - Recipe schema with ingredient processing notes
- `GET /api/publish/newWorkout/schema` - Workout schema with exercise lookup notes
- `GET /api/publish/newPost/schema` - Post schema (dynamically generated)
- `GET /api/publish/newText/schema` - Text schema (dynamically generated)
- `GET /api/publish/newVideo/schema` - Video schema (dynamically generated)
- `GET /api/publish/newImage/schema` - Image schema (dynamically generated)
- `GET /api/publish/newNutritionalInfo/schema` - Nutritional info schema

## User Authentication System

### HD Wallet Registration

**Endpoint**: `POST /api/user/register`

**Request**:
```json
{
  "email": "user@example.com",
  "password": "secure_password"
}
```

**Response**:
```json
{
  "success": true,
  "message": "User registered successfully",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "publicKey": "0349b2160ea3117a90a1fcbbf198ef53bf325b604157cbcf81693f0f476006c9e1"
}
```

### HD Wallet Login

**Endpoint**: `POST /api/user/login`

**Request**:
```json
{
  "email": "user@example.com", 
  "password": "secure_password"
}
```

**Response**:
```json
{
  "success": true,
  "message": "Login successful",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "publicKey": "0349b2160ea3117a90a1fcbbf198ef53bf325b604157cbcf81693f0f476006c9e1"
}
```

### JWT Token Structure
```json
{
  "userId": "elasticsearch_user_id",
  "email": "user@example.com",
  "publicKey": "0349b2160ea3117a90a1fcbbf198ef53bf325b604157cbcf81693f0f476006c9e1",
  "isAdmin": false,
  "iat": 1757789547,
  "exp": 1761677547
}
```

## Publishing to Arweave (Public Records)

### Standard Post Publishing

**Endpoint**: `POST /api/publish/newPost`

**Headers**:
```http
Content-Type: application/json
Authorization: Bearer <jwt-token>  # Required
```

**Authentication Status**: ✅ **REQUIRED** - This endpoint requires a valid JWT token.

**Request Body**:
```json
{
  "basic": {
    "name": "My Blog Post",
    "description": "A comprehensive guide to blockchain",
    "language": "en",
    "date": 1757789547,
    "nsfw": false,
    "tagItems": ["blockchain", "technology", "guide"]
  },
  "post": {
    "articleText": "This is the main content of my blog post...",
    "bylineWriter": "John Doe",
    "bylineWritersTitle": "Blockchain Developer",
    "bylineWritersLocation": "San Francisco, CA",
    "webUrl": "https://example.com/my-post",
    "featuredImage": "https://example.com/images/featured.jpg",
    "imageItems": [],
    "imageCaptionItems": [],
    "videoItems": [],
    "audioItems": [],
    "audioCaptionItems": [],
    "replyTo": ""
  },
  "blockchain": "arweave"
}
```

**Field Specifications**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `basic.name` | string | **Yes** | Title/name of the post |
| `basic.description` | string | No | Brief description or summary |
| `basic.language` | string | No | Language code (default: "en") |
| `basic.date` | number | No | Unix timestamp (default: current time) |
| `basic.nsfw` | boolean | No | Not Safe For Work flag (default: false) |
| `basic.tagItems` | array | No | Array of tag strings for categorization |
| `post.articleText` | string | **Yes** | Main content of the post |
| `post.webUrl` | string | No | Original URL if cross-posting |
| `post.bylineWriter` | string | No | Author name |
| `post.bylineWritersTitle` | string | No | Author's title/position |
| `post.bylineWritersLocation` | string | No | Author's location |
| `post.featuredImage` | string | No | URL to featured image |
| `post.imageItems` | array | No | Array of additional images |
| `post.imageCaptionItems` | array | No | Captions for images |
| `post.videoItems` | array | No | Array of embedded videos |
| `post.audioItems` | array | No | Array of audio files |
| `post.audioCaptionItems` | array | No | Captions for audio items |
| `post.replyTo` | string | No | Reference to another post if this is a reply |
| `blockchain` | string | No | Target blockchain (default: "arweave") |

**Minimal Example**:
```json
{
  "basic": {
    "name": "My First Blog Post"
  },
  "post": {
    "articleText": "This is the main content of my blog post."
  }
}
```

**Response**:
```json
{
  "transactionId": "abc123def456...",
  "recordToIndex": {
    "data": { /* original record data */ },
    "oip": {
      "didTx": "did:arweave:abc123def456...",
      "inArweaveBlock": 1234567,
      "recordType": "post",
      "indexedAt": "2025-09-13T18:52:38.413Z",
      "recordStatus": "pending confirmation in Arweave",
      "creator": {
        "creatorHandle": "string",
        "didAddress": "did:arweave:creator_address",
        "didTx": "did:arweave:creator_tx",
        "publicKey": "creator_public_key"
      }
    }
  },
  "blockchain": "arweave",
  "message": "Post published successfully"
}
```

**Query Parameters for Media Processing** (Optional):
- `publishFiles`: Boolean to enable media file processing
- `addMediaToArweave`: Boolean to store media on Arweave (default: true for media endpoints)
- `addMediaToIPFS`: Boolean to store media on IPFS
- `addMediaToArFleet`: Boolean to store media on ArFleet

**Example with Media Processing**:
```bash
curl -X POST "https://api.oip.onl/api/publish/newPost?publishFiles=true&addMediaToArweave=true" \
  -H "Content-Type: application/json" \
  -d '{ /* post data */ }'
```

## Publishing to GUN (Private Records)

### Private Conversation Session

**Endpoint**: `POST /api/records/newRecord`

**Headers**:
```http
Content-Type: application/json
Authorization: Bearer <jwt-token>  # Required for private records
```

**Query Parameters**:
```
?recordType=conversationSession&storage=gun&localId=session_1757789557773
```

**Request Body**:
```json
{
  "basic": {
    "name": "My Private Session",
    "description": "Alfred conversation session",
    "date": 1757789558,
    "language": "en"
  },
  "conversationSession": {
    "session_id": "session_1757789557773",
    "start_timestamp": 1757789558199,
    "last_activity_timestamp": 1757789558199,
    "last_modified_timestamp": 1757789558199,
    "message_count": 0,
    "messages": [],
    "message_timestamps": [],
    "message_roles": [],
    "model_name": "grok-4",
    "model_provider": "did:arweave:model_provider_did",
    "total_tokens": 0,
    "input_tokens": 0,
    "output_tokens": 0,
    "processing_mode": "rag",
    "conversation_type": "voice",
    "is_archived": false,
    "owner_public_key": "0349b2160ea3117a90a1fcbbf198ef53bf325b604157cbcf81693f0f476006c9e1",
    "version": "1.0.0"
  },
  "accessControl": {
    "access_level": "private",
    "owner_public_key": "0349b2160ea3117a90a1fcbbf198ef53bf325b604157cbcf81693f0f476006c9e1",
    "created_by": "0349b2160ea3117a90a1fcbbf81693f0f476006c9e1"
  }
}
```

**Response**:
```json
{
  "did": "did:gun:647f79c2a338:session_1757789557773",
  "message": "Record published successfully to GUN",
  "storage": "gun",
  "encrypted": true,
  "owner": "0349b2160ea3117a90a1fcbbf198ef53bf325b604157cbcf81693f0f476006c9e1"
}
```

### Private Record with Messages

**Request Body** (with conversation data):
```json
{
  "basic": {
    "name": "Active Conversation",
    "description": "Alfred conversation session",
    "date": 1757789558,
    "language": "en"
  },
  "conversationSession": {
    "session_id": "session_1757789557773",
    "start_timestamp": 1757789558199,
    "last_activity_timestamp": 1757789564542,
    "last_modified_timestamp": 1757789564542,
    "message_count": 2,
    "messages": ["Hello, who are you?", "I am ALFRED, an AI assistant..."],
    "message_timestamps": [1757789559348, 1757789564040],
    "message_roles": ["user", "assistant"],
    "model_name": "grok-4",
    "model_provider": "did:arweave:fHGJvSZEdxFVLJjzPvA2Lu4892l05siTveFd5hU5xZQ",
    "processing_mode": "llm",
    "conversation_type": "voice",
    "owner_public_key": "0349b2160ea3117a90a1fcbbf198ef53bf325b604157cbcf81693f0f476006c9e1"
  },
  "accessControl": {
    "access_level": "private",
    "owner_public_key": "0349b2160ea3117a90a1fcbbf198ef53bf325b604157cbcf81693f0f476006c9e1",
    "created_by": "0349b2160ea3117a90a1fcbbf198ef53bf325b604157cbcf81693f0f476006c9e1"
  }
}
```

## Publishing Media Files (GUN + BitTorrent)

### Media Upload and Distribution

**Endpoint**: `POST /api/media/upload`

**Headers**:
```http
Content-Type: multipart/form-data
Authorization: Bearer <jwt-token>  # Required
```

**Form Fields**:
```
file: <binary_file>                    # Required: The media file to upload
name: "My Video File"                  # Optional: Human-readable name
access_level: "private"                # Optional: "private" (default) or "public"
encrypt: false                         # Optional: Enable file encryption
publishTo[ipfs]: true                  # Optional: Also publish to IPFS
publishTo[arweave]: false              # Optional: Also publish to Arweave
```

**Response**:
```json
{
  "success": true,
  "mediaId": "a1b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789a",
  "did": "did:gun:media:a1b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789a",
  "magnetURI": "magnet:?xt=urn:btih:abc123def456...",
  "infoHash": "abc123def456789abcdef0123456789abcdef01",
  "transport": {
    "bittorrent": {
      "magnetURI": "magnet:?xt=urn:btih:abc123def456...",
      "infoHash": "abc123def456789abcdef0123456789abcdef01",
      "trackers": ["wss://tracker.openwebtorrent.com", "wss://tracker.btorrent.xyz"]
    },
    "http": ["https://api.oip.onl/api/media/a1b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789a"]
  },
  "encrypted": false,
  "access_level": "private",
  "owner": "0349b2160ea3117a90a1fcbbf198ef53bf325b604157cbcf81693f0f476006c9e1",
  "size": 1048576,
  "mime": "video/mp4",
  "originalName": "my_video.mp4"
}
```

### Media File Streaming

**Endpoint**: `GET /api/media/:mediaId`

**Headers**:
```http
Authorization: Bearer <jwt-token>  # Required for private media
Range: bytes=0-1023                # Optional: For range requests
```

**Response**:
- **Content-Type**: Original file MIME type
- **Content-Length**: File size in bytes
- **Accept-Ranges**: bytes (supports video streaming)
- **Content-Range**: bytes start-end/total (for range requests)

**Status Codes**:
- `200`: Full file served
- `206`: Partial content (range request)
- `401`: Authentication required for private media
- `403`: Access denied (not the owner)
- `404`: Media file not found

### Media Information

**Endpoint**: `GET /api/media/:mediaId/info`

**Headers**:
```http
Authorization: Bearer <jwt-token>  # Required for private media
```

**Response**:
```json
{
  "basic": {
    "name": "My Video File",
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
  },
  "seeding": true,
  "seedingInfo": {
    "mediaId": "a1b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789a",
    "infoHash": "abc123def456789abcdef0123456789abcdef01",
    "magnetURI": "magnet:?xt=urn:btih:abc123def456...",
    "filePath": "/usr/src/app/data/media/a1b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789a/original",
    "createdAt": "2025-09-13T18:52:38.199Z",
    "fileSize": 1048576
  }
}
```

## Record Types and Templates

### Supported Record Types

#### Public Records (Arweave)
- **`post`**: Blog posts, articles, news
- **`image`**: Image content with metadata
- **`video`**: Video content with metadata
- **`audio`**: Audio content with metadata
- **`recipe`**: Cooking recipes with ingredients
- **`workout`**: Exercise routines
- **`exercise`**: Individual exercises
- **`text`**: Plain text content

#### Private Records (GUN)
- **`conversationSession`**: Private AI conversation history
- **`media`**: Private media files with torrent distribution
- **`note`**: Private user notes (future)
- **`calendar`**: Private calendar events (future)
- **`webHistory`**: Private browsing history (future)

#### Additional Record Types
- **`text`**: Text document records
- **`template`**: Schema template records
- **`nutritionalInfo`**: Nutritional information records

### Access Control Levels

#### `access_level` Values
- **`public`**: Accessible to everyone (default for Arweave)
- **`private`**: Accessible only to owner (default for GUN)
- **`shared`**: Accessible to owner and specified users (future)
- **`organization`**: Accessible to organization members (future)

## User Ownership and Privacy

### HD Wallet System
- **BIP-39**: 12-word mnemonic phrases for account recovery
- **BIP-32**: Hierarchical deterministic key derivation
- **Key Path**: `m/44'/0'/0'/0/0`
- **Public Key Format**: 66-character hex string (compressed secp256k1)
- **Private Key Storage**: Encrypted with user password using PBKDF2

### Ownership Verification
Records include multiple ownership indicators:
1. **`accessControl.owner_public_key`**: Primary ownership field
2. **`accessControl.created_by`**: Record creator's public key
3. **`conversationSession.owner_public_key`**: Session-specific ownership
4. **GUN Soul Hash**: User's public key hash in DID

### Privacy Filtering
- **Unauthenticated**: Only public records (`access_level: 'public'`)
- **Authenticated**: Public records + owned private records
- **Cross-User**: Users cannot access other users' private records

## GUN Network Integration


### Array Data Handling (Automatic)
**GUN cannot handle complex nested arrays**, but the OIP backend automatically handles this conversion for you.

#### ✅ What You Can Send (Natural Format)
```json
{
  "conversationSession": {
    "messages": ["Hello", "Hi there", "How are you?"],           // ✅ Send natural arrays
    "message_timestamps": [1757789559348, 1757789564040],        // ✅ Send natural arrays
    "message_roles": ["user", "assistant", "user"],             // ✅ Send natural arrays
    "model_provider": "did:arweave:abc123"                       // ✅ Single strings work as-is
  }
}
```

#### 🔄 What Happens Automatically (Backend Processing)
```json
{
  "conversationSession": {
    "messages": "[\"Hello\",\"Hi there\",\"How are you?\"]",           // 🔄 Auto-converted to JSON string
    "message_timestamps": "[1757789559348,1757789564040]",            // 🔄 Auto-converted to JSON string
    "message_roles": "[\"user\",\"assistant\",\"user\"]",           // 🔄 Auto-converted to JSON string
    "model_provider": "did:arweave:abc123"                           // 🔄 Strings unchanged
  }
}
```

### Data Structure Processing
- **Automatic Array Conversion**: Backend automatically converts arrays to JSON strings for GUN
- **Transparent to Developers**: Send natural array data, backend handles GUN compatibility
- **Elasticsearch Restoration**: JSON strings automatically converted back to arrays for indexing
- **API Response Consistency**: Retrieved records show natural array format

### Encryption
- **Algorithm**: AES-256-GCM
- **Key Derivation**: PBKDF2 with 100,000 iterations
- **Automatic**: Private records encrypted before GUN storage
- **Decryption**: Automatic on retrieval for authorized users

### Soul Generation
GUN souls are deterministic based on user's public key:
```
{user_public_key_hash}:{record_id}
```

Example: `647f79c2a338:session_1757789557773`

## Publishing Examples

### cURL Examples

#### Register New User
```bash
curl -X POST https://api.oip.onl/api/user/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "developer@example.com",
    "password": "secure_password_123"
  }'
```

#### Login User
```bash
curl -X POST https://api.oip.onl/api/user/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "developer@example.com",
    "password": "secure_password_123"
  }'
```

#### Publish Public Post (Arweave) - Authentication Required
```bash
curl -X POST https://api.oip.onl/api/publish/newPost \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "basic": {
      "name": "My Public Blog Post",
      "description": "A sample public post",
      "tagItems": ["public", "blog", "example"]
    },
    "post": {
      "articleText": "This is my public blog post content that everyone can see.",
      "bylineWriter": "John Developer"
    }
  }'
```

#### Publish Recipe (No Authentication Required - Legacy)
```bash
curl -X POST https://api.oip.onl/api/publish/newRecipe \
  -H "Content-Type: application/json" \
  -d '{
    "basic": {
      "name": "Mediterranean Grilled Chicken",
      "description": "A delicious grilled chicken recipe"
    },
    "recipe": {
      "ingredient": ["chicken thighs", "olive oil", "garlic"],
      "ingredient_amount": [4, 2, 2],
      "ingredient_unit": ["pieces", "tbsp", "cloves"],
      "instructions": "1. Marinate chicken..."
    }
  }'
```

#### Publish Workout (No Authentication Required - Legacy)
```bash
curl -X POST https://api.oip.onl/api/publish/newWorkout \
  -H "Content-Type: application/json" \
  -d '{
    "basic": {
      "name": "Upper Body Strength",
      "description": "Comprehensive upper body workout"
    },
    "workout": {
      "exercise": ["Push-ups", "Bench Press", "Pull-ups"],
      "exercise_amount": [3, 3, 3],
      "exercise_unit": ["sets", "sets", "sets"]
    }
  }'
```

#### Publish Private Session (GUN)
```bash
curl -X POST "https://api.oip.onl/api/records/newRecord?recordType=conversationSession&storage=gun&localId=my_session_123" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "basic": {
      "name": "My Private Conversation",
      "description": "Private AI conversation session"
    },
    "conversationSession": {
      "session_id": "my_session_123",
      "start_timestamp": 1757789558199,
      "message_count": 0,
      "messages": [],
      "message_timestamps": [],
      "message_roles": [],
      "model_name": "gpt-4o-mini",
      "conversation_type": "text",
      "owner_public_key": "YOUR_PUBLIC_KEY_FROM_JWT"
    },
    "accessControl": {
      "access_level": "private",
      "owner_public_key": "YOUR_PUBLIC_KEY_FROM_JWT",
      "created_by": "YOUR_PUBLIC_KEY_FROM_JWT"
    }
  }'
```

#### Upload Private Media (GUN + BitTorrent)
```bash
curl -X POST https://api.oip.onl/api/media/upload \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "file=@/path/to/your/video.mp4" \
  -F "name=My Private Video" \
  -F "access_level=private"
```

#### Stream Media File
```bash
# Get full file
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  https://api.oip.onl/api/media/a1b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789a

# Get range (for video streaming)
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Range: bytes=0-1048575" \
  https://api.oip.onl/api/media/a1b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789a
```

#### Get Media Information
```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  https://api.oip.onl/api/media/a1b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789a/info
```

### JavaScript/Node.js Examples

#### Complete User Registration and Publishing Flow
```javascript
const axios = require('axios');

class OIPClient {
  constructor(baseUrl = 'https://api.oip.onl') {
    this.baseUrl = baseUrl;
    this.token = null;
    this.user = null;
  }

  // Register new user with HD wallet
  async register(email, password) {
    try {
      const response = await axios.post(`${this.baseUrl}/api/user/register`, {
        email,
        password
      });

      if (response.data.success) {
        this.token = response.data.token;
        this.user = {
          email,
          publicKey: response.data.publicKey
        };
        console.log('✅ User registered with HD wallet:', this.user.publicKey.slice(0, 12) + '...');
        return response.data;
      }
    } catch (error) {
      console.error('❌ Registration failed:', error.response?.data || error.message);
      throw error;
    }
  }

  // Login existing user
  async login(email, password) {
    try {
      const response = await axios.post(`${this.baseUrl}/api/user/login`, {
        email,
        password
      });

      if (response.data.success) {
        this.token = response.data.token;
        this.user = {
          email,
          publicKey: response.data.publicKey
        };
        console.log('✅ User logged in:', this.user.publicKey.slice(0, 12) + '...');
        return response.data;
      }
    } catch (error) {
      console.error('❌ Login failed:', error.response?.data || error.message);
      throw error;
    }
  }

  // Publish public post to Arweave
  async publishPublicPost(title, content, tags = []) {
    try {
      const postData = {
        basic: {
          name: title,
          description: `Public post: ${title}`,
          tagItems: tags,
          date: Math.floor(Date.now() / 1000)
        },
        post: {
          articleText: content,
          bylineWriter: this.user?.email || 'Anonymous'
        }
      };

      const response = await axios.post(
        `${this.baseUrl}/api/publish/newPost`,
        postData,
        {
          headers: {
            'Content-Type': 'application/json',
            ...(this.token && { 'Authorization': `Bearer ${this.token}` })
          }
        }
      );

      console.log('✅ Public post published to Arweave:', response.data.transactionId);
      return response.data;
    } catch (error) {
      console.error('❌ Failed to publish public post:', error.response?.data || error.message);
      throw error;
    }
  }

  // Publish private session to GUN
  async publishPrivateSession(sessionId, messages = []) {
    if (!this.token) {
      throw new Error('Authentication required for private records');
    }

    try {
      const sessionData = {
        basic: {
          name: `Private Session ${sessionId}`,
          description: 'Private conversation session',
          date: Math.floor(Date.now() / 1000)
        },
        conversationSession: {
          session_id: sessionId,
          start_timestamp: Date.now(),
          last_activity_timestamp: Date.now(),
          last_modified_timestamp: Date.now(),
          message_count: messages.length,
          // ✅ Send natural arrays - backend automatically converts for GUN compatibility
          messages: messages.map(m => m.content || m.text),
          message_timestamps: messages.map(m => m.timestamp || Date.now()),
          message_roles: messages.map(m => m.role || 'user'),
          // ✅ Single strings work as-is
          model_provider: 'did:arweave:model_provider_did',
          model_name: 'gpt-4o-mini',
          conversation_type: 'text',
          is_archived: false,
          owner_public_key: this.user.publicKey,
          version: '1.0.0'
        },
        accessControl: {
          access_level: 'private',
          owner_public_key: this.user.publicKey,
          created_by: this.user.publicKey
        }
      };

      const response = await axios.post(
        `${this.baseUrl}/api/records/newRecord?recordType=conversationSession&storage=gun&localId=${sessionId}`,
        sessionData,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`
          }
        }
      );

      console.log('✅ Private session published to GUN:', response.data.did);
      return response.data;
    } catch (error) {
      console.error('❌ Failed to publish private session:', error.response?.data || error.message);
      throw error;
    }
  }

  // Retrieve user's private records
  async getPrivateRecords(recordType = 'conversationSession', limit = 15) {
    if (!this.token) {
      throw new Error('Authentication required for private records');
    }

    try {
      const response = await axios.get(
        `${this.baseUrl}/api/records?source=gun&recordType=${recordType}&limit=${limit}&sortBy=date:desc`,
        {
          headers: {
            'Authorization': `Bearer ${this.token}`
          }
        }
      );

      console.log(`✅ Retrieved ${response.data.records.length} private ${recordType} records`);
      return response.data;
    } catch (error) {
      console.error('❌ Failed to retrieve private records:', error.response?.data || error.message);
      throw error;
    }
  }
  
  // Upload private media file
  async uploadMedia(filePath, options = {}) {
    if (!this.token) {
      throw new Error('Authentication required for media upload');
    }

    try {
      const FormData = require('form-data');
      const fs = require('fs');
      
      const form = new FormData();
      form.append('file', fs.createReadStream(filePath));
      
      if (options.name) form.append('name', options.name);
      if (options.access_level) form.append('access_level', options.access_level);
      if (options.encrypt) form.append('encrypt', options.encrypt);

      const response = await axios.post(
        `${this.baseUrl}/api/media/upload`,
        form,
        {
          headers: {
            ...form.getHeaders(),
            'Authorization': `Bearer ${this.token}`
          }
        }
      );

      if (response.data.success) {
        console.log('✅ Media uploaded successfully');
        console.log('🆔 Media ID:', response.data.mediaId);
        console.log('🧲 Magnet URI:', response.data.magnetURI.slice(0, 50) + '...');
        console.log('📊 Size:', (response.data.size / 1024 / 1024).toFixed(2), 'MB');
        return response.data;
      }
    } catch (error) {
      console.error('❌ Failed to upload media:', error.response?.data || error.message);
      throw error;
    }
  }

  // Get media information
  async getMediaInfo(mediaId) {
    if (!this.token) {
      throw new Error('Authentication required for private media');
    }

    try {
      const response = await axios.get(
        `${this.baseUrl}/api/media/${mediaId}/info`,
        {
          headers: {
            'Authorization': `Bearer ${this.token}`
          }
        }
      );

      console.log('✅ Media info retrieved:', response.data.media?.originalName);
      return response.data;
    } catch (error) {
      console.error('❌ Failed to get media info:', error.response?.data || error.message);
      throw error;
    }
  }

  // Stream media file
  async streamMedia(mediaId, options = {}) {
    if (!this.token) {
      throw new Error('Authentication required for private media');
    }

    try {
      const headers = { 'Authorization': `Bearer ${this.token}` };
      
      // Add range header if specified
      if (options.range) {
        headers['Range'] = `bytes=${options.range}`;
      }

      const response = await axios.get(
        `${this.baseUrl}/api/media/${mediaId}`,
        {
          headers,
          responseType: 'stream'
        }
      );

      console.log('✅ Media stream started:', mediaId);
      return response.data; // Returns readable stream
    } catch (error) {
      console.error('❌ Failed to stream media:', error.response?.data || error.message);
      throw error;
    }
  }
}

// Usage Example
async function example() {
  const client = new OIPClient();

  // Register or login
  await client.register('developer@example.com', 'secure_password_123');
  // OR: await client.login('developer@example.com', 'secure_password_123');

  // Publish public post
  await client.publishPublicPost(
    'My Development Journey',
    'Today I learned about HD wallets and decentralized storage...',
    ['development', 'blockchain', 'learning']
  );

  // Publish private session
  await client.publishPrivateSession('dev_session_001', [
    { role: 'user', content: 'What is blockchain?', timestamp: Date.now() },
    { role: 'assistant', content: 'Blockchain is a distributed ledger...', timestamp: Date.now() }
  ]);

  // Upload private media
  const mediaResult = await client.uploadMedia('./my_video.mp4', {
    name: 'Development Tutorial Video',
    access_level: 'private'
  });

  // Get media info
  const mediaInfo = await client.getMediaInfo(mediaResult.mediaId);
  console.log('Media seeding status:', mediaInfo.seeding);

  // Stream media (for video playback)
  const mediaStream = await client.streamMedia(mediaResult.mediaId);
  // Use mediaStream for video player or file download

  // Retrieve private records
  const privateRecords = await client.getPrivateRecords();
  console.log('My private sessions:', privateRecords.records.length);
  
  // Retrieve private media
  const privateMedia = await client.getPrivateRecords('media');
  console.log('My private media files:', privateMedia.records.length);
}
```

## Record Ownership and Security

### Public Key Ownership
Each user has a unique HD wallet with:
- **Public Key**: Used for record ownership verification
- **Private Key**: Encrypted and stored securely
- **Mnemonic**: 12-word backup phrase (encrypted)

### Access Control Template
```json
{
  "accessControl": {
    "access_level": "private|public|shared|organization",
    "owner_public_key": "user_hex_public_key",
    "created_by": "creator_hex_public_key"
  }
}
```

### Privacy Levels
- **Public Records**: Visible to everyone
- **Private Records**: Visible only to owner
- **Shared Records**: Visible to owner and specified users (future)
- **Organization Records**: Visible to organization members (future)

## Storage Comparison

| Feature | Arweave | GUN |
|---------|---------|-----|
| **Permanence** | Permanent | Distributed |
| **Privacy** | Public | Private/Encrypted |
| **Cost** | Paid (AR tokens) | Free |
| **Speed** | Slower | Faster |
| **Authentication** | Required (most endpoints) | Required for private |
| **Ownership** | User HD wallets | User HD wallets |
| **Arrays** | ✅ Supported | ❌ JSON strings only |
| **Search** | Full Elasticsearch | Basic filtering |
| **Data Complexity** | ✅ Full support | ⚠️ Limited by GUN |
| **Media Files** | ✅ Via IPFS/HTTP | ✅ BitTorrent + HTTP |
| **Video Streaming** | ⚠️ Basic | ✅ Range requests |
| **P2P Distribution** | ❌ No | ✅ WebTorrent |
| **File Seeding** | ❌ No | ✅ Persistent |

**Note**: The `/api/publish/newRecipe` and `/api/publish/newWorkout` endpoints are legacy endpoints that don't require authentication. All other publishing endpoints require authentication.

## Error Handling

### Common Error Responses

#### Authentication Errors

**No Token Provided** (401):
```json
{
  "error": "No token provided"
}
```

**Invalid Token** (403):
```json
{
  "error": "Invalid token"
}
```

**Token Expired** (403):
```json
{
  "error": "Token expired"
}
```

**Authentication Required** (401):
```json
{
  "error": "Authentication required for this endpoint"
}
```

#### Validation Errors
```json
{
  "error": "Missing required field: basic.name",
  "status": 400
}
```

#### Storage Errors
```json
{
  "error": "Failed to store record in GUN",
  "details": "Network timeout",
  "status": 500
}
```

#### Media Upload Errors
```json
{
  "error": "No file provided",
  "status": 400
}
```

```json
{
  "error": "File too large",
  "details": "Maximum file size is 500MB",
  "status": 413
}
```

```json
{
  "error": "Failed to create torrent",
  "details": "WebTorrent initialization failed",

  "status": 500
}
```

#### GUN Array Errors
```json
{
  "error": "Invalid data: Array at 647f79c2a338:session_123.data.conversationSession.messages",
  "details": "GUN cannot handle arrays - use JSON strings",
  "status": 400
}
```

### Error Handling Best Practices
1. **Always check response status**
2. **Handle network timeouts gracefully**
3. **Validate data before publishing**
4. **Use natural data formats - backend handles GUN compatibility**
5. **Store JWT tokens securely**
6. **Implement retry logic for network failures**
7. **Test with sample data before production**

## Media Distribution Features

### BitTorrent Integration
- **Persistent Seeding**: Server continuously seeds uploaded files
- **WebTorrent**: Browser-compatible P2P file sharing
- **Magnet URIs**: Decentralized file discovery and downloading
- **Tracker Network**: Public WebSocket trackers for peer discovery

### Media Streaming
- **HTTP Range Requests**: Optimized for video/audio streaming
- **Immediate Playback**: Stream while downloading via BitTorrent
- **Bandwidth Efficiency**: P2P distribution reduces server load
- **Cross-Platform**: Works in browsers and native applications

### File Organization
```
/data/media/
├── <mediaId>/
│   ├── original          # Original uploaded file
│   └── manifest.json     # Media manifest with metadata
└── seeder.json          # Seeding state persistence
```

### Supported Media Types
- **Video**: MP4, WebM, AVI, MOV (with range request streaming)
- **Audio**: MP3, WAV, FLAC, OGG (with range request streaming)
- **Images**: JPEG, PNG, GIF, WebP
- **Documents**: PDF, TXT, MD
- **Archives**: ZIP, TAR, GZ
- **Any Binary**: Generic file support with MIME detection

## Additional Publish Endpoints

### Photo Analysis and Upload

#### Photo Upload
**Endpoint**: `POST /api/photo/upload`

**Headers**:
```http
Content-Type: multipart/form-data
```

**Request Body**:
```
photo: <image_file>  # Required: Image file (JPEG, PNG, GIF, WebP, BMP, TIFF, SVG)
```

**Response**:
```json
{
  "success": true,
  "photoId": "abc123...",
  "filename": "image.jpg",
  "size": 1234567,
  "mimetype": "image/jpeg",
  "message": "Photo uploaded and cached successfully",
  "expiresIn": "24 hours"
}
```

#### Photo Analysis
**Endpoint**: `POST /api/photo/analyze`

**Headers**:
```http
Content-Type: application/json
```

**Request Body**:
```json
{
  "photoId": "abc123...",
  "question": "What do you see in this image?",
  "model": "grok-4"
}
```

**Response**:
```json
{
  "success": true,
  "photoId": "abc123...",
  "question": "What do you see in this image?",
  "analysis": "I can see a beautiful landscape with mountains...",
  "model": "grok-4",
  "processingTimeMs": 1234,
  "photoInfo": {
    "filename": "image.jpg",
    "size": 1234567,
    "uploadedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

#### Photo Chat Integration
**Endpoint**: `POST /api/photo/chat`

**Headers**:
```http
Content-Type: application/json
```

**Request Body**:
```json
{
  "photoId": "abc123...",
  "question": "Explain what's happening in this photo",
  "model": "grok-4",
  "processing_mode": "rag",
  "return_audio": true,
  "voiceConfig": "{\"engine\":\"elevenlabs\",\"voice_id\":\"daniel\"}",
  "conversationHistory": []
}
```

**Response**:
```json
{
  "success": true,
  "response": "Based on the image analysis, I can see...",
  "image_analysis": "Raw Grok-4 analysis...",
  "audio_data": "base64_encoded_audio_data",
  "processing_mode": "rag",
  "model": "grok-4",
  "photoInfo": {
    "filename": "image.jpg",
    "uploadedAt": "2024-01-15T10:30:00.000Z"
  },
  "processingTimeMs": 2345
}
```

### Recipe Image Generation

#### Generate Recipe Image
**Endpoint**: `POST /api/recipes/generate-image`

**Headers**:
```http
Content-Type: application/json
```

**Request Body**:
```json
{
  "recipeId": "recipe-123",
  "recipeTitle": "Grilled Chicken Salad",
  "description": "A healthy and delicious salad with grilled chicken breast",
  "ingredients": ["chicken breast", "lettuce", "tomatoes", "cucumber"],
  "forceRegenerate": false
}
```

**Response**:
```json
{
  "success": true,
  "imageUrl": "/api/recipe-images/recipe-123.png",
  "cached": false
}
```

#### Serve Recipe Images
**Endpoint**: `GET /api/recipes/images/:filename`

**Response**: Binary image data with proper content type headers

### Text Document Publishing

**Endpoint**: `POST /api/publish/newText`

**Headers**:
```http
Content-Type: application/json
Authorization: Bearer <jwt-token>  # Required
```

**Authentication Status**: ✅ **REQUIRED** - This endpoint requires a valid JWT token.

**Request Body**:
```json
{
  "basic": {
    "name": "My Text Document",
    "description": "A sample text document",
    "language": "en",
    "date": 1757789547,
    "nsfw": false,
    "tagItems": ["document", "text", "example"]
  },
  "text": {
    "content": "This is the main content of my text document...",
    "format": "markdown",
    "wordCount": 150
  },
  "blockchain": "arweave"
}
```

### Template Publishing

**Endpoint**: `POST /api/publish/newTemplate`

**Headers**:
```http
Content-Type: application/json
Authorization: Bearer <jwt-token>  # Required
```

**Request Body**:
```json
{
  "template": {
    "myRecordType": {
      "name": "string",
      "description": "string",
      "date": "number",
      "category": "enum",
      "categoryValues": ["option1", "option2", "option3"]
    }
  },
  "blockchain": "arweave"
}
```

### Nutritional Information Publishing

**Endpoint**: `POST /api/publish/newNutritionalInfo`

**Headers**:
```http
Content-Type: application/json
Authorization: Bearer <jwt-token>  # Required
```

**Authentication Status**: ✅ **REQUIRED** - This endpoint requires a valid JWT token.

**Request Body**:
```json
{
  "data": {
    "basic": {
      "name": "Chicken Breast Nutritional Info",
      "date": 1757789547,
      "language": "en",
      "tagItems": ["nutrition", "chicken", "protein"]
    },
    "nutritionalInfo": {
      "calories": 165,
      "proteinG": 31,
      "fatG": 3.6,
      "saturatedFatG": 1.0,
      "transFatG": 0,
      "cholesterolMg": 85,
      "sodiumMg": 74,
      "carbohydratesG": 0,
      "dietaryFiberG": 0,
      "sugarsG": 0,
      "addedSugarsG": 0,
      "vitaminDMcg": 0,
      "calciumMg": 15,
      "ironMg": 0.9,
      "potassiumMg": 256,
      "vitaminAMcg": 9,
      "vitaminCMg": 0,
      "allergens": [],
      "glutenFree": true,
      "organic": false,
      "standardAmount": 1,
      "standardUnit": "100g"
    },
    "image": {
      "webUrl": "https://example.com/chicken-breast.jpg",
      "contentType": "image/jpeg"
    }
  },
  "blockchain": "arweave"
}
```

### Nutritional Information Lookup (Preview)

**Endpoint**: `POST /api/publish/lookupNutritionalInfo`

**Headers**:
```http
Content-Type: application/json
Authorization: Bearer <jwt-token>  # Required
```

**Purpose**: Look up nutritional information from Nutritionix API without publishing (preview/validation)

**Request Body**:
```json
{
  "ingredientName": "chicken breast"
}
```

**Response**:
```json
{
  "success": true,
  "ingredientName": "chicken breast",
  "data": {
    "basic": {
      "name": "chicken breast",
      "webUrl": "https://www.nutritionix.com/food/chicken-breast",
      "date": 1757789547,
      "language": "en"
    },
    "nutritionalInfo": {
      "standardAmount": 1,
      "standardUnit": "100g",
      "calories": 165,
      "proteinG": 31,
      "fatG": 3.6,
      ...
    }
  }
}
```

## Recipe Publishing: Two Approaches

### Specialized Recipe Endpoint (`/api/publish/newRecipe`)

**Endpoint**: `POST /api/publish/newRecipe`

**Headers**:
```http
Content-Type: application/json
```

**Authentication Status**: ⚠️ **NOT REQUIRED** - This endpoint currently does not require authentication for backward compatibility.

**Features**:
- **Intelligent Ingredient Processing**: Automatically looks up existing nutritional records
- **Fuzzy Matching**: Advanced scoring algorithms for ingredient matching
- **Auto-Creation**: Creates new nutritional records for missing ingredients
- **Nutritionix Integration**: Fetches nutritional data from external API
- **Parallel Array Construction**: Server builds ingredient arrays automatically

**Use Case**: Server-side automation with intelligent ingredient handling

**Request Format**:
```json
{
  "basic": { "name": "My Recipe", ... },
  "recipe": {
    "ingredient": ["garlic", "olive oil"],           // Raw ingredient names
    "ingredient_comment": ["minced", "extra virgin"],
    "ingredient_amount": [2, 3],
    "ingredient_unit": ["cloves", "tbsp"],
    "instructions": "Cook the garlic in oil...",
    ...
  }
}
```

### Specialized Workout Endpoint (`/api/publish/newWorkout`)

**Endpoint**: `POST /api/publish/newWorkout`

**Headers**:
```http
Content-Type: application/json
```

**Authentication Status**: ⚠️ **NOT REQUIRED** - This endpoint currently does not require authentication for backward compatibility.

**Features**:
- **Intelligent Exercise Processing**: Automatically looks up existing exercise records
- **Auto-Creation**: Creates new exercise records from Kaggle dataset if missing
- **Duration Calculation**: Automatically calculates total workout duration
- **Exercise Validation**: Validates exercise references and resolves them
- **Parallel Array Construction**: Server builds exercise arrays automatically

**Use Case**: Server-side automation with intelligent exercise handling

### General Record Endpoint (`/api/records/newRecord`)

**Endpoint**: `POST /api/records/newRecord`

**Headers**:
```http
Content-Type: application/json
Authorization: Bearer <jwt-token>  # Required
```

**Authentication Status**: ✅ **REQUIRED** - This endpoint requires a valid JWT token.

**Features**:
- **Pre-processed Ingredients**: Requires DIDs for all ingredients
- **Standard DID Handling**: Uses `oip.did` field (modern standard)
- **Storage Flexibility**: Supports both Arweave and GUN storage
- **Authentication Required**: Secure publishing with user ownership

**Use Case**: Client-side control with proper DID standardization

**Request Format**:
```json
{
  "basic": { "name": "My Recipe", ... },
  "recipe": {
    "ingredient": ["did:arweave:xyz", "did:arweave:abc"],  // Pre-resolved DIDs
    "ingredient_comment": ["chopped", "diced"],
    "ingredient_amount": [2, 1],
    "ingredient_unit": ["cups", "whole"],
    "instructions": ["Step 1", "Step 2"],
    ...
  },
  "accessControl": { ... }
}
```

### Recommendation for Recipe Bundle Feature

For implementing a Recipe Bundle feature in `reference-client.html`:

1. **Use `/api/records/newRecord`** for final recipe publishing (ensures proper DID handling)
2. **Implement intelligent ingredient handling client-side**:
   - Search for existing ingredients using `/api/records?recordType=nutritionalInfo`
   - Create new nutritional records as needed
   - Build parallel arrays with DIDs before publishing
3. **Follow the Exercise Bundle pattern** for UI/UX consistency

## Advanced Features

### Batch Publishing
For multiple records, publish them sequentially:

```javascript
async function publishBatch(records) {
  const results = [];
  for (const record of records) {
    try {
      const result = await client.publishPrivateSession(record.id, record.messages);
      results.push({ success: true, result });
    } catch (error) {
      results.push({ success: false, error: error.message });
    }
  }
  return results;
}
```

### Session Updates
Update existing sessions by republishing with the same `localId`:

```javascript
// Update session with new messages
await client.publishPrivateSession('existing_session_id', updatedMessages);
```

### Cross-Device Synchronization
Users can access their private records from any device using their JWT token:

```javascript
// Device A creates session
await clientA.publishPrivateSession('shared_session', messages);

// Device B (same user) retrieves session
const records = await clientB.getPrivateRecords();
// Will include session created on Device A
```

## Record Deletion

### Delete Record

**Endpoint**: `POST /api/records/deleteRecord`

**Headers**:
```http
Content-Type: application/json
Authorization: Bearer <jwt-token>  # Required
```

**Authentication Status**: ✅ **REQUIRED** - This endpoint requires a valid JWT token.

**Request Body**:
```json
{
  "delete": {
    "did": "did:arweave:abc123def456..."
  }
}
```

**Response**:
```json
{
  "success": true,
  "message": "Record deleted successfully",
  "did": "did:arweave:abc123def456...",
  "deletedCount": 1,
  "deleteMessageTxId": "xyz789...",
  "blockchainDeletion": true,
  "propagationNote": "Delete message published to blockchain. Deletion will propagate to all nodes during sync."
}
```

**Features**:
- **Ownership Verification**: Only record owners can delete their records
- **Blockchain Propagation**: For Arweave records, publishes a deleteMessage to propagate deletion across all nodes
- **Admin Override**: Server admins can delete server-created records
- **Immediate Deletion**: Records are deleted from local Elasticsearch index immediately
- **Network Sync**: Delete messages ensure deletion propagates during blockchain sync

**Error Responses**:

```json
{
  "error": "Record not found",
  "did": "did:arweave:abc123..."
}
```

```json
{
  "error": "Access denied. You can only delete records that you own.",
  "did": "did:arweave:abc123..."
}
```

```json
{
  "error": "Invalid request format. Expected: {\"delete\": {\"did\": \"did:gun:...\"}}"
}
```

## Podcast Generation from Records

### Generate Podcast from OIP Records

**Endpoint**: `POST /api/generate/podcast`

**Headers**:
```http
Content-Type: application/json
```

**Authentication Status**: ❌ **NOT REQUIRED** - This endpoint works without authentication.

**Request Body**:
```json
{
  "didTx": "did:arweave:record-id",
  "selectedHosts": ["socrates", "hypatia"],
  "targetLengthSeconds": 3500
}
```

### Parameters

#### `didTx` (string)
- **Description**: Single didTx identifier for a record to include in the podcast
- **Format**: `"did:arweave:transactionId"`
- **Example**: `"did:arweave:abc123def456ghi789"`

#### `didTxs` (array of strings)
- **Description**: Array of didTx identifiers for multiple records to include in the podcast
- **Format**: `["did:arweave:txId1", "did:arweave:txId2", ...]`
- **Example**: `["did:arweave:abc123", "did:arweave:def456", "did:arweave:ghi789"]`

#### `articles` (array of objects)
- **Description**: Manually provided articles for podcast content
- **Can be combined with**: `didTx` or `didTxs` for mixed content

#### `selectedHosts` (array of strings)
- **Description**: Podcast host personas
- **Required**: Yes
- **Available**: "socrates", "hypatia", "thomasJefferson", "machiavelli", etc.

#### `targetLengthSeconds` (number)
- **Description**: Target podcast length in seconds
- **Default**: Varies based on content
- **Example**: 3500 (approximately 58 minutes)

### Supported Record Types

#### `post` Records
- **Primary source**: `data.post.webUrl` - External article URL
- **Secondary source**: `data.post.articleText.data.text.webUrl` - Resolved text dref URL
- **Fallback**: `data.post.articleText` - Direct text content

#### `text` Records
- **Primary source**: `data.text.webUrl` - Text content URL
- **Fallback**: `data.text.text` - Direct text content

#### Other Record Types
- **Automatic extraction**: Uses RAG service to find full text URLs
- **Fallback**: `data.basic.description` - Record description

### Usage Examples

#### Single Record Podcast
```javascript
const response = await fetch('/api/generate/podcast', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
    },
    body: JSON.stringify({
        didTx: "did:arweave:your-record-id-here",
        selectedHosts: ["socrates", "hypatia"],
        targetLengthSeconds: 3500
    })
});
```

#### Multiple Records Podcast
```javascript
const response = await fetch('/api/generate/podcast', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
    },
    body: JSON.stringify({
        didTxs: [
            "did:arweave:record1-id",
            "did:arweave:record2-id",
            "did:arweave:record3-id"
        ],
        selectedHosts: ["thomasJefferson", "machiavelli"],
        targetLengthSeconds: 2500
    })
});
```

#### Mixed Content (Articles + Records)
```javascript
const response = await fetch('/api/generate/podcast', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
    },
    body: JSON.stringify({
        articles: [
            {
                title: "Manual Article",
                content: "Article content...",
                url: "https://example.com/article"
            }
        ],
        didTxs: [
            "did:arweave:record1-id",
            "did:arweave:record2-id"
        ],
        selectedHosts: ["socrates", "hypatia"],
        targetLengthSeconds: 4000
    })
});
```

### Response Format

Server-Sent Events (SSE) stream:

```
event: generatingPodcast
data: "Podcast generation starting for ID: abc123..."

event: podcastProductionUpdate  
data: "Socrates & Hypatia are hosting"

event: podcastProductionUpdate
data: "Socrates is writing intro"

event: podcastComplete
data: {"message": "Podcast generation complete!", "podcastFile": "podcast-id.mp3"}
```

### Content Processing

The system automatically:

1. **Fetches records** with `resolveDepth: 3` to ensure all dref references are resolved
2. **Extracts URLs** based on record type and structure
3. **Fetches content** from web URLs using the built-in content fetching service
4. **Converts to articles format** with the following structure:
   ```javascript
   {
       didTx: "did:arweave:...",
       title: "Record title",
       description: "Record description", 
       tags: "tag1,tag2,tag3",
       relatedScore: 1.0,
       url: "https://source-url.com", // if available
       content: "Full text content..."
   }
   ```

### Error Handling

**Common Errors**:
- **No valid articles**: No content could be extracted from provided didTx records
- **Record not found**: One or more didTx records don't exist in the database
- **Content extraction failed**: Unable to fetch content from URLs in the records
- **Missing hosts**: `selectedHosts` parameter is required

**Error Response Format**:
```json
{
    "error": "Error message describing the issue"
}
```

### Best Practices

1. **Use specific records**: Records with clear content URLs work best
2. **Mix content types**: Combine different record types for varied discussion
3. **Check record availability**: Ensure records exist and are accessible
4. **Content quality**: Records with substantial text content produce better podcasts
5. **Host selection**: Choose hosts that match the content topic for better discussions

### Limitations

1. **Content accessibility**: URLs must be publicly accessible for content fetching
2. **Content size**: Very large articles may be truncated
3. **Processing time**: Multiple records with external URLs take longer to process
4. **Network dependencies**: Requires internet access to fetch external content

### Media Distribution and Streaming
Handle large media files with BitTorrent distribution:

```javascript
// Upload and start seeding
const media = await client.uploadMedia('./large_video.mp4', {
  name: 'Training Video',
  access_level: 'private'
});

// Share magnet URI with authorized users
console.log('Magnet URI:', media.magnetURI);

// Stream for video player (supports range requests)
const videoStream = await client.streamMedia(media.mediaId, {
  range: '0-1048575' // First 1MB for preview
});

// Check seeding status
const info = await client.getMediaInfo(media.mediaId);
console.log('Seeders active:', info.seeding);
```

## Migration and Compatibility

### Legacy Records
- **Old Format**: Records without HD wallet ownership
- **Server Ownership**: Signed with server's Arweave key
- **Backward Compatibility**: Still accessible during migration
- **Gradual Migration**: New records use HD wallet ownership

### Data Format Evolution
- **Arrays → JSON Strings**: For GUN compatibility
- **Server Keys → User Keys**: For true ownership
- **Boolean → Enum**: `private: true` → `access_level: 'private'`

## Security Best Practices

### For Developers
1. **Never expose private keys** in client-side code
2. **Store JWT tokens securely** (httpOnly cookies recommended)
3. **Validate all inputs** before publishing
4. **Use HTTPS** for all API calls
5. **Implement proper error handling**
6. **Log security events** for monitoring

### For Users
1. **Backup mnemonic phrases** securely
2. **Use strong passwords** for key encryption
3. **Keep JWT tokens private**
4. **Log out from shared devices**
5. **Monitor account activity**

## Performance Considerations

### Publishing Speed
- **Arweave**: Slower due to blockchain confirmation
- **GUN**: Faster, immediate availability
- **Media Upload**: Depends on file size and torrent creation
- **Batch Operations**: Process sequentially to avoid rate limits

### Media Performance
- **Upload Time**: ~1-5 seconds for torrent creation + file processing
- **Streaming**: Immediate via HTTP, BitTorrent for P2P distribution
- **Range Requests**: Optimized for video/audio streaming
- **File Size Limit**: 500MB per file (configurable)

### Storage Costs
- **Arweave**: Paid storage (one-time fee)
- **GUN**: Free but requires network participation
- **Hybrid Approach**: Use GUN for private, Arweave for permanent public

### Network Requirements
- **Arweave**: Internet connection required
- **GUN**: Peer-to-peer network, works offline
- **Elasticsearch**: Required for search and retrieval

## API Rate Limits

### Current Status
- **No rate limits** currently implemented
- **Production Recommendation**: Implement rate limiting
- **Suggested Limits**: 100 requests/minute per user

### Future Implementation
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1757789558
```

## Monitoring and Analytics

### Published Record Tracking
```javascript
// Track publishing success rate
const publishingMetrics = {
  totalAttempts: 0,
  successfulPublications: 0,
  failedPublications: 0,
  averageResponseTime: 0
};
```

### User Activity Monitoring
```javascript
// Monitor user publishing patterns
const userActivity = {
  publicPosts: 0,
  privateSessions: 0,
  lastActivity: Date.now(),
  storageUsed: '1.2MB'
};
```

This comprehensive guide provides everything needed to integrate with the OIP publishing system, supporting both public permanent storage and private encrypted storage with true user ownership through HD wallets.
