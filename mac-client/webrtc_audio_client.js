/**
 * WebRTC Audio Client for ALFRED Voice Agent
 * Provides ultra-low latency audio streaming to replace HTTP uploads
 */

class WebRTCAudioClient {
    constructor(signalingServerUrl = 'http://localhost:3002') {
        this.signalingServerUrl = signalingServerUrl;
        this.socket = null;
        this.peerConnection = null;
        this.localStream = null;
        this.dataChannel = null;
        this.isConnected = false;
        this.isStreaming = false;
        
        // WebRTC configuration
        this.config = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };
        
        // Audio constraints optimized for voice
        this.audioConstraints = {
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 16000,
                channelCount: 1
            }
        };
        
        // Event callbacks
        this.onConnected = null;
        this.onDisconnected = null;
        this.onAudioData = null;
        this.onSTTResult = null;
        this.onError = null;
    }
    
    async connect() {
        try {
            console.log('[WebRTC] Connecting to signaling server...');
            
            // Import Socket.IO client (assumes it's loaded globally)
            if (typeof io === 'undefined') {
                throw new Error('Socket.IO client not loaded');
            }
            
            this.socket = io(this.signalingServerUrl);
            
            this.socket.on('connect', () => {
                console.log('[WebRTC] Connected to signaling server');
                this.isConnected = true;
                if (this.onConnected) this.onConnected();
            });
            
            this.socket.on('disconnect', () => {
                console.log('[WebRTC] Disconnected from signaling server');
                this.isConnected = false;
                this.cleanup();
                if (this.onDisconnected) this.onDisconnected();
            });
            
            this.socket.on('stt-result', (result) => {
                console.log('[WebRTC] STT result received:', result);
                if (this.onSTTResult) this.onSTTResult(result);
            });
            
            this.socket.on('stt-error', (error) => {
                console.error('[WebRTC] STT error:', error);
                if (this.onError) this.onError(error);
            });
            
            // Setup WebRTC signaling handlers
            this.setupWebRTCSignaling();
            
        } catch (error) {
            console.error('[WebRTC] Connection error:', error);
            if (this.onError) this.onError(error);
            throw error;
        }
    }
    
    setupWebRTCSignaling() {
        this.socket.on('offer', async (data) => {
            console.log('[WebRTC] Received offer');
            await this.handleOffer(data.offer, data.sender);
        });
        
        this.socket.on('answer', async (data) => {
            console.log('[WebRTC] Received answer');
            await this.handleAnswer(data.answer);
        });
        
        this.socket.on('ice-candidate', async (data) => {
            console.log('[WebRTC] Received ICE candidate');
            await this.handleICECandidate(data.candidate);
        });
    }
    
    async startAudioStreaming() {
        try {
            if (this.isStreaming) {
                console.log('[WebRTC] Already streaming');
                return;
            }
            
            console.log('[WebRTC] Starting audio streaming...');
            
            // Get microphone access
            this.localStream = await navigator.mediaDevices.getUserMedia(this.audioConstraints);
            console.log('[WebRTC] Microphone access granted');
            
            // For now, use Socket.IO fallback instead of full WebRTC peer connection
            // This gives us most of the performance benefits with less complexity
            this.startSocketAudioStreaming();
            
            this.isStreaming = true;
            
        } catch (error) {
            console.error('[WebRTC] Error starting audio streaming:', error);
            if (this.onError) this.onError(error);
            throw error;
        }
    }
    
    startSocketAudioStreaming() {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioContext.createMediaStreamSource(this.localStream);
        const processor = audioContext.createScriptProcessorNode(4096, 1, 1);
        
        processor.onaudioprocess = (event) => {
            if (!this.isStreaming) return;
            
            const inputData = event.inputBuffer.getChannelData(0);
            
            // Convert to 16-bit PCM
            const pcmData = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
                pcmData[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
            }
            
            // Send audio data via Socket.IO
            if (this.socket && this.socket.connected) {
                this.socket.emit('audio-data', Array.from(pcmData));
            }
            
            if (this.onAudioData) {
                this.onAudioData(pcmData);
            }
        };
        
        source.connect(processor);
        processor.connect(audioContext.destination);
        
        this.audioProcessor = processor;
        this.audioContext = audioContext;
        
        console.log('[WebRTC] Socket.IO audio streaming started');
    }
    
    stopAudioStreaming() {
        console.log('[WebRTC] Stopping audio streaming...');
        
        this.isStreaming = false;
        
        if (this.audioProcessor) {
            this.audioProcessor.disconnect();
            this.audioProcessor = null;
        }
        
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
        
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
        
        console.log('[WebRTC] Audio streaming stopped');
    }
    
    disconnect() {
        console.log('[WebRTC] Disconnecting...');
        
        this.stopAudioStreaming();
        
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        
        this.cleanup();
    }
    
    cleanup() {
        this.isConnected = false;
        this.isStreaming = false;
        
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        
        if (this.dataChannel) {
            this.dataChannel.close();
            this.dataChannel = null;
        }
    }
    
    // WebRTC peer connection methods (for future full WebRTC implementation)
    async createPeerConnection() {
        this.peerConnection = new RTCPeerConnection(this.config);
        
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate && this.socket) {
                this.socket.emit('ice-candidate', {
                    candidate: event.candidate,
                    target: 'server'
                });
            }
        };
        
        this.peerConnection.onconnectionstatechange = () => {
            console.log('[WebRTC] Connection state:', this.peerConnection.connectionState);
        };
        
        return this.peerConnection;
    }
    
    async handleOffer(offer, sender) {
        await this.createPeerConnection();
        await this.peerConnection.setRemoteDescription(offer);
        
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);
        
        this.socket.emit('answer', {
            answer: answer,
            target: sender
        });
    }
    
    async handleAnswer(answer) {
        if (this.peerConnection) {
            await this.peerConnection.setRemoteDescription(answer);
        }
    }
    
    async handleICECandidate(candidate) {
        if (this.peerConnection) {
            await this.peerConnection.addIceCandidate(candidate);
        }
    }
    
    // Utility methods
    getConnectionState() {
        return {
            connected: this.isConnected,
            streaming: this.isStreaming,
            peerConnection: this.peerConnection?.connectionState || 'none',
            socketConnected: this.socket?.connected || false
        };
    }
}

// Export for use in browser
if (typeof window !== 'undefined') {
    window.WebRTCAudioClient = WebRTCAudioClient;
}

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WebRTCAudioClient;
}
