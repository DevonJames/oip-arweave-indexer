/**
 * Frame-Based Audio Processor for ALFRED Voice Agent
 * 
 * This module implements 20ms frame-based audio processing for real-time
 * voice interaction capabilities. It coordinates VAD, STT, and Smart Turn
 * processing on a frame-by-frame basis.
 * 
 * Key Features:
 * - 20ms audio frame processing (320 samples at 16kHz)
 * - Real-time VAD with frame-level decisions
 * - Streaming STT with partial results
 * - Frame-synchronized Smart Turn detection
 * - Audio buffer management and overflow protection
 */

const EventEmitter = require('events');
const axios = require('axios');

class FrameAudioProcessor extends EventEmitter {
    constructor(options = {}) {
        super();
        
        // Configuration
        this.config = {
            sampleRate: 16000,              // 16kHz audio
            frameSize: 320,                 // 20ms at 16kHz (16000 * 0.02)
            frameDurationMs: 20,            // 20ms frames
            maxBufferFrames: 250,           // 5 seconds of audio buffer
            vadThreshold: 0.5,              // VAD confidence threshold
            sttPartialThreshold: 0.7,       // STT confidence for partial results
            smartTurnThreshold: 0.7,        // Smart Turn confidence threshold
            
            // Service URLs
            sttServiceUrl: options.sttServiceUrl || 'http://localhost:8013',
            smartTurnServiceUrl: options.smartTurnServiceUrl || 'http://localhost:8014',
            
            // Processing options
            enableVAD: options.enableVAD !== false,
            enableSTT: options.enableSTT !== false,
            enableSmartTurn: options.enableSmartTurn !== false,
            
            ...options
        };
        
        // Audio buffers
        this.frameBuffer = [];              // Incoming audio frames
        this.vadBuffer = [];                // VAD processing buffer
        this.sttBuffer = [];                // STT accumulation buffer
        this.smartTurnBuffer = [];          // Smart Turn analysis buffer
        
        // Processing state
        this.isProcessing = false;
        this.frameCount = 0;
        this.sessionId = null;
        
        // VAD state
        this.vadState = {
            isSpeechActive: false,
            speechStartFrame: null,
            speechEndFrame: null,
            silenceFrameCount: 0,
            speechFrameCount: 0
        };
        
        // STT state
        this.sttState = {
            isTranscribing: false,
            partialText: '',
            finalText: '',
            confidence: 0,
            lastUpdateFrame: 0
        };
        
        // Smart Turn state
        this.smartTurnState = {
            isAnalyzing: false,
            probability: 0,
            isEndpoint: false,
            lastAnalysisFrame: 0
        };
        
        // Performance metrics
        this.metrics = {
            framesProcessed: 0,
            averageProcessingTime: 0,
            vadAccuracy: 0,
            sttLatency: 0,
            smartTurnLatency: 0,
            bufferOverflows: 0
        };
        
        // Processing intervals
        this.processingInterval = null;
        this.metricsInterval = null;
    }

    /**
     * Initialize the frame processor
     */
    async initialize(sessionId) {
        try {
            console.log('[FrameProcessor] Initializing frame-based audio processor...');
            
            this.sessionId = sessionId || `session_${Date.now()}`;
            this.isProcessing = false;
            
            // Reset all buffers and state
            this.resetState();
            
            // Verify service connections
            await this.checkServices();
            
            console.log(`[FrameProcessor] Frame processor initialized for session: ${this.sessionId}`);
            console.log(`[FrameProcessor] Frame size: ${this.config.frameSize} samples (${this.config.frameDurationMs}ms)`);
            
            this.emit('initialized', { sessionId: this.sessionId });
            
        } catch (error) {
            console.error('[FrameProcessor] Failed to initialize:', error);
            throw error;
        }
    }

    /**
     * Start frame processing
     */
    start() {
        if (this.isProcessing) {
            console.warn('[FrameProcessor] Already processing');
            return;
        }
        
        console.log('[FrameProcessor] Starting frame processing...');
        this.isProcessing = true;
        
        // Start processing loop (every 10ms to handle 20ms frames with overlap)
        this.processingInterval = setInterval(() => {
            this.processFrames();
        }, 10);
        
        // Start metrics collection (every second)
        this.metricsInterval = setInterval(() => {
            this.updateMetrics();
        }, 1000);
        
        this.emit('started');
    }

    /**
     * Stop frame processing
     */
    stop() {
        if (!this.isProcessing) {
            return;
        }
        
        console.log('[FrameProcessor] Stopping frame processing...');
        this.isProcessing = false;
        
        // Clear intervals
        if (this.processingInterval) {
            clearInterval(this.processingInterval);
            this.processingInterval = null;
        }
        
        if (this.metricsInterval) {
            clearInterval(this.metricsInterval);
            this.metricsInterval = null;
        }
        
        // Flush any remaining audio
        this.flushBuffers();
        
        this.emit('stopped');
    }

    /**
     * Add audio frame to processing queue
     */
    addAudioFrame(audioData, timestamp = Date.now()) {
        if (!this.isProcessing) {
            return false;
        }
        
        // Convert audio data to Float32Array if needed
        let frameData;
        if (audioData instanceof Float32Array) {
            frameData = audioData;
        } else if (audioData instanceof ArrayBuffer) {
            frameData = new Float32Array(audioData);
        } else if (Array.isArray(audioData)) {
            frameData = new Float32Array(audioData);
        } else {
            console.warn('[FrameProcessor] Invalid audio data format');
            return false;
        }
        
        // Ensure frame is correct size
        if (frameData.length !== this.config.frameSize) {
            console.warn(`[FrameProcessor] Invalid frame size: ${frameData.length} (expected ${this.config.frameSize})`);
            return false;
        }
        
        // Check buffer overflow
        if (this.frameBuffer.length >= this.config.maxBufferFrames) {
            console.warn('[FrameProcessor] Buffer overflow, dropping oldest frame');
            this.frameBuffer.shift();
            this.metrics.bufferOverflows++;
        }
        
        // Add frame to buffer
        const frame = {
            data: frameData,
            timestamp: timestamp,
            frameIndex: this.frameCount++,
            processed: false
        };
        
        this.frameBuffer.push(frame);
        
        return true;
    }

    /**
     * Process available frames
     */
    async processFrames() {
        if (this.frameBuffer.length === 0) {
            return;
        }
        
        const startTime = Date.now();
        
        try {
            // Process all available frames
            while (this.frameBuffer.length > 0) {
                const frame = this.frameBuffer.shift();
                if (frame && !frame.processed) {
                    await this.processFrame(frame);
                    frame.processed = true;
                }
            }
            
            // Update processing time metrics
            const processingTime = Date.now() - startTime;
            this.updateProcessingMetrics(processingTime);
            
        } catch (error) {
            console.error('[FrameProcessor] Error processing frames:', error);
        }
    }

    /**
     * Process a single audio frame
     */
    async processFrame(frame) {
        const { data, timestamp, frameIndex } = frame;
        
        // Step 1: Voice Activity Detection
        if (this.config.enableVAD) {
            await this.processVAD(data, frameIndex);
        }
        
        // Step 2: STT Processing (only if speech is detected)
        if (this.config.enableSTT && this.vadState.isSpeechActive) {
            await this.processSTT(data, frameIndex);
        }
        
        // Step 3: Smart Turn Detection (only if speech is detected)
        if (this.config.enableSmartTurn && this.vadState.isSpeechActive) {
            await this.processSmartTurn(data, frameIndex);
        }
        
        this.metrics.framesProcessed++;
        
        // Emit frame processed event
        this.emit('frameProcessed', {
            frameIndex,
            timestamp,
            vadResult: {
                isSpeech: this.vadState.isSpeechActive,
                confidence: this.vadState.confidence
            },
            sttResult: {
                partialText: this.sttState.partialText,
                confidence: this.sttState.confidence
            },
            smartTurnResult: {
                probability: this.smartTurnState.probability,
                isEndpoint: this.smartTurnState.isEndpoint
            }
        });
    }

    /**
     * Process Voice Activity Detection for a frame
     */
    async processVAD(audioData, frameIndex) {
        try {
            // Add frame to VAD buffer
            this.vadBuffer.push(audioData);
            
            // Keep buffer size manageable (process every 5 frames = 100ms)
            if (this.vadBuffer.length >= 5) {
                // Combine frames for VAD analysis
                const combinedAudio = this.combineAudioFrames(this.vadBuffer);
                
                // Simple energy-based VAD (can be replaced with Silero VAD)
                const energy = this.calculateAudioEnergy(combinedAudio);
                const isSpeech = energy > this.config.vadThreshold;
                
                // Update VAD state
                if (isSpeech && !this.vadState.isSpeechActive) {
                    // Speech started
                    this.vadState.isSpeechActive = true;
                    this.vadState.speechStartFrame = frameIndex;
                    this.vadState.silenceFrameCount = 0;
                    this.vadState.speechFrameCount = 1;
                    
                    console.log(`[FrameProcessor] Speech started at frame ${frameIndex}`);
                    this.emit('speechStart', { frameIndex, energy });
                    
                } else if (isSpeech && this.vadState.isSpeechActive) {
                    // Speech continues
                    this.vadState.speechFrameCount++;
                    this.vadState.silenceFrameCount = 0;
                    
                } else if (!isSpeech && this.vadState.isSpeechActive) {
                    // Potential speech end
                    this.vadState.silenceFrameCount++;
                    
                    // End speech after 10 frames (200ms) of silence
                    if (this.vadState.silenceFrameCount >= 10) {
                        this.vadState.isSpeechActive = false;
                        this.vadState.speechEndFrame = frameIndex;
                        
                        console.log(`[FrameProcessor] Speech ended at frame ${frameIndex}`);
                        this.emit('speechEnd', { 
                            frameIndex, 
                            duration: (frameIndex - this.vadState.speechStartFrame) * this.config.frameDurationMs 
                        });
                        
                        // Trigger STT finalization
                        this.finalizeSTT();
                    }
                }
                
                this.vadState.confidence = energy;
                
                // Clear VAD buffer
                this.vadBuffer = [];
            }
            
        } catch (error) {
            console.error('[FrameProcessor] VAD processing error:', error);
        }
    }

    /**
     * Process Speech-to-Text for a frame
     */
    async processSTT(audioData, frameIndex) {
        try {
            // Add frame to STT buffer
            this.sttBuffer.push(audioData);
            
            // Process STT every 10 frames (200ms) for partial results
            if (this.sttBuffer.length >= 10) {
                const combinedAudio = this.combineAudioFrames(this.sttBuffer);
                
                // Convert to buffer for STT service
                const audioBuffer = this.audioToBuffer(combinedAudio);
                
                // Send to STT service for partial transcription
                const sttResult = await this.callSTTService(audioBuffer, true);
                
                if (sttResult && sttResult.text) {
                    this.sttState.partialText = sttResult.text;
                    this.sttState.confidence = sttResult.confidence || 0;
                    this.sttState.lastUpdateFrame = frameIndex;
                    
                    // Emit partial result if confidence is high enough
                    if (sttResult.confidence > this.config.sttPartialThreshold) {
                        this.emit('partialTranscription', {
                            text: sttResult.text,
                            confidence: sttResult.confidence,
                            frameIndex: frameIndex,
                            isPartial: true
                        });
                    }
                }
                
                // Keep only recent frames in buffer (sliding window)
                if (this.sttBuffer.length > 50) { // 1 second of audio
                    this.sttBuffer = this.sttBuffer.slice(-25); // Keep last 500ms
                }
            }
            
        } catch (error) {
            console.error('[FrameProcessor] STT processing error:', error);
        }
    }

    /**
     * Process Smart Turn detection for a frame
     */
    async processSmartTurn(audioData, frameIndex) {
        try {
            // Add frame to Smart Turn buffer
            this.smartTurnBuffer.push(audioData);
            
            // Analyze every 5 frames (100ms) for responsiveness
            if (this.smartTurnBuffer.length >= 5) {
                const combinedAudio = this.combineAudioFrames(this.smartTurnBuffer);
                const audioBuffer = this.audioToBuffer(combinedAudio);
                
                // Send to Smart Turn service
                const smartTurnResult = await this.callSmartTurnService(audioBuffer, this.sttState.partialText);
                
                if (smartTurnResult) {
                    this.smartTurnState.probability = smartTurnResult.probability;
                    this.smartTurnState.isEndpoint = smartTurnResult.prediction === 1 && 
                                                   smartTurnResult.probability > this.config.smartTurnThreshold;
                    this.smartTurnState.lastAnalysisFrame = frameIndex;
                    
                    // Emit endpoint detection
                    if (this.smartTurnState.isEndpoint) {
                        this.emit('endpointDetected', {
                            frameIndex: frameIndex,
                            probability: smartTurnResult.probability,
                            confidence: smartTurnResult.probability
                        });
                    }
                }
                
                // Clear Smart Turn buffer
                this.smartTurnBuffer = [];
            }
            
        } catch (error) {
            console.error('[FrameProcessor] Smart Turn processing error:', error);
        }
    }

    /**
     * Finalize STT processing when speech ends
     */
    async finalizeSTT() {
        if (this.sttBuffer.length === 0) {
            return;
        }
        
        try {
            console.log('[FrameProcessor] Finalizing STT transcription...');
            
            // Combine all buffered audio for final transcription
            const combinedAudio = this.combineAudioFrames(this.sttBuffer);
            const audioBuffer = this.audioToBuffer(combinedAudio);
            
            // Get final transcription
            const sttResult = await this.callSTTService(audioBuffer, false);
            
            if (sttResult && sttResult.text) {
                this.sttState.finalText = sttResult.text;
                this.sttState.confidence = sttResult.confidence || 0;
                
                console.log(`[FrameProcessor] Final transcription: "${sttResult.text}" (confidence: ${sttResult.confidence})`);
                
                this.emit('finalTranscription', {
                    text: sttResult.text,
                    confidence: sttResult.confidence,
                    duration: this.sttBuffer.length * this.config.frameDurationMs,
                    isPartial: false
                });
            }
            
            // Clear STT buffer
            this.sttBuffer = [];
            this.sttState.partialText = '';
            
        } catch (error) {
            console.error('[FrameProcessor] STT finalization error:', error);
        }
    }

    /**
     * Call STT service
     */
    async callSTTService(audioBuffer, isPartial = false) {
        try {
            const FormData = require('form-data');
            const formData = new FormData();
            
            formData.append('file', audioBuffer, {
                filename: 'audio.wav',
                contentType: 'audio/wav'
            });
            
            if (isPartial) {
                formData.append('partial', 'true');
            }
            
            const response = await axios.post(
                `${this.config.sttServiceUrl}/transcribe_file`,
                formData,
                {
                    headers: formData.getHeaders(),
                    timeout: 5000
                }
            );
            
            return response.data;
            
        } catch (error) {
            console.warn('[FrameProcessor] STT service call failed:', error.message);
            return null;
        }
    }

    /**
     * Call Smart Turn service
     */
    async callSmartTurnService(audioBuffer, transcript = null) {
        try {
            const FormData = require('form-data');
            const formData = new FormData();
            
            formData.append('audio_file', audioBuffer, {
                filename: 'audio.wav',
                contentType: 'audio/wav'
            });
            
            if (transcript) {
                formData.append('transcript', transcript);
            }
            
            const response = await axios.post(
                `${this.config.smartTurnServiceUrl}/predict_endpoint`,
                formData,
                {
                    headers: formData.getHeaders(),
                    timeout: 3000
                }
            );
            
            return response.data;
            
        } catch (error) {
            console.warn('[FrameProcessor] Smart Turn service call failed:', error.message);
            return null;
        }
    }

    /**
     * Combine multiple audio frames into single array
     */
    combineAudioFrames(frames) {
        const totalLength = frames.reduce((sum, frame) => sum + frame.length, 0);
        const combined = new Float32Array(totalLength);
        
        let offset = 0;
        for (const frame of frames) {
            combined.set(frame, offset);
            offset += frame.length;
        }
        
        return combined;
    }

    /**
     * Calculate audio energy for VAD
     */
    calculateAudioEnergy(audioData) {
        let energy = 0;
        for (let i = 0; i < audioData.length; i++) {
            energy += audioData[i] * audioData[i];
        }
        return Math.sqrt(energy / audioData.length);
    }

    /**
     * Convert Float32Array audio to Buffer
     */
    audioToBuffer(audioData) {
        // Convert Float32Array to 16-bit PCM
        const buffer = Buffer.alloc(audioData.length * 2);
        for (let i = 0; i < audioData.length; i++) {
            const sample = Math.max(-1, Math.min(1, audioData[i]));
            buffer.writeInt16LE(sample * 32767, i * 2);
        }
        return buffer;
    }

    /**
     * Check service availability
     */
    async checkServices() {
        const services = [
            { name: 'STT', url: `${this.config.sttServiceUrl}/health` },
            { name: 'Smart Turn', url: `${this.config.smartTurnServiceUrl}/health` }
        ];
        
        for (const service of services) {
            try {
                await axios.get(service.url, { timeout: 3000 });
                console.log(`[FrameProcessor] ${service.name} service is available`);
            } catch (error) {
                console.warn(`[FrameProcessor] ${service.name} service unavailable: ${error.message}`);
            }
        }
    }

    /**
     * Reset all state
     */
    resetState() {
        this.frameBuffer = [];
        this.vadBuffer = [];
        this.sttBuffer = [];
        this.smartTurnBuffer = [];
        
        this.frameCount = 0;
        
        this.vadState = {
            isSpeechActive: false,
            speechStartFrame: null,
            speechEndFrame: null,
            silenceFrameCount: 0,
            speechFrameCount: 0,
            confidence: 0
        };
        
        this.sttState = {
            isTranscribing: false,
            partialText: '',
            finalText: '',
            confidence: 0,
            lastUpdateFrame: 0
        };
        
        this.smartTurnState = {
            isAnalyzing: false,
            probability: 0,
            isEndpoint: false,
            lastAnalysisFrame: 0
        };
    }

    /**
     * Flush remaining buffers
     */
    flushBuffers() {
        if (this.sttBuffer.length > 0) {
            this.finalizeSTT();
        }
        
        this.resetState();
    }

    /**
     * Update processing metrics
     */
    updateProcessingMetrics(processingTime) {
        if (this.metrics.averageProcessingTime === 0) {
            this.metrics.averageProcessingTime = processingTime;
        } else {
            this.metrics.averageProcessingTime = (this.metrics.averageProcessingTime * 0.9) + (processingTime * 0.1);
        }
    }

    /**
     * Update and emit metrics
     */
    updateMetrics() {
        const metrics = {
            ...this.metrics,
            bufferSizes: {
                frame: this.frameBuffer.length,
                vad: this.vadBuffer.length,
                stt: this.sttBuffer.length,
                smartTurn: this.smartTurnBuffer.length
            },
            state: {
                vad: this.vadState,
                stt: this.sttState,
                smartTurn: this.smartTurnState
            }
        };
        
        this.emit('metrics', metrics);
    }

    /**
     * Get current status
     */
    getStatus() {
        return {
            isProcessing: this.isProcessing,
            sessionId: this.sessionId,
            frameCount: this.frameCount,
            metrics: this.metrics,
            bufferSizes: {
                frame: this.frameBuffer.length,
                vad: this.vadBuffer.length,
                stt: this.sttBuffer.length,
                smartTurn: this.smartTurnBuffer.length
            },
            state: {
                vad: this.vadState,
                stt: this.sttState,
                smartTurn: this.smartTurnState
            }
        };
    }
}

module.exports = FrameAudioProcessor;
