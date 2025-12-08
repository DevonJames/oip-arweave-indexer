const express = require('express');
const { elasticClient } = require('../helpers/elasticsearch');
const { authenticateToken } = require('../helpers/utils');
const router = express.Router();

/**
 * Validate that the requesting user is an admin of the organization hosting this node
 * Uses the approach: PUBLIC_API_BASE_URL → organization.webUrl → organization.adminPublicKeys
 */
async function validateNodeAdmin(req, res, next) {
    try {
        const user = req.user;
        
        if (!user || !user.publicKey) {
            return res.status(401).json({ 
                error: 'Authentication required',
                message: 'Please provide a valid JWT token'
            });
        }
        
        // Get the node's public API base URL from environment
        const nodeBaseUrl = process.env.PUBLIC_API_BASE_URL;
        
        if (!nodeBaseUrl) {
            console.warn('⚠️ PUBLIC_API_BASE_URL not configured - falling back to isAdmin check');
            // Fallback to traditional isAdmin check if PUBLIC_API_BASE_URL not configured
            if (user.isAdmin) {
                req.isNodeAdmin = true;
                return next();
            }
            return res.status(403).json({ 
                error: 'Unauthorized',
                message: 'PUBLIC_API_BASE_URL not configured on this node'
            });
        }
        
        // Extract domain from PUBLIC_API_BASE_URL
        const nodeDomain = extractDomain(nodeBaseUrl);
        console.log('🔍 Node domain from PUBLIC_API_BASE_URL:', nodeDomain);
        console.log('🔍 Base domain:', extractBaseDomain(nodeDomain));
        
        // Get ALL organizations and filter by domain matching
        // This is more reliable than complex Elasticsearch queries
        const orgSearchResult = await elasticClient.search({
            index: 'organizations',
            body: {
                query: { match_all: {} },
                size: 1000 // Get all organizations
            }
        });
        
        console.log(`🔍 Found ${orgSearchResult.hits.hits.length} total organizations in database`);
        
        // Filter organizations by domain matching
        const matchingOrgs = orgSearchResult.hits.hits.filter(hit => {
            const orgWebUrl = hit._source.data?.webUrl;
            const matches = doesOrgMatchDomain(orgWebUrl, nodeDomain);
            if (matches) {
                console.log(`✅ Organization "${hit._source.data?.name}" (${orgWebUrl}) matches node domain ${nodeDomain}`);
            }
            return matches;
        });
        
        if (matchingOrgs.length === 0) {
            console.warn('⚠️ No organization found matching node domain:', nodeDomain);
            console.warn('💡 Available organization webUrls:', 
                orgSearchResult.hits.hits.map(h => h._source.data?.webUrl).join(', '));
            
            // Fallback to traditional isAdmin check
            if (user.isAdmin) {
                console.log('✅ Falling back to isAdmin check - user is admin');
                req.isNodeAdmin = true;
                req.nodeOrganization = null;
                return next();
            }
            return res.status(403).json({ 
                error: 'Unauthorized',
                message: `No organization registered for this node domain "${nodeDomain}". Please create an organization record with matching webUrl.`,
                availableOrganizations: orgSearchResult.hits.hits.map(h => ({
                    name: h._source.data?.name,
                    webUrl: h._source.data?.webUrl
                }))
            });
        }
        
        // Use the first matching organization
        const organization = matchingOrgs[0]._source;
        console.log('✅ Found organization for node:', organization.data?.name || organization.data?.orgHandle);
        
        // Extract admin public keys from organization
        // Try multiple locations in the organization object
        let adminPublicKeys = 
            organization.data?.adminPublicKeys || 
            organization.oip?.organization?.adminPublicKeys ||
            organization.adminPublicKeys;
        
        if (!adminPublicKeys) {
            console.error('❌ No adminPublicKeys found in organization:', JSON.stringify(organization, null, 2));
            return res.status(500).json({
                error: 'Configuration error',
                message: 'Organization record is missing adminPublicKeys field'
            });
        }
        
        // Handle both array and string formats
        if (typeof adminPublicKeys === 'string') {
            // Try parsing as JSON array
            try {
                const parsed = JSON.parse(adminPublicKeys);
                if (Array.isArray(parsed)) {
                    adminPublicKeys = parsed;
                } else {
                    adminPublicKeys = [adminPublicKeys]; // Single key as string
                }
            } catch (e) {
                // Not JSON, treat as single admin key string
                adminPublicKeys = [adminPublicKeys];
            }
        }
        
        if (!Array.isArray(adminPublicKeys)) {
            adminPublicKeys = adminPublicKeys ? [adminPublicKeys] : [];
        }
        
        // Filter out any null/undefined values
        adminPublicKeys = adminPublicKeys.filter(key => key);
        
        console.log('🔑 Organization admin public keys:', adminPublicKeys.length, 'key(s)');
        console.log('🔑 Admin keys:', adminPublicKeys.map(k => k.substring(0, 20) + '...').join(', '));
        console.log('🔑 Requesting user public key:', user.publicKey?.substring(0, 20) + '...');
        
        // Check if user's public key matches any admin public key
        const isAdmin = adminPublicKeys.some(adminKey => {
            // Handle different string formats and trim whitespace
            const normalizedAdminKey = String(adminKey).trim();
            const normalizedUserKey = String(user.publicKey).trim();
            return normalizedAdminKey === normalizedUserKey;
        });
        
        if (!isAdmin) {
            console.warn('❌ User is not an admin of the organization');
            return res.status(403).json({ 
                error: 'Unauthorized',
                message: 'You are not an admin of the organization hosting this node',
                organizationName: organization.data?.name,
                organizationHandle: organization.data?.orgHandle
            });
        }
        
        console.log('✅ User validated as node admin');
        
        // Attach organization info to request for use in route handlers
        req.isNodeAdmin = true;
        req.nodeOrganization = organization;
        
        next();
        
    } catch (error) {
        console.error('❌ Error validating node admin:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            message: 'Failed to validate admin permissions'
        });
    }
}

/**
 * Extract domain from URL
 */
function extractDomain(url) {
    try {
        // Remove protocol if present
        let domain = url.replace(/^https?:\/\//, '');
        // Remove port if present
        domain = domain.replace(/:\d+.*$/, '');
        // Remove path if present
        domain = domain.replace(/\/.*$/, '');
        return domain;
    } catch (error) {
        return url;
    }
}

/**
 * Extract base domain (without subdomain)
 * e.g., "oip.fitnessally.io" → "fitnessally.io"
 */
function extractBaseDomain(domain) {
    const parts = domain.split('.');
    if (parts.length > 2) {
        // Return last two parts (e.g., "fitnessally.io")
        return parts.slice(-2).join('.');
    }
    return domain;
}

/**
 * Check if organization webUrl matches the node domain
 */
function doesOrgMatchDomain(orgWebUrl, nodeDomain) {
    if (!orgWebUrl || !nodeDomain) return false;
    
    // Normalize both URLs
    const normalizedOrgUrl = extractDomain(orgWebUrl.toLowerCase());
    const normalizedNodeDomain = nodeDomain.toLowerCase();
    
    // Exact match
    if (normalizedOrgUrl === normalizedNodeDomain) {
        return true;
    }
    
    // Base domain match (e.g., "oip.fitnessally.io" matches "fitnessally.io")
    const orgBaseDomain = extractBaseDomain(normalizedOrgUrl);
    const nodeBaseDomain = extractBaseDomain(normalizedNodeDomain);
    
    if (orgBaseDomain === nodeBaseDomain) {
        return true;
    }
    
    return false;
}

/**
 * GET /api/admin/node-analytics
 * 
 * Get comprehensive analytics for the OIP node
 * Requires: Organization admin authentication
 * 
 * Query params:
 * - timeRange: 24h, 7d, 30d, 90d, all (default: 30d)
 * - userId: Filter by specific user ID
 * - includeDetails: true/false - include detailed logs (default: false)
 */
router.get('/node-analytics', authenticateToken, validateNodeAdmin, async (req, res) => {
    try {
        const { timeRange = '30d', userId, includeDetails = 'false' } = req.query;
        
        console.log('📊 Node analytics request from admin:', req.user.email);
        console.log('📊 Time range:', timeRange);
        
        // Calculate time filter
        const timeFilter = calculateTimeFilter(timeRange);
        
        // Build base query
        const baseQuery = {
            bool: {
                must: []
            }
        };
        
        if (timeFilter) {
            baseQuery.bool.must.push({
                range: {
                    timestamp: { gte: timeFilter }
                }
            });
        }
        
        if (userId) {
            baseQuery.bool.must.push({
                term: { userId: userId }
            });
        }
        
        // Get registered users count and list
        const usersResult = await elasticClient.search({
            index: 'users',
            body: {
                query: {
                    match: { waitlistStatus: 'registered' }
                },
                size: 1000,
                _source: ['email', 'publicKey', 'createdAt', 'subscriptionStatus', 'isAdmin', 'importedWallet']
            }
        });
        
        const registeredUsers = usersResult.hits.hits.map(hit => ({
            userId: hit._id,
            email: hit._source.email,
            publicKey: hit._source.publicKey,
            createdAt: hit._source.createdAt,
            subscriptionStatus: hit._source.subscriptionStatus,
            isAdmin: hit._source.isAdmin || false,
            importedWallet: hit._source.importedWallet || false
        }));
        
        // Get total activity count
        const totalActivityResult = await elasticClient.count({
            index: 'user_activity',
            body: {
                query: baseQuery
            }
        });
        
        // Get activity breakdown by request type
        const activityByTypeResult = await elasticClient.search({
            index: 'user_activity',
            body: {
                query: baseQuery,
                size: 0,
                aggs: {
                    by_request_type: {
                        terms: {
                            field: 'requestType',
                            size: 50
                        }
                    }
                }
            }
        });
        
        // Get activity by user
        const activityByUserResult = await elasticClient.search({
            index: 'user_activity',
            body: {
                query: baseQuery,
                size: 0,
                aggs: {
                    by_user: {
                        terms: {
                            field: 'userEmail.keyword',
                            size: 1000,
                            order: { _count: 'desc' }
                        },
                        aggs: {
                            by_request_type: {
                                terms: {
                                    field: 'requestType',
                                    size: 20
                                }
                            },
                            avg_duration: {
                                avg: {
                                    field: 'duration'
                                }
                            },
                            success_rate: {
                                avg: {
                                    field: 'success'
                                }
                            }
                        }
                    }
                }
            }
        });
        
        // Get recent logins
        const recentLoginsResult = await elasticClient.search({
            index: 'user_activity',
            body: {
                query: {
                    bool: {
                        must: [
                            { term: { requestType: 'user_login' } },
                            { term: { success: true } }
                        ]
                    }
                },
                size: 100,
                sort: [{ timestamp: 'desc' }],
                _source: ['timestamp', 'userEmail', 'ip', 'userAgent']
            }
        });
        
        // Get most active endpoints
        const topEndpointsResult = await elasticClient.search({
            index: 'user_activity',
            body: {
                query: baseQuery,
                size: 0,
                aggs: {
                    top_endpoints: {
                        terms: {
                            field: 'endpoint',
                            size: 20,
                            order: { _count: 'desc' }
                        },
                        aggs: {
                            avg_duration: {
                                avg: { field: 'duration' }
                            },
                            success_rate: {
                                avg: { field: 'success' }
                            }
                        }
                    }
                }
            }
        });
        
        // Get error rate over time
        const errorRateResult = await elasticClient.search({
            index: 'user_activity',
            body: {
                query: baseQuery,
                size: 0,
                aggs: {
                    errors_over_time: {
                        date_histogram: {
                            field: 'timestamp',
                            calendar_interval: timeRange === '24h' ? 'hour' : 'day'
                        },
                        aggs: {
                            error_rate: {
                                avg: {
                                    script: {
                                        source: "doc['success'].value ? 0 : 1"
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });
        
        // Compile response
        const response = {
            nodeInfo: {
                baseUrl: process.env.PUBLIC_API_BASE_URL,
                organization: req.nodeOrganization ? {
                    name: req.nodeOrganization.data?.name,
                    handle: req.nodeOrganization.data?.orgHandle,
                    did: req.nodeOrganization.oip?.did
                } : null
            },
            
            timeRange: timeRange,
            generatedAt: new Date().toISOString(),
            
            users: {
                totalRegistered: registeredUsers.length,
                users: registeredUsers
            },
            
            activity: {
                totalRequests: totalActivityResult.count,
                
                byRequestType: activityByTypeResult.aggregations.by_request_type.buckets.map(bucket => ({
                    type: bucket.key,
                    count: bucket.doc_count
                })),
                
                byUser: activityByUserResult.aggregations.by_user.buckets.map(bucket => ({
                    email: bucket.key,
                    totalRequests: bucket.doc_count,
                    avgDuration: Math.round(bucket.avg_duration.value),
                    successRate: (bucket.success_rate.value * 100).toFixed(2) + '%',
                    requestBreakdown: bucket.by_request_type.buckets.map(typeBucket => ({
                        type: typeBucket.key,
                        count: typeBucket.doc_count
                    }))
                })),
                
                topEndpoints: topEndpointsResult.aggregations.top_endpoints.buckets.map(bucket => ({
                    endpoint: bucket.key,
                    count: bucket.doc_count,
                    avgDuration: Math.round(bucket.avg_duration.value),
                    successRate: (bucket.success_rate.value * 100).toFixed(2) + '%'
                })),
                
                errorRateOverTime: errorRateResult.aggregations.errors_over_time.buckets.map(bucket => ({
                    timestamp: bucket.key_as_string,
                    errorRate: (bucket.error_rate.value * 100).toFixed(2) + '%'
                }))
            },
            
            recentLogins: recentLoginsResult.hits.hits.map(hit => ({
                timestamp: hit._source.timestamp,
                email: hit._source.userEmail,
                ip: hit._source.ip,
                userAgent: hit._source.userAgent
            }))
        };
        
        // Include detailed logs if requested
        if (includeDetails === 'true') {
            const detailedLogsResult = await elasticClient.search({
                index: 'user_activity',
                body: {
                    query: baseQuery,
                    size: 1000,
                    sort: [{ timestamp: 'desc' }]
                }
            });
            
            response.detailedLogs = detailedLogsResult.hits.hits.map(hit => hit._source);
        }
        
        res.status(200).json(response);
        
    } catch (error) {
        console.error('❌ Error generating node analytics:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            message: error.message
        });
    }
});

/**
 * Calculate time filter for analytics queries
 */
function calculateTimeFilter(timeRange) {
    const now = new Date();
    
    switch (timeRange) {
        case '24h':
            return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
        case '7d':
            return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
        case '30d':
            return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
        case '90d':
            return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
        case 'all':
            return null; // No time filter
        default:
            return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    }
}

/**
 * GET /api/admin/user-sessions/:userId
 * 
 * Get detailed session history for a specific user
 */
router.get('/user-sessions/:userId', authenticateToken, validateNodeAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { limit = 100, offset = 0 } = req.query;
        
        // Get user info
        const userResult = await elasticClient.get({
            index: 'users',
            id: userId
        });
        
        const user = userResult._source;
        
        // Get all login sessions
        const loginsResult = await elasticClient.search({
            index: 'user_activity',
            body: {
                query: {
                    bool: {
                        must: [
                            { term: { userId: userId } },
                            { term: { requestType: 'user_login' } }
                        ]
                    }
                },
                size: parseInt(limit),
                from: parseInt(offset),
                sort: [{ timestamp: 'desc' }]
            }
        });
        
        // Get all activity for this user
        const activityResult = await elasticClient.search({
            index: 'user_activity',
            body: {
                query: {
                    term: { userId: userId }
                },
                size: 0,
                aggs: {
                    by_date: {
                        date_histogram: {
                            field: 'timestamp',
                            calendar_interval: 'day'
                        }
                    },
                    by_request_type: {
                        terms: {
                            field: 'requestType',
                            size: 50
                        }
                    }
                }
            }
        });
        
        res.status(200).json({
            user: {
                userId: userId,
                email: user.email,
                publicKey: user.publicKey,
                createdAt: user.createdAt,
                subscriptionStatus: user.subscriptionStatus
            },
            sessions: {
                totalLogins: loginsResult.hits.total.value,
                recentLogins: loginsResult.hits.hits.map(hit => ({
                    timestamp: hit._source.timestamp,
                    ip: hit._source.ip,
                    userAgent: hit._source.userAgent,
                    success: hit._source.success
                }))
            },
            activity: {
                activityByDate: activityResult.aggregations.by_date.buckets.map(bucket => ({
                    date: bucket.key_as_string,
                    count: bucket.doc_count
                })),
                activityByType: activityResult.aggregations.by_request_type.buckets.map(bucket => ({
                    type: bucket.key,
                    count: bucket.doc_count
                }))
            }
        });
        
    } catch (error) {
        console.error('❌ Error fetching user sessions:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            message: error.message
        });
    }
});

module.exports = router;

