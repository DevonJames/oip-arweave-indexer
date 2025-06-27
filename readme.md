# OIPArweave - Open Index Protocol for Arweave & Irys

OIPArweave is a comprehensive indexing and publishing system for blockchain records following the Open Index Protocol (OIP) specification. It indexes "OIP" records from the Arweave blockchain into a local Elasticsearch database for fast JSON-based interactions, while also supporting record publishing to both Arweave (via ArDrive Turbo SDK) and Irys networks.

## Key Features

- **Dual Blockchain Support**: Publish records to either Arweave (via ArDrive Turbo SDK) or Irys network
- **Multi-Network Media Publishing**: Store media across multiple decentralized networks with DID addresses
- **Blockchain Indexing**: Automatically indexes Arweave transactions with OIP tags
- **Elasticsearch Integration**: Local database for fast querying and JSON interactions
- **AI-Powered Features**:
  - Document analysis and summarization
  - AI-generated podcasts from news records
  - Automatic author and date extraction from articles
  - Recipe ingredient analysis and nutritional information lookup
- **Enhanced Media Support**: Handles images, videos, audio, and text with multiple storage options:
  - **Arweave/Irys**: Primary blockchain storage
  - **IPFS**: Content-addressed distributed storage
  - **ArFleet**: Time-limited decentralized storage
  - **BitTorrent**: Peer-to-peer distribution (automatic)
- **DID Addressing**: All media stored with proper Decentralized Identifier (DID) addresses
- **Embedded Records**: Supports nested records to avoid data duplication
- **Web Scraping**: Archive web articles and recipes to the permaweb

## System Requirements

### Prerequisites

- Docker & Docker Compose
- Node.js (version 16 or higher if running locally without Docker)
- Arweave wallet (for publishing)
- API Keys (for AI features):
  - OpenAI API key
  - Twitter Bearer Token (for tweet scraping)
  - ElevenLabs API key (for speech synthesis)
- Optional: Local IPFS node for IPFS storage
- Optional: ArFleet client for temporary storage

### Canvas Module Dependencies

The `canvas` module is required for image processing. Install system dependencies:

**Ubuntu/Debian:**
```bash
sudo apt-get install build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
```

**macOS:**
```bash
brew install pkg-config cairo pango libpng jpeg giflib librsvg
```

**Windows:**
See the [node-canvas Wiki](https://github.com/Automattic/node-canvas/wiki/Installation:-Windows) for setup instructions.

## Installation

### 1. Clone the repository
```bash
git clone https://github.com/yourusername/OIPArweave.git
cd OIPArweave
```

### 2. Install dependencies
```bash
npm install
```

### 3. Environment Configuration

Create an `.env` file in the project root:

```env
# Arweave Configuration
WALLET_FILE=config/arweave-keyfile.json
# Turbo SDK will use default endpoints

# Server Configuration
PORT=3005

# Elasticsearch Configuration
ELASTICSEARCHHOST=http://elasticsearch:9200
ELASTICCLIENTUSERNAME=elastic
ELASTICCLIENTPASSWORD=tVUsFYYXexZshWT3Jbhx

# API Keys (Required for AI features)
OPENAI_API_KEY=your-openai-api-key
TWITTER_BEARER_TOKEN=your-twitter-bearer-token
ELEVENLABS_API_KEY=your-elevenlabs-api-key
ANTHROPIC_API_KEY=your-anthropic-api-key

# Optional Services
FIRECRAWL_API_KEY=your-firecrawl-api-key
X_API_KEY=your-x-api-key

# Lit Protocol (for content encryption)
LIT_PKP_PRIVATE_KEY=your-lit-pkp-private-key

# Bitcoin HD Wallet (for payment features)
BTC_SEED_PHRASE=your-bitcoin-seed-phrase

# Media Storage Configuration (Optional)
IPFS_HOST=localhost
IPFS_PORT=5001
ARFLEET_CLIENT_PATH=./arfleet
```

### 4. Arweave Wallet Setup

1. Create a new Arweave wallet at [Arweave.app](https://arweave.app)
2. Click **Backup Keyfile** and save as `config/arweave-keyfile.json`
3. Fund your wallet with AR tokens for publishing

### 5. Docker Deployment

#### Quick Start (Minimal Setup)

For a lightweight installation with just the core services (Elasticsearch, Kibana, and OIP API):

```bash
# Make deployment script executable
chmod +x deploy.sh

# Start minimal deployment (recommended for first-time users)
./deploy.sh up minimal
```

This starts only the essential services:
- ✅ **Elasticsearch** (database)
- ✅ **Kibana** (data visualization) 
- ✅ **OIP API server** (core functionality)

Your OIP API will be available at: `http://localhost:3005`

#### Other Deployment Options

Need additional services like IPFS, Speech Synthesis, Text Generation, GPU acceleration, or GPU-optimized AI services? 

📖 **See [DEPLOYMENT.md](DEPLOYMENT.md) for all deployment options:**
- `minimal` - Core services only (recommended for beginners)
- `standard` - Full distributed stack with all services
- `full` - All services in one container (monolithic)
- `gpu` - GPU-optimized deployment for RTX 4090 machines
- `oip-gpu-only` - Minimal GPU service for existing stacks
- `standard-gpu` - Complete stack with GPU acceleration

#### Alternative Commands

You can also use:
```bash
# Using Make
make minimal                    # Start minimal profile
make rebuild PROFILE=minimal    # Rebuild minimal profile with --no-cache

# Using Docker Compose directly  
docker-compose --profile minimal up -d
```

**Need a fresh build?** Use the `rebuild` command to force a complete rebuild without Docker cache:
```bash
# Rebuild minimal setup with no cache
make rebuild PROFILE=minimal

# Rebuild any profile with no cache
make rebuild PROFILE=standard
make rebuild PROFILE=standard-gpu
```

## Ngrok Domain Configuration

Set your custom domain in the `.env` file:

```bash
# For GPU nodes with custom domain
NGROK_DOMAIN=api.oip.onl

# For other nodes with custom domains  
NGROK_DOMAIN=mynode.example.com

# Leave empty for random ngrok URLs
NGROK_DOMAIN=
```

**Note**: The `docker-compose-for4090.yml` file is no longer used and can be safely deleted. All deployments now use the main `docker-compose.yml` with configurable domains.

## Enhanced Media Publishing System

### Multi-Network Storage with DID Addresses

The system now properly implements multi-network media publishing with Decentralized Identifier (DID) addresses. Media files are stored across multiple networks and referenced in records with their respective DIDs.

#### Record Structure

**Before (Legacy):**
```json
{
  "image": {
    "webUrl": "https://api.oip.onl/api/media?id=hash"
  }
}
```

**After (Enhanced):**
```json
{
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
```

### Media Publishing Flags

Control which networks to use for media storage:

```javascript
// Available flags:
publishFiles = true/false        // Whether to process media at all
addMediaToArweave = true/false   // Publish to Arweave (default: true)
addMediaToIPFS = true/false      // Publish to IPFS (default: false)
addMediaToArFleet = true/false   // Publish to ArFleet (default: false)
// BitTorrent is always enabled for distribution redundancy
```

#### Flag Behavior

- **Without `publishFiles`**: Only metadata JSON published, original URLs preserved
- **With `publishFiles=true`**: Media processed and published according to flags
- **Default networks**: Arweave + BitTorrent (if no specific flags set)

## API Endpoints

### Enhanced Publishing Endpoints

#### Publish Record with Media Control
`POST /api/records/newRecord`

```json
{
  "blockchain": "arweave",
  "publishFiles": true,
  "addMediaToArweave": true,
  "addMediaToIPFS": true,
  "addMediaToArFleet": false,
  "basic": {
    "name": "My Record with Media"
  },
  "image": {
    "webUrl": "https://example.com/image.jpg"
  }
}
```

#### Publish Video with Multi-Network Storage
`POST /api/publish/newVideo`

```json
{
  "youtubeUrl": "https://youtube.com/watch?v=123",
  "basicMetadata": {
    "name": "My Video",
    "description": "Video description"
  },
  "publishTo": {
    "arweave": true,
    "ipfs": true,
    "arfleet": false,
    "bittorrent": true
  },
  "blockchain": "arweave"
}
```

#### General Media Publishing
`POST /api/publish/newMedia`

```json
{
  "mediaUrl": "https://example.com/document.pdf",
  "contentType": "application/pdf",
  "basicMetadata": {
    "name": "Important Document"
  },
  "publishTo": {
    "arweave": true,
    "ipfs": true
  }
}
```

### Records Management

#### Create New Record
`POST /api/records/newRecord`

**New Feature**: Blockchain selection
```json
{
  "blockchain": "arweave",  // or "irys" (optional, defaults to "arweave")
  "basic": {
    "name": "Sample Record",
    "language": "en"
  }
}
```

Query Parameters:
- `recordType` - Required, template name
- `blockchain` - Optional, "arweave" or "irys"
- `publishFiles` - Optional, enable media processing
- `addMediaToArweave` - Optional, publish media to Arweave
- `addMediaToIPFS` - Optional, publish media to IPFS
- `addMediaToArFleet` - Optional, publish media to ArFleet

#### Get Records
`GET /api/records`

Query Parameters:
- `resolveDepth` - Resolve embedded records (0-3)
- `sortBy` - Sort field (e.g., `inArweaveBlock:desc`)
- `limit` - Number of results
- `recordType` - Filter by type
- `creatorHandle` - Filter by creator

### Publishing Endpoints

#### Publish Recipe
`POST /api/publish/newRecipe`
```json
{
  "blockchain": "arweave",
  "recipe": {
    "basic": {
      "name": "Chocolate Cake"
    },
    "recipe": [{
      "section": "Main",
      "ingredient": ["flour", "sugar"],
      "ingredient_amount": [2, 1],
      "ingredient_unit": ["cups", "cup"]
    }]
  }
}
```

#### Publish Video with Access Control
`POST /api/publish/newVideo`
```json
{
  "blockchain": "arweave",
  "videoFile": "base64-encoded-video",
  "accessControl": {
    "price": 0.001,
    "currency": "BTC"
  },
  "basicMetadata": {
    "name": "My Video",
    "description": "Video description"
  }
}
```

### AI-Powered Scraping

#### Scrape & Archive Article
`POST /api/scrape/article`
```json
{
  "url": "https://example.com/article",
  "html": "optional-html-content",
  "userId": "user123",
  "blockchain": "arweave",
  "screenshots": [],
  "totalHeight": 1200
}
```

Features:
- Automatic text summarization
- AI-generated audio narration
- Author and date extraction
- Tag generation
- Screenshot archival

#### Scrape Recipe
`POST /api/scrape/recipe`
```json
{
  "url": "https://example.com/recipe",
  "userId": "user123",
  "blockchain": "arweave"
}
```

Features:
- Ingredient extraction and normalization
- Nutritional information lookup
- Automatic unit conversion
- Multi-section recipe support

### AI Generation

#### Generate Chat Response
`POST /api/generate/chat`
```json
{
  "userInput": "Tell me about blockchain",
  "conversationHistory": [],
  "personality": {
    "name": "Assistant",
    "model": "grok-2",
    "temperature": 0.7
  }
}
```

#### Text-to-Speech
`POST /api/generate/tts`
```json
{
  "text": "Hello world",
  "voice": "rachel",
  "modelId": "eleven_turbo_v2"
}
```

### Templates

#### Get Templates
`GET /api/templates`

#### Create Template
`POST /api/templates/newTemplate`
```json
{
  "blockchain": "arweave",
  "templateName": {
    "field1": "string",
    "field2": "enum",
    "field2Values": [
      {"code": "val1", "name": "Value 1"},
      {"code": "val2", "name": "Value 2"}
    ]
  }
}
```

### Creators

#### Register Creator
`POST /api/creators/newCreator`
```json
{
  "blockchain": "arweave",
  "creatorRegistration": {
    "handle": "myhandle",
    "surname": "Smith"
  }
}
```

## Blockchain Publishing

### Choosing a Blockchain

All publishing endpoints accept an optional `blockchain` parameter:

- **`"arweave"`** (default) - Publishes to Arweave using Turbo SDK
  - Permanent storage
  - Higher cost
  - Ideal for long-term archival

- **`"irys"`** - Publishes to Irys network
  - Different cost structure
  - Fast data availability
  - Good for frequently accessed data

Example:
```bash
curl -X POST http://localhost:3005/api/records/newRecord \
  -H "Content-Type: application/json" \
  -d '{
    "blockchain": "irys",
    "recordType": "post",
    "basic": {"name": "My Post"}
  }'
```

## Multi-Network Storage System

The enhanced media publishing system supports multiple storage backends with proper DID addressing:

### Supported Networks

1. **Arweave** (via Turbo) - Primary blockchain storage
   - **DID Format**: `did:arweave:{transaction_id}`
   - **URL**: `https://arweave.net/{id}`
   - Permanent storage on the permaweb
   - Default option for all media

2. **Irys** - Alternative blockchain storage
   - **DID Format**: `did:irys:{transaction_id}`
   - **URL**: `https://gateway.irys.xyz/{id}`
   - Fast data availability
   - Alternative to Arweave

3. **IPFS** - Content-addressed distributed storage
   - **DID Format**: `did:ipfs:{cid}`
   - **URL**: `https://ipfs.io/ipfs/{cid}`
   - Content deduplication
   - Distributed network storage

4. **ArFleet** - Time-limited decentralized storage
   - **DID Format**: `did:arfleet:{arfleet_id}`
   - **URL**: `arfleet://{id}`
   - Temporary storage (30 days default)
   - Cost-effective for temporary content

5. **BitTorrent** - Peer-to-peer distribution
   - **DID Format**: `did:bittorrent:{info_hash}`
   - **URL**: `magnet:?xt=urn:btih:{hash}`
   - Always enabled for redundancy
   - Excellent for content distribution

### Usage Examples

#### URL-Only Publishing (No Media Processing)
```javascript
const record = {
  basic: { name: "Article" },
  image: { webUrl: "https://example.com/image.jpg" }
};

// publishFiles = false, so original URL is preserved
await publishNewRecord(record, 'post', false);
```

#### Multi-Network Media Publishing
```bash
curl -X POST http://localhost:3005/api/records/newRecord \
  -H "Content-Type: application/json" \
  -d '{
    "recordType": "post",
    "publishFiles": true,
    "addMediaToArweave": true,
    "addMediaToIPFS": true,
    "addMediaToArFleet": false,
    "basic": {"name": "My Post"},
    "image": {"webUrl": "https://example.com/image.jpg"}
  }'
```

#### YouTube Video Processing
```bash
curl -X POST http://localhost:3005/api/publish/newVideo \
  -H "Content-Type: application/json" \
  -d '{
    "youtubeUrl": "https://youtube.com/watch?v=123",
    "publishTo": {
      "arweave": true,
      "ipfs": true,
      "bittorrent": true
    }
  }'
```

## Monitoring & Analytics

- **Elasticsearch**: Browse indexed data at http://localhost:9200
- **Kibana**: Visualize data at http://localhost:5601
- **Health Check**: `GET /api/health`

## Development

### Running Tests

```bash
# Run all tests
npm test

# Run media publishing tests only
npm run test:media

# Run publisher manager tests
npm run test:publisher
```

### Test Coverage

The test suite includes:
- **Media Publishing Tests**: Multi-network publishing, DID formatting, error handling
- **Publisher Manager Tests**: Blockchain publishing, configuration validation
- **Integration Tests**: Flag behavior, record updating
- **Error Handling Tests**: Network failures, validation

### Testing Publisher Manager
```bash
# Test balance and pricing
node test/test-publisher.js

# Test Arweave publishing
node test/test-publisher.js --publish-arweave

# Test Irys publishing  
node test/test-publisher.js --publish-irys
```

### Manual Testing

1. **Start the backend services**:
   ```bash
   ./deploy.sh up minimal
   ```

2. **Test basic media publishing**:
   ```bash
   curl -X POST http://localhost:3005/api/publish/newMedia \
     -H "Content-Type: application/json" \
     -d '{
       "mediaUrl": "https://example.com/test.jpg",
       "contentType": "image/jpeg",
       "basicMetadata": {"name": "Test Image"},
       "publishTo": {"arweave": true, "ipfs": true}
     }'
   ```

## Documentation

Comprehensive documentation is available:

- **Media Publishing System**: `docs/MEDIA_PUBLISHING.md` - Complete guide to the multi-network media system
- **API Documentation**: Available in endpoint comments and test files
- **Configuration Guide**: See environment variables section above
- **Troubleshooting**: Common issues and solutions below

## Troubleshooting

### Common Issues

1. **Canvas module errors**: Ensure system dependencies are installed
2. **Elasticsearch connection**: Check Docker containers are running with `./deploy.sh status`
3. **Publishing fails**: Verify wallet has sufficient funds
4. **AI features not working**: Check API keys in `.env`
5. **IPFS publishing fails**: Ensure IPFS node is running on localhost:5001
6. **ArFleet errors**: Check ArFleet client is available and executable
7. **Media processing timeouts**: Increase timeout or check network connectivity

### Debug Mode

Enable debug logging:
```bash
DEBUG=media-manager npm start  # For media publishing debug
DEBUG=* npm start              # For all debug output
```

### Media Publishing Debug

Set environment variable for verbose media processing logs:
```bash
DEBUG=media-manager npm start
```

## Migration Notes

### Backward Compatibility

- Existing records continue to work unchanged
- Old API endpoints maintain current behavior by default
- New functionality is opt-in via `publishFiles` and network flags

### Gradual Migration

1. **Phase 1**: Deploy new system with default behavior unchanged
2. **Phase 2**: Enable multi-network publishing for new records
3. **Phase 3**: Optionally migrate existing records to new format

## License

MIT License - see LICENSE file for details

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Support

For issues and questions:
- Open an issue on GitHub
- Check existing documentation in `/docs`
- Review test files for usage examples
- See `docs/MEDIA_PUBLISHING.md` for detailed media system documentation
