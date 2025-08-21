#!/usr/bin/env node

/**
 * GUN Relay Server
 * Simple GUN relay for OIP private/temporary storage
 */

const Gun = require('gun');
require('gun/sea');
const http = require('http');

console.log('Starting GUN relay server...');

try {
    // Create HTTP server
    const server = http.createServer();
    
    // Initialize GUN with the server in relay mode
    const gun = Gun({
        web: server,
        radisk: true,
        file: 'data',
        multicast: false, // Disable multicast for HTTP relay mode
        localStorage: false
    });
    
    // Start server
    server.listen(8765, '0.0.0.0', () => {
        console.log('✅ GUN relay server running on port 8765');
        console.log('📡 Ready to accept connections from OIP services');
    });
    
    // Handle graceful shutdown
    process.on('SIGTERM', () => {
        console.log('🛑 Received SIGTERM, shutting down gracefully');
        server.close(() => {
            console.log('✅ GUN relay server stopped');
            process.exit(0);
        });
    });
    
    process.on('SIGINT', () => {
        console.log('🛑 Received SIGINT, shutting down gracefully');
        server.close(() => {
            console.log('✅ GUN relay server stopped');
            process.exit(0);
        });
    });
    
} catch (error) {
    console.error('❌ Error starting GUN relay server:', error);
    process.exit(1);
}
