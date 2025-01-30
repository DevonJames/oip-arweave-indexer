const express = require('express');
const path = require('path');
const fs = require('fs');
const { authenticateToken } = require('../helpers/utils'); // Import the authentication middleware

const router = express.Router();
const mediaDirectory = path.join(__dirname, '../media');
const { ongoingScrapes } = require('../helpers/sharedState.js'); // Adjust the path to store.js

router.get('/', (req, res) => {
    res.status(200).send('Welcome to OIP server!');
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

router.get('/open-stream', (req, res) => {
  const { scrapeId } = req.query;
  console.log('scrapeId:', scrapeId);

  if (!scrapeId) {
    return res.status(400).json({ error: 'scrapeId is required' });
  }

  
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Send initial connection acknowledgment
  res.write(`event: connected\n`);
  res.write(`data: {"message": "Stream connected for scrapeId: ${scrapeId}"}\n\n`);
  
  console.log(`Client connected to open-stream for scrapeId: ${scrapeId}`);
  // Periodic pings to keep the connection alive
  const keepAliveInterval = setInterval(() => {
    res.write('event: ping\n');
    res.write('data: "Keep connection alive"\n\n');
  }, 15000);

  // Check if the scrape exists in `ongoingScrapes`
  const ongoingStream = ongoingScrapes.get(scrapeId);
  if (!ongoingStream) {
    console.log(`No ongoing scrape found for scrapeId: ${scrapeId}`);
    clearInterval(keepAliveInterval);
    res.write(`event: error\n`);
    res.write(`data: {"message": "Stream not found or already closed."}\n\n`);
    return res.end();
  }

  // Ensure the `clients` array exists
  if (!ongoingStream.clients) {
    ongoingStream.clients = [];
  }

  // Attach the client to the ongoing stream
  ongoingStream.clients.push(res);

  // Send all stored updates to the new client
  if (ongoingStream.data && ongoingStream.data.length > 0) {
    ongoingStream.data.forEach(({ event, data }) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    });
  }

  // Handle client disconnection
  req.on('close', () => {
    console.log(`Client disconnected for scrapeId: ${scrapeId}`);
    clearInterval(keepAliveInterval);

    // Remove the client from the stream's list
    ongoingStream.clients = ongoingStream.clients.filter(client => client !== res);

    // Clean up if no more clients are connected
    if (ongoingStream.clients.length === 0) {
      console.log(`No more clients for scrapeId: ${scrapeId}. Cleaning up.`);
      ongoingScrapes.delete(scrapeId);
    }
  });
});

// router.get('/open-stream', (req, res) => {
//   const { scrapeId } = req.query;
//   console.log('scrapeId:', scrapeId);

//   if (!scrapeId) {
//     return res.status(400).json({ error: 'scrapeId is required' });
//   }

//   console.log(`Client connected to open-stream for scrapeId: ${scrapeId}`);

//   // Set SSE headers
//   res.setHeader('Content-Type', 'text/event-stream');
//   res.setHeader('Cache-Control', 'no-cache');
//   res.setHeader('Connection', 'keep-alive');

//   // Periodic pings to keep the connection alive
//   const keepAliveInterval = setInterval(() => {
//     res.write('event: ping\n');
//     res.write('data: "Keep connection alive"\n\n');
//   }, 15000);

//   // Ensure the ongoingScrapes map exists and is properly initialized
//   if (!ongoingScrapes.has(scrapeId)) {
//     console.log(`No ongoing scrape found for scrapeId: ${scrapeId}`);
//     clearInterval(keepAliveInterval);
//     return res.status(404).json({ error: 'Stream not found or already closed.' });
//   }

//   const ongoingStream = ongoingScrapes.get(scrapeId);

//   // Ensure the `clients` array exists
//   if (!ongoingStream.clients) {
//     ongoingStream.clients = [];
//   }

//   // Attach the client to the ongoing stream
//   ongoingStream.clients.push(res);

//   req.on('close', () => {
//     console.log(`Client disconnected for scrapeId: ${scrapeId}`);
//     clearInterval(keepAliveInterval);

//     // Remove the client from the stream's list
//     ongoingStream.clients = ongoingStream.clients.filter(client => client !== res);

//     // Clean up if no more clients are connected
//     if (ongoingStream.clients.length === 0) {
//       console.log(`No more clients for scrapeId: ${scrapeId}. Cleaning up.`);
//       ongoingScrapes.delete(scrapeId);
//     }
//   });
// });

module.exports = router;