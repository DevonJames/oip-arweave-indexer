#!/usr/bin/env node

/**
 * GUN Relay Server
 * Simple in-memory GUN relay for OIP private/temporary storage
 */

const Gun = require('gun');
require('gun/sea');

console.log('Starting GUN relay server...');

try {
    // Use GUN's built-in server mode - much simpler and more reliable
    const gun = Gun({
        port: 8765,
        host: '0.0.0.0',
        web: require('http').createServer().listen(8765),
        radisk: true,
        file: 'data'
    });
    
    console.log('✅ GUN relay server running on 0.0.0.0:8765');
    console.log('💾 Persistent storage enabled in /app/data');
    console.log('📡 Ready to accept connections from OIP services');
    
    // Test the relay by storing a test record
    setTimeout(() => {
        const testSoul = 'test:relay:startup';
        gun.get(testSoul).put({ test: true, timestamp: Date.now() }, (ack) => {
            if (ack.err) {
                console.error('❌ Relay self-test failed:', ack.err);
            } else {
                console.log('✅ Relay self-test passed - ready for operations');
            }
        });
    }, 1000);
    
    // Handle graceful shutdown
    const shutdown = (signal) => {
        console.log(`🛑 Received ${signal}, shutting down gracefully`);
        process.exit(0);
    };
    
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    
} catch (error) {
    console.error('❌ Error starting GUN relay server:', error);
    console.error('Stack trace:', error.stack);
    process.exit(1);
}
