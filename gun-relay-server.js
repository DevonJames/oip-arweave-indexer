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
                        
                        // Store data and ensure all nested properties are properly saved
                        const gunNode = gun.get(soul);

                        // Put the main data structure
                        gunNode.put(data, (ack) => {
                            if (ack.err) {
                                console.error('❌ GUN put error:', ack.err);
                                res.writeHead(500);
                                res.end(JSON.stringify({ error: ack.err }));
                            } else {
                                console.log('✅ Data stored successfully');

                                // Ensure nested data is also stored by explicitly setting each property
                                // This helps GUN properly handle complex nested structures
                                if (data.data && typeof data.data === 'object') {
                                    Object.keys(data.data).forEach(key => {
                                        gunNode.get('data').get(key).put(data.data[key]);
                                    });
                                }
                                if (data.meta && typeof data.meta === 'object') {
                                    Object.keys(data.meta).forEach(key => {
                                        gunNode.get('meta').get(key).put(data.meta[key]);
                                    });
                                }
                                if (data.oip && typeof data.oip === 'object') {
                                    Object.keys(data.oip).forEach(key => {
                                        gunNode.get('oip').get(key).put(data.oip[key]);
                                    });
                                }

                                try {
                                    // Maintain a simple in-memory index by publisher hash prefix
                                    // Expected soul format: "<publisherHash>:<rest>"
                                    const prefix = String(soul).split(':')[0];
                                    if (prefix && prefix.length > 0) {
                                        const list = publisherIndex.get(prefix) || [];
                                        // Upsert by soul
                                        const existingIndex = list.findIndex(r => r.soul === soul);
                                        const recordType = data?.oip?.recordType || data?.data?.oip?.recordType || null;
                                        const record = { soul, data, recordType, storedAt: Date.now() };
                                        if (existingIndex >= 0) list[existingIndex] = record; else list.push(record);
                                        publisherIndex.set(prefix, list);

                                        // Persist minimal index into GUN for restart durability
                                        // Layout: index:<publisherHash> is a map of soul -> { recordType, storedAt }
                                        gun.get(`index:${prefix}`).get(soul).put({ recordType, storedAt: record.storedAt });
                                    }
                                } catch (e) {
                                    console.warn('⚠️ Failed to update in-memory index:', e.message);
                                }

                                // Add a small delay to ensure GUN has time to propagate changes
                                setTimeout(() => {
                                    res.writeHead(200);
                                    res.end(JSON.stringify({ success: true, soul }));
                                }, 100);
                            }
                        });
                    } catch (parseError) {
                        console.error('❌ JSON parse error:', parseError);
                        res.writeHead(400);
                        res.end(JSON.stringify({ error: 'Invalid JSON' }));
                    }
                });
                
            } else if (req.method === 'POST' && path === '/media/manifest') {
                // Handle media manifest publishing
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', async () => {
                    try {
                        const manifest = JSON.parse(body);
                        const mediaId = manifest.media?.id;
                        
                        if (!mediaId) {
                            res.writeHead(400);
                            res.end(JSON.stringify({ error: 'mediaId required in manifest' }));
                            return;
                        }
                        
                        console.log(`📡 Publishing media manifest: ${mediaId}`);
                        
                        // Store manifest in GUN
                        const manifestSoul = `media:${mediaId}`;
                        gun.get(manifestSoul).put(manifest, (ack) => {
                            if (ack.err) {
                                console.error('❌ Failed to store manifest:', ack.err);
                                res.writeHead(500);
                                res.end(JSON.stringify({ error: ack.err }));
                            } else {
                                console.log('✅ Media manifest stored successfully');
                                res.writeHead(200);
                                res.end(JSON.stringify({ 
                                    success: true, 
                                    mediaId,
                                    soul: manifestSoul 
                                }));
                            }
                        });
                        
                    } catch (error) {
                        console.error('❌ Error parsing manifest:', error);
                        res.writeHead(400);
                        res.end(JSON.stringify({ error: 'Invalid JSON' }));
                    }
                });
                
            } else if (req.method === 'GET' && path === '/media/manifest') {
                // Handle media manifest retrieval
                const mediaId = parsedUrl.query.id;
                if (!mediaId) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'mediaId parameter required' }));
                    return;
                }
                
                console.log(`📖 Getting media manifest: ${mediaId}`);
                const manifestSoul = `media:${mediaId}`;
                
                gun.get(manifestSoul).once((data) => {
                    if (data) {
                        console.log('✅ Media manifest retrieved successfully');
                        res.writeHead(200);
                        res.end(JSON.stringify(data));
                    } else {
                        console.log('❌ Media manifest not found');
                        res.writeHead(404);
                        res.end(JSON.stringify({ error: 'Manifest not found' }));
                    }
                });
                
            } else if (req.method === 'POST' && path === '/media/presence') {
                // Handle peer presence heartbeat
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', async () => {
                    try {
                        const { mediaId, peerId, protocols, endpoints } = JSON.parse(body);
                        
                        if (!mediaId || !peerId) {
                            res.writeHead(400);
                            res.end(JSON.stringify({ error: 'mediaId and peerId required' }));
                            return;
                        }
                        
                        console.log(`📡 Updating presence for ${mediaId}: ${peerId}`);
                        
                        const presenceData = {
                            peerId,
                            protocols: protocols || {},
                            endpoints: endpoints || {},
                            lastSeen: Date.now(),
                            timestamp: new Date().toISOString()
                        };
                        
                        const presenceSoul = `media:${mediaId}:peers:${peerId}`;
                        gun.get(presenceSoul).put(presenceData, (ack) => {
                            if (ack.err) {
                                console.error('❌ Failed to update presence:', ack.err);
                                res.writeHead(500);
                                res.end(JSON.stringify({ error: ack.err }));
                            } else {
                                console.log('✅ Presence updated successfully');
                                res.writeHead(200);
                                res.end(JSON.stringify({ success: true }));
                            }
                        });
                        
                    } catch (error) {
                        console.error('❌ Error parsing presence data:', error);
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

                // Retrieve the complete data structure including nested properties
                const gunNode = gun.get(soul);
                const result = {};

                // Use a counter to track when all properties are loaded
                let pending = 3; // data, meta, oip
                let completed = false;

                const checkComplete = () => {
                    if (--pending === 0 && !completed) {
                        completed = true;
                        if (Object.keys(result).length > 0) {
                            console.log('✅ Data retrieved successfully');
                            res.writeHead(200);
                            res.end(JSON.stringify({ success: true, data: result }));
                        } else {
                            console.log('❌ No data found');
                            res.writeHead(404);
                            res.end(JSON.stringify({ error: 'Not found' }));
                        }
                    }
                };

                // Retrieve main data
                gunNode.once((mainData) => {
                    if (mainData) {
                        result._ = mainData._;
                        // Remove GUN internal properties
                        delete mainData._;
                        Object.assign(result, mainData);
                    }
                    checkComplete();
                });

                // Retrieve nested data if it exists
                gunNode.get('data').once((dataData) => {
                    if (dataData) {
                        result.data = dataData;
                        // Remove GUN internal properties
                        delete result.data._;
                    }
                    checkComplete();
                });

                // Retrieve nested meta if it exists
                gunNode.get('meta').once((metaData) => {
                    if (metaData) {
                        result.meta = metaData;
                        // Remove GUN internal properties
                        delete result.meta._;
                    }
                    checkComplete();
                });

                // Retrieve nested oip if it exists
                gunNode.get('oip').once((oipData) => {
                    if (oipData) {
                        result.oip = oipData;
                        // Remove GUN internal properties
                        delete result.oip._;
                    }
                    checkComplete();
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

                const respond = (records) => {
                    let filtered = records;
                    if (recordType) {
                        filtered = filtered.filter(r => (r?.recordType || r?.data?.oip?.recordType) === recordType);
                    }
                    const paged = filtered.slice(offset, offset + limit);
                    res.writeHead(200);
                    res.end(JSON.stringify({ success: true, records: paged }));
                };

                const mem = publisherIndex.get(publisherHash) || [];
                if (mem.length > 0) {
                    return respond(mem);
                }

                // Fallback: hydrate from GUN persistent index
                try {
                    gun.get(`index:${publisherHash}`).once((idx) => {
                        if (!idx || typeof idx !== 'object') {
                            return respond([]);
                        }
                        const souls = Object.keys(idx).filter(k => k && k !== '_' );
                        if (souls.length === 0) {
                            return respond([]);
                        }
                        const collected = [];
                        let pending = souls.length;
                        souls.forEach((soul) => {
                            gun.get(soul).once((data) => {
                                if (data) {
                                    collected.push({ soul, data, recordType: data?.oip?.recordType || null, storedAt: idx[soul]?.storedAt || Date.now() });
                                }
                                if (--pending === 0) {
                                    // Cache hydrated results in memory
                                    publisherIndex.set(publisherHash, collected);
                                    respond(collected);
                                }
                            });
                        });
                    });
                } catch (e) {
                    console.warn('⚠️ Failed to hydrate index from GUN:', e.message);
                    respond([]);
                }

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
        console.log('📁 Media endpoints: /media/manifest (POST/GET), /media/presence (POST)');
        
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
