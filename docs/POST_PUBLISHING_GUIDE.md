# Post Publishing API Documentation

## Overview

This document provides comprehensive information about publishing 'post' records in the OIPArweave system, including the endpoint details, authentication requirements, and exact JSON format specifications.

## Endpoint Information

### Base Endpoint
```
POST /api/publish/newPost
```

**Complete URL Example:**
```
https://your-api-domain.com/api/publish/newPost
```

## Authentication Requirements

### Current Status
⚠️ **Important**: The `/api/publish/newPost` endpoint currently does **NOT** require authentication, but this is likely to change in future versions for security reasons.

### Future Authentication (Recommended)
When authentication is implemented, the endpoint will require a JWT token in the Authorization header:

```http
Authorization: Bearer <your-jwt-token>
```

### How to Obtain JWT Tokens

#### For Admin Users
1. **Create Admin User:**
   ```bash
   node config/createAdmin.js
   ```

2. **Generate Token for Existing Admin:**
   ```bash
   node config/generateToken.js
   ```

3. **Test Token Generation:**
   ```bash
   JWT_SECRET=your_secret node config/testToken.js
   ```

#### Token Format
JWT tokens are signed using the `JWT_SECRET` environment variable and include:
- `userId`: Elasticsearch document ID
- `email`: User email address  
- `isAdmin`: Boolean flag for admin privileges
- `expiresIn`: Token expiration (default: 45 days)

## Request Format

### HTTP Headers
```http
Content-Type: application/json
Authorization: Bearer <jwt-token>  # When authentication is enabled
```

### JSON Schema

#### Complete Request Structure
```json
{
  "basic": {
    "name": "string (required)",
    "description": "string (optional)",
    "language": "string (optional, default: 'en')",
    "date": "number (optional, Unix timestamp)",
    "nsfw": "boolean (optional, default: false)",
    "tagItems": ["array of strings (optional)"]
  },
  "post": {
    "webUrl": "string (optional)",
    "bylineWriter": "string (optional)",
    "bylineWritersTitle": "string (optional)", 
    "bylineWritersLocation": "string (optional)",
    "articleText": "string (required for posts)",
    "featuredImage": "string (optional)",
    "imageItems": ["array (optional)"],
    "imageCaptionItems": ["array (optional)"],
    "videoItems": ["array (optional)"],
    "audioItems": ["array (optional)"],
    "audioCaptionItems": ["array (optional)"],
    "replyTo": "string (optional)"
  },
  "blockchain": "string (optional, default: 'arweave')"
}
```

#### Minimal Example
```json
{
  "basic": {
    "name": "My First Blog Post"
  },
  "post": {
    "articleText": "This is the main content of my blog post. It can contain multiple paragraphs and rich text content."
  }
}
```

#### Complete Example
```json
{
  "basic": {
    "name": "Understanding Blockchain Technology",
    "description": "A comprehensive guide to blockchain fundamentals",
    "language": "en",
    "date": 1703721600,
    "nsfw": false,
    "tagItems": ["blockchain", "technology", "education", "cryptocurrency"]
  },
  "post": {
    "webUrl": "https://example.com/blockchain-guide",
    "bylineWriter": "Jane Doe",
    "bylineWritersTitle": "Senior Blockchain Developer",
    "bylineWritersLocation": "San Francisco, CA",
    "articleText": "Blockchain technology has revolutionized how we think about digital transactions and data integrity. In this comprehensive guide, we'll explore the fundamental concepts that make blockchain such a powerful technology...",
    "featuredImage": "https://example.com/images/blockchain-hero.jpg",
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

## Field Specifications

### Basic Section (Required)
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Title/name of the post |
| `description` | string | No | Brief description or summary |
| `language` | string | No | Language code (default: "en") |
| `date` | number | No | Unix timestamp (default: current time) |
| `nsfw` | boolean | No | Not Safe For Work flag (default: false) |
| `tagItems` | array | No | Array of tag strings for categorization |

### Post Section (Required)
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `webUrl` | string | No | Original URL if cross-posting |
| `bylineWriter` | string | No | Author name |
| `bylineWritersTitle` | string | No | Author's title/position |
| `bylineWritersLocation` | string | No | Author's location |
| `articleText` | string | **Yes** | Main content of the post |
| `featuredImage` | string | No | URL to featured image |
| `imageItems` | array | No | Array of additional images |
| `imageCaptionItems` | array | No | Captions for images |
| `videoItems` | array | No | Array of embedded videos |
| `audioItems` | array | No | Array of audio files |
| `audioCaptionItems` | array | No | Captions for audio items |
| `replyTo` | string | No | Reference to another post if this is a reply |

### Additional Options
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `blockchain` | string | No | Target blockchain (default: "arweave") |

## Response Format

### Success Response (200)
```json
{
  "transactionId": "string",
  "recordToIndex": {
    "data": { /* original record data */ },
    "oip": {
      "didTx": "did:arweave:transaction_id",
      "inArweaveBlock": "number",
      "recordType": "post",
      "indexedAt": "ISO_timestamp",
      "recordStatus": "pending confirmation in Arweave",
      "creator": {
        "creatorHandle": "string",
        "didAddress": "string", 
        "didTx": "string",
        "publicKey": "string"
      }
    }
  },
  "blockchain": "arweave",
  "message": "Post published successfully"
}
```

### Error Response (500)
```json
{
  "error": "Failed to publish post"
}
```

### Error Response (400) - Missing Required Fields
```json
{
  "error": "Validation error message"
}
```

## Implementation Examples

### cURL Example
```bash
curl -X POST https://your-api-domain.com/api/publish/newPost \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-jwt-token" \
  -d '{
    "basic": {
      "name": "My Blog Post",
      "description": "A sample blog post",
      "tagItems": ["sample", "blog"]
    },
    "post": {
      "articleText": "This is the main content of my blog post.",
      "bylineWriter": "John Doe"
    }
  }'
```

### JavaScript/Node.js Example
```javascript
const axios = require('axios');

const publishPost = async () => {
  try {
    const postData = {
      basic: {
        name: "My Blog Post",
        description: "A sample blog post",
        tagItems: ["sample", "blog"]
      },
      post: {
        articleText: "This is the main content of my blog post.",
        bylineWriter: "John Doe"
      }
    };

    const response = await axios.post(
      'https://your-api-domain.com/api/publish/newPost',
      postData,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer your-jwt-token'
        }
      }
    );

    console.log('Post published:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error publishing post:', error.response.data);
    throw error;
  }
};
```

### Python Example
```python
import requests
import json

def publish_post():
    url = "https://your-api-domain.com/api/publish/newPost"
    
    post_data = {
        "basic": {
            "name": "My Blog Post",
            "description": "A sample blog post",
            "tagItems": ["sample", "blog"]
        },
        "post": {
            "articleText": "This is the main content of my blog post.",
            "bylineWriter": "John Doe"
        }
    }
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer your-jwt-token"
    }
    
    try:
        response = requests.post(url, json=post_data, headers=headers)
        response.raise_for_status()
        
        result = response.json()
        print(f"Post published: {result}")
        return result
    except requests.exceptions.RequestException as e:
        print(f"Error publishing post: {e}")
        raise
```

## Media Publishing Options

The system supports optional media processing with additional parameters:

### Query Parameters (Optional)
- `publishFiles`: Boolean to enable media file processing
- `addMediaToArweave`: Boolean to store media on Arweave
- `addMediaToIPFS`: Boolean to store media on IPFS
- `addMediaToArFleet`: Boolean to store media on ArFleet

### Example with Media Processing
```bash
curl -X POST "https://your-api-domain.com/api/publish/newPost?publishFiles=true&addMediaToArweave=true" \
  -H "Content-Type: application/json" \
  -d '{ /* post data */ }'
```

## Blockchain Support

The system supports multiple blockchain networks:
- **Arweave** (default)
- **Irys** 
- **Other networks** as configured

Specify the target blockchain in the request:
```json
{
  "blockchain": "arweave",
  /* other post data */
}
```

## Data Indexing and Retrieval

Published posts are automatically:
1. **Stored** on the specified blockchain
2. **Indexed** in Elasticsearch for fast retrieval
3. **Assigned** a unique DID (Decentralized Identifier)
4. **Associated** with creator information

### DID Format
Posts receive a DID in the format: `did:arweave:{transaction_id}`

## Template Mapping

The post data is internally mapped using the template defined in `remapTemplates/post.json`:

```json
{
  "Title": "basic.name",
  "Description": "basic.description", 
  "ByLine": "post.bylineWriter",
  "ByLineTitle": "post.bylineWritersTitle",
  "ByLineLocation": "post.bylineWritersLocation",
  "TextArweaveAddress": "text.arweaveAddress",
  "FeaturedImage": "post.featuredImage",
  "EmbeddedImages": "post.imageItems",
  "EmbeddedVideos": "post.videoItems",
  "PublishedOnUtcEpoch": "basic.date",
  "Tags": "basic.tagItems",
  "Language": "basic.language",
  "NSFW": "basic.nsfw",
  "ReplyTo": "basic.replyTo"
}
```

## Error Handling

### Common Error Scenarios
1. **Missing articleText**: Required field validation
2. **Invalid JWT Token**: 401 Unauthorized (when auth enabled)
3. **Network Issues**: 500 Internal Server Error
4. **Blockchain Publishing Failure**: Transaction submission errors

### Error Response Structure
```json
{
  "error": "string",
  "details": "string (optional)",
  "success": false
}
```

## Rate Limiting

Currently no rate limiting is implemented, but consider implementing rate limiting in production environments.

## Security Considerations

1. **Input Validation**: All text fields should be sanitized
2. **Content Moderation**: Consider implementing content filtering
3. **Authentication**: Will be required in future versions
4. **HTTPS**: Always use HTTPS in production
5. **Token Security**: Store JWT tokens securely

## Related Endpoints

- `GET /api/records` - Retrieve published records
- `POST /api/publish/newTemplate` - Create custom templates
- `POST /api/publish/newImage` - Publish image records
- `POST /api/publish/newVideo` - Publish video records

## Support and Troubleshooting

### Common Issues
1. **"Failed to publish post"**: Check network connectivity and blockchain status
2. **Missing required fields**: Ensure `basic.name` and `post.articleText` are provided
3. **Authentication errors**: Verify JWT token is valid and not expired

### Debugging
Enable debug logging by setting environment variables:
```bash
DEBUG=true node server.js
```

This will provide detailed logging of the publishing process. 