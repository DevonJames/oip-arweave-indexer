/**
 * Narration Routes for Rock Hoppers Documentation
 * 
 * Provides text-to-speech generation using ElevenLabs API
 * Integrated into OIP backend for Docker container deployment
 */

const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');

// Import from generators.js or create helper functions
const { generateNarration, findExistingNarration } = require('../../helpers/core/generators');

/**
 * POST /api/narrate
 * Generate or retrieve cached narration for a document
 */
router.post('/narrate', async (req, res) => {
    try {
        const { docName, markdown } = req.body;
        
        if (!docName || !markdown) {
            return res.status(400).json({ 
                error: 'docName and markdown are required' 
            });
        }
        
        console.log(`📖 Narration request for: ${docName}`);
        
        // Call generator function
        const result = await generateNarration(docName, markdown);
        
        res.json(result);
        
    } catch (error) {
        console.error('❌ Error generating narration:', error);
        res.status(500).json({
            error: 'Failed to generate narration',
            message: error.message
        });
    }
});

/**
 * GET /api/narrations
 * List all available narrations
 */
router.get('/narrations', async (req, res) => {
    try {
        const projectName = process.env.COMPOSE_PROJECT_NAME || 'oip-arweave-indexer';
        const narrationsDir = path.join(__dirname, '../data/media/web', projectName);
        const files = await fs.readdir(narrationsDir);
        const mp3Files = files.filter(f => f.endsWith('.mp3'));
        
        res.json({
            success: true,
            count: mp3Files.length,
            narrations: mp3Files.map(f => ({
                filename: f,
                url: `/media/${projectName}/${f}`
            }))
        });
    } catch (error) {
        console.error('Error listing narrations:', error);
        res.status(500).json({ error: 'Failed to list narrations' });
    }
});

/**
 * GET /api/narrate/health
 * Check narration service status
 */
router.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Narration service is running',
        elevenlabs: {
            apiKeySet: !!process.env.ELEVENLABS_API_KEY,
            voiceIdSet: !!process.env.ELEVENLABS_VOICE_ID
        }
    });
});

module.exports = router;
