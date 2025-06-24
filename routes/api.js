const express = require('express');
const path = require('path');
const fs = require('fs');
const { authenticateToken } = require('../helpers/utils'); // Import the authentication middleware
const socketManager = require('../socket/socketManager');
const ragService = require('../helpers/ragService'); // Add RAG service

const router = express.Router();
const mediaDirectory = path.join(__dirname, '../media');
const { ongoingScrapes } = require('../helpers/sharedState.js'); // Adjust the path to store.js

// Serve static files from the public directory
router.use(express.static(path.join(__dirname, '../public')));

router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Simple RAG test endpoint
router.post('/test-rag', async (req, res) => {
    try {
        const { question = "What records do I have?" } = req.body;
        
        console.log(`[API] Testing RAG with question: ${question}`);
        
        const ragResponse = await ragService.query(question, {
            model: 'llama3.2:3b',
            searchParams: { limit: 3 }
        });
        
        res.json({
            success: true,
            question,
            answer: ragResponse.answer,
            sources: ragResponse.sources,
            context_used: ragResponse.context_used,
            search_results_count: ragResponse.search_results_count,
            model: ragResponse.model
        });
        
    } catch (error) {
        console.error('[API] RAG test error:', error);
        res.status(500).json({
            error: 'RAG test failed',
            details: error.message
        });
    }
});

// const ongoingScrapes = new Map();
// Route to serve media files
// router.get('/media', authenticateToken, (req, res) => {
router.get('/media', (req, res) => {
    const { id } = req.query;
    const filePath = path.join(mediaDirectory, id);
    console.log('filepath:', filePath);
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).send("File not found");
    }
});


// Add or update the ping endpoint with a proper keepalive response
router.get('/ping', (req, res) => {
  // Set headers to prevent caching
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  
  // Send a simple response with timestamp
  res.json({ 
    status: 'active', 
    timestamp: Date.now(),
    message: 'Connection alive'
  });
});

/**
 * Open a Server-Sent Events (SSE) connection
 */
router.get('/open-stream', (req, res) => {
    const streamId = req.query.id;
    
    if (!streamId) {
        return res.status(400).json({ error: 'No dialogue ID provided' });
    }
    
    console.log(`Client connecting to open-stream for streamId: ${streamId}`);
    
    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    
    // Send initial connection message with proper SSE format
    res.write(`event: connected\n`);
    res.write(`data: ${JSON.stringify({ message: 'Stream connected' })}\n\n`);
    
    // Register client with the Socket Manager  
    socketManager.addClient(streamId, res);
    
    // Handle client disconnect
    req.on('close', () => {
        console.log(`Client disconnected from streamId: ${streamId}`);
        socketManager.removeClient(streamId, res);
    });
});

module.exports = router;