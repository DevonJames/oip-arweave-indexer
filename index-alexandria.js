/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ALEXANDRIA SERVICE - Entry Point
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Purpose: Intelligent interface layer - AI, voice, content creation
 * Analogy: The Librarian (helps you find things, creates content, talks to you)
 * 
 * This service handles:
 *   - Alfred AI/RAG queries
 *   - Voice interface (STT/TTS)
 *   - Content generation (podcasts, images)
 *   - Web scraping
 *   - Photo analysis
 *   - Recipe/Workout AI processing
 *   - WebSocket real-time features
 * 
 * DATA ACCESS:
 *   All data operations go through oipClient.js → oip-daemon-service
 *   Alexandria does NOT directly access Elasticsearch, GUN, or Arweave
 * 
 * MEMORY LEAK PREVENTION:
 *   - Bounded conversation context
 *   - Aggressive audio buffer cleanup
 *   - Proper WebSocket cleanup on disconnect
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
const axios = require('axios');

// Load environment variables
dotenv.config();

// ═══════════════════════════════════════════════════════════════════════════════
// MEMORY LEAK FIX: Configure HTTP agents
// ═══════════════════════════════════════════════════════════════════════════════
const httpAgent = new http.Agent({
    keepAlive: false,       // Close sockets after use
    maxSockets: 50,
    maxFreeSockets: 10,
    timeout: 30000
});

const httpsAgent = new https.Agent({
    keepAlive: false,
    maxSockets: 50,
    maxFreeSockets: 10,
    timeout: 30000
});

axios.defaults.httpAgent = httpAgent;
axios.defaults.httpsAgent = httpsAgent;

// ═══════════════════════════════════════════════════════════════════════════════
// MEMORY LEAK FIX: Axios interceptors for buffer cleanup
// ═══════════════════════════════════════════════════════════════════════════════
axios.interceptors.response.use(
    (response) => {
        // Cleanup arraybuffer responses (audio, images)
        if (response.config.responseType === 'arraybuffer' && response.data) {
            const bufferSize = response.data.byteLength || response.data.length || 0;
            
            // Log large audio buffers
            if (bufferSize > 100 * 1024) {
                const sizeStr = bufferSize > 1024 * 1024 
                    ? `${(bufferSize / 1024 / 1024).toFixed(2)}MB`
                    : `${Math.round(bufferSize / 1024)}KB`;
                console.log(`📦 [Buffer] ${sizeStr} from ${(response.config.url || '').substring(0, 60)}`);
            }
            
            response._bufferSize = bufferSize;
            
            // Schedule aggressive cleanup
            setTimeout(() => {
                if (response.data) {
                    response.data = null;
                    if (global.gc && bufferSize > 1024 * 1024) {
                        setImmediate(() => global.gc());
                    }
                }
            }, 500);
        }
        return response;
    },
    (error) => {
        if (error.response) {
            error.response.data = null;
            error.response = null;
        }
        return Promise.reject(error);
    }
);

// ═══════════════════════════════════════════════════════════════════════════════
// Import Middleware
// ═══════════════════════════════════════════════════════════════════════════════
const apiLogger = require('./middleware/apiLogger');
const { trackRequestMemory } = require('./middleware/memoryTrackingMiddleware');

// ═══════════════════════════════════════════════════════════════════════════════
// Import Alexandria Routes
// ═══════════════════════════════════════════════════════════════════════════════
const alfredRoutes = require('./routes/alexandria/alfred');
const voiceRoutes = require('./routes/alexandria/voice');
const scrapeRoutes = require('./routes/alexandria/scrape');
const generateRoutes = require('./routes/alexandria/generate');
const photoRoutes = require('./routes/alexandria/photo');
const recipesRoutes = require('./routes/alexandria/recipes');
const narrationRoutes = require('./routes/alexandria/narration');
const workoutRoutes = require('./routes/alexandria/workout');
const notesRoutes = require('./routes/alexandria/notes');
const documentationRoutes = require('./routes/alexandria/documentation');
const healthRoutes = require('./routes/alexandria/health');

// ═══════════════════════════════════════════════════════════════════════════════
// Import OIP Client (for daemon communication)
// ═══════════════════════════════════════════════════════════════════════════════
const OIPClient = require('./helpers/oipClient');

// ═══════════════════════════════════════════════════════════════════════════════
// Socket.io Initialization
// ═══════════════════════════════════════════════════════════════════════════════
const socket = require('./socket');

// ═══════════════════════════════════════════════════════════════════════════════
// Create Express App
// ═══════════════════════════════════════════════════════════════════════════════
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    },
    // MEMORY LEAK FIX: Limit buffer size
    maxHttpBufferSize: 1e7 // 10MB
});

// Initialize socket.io
socket.init(server);

// ═══════════════════════════════════════════════════════════════════════════════
// Express Configuration
// ═══════════════════════════════════════════════════════════════════════════════
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Logging
app.use(apiLogger);
app.use(trackRequestMemory);

// CORS
const corsOptions = {
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        
        if (origin.startsWith('chrome-extension://') ||
            origin.startsWith('moz-extension://') ||
            origin.startsWith('safari-web-extension://')) {
            return callback(null, true);
        }
        
        const allowedOrigins = [
            'http://localhost:3000',
            'http://localhost:3001',
            'http://localhost:3005',  // Daemon service
            'http://localhost:3006',
            `http://localhost:${process.env.PORT || 3006}`,
            'https://api.oip.onl',
        ];
        
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

const port = process.env.PORT || 3006;
const OIP_DAEMON_URL = process.env.OIP_DAEMON_URL || 'http://oip-daemon-service:3005';

// ═══════════════════════════════════════════════════════════════════════════════
// Make OIPClient available to routes
// ═══════════════════════════════════════════════════════════════════════════════
app.use((req, res, next) => {
    // Create OIPClient with user's auth token for each request
    const userToken = req.headers.authorization?.split(' ')[1];
    req.oipClient = new OIPClient(userToken);
    next();
});

// ═══════════════════════════════════════════════════════════════════════════════
// Mount Alexandria API Routes
// ═══════════════════════════════════════════════════════════════════════════════
app.use('/api/alfred', alfredRoutes);
app.use('/api/voice', voiceRoutes);
app.use('/api/scrape', scrapeRoutes);
app.use('/api/generate', generateRoutes);
app.use('/api/photo', photoRoutes);
app.use('/api/recipes', recipesRoutes);
app.use('/api/narration', narrationRoutes);
app.use('/api/workout', workoutRoutes);
app.use('/api/notes', notesRoutes);
app.use('/api/documentation', documentationRoutes);
app.use('/api/health', healthRoutes);

// ═══════════════════════════════════════════════════════════════════════════════
// Proxy Daemon Endpoints (for unified API access)
// ═══════════════════════════════════════════════════════════════════════════════
// These endpoints proxy to the daemon service so clients can use a single URL

const createDaemonProxy = (basePath) => {
    return async (req, res) => {
        try {
            const userToken = req.headers.authorization?.split(' ')[1];
            const oipClient = new OIPClient(userToken);
            
            // Build the full path
            const fullPath = basePath + req.path;
            
            // Proxy the request
            const response = await oipClient.proxyRequest(req.method, fullPath, req.body, req.query);
            
            res.json(response);
        } catch (error) {
            console.error(`Proxy error for ${basePath}${req.path}:`, error.message);
            
            // Forward error status from daemon
            const status = error.response?.status || 500;
            const message = error.response?.data || { error: error.message };
            
            res.status(status).json(message);
        }
    };
};

// Proxy daemon endpoints through Alexandria
app.use('/api/records', createDaemonProxy('/api/records'));
app.use('/api/publish', createDaemonProxy('/api/publish'));
app.use('/api/templates', createDaemonProxy('/api/templates'));
app.use('/api/creators', createDaemonProxy('/api/creators'));
app.use('/api/organizations', createDaemonProxy('/api/organizations'));
app.use('/api/user', createDaemonProxy('/api/user'));
app.use('/api/wallet', createDaemonProxy('/api/wallet'));
app.use('/api/media', createDaemonProxy('/api/media'));
app.use('/api/cleanup', createDaemonProxy('/api/cleanup'));
app.use('/api/admin', createDaemonProxy('/api/admin'));

// ═══════════════════════════════════════════════════════════════════════════════
// Static Assets for Alexandria Features
// ═══════════════════════════════════════════════════════════════════════════════
app.use('/media/generated', express.static(path.join(__dirname, 'media', 'generated')));
app.use('/podcastHosts', express.static(path.join(__dirname, 'podcastHosts')));
app.use('/podcastShows', express.static(path.join(__dirname, 'podcastShows')));

// Serve public directory for static HTML files (alfreds-notes.html, etc.)
const publicPath = path.join(__dirname, 'public');
console.log(`📁 Serving static files from: ${publicPath}`);
app.use(express.static(publicPath));

// Debug: List files in public directory on startup
try {
    const publicFiles = fs.readdirSync(publicPath);
    console.log(`📁 Public directory contents: ${publicFiles.join(', ')}`);
} catch (e) {
    console.error(`❌ Cannot read public directory: ${e.message}`);
}

// Serve onion-press static files
app.use('/onion-press', express.static(path.join(__dirname, 'public', 'onion-press'), {
    index: 'index.html',
    etag: true,
    lastModified: true
}));

// Proxy onion-press API routes to daemon
app.use('/onion-press/api', createDaemonProxy('/onion-press/api'));

// Fallback for onion-press SPA routing
app.get('/onion-press/*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'onion-press', 'index.html'));
});

// ═══════════════════════════════════════════════════════════════════════════════
// Basic Health Check
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/health', async (req, res) => {
    // Also check daemon connectivity
    let daemonStatus = 'unknown';
    try {
        const oipClient = new OIPClient();
        await axios.get(`${OIP_DAEMON_URL}/health`, { timeout: 5000 });
        daemonStatus = 'connected';
    } catch (error) {
        daemonStatus = 'disconnected';
    }
    
    res.status(200).json({ 
        status: 'OK',
        service: 'alexandria-service',
        daemon: daemonStatus,
        daemonUrl: OIP_DAEMON_URL,
        timestamp: new Date().toISOString()
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Root API Info
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api', (req, res) => {
    res.json({
        service: 'alexandria-service',
        version: '1.0.0',
        description: 'AI librarian, voice interface, and content creation',
        daemon: OIP_DAEMON_URL,
        endpoints: {
            ai: ['/api/alfred', '/api/voice'],
            content: ['/api/generate', '/api/recipes', '/api/narration', '/api/photo'],
            acquisition: ['/api/scrape'],
            specialized: ['/api/workout', '/api/notes'],
            proxied: ['/api/records', '/api/publish', '/api/templates', '/api/organizations', '/api/media']
        }
    });
});

// Make io available to routes
app.set('io', io);

// ═══════════════════════════════════════════════════════════════════════════════
// Socket.IO Connection Handling
// ═══════════════════════════════════════════════════════════════════════════════
// MEMORY LEAK FIX: Track and cleanup per-connection state
const clientStates = new Map();

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    // Initialize client state (bounded size)
    clientStates.set(socket.id, {
        connectedAt: Date.now(),
        conversationLength: 0
    });
    
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        
        // MEMORY LEAK FIX: Clean up client state
        clientStates.delete(socket.id);
        
        // Force GC after disconnect
        if (global.gc) {
            setImmediate(() => global.gc());
        }
    });
});

// MEMORY LEAK FIX: Periodic cleanup of stale client states
setInterval(() => {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    
    for (const [socketId, state] of clientStates.entries()) {
        if (now - state.connectedAt > maxAge) {
            clientStates.delete(socketId);
        }
    }
}, 60 * 60 * 1000); // Every hour

// ═══════════════════════════════════════════════════════════════════════════════
// Error Handler
// ═══════════════════════════════════════════════════════════════════════════════
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Server error', message: err.message });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Server Startup
// ═══════════════════════════════════════════════════════════════════════════════
server.listen(port, async () => {
    console.log(`\n═══════════════════════════════════════════════════════════════`);
    console.log(`  ALEXANDRIA SERVICE`);
    console.log(`  Port: ${port}`);
    console.log(`  Daemon: ${OIP_DAEMON_URL}`);
    console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`═══════════════════════════════════════════════════════════════\n`);
    
    // Test daemon connectivity
    try {
        await axios.get(`${OIP_DAEMON_URL}/health`, { timeout: 5000 });
        console.log('✅ Connected to OIP Daemon Service');
    } catch (error) {
        console.warn('⚠️  Could not connect to OIP Daemon Service');
        console.warn(`   URL: ${OIP_DAEMON_URL}`);
        console.warn('   Alexandria will retry connections on each request');
    }
    
    // Check AI services
    const ollamaHost = process.env.OLLAMA_HOST || 'http://ollama:11434';
    try {
        await axios.get(`${ollamaHost}/api/tags`, { timeout: 5000 });
        console.log('✅ Connected to Ollama');
    } catch (error) {
        console.warn('⚠️  Could not connect to Ollama');
        console.warn(`   URL: ${ollamaHost}`);
    }
    
    // Check TTS service
    const ttsUrl = process.env.TTS_SERVICE_URL || 'http://tts-service:8005';
    try {
        await axios.get(`${ttsUrl}/health`, { timeout: 5000 });
        console.log('✅ Connected to TTS Service');
    } catch (error) {
        console.warn('⚠️  Could not connect to TTS Service');
    }
    
    // Check STT service
    const sttUrl = process.env.STT_SERVICE_URL || 'http://stt-service:8013';
    try {
        await axios.get(`${sttUrl}/health`, { timeout: 5000 });
        console.log('✅ Connected to STT Service');
    } catch (error) {
        console.warn('⚠️  Could not connect to STT Service');
    }
    
    console.log('\n');
    
    // ═══════════════════════════════════════════════════════════════════
    // Memory Monitor
    // ═══════════════════════════════════════════════════════════════════
    const memoryMonitorInterval = parseInt(process.env.MEMORY_MONITOR_INTERVAL) || 300000;
    
    setInterval(() => {
        const memUsage = process.memoryUsage();
        const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
        const rssMB = Math.round(memUsage.rss / 1024 / 1024);
        const externalMB = Math.round(memUsage.external / 1024 / 1024);
        
        console.log(`[Memory] Heap: ${heapUsedMB}MB, RSS: ${rssMB}MB, External: ${externalMB}MB, Clients: ${clientStates.size}`);
        
        // Critical warning
        if (rssMB > 12288) { // 12GB
            console.warn(`🚨 MEMORY CRITICAL: RSS at ${rssMB}MB`);
            if (global.gc) {
                console.log('🧹 Emergency GC...');
                global.gc();
            }
        }
    }, memoryMonitorInterval);
    
    console.log(`✅ Memory monitor started (${memoryMonitorInterval/1000}s interval)`);
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
});

process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down...');
    console.log('Memory at shutdown:', process.memoryUsage());
    
    // Cleanup all client states
    clientStates.clear();
    
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT received, shutting down...');
    clientStates.clear();
    process.exit(0);
});

