# Media Publishing with Proper OIP Records Implementation

## Overview

This implementation fixes the media publishing system to create proper OIP records (image/video/audio) instead of generic "media" records, while maintaining BitTorrent distribution and GUN storage.

## What Was Fixed

### 1. **Frontend Interface Improvements**
- **Automatic Record Type Detection**: File type automatically determines whether to create image, video, or audio records
- **Clearer Storage Options**: Updated "GUN (Private Draft)" to "GUN + BitTorrent (Private with P2P Distribution)"
- **Enhanced UI**: Added file type detection display and better form fields
- **Dimension Extraction**: Automatically extracts width/height for images and videos, duration for videos/audio

### 2. **Backend Architecture Changes**
- **Two-Step Process**: 
  1. `/api/media/upload` - Handles file storage and BitTorrent creation
  2. `/api/media/createRecord` - Creates proper OIP records with template compliance
- **Proper Template Fields**: Records now include `bittorrentAddress`, `width`, `height`, `size`, `contentType`, etc.
- **Simplified Manifests**: File manifests only track file metadata, not OIP record structure

### 3. **Record Structure Compliance**

#### Image Records
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
    "bittorrentAddress": "string",  // Magnet URI
    "filename": "string",
    "width": "uint64",
    "height": "uint64", 
    "size": "uint64",
    "contentType": "string"
  },
  "accessControl": {
    "access_level": "enum",
    "owner_public_key": "string",
    "shared_with": "string"  // Organization DID when access_level is "organization"
  }
}
```

#### Video Records
```json
{
  "basic": { /* same as image */ },
  "video": {
    "bittorrentAddress": "string",  // Magnet URI
    "filename": "string",
    "width": "uint64",
    "height": "uint64",
    "size": "uint64", 
    "duration": "uint64",           // seconds
    "contentType": "string",
    "thumbnails": "repeated string" // Future: dref to image records
  },
  "accessControl": {
    "access_level": "enum",
    "owner_public_key": "string", 
    "shared_with": "string"  // Organization DID when access_level is "organization"
  }
}
```

#### Audio Records
```json
{
  "basic": { /* same as image */ },
  "audio": {
    "bittorrentAddress": "string",  // Magnet URI
    "filename": "string",
    "size": "uint64",
    "duration": "uint64",           // seconds
    "contentType": "string"
  },
  "accessControl": {
    "access_level": "enum",
    "owner_public_key": "string",
    "shared_with": "string"  // Organization DID when access_level is "organization"
  }
}
```

## API Endpoints

### 1. File Upload (Step 1)
**Endpoint**: `POST /api/media/upload`

**Purpose**: Upload file, create BitTorrent, return file metadata

**Request**: Multipart form with file and metadata

**Response**:
```json
{
  "success": true,
  "mediaId": "sha256_hash",
  "magnetURI": "magnet:?xt=urn:btih:...",
  "httpUrl": "https://api.oip.onl/api/media/mediaId",
  "size": 1048576,
  "mime": "image/jpeg",
  "originalName": "photo.jpg"
}
```

### 2. OIP Record Creation (Step 2)
**Endpoint**: `POST /api/media/createRecord`

**Purpose**: Create proper OIP record (image/video/audio) from uploaded file

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
    "shared_with": "did:gun:orgHash:orgHandle"  // Organization DID (only when access_level is "organization")
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

## Integration Flow

### Frontend Process
1. **File Selection**: User selects media file
2. **Type Detection**: JavaScript detects file type and shows expected record type
3. **Access Level Selection**: User chooses private/organization/public
4. **Organization Selection**: If "organization" is selected, load and display available organizations
5. **Dimension Extraction**: Extract width/height/duration from file
6. **Upload**: Send file to `/api/media/upload`
7. **Record Creation**: Send metadata to `/api/media/createRecord` with organization DID in `shared_with`
8. **Success**: Display results with BitTorrent and OIP information

### Backend Process
1. **File Storage**: Store file with SHA256 hash as mediaId
2. **BitTorrent Creation**: Create torrent and start seeding
3. **Manifest Creation**: Save file metadata for access control
4. **OIP Record Publishing**: Create proper template-compliant record
5. **GUN Storage**: Store record in GUN with encryption if private
6. **Elasticsearch Indexing**: Index record for search and discovery

## Benefits

### ✅ **Proper OIP Compliance**
- Records follow established image/video/audio templates
- Include all required fields like `bittorrentAddress`, dimensions, etc.
- Compatible with existing OIP ecosystem

### ✅ **BitTorrent Distribution** 
- All media files automatically get BitTorrent distribution
- Peer-to-peer sharing reduces server bandwidth
- Magnet URIs enable decentralized access

### ✅ **Search and Discovery**
- Records properly indexed in Elasticsearch
- Searchable by record type (image/video/audio)
- Filterable by access level, tags, etc.

### ✅ **Access Control**
- HD wallet ownership verification
- Private/organization/public access levels
- Cross-user privacy protection

### ✅ **Streaming Support**
- HTTP range requests for video/audio streaming
- Compatible with HTML5 video/audio players
- Progressive download support

## Usage Examples

### Upload an Image
```javascript
// 1. Upload file
const formData = new FormData();
formData.append('file', imageFile);
formData.append('name', 'My Photo');
formData.append('access_level', 'private');

const uploadResponse = await fetch('/api/media/upload', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: formData
});

const uploadResult = await uploadResponse.json();

// 2. Create OIP record
const recordData = {
  mediaId: uploadResult.mediaId,
  recordType: 'image',
  basicInfo: {
    name: 'My Photo',
    description: 'A beautiful landscape photo',
    language: 'en',
    tagItems: ['landscape', 'nature']
  },
  accessControl: { access_level: 'private' },
  width: 1920,
  height: 1080
};

const recordResponse = await fetch('/api/media/createRecord', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify(recordData)
});
```

### Search for Media Records
```javascript
// Find all private images
const images = await fetch('/api/records?source=gun&recordType=image&limit=10', {
  headers: { 'Authorization': `Bearer ${token}` }
});

// Find all videos with BitTorrent
const videos = await fetch('/api/records?source=gun&recordType=video&limit=10', {
  headers: { 'Authorization': `Bearer ${token}` }
});
```

## Testing

Run the test script to verify the implementation:

```bash
# Set your JWT token (get from /api/user/login)
export TEST_JWT_TOKEN="your_jwt_token_here"

# Run the test
node test/test-media-oip-records.js
```

## Migration Notes

### Existing "media" Records
- Old generic "media" records will continue to work
- New uploads will create proper image/video/audio records
- Gradual migration as users upload new content

### Backward Compatibility
- All existing endpoints continue to work
- `/api/media/:mediaId` serving unchanged
- Search still works for old records

## Future Enhancements

### Thumbnail Generation
- Automatic thumbnail creation for videos
- Multiple resolution support
- Thumbnail records as dref references

### Metadata Extraction
- EXIF data for images
- Video codec information
- Audio track metadata

### Multi-Resolution Support
- Multiple quality versions
- Adaptive streaming
- Storage optimization

---

*Implementation completed: January 2025*  
*Compatible with OIP v0.8.0*
