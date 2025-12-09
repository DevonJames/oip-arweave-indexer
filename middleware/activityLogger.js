const { elasticClient } = require('../helpers/elasticsearch');

/**
 * Middleware to log API activity for analytics
 * Tracks authenticated user activity, endpoints called, and response status
 */
async function logAPIActivity(req, res, next) {
    // Capture the original res.json to intercept response
    const originalJson = res.json.bind(res);
    const startTime = Date.now();
    
    res.json = function(body) {
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        // Log activity asynchronously (don't block response)
        logActivity(req, res, duration, body).catch(error => {
            console.error('❌ Error logging API activity:', error);
        });
        
        return originalJson(body);
    };
    
    next();
}

async function logActivity(req, res, duration, responseBody) {
    try {
        // Get full path including base URL (e.g., /api/records instead of just /records)
        const fullPath = req.baseUrl + req.path;
        
        // Skip logging for certain endpoints (to avoid infinite loops or noise)
        const skipEndpoints = [
            '/api/admin/node-analytics', // Don't log the analytics endpoint itself
            '/health',
            '/metrics',
            '/config.js' // Skip config endpoint
        ];
        
        if (skipEndpoints.some(endpoint => fullPath.startsWith(endpoint))) {
            return;
        }
        
        // Extract user info from JWT (if authenticated)
        // Authentication middleware sets req.user for authenticated requests
        const user = req.user || null;
        
        // Extract user data with fallbacks for different token types
        const userId = user?.userId || user?.id || null;
        const userEmail = user?.email || null;
        const userPublicKey = user?.publicKey || user?.publisherPubKey || null;
        const isAdmin = user?.isAdmin || false;
        
        const activityLog = {
            timestamp: new Date().toISOString(),
            userId: userId,
            userEmail: userEmail,
            userPublicKey: userPublicKey,
            isAdmin: isAdmin,
            
            // Request details
            method: req.method,
            endpoint: fullPath, // Use full path with /api prefix
            fullUrl: req.originalUrl,
            queryParams: req.query,
            
            // Response details
            statusCode: res.statusCode,
            duration: duration, // milliseconds
            success: res.statusCode >= 200 && res.statusCode < 400,
            
            // Additional context
            ip: req.ip || req.connection?.remoteAddress || null,
            userAgent: req.headers['user-agent'] || null,
            
            // Categorize request type
            requestType: categorizeRequest(fullPath, req.method),
            
            // Record type if publishing/querying records
            recordType: extractRecordType(req),
            
            // Error info if failed
            error: res.statusCode >= 400 ? (responseBody?.error || responseBody?.message) : null
        };
        
        // Only log if we have meaningful data (skip static file requests, etc.)
        if (!fullPath || fullPath === '/') {
            return;
        }
        
        // Ensure activity index exists
        await ensureActivityIndexExists();
        
        // Index the activity log
        await elasticClient.index({
            index: 'user_activity',
            body: activityLog
        });
        
        // Debug log for first few requests to verify it's working
        if (Math.random() < 0.05) { // 5% sampling for debugging
            console.log(`📊 [Activity] ${user?.email || 'anonymous'} - ${req.method} ${fullPath} - ${activityLog.requestType}`);
        }
        
    } catch (error) {
        // Silently fail - don't break the API if logging fails
        console.error('Error in logActivity:', error);
    }
}

/**
 * Categorize the request for easier analytics
 * Order matters - check most specific paths first
 */
function categorizeRequest(path, method) {
    // User authentication
    if (path.includes('/login')) return 'user_login';
    if (path.includes('/register')) return 'user_register';
    if (path.includes('/mnemonic')) return 'mnemonic_access';
    if (path.includes('/generate-calendar')) return 'calendar_token';
    
    // Record operations (check specific endpoints first)
    if (path.includes('/deleteRecord')) return 'delete_record';
    if (path.includes('/newRecord')) return 'publish_record';
    if (path.startsWith('/api/records') && method === 'GET') return 'query_records';
    if (path.startsWith('/api/records') && method === 'POST') return 'publish_record';
    if (path.startsWith('/api/records') && method === 'DELETE') return 'delete_record';
    
    // Publishing
    if (path.startsWith('/api/publish')) return 'publish_content';
    
    // Media operations
    if (path.startsWith('/api/media')) return 'media_operation';
    
    // Organizations
    if (path.startsWith('/api/organizations')) return 'organization_operation';
    
    // AI/ALFRED
    if (path.startsWith('/api/alfred') || path.startsWith('/api/voice')) return 'ai_request';
    
    // Admin operations
    if (path.startsWith('/api/admin')) return 'admin_operation';
    
    // GUN relay (cross-node sync)
    if (path.startsWith('/gun-relay')) return 'gun_relay';
    
    // Health checks
    if (path.startsWith('/health') || path.startsWith('/api/health')) return 'health_check';
    
    // Templates
    if (path.startsWith('/api/templates')) return 'template_operation';
    
    // Creators
    if (path.startsWith('/api/creators')) return 'creator_operation';
    
    // Workout/fitness
    if (path.startsWith('/api/workout')) return 'workout_operation';
    
    return 'other';
}

/**
 * Extract record type from request
 */
function extractRecordType(req) {
    // Check query params
    if (req.query.recordType) return req.query.recordType;
    
    // Check body for publish requests
    if (req.body) {
        // Check for direct recordType field
        if (req.body.recordType) return req.body.recordType;
        
        // Check for template names in body (post, recipe, exercise, etc.)
        const commonTemplates = ['post', 'recipe', 'exercise', 'video', 'image', 'conversationSession', 'organization'];
        for (const template of commonTemplates) {
            if (req.body[template]) return template;
        }
    }
    
    return null;
}

/**
 * Ensure the user_activity index exists with proper mapping
 */
async function ensureActivityIndexExists() {
    try {
        const indexExists = await elasticClient.indices.exists({ index: 'user_activity' });
        
        if (!indexExists) {
            console.log('📊 Creating user_activity index...');
            await elasticClient.indices.create({
                index: 'user_activity',
                body: {
                    mappings: {
                        properties: {
                            timestamp: { type: 'date' },
                            userId: { type: 'keyword' },
                            userEmail: { type: 'keyword' },
                            userPublicKey: { type: 'keyword' },
                            isAdmin: { type: 'boolean' },
                            method: { type: 'keyword' },
                            endpoint: { type: 'keyword' },
                            fullUrl: { type: 'text' },
                            queryParams: { type: 'object', enabled: false },
                            statusCode: { type: 'integer' },
                            duration: { type: 'integer' },
                            success: { type: 'boolean' },
                            ip: { type: 'ip' },
                            userAgent: { type: 'text' },
                            requestType: { type: 'keyword' },
                            recordType: { type: 'keyword' },
                            error: { type: 'text' }
                        }
                    }
                }
            });
            console.log('✅ user_activity index created successfully');
        }
    } catch (error) {
        console.error('Error ensuring activity index exists:', error);
    }
}

module.exports = { logAPIActivity };

