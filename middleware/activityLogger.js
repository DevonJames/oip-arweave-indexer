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
        // Skip logging for certain endpoints (to avoid infinite loops or noise)
        const skipEndpoints = [
            '/api/admin/node-analytics', // Don't log the analytics endpoint itself
            '/health',
            '/metrics'
        ];
        
        if (skipEndpoints.some(endpoint => req.path.startsWith(endpoint))) {
            return;
        }
        
        // Extract user info from JWT (if authenticated)
        const user = req.user || null;
        
        const activityLog = {
            timestamp: new Date().toISOString(),
            userId: user?.userId || null,
            userEmail: user?.email || null,
            userPublicKey: user?.publicKey || null,
            isAdmin: user?.isAdmin || false,
            
            // Request details
            method: req.method,
            endpoint: req.path,
            fullUrl: req.originalUrl,
            queryParams: req.query,
            
            // Response details
            statusCode: res.statusCode,
            duration: duration, // milliseconds
            success: res.statusCode >= 200 && res.statusCode < 400,
            
            // Additional context
            ip: req.ip || req.connection.remoteAddress,
            userAgent: req.headers['user-agent'],
            
            // Categorize request type
            requestType: categorizeRequest(req.path, req.method),
            
            // Record type if publishing/querying records
            recordType: extractRecordType(req),
            
            // Error info if failed
            error: res.statusCode >= 400 ? (responseBody?.error || responseBody?.message) : null
        };
        
        // Ensure activity index exists
        await ensureActivityIndexExists();
        
        // Index the activity log
        await elasticClient.index({
            index: 'user_activity',
            body: activityLog
        });
        
    } catch (error) {
        // Silently fail - don't break the API if logging fails
        console.error('Error in logActivity:', error);
    }
}

/**
 * Categorize the request for easier analytics
 */
function categorizeRequest(path, method) {
    if (path.startsWith('/api/records') && method === 'GET') return 'query_records';
    if (path.startsWith('/api/records') && method === 'POST') return 'publish_record';
    if (path.startsWith('/api/records') && method === 'DELETE') return 'delete_record';
    if (path.startsWith('/api/publish')) return 'publish_content';
    if (path.startsWith('/api/media')) return 'media_operation';
    if (path.startsWith('/api/user/login')) return 'user_login';
    if (path.startsWith('/api/user/register')) return 'user_register';
    if (path.startsWith('/api/user/mnemonic')) return 'mnemonic_access';
    if (path.startsWith('/api/organizations')) return 'organization_operation';
    if (path.startsWith('/api/alfred')) return 'ai_request';
    if (path.startsWith('/api/admin')) return 'admin_operation';
    
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

