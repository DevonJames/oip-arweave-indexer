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
        
        // Allow all .onion domains (TOR hidden services)
        if (origin.includes('.onion')) {
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

// Proxy publishAnonymous to daemon (daemon handles WordPress publishing via wp-cli)
app.post('/onion-press/api/records/publishAnonymous', async (req, res) => {
    // Try to proxy to daemon first (daemon uses wp-cli which works reliably)
    // The daemon endpoint is at /api/records/publishAnonymous (not /onion-press/api/records/publishAnonymous)
    console.log(`🔍 [PublishAnonymous] Attempting to proxy to daemon at ${OIP_DAEMON_URL}/api/records/publishAnonymous...`);
    
    // Check if daemon is accessible first (quick check)
    let daemonAccessible = false;
    try {
        const healthCheck = await axios.get(`${OIP_DAEMON_URL}/health`, {
            timeout: 2000,
            validateStatus: () => true
        });
        daemonAccessible = healthCheck.status === 200;
        if (!daemonAccessible) {
            console.warn(`⚠️ [PublishAnonymous] Daemon health check returned status ${healthCheck.status}`);
        }
    } catch (daemonError) {
        console.warn(`⚠️ [PublishAnonymous] Daemon health check failed: ${daemonError.code || daemonError.message} (${OIP_DAEMON_URL}/health)`);
        daemonAccessible = false;
    }
    
    if (daemonAccessible) {
        console.log(`✅ [PublishAnonymous] Daemon is accessible at ${OIP_DAEMON_URL}, proxying request...`);
        try {
            await proxyToDaemon(req, res, '/api/records/publishAnonymous');
            return; // Proxy handled the response
        } catch (proxyError) {
            console.warn(`⚠️ [PublishAnonymous] Proxy failed: ${proxyError.message}, falling back to direct WordPress`);
        }
    } else {
        console.warn(`⚠️ [PublishAnonymous] Daemon not accessible at ${OIP_DAEMON_URL}, using direct WordPress REST API`);
    }
    
    // Fallback: Direct WordPress REST API implementation
    try {
        const { payload, destinations } = req.body;
        
        if (!payload) {
            return res.status(400).json({
                error: 'Missing payload',
                message: 'Request body must include a "payload" object'
            });
        }
        
        console.log(`📝 [PublishAnonymous] Received anonymous payload`);
        
        // Validate payload structure
        if (!payload.tags || !Array.isArray(payload.tags)) {
            return res.status(400).json({
                error: 'Invalid payload',
                message: 'Payload must include a "tags" array'
            });
        }
        
        // For TOR service, default to WordPress-only publishing (local-only mode)
        const publishToWordPress = destinations?.thisHost !== false;
        
        if (!publishToWordPress) {
            return res.status(400).json({
                error: 'No destination enabled',
                message: 'WordPress publishing (thisHost) must be enabled for anonymous publishing'
            });
        }
        
        // Extract record data from fragments
        const fragment = payload.fragments?.[0];
        if (!fragment || !fragment.records || fragment.records.length === 0) {
            return res.status(400).json({
                error: 'Invalid payload',
                message: 'Payload must include at least one fragment with records'
            });
        }
        
        const recordData = fragment.records[0];
        const recordType = payload.tags.find(t => t.name === 'Record-Type')?.value || 'post';
        
        // Build WordPress post data
        const wpPostData = {
            title: recordData.basic?.name || recordData.post?.title || 'Untitled',
            content: recordData.basic?.description || recordData.post?.content || '',
            excerpt: recordData.basic?.description || recordData.post?.excerpt || '',
            status: 'publish'
        };
        
        // Publish to WordPress via REST API
        const wordpressUrl = process.env.WORDPRESS_URL || 'http://wordpress:80';
        const wpApiUrl = `${wordpressUrl}/wp-json/wp/v2/posts`;
        
        // Get WordPress admin credentials for authentication
        // Note: WordPress username is "OIP Daemon" by default (matches daemon's WordPress user)
        const WORDPRESS_ADMIN_USER = process.env.WP_ADMIN_USER || 'OIP Daemon';
        const WORDPRESS_ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || '';
        
        if (!WORDPRESS_ADMIN_PASSWORD) {
            return res.status(500).json({
                error: 'WordPress authentication not configured',
                message: 'WP_ADMIN_PASSWORD environment variable is required'
            });
        }
        
        // Get Application Password (WordPress REST API requires it for creating posts)
        let authPassword = WORDPRESS_ADMIN_PASSWORD;
        let authUsername = WORDPRESS_ADMIN_USER;
        
        // Check if Application Password is provided via env var
        if (process.env.WP_APP_PASSWORD) {
            // WordPress Application Passwords MUST be used WITH SPACES for Basic Auth
            // WordPress displays them as "xxxx xxxx xxxx xxxx xxxx xxxx" and expects that exact format
            authPassword = process.env.WP_APP_PASSWORD; // Keep spaces!
            console.log(`✅ [PublishAnonymous] Using Application Password from WP_APP_PASSWORD env var`);
            
            // Application Passwords are user-specific - try to find which user it belongs to
            // Try common usernames: "devon" (most common), then env var, then defaults
            const possibleUsernames = [
                'devon',  // Most common WordPress username (Application Password shown in logs is for "devon")
                WORDPRESS_ADMIN_USER,  // From env var or default ("OIP Daemon")
                'admin',  // Default admin username
                'OIP Daemon'  // Display name (unlikely to be username, but try anyway)
            ];
            
            // Remove duplicates
            const uniqueUsernames = [...new Set(possibleUsernames)];
            
            let appPasswordAuthenticated = false;
            for (const testUsername of uniqueUsernames) {
                try {
                    const verifyAppPassword = await axios.get(`${wordpressUrl}/wp-json/wp/v2/users/me`, {
                        auth: {
                            username: testUsername,
                            password: authPassword
                        },
                        timeout: 10000,
                        validateStatus: () => true
                    });
                    
                    if (verifyAppPassword.status === 200) {
                        const appPasswordUser = verifyAppPassword.data.name || verifyAppPassword.data.slug;
                        const appPasswordUserLogin = verifyAppPassword.data.slug || testUsername;
                        const appPasswordRoles = verifyAppPassword.data.roles || [];
                        console.log(`✅ [PublishAnonymous] Application Password authenticates as: ${appPasswordUser} (login: ${appPasswordUserLogin}), Roles: ${appPasswordRoles.join(', ')}`);
                        
                        // Use the correct username for this Application Password
                        authUsername = appPasswordUserLogin;
                        appPasswordAuthenticated = true;
                        
                        // Check if user has editor/administrator role
                        if (!appPasswordRoles.includes('administrator') && !appPasswordRoles.includes('editor')) {
                            console.error(`❌ [PublishAnonymous] Application Password user "${appPasswordUser}" does not have administrator or editor role. Roles: ${appPasswordRoles.join(', ')}`);
                            return res.status(403).json({
                                error: 'Insufficient permissions',
                                message: `Application Password is for user "${appPasswordUser}" who does not have permission to create posts. User must have administrator or editor role. Current roles: ${appPasswordRoles.join(', ')}`,
                                userRoles: appPasswordRoles,
                                username: appPasswordUser
                            });
                        }
                        break; // Found the correct username
                    }
                } catch (verifyError) {
                    // Try next username
                    continue;
                }
            }
            
            if (!appPasswordAuthenticated) {
                console.warn(`⚠️ [PublishAnonymous] Application Password didn't authenticate with any tested username. The Application Password in WP_APP_PASSWORD may be incorrect or expired.`);
                console.warn(`⚠️ [PublishAnonymous] Will try to create a new Application Password for user "devon" (has administrator role)`);
                
                // Try to authenticate with regular password for "devon" user to create Application Password
                try {
                    const devonAuthResponse = await axios.get(`${wordpressUrl}/wp-json/wp/v2/users/me`, {
                        auth: {
                            username: 'devon',
                            password: WORDPRESS_ADMIN_PASSWORD
                        },
                        timeout: 10000,
                        validateStatus: () => true
                    });
                    
                    if (devonAuthResponse.status === 200 && devonAuthResponse.data?.id) {
                        const devonUserId = devonAuthResponse.data.id;
                        const devonRoles = devonAuthResponse.data.roles || [];
                        console.log(`✅ [PublishAnonymous] Authenticated as "devon" (ID: ${devonUserId}), Roles: ${devonRoles.join(', ')}, creating Application Password...`);
                        
                        // Create Application Password for devon user
                        const appPasswordResponse = await axios.post(
                            `${wordpressUrl}/wp-json/wp/v2/users/${devonUserId}/application-passwords`,
                            {
                                name: 'Onion Press Service',
                                app_id: 'onion-press-service'
                            },
                            {
                                auth: {
                                    username: 'devon',
                                    password: WORDPRESS_ADMIN_PASSWORD
                                },
                                timeout: 10000,
                                validateStatus: () => true
                            }
                        );
                        
                        if (appPasswordResponse.status === 201 && appPasswordResponse.data?.password) {
                            authPassword = appPasswordResponse.data.password; // Keep spaces - WordPress requires them!
                            authUsername = 'devon';
                            console.log(`✅ [PublishAnonymous] Created Application Password for "devon" successfully`);
                            console.log(`⚠️ [PublishAnonymous] IMPORTANT: Update WP_APP_PASSWORD in .env with: "${appPasswordResponse.data.password}" (WITH SPACES!)`);
                        } else {
                            console.warn(`⚠️ [PublishAnonymous] Could not create Application Password (status ${appPasswordResponse.status}), will try regular password`);
                            authPassword = WORDPRESS_ADMIN_PASSWORD;
                            authUsername = 'devon';
                        }
                    } else {
                        console.error(`❌ [PublishAnonymous] Could not authenticate as "devon" (status ${devonAuthResponse.status})`);
                        authPassword = WORDPRESS_ADMIN_PASSWORD;
                        authUsername = 'devon'; // Try anyway
                    }
                } catch (devonError) {
                    console.error(`❌ [PublishAnonymous] Error authenticating as "devon": ${devonError.message}`);
                    authPassword = WORDPRESS_ADMIN_PASSWORD;
                    authUsername = 'devon'; // Try anyway
                }
            }
        }
        
        // If we still don't have a valid Application Password, try regular password with devon
        if (authPassword === WORDPRESS_ADMIN_PASSWORD && !authUsername) {
            authUsername = 'devon'; // Default to devon since that's the admin user
        }
        
        console.log(`📝 [PublishAnonymous] Publishing to WordPress: ${wpApiUrl}`);
        console.log(`🔍 [PublishAnonymous] Using ${authPassword === WORDPRESS_ADMIN_PASSWORD ? 'regular' : 'Application'} password`);
        console.log(`🔍 [PublishAnonymous] WordPress username: ${authUsername}`);
        
        // Verify authentication before publishing
        let authenticatedUser = null;
        try {
            const verifyResponse = await axios.get(`${wordpressUrl}/wp-json/wp/v2/users/me`, {
                auth: {
                    username: authUsername,
                    password: authPassword
                },
                timeout: 10000,
                validateStatus: () => true
            });
            
            if (verifyResponse.status === 200) {
                authenticatedUser = verifyResponse.data.name || verifyResponse.data.slug;
                const userRoles = verifyResponse.data.roles || [];
                console.log(`✅ [PublishAnonymous] Verified authentication as: ${authenticatedUser}, Roles: ${userRoles.join(', ')}`);
                
                if (!userRoles.includes('administrator') && !userRoles.includes('editor')) {
                    return res.status(403).json({
                        error: 'Insufficient permissions',
                        message: `User "${authenticatedUser}" does not have permission to create posts. User must have administrator or editor role.`,
                        userRoles: userRoles,
                        username: authenticatedUser
                    });
                }
            } else {
                console.error(`❌ [PublishAnonymous] Authentication verification failed: ${verifyResponse.status}`, verifyResponse.data);
                return res.status(401).json({
                    error: 'WordPress authentication failed',
                    message: `Could not verify WordPress authentication. Status: ${verifyResponse.status}`,
                    details: verifyResponse.data,
                    solution: 'Create an Application Password: docker exec -it onionpress-wordpress-1 wp user application-password create devon "Onion Press Service" --allow-root'
                });
            }
        } catch (verifyError) {
            console.error(`❌ [PublishAnonymous] Error verifying authentication:`, verifyError.message);
            return res.status(401).json({
                error: 'WordPress authentication failed',
                message: `Could not authenticate with WordPress. ${verifyError.message}`,
                solution: 'Run this command to create an Application Password for user "devon":\n' +
                      'docker exec -it onionpress-wordpress-1 wp user application-password create devon "Onion Press Service" --allow-root\n' +
                      'Then copy the Application Password (shown in the output) and set WP_APP_PASSWORD in your .env file.'
            });
        }
        
        // Create WordPress post via REST API
        const wpResponse = await axios.post(wpApiUrl, wpPostData, {
            auth: {
                username: authUsername,
                password: authPassword
            },
            timeout: 30000,
            validateStatus: () => true
        });
        
        if (wpResponse.status !== 201 && wpResponse.status !== 200) {
            console.error(`❌ [PublishAnonymous] WordPress API error: ${wpResponse.status}`, wpResponse.data);
            console.error(`❌ [PublishAnonymous] Authenticated user was: ${authenticatedUser}`);
            return res.status(500).json({
                error: 'WordPress publish failed',
                message: wpResponse.data?.message || `WordPress returned status ${wpResponse.status}`,
                details: wpResponse.data,
                authenticatedUser: authenticatedUser
            });
        }
        
        const wpPost = wpResponse.data;
        const baseUrl = process.env.PUBLIC_API_BASE_URL || `${req.protocol}://${req.get('host')}`;
        const wordpressPath = process.env.WORDPRESS_PROXY_PATH || '/wordpress';
        const permalink = wpPost.link || `${baseUrl}${wordpressPath}/?p=${wpPost.id}`;
        
        console.log(`✅ [PublishAnonymous] Published to WordPress! Post ID: ${wpPost.id}, Permalink: ${permalink}`);
        
        res.status(200).json({
            success: true,
            destinations: {
                thisHost: {
                    success: true,
                    postId: wpPost.id,
                    permalink: permalink,
                    postUrl: permalink
                }
            }
        });
        
    } catch (error) {
        console.error('❌ [PublishAnonymous] Error:', error.message);
        console.error('❌ [PublishAnonymous] Stack:', error.stack);
        
        res.status(500).json({
            error: 'Failed to publish anonymous record',
            message: error.message
        });
    }
});

app.post('/onion-press/api/records/publishSigned', async (req, res) => {
    await proxyToDaemon(req, res, '/api/records/publishSigned');
});

app.post('/onion-press/api/records/publishAccount', async (req, res) => {
    await proxyToDaemon(req, res, '/api/records/publishAccount');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Proxy routes to daemon
// ═══════════════════════════════════════════════════════════════════════════════
const axios = require('axios');
// Use OIP_DAEMON_URL from env, or default to port 3005
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

// WordPress posts API - Use WordPress REST API directly (containers can't run docker exec)
app.get('/onion-press/api/wordpress/posts', async (req, res) => {
    try {
        const WORDPRESS_PROXY_ENABLED = process.env.WORDPRESS_PROXY_ENABLED === 'true';
        
        if (!WORDPRESS_PROXY_ENABLED) {
            return res.status(503).json({
                error: 'WordPress not available',
                message: 'WordPress proxy is not enabled'
            });
        }
        
        const { limit = 20, offset = 0, search, type } = req.query;
        
        if (type && type !== 'post') {
            return res.json({ records: [] });
        }
        
        // Use WordPress REST API (accessible via HTTP from container)
        const wordpressUrl = process.env.WORDPRESS_URL || 'http://wordpress:80';
        const wpApiUrl = `${wordpressUrl}/wp-json/wp/v2/posts`;
        
        const params = new URLSearchParams({
            per_page: Math.min(parseInt(limit) || 20, 100),
            offset: parseInt(offset) || 0,
            _embed: 'true',
            status: 'publish'
        });
        
        // Request meta fields to get byline information
        // Note: WordPress REST API requires meta fields to be registered, but we'll fetch them separately if needed
        
        if (search) {
            params.append('search', search);
        }
        
        console.log(`🔍 [WordPressPosts] Querying WordPress REST API: ${wpApiUrl}?${params.toString()}`);
        
        const response = await axios.get(`${wpApiUrl}?${params.toString()}`, {
            timeout: 10000,
            validateStatus: () => true,
            headers: {
                'Accept': 'application/json'
            }
        });
        
        if (response.status !== 200) {
            console.error(`❌ [WordPressPosts] WordPress API returned status ${response.status}`);
            return res.status(503).json({
                error: 'WordPress API error',
                message: `WordPress returned status ${response.status}`,
                details: response.data
            });
        }
        
        const wpPosts = Array.isArray(response.data) ? response.data : [];
        console.log(`✅ [WordPressPosts] Retrieved ${wpPosts.length} posts from WordPress`);
        
        // Build base URL for permalinks
        const baseUrl = process.env.PUBLIC_API_BASE_URL || `${req.protocol}://${req.get('host')}`;
        const wordpressPath = process.env.WORDPRESS_PROXY_PATH || '/wordpress';
        
        // Transform WordPress posts to OIP-like format
        // Fetch meta fields for each post to get byline information
        const records = await Promise.all(wpPosts.map(async (post) => {
            let permalink = post.link;
            if (!permalink && post.id) {
                permalink = `${baseUrl}${wordpressPath}/?p=${post.id}`;
            }
            
            // Get author from WordPress post
            let author = post._embedded?.author?.[0]?.name || '';
            let displayAuthor = author;
            
            // Fetch meta fields via wp-cli (WordPress REST API doesn't reliably return custom meta)
            try {
                const { execSync } = require('child_process');
                const projectName = process.env.COMPOSE_PROJECT_NAME || 'onionpress';
                const wpContainerName = `${projectName}-wordpress-1`;
                
                // Get publishing mode
                const publisherModeCmd = `docker exec ${wpContainerName} wp post meta get ${post.id} op_publisher_mode --allow-root 2>/dev/null || echo ""`;
                const publisherMode = execSync(publisherModeCmd, { encoding: 'utf-8', timeout: 5000 }).trim();
                const isDidMode = (publisherMode === 'did');
                
                if (isDidMode) {
                    // For DID mode, prioritize the DID from op_publisher_creator_did
                    const creatorDidCmd = `docker exec ${wpContainerName} wp post meta get ${post.id} op_publisher_creator_did --allow-root 2>/dev/null || echo ""`;
                    const creatorDid = execSync(creatorDidCmd, { encoding: 'utf-8', timeout: 5000 }).trim();
                    if (creatorDid) {
                        displayAuthor = creatorDid;
                    } else {
                        // Fallback to byline meta fields
                        const bylineCmd = `docker exec ${wpContainerName} wp post meta get ${post.id} _op_byline --allow-root 2>/dev/null || docker exec ${wpContainerName} wp post meta get ${post.id} op_publisher_byline --allow-root 2>/dev/null || echo ""`;
                        const byline = execSync(bylineCmd, { encoding: 'utf-8', timeout: 5000 }).trim();
                        displayAuthor = byline || author;
                    }
                } else {
                    // For non-DID modes, use byline if available
                    const bylineCmd = `docker exec ${wpContainerName} wp post meta get ${post.id} _op_byline --allow-root 2>/dev/null || docker exec ${wpContainerName} wp post meta get ${post.id} op_publisher_byline --allow-root 2>/dev/null || echo ""`;
                    const byline = execSync(bylineCmd, { encoding: 'utf-8', timeout: 5000 }).trim();
                    displayAuthor = byline || author;
                }
            } catch (metaError) {
                // Ignore meta fetch errors - fallback to author name
                console.warn(`⚠️ [WordPressPosts] Could not fetch meta for post ${post.id}:`, metaError.message);
                displayAuthor = author;
            }
            
            return {
                wordpress: {
                    postId: post.id,
                    title: post.title?.rendered || '',
                    excerpt: post.excerpt?.rendered || '',
                    content: post.content?.rendered || '',
                    postDate: post.date,
                    permalink: permalink,
                    tags: post._embedded?.['wp:term']?.[0]?.map(t => t.name) || [],
                    author: displayAuthor
                },
                id: `wp-${post.id}`,
                oip: {
                    indexedAt: post.date
                }
            };
        }));
        
        console.log(`✅ [WordPressPosts] Returning ${records.length} transformed records`);
        res.json({ records });
        
    } catch (error) {
        console.error('❌ [WordPressPosts] Error:', error.message);
        res.status(500).json({
            error: 'Failed to fetch WordPress posts',
            message: error.message
        });
    }
});

// Host-info API - Implement directly
app.get('/onion-press/api/host-info', (req, res) => {
    const hostName = process.env.COMPOSE_PROJECT_NAME || 'Onion Press';
    const hostUrl = process.env.PUBLIC_API_BASE_URL || `${req.protocol}://${req.get('host')}`;
    
    res.json({
        name: hostName,
        url: hostUrl
    });
});

// Destinations defaults API - Implement directly
app.get('/onion-press/api/destinations/defaults', (req, res) => {
    // Read from environment variables (defaults match original behavior)
    const defaults = {
        arweave: process.env.PUBLISH_TO_ARWEAVE !== 'false',
        gun: process.env.PUBLISH_TO_GUN !== 'false',
        thisHost: process.env.PUBLISH_TO_THIS_HOST === 'true'
    };
    
    res.json({
        destinations: defaults
    });
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

