#!/usr/bin/env node

/**
 * GUN Relay Server
 * HTTP-based GUN relay for OIP private/temporary storage
 */

const Gun = require('gun');
require('gun/sea');
const http = require('http');

console.log('Starting GUN HTTP relay server...');

try {
    // Create HTTP server with proper request handling
    const server = http.createServer((req, res) => {
        // Set CORS headers for all requests
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Max-Age', '86400');
        
        // Handle preflight requests
        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }
        
        // Log incoming requests for debugging
        console.log(`📡 ${req.method} ${req.url} from ${req.headers.host || 'unknown'}`);
    });
    
    // Initialize GUN with proper HTTP relay configuration
    const gun = Gun({
        web: server,           // Attach to HTTP server
        radisk: true,          // Enable persistent storage
        file: 'data',          // Storage directory
        multicast: false,      // CRITICAL: Disable multicast for HTTP mode
        localStorage: false,   // Disable browser localStorage
        peers: []              // No other peers, this IS the relay
    });
    
    // Start server on all interfaces
    server.listen(8765, '0.0.0.0', () => {
        console.log('✅ GUN HTTP relay server running on 0.0.0.0:8765');
        console.log('🔧 Multicast disabled - HTTP relay mode active');
        console.log('💾 Persistent storage enabled in /app/data');
        console.log('📡 Ready to accept HTTP connections from OIP services');
    });
    
    // Add connection monitoring
    server.on('connection', (socket) => {
        console.log(`🔗 New connection from ${socket.remoteAddress}:${socket.remotePort}`);
    });
    
    // Handle graceful shutdown
    const shutdown = (signal) => {
        console.log(`🛑 Received ${signal}, shutting down gracefully`);
        server.close(() => {
            console.log('✅ GUN relay server stopped');
            process.exit(0);
        });
    };
    
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    
} catch (error) {
    console.error('❌ Error starting GUN relay server:', error);
    console.error('Stack trace:', error.stack);
    process.exit(1);
}
