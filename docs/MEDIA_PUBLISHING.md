# Media Publishing System Documentation

## Overview

The OIP Arweave system now properly implements multi-network media publishing with DID (Decentralized Identifier) addresses, allowing media to be stored across multiple decentralized networks while maintaining immutable records on Arweave.

## Architecture

### Core Components

1. **MediaManager** (`helpers/media-manager.js`)
   - Handles media processing from various sources (URL, file, base64, YouTube)
   - Publishes to multiple networks simultaneously 
   - Formats results into DID addresses
   - Updates record metadata with storage network information

2. **Enhanced TemplateHelper** (`helpers/templateHelper.js`)
   - Integrates MediaManager into the publishing flow
   - Processes media flags correctly
   - Maintains backward compatibility

3. **Updated Publish Routes** (`routes/publish.js`)
   - New endpoints for media-specific publishing
   - Proper flag handling for different storage networks
   - Support for access control and encryption

## Supported Networks

### Primary Blockchain Storage
- **Arweave** (via Turbo): Permanent storage, default option
- **Irys**: Alternative blockchain storage option

### Distributed Storage
- **IPFS**: Content-addressed storage network
- **ArFleet**: Temporary/time-limited storage option
- **BitTorrent**: Peer-to-peer distribution (always enabled for redundancy)

## Media Publishing Flags

### Flag Behavior

The media publishing flags now work as intended:

```javascript
// Flag meanings:
publishFiles = true/false     // Whether to process media at all
addMediaToArweave = true/false // Publish to Arweave network
addMediaToIPFS = true/false    // Publish to IPFS network  
addMediaToArFleet = true/false // Publish to ArFleet network
// BitTorrent is always enabled for distribution redundancy
```

### Default Behavior
- **Without flags**: Only metadata JSON is published to blockchain, original URLs preserved
- **With publishFiles=true**: Media is processed and published according to other flags
- **Default networks**: Arweave + BitTorrent (if no specific flags set)

## Record Structure

### Before (Current/Broken Implementation)
```json
{
  "data": {
    "post": {
      "featuredImage": {
        "data": {
          "image": {
            "webUrl": "https://api.oip.onl/api/media?id=hash",
            "contentType": "image/jpeg"
          }
        }
      }
    }
  }
}
```

### After (New Implementation)
```json
{
  "data": {
    "post": {
      "featuredImage": {
        "data": {
          "image": {
            "originalUrl": "https://example.com/original.jpg",
            "storageNetworks": [
              {
                "network": "arweave",
                "did": "did:arweave:abc123",
                "url": "https://arweave.net/abc123",
                "provider": "turbo"
              },
              {
                "network": "ipfs",
                "did": "did:ipfs:def456", 
                "url": "https://ipfs.io/ipfs/def456",
                "provider": "ipfs"
              },
              {
                "network": "bittorrent",
                "did": "did:bittorrent:ghi789",
                "url": "magnet:?xt=urn:btih:ghi789",
                "provider": "bittorrent"
              }
            ],
            "contentType": "image/jpeg"
          }
        }
      }
    }
  }
}
```

## API Endpoints

### Enhanced Existing Endpoints

All existing publish endpoints now support proper media handling:

```javascript
// Example: Publishing a post with media
POST /api/publish/newPost
{
  "basic": {
    "name": "My Post",
    "description": "Post with media"
  },
  "post": {
    "webUrl": "https://example.com/article"
  },
  "image": {
    "webUrl": "https://example.com/image.jpg"
  },
  "publishFiles": true,
  "addMediaToArweave": true,
  "addMediaToIPFS": true,
  "blockchain": "arweave"
}
```

### New Media-Specific Endpoints

#### Video Publishing
```javascript
POST /api/publish/newVideo
{
  "youtubeUrl": "https://youtube.com/watch?v=123",  // OR
  "videoUrl": "https://example.com/video.mp4",      // OR  
  "videoFile": "base64_encoded_video_data",
  "basicMetadata": {
    "name": "Video Title",
    "description": "Video description"
  },
  "publishTo": {
    "arweave": true,
    "ipfs": true,
    "bittorrent": true
  },
  "blockchain": "arweave"
}
```

#### General Media Publishing
```javascript
POST /api/publish/newMedia
{
  "mediaUrl": "https://example.com/file.pdf",       // OR
  "mediaFile": "base64_encoded_data",
  "contentType": "application/pdf",
  "basicMetadata": {
    "name": "Document Title"
  },
  "publishTo": {
    "arweave": true,
    "arfleet": true
  }
}
```

## Usage Examples

### 1. URL-Only Publishing (No Media Processing)
```javascript
const record = {
  basic: { name: "Article" },
  image: { webUrl: "https://example.com/image.jpg" }
};

// publishFiles = false, so original URL is preserved
await publishNewRecord(record, 'post', false);
```

### 2. Multi-Network Media Publishing
```javascript
const record = {
  basic: { name: "Article" },
  image: { webUrl: "https://example.com/image.jpg" }
};

// Process and publish media to multiple networks
await publishNewRecord(
  record, 
  'post',
  true,  // publishFiles
  true,  // addMediaToArweave  
  true,  // addMediaToIPFS
  null,  // youtubeUrl
  'arweave', // blockchain
  false  // addMediaToArFleet
);
```

### 3. YouTube Video Processing
```javascript
const record = {
  basic: { name: "Video Post" },
  video: { webUrl: "https://youtube.com/watch?v=123" }
};

await publishNewRecord(
  record,
  'video', 
  true,
  true,  // Arweave
  false, // IPFS
  "https://youtube.com/watch?v=123",
  'arweave'
);
```

## DID Format Specification

### Network-Specific DID Formats
- **Arweave**: `did:arweave:{transaction_id}`
- **Irys**: `did:irys:{transaction_id}` 
- **IPFS**: `did:ipfs:{cid}`
- **ArFleet**: `did:arfleet:{arfleet_id}`
- **BitTorrent**: `did:bittorrent:{info_hash}`

### URL Mappings
- **Arweave**: `https://arweave.net/{id}`
- **Irys**: `https://gateway.irys.xyz/{id}`
- **IPFS**: `https://ipfs.io/ipfs/{cid}`
- **ArFleet**: `arfleet://{id}` 
- **BitTorrent**: `magnet:?xt=urn:btih:{hash}`

## Testing

### Unit Tests
Run the comprehensive test suite:

```bash
npm test                    # Run all tests
npm run test:media         # Run media publishing tests only
```

### Test Coverage
- Media processing from different sources
- Multi-network publishing
- Error handling and fallbacks  
- DID formatting
- Record metadata updates
- Flag behavior validation

### Manual Testing
1. **Start the backend services**:
   ```bash
   ./start.sh
   ```

2. **Test basic media publishing**:
   ```bash
   curl -X POST http://localhost:3000/api/publish/newMedia \
     -H "Content-Type: application/json" \
     -d '{
       "mediaUrl": "https://example.com/test.jpg",
       "contentType": "image/jpeg",
       "basicMetadata": {"name": "Test Image"},
       "publishTo": {"arweave": true, "ipfs": true}
     }'
   ```

## Error Handling

### Network Failures
- Individual network failures don't stop the entire process
- Partial success is recorded with error details
- Retry logic for transient failures

### Validation
- Content type validation
- File size limits
- Network availability checks
- Wallet/key validation

## Configuration

### Environment Variables
```bash
# Required for Arweave
WALLET_FILE=path/to/arweave-wallet.json
TURBO_URL=https://turbo.ardrive.io

# Optional network configurations  
IPFS_HOST=localhost
IPFS_PORT=5001
ARFLEET_CLIENT_PATH=./arfleet
```

### Dependencies
All required dependencies are in `package.json`:
- `@ardrive/turbo-sdk` - Arweave/Turbo publishing
- `ipfs-http-client` - IPFS integration
- `webtorrent` - BitTorrent functionality
- Additional testing dependencies (mocha, sinon, chai)

## Migration Notes

### Backward Compatibility
- Existing records continue to work unchanged
- Old API endpoints maintain current behavior by default
- New functionality is opt-in via flags

### Gradual Migration
1. **Phase 1**: Deploy new system with default behavior unchanged
2. **Phase 2**: Enable multi-network publishing for new records
3. **Phase 3**: Optionally migrate existing records to new format

## Troubleshooting

### Common Issues
1. **Missing wallet file**: Ensure `WALLET_FILE` environment variable is set
2. **IPFS not running**: Start local IPFS node or configure remote gateway
3. **ArFleet client**: Ensure ArFleet client binary is available and executable
4. **Network timeouts**: Check internet connectivity and network configurations

### Debug Mode
Set `DEBUG=media-manager` for verbose logging of media processing operations.

## Security Considerations

### Access Control
- Lit Protocol integration for encrypted content
- Bitcoin payment conditions for premium content
- Public key verification for content authenticity

### Privacy
- Original URLs are preserved but can be omitted
- Content can be encrypted before network distribution
- Metadata includes creator signatures for verification

---

*Last updated: January 2025*
*Version: 1.0.0* 