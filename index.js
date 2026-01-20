/**
 * OIP Arweave Server
 * Main entry point for the application
 */
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Client } = require('@elastic/elasticsearch');
const path = require('path');
const fs = require('fs');
const http = require('http');
const socketIo = require('socket.io');
const apiLogger = require('./middleware/apiLogger');
const { logAPIActivity } = require('./middleware/activityLogger');
const { createSwapsIndex, initializeIndices } = require('./config/createIndices');
const { validateEnvironment } = require('./config/checkEnvironment');
const dotenv = require('dotenv');
const rootRoute = require('./routes/api');
const recordRoutes = require('./routes/records');
const templateRoutes = require('./routes/templates');
const creatorRoutes = require('./routes/creators');
const organizationRoutes = require('./routes/organizations');
const scrapeRoutes = require('./routes/scrape');
const healthRoutes = require('./routes/health');
const generateRoutes = require('./routes/generate');
const { router: userRoutes } = require('./routes/user');
const adminRoutes = require('./routes/admin');
const walletRoutes = require('./routes/wallet');
const publishRecords = require('./routes/publish');
const workoutRoutes = require('./routes/workout');
const { getIsProcessing, setIsProcessing } = require('./helpers/processingState');
const { keepDBUpToDate, remapExistingRecords, deleteRecordsByBlock, deleteRecordsByDID, deleteRecordsByIndexedAt, deleteRecordsByIndex, deleteIndex } = require('./helpers/elasticsearch');
const minimist = require('minimist');
const socket = require('./socket');
const litRoutes = require('./routes/lit');
const jfkRoutes = require('./routes/jfk');
const voiceRoutes = require('./routes/voice');
const alfredRoutes = require('./routes/alfred');
const mediaRoutes = require('./routes/media');
const cleanupRoutes = require('./routes/cleanup');
const photoRoutes = require('./routes/photo');
const recipesRoutes = require('./routes/recipes');
const narrationRoutes = require('./routes/narration');
const documentationRoutes = require('./routes/documentation');
const notesRoutes = require('./routes/notes');
const { getMediaSeeder } = require('./services/mediaSeeder');
const axios = require('axios');
const { getTracker } = require('./helpers/memoryTracker');
const memoryDiagnostics = require('./helpers/memoryDiagnostics');
const { trackRequestMemory } = require('./middleware/memoryTrackingMiddleware');

dotenv.config();

// MEMORY LEAK FIX: Configure HTTP agents to prevent socket leak
// The application was accumulating 1000+ open sockets leading to 200GB+ external memory
const https = require('https');

const httpAgent = new http.Agent({
    keepAlive: false,  // Disable keep-alive to close sockets after each request
    maxSockets: 50,    // Limit concurrent connections
    maxFreeSockets: 10, // Limit cached sockets
    timeout: 30000     // Socket timeout
});

const httpsAgent = new https.Agent({
    keepAlive: false,  // Disable keep-alive to close sockets after each request
    maxSockets: 50,    // Limit concurrent connections
    maxFreeSockets: 10, // Limit cached sockets
    timeout: 30000     // Socket timeout
});

// Set default agents for all axios requests
axios.defaults.httpAgent = httpAgent;
axios.defaults.httpsAgent = httpsAgent;

// MEMORY LEAK FIX: Add axios response interceptor to clean up arraybuffers
// This prevents external memory leaks from images, GIFs, and audio downloads
// CRITICAL: Response buffers MUST be copied before they're released by cleanup timers
axios.interceptors.response.use(
  (response) => {
    // If response contains arraybuffer data, implement aggressive cleanup
    if (response.config.responseType === 'arraybuffer' && response.data) {
      const originalData = response.data;
      const bufferSize = originalData.byteLength || originalData.length || 0;
      
      // Log large buffers being created (even small ones for images/GIFs add up)
      if (bufferSize > 100 * 1024) { // > 100KB
        const url = response.config.url || 'unknown';
        const sizeStr = bufferSize > 1024 * 1024 
          ? `${(bufferSize / 1024 / 1024).toFixed(2)}MB`
          : `${Math.round(bufferSize / 1024)}KB`;
        console.log(`📦 [Axios Buffer] Created ${sizeStr} from ${url.substring(0, 80)}`);
      }
      
      // WARNING: The original buffer WILL be nulled after processing
      // Code using this response MUST copy the buffer if it needs to retain it
      // Example: Buffer.from(response.data) creates a copy
      
      // Store reference for cleanup
      response._originalBuffer = originalData;
      response._bufferSize = bufferSize;
      
      // AGGRESSIVE cleanup - null the buffer after a very short delay
      // This forces developers to copy buffers explicitly if needed
      const cleanupTimer = setTimeout(() => {
        if (response._originalBuffer) {
          response._originalBuffer = null;
          response.data = null;
          
          // Force GC for buffers > 1MB
          if (global.gc && bufferSize > 1024 * 1024) {
            setImmediate(() => {
              global.gc();
              const sizeStr = bufferSize > 1024 * 1024 
                ? `${(bufferSize / 1024 / 1024).toFixed(2)}MB`
                : `${Math.round(bufferSize / 1024)}KB`;
              console.log(`🧹 [Axios Buffer] Released ${sizeStr}`);
            });
          }
        }
      }, 500); // 500ms - very aggressive cleanup
      
      // Store cleanup timer so it can be cleared if needed
      response._cleanupTimer = cleanupTimer;
      
    } else if (response.data && typeof response.data === 'object') {
      // MEMORY LEAK FIX: Track and cleanup JSON responses from GUN sync
      // CRITICAL FIX: Do NOT use JSON.stringify to measure size - that creates a massive 
      // temporary string buffer that leaks memory! Use rough estimation instead.
      
      // Rough size estimation without allocating memory
      // For GUN registry data, estimate based on key count and average entry size
      let estimatedSize = 0;
      const url = response.config.url || 'unknown';
      const isGunRequest = url.includes('gun-relay') || url.includes(':8765');
      
      if (isGunRequest && response.data.data) {
        // GUN responses have nested data - count keys as proxy for size
        const keyCount = Object.keys(response.data.data || {}).length;
        // Assume ~500 bytes per registry entry (conservative estimate)
        estimatedSize = keyCount * 500;
      } else {
        // For other JSON, use key count with smaller multiplier
        estimatedSize = Object.keys(response.data).length * 100;
      }
      
      // AGGRESSIVE cleanup for GUN relay responses - these are the main leak source
      if (isGunRequest) {
        // Immediate cleanup - copy data synchronously then null response
        const extractedData = response.data;
        
        // Schedule aggressive cleanup
        setImmediate(() => {
          response.data = null;
          // Force GC for any GUN request with substantial data
          if (global.gc && estimatedSize > 10000) {
            setImmediate(() => global.gc());
          }
        });
      } else {
        // Standard cleanup for non-GUN requests
        setTimeout(() => {
          if (response.data) {
            response.data = null;
            if (global.gc && estimatedSize > 100000) {
              setImmediate(() => global.gc());
            }
          }
        }, 500); // Shorter delay than before
      }
    }
    return response;
  },
  (error) => {
    // MEMORY LEAK FIX: Log errors for diagnostics (suppress expected 404s from GUN relay)
    if (error.response?.config?.url) {
      // Suppress 404 errors from GUN relay - they're expected when index parent nodes don't have data
      const isGunRelay404 = error.response.status === 404 && error.response.config.url?.includes('gun-relay');
      if (!isGunRelay404) {
        console.error(`[Axios Error] ${error.message} from ${error.response.config.url}`);
      }
    }
    return Promise.reject(error);
  }
);

// Validate environment variables
validateEnvironment();

// Log AR.IO Gateway configuration status
const useLocalArioGateway = process.env.USE_LOCAL_ARIO_GATEWAY === 'true';
const localArioGatewayAddress = process.env.LOCAL_ARIO_GATEWAY_ADDRESS || 'localhost:4000';
if (useLocalArioGateway) {
    console.log(`🌐 AR.IO Gateway: ENABLED (${localArioGatewayAddress})`);
    console.log(`   Local gateway will be tried first, falling back to arweave.net if unavailable`);
} else {
    console.log(`🌐 AR.IO Gateway: DISABLED (using arweave.net only)`);
    console.log(`   Set USE_LOCAL_ARIO_GATEWAY=true in .env to enable local gateway`);
}

// Initialize GUN Sync Service (will be started after server is ready)
let gunSyncService = null;
if (process.env.GUN_SYNC_ENABLED !== 'false') {
    const { GunSyncService } = require('./helpers/gunSyncService');
    gunSyncService = new GunSyncService();
    global.gunSyncService = gunSyncService; // Make globally accessible immediately
}

const app = express();
const server = http.createServer(app);

// HTTP Server Timeout Configuration
// Extended timeouts to support long-running operations like 4+ hour meeting processing
// These can be overridden via environment variables
const HTTP_TIMEOUT_MS = parseInt(process.env.HTTP_SERVER_TIMEOUT_MS) || 30 * 60 * 1000; // 30 minutes default
const HTTP_KEEPALIVE_TIMEOUT_MS = parseInt(process.env.HTTP_KEEPALIVE_TIMEOUT_MS) || 35 * 60 * 1000; // 35 minutes
const HTTP_HEADERS_TIMEOUT_MS = parseInt(process.env.HTTP_HEADERS_TIMEOUT_MS) || 35 * 60 * 1000; // 35 minutes

server.timeout = HTTP_TIMEOUT_MS;
server.keepAliveTimeout = HTTP_KEEPALIVE_TIMEOUT_MS;
server.headersTimeout = HTTP_HEADERS_TIMEOUT_MS;

console.log(`⏱️  HTTP Server Timeouts: request=${HTTP_TIMEOUT_MS/60000}min, keepAlive=${HTTP_KEEPALIVE_TIMEOUT_MS/60000}min`);
console.log(`   For long meetings (60+ min), use the async endpoint: /api/notes/from-audio-async`);

const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Initialize socket.io
socket.init(server);

// Set higher body size limit (e.g., 50MB)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Clean API logging
app.use(apiLogger);

// MEMORY DIAGNOSTICS: Track memory growth per request (only when enabled via env)
app.use(trackRequestMemory);

// API ACTIVITY LOGGING: Track user activity for analytics (for authenticated requests)
app.use(logAPIActivity);

// CORS middleware configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Allow Chrome extension origins
    if (origin.startsWith('chrome-extension://')) {
      console.log(`[CORS] Allowing Chrome extension: ${origin}`);
      return callback(null, true);
    }
    
    // Allow Firefox extension origins
    if (origin.startsWith('moz-extension://')) {
      console.log(`[CORS] Allowing Firefox extension: ${origin}`);
      return callback(null, true);
    }
    
    // Allow Safari extension origins
    if (origin.startsWith('safari-web-extension://')) {
      console.log(`[CORS] Allowing Safari extension: ${origin}`);
      return callback(null, true);
    }
    
    // List of allowed origins
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001',  // Added for ALFRED voice interface
      'http://localhost:3005',  // Keep hardcoded as requested
      `http://localhost:${process.env.PORT || 3005}`,  // Also allow env PORT
      'http://localhost:5173',
      'http://localhost:8080',
      'https://api.oip.onl',
      'https://api.elevenlabs.io',
      'wss://api.elevenlabs.io',
      'https://api.fitnessally.io',
      'https://librairian.net',
      'https://oip.fitnessally.io',
      'https://app.fitnessally.io',
      'https://mini.fitnessally.io',
      'https://mobile.fitnessally.io',
      'https://rockhoppersgame.com',
      'https://lyra.ninja'
    ];
    
    // Allow any localhost origin in development
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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'xi-api-key'],
  exposedHeaders: ['Content-Length', 'Content-Type'],
  maxAge: 86400 // 24 hours
};

app.use(cors(corsOptions));

// Additional headers for ElevenLabs compatibility
app.use((req, res, next) => {
  // Allow WebSocket upgrades
  if (req.headers.upgrade === 'websocket') {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  next();
});

const port = process.env.PORT || 3005;

app.use((req, res, next) => {
    next();
});

// Custom Proxy Server Support
// Allows OIP to proxy requests to another server (e.g., a game server, custom API)
// This enables running a custom application alongside OIP with its own endpoints
// Configure via environment variables:
//   CUSTOM_PROXY_TARGET - The URL of the custom server (e.g., http://localhost:3001)
//   CUSTOM_PROXY_ROUTE - The route prefix to proxy (e.g., /game-api)
if (process.env.CUSTOM_PROXY_TARGET && process.env.CUSTOM_PROXY_ROUTE) {
    const { createProxyMiddleware } = require('http-proxy-middleware');
    
    const proxyTarget = process.env.CUSTOM_PROXY_TARGET;
    const proxyRoute = process.env.CUSTOM_PROXY_ROUTE;
    
    // Ensure route starts with /
    const normalizedRoute = proxyRoute.startsWith('/') ? proxyRoute : `/${proxyRoute}`;
    
    console.log(`🔀 Custom proxy enabled: ${normalizedRoute}/* → ${proxyTarget}`);
    
    // Create proxy middleware with comprehensive options
    const proxyMiddleware = createProxyMiddleware({
        target: proxyTarget,
        changeOrigin: true,
        ws: true, // Support WebSocket proxying
        pathRewrite: process.env.CUSTOM_PROXY_STRIP_PREFIX === 'true' 
            ? { [`^${normalizedRoute}`]: '' }  // Strip the prefix when forwarding
            : undefined,  // Keep the prefix
        // Log proxy activity
        on: {
            proxyReq: (proxyReq, req, res) => {
                console.log(`🔀 [Proxy] ${req.method} ${req.url} → ${proxyTarget}${req.url}`);
            },
            proxyRes: (proxyRes, req, res) => {
                // Add CORS headers to proxied responses
                proxyRes.headers['Access-Control-Allow-Origin'] = '*';
            },
            error: (err, req, res) => {
                console.error(`🔀 [Proxy Error] ${req.url}:`, err.message);
                if (!res.headersSent) {
                    res.status(502).json({ 
                        error: 'Proxy error', 
                        message: err.message,
                        target: proxyTarget 
                    });
                }
            }
        }
    });
    
    // Apply proxy middleware to the specified route
    app.use(normalizedRoute, proxyMiddleware);
    
    console.log(`🔀 Proxy configured: ${normalizedRoute}/* → ${proxyTarget}`);
    console.log(`🔀 Strip prefix: ${process.env.CUSTOM_PROXY_STRIP_PREFIX === 'true'}`);
}

// Public runtime config for static clients (e.g., reference-client.html)
// Exposes window.API_BASE_URL derived from env var PUBLIC_API_BASE_URL and PORT
app.get('/config.js', (req, res) => {
  const apiBase = process.env.PUBLIC_API_BASE_URL || '';
  const port = process.env.PORT || 3005;
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  const safeApiBase = String(apiBase).replace(/'/g, "\\'");
  res.send(`window.API_BASE_URL = '${safeApiBase}'; window.OIP_PORT = ${port};`);
});

// Serve static files from the 'public' directory (or custom path if specified)
// In Docker, the entrypoint script handles symlinking, so we always use ./public
// In non-Docker, we check for parent directory when CUSTOM_PUBLIC_PATH=true
const isDocker = fs.existsSync('/.dockerenv');
let publicPath;

if (process.env.CUSTOM_PUBLIC_PATH === 'true' && !isDocker) {
  // Non-Docker: Use parent directory
  publicPath = path.join(__dirname, '..', 'public');
} else {
  // Docker or default: Use local public (symlinked by entrypoint if needed)
  publicPath = path.join(__dirname, 'public');
}

console.log(`📁 Serving static files from: ${publicPath}`);
console.log(`🐳 Docker environment: ${isDocker}`);
console.log(`🔧 CUSTOM_PUBLIC_PATH: ${process.env.CUSTOM_PUBLIC_PATH}`);
app.use(express.static(publicPath));

// Define routes for static admin pages
app.get('/admin', (req, res) => {
    res.sendFile(path.join(publicPath, 'admin.html'));
});
app.get('/admin_login', (req, res) => {
    res.sendFile(path.join(publicPath, 'admin_login.html'));
});

app.use(bodyParser.json());

// GUN Relay Proxy Routes - for cross-node synchronization
// These routes proxy requests to the internal gun-relay service
// Allows external nodes to access gun-relay through the public API
// MEMORY LEAK DEBUG: Can be disabled via DISABLE_GUN_RELAY_PROXY=true
const disableGunRelayProxy = process.env.DISABLE_GUN_RELAY_PROXY === 'true';
if (disableGunRelayProxy) {
    console.log('⚠️  GUN relay proxy routes DISABLED (DISABLE_GUN_RELAY_PROXY=true)');
    app.get('/gun-relay/get', (req, res) => {
        res.status(503).json({ error: 'GUN relay proxy disabled for maintenance', success: false });
    });
    app.post('/gun-relay/put', (req, res) => {
        res.status(503).json({ error: 'GUN relay proxy disabled for maintenance', success: false });
    });
} else {
app.get('/gun-relay/get', async (req, res) => {
    let response = null;
    
    try {
        const soul = req.query.soul;
        if (!soul) {
            return res.status(400).json({ error: 'soul parameter required' });
        }
        
        const gunRelayUrl = process.env.GUN_PEERS || 'http://gun-relay:8765';
        
        // MEMORY LEAK FIX: Use responseType 'text' to get raw JSON string
        // This avoids: 1) axios JSON parsing overhead 2) res.json() re-serialization
        // We just pipe the raw JSON text straight through - only ONE copy in memory
        response = await axios.get(`${gunRelayUrl}/get?soul=${encodeURIComponent(soul)}`, {
            timeout: 10000,
            responseType: 'text', // Raw text - no parsing
            httpAgent: httpAgent,
            httpsAgent: httpsAgent
        });
        
        // Extract raw text and immediately null response to free axios buffers
        const rawText = response.data;
        response.data = null;
        response = null;
        
        // CRITICAL: Send raw JSON text directly - no parsing, no re-serialization
        // This eliminates the double-buffer problem that was causing 50-137MB leaks per request
        res.setHeader('Content-Type', 'application/json');
        res.send(rawText);
        
        // Force GC after response is sent
        res.on('finish', () => {
            if (global.gc) {
                setImmediate(() => global.gc());
            }
        });
        
    } catch (error) {
        // MEMORY LEAK FIX: Clean up ALL references immediately
        if (response) {
            response.data = null;
            response = null;
        }
        if (error.response) {
            error.response.data = null;
            error.response = null;
        }
        
        // Silent - 404s are normal when records don't exist
        const statusCode = error.response?.status || 500;
        res.status(statusCode).json({ 
            error: error.message,
            success: false 
        });
        
        // Force GC on errors too
        if (global.gc) {
            setImmediate(() => global.gc());
        }
    }
});

app.post('/gun-relay/put', async (req, res) => {
    let response = null;
    try {
        const { soul, data } = req.body;
        if (!soul || !data) {
            return res.status(400).json({ error: 'soul and data required' });
        }
        
        const gunRelayUrl = process.env.GUN_PEERS || 'http://gun-relay:8765';
        
        // Use responseType 'text' for consistency with GET - avoids JSON parsing overhead
        response = await axios.post(`${gunRelayUrl}/put`, req.body, {
            timeout: 30000,
            responseType: 'text',
            headers: { 'Content-Type': 'application/json' },
            httpAgent: httpAgent,
            httpsAgent: httpsAgent
        });
        
        // Extract raw text and null response immediately
        const rawText = response.data;
        response.data = null;
        response = null;
        
        // Send raw JSON directly without re-parsing/re-serializing
        res.setHeader('Content-Type', 'application/json');
        res.send(rawText);
        
        // Force GC after response is sent
        res.on('finish', () => {
            if (global.gc) {
                setImmediate(() => global.gc());
            }
        });
        
    } catch (error) {
        // MEMORY LEAK FIX: Clean up error response buffers immediately
        if (response) {
            response.data = null;
            response = null;
        }
        const statusCode = error.response?.status;
        if (error.response) {
            error.response.data = null;
            error.response = null;
        }
        
        // Only log non-404 errors
        if (statusCode !== 404) {
            console.error('Gun relay PUT error:', error.message);
        }
        res.status(statusCode || 500).json({ 
            error: error.message,
            success: false 
        });
    }
});

console.log('🔄 Gun relay proxy routes enabled at /gun-relay/get and /gun-relay/put');
} // End of else block for !disableGunRelayProxy

// API routes
app.use('/api', rootRoute);
app.use('/api/records', recordRoutes);
app.use('/api/publish', publishRecords);
app.use('/api/templates', templateRoutes);
app.use('/api/creators', creatorRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/scrape', scrapeRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/generate', generateRoutes);
// MEMORY LEAK FIX: Configure express.static with aggressive caching and memory limits
// Without proper configuration, serving 100+ GIFs/minute accumulates buffers faster than GC
const mediaStaticOptions = {
    etag: true,              // Enable ETags for browser caching
    lastModified: true,      // Enable Last-Modified header
    maxAge: '1y',           // Cache for 1 year (GIFs don't change)
    immutable: true,        // Tell browsers these files never change
    setHeaders: (res, filePath) => {
        // Aggressive caching for images/GIFs to prevent repeated requests
        if (filePath.endsWith('.gif') || filePath.endsWith('.jpg') || filePath.endsWith('.png') || filePath.endsWith('.svg')) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
    }
};

// CRITICAL FIX: ULTRA-AGGRESSIVE buffer cleanup for static files
// FitnessAlly serves 100+ GIFs/minute causing 60GB+ external memory leak
// The previous fix used setImmediate() which was too slow

// Track concurrent GIF requests to prevent buffer accumulation
let concurrentGifRequests = 0;
let totalGifRequests = 0;
let lastGCTime = Date.now();
let gcCount = 0;

// CRITICAL FIX: Semaphore to limit concurrent file streams (prevents buffer explosion)
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

const forceStaticCleanup = (req, res, next) => {
    const originalEnd = res.end;
    let bufferReleased = false;
    let startTime = Date.now();
    const isGif = req.path && req.path.endsWith('.gif');
    let streamAcquired = false;
    
    if (isGif) {
        concurrentGifRequests++;
        totalGifRequests++;
        
        // Wait for stream slot before allowing request through
        acquireStream().then(() => {
            streamAcquired = true;
        });
        
        // Log bursts of concurrent requests
        if (concurrentGifRequests > 15) {
            console.log(`⚠️  [Static GIF Burst] ${concurrentGifRequests} concurrent | Queue: ${streamQueue.length}`);
        }
    }
    
    // Wrap res.end to force ULTRA-AGGRESSIVE cleanup
    res.end = function(...args) {
        const result = originalEnd.apply(this, args);
        
        if (isGif && streamAcquired) {
            releaseStream();
            concurrentGifRequests--;
        }
        
        // ULTRA-AGGRESSIVE: Force GC on EVERY GIF response (not throttled)
        if (!bufferReleased && global.gc && isGif) {
            bufferReleased = true;
            gcCount++;
            
            // Call GC IMMEDIATELY in process.nextTick (before any other I/O)
            process.nextTick(() => {
                global.gc();
                
                // Log every 5th GIF to monitor effectiveness
                if (totalGifRequests % 5 === 0) {
                    const duration = Date.now() - startTime;
                    const mem = process.memoryUsage();
                    const rssMB = (mem.rss / 1024 / 1024).toFixed(0);
                    console.log(`🧹 [GIF #${totalGifRequests}] GC #${gcCount} | ${duration}ms | RSS: ${rssMB}MB | Active: ${activeStreams}/${MAX_CONCURRENT_STREAMS}`);
                }
            });
            
            // DOUBLE GC: Also schedule a second GC after 100ms to catch stragglers
            setTimeout(() => {
                if (global.gc) {
                    global.gc();
                }
            }, 100);
        }
        
        return result;
    };
    
    next();
};

app.use('/api/generate/media', forceStaticCleanup, express.static(path.join(__dirname, 'media'), mediaStaticOptions));
// Serve web-accessible media files
app.use('/media', forceStaticCleanup, express.static(path.join(__dirname, 'data', 'media', 'web'), mediaStaticOptions));
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/workout', workoutRoutes);
app.use('/api/lit', litRoutes);
app.use('/api/jfk', jfkRoutes);
// Mount new canonical route
app.use('/api/alfred', alfredRoutes);
// Backward-compatible alias
app.use('/api/voice', voiceRoutes);
// Photo upload and analysis routes
app.use('/api/photo', photoRoutes);
// Media storage and distribution routes
app.use('/api/media', mediaRoutes);
// Recipe image generation routes
app.use('/api/recipes', recipesRoutes);
// Template cleanup routes
app.use('/api/cleanup', cleanupRoutes);
// Document narration routes
app.use('/api', narrationRoutes);
// Documentation routes
app.use('/api/documentation', documentationRoutes);
// Notes routes (Alfred Meeting Notes)
app.use('/api/notes', notesRoutes);

// Local Media Routes (for custom apps that need to serve local media files)
// Configure via LOCAL_MEDIA_PATH environment variable
if (process.env.ENABLE_LOCAL_MEDIA === 'true') {
  const localMediaPath = process.env.LOCAL_MEDIA_PATH || path.join(publicPath, 'mediamixer', 'local-tracks');
  
  console.log(`🎵 Local media enabled: ${localMediaPath}`);
  
  // Function to find album art in a directory
  const findAlbumArt = (albumDir) => {
    try {
      if (!fs.existsSync(albumDir)) return null;
      
      const files = fs.readdirSync(albumDir);
      
      // Find first JPG or PNG file
      for (const filename of files) {
        const ext = path.extname(filename).toLowerCase();
        if (['.jpg', '.jpeg', '.png'].includes(ext)) {
          const artPath = path.join(albumDir, filename);
          if (fs.statSync(artPath).isFile()) {
            const relativePath = path.relative(localMediaPath, artPath);
            return '/local-media/' + relativePath.replace(/\\/g, '/');
          }
        }
      }
    } catch (error) {
      console.error(`Error finding album art in ${albumDir}:`, error);
    }
    return null;
  };
  
  // Recursive function to scan directories for media files
  const scanMediaDirectory = (dir, baseDir = dir) => {
    const audioExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac', '.webm'];
    const videoExtensions = ['.mp4', '.m4v', '.mov'];
    const mediaExtensions = [...audioExtensions, ...videoExtensions];
    let results = [];
    const albumArtCache = {}; // Cache album art lookups
    
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          // Recursively scan subdirectories
          results = results.concat(scanMediaDirectory(fullPath, baseDir));
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (mediaExtensions.includes(ext)) {
            // Get relative path from base directory
            const relativePath = path.relative(baseDir, fullPath);
            const urlPath = '/local-media/' + relativePath.replace(/\\/g, '/');
            
            // Determine media type
            const mediaType = videoExtensions.includes(ext) ? 'video' : 'audio';
            
            // Parse structure: Album/Artist/Track.mp3 or Album/Video.mp4
            const pathParts = relativePath.split(path.sep);
            const album = pathParts.length >= 2 ? pathParts[0] : '';
            
            // For videos directly in album folder (Album/video.mp4), artist is empty
            // For audio in nested structure (Album/Artist/track.mp3), artist is the middle folder
            const artist = pathParts.length > 2 ? pathParts[1] : '';
            const filename = pathParts[pathParts.length - 1];
            
            // Find album art (cache by album to avoid repeated lookups)
            let albumArt = null;
            if (album) {
              if (albumArtCache[album] === undefined) {
                const albumDir = path.join(baseDir, album);
                albumArtCache[album] = findAlbumArt(albumDir);
              }
              albumArt = albumArtCache[album];
            }
            
            results.push({
              name: filename,
              path: urlPath,
              relativePath: relativePath,
              album: album,
              artist: artist,
              albumArt: albumArt,
              type: mediaType,
              size: fs.statSync(fullPath).size
            });
          }
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${dir}:`, error);
    }
    
    return results;
  };
  
  // API endpoint to list files in local media directory
  app.get('/api/local-media', (req, res) => {
    try {
      if (!fs.existsSync(localMediaPath)) {
        return res.json({ tracks: [] });
      }
      
      const tracks = scanMediaDirectory(localMediaPath);
      console.log(`📂 Found ${tracks.length} local media files`);
      
      res.json({ tracks });
    } catch (error) {
      console.error('Error listing local media:', error);
      res.status(500).json({ error: 'Failed to list local media files' });
    }
  });
  
  // Serve individual local media files and album art
  app.use('/local-media', express.static(localMediaPath, {
    setHeaders: (res, filePath) => {
      // Enable streaming and range requests for audio/video
      res.setHeader('Accept-Ranges', 'bytes');
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        // Audio formats
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.ogg': 'audio/ogg',
        '.m4a': 'audio/mp4',
        '.flac': 'audio/flac',
        '.aac': 'audio/aac',
        '.webm': 'audio/webm',
        // Video formats
        '.mp4': 'video/mp4',
        '.m4v': 'video/mp4',
        '.mov': 'video/quicktime',
        // Image formats (for album art)
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml'
      };
      if (mimeTypes[ext]) {
        res.setHeader('Content-Type', mimeTypes[ext]);
      }
    }
  }));
}

// Open Graph Preview Middleware (for link sharing on Discord, iMessage, Twitter, etc.)
// This middleware intercepts bot requests and returns HTML with OG meta tags
app.get('*', (req, res, next) => {
  // Skip API routes, config, and actual files
  if (req.path.startsWith('/api/') || 
      req.path === '/config.js' || 
      req.path.startsWith('/gun-relay/') ||
      req.path.startsWith('/media/') ||
      req.path.startsWith('/local-media/')) {
    return next();
  }
  
  // Detect bot user-agents
  const userAgent = req.get('user-agent') || '';
  const isBot = /bot|crawler|spider|crawling|facebookexternalhit|twitterbot|slackbot|telegrambot|whatsapp|discordbot|imessagebot|pinterest|LinkedInBot/i.test(userAgent);
  
  if (isBot && process.env.ENABLE_LOCAL_MEDIA === 'true') {
    // Parse MediaMixer URLs like: /listen/local/Album Name/Artist Name/track.mp3
    const listenMatch = req.path.match(/^\/listen\/local\/(.+)/);
    
    if (listenMatch) {
      const encodedPath = listenMatch[1];
      const decodedPath = decodeURIComponent(encodedPath);
      
      console.log(`🤖 Bot detected (${userAgent.substring(0, 50)}...) requesting: ${req.path}`);
      
      // Parse path: Album/Artist/Track.mp3
      const pathParts = decodedPath.split('/');
      const album = pathParts[0] || 'Unknown Album';
      const artist = pathParts.length > 2 ? pathParts[1] : 'Unknown Artist';
      const filename = pathParts[pathParts.length - 1] || 'Unknown Track';
      const trackName = path.basename(filename, path.extname(filename));
      
      // Determine media type
      const ext = path.extname(filename).toLowerCase();
      const isVideo = ['.mp4', '.m4v', '.mov'].includes(ext);
      const mediaType = isVideo ? 'video.other' : 'music.song';
      
      // Look for album art
      const localMediaPath = process.env.LOCAL_MEDIA_PATH || path.join(publicPath, 'mediamixer', 'local-tracks');
      const albumDir = path.join(localMediaPath, album);
      let albumArtUrl = null;
      
      try {
        if (fs.existsSync(albumDir)) {
          const files = fs.readdirSync(albumDir);
          for (const file of files) {
            const fileExt = path.extname(file).toLowerCase();
            if (['.jpg', '.jpeg', '.png'].includes(fileExt)) {
              const domain = req.get('host');
              const protocol = req.get('x-forwarded-proto') || req.protocol || 'https';
              albumArtUrl = `${protocol}://${domain}/local-media/${encodeURIComponent(album)}/${encodeURIComponent(file)}`;
              break;
            }
          }
        }
      } catch (error) {
        console.error('Error finding album art for OG tags:', error);
      }
      
      // Generate OG meta tags HTML
      const ogHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta property="og:title" content="${trackName}" />
  <meta property="og:description" content="${artist} • ${album}" />
  ${albumArtUrl ? `<meta property="og:image" content="${albumArtUrl}" />` : ''}
  <meta property="og:type" content="${mediaType}" />
  <meta property="og:url" content="${req.protocol}://${req.get('host')}${req.path}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${trackName}" />
  <meta name="twitter:description" content="${artist} • ${album}" />
  ${albumArtUrl ? `<meta name="twitter:image" content="${albumArtUrl}" />` : ''}
  <title>${trackName} - ${artist}</title>
  <meta http-equiv="refresh" content="0;url=/" />
</head>
<body>
  <h1>${trackName}</h1>
  <p>${artist} • ${album}</p>
  <p>Redirecting to MediaMixer...</p>
</body>
</html>`;
      
      return res.send(ogHtml);
    }
  }
  
  // Check if the requested file exists (for static assets like CSS, JS, images)
  const filePath = path.join(publicPath, req.path);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return next(); // Let express.static handle it
  }
  
  // SPA Fallback: Serve index.html for all non-bot requests
  const indexPath = path.join(publicPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    if (!isBot) {
      console.log(`🔄 SPA Fallback: ${req.path} → index.html`);
    }
    res.sendFile(indexPath);
  } else {
    next(); // No index.html found, continue to 404
  }
});

// Make io available to routes
app.set('io', io);

// Setup Socket.IO
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

let isProcessing = false; // Flag to indicate if the process is running

// Initialize indices first, then check for CLI operations or start server
initializeIndices()
  .then(async () => {
    // Parse command-line arguments first
    const args = minimist(process.argv.slice(2));
    
    console.log('\n🔍 [DEBUG] Command line arguments:');
    console.log('   process.argv:', process.argv);
    console.log('   Parsed args:', JSON.stringify(args, null, 2));
    console.log('   args.keepDBUpToDate:', args.keepDBUpToDate);
    console.log('');
    
    // CLI functionality for deleting records by block
    if (args.deleteRecords && args.index && args.blockThreshold) {
        const index = args.index;
        const blockThreshold = parseInt(args.blockThreshold, 10);

        if (isNaN(blockThreshold)) {
            console.error('Invalid blockThreshold value. Please provide a valid number.');
            process.exit(1);
        }

        try {
            console.log(`Deleting records from index '${index}' with inArweaveBlock >= ${blockThreshold}...`);
            const response = await deleteRecordsByBlock(index, blockThreshold);
            console.log('Deletion completed successfully:', response);
            process.exit(0);
        } catch (error) {
            console.error('Error occurred during deletion:', error);
            process.exit(1);
        }
    }

    // CLI functionality for deleting records by DID
    if (args.deleteRecords && args.index && args.did) {
        const index = args.index;
        const did = args.did;

        if (!did || typeof did !== 'string') {
            console.error('Invalid DID value. Please provide a valid DID string.');
            process.exit(1);
        }

        try {
            console.log(`Deleting records from index '${index}' with DID '${did}'...`);
            const response = await deleteRecordsByDID(index, did);
            console.log('Deletion completed successfully:', response);
            process.exit(0);
        } catch (error) {
            console.error('Error occurred during deletion:', error);
            process.exit(1);
        }
    }

    // CLI functionality for deleting records by indexedAt timestamp
    if (args.deleteRecords && args.index && args.indexedAt) {
        const index = args.index;
        const indexedAt = args.indexedAt;

        if (isNaN(Date.parse(indexedAt))) {
            console.error('Invalid indexedAt value. Please provide a valid timestamp.');
            process.exit(1);
        }

        try {
            console.log(`Deleting records from index '${index}' with indexedAt >= ${indexedAt}...`);
            const response = await deleteRecordsByIndexedAt(index, indexedAt);
            console.log('Deletion completed successfully:', response);
            process.exit(0);
        } catch (error) {
            console.error('Error occurred during deletion:', error);
            process.exit(1);
        }
    }

    // CLI functionality for deleting all records from a specified index
    if (args.deleteAllRecords && args.index) {
        const index = args.index;
        console.log(`Deleting all records from index '${index}'...`);

        try {
            console.log(`Deleting all records from index '${index}'...`);
            const response = await deleteRecordsByIndex(index); 
            console.log('Deletion of all records completed successfully:', response);
            process.exit(0);
        } catch (error) {
            console.error('Error occurred during deletion of all records:', error);
            process.exit(1);
        }
    }

    // CLI functionality for deleting an entire index
    if (args.deleteIndex && args.index) {
        const indexName = args.index;
        
        if (!indexName || typeof indexName !== 'string') {
            console.error('Invalid index name. Please provide a valid index name with --deleteIndex.');
            process.exit(1);
        }

        try {
            console.log(`Deleting entire index '${indexName}'...`);
            const response = await deleteIndex(indexName);
            console.log('Index deletion completed successfully:', response);
            process.exit(0);
        } catch (error) {
            console.error('Error occurred during index deletion:', error);
            process.exit(1);
        }
    }
    
    // If we reach here, it's not a CLI operation, so start the server
    // But first check if we're in a CLI-only mode (delete commands that didn't match valid patterns)
    // Note: keepDBUpToDate needs the server running, so it's not included here
    const hasInvalidDeleteCommand = (args.deleteRecords && !args.index) || 
                                    (args.deleteAllRecords && !args.index) || 
                                    (args.deleteIndex && !args.index);
    
    if (hasInvalidDeleteCommand) {
        console.log('⚠️  Delete command detected but missing required parameters. Exiting.');
        console.log('💡 Available delete commands:');
        console.log('   --deleteAllRecords --index <indexName>  (delete all records from index)');
        console.log('   --deleteIndex --index <indexName>       (delete entire index)');
        console.log('   --deleteRecords --index <indexName> --blockThreshold <number>');
        console.log('   --deleteRecords --index <indexName> --did <did>');
        console.log('   --deleteRecords --index <indexName> --indexedAt <timestamp>');
        process.exit(1);
    }
    
    const serverInstance = server.listen(port, async () => {
      console.log(`Server is running on port ${port}`);

      // Initialize MediaSeeder for server mode (non-blocking)
      // Don't await - let it initialize in the background so it doesn't block keepDBUpToDate
      const mediaSeeder = getMediaSeeder();
      mediaSeeder.initialize()
        .then(() => {
          console.log('🌱 MediaSeeder initialized successfully');
        })
        .catch((error) => {
          console.error('❌ Failed to initialize MediaSeeder:', error);
        });

      // Start GUN sync service after server is ready (non-blocking)
      if (gunSyncService) {
        gunSyncService.start()
          .then(() => {
            console.log('🚀 Starting GUN Record Sync Service...'); // This will start the background sync loop
          })
          .catch((error) => {
            console.error('❌ Failed to start GUN Sync Service:', error);
          });
      }

      console.log('🔍 [DEBUG] About to start memory monitor...');
      
      // MEMORY LEAK FIX: Start memory monitor for long-running processes
      const memoryMonitorInterval = parseInt(process.env.MEMORY_MONITOR_INTERVAL) || 300000; // 5 minutes default
      const memoryWarningThreshold = parseInt(process.env.MEMORY_WARNING_THRESHOLD) || 80; // 80% threshold
      
      console.log('🔍 [DEBUG] Setting up memory monitor setInterval...');
      setInterval(() => {
        const memUsage = process.memoryUsage();
        const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
        const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
        const rssMB = Math.round(memUsage.rss / 1024 / 1024);
        const externalMB = Math.round(memUsage.external / 1024 / 1024);
        // Use V8 heap statistics for accurate utilization calculation
        const v8 = require('v8');
        const heapStats = v8.getHeapStatistics();
        const heapUtilization = ((heapStats.used_heap_size / heapStats.heap_size_limit) * 100).toFixed(2);
        
        console.log(`[Memory Monitor] Heap: ${heapUsedMB}MB / ${heapTotalMB}MB (${heapUtilization}%), RSS: ${rssMB}MB, External: ${externalMB}MB`);
        
        // CRITICAL FIX: Node.js external counter is often inaccurate!
        // Use RSS (actual OS memory) as the real indicator, not external counter
        // Only warn if RSS is actually growing, not if external counter is high
        
        // Real memory warning: RSS > 10GB is a problem
        if (rssMB > 10240) {
          console.warn(`🚨 [Memory Monitor] REAL MEMORY CRITICAL: RSS at ${rssMB}MB - approaching limits!`);
          console.warn(`    Heap: ${heapUsedMB}MB, External (may be inaccurate): ${externalMB}MB`);
          
          // Force aggressive GC
          if (global.gc) {
            console.log(`🧹 [Memory Monitor] Forcing emergency GC...`);
            global.gc();
          }
        }
        
        // Info only: External counter discrepancy (common and usually harmless)
        if (externalMB > rssMB * 2) {
          const rssExternalRatio = ((externalMB / rssMB) * 100).toFixed(1);
          console.log(`ℹ️  [Memory Monitor] External counter shows ${externalMB}MB (${rssExternalRatio}% of RSS)`);
          console.log(`    Note: External counter is often inaccurate. Actual RSS: ${rssMB}MB`);
          
          // Force aggressive cleanup when external memory is too high
          if (global.gc) {
            console.log('[Memory Monitor] Forcing aggressive garbage collection for external memory...');
            
            // Clear Elasticsearch records cache to free memory
            try {
              const { clearRecordsCache } = require('./helpers/elasticsearch');
              clearRecordsCache();
              console.log('[Memory Monitor] Cleared Elasticsearch records cache');
            } catch (error) {
              console.log('[Memory Monitor] Could not clear records cache:', error.message);
            }
            
            global.gc();
            
            // Check memory after GC
            const afterGC = process.memoryUsage();
            const afterExternalMB = Math.round(afterGC.external / 1024 / 1024);
            const freedExternalMB = externalMB - afterExternalMB;
            console.log(`[Memory Monitor] After aggressive GC: ${afterExternalMB}MB external (freed ${freedExternalMB}MB)`);
          }
        }
        
        // Warning if heap utilization is high (using V8 heap statistics)
        if (parseFloat(heapUtilization) > memoryWarningThreshold) {
          console.warn(`⚠️  [Memory Monitor] HIGH MEMORY USAGE: ${heapUtilization}% heap utilization`);
          
          // Force garbage collection if available and heap is critically high
          if (global.gc && parseFloat(heapUtilization) > 90) {
            console.log('[Memory Monitor] Forcing garbage collection...');
            global.gc();
            
            // Log memory after GC
            const afterGC = process.memoryUsage();
            const afterHeapUsedMB = Math.round(afterGC.heapUsed / 1024 / 1024);
            const afterHeapTotalMB = Math.round(afterGC.heapTotal / 1024 / 1024);
            const afterExternalMB = Math.round(afterGC.external / 1024 / 1024);
            const freedMB = heapUsedMB - afterHeapUsedMB;
            const freedExternalMB = externalMB - afterExternalMB;
            console.log(`[Memory Monitor] After GC: ${afterHeapUsedMB}MB / ${afterHeapTotalMB}MB (freed ${freedMB}MB heap, ${freedExternalMB}MB external)`);
          }
        }
      }, memoryMonitorInterval);
      
      console.log(`✅ Memory monitor started (interval: ${memoryMonitorInterval/1000}s, warning threshold: ${memoryWarningThreshold}%)`);

      console.log('🔍 [DEBUG] Checking for remapTemplates...');
      // Initialize remapTemplates
      let remapTemplates = [];
      if (args.remapTemplates) {
          remapTemplates = args.remapTemplates.split(',');
          console.log(`Remap templates enabled for: ${remapTemplates.join(', ')}`);
          await remapExistingRecords(remapTemplates);
      } else {
          console.log('🔍 [DEBUG] No remapTemplates specified');
      }

      console.log('🔍 [DEBUG] Checking args.keepDBUpToDate:', args.keepDBUpToDate, 'Type:', typeof args.keepDBUpToDate);
      // Periodically keep DB up to date
      if (args.keepDBUpToDate) {
          console.log('🔍 [DEBUG] ✅ INSIDE keepDBUpToDate block! Setting up parameters...');
          // When called as: node index.js --keepDBUpToDate 15 600
          // minimist parses as: { keepDBUpToDate: 15, _: [600] }
          // So the delay is args.keepDBUpToDate, and interval is args._[0]
          const wait = parseInt(args.keepDBUpToDate, 10); // Delay in seconds (from flag value)
          const interval = args._[0] ? parseInt(args._[0], 10) : 600; // Interval in seconds (from positional arg)
          // const interval = 300;

          if (isNaN(wait) || isNaN(interval)) {
              console.error('Invalid arguments for --keepDBUpToDate. Provide delay and interval as numbers.');
              process.exit(1);
          }
          if (interval > 120) {
            minutes = Math.floor(interval / 60);
            if (wait > 0) {
              console.log(`After a delay of ${wait} seconds, will check Arweave for new OIP data every ${minutes} minutes`);
            } else {
              console.log(`Will check Arweave for new OIP data every ${minutes} minutes`);
            }
          } else {
            if (wait > 0) {
              console.log(`After a delay of ${wait} seconds, will check Arweave for new OIP data every ${interval} seconds`);
            } else {
              console.log(`Will check Arweave for new OIP data every ${interval} seconds`);
            }
          }

          // Start memory leak tracker (can be disabled via DISABLE_MEMORY_TRACKER=true)
          if (process.env.DISABLE_MEMORY_TRACKER !== 'true') {
              const memTracker = getTracker({
                  trackingInterval: 60000, // Sample every 1 minute
                  maxSamples: 30, // Keep last 30 samples (30 min) - reduced to lower memory footprint
                  alertThreshold: 5000 // Alert if > 5GB growth
              });
              memTracker.start();
              console.log('🔍 [STARTUP] Memory leak tracker started (30 samples max, aggressive cleanup enabled)');
          } else {
              console.log('⚠️ [STARTUP] Memory leak tracker DISABLED via env var (testing memory leak in tracker itself)');
          }

          setTimeout(async () => {
              console.log("🚀 [STARTUP] Starting first keepDBUpToDate cycle...");
              try {
                  setIsProcessing(true);
                  await keepDBUpToDate(remapTemplates);
                  console.log("✅ [STARTUP] First keepDBUpToDate cycle completed successfully");
              } catch (error) {
                  console.error("❌ [STARTUP] Error during first keepDBUpToDate:", error);
              } finally {
                  setIsProcessing(false);
              }
              
              console.log(`⏰ [STARTUP] Setting up keepDBUpToDate interval (every ${interval} seconds)...`);
              setInterval(async () => {
                  const processing = getIsProcessing();
                  console.log(`\n⏱️  [INTERVAL] keepDBUpToDate interval triggered (isProcessing: ${processing})`);
                  
                  if (!processing) {
                      try {
                          console.log("▶️  [INTERVAL] Starting new keepDBUpToDate cycle...");
                          setIsProcessing(true);
                          await keepDBUpToDate(remapTemplates);
                          console.log("✅ [INTERVAL] keepDBUpToDate cycle completed");
                      } catch (error) {
                          console.error("❌ [INTERVAL] Error during keepDBUpToDate:", error);
                          console.error("❌ [INTERVAL] Stack trace:", error.stack);
                      } finally {
                          setIsProcessing(false);
                      }
                  } else {
                      console.log("⏭️  [INTERVAL] Skipping cycle - previous process still running");
                  }
              }, interval * 1000);
          }, wait * 1000);
      } else {
          console.log('⏭️  [DEBUG] keepDBUpToDate block SKIPPED - args.keepDBUpToDate is:', args.keepDBUpToDate);
      }
      
      console.log('🔍 [DEBUG] Finished server.listen callback');
    });
  })
  .catch(error => {
    console.error('Failed to initialize indices:', error);
    // Allow server to start anyway by manually calling listen
    console.log('Starting server despite index initialization failure...');
    server.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });
  });

// Graceful shutdown handling
// CRITICAL: Add comprehensive crash detection
process.on('uncaughtException', (error) => {
  console.error('\n🚨🚨🚨 UNCAUGHT EXCEPTION 🚨🚨🚨');
  console.error('Time:', new Date().toISOString());
  console.error('Error:', error.message);
  console.error('Stack:', error.stack);
  console.error('Memory at crash:', process.memoryUsage());
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('\n🚨🚨🚨 UNHANDLED REJECTION 🚨🚨🚨');
  console.error('Time:', new Date().toISOString());
  console.error('Reason:', reason);
  console.error('Promise:', promise);
  console.error('Memory:', process.memoryUsage());
  // Don't exit - log and continue
});

process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully...');
  console.log('Memory at shutdown:', process.memoryUsage());
  if (gunSyncService) {
    gunSyncService.stop();
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 Received SIGINT, shutting down gracefully...');
  if (gunSyncService) {
    gunSyncService.stop();
  }
  process.exit(0);
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Server error', message: err.message });
});
