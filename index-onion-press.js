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
        console.log(`🔍 [Proxy] OIP_DAEMON_URL: ${OIP_DAEMON_URL}`);
        
        const config = {
            method: req.method,
            url: targetUrl,
            timeout: 10000, // Shorter timeout to fail faster
            validateStatus: () => true, // Don't throw on any status
            headers: {
                'Content-Type': req.headers['content-type'] || 'application/json',
                'Authorization': req.headers.authorization || ''
            }
        };
        
        if (req.body && Object.keys(req.body).length > 0) {
            config.data = req.body;
        }
        
        let response;
        try {
            response = await axios(config);
        } catch (axiosError) {
            // Axios error (network, timeout, etc.)
            console.error(`❌ [Proxy] Axios error for ${endpoint}:`, axiosError.message);
            console.error(`❌ [Proxy] Error code:`, axiosError.code);
            console.error(`❌ [Proxy] Error details:`, {
                code: axiosError.code,
                message: axiosError.message,
                syscall: axiosError.syscall,
                address: axiosError.address,
                port: axiosError.port,
                errno: axiosError.errno
            });
            
            // Check if it's a connection error
            if (axiosError.code === 'ECONNREFUSED' || axiosError.code === 'ENOTFOUND' || axiosError.code === 'EAI_AGAIN') {
                return res.status(503).json({
                    error: 'Daemon service unavailable',
                    message: `Cannot connect to daemon at ${OIP_DAEMON_URL}. Is the daemon service running?`,
                    endpoint: endpoint,
                    daemonUrl: OIP_DAEMON_URL,
                    errorCode: axiosError.code
                });
            }
            
            throw axiosError; // Re-throw to be caught by outer catch
        }
        
        console.log(`✅ [Proxy] Response status: ${response.status} for ${endpoint}`);
        
        if (response.status !== 200) {
            console.warn(`⚠️ [Proxy] Non-200 status: ${response.status} for ${endpoint}`, response.data);
        }
        
        res.status(response.status).json(response.data);
        
    } catch (error) {
        console.error(`❌ [Proxy] Unexpected error proxying ${endpoint}:`, error.message);
        console.error(`❌ [Proxy] Error stack:`, error.stack);
        
        const statusCode = error.response?.status || 500;
        const errorMessage = error.response?.data?.message || error.message || 'Proxy request failed';
        
        res.status(statusCode).json({
            error: 'Proxy request failed',
            message: errorMessage,
            endpoint: endpoint,
            daemonUrl: OIP_DAEMON_URL,
            details: error.response?.data || { 
                code: error.code, 
                message: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            }
        });
    }
}

// Proxy WordPress posts API to daemon (which uses wp-cli)
// If daemon is unavailable, try direct WordPress access
app.get('/onion-press/api/wordpress/posts', async (req, res) => {
    // Try direct WordPress access first (more reliable for standalone TOR service)
    const WORDPRESS_PROXY_ENABLED = process.env.WORDPRESS_PROXY_ENABLED === 'true';
    
    if (WORDPRESS_PROXY_ENABLED) {
        try {
            const { execSync } = require('child_process');
            const { limit = 20, offset = 0, search, type } = req.query;
            
            if (type && type !== 'post') {
                return res.json({ records: [] });
            }
            
            // Use wp-cli directly (same as daemon does)
            const projectName = process.env.COMPOSE_PROJECT_NAME || 'onionpress';
            const wpContainerName = `${projectName}-wordpress-1`;
            
            let wpCommand = `docker exec ${wpContainerName} wp post list `;
            wpCommand += `--format=json `;
            wpCommand += `--posts_per_page=${Math.min(parseInt(limit) || 20, 100)} `;
            wpCommand += `--offset=${parseInt(offset) || 0} `;
            wpCommand += `--post_status=publish `;
            wpCommand += `--orderby=date `;
            wpCommand += `--order=DESC `;
            wpCommand += `--allow-root`;
            
            if (search) {
                wpCommand += ` --s='${search.replace(/'/g, "'\\''")}'`;
            }
            
            console.log(`🔧 [WordPressPosts] Executing wp-cli: ${wpCommand}`);
            
            const wpOutput = execSync(wpCommand, { encoding: 'utf-8', timeout: 10000 });
            const wpPosts = JSON.parse(wpOutput.trim() || '[]');
            
            if (!Array.isArray(wpPosts)) {
                return res.json({ records: [] });
            }
            
            // Get full post details
            const postsWithDetails = [];
            for (const post of wpPosts) {
                try {
                    const detailCommand = `docker exec ${wpContainerName} wp post get ${post.ID} --format=json --allow-root`;
                    const detailOutput = execSync(detailCommand, { encoding: 'utf-8', timeout: 5000 });
                    const postDetail = JSON.parse(detailOutput.trim());
                    
                    let authorName = '';
                    if (postDetail.post_author) {
                        try {
                            const authorCommand = `docker exec ${wpContainerName} wp user get ${postDetail.post_author} --field=display_name --allow-root`;
                            authorName = execSync(authorCommand, { encoding: 'utf-8', timeout: 3000 }).trim();
                        } catch (e) {}
                    }
                    
                    postsWithDetails.push({
                        id: postDetail.ID,
                        title: postDetail.post_title || '',
                        content: postDetail.post_content || '',
                        excerpt: postDetail.post_excerpt || '',
                        date: postDetail.post_date || postDetail.post_date_gmt,
                        author: authorName,
                        link: postDetail.guid || ''
                    });
                } catch (detailError) {
                    postsWithDetails.push({
                        id: post.ID,
                        title: post.post_title || '',
                        content: '',
                        excerpt: '',
                        date: post.post_date || '',
                        author: '',
                        link: ''
                    });
                }
            }
            
            // Filter by search if provided
            let filteredPosts = postsWithDetails;
            if (search) {
                const searchLower = search.toLowerCase();
                filteredPosts = postsWithDetails.filter(post => 
                    (post.title && post.title.toLowerCase().includes(searchLower)) ||
                    (post.content && post.content.toLowerCase().includes(searchLower)) ||
                    (post.excerpt && post.excerpt.toLowerCase().includes(searchLower))
                );
            }
            
            // Build base URL for permalinks
            const baseUrl = process.env.PUBLIC_API_BASE_URL || `${req.protocol}://${req.get('host')}`;
            const wordpressPath = process.env.WORDPRESS_PROXY_PATH || '/wordpress';
            
            // Transform to OIP format
            const records = filteredPosts.map(post => {
                let permalink = post.link;
                if (!permalink && post.id) {
                    permalink = `${baseUrl}${wordpressPath}/?p=${post.id}`;
                }
                
                return {
                    wordpress: {
                        postId: post.id,
                        title: post.title,
                        excerpt: post.excerpt,
                        content: post.content,
                        postDate: post.date,
                        permalink: permalink,
                        tags: [],
                        author: post.author
                    },
                    id: `wp-${post.id}`,
                    oip: {
                        indexedAt: post.date
                    }
                };
            });
            
            console.log(`✅ [WordPressPosts] Returning ${records.length} records`);
            return res.json({ records });
            
        } catch (directError) {
            console.error('❌ [WordPressPosts] Direct wp-cli error:', directError.message);
            // Fall through to proxy attempt
        }
    }
    
    // Fallback: try to proxy to daemon
    console.log('⚠️ [WordPressPosts] Trying proxy to daemon...');
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

