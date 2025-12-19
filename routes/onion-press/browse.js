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
 * Get a single record by DID
 */
router.get('/record/:did', async (req, res) => {
    try {
        const { did } = req.params;
        const { resolveDepth = 1 } = req.query;
        
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

