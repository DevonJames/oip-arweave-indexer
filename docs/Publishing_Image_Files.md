# Publishing Image Files in OIP (Open Index Protocol)

## Overview

The OIP system provides a sophisticated image publishing workflow that combines traditional OIP record structures with modern BitTorrent distribution and HTTP streaming. Image files can be published either as standalone image records or as part of the unified "Media File" publishing system that automatically detects file types and creates appropriate OIP records.

## Architecture Overview

### Two-Phase Publishing Process

Image publishing in OIP follows a two-phase process:

1. **Phase 1: File Upload & BitTorrent Creation** (`/api/media/upload`)
   - File storage and hash generation
   - BitTorrent torrent creation and seeding
   - File metadata extraction
   - Returns media ID and torrent information

2. **Phase 2: OIP Record Creation** (`/api/media/createRecord`)
   - Creates proper OIP record structure
   - Links file metadata to blockchain record
   - Applies access control and ownership
   - Indexes record in Elasticsearch

### Storage Systems

#### GUN Storage (Default for Media Files)
- **Privacy**: Private by default with HD wallet ownership
- **Distribution**: BitTorrent P2P distribution + HTTP streaming
- **Access Control**: User-owned with organization sharing support
- **Performance**: Immediate availability, optimized for media streaming

#### Arweave Storage (Alternative)
- **Privacy**: Public, permanent storage
- **Distribution**: IPFS + HTTP
- **Access Control**: Public by design
- **Performance**: Slower confirmation, permanent archive

## User Authentication & Ownership

### HD Wallet System
Images are owned by individual users through their HD wallet public keys:

- **Key Generation**: BIP-39 (12-word mnemonic) + BIP-32 (hierarchical derivation)
- **Ownership**: Records include `accessControl.owner_public_key` field
- **Privacy**: Only owners can access their private image records
- **Cross-Device**: Same wallet works across devices with mnemonic import

### JWT Authentication
```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

JWT payload includes:
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

## Publishing Workflow

### Frontend Implementation (reference-client.html)

#### 1. Media File Interface Creation

The `createMediaInterface()` function generates the publishing form:

```javascript
function createMediaInterface() {
    return `
        <div class="publish-form">
            <h3>📁 Media File Publishing</h3>
            
            <!-- File Upload -->
            <div class="form-group">
                <label for="media-file">Select Media File:</label>
                <input type="file" id="media-file" accept="image/*,video/*,audio/*" 
                       required onchange="updateMediaFilePreview()">
                <small>Supported: Images (JPG, PNG, GIF, WebP), Videos (MP4, WebM), Audio (MP3, WAV, FLAC)</small>
            </div>

            <!-- Auto-detected file type display -->
            <div id="detected-file-type" class="form-group hidden">
                <label>Detected Record Type:</label>
                <div id="detected-type-display"></div>
                <small id="detected-type-description"></small>
            </div>

            <!-- Media metadata fields -->
            <div class="form-group">
                <label for="media-name">Media Title:</label>
                <input type="text" id="media-name" placeholder="Descriptive title for the media file">
                <small>If empty, will use the original filename</small>
            </div>

            <!-- Access control and organization selection -->
            <div class="form-group">
                <label for="media-access-level">Access Level:</label>
                <select id="media-access-level" onchange="updateMediaAccessLevel()">
                    <option value="private">Private (Only you)</option>
                    <option value="organization" selected>Organization (Your team/org)</option>
                    <option value="public">Public (Everyone)</option>
                </select>
            </div>
            
            <!-- Additional metadata fields... -->
        </div>
    `;
}
```

#### 2. File Type Detection

The `updateMediaFilePreview()` function automatically detects file types:

```javascript
function updateMediaFilePreview() {
    const fileInput = document.getElementById('media-file');
    const file = fileInput.files[0];
    
    if (file) {
        const mimeType = file.type;
        let recordType = 'unknown';
        let description = '';
        
        if (mimeType.startsWith('image/')) {
            recordType = 'image';
            description = 'Will create an OIP image record with BitTorrent distribution';
        } else if (mimeType.startsWith('video/')) {
            recordType = 'video';
            description = 'Will create an OIP video record with BitTorrent distribution and streaming support';
        } else if (mimeType.startsWith('audio/')) {
            recordType = 'audio';
            description = 'Will create an OIP audio record with BitTorrent distribution and streaming support';
        }
        
        // Update UI with detected type
        document.getElementById('detected-type-display').textContent = `${recordType.toUpperCase()} Record`;
        document.getElementById('detected-type-description').textContent = description;
        
        // Auto-populate title if empty
        const nameInput = document.getElementById('media-name');
        if (!nameInput.value) {
            const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
            nameInput.value = nameWithoutExt;
        }
    }
}
```

#### 3. Image Dimension Extraction

For images, the client automatically extracts dimensions:

```javascript
async function getMediaDimensions(file, recordType) {
    return new Promise((resolve) => {
        if (recordType === 'image') {
            const img = new Image();
            img.onload = () => {
                resolve({ width: img.width, height: img.height });
            };
            img.onerror = () => {
                resolve({ width: 0, height: 0 });
            };
            img.src = URL.createObjectURL(file);
        } else if (recordType === 'video') {
            const video = document.createElement('video');
            video.onloadedmetadata = () => {
                resolve({ 
                    width: video.videoWidth, 
                    height: video.videoHeight,
                    duration: Math.floor(video.duration) || 0
                });
            };
            video.onerror = () => {
                resolve({ width: 0, height: 0, duration: 0 });
            };
            video.src = URL.createObjectURL(file);
        } else {
            resolve({ width: 0, height: 0, duration: 0 });
        }
    });
}
```

#### 4. Two-Phase Publishing Process

The `publishMedia()` function implements the complete workflow:

```javascript
async function publishMedia() {
    // Phase 1: Upload file and create BitTorrent
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', document.getElementById('media-name').value || file.name);
    formData.append('access_level', document.getElementById('media-access-level').value);
    
    const uploadResponse = await fetch('/api/media/upload', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${authToken}`
        },
        body: formData
    });

    const uploadResult = await uploadResponse.json();
    
    // Phase 2: Create OIP record
    const recordData = {
        mediaId: uploadResult.mediaId,
        recordType: recordType, // Auto-detected from MIME type
        basicInfo: {
            name: mediaTitle,
            description: mediaDescription,
            language: language,
            nsfw: nsfw,
            tagItems: tags
        },
        accessControl: {
            access_level: accessLevel,
            shared_with: selectedOrganizationDid
        },
        width: width,
        height: height,
        duration: duration
    };

    const recordResponse = await fetch('/api/media/createRecord', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(recordData)
    });
}
```

### Backend Implementation

#### 1. File Upload Endpoint (`POST /api/media/upload`)

Located in `routes/media.js`, this endpoint handles the initial file processing:

```javascript
router.post('/upload', authenticateToken, upload.single('file'), async (req, res) => {
    // Generate SHA256 hash as mediaId
    const fileBuffer = fs.readFileSync(tempFilePath);
    const mediaId = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    
    // Create directory structure
    const mediaIdDir = path.join(MEDIA_DIR, mediaId);
    const finalFilePath = path.join(mediaIdDir, 'original');
    fs.renameSync(tempFilePath, finalFilePath);
    
    // Start BitTorrent seeding
    const mediaSeeder = getMediaSeeder();
    const seedInfo = await mediaSeeder.seedFile(finalFilePath, mediaId);
    
    // Create file manifest
    const mediaManifest = {
        mediaId: mediaId,
        originalName: originalName,
        mimeType: mimeType,
        fileSize: fileSize,
        magnetURI: seedInfo.magnetURI,
        infoHash: seedInfo.infoHash,
        httpUrl: `${req.protocol}://${req.get('host')}/api/media/${mediaId}`,
        createdAt: new Date().toISOString(),
        userPublicKey: userPublicKey,
        accessLevel: accessLevel
    };
    
    // Save manifest for tracking
    fs.writeFileSync(manifestPath, JSON.stringify(mediaManifest, null, 2));
    
    // Return BitTorrent info for OIP record creation
    res.json({
        success: true,
        mediaId,
        magnetURI: seedInfo.magnetURI,
        infoHash: seedInfo.infoHash,
        httpUrl: `${req.protocol}://${req.get('host')}/api/media/${mediaId}`,
        size: fileSize,
        mime: mimeType,
        originalName: originalName,
        access_level: accessLevel,
        owner: userPublicKey
    });
});
```

#### 2. OIP Record Creation (`POST /api/media/createRecord`)

This endpoint creates the actual OIP record linking to the uploaded file:

```javascript
router.post('/createRecord', authenticateToken, async (req, res) => {
    const { mediaId, recordType, basicInfo, accessControl, width, height, duration } = req.body;
    
    // Verify ownership of media file
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const userPublicKey = req.user.publicKey || req.user.publisherPubKey;
    
    if (manifest.userPublicKey !== userPublicKey) {
        return res.status(403).json({ error: 'Access denied: not the owner of this media file' });
    }
    
    // Build OIP record structure
    const oipRecord = {
        basic: {
            name: basicInfo.name || manifest.originalName,
            description: basicInfo.description || `Image file: ${manifest.originalName}`,
            language: basicInfo.language || 'en',
            date: Math.floor(Date.now() / 1000),
            nsfw: basicInfo.nsfw || false,
            tagItems: basicInfo.tagItems || []
        },
        accessControl: {
            access_level: accessControl.access_level || 'private',
            owner_public_key: userPublicKey
        }
    };
    
    // Add image-specific fields
    if (recordType === 'image') {
        oipRecord.image = {
            bittorrentAddress: manifest.magnetURI,
            filename: manifest.originalName,
            width: width || 0,
            height: height || 0,
            size: manifest.fileSize,
            contentType: manifest.mimeType
        };
    }
    
    // Publish to GUN storage
    const result = await publishNewRecord(oipRecord, recordType, false, false, false, null, 'gun', false, {
        storage: 'gun',
        localId: `media_${mediaId}`,
        accessControl: oipRecord.accessControl
    });
    
    res.json({
        success: true,
        did: result.did,
        recordType: recordType,
        mediaId: mediaId,
        storage: 'gun',
        encrypted: result.encrypted
    });
});
```

## Image Record Structure

### Complete OIP Image Record

When an image file is uploaded, it creates a comprehensive OIP record:

```json
{
  "data": {
    "basic": {
      "name": "My Beautiful Landscape",
      "description": "A sunset photo taken in the mountains",
      "language": "en",
      "date": 1757789558,
      "nsfw": false,
      "tagItems": ["landscape", "sunset", "mountains", "photography"]
    },
    "image": {
      "bittorrentAddress": "magnet:?xt=urn:btih:abc123def456...",
      "filename": "landscape_sunset.jpg",
      "width": 1920,
      "height": 1080,
      "size": 2048576,
      "contentType": "image/jpeg"
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
    "didTx": "did:gun:media:a1b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789a",
    "recordType": "image",
    "storage": "gun",
    "indexedAt": "2025-09-13T18:52:38.413Z",
    "ver": "0.8.0",
    "creator": {
      "didAddress": "did:arweave:u4B6d5ddggsotOiG86D-KPkeW23qQNdqaXo_ZcdI3k0",
      "publicKey": "0349b2160ea3117a90a1fcbbf198ef53bf325b604157cbcf81693f0f476006c9e1"
    }
  }
}
```

### File Storage Structure

```
/data/media/
├── <mediaId>/
│   ├── original          # Original uploaded image file
│   └── manifest.json     # File metadata and BitTorrent info
└── seeder.json          # Global seeding state
```

### Media Manifest Structure

```json
{
  "mediaId": "a1b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789a",
  "originalName": "landscape_sunset.jpg",
  "mimeType": "image/jpeg",
  "fileSize": 2048576,
  "magnetURI": "magnet:?xt=urn:btih:abc123def456...",
  "infoHash": "abc123def456789abcdef0123456789abcdef01",
  "httpUrl": "https://api.oip.onl/api/media/a1b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789a",
  "createdAt": "2025-09-13T18:52:38.199Z",
  "userPublicKey": "0349b2160ea3117a90a1fcbbf198ef53bf325b604157cbcf81693f0f476006c9e1",
  "accessLevel": "private"
}
```

## API Endpoints

### 1. Upload Image File

**Endpoint**: `POST /api/media/upload`

**Headers**:
```http
Content-Type: multipart/form-data
Authorization: Bearer <jwt-token>
```

**Form Fields**:
```
file: <binary_image_file>           # Required: The image file
name: "My Image Title"              # Optional: Human-readable name
access_level: "private"             # Optional: "private" (default), "organization", or "public"
description: "Image description"     # Optional: Description text
```

**Response**:
```json
{
  "success": true,
  "mediaId": "a1b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789a",
  "magnetURI": "magnet:?xt=urn:btih:abc123def456...",
  "infoHash": "abc123def456789abcdef0123456789abcdef01",
  "httpUrl": "https://api.oip.onl/api/media/a1b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789a",
  "size": 2048576,
  "mime": "image/jpeg",
  "originalName": "landscape_sunset.jpg",
  "access_level": "private",
  "owner": "0349b2160ea3117a90a1fcbbf198ef53bf325b604157cbcf81693f0f476006c9e1",
  "message": "File uploaded and BitTorrent created. Use /api/records/newRecord to create proper OIP record."
}
```

### 2. Create OIP Image Record

**Endpoint**: `POST /api/media/createRecord`

**Headers**:
```http
Content-Type: application/json
Authorization: Bearer <jwt-token>
```

**Request Body**:
```json
{
  "mediaId": "a1b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789a",
  "recordType": "image",
  "basicInfo": {
    "name": "My Beautiful Landscape",
    "description": "A sunset photo taken in the mountains",
    "language": "en",
    "nsfw": false,
    "tagItems": ["landscape", "sunset", "mountains", "photography"]
  },
  "accessControl": {
    "access_level": "private",
    "shared_with": "did:arweave:organization_did"
  },
  "width": 1920,
  "height": 1080,
  "duration": 0
}
```

**Response**:
```json
{
  "success": true,
  "did": "did:gun:media:a1b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789a",
  "recordType": "image",
  "mediaId": "a1b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789a",
  "storage": "gun",
  "encrypted": true,
  "message": "Image record created successfully"
}
```

### 3. Stream Image File

**Endpoint**: `GET /api/media/:mediaId`

**Headers**:
```http
Authorization: Bearer <jwt-token>  # Required for private images
Range: bytes=0-1023                # Optional: For partial content
```

**Response**:
- **Content-Type**: `image/jpeg` (original MIME type)
- **Content-Length**: File size in bytes
- **Accept-Ranges**: bytes (supports range requests)
- **Content-Range**: bytes start-end/total (for range requests)

**Status Codes**:
- `200`: Full image served
- `206`: Partial content (range request)
- `401`: Authentication required
- `403`: Access denied (not the owner)
- `404`: Image file not found

### 4. Get Image Information

**Endpoint**: `GET /api/media/:mediaId/info`

**Headers**:
```http
Authorization: Bearer <jwt-token>
```

**Response**:
```json
{
  "basic": {
    "name": "My Beautiful Landscape",
    "description": "A sunset photo taken in the mountains",
    "date": 1757789558,
    "language": "en"
  },
  "image": {
    "bittorrentAddress": "magnet:?xt=urn:btih:abc123def456...",
    "filename": "landscape_sunset.jpg",
    "width": 1920,
    "height": 1080,
    "size": 2048576,
    "contentType": "image/jpeg"
  },
  "accessControl": {
    "access_level": "private",
    "owner_public_key": "0349b2160ea3117a90a1fcbbf198ef53bf325b604157cbcf81693f0f476006c9e1"
  },
  "seeding": true,
  "seedingInfo": {
    "mediaId": "a1b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789a",
    "infoHash": "abc123def456789abcdef0123456789abcdef01",
    "magnetURI": "magnet:?xt=urn:btih:abc123def456...",
    "filePath": "/usr/src/app/data/media/.../original",
    "createdAt": "2025-09-13T18:52:38.199Z",
    "fileSize": 2048576
  }
}
```

## Access Control Levels

### Private Access (Default)
- **Visibility**: Only the owner can access
- **Use Case**: Personal photos, private content
- **Organization**: Not shared with any organization
- **BitTorrent**: Still available via magnet URI (encrypted if enabled)

### Organization Access
- **Visibility**: Owner + organization members
- **Use Case**: Team photos, shared project images
- **Organization**: Must select an organization from dropdown
- **BitTorrent**: Available to organization members

### Public Access
- **Visibility**: Everyone can access
- **Use Case**: Public artwork, open content
- **Organization**: Not applicable
- **BitTorrent**: Publicly available

## Supported Image Formats

### Primary Formats
- **JPEG** (`image/jpeg`): Most common, good compression
- **PNG** (`image/png`): Lossless, supports transparency
- **GIF** (`image/gif`): Animated images, limited colors
- **WebP** (`image/webp`): Modern format, excellent compression

### Additional Formats
- **BMP** (`image/bmp`): Uncompressed bitmap
- **TIFF** (`image/tiff`): High-quality, large files
- **SVG** (`image/svg+xml`): Vector graphics (text-based)

### File Size Limits
- **Maximum**: 500MB per file (configurable)
- **Recommended**: Under 50MB for optimal performance
- **BitTorrent**: Better for larger files (P2P distribution)

## Integration Examples

### JavaScript Client Implementation

```javascript
class OIPImageClient {
    constructor(baseUrl = 'https://api.oip.onl', token) {
        this.baseUrl = baseUrl;
        this.token = token;
    }

    // Upload and publish image file
    async publishImage(imageFile, metadata = {}) {
        try {
            // Phase 1: Upload file
            const formData = new FormData();
            formData.append('file', imageFile);
            formData.append('name', metadata.name || imageFile.name);
            formData.append('access_level', metadata.access_level || 'private');
            
            if (metadata.description) {
                formData.append('description', metadata.description);
            }

            const uploadResponse = await fetch(`${this.baseUrl}/api/media/upload`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`
                },
                body: formData
            });

            const uploadResult = await uploadResponse.json();
            
            if (!uploadResponse.ok) {
                throw new Error(uploadResult.error || 'Upload failed');
            }

            // Extract image dimensions
            const dimensions = await this.getImageDimensions(imageFile);

            // Phase 2: Create OIP record
            const recordData = {
                mediaId: uploadResult.mediaId,
                recordType: 'image',
                basicInfo: {
                    name: metadata.name || imageFile.name,
                    description: metadata.description || `Image file: ${imageFile.name}`,
                    language: metadata.language || 'en',
                    nsfw: metadata.nsfw || false,
                    tagItems: metadata.tags || []
                },
                accessControl: {
                    access_level: metadata.access_level || 'private',
                    shared_with: metadata.organization_did || null
                },
                width: dimensions.width,
                height: dimensions.height,
                duration: 0
            };

            const recordResponse = await fetch(`${this.baseUrl}/api/media/createRecord`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify(recordData)
            });

            const recordResult = await recordResponse.json();
            
            if (!recordResponse.ok) {
                throw new Error(recordResult.error || 'Record creation failed');
            }

            return {
                success: true,
                did: recordResult.did,
                mediaId: uploadResult.mediaId,
                magnetURI: uploadResult.magnetURI,
                httpUrl: uploadResult.httpUrl,
                dimensions: dimensions,
                storage: 'gun',
                recordType: 'image'
            };

        } catch (error) {
            console.error('Image publishing failed:', error);
            throw error;
        }
    }

    // Extract image dimensions from file
    async getImageDimensions(file) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                resolve({ width: img.width, height: img.height });
                URL.revokeObjectURL(img.src);
            };
            img.onerror = () => {
                resolve({ width: 0, height: 0 });
                URL.revokeObjectURL(img.src);
            };
            img.src = URL.createObjectURL(file);
        });
    }

    // Retrieve user's image records
    async getUserImages(limit = 20) {
        try {
            const response = await fetch(
                `${this.baseUrl}/api/records?source=gun&recordType=image&limit=${limit}&sortBy=date:desc`,
                {
                    headers: {
                        'Authorization': `Bearer ${this.token}`
                    }
                }
            );

            const data = await response.json();
            return data.records || [];
        } catch (error) {
            console.error('Failed to retrieve images:', error);
            throw error;
        }
    }

    // Get image streaming URL
    getImageUrl(mediaId) {
        return `${this.baseUrl}/api/media/${mediaId}`;
    }

    // Get BitTorrent magnet URI from record
    getMagnetURI(imageRecord) {
        return imageRecord.data?.image?.bittorrentAddress;
    }
}
```

### Usage Example

```javascript
// Initialize client
const imageClient = new OIPImageClient('https://api.oip.onl', userJWTToken);

// Upload image from file input
const fileInput = document.getElementById('image-file');
const imageFile = fileInput.files[0];

const result = await imageClient.publishImage(imageFile, {
    name: 'Sunset Landscape',
    description: 'Beautiful sunset in the Rocky Mountains',
    tags: ['landscape', 'sunset', 'mountains', 'nature'],
    access_level: 'private',
    language: 'en',
    nsfw: false
});

console.log('Image published:', result.did);
console.log('Stream URL:', imageClient.getImageUrl(result.mediaId));
console.log('Magnet URI:', result.magnetURI);

// Display image in gallery
const img = document.createElement('img');
img.src = imageClient.getImageUrl(result.mediaId);
img.alt = result.basicInfo?.name || 'Image';
gallery.appendChild(img);

// Retrieve all user images
const userImages = await imageClient.getUserImages(50);
console.log(`User has ${userImages.length} images`);
```

### React Component Example

```jsx
import React, { useState, useCallback } from 'react';

const ImageUploader = ({ token, onImagePublished }) => {
    const [uploading, setUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [preview, setPreview] = useState(null);

    const handleFileSelect = useCallback((event) => {
        const file = event.target.files[0];
        if (file && file.type.startsWith('image/')) {
            const previewUrl = URL.createObjectURL(file);
            setPreview({ file, url: previewUrl });
        }
    }, []);

    const publishImage = useCallback(async () => {
        if (!preview?.file) return;

        setUploading(true);
        setProgress(0);

        try {
            const client = new OIPImageClient('https://api.oip.onl', token);
            
            setProgress(25);
            const result = await client.publishImage(preview.file, {
                name: document.getElementById('image-title').value,
                description: document.getElementById('image-description').value,
                tags: document.getElementById('image-tags').value.split(',').map(t => t.trim()),
                access_level: document.getElementById('access-level').value
            });
            
            setProgress(100);
            onImagePublished(result);
            
            // Reset form
            setPreview(null);
            setProgress(0);
            
        } catch (error) {
            console.error('Upload failed:', error);
            alert('Upload failed: ' + error.message);
        } finally {
            setUploading(false);
        }
    }, [preview, token, onImagePublished]);

    return (
        <div className="image-uploader">
            <div className="form-group">
                <label>Select Image:</label>
                <input 
                    type="file" 
                    accept="image/*" 
                    onChange={handleFileSelect}
                    disabled={uploading}
                />
            </div>

            {preview && (
                <div className="preview-section">
                    <img 
                        src={preview.url} 
                        alt="Preview" 
                        style={{ maxWidth: '100%', maxHeight: '200px' }}
                    />
                    
                    <div className="metadata-fields">
                        <input id="image-title" placeholder="Image title" />
                        <textarea id="image-description" placeholder="Description" />
                        <input id="image-tags" placeholder="tags, separated, by, commas" />
                        <select id="access-level">
                            <option value="private">Private</option>
                            <option value="organization">Organization</option>
                            <option value="public">Public</option>
                        </select>
                    </div>

                    {uploading && (
                        <div className="progress-bar">
                            <div 
                                className="progress-fill" 
                                style={{ width: `${progress}%` }}
                            />
                            <span>{progress}% Complete</span>
                        </div>
                    )}

                    <button 
                        onClick={publishImage} 
                        disabled={uploading}
                    >
                        {uploading ? 'Publishing...' : 'Publish Image'}
                    </button>
                </div>
            )}
        </div>
    );
};
```

## BitTorrent Distribution

### Automatic Torrent Creation
- **Hash Algorithm**: SHA256 for file content (becomes mediaId)
- **Piece Size**: Optimized based on file size
- **Trackers**: WebSocket trackers for browser compatibility
- **Seeding**: Server automatically seeds all uploaded files

### Magnet URI Structure
```
magnet:?xt=urn:btih:abc123def456789abcdef0123456789abcdef01
&dn=landscape_sunset.jpg
&tr=wss://tracker.openwebtorrent.com
&tr=wss://tracker.btorrent.xyz
```

### P2P Integration
- **WebTorrent**: Browser-compatible BitTorrent protocol
- **Persistent Seeding**: Server maintains seed for all files
- **Peer Discovery**: Automatic via tracker network
- **Bandwidth Efficiency**: Reduces server load through P2P distribution

## Image Retrieval and Display

### Search for Images

```javascript
// Get all user's private images
const privateImages = await fetch('/api/records?source=gun&recordType=image&limit=50&sortBy=date:desc', {
    headers: { 'Authorization': `Bearer ${token}` }
});

// Search images by tags
const landscapeImages = await fetch('/api/records?recordType=image&tags=landscape,nature&tagsMatchMode=OR&limit=20', {
    headers: { 'Authorization': `Bearer ${token}` }
});

// Search images by name
const searchResults = await fetch('/api/records?recordType=image&search=sunset mountains&searchMatchMode=AND&limit=10', {
    headers: { 'Authorization': `Bearer ${token}` }
});
```

### Display Images in Gallery

```javascript
// Create image gallery from records
function createImageGallery(imageRecords) {
    const gallery = document.getElementById('image-gallery');
    
    imageRecords.forEach(record => {
        const imageData = record.data;
        const mediaId = imageData.image?.bittorrentAddress?.match(/btih:([a-f0-9]+)/)?.[1] || 
                       imageData.media?.id;
        
        if (mediaId) {
            const imgElement = document.createElement('img');
            imgElement.src = `/api/media/${mediaId}`;
            imgElement.alt = imageData.basic?.name || 'Image';
            imgElement.title = imageData.basic?.description || '';
            imgElement.style.cssText = 'max-width: 200px; max-height: 200px; margin: 10px; border-radius: 8px; cursor: pointer;';
            
            // Add click handler for full-size view
            imgElement.onclick = () => openImageModal(imgElement.src, imgElement.alt);
            
            gallery.appendChild(imgElement);
        }
    });
}

// Modal for full-size image viewing
function openImageModal(src, title) {
    const modal = document.createElement('div');
    modal.className = 'image-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>${title}</h3>
                <button onclick="this.closest('.image-modal').remove()">×</button>
            </div>
            <img src="${src}" style="max-width: 90vw; max-height: 90vh;">
        </div>
    `;
    
    modal.onclick = (e) => {
        if (e.target === modal) modal.remove();
    };
    
    document.body.appendChild(modal);
}
```

## Security Considerations

### File Validation
- **MIME Type Checking**: Server validates file types
- **File Size Limits**: 500MB maximum (configurable)
- **Content Scanning**: Future: virus/malware scanning
- **Extension Validation**: Matches MIME type to prevent spoofing

### Access Control
- **Owner Verification**: Only file owner can create OIP records
- **Cross-User Privacy**: Users cannot access other users' private images
- **Organization Sharing**: Controlled via DID-based organization membership
- **Public Key Ownership**: Cryptographic proof of ownership

### Privacy Protection
- **Private by Default**: Images are private unless explicitly made public
- **Encrypted Storage**: Optional file encryption before BitTorrent distribution
- **Secure Streaming**: Authentication required for private image access
- **No Cross-Contamination**: Strict user isolation in GUN storage

## Performance Characteristics

### Upload Performance
- **File Processing**: ~1-3 seconds for hash generation and torrent creation
- **BitTorrent Setup**: ~2-5 seconds for tracker registration and seeding start
- **OIP Record Creation**: ~1-2 seconds for GUN storage and Elasticsearch indexing
- **Total Time**: ~5-10 seconds for complete image publishing workflow

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

## Future Enhancements

### Planned Features
- **Image Thumbnails**: Automatic thumbnail generation
- **Format Conversion**: WebP conversion for optimization
- **Batch Upload**: Multiple image upload support
- **Image Editing**: Basic editing tools (crop, resize, rotate)
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

## Conclusion

The OIP image publishing system provides a comprehensive solution for decentralized image storage and distribution. By combining HD wallet ownership, BitTorrent distribution, and HTTP streaming, it offers both privacy and performance while maintaining the benefits of blockchain-based record keeping.

The two-phase architecture separates file handling from record creation, enabling flexible workflows and robust error handling. The system's support for multiple access levels and organization sharing makes it suitable for both personal and collaborative use cases.

Through its integration with the broader OIP ecosystem, published images can be referenced by other records (via dref fields), creating rich, interconnected content structures while maintaining efficient storage and distribution.
