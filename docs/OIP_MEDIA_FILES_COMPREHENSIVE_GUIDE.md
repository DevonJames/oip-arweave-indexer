# OIP Media Files Comprehensive Guide

## Overview

The OIP (Open Index Protocol) system provides a sophisticated multi-network media publishing and distribution platform that combines traditional HTTP serving with decentralized storage networks including BitTorrent, IPFS, Arweave, and WebTorrent. This guide covers the complete media file lifecycle from upload to retrieval across multiple distribution networks.

## Architecture

### Core Components

1. **Media Upload System** (`routes/media.js`)
   - Handles file uploads with SHA256 content addressing
   - Creates BitTorrent distributions automatically
   - Manages file manifests and access control

2. **MediaSeeder Service** (`services/mediaSeeder.js`)
   - Persistent BitTorrent seeding for P2P distribution
   - WebTorrent integration for browser compatibility
   - State management across server restarts

3. **MediaManager** (`helpers/media-manager.js`)
   - Multi-network publishing (Arweave, IPFS, ArFleet, BitTorrent)
   - YouTube video processing and thumbnail extraction
   - DID (Decentralized Identifier) generation

4. **Template Integration** (`helpers/templateHelper.js`)
   - OIP record creation with proper template compliance
   - Media field processing and validation
   - Multi-network address formatting

## Media File Lifecycle

### 1. Upload Process

#### File Upload Endpoint
**Endpoint**: `POST /api/media/upload`

**Purpose**: Upload media file, create BitTorrent, and return metadata for OIP record creation

**Request**:
```http
Content-Type: multipart/form-data
Authorization: Bearer <jwt-token>

Form Fields:
- file: <binary_file>           # Required: Media file
- name: "Media Title"           # Optional: Human-readable name
- access_level: "private"       # Optional: "private", "organization", "public"
- description: "Description"    # Optional: Description text
```

**Response**:
```json
{
  "success": true,
  "mediaId": "sha256_hash_of_file_content",
  "magnetURI": "magnet:?xt=urn:btih:...",
  "infoHash": "bittorrent_info_hash",
  "httpUrl": "https://api.oip.onl/api/media/mediaId",
  "size": 1048576,
  "mime": "image/jpeg",
  "originalName": "photo.jpg",
  "access_level": "private",
  "owner": "user_public_key",
  "message": "File uploaded and BitTorrent created. Use /api/records/newRecord to create proper OIP record."
}
```

#### File Processing Flow
1. **File Validation**: Check file size (500MB limit), MIME type
2. **Content Hashing**: Generate SHA256 hash as `mediaId` for deduplication
3. **Directory Structure**: Create `/data/media/<mediaId>/original`
4. **BitTorrent Creation**: Start seeding via MediaSeeder service
5. **Manifest Creation**: Save file metadata for access control
6. **Response**: Return file info for OIP record creation

### 2. Multi-Network Distribution

#### Network-Specific Upload Endpoints

**IPFS Upload**: `POST /api/media/ipfs-upload`
```json
{
  "mediaId": "sha256_hash"
}
```

**Web Server Setup**: `POST /api/media/web-setup`
```json
{
  "mediaId": "sha256_hash",
  "filename": "original_filename.jpg"
}
```

**Response**:
```json
{
  "success": true,
  "webUrl": "https://domain.com/media/project_name/filename.jpg",
  "filename": "original_filename.jpg",
  "message": "Web access setup successfully"
}
```

**Arweave Upload**: `POST /api/media/arweave-upload`
```json
{
  "mediaId": "sha256_hash"
}
```

#### Supported Networks

| Network | Purpose | Access Method | Persistence |
|---------|---------|---------------|-------------|
| **BitTorrent** | P2P Distribution | Magnet URI | Server-dependent |
| **HTTP API** | Direct Access | `/api/media/:mediaId` | Server-dependent |
| **Web Server** | Public HTTP | `/media/{COMPOSE_PROJECT_NAME}/filename` | Server-dependent |
| **IPFS** | Decentralized | `https://ipfs.io/ipfs/hash` | Network-dependent |
| **Arweave** | Permanent | `https://arweave.net/txid` | Blockchain permanent |

### 3. OIP Record Creation

#### Approach 1: Simplified Helper Method (BitTorrent Only)

**Endpoint**: `POST /api/media/createRecord`

**Purpose**: Automatically create OIP records with BitTorrent distribution

**Request**:
```json
{
  "mediaId": "sha256_hash",
  "recordType": "image|video|audio",
  "basicInfo": {
    "name": "Media Title",
    "description": "Description",
    "language": "en",
    "nsfw": false,
    "tagItems": ["tag1", "tag2"]
  },
  "accessControl": {
    "access_level": "private|organization|public",
    "shared_with": "organization_did"  // Optional: for organization access
  },
  "width": 1920,
  "height": 1080,
  "duration": 120
}
```

**Response**:
```json
{
  "success": true,
  "did": "did:gun:hash:media_sha256",
  "recordType": "image",
  "storage": "gun",
  "encrypted": false
}
```

#### Approach 2: Full Multi-Network Method

**Endpoint**: `POST /api/records/newRecord?recordType=image&storage=gun`

**Purpose**: Create complete OIP records with multi-network distribution

**Process**:
1. Upload file via `/api/media/upload`
2. Optional: Upload to IPFS via `/api/media/ipfs-upload`
3. Optional: Setup web access via `/api/media/web-setup`
4. Optional: Upload to Arweave via `/api/media/arweave-upload`
5. Build complete record JSON with all network addresses
6. Publish via `/api/records/newRecord`

**Record Structure**:
```json
{
  "basic": {
    "name": "Media Title",
    "description": "Description",
    "language": "en",
    "date": 1759094653,
    "nsfw": false,
    "tagItems": ["tag1", "tag2"],
    "webUrl": "https://domain.com/media/project/filename.jpg"
  },
  "image": {
    "webUrl": "https://domain.com/media/project/filename.jpg",
    "bittorrentAddress": "magnet:?xt=urn:btih:...",
    "ipfsAddress": "QmHash...",
    "arweaveAddress": "transaction_id",
    "filename": "original_filename.jpg",
    "size": 1048576,
    "contentType": "image/jpeg",
    "width": 1920,
    "height": 1080
  },
  "accessControl": {
    "access_level": "organization",
    "owner_public_key": "user_public_key",
    "created_by": "user_public_key",
    "shared_with": "organization_did"
  }
}
```

**Note**: The `webUrl` field is populated from the `/api/media/web-setup` endpoint, which creates the URL pattern `/media/{COMPOSE_PROJECT_NAME}/{filename}` based on the `COMPOSE_PROJECT_NAME` environment variable. This provides direct HTTP access to media files through the Express static middleware.

## Media Seeding Service

### MediaSeeder Architecture

The MediaSeeder service (`services/mediaSeeder.js`) provides persistent BitTorrent seeding for all uploaded media files.

#### Key Features
- **Persistent Seeding**: Continues seeding across server restarts
- **WebTorrent Integration**: Browser-compatible P2P protocol
- **State Management**: Tracks seeding status in `/data/media/seeder.json`
- **Deduplication**: Uses SHA256 content addressing

#### Configuration
```bash
# Environment Variables
MEDIA_DIR=/usr/src/app/data/media
WEBTORRENT_TRACKERS=wss://tracker.openwebtorrent.com,wss://tracker.btorrent.xyz
```

#### Service Methods
```javascript
// Initialize seeder
const mediaSeeder = getMediaSeeder();
await mediaSeeder.initialize();

// Seed a file
const seedInfo = await mediaSeeder.seedFile(filePath, mediaId);

// Get seeding statistics
const stats = mediaSeeder.getStats();
// Returns: { seedingCount, activeTorrents, totalUploaded, totalDownloaded, peers }
```

### BitTorrent Integration

#### WebTorrent Configuration
- **Version**: 1.9.7 (avoiding native compilation issues)
- **Trackers**: WebSocket-based for browser compatibility
- **Seeding**: Automatic for all uploaded files
- **Magnet URIs**: Standard format for peer discovery

#### Magnet URI Structure
```
magnet:?xt=urn:btih:info_hash&dn=filename&tr=wss://tracker.openwebtorrent.com&tr=wss://tracker.btorrent.xyz
```

## Media File Storage

### Directory Structure
```
/data/media/
├── <mediaId>/                          # SHA256 hash directory
│   ├── original                        # Original uploaded file
│   └── manifest.json                   # File metadata and access control
├── web/                                # Web server distribution
│   ├── <COMPOSE_PROJECT_NAME>/         # Project-specific folder (from .env)
│   │   ├── filename1.jpg
│   │   └── filename2.mp4
│   └── another-project/
│       └── files-here.png
├── temp/                               # Temporary upload directory
└── seeder.json                         # BitTorrent seeding state
```

### File Manifest Structure
```json
{
  "mediaId": "sha256_hash",
  "originalName": "filename.jpg",
  "mimeType": "image/jpeg",
  "fileSize": 1048576,
  "magnetURI": "magnet:?xt=urn:btih:...",
  "infoHash": "bittorrent_info_hash",
  "httpUrl": "https://api.oip.onl/api/media/mediaId",
  "createdAt": "2025-01-15T10:30:00Z",
  "userPublicKey": "user_public_key",
  "accessLevel": "private",
  "ipfsHash": "QmHash...",              // Added by IPFS upload
  "webUrl": "https://domain.com/media/project/filename.jpg",  // Added by web setup
  "arweaveTransactionId": "tx_id"       // Added by Arweave upload
}
```

### Web Server Distribution

The web server distribution system provides direct HTTP access to media files through a project-specific directory structure.

#### Directory Organization
Files are organized by `COMPOSE_PROJECT_NAME` environment variable:
```
/data/media/web/
├── oip-arweave-indexer/              # Default project name
│   ├── image1.jpg
│   ├── video1.mp4
│   └── audio1.mp3
├── fitnessally/                      # Custom project name
│   ├── workout-video.mp4
│   └── nutrition-guide.pdf
└── another-project/                  # Another deployment
    └── files-here.png
```

#### URL Generation
The system generates URLs dynamically based on environment configuration:

**Environment Variables**:
```bash
COMPOSE_PROJECT_NAME=my-project        # Project-specific folder name
NGROK_DOMAIN=abc123.ngrok.io          # Optional: Custom domain
```

**URL Examples**:
```
# Default (localhost:3005)
http://localhost:3005/media/oip-arweave-indexer/filename.jpg

# With custom project name
http://localhost:3005/media/fitnessally/workout-video.mp4

# With ngrok domain
https://abc123.ngrok.io/media/my-project/image.jpg

# With reverse proxy (production)
https://oip.fitnessally.io/media/fitnessally/image.jpg
```

#### Static File Serving
The Express server serves web media files using static middleware:

```javascript
// In index.js
app.use('/media', express.static(path.join(__dirname, 'data', 'media', 'web')));
```

This creates the URL pattern: `/media/{COMPOSE_PROJECT_NAME}/{filename}`

#### Web Setup Process
1. **File Copy**: Original file copied to `/data/media/web/{COMPOSE_PROJECT_NAME}/`
2. **URL Generation**: Dynamic URL based on request headers and environment
3. **Manifest Update**: `webUrl` added to file manifest
4. **Static Serving**: File accessible via `/media/{project}/{filename}`

#### Protocol Detection
The system handles various deployment scenarios:

```javascript
// Protocol detection (handles reverse proxy)
const ngrokDomain = process.env.NGROK_DOMAIN || req.get('x-forwarded-host') || req.get('host');
const protocol = req.get('x-forwarded-proto') || req.protocol || 'https';
const webUrl = `${protocol}://${ngrokDomain}/media/${composeProjectName}/${filename}`;
```

**Supported Scenarios**:
- **Local Development**: `http://localhost:3005/media/project/file.jpg`
- **Ngrok Tunnels**: `https://abc123.ngrok.io/media/project/file.jpg`
- **Reverse Proxy**: `https://domain.com/media/project/file.jpg`
- **Docker Containers**: Handles forwarded headers correctly

## Media Streaming and Access

### File Serving Endpoint
**Endpoint**: `GET /api/media/:mediaId`

**Features**:
- **Range Request Support**: HTTP 206 partial content for video streaming
- **Access Control**: Private files require authentication and ownership verification
- **MIME Type Detection**: Automatic content-type headers
- **Caching Headers**: Browser caching support

**Request Headers**:
```http
Authorization: Bearer <jwt-token>  # Required for private files
Range: bytes=0-1023                # Optional: For partial content
```

**Response Headers**:
```http
Content-Type: image/jpeg
Content-Length: 1048576
Accept-Ranges: bytes
Content-Range: bytes 0-1023/1048576  # For range requests
```

### Access Control Levels

#### Private Access
- **Visibility**: Only the owner can access
- **Authentication**: JWT token required
- **Ownership**: Verified via public key comparison
- **Use Case**: Personal photos, private content

#### Organization Access
- **Visibility**: Owner + organization members
- **Membership**: Domain-based or invite-based
- **Policy Support**: Auto-enroll app users, token-gated access
- **Use Case**: Team photos, shared project media

#### Public Access
- **Visibility**: Everyone can access
- **Authentication**: Not required
- **Use Case**: Public artwork, open content

## Multi-Network Media Manager

### MediaManager Class

The MediaManager (`helpers/media-manager.js`) handles complex multi-network publishing scenarios.

#### Supported Sources
- **URL**: Download from web URLs
- **File**: Local file paths
- **Base64**: Inline data
- **YouTube**: Video and thumbnail extraction

#### Network Publishing
```javascript
const mediaManager = require('./helpers/media-manager');

const result = await mediaManager.processMedia({
  source: 'url',
  data: 'https://example.com/video.mp4',
  contentType: 'video/mp4',
  publishTo: {
    arweave: true,
    ipfs: true,
    bittorrent: true,
    arfleet: false
  },
  blockchain: 'arweave'
});
```

#### YouTube Processing
```javascript
const youtubeResult = await mediaManager.processMedia({
  source: 'youtube',
  data: 'https://youtube.com/watch?v=videoId',
  publishTo: { arweave: true, ipfs: true }
});

// Returns: { video: videoAddresses, thumbnail: thumbnailAddresses }
```

### DID Format Specification

#### Network-Specific DID Formats
- **Arweave**: `did:arweave:{transaction_id}`
- **Irys**: `did:irys:{transaction_id}`
- **IPFS**: `did:ipfs:{cid}`
- **ArFleet**: `did:arfleet:{arfleet_id}`
- **BitTorrent**: `did:bittorrent:{info_hash}`

#### URL Mappings
- **Arweave**: `https://arweave.net/{id}`
- **Irys**: `https://gateway.irys.xyz/{id}`
- **IPFS**: `https://ipfs.io/ipfs/{cid}`
- **ArFleet**: `arfleet://{id}`
- **BitTorrent**: `magnet:?xt=urn:btih:{hash}`

## OIP Record Templates

### Image Records
```json
{
  "basic": {
    "name": "string",
    "description": "string",
    "language": "enum",
    "date": "long",
    "nsfw": "bool",
    "tagItems": "repeated string"
  },
  "image": {
    "bittorrentAddress": "string",    // Magnet URI
    "ipfsAddress": "string",          // IPFS hash
    "arweaveAddress": "string",       // Arweave transaction ID
    "webUrl": "string",               // Direct HTTP URL
    "filename": "string",
    "width": "uint64",
    "height": "uint64",
    "size": "uint64",
    "contentType": "string"
  },
  "accessControl": {
    "access_level": "enum",
    "owner_public_key": "string",
    "shared_with": "string"           // Organization DID
  }
}
```

### Video Records
```json
{
  "basic": { /* same as image */ },
  "video": {
    "bittorrentAddress": "string",
    "ipfsAddress": "string",
    "arweaveAddress": "string",
    "webUrl": "string",
    "filename": "string",
    "width": "uint64",
    "height": "uint64",
    "size": "uint64",
    "duration": "uint64",             // seconds
    "contentType": "string",
    "thumbnails": "repeated string"  // dref to image records
  },
  "accessControl": { /* same as image */ }
}
```

### Audio Records
```json
{
  "basic": { /* same as image */ },
  "audio": {
    "bittorrentAddress": "string",
    "ipfsAddress": "string",
    "arweaveAddress": "string",
    "webUrl": "string",
    "filename": "string",
    "size": "uint64",
    "duration": "uint64",             // seconds
    "contentType": "string"
  },
  "accessControl": { /* same as image */ }
}
```

## Client Integration Examples

### Client Deployment Options

OIP supports two primary client deployment patterns, each with different advantages:

| Deployment | Description | Best For |
|------------|-------------|----------|
| **Public Folder Applications** | Frontend served directly by OIP server | Same-origin benefits, simpler setup |
| **External Applications** | Standalone frontend connecting to OIP API | Independent deployments, multiple backends |

### Public Folder Applications

Applications placed in the OIP server's `public/` directory are served directly by the Express server, providing significant advantages for media-intensive applications.

#### How It Works

The OIP server serves static files from a configurable public directory:

```javascript
// In index.js - Static file serving configuration
if (process.env.CUSTOM_PUBLIC_PATH === 'true' && !isDocker) {
  // Non-Docker: Use parent directory's public folder
  publicPath = path.join(__dirname, '..', 'public');
} else {
  // Docker or default: Use local public folder
  publicPath = path.join(__dirname, 'public');
}
app.use(express.static(publicPath));
```

#### Benefits of Public Folder Deployment

| Benefit | Description |
|---------|-------------|
| **Same-Origin Requests** | No CORS configuration needed - all API calls are same-origin |
| **Relative Paths** | Use simple paths like `/api/media/upload` instead of full URLs |
| **Simplified Authentication** | Cookies and tokens work seamlessly without cross-origin complexity |
| **Single Deployment** | One `make standard` starts both backend and frontend |
| **Automatic Protocol Detection** | Media URLs automatically use the correct protocol (http/https) |
| **Shared Session** | JWT tokens stored in localStorage are automatically available |

#### Configuration

**Environment Variable** (`.env`):
```bash
# Use custom public path (for development outside Docker)
CUSTOM_PUBLIC_PATH=true

# Project name used for media web URLs
COMPOSE_PROJECT_NAME=fitnessally
```

**Directory Structure**:
```
project-root/
├── oip-arweave-indexer/           # OIP backend
│   ├── public/                    # Default public folder (Docker)
│   │   └── reference-client.html
│   └── data/media/web/
│       └── fitnessally/           # Media files for this project
│           ├── workout-video.mp4
│           └── recipe-image.jpg
└── public/                        # Custom public folder (CUSTOM_PUBLIC_PATH=true)
    └── my-app.html                # Your application
```

#### Public Folder Client Implementation

Applications in the public folder can use simplified relative paths:

```javascript
class OIPPublicFolderClient {
  constructor(token) {
    // No baseUrl needed - all requests are same-origin
    this.token = token;
  }

  async uploadMedia(file, metadata = {}) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', metadata.name || file.name);
    formData.append('access_level', metadata.access_level || 'private');

    // Step 1: Upload file using relative path
    const uploadResponse = await fetch('/api/media/upload', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.token}` },
      body: formData
    });

    const uploadResult = await uploadResponse.json();
    if (!uploadResult.success) throw new Error(uploadResult.error);

    return uploadResult;
  }

  async setupWebAccess(mediaId, filename) {
    // Step 2: Setup web server access using relative path
    const webResponse = await fetch('/api/media/web-setup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`
      },
      body: JSON.stringify({ mediaId, filename })
    });

    const webResult = await webResponse.json();
    if (!webResult.success) throw new Error(webResult.error);

    // Returns URL like: /media/fitnessally/filename.jpg
    // Automatically uses correct protocol based on request
    return webResult;
  }

  async uploadWithWebAccess(file, metadata = {}) {
    // Complete workflow with web server distribution
    const uploadResult = await this.uploadMedia(file, metadata);
    
    // Setup web access for direct HTTP serving
    const webResult = await this.setupWebAccess(
      uploadResult.mediaId, 
      uploadResult.originalName
    );

    return {
      ...uploadResult,
      webUrl: webResult.webUrl  // e.g., https://oip.fitnessally.io/media/fitnessally/photo.jpg
    };
  }

  // Display media using web URL (faster than API endpoint)
  displayMedia(webUrl) {
    // Web URLs serve directly from static middleware - no auth needed for public files
    // Pattern: /media/{COMPOSE_PROJECT_NAME}/{filename}
    const img = document.createElement('img');
    img.src = webUrl;
    return img;
  }
}

// Usage in public folder application
const token = localStorage.getItem('jwt_token');
const client = new OIPPublicFolderClient(token);

// Upload and get web-accessible URL
const result = await client.uploadWithWebAccess(fileInput.files[0], {
  name: 'Workout Photo',
  access_level: 'public'
});

console.log('Web URL:', result.webUrl);
// Output: https://oip.fitnessally.io/media/fitnessally/workout-photo.jpg
```

#### Real-World Example: reference-client.html

The `reference-client.html` in the public folder demonstrates this pattern:

```javascript
// From reference-client.html - Media upload with web setup
if (enableWeb) {
    const webResponse = await fetch('/api/media/web-setup', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ 
            mediaId: uploadResult.mediaId,
            filename: uploadResult.originalName
        })
    });
    
    const webResult = await webResponse.json();
    if (webResponse.ok) {
        webUrl = webResult.webUrl;
    }
}
```

#### When to Use Public Folder Deployment

**✅ Recommended For**:
- Single-application deployments
- Media-heavy applications (fitness apps, galleries, content management)
- Development and prototyping
- Applications that need tight integration with OIP features
- Projects where simplicity is valued over architectural separation

**❌ Consider External Deployment For**:
- Multi-backend architectures (app connects to multiple OIP nodes)
- Applications requiring independent scaling
- Microservice architectures
- When frontend and backend teams work independently
- CDN-hosted frontends

---

### External Client Applications

For applications hosted separately from the OIP server, use the full URL pattern with explicit CORS handling.

### JavaScript Client Implementation

#### Simple Upload (BitTorrent Only)
```javascript
class OIPMediaClient {
  constructor(baseUrl, token) {
    this.baseUrl = baseUrl;
    this.token = token;
  }

  async uploadMedia(file, metadata = {}) {
    // Step 1: Upload file
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', metadata.name || file.name);
    formData.append('access_level', metadata.access_level || 'private');

    const uploadResponse = await fetch(`${this.baseUrl}/api/media/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.token}` },
      body: formData
    });

    const uploadResult = await uploadResponse.json();

    // Step 2: Create OIP record
    const dimensions = await this.getMediaDimensions(file);
    
    const recordResponse = await fetch(`${this.baseUrl}/api/media/createRecord`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`
      },
      body: JSON.stringify({
        mediaId: uploadResult.mediaId,
        recordType: this.detectRecordType(file),
        basicInfo: {
          name: metadata.name || file.name,
          description: metadata.description || `Media file: ${file.name}`,
          language: metadata.language || 'en',
          tagItems: metadata.tags || []
        },
        accessControl: {
          access_level: metadata.access_level || 'private',
          shared_with: metadata.organization_did
        },
        width: dimensions.width,
        height: dimensions.height,
        duration: dimensions.duration
      })
    });

    return await recordResponse.json();
  }

  detectRecordType(file) {
    if (file.type.startsWith('image/')) return 'image';
    if (file.type.startsWith('video/')) return 'video';
    if (file.type.startsWith('audio/')) return 'audio';
    return 'media';
  }

  async getMediaDimensions(file) {
    return new Promise((resolve) => {
      if (file.type.startsWith('image/')) {
        const img = new Image();
        img.onload = () => {
          resolve({ width: img.width, height: img.height, duration: 0 });
          URL.revokeObjectURL(img.src);
        };
        img.src = URL.createObjectURL(file);
      } else if (file.type.startsWith('video/')) {
        const video = document.createElement('video');
        video.onloadedmetadata = () => {
          resolve({
            width: video.videoWidth,
            height: video.videoHeight,
            duration: Math.floor(video.duration) || 0
          });
          URL.revokeObjectURL(video.src);
        };
        video.src = URL.createObjectURL(file);
      } else {
        resolve({ width: 0, height: 0, duration: 0 });
      }
    });
  }
}
```

#### Multi-Network Upload
```javascript
class OIPMultiNetworkClient extends OIPMediaClient {
  async uploadWithMultiNetwork(file, options = {}) {
    // Step 1: Upload file
    const uploadResult = await this.uploadFile(file, options);
    
    // Step 2: Optional network uploads
    let ipfsAddress = '';
    let webUrl = '';
    let arweaveAddress = '';

    if (options.enableIPFS) {
      const ipfsResult = await this.uploadToIPFS(uploadResult.mediaId);
      ipfsAddress = ipfsResult.ipfsHash;
    }

    if (options.enableWeb) {
      const webResult = await this.setupWebAccess(uploadResult.mediaId, uploadResult.originalName);
      webUrl = webResult.webUrl;
    }

    if (options.enableArweave) {
      const arweaveResult = await this.uploadToArweave(uploadResult.mediaId);
      arweaveAddress = arweaveResult.transactionId;
    }

    // Step 3: Build complete record
    const dimensions = await this.getMediaDimensions(file);
    const recordData = {
      basic: {
        name: options.name || file.name,
        description: options.description || `Media file: ${file.name}`,
        language: options.language || 'en',
        date: Math.floor(Date.now() / 1000),
        nsfw: options.nsfw || false,
        tagItems: options.tags || [],
        webUrl: webUrl || uploadResult.httpUrl  // Prefer web URL from /api/media/web-setup
      },
      [this.detectRecordType(file)]: {
        webUrl: webUrl || uploadResult.httpUrl,  // Prefer web URL from /api/media/web-setup
        bittorrentAddress: uploadResult.magnetURI,
        ipfsAddress: ipfsAddress,
        arweaveAddress: arweaveAddress,
        filename: uploadResult.originalName,
        size: uploadResult.size,
        contentType: uploadResult.mime,
        width: dimensions.width,
        height: dimensions.height,
        duration: dimensions.duration
      },
      accessControl: {
        access_level: options.access_level || 'private',
        owner_public_key: this.getUserPublicKey(),
        created_by: this.getUserPublicKey(),
        shared_with: options.organization_did
      }
    };

    // Step 4: Publish complete record
    const recordResponse = await fetch(
      `${this.baseUrl}/api/records/newRecord?recordType=${this.detectRecordType(file)}&storage=gun`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify(recordData)
      }
    );

    return await recordResponse.json();
  }
}
```

## Performance and Optimization

### Upload Performance
- **File Processing**: ~1-3 seconds for hash generation and torrent creation
- **BitTorrent Setup**: ~2-5 seconds for tracker registration and seeding
- **OIP Record Creation**: ~1-2 seconds for GUN storage and Elasticsearch indexing
- **Total Time**: ~5-10 seconds for complete publishing workflow

### Streaming Performance
- **HTTP Serving**: Direct file serving with range request support
- **P2P Distribution**: Reduces server bandwidth through peer sharing
- **Caching**: Browser caching enabled for repeated access
- **Optimization**: Automatic MIME type detection and appropriate headers

### Storage Efficiency
- **Deduplication**: Identical files share the same mediaId (SHA256 hash)
- **Compression**: No additional compression (preserves original quality)
- **Directory Structure**: Organized by mediaId for efficient lookup
- **Metadata Separation**: File manifest separate from OIP record

## Security Considerations

### File Validation
- **MIME Type Checking**: Server validates file types
- **File Size Limits**: 500MB maximum (configurable)
- **Content Scanning**: Future: virus/malware scanning
- **Extension Validation**: Matches MIME type to prevent spoofing

### Access Control
- **Owner Verification**: Only file owner can create OIP records
- **Cross-User Privacy**: Users cannot access other users' private files
- **Organization Sharing**: Controlled via DID-based organization membership
- **Public Key Ownership**: Cryptographic proof of ownership

### Privacy Protection
- **Private by Default**: Files are private unless explicitly made public
- **Encrypted Storage**: Optional file encryption before BitTorrent distribution
- **Secure Streaming**: Authentication required for private file access
- **No Cross-Contamination**: Strict user isolation in GUN storage

## Error Handling

### Common Upload Errors

#### File Too Large
```json
{
  "error": "File too large",
  "details": "Maximum file size is 500MB",
  "status": 413
}
```

#### Unsupported Format
```json
{
  "error": "Unsupported file type",
  "details": "Only image, video, and audio files are supported",
  "status": 400
}
```

#### Authentication Required
```json
{
  "error": "Authentication required",
  "details": "JWT token required for media upload",
  "status": 401
}
```

#### BitTorrent Creation Failed
```json
{
  "error": "Failed to create torrent",
  "details": "WebTorrent initialization failed",
  "status": 500
}
```

### Error Recovery Strategies
1. **Retry Logic**: Implement exponential backoff for network failures
2. **Progress Tracking**: Show upload progress to users
3. **Partial Uploads**: Resume interrupted uploads (future enhancement)
4. **Fallback Storage**: Alternative storage if BitTorrent fails
5. **User Feedback**: Clear error messages with actionable guidance

## Testing and Validation

### Unit Tests
```bash
# Test media upload functionality
npm test -- --grep "media upload"

# Test BitTorrent seeding
npm test -- --grep "media seeder"

# Test multi-network publishing
npm test -- --grep "media manager"
```

### Integration Tests
```bash
# Test complete upload workflow
node test/test-media-upload-workflow.js

# Test multi-network distribution
node test/test-multi-network-media.js

# Test access control
node test/test-media-access-control.js
```

### Manual Testing
```bash
# Upload test file
curl -X POST http://localhost:3000/api/media/upload \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -F "file=@test-image.jpg" \
  -F "name=Test Image" \
  -F "access_level=private"

# Create OIP record
curl -X POST http://localhost:3000/api/media/createRecord \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mediaId": "sha256_hash",
    "recordType": "image",
    "basicInfo": {"name": "Test Image"},
    "accessControl": {"access_level": "private"},
    "width": 1920,
    "height": 1080
  }'
```

## Future Enhancements

### Planned Features
- **Image Thumbnails**: Automatic thumbnail generation for videos
- **Format Conversion**: WebP conversion for optimization
- **Batch Upload**: Multiple file upload support
- **Media Editing**: Basic editing tools (crop, resize, rotate)
- **Metadata Extraction**: EXIF data extraction and preservation
- **Facial Recognition**: Optional face detection and tagging
- **Content Moderation**: Automatic NSFW detection
- **Backup Storage**: Redundant storage across multiple backends

### Advanced Integration
- **CDN Support**: Integration with content delivery networks
- **Progressive Loading**: Progressive JPEG support
- **Responsive Images**: Multiple resolution variants
- **Image Optimization**: Automatic compression and format selection
- **AI Enhancement**: Image upscaling and quality improvement
- **Blockchain Anchoring**: Optional Arweave archival for permanent storage

## Configuration

### Environment Variables
```bash
# Media storage
MEDIA_DIR=/usr/src/app/data/media

# Web server distribution
COMPOSE_PROJECT_NAME=my-project        # Project-specific folder for web media
NGROK_DOMAIN=abc123.ngrok.io          # Optional: Custom domain for web URLs

# Public folder configuration (for custom frontend locations)
CUSTOM_PUBLIC_PATH=true               # Enable custom public folder location
# When true (non-Docker): serves from ../public (parent directory)
# When false/unset: serves from ./public (local directory)

# BitTorrent configuration
WEBTORRENT_TRACKERS=wss://tracker.openwebtorrent.com,wss://tracker.btorrent.xyz

# Network configurations
IPFS_HOST=localhost
IPFS_PORT=5001
ARFLEET_CLIENT_PATH=./arfleet

# Arweave configuration
WALLET_FILE=path/to/arweave-wallet.json
TURBO_URL=https://turbo.ardrive.io

# Web server configuration
COMPOSE_PROJECT_NAME=oip-arweave-indexer
NGROK_DOMAIN=your-domain.ngrok.io
```

### Public Folder Path Configuration

The OIP server determines the public folder location based on `CUSTOM_PUBLIC_PATH`:

| CUSTOM_PUBLIC_PATH | Environment | Public Path |
|--------------------|-------------|-------------|
| `false` or unset | Any | `./public` (inside oip-arweave-indexer) |
| `true` | Docker | `./public` (Docker handles symlinks) |
| `true` | Non-Docker | `../public` (sibling to oip-arweave-indexer) |

**Example Project Structures**:

```bash
# Standard (CUSTOM_PUBLIC_PATH=false)
oip-arweave-indexer/
├── public/              # ← Static files served from here
│   └── my-app.html
└── data/media/web/
    └── project-name/

# Custom path (CUSTOM_PUBLIC_PATH=true, non-Docker)
my-project/
├── oip-arweave-indexer/
│   └── data/media/web/
│       └── fitnessally/
└── public/              # ← Static files served from here
    └── my-app.html
```

This flexibility allows you to:
- Keep your frontend code separate from the OIP codebase
- Share a public folder between multiple OIP instances
- Organize project files according to your team's preferences

### Dependencies
```json
{
  "dependencies": {
    "webtorrent": "^1.9.7",
    "ipfs-http-client": "^60.0.1",
    "@ardrive/turbo-sdk": "^1.0.0",
    "multer": "^1.4.5-lts.1",
    "form-data": "^4.0.0"
  }
}
```

## Troubleshooting

### Common Issues

#### MediaSeeder Won't Start
1. **Check WebTorrent Version**: Ensure version 1.9.7, not 2.x
2. **Verify Directory Permissions**: Ensure write access to media directory
3. **Test Manual Initialization**: Run MediaSeeder initialization manually

#### Files Not Seeding
1. **Check Seeding State**: Verify `/data/media/seeder.json` exists
2. **Verify File Exists**: Check that original files are in place
3. **Test Tracker Connectivity**: Ensure tracker URLs are accessible

#### No Peers Connecting
1. **Verify Tracker URLs**: Test with alternative public trackers
2. **Check Firewall Settings**: WebSocket connections should be allowed
3. **Monitor Logs**: Look for tracker connection errors

### Debug Mode
```bash
# Enable verbose logging
DEBUG=media-seeder,media-manager npm start

# Check MediaSeeder status
curl http://localhost:3000/api/health/media-seeder

# View seeding statistics
curl http://localhost:3000/api/health/media-seeder/stats
```

## Conclusion

The OIP media file system provides a comprehensive solution for decentralized media publishing and distribution. By combining traditional HTTP serving with BitTorrent P2P distribution, IPFS decentralized storage, and Arweave permanent storage, it offers multiple redundancy layers while maintaining performance and accessibility.

The system's modular architecture allows for flexible deployment scenarios, from simple BitTorrent-only setups to full multi-network distributions, making it suitable for a wide range of applications from personal media sharing to enterprise content management.

---

*Last updated: January 2025*  
*Version: 1.1.0*  
*Compatible with OIP v0.8.0 and v0.9.0*
