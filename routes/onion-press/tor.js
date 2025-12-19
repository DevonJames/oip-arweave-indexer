/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * TOR ROUTES - TOR daemon status API
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Endpoints:
 *   GET /api/tor/status  - Get TOR daemon status and .onion address
 *   GET /api/tor/test    - Test TOR connectivity
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

const express = require('express');
const router = express.Router();
const { getTorStatus, isTorAvailable, getOnionAddress, torRequest } = require('../../helpers/onion-press/torClient');

/**
 * GET /api/tor/status
 * Get TOR daemon status and this instance's .onion address
 */
router.get('/status', async (req, res) => {
    try {
        const status = await getTorStatus();
        
        res.status(200).json({
            ...status,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('TOR status error:', error);
        res.status(500).json({
            error: 'Failed to get TOR status',
            message: error.message,
            connected: false
        });
    }
});

/**
 * GET /api/tor/test
 * Test TOR connectivity by making a request through TOR
 */
router.get('/test', async (req, res) => {
    try {
        const startTime = Date.now();
        
        // Check if TOR is available
        const available = await isTorAvailable();
        
        const duration = Date.now() - startTime;
        
        if (available) {
            res.status(200).json({
                success: true,
                message: 'TOR connectivity verified',
                duration: `${duration}ms`,
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(503).json({
                success: false,
                message: 'TOR proxy not reachable',
                duration: `${duration}ms`,
                timestamp: new Date().toISOString()
            });
        }
        
    } catch (error) {
        console.error('TOR test error:', error);
        res.status(500).json({
            success: false,
            error: 'TOR test failed',
            message: error.message
        });
    }
});

/**
 * GET /api/tor/onion-address
 * Get just the .onion address for this instance
 */
router.get('/onion-address', async (req, res) => {
    try {
        const onionAddress = await getOnionAddress();
        
        if (onionAddress) {
            res.status(200).json({
                onionAddress,
                fullUrl: `http://${onionAddress}`
            });
        } else {
            res.status(404).json({
                error: 'Onion address not available',
                message: 'TOR hidden service may not be configured or running'
            });
        }
        
    } catch (error) {
        console.error('Onion address error:', error);
        res.status(500).json({
            error: 'Failed to get onion address',
            message: error.message
        });
    }
});

/**
 * POST /api/tor/proxy
 * Proxy a request through TOR (for testing/debugging)
 * Body: { method: 'GET', url: 'http://example.onion/path', data: {} }
 */
router.post('/proxy', async (req, res) => {
    try {
        const { method = 'GET', url, data } = req.body;
        
        if (!url) {
            return res.status(400).json({
                error: 'Missing URL',
                message: 'Request body must include a "url" field'
            });
        }
        
        console.log(`🧅 TOR proxy request: ${method} ${url}`);
        
        const startTime = Date.now();
        const response = await torRequest(method, url, data);
        const duration = Date.now() - startTime;
        
        res.status(200).json({
            success: true,
            duration: `${duration}ms`,
            response
        });
        
    } catch (error) {
        console.error('TOR proxy error:', error);
        res.status(500).json({
            success: false,
            error: 'TOR proxy request failed',
            message: error.message
        });
    }
});

module.exports = router;

