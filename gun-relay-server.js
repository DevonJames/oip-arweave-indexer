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

                                // Skip nested property setting for parent registry indexes to avoid nested paths
                                // Parent registry indexes (like 'oip:registry:index:image') should be stored flat
                                // Child entries (like 'oip:registry:index:image:647f79c2a338:image008') are fine with nesting
                                const isParentRegistryIndex = soul.startsWith('oip:registry:index:') && 
                                                              soul.split(':').length === 4; // Exactly 4 parts: oip:registry:index:image
                                
                                if (!isParentRegistryIndex) {
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

                // Check if this is a parent registry index (should be stored flat, not wrapped)
                const isParentRegistryIndex = soul.startsWith('oip:registry:index:') && 
                                              soul.split(':').length === 4;

                // Retrieve the complete data structure including nested properties
                const gunNode = gun.get(soul);
                const result = {};

                // Use a counter to track when all properties are loaded
                let pending = isParentRegistryIndex ? 1 : 3; // For parent indexes, only check main data
                let completed = false;
                let hasChildren = false;

                const checkComplete = () => {
                    if (--pending === 0 && !completed) {
                        completed = true;
                        // For parent registry indexes, return the data directly (it's stored flat)
                        if (isParentRegistryIndex) {
                            // Remove GUN internal properties
                            const gunInternalProps = ['_', '#', '>', '<'];
                            const cleanResult = {};
                            Object.keys(result).forEach(key => {
                                if (!gunInternalProps.includes(key)) {
                                    cleanResult[key] = result[key];
                                }
                            });
                            if (Object.keys(cleanResult).length > 0) {
                                console.log('✅ Parent registry index retrieved successfully');
                                res.writeHead(200);
                                res.end(JSON.stringify({ success: true, data: cleanResult }));
                            } else {
                                console.log('❌ No data found');
                                res.writeHead(404);
                                res.end(JSON.stringify({ error: 'Not found' }));
                            }
                        } else {
                            // Regular records: check if this is a parent node with children (registry indexes)
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
                    }
                };

                // Retrieve main data - handle both regular records and parent nodes with children
                // IMPORTANT: Use .on() instead of .once() to trigger peer synchronization
                // .once() only reads local data, .on() actively requests from peers
                let onceReceived = false;
                const gunSubscription = gunNode.on((mainData) => {
                    if (onceReceived || !mainData) return;
                    onceReceived = true;
                    
                    // Unsubscribe after first data to prevent memory leaks
                    if (gunSubscription && gunSubscription.off) {
                        gunSubscription.off();
                    }
                    
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
                                
                                // Handle nested paths like 'oip:registry:index:image/data/647f79c2a338:image008'
                                // GUN stores these as separate nodes, so we need to fetch them directly
                                const childPromise = new Promise((resolve) => {
                                    let childOnceReceived = false;
                                    const childSubscription = gun.get(childSoul).on((childData) => {
                                        if (childOnceReceived || !childData) return;
                                        childOnceReceived = true;
                                        
                                        if (childSubscription && childSubscription.off) {
                                            childSubscription.off();
                                        }
                                        
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
                                    
                                    // Timeout for child fetch
                                    setTimeout(() => {
                                        if (!childOnceReceived) {
                                            childOnceReceived = true;
                                            if (childSubscription && childSubscription.off) {
                                                childSubscription.off();
                                            }
                                            resolve();
                                        }
                                    }, 2000);
                                });
                                childPromises.push(childPromise);
                            } else if (value !== null && value !== undefined) {
                                // Direct property value
                                result[key] = value;
                            }
                        }
                    });
                    
                    // Special handling for registry indexes: if we have a 'data' property with nested paths,
                    // we need to fetch the actual nested data
                    if (mainData.data && typeof mainData.data === 'object') {
                        // Check if data contains references to nested paths
                        Object.keys(mainData.data).forEach(dataKey => {
                            const dataValue = mainData.data[dataKey];
                            if (typeof dataValue === 'object' && dataValue !== null && dataValue['#']) {
                                hasChildren = true;
                                const nestedPath = dataValue['#'];
                                const nestedPromise = new Promise((resolve) => {
                                    let nestedOnceReceived = false;
                                    const nestedSubscription = gun.get(nestedPath).on((nestedData) => {
                                        if (nestedOnceReceived || !nestedData) return;
                                        nestedOnceReceived = true;
                                        
                                        if (nestedSubscription && nestedSubscription.off) {
                                            nestedSubscription.off();
                                        }
                                        
                                        if (nestedData && typeof nestedData === 'object') {
                                            // Extract actual data from nested node
                                            const cleanNested = {};
                                            Object.keys(nestedData).forEach(nestedKey => {
                                                if (!gunInternalProps.includes(nestedKey)) {
                                                    cleanNested[nestedKey] = nestedData[nestedKey];
                                                }
                                            });
                                            if (Object.keys(cleanNested).length > 0) {
                                                if (!result.data) result.data = {};
                                                result.data[dataKey] = cleanNested;
                                            }
                                        }
                                        resolve();
                                    });
                                    
                                    setTimeout(() => {
                                        if (!nestedOnceReceived) {
                                            nestedOnceReceived = true;
                                            if (nestedSubscription && nestedSubscription.off) {
                                                nestedSubscription.off();
                                            }
                                            resolve();
                                        }
                                    }, 2000);
                                });
                                childPromises.push(nestedPromise);
                            }
                        });
                    }
                    
                    // Wait for all child nodes to load before completing
                    if (childPromises.length > 0) {
                        Promise.all(childPromises).then(() => {
                            checkComplete();
                        });
                    } else {
                        checkComplete();
                    }
                });
                
                // Set timeout for main data fetch (in case no data exists or peers are slow)
                setTimeout(() => {
                    if (!onceReceived) {
                        onceReceived = true;
                        if (gunSubscription && gunSubscription.off) {
                            gunSubscription.off();
                        }
                        checkComplete();
                    }
                }, 3000); // 3 second timeout to allow peer sync

                // For parent registry indexes, skip nested data/meta/oip retrieval (stored flat)
                if (!isParentRegistryIndex) {
                    // Retrieve nested data if it exists - use .on() to trigger peer sync
                    let dataReceived = false;
                    const dataSubscription = gunNode.get('data').on((dataData) => {
                        if (dataReceived) return;
                        dataReceived = true;
                        if (dataSubscription && dataSubscription.off) {
                            dataSubscription.off();
                        }
                        if (dataData) {
                            result.data = dataData;
                            // Remove GUN internal properties
                            delete result.data._;
                        }
                        checkComplete();
                    });
                    setTimeout(() => {
                        if (!dataReceived) {
                            dataReceived = true;
                            if (dataSubscription && dataSubscription.off) {
                                dataSubscription.off();
                            }
                            checkComplete();
                        }
                    }, 2000);

                    // Retrieve nested meta if it exists - use .on() to trigger peer sync
                    let metaReceived = false;
                    const metaSubscription = gunNode.get('meta').on((metaData) => {
                        if (metaReceived) return;
                        metaReceived = true;
                        if (metaSubscription && metaSubscription.off) {
                            metaSubscription.off();
                        }
                        if (metaData) {
                            result.meta = metaData;
                            // Remove GUN internal properties
                            delete result.meta._;
                        }
                        checkComplete();
                    });
                    setTimeout(() => {
                        if (!metaReceived) {
                            metaReceived = true;
                            if (metaSubscription && metaSubscription.off) {
                                metaSubscription.off();
                            }
                            checkComplete();
                        }
                    }, 2000);

                    // Retrieve nested oip if it exists - use .on() to trigger peer sync
                    let oipReceived = false;
                    const oipSubscription = gunNode.get('oip').on((oipData) => {
                        if (oipReceived) return;
                        oipReceived = true;
                        if (oipSubscription && oipSubscription.off) {
                            oipSubscription.off();
                        }
                        if (oipData) {
                            result.oip = oipData;
                            // Remove GUN internal properties
                            delete result.oip._;
                        }
                        checkComplete();
                    });
                    setTimeout(() => {
                        if (!oipReceived) {
                            oipReceived = true;
                            if (oipSubscription && oipSubscription.off) {
                                oipSubscription.off();
                            }
                            checkComplete();
                        }
                    }, 2000);
                }
                
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
    
    // Monitor peer connections (GUN doesn't provide direct connection status, but we can log sync events)
    if (gunPeers.length > 0) {
        // Try to verify peer connectivity by attempting to read from a known peer
        gunPeers.forEach((peerUrl, index) => {
            setTimeout(() => {
                console.log(`🔍 Testing peer connection: ${peerUrl}`);
                // Try to read a test value from peer to verify connectivity
                gun.get('test:peer:connectivity').once((data) => {
                    if (data) {
                        console.log(`✅ Peer ${peerUrl} is reachable`);
                    } else {
                        console.log(`⚠️ Peer ${peerUrl} - no data yet (may need time to connect)`);
                    }
                });
            }, 2000 + (index * 1000));
        });
    }
    
    server.listen(8765, '0.0.0.0', () => {
        console.log('✅ GUN HTTP API server running on 0.0.0.0:8765');
        console.log('💾 Local GUN database with persistent storage');
        console.log('🌐 HTTP API endpoints: /put (POST), /get (GET), /list (GET)');
        console.log('📁 Media endpoints: /media/manifest (POST/GET), /media/presence (POST)');
        if (gunPeers.length > 0) {
            console.log(`🔗 Configured ${gunPeers.length} external peer(s) for synchronization: ${gunPeers.join(', ')}`);
            console.log(`⚠️ Note: GUN WebSocket sync happens automatically when data is accessed, not proactively`);
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
