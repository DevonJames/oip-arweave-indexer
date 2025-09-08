/**
 * Real-Time Interruption Handler for ALFRED Voice Agent
 * 
 * This module implements sophisticated interruption handling capabilities,
 * including mid-speech interruption, audio crossfading, and conversation
 * flow management.
 * 
 * Key Features:
 * - Instant TTS interruption (<200ms response time)
 * - Smooth audio crossfading between speaking/listening
 * - Speaker state coordination to prevent self-interruption
 * - Context preservation during interruptions
 * - Natural conversation flow management
 */

const EventEmitter = require('events');

class RealtimeInterruptionHandler extends EventEmitter {
    constructor(options = {}) {
        super();
        
        // Configuration
        this.config = {
            // Interruption thresholds
            interruptionThreshold: 0.7,        // Confidence required for interruption
            temporalThreshold: 500,            // 500ms min before interruption allowed
            cooldownPeriod: 1000,              // 1s cooldown between interruptions
            
            // Audio crossfading
            crossfadeDuration: 150,            // 150ms crossfade
            fadeOutCurve: 'exponential',       // Fade curve type
            fadeInCurve: 'linear',
            
            // Response timing
            maxInterruptionLatency: 200,       // 200ms max interruption response
            processingTimeout: 100,            // 100ms processing timeout
            
            // Context preservation
            preserveContextFrames: 50,         // 1 second of context
            maxContextHistory: 10,             // 10 conversation turns
            
            ...options
        };
        
        // Audio management
        this.audioContext = null;
        this.currentTTSSource = null;
        this.currentTTSGain = null;
        this.audioQueue = [];
        
        // Speaker state management
        this.speakerState = {
            agentSpeaking: false,
            agentSpeechStartTime: null,
            userSpeaking: false,
            conversationTurn: 'user',  // 'user' or 'agent'
            lastInterruptionTime: null
        };
        
        // Interruption state
        this.interruptionState = {
            isInterrupting: false,
            interruptionStartTime: null,
            pendingInterruption: null,
            crossfadeInProgress: false
        };
        
        // Context preservation
        this.conversationContext = {
            currentUtterance: '',
            interruptedText: '',
            conversationHistory: [],
            audioContext: []
        };
        
        // Performance tracking
        this.metrics = {
            interruptionsHandled: 0,
            averageInterruptionLatency: 0,
            successfulInterruptions: 0,
            failedInterruptions: 0,
            crossfadeQuality: 'good'
        };
    }

    /**
     * Initialize the interruption handler
     */
    async initialize(audioContext) {
        try {
            console.log('[InterruptionHandler] Initializing real-time interruption handler...');
            
            this.audioContext = audioContext;
            
            // Setup audio processing nodes
            await this.setupAudioNodes();
            
            // Initialize speaker state
            this.resetSpeakerState();
            
            console.log('[InterruptionHandler] Interruption handler initialized successfully');
            this.emit('initialized');
            
        } catch (error) {
            console.error('[InterruptionHandler] Failed to initialize:', error);
            throw error;
        }
    }

    /**
     * Setup audio processing nodes for crossfading
     */
    async setupAudioNodes() {
        if (!this.audioContext) {
            throw new Error('Audio context required for interruption handling');
        }
        
        // Create master gain node for output control
        this.masterGain = this.audioContext.createGain();
        this.masterGain.connect(this.audioContext.destination);
        
        // Create crossfade controller
        this.crossfadeController = {
            currentSource: null,
            fadeOutGain: null,
            fadeInGain: null,
            isActive: false
        };
        
        console.log('[InterruptionHandler] Audio nodes setup complete');
    }

    /**
     * Handle potential interruption from Smart Turn analysis
     */
    async handlePotentialInterruption(smartTurnResult, audioFrame, transcript = null) {
        const startTime = Date.now();
        
        try {
            // Check if interruption is allowed
            if (!this.canInterrupt()) {
                return {
                    handled: false,
                    reason: 'interruption_not_allowed',
                    speakerState: this.speakerState
                };
            }
            
            // Analyze interruption confidence
            const shouldInterrupt = this.shouldInterrupt(smartTurnResult, audioFrame, transcript);
            
            if (shouldInterrupt.interrupt) {
                console.log(`[InterruptionHandler] Interruption triggered (confidence: ${smartTurnResult.probability})`);
                
                // Execute interruption
                const result = await this.executeInterruption(shouldInterrupt);
                
                // Update metrics
                const latency = Date.now() - startTime;
                this.updateInterruptionMetrics(latency, true);
                
                return {
                    handled: true,
                    latency: latency,
                    confidence: smartTurnResult.probability,
                    reason: shouldInterrupt.reason,
                    result: result
                };
            }
            
            return {
                handled: false,
                reason: 'confidence_too_low',
                confidence: smartTurnResult.probability,
                threshold: this.config.interruptionThreshold
            };
            
        } catch (error) {
            console.error('[InterruptionHandler] Interruption handling error:', error);
            this.updateInterruptionMetrics(Date.now() - startTime, false);
            
            return {
                handled: false,
                error: error.message
            };
        }
    }

    /**
     * Check if interruption is currently allowed
     */
    canInterrupt() {
        // Must be during agent speech
        if (!this.speakerState.agentSpeaking) {
            return false;
        }
        
        // Must have minimum speech duration
        if (this.speakerState.agentSpeechStartTime) {
            const elapsed = Date.now() - this.speakerState.agentSpeechStartTime;
            if (elapsed < this.config.temporalThreshold) {
                return false;
            }
        }
        
        // Must respect cooldown period
        if (this.speakerState.lastInterruptionTime) {
            const elapsed = Date.now() - this.speakerState.lastInterruptionTime;
            if (elapsed < this.config.cooldownPeriod) {
                return false;
            }
        }
        
        // Must not be already interrupting
        if (this.interruptionState.isInterrupting) {
            return false;
        }
        
        return true;
    }

    /**
     * Determine if we should interrupt based on analysis
     */
    shouldInterrupt(smartTurnResult, audioFrame, transcript) {
        const confidence = smartTurnResult.probability || 0;
        
        // Base confidence check
        if (confidence < this.config.interruptionThreshold) {
            return { interrupt: false, reason: 'low_confidence', confidence };
        }
        
        // Enhanced analysis based on context
        let adjustedConfidence = confidence;
        
        // Boost confidence for clear interruption indicators
        if (transcript) {
            const transcriptLower = transcript.toLowerCase();
            const interruptionKeywords = ['wait', 'stop', 'excuse me', 'actually', 'but'];
            const hasKeywords = interruptionKeywords.some(keyword => transcriptLower.includes(keyword));
            
            if (hasKeywords) {
                adjustedConfidence = Math.min(1.0, confidence + 0.2);
            }
        }
        
        // Consider audio energy
        if (audioFrame && audioFrame.energy > 0.05) {
            adjustedConfidence = Math.min(1.0, adjustedConfidence + 0.1);
        }
        
        const shouldInterrupt = adjustedConfidence > this.config.interruptionThreshold;
        
        return {
            interrupt: shouldInterrupt,
            confidence: adjustedConfidence,
            originalConfidence: confidence,
            reason: shouldInterrupt ? 'high_confidence_interruption' : 'adjusted_confidence_too_low'
        };
    }

    /**
     * Execute interruption with audio crossfading
     */
    async executeInterruption(interruptionDecision) {
        try {
            console.log('[InterruptionHandler] Executing interruption...');
            
            this.interruptionState.isInterrupting = true;
            this.interruptionState.interruptionStartTime = Date.now();
            
            // Step 1: Stop current TTS playback with crossfade
            const crossfadeResult = await this.crossfadeToListening();
            
            // Step 2: Update speaker state
            this.updateSpeakerStateForInterruption();
            
            // Step 3: Preserve conversation context
            this.preserveInterruptionContext();
            
            // Step 4: Notify all components of interruption
            this.notifyInterruption(interruptionDecision);
            
            console.log('[InterruptionHandler] Interruption executed successfully');
            
            return {
                success: true,
                crossfadeResult: crossfadeResult,
                timestamp: Date.now()
            };
            
        } catch (error) {
            console.error('[InterruptionHandler] Interruption execution failed:', error);
            this.interruptionState.isInterrupting = false;
            throw error;
        }
    }

    /**
     * Crossfade from TTS playback to listening mode
     */
    async crossfadeToListening() {
        try {
            console.log('[InterruptionHandler] Starting audio crossfade...');
            
            this.interruptionState.crossfadeInProgress = true;
            
            if (this.currentTTSSource && this.currentTTSGain) {
                // Fade out current TTS
                const fadeOutDuration = this.config.crossfadeDuration / 1000;
                const currentTime = this.audioContext.currentTime;
                
                // Exponential fade out for natural sound
                this.currentTTSGain.gain.setValueAtTime(1.0, currentTime);
                this.currentTTSGain.gain.exponentialRampToValueAtTime(0.001, currentTime + fadeOutDuration);
                
                // Stop source after fade
                setTimeout(() => {
                    if (this.currentTTSSource) {
                        this.currentTTSSource.stop();
                        this.currentTTSSource = null;
                    }
                    if (this.currentTTSGain) {
                        this.currentTTSGain.disconnect();
                        this.currentTTSGain = null;
                    }
                }, this.config.crossfadeDuration);
            }
            
            // Emit listening mode started
            this.emit('listeningModeStarted', {
                timestamp: Date.now(),
                crossfadeDuration: this.config.crossfadeDuration
            });
            
            setTimeout(() => {
                this.interruptionState.crossfadeInProgress = false;
                console.log('[InterruptionHandler] Audio crossfade completed');
            }, this.config.crossfadeDuration);
            
            return {
                success: true,
                fadeOutDuration: this.config.crossfadeDuration,
                timestamp: Date.now()
            };
            
        } catch (error) {
            console.error('[InterruptionHandler] Crossfade error:', error);
            this.interruptionState.crossfadeInProgress = false;
            throw error;
        }
    }

    /**
     * Update speaker state for interruption
     */
    updateSpeakerStateForInterruption() {
        this.speakerState.agentSpeaking = false;
        this.speakerState.agentSpeechStartTime = null;
        this.speakerState.userSpeaking = true;
        this.speakerState.conversationTurn = 'user';
        this.speakerState.lastInterruptionTime = Date.now();
        
        console.log('[InterruptionHandler] Speaker state updated for interruption');
    }

    /**
     * Preserve conversation context during interruption
     */
    preserveInterruptionContext() {
        // Save current utterance state
        if (this.conversationContext.currentUtterance) {
            this.conversationContext.interruptedText = this.conversationContext.currentUtterance;
            
            // Add to conversation history
            this.conversationContext.conversationHistory.push({
                type: 'interrupted',
                text: this.conversationContext.currentUtterance,
                timestamp: Date.now(),
                interruptionReason: 'user_interruption'
            });
        }
        
        // Clear current utterance
        this.conversationContext.currentUtterance = '';
        
        // Limit history size
        if (this.conversationContext.conversationHistory.length > this.config.maxContextHistory) {
            this.conversationContext.conversationHistory = 
                this.conversationContext.conversationHistory.slice(-this.config.maxContextHistory);
        }
        
        console.log('[InterruptionHandler] Conversation context preserved');
    }

    /**
     * Notify all components of interruption
     */
    notifyInterruption(interruptionDecision) {
        const interruptionEvent = {
            type: 'interruption',
            timestamp: Date.now(),
            confidence: interruptionDecision.confidence,
            reason: interruptionDecision.reason,
            speakerState: { ...this.speakerState },
            preservedContext: {
                interruptedText: this.conversationContext.interruptedText,
                conversationTurn: this.speakerState.conversationTurn
            }
        };
        
        // Emit to all listeners
        this.emit('interruption', interruptionEvent);
        
        // Emit specific events
        this.emit('ttsInterrupted', {
            interruptedText: this.conversationContext.interruptedText,
            timestamp: Date.now()
        });
        
        this.emit('userTurnStarted', {
            previousTurn: 'agent',
            timestamp: Date.now()
        });
        
        console.log('[InterruptionHandler] Interruption notifications sent');
    }

    /**
     * Start TTS playback with interruption monitoring
     */
    async startTTSPlayback(audioBuffer, metadata = {}) {
        try {
            console.log('[InterruptionHandler] Starting TTS playback with interruption monitoring...');
            
            // Update speaker state
            this.speakerState.agentSpeaking = true;
            this.speakerState.agentSpeechStartTime = Date.now();
            this.speakerState.conversationTurn = 'agent';
            this.speakerState.userSpeaking = false;
            
            // Store current utterance for context
            this.conversationContext.currentUtterance = metadata.text || '';
            
            // Create audio source
            const audioSource = this.audioContext.createBufferSource();
            const gainNode = this.audioContext.createGain();
            
            // Create audio buffer from data
            const audioBufferNode = await this.createAudioBuffer(audioBuffer);
            audioSource.buffer = audioBufferNode;
            
            // Connect audio chain
            audioSource.connect(gainNode);
            gainNode.connect(this.masterGain);
            
            // Store references for interruption
            this.currentTTSSource = audioSource;
            this.currentTTSGain = gainNode;
            
            // Setup playback completion handler
            audioSource.onended = () => {
                this.handleTTSPlaybackComplete();
            };
            
            // Start playback
            audioSource.start();
            
            // Emit TTS started event
            this.emit('ttsStarted', {
                timestamp: Date.now(),
                text: metadata.text,
                duration: audioBufferNode.duration,
                canBeInterrupted: true
            });
            
            console.log(`[InterruptionHandler] TTS playback started (${audioBufferNode.duration.toFixed(2)}s)`);
            
            return {
                success: true,
                duration: audioBufferNode.duration,
                canBeInterrupted: true
            };
            
        } catch (error) {
            console.error('[InterruptionHandler] TTS playback start error:', error);
            this.resetTTSState();
            throw error;
        }
    }

    /**
     * Handle TTS playback completion
     */
    handleTTSPlaybackComplete() {
        console.log('[InterruptionHandler] TTS playback completed naturally');
        
        // Update speaker state
        this.speakerState.agentSpeaking = false;
        this.speakerState.agentSpeechStartTime = null;
        this.speakerState.conversationTurn = 'user';
        
        // Clear TTS references
        this.currentTTSSource = null;
        this.currentTTSGain = null;
        
        // Add to conversation history
        if (this.conversationContext.currentUtterance) {
            this.conversationContext.conversationHistory.push({
                type: 'completed',
                text: this.conversationContext.currentUtterance,
                timestamp: Date.now()
            });
        }
        
        this.conversationContext.currentUtterance = '';
        
        // Emit completion event
        this.emit('ttsCompleted', {
            timestamp: Date.now(),
            reason: 'natural_completion'
        });
        
        // Reset interruption state
        this.interruptionState.isInterrupting = false;
    }

    /**
     * Create audio buffer from raw audio data
     */
    async createAudioBuffer(audioData) {
        try {
            // Determine audio format and decode
            let audioBuffer;
            
            if (audioData instanceof ArrayBuffer) {
                // Decode audio data
                audioBuffer = await this.audioContext.decodeAudioData(audioData);
            } else if (audioData instanceof AudioBuffer) {
                audioBuffer = audioData;
            } else {
                throw new Error('Unsupported audio data format');
            }
            
            return audioBuffer;
            
        } catch (error) {
            console.error('[InterruptionHandler] Audio buffer creation error:', error);
            throw error;
        }
    }

    /**
     * Reset TTS state after interruption or completion
     */
    resetTTSState() {
        this.currentTTSSource = null;
        this.currentTTSGain = null;
        this.speakerState.agentSpeaking = false;
        this.speakerState.agentSpeechStartTime = null;
    }

    /**
     * Reset speaker state
     */
    resetSpeakerState() {
        this.speakerState = {
            agentSpeaking: false,
            agentSpeechStartTime: null,
            userSpeaking: false,
            conversationTurn: 'user',
            lastInterruptionTime: null
        };
        
        this.interruptionState = {
            isInterrupting: false,
            interruptionStartTime: null,
            pendingInterruption: null,
            crossfadeInProgress: false
        };
    }

    /**
     * Update interruption metrics
     */
    updateInterruptionMetrics(latency, success) {
        this.metrics.interruptionsHandled++;
        
        if (success) {
            this.metrics.successfulInterruptions++;
            
            // Update average latency
            if (this.metrics.averageInterruptionLatency === 0) {
                this.metrics.averageInterruptionLatency = latency;
            } else {
                this.metrics.averageInterruptionLatency = 
                    (this.metrics.averageInterruptionLatency * 0.9) + (latency * 0.1);
            }
        } else {
            this.metrics.failedInterruptions++;
        }
        
        // Emit metrics update
        this.emit('metricsUpdate', this.metrics);
    }

    /**
     * Get current status
     */
    getStatus() {
        return {
            speakerState: this.speakerState,
            interruptionState: this.interruptionState,
            conversationContext: {
                currentUtterance: this.conversationContext.currentUtterance,
                hasInterruptedText: !!this.conversationContext.interruptedText,
                historyLength: this.conversationContext.conversationHistory.length
            },
            metrics: this.metrics,
            canInterrupt: this.canInterrupt()
        };
    }

    /**
     * Get conversation context for recovery
     */
    getConversationContext() {
        return {
            interruptedText: this.conversationContext.interruptedText,
            conversationHistory: this.conversationContext.conversationHistory.slice(-5), // Last 5 turns
            currentTurn: this.speakerState.conversationTurn
        };
    }

    /**
     * Clear interruption context (after successful recovery)
     */
    clearInterruptionContext() {
        this.conversationContext.interruptedText = '';
        console.log('[InterruptionHandler] Interruption context cleared');
    }

    /**
     * Emergency stop all audio
     */
    emergencyStop() {
        console.log('[InterruptionHandler] Emergency stop triggered');
        
        try {
            // Stop current TTS immediately
            if (this.currentTTSSource) {
                this.currentTTSSource.stop();
                this.currentTTSSource = null;
            }
            
            if (this.currentTTSGain) {
                this.currentTTSGain.disconnect();
                this.currentTTSGain = null;
            }
            
            // Reset all state
            this.resetSpeakerState();
            
            this.emit('emergencyStop', { timestamp: Date.now() });
            
        } catch (error) {
            console.error('[InterruptionHandler] Emergency stop error:', error);
        }
    }

    /**
     * Cleanup and disconnect
     */
    cleanup() {
        console.log('[InterruptionHandler] Cleaning up interruption handler...');
        
        // Stop any ongoing audio
        this.emergencyStop();
        
        // Clear all references
        this.audioContext = null;
        this.currentTTSSource = null;
        this.currentTTSGain = null;
        
        // Reset state
        this.resetSpeakerState();
        
        this.emit('cleanup', { timestamp: Date.now() });
    }
}

module.exports = RealtimeInterruptionHandler;
