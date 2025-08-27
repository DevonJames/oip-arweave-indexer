#!/usr/bin/env node
/**
 * Mac Voice Interface Server
 * Serves the local voice interface and handles coordination
 */

const express = require('express');
const path = require('path');
const cors = require('cors');
const MacClientCoordinator = require('./mac_client_coordinator');

const app = express();
const PORT = process.env.INTERFACE_PORT || 3001;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Initialize coordinator
const coordinator = new MacClientCoordinator();

// Serve the main interface
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'voice_interface.html'));
});

// Health check endpoint for the interface
app.get('/health', async (req, res) => {
    try {
        const health = await coordinator.checkHealth();
        res.json(health);
    } catch (error) {
        res.status(500).json({
            error: 'Health check failed',
            message: error.message
        });
    }
});

// Voice processing endpoint
app.post('/process-voice', async (req, res) => {
    try {
        const { audioData } = req.body;
        
        if (!audioData) {
            return res.status(400).json({ error: 'No audio data provided' });
        }
        
        // Convert base64 to buffer
        const audioBuffer = Buffer.from(audioData, 'base64');
        
        // Process through the pipeline
        const result = await coordinator.processAudio(audioBuffer);
        
        res.json(result);
    } catch (error) {
        console.error('Voice processing error:', error);
        res.status(500).json({
            error: 'Voice processing failed',
            message: error.message
        });
    }
});

// Proxy endpoint for backend /generate routes
app.post('/api/backend/generate/:endpoint', async (req, res) => {
    try {
        const { endpoint } = req.params;
        const backendUrl = `${coordinator.backendUrl}/generate/${endpoint}`;
        
        console.log(`🔗 Proxying request to: ${backendUrl}`);
        console.log(`📦 Request body:`, JSON.stringify(req.body, null, 2));
        
        // Use axios instead of fetch for better error handling and timeout support
        const axios = require('axios');
        
        const response = await axios.post(backendUrl, req.body, {
            headers: {
                'Content-Type': 'application/json',
            },
            timeout: 30000,
            validateStatus: function (status) {
                return status < 500; // Accept any response that's not a server error
            }
        });
        
        console.log(`✅ Backend response status: ${response.status}`);
        
        if (response.status >= 400) {
            console.log(`❌ Backend error: ${response.status} - ${response.data}`);
        }
        
        res.status(response.status).json(response.data);
        
    } catch (error) {
        console.error('Backend proxy error:', error);
        
        if (error.code === 'ECONNREFUSED') {
            res.status(503).json({
                error: 'Backend service unavailable',
                message: 'Cannot connect to backend server',
                details: error.message
            });
        } else if (error.code === 'ETIMEDOUT') {
            res.status(504).json({
                error: 'Backend timeout',
                message: 'Backend server is taking too long to respond',
                details: error.message
            });
        } else {
            res.status(500).json({
                error: 'Backend proxy failed',
                message: error.message
            });
        }
    }
});

// Proxy endpoint for backend communication (to avoid CORS issues)
app.post('/api/backend/:endpoint', async (req, res) => {
    try {
        const { endpoint } = req.params;
        const backendUrl = `${coordinator.backendUrl}/alfred/${endpoint}`;
        
        console.log(`🔗 Proxying request to: ${backendUrl}`);
        console.log(`📦 Request body:`, JSON.stringify(req.body, null, 2));
        
        // Use axios instead of fetch for better error handling and timeout support
        const axios = require('axios');
        
        const response = await axios.post(backendUrl, req.body, {
            headers: {
                'Content-Type': 'application/json',
            },
            timeout: 30000,
            validateStatus: function (status) {
                return status < 500; // Accept all responses under 500 as valid
            }
        });
        
        console.log(`✅ Backend response status: ${response.status}`);
        
        if (response.status >= 400) {
            console.error(`❌ Backend error: ${response.status} - ${response.data}`);
            return res.status(response.status).json({
                error: 'Backend request failed',
                message: response.data?.message || response.statusText,
                status: response.status
            });
        }
        
        res.json(response.data);
    } catch (error) {
        console.error('Backend proxy error:', error);
        
        if (error.code === 'ECONNREFUSED') {
            res.status(503).json({
                error: 'Backend service unavailable',
                message: 'Cannot connect to backend server',
                details: error.message
            });
        } else if (error.code === 'ETIMEDOUT') {
            res.status(504).json({
                error: 'Backend timeout',
                message: 'Backend server took too long to respond',
                details: error.message
            });
        } else {
            res.status(500).json({
                error: 'Backend communication failed',
                message: error.message,
                code: error.code
            });
        }
    }
});

// Proxy endpoint for backend streaming (GET requests)
app.get('/api/backend/generate/:endpoint', async (req, res) => {
    try {
        const { endpoint } = req.params;
        const backendUrl = `${coordinator.backendUrl}/generate/${endpoint}`;
        const queryString = new URLSearchParams(req.query).toString();
        const fullUrl = queryString ? `${backendUrl}?${queryString}` : backendUrl;
        
        console.log(`🔗 Proxying GET request to: ${fullUrl}`);
        
        // For streaming endpoints, we need to proxy the stream
        if (endpoint === 'open-stream') {
            // Set SSE headers
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            
            // Use axios to get the stream
            const axios = require('axios');
            
            const response = await axios.get(fullUrl, {
                responseType: 'stream',
                timeout: 0 // No timeout for streaming
            });
            
            console.log(`✅ Backend streaming response status: ${response.status}`);
            
            // Pipe the stream to the client
            response.data.pipe(res);
            
            // Handle stream errors
            response.data.on('error', (error) => {
                console.error('Backend stream error:', error);
                res.end();
            });
            
            // Handle client disconnect
            req.on('close', () => {
                console.log('Client disconnected from stream');
                response.data.destroy();
            });
            
        } else {
            // Regular GET request
            const axios = require('axios');
            
            const response = await axios.get(fullUrl, {
                timeout: 30000
            });
            
            console.log(`✅ Backend GET response status: ${response.status}`);
            res.status(response.status).json(response.data);
        }
        
    } catch (error) {
        console.error('Backend GET proxy error:', error);
        
        if (error.code === 'ECONNREFUSED') {
            res.status(503).json({
                error: 'Backend service unavailable',
                message: 'Cannot connect to backend server',
                details: error.message
            });
        } else if (error.code === 'ETIMEDOUT') {
            res.status(504).json({
                error: 'Backend timeout',
                message: 'Backend server is taking too long to respond',
                details: error.message
            });
        } else {
            res.status(500).json({
                error: 'Backend GET proxy failed',
                message: error.message
            });
        }
    }
});

// Start server
app.listen(PORT, '127.0.0.1', () => {
    console.log('🍎 Mac Voice Interface Server Started');
    console.log('=================================');
    console.log(`🌐 Local Interface: http://127.0.0.1:${PORT}`);
    console.log(`🎤 STT Service: http://127.0.0.1:8013`);
    console.log(`🤖 Smart Turn Service: http://127.0.0.1:8014`);
    console.log(`🖥️  Backend: ${coordinator.backendUrl}`);
    console.log('');
    console.log('✨ Open your browser and start talking to ALFRED!');
    console.log('   Press Ctrl+C to stop the server');
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down Mac Voice Interface Server...');
    process.exit(0);
});

module.exports = app;
