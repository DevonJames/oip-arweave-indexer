/**
 * WebRTC Signaling Server for ALFRED Voice Agent
 * 
 * This module handles WebRTC signaling between the voice client and backend,
 * enabling real-time audio streaming and text communication.
 * 
 * Key Features:
 * - WebRTC peer connection signaling
 * - Audio stream relay to backend services
 * - Text communication via data channels
 * - Connection management and fallback handling
 */

const WebSocket = require('ws');
const EventEmitter = require('events');
const axios = require('axios');
const ConversationFlowManager = require('./conversation_flow_manager');

class WebRTCSignalingServer extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.config = {
            port: options.port || 3002,
            backendUrl: options.backendUrl || 'https://api.oip.onl',
            sttServiceUrl: options.sttServiceUrl || 'http://localhost:8013',
            smartTurnServiceUrl: options.smartTurnServiceUrl || 'http://localhost:8014',
            maxConnections: options.maxConnections || 10,
            connectionTimeout: options.connectionTimeout || 30000,
            ...options
        };
        
        // Server components
        this.wsServer = null;
        this.connections = new Map(); // clientId -> connection info
        this.peerConnections = new Map(); // clientId -> RTCPeerConnection
        
        // Audio processing
        this.audioProcessors = new Map(); // clientId -> audio processor
        
        // Conversation flow managers
        this.conversationFlows = new Map(); // clientId -> conversation flow manager
        
        // State
        this.isRunning = false;
        this.connectionCount = 0;
    }

    /**
     * Start the signaling server
     */
    async start() {
        try {
            console.log(`[Signaling] Starting WebRTC Signaling Server on port ${this.config.port}...`);
            
            // Create WebSocket server for signaling
            this.wsServer = new WebSocket.Server({
                port: this.config.port,
                perMessageDeflate: false
            });
            
            // Setup WebSocket event handlers
            this.setupWebSocketHandlers();
            
            // Setup periodic cleanup
            this.setupCleanupTimer();
            
            this.isRunning = true;
            console.log(`[Signaling] WebRTC Signaling Server started successfully on port ${this.config.port}`);
            
        } catch (error) {
            console.error('[Signaling] Failed to start signaling server:', error);
            throw error;
        }
    }

    /**
     * Setup WebSocket event handlers
     */
    setupWebSocketHandlers() {
        this.wsServer.on('connection', (ws, req) => {
            const clientId = this.generateClientId();
            console.log(`[Signaling] New client connected: ${clientId}`);
            
            // Store connection info
            const connectionInfo = {
                id: clientId,
                ws: ws,
                peerConnection: null,
                audioProcessor: null,
                connectedAt: Date.now(),
                lastActivity: Date.now()
            };
            
            this.connections.set(clientId, connectionInfo);
            this.connectionCount++;
            
            // Setup WebSocket handlers for this client
            this.setupClientHandlers(clientId, ws);
            
            // Send welcome message
            this.sendToClient(clientId, {
                type: 'connected',
                clientId: clientId,
                timestamp: Date.now()
            });
        });
        
        this.wsServer.on('error', (error) => {
            console.error('[Signaling] WebSocket server error:', error);
            this.emit('error', error);
        });
    }

    /**
     * Setup handlers for a specific client
     */
    setupClientHandlers(clientId, ws) {
        ws.on('message', async (data) => {
            try {
                const message = JSON.parse(data.toString());
                await this.handleClientMessage(clientId, message);
            } catch (error) {
                console.error(`[Signaling] Failed to handle message from ${clientId}:`, error);
                this.sendToClient(clientId, {
                    type: 'error',
                    message: 'Invalid message format'
                });
            }
        });
        
        ws.on('close', () => {
            console.log(`[Signaling] Client disconnected: ${clientId}`);
            this.handleClientDisconnect(clientId);
        });
        
        ws.on('error', (error) => {
            console.error(`[Signaling] Client ${clientId} error:`, error);
            this.handleClientDisconnect(clientId);
        });
        
        // Setup connection timeout
        setTimeout(() => {
            const connection = this.connections.get(clientId);
            if (connection && !connection.peerConnection) {
                console.warn(`[Signaling] Client ${clientId} connection timeout`);
                this.handleClientDisconnect(clientId);
            }
        }, this.config.connectionTimeout);
    }

    /**
     * Handle messages from clients
     */
    async handleClientMessage(clientId, message) {
        const connection = this.connections.get(clientId);
        if (!connection) {
            console.warn(`[Signaling] Message from unknown client: ${clientId}`);
            return;
        }
        
        // Update last activity
        connection.lastActivity = Date.now();
        
        console.log(`[Signaling] Received ${message.type} from ${clientId}`);
        
        switch (message.type) {
            case 'offer':
                await this.handleOffer(clientId, message);
                break;
                
            case 'answer':
                await this.handleAnswer(clientId, message);
                break;
                
            case 'ice-candidate':
                await this.handleIceCandidate(clientId, message);
                break;
                
            case 'transcription':
                await this.handleTranscription(clientId, message);
                break;
                
            case 'interruption':
                await this.handleInterruption(clientId, message);
                break;
                
            case 'ping':
                this.sendToClient(clientId, { type: 'pong', timestamp: Date.now() });
                break;
                
            default:
                console.warn(`[Signaling] Unknown message type: ${message.type}`);
        }
    }

    /**
     * Handle WebRTC offer
     */
    async handleOffer(clientId, message) {
        try {
            const connection = this.connections.get(clientId);
            
            // Note: We don't create RTCPeerConnection on server side
            // WebRTC peer connections are handled entirely in the browser
            // Server only handles signaling messages
            
            connection.peerConnection = peerConnection;
            this.peerConnections.set(clientId, peerConnection);
            
            // Setup peer connection handlers
            this.setupPeerConnectionHandlers(clientId, peerConnection);
            
            // Set remote description (offer)
            await peerConnection.setRemoteDescription(message.offer);
            
            // Create and set local description (answer)
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            
            // Send answer back to client
            this.sendToClient(clientId, {
                type: 'answer',
                answer: answer
            });
            
            console.log(`[Signaling] Sent answer to ${clientId}`);
            
        } catch (error) {
            console.error(`[Signaling] Failed to handle offer from ${clientId}:`, error);
            this.sendToClient(clientId, {
                type: 'error',
                message: 'Failed to handle offer'
            });
        }
    }

    /**
     * Handle WebRTC answer (if server creates offers)
     */
    async handleAnswer(clientId, message) {
        try {
            const peerConnection = this.peerConnections.get(clientId);
            if (peerConnection) {
                await peerConnection.setRemoteDescription(message.answer);
                console.log(`[Signaling] Set remote description for ${clientId}`);
            }
        } catch (error) {
            console.error(`[Signaling] Failed to handle answer from ${clientId}:`, error);
        }
    }

    /**
     * Handle ICE candidates
     */
    async handleIceCandidate(clientId, message) {
        try {
            const peerConnection = this.peerConnections.get(clientId);
            if (peerConnection && message.candidate) {
                await peerConnection.addIceCandidate(message.candidate);
                console.log(`[Signaling] Added ICE candidate for ${clientId}`);
            }
        } catch (error) {
            console.error(`[Signaling] Failed to handle ICE candidate from ${clientId}:`, error);
        }
    }

    /**
     * Setup peer connection event handlers
     */
    setupPeerConnectionHandlers(clientId, peerConnection) {
        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendToClient(clientId, {
                    type: 'ice-candidate',
                    candidate: event.candidate
                });
            }
        };
        
        // Handle connection state changes
        peerConnection.onconnectionstatechange = () => {
            const state = peerConnection.connectionState;
            console.log(`[Signaling] Client ${clientId} connection state: ${state}`);
            
            this.sendToClient(clientId, {
                type: 'connection-state',
                state: state
            });
            
            if (state === 'connected') {
                this.emit('clientConnected', clientId);
            } else if (state === 'disconnected' || state === 'failed') {
                this.handleClientDisconnect(clientId);
            }
        };
        
        // Handle incoming tracks (audio from client)
        peerConnection.ontrack = (event) => {
            console.log(`[Signaling] Received audio track from ${clientId}`);
            this.setupAudioProcessing(clientId, event.streams[0]);
        };
        
        // Handle data channels
        peerConnection.ondatachannel = (event) => {
            const channel = event.channel;
            console.log(`[Signaling] Data channel opened for ${clientId}: ${channel.label}`);
            
            channel.onmessage = (messageEvent) => {
                this.handleDataChannelMessage(clientId, messageEvent.data);
            };
        };
    }

    /**
     * Setup audio processing for incoming stream
     */
    setupAudioProcessing(clientId, stream) {
        console.log(`[Signaling] Setting up audio processing for ${clientId}`);
        
        // Create audio processor
        const audioProcessor = new AudioStreamProcessor(clientId, stream, {
            sttServiceUrl: this.config.sttServiceUrl,
            smartTurnServiceUrl: this.config.smartTurnServiceUrl,
            backendUrl: this.config.backendUrl
        });
        
        // Store processor
        const connection = this.connections.get(clientId);
        connection.audioProcessor = audioProcessor;
        this.audioProcessors.set(clientId, audioProcessor);
        
        // Create conversation flow manager for Phase 3
        const conversationFlow = new ConversationFlowManager({
            backendUrl: this.config.backendUrl,
            interruption: {
                interruptionThreshold: 0.7,
                temporalThreshold: 500,
                crossfadeDuration: 150
            }
        });
        
        // Store conversation flow manager
        connection.conversationFlow = conversationFlow;
        this.conversationFlows.set(clientId, conversationFlow);
        
        // Initialize conversation flow with audio processor
        try {
            // We'll initialize this when WebRTC connection is established
            console.log(`[Signaling] Conversation flow manager created for ${clientId}`);
        } catch (error) {
            console.error(`[Signaling] Failed to initialize conversation flow for ${clientId}:`, error);
        }
        
        // Setup audio processor event handlers
        audioProcessor.on('transcription', (data) => {
            this.sendToClient(clientId, {
                type: 'transcription',
                ...data
            });
        });
        
        audioProcessor.on('speechStart', (data) => {
            this.sendToClient(clientId, {
                type: 'speechStart',
                ...data
            });
        });
        
        audioProcessor.on('speechEnd', (data) => {
            this.sendToClient(clientId, {
                type: 'speechEnd',
                ...data
            });
        });
        
        audioProcessor.on('interruption', (data) => {
            this.sendToClient(clientId, {
                type: 'interruption_detected',
                ...data
            });
        });
        
        audioProcessor.on('tts_audio', (audioData) => {
            this.sendAudioToClient(clientId, audioData);
        });
        
        // Setup conversation flow event handlers
        conversationFlow.on('userTurnStarted', (data) => {
            this.sendToClient(clientId, {
                type: 'userTurnStarted',
                ...data
            });
        });
        
        conversationFlow.on('agentTurnStarted', (data) => {
            this.sendToClient(clientId, {
                type: 'agentTurnStarted',
                ...data
            });
        });
        
        conversationFlow.on('userInterrupted', (data) => {
            this.sendToClient(clientId, {
                type: 'interruption',
                ...data
            });
        });
        
        conversationFlow.on('agentSpeakingStarted', (data) => {
            this.sendToClient(clientId, {
                type: 'ttsStarted',
                ...data
            });
        });
        
        conversationFlow.on('agentSpeakingInterrupted', (data) => {
            this.sendToClient(clientId, {
                type: 'ttsInterrupted',
                ...data
            });
        });
        
        conversationFlow.on('agentSpeakingEnded', (data) => {
            this.sendToClient(clientId, {
                type: 'ttsCompleted',
                ...data
            });
        });
        
        // Start processing
        audioProcessor.start();
    }

    /**
     * Handle data channel messages
     */
    handleDataChannelMessage(clientId, data) {
        try {
            const message = JSON.parse(data);
            console.log(`[Signaling] Data channel message from ${clientId}: ${message.type}`);
            
            // Forward to appropriate handler
            this.handleClientMessage(clientId, message);
            
        } catch (error) {
            console.error(`[Signaling] Failed to parse data channel message from ${clientId}:`, error);
        }
    }

    /**
     * Handle transcription from client
     */
    async handleTranscription(clientId, message) {
        try {
            console.log(`[Signaling] Transcription from ${clientId}: "${message.text}"`);
            
            // Send to backend for LLM/RAG processing
            const response = await axios.post(`${this.config.backendUrl}/api/voice/rag`, {
                text: message.text,
                model: 'llama3.2:3b',
                // Include client context if needed
                clientId: clientId,
                timestamp: message.timestamp
            });
            
            // Send response back to client
            this.sendToClient(clientId, {
                type: 'llm_response',
                text: response.data.answer,
                sources: response.data.sources,
                timestamp: Date.now()
            });
            
            // Generate TTS audio
            await this.generateTTSResponse(clientId, response.data.answer);
            
        } catch (error) {
            console.error(`[Signaling] Failed to process transcription from ${clientId}:`, error);
            this.sendToClient(clientId, {
                type: 'error',
                message: 'Failed to process transcription'
            });
        }
    }

    /**
     * Handle interruption from client
     */
    async handleInterruption(clientId, message) {
        console.log(`[Signaling] Interruption from ${clientId} (confidence: ${message.confidence})`);
        
        // Stop current TTS if playing
        const audioProcessor = this.audioProcessors.get(clientId);
        if (audioProcessor) {
            audioProcessor.stopTTS();
        }
        
        // Notify client that interruption was handled
        this.sendToClient(clientId, {
            type: 'interruption_handled',
            timestamp: Date.now()
        });
    }

    /**
     * Generate TTS response
     */
    async generateTTSResponse(clientId, text) {
        try {
            console.log(`[Signaling] Generating TTS for ${clientId}: "${text.substring(0, 50)}..."`);
            
            // Notify client that TTS is starting
            this.sendToClient(clientId, {
                type: 'tts_start',
                text: text,
                timestamp: Date.now()
            });
            
            // Call backend TTS service
            const response = await axios.post(`${this.config.backendUrl}/api/voice/synthesize`, {
                text: text,
                voice_id: 'en-GB-RyanNeural',
                engine: 'edge_tts',
                speed: 1.0
            }, {
                responseType: 'arraybuffer'
            });
            
            // Send audio to client
            await this.sendAudioToClient(clientId, response.data);
            
            // Notify client that TTS is complete
            this.sendToClient(clientId, {
                type: 'tts_end',
                timestamp: Date.now()
            });
            
        } catch (error) {
            console.error(`[Signaling] Failed to generate TTS for ${clientId}:`, error);
            this.sendToClient(clientId, {
                type: 'tts_error',
                message: 'Failed to generate speech'
            });
        }
    }

    /**
     * Send audio data to client via WebRTC
     */
    async sendAudioToClient(clientId, audioData) {
        try {
            const peerConnection = this.peerConnections.get(clientId);
            if (!peerConnection) {
                console.warn(`[Signaling] No peer connection for ${clientId}`);
                return;
            }
            
            // For now, send via data channel (in Phase 2, we'll implement proper audio streaming)
            const connection = this.connections.get(clientId);
            if (connection && connection.ws.readyState === WebSocket.OPEN) {
                this.sendToClient(clientId, {
                    type: 'tts_audio',
                    audio: Buffer.from(audioData).toString('base64'),
                    timestamp: Date.now()
                });
            }
            
        } catch (error) {
            console.error(`[Signaling] Failed to send audio to ${clientId}:`, error);
        }
    }

    /**
     * Send message to specific client
     */
    sendToClient(clientId, message) {
        const connection = this.connections.get(clientId);
        if (connection && connection.ws.readyState === WebSocket.OPEN) {
            connection.ws.send(JSON.stringify(message));
        } else {
            console.warn(`[Signaling] Cannot send to ${clientId}: connection not available`);
        }
    }

    /**
     * Handle client disconnect
     */
    handleClientDisconnect(clientId) {
        const connection = this.connections.get(clientId);
        if (!connection) return;
        
        console.log(`[Signaling] Cleaning up client ${clientId}`);
        
        // Stop audio processor
        if (connection.audioProcessor) {
            connection.audioProcessor.stop();
            this.audioProcessors.delete(clientId);
        }
        
        // Cleanup conversation flow manager
        if (connection.conversationFlow) {
            connection.conversationFlow.cleanup();
            this.conversationFlows.delete(clientId);
        }
        
        // Close peer connection
        if (connection.peerConnection) {
            connection.peerConnection.close();
            this.peerConnections.delete(clientId);
        }
        
        // Remove connection
        this.connections.delete(clientId);
        this.connectionCount--;
        
        this.emit('clientDisconnected', clientId);
    }

    /**
     * Generate unique client ID
     */
    generateClientId() {
        return `client_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    }

    /**
     * Setup periodic cleanup
     */
    setupCleanupTimer() {
        setInterval(() => {
            const now = Date.now();
            const timeout = 5 * 60 * 1000; // 5 minutes
            
            for (const [clientId, connection] of this.connections.entries()) {
                if (now - connection.lastActivity > timeout) {
                    console.log(`[Signaling] Cleaning up inactive client: ${clientId}`);
                    this.handleClientDisconnect(clientId);
                }
            }
        }, 60000); // Check every minute
    }

    /**
     * Get server status
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            connectionCount: this.connectionCount,
            port: this.config.port,
            connections: Array.from(this.connections.keys())
        };
    }

    /**
     * Stop the server
     */
    async stop() {
        console.log('[Signaling] Stopping WebRTC Signaling Server...');
        
        // Disconnect all clients
        for (const clientId of this.connections.keys()) {
            this.handleClientDisconnect(clientId);
        }
        
        // Close WebSocket server
        if (this.wsServer) {
            this.wsServer.close();
            this.wsServer = null;
        }
        
        this.isRunning = false;
        console.log('[Signaling] WebRTC Signaling Server stopped');
    }
}

/**
 * Audio Stream Processor with Frame-Based Processing
 * Handles real-time audio processing for each client using 20ms frames
 */
class AudioStreamProcessor extends EventEmitter {
    constructor(clientId, stream, config) {
        super();
        
        this.clientId = clientId;
        this.stream = stream;
        this.config = config;
        
        this.isProcessing = false;
        this.audioContext = null;
        this.frameProcessor = null;
        
        // Frame processing setup
        this.sampleRate = 16000;
        this.frameSize = 320; // 20ms at 16kHz
        this.frameBuffer = new Float32Array(this.frameSize);
        this.bufferIndex = 0;
        
        // Initialize frame processor
        const FrameAudioProcessor = require('./frame_audio_processor');
        this.frameProcessor = new FrameAudioProcessor({
            sttServiceUrl: config.sttServiceUrl,
            smartTurnServiceUrl: config.smartTurnServiceUrl
        });
        
        this.setupFrameProcessorEvents();
    }
    
    setupFrameProcessorEvents() {
        // Forward frame processor events
        this.frameProcessor.on('speechStart', (data) => {
            console.log(`[AudioProcessor] Speech started for ${this.clientId}`);
            this.emit('speechStart', data);
        });
        
        this.frameProcessor.on('speechEnd', (data) => {
            console.log(`[AudioProcessor] Speech ended for ${this.clientId}`);
            this.emit('speechEnd', data);
        });
        
        this.frameProcessor.on('partialTranscription', (data) => {
            console.log(`[AudioProcessor] Partial transcription for ${this.clientId}: "${data.text}"`);
            this.emit('transcription', {
                text: data.text,
                confidence: data.confidence,
                isPartial: true,
                timestamp: Date.now()
            });
        });
        
        this.frameProcessor.on('finalTranscription', (data) => {
            console.log(`[AudioProcessor] Final transcription for ${this.clientId}: "${data.text}"`);
            this.emit('transcription', {
                text: data.text,
                confidence: data.confidence,
                isPartial: false,
                timestamp: Date.now()
            });
        });
        
        this.frameProcessor.on('endpointDetected', (data) => {
            console.log(`[AudioProcessor] Endpoint detected for ${this.clientId} (confidence: ${data.confidence})`);
            this.emit('interruption', {
                confidence: data.confidence,
                probability: data.probability,
                timestamp: Date.now()
            });
        });
        
        this.frameProcessor.on('metrics', (metrics) => {
            this.emit('metrics', metrics);
        });
    }
    
    async start() {
        console.log(`[AudioProcessor] Starting frame-based audio processing for ${this.clientId}`);
        this.isProcessing = true;
        
        try {
            // Initialize frame processor
            await this.frameProcessor.initialize(this.clientId);
            
            // Setup audio context for real-time processing
            await this.setupAudioProcessing();
            
            // Start frame processor
            this.frameProcessor.start();
            
            console.log(`[AudioProcessor] Frame-based processing started for ${this.clientId}`);
            
        } catch (error) {
            console.error(`[AudioProcessor] Failed to start processing for ${this.clientId}:`, error);
            this.isProcessing = false;
            throw error;
        }
    }
    
    async setupAudioProcessing() {
        try {
            // Create audio context
            const AudioContext = global.AudioContext || global.webkitAudioContext;
            if (!AudioContext) {
                console.warn(`[AudioProcessor] AudioContext not available for ${this.clientId}, using fallback`);
                return;
            }
            
            this.audioContext = new AudioContext({
                sampleRate: this.sampleRate,
                latencyHint: 'interactive'
            });
            
            // Create media stream source
            const source = this.audioContext.createMediaStreamSource(this.stream);
            
            // Create script processor for frame extraction
            const scriptProcessor = this.audioContext.createScriptProcessor(this.frameSize, 1, 1);
            
            scriptProcessor.onaudioprocess = (event) => {
                if (!this.isProcessing) return;
                
                const inputBuffer = event.inputBuffer;
                const inputData = inputBuffer.getChannelData(0);
                
                // Process audio frame
                this.processAudioFrame(inputData);
            };
            
            // Connect audio processing chain
            source.connect(scriptProcessor);
            scriptProcessor.connect(this.audioContext.destination);
            
            console.log(`[AudioProcessor] Audio processing chain setup for ${this.clientId}`);
            
        } catch (error) {
            console.error(`[AudioProcessor] Audio setup error for ${this.clientId}:`, error);
            // Continue without audio context - frame processor can still work
        }
    }
    
    processAudioFrame(audioData) {
        try {
            // Ensure we have the right frame size
            if (audioData.length !== this.frameSize) {
                console.warn(`[AudioProcessor] Unexpected frame size: ${audioData.length}`);
                return;
            }
            
            // Copy frame data
            const frameData = new Float32Array(audioData);
            
            // Send to frame processor
            this.frameProcessor.addAudioFrame(frameData);
            
        } catch (error) {
            console.error(`[AudioProcessor] Frame processing error for ${this.clientId}:`, error);
        }
    }
    
    stop() {
        console.log(`[AudioProcessor] Stopping frame-based processing for ${this.clientId}`);
        this.isProcessing = false;
        
        // Stop frame processor
        if (this.frameProcessor) {
            this.frameProcessor.stop();
        }
        
        // Close audio context
        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close().catch(error => {
                console.warn(`[AudioProcessor] Error closing audio context: ${error}`);
            });
        }
    }
    
    stopTTS() {
        console.log(`[AudioProcessor] Stopping TTS for ${this.clientId}`);
        // Will implement TTS interruption in Phase 3
        this.emit('ttsStop', { timestamp: Date.now() });
    }
    
    getStatus() {
        return {
            clientId: this.clientId,
            isProcessing: this.isProcessing,
            frameProcessor: this.frameProcessor ? this.frameProcessor.getStatus() : null
        };
    }
}

module.exports = { WebRTCSignalingServer, AudioStreamProcessor };
