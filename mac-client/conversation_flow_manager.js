/**
 * Conversation Flow Manager for ALFRED Voice Agent
 * 
 * This module manages the complete conversation flow including turn-taking,
 * interruption handling, context preservation, and state coordination
 * across all voice processing components.
 * 
 * Key Features:
 * - Turn-taking state machine
 * - Conversation context management
 * - Interruption recovery and resumption
 * - Multi-modal input handling (voice + text)
 * - Natural conversation flow patterns
 */

const EventEmitter = require('events');
const RealtimeInterruptionHandler = require('./realtime_interruption_handler');

class ConversationFlowManager extends EventEmitter {
    constructor(options = {}) {
        super();
        
        // Configuration
        this.config = {
            // Turn-taking timing
            maxUserTurnDuration: 30000,        // 30s max user turn
            maxAgentTurnDuration: 60000,       // 60s max agent turn
            turnTransitionDelay: 100,          // 100ms transition delay
            
            // Context management
            maxConversationHistory: 20,        // 20 conversation turns
            contextPreservationTime: 300000,   // 5 minutes context retention
            
            // Interruption handling
            interruptionRecoveryDelay: 500,    // 500ms delay before recovery
            maxInterruptionRecoveryAttempts: 3,
            
            // Response coordination
            backendResponseTimeout: 30000,     // 30s backend timeout
            ttsGenerationTimeout: 15000,       // 15s TTS timeout
            
            ...options
        };
        
        // Components
        this.interruptionHandler = new RealtimeInterruptionHandler(options.interruption || {});
        this.frameProcessor = null;
        this.webrtcPipeline = null;
        
        // Conversation state machine
        this.conversationState = {
            currentTurn: 'user',               // 'user', 'agent', 'transition'
            turnStartTime: null,
            turnDuration: 0,
            isProcessing: false,
            awaitingResponse: false
        };
        
        // Conversation history
        this.conversationHistory = [];
        
        // Turn management
        this.turnManager = {
            userTurnActive: false,
            agentTurnActive: false,
            turnTransitionInProgress: false,
            pendingAgentResponse: null
        };
        
        // Interruption recovery
        this.recoveryState = {
            hasInterruptedContent: false,
            interruptedText: '',
            recoveryAttempts: 0,
            lastRecoveryTime: null
        };
        
        // Performance metrics
        this.metrics = {
            totalTurns: 0,
            userTurns: 0,
            agentTurns: 0,
            interruptions: 0,
            averageTurnDuration: 0,
            averageResponseTime: 0,
            successfulRecoveries: 0,
            conversationDuration: 0
        };
        
        this.conversationStartTime = null;
        
        this.setupEventHandlers();
    }

    /**
     * Initialize conversation flow manager
     */
    async initialize(frameProcessor, webrtcPipeline, audioContext) {
        try {
            console.log('[ConversationFlow] Initializing conversation flow manager...');
            
            this.frameProcessor = frameProcessor;
            this.webrtcPipeline = webrtcPipeline;
            
            // Initialize interruption handler
            await this.interruptionHandler.initialize(audioContext);
            
            // Setup component event handlers
            this.setupComponentEventHandlers();
            
            // Initialize conversation
            this.startConversation();
            
            console.log('[ConversationFlow] Conversation flow manager initialized successfully');
            this.emit('initialized');
            
        } catch (error) {
            console.error('[ConversationFlow] Failed to initialize:', error);
            throw error;
        }
    }

    /**
     * Setup event handlers for components
     */
    setupComponentEventHandlers() {
        // Frame processor events
        if (this.frameProcessor) {
            this.frameProcessor.on('speechStart', (data) => {
                this.handleUserSpeechStart(data);
            });
            
            this.frameProcessor.on('speechEnd', (data) => {
                this.handleUserSpeechEnd(data);
            });
            
            this.frameProcessor.on('partialTranscription', (data) => {
                this.handlePartialTranscription(data);
            });
            
            this.frameProcessor.on('finalTranscription', (data) => {
                this.handleFinalTranscription(data);
            });
            
            this.frameProcessor.on('endpointDetected', (data) => {
                this.handleEndpointDetection(data);
            });
        }
        
        // Interruption handler events
        this.interruptionHandler.on('interruption', (data) => {
            this.handleInterruption(data);
        });
        
        this.interruptionHandler.on('ttsStarted', (data) => {
            this.handleTTSStarted(data);
        });
        
        this.interruptionHandler.on('ttsCompleted', (data) => {
            this.handleTTSCompleted(data);
        });
        
        this.interruptionHandler.on('ttsInterrupted', (data) => {
            this.handleTTSInterrupted(data);
        });
    }

    /**
     * Setup internal event handlers
     */
    setupEventHandlers() {
        // Handle turn timeouts
        this.on('turnTimeout', (data) => {
            this.handleTurnTimeout(data);
        });
        
        // Handle backend responses
        this.on('backendResponse', (data) => {
            this.handleBackendResponse(data);
        });
    }

    /**
     * Start a new conversation
     */
    startConversation() {
        console.log('[ConversationFlow] Starting new conversation...');
        
        this.conversationStartTime = Date.now();
        this.conversationState.currentTurn = 'user';
        this.conversationState.turnStartTime = Date.now();
        this.conversationState.isProcessing = false;
        
        // Reset all state
        this.turnManager.userTurnActive = false;
        this.turnManager.agentTurnActive = false;
        this.turnManager.turnTransitionInProgress = false;
        
        this.emit('conversationStarted', {
            timestamp: Date.now(),
            initialTurn: 'user'
        });
    }

    /**
     * Handle user speech start
     */
    handleUserSpeechStart(data) {
        console.log(`[ConversationFlow] User speech started (frame: ${data.frameIndex})`);
        
        // Check if this is an interruption
        if (this.conversationState.currentTurn === 'agent') {
            console.log('[ConversationFlow] Potential interruption detected during agent turn');
            
            // Let the interruption handler decide
            // The actual interruption will be handled by handleInterruption()
            return;
        }
        
        // Normal user turn start
        if (!this.turnManager.userTurnActive) {
            this.startUserTurn();
        }
    }

    /**
     * Handle user speech end
     */
    handleUserSpeechEnd(data) {
        console.log(`[ConversationFlow] User speech ended (frame: ${data.frameIndex})`);
        
        // Don't end turn immediately - wait for final transcription
        // The turn will end when we get the final transcription
    }

    /**
     * Handle partial transcription
     */
    handlePartialTranscription(data) {
        console.log(`[ConversationFlow] Partial transcription: "${data.text}"`);
        
        // Emit for real-time display
        this.emit('partialUserInput', {
            text: data.text,
            confidence: data.confidence,
            timestamp: Date.now()
        });
    }

    /**
     * Handle final transcription
     */
    async handleFinalTranscription(data) {
        console.log(`[ConversationFlow] Final transcription: "${data.text}"`);
        
        if (!data.text.trim()) {
            console.log('[ConversationFlow] Empty transcription, ignoring');
            return;
        }
        
        // Add to conversation history
        this.addToConversationHistory('user', data.text);
        
        // End user turn and start processing
        this.endUserTurn();
        
        // Send to backend for processing
        await this.processUserInput(data.text);
    }

    /**
     * Handle endpoint detection
     */
    handleEndpointDetection(data) {
        console.log(`[ConversationFlow] Endpoint detected (confidence: ${data.confidence})`);
        
        if (this.conversationState.currentTurn === 'agent' && this.conversationState.agentSpeaking) {
            // This might be an interruption
            this.checkForInterruption(data);
        }
    }

    /**
     * Check for interruption and trigger if needed
     */
    async checkForInterruption(endpointData) {
        try {
            // Get latest frame data for analysis
            const frameData = this.frameProcessor ? this.frameProcessor.getLatestFrame() : null;
            const transcript = this.frameProcessor ? this.frameProcessor.getPartialTranscript() : null;
            
            // Use interruption handler to analyze
            const result = await this.interruptionHandler.handlePotentialInterruption(
                endpointData, 
                frameData, 
                transcript
            );
            
            if (result.handled) {
                console.log(`[ConversationFlow] Interruption handled (latency: ${result.latency}ms)`);
            }
            
        } catch (error) {
            console.error('[ConversationFlow] Interruption check error:', error);
        }
    }

    /**
     * Handle successful interruption
     */
    handleInterruption(data) {
        console.log(`[ConversationFlow] Handling interruption (confidence: ${data.confidence})`);
        
        // Update conversation state
        this.conversationState.currentTurn = 'user';
        this.conversationState.turnStartTime = Date.now();
        
        // Update turn manager
        this.turnManager.agentTurnActive = false;
        this.turnManager.userTurnActive = true;
        this.turnManager.turnTransitionInProgress = false;
        
        // Update metrics
        this.metrics.interruptions++;
        
        // Store interrupted content for potential recovery
        if (data.preservedContext && data.preservedContext.interruptedText) {
            this.recoveryState.hasInterruptedContent = true;
            this.recoveryState.interruptedText = data.preservedContext.interruptedText;
            this.recoveryState.recoveryAttempts = 0;
        }
        
        // Emit interruption event
        this.emit('userInterrupted', {
            timestamp: Date.now(),
            confidence: data.confidence,
            preservedContext: data.preservedContext,
            canRecover: this.recoveryState.hasInterruptedContent
        });
        
        // Start new user turn
        this.startUserTurn();
    }

    /**
     * Start user turn
     */
    startUserTurn() {
        console.log('[ConversationFlow] Starting user turn...');
        
        this.conversationState.currentTurn = 'user';
        this.conversationState.turnStartTime = Date.now();
        this.conversationState.isProcessing = false;
        
        this.turnManager.userTurnActive = true;
        this.turnManager.agentTurnActive = false;
        this.turnManager.turnTransitionInProgress = false;
        
        this.metrics.userTurns++;
        this.metrics.totalTurns++;
        
        // Setup turn timeout
        this.setupTurnTimeout('user');
        
        this.emit('userTurnStarted', {
            timestamp: Date.now(),
            turnNumber: this.metrics.totalTurns
        });
    }

    /**
     * End user turn
     */
    endUserTurn() {
        console.log('[ConversationFlow] Ending user turn...');
        
        const turnDuration = Date.now() - this.conversationState.turnStartTime;
        this.conversationState.turnDuration = turnDuration;
        
        this.turnManager.userTurnActive = false;
        this.turnManager.turnTransitionInProgress = true;
        
        // Update metrics
        this.updateTurnMetrics('user', turnDuration);
        
        this.emit('userTurnEnded', {
            timestamp: Date.now(),
            duration: turnDuration
        });
    }

    /**
     * Process user input through backend
     */
    async processUserInput(text) {
        try {
            console.log(`[ConversationFlow] Processing user input: "${text}"`);
            
            this.conversationState.isProcessing = true;
            this.conversationState.awaitingResponse = true;
            
            const startTime = Date.now();
            
            // Emit processing started
            this.emit('processingStarted', {
                userInput: text,
                timestamp: Date.now()
            });
            
            // Send to backend (this would integrate with your existing backend)
            const response = await this.sendToBackend(text);
            
            const processingTime = Date.now() - startTime;
            
            // Update metrics
            this.updateResponseMetrics(processingTime);
            
            // Start agent turn with response
            await this.startAgentTurn(response);
            
        } catch (error) {
            console.error('[ConversationFlow] User input processing error:', error);
            this.handleProcessingError(error);
        }
    }

    /**
     * Send user input to backend for processing
     */
    async sendToBackend(text) {
        try {
            // This would integrate with your existing backend API
            // For now, simulate backend processing
            
            console.log('[ConversationFlow] Sending to backend for LLM/RAG processing...');
            
            // Simulate processing delay
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Return simulated response
            return {
                text: `I heard you say: "${text}". This is a simulated response from the backend LLM/RAG system.`,
                confidence: 0.95,
                sources: [],
                processingTime: 1000
            };
            
        } catch (error) {
            console.error('[ConversationFlow] Backend communication error:', error);
            throw error;
        }
    }

    /**
     * Start agent turn with response
     */
    async startAgentTurn(response) {
        try {
            console.log(`[ConversationFlow] Starting agent turn with response: "${response.text}"`);
            
            // Update conversation state
            this.conversationState.currentTurn = 'agent';
            this.conversationState.turnStartTime = Date.now();
            this.conversationState.isProcessing = false;
            this.conversationState.awaitingResponse = false;
            
            // Update turn manager
            this.turnManager.agentTurnActive = true;
            this.turnManager.userTurnActive = false;
            this.turnManager.turnTransitionInProgress = false;
            
            // Add to conversation history
            this.addToConversationHistory('agent', response.text);
            
            // Update metrics
            this.metrics.agentTurns++;
            this.metrics.totalTurns++;
            
            // Setup turn timeout
            this.setupTurnTimeout('agent');
            
            // Generate TTS and start playback with interruption monitoring
            await this.generateAndPlayTTS(response.text);
            
            this.emit('agentTurnStarted', {
                timestamp: Date.now(),
                response: response.text,
                turnNumber: this.metrics.totalTurns
            });
            
        } catch (error) {
            console.error('[ConversationFlow] Agent turn start error:', error);
            this.handleProcessingError(error);
        }
    }

    /**
     * Generate TTS and start playback with interruption monitoring
     */
    async generateAndPlayTTS(text) {
        try {
            console.log('[ConversationFlow] Generating TTS for agent response...');
            
            // This would integrate with your TTS backend
            // For now, simulate TTS generation
            const ttsAudio = await this.generateTTS(text);
            
            // Start playback with interruption monitoring
            await this.interruptionHandler.startTTSPlayback(ttsAudio, { text });
            
        } catch (error) {
            console.error('[ConversationFlow] TTS generation/playback error:', error);
            // Fall back to text-only response
            this.emit('ttsError', {
                error: error.message,
                fallbackText: text,
                timestamp: Date.now()
            });
        }
    }

    /**
     * Generate TTS audio (placeholder for backend integration)
     */
    async generateTTS(text) {
        try {
            console.log('[ConversationFlow] Requesting TTS from backend...');
            
            // This would call your backend TTS service
            // For now, return a placeholder
            
            // Simulate TTS generation delay
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Return placeholder audio buffer
            const duration = text.length * 0.05; // Rough estimate: 50ms per character
            const sampleRate = 16000;
            const samples = Math.floor(duration * sampleRate);
            
            // Create simple tone for testing
            const audioBuffer = new AudioBuffer({
                numberOfChannels: 1,
                length: samples,
                sampleRate: sampleRate
            });
            
            const channelData = audioBuffer.getChannelData(0);
            for (let i = 0; i < samples; i++) {
                channelData[i] = Math.sin(2 * Math.PI * 440 * i / sampleRate) * 0.1; // 440Hz tone
            }
            
            return audioBuffer;
            
        } catch (error) {
            console.error('[ConversationFlow] TTS generation error:', error);
            throw error;
        }
    }

    /**
     * Handle TTS started
     */
    handleTTSStarted(data) {
        console.log('[ConversationFlow] TTS playback started');
        
        this.emit('agentSpeakingStarted', {
            timestamp: data.timestamp,
            text: data.text,
            duration: data.duration,
            canBeInterrupted: data.canBeInterrupted
        });
    }

    /**
     * Handle TTS completed
     */
    handleTTSCompleted(data) {
        console.log('[ConversationFlow] TTS playback completed');
        
        // End agent turn
        this.endAgentTurn();
        
        this.emit('agentSpeakingEnded', {
            timestamp: data.timestamp,
            reason: data.reason
        });
    }

    /**
     * Handle TTS interrupted
     */
    handleTTSInterrupted(data) {
        console.log('[ConversationFlow] TTS playback interrupted');
        
        // Store interrupted content for potential recovery
        if (data.interruptedText) {
            this.recoveryState.hasInterruptedContent = true;
            this.recoveryState.interruptedText = data.interruptedText;
        }
        
        // End agent turn immediately
        this.endAgentTurn();
        
        this.emit('agentSpeakingInterrupted', {
            timestamp: data.timestamp,
            interruptedText: data.interruptedText,
            canRecover: this.recoveryState.hasInterruptedContent
        });
    }

    /**
     * End agent turn
     */
    endAgentTurn() {
        console.log('[ConversationFlow] Ending agent turn...');
        
        const turnDuration = Date.now() - this.conversationState.turnStartTime;
        this.conversationState.turnDuration = turnDuration;
        
        this.turnManager.agentTurnActive = false;
        this.turnManager.turnTransitionInProgress = true;
        
        // Update metrics
        this.updateTurnMetrics('agent', turnDuration);
        
        // Transition to user turn
        setTimeout(() => {
            this.startUserTurn();
        }, this.config.turnTransitionDelay);
        
        this.emit('agentTurnEnded', {
            timestamp: Date.now(),
            duration: turnDuration
        });
    }

    /**
     * Add message to conversation history
     */
    addToConversationHistory(role, text) {
        const message = {
            role: role,
            text: text,
            timestamp: Date.now(),
            turnNumber: this.metrics.totalTurns
        };
        
        this.conversationHistory.push(message);
        
        // Limit history size
        if (this.conversationHistory.length > this.config.maxConversationHistory) {
            this.conversationHistory = this.conversationHistory.slice(-this.config.maxConversationHistory);
        }
        
        this.emit('conversationHistoryUpdated', {
            message: message,
            historyLength: this.conversationHistory.length
        });
    }

    /**
     * Setup turn timeout monitoring
     */
    setupTurnTimeout(turnType) {
        const timeout = turnType === 'user' ? 
            this.config.maxUserTurnDuration : 
            this.config.maxAgentTurnDuration;
        
        setTimeout(() => {
            if (this.conversationState.currentTurn === turnType) {
                this.emit('turnTimeout', {
                    turnType: turnType,
                    duration: Date.now() - this.conversationState.turnStartTime,
                    timestamp: Date.now()
                });
            }
        }, timeout);
    }

    /**
     * Handle turn timeout
     */
    handleTurnTimeout(data) {
        console.warn(`[ConversationFlow] Turn timeout: ${data.turnType} (${data.duration}ms)`);
        
        if (data.turnType === 'user') {
            // Force end user turn
            this.endUserTurn();
        } else if (data.turnType === 'agent') {
            // Force end agent turn
            this.interruptionHandler.emergencyStop();
            this.endAgentTurn();
        }
        
        this.emit('turnTimedOut', data);
    }

    /**
     * Update turn metrics
     */
    updateTurnMetrics(turnType, duration) {
        if (this.metrics.averageTurnDuration === 0) {
            this.metrics.averageTurnDuration = duration;
        } else {
            this.metrics.averageTurnDuration = 
                (this.metrics.averageTurnDuration * 0.9) + (duration * 0.1);
        }
        
        this.metrics.conversationDuration = Date.now() - this.conversationStartTime;
    }

    /**
     * Update response time metrics
     */
    updateResponseMetrics(processingTime) {
        if (this.metrics.averageResponseTime === 0) {
            this.metrics.averageResponseTime = processingTime;
        } else {
            this.metrics.averageResponseTime = 
                (this.metrics.averageResponseTime * 0.9) + (processingTime * 0.1);
        }
    }

    /**
     * Handle processing errors
     */
    handleProcessingError(error) {
        console.error('[ConversationFlow] Processing error:', error);
        
        this.conversationState.isProcessing = false;
        this.conversationState.awaitingResponse = false;
        
        // Return to user turn
        this.startUserTurn();
        
        this.emit('processingError', {
            error: error.message,
            timestamp: Date.now()
        });
    }

    /**
     * Get current conversation status
     */
    getStatus() {
        return {
            conversationState: this.conversationState,
            turnManager: this.turnManager,
            recoveryState: this.recoveryState,
            metrics: this.metrics,
            conversationHistory: this.conversationHistory.slice(-5), // Last 5 messages
            interruptionHandler: this.interruptionHandler.getStatus()
        };
    }

    /**
     * Get conversation history
     */
    getConversationHistory(limit = 10) {
        return this.conversationHistory.slice(-limit);
    }

    /**
     * Cleanup conversation flow manager
     */
    cleanup() {
        console.log('[ConversationFlow] Cleaning up conversation flow manager...');
        
        // Cleanup interruption handler
        if (this.interruptionHandler) {
            this.interruptionHandler.cleanup();
        }
        
        // Clear all state
        this.conversationHistory = [];
        this.conversationStartTime = null;
        
        this.emit('cleanup', { timestamp: Date.now() });
    }
}

module.exports = ConversationFlowManager;
