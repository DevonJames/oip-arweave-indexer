/**
 * Unified WebRTC Server for ALFRED Voice Agent Phase 4
 * 
 * This server integrates the unified pipeline coordinator with WebRTC
 * signaling to provide optimized, single-process voice processing.
 * 
 * Key Features:
 * - Single coordinated pipeline for all processing
 * - Optimized resource utilization
 * - Centralized performance monitoring
 * - Graceful degradation under load
 * - Advanced session management
 */

const WebSocket = require('ws');
const EventEmitter = require('events');
const axios = require('axios');
const UnifiedPipelineCoordinator = require('./unified_pipeline_coordinator');

class UnifiedWebRTCServer extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.config = {
            port: options.port || 3003,
            backendUrl: options.backendUrl || 'https://api.oip.onl',
            unifiedProcessorUrl: options.unifiedProcessorUrl || 'http://localhost:8015',
            maxConnections: options.maxConnections || 10,
            connectionTimeout: options.connectionTimeout || 30000,
            performanceMonitoring: options.performanceMonitoring !== false,
            ...options
        };
        
        // Server components
        this.wsServer = null;
        this.connections = new Map(); // clientId -> connection info
        this.peerConnections = new Map(); // clientId -> RTCPeerConnection
        
        // Unified pipeline
        this.pipelineCoordinator = new UnifiedPipelineCoordinator({
            unifiedProcessorUrl: this.config.unifiedProcessorUrl,
            backendUrl: this.config.backendUrl
        });
        
        // Performance monitoring
        this.serverMetrics = {
            connectionsTotal: 0,
            connectionsCurrent: 0,
            messagesProcessed: 0,
            errorsEncountered: 0,
            uptimeStart: Date.now()
        };
        
        this.isRunning = false;
    }

    /**
     * Start the unified WebRTC server
     */
    async start() {
        try {
            console.log(`[UnifiedWebRTC] Starting Unified WebRTC Server on port ${this.config.port}...`);
            
            // Initialize unified pipeline
            await this.pipelineCoordinator.initialize();
            
            // Create WebSocket server for signaling
            this.wsServer = new WebSocket.Server({
                port: this.config.port,
                perMessageDeflate: false
            });
            
            // Setup WebSocket handlers
            this.setupWebSocketHandlers();
            
            // Setup pipeline event handlers
            this.setupPipelineEventHandlers();
            
            // Start performance monitoring
            if (this.config.performanceMonitoring) {
                this.startPerformanceMonitoring();
            }
            
            this.isRunning = true;
            console.log(`[UnifiedWebRTC] ✅ Unified WebRTC Server started successfully`);
            
        } catch (error) {
            console.error('[UnifiedWebRTC] Failed to start server:', error);
            throw error;
        }
    }

    /**
     * Setup WebSocket event handlers
     */
    setupWebSocketHandlers() {
        this.wsServer.on('connection', (ws, req) => {
            const clientId = this.generateClientId();
            console.log(`[UnifiedWebRTC] New client connected: ${clientId}`);
            
            // Check connection limits
            if (this.connections.size >= this.config.maxConnections) {
                console.warn(`[UnifiedWebRTC] Connection limit reached, rejecting ${clientId}`);
                ws.close(1013, 'Server overloaded');
                return;
            }
            
            // Create connection info
            const connectionInfo = {
                id: clientId,
                ws: ws,
                peerConnection: null,
                connectedAt: Date.now(),
                lastActivity: Date.now(),
                metrics: {
                    messagesReceived: 0,
                    messagesSent: 0,
                    errorsEncountered: 0
                }
            };
            
            this.connections.set(clientId, connectionInfo);
            this.serverMetrics.connectionsTotal++;
            this.serverMetrics.connectionsCurrent = this.connections.size;
            
            // Setup client handlers
            this.setupClientHandlers(clientId, ws);
            
            // Create session in unified pipeline
            this.createPipelineSession(clientId);
            
            // Send welcome message
            this.sendToClient(clientId, {
                type: 'connected',
                clientId: clientId,
                serverVersion: '4.0.0',
                features: ['unified_pipeline', 'real_time_interruption', 'optimized_performance'],
                timestamp: Date.now()
            });
        });
        
        this.wsServer.on('error', (error) => {
            console.error('[UnifiedWebRTC] WebSocket server error:', error);
            this.emit('error', error);
        });
    }

    /**
     * Setup pipeline event handlers
     */
    setupPipelineEventHandlers() {
        // Session events
        this.pipelineCoordinator.on('sessionEvent', (event) => {
            this.sendToClient(event.sessionId, {
                type: event.type,
                data: event.data,
                timestamp: Date.now()
            });
        });
        
        // Performance events
        this.pipelineCoordinator.on('pipelineHealthUpdate', (data) => {
            this.broadcastToAllClients({
                type: 'pipelineHealth',
                health: data.state.health,
                processingLoad: data.state.processingLoad,
                timestamp: data.timestamp
            });
        });
        
        // Backpressure events
        this.pipelineCoordinator.on('backpressureTriggered', (data) => {
            console.warn('[UnifiedWebRTC] Pipeline backpressure triggered');
            this.broadcastToAllClients({
                type: 'performanceWarning',
                message: 'High processing load detected',
                data: data
            });
        });
        
        this.pipelineCoordinator.on('backpressureReleased', (data) => {
            console.log('[UnifiedWebRTC] Pipeline backpressure released');
            this.broadcastToAllClients({
                type: 'performanceRecovered',
                message: 'Processing load normalized',
                data: data
            });
        });
    }

    /**
     * Create session in unified pipeline
     */
    async createPipelineSession(clientId) {
        try {
            await this.pipelineCoordinator.createSession(clientId);
            console.log(`[UnifiedWebRTC] Pipeline session created for ${clientId}`);
        } catch (error) {
            console.error(`[UnifiedWebRTC] Failed to create pipeline session for ${clientId}:`, error);
            this.sendToClient(clientId, {
                type: 'error',
                message: 'Failed to initialize voice processing session'
            });
        }
    }

    /**
     * Setup handlers for specific client
     */
    setupClientHandlers(clientId, ws) {
        ws.on('message', async (data) => {
            try {
                const connection = this.connections.get(clientId);
                if (connection) {
                    connection.lastActivity = Date.now();
                    connection.metrics.messagesReceived++;
                }
                
                const message = JSON.parse(data.toString());
                await this.handleClientMessage(clientId, message);
                
                this.serverMetrics.messagesProcessed++;
                
            } catch (error) {
                console.error(`[UnifiedWebRTC] Failed to handle message from ${clientId}:`, error);
                this.handleClientError(clientId, error);
            }
        });
        
        ws.on('close', () => {
            console.log(`[UnifiedWebRTC] Client disconnected: ${clientId}`);
            this.handleClientDisconnect(clientId);
        });
        
        ws.on('error', (error) => {
            console.error(`[UnifiedWebRTC] Client ${clientId} error:`, error);
            this.handleClientError(clientId, error);
        });
    }

    /**
     * Handle client messages with unified processing
     */
    async handleClientMessage(clientId, message) {
        const connection = this.connections.get(clientId);
        if (!connection) return;
        
        console.log(`[UnifiedWebRTC] ${message.type} from ${clientId}`);
        
        switch (message.type) {
            case 'offer':
                await this.handleWebRTCOffer(clientId, message);
                break;
                
            case 'answer':
                await this.handleWebRTCAnswer(clientId, message);
                break;
                
            case 'ice-candidate':
                await this.handleIceCandidate(clientId, message);
                break;
                
            case 'audioFrame':
                await this.handleAudioFrame(clientId, message);
                break;
                
            case 'transcription':
                await this.handleTranscription(clientId, message);
                break;
                
            case 'setAgentSpeaking':
                await this.handleSetAgentSpeaking(clientId, message);
                break;
                
            case 'getSessionStatus':
                await this.handleGetSessionStatus(clientId, message);
                break;
                
            case 'ping':
                this.sendToClient(clientId, { 
                    type: 'pong', 
                    timestamp: Date.now(),
                    serverLoad: this.pipelineCoordinator.pipelineState.processingLoad
                });
                break;
                
            default:
                console.warn(`[UnifiedWebRTC] Unknown message type: ${message.type}`);
        }
    }

    /**
     * Handle audio frame through unified pipeline
     */
    async handleAudioFrame(clientId, message) {
        try {
            const startTime = Date.now();
            
            // Process through unified pipeline
            const result = await this.pipelineCoordinator.processAudioFrame(
                clientId,
                message.audioData,
                message.timestamp
            );
            
            // Send result back to client
            this.sendToClient(clientId, {
                type: 'frameProcessed',
                result: result,
                processingTime: Date.now() - startTime,
                timestamp: Date.now()
            });
            
        } catch (error) {
            console.error(`[UnifiedWebRTC] Audio frame processing error for ${clientId}:`, error);
            this.sendToClient(clientId, {
                type: 'frameError',
                error: error.message,
                timestamp: Date.now()
            });
        }
    }

    /**
     * Handle agent speaking state update
     */
    async handleSetAgentSpeaking(clientId, message) {
        try {
            await this.pipelineCoordinator.setAgentSpeakingState(
                clientId, 
                message.agentSpeaking
            );
            
            this.sendToClient(clientId, {
                type: 'agentSpeakingStateUpdated',
                agentSpeaking: message.agentSpeaking,
                timestamp: Date.now()
            });
            
        } catch (error) {
            console.error(`[UnifiedWebRTC] Failed to set agent speaking state for ${clientId}:`, error);
        }
    }

    /**
     * Handle session status request
     */
    async handleGetSessionStatus(clientId, message) {
        try {
            const status = this.pipelineCoordinator.getStatus();
            
            this.sendToClient(clientId, {
                type: 'sessionStatus',
                status: status,
                timestamp: Date.now()
            });
            
        } catch (error) {
            console.error(`[UnifiedWebRTC] Failed to get session status for ${clientId}:`, error);
        }
    }

    /**
     * Handle WebRTC offer
     */
    async handleWebRTCOffer(clientId, message) {
        try {
            const connection = this.connections.get(clientId);
            
            // Create peer connection
            const peerConnection = new RTCPeerConnection({
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' }
                ]
            });
            
            connection.peerConnection = peerConnection;
            this.peerConnections.set(clientId, peerConnection);
            
            // Setup peer connection handlers
            this.setupPeerConnectionHandlers(clientId, peerConnection);
            
            // Handle offer
            await peerConnection.setRemoteDescription(message.offer);
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            
            this.sendToClient(clientId, {
                type: 'answer',
                answer: answer
            });
            
            console.log(`[UnifiedWebRTC] WebRTC answer sent to ${clientId}`);
            
        } catch (error) {
            console.error(`[UnifiedWebRTC] Failed to handle offer from ${clientId}:`, error);
            this.sendToClient(clientId, {
                type: 'error',
                message: 'Failed to handle WebRTC offer'
            });
        }
    }

    /**
     * Setup peer connection handlers with unified processing
     */
    setupPeerConnectionHandlers(clientId, peerConnection) {
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendToClient(clientId, {
                    type: 'ice-candidate',
                    candidate: event.candidate
                });
            }
        };
        
        peerConnection.onconnectionstatechange = () => {
            const state = peerConnection.connectionState;
            console.log(`[UnifiedWebRTC] Client ${clientId} connection state: ${state}`);
            
            this.sendToClient(clientId, {
                type: 'connection-state',
                state: state,
                pipelineHealth: this.pipelineCoordinator.pipelineState.health
            });
            
            if (state === 'connected') {
                this.emit('clientConnected', clientId);
            } else if (state === 'disconnected' || state === 'failed') {
                this.handleClientDisconnect(clientId);
            }
        };
        
        // Handle incoming audio tracks
        peerConnection.ontrack = (event) => {
            console.log(`[UnifiedWebRTC] Audio track received from ${clientId}`);
            this.setupUnifiedAudioProcessing(clientId, event.streams[0]);
        };
        
        // Handle data channels
        peerConnection.ondatachannel = (event) => {
            const channel = event.channel;
            console.log(`[UnifiedWebRTC] Data channel opened for ${clientId}: ${channel.label}`);
            
            channel.onmessage = (messageEvent) => {
                this.handleDataChannelMessage(clientId, messageEvent.data);
            };
        };
    }

    /**
     * Setup unified audio processing for client
     */
    setupUnifiedAudioProcessing(clientId, stream) {
        console.log(`[UnifiedWebRTC] Setting up unified audio processing for ${clientId}`);
        
        try {
            // Create audio context for this client
            const AudioContext = global.AudioContext || global.webkitAudioContext;
            if (!AudioContext) {
                console.warn(`[UnifiedWebRTC] AudioContext not available for ${clientId}`);
                return;
            }
            
            const audioContext = new AudioContext({
                sampleRate: 16000,
                latencyHint: 'interactive'
            });
            
            // Create session in pipeline with audio context
            this.pipelineCoordinator.createSession(clientId, audioContext);
            
            // Setup real-time audio processing
            const source = audioContext.createMediaStreamSource(stream);
            
            // Create script processor for frame extraction
            const frameSize = 320; // 20ms at 16kHz
            const scriptProcessor = audioContext.createScriptProcessor(frameSize, 1, 1);
            
            scriptProcessor.onaudioprocess = async (event) => {
                try {
                    const inputBuffer = event.inputBuffer;
                    const inputData = inputBuffer.getChannelData(0);
                    
                    // Process frame through unified pipeline
                    await this.processUnifiedAudioFrame(clientId, inputData);
                    
                } catch (error) {
                    console.error(`[UnifiedWebRTC] Audio frame processing error for ${clientId}:`, error);
                }
            };
            
            // Connect audio processing chain
            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContext.destination);
            
            // Store audio context reference
            const connection = this.connections.get(clientId);
            if (connection) {
                connection.audioContext = audioContext;
                connection.scriptProcessor = scriptProcessor;
            }
            
            console.log(`[UnifiedWebRTC] Unified audio processing setup complete for ${clientId}`);
            
        } catch (error) {
            console.error(`[UnifiedWebRTC] Failed to setup audio processing for ${clientId}:`, error);
        }
    }

    /**
     * Process audio frame through unified pipeline
     */
    async processUnifiedAudioFrame(clientId, audioData) {
        try {
            // Convert Float32Array to Buffer
            const audioBuffer = Buffer.alloc(audioData.length * 2);
            for (let i = 0; i < audioData.length; i++) {
                const sample = Math.max(-1, Math.min(1, audioData[i]));
                audioBuffer.writeInt16LE(sample * 32767, i * 2);
            }
            
            // Process through unified pipeline coordinator
            const result = await this.pipelineCoordinator.processAudioFrame(
                clientId,
                audioBuffer,
                Date.now()
            );
            
            // The result will be sent to client via pipeline events
            // No need to send here as the pipeline coordinator handles it
            
        } catch (error) {
            console.error(`[UnifiedWebRTC] Unified frame processing error for ${clientId}:`, error);
        }
    }

    /**
     * Handle client disconnect with unified cleanup
     */
    async handleClientDisconnect(clientId) {
        const connection = this.connections.get(clientId);
        if (!connection) return;
        
        console.log(`[UnifiedWebRTC] Cleaning up unified client ${clientId}`);
        
        try {
            // Cleanup audio processing
            if (connection.audioContext && connection.audioContext.state !== 'closed') {
                await connection.audioContext.close();
            }
            
            if (connection.scriptProcessor) {
                connection.scriptProcessor.disconnect();
            }
            
            // Remove session from unified pipeline
            await this.pipelineCoordinator.removeSession(clientId);
            
            // Close peer connection
            if (connection.peerConnection) {
                connection.peerConnection.close();
                this.peerConnections.delete(clientId);
            }
            
            // Remove connection
            this.connections.delete(clientId);
            this.serverMetrics.connectionsCurrent = this.connections.size;
            
            this.emit('clientDisconnected', clientId);
            
        } catch (error) {
            console.error(`[UnifiedWebRTC] Error during client cleanup for ${clientId}:`, error);
        }
    }

    /**
     * Handle client errors
     */
    handleClientError(clientId, error) {
        const connection = this.connections.get(clientId);
        if (connection) {
            connection.metrics.errorsEncountered++;
        }
        
        this.serverMetrics.errorsEncountered++;
        
        this.sendToClient(clientId, {
            type: 'error',
            message: error.message,
            timestamp: Date.now()
        });
    }

    /**
     * Send message to specific client
     */
    sendToClient(clientId, message) {
        const connection = this.connections.get(clientId);
        if (connection && connection.ws.readyState === WebSocket.OPEN) {
            try {
                connection.ws.send(JSON.stringify(message));
                connection.metrics.messagesSent++;
            } catch (error) {
                console.error(`[UnifiedWebRTC] Failed to send message to ${clientId}:`, error);
            }
        }
    }

    /**
     * Broadcast message to all clients
     */
    broadcastToAllClients(message) {
        for (const clientId of this.connections.keys()) {
            this.sendToClient(clientId, message);
        }
    }

    /**
     * Start performance monitoring
     */
    startPerformanceMonitoring() {
        console.log('[UnifiedWebRTC] Starting performance monitoring...');
        
        setInterval(() => {
            this.collectServerMetrics();
        }, 5000);  // Every 5 seconds
        
        setInterval(() => {
            this.optimizePerformance();
        }, 30000);  // Every 30 seconds
    }

    /**
     * Collect server performance metrics
     */
    async collectServerMetrics() {
        try {
            const pipelineStatus = this.pipelineCoordinator.getStatus();
            
            const serverMetrics = {
                server: {
                    ...this.serverMetrics,
                    uptime: Date.now() - this.serverMetrics.uptimeStart,
                    memoryUsage: process.memoryUsage(),
                    cpuUsage: process.cpuUsage()
                },
                pipeline: pipelineStatus,
                connections: Array.from(this.connections.entries()).map(([id, conn]) => ({
                    id,
                    connectedAt: conn.connectedAt,
                    lastActivity: conn.lastActivity,
                    metrics: conn.metrics
                }))
            };
            
            this.emit('metricsCollected', serverMetrics);
            
            // Broadcast health status to clients
            this.broadcastToAllClients({
                type: 'serverMetrics',
                health: pipelineStatus.pipelineState.health,
                load: pipelineStatus.pipelineState.processingLoad,
                sessions: pipelineStatus.pipelineState.sessionsActive,
                timestamp: Date.now()
            });
            
        } catch (error) {
            console.error('[UnifiedWebRTC] Metrics collection error:', error);
        }
    }

    /**
     * Optimize performance based on current load
     */
    optimizePerformance() {
        const pipelineState = this.pipelineCoordinator.pipelineState;
        
        if (pipelineState.health === 'overloaded') {
            console.warn('[UnifiedWebRTC] Pipeline overloaded, applying optimizations...');
            
            // Reduce connection limits temporarily
            this.config.maxConnections = Math.max(2, this.config.maxConnections - 1);
            
            // Increase processing timeouts
            this.config.frameProcessingTimeout = 50;  // Increase from 20ms to 50ms
            
        } else if (pipelineState.health === 'healthy') {
            // Restore normal limits
            this.config.maxConnections = Math.min(10, this.config.maxConnections + 1);
            this.config.frameProcessingTimeout = 20;  // Back to 20ms
        }
    }

    /**
     * Generate unique client ID
     */
    generateClientId() {
        return `unified_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    }

    /**
     * Get server status
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            port: this.config.port,
            serverMetrics: this.serverMetrics,
            pipelineStatus: this.pipelineCoordinator.getStatus(),
            connections: this.connections.size,
            maxConnections: this.config.maxConnections
        };
    }

    /**
     * Stop the unified server
     */
    async stop() {
        console.log('[UnifiedWebRTC] Stopping Unified WebRTC Server...');
        
        this.isRunning = false;
        
        // Disconnect all clients
        for (const clientId of this.connections.keys()) {
            await this.handleClientDisconnect(clientId);
        }
        
        // Shutdown unified pipeline
        await this.pipelineCoordinator.shutdown();
        
        // Close WebSocket server
        if (this.wsServer) {
            this.wsServer.close();
            this.wsServer = null;
        }
        
        console.log('[UnifiedWebRTC] ✅ Unified WebRTC Server stopped');
    }
}

module.exports = UnifiedWebRTCServer;
