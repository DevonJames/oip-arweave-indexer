/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * BROWSE ROUTES - Record browsing API (proxies to OIP daemon)
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Endpoints:
 *   GET /api/browse/records      - Browse records
 *   GET /api/browse/record/:did  - Get single record
 *   GET /api/browse/types        - Get record types
 *   GET /api/browse/templates    - Get templates
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

const express = require('express');
const router = express.Router();
const axios = require('axios');

const OIP_DAEMON_URL = process.env.OIP_DAEMON_URL || 'http://oip-daemon-service:3005';

/**
 * Proxy request to OIP daemon
 */
async function proxyToOIP(endpoint, params = {}) {
    let response = null;
    
    try {
        response = await axios.get(`${OIP_DAEMON_URL}${endpoint}`, {
            params,
            timeout: 30000
        });
        
        const data = response.data;
        response.data = null;
        response = null;
        
        return data;
        
    } catch (error) {
        if (response) {
            response.data = null;
            response = null;
        }
        throw error;
    }
}

/**
 * GET /api/browse/records
 * Browse records with filtering
 */
router.get('/records', async (req, res) => {
    try {
        // Extract query parameters
        const {
            recordType,
            search,
            tags,
            tagsMatchMode,
            creator,
            limit = 20,
            offset = 0,
            sortBy = 'date:desc',
            resolveDepth = 0
        } = req.query;
        
        const params = {
            limit: Math.min(parseInt(limit) || 20, 100),
            offset: parseInt(offset) || 0,
            sortBy,
            resolveDepth: parseInt(resolveDepth) || 0
        };
        
        // Add optional filters
        if (recordType) params.recordType = recordType;
        if (search) params.search = search;
        if (tags) params.tags = tags;
        if (tagsMatchMode) params.tagsMatchMode = tagsMatchMode;
        if (creator) params.creator = creator;
        
        const data = await proxyToOIP('/api/records', params);
        
        // Add publishing source indicators if available
        if (data.records) {
            data.records = data.records.map(record => ({
                ...record,
                _publishingSources: getPublishingSources(record)
            }));
        }
        
        res.status(200).json(data);
        
    } catch (error) {
        console.error('Browse records error:', error.message);
        res.status(error.response?.status || 500).json({
            error: 'Failed to browse records',
            message: error.message
        });
    }
});

/**
 * GET /api/browse/record/:did
 * Get a single record by DID or WordPress post ID
 */
router.get('/record/:did', async (req, res) => {
    try {
        const { did } = req.params;
        const { resolveDepth = 1 } = req.query;
        
        // Check if this is a WordPress post ID (starts with 'wp-' or is numeric)
        if (did.startsWith('wp-') || /^\d+$/.test(did)) {
            const postId = did.replace('wp-', '');
            
            // Fetch WordPress posts and find the matching one
            try {
                const WORDPRESS_URL = process.env.WORDPRESS_URL || 'http://wordpress:80';
                const response = await axios.get(`${WORDPRESS_URL}/wp-json/wp/v2/posts/${postId}`, {
                    params: {
                        _embed: true
                    },
                    timeout: 10000,
                    validateStatus: () => true
                });
                
                if (response.status === 404 || !response.data) {
                    return res.status(404).json({
                        error: 'WordPress post not found',
                        postId
                    });
                }
                
                const post = response.data;
                const baseUrl = process.env.PUBLIC_API_BASE_URL || `${req.protocol}://${req.get('host')}`;
                const wordpressPath = process.env.WORDPRESS_PROXY_PATH || '/wordpress';
                
                let permalink = post.link;
                if (!permalink && post.id) {
                    permalink = `${baseUrl}${wordpressPath}/?p=${post.id}`;
                }
                
                // Get author from WordPress post (fallback)
                let author = post._embedded?.author?.[0]?.name || '';
                let displayAuthor = author;
                
                // Fetch meta fields via wp-cli to get DID/byline (WordPress REST API doesn't reliably return custom meta)
                try {
                    const { execSync } = require('child_process');
                    const projectName = process.env.COMPOSE_PROJECT_NAME || 'onionpress';
                    const wpContainerName = `${projectName}-wordpress-1`;
                    
                    // Get publishing mode
                    let publisherMode = '';
                    try {
                        const publisherModeCmd = `docker exec ${wpContainerName} wp post meta get ${post.id} op_publisher_mode --allow-root 2>/dev/null || true`;
                        publisherMode = execSync(publisherModeCmd, { encoding: 'utf-8', timeout: 5000, shell: '/bin/bash' }).trim();
                    } catch (e) {
                        publisherMode = '';
                    }
                    const isDidMode = (publisherMode === 'did');
                    
                    if (isDidMode) {
                        // For DID mode, prioritize the DID from op_publisher_creator_did
                        let creatorDid = '';
                        try {
                            const creatorDidCmd = `docker exec ${wpContainerName} wp post meta get ${post.id} op_publisher_creator_did --allow-root 2>/dev/null || true`;
                            creatorDid = execSync(creatorDidCmd, { encoding: 'utf-8', timeout: 5000, shell: '/bin/bash' }).trim();
                        } catch (e) {
                            creatorDid = '';
                        }
                        if (creatorDid) {
                            displayAuthor = creatorDid;
                        } else {
                            // Fallback to byline meta fields
                            let byline = '';
                            try {
                                const bylineCmd1 = `docker exec ${wpContainerName} wp post meta get ${post.id} _op_byline --allow-root 2>/dev/null || true`;
                                byline = execSync(bylineCmd1, { encoding: 'utf-8', timeout: 5000, shell: '/bin/bash' }).trim();
                                if (!byline) {
                                    const bylineCmd2 = `docker exec ${wpContainerName} wp post meta get ${post.id} op_publisher_byline --allow-root 2>/dev/null || true`;
                                    byline = execSync(bylineCmd2, { encoding: 'utf-8', timeout: 5000, shell: '/bin/bash' }).trim();
                                }
                            } catch (e) {
                                byline = '';
                            }
                            displayAuthor = byline || author;
                        }
                    } else {
                        // For non-DID modes, use byline if available
                        let byline = '';
                        try {
                            const bylineCmd1 = `docker exec ${wpContainerName} wp post meta get ${post.id} _op_byline --allow-root 2>/dev/null || true`;
                            byline = execSync(bylineCmd1, { encoding: 'utf-8', timeout: 5000, shell: '/bin/bash' }).trim();
                            if (!byline) {
                                const bylineCmd2 = `docker exec ${wpContainerName} wp post meta get ${post.id} op_publisher_byline --allow-root 2>/dev/null || true`;
                                byline = execSync(bylineCmd2, { encoding: 'utf-8', timeout: 5000, shell: '/bin/bash' }).trim();
                            }
                        } catch (e) {
                            byline = '';
                        }
                        if (byline) {
                            displayAuthor = byline;
                        }
                    }
                } catch (metaError) {
                    // Ignore meta fetch errors - fallback to author name
                    console.warn(`⚠️ [BrowseRecord] Could not fetch meta for post ${post.id}:`, metaError.message);
                    displayAuthor = author;
                }
                
                const record = {
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
                
                return res.status(200).json(record);
            } catch (wpError) {
                console.error('Get WordPress post error:', wpError.message);
                return res.status(404).json({
                    error: 'WordPress post not found',
                    postId,
                    message: wpError.message
                });
            }
        }
        
        // Otherwise, treat as OIP DID
        const data = await proxyToOIP('/api/records', {
            did: decodeURIComponent(did),
            resolveDepth: parseInt(resolveDepth) || 1
        });
        
        if (!data.records || data.records.length === 0) {
            return res.status(404).json({
                error: 'Record not found',
                did
            });
        }
        
        const record = data.records[0];
        record._publishingSources = getPublishingSources(record);
        
        res.status(200).json(record);
        
    } catch (error) {
        console.error('Get record error:', error.message);
        res.status(error.response?.status || 500).json({
            error: 'Failed to get record',
            message: error.message
        });
    }
});

/**
 * GET /api/browse/types
 * Get available record types with counts
 */
router.get('/types', async (req, res) => {
    try {
        const data = await proxyToOIP('/api/records/recordTypes');
        
        // Filter to common publishing types
        const publishingTypes = ['post', 'image', 'video', 'audio', 'recipe', 'exercise', 'basic'];
        
        const filteredTypes = {};
        for (const [type, count] of Object.entries(data.recordTypes || data)) {
            if (publishingTypes.includes(type)) {
                filteredTypes[type] = count;
            }
        }
        
        res.status(200).json({
            recordTypes: filteredTypes,
            allTypes: data.recordTypes || data
        });
        
    } catch (error) {
        console.error('Get types error:', error.message);
        res.status(error.response?.status || 500).json({
            error: 'Failed to get record types',
            message: error.message
        });
    }
});

/**
 * GET /api/browse/templates
 * Get available templates
 */
router.get('/templates', async (req, res) => {
    try {
        const data = await proxyToOIP('/api/templates');
        
        res.status(200).json(data);
        
    } catch (error) {
        console.error('Get templates error:', error.message);
        res.status(error.response?.status || 500).json({
            error: 'Failed to get templates',
            message: error.message
        });
    }
});

/**
 * GET /api/browse/template/:name
 * Get a specific template by name
 */
router.get('/template/:name', async (req, res) => {
    try {
        const { name } = req.params;
        
        const data = await proxyToOIP(`/api/templates/${name}`);
        
        res.status(200).json(data);
        
    } catch (error) {
        console.error('Get template error:', error.message);
        res.status(error.response?.status || 500).json({
            error: 'Failed to get template',
            message: error.message
        });
    }
});

/**
 * GET /api/browse/schema/:recordType
 * Get publishing schema for a record type
 */
router.get('/schema/:recordType', async (req, res) => {
    try {
        const { recordType } = req.params;
        
        const data = await proxyToOIP('/api/publish/schema', { recordType });
        
        res.status(200).json(data);
        
    } catch (error) {
        console.error('Get schema error:', error.message);
        res.status(error.response?.status || 500).json({
            error: 'Failed to get schema',
            message: error.message
        });
    }
});

/**
 * Helper: Determine publishing sources from record metadata
 */
function getPublishingSources(record) {
    const sources = [];
    
    const oip = record.oip || {};
    const did = oip.did || oip.didTx || '';
    
    // Check DID format for source
    if (did.includes('did:arweave:') || oip.inArweaveBlock) {
        sources.push('arweave');
    }
    
    if (did.includes('did:gun:') || oip.gunSoul) {
        sources.push('gun');
    }
    
    // Check for TOR/IA indicator (custom field we might add)
    if (oip.viaInternetArchive || oip.viaTor) {
        sources.push('internetArchive');
    }
    
    return sources;
}

module.exports = router;

