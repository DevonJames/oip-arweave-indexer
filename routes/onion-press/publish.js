/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * PUBLISH ROUTES - Multi-destination publishing API
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Endpoints:
 *   POST /api/publish           - Submit record for multi-destination publishing
 *   GET  /api/publish/:id/status - Check submission status
 *   GET  /api/publish/recent    - Get recent submissions
 *   GET  /api/publish/destinations - Get available destinations
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

const express = require('express');
const router = express.Router();
const { publishRecord, getSubmissionStatus, getRecentSubmissions } = require('../../helpers/onion-press/multiDestinationPublisher');
const settingsManager = require('../../helpers/onion-press/settingsManager');

/**
 * POST /api/publish
 * Submit a record for multi-destination publishing
 */
router.post('/', async (req, res) => {
    try {
        const { record, destinations, wordpress } = req.body;
        
        if (!record) {
            return res.status(400).json({
                error: 'Missing record',
                message: 'Request body must include a "record" object'
            });
        }
        
        // Get user token from Authorization header if present
        const authHeader = req.headers.authorization;
        const userToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
        
        // Default destinations to all enabled
        const publishDestinations = destinations || {
            arweave: settingsManager.isDestinationEnabled('arweave'),
            gun: settingsManager.isDestinationEnabled('gun'),
            internetArchive: settingsManager.isDestinationEnabled('internetArchive')
        };
        
        console.log(`📤 Publishing record to:`, Object.entries(publishDestinations)
            .filter(([, v]) => v)
            .map(([k]) => k)
            .join(', ') || 'no destinations enabled');
        
        // Publish to all destinations
        const result = await publishRecord(record, publishDestinations, userToken, wordpress);
        
        res.status(200).json(result);
        
    } catch (error) {
        console.error('Publish error:', error);
        res.status(500).json({
            error: 'Publishing failed',
            message: error.message
        });
    }
});

/**
 * GET /api/publish/:id/status
 * Check submission status
 */
router.get('/:id/status', (req, res) => {
    try {
        const { id } = req.params;
        
        const status = getSubmissionStatus(id);
        
        if (!status) {
            return res.status(404).json({
                error: 'Submission not found',
                submissionId: id
            });
        }
        
        res.status(200).json(status);
        
    } catch (error) {
        console.error('Status check error:', error);
        res.status(500).json({
            error: 'Status check failed',
            message: error.message
        });
    }
});

/**
 * GET /api/publish/recent
 * Get recent submissions
 */
router.get('/recent', (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 10, 100);
        const submissions = getRecentSubmissions(limit);
        
        res.status(200).json({
            count: submissions.length,
            submissions
        });
        
    } catch (error) {
        console.error('Recent submissions error:', error);
        res.status(500).json({
            error: 'Failed to get recent submissions',
            message: error.message
        });
    }
});

/**
 * GET /api/publish/destinations
 * Get available publishing destinations
 */
router.get('/destinations', (req, res) => {
    try {
        res.status(200).json({
            destinations: {
                arweave: {
                    enabled: settingsManager.isDestinationEnabled('arweave'),
                    description: 'Permanent blockchain storage on Arweave'
                },
                gun: {
                    enabled: settingsManager.isDestinationEnabled('gun'),
                    description: 'Real-time peer synchronization via GUN'
                },
                internetArchive: {
                    enabled: settingsManager.isDestinationEnabled('internetArchive'),
                    description: 'Anonymous submission to Internet Archive via TOR'
                }
            },
            enabledDestinations: settingsManager.getEnabledDestinations()
        });
        
    } catch (error) {
        console.error('Destinations error:', error);
        res.status(500).json({
            error: 'Failed to get destinations',
            message: error.message
        });
    }
});

module.exports = router;

