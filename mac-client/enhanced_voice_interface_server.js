#!/usr/bin/env node
/**
 * Enhanced Mac Voice Interface Server with WebRTC Support
 * 
 * This server integrates WebRTC capabilities alongside the existing
 * voice interface, providing both traditional and real-time communication paths.
 */

const express = require('express');
const path = require('path');
const cors = require('cors');
const { createServer } = require('http');
const MacClientCoordinator = require('./mac_client_coordinator');
const SimpleWebRTCSignaling = require('./simple_webrtc_signaling');

class EnhancedVoiceInterfaceServer {
    constructor() {
        this.app = express();
        this.server = null;
        this.coordinator = new MacClientCoordinator();
        this.webrtcSignaling = null;
        
        // Configuration
        this.config = {
            interfacePort: process.env.INTERFACE_PORT || 3001,
            webrtcPort: process.env.WEBRTC_PORT || 3002,
            backendUrl: process.env.BACKEND_URL || 'https://api.oip.onl',
            sttServiceUrl: process.env.STT_SERVICE_URL || 'http://localhost:8013',
            smartTurnServiceUrl: process.env.SMART_TURN_URL || 'http://localhost:8014'
        };
        
        this.setupExpress();
        this.setupRoutes();
    }

    /**
     * Setup Express middleware and configuration
     */
    setupExpress() {
        // Enable CORS and JSON parsing
        this.app.use(cors({
            origin: '*',
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization'],
            credentials: true
        }));
        
        this.app.use(express.json({ limit: '50mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '50mb' }));
        
        // Serve static files
        this.app.use(express.static(__dirname));
        
        // Request logging middleware
        this.app.use((req, res, next) => {
            console.log(`[Interface] ${req.method} ${req.path} - ${new Date().toISOString()}`);
            next();
        });
    }

    /**
     * Setup all routes
     */
    setupRoutes() {
        // Main interface routes
        this.setupMainRoutes();
        
        // WebRTC test routes
        this.setupWebRTCRoutes();
        
        // Legacy voice processing routes
        this.setupLegacyRoutes();
        
        // API proxy routes
        this.setupProxyRoutes();
        
        // Health and status routes
        this.setupHealthRoutes();
    }

    /**
     * Setup main interface routes
     */
    setupMainRoutes() {
        // Serve the main voice interface (legacy)
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'voice_interface.html'));
        });
        
        // Serve WebRTC test interface
        this.app.get('/webrtc', (req, res) => {
            res.sendFile(path.join(__dirname, 'webrtc_test_client.html'));
        });
        
        // Serve enhanced voice interface
        this.app.get('/enhanced', (req, res) => {
            res.sendFile(path.join(__dirname, 'simple_voice_interface.html'));
        });
        
        // Serve Phase 3 interruption test interface
        this.app.get('/interruption', (req, res) => {
            res.sendFile(path.join(__dirname, 'interruption_test_client.html'));
        });
        
        // Serve Phase 4 pipeline monitor
        this.app.get('/monitor', (req, res) => {
            res.sendFile(path.join(__dirname, 'pipeline_monitor.html'));
        });
    }

    /**
     * Setup WebRTC-specific routes
     */
    setupWebRTCRoutes() {
        // WebRTC configuration endpoint
        this.app.get('/api/webrtc/config', (req, res) => {
            res.json({
                signalingUrl: `ws://localhost:${this.config.webrtcPort}`,
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' }
                ],
                audioConstraints: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 16000,
                    channelCount: 1
                }
            });
        });
        
        // WebRTC status endpoint
        this.app.get('/api/webrtc/status', (req, res) => {
            const status = this.webrtcSignaling ? this.webrtcSignaling.getStatus() : {
                isRunning: false,
                connectionCount: 0,
                error: 'WebRTC signaling server not initialized'
            };
            
            res.json(status);
        });
        
        // WebRTC metrics endpoint
        this.app.get('/api/webrtc/metrics', (req, res) => {
            // Will implement detailed metrics in Phase 2
            res.json({
                totalConnections: 0,
                activeConnections: 0,
                averageLatency: 0,
                packetsLost: 0,
                audioQuality: 'unknown'
            });
        });
    }

    /**
     * Setup legacy voice processing routes (maintain compatibility)
     */
    setupLegacyRoutes() {
        // Legacy voice processing endpoint
        this.app.post('/process-voice', async (req, res) => {
            try {
                const { audioData } = req.body;
                
                if (!audioData) {
                    return res.status(400).json({ error: 'No audio data provided' });
                }
                
                // Convert base64 to buffer
                const audioBuffer = Buffer.from(audioData, 'base64');
                
                // Process through coordinator
                const result = await this.coordinator.processAudio(audioBuffer);
                
                res.json(result);
                
            } catch (error) {
                console.error('[Interface] Voice processing error:', error);
                res.status(500).json({
                    error: 'Voice processing failed',
                    message: error.message
                });
            }
        });
        
        // Legacy STT endpoint
        this.app.post('/api/stt', async (req, res) => {
            try {
                const result = await this.coordinator.transcribeAudio(req.body.audioData);
                res.json(result);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        
        // Legacy TTS endpoint
        this.app.post('/api/tts', async (req, res) => {
            try {
                const result = await this.coordinator.synthesizeSpeech(req.body.text);
                res.json(result);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
    }

    /**
     * Setup API proxy routes to backend
     */
    setupProxyRoutes() {
        // Proxy to backend voice API
        this.app.use('/api/backend', async (req, res) => {
            try {
                const axios = require('axios');
                const targetUrl = `${this.config.backendUrl}${req.path}`;
                
                console.log(`[Interface] Proxying ${req.method} ${req.path} to ${targetUrl}`);
                
                const response = await axios({
                    method: req.method,
                    url: targetUrl,
                    data: req.body,
                    headers: {
                        'Content-Type': req.headers['content-type'] || 'application/json',
                        'User-Agent': 'ALFRED-Mac-Client/1.0'
                    },
                    timeout: 30000
                });
                
                res.json(response.data);
                
            } catch (error) {
                console.error('[Interface] Proxy error:', error.message);
                
                if (error.response) {
                    res.status(error.response.status).json(error.response.data);
                } else {
                    res.status(500).json({
                        error: 'Backend proxy failed',
                        message: error.message
                    });
                }
            }
        });
    }

    /**
     * Setup health and status routes
     */
    setupHealthRoutes() {
        // Main health check
        this.app.get('/health', async (req, res) => {
            try {
                const health = await this.coordinator.checkHealth();
                const webrtcHealth = this.webrtcSignaling ? this.webrtcSignaling.getStatus() : { isRunning: false };
                
                res.json({
                    ...health,
                    webrtc: webrtcHealth,
                    interface: {
                        port: this.config.interfacePort,
                        uptime: process.uptime(),
                        memory: process.memoryUsage()
                    }
                });
                
            } catch (error) {
                res.status(500).json({
                    error: 'Health check failed',
                    message: error.message
                });
            }
        });
        
        // Detailed status endpoint
        this.app.get('/api/status', async (req, res) => {
            try {
                const coordinatorHealth = await this.coordinator.checkHealth();
                const webrtcStatus = this.webrtcSignaling ? this.webrtcSignaling.getStatus() : null;
                
                res.json({
                    timestamp: new Date().toISOString(),
                    interface: {
                        port: this.config.interfacePort,
                        uptime: Math.round(process.uptime()),
                        memory: {
                            used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                            total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
                        },
                        pid: process.pid
                    },
                    coordinator: coordinatorHealth,
                    webrtc: webrtcStatus,
                    config: {
                        backendUrl: this.config.backendUrl,
                        sttServiceUrl: this.config.sttServiceUrl,
                        smartTurnServiceUrl: this.config.smartTurnServiceUrl
                    }
                });
                
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        
        // Service-specific health checks
        this.app.get('/api/health/:service', async (req, res) => {
            const { service } = req.params;
            
            try {
                let result;
                
                switch (service) {
                    case 'stt':
                        result = await this.coordinator.checkSTTHealth();
                        break;
                    case 'smart-turn':
                        result = await this.coordinator.checkSmartTurnHealth();
                        break;
                    case 'webrtc':
                        result = this.webrtcSignaling ? this.webrtcSignaling.getStatus() : { error: 'Not initialized' };
                        break;
                    default:
                        return res.status(400).json({ error: 'Unknown service' });
                }
                
                res.json(result);
                
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
    }

    /**
     * Initialize and start the server
     */
    async start() {
        try {
            console.log('[Interface] Starting Enhanced Voice Interface Server...');
            
            // Create HTTP server
            this.server = createServer(this.app);
            
            // Initialize WebRTC signaling server
            console.log('[Interface] Initializing simple WebRTC signaling server...');
            this.webrtcSignaling = new SimpleWebRTCSignaling({
                port: this.config.webrtcPort,
                backendUrl: this.config.backendUrl,
                unifiedProcessorUrl: 'http://localhost:8015'
            });
            
            // Setup WebRTC event handlers
            this.setupWebRTCEventHandlers();
            
            // Start WebRTC signaling server
            await this.webrtcSignaling.start();
            
            // Start main HTTP server
            await new Promise((resolve, reject) => {
                this.server.listen(this.config.interfacePort, (error) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve();
                    }
                });
            });
            
            console.log(`[Interface] ✅ Enhanced Voice Interface Server started successfully`);
            console.log(`[Interface] 🌐 Main interface: http://localhost:${this.config.interfacePort}`);
            console.log(`[Interface] 🎤 WebRTC test: http://localhost:${this.config.interfacePort}/webrtc`);
            console.log(`[Interface] 🚀 Enhanced interface: http://localhost:${this.config.interfacePort}/enhanced`);
            console.log(`[Interface] 📡 WebRTC signaling: ws://localhost:${this.config.webrtcPort}`);
            
        } catch (error) {
            console.error('[Interface] Failed to start server:', error);
            throw error;
        }
    }

    /**
     * Setup WebRTC signaling server event handlers
     */
    setupWebRTCEventHandlers() {
        this.webrtcSignaling.on('clientConnected', (clientId) => {
            console.log(`[Interface] WebRTC client connected: ${clientId}`);
        });
        
        this.webrtcSignaling.on('clientDisconnected', (clientId) => {
            console.log(`[Interface] WebRTC client disconnected: ${clientId}`);
        });
        
        this.webrtcSignaling.on('error', (error) => {
            console.error('[Interface] WebRTC signaling error:', error);
        });
    }

    /**
     * Stop the server
     */
    async stop() {
        console.log('[Interface] Stopping Enhanced Voice Interface Server...');
        
        try {
            // Stop WebRTC signaling server
            if (this.webrtcSignaling) {
                await this.webrtcSignaling.stop();
            }
            
            // Stop HTTP server
            if (this.server) {
                await new Promise((resolve) => {
                    this.server.close(resolve);
                });
            }
            
            console.log('[Interface] ✅ Enhanced Voice Interface Server stopped');
            
        } catch (error) {
            console.error('[Interface] Error stopping server:', error);
        }
    }

    /**
     * Get server status
     */
    getStatus() {
        return {
            interface: {
                port: this.config.interfacePort,
                uptime: Math.round(process.uptime()),
                isRunning: !!this.server
            },
            webrtc: this.webrtcSignaling ? this.webrtcSignaling.getStatus() : { isRunning: false },
            coordinator: this.coordinator ? 'initialized' : 'not initialized'
        };
    }
}

// If run directly, start the server
if (require.main === module) {
    const server = new EnhancedVoiceInterfaceServer();
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n[Interface] Received SIGINT, shutting down gracefully...');
        await server.stop();
        process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
        console.log('\n[Interface] Received SIGTERM, shutting down gracefully...');
        await server.stop();
        process.exit(0);
    });
    
    // Start the server
    server.start().catch((error) => {
        console.error('[Interface] Failed to start server:', error);
        process.exit(1);
    });
}

module.exports = EnhancedVoiceInterfaceServer;
