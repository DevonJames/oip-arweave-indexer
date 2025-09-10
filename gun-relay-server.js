#!/usr/bin/env node

/**
 * GUN HTTP API Server
 * HTTP API wrapper around GUN database for OIP integration
 */

const Gun = require('gun');
require('gun/sea');
const http = require('http');
const url = require('url');

// In-memory index for simple listing by publisher hash
// Structure: { [publisherHash: string]: Array<{ soul: string, data: any, storedAt: number }> }
const publisherIndex = new Map();

console.log('Starting GUN HTTP API server...');

try {
    // Create HTTP API server first
    const server = http.createServer(async (req, res) => {
        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Content-Type', 'application/json');
        
        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }
        
        const parsedUrl = url.parse(req.url, true);
        const path = parsedUrl.pathname;
        
        console.log(`📡 ${req.method} ${path}`);
        
        try {
            if (req.method === 'POST' && path === '/put') {
                // Handle PUT operations
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', async () => {
                    try {
                        const { soul, data } = JSON.parse(body);
                        console.log(`💾 Storing data for soul: ${soul.substring(0, 50)}...`);
                        
                        gun.get(soul).put(data, (ack) => {
                            if (ack.err) {
                                console.error('❌ GUN put error:', ack.err);
                                res.writeHead(500);
                                res.end(JSON.stringify({ error: ack.err }));
                            } else {
                                console.log('✅ Data stored successfully');
                                try {
                                    // Maintain a simple in-memory index by publisher hash prefix
                                    // Expected soul format: "<publisherHash>:<rest>"
                                    const prefix = String(soul).split(':')[0];
                                    if (prefix && prefix.length > 0) {
                                        const list = publisherIndex.get(prefix) || [];
                                        // Upsert by soul
                                        const existingIndex = list.findIndex(r => r.soul === soul);
                                        const record = { soul, data, storedAt: Date.now() };
                                        if (existingIndex >= 0) list[existingIndex] = record; else list.push(record);
                                        publisherIndex.set(prefix, list);
                                    }
                                } catch (e) {
                                    console.warn('⚠️ Failed to update in-memory index:', e.message);
                                }
                                res.writeHead(200);
                                res.end(JSON.stringify({ success: true, soul }));
                            }
                        });
                    } catch (parseError) {
                        console.error('❌ JSON parse error:', parseError);
                        res.writeHead(400);
                        res.end(JSON.stringify({ error: 'Invalid JSON' }));
                    }
                });
                
            } else if (req.method === 'GET' && path === '/get') {
                // Handle GET operations
                const soul = parsedUrl.query.soul;
                if (!soul) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'Soul parameter required' }));
                    return;
                }
                
                console.log(`📖 Getting data for soul: ${soul.substring(0, 50)}...`);
                gun.get(soul).once((data) => {
                    if (data) {
                        console.log('✅ Data retrieved successfully');
                        res.writeHead(200);
                        res.end(JSON.stringify({ success: true, data }));
                    } else {
                        console.log('❌ No data found');
                        res.writeHead(404);
                        res.end(JSON.stringify({ error: 'Not found' }));
                    }
                });
                
            } else if (req.method === 'GET' && path === '/list') {
                // List records by publisher hash prefix
                const publisherHash = parsedUrl.query.publisherHash;
                const limit = Math.max(0, parseInt(parsedUrl.query.limit || '50', 10) || 50);
                const offset = Math.max(0, parseInt(parsedUrl.query.offset || '0', 10) || 0);
                const recordType = parsedUrl.query.recordType;

                if (!publisherHash) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'publisherHash parameter required' }));
                    return;
                }

                console.log(`📃 Listing records for publisherHash=${publisherHash}, limit=${limit}, offset=${offset}, recordType=${recordType || 'any'}`);
                const list = publisherIndex.get(publisherHash) || [];
                let records = list;
                if (recordType) {
                    records = records.filter(r => r?.data?.oip?.recordType === recordType);
                }
                const paged = records.slice(offset, offset + limit);
                res.writeHead(200);
                res.end(JSON.stringify({ success: true, records: paged }));

            } else {
                // Handle unknown endpoints
                res.writeHead(404);
                res.end(JSON.stringify({ error: 'Endpoint not found' }));
            }
            
        } catch (error) {
            console.error('❌ Request handling error:', error);
            res.writeHead(500);
            res.end(JSON.stringify({ error: error.message }));
        }
    });
    
    // Initialize GUN database after server is created
    const gun = Gun({
        web: server,
        radisk: true,
        file: 'data',
        localStorage: false,
        multicast: false
    });
    
    server.listen(8765, '0.0.0.0', () => {
        console.log('✅ GUN HTTP API server running on 0.0.0.0:8765');
        console.log('💾 Local GUN database with persistent storage');
        console.log('🌐 HTTP API endpoints: /put (POST), /get (GET), /list (GET)');
        
        // Test the local GUN database
        setTimeout(() => {
            gun.get('test:startup').put({ test: true, timestamp: Date.now() }, (ack) => {
                if (ack.err) {
                    console.error('❌ Local GUN test failed:', ack.err);
                } else {
                    console.log('✅ Local GUN database working - ready for HTTP API operations');
                }
            });
        }, 1000);
    });
    
    // Keep the process alive
    process.on('uncaughtException', (error) => {
        console.error('❌ Uncaught exception:', error);
        // Don't exit - keep the server running
    });
    
    process.on('unhandledRejection', (reason, promise) => {
        console.error('❌ Unhandled rejection at:', promise, 'reason:', reason);
        // Don't exit - keep the server running
    });
    
    // Handle graceful shutdown
    const shutdown = (signal) => {
        console.log(`🛑 Received ${signal}, shutting down gracefully`);
        server.close(() => {
            console.log('✅ GUN HTTP API server stopped');
            process.exit(0);
        });
    };
    
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    
} catch (error) {
    console.error('❌ Error starting GUN HTTP API server:', error);
    console.error('Stack trace:', error.stack);
    process.exit(1);
}
