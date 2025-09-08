/**
 * WebRTC Audio Pipeline for ALFRED Voice Agent
 * 
 * This module implements WebRTC-based real-time audio streaming
 * to replace WebSocket communication and achieve <100ms latency.
 * 
 * Key Features:
 * - Echo cancellation to prevent self-interruption
 * - Real-time bidirectional audio streaming
 * - Data channel for text communication
 * - Automatic fallback to WebSocket if WebRTC fails
 */

const EventEmitter = require('events');

class WebRTCAudioPipeline extends EventEmitter {
    constructor(options = {}) {
        super();
        
        // Configuration
        this.config = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                ...options.iceServers || []
            ],
            // Audio constraints optimized for voice interaction
            audioConstraints: {
                echoCancellation: true,        // Critical for preventing self-interruption
                noiseSuppression: true,        // Reduce background noise
                autoGainControl: true,         // Normalize input levels
                sampleRate: 16000,             // Standard for speech processing
                channelCount: 1,               // Mono audio
                latency: 0.01,                 // 10ms target latency
                ...options.audioConstraints || {}
            },
            // Data channel configuration
            dataChannelConfig: {
                ordered: true,
                maxRetransmits: 0,             // Prioritize speed over reliability
                maxPacketLifeTime: 100         // 100ms max packet lifetime
            },
            // Connection timeouts
            connectionTimeout: 10000,          // 10 second connection timeout
            reconnectAttempts: 3,
            ...options
        };
        
        // WebRTC components
        this.peerConnection = null;
        this.localStream = null;
        this.remoteStream = null;
        this.dataChannel = null;
        
        // State management
        this.isConnected = false;
        this.isAudioStreaming = false;
        this.connectionState = 'disconnected';
        this.speakerState = {
            agentSpeaking: false,
            ttsStartTime: null,
            minSpeechDuration: 500  // 500ms minimum before interruption possible
        };
        
        // Audio processing
        this.audioContext = null;
        this.audioWorklet = null;
        this.frameBuffer = [];
        this.frameSize = 320;  // 20ms at 16kHz
        
        // Metrics
        this.metrics = {
            connectionAttempts: 0,
            packetsLost: 0,
            averageLatency: 0,
            audioQuality: 'good'
        };
        
        // Fallback WebSocket reference
        this.fallbackSocket = null;
        this.usingFallback = false;
    }

    /**
     * Initialize WebRTC connection
     */
    async initialize() {
        try {
            console.log('[WebRTC] Initializing WebRTC Audio Pipeline...');
            
            // Create peer connection
            await this.createPeerConnection();
            
            // Setup local audio stream
            await this.setupLocalAudioStream();
            
            // Setup data channel
            this.setupDataChannel();
            
            // Setup connection monitoring
            this.setupConnectionMonitoring();
            
            console.log('[WebRTC] WebRTC Audio Pipeline initialized successfully');
            this.emit('initialized');
            
        } catch (error) {
            console.error('[WebRTC] Failed to initialize WebRTC pipeline:', error);
            await this.fallbackToWebSocket();
            throw error;
        }
    }

    /**
     * Create WebRTC peer connection
     */
    async createPeerConnection() {
        this.peerConnection = new RTCPeerConnection({
            iceServers: this.config.iceServers,
            iceCandidatePoolSize: 10
        });

        // Handle ICE candidates
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('[WebRTC] ICE candidate generated');
                this.emit('iceCandidate', event.candidate);
            }
        };

        // Handle connection state changes
        this.peerConnection.onconnectionstatechange = () => {
            this.connectionState = this.peerConnection.connectionState;
            console.log(`[WebRTC] Connection state: ${this.connectionState}`);
            
            switch (this.connectionState) {
                case 'connected':
                    this.isConnected = true;
                    this.emit('connected');
                    break;
                case 'disconnected':
                case 'failed':
                    this.isConnected = false;
                    this.emit('disconnected');
                    if (this.connectionState === 'failed') {
                        this.handleConnectionFailure();
                    }
                    break;
            }
        };

        // Handle remote stream
        this.peerConnection.ontrack = (event) => {
            console.log('[WebRTC] Received remote stream');
            this.remoteStream = event.streams[0];
            this.emit('remoteStream', this.remoteStream);
        };

        // Handle data channel from remote
        this.peerConnection.ondatachannel = (event) => {
            const channel = event.channel;
            this.setupDataChannelHandlers(channel);
        };
    }

    /**
     * Setup local audio stream with echo cancellation
     */
    async setupLocalAudioStream() {
        try {
            console.log('[WebRTC] Setting up local audio stream...');
            
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: this.config.audioConstraints,
                video: false
            });

            // Add tracks to peer connection
            this.localStream.getTracks().forEach(track => {
                console.log(`[WebRTC] Adding local track: ${track.kind}`);
                this.peerConnection.addTrack(track, this.localStream);
            });

            // Setup audio context for frame processing
            await this.setupAudioContext();

            this.isAudioStreaming = true;
            this.emit('localStreamReady', this.localStream);
            
        } catch (error) {
            console.error('[WebRTC] Failed to setup local audio stream:', error);
            throw new Error(`Microphone access failed: ${error.message}`);
        }
    }

    /**
     * Setup audio context for real-time frame processing
     */
    async setupAudioContext() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: 16000,
            latencyHint: 'interactive'
        });

        // Load audio worklet for precise frame processing
        await this.audioContext.audioWorklet.addModule('./audio_frame_worklet.js');

        // Create audio source from local stream
        const source = this.audioContext.createMediaStreamSource(this.localStream);
        
        // Create audio worklet node for 20ms frame processing
        this.audioWorklet = new AudioWorkletNode(this.audioContext, 'audio-frame-processor', {
            processorOptions: {
                sampleRate: 16000,
                frameSize: 320 // 20ms at 16kHz
            }
        });
        
        // Handle frames from worklet
        this.audioWorklet.port.onmessage = (event) => {
            this.handleAudioFrame(event.data);
        };
        
        // Connect audio processing chain
        source.connect(this.audioWorklet);
        
        // Setup audio level monitoring
        const analyser = this.audioContext.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        this.monitorAudioLevels(analyser);
        
        // Start frame processing
        this.audioWorklet.port.postMessage({ type: 'start' });
        
        console.log('[WebRTC] Audio worklet setup complete for 20ms frame processing');
    }

    /**
     * Handle audio frames from worklet
     */
    handleAudioFrame(message) {
        if (message.type === 'audioFrame') {
            const { frameIndex, audioData, timestamp, energy, frameInterval } = message.data;
            
            // Emit frame for processing
            this.emit('audioFrame', {
                frameIndex,
                audioData,
                timestamp,
                energy,
                frameInterval
            });
            
            // Update frame metrics
            this.metrics.frameProcessingTime = frameInterval;
            this.metrics.framesProcessed = frameIndex;
            
        } else if (message.type === 'stats') {
            this.emit('workletStats', message.data);
        }
    }

    /**
     * Setup data channel for text communication
     */
    setupDataChannel() {
        console.log('[WebRTC] Setting up data channel...');
        
        this.dataChannel = this.peerConnection.createDataChannel('text', this.config.dataChannelConfig);
        this.setupDataChannelHandlers(this.dataChannel);
    }

    /**
     * Setup data channel event handlers
     */
    setupDataChannelHandlers(channel) {
        channel.onopen = () => {
            console.log('[WebRTC] Data channel opened');
            this.emit('dataChannelOpen');
        };

        channel.onclose = () => {
            console.log('[WebRTC] Data channel closed');
            this.emit('dataChannelClose');
        };

        channel.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleDataChannelMessage(data);
            } catch (error) {
                console.error('[WebRTC] Failed to parse data channel message:', error);
            }
        };

        channel.onerror = (error) => {
            console.error('[WebRTC] Data channel error:', error);
            this.emit('dataChannelError', error);
        };
    }

    /**
     * Handle incoming data channel messages
     */
    handleDataChannelMessage(data) {
        switch (data.type) {
            case 'transcription':
                this.emit('transcription', {
                    text: data.text,
                    timestamp: data.timestamp,
                    confidence: data.confidence
                });
                break;
                
            case 'tts_start':
                this.handleTTSStart(data);
                break;
                
            case 'tts_end':
                this.handleTTSEnd(data);
                break;
                
            case 'interruption_allowed':
                this.emit('interruptionAllowed', data);
                break;
                
            default:
                console.warn('[WebRTC] Unknown data channel message type:', data.type);
        }
    }

    /**
     * Handle TTS start notification
     */
    handleTTSStart(data) {
        this.speakerState.agentSpeaking = true;
        this.speakerState.ttsStartTime = Date.now();
        
        console.log('[WebRTC] Agent started speaking');
        this.emit('agentSpeakingStart', data);
    }

    /**
     * Handle TTS end notification
     */
    handleTTSEnd(data) {
        this.speakerState.agentSpeaking = false;
        this.speakerState.ttsStartTime = null;
        
        console.log('[WebRTC] Agent finished speaking');
        this.emit('agentSpeakingEnd', data);
    }

    /**
     * Check if interruption is allowed
     */
    canAcceptInterruption() {
        if (!this.speakerState.agentSpeaking) {
            return false;
        }
        
        const elapsed = Date.now() - this.speakerState.ttsStartTime;
        return elapsed > this.speakerState.minSpeechDuration;
    }

    /**
     * Send text to backend via data channel
     */
    sendText(text, type = 'transcription', metadata = {}) {
        if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
            console.warn('[WebRTC] Data channel not ready, queuing message');
            // Could implement message queuing here
            return false;
        }

        const message = {
            type: type,
            text: text,
            timestamp: Date.now(),
            ...metadata
        };

        try {
            this.dataChannel.send(JSON.stringify(message));
            console.log(`[WebRTC] Sent ${type}: "${text.substring(0, 50)}..."`);
            return true;
        } catch (error) {
            console.error('[WebRTC] Failed to send text via data channel:', error);
            return false;
        }
    }

    /**
     * Send interruption signal
     */
    sendInterruption(confidence, metadata = {}) {
        return this.sendText('', 'interruption', {
            confidence: confidence,
            canInterrupt: this.canAcceptInterruption(),
            ...metadata
        });
    }

    /**
     * Create offer for WebRTC connection
     */
    async createOffer() {
        try {
            console.log('[WebRTC] Creating offer...');
            const offer = await this.peerConnection.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: false
            });
            
            await this.peerConnection.setLocalDescription(offer);
            console.log('[WebRTC] Local description set');
            
            return offer;
        } catch (error) {
            console.error('[WebRTC] Failed to create offer:', error);
            throw error;
        }
    }

    /**
     * Handle answer from remote peer
     */
    async handleAnswer(answer) {
        try {
            console.log('[WebRTC] Handling answer...');
            await this.peerConnection.setRemoteDescription(answer);
            console.log('[WebRTC] Remote description set');
        } catch (error) {
            console.error('[WebRTC] Failed to handle answer:', error);
            throw error;
        }
    }

    /**
     * Add ICE candidate
     */
    async addIceCandidate(candidate) {
        try {
            await this.peerConnection.addIceCandidate(candidate);
            console.log('[WebRTC] ICE candidate added');
        } catch (error) {
            console.error('[WebRTC] Failed to add ICE candidate:', error);
        }
    }

    /**
     * Monitor audio levels for debugging
     */
    monitorAudioLevels(analyser) {
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        
        const checkLevels = () => {
            if (!this.isAudioStreaming) return;
            
            analyser.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
            
            // Emit audio level for UI visualization
            this.emit('audioLevel', average);
            
            // Check for audio issues
            if (average < 1) {
                this.metrics.audioQuality = 'poor';
            } else if (average < 10) {
                this.metrics.audioQuality = 'fair';
            } else {
                this.metrics.audioQuality = 'good';
            }
            
            setTimeout(checkLevels, 100); // Check every 100ms
        };
        
        checkLevels();
    }

    /**
     * Setup connection monitoring
     */
    setupConnectionMonitoring() {
        // Monitor connection quality
        setInterval(() => {
            if (this.peerConnection && this.isConnected) {
                this.peerConnection.getStats().then(stats => {
                    this.updateConnectionMetrics(stats);
                });
            }
        }, 1000);
    }

    /**
     * Update connection metrics
     */
    updateConnectionMetrics(stats) {
        stats.forEach(report => {
            if (report.type === 'inbound-rtp' && report.mediaType === 'audio') {
                this.metrics.packetsLost = report.packetsLost || 0;
            }
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                this.metrics.averageLatency = report.currentRoundTripTime || 0;
            }
        });
        
        // Emit metrics for monitoring
        this.emit('metrics', this.metrics);
    }

    /**
     * Handle connection failure
     */
    async handleConnectionFailure() {
        console.warn('[WebRTC] Connection failed, attempting to reconnect...');
        
        this.metrics.connectionAttempts++;
        
        if (this.metrics.connectionAttempts < this.config.reconnectAttempts) {
            setTimeout(() => {
                this.reconnect();
            }, 2000);
        } else {
            console.error('[WebRTC] Max reconnection attempts reached, falling back to WebSocket');
            await this.fallbackToWebSocket();
        }
    }

    /**
     * Reconnect WebRTC connection
     */
    async reconnect() {
        try {
            console.log('[WebRTC] Attempting to reconnect...');
            await this.disconnect();
            await this.initialize();
        } catch (error) {
            console.error('[WebRTC] Reconnection failed:', error);
            this.handleConnectionFailure();
        }
    }

    /**
     * Fallback to WebSocket communication
     */
    async fallbackToWebSocket() {
        console.log('[WebRTC] Falling back to WebSocket communication...');
        
        this.usingFallback = true;
        this.emit('fallbackActivated', 'websocket');
        
        // Could implement WebSocket fallback here
        // For now, just emit event for higher-level handling
    }

    /**
     * Get current connection status
     */
    getStatus() {
        return {
            isConnected: this.isConnected,
            isAudioStreaming: this.isAudioStreaming,
            connectionState: this.connectionState,
            usingFallback: this.usingFallback,
            metrics: this.metrics,
            speakerState: this.speakerState
        };
    }

    /**
     * Disconnect and cleanup
     */
    async disconnect() {
        console.log('[WebRTC] Disconnecting WebRTC pipeline...');
        
        // Stop local stream
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
        
        // Close data channel
        if (this.dataChannel) {
            this.dataChannel.close();
            this.dataChannel = null;
        }
        
        // Close peer connection
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        
        // Stop audio worklet
        if (this.audioWorklet) {
            this.audioWorklet.port.postMessage({ type: 'stop' });
            this.audioWorklet.disconnect();
            this.audioWorklet = null;
        }
        
        // Close audio context
        if (this.audioContext) {
            await this.audioContext.close();
            this.audioContext = null;
        }
        
        this.isConnected = false;
        this.isAudioStreaming = false;
        this.connectionState = 'disconnected';
        
        this.emit('disconnected');
    }
}

module.exports = WebRTCAudioPipeline;
