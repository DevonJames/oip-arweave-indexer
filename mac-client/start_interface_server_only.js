#!/usr/bin/env node
/**
 * Simple script to start just the interface server
 */

const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 3001;

// Enable CORS
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

app.use(express.json());
app.use(express.static(__dirname));

// Serve the hybrid voice interface
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'hybrid_voice_interface.html'));
});

app.get('/enhanced', (req, res) => {
    res.sendFile(path.join(__dirname, 'hybrid_voice_interface.html'));
});

// Simple health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'ALFRED Voice Interface Server',
        timestamp: new Date().toISOString()
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 ALFRED Voice Interface Server started on port ${PORT}`);
    console.log(`📱 Interface: http://localhost:${PORT}/enhanced`);
    console.log(`🔧 Health: http://localhost:${PORT}/health`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down interface server...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down interface server...');
    process.exit(0);
});
