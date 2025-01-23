const express = require('express');
const path = require('path');
const fs = require('fs');
const { authenticateToken } = require('../helpers/utils'); // Import the authentication middleware

const router = express.Router();
const mediaDirectory = path.join(__dirname, '../media');

router.get('/', (req, res) => {
    res.status(200).send('Welcome to OIP server!');
});

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

router.get('/open-stream', (req, res) => {
    const { scrapeId } = req.query;
  
    if (!scrapeId) {
      return res.status(400).json({ error: 'scrapeId is required' });
    }
  
    console.log(`Client connected to open-stream for scrapeId: ${scrapeId}`);
  
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
  
    // Keep the connection alive
    const keepAliveInterval = setInterval(() => {
      res.write('event: ping\n');
      res.write('data: "Keep connection alive"\n\n');
    }, 15000);
  
    // Store the connection to send updates later
    if (!ongoingScrapes.has(scrapeId)) {
      ongoingScrapes.set(scrapeId, res);
    }
  
    // Handle client disconnect
    req.on('close', () => {
      console.log(`Client disconnected from stream for scrapeId: ${scrapeId}`);
      clearInterval(keepAliveInterval);
      ongoingScrapes.delete(scrapeId);
      res.end();
    });
  });

module.exports = router;