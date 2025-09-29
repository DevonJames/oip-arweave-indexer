# MediaSeeder Service Documentation

## Overview

The MediaSeeder service (`services/mediaSeeder.js`) is a persistent BitTorrent seeding service that enables P2P file distribution for media files uploaded to the OIP system. It uses WebTorrent to create and continuously seed torrents for uploaded media files, providing decentralized distribution while maintaining server-based availability.

## Architecture

### Core Components

1. **WebTorrent Client**: Persistent WebTorrent instance that manages all torrents
2. **State Management**: Tracks seeding state across server restarts
3. **File Organization**: Structured storage in `/data/media/` directory
4. **Tracker Integration**: Uses public WebSocket trackers for peer discovery

### File Structure

```
data/media/
├── <mediaId>/
│   ├── original          # Original uploaded file
│   └── manifest.json     # Media manifest with metadata
└── seeder.json          # Seeding state persistence
```

Where `mediaId` is the SHA256 hash of the file content, ensuring deduplication.

## Service Features

### Persistent Seeding
- **Continuous Operation**: Keeps files seeded as long as the server runs
- **State Recovery**: Automatically resumes seeding after server restarts
- **Deduplication**: Uses content-based addressing (SHA256) to avoid duplicate storage

### WebTorrent Integration
- **Browser Compatible**: Uses WebTorrent for browser-to-server P2P transfers
- **Tracker Network**: Configured with reliable public WebSocket trackers
- **Magnet URIs**: Generates standard magnet links for file discovery

### Authentication & Privacy
- **HD Wallet Integration**: Files owned by user's cryptographic identity
- **Access Control**: Private files only accessible to owners
- **Ownership Verification**: Uses public key signatures for file ownership

## Configuration

### Environment Variables

```bash
# Media storage directory (defaults to ./data/media)
MEDIA_DIR=/usr/src/app/data/media

# WebTorrent tracker URLs (comma-separated)
WEBTORRENT_TRACKERS=wss://tracker.openwebtorrent.com,wss://tracker.btorrent.xyz
```

### Default Trackers

The service uses these public WebSocket trackers by default:
- `wss://tracker.openwebtorrent.com`
- `wss://tracker.btorrent.xyz`

## API Integration

### Initialization

The MediaSeeder is automatically initialized when the server starts:

```javascript
// In index.js
const mediaSeeder = getMediaSeeder();
await mediaSeeder.initialize();
```

### Usage in Routes

```javascript
// In routes/media.js
const mediaSeeder = getMediaSeeder();
const seedInfo = await mediaSeeder.seedFile(finalFilePath, mediaId);
```

## Service Methods

### Core Methods

#### `initialize()`
Initializes the WebTorrent client and resumes seeding existing files.

```javascript
const success = await mediaSeeder.initialize();
// Returns: boolean indicating success
```

#### `seedFile(filePath, mediaId)`
Creates a new torrent and starts seeding a file.

```javascript
const seedInfo = await mediaSeeder.seedFile('/path/to/file', 'abc123...');
// Returns: { mediaId, infoHash, magnetURI, filePath, createdAt, fileSize }
```

#### `getSeedingInfo(mediaId)`
Retrieves seeding information for a specific media file.

```javascript
const info = mediaSeeder.getSeedingInfo('abc123...');
// Returns: seedInfo object or undefined
```

#### `getAllSeeding()`
Gets all currently seeded files.

```javascript
const allSeeding = mediaSeeder.getAllSeeding();
// Returns: Array of seedInfo objects
```

#### `getStats()`
Returns current seeding statistics.

```javascript
const stats = mediaSeeder.getStats();
// Returns: { seedingCount, activeTorrents, totalUploaded, totalDownloaded, peers }
```

### State Management

#### `loadSeedingState()`
Loads seeding state from disk on startup.

#### `saveSeedingState()`
Persists current seeding state to disk.

#### `resumeSeeding()`
Resumes seeding all files found in the seeding state.

## Data Structures

### Seed Info Object

```javascript
{
  mediaId: "a1b2c3d4e5f6...",           // SHA256 hash of file content
  infoHash: "abc123def456...",          // BitTorrent info hash
  magnetURI: "magnet:?xt=urn:btih:...", // Standard magnet URI
  filePath: "/full/path/to/file",       // Absolute file path
  createdAt: "2025-01-15T10:30:00Z",    // ISO timestamp
  fileSize: 1048576                     // File size in bytes
}
```

### Statistics Object

```javascript
{
  seedingCount: 5,        // Number of files being seeded
  activeTorrents: 5,      // Number of active WebTorrent instances
  totalUploaded: 1024000, // Total bytes uploaded to peers
  totalDownloaded: 0,     // Total bytes downloaded (usually 0 for seeder)
  peers: 12               // Total number of connected peers
}
```

## Media Upload Flow

### 1. File Upload
```
POST /api/media/upload
├── Multer processes multipart upload
├── File saved to temp directory
└── SHA256 hash computed as mediaId
```

### 2. File Processing
```
File Processing
├── Create final directory: data/media/<mediaId>/
├── Move file to: data/media/<mediaId>/original
├── Generate manifest.json with metadata
└── Start BitTorrent seeding
```

### 3. Torrent Creation
```
MediaSeeder.seedFile()
├── Create WebTorrent instance
├── Generate .torrent metadata
├── Start seeding to tracker network
├── Save seeding state to disk
└── Return magnetURI and infoHash
```

### 4. Record Creation
```
OIP Record Creation
├── Create proper OIP record structure
├── Include BitTorrent transport info
├── Store in GUN (private) or Arweave (public)
└── Index in Elasticsearch
```

## WebTorrent Integration Details

### Version Compatibility

The service uses WebTorrent 1.9.7 to avoid native compilation issues:

```json
{
  "dependencies": {
    "webtorrent": "^1.9.7"
  }
}
```

### Import Method

Uses dynamic ESM import for WebTorrent compatibility:

```javascript
async loadWebTorrent() {
  if (!this.WebTorrent) {
    const WebTorrentModule = await import('webtorrent');
    this.WebTorrent = WebTorrentModule.default;
  }
  return this.WebTorrent;
}
```

### Client Configuration

```javascript
this.client = new WebTorrent({
  tracker: {
    announce: this.trackers  // WebSocket tracker URLs
  }
});
```

## Error Handling

### Common Issues

#### WebTorrent Import Errors
- **Issue**: `Cannot find module '../build/Release/node_datachannel.node'`
- **Solution**: Use WebTorrent 1.9.7 instead of 2.x versions
- **Fix**: `npm install webtorrent@1.9.7 --save`

#### Directory Permission Errors
- **Issue**: Cannot create media directories
- **Solution**: Ensure proper permissions on data directory
- **Fix**: Use local `./data/media` instead of `/usr/src/app/data/media`

#### Tracker Connection Issues
- **Issue**: No peers found for torrents
- **Solution**: Verify tracker URLs are accessible
- **Fix**: Test tracker connectivity and use alternative trackers

### Error Recovery

The service implements graceful error handling:

```javascript
try {
  await mediaSeeder.initialize();
  console.log('✅ MediaSeeder initialized successfully');
} catch (error) {
  console.error('❌ MediaSeeder initialization failed:', error.message);
  // Service continues without P2P features
}
```

## Monitoring & Debugging

### Logging

The service provides comprehensive logging:

```
🌱 MediaSeeder initialized
📁 Media directory: /path/to/media
🔗 Trackers: [ 'wss://tracker1.com', 'wss://tracker2.com' ]
🔄 Resumed seeding: 3 files, 0 failed
✅ MediaSeeder initialized successfully
🌱 Currently seeding 3 files
```

### Health Checks

Check service status programmatically:

```javascript
const seeder = getMediaSeeder();
const stats = seeder.getStats();
console.log(`Seeding ${stats.seedingCount} files with ${stats.peers} peers`);
```

### File Verification

Verify files are being seeded:

```bash
# Check media directory structure
ls -la data/media/

# Check seeding state file
cat data/media/seeder.json

# Verify specific file exists
ls -la data/media/<mediaId>/original
```

## Performance Considerations

### Resource Usage

- **Memory**: WebTorrent client maintains metadata for all torrents
- **Network**: Continuous seeding uses upload bandwidth
- **Disk I/O**: File access for peer requests
- **CPU**: Torrent protocol overhead (minimal)

### Scaling

- **File Limits**: No hard limits, constrained by available disk space
- **Peer Limits**: WebTorrent handles peer connections automatically
- **Bandwidth**: Configure upload limits if needed for production

### Optimization

- **Deduplication**: SHA256 content addressing prevents duplicate storage
- **Selective Seeding**: Only seed files that have been requested recently
- **Tracker Rotation**: Use multiple trackers for redundancy

## Security Considerations

### File Access Control

- **Authentication Required**: Private files require JWT token
- **Ownership Verification**: Files linked to user's HD wallet public key
- **Cross-User Privacy**: Users cannot access other users' private files

### Network Security

- **Tracker Trust**: Uses public WebSocket trackers (consider private trackers for production)
- **Peer Verification**: WebTorrent protocol provides integrity checking
- **Firewall Friendly**: Uses WebSocket connections, no special port requirements

## Troubleshooting

### Service Won't Start

1. **Check WebTorrent Version**
   ```bash
   npm list webtorrent
   # Should show 1.9.7, not 2.x
   ```

2. **Verify Directory Permissions**
   ```bash
   mkdir -p data/media
   ls -ld data/media
   ```

3. **Test Manual Initialization**
   ```bash
   node -e "const { getMediaSeeder } = require('./services/mediaSeeder'); getMediaSeeder().initialize().then(s => console.log('Success:', s))"
   ```

### Files Not Seeding

1. **Check Seeding State**
   ```bash
   cat data/media/seeder.json
   ```

2. **Verify File Exists**
   ```bash
   ls -la data/media/<mediaId>/original
   ```

3. **Test Tracker Connectivity**
   ```bash
   # Use WebTorrent client to test tracker
   node -e "const WebTorrent = require('webtorrent'); const client = new WebTorrent(); console.log('Client created');"
   ```

### No Peers Connecting

1. **Verify Tracker URLs**
   - Ensure trackers are accessible from your network
   - Test with alternative public trackers

2. **Check Firewall Settings**
   - WebSocket connections should be allowed
   - No special port forwarding needed

3. **Monitor Logs**
   - Look for tracker connection errors
   - Verify magnet URIs are being generated

## Integration Examples

### Upload and Seed Media File

```javascript
// Complete upload flow
async function uploadAndSeedFile(filePath, user) {
  // 1. Upload file
  const formData = new FormData();
  formData.append('file', fs.createReadStream(filePath));
  formData.append('access_level', 'private');
  
  const uploadResponse = await fetch('/api/media/upload', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${user.token}` },
    body: formData
  });
  
  const uploadResult = await uploadResponse.json();
  
  // 2. File is now being seeded automatically
  console.log('🧲 Magnet URI:', uploadResult.magnetURI);
  console.log('📁 Media ID:', uploadResult.mediaId);
  
  return uploadResult;
}
```

### Check Seeding Status

```javascript
// Monitor seeding progress
async function checkSeedingStatus() {
  const seeder = getMediaSeeder();
  const stats = seeder.getStats();
  
  console.log(`📊 Seeding Statistics:`);
  console.log(`   Files: ${stats.seedingCount}`);
  console.log(`   Peers: ${stats.peers}`);
  console.log(`   Uploaded: ${(stats.totalUploaded / 1024 / 1024).toFixed(2)} MB`);
  
  return stats;
}
```

### Download via Magnet URI

```javascript
// Client-side download using WebTorrent
import WebTorrent from 'webtorrent';

async function downloadViaMagnet(magnetURI) {
  const client = new WebTorrent();
  
  return new Promise((resolve, reject) => {
    client.add(magnetURI, (torrent) => {
      console.log('📥 Downloading:', torrent.name);
      
      torrent.on('done', () => {
        console.log('✅ Download complete');
        resolve(torrent.files);
      });
      
      torrent.on('error', reject);
    });
  });
}
```

## Future Enhancements

### Planned Features

1. **Selective Seeding**: Only seed recently accessed files
2. **Bandwidth Limits**: Configurable upload/download limits  
3. **Peer Metrics**: Detailed peer connection statistics
4. **Health Monitoring**: Automated health checks and alerts
5. **Tracker Management**: Dynamic tracker addition/removal

### Integration Opportunities

1. **IPFS Integration**: Dual-seed files on both BitTorrent and IPFS
2. **CDN Fallback**: Use CDN when P2P peers unavailable
3. **Mobile Clients**: WebTorrent support in mobile applications
4. **Analytics**: Track download patterns and peer geography

## Conclusion

The MediaSeeder service provides robust P2P file distribution for the OIP ecosystem, enabling decentralized media sharing while maintaining server-based reliability. Its integration with HD wallets ensures proper ownership and privacy controls, making it suitable for both public and private media distribution.

For implementation details, see the source code in `services/mediaSeeder.js` and related media routes in `routes/media.js`.
