/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ONION PRESS SERVICE - Entry Point
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Purpose: Anonymous publishing platform with WordPress integration and TOR
 * Analogy: The Underground Press (anonymous publishing, distributed syndication)
 * 
 * This service handles:
 *   - Multi-destination publishing (Arweave, GUN, Internet Archive)
 *   - WordPress integration via LO Publisher plugin
 *   - TOR client for anonymous publishing
 *   - Enhanced browsing interface
 *   - Admin settings management
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const http = require('http');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables first
dotenv.config();

// ═══════════════════════════════════════════════════════════════════════════════
// Import Routes
// ═══════════════════════════════════════════════════════════════════════════════
const publishRoutes = require('./routes/onion-press/publish');
const adminRoutes = require('./routes/onion-press/admin');
const browseRoutes = require('./routes/onion-press/browse');
const torRoutes = require('./routes/onion-press/tor');
const debugRoutes = require('./routes/onion-press/debug');

// ═══════════════════════════════════════════════════════════════════════════════
// Import Helpers
// ═══════════════════════════════════════════════════════════════════════════════
const settingsManager = require('./helpers/onion-press/settingsManager');

// ═══════════════════════════════════════════════════════════════════════════════
// Create Express App
// ═══════════════════════════════════════════════════════════════════════════════
const app = express();
const server = http.createServer(app);

// ═══════════════════════════════════════════════════════════════════════════════
// Express Configuration
// ═══════════════════════════════════════════════════════════════════════════════
// Body size limits
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

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
            'http://localhost:3005',
            'http://localhost:3006',
            'http://localhost:3007',
            'http://localhost:8080',  // WordPress
            `http://localhost:${process.env.PORT || 3007}`,
            'https://api.oip.onl',
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

const port = process.env.PORT || 3007;

// ═══════════════════════════════════════════════════════════════════════════════
// Mount API Routes
// ═══════════════════════════════════════════════════════════════════════════════
app.use('/api/publish', publishRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/browse', browseRoutes);
app.use('/api/tor', torRoutes);
app.use('/api/debug', debugRoutes);

// Also mount at /onion-press/api for frontend compatibility
app.use('/onion-press/api/publish', publishRoutes);
app.use('/onion-press/api/admin', adminRoutes);
app.use('/onion-press/api/browse', browseRoutes);
app.use('/onion-press/api/tor', torRoutes);
app.use('/onion-press/api/debug', debugRoutes);

// ═══════════════════════════════════════════════════════════════════════════════
// Proxy routes to daemon
// ═══════════════════════════════════════════════════════════════════════════════
const axios = require('axios');
const OIP_DAEMON_URL = process.env.OIP_DAEMON_URL || 'http://oip-daemon-service:3005';

/**
 * Generic proxy function to forward requests to daemon
 */
async function proxyToDaemon(req, res, endpoint) {
    try {
        const queryString = new URLSearchParams(req.query).toString();
        const targetUrl = `${OIP_DAEMON_URL}${endpoint}${queryString ? '?' + queryString : ''}`;
        
        console.log(`🔍 [Proxy] ${req.method} ${req.path} -> ${targetUrl}`);
        
        const config = {
            method: req.method,
            url: targetUrl,
            timeout: 30000,
            validateStatus: () => true,
            headers: {
                'Content-Type': req.headers['content-type'] || 'application/json',
                'Authorization': req.headers.authorization || ''
            }
        };
        
        if (req.body && Object.keys(req.body).length > 0) {
            config.data = req.body;
        }
        
        const response = await axios(config);
        
        if (response.status !== 200) {
            console.warn(`⚠️ [Proxy] Non-200 status: ${response.status} for ${endpoint}`);
        }
        
        res.status(response.status).json(response.data);
        
    } catch (error) {
        console.error(`❌ [Proxy] Error proxying ${endpoint}:`, error.message);
        console.error(`❌ [Proxy] Error code:`, error.code);
        console.error(`❌ [Proxy] Error response:`, error.response?.data);
        
        const statusCode = error.response?.status || 500;
        const errorMessage = error.response?.data?.message || error.message || 'Proxy request failed';
        
        res.status(statusCode).json({
            error: 'Proxy request failed',
            message: errorMessage,
            endpoint: endpoint,
            details: error.response?.data || { code: error.code, message: error.message }
        });
    }
}

// Proxy WordPress posts API to daemon (which uses wp-cli)
app.get('/onion-press/api/wordpress/posts', async (req, res) => {
    await proxyToDaemon(req, res, '/onion-press/api/wordpress/posts');
});

// Proxy host-info API to daemon
app.get('/onion-press/api/host-info', async (req, res) => {
    await proxyToDaemon(req, res, '/onion-press/api/host-info');
});

// Proxy destinations defaults API to daemon
app.get('/onion-press/api/destinations/defaults', async (req, res) => {
    await proxyToDaemon(req, res, '/onion-press/api/destinations/defaults');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Static Files - Browsing Interface
// ═══════════════════════════════════════════════════════════════════════════════
// Serve static files at /onion-press path to match HTML references
app.use('/onion-press', express.static(path.join(__dirname, 'public', 'onion-press'), {
    index: 'index.html',
    etag: true,
    lastModified: true
}));

// Also serve at root for convenience
app.use(express.static(path.join(__dirname, 'public', 'onion-press')));

// Serve index.html for all non-API routes (SPA support)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'onion-press', 'index.html'));
});

// Serve debug interface
app.get('/debug', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'onion-press', 'debug.html'));
});

// Serve v0.9 anonymous publisher interface
app.get('/publish', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'onion-press', 'publish.html'));
});

// ═══════════════════════════════════════════════════════════════════════════════
// Basic Health Check
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK',
        service: 'onion-press-service',
        timestamp: new Date().toISOString(),
        settings: {
            publishToArweave: settingsManager.getSetting('publishToArweave'),
            publishToGun: settingsManager.getSetting('publishToGun'),
            publishToThisHost: settingsManager.getSetting('publishToThisHost')
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// API Root
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api', (req, res) => {
    res.json({
        service: 'onion-press-service',
        version: '1.0.0',
        endpoints: {
            publish: '/api/publish',
            admin: '/api/admin',
            browse: '/api/browse',
            tor: '/api/tor'
        }
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
server.listen(port, async () => {
    console.log(`\n═══════════════════════════════════════════════════════════════`);
    console.log(`  🧅 ONION PRESS SERVICE`);
    console.log(`  Port: ${port}`);
    console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`═══════════════════════════════════════════════════════════════`);
    console.log(`\n  Publishing Destinations:`);
    console.log(`    Arweave:          ${settingsManager.getSetting('publishToArweave') ? '✓' : '✗'}`);
    console.log(`    GUN:              ${settingsManager.getSetting('publishToGun') ? '✓' : '✗'}`);
    console.log(`    This Host:        ${settingsManager.getSetting('publishToThisHost') ? '✓' : '✗'}`);
    console.log(`\n  OIP Daemon: ${process.env.OIP_DAEMON_URL || 'http://oip-daemon-service:3005'}`);
    console.log(`  TOR Proxy:  127.0.0.1:9050 (integrated)`);
    if (process.env.ONION_ADDRESS) {
        console.log(`  .onion:     ${process.env.ONION_ADDRESS}`);
    }
    console.log(`\n═══════════════════════════════════════════════════════════════\n`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Graceful Shutdown
// ═══════════════════════════════════════════════════════════════════════════════
process.on('uncaughtException', (error) => {
    console.error('\n🚨 UNCAUGHT EXCEPTION 🚨');
    console.error('Time:', new Date().toISOString());
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('\n⚠️  UNHANDLED REJECTION');
    console.error('Time:', new Date().toISOString());
    console.error('Reason:', reason);
});

process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT received, shutting down...');
    process.exit(0);
});

