const express = require('express');
const path = require('path');
const fs = require('fs');
const { authenticateToken } = require('../helpers/utils'); // Import the authentication middleware
const socketManager = require('../socket/socketManager');
const alfred = require('../helpers/alfred'); // Add ALFRED service

const router = express.Router();
const mediaDirectory = path.join(__dirname, '../media');
const { ongoingScrapes } = require('../helpers/sharedState.js'); // Adjust the path to store.js

// Serve static files from the public directory
// Use custom public path if specified, otherwise default to OIP's public folder
const publicPath = process.env.CUSTOM_PUBLIC_PATH === 'true' 
  ? path.join(__dirname, '..', '..', 'public')  // Parent directory public folder
  : path.join(__dirname, '..', 'public');       // Default OIP public folder

router.use(express.static(publicPath));

router.get('/', (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
});

// Simple RAG test endpoint
router.post('/test-rag', async (req, res) => {
    try {
        const { question = "What records do I have?" } = req.body;
        
        console.log(`[API] Testing RAG with question: ${question}`);
        
        const ragResponse = await alfred.query(question, {
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
// Route to serve media files with range request support
// router.get('/media', authenticateToken, (req, res) => {
router.get('/media', (req, res) => {
    const { id } = req.query;
    const filePath = path.join(mediaDirectory, id);
    console.log('filepath:', filePath);
    
    if (!fs.existsSync(filePath)) {
        return res.status(404).send("File not found");
    }
    
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;
    
    // Always set Accept-Ranges header to indicate range support
    res.setHeader('Accept-Ranges', 'bytes');
    
    if (range) {
        // Parse the range header
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        
        // Validate range
        if (start >= fileSize || end >= fileSize || start > end) {
            res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
            return res.send('Range Not Satisfiable');
        }
        
        const chunksize = (end - start) + 1;
        const file = fs.createReadStream(filePath, { start, end });
        
        // Set headers for partial content
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
        res.setHeader('Content-Length', chunksize);
        res.setHeader('Content-Type', getContentType(filePath));
        
        // Pipe the file stream
        file.pipe(res);
        
    } else {
        // No range requested, send entire file
        res.setHeader('Content-Length', fileSize);
        res.setHeader('Content-Type', getContentType(filePath));
        
        const file = fs.createReadStream(filePath);
        file.pipe(res);
    }
});

// Helper function to determine content type based on file extension
function getContentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const contentTypes = {
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.ogg': 'video/ogg',
        '.avi': 'video/x-msvideo',
        '.mov': 'video/quicktime',
        '.wmv': 'video/x-ms-wmv',
        '.flv': 'video/x-flv',
        '.mkv': 'video/x-matroska',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.ogg': 'audio/ogg',
        '.flac': 'audio/flac',
        '.aac': 'audio/aac',
        '.m4a': 'audio/mp4',
        '.wma': 'audio/x-ms-wma',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.bmp': 'image/bmp',
        '.ico': 'image/x-icon',
        '.pdf': 'application/pdf',
        '.txt': 'text/plain',
        '.json': 'application/json',
        '.xml': 'application/xml',
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript'
    };
    
    return contentTypes[ext] || 'application/octet-stream';
}


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