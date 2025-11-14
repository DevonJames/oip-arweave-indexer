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
                        if (!soul) {
                            res.writeHead(400);
                            res.end(JSON.stringify({ error: 'soul parameter required' }));
                            return;
                        }
                        if (!data) {
                            res.writeHead(400);
                            res.end(JSON.stringify({ error: 'data parameter required' }));
                            return;
                        }
                        console.log(`💾 Storing data for soul: ${soul.substring(0, 50)}...`);
                        console.log(`📊 Data structure:`, {
                            hasData: !!data.data,
                            hasOip: !!data.oip,
                            hasMeta: !!data.meta,
                            dataKeys: data.data ? Object.keys(data.data) : [],
                            dataSize: JSON.stringify(data).length
                        });
                        
                        // Sanitize data to remove any circular references or non-serializable values
                        // This helps prevent GUN radisk JSON errors
                        const sanitizeData = (obj, seen = new WeakSet()) => {
                            if (obj === null || typeof obj !== 'object') {
                                return obj;
                            }
                            
                            // Check for circular references
                            if (seen.has(obj)) {
                                return '[Circular]';
                            }
                            seen.add(obj);
                            
                            // Handle arrays
                            if (Array.isArray(obj)) {
                                return obj.map(item => sanitizeData(item, seen));
                            }
                            
                            // Handle objects
                            const sanitized = {};
                            for (const [key, value] of Object.entries(obj)) {
                                // Skip functions and undefined
                                if (typeof value === 'function' || value === undefined) {
                                    continue;
                                }
                                
                                try {
                                    sanitized[key] = sanitizeData(value, seen);
                                } catch (e) {
                                    console.warn(`⚠️ Failed to sanitize key ${key}:`, e.message);
                                    sanitized[key] = '[Error serializing]';
                                }
                            }
                            
                            seen.delete(obj);
                            return sanitized;
                        };
                        
                        const sanitizedData = sanitizeData(data);
                        
                        // Store data incrementally to avoid GUN radisk JSON errors with complex nested structures
                        // GUN radisk has trouble with deeply nested objects, so we store top-level properties separately
                        const gunNode = gun.get(soul);
                        
                        // Track completion of all storage operations
                        let completedOps = 0;
                        let totalOps = 0;
                        let hasError = false;
                        let errorMessage = null;
                        
                        const checkComplete = () => {
                            completedOps++;
                            if (completedOps >= totalOps && !hasError) {
                                console.log('✅ Data stored successfully');
                                
                                // Update publisher index after successful storage
                                try {
                                    // Maintain a simple in-memory index by publisher hash prefix
                                    // Expected soul format: "<publisherHash>:<rest>"
                                    const prefix = String(soul).split(':')[0];
                                    if (prefix && prefix.length > 0) {
                                        const list = publisherIndex.get(prefix) || [];
                                        // Upsert by soul
                                        const existingIndex = list.findIndex(r => r.soul === soul);
                                        const recordType = sanitizedData?.oip?.recordType || sanitizedData?.data?.oip?.recordType || null;
                                        const record = { soul, data: sanitizedData, recordType, storedAt: Date.now() };
                                        if (existingIndex >= 0) list[existingIndex] = record; else list.push(record);
                                        publisherIndex.set(prefix, list);

                                        // Persist minimal index into GUN for restart durability
                                        // Layout: index:<publisherHash> is a map of soul -> { recordType, storedAt }
                                        gun.get(`index:${prefix}`).get(soul).put({ recordType, storedAt: record.storedAt });
                                    }
                                } catch (e) {
                                    console.warn('⚠️ Failed to update in-memory index:', e.message);
                                }
                                
                                setTimeout(() => {
                                    if (!res.headersSent) {
                                        res.writeHead(200);
                                        res.end(JSON.stringify({ success: true, soul }));
                                    }
                                }, 100);
                            } else if (hasError && completedOps >= totalOps) {
                                if (!res.headersSent) {
                                    res.writeHead(500);
                                    res.end(JSON.stringify({ error: errorMessage || 'GUN storage failed', details: 'Failed to store all data properties' }));
                                }
                            }
                        };
                        
                        // Store each top-level property separately to avoid radisk JSON errors
                        if (sanitizedData.data) {
                            totalOps++;
                            gunNode.get('data').put(sanitizedData.data, (ack) => {
                                if (ack && ack.err) {
                                    console.error('❌ Error storing data property:', ack.err);
                                    hasError = true;
                                    errorMessage = ack.err;
                                }
                                checkComplete();
                            });
                        }
                        
                        if (sanitizedData.oip) {
                            totalOps++;
                            gunNode.get('oip').put(sanitizedData.oip, (ack) => {
                                if (ack && ack.err) {
                                    console.error('❌ Error storing oip property:', ack.err);
                                    hasError = true;
                                    errorMessage = ack.err;
                                }
                                checkComplete();
                            });
                        }
                        
                        if (sanitizedData.meta) {
                            totalOps++;
                            gunNode.get('meta').put(sanitizedData.meta, (ack) => {
                                if (ack && ack.err) {
                                    console.error('❌ Error storing meta property:', ack.err);
                                    hasError = true;
                                    errorMessage = ack.err;
                                }
                                checkComplete();
                            });
                        }
                        
                        // If no properties to store, send success immediately
                        if (totalOps === 0) {
                            console.log('⚠️ No data properties to store');
                            res.writeHead(400);
                            res.end(JSON.stringify({ error: 'No data properties found' }));
                            return;
                        }
                        
                        // Note: Removed bulk put fallback - incremental storage is the primary method
                        // Bulk put was causing GUN radisk JSON errors with nested structures
                    } catch (parseError) {
                        console.error('❌ JSON parse error:', parseError);
                        if (!res.headersSent) {
                            res.writeHead(400);
                            res.end(JSON.stringify({ error: 'Invalid JSON: ' + parseError.message }));
                        }
                    }
                });
                
                // Handle request errors
                req.on('error', (error) => {
                    console.error('❌ Request error:', error);
                    if (!res.headersSent) {
                        res.writeHead(500);
                        res.end(JSON.stringify({ error: 'Request error: ' + error.message }));
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
                let hasChildren = false;

                const checkComplete = () => {
                    if (--pending === 0 && !completed) {
                        completed = true;
                        // Check if this is a parent node with children (registry indexes)
                        // If no data/meta/oip but has other properties, it's likely a parent node
                        if (Object.keys(result).length > 0) {
                            console.log('✅ Data retrieved successfully');
                            res.writeHead(200);
                            res.end(JSON.stringify({ success: true, data: result }));
                        } else if (hasChildren) {
                            // Parent node with children but no data/meta/oip - return children
                            console.log('✅ Parent node with children retrieved');
                            res.writeHead(200);
                            res.end(JSON.stringify({ success: true, data: result }));
                        } else {
                            console.log('❌ No data found');
                            res.writeHead(404);
                            res.end(JSON.stringify({ error: 'Not found' }));
                        }
                    }
                };

                // Retrieve main data - handle both regular records and parent nodes with children
                gunNode.once((mainData) => {
                    if (mainData) {
                        result._ = mainData._;
                        // Remove GUN internal properties
                        const gunInternalProps = ['_', '#', '>', '<'];
                        
                        // Collect all properties including potential child references
                        const allKeys = Object.keys(mainData);
                        const childPromises = [];
                        
                        allKeys.forEach(key => {
                            if (!gunInternalProps.includes(key)) {
                                const value = mainData[key];
                                
                                // Check if this looks like a child node reference (object with # property)
                                if (typeof value === 'object' && value !== null && value['#']) {
                                    // This is a GUN node reference - fetch the actual child data
                                    hasChildren = true;
                                    const childSoul = value['#'];
                                    const childPromise = new Promise((resolve) => {
                                        gun.get(childSoul).once((childData) => {
                                            if (childData && typeof childData === 'object') {
                                                const cleanChild = {};
                                                Object.keys(childData).forEach(childKey => {
                                                    if (!gunInternalProps.includes(childKey)) {
                                                        cleanChild[childKey] = childData[childKey];
                                                    }
                                                });
                                                if (Object.keys(cleanChild).length > 0) {
                                                    result[key] = cleanChild;
                                                }
                                            }
                                            resolve();
                                        });
                                    });
                                    childPromises.push(childPromise);
                                } else if (value !== null && value !== undefined) {
                                    // Direct property value
                                    result[key] = value;
                                }
                            }
                        });
                        
                        // Wait for all child nodes to load before completing
                        if (childPromises.length > 0) {
                            Promise.all(childPromises).then(() => {
                                checkComplete();
                            });
                        } else {
                            checkComplete();
                        }
                    } else {
                        checkComplete();
                    }
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
    // Configure peers from environment variable (for multi-node sync)
    const gunPeers = process.env.GUN_PEERS ? process.env.GUN_PEERS.split(',').map(p => p.trim()).filter(p => p) : [];
    
    const gunConfig = {
        web: server,
        radisk: true,
        file: 'data',
        localStorage: false,
        multicast: false
    };
    
    // Add peers if configured (for cross-node synchronization)
    if (gunPeers.length > 0) {
        gunConfig.peers = gunPeers;
        console.log(`🌐 GUN peers configured: ${gunPeers.join(', ')}`);
    }
    
    const gun = Gun(gunConfig);
    
    server.listen(8765, '0.0.0.0', () => {
        console.log('✅ GUN HTTP API server running on 0.0.0.0:8765');
        console.log('💾 Local GUN database with persistent storage');
        console.log('🌐 HTTP API endpoints: /put (POST), /get (GET), /list (GET)');
        console.log('📁 Media endpoints: /media/manifest (POST/GET), /media/presence (POST)');
        if (gunPeers.length > 0) {
            console.log(`🔗 Connected to ${gunPeers.length} external peer(s) for synchronization`);
        } else {
            console.log('📡 Single-node mode: No external peers configured (set GUN_EXTERNAL_PEERS to enable sync)');
        }
        
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
