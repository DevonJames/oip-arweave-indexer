/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * OIP DAEMON SERVICE - Entry Point
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Purpose: Core OIP infrastructure - indexing, storage, media distribution
 * Analogy: The Library Infrastructure (card catalog, shelves, access control)
 * 
 * This service handles:
 *   - Arweave blockchain indexing
 *   - GUN network for private records
 *   - Elasticsearch search/indexing
 *   - BitTorrent/WebTorrent media seeding
 *   - IPFS integration
 *   - HD wallet authentication
 *   - Organization management
 *   - Media upload/streaming
 * 
 * MEMORY LEAK PREVENTION:
 *   - All HTTP agents configured with keepAlive: false
 *   - Axios interceptors clean up response buffers
 *   - Bounded caches with TTL
 *   - Proper stream cleanup handlers
 *   - Periodic GC during heavy operations
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const socketIo = require('socket.io');
const dotenv = require('dotenv');
const minimist = require('minimist');
const axios = require('axios');

// Load environment variables first
dotenv.config();

// ═══════════════════════════════════════════════════════════════════════════════
// MEMORY LEAK FIX: Configure HTTP agents to prevent socket leak
// ═══════════════════════════════════════════════════════════════════════════════
const httpAgent = new http.Agent({
    keepAlive: false,       // CRITICAL: Disable keep-alive to close sockets
    maxSockets: 50,         // Limit concurrent connections
    maxFreeSockets: 10,     // Limit cached sockets
    timeout: 30000          // Socket timeout
});

const httpsAgent = new https.Agent({
    keepAlive: false,
    maxSockets: 50,
    maxFreeSockets: 10,
    timeout: 30000
});

// Set default agents for all axios requests
axios.defaults.httpAgent = httpAgent;
axios.defaults.httpsAgent = httpsAgent;

// ═══════════════════════════════════════════════════════════════════════════════
// MEMORY LEAK FIX: Axios response interceptor for buffer cleanup
// ═══════════════════════════════════════════════════════════════════════════════
axios.interceptors.response.use(
    (response) => {
        // Handle arraybuffer responses (media, images)
        if (response.config.responseType === 'arraybuffer' && response.data) {
            const bufferSize = response.data.byteLength || response.data.length || 0;
            
            // Schedule aggressive cleanup
            const cleanupTimer = setTimeout(() => {
                if (response._originalBuffer) {
                    response._originalBuffer = null;
                    response.data = null;
                    
                    // Force GC for buffers > 1MB
                    if (global.gc && bufferSize > 1024 * 1024) {
                        setImmediate(() => global.gc());
                    }
                }
            }, 500);
            
            response._originalBuffer = response.data;
            response._bufferSize = bufferSize;
            response._cleanupTimer = cleanupTimer;
        }
        // Handle JSON responses (especially GUN sync)
        else if (response.data && typeof response.data === 'object') {
            const url = response.config.url || '';
            const isGunRequest = url.includes('gun-relay') || url.includes(':8765');
            
            if (isGunRequest) {
                // AGGRESSIVE cleanup for GUN relay responses
                setImmediate(() => {
                    response.data = null;
                    if (global.gc) {
                        setImmediate(() => global.gc());
                    }
                });
            } else {
                // Standard cleanup for other JSON
                setTimeout(() => {
                    if (response.data) {
                        response.data = null;
                    }
                }, 500);
            }
        }
        return response;
    },
    (error) => {
        // Clean up error response buffers
        if (error.response) {
            const isGunRelay404 = error.response.status === 404 && 
                                  error.response.config?.url?.includes('gun-relay');
            if (!isGunRelay404) {
                console.error(`[Axios Error] ${error.message} from ${error.response.config?.url}`);
            }
            error.response.data = null;
            error.response = null;
        }
        return Promise.reject(error);
    }
);

// ═══════════════════════════════════════════════════════════════════════════════
// Import Configuration and Middleware
// ═══════════════════════════════════════════════════════════════════════════════
const { validateEnvironment } = require('./config/checkEnvironment');
const { initializeIndices } = require('./config/createIndices');
const apiLogger = require('./middleware/apiLogger');
const { logAPIActivity } = require('./middleware/activityLogger');
const { trackRequestMemory } = require('./middleware/memoryTrackingMiddleware');

// ═══════════════════════════════════════════════════════════════════════════════
// Import Daemon Routes
// ═══════════════════════════════════════════════════════════════════════════════
const rootRoute = require('./routes/daemon/api');
const recordRoutes = require('./routes/daemon/records');
const templateRoutes = require('./routes/daemon/templates');
const creatorRoutes = require('./routes/daemon/creators');
const organizationRoutes = require('./routes/daemon/organizations');
const healthRoutes = require('./routes/daemon/health');
const { router: userRoutes } = require('./routes/daemon/user');
const walletRoutes = require('./routes/daemon/wallet');
const publishRoutes = require('./routes/daemon/publish');
const mediaRoutes = require('./routes/daemon/media');
const cleanupRoutes = require('./routes/daemon/cleanup');
const adminRoutes = require('./routes/daemon/admin');
const didRoutes = require('./routes/daemon/did');

// ═══════════════════════════════════════════════════════════════════════════════
// Import Daemon Helpers
// ═══════════════════════════════════════════════════════════════════════════════
const { getIsProcessing, setIsProcessing } = require('./helpers/core/processingState');
const { keepDBUpToDate, deleteRecordsByBlock, deleteRecordsByDID, 
        deleteRecordsByIndexedAt, deleteRecordsByIndex, deleteIndex,
        remapExistingRecords } = require('./helpers/core/elasticsearch');
const { getMediaSeeder } = require('./services/mediaSeeder');
const { getTracker } = require('./helpers/core/memoryTracker');
const socket = require('./socket');

// Validate environment
validateEnvironment();

// ═══════════════════════════════════════════════════════════════════════════════
// Initialize GUN Sync Service
// ═══════════════════════════════════════════════════════════════════════════════
let gunSyncService = null;
if (process.env.GUN_SYNC_ENABLED !== 'false') {
    const { GunSyncService } = require('./helpers/core/gunSyncService');
    gunSyncService = new GunSyncService();
    global.gunSyncService = gunSyncService;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Create Express App
// ═══════════════════════════════════════════════════════════════════════════════
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// Initialize socket.io
socket.init(server);

// ═══════════════════════════════════════════════════════════════════════════════
// Express Configuration
// ═══════════════════════════════════════════════════════════════════════════════
// Body size limits
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Logging middleware
app.use(apiLogger);
app.use(trackRequestMemory);
app.use(logAPIActivity);

// CORS configuration
const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (mobile apps, curl)
        if (!origin) return callback(null, true);
        
        // Allow browser extensions
        if (origin.startsWith('chrome-extension://') ||
            origin.startsWith('moz-extension://') ||
            origin.startsWith('safari-web-extension://')) {
            return callback(null, true);
        }
        
        // Allowed origins
        const allowedOrigins = [
            'http://localhost:3000',
            'http://localhost:3001',
            'http://localhost:3005',
            'http://localhost:3006',  // Alexandria service
            `http://localhost:${process.env.PORT || 3005}`,
            'https://api.oip.onl',
            'https://app.fitnessally.io',
            'https://mobile.fitnessally.io',
            'https://rockhoppersgame.com',
            'https://lyra.ninja',
            'https://alexandria.io',
            // Add your production domains here
        ];
        
        // Development mode allows any localhost
        if (process.env.NODE_ENV === 'development' && origin.includes('localhost')) {
            return callback(null, true);
        }
        
        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.log(`[CORS] Blocked origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    maxAge: 86400
};

app.use(cors(corsOptions));
app.use(bodyParser.json());

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

const port = process.env.PORT || 3005;

// ═══════════════════════════════════════════════════════════════════════════════
// GUN Relay Proxy Routes
// ═══════════════════════════════════════════════════════════════════════════════
const disableGunRelayProxy = process.env.DISABLE_GUN_RELAY_PROXY === 'true';

if (disableGunRelayProxy) {
    console.log('⚠️  GUN relay proxy routes DISABLED');
    app.get('/gun-relay/get', (req, res) => {
        res.status(503).json({ error: 'GUN relay proxy disabled', success: false });
    });
    app.post('/gun-relay/put', (req, res) => {
        res.status(503).json({ error: 'GUN relay proxy disabled', success: false });
    });
} else {
    // GUN relay GET with memory-safe patterns
    app.get('/gun-relay/get', async (req, res) => {
        let response = null;
        try {
            const soul = req.query.soul;
            if (!soul) {
                return res.status(400).json({ error: 'soul parameter required' });
            }
            
            const gunRelayUrl = process.env.GUN_PEERS || 'http://gun-relay:8765';
            
            // Use responseType 'text' to avoid JSON parsing overhead
            response = await axios.get(`${gunRelayUrl}/get?soul=${encodeURIComponent(soul)}`, {
                timeout: 10000,
                responseType: 'text',
                httpAgent: httpAgent,
                httpsAgent: httpsAgent
            });
            
            // Extract raw text and null response immediately
            const rawText = response.data;
            response.data = null;
            response = null;
            
            // Send raw JSON directly
            res.setHeader('Content-Type', 'application/json');
            res.send(rawText);
            
            // Force GC after response
            res.on('finish', () => {
                if (global.gc) setImmediate(() => global.gc());
            });
            
        } catch (error) {
            // Clean up references
            if (response) {
                response.data = null;
                response = null;
            }
            if (error.response) {
                error.response.data = null;
                error.response = null;
            }
            
            const statusCode = error.response?.status || 500;
            res.status(statusCode).json({ error: error.message, success: false });
            
            if (global.gc) setImmediate(() => global.gc());
        }
    });

    // GUN relay PUT with memory-safe patterns
    app.post('/gun-relay/put', async (req, res) => {
        let response = null;
        try {
            const { soul, data } = req.body;
            if (!soul || !data) {
                return res.status(400).json({ error: 'soul and data required' });
            }
            
            const gunRelayUrl = process.env.GUN_PEERS || 'http://gun-relay:8765';
            
            response = await axios.post(`${gunRelayUrl}/put`, req.body, {
                timeout: 30000,
                responseType: 'text',
                headers: { 'Content-Type': 'application/json' },
                httpAgent: httpAgent,
                httpsAgent: httpsAgent
            });
            
            const rawText = response.data;
            response.data = null;
            response = null;
            
            res.setHeader('Content-Type', 'application/json');
            res.send(rawText);
            
            res.on('finish', () => {
                if (global.gc) setImmediate(() => global.gc());
            });
            
        } catch (error) {
            if (response) {
                response.data = null;
                response = null;
            }
            if (error.response) {
                error.response.data = null;
                error.response = null;
            }
            
            const statusCode = error.response?.status || 500;
            if (statusCode !== 404) {
                console.error('GUN relay PUT error:', error.message);
            }
            res.status(statusCode).json({ error: error.message, success: false });
        }
    });
    
    console.log('🔄 GUN relay proxy routes enabled');
}

// ═══════════════════════════════════════════════════════════════════════════════
// Mount Daemon API Routes
// ═══════════════════════════════════════════════════════════════════════════════
app.use('/api', rootRoute);
app.use('/api/records', recordRoutes);
app.use('/api/publish', publishRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/creators', creatorRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/user', userRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/cleanup', cleanupRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/did', didRoutes);

// ═══════════════════════════════════════════════════════════════════════════════
// Backward Compatibility: Direct /api/* routes that redirect to /api/user/*
// This allows clients to use either /api/register or /api/user/register
// ═══════════════════════════════════════════════════════════════════════════════
app.post('/api/register', (req, res, next) => {
    req.url = '/register';
    userRoutes(req, res, next);
});
app.post('/api/login', (req, res, next) => {
    req.url = '/login';
    userRoutes(req, res, next);
});
app.post('/api/joinWaitlist', (req, res, next) => {
    req.url = '/joinWaitlist';
    userRoutes(req, res, next);
});
app.post('/api/reset-password', (req, res, next) => {
    req.url = '/reset-password';
    userRoutes(req, res, next);
});
app.post('/api/import-wallet', (req, res, next) => {
    req.url = '/import-wallet';
    userRoutes(req, res, next);
});
app.get('/api/mnemonic', (req, res, next) => {
    req.url = '/mnemonic';
    userRoutes(req, res, next);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Alexandria Service Stub Routes (for oip-only deployments)
// ═══════════════════════════════════════════════════════════════════════════════
const alexandriaStub = (req, res) => {
    res.status(503).json({
        error: 'Alexandria service not available',
        message: 'This endpoint requires the alexandria profile. Current deployment: oip-only',
        hint: 'Deploy with: make alexandria',
        endpoint: req.originalUrl
    });
};

app.use('/api/alfred', alexandriaStub);
app.use('/api/voice', alexandriaStub);
app.use('/api/scrape', alexandriaStub);
app.use('/api/generate', alexandriaStub);
app.use('/api/photo', alexandriaStub);
app.use('/api/recipes', alexandriaStub);
app.use('/api/narration', alexandriaStub);
app.use('/api/workout', alexandriaStub);
app.use('/api/notes', alexandriaStub);

// ═══════════════════════════════════════════════════════════════════════════════
// Onion Press Routes (browse handled locally, other APIs proxy to onion-press-service)
// ═══════════════════════════════════════════════════════════════════════════════
const ONION_PRESS_URL = process.env.ONION_PRESS_URL || `http://onion-press-service:${process.env.ONION_PRESS_PORT || 3007}`;
const ONION_PRESS_ENABLED = process.env.ONION_PRESS_ENABLED !== 'false';

// Import Elasticsearch helper for browse routes
const { getRecords: getRecordsFromES } = require('./helpers/core/elasticsearch');

if (ONION_PRESS_ENABLED) {
    // ─────────────────────────────────────────────────────────────────────────
    // Browse API - handled locally (no need for onion-press-service)
    // ─────────────────────────────────────────────────────────────────────────
    
    // GET /onion-press/api/browse/records - Browse records
    app.get('/onion-press/api/browse/records', async (req, res) => {
        try {
            const {
                recordType = 'post',
                search,
                tags,
                tagsMatchMode,
                creator,
                limit = 20,
                page = 1,
                sortBy = 'inArweaveBlock:desc',
                resolveDepth = 0,
                noDuplicates = true,
            } = req.query;
            
            const params = {
                limit: Math.min(parseInt(limit) || 20, 100),
                page: parseInt(page) || 1,
                sortBy,
                resolveDepth: parseInt(resolveDepth) || 0
            };
            
            if (recordType) params.recordType = recordType;
            if (search) params.search = search;
            if (tags) params.tags = tags;
            if (tagsMatchMode) params.tagsMatchMode = tagsMatchMode;
            if (creator) params.creator = creator;
            
            const data = await getRecordsFromES(params);
            res.status(200).json(data);
            
        } catch (error) {
            console.error('Onion Press browse error:', error.message);
            res.status(500).json({
                error: 'Failed to browse records',
                message: error.message
            });
        }
    });
    
    // GET /onion-press/api/browse/types - Get record types
    app.get('/onion-press/api/browse/types', async (req, res) => {
        try {
            // Get unique record types with counts
            const data = await getRecordsFromES({ limit: 0 });
            res.status(200).json({ 
                recordTypes: data.recordTypes || {},
                total: data.total || 0
            });
        } catch (error) {
            console.error('Onion Press types error:', error.message);
            res.status(500).json({
                error: 'Failed to get record types',
                message: error.message
            });
        }
    });
    
    // GET /onion-press/api/browse/templates - Get templates (proxy to local /api/templates)
    app.get('/onion-press/api/browse/templates', async (req, res) => {
        try {
            // Redirect internally to templates route
            const response = await axios.get(`http://localhost:${port}/api/templates`, {
                timeout: 10000
            });
            res.status(200).json(response.data);
        } catch (error) {
            res.status(500).json({ error: 'Failed to get templates', message: error.message });
        }
    });
    
    // ─────────────────────────────────────────────────────────────────────────
    // Publish/Admin/TOR API - proxy to onion-press-service (if available)
    // ─────────────────────────────────────────────────────────────────────────
    app.use('/onion-press/api', async (req, res) => {
        let response = null;
        try {
            const targetUrl = `${ONION_PRESS_URL}/api${req.url}`;
            
            response = await axios({
                method: req.method,
                url: targetUrl,
                data: req.body,
                headers: {
                    'Content-Type': req.headers['content-type'] || 'application/json',
                    'Authorization': req.headers.authorization || ''
                },
                timeout: 30000,
                validateStatus: () => true
            });
            
            const data = response.data;
            const status = response.status;
            response.data = null;
            response = null;
            
            res.status(status).json(data);
            
        } catch (error) {
            if (response) {
                response.data = null;
                response = null;
            }
            
            // If onion-press-service is not available, return stub response
            if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
                // For publish destinations endpoint, return local settings
                if (req.url.startsWith('/publish/destinations')) {
                    return res.status(200).json({
                        destinations: {
                            arweave: { enabled: true, description: 'Permanent blockchain storage' },
                            gun: { enabled: true, description: 'Real-time peer sync' },
                            internetArchive: { enabled: false, description: 'Requires onion-press-service' }
                        },
                        enabledDestinations: ['arweave', 'gun'],
                        note: 'Full publishing requires onion-press-server profile'
                    });
                }
                // For TOR status, return disconnected
                if (req.url.startsWith('/tor/')) {
                    return res.status(200).json({
                        connected: false,
                        onionAddress: null,
                        message: 'TOR requires onion-press-server profile'
                    });
                }
                res.status(503).json({
                    error: 'Onion Press service not available',
                    message: 'Publishing and TOR features require the onion-press-server profile',
                    hint: 'Deploy with: make -f Makefile.split onion-press-server'
                });
            } else {
                res.status(500).json({ error: error.message });
            }
        }
    });
    
    // ─────────────────────────────────────────────────────────────────────────
    // Static files and SPA routing
    // ─────────────────────────────────────────────────────────────────────────
    app.use('/onion-press', express.static(path.join(__dirname, 'public', 'onion-press'), {
        index: 'index.html',
        etag: true,
        lastModified: true
    }));
    
    // Fallback for SPA routing
    app.get('/onion-press/*', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'onion-press', 'index.html'));
    });
    
    console.log(`🧅 Onion Press enabled (browse: local, publish/tor: ${ONION_PRESS_URL})`);
} else {
    app.use('/onion-press', (req, res) => {
        res.status(503).json({
            error: 'Onion Press service disabled',
            message: 'Set ONION_PRESS_ENABLED=true to enable'
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Static File Serving with Memory-Safe Patterns
// ═══════════════════════════════════════════════════════════════════════════════
const mediaStaticOptions = {
    etag: true,
    lastModified: true,
    maxAge: '1y',
    immutable: true,
    setHeaders: (res, filePath) => {
        if (filePath.match(/\.(gif|jpg|png|svg)$/i)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
    }
};

// MEMORY LEAK FIX: Semaphore to limit concurrent file streams
const MAX_CONCURRENT_STREAMS = 20;
let activeStreams = 0;
const streamQueue = [];

const acquireStream = () => {
    return new Promise((resolve) => {
        if (activeStreams < MAX_CONCURRENT_STREAMS) {
            activeStreams++;
            resolve();
        } else {
            streamQueue.push(resolve);
        }
    });
};

const releaseStream = () => {
    activeStreams--;
    if (streamQueue.length > 0) {
        const next = streamQueue.shift();
        activeStreams++;
        next();
    }
};

// Media static middleware with stream management
const forceStaticCleanup = (req, res, next) => {
    const originalEnd = res.end;
    const isMedia = req.path && /\.(gif|jpg|png|mp4|webm)$/i.test(req.path);
    let streamAcquired = false;
    
    if (isMedia) {
        acquireStream().then(() => {
            streamAcquired = true;
        });
    }
    
    res.end = function(...args) {
        const result = originalEnd.apply(this, args);
        
        if (isMedia && streamAcquired) {
            releaseStream();
        }
        
        // Force GC for media responses
        if (global.gc && isMedia) {
            process.nextTick(() => {
                global.gc();
            });
        }
        
        return result;
    };
    
    next();
};

app.use('/media', forceStaticCleanup, express.static(
    path.join(__dirname, 'data', 'media', 'web'), 
    mediaStaticOptions
));

// ═══════════════════════════════════════════════════════════════════════════════
// Basic Health Check
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK',
        service: 'oip-daemon-service',
        timestamp: new Date().toISOString()
    });
});

// Make io available to routes
app.set('io', io);

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Error Handler
// ═══════════════════════════════════════════════════════════════════════════════
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Server error', message: err.message });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Server Initialization
// ═══════════════════════════════════════════════════════════════════════════════
initializeIndices()
    .then(async () => {
        const args = minimist(process.argv.slice(2));
        
        // CLI functionality for record deletion (same as original)
        if (args.deleteRecords && args.index && args.blockThreshold) {
            const index = args.index;
            const blockThreshold = parseInt(args.blockThreshold, 10);
            if (isNaN(blockThreshold)) {
                console.error('Invalid blockThreshold');
                process.exit(1);
            }
            try {
                console.log(`Deleting records from '${index}' with inArweaveBlock >= ${blockThreshold}...`);
                await deleteRecordsByBlock(index, blockThreshold);
                process.exit(0);
            } catch (error) {
                console.error('Deletion error:', error);
                process.exit(1);
            }
        }

        if (args.deleteRecords && args.index && args.did) {
            try {
                console.log(`Deleting records with DID '${args.did}'...`);
                await deleteRecordsByDID(args.index, args.did);
                process.exit(0);
            } catch (error) {
                console.error('Deletion error:', error);
                process.exit(1);
            }
        }

        if (args.deleteAllRecords && args.index) {
            try {
                console.log(`Deleting all records from '${args.index}'...`);
                await deleteRecordsByIndex(args.index);
                process.exit(0);
            } catch (error) {
                console.error('Deletion error:', error);
                process.exit(1);
            }
        }

        if (args.deleteIndex && args.index) {
            try {
                console.log(`Deleting index '${args.index}'...`);
                await deleteIndex(args.index);
                process.exit(0);
            } catch (error) {
                console.error('Index deletion error:', error);
                process.exit(1);
            }
        }

        // Start server
        server.listen(port, async () => {
            console.log(`\n═══════════════════════════════════════════════════════════════`);
            console.log(`  OIP DAEMON SERVICE`);
            console.log(`  Port: ${port}`);
            console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`═══════════════════════════════════════════════════════════════\n`);

            // Initialize MediaSeeder (non-blocking)
            const mediaSeeder = getMediaSeeder();
            mediaSeeder.initialize()
                .then(() => console.log('🌱 MediaSeeder initialized'))
                .catch((err) => console.error('❌ MediaSeeder error:', err));

            // Start GUN sync service (non-blocking)
            if (gunSyncService) {
                gunSyncService.start()
                    .then(() => console.log('🔄 GUN Sync Service started'))
                    .catch((err) => console.error('❌ GUN Sync error:', err));
            }

            // ═══════════════════════════════════════════════════════════════════
            // Memory Monitor
            // ═══════════════════════════════════════════════════════════════════
            const memoryMonitorInterval = parseInt(process.env.MEMORY_MONITOR_INTERVAL) || 300000;
            const memoryWarningThreshold = parseInt(process.env.MEMORY_WARNING_THRESHOLD) || 80;
            
            setInterval(() => {
                const memUsage = process.memoryUsage();
                const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
                const rssMB = Math.round(memUsage.rss / 1024 / 1024);
                const externalMB = Math.round(memUsage.external / 1024 / 1024);
                
                const v8 = require('v8');
                const heapStats = v8.getHeapStatistics();
                const heapUtilization = ((heapStats.used_heap_size / heapStats.heap_size_limit) * 100).toFixed(2);
                
                console.log(`[Memory] Heap: ${heapUsedMB}MB (${heapUtilization}%), RSS: ${rssMB}MB, External: ${externalMB}MB`);
                
                // Critical warning
                if (rssMB > 10240) {
                    console.warn(`🚨 MEMORY CRITICAL: RSS at ${rssMB}MB`);
                    if (global.gc) {
                        console.log('🧹 Emergency GC...');
                        global.gc();
                    }
                }
                
                // High utilization warning
                if (parseFloat(heapUtilization) > memoryWarningThreshold) {
                    console.warn(`⚠️  HIGH MEMORY: ${heapUtilization}% heap utilization`);
                    if (global.gc && parseFloat(heapUtilization) > 90) {
                        global.gc();
                    }
                }
            }, memoryMonitorInterval);
            
            console.log(`✅ Memory monitor started (${memoryMonitorInterval/1000}s interval)`);

            // ═══════════════════════════════════════════════════════════════════
            // keepDBUpToDate (Arweave indexing)
            // ═══════════════════════════════════════════════════════════════════
            let remapTemplates = [];
            if (args.remapTemplates) {
                remapTemplates = args.remapTemplates.split(',');
                console.log(`Remap templates: ${remapTemplates.join(', ')}`);
                await remapExistingRecords(remapTemplates);
            }

            if (args.keepDBUpToDate) {
                const wait = parseInt(args.keepDBUpToDate, 10);
                const interval = args._[0] ? parseInt(args._[0], 10) : 600;
                
                if (isNaN(wait) || isNaN(interval)) {
                    console.error('Invalid --keepDBUpToDate arguments');
                    process.exit(1);
                }
                
                const minutes = interval > 120 ? Math.floor(interval / 60) : interval;
                const unit = interval > 120 ? 'minutes' : 'seconds';
                console.log(`📡 Will sync from Arweave every ${minutes} ${unit}`);

                // Start memory tracker
                if (process.env.DISABLE_MEMORY_TRACKER !== 'true') {
                    const memTracker = getTracker({
                        trackingInterval: 60000,
                        maxSamples: 30,
                        alertThreshold: 5000
                    });
                    memTracker.start();
                    console.log('🔍 Memory tracker started');
                }

                setTimeout(async () => {
                    console.log('🚀 Starting first keepDBUpToDate cycle...');
                    try {
                        setIsProcessing(true);
                        await keepDBUpToDate(remapTemplates);
                        console.log('✅ First sync complete');
                    } catch (error) {
                        console.error('❌ Sync error:', error);
                    } finally {
                        setIsProcessing(false);
                    }
                    
                    setInterval(async () => {
                        if (!getIsProcessing()) {
                            try {
                                setIsProcessing(true);
                                await keepDBUpToDate(remapTemplates);
                            } catch (error) {
                                console.error('❌ Sync error:', error);
                            } finally {
                                setIsProcessing(false);
                            }
                        }
                    }, interval * 1000);
                }, wait * 1000);
            }
        });
    })
    .catch(error => {
        console.error('Failed to initialize:', error);
        server.listen(port, () => {
            console.log(`Server running on port ${port} (init failed)`);
        });
    });

// ═══════════════════════════════════════════════════════════════════════════════
// Graceful Shutdown
// ═══════════════════════════════════════════════════════════════════════════════
process.on('uncaughtException', (error) => {
    console.error('\n🚨 UNCAUGHT EXCEPTION 🚨');
    console.error('Time:', new Date().toISOString());
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.error('Memory:', process.memoryUsage());
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('\n⚠️  UNHANDLED REJECTION');
    console.error('Time:', new Date().toISOString());
    console.error('Reason:', reason);
    // Don't exit - log and continue
});

process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down...');
    console.log('Memory at shutdown:', process.memoryUsage());
    if (gunSyncService) {
        gunSyncService.stop();
    }
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT received, shutting down...');
    if (gunSyncService) {
        gunSyncService.stop();
    }
    process.exit(0);
});

