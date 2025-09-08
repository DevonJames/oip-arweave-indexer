/**
 * Simple WebRTC Signaling Server for ALFRED Voice Agent
 * 
 * This server provides WebRTC signaling between clients and coordinates
 * with the unified voice processor for audio processing.
 * 
 * Note: This is a pure signaling server - WebRTC peer connections
 * are handled entirely in the browser.
 */

const WebSocket = require('ws');
const EventEmitter = require('events');
const axios = require('axios');

class SimpleWebRTCSignaling extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.config = {
            port: options.port || 3002,
            backendUrl: options.backendUrl || 'https://api.oip.onl',
            unifiedProcessorUrl: options.unifiedProcessorUrl || 'http://localhost:8015',
            maxConnections: options.maxConnections || 10,
            ...options
        };
        
        // Server state
        this.wsServer = null;
        this.clients = new Map(); // clientId -> client info
        this.isRunning = false;
        
        // Metrics
        this.metrics = {
            connectionsTotal: 0,
            connectionsCurrent: 0,
            messagesProcessed: 0,
            errorsEncountered: 0
        };
    }

    /**
     * Start the signaling server
     */
    async start() {
        try {
            console.log(`[SimpleSignaling] Starting WebRTC signaling server on port ${this.config.port}...`);
            
            // Create WebSocket server
            this.wsServer = new WebSocket.Server({
                port: this.config.port,
                perMessageDeflate: false
            });
            
            // Setup event handlers
            this.setupWebSocketHandlers();
            
            this.isRunning = true;
            console.log(`[SimpleSignaling] ✅ WebRTC signaling server started successfully`);
            
        } catch (error) {
            console.error('[SimpleSignaling] Failed to start server:', error);
            throw error;
        }
    }

    /**
     * Setup WebSocket event handlers
     */
    setupWebSocketHandlers() {
        this.wsServer.on('connection', (ws, req) => {
            const clientId = this.generateClientId();
            console.log(`[SimpleSignaling] New client connected: ${clientId}`);
            
            // Check connection limits
            if (this.clients.size >= this.config.maxConnections) {
                console.warn(`[SimpleSignaling] Connection limit reached, rejecting ${clientId}`);
                ws.close(1013, 'Server overloaded');
                return;
            }
            
            // Store client info
            const clientInfo = {
                id: clientId,
                ws: ws,
                connectedAt: Date.now(),
                lastActivity: Date.now(),
                metrics: {
                    messagesReceived: 0,
                    messagesSent: 0,
                    errorsEncountered: 0
                }
            };
            
            this.clients.set(clientId, clientInfo);
            this.metrics.connectionsTotal++;
            this.metrics.connectionsCurrent = this.clients.size;
            
            // Setup client handlers
            this.setupClientHandlers(clientId, ws);
            
            // Send welcome message
            this.sendToClient(clientId, {
                type: 'connected',
                clientId: clientId,
                timestamp: Date.now(),
                serverInfo: {
                    version: '5.0.0',
                    features: ['webrtc_signaling', 'unified_processing'],
                    unifiedProcessorUrl: this.config.unifiedProcessorUrl
                }
            });
        });
        
        this.wsServer.on('error', (error) => {
            console.error('[SimpleSignaling] WebSocket server error:', error);
            this.emit('error', error);
        });
    }

    /**
     * Setup handlers for specific client
     */
    setupClientHandlers(clientId, ws) {
        ws.on('message', async (data) => {
            try {
                const client = this.clients.get(clientId);
                if (client) {
                    client.lastActivity = Date.now();
                    client.metrics.messagesReceived++;
                }
                
                const message = JSON.parse(data.toString());
                await this.handleClientMessage(clientId, message);
                
                this.metrics.messagesProcessed++;
                
            } catch (error) {
                console.error(`[SimpleSignaling] Failed to handle message from ${clientId}:`, error);
                this.handleClientError(clientId, error);
            }
        });
        
        ws.on('close', () => {
            console.log(`[SimpleSignaling] Client disconnected: ${clientId}`);
            this.handleClientDisconnect(clientId);
        });
        
        ws.on('error', (error) => {
            console.error(`[SimpleSignaling] Client ${clientId} error:`, error);
            this.handleClientError(clientId, error);
        });
    }

    /**
     * Handle client messages
     */
    async handleClientMessage(clientId, message) {
        console.log(`[SimpleSignaling] ${message.type} from ${clientId}`);
        
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
                
            case 'transcription':
                await this.handleTranscription(clientId, message);
                break;
                
            case 'setAgentSpeaking':
                await this.handleSetAgentSpeaking(clientId, message);
                break;
                
            case 'audioFrame':
                await this.handleAudioFrame(clientId, message);
                break;
                
            case 'ping':
                this.sendToClient(clientId, {
                    type: 'pong',
                    timestamp: Date.now(),
                    serverLoad: await this.getServerLoad()
                });
                break;
                
            default:
                console.warn(`[SimpleSignaling] Unknown message type: ${message.type}`);
        }
    }

    /**
     * Handle WebRTC offer from client
     */
    async handleWebRTCOffer(clientId, message) {
        try {
            console.log(`[SimpleSignaling] Handling WebRTC offer from ${clientId}`);
            
            // For a signaling server, we just need to acknowledge the offer
            // The actual peer connection is established between browser and browser
            // or in this case, we'll send back a simple answer
            
            this.sendToClient(clientId, {
                type: 'answer',
                answer: {
                    type: 'answer',
                    sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=ice-lite\r\n'
                },
                timestamp: Date.now()
            });
            
            console.log(`[SimpleSignaling] Sent answer to ${clientId}`);
            
        } catch (error) {
            console.error(`[SimpleSignaling] Failed to handle offer from ${clientId}:`, error);
            this.sendToClient(clientId, {
                type: 'error',
                message: 'Failed to handle WebRTC offer'
            });
        }
    }

    /**
     * Handle WebRTC answer from client
     */
    async handleWebRTCAnswer(clientId, message) {
        console.log(`[SimpleSignaling] Received answer from ${clientId}`);
        // In a simple signaling server, we just acknowledge
    }

    /**
     * Handle ICE candidate from client
     */
    async handleIceCandidate(clientId, message) {
        console.log(`[SimpleSignaling] Received ICE candidate from ${clientId}`);
        // In a simple signaling server, we just acknowledge
    }

    /**
     * Handle transcription from client
     */
    async handleTranscription(clientId, message) {
        try {
            console.log(`[SimpleSignaling] Transcription from ${clientId}: "${message.text}"`);
            
            // Send to backend for LLM/RAG processing
            const response = await axios.post(`${this.config.backendUrl}/api/voice/rag`, {
                text: message.text,
                model: 'llama3.2:3b',
                clientId: clientId,
                timestamp: message.timestamp
            }, {
                timeout: 30000
            });
            
            // Send response back to client
            this.sendToClient(clientId, {
                type: 'llm_response',
                text: response.data.answer,
                sources: response.data.sources,
                processingTime: Date.now() - message.timestamp,
                timestamp: Date.now()
            });
            
            // Generate TTS
            await this.generateTTSResponse(clientId, response.data.answer);
            
        } catch (error) {
            console.error(`[SimpleSignaling] Transcription processing error for ${clientId}:`, error);
            this.sendToClient(clientId, {
                type: 'error',
                message: 'Failed to process transcription',
                details: error.message
            });
        }
    }

    /**
     * Generate TTS response
     */
    async generateTTSResponse(clientId, text) {
        try {
            console.log(`[SimpleSignaling] Generating TTS for ${clientId}: "${text.substring(0, 50)}..."`);
            
            // Notify client that TTS is starting
            this.sendToClient(clientId, {
                type: 'ttsStarted',
                text: text,
                canBeInterrupted: true,
                timestamp: Date.now()
            });
            
            // Call backend TTS service
            const response = await axios.post(`${this.config.backendUrl}/api/voice/synthesize`, {
                text: text,
                voice_id: 'en-GB-RyanNeural',
                engine: 'edge_tts',
                speed: 1.0
            }, {
                responseType: 'arraybuffer',
                timeout: 30000
            });
            
            // Send audio to client
            this.sendToClient(clientId, {
                type: 'tts_audio',
                audio: Buffer.from(response.data).toString('base64'),
                timestamp: Date.now()
            });
            
            // Notify completion
            this.sendToClient(clientId, {
                type: 'ttsCompleted',
                timestamp: Date.now()
            });
            
        } catch (error) {
            console.error(`[SimpleSignaling] TTS generation error for ${clientId}:`, error);
            this.sendToClient(clientId, {
                type: 'tts_error',
                message: 'Failed to generate speech',
                details: error.message
            });
        }
    }

    /**
     * Handle agent speaking state update
     */
    async handleSetAgentSpeaking(clientId, message) {
        try {
            // Update unified processor
            await axios.post(`${this.config.unifiedProcessorUrl}/set_speaker_state`, {
                session_id: clientId,
                agent_speaking: message.agentSpeaking
            }, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 2000
            });
            
            this.sendToClient(clientId, {
                type: 'agentSpeakingStateUpdated',
                agentSpeaking: message.agentSpeaking,
                timestamp: Date.now()
            });
            
        } catch (error) {
            console.error(`[SimpleSignaling] Failed to set agent speaking state for ${clientId}:`, error);
        }
    }

    /**
     * Handle audio frame processing
     */
    async handleAudioFrame(clientId, message) {
        try {
            // Forward to unified processor
            const FormData = require('form-data');
            const formData = new FormData();
            
            // Convert base64 audio to buffer
            const audioBuffer = Buffer.from(message.audioData, 'base64');
            formData.append('audio_file', audioBuffer, {
                filename: 'frame.wav',
                contentType: 'audio/wav'
            });
            formData.append('session_id', clientId);
            
            const response = await axios.post(
                `${this.config.unifiedProcessorUrl}/process_frame`,
                formData,
                {
                    headers: formData.getHeaders(),
                    timeout: 5000
                }
            );
            
            // Send result back to client
            this.sendToClient(clientId, {
                type: 'frameProcessed',
                result: response.data,
                timestamp: Date.now()
            });
            
        } catch (error) {
            console.error(`[SimpleSignaling] Audio frame processing error for ${clientId}:`, error);
            this.sendToClient(clientId, {
                type: 'frameError',
                error: error.message,
                timestamp: Date.now()
            });
        }
    }

    /**
     * Get server load
     */
    async getServerLoad() {
        try {
            const response = await axios.get(`${this.config.unifiedProcessorUrl}/pipeline/status`, {
                timeout: 2000
            });
            
            return response.data.pipelineState?.processingLoad || 0;
            
        } catch (error) {
            return 0; // Return 0 if can't get load
        }
    }

    /**
     * Send message to client
     */
    sendToClient(clientId, message) {
        const client = this.clients.get(clientId);
        if (client && client.ws.readyState === WebSocket.OPEN) {
            try {
                client.ws.send(JSON.stringify(message));
                client.metrics.messagesSent++;
            } catch (error) {
                console.error(`[SimpleSignaling] Failed to send message to ${clientId}:`, error);
            }
        }
    }

    /**
     * Handle client disconnect
     */
    handleClientDisconnect(clientId) {
        const client = this.clients.get(clientId);
        if (!client) return;
        
        console.log(`[SimpleSignaling] Cleaning up client ${clientId}`);
        
        // Remove client
        this.clients.delete(clientId);
        this.metrics.connectionsCurrent = this.clients.size;
        
        // Cleanup session in unified processor
        this.cleanupProcessorSession(clientId);
        
        this.emit('clientDisconnected', clientId);
    }

    /**
     * Handle client error
     */
    handleClientError(clientId, error) {
        const client = this.clients.get(clientId);
        if (client) {
            client.metrics.errorsEncountered++;
        }
        
        this.metrics.errorsEncountered++;
        
        this.sendToClient(clientId, {
            type: 'error',
            message: error.message,
            timestamp: Date.now()
        });
    }

    /**
     * Cleanup session in unified processor
     */
    async cleanupProcessorSession(clientId) {
        try {
            await axios.delete(`${this.config.unifiedProcessorUrl}/session/${clientId}`, {
                timeout: 2000
            });
            console.log(`[SimpleSignaling] Cleaned up processor session for ${clientId}`);
        } catch (error) {
            console.warn(`[SimpleSignaling] Failed to cleanup processor session for ${clientId}:`, error.message);
        }
    }

    /**
     * Generate unique client ID
     */
    generateClientId() {
        return `client_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    }

    /**
     * Get server status
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            port: this.config.port,
            metrics: this.metrics,
            activeClients: this.clients.size,
            maxConnections: this.config.maxConnections
        };
    }

    /**
     * Stop the server
     */
    async stop() {
        console.log('[SimpleSignaling] Stopping WebRTC signaling server...');
        
        this.isRunning = false;
        
        // Disconnect all clients
        for (const clientId of this.clients.keys()) {
            this.handleClientDisconnect(clientId);
        }
        
        // Close WebSocket server
        if (this.wsServer) {
            this.wsServer.close();
            this.wsServer = null;
        }
        
        console.log('[SimpleSignaling] ✅ WebRTC signaling server stopped');
    }
}

module.exports = SimpleWebRTCSignaling;
