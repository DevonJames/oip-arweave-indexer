# Project Split Outline: oip-daemon vs dweb-server

## 📊 **High-Level Philosophy**

**oip-daemon** = Pure OIP protocol implementation - the "library" layer
**dweb-server** = Application layer that uses OIP + adds decentralized features

## 🎯 **Part 1: oip-daemon** 
### Core Open Index Protocol Functionality Only

#### **Purpose**
A focused, lightweight service for blockchain-indexed record storage and retrieval using the Open Index Protocol. This is the foundational layer that any application can use.

#### **Core Responsibilities**
- Template-based record compression/decompression
- Blockchain publishing (Arweave)
- Elasticsearch indexing and search
- Record retrieval with dref resolution
- User authentication (HD wallet/DID-based)
- Basic API endpoints for CRUD operations

---

### **Files/Directories to KEEP in oip-daemon**

#### **Configuration**
```
config/
├── arweave.config.js          # Arweave connection config
├── checkEnvironment.js         # Environment validation
├── createIndices.js            # Elasticsearch index setup
├── templates.config.js         # Template mappings
├── recordTypesToIndex.js       # Which record types to index
├── createAdmin.js              # Admin user creation
├── generateToken.js            # JWT token generation
├── generateWallet.js           # HD wallet generation
└── updateElasticsearchMappings.js
```

#### **Core Helpers**
```
helpers/
├── arweave.js                  # Arweave blockchain integration
├── arweave-wallet.js           # Wallet management
├── elasticsearch.js            # ES indexing/search (CORE)
├── templateHelper.js           # Template expansion/compression
├── dref-resolver.js            # Reference resolution
├── generators.js               # Record ID generation
├── utils.js                    # Utility functions
├── file.js                     # File operations
├── urlHelper.js                # URL utilities
└── apiConfig.js                # API configuration
```

#### **Core Routes**
```
routes/
├── api.js                      # Root API endpoint
├── records.js                  # Record CRUD operations
├── templates.js                # Template management
├── creators.js                 # Creator registration/lookup
├── user.js                     # User auth (register/login)
├── wallet.js                   # HD wallet operations
├── publish.js                  # Record publishing
└── health.js                   # Health checks (basic only)
```

#### **Middleware**
```
middleware/
├── auth.js                     # JWT authentication
└── apiLogger.js                # Request logging
```

#### **Root Files**
```
index.js                        # Main entry point
server.js                       # Express server (stripped down)
package.json                    # Dependencies (minimal)
Dockerfile                      # Build for oip-daemon only
docker-compose.yml              # Elasticsearch + oip-daemon only
.env                            # Environment configuration
Makefile                        # Build/deploy commands (simplified)
```

#### **Documentation**
```
docs/
├── API_RECORDS_ENDPOINT_DOCUMENTATION.md
├── API_PUBLISH_DOCUMENTATION.md
├── OIP_TECHNICAL_OVERVIEW.md
├── ELASTICSEARCH_COMPREHENSIVE_GUIDE.md
└── HD_WALLET_GUIDE.md
```

---

### **Core Functionality**

#### **1. Template System**
- Template registration and storage
- Field-to-index compression
- Template-based record validation
- Dynamic template lookup

#### **2. Record Publishing**
- Blockchain submission (Arweave)
- Signature generation and verification
- Transaction tracking
- Record compression

#### **3. Elasticsearch Indexing**
- Record indexing
- Full-text search
- Field-specific queries
- Advanced filtering (tags, dates, types)

#### **4. Record Retrieval**
- Query API (`GET /api/records`)
- Dref resolution (configurable depth)
- Pagination and sorting
- Field projection

#### **5. Authentication**
- HD wallet generation (BIP-39/BIP-32)
- User registration/login
- JWT token management
- Optional authentication for private records

#### **6. Creator Management**
- Creator registration
- Public key management
- Creator lookup

---

### **API Surface (oip-daemon)**

```
Core Record Operations:
GET    /api/records               # Query/search records
POST   /api/records/newRecord     # Publish new record  
GET    /api/records/recordTypes   # Get record type summary
POST   /api/records/deleteRecord  # Delete owned record

Template Operations:
GET    /api/templates             # Get all templates
GET    /api/templates/:name       # Get specific template
POST   /api/templates/new         # Publish new template

Creator Operations:
GET    /api/creators              # List creators
POST   /api/creators/register     # Register creator

Authentication:
POST   /api/user/register         # Register user
POST   /api/user/login            # Login user
GET    /api/user/mnemonic         # Export mnemonic

Wallet:
POST   /api/wallet/generate       # Generate HD wallet
POST   /api/wallet/import         # Import wallet from mnemonic

Health:
GET    /health                    # Basic health check
GET    /api/health/elasticsearch  # ES connection status
```

---

### **Docker Services (oip-daemon)**

```yaml
services:
  elasticsearch:
    # Elasticsearch for indexing
    
  oip-daemon:
    # Core OIP service
    # No AI dependencies
    # No media seeding
    # No voice services
    # Just pure OIP functionality
```

---

### **Key Dependencies (oip-daemon)**

**Minimal - Only what OIP needs:**
```json
{
  "dependencies": {
    "@elastic/elasticsearch": "^8.17.0",
    "arweave": "^1.15.5",
    "express": "^4.19.2",
    "body-parser": "^1.20.2",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "jsonwebtoken": "^9.0.2",
    "bcrypt": "^5.1.1",
    "bip39": "^3.1.0",
    "bip32": "^4.0.0",
    "tiny-secp256k1": "^2.2.3",
    "uuid": "^9.0.1",
    "multer": "^2.0.2",
    "axios": "^1.7.9"
  }
}
```

**NO:**
- AI/LLM packages
- Media processing libraries
- WebTorrent, IPFS
- GUN
- Voice processing
- Image generation

---

## 🌐 **Part 2: dweb-server**
### Everything Else - The Application Layer

#### **Purpose**
A comprehensive decentralized publishing platform built ON TOP of OIP, integrating AI, P2P distribution, encrypted storage, and anonymous publishing capabilities.

#### **Core Responsibilities**
- AI-powered features (Alfred RAG, content generation)
- Voice interface (STT/TTS)
- Decentralized storage (GUN, IPFS, BitTorrent)
- Media distribution and seeding
- Organization management
- Advanced content features (recipes, workouts, photo analysis)
- Tor integration for anonymous publishing
- Real-time features (WebSockets)
- Client applications

---

### **Files/Directories to MOVE to dweb-server**

#### **AI & Voice Services**
```
Routes:
routes/
├── alfred.js                   # AI assistant
├── voice.js                    # Voice interface
├── generate.js                 # Content generation
├── narration.js                # Audio narration
└── photo.js                    # Photo analysis

Helpers:
helpers/
├── alfred.js                   # AI/RAG core
├── adaptiveChunking.js         # Text chunking for AI
├── streamingCoordinator.js     # Streaming responses
├── podcast-generator.js        # Podcast creation
├── nutritional-helper.js       # AI nutritional analysis
└── nutritional-helper-openai.js
```

#### **Media & P2P Distribution**
```
Services:
services/
├── mediaSeeder.js              # BitTorrent/WebTorrent seeding
└── swapDataService.js

Routes:
routes/
├── media.js                    # Media upload/streaming

Helpers:
helpers/
├── media-manager.js            # Media file handling
├── ipfs.js                     # IPFS integration
├── playdl.js                   # YouTube/media download
```

#### **GUN Network Integration**
```
Helpers:
helpers/
├── gun.js                      # GUN database integration
├── gunSyncService.js           # Cross-node sync
├── oipGunRegistry.js           # GUN record registry
├── privateRecordHandler.js    # Encrypted records
├── organizationEncryption.js  # Org-level encryption
├── organizationDecryptionQueue.js
└── sharedState.js              # State management

Server:
gun-relay-server.js             # GUN relay HTTP API
```

#### **Advanced Content Features**
```
Routes:
routes/
├── recipes.js                  # Recipe management + AI images
├── workout.js                  # Workout management
├── scrape.js                   # Web scraping
├── organizations.js            # Organization management
├── cleanup.js                  # Data cleanup
├── jfk.js                      # Special content
└── documentation.js            # Dynamic docs

Helpers:
helpers/
├── migrate-nutritional-helper.js
└── test-nutritional-helper.js
```

#### **Blockchain Alternatives & Advanced Features**
```
Helpers:
helpers/
├── lit-protocol.js             # Decentralized access control
├── mint-pkp.js                 # Programmable key pairs
├── payment-manager.js          # Payment integration
├── payment-verification.js
└── publisher-manager.js        # Multi-publisher support

Routes:
routes/
├── lit.js                      # Lit Protocol routes
└── publish.mjs                 # Advanced publishing
```

#### **Client Applications**
```
client/                         # Web client (if exists)
frontend/                       # Next.js frontend
mac-client/                     # macOS voice client
ios-client/                     # iOS app
public/                         # Static web interface
```

#### **AI Service Containers**
```
text-generator/                 # Text generation service
text-to-speech/                 # TTS service
speech-to-text/                 # STT service
speech-to-text-mlx/             # MLX-optimized STT
speech-synthesizer/             # Speech synthesis
smart-turn-service/             # Conversation turn detection
kokoro-tts-service/             # Kokoro TTS
```

#### **Monitoring & Utilities**
```
helpers/
├── memoryTracker.js            # Memory monitoring
├── processingState.js          # State tracking
└── notification.js             # Notifications

Socket:
socket/
└── (socket.io files)

socket.js                       # WebSocket server
```

#### **Configuration**
```
config/
├── migrateGunSupport.js        # GUN migration
└── recordTypesForRAG.js        # AI-specific config
```

---

### **Additional Functionality (dweb-server)**

#### **1. AI Integration (Alfred)**
- RAG (Retrieval-Augmented Generation)
- Multi-LLM support (Ollama, OpenAI, XAI)
- Voice interface (speech-to-text, text-to-speech)
- Content summarization
- Conversation history

#### **2. Decentralized Storage**
- **GUN Network**: Private encrypted records
- **IPFS**: Content-addressed storage
- **BitTorrent/WebTorrent**: P2P file distribution
- Cross-node synchronization

#### **3. Media Distribution**
- File upload and processing
- BitTorrent seeding
- HTTP streaming with range requests
- Magnet URI generation
- Persistent peer seeding

#### **4. Organization Features**
- Organization registration
- Member management
- Shared encrypted records
- Access control policies
- Domain-based auto-enrollment

#### **5. Advanced Content**
- Recipe management with AI images (DALL-E)
- Workout creation and tracking
- Photo analysis (Grok vision)
- Web scraping and archiving
- Podcast generation

#### **6. Tor Integration** (Future - Phase 2)
- Anonymous publishing
- Onion service setup
- Header stripping
- Timing obfuscation

---

### **API Surface (dweb-server)**

```
AI/Voice:
POST   /api/alfred/chat           # AI conversation
POST   /api/alfred/rag            # RAG query
POST   /api/voice/transcribe      # Speech-to-text
POST   /api/voice/synthesize      # Text-to-speech
POST   /api/voice/process         # Full voice pipeline
POST   /api/generate/content      # AI content generation

Media:
POST   /api/media/upload          # Upload media file
GET    /api/media/:mediaId        # Stream media
POST   /api/media/createRecord    # Create OIP record for media
POST   /api/media/ipfs-upload     # Upload to IPFS
POST   /api/media/arweave-upload  # Upload to Arweave

Advanced Content:
POST   /api/recipes/generate-image # AI recipe image
GET    /api/recipes/images/:file  # Serve recipe image
POST   /api/workout/create        # Create workout
POST   /api/scrape/url            # Scrape web content
POST   /api/photo/upload          # Upload photo
POST   /api/photo/analyze         # AI photo analysis

Organizations:
POST   /api/organizations/register # Register org
GET    /api/organizations/:id     # Get org details
POST   /api/organizations/members # Manage members

GUN:
GET    /api/health/gun-sync       # GUN sync status
POST   /api/health/gun-sync/force # Force sync cycle
POST   /api/health/memory/clear-cache # Clear GUN cache

Tor Publishing (Future):
POST   /api/publish/anonymous     # Submit via Tor
GET    /api/publish/status/:id    # Check submission status
GET    /api/publish/limits        # Get gateway policies
```

---

### **Docker Services (dweb-server)**

```yaml
services:
  # Core OIP (as dependency - could be external service)
  oip-daemon:
    image: oip/daemon:latest      # Pull from oip-daemon
    # OR build from source if developing both
    
  # Elasticsearch (or connect to external)
  elasticsearch:
    # Could be shared or separate
  
  # Decentralized Storage
  ipfs:
    image: ipfs/go-ipfs:latest
    
  gun-relay:
    build: ./gun-relay-server
    
  # AI Services
  ollama:
    image: ollama/ollama:latest
    
  text-generator:
    build: ./text-generator
    
  tts-service:
    build: ./text-to-speech
    
  stt-service:
    build: ./speech-to-text
    
  smart-turn:
    build: ./smart-turn-service
    
  # DWeb Server Main
  dweb-server:
    build: .
    depends_on:
      - oip-daemon
      - ollama
      - ipfs
      - gun-relay
      - tts-service
      - stt-service
```

---

### **Key Dependencies (dweb-server)**

**Everything OIP doesn't need:**
```json
{
  "dependencies": {
    // OIP client (to talk to oip-daemon)
    "@oip/client": "^1.0.0",       // New package
    
    // P2P & Decentralized Storage
    "gun": "^0.2020.1240",
    "ipfs-http-client": "^49.0.4",
    "webtorrent": "^1.9.7",
    "create-torrent": "^4.4.6",
    "parse-torrent": "^9.1.5",
    
    // AI/LLM
    "axios": "^1.7.9",             // For LLM APIs
    "gpt-tokenizer": "^2.1.2",
    
    // Media Processing
    "fluent-ffmpeg": "^2.1.3",
    "sharp": "^0.33.5",
    "canvas": "^3.1.0",
    
    // Web Scraping
    "@mendable/firecrawl-js": "^1.15.7",
    "@postlight/parser": "^2.2.3",
    "cheerio": "^1.0.0",
    "puppeteer": "^23.3.0",
    
    // Real-time
    "socket.io": "^4.8.1",
    "ws": "^8.18.1",
    
    // Other
    "multer": "^2.0.2",
    "uuid": "^9.0.1"
  }
}
```

---

## 🔄 **Integration Between Projects**

### **Approach 1: Direct API Calls**
**dweb-server** makes HTTP requests to **oip-daemon**:

```javascript
// In dweb-server code
const OIPClient = require('@oip/client');
const oip = new OIPClient({
  baseURL: process.env.OIP_DAEMON_URL || 'http://oip-daemon:3005'
});

// Publish a record
await oip.publishRecord({
  basic: { name: "My Article", ... },
  post: { articleText: "Content..." }
});

// Query records
const records = await oip.getRecords({
  recordType: 'post',
  limit: 10
});
```

### **Approach 2: Shared Elasticsearch**
Both services connect to the same Elasticsearch instance:
- **oip-daemon**: Writes records
- **dweb-server**: Reads records for AI/RAG

### **Approach 3: Event Stream**
**oip-daemon** publishes events:
```javascript
// oip-daemon emits
eventBus.emit('record:indexed', { did, recordType, data });

// dweb-server listens
eventBus.on('record:indexed', (record) => {
  // Trigger media seeding
  // Update GUN registry
  // Notify websocket clients
});
```

---

## 📦 **Migration Strategy**

### **Phase 1: Create oip-daemon (Week 1-2)**
1. Copy entire project to new `oip-daemon` directory
2. Remove all dweb-server files (keep only core list above)
3. Simplify Docker Compose (ES + OIP only)
4. Strip out AI/media/GUN dependencies from package.json
5. Update documentation to focus on OIP protocol
6. Create clean API documentation
7. Test all core OIP functionality

### **Phase 2: Create dweb-server (Week 2-3)**
1. Copy entire project to new `dweb-server` directory
2. Remove oip-daemon files (keep only dweb list above)
3. Install `oip-daemon` as dependency or external service
4. Update imports to use OIP client library
5. Update Docker Compose to include all services
6. Test integration with oip-daemon

### **Phase 3: Extract OIP Client Library (Week 3-4)**
1. Create `@oip/client` npm package
2. Implement clean API for:
   - `publishRecord()`
   - `getRecords()`
   - `getTemplates()`
   - `registerUser()`
   - etc.
3. Publish to npm
4. Update dweb-server to use `@oip/client`

### **Phase 4: Documentation & Examples (Week 4-5)**
1. **oip-daemon README**: Pure OIP usage
2. **dweb-server README**: Full stack guide
3. Quick start guides for both
4. API documentation
5. Integration examples

---

## 🎯 **Benefits of This Split**

### **For oip-daemon:**
✅ **Focused**: Does one thing well (OIP protocol)  
✅ **Lightweight**: Minimal dependencies, fast startup  
✅ **Reusable**: Any app can use it as backend  
✅ **Maintainable**: Clear scope, easier to debug  
✅ **Testable**: Pure protocol logic, no side effects  

### **For dweb-server:**
✅ **Feature-Rich**: All the advanced capabilities  
✅ **Flexible**: Can swap OIP for different indexer  
✅ **Modular**: Add/remove features independently  
✅ **Scalable**: AI services can scale separately  
✅ **Clear Purpose**: Anonymous publishing platform  

### **For Developers:**
✅ **Clear separation**: Know which repo to contribute to  
✅ **Independent deployment**: Run just what you need  
✅ **Version management**: Update OIP without breaking dweb features  
✅ **API stability**: OIP protocol remains stable while dweb evolves  

---

## 🚀 **Directory Structure After Split**

```
oip-daemon/
├── config/
├── helpers/          # Only core helpers
├── routes/           # Only core routes
├── middleware/
├── docs/
├── test/
├── index.js
├── server.js
├── package.json
├── Dockerfile
├── docker-compose.yml  # ES + OIP only
└── README.md

dweb-server/
├── services/         # Media seeding, swap data
├── helpers/          # AI, GUN, IPFS, media
├── routes/           # Advanced routes
├── client/           # Web clients
├── mac-client/
├── ios-client/
├── text-generator/
├── speech-to-text/
├── text-to-speech/
├── smart-turn-service/
├── gun-relay-server.js
├── socket.js
├── package.json
├── Dockerfile
├── docker-compose.yml  # Full stack
└── README.md
```

---

This split creates a clean architectural boundary where **oip-daemon** is the protocol layer (like a database) and **dweb-server** is the application layer (like an app server). DWeb Server becomes a powerful reference implementation showing what's possible when you build on OIP, while keeping the protocol itself clean and reusable.