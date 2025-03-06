const express = require('express');
const axios = require('axios');
const router = express.Router();

/**
 * Generate a signed URL for ElevenLabs Conversation API
 */
router.get('/get-signed-url', async (req, res) => {
    try {
        // Get agent ID from query parameter
        const agentId = req.query.agentId;
        
        if (!agentId) {
            return res.status(400).json({ error: 'Agent ID is required' });
        }
        
        // Create request headers with API key
        const requestHeaders = {
            'xi-api-key': process.env.ELEVENLABS_API_KEY
        };
        
        // Make request to ElevenLabs API
        const response = await axios.get(
            `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${agentId}`,
            {
                headers: requestHeaders
            }
        );
        
        if (!response.data || !response.data.signed_url) {
            return res.status(500).json({ error: 'Failed to get signed URL from ElevenLabs' });
        }
        
        // Return the signed URL to the client
        res.json({
            signedUrl: response.data.signed_url
        });
    } catch (error) {
        console.error('Error getting signed URL:', error);
        
        // Better error response with details
        const errorResponse = {
            error: 'Failed to generate signed URL',
            message: error.message
        };
        
        if (error.response) {
            errorResponse.status = error.response.status;
            errorResponse.data = error.response.data;
        }
        
        res.status(500).json(errorResponse);
    }
});

module.exports = router; 