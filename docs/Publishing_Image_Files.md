# Publishing Image Files in OIP (Open Index Protocol)

## Overview

The OIP system provides a sophisticated image publishing workflow that combines traditional OIP record structures with modern BitTorrent distribution and HTTP streaming. Image files can be published using either a **simplified helper method** or a **full-control multi-network method** that enables distribution across BitTorrent, IPFS, Web servers, and Arweave.

## Quick Start Guide

### What You Need to Know

1. **Two Approaches Available**:
   - **Simple** (2 steps): Upload → CreateRecord (BitTorrent only)
   - **Full Control** (5+ steps): Upload → IPFS → Web → Arweave → Build JSON → Publish (multi-network)

2. **Critical Understanding**:
   - `/api/media/upload` **ONLY creates BitTorrent**, not IPFS/Web/Arweave
   - Multi-network distribution requires **separate sequential API calls**
   - You must **manually build the record JSON** for Approach 2
   - Final publish uses `/api/records/newRecord?recordType=image&storage=gun`, NOT `/api/media/createRecord`

3. **What You Get Back**:
   - After upload: `mediaId`, `magnetURI`, `httpUrl`
   - After IPFS: `ipfsHash`
   - After Web: `webUrl`
   - After Arweave: `transactionId`
   - After publishing: `did` (the record's DID identifier)

4. **Record JSON Structure** (for Approach 2):
   ```json
   {
     "basic": { "name": "...", "webUrl": "from-web-setup" },
     "image": {
       "webUrl": "from-web-setup",
       "bittorrentAddress": "from-upload",
       "ipfsAddress": "from-ipfs OR empty-string",
       "arweaveAddress": "from-arweave OR empty-string",
       "filename": "...", "size": 123, "contentType": "image/jpeg",
       "width": 1920, "height": 1080
     },
     "accessControl": {
       "access_level": "private|organization|public",
       "owner_public_key": "from-your-jwt",
       "shared_with": "org-did-if-organization-level"
     }
   }
   ```

## Architecture Overview

### Two Publishing Approaches

OIP provides two distinct methods for publishing image files:

#### **Approach 1: Simplified Helper Method** (BitTorrent Only)
Best for: Quick publishing with automatic BitTorrent distribution

1. **Step 1**: Upload file → `POST /api/media/upload` (creates BitTorrent)
2. **Step 2**: Create record → `POST /api/media/createRecord` (formats and publishes to GUN)

**Advantages**: Simple two-step process, automatic record formatting
**Limitation**: Only includes BitTorrent address in the record

#### **Approach 2: Full-Control Multi-Network Method** (Complete Control)
Best for: Applications needing multi-network distribution and custom record structure

1. **Step 1**: Upload file → `POST /api/media/upload` (creates BitTorrent, returns mediaId)
2. **Step 2a** (Optional): Upload to IPFS → `POST /api/media/ipfs-upload`
3. **Step 2b** (Optional): Setup web access → `POST /api/media/web-setup`
4. **Step 2c** (Optional): Upload to Arweave → `POST /api/media/arweave-upload`
5. **Step 3**: Build complete record JSON with all network addresses
6. **Step 4**: Publish record → `POST /api/records/newRecord?recordType=image&storage=gun`

**Advantages**: Full control over record structure, multi-network distribution, custom metadata
**Use Case**: This is what `reference-client.html` implements for maximum flexibility

### Multi-Network Distribution Process

**Important**: The `/api/media/upload` endpoint **only handles file storage and BitTorrent creation**. Additional networks (IPFS, Web, Arweave) require **separate sequential API calls** after the initial upload completes

### Multi-Network Storage Architecture

#### Primary Storage: GUN + BitTorrent (Always Enabled)
- **Privacy**: Private by default with HD wallet ownership
- **Distribution**: BitTorrent P2P distribution with automatic seeding
- **Access Control**: User-owned with organization sharing support
- **Performance**: Immediate availability, optimized for media streaming
- **Reliability**: Server maintains persistent seeding for all files

#### Web Server Distribution (Configurable)
- **URL Generation**: Dynamic URLs based on request domain (e.g., `https://oip.fitnessally.io/media/fitnessally/filename.jpg`)
- **Folder Organization**: Files organized by domain-specific folders for multi-tenant support
- **Range Requests**: Full HTTP range request support for streaming
- **Authentication**: Respects access control for private files
- **Performance**: Direct HTTP serving with browser caching

#### IPFS Distribution (Optional)
- **Decentralization**: Content-addressed storage on IPFS network
- **Global Access**: Available via any IPFS gateway
- **Redundancy**: Distributed across IPFS peer network
- **Integration**: Automatic pinning and hash generation

#### Arweave Storage (Optional)
- **Permanence**: Immutable, permanent blockchain storage
- **Public Access**: Globally accessible via Arweave gateways
- **Cost**: Requires AR tokens for storage fees
- **Archival**: Best for long-term preservation

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
                <small>Controls who can access this media file</small>
            </div>

            <!-- Organization Selection (shown when Organization access level is selected) -->
            <div id="media-organization-selection" class="form-group" style="background: #f0f4ff; padding: 15px; border-radius: 8px; border: 1px solid #c7d2fe;">
                <label for="media-organization">Select Organization:</label>
                <select id="media-organization" required>
                    <option value="">Loading organizations...</option>
                </select>
                <small>Choose which organization this media belongs to</small>
            </div>

            <!-- Multi-Network Storage Options -->
            <div class="form-group" style="background: #e8f5e8; padding: 15px; border-radius: 8px; border: 1px solid #4caf50;">
                <h4 style="margin: 0 0 15px 0; color: #2e7d32;">🌐 Multi-Network Storage</h4>
                <div style="margin-bottom: 10px;">
                    <label>
                        <input type="checkbox" id="media-enable-ipfs" checked> Store on IPFS
                    </label>
                    <small style="display: block; color: #555; margin-top: 2px;">Enable IPFS storage for decentralized distribution</small>
                </div>
                <div style="margin-bottom: 10px;">
                    <label>
                        <input type="checkbox" id="media-enable-web" checked> Store on Web Server
                    </label>
                    <small style="display: block; color: #555; margin-top: 2px;">Enable direct HTTP access via web server</small>
                </div>
                <div>
                    <label>
                        <input type="checkbox" id="media-enable-arweave"> Store on Arweave
                    </label>
                    <small style="display: block; color: #555; margin-top: 2px;">Enable permanent storage on Arweave blockchain (costs AR tokens)</small>
                </div>
                <small style="display: block; margin-top: 10px; color: #666; font-style: italic;">
                    BitTorrent is always enabled. Multiple storage options provide redundancy and different access methods.
                </small>
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

#### 4. Complete Multi-Network Publishing Workflow

The `publishMedia()` function in `reference-client.html` (lines 16374-16713) implements the complete multi-network workflow:

```javascript
async function publishMedia() {
    // Step 1: Upload file (creates BitTorrent automatically)
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', document.getElementById('media-name').value || file.name);
    formData.append('access_level', document.getElementById('media-access-level').value);

    const uploadResponse = await fetch('/api/media/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` },
        body: formData
    });

    const uploadResult = await uploadResponse.json();
    // uploadResult contains: mediaId, magnetURI, httpUrl, size, mime, originalName
    
    // Step 2: Optional network uploads (separate calls)
    let ipfsAddress = '';
    let webUrl = '';
    let arweaveAddress = '';

    // Step 2a: IPFS (optional)
    if (enableIPFS) {
        const ipfsResponse = await fetch('/api/media/ipfs-upload', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ mediaId: uploadResult.mediaId })
        });
        const ipfsResult = await ipfsResponse.json();
        ipfsAddress = ipfsResult.ipfsHash; // Store for record JSON
    }

    // Step 2b: Web server setup (optional)
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
        webUrl = webResult.webUrl; // Store for record JSON
    }

    // Step 2c: Arweave upload (optional)
    if (enableArweave) {
        const arweaveResponse = await fetch('/api/media/arweave-upload', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ mediaId: uploadResult.mediaId })
        });
        const arweaveResult = await arweaveResponse.json();
        arweaveAddress = arweaveResult.transactionId; // Store for record JSON
    }
    
    // Step 3: Extract image dimensions
    const dimensions = await getMediaDimensions(file, recordType);
    
    // Step 4: Manually build complete OIP record JSON
    const recordData = {
        basic: {
            name: mediaTitle,
            description: mediaDescription,
            language: language,
            date: Math.floor(Date.now() / 1000),
            nsfw: nsfw,
            tagItems: tags,
            webUrl: webUrl || uploadResult.httpUrl
        },
        image: {  // or 'video' or 'audio' based on recordType
            webUrl: webUrl || uploadResult.httpUrl,
            bittorrentAddress: uploadResult.magnetURI,
            ipfsAddress: ipfsAddress,          // From Step 2a (or empty string)
            arweaveAddress: arweaveAddress,    // From Step 2c (or empty string)
            filename: uploadResult.originalName,
            size: uploadResult.size,
            contentType: uploadResult.mime,
            width: dimensions.width,
            height: dimensions.height
        },
        accessControl: {
            access_level: accessLevel,
            owner_public_key: getUserPublicKeyFromJWT(),
            created_by: getUserPublicKeyFromJWT(),
            shared_with: selectedOrganizationDid  // Optional: for organization access
        }
    };

    // Step 5: Publish complete record to GUN
    const recordResponse = await fetch('/api/records/newRecord?recordType=image&storage=gun', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(recordData)
    });

    const recordResult = await recordResponse.json();
    // recordResult contains: success, did, storage, encrypted, message
}
```

**Key Point**: You must populate network addresses from **separate API responses** and build the complete JSON structure yourself. The backend does NOT automatically combine them.

### Backend Implementation

#### 1. Media Upload Endpoint (`POST /api/media/upload`)

**Important**: Located in `routes/media.js` lines 62-171, this endpoint **ONLY handles file storage and BitTorrent creation**. It does NOT process IPFS/Web/Arweave uploads.

```javascript
router.post('/upload', authenticateToken, upload.single('file'), async (req, res) => {
    // Generate SHA256 hash as mediaId for deduplication
    const fileBuffer = fs.readFileSync(tempFilePath);
    const mediaId = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    
    // Create secure directory structure
    const mediaIdDir = path.join(MEDIA_DIR, mediaId);
    const finalFilePath = path.join(mediaIdDir, 'original');
    fs.renameSync(tempFilePath, finalFilePath);
    
    // Get file metadata
    const mimeType = req.file.mimetype || 'application/octet-stream';
    
    // Create BitTorrent torrent and start seeding (ALWAYS happens)
    const mediaSeeder = getMediaSeeder();
    const seedInfo = await mediaSeeder.seedFile(finalFilePath, mediaId);
    console.log('🌱 Seeding started:', seedInfo.magnetURI);
    
    // Prepare access control
    const accessLevel = req.body.access_level || 'private';
    const userPublicKey = req.user.publicKey || req.user.publisherPubKey;
    
    // Create basic manifest for file tracking
    const mediaManifest = {
        mediaId: mediaId,
        originalName: originalName,
        mimeType: mimeType,
        fileSize: fileSize,
        magnetURI: seedInfo.magnetURI,
        infoHash: seedInfo.infoHash,
        httpUrl: getMediaFileUrl(mediaId, req),
        createdAt: new Date().toISOString(),
        userPublicKey: userPublicKey,
        accessLevel: accessLevel
    };
    
    // Save manifest to disk
    const manifestPath = path.join(mediaIdDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(mediaManifest, null, 2));
    
    // Return response with BitTorrent info ONLY
    res.json({
        success: true,
        mediaId,
        magnetURI: seedInfo.magnetURI,
        infoHash: seedInfo.infoHash,
        httpUrl: getMediaFileUrl(mediaId, req),
        size: fileSize,
        mime: mimeType,
        originalName: originalName,
        access_level: accessLevel,
        owner: userPublicKey,
        message: 'File uploaded and BitTorrent created. Use /api/records/newRecord to create proper OIP record.'
    });
});
```

**Note**: The response does **NOT** include `ipfsAddress`, `webUrl`, or `arweaveAddress`. Those require separate API calls.

#### 2. Helper Endpoint for Simple Record Creation (`POST /api/media/createRecord`)

**Purpose**: Automatically formats and publishes OIP records using data from the manifest. Located in `routes/media.js` lines 323-457.

**What it does**:
- Loads the file manifest (created in Step 1)
- Verifies ownership
- Builds OIP record structure with `bittorrentAddress` from manifest
- Publishes to GUN using `publishNewRecord()`
- **Only includes network addresses that exist in the manifest**

```javascript
router.post('/createRecord', authenticateToken, async (req, res) => {
    const { mediaId, recordType, basicInfo, accessControl, width, height, duration } = req.body;
    
    // Load file manifest
    const manifestPath = path.join(MEDIA_DIR, mediaId, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    
    // Verify ownership
    const userPublicKey = req.user.publicKey || req.user.publisherPubKey;
    if (manifest.userPublicKey !== userPublicKey) {
        return res.status(403).json({ error: 'Access denied: not the owner of this media file' });
    }
    
    // Build OIP record structure (automatically formatted)
    const oipRecord = {
        basic: {
            name: basicInfo.name || manifest.originalName,
            description: basicInfo.description || `${recordType} file: ${manifest.originalName}`,
            language: basicInfo.language || 'en',
            date: Math.floor(Date.now() / 1000),
            nsfw: basicInfo.nsfw || false,
            tagItems: basicInfo.tagItems || []
        },
        accessControl: {
            access_level: accessControl.access_level || manifest.accessLevel || 'private',
            owner_public_key: userPublicKey
        }
    };
    
    // Add organization sharing if specified
    if (accessControl.access_level === 'organization' && accessControl.shared_with) {
        oipRecord.accessControl.shared_with = accessControl.shared_with;
    }
    
    // Add media-specific fields (BitTorrent only, from manifest)
    if (recordType === 'image') {
        oipRecord.image = {
            bittorrentAddress: manifest.magnetURI,
            filename: manifest.originalName,
            width: width || 0,
            height: height || 0,
            size: manifest.fileSize,
            contentType: manifest.mimeType
        };
    } else if (recordType === 'video') {
        oipRecord.video = {
            bittorrentAddress: manifest.magnetURI,
            filename: manifest.originalName,
            width: width || 0,
            height: height || 0,
            size: manifest.fileSize,
            duration: duration || 0,
            contentType: manifest.mimeType
        };
    } else if (recordType === 'audio') {
        oipRecord.audio = {
            bittorrentAddress: manifest.magnetURI,
            filename: manifest.originalName,
            size: manifest.fileSize,
            duration: duration || 0,
            contentType: manifest.mimeType
        };
    }
    
    // Publish to GUN (backend handles all formatting)
    const result = await publishNewRecord(
        oipRecord, recordType, false, false, false, null, 'gun', false,
        { storage: 'gun', localId: `media_${mediaId}`, accessControl: oipRecord.accessControl }
    );
    
    res.json({
        success: true,
        did: result.did,
        recordType: recordType,
        mediaId: mediaId,
        storage: 'gun',
        encrypted: result.encrypted,
        message: `${recordType.charAt(0).toUpperCase() + recordType.slice(1)} record created successfully`
    });
});
```

**Limitation**: This approach only includes `bittorrentAddress`. If you previously called `/api/media/ipfs-upload` or `/api/media/web-setup`, those addresses are stored in the manifest but NOT included in the OIP record created by this endpoint.

**For multi-network records, use Approach 2** and manually build the record JSON with all network addresses.

## Image Record Structure

### Approach 1 Record (BitTorrent Only)

When using `/api/media/createRecord`, you get a simpler record structure:

```json
{
  "data": {
    "basic": {
      "name": "Barbell Equipment Image",
      "description": "Image file: noun-barbell-5673068.svg",
      "language": "en",
      "date": 1759094653,
      "nsfw": false,
      "tagItems": ["fitness", "equipment", "barbell"]
    },
    "image": {
      "bittorrentAddress": "magnet:?xt=urn:btih:2993527fd556b60f61aa0185210fa126088c2f8f",
      "filename": "noun-barbell-5673068.svg",
      "size": 2760,
      "contentType": "image/svg+xml",
      "width": 683,
      "height": 683
    },
    "accessControl": {
      "access_level": "private",
      "owner_public_key": "034d41b0c8bdbf3ad65e55624b554aa01533c7d2695fe91cb8a20febc99e63e92d"
    }
  },
  "oip": {
    "did": "did:gun:647f79c2a338:h:cc3bc323",
    "didTx": "did:gun:647f79c2a338:h:cc3bc323",
    "recordType": "image",
    "storage": "gun",
    "indexedAt": "2025-09-28T21:24:14.215Z"
  }
}
```

**Note**: No `ipfsAddress`, `webUrl`, or `arweaveAddress` fields.

### Approach 2 Record (Complete Multi-Network)

When using Approach 2 (manual record building with `/api/records/newRecord`), you get complete multi-network support:

```json
{
  "data": {
    "basic": {
      "name": "Barbell Equipment Image",
      "description": "Barbell icon from TheNounProject.com",
      "language": "en",
      "date": 1759094653,
      "nsfw": false,
      "tagItems": ["fitness", "equipment", "barbell"],
      "webUrl": "https://oip.fitnessally.io/media/fitnessally/noun-barbell-5673068.svg"
    },
    "image": {
      "webUrl": "https://oip.fitnessally.io/media/fitnessally/noun-barbell-5673068.svg",
      "bittorrentAddress": "magnet:?xt=urn:btih:2993527fd556b60f61aa0185210fa126088c2f8f&dn=original&tr=wss%3A%2F%2Ftracker.openwebtorrent.com&tr=wss%3A%2F%2Ftracker.btorrent.xyz",
      "ipfsAddress": "QmdjNDFTiuixbJWJXVDmuS2kEfx5Y3M2t816578vkynVVa",
      "arweaveAddress": "",
      "filename": "noun-barbell-5673068.svg",
      "size": 2760,
      "contentType": "image/svg+xml",
      "width": 683,
      "height": 683
    },
    "accessControl": {
      "access_level": "organization",
      "owner_public_key": "034d41b0c8bdbf3ad65e55624b554aa01533c7d2695fe91cb8a20febc99e63e92d",
      "created_by": "034d41b0c8bdbf3ad65e55624b554aa01533c7d2695fe91cb8a20febc99e63e92d",
      "shared_with": "did:arweave:6zmCRZ06E2XtvN84BEQE_g4laBJdoCzTfQURHD2YlC4"
    }
  },
  "oip": {
    "did": "did:gun:647f79c2a338:h:cc3bc323",
    "didTx": "did:gun:647f79c2a338:h:cc3bc323",
    "recordType": "image",
    "storage": "gun",
    "indexedAt": "2025-09-28T21:24:14.215Z",
    "ver": "0.8.0",
    "creator": {
      "didAddress": "did:arweave:u4B6d5ddggsotOiG86D-KPkeW23qQNdqaXo_ZcdI3k0",
      "publicKey": "034d41b0c8bdbf3ad65e55624b554aa01533c7d2695fe91cb8a20febc99e63e92d"
    }
  }
}
```

### Network Address Priority

The system uses this priority order for image URLs:
1. **Web URL** (`webUrl`): Direct HTTP access with domain-specific organization
2. **HTTP API** (`httpUrl`): Authenticated access via `/api/media/:mediaId`
3. **IPFS** (`ipfsAddress`): Decentralized content-addressed storage
4. **BitTorrent** (`bittorrentAddress`): P2P distribution via magnet URI
5. **Arweave** (`arweaveAddress`): Permanent blockchain storage

### File Storage Structure

```
/data/media/
├── <mediaId>/                          # One directory per unique file (SHA256 hash)
│   ├── original                        # Original uploaded file (source for all networks)
│   └── manifest.json                   # File metadata (updated by network uploads)
├── web/                                # Web server distribution (optional)
│   ├── <COMPOSE_PROJECT_NAME>/        # Project-specific folder (from env variable)
│   │   ├── noun-barbell-5673068.svg
│   │   ├── user-avatar.jpg
│   │   └── exercise-demo.gif
│   ├── another-project/               # Another deployment's files
│   │   └── files-here.png
│   └── oip-arweave-indexer/          # Default project name
│       └── default-files.jpg
├── temp/                               # Temporary upload directory
└── seeder.json                         # Global BitTorrent seeding state
```

**Note**: The `web/` subdirectory structure is based on `COMPOSE_PROJECT_NAME` environment variable, **not** the request domain. This allows multi-tenant deployments to organize files by project/application.

### Dynamic URL Generation

The system generates URLs dynamically based on environment configuration and request context:

```javascript
// URL Helper (helpers/urlHelper.js)
function getBaseUrl(req) {
    return `${req.protocol}://${req.get('host')}`;
}

function getMediaFileUrl(mediaId, req) {
    return `${getBaseUrl(req)}/api/media/${mediaId}`;
}

// Web URL generation (routes/media.js lines 573-576)
const composeProjectName = process.env.COMPOSE_PROJECT_NAME || 'oip-arweave-indexer';
const ngrokDomain = process.env.NGROK_DOMAIN || req.get('x-forwarded-host') || req.get('host');
const protocol = req.get('x-forwarded-proto') || req.protocol || 'https';
const webUrl = `${protocol}://${ngrokDomain}/media/${composeProjectName}/${filename}`;

// Examples:
// COMPOSE_PROJECT_NAME=fitnessally, host=oip.fitnessally.io
//   → https://oip.fitnessally.io/media/fitnessally/file.jpg
//
// COMPOSE_PROJECT_NAME=my-app, NGROK_DOMAIN=abc123.ngrok.io
//   → https://abc123.ngrok.io/media/my-app/file.jpg
//
// Default (localhost:3005)
//   → http://localhost:3005/media/oip-arweave-indexer/file.jpg
```

**Important**: The web directory structure uses `COMPOSE_PROJECT_NAME`, not domain extraction. Set this environment variable to organize your media files.

### Media Manifest Structure

The manifest is created by `/api/media/upload` and updated by subsequent network upload calls:

**Initial Manifest** (after `/api/media/upload`):
```json
{
  "mediaId": "651189db9bd4c6874af389b65d5fb8cf1f2cc7fa69c5711a40d79206a1c4c6b7",
  "originalName": "noun-barbell-5673068.svg",
  "mimeType": "image/svg+xml",
  "fileSize": 2760,
  "magnetURI": "magnet:?xt=urn:btih:2993527fd556b60f61aa0185210fa126088c2f8f",
  "infoHash": "2993527fd556b60f61aa0185210fa126088c2f8f",
  "httpUrl": "https://oip.fitnessally.io/api/media/651189db9bd4c6874af389b65d5fb8cf1f2cc7fa69c5711a40d79206a1c4c6b7",
  "createdAt": "2025-09-28T21:24:11.199Z",
  "userPublicKey": "034d41b0c8bdbf3ad65e55624b554aa01533c7d2695fe91cb8a20febc99e63e92d",
  "accessLevel": "private"
}
```

**Updated Manifest** (after optional network uploads):
```json
{
  "mediaId": "651189db9bd4c6874af389b65d5fb8cf1f2cc7fa69c5711a40d79206a1c4c6b7",
  "originalName": "noun-barbell-5673068.svg",
  "mimeType": "image/svg+xml",
  "fileSize": 2760,
  "magnetURI": "magnet:?xt=urn:btih:2993527fd556b60f61aa0185210fa126088c2f8f",
  "infoHash": "2993527fd556b60f61aa0185210fa126088c2f8f",
  "httpUrl": "https://oip.fitnessally.io/api/media/651189db...",
  "createdAt": "2025-09-28T21:24:11.199Z",
  "userPublicKey": "034d41b0c8bdbf3ad65e55624b554aa01533c7d2695fe91cb8a20febc99e63e92d",
  "accessLevel": "private",
  
  "ipfsHash": "QmdjNDFTiuixbJWJXVDmuS2kEfx5Y3M2t816578vkynVVa",
  "webUrl": "https://oip.fitnessally.io/media/oip-arweave-indexer/noun-barbell-5673068.svg",
  "arweaveTransactionId": "abc123xyz789"
}
```

**Key Point**: Each network upload endpoint (`/ipfs-upload`, `/web-setup`, `/arweave-upload`) **updates the manifest** by adding its respective field. The manifest grows as you enable more networks.

## API Endpoints

This section documents both approaches. **For full multi-network support, use Approach 2.**

---

## Approach 1: Simplified Helper Method (BitTorrent Only)

### Step 1: Upload Image File

**Endpoint**: `POST /api/media/upload`

**Headers**:
```http
Content-Type: multipart/form-data
Authorization: Bearer <jwt-token>
```

**Form Fields**:
```
file: <binary_image_file>           # Required: The image file
name: "My Image Title"              # Optional: Human-readable name (stored in manifest)
access_level: "private"             # Optional: "private" (default), "organization", or "public"
description: "Image description"     # Optional: Description text (stored in manifest)
```

**Response** (BitTorrent only):
```json
{
  "success": true,
  "mediaId": "651189db9bd4c6874af389b65d5fb8cf1f2cc7fa69c5711a40d79206a1c4c6b7",
  "magnetURI": "magnet:?xt=urn:btih:2993527fd556b60f61aa0185210fa126088c2f8f&dn=original&tr=wss%3A%2F%2Ftracker.openwebtorrent.com",
  "infoHash": "2993527fd556b60f61aa0185210fa126088c2f8f",
  "httpUrl": "https://oip.fitnessally.io/api/media/651189db9bd4c6874af389b65d5fb8cf1f2cc7fa69c5711a40d79206a1c4c6b7",
  "size": 2760,
  "mime": "image/svg+xml",
  "originalName": "noun-barbell-5673068.svg",
  "access_level": "private",
  "owner": "034d41b0c8bdbf3ad65e55624b554aa01533c7d2695fe91cb8a20febc99e63e92d",
  "message": "File uploaded and BitTorrent created. Use /api/records/newRecord to create proper OIP record."
}
```

**Note**: This response does **NOT** include `ipfsAddress`, `webUrl`, or `arweaveAddress`. Those require separate calls (see Approach 2).

### Step 2: Create OIP Image Record (Simplified)

**Endpoint**: `POST /api/media/createRecord`

**Headers**:
```http
Content-Type: application/json
Authorization: Bearer <jwt-token>
```

**Request Body**:
```json
{
  "mediaId": "651189db9bd4c6874af389b65d5fb8cf1f2cc7fa69c5711a40d79206a1c4c6b7",
  "recordType": "image",
  "basicInfo": {
    "name": "Barbell Equipment Image",
    "description": "Barbell icon from TheNounProject.com",
    "language": "en",
    "nsfw": false,
    "tagItems": ["fitness", "equipment", "barbell"]
  },
  "accessControl": {
    "access_level": "organization",
    "shared_with": "did:arweave:6zmCRZ06E2XtvN84BEQE_g4laBJdoCzTfQURHD2YlC4"
  },
  "width": 683,
  "height": 683,
  "duration": 0
}
```

**Response**:
```json
{
  "success": true,
  "did": "did:gun:647f79c2a338:h:cc3bc323",
  "recordType": "image",
  "mediaId": "651189db9bd4c6874af389b65d5fb8cf1f2cc7fa69c5711a40d79206a1c4c6b7",
  "storage": "gun",
  "encrypted": true,
  "message": "Image record created successfully"
}
```

**What it does**: Automatically creates an OIP record with `bittorrentAddress` from the manifest. The backend handles all formatting.

---

## Approach 2: Full-Control Multi-Network Method

This is the approach used by `reference-client.html` for maximum flexibility and multi-network support.

### Step 1: Upload Image File

**Endpoint**: `POST /api/media/upload`

Same as Approach 1. Returns `mediaId`, `magnetURI`, `httpUrl`, and file metadata.

### Step 2a: Upload to IPFS (Optional)

**Endpoint**: `POST /api/media/ipfs-upload`

**Headers**:
```http
Content-Type: application/json
Authorization: Bearer <jwt-token>
```

**Request Body**:
```json
{
  "mediaId": "651189db9bd4c6874af389b65d5fb8cf1f2cc7fa69c5711a40d79206a1c4c6b7"
}
```

**Response**:
```json
{
  "success": true,
  "ipfsHash": "QmdjNDFTiuixbJWJXVDmuS2kEfx5Y3M2t816578vkynVVa",
  "ipfsUrl": "https://ipfs.io/ipfs/QmdjNDFTiuixbJWJXVDmuS2kEfx5Y3M2t816578vkynVVa",
  "message": "File uploaded to IPFS successfully"
}
```

### Step 2b: Setup Web Server Access (Optional)

**Endpoint**: `POST /api/media/web-setup`

**Headers**:
```http
Content-Type: application/json
Authorization: Bearer <jwt-token>
```

**Request Body**:
```json
{
  "mediaId": "651189db9bd4c6874af389b65d5fb8cf1f2cc7fa69c5711a40d79206a1c4c6b7",
  "filename": "noun-barbell-5673068.svg"
}
```

**Response**:
```json
{
  "success": true,
  "webUrl": "https://oip.fitnessally.io/media/oip-arweave-indexer/noun-barbell-5673068.svg",
  "filename": "noun-barbell-5673068.svg",
  "message": "Web access setup successfully"
}
```

**What it does**: Copies the file to a web-accessible directory at `/data/media/web/{COMPOSE_PROJECT_NAME}/{filename}` and returns a direct HTTP URL.

### Step 2c: Upload to Arweave (Optional)

**Endpoint**: `POST /api/media/arweave-upload`

**Headers**:
```http
Content-Type: application/json
Authorization: Bearer <jwt-token>
```

**Request Body**:
```json
{
  "mediaId": "651189db9bd4c6874af389b65d5fb8cf1f2cc7fa69c5711a40d79206a1c4c6b7"
}
```

**Response**:
```json
{
  "success": true,
  "transactionId": "abc123def456789xyz",
  "arweaveUrl": "https://arweave.net/abc123def456789xyz",
  "message": "File uploaded to Arweave successfully"
}
```

### Step 3: Build Complete OIP Record Structure

Using the responses from Steps 1-2, build a complete OIP record JSON:

```javascript
const recordData = {
  basic: {
    name: "Barbell Equipment Image",
    description: "Barbell icon from TheNounProject.com",
    language: "en",
    date: Math.floor(Date.now() / 1000),
    nsfw: false,
    tagItems: ["fitness", "equipment", "barbell"],
    webUrl: webUrlFromStep2b || httpUrlFromStep1  // Use web URL if available
  },
  image: {
    webUrl: webUrlFromStep2b || httpUrlFromStep1,        // Primary access URL
    bittorrentAddress: magnetURIFromStep1,               // From /api/media/upload
    ipfsAddress: ipfsHashFromStep2a || "",               // From /api/media/ipfs-upload (or empty string)
    arweaveAddress: transactionIdFromStep2c || "",       // From /api/media/arweave-upload (or empty string)
    filename: "noun-barbell-5673068.svg",
    size: 2760,
    contentType: "image/svg+xml",
    width: 683,
    height: 683
  },
  accessControl: {
    access_level: "organization",
    owner_public_key: "034d41b0c8bdbf3ad65e55624b554aa01533c7d2695fe91cb8a20febc99e63e92d",
    created_by: "034d41b0c8bdbf3ad65e55624b554aa01533c7d2695fe91cb8a20febc99e63e92d",
    shared_with: "did:arweave:6zmCRZ06E2XtvN84BEQE_g4laBJdoCzTfQURHD2YlC4"  // Organization DID (optional)
  }
};
```

**Key Points**:
- All network addresses must be manually populated from API responses
- `ipfsAddress` and `arweaveAddress` can be empty strings if those networks weren't used
- `webUrl` should be the direct web server URL (from Step 2b) for best performance
- `bittorrentAddress` is always included (BitTorrent is mandatory)
- `owner_public_key` and `created_by` must be extracted from your JWT token

### Step 4: Publish Complete OIP Record

**Endpoint**: `POST /api/records/newRecord?recordType=image&storage=gun`

**Headers**:
```http
Content-Type: application/json
Authorization: Bearer <jwt-token>
```

**Request Body**: The complete `recordData` object from Step 3

**Response**:
```json
{
  "success": true,
  "did": "did:gun:647f79c2a338:h:cc3bc323",
  "storage": "gun",
  "encrypted": true,
  "message": "Record published successfully to GUN"
}
```

---

## Common Endpoints (Both Approaches)

### Stream Image File

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

### Get Image Information

**Endpoint**: `GET /api/media/:mediaId/info`

**Headers**:
```http
Authorization: Bearer <jwt-token>
```

**Response** (Manifest only):
```json
{
  "mediaId": "651189db9bd4c6874af389b65d5fb8cf1f2cc7fa69c5711a40d79206a1c4c6b7",
  "originalName": "landscape_sunset.jpg",
  "mimeType": "image/jpeg",
  "fileSize": 2048576,
  "magnetURI": "magnet:?xt=urn:btih:abc123def456...",
  "infoHash": "abc123def456789abcdef0123456789abcdef01",
  "httpUrl": "https://api.oip.onl/api/media/651189db...",
  "ipfsHash": "QmXYZ123...",
  "webUrl": "https://oip.fitnessally.io/media/fitnessally/landscape_sunset.jpg",
  "arweaveTransactionId": "abc123xyz789",
  "createdAt": "2025-09-13T18:52:38.199Z",
  "userPublicKey": "0349b2160ea3117a90a1fcbbf198ef53bf325b604157cbcf81693f0f476006c9e1",
  "accessLevel": "private",
  "seeding": true,
  "seedingInfo": {
    "mediaId": "651189db9bd4c6874af389b65d5fb8cf1f2cc7fa69c5711a40d79206a1c4c6b7",
    "infoHash": "abc123def456789abcdef0123456789abcdef01",
    "magnetURI": "magnet:?xt=urn:btih:abc123def456...",
    "filePath": "/usr/src/app/data/media/.../original",
    "createdAt": "2025-09-13T18:52:38.199Z",
    "fileSize": 2048576
  }
}
```

**Note**: This endpoint returns the **file manifest**, not the OIP record. To get the OIP record, query `/api/records?did=<record-did>`

## Access Control Levels

### Private Access
- **Visibility**: Only the owner can access
- **Use Case**: Personal photos, private content
- **Organization**: Not shared with any organization
- **BitTorrent**: Still available via magnet URI (encrypted if enabled)
- **Web URL**: Requires authentication to access

### Organization Access (Enhanced)
- **Visibility**: Owner + organization members (domain-based membership)
- **Use Case**: Team photos, shared project images, branded content
- **Organization**: Must select an organization from dropdown (populated from user's organizations)
- **Membership Validation**: Automatic via domain matching (e.g., `oip.fitnessally.io` → `fitnessally.io`)
- **Policy Support**: "Auto-Enroll App Users" policy grants access based on request domain
- **BitTorrent**: Available to organization members
- **Web URL**: Organization members can access without authentication

### Public Access
- **Visibility**: Everyone can access
- **Use Case**: Public artwork, open content
- **Organization**: Not applicable
- **BitTorrent**: Publicly available
- **Web URL**: No authentication required

### Organization Access Control Implementation

The system implements sophisticated organization-level access control:

```javascript
// Domain-based membership validation (helpers/organizationEncryption.js)
async function checkDomainBasedMembership(organization, requestInfo) {
    const orgWebUrl = organization.data.webUrl; // e.g., "fitnessally.io"
    const requestHost = requestInfo.host;        // e.g., "oip.fitnessally.io"
    
    // Extract domain from organization's webUrl
    let orgDomain = orgWebUrl.startsWith('http') ? 
        new URL(orgWebUrl).hostname : orgWebUrl;
    
    // Check for subdomain match
    if (requestHost === orgDomain || requestHost.endsWith('.' + orgDomain)) {
        console.log(`✅ Domain-based membership granted: ${requestHost} matches ${orgDomain}`);
        return true;
    }
    
    return false;
}

// Organization record filtering (helpers/elasticsearch.js)
if (accessLevel === 'organization') {
    const sharedWith = accessControl?.shared_with; // Organization DID
    const isMember = await checkOrganizationMembershipForRecord(userPubKey, [sharedWith], requestInfo);
    
    if (isMember) {
        console.log('Including organization record for member:', record.oip?.did);
        return true; // User can access this organization record
    } else {
        console.log('Excluding organization record (not member):', record.oip?.did);
        return false; // User cannot access this organization record
    }
}
```

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

#### Approach 1: Simplified Method (BitTorrent Only)

```javascript
class OIPImageClientSimple {
    constructor(baseUrl = 'https://api.oip.onl', token) {
        this.baseUrl = baseUrl;
        this.token = token;
    }

    // Simple two-step publish (BitTorrent only)
    async publishImage(imageFile, metadata = {}) {
        try {
            // Step 1: Upload file
            const formData = new FormData();
            formData.append('file', imageFile);
            formData.append('name', metadata.name || imageFile.name);
            formData.append('access_level', metadata.access_level || 'private');
            
            const uploadResponse = await fetch(`${this.baseUrl}/api/media/upload`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.token}` },
                body: formData
            });

            const uploadResult = await uploadResponse.json();
            if (!uploadResponse.ok) throw new Error(uploadResult.error || 'Upload failed');

            // Step 2: Create OIP record (backend handles formatting)
            const dimensions = await this.getImageDimensions(imageFile);
            
            const recordResponse = await fetch(`${this.baseUrl}/api/media/createRecord`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({
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
                        shared_with: metadata.organization_did || undefined
                    },
                    width: dimensions.width,
                    height: dimensions.height
                })
            });

            const recordResult = await recordResponse.json();
            if (!recordResponse.ok) throw new Error(recordResult.error);

            return {
                success: true,
                did: recordResult.did,
                mediaId: uploadResult.mediaId,
                magnetURI: uploadResult.magnetURI,
                httpUrl: uploadResult.httpUrl
            };

        } catch (error) {
            console.error('Image publishing failed:', error);
            throw error;
        }
    }

    async getImageDimensions(file) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                resolve({ width: img.width, height: img.height });
                URL.revokeObjectURL(img.src);
            };
            img.onerror = () => resolve({ width: 0, height: 0 });
            img.src = URL.createObjectURL(file);
        });
    }
}
```

#### Approach 2: Full-Control Multi-Network Method

**This is the implementation from `reference-client.html` lines 16374-16713**

```javascript
class OIPImageClient {
    constructor(baseUrl = 'https://api.oip.onl', token) {
        this.baseUrl = baseUrl;
        this.token = token;
    }

    // Full multi-network publish (as implemented in reference-client.html)
    async publishImage(imageFile, options = {}) {
        try {
            // Step 1: Upload file to get BitTorrent and mediaId
            const formData = new FormData();
            formData.append('file', imageFile);
            formData.append('name', options.name || imageFile.name);
            formData.append('access_level', options.access_level || 'private');
            
            const uploadResponse = await fetch(`${this.baseUrl}/api/media/upload`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.token}` },
                body: formData
            });

            const uploadResult = await uploadResponse.json();
            if (!uploadResponse.ok) throw new Error(uploadResult.error || 'Upload failed');

            console.log('✅ Step 1 complete - mediaId:', uploadResult.mediaId);

            // Step 2: Optional network uploads (sequential calls)
            let ipfsAddress = '';
            let webUrl = '';
            let arweaveAddress = '';

            // Step 2a: IPFS (if enabled)
            if (options.enableIPFS) {
                try {
                    const ipfsResponse = await fetch(`${this.baseUrl}/api/media/ipfs-upload`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${this.token}`
                        },
                        body: JSON.stringify({ mediaId: uploadResult.mediaId })
                    });
                    
                    const ipfsResult = await ipfsResponse.json();
                    if (ipfsResponse.ok) {
                        ipfsAddress = ipfsResult.ipfsHash;
                        console.log('✅ Step 2a complete - IPFS:', ipfsAddress);
                    }
                } catch (error) {
                    console.warn('⚠️ IPFS upload failed:', error);
                }
            }

            // Step 2b: Web server (if enabled)
            if (options.enableWeb) {
                try {
                    const webResponse = await fetch(`${this.baseUrl}/api/media/web-setup`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${this.token}`
                        },
                        body: JSON.stringify({ 
                            mediaId: uploadResult.mediaId,
                            filename: uploadResult.originalName
                        })
                    });
                    
                    const webResult = await webResponse.json();
                    if (webResponse.ok) {
                        webUrl = webResult.webUrl;
                        console.log('✅ Step 2b complete - Web URL:', webUrl);
                    }
                } catch (error) {
                    console.warn('⚠️ Web setup failed:', error);
                }
            }

            // Step 2c: Arweave (if enabled)
            if (options.enableArweave) {
                try {
                    const arweaveResponse = await fetch(`${this.baseUrl}/api/media/arweave-upload`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${this.token}`
                        },
                        body: JSON.stringify({ mediaId: uploadResult.mediaId })
                    });
                    
                    const arweaveResult = await arweaveResponse.json();
                    if (arweaveResponse.ok) {
                        arweaveAddress = arweaveResult.transactionId;
                        console.log('✅ Step 2c complete - Arweave:', arweaveAddress);
                    }
                } catch (error) {
                    console.warn('⚠️ Arweave upload failed:', error);
                }
            }

            // Step 3: Extract image dimensions
            const dimensions = await this.getImageDimensions(imageFile);

            // Step 4: Build complete OIP record with all network addresses
            const recordData = {
                basic: {
                    name: options.name || imageFile.name,
                    description: options.description || `Image file: ${imageFile.name}`,
                    language: options.language || 'en',
                    date: Math.floor(Date.now() / 1000),
                    nsfw: options.nsfw || false,
                    tagItems: options.tags || [],
                    webUrl: webUrl || uploadResult.httpUrl  // Prefer web URL, fallback to httpUrl
                },
                image: {
                    webUrl: webUrl || uploadResult.httpUrl,
                    bittorrentAddress: uploadResult.magnetURI,
                    ipfsAddress: ipfsAddress,
                    arweaveAddress: arweaveAddress,
                    filename: uploadResult.originalName,
                    size: uploadResult.size,
                    contentType: uploadResult.mime,
                    width: dimensions.width,
                    height: dimensions.height
                },
                accessControl: {
                    access_level: options.access_level || 'private',
                    owner_public_key: this.getUserPublicKey(),
                    created_by: this.getUserPublicKey(),
                    shared_with: options.organization_did || undefined
                }
            };

            console.log('📋 Step 4: Built record structure');

            // Step 5: Publish to GUN via /api/records/newRecord
            const recordResponse = await fetch(
                `${this.baseUrl}/api/records/newRecord?recordType=image&storage=gun`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.token}`
                    },
                    body: JSON.stringify(recordData)
                }
            );

            const recordResult = await recordResponse.json();
            if (!recordResponse.ok) throw new Error(recordResult.error || 'Record creation failed');

            console.log('✅ Step 5 complete - OIP Record:', recordResult.did);

            return {
                success: true,
                did: recordResult.did,
                mediaId: uploadResult.mediaId,
                magnetURI: uploadResult.magnetURI,
                httpUrl: uploadResult.httpUrl,
                ipfsAddress: ipfsAddress,
                webUrl: webUrl,
                arweaveAddress: arweaveAddress,
                dimensions: dimensions,
                storage: 'gun',
                recordType: 'image',
                networks: {
                    bittorrent: true,
                    ipfs: !!ipfsAddress,
                    web: !!webUrl,
                    arweave: !!arweaveAddress
                }
            };

        } catch (error) {
            console.error('Image publishing failed:', error);
            throw error;
        }
    }

    // Extract user's public key from JWT token
    getUserPublicKey() {
        try {
            const parts = this.token.split('.');
            if (parts.length === 3) {
                const payload = JSON.parse(atob(parts[1]));
                return payload.publicKey;
            }
        } catch (error) {
            console.error('Failed to extract public key from JWT');
        }
        return null;
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
                    headers: { 'Authorization': `Bearer ${this.token}` }
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

    // Get Web URL from record
    getWebUrl(imageRecord) {
        return imageRecord.data?.image?.webUrl || imageRecord.data?.basic?.webUrl;
    }

    // Get IPFS URL from record
    getIPFSUrl(imageRecord) {
        const ipfsHash = imageRecord.data?.image?.ipfsAddress;
        return ipfsHash ? `https://ipfs.io/ipfs/${ipfsHash}` : null;
    }
}
```

### Usage Examples

#### Example 1: Simple Publishing (BitTorrent Only)

```javascript
// Initialize simple client
const client = new OIPImageClientSimple('https://api.oip.onl', userJWTToken);

// Upload image from file input
const fileInput = document.getElementById('image-file');
const imageFile = fileInput.files[0];

const result = await client.publishImage(imageFile, {
    name: 'Sunset Landscape',
    description: 'Beautiful sunset in the Rocky Mountains',
    tags: ['landscape', 'sunset', 'mountains', 'nature'],
    access_level: 'private',
    language: 'en',
    nsfw: false
});

console.log('✅ Image published:', result.did);
console.log('📥 Stream via HTTP:', result.httpUrl);
console.log('🧲 BitTorrent magnet:', result.magnetURI);

// Display image
const img = document.createElement('img');
img.src = result.httpUrl; // Uses /api/media/:mediaId endpoint
gallery.appendChild(img);
```

#### Example 2: Multi-Network Publishing

```javascript
// Initialize full-featured client
const client = new OIPImageClient('https://api.oip.onl', userJWTToken);

// Upload with multi-network distribution
const result = await client.publishImage(imageFile, {
    name: 'Sunset Landscape',
    description: 'Beautiful sunset in the Rocky Mountains',
    tags: ['landscape', 'sunset', 'mountains', 'nature'],
    access_level: 'organization',
    organization_did: 'did:arweave:orgDid123...',
    language: 'en',
    nsfw: false,
    // Network options
    enableIPFS: true,
    enableWeb: true,
    enableArweave: false  // Costs AR tokens
});

console.log('✅ Image published to multiple networks');
console.log('🆔 OIP DID:', result.did);
console.log('📥 HTTP Stream:', result.httpUrl);
console.log('🌍 Web URL:', result.webUrl);
console.log('🧲 BitTorrent:', result.magnetURI);
console.log('🌐 IPFS:', result.ipfsAddress);
console.log('📊 Networks:', result.networks);

// Display image using web URL for best performance
const img = document.createElement('img');
img.src = result.webUrl || result.httpUrl;
img.alt = result.name;
gallery.appendChild(img);

// Retrieve all user images
const userImages = await client.getUserImages(50);
console.log(`User has ${userImages.length} images`);
```

### React Component Example (Multi-Network Support)

```jsx
import React, { useState, useCallback } from 'react';

const ImageUploader = ({ token, onImagePublished }) => {
    const [uploading, setUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [statusText, setStatusText] = useState('');
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
        setProgress(10);
        setStatusText('Uploading file...');

        try {
            const client = new OIPImageClient('https://api.oip.onl', token);
            
            // Get form values
            const metadata = {
                name: document.getElementById('image-title').value,
                description: document.getElementById('image-description').value,
                tags: document.getElementById('image-tags').value.split(',').map(t => t.trim()).filter(t => t),
                access_level: document.getElementById('access-level').value,
                enableIPFS: document.getElementById('enable-ipfs')?.checked || false,
                enableWeb: document.getElementById('enable-web')?.checked || true,
                enableArweave: document.getElementById('enable-arweave')?.checked || false
            };
            
            // Publish with multi-network support
            const result = await client.publishImage(preview.file, metadata);
            
            setProgress(100);
            setStatusText('Published successfully!');
            onImagePublished(result);
            
            // Show success details
            console.log('📊 Published to networks:', result.networks);
            console.log('🆔 DID:', result.did);
            if (result.webUrl) console.log('🌍 Web URL:', result.webUrl);
            if (result.ipfsAddress) console.log('🌐 IPFS:', result.ipfsAddress);
            
            // Reset form
            setTimeout(() => {
                setPreview(null);
                setProgress(0);
                setStatusText('');
            }, 3000);
            
        } catch (error) {
            console.error('Upload failed:', error);
            setStatusText('Upload failed: ' + error.message);
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
                        <textarea id="image-description" placeholder="Description" rows="3" />
                        <input id="image-tags" placeholder="tags, separated, by, commas" />
                        
                        <select id="access-level">
                            <option value="private">Private</option>
                            <option value="organization">Organization</option>
                            <option value="public">Public</option>
                        </select>
                        
                        <div className="network-options">
                            <label>
                                <input type="checkbox" id="enable-ipfs" /> Upload to IPFS
                            </label>
                            <label>
                                <input type="checkbox" id="enable-web" defaultChecked /> Setup Web Access
                            </label>
                            <label>
                                <input type="checkbox" id="enable-arweave" /> Upload to Arweave (costs AR)
                            </label>
                        </div>
                    </div>

                    {uploading && (
                        <div className="progress-container">
                            <div className="progress-bar">
                                <div 
                                    className="progress-fill" 
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                            <span className="progress-text">{statusText}</span>
                        </div>
                    )}

                    <button 
                        onClick={publishImage} 
                        disabled={uploading}
                        className="publish-btn"
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

## Approach Comparison

| Feature | Approach 1 (Simple) | Approach 2 (Full Control) |
|---------|---------------------|---------------------------|
| **API Calls** | 2 calls | 2-5+ calls (depends on networks) |
| **Complexity** | Low | Medium-High |
| **BitTorrent** | ✅ Always included | ✅ Always included |
| **IPFS** | ❌ Not in record | ✅ Optional, in record |
| **Web Server** | ❌ Not in record | ✅ Optional, in record |
| **Arweave** | ❌ Not in record | ✅ Optional, in record |
| **Record Formatting** | ✅ Automatic | ⚠️ Manual (you build JSON) |
| **Final Endpoint** | `/api/media/createRecord` | `/api/records/newRecord` |
| **Best For** | Quick publishing, simple apps | Advanced apps, multi-network, custom structure |
| **Example** | See OIPImageClientSimple | See reference-client.html |

## Key Implementation Details

### Critical Flags and Requirements

1. **Authentication**: JWT token is **required** for all media operations
   - Must include `Authorization: Bearer <token>` header
   - Token must contain valid `publicKey` field

2. **Record Type Detection**: Auto-detected from file MIME type
   - `image/*` → `recordType: 'image'`
   - `video/*` → `recordType: 'video'`
   - `audio/*` → `recordType: 'audio'`

3. **Dimension Extraction**: Client-side responsibility
   - Images: Extract `width` and `height` using `Image` object
   - Videos: Extract `width`, `height`, `duration` using `<video>` element
   - Audio: Extract `duration` using `<audio>` element

4. **Network Address Population**:
   - **BitTorrent**: Mandatory, from `/api/media/upload` response
   - **IPFS**: Optional, requires calling `/api/media/ipfs-upload` first
   - **Web**: Optional, requires calling `/api/media/web-setup` first
   - **Arweave**: Optional, requires calling `/api/media/arweave-upload` first
   - Use **empty strings** for unused networks, NOT null or undefined

5. **Storage Type**: Always `storage=gun` for media records
   - Query parameter: `?recordType=image&storage=gun`
   - Media records are stored in GUN, not Arweave
   - BitTorrent provides the distribution layer

### Common Pitfalls

❌ **Don't**: Expect `/api/media/upload` to handle IPFS/Web/Arweave
✅ **Do**: Make separate API calls for each network

❌ **Don't**: Use `/api/media/createRecord` if you want multi-network addresses in your record
✅ **Do**: Use `/api/records/newRecord` with manually built JSON

❌ **Don't**: Forget to extract dimensions client-side
✅ **Do**: Use Image/Video/Audio objects to get dimensions before publishing

❌ **Don't**: Use `null` for unused network addresses
✅ **Do**: Use empty strings `""` for unused networks

❌ **Don't**: Forget the `owner_public_key` and `created_by` fields
✅ **Do**: Extract from JWT token payload before building record

## Conclusion

The OIP image publishing system provides two distinct workflows:

1. **Simplified Method** (`/api/media/createRecord`): Quick BitTorrent-only publishing with automatic record formatting. Best for simple applications.

2. **Full-Control Method** (`/api/records/newRecord`): Complete multi-network distribution with manual JSON construction. Best for advanced applications needing IPFS, Web server, and Arweave support.

**Key Architectural Decision**: The `/api/media/upload` endpoint handles **only** file storage and BitTorrent creation. Multi-network distribution requires sequential API calls to separate endpoints, with the client responsible for aggregating network addresses into the final record JSON.

This separation enables:
- **Flexibility**: Applications choose which networks to use
- **Fault Tolerance**: Network failures don't block the entire upload
- **Cost Control**: Expensive operations (Arweave) are opt-in
- **Performance**: Fast BitTorrent creation happens first, other networks async

Through integration with the broader OIP ecosystem, published images can be referenced by other records (via dref fields), creating rich, interconnected content structures while maintaining efficient multi-network distribution.

---

## Quick Reference: Publishing Workflow Checklist

### ✅ Approach 1 (Simple - BitTorrent Only)

```
1. POST /api/media/upload
   FormData: { file, name, access_level }
   Get: mediaId, magnetURI, httpUrl

2. POST /api/media/createRecord
   JSON: { mediaId, recordType, basicInfo, accessControl, width, height }
   Get: did, storage, encrypted

DONE ✓ Record published with BitTorrent
```

### ✅ Approach 2 (Full Control - Multi-Network)

```
1. POST /api/media/upload
   FormData: { file, name, access_level }
   Get: mediaId, magnetURI, httpUrl, size, mime, originalName
   Save: mediaId, magnetURI, httpUrl

2a. [OPTIONAL] POST /api/media/ipfs-upload
    JSON: { mediaId }
    Get: ipfsHash
    Save: ipfsHash

2b. [OPTIONAL] POST /api/media/web-setup
    JSON: { mediaId, filename }
    Get: webUrl
    Save: webUrl

2c. [OPTIONAL] POST /api/media/arweave-upload
    JSON: { mediaId }
    Get: transactionId
    Save: transactionId

3. Extract dimensions client-side
   Image: const img = new Image(); img.src = URL.createObjectURL(file)
   Get: width, height

4. Build record JSON manually:
   {
     basic: { name, description, language, date, nsfw, tagItems, webUrl },
     image: { 
       webUrl,           // from step 2b OR httpUrl from step 1
       bittorrentAddress,  // from step 1
       ipfsAddress,        // from step 2a OR ""
       arweaveAddress,     // from step 2c OR ""
       filename, size, contentType, width, height
     },
     accessControl: { 
       access_level, owner_public_key, created_by, shared_with 
     }
   }

5. POST /api/records/newRecord?recordType=image&storage=gun
   JSON: { ...recordData from step 4 }
   Get: did, storage, encrypted

DONE ✓ Record published with multi-network support
```

### 📝 Critical Fields Checklist

**From API Responses** (save these):
- ✅ `mediaId` (from upload)
- ✅ `magnetURI` (from upload) → goes in `image.bittorrentAddress`
- ✅ `httpUrl` (from upload) → fallback for `image.webUrl`
- ✅ `ipfsHash` (from ipfs-upload) → goes in `image.ipfsAddress`
- ✅ `webUrl` (from web-setup) → goes in `image.webUrl` AND `basic.webUrl`
- ✅ `transactionId` (from arweave-upload) → goes in `image.arweaveAddress`

**From Client Extraction** (calculate these):
- ✅ `width`, `height` (from Image object)
- ✅ `owner_public_key` (from JWT token payload)
- ✅ `created_by` (from JWT token payload)

**From Form Input** (user provides):
- ✅ `name`, `description`, `language`, `tagItems`
- ✅ `access_level` (private/organization/public)
- ✅ `shared_with` (organization DID, if access_level is 'organization')

### 🚨 Common Mistakes to Avoid

| Mistake | Correct Approach |
|---------|------------------|
| Sending `publishTo[ipfs]` to `/api/media/upload` | Call `/api/media/ipfs-upload` separately |
| Using `/api/media/createRecord` for multi-network | Use `/api/records/newRecord` with manual JSON |
| Setting unused networks to `null` | Use empty strings `""` instead |
| Forgetting to extract dimensions | Extract client-side before Step 4 |
| Missing `owner_public_key` field | Extract from JWT token payload |
| Wrong final endpoint | Use `/api/records/newRecord`, NOT `/api/media/createRecord` for Approach 2 |
