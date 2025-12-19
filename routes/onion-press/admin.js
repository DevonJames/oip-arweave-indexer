/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ADMIN ROUTES - Settings management API (requires authentication)
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Endpoints:
 *   GET  /api/admin/settings     - Get current settings
 *   POST /api/admin/settings     - Update settings
 *   POST /api/admin/settings/reset - Reset to defaults
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const settingsManager = require('../../helpers/onion-press/settingsManager');
const { getTorStatus } = require('../../helpers/onion-press/torClient');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

/**
 * Authentication middleware - requires valid JWT with admin role
 */
function requireAdmin(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Authentication required'
            });
        }
        
        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Check for admin role
        if (!decoded.isAdmin && decoded.role !== 'admin') {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Admin access required'
            });
        }
        
        req.user = decoded;
        next();
        
    } catch (error) {
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Invalid or expired token'
            });
        }
        
        console.error('Auth error:', error);
        res.status(500).json({
            error: 'Authentication error',
            message: error.message
        });
    }
}

/**
 * GET /api/admin/settings
 * Get current settings (requires admin auth)
 */
router.get('/settings', requireAdmin, async (req, res) => {
    try {
        const settings = settingsManager.getAllSettings();
        const torStatus = await getTorStatus();
        
        res.status(200).json({
            settings,
            torStatus
        });
        
    } catch (error) {
        console.error('Get settings error:', error);
        res.status(500).json({
            error: 'Failed to get settings',
            message: error.message
        });
    }
});

/**
 * POST /api/admin/settings
 * Update settings (requires admin auth)
 */
router.post('/settings', requireAdmin, (req, res) => {
    try {
        const updates = req.body;
        
        if (!updates || typeof updates !== 'object') {
            return res.status(400).json({
                error: 'Invalid request',
                message: 'Request body must be an object with settings to update'
            });
        }
        
        console.log('⚙️ Updating settings:', Object.keys(updates).join(', '));
        
        const updatedSettings = settingsManager.updateSettings(updates);
        
        res.status(200).json({
            success: true,
            message: 'Settings updated',
            settings: updatedSettings
        });
        
    } catch (error) {
        console.error('Update settings error:', error);
        res.status(500).json({
            error: 'Failed to update settings',
            message: error.message
        });
    }
});

/**
 * POST /api/admin/settings/reset
 * Reset settings to defaults (requires admin auth)
 */
router.post('/settings/reset', requireAdmin, (req, res) => {
    try {
        console.log('⚙️ Resetting settings to defaults');
        
        const defaultSettings = settingsManager.resetSettings();
        
        res.status(200).json({
            success: true,
            message: 'Settings reset to defaults',
            settings: defaultSettings
        });
        
    } catch (error) {
        console.error('Reset settings error:', error);
        res.status(500).json({
            error: 'Failed to reset settings',
            message: error.message
        });
    }
});

/**
 * GET /api/admin/status
 * Get overall admin status (public - for UI to check if admin features available)
 */
router.get('/status', (req, res) => {
    try {
        // Check if user is admin
        let isAdmin = false;
        const authHeader = req.headers.authorization;
        
        if (authHeader?.startsWith('Bearer ')) {
            try {
                const token = authHeader.substring(7);
                const decoded = jwt.verify(token, JWT_SECRET);
                isAdmin = decoded.isAdmin || decoded.role === 'admin';
            } catch (e) {
                // Invalid token, not admin
            }
        }
        
        res.status(200).json({
            isAdmin,
            adminFeaturesAvailable: isAdmin,
            enabledDestinations: settingsManager.getEnabledDestinations()
        });
        
    } catch (error) {
        console.error('Admin status error:', error);
        res.status(500).json({
            error: 'Failed to get admin status',
            message: error.message
        });
    }
});

module.exports = router;

