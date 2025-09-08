/**
 * Unified Pipeline Coordinator for ALFRED Voice Agent
 * 
 * This module coordinates all voice processing components in a single
 * optimized pipeline, eliminating IPC overhead and providing centralized
 * state management and performance monitoring.
 * 
 * Key Features:
 * - Single coordinated process for all voice processing
 * - Shared memory and state management
 * - Optimized frame-level processing pipeline
 * - Centralized performance monitoring
 * - Graceful degradation under load
 */

const EventEmitter = require('events');
const axios = require('axios');

class UnifiedPipelineCoordinator extends EventEmitter {
    constructor(options = {}) {
        super();
        
        // Configuration
        this.config = {
            // Service configuration
            unifiedProcessorUrl: options.unifiedProcessorUrl || 'http://localhost:8015',
            backendUrl: options.backendUrl || 'https://api.oip.onl',
            
            // Pipeline optimization
            maxConcurrentSessions: 10,
            frameProcessingBatchSize: 5,
            maxFrameQueueSize: 250,  // 5 seconds at 50fps
            
            // Performance targets
            targetFrameProcessingTime: 20,    // 20ms per frame
            targetPipelineLatency: 100,       // 100ms end-to-end
            maxMemoryUsageMB: 500,            // 500MB max memory
            
            // Backpressure handling
            enableBackpressure: true,
            backpressureThreshold: 0.8,       // 80% of max capacity
            degradationSteps: ['reduce_quality', 'drop_frames', 'pause_processing'],
            
            ...options
        };
        
        // Pipeline state
        this.pipelineState = {
            isRunning: false,
            sessionsActive: 0,
            framesInQueue: 0,
            processingLoad: 0,
            memoryUsage: 0,
            health: 'healthy'  // 'healthy', 'stressed', 'overloaded', 'failed'
        };
        
        // Session management
        this.activeSessions = new Map();  // sessionId -> session state
        this.sessionMetrics = new Map();  // sessionId -> performance metrics
        
        // Frame processing queue
        this.frameQueue = [];
        this.processingInProgress = false;
        
        // Performance monitoring
        this.performanceMonitor = {
            frameProcessingTimes: [],
            pipelineLatencies: [],
            memorySnapshots: [],
            errorCounts: 0,
            warningCounts: 0
        };
        
        // Backpressure management
        this.backpressureState = {
            isActive: false,
            currentLevel: 0,  // 0 = no pressure, 1 = max pressure
            degradationActions: [],
            lastDegradationTime: null
        };
        
        // Component references
        this.conversationFlows = new Map();  // sessionId -> ConversationFlowManager
        this.interruptionHandlers = new Map();  // sessionId -> RealtimeInterruptionHandler
        
        this.setupPerformanceMonitoring();
    }

    /**
     * Initialize the unified pipeline coordinator
     */
    async initialize() {
        try {
            console.log('[UnifiedPipeline] Initializing unified pipeline coordinator...');
            
            // Check unified processor availability
            await this.checkUnifiedProcessor();
            
            // Start pipeline processing
            this.startPipelineProcessing();
            
            // Start performance monitoring
            this.startPerformanceMonitoring();
            
            this.pipelineState.isRunning = true;
            
            console.log('[UnifiedPipeline] Unified pipeline coordinator initialized successfully');
            this.emit('initialized');
            
        } catch (error) {
            console.error('[UnifiedPipeline] Failed to initialize:', error);
            throw error;
        }
    }

    /**
     * Check unified processor availability
     */
    async checkUnifiedProcessor() {
        try {
            const response = await axios.get(`${this.config.unifiedProcessorUrl}/health`, {
                timeout: 5000
            });
            
            if (response.data.status === 'healthy') {
                console.log('[UnifiedPipeline] Unified processor is healthy');
                return true;
            } else {
                throw new Error(`Unified processor unhealthy: ${response.data.status}`);
            }
            
        } catch (error) {
            console.error('[UnifiedPipeline] Unified processor check failed:', error);
            throw new Error(`Unified processor unavailable: ${error.message}`);
        }
    }

    /**
     * Create new session with optimized components
     */
    async createSession(sessionId, audioContext = null) {
        try {
            console.log(`[UnifiedPipeline] Creating optimized session: ${sessionId}`);
            
            // Check session limits
            if (this.activeSessions.size >= this.config.maxConcurrentSessions) {
                throw new Error('Maximum concurrent sessions reached');
            }
            
            // Create session state
            const session = {
                id: sessionId,
                createdAt: Date.now(),
                lastActivity: Date.now(),
                frameCount: 0,
                
                // Processing state
                isActive: true,
                processingQueue: [],
                
                // Performance tracking
                metrics: {
                    framesProcessed: 0,
                    averageLatency: 0,
                    transcriptionsCompleted: 0,
                    interruptionsHandled: 0,
                    errorCount: 0
                }
            };
            
            this.activeSessions.set(sessionId, session);
            this.sessionMetrics.set(sessionId, session.metrics);
            
            // Create conversation flow manager for this session
            const ConversationFlowManager = require('./conversation_flow_manager');
            const conversationFlow = new ConversationFlowManager({
                sessionId: sessionId,
                backendUrl: this.config.backendUrl,
                unifiedPipeline: true
            });
            
            this.conversationFlows.set(sessionId, conversationFlow);
            
            // Create interruption handler for this session
            const RealtimeInterruptionHandler = require('./realtime_interruption_handler');
            const interruptionHandler = new RealtimeInterruptionHandler({
                sessionId: sessionId,
                unifiedPipeline: true
            });
            
            if (audioContext) {
                await interruptionHandler.initialize(audioContext);
            }
            
            this.interruptionHandlers.set(sessionId, interruptionHandler);
            
            // Setup session event handlers
            this.setupSessionEventHandlers(sessionId, conversationFlow, interruptionHandler);
            
            // Update pipeline state
            this.pipelineState.sessionsActive = this.activeSessions.size;
            
            console.log(`[UnifiedPipeline] Session ${sessionId} created with optimized components`);
            this.emit('sessionCreated', { sessionId, timestamp: Date.now() });
            
            return session;
            
        } catch (error) {
            console.error(`[UnifiedPipeline] Failed to create session ${sessionId}:`, error);
            throw error;
        }
    }

    /**
     * Setup event handlers for session components
     */
    setupSessionEventHandlers(sessionId, conversationFlow, interruptionHandler) {
        // Conversation flow events
        conversationFlow.on('userTurnStarted', (data) => {
            this.emit('sessionEvent', { sessionId, type: 'userTurnStarted', data });
        });
        
        conversationFlow.on('agentTurnStarted', (data) => {
            this.emit('sessionEvent', { sessionId, type: 'agentTurnStarted', data });
        });
        
        conversationFlow.on('userInterrupted', (data) => {
            this.emit('sessionEvent', { sessionId, type: 'interruption', data });
            this.updateSessionMetrics(sessionId, 'interruption');
        });
        
        // Interruption handler events
        interruptionHandler.on('ttsStarted', (data) => {
            // Notify unified processor of agent speaking state
            this.setAgentSpeakingState(sessionId, true);
            this.emit('sessionEvent', { sessionId, type: 'ttsStarted', data });
        });
        
        interruptionHandler.on('ttsCompleted', (data) => {
            this.setAgentSpeakingState(sessionId, false);
            this.emit('sessionEvent', { sessionId, type: 'ttsCompleted', data });
        });
        
        interruptionHandler.on('ttsInterrupted', (data) => {
            this.setAgentSpeakingState(sessionId, false);
            this.emit('sessionEvent', { sessionId, type: 'ttsInterrupted', data });
        });
        
        // Performance monitoring
        interruptionHandler.on('metricsUpdate', (metrics) => {
            this.updateSessionMetrics(sessionId, 'interruption_metrics', metrics);
        });
    }

    /**
     * Process audio frame through unified pipeline
     */
    async processAudioFrame(sessionId, audioData, timestamp = Date.now()) {
        try {
            const startTime = Date.now();
            
            // Check session exists
            const session = this.activeSessions.get(sessionId);
            if (!session) {
                throw new Error(`Session ${sessionId} not found`);
            }
            
            // Update session activity
            session.lastActivity = Date.now();
            session.frameCount++;
            
            // Check backpressure
            if (this.backpressureState.isActive) {
                const shouldDrop = await this.handleBackpressure(sessionId);
                if (shouldDrop) {
                    return { status: 'dropped', reason: 'backpressure' };
                }
            }
            
            // Send to unified processor
            const FormData = require('form-data');
            const formData = new FormData();
            
            // Convert audio data to buffer if needed
            let audioBuffer;
            if (audioData instanceof Buffer) {
                audioBuffer = audioData;
            } else if (audioData instanceof Float32Array) {
                // Convert Float32Array to 16-bit PCM
                const buffer = Buffer.alloc(audioData.length * 2);
                for (let i = 0; i < audioData.length; i++) {
                    const sample = Math.max(-1, Math.min(1, audioData[i]));
                    buffer.writeInt16LE(sample * 32767, i * 2);
                }
                audioBuffer = buffer;
            } else {
                throw new Error('Invalid audio data format');
            }
            
            formData.append('audio_file', audioBuffer, {
                filename: 'frame.wav',
                contentType: 'audio/wav'
            });
            formData.append('session_id', sessionId);
            
            // Send to unified processor
            const response = await axios.post(
                `${this.config.unifiedProcessorUrl}/process_frame`,
                formData,
                {
                    headers: formData.getHeaders(),
                    timeout: 1000  // 1 second timeout for frame processing
                }
            );
            
            // Update metrics
            const processingTime = Date.now() - startTime;
            this.updateFrameMetrics(sessionId, processingTime);
            
            return {
                status: 'processed',
                sessionId: sessionId,
                frameIndex: session.frameCount,
                processingTime: processingTime,
                result: response.data
            };
            
        } catch (error) {
            console.error(`[UnifiedPipeline] Frame processing error for ${sessionId}:`, error);
            this.updateSessionMetrics(sessionId, 'error');
            throw error;
        }
    }

    /**
     * Set agent speaking state in unified processor
     */
    async setAgentSpeakingState(sessionId, isSpeaking) {
        try {
            await axios.post(`${this.config.unifiedProcessorUrl}/set_speaker_state`, {
                session_id: sessionId,
                agent_speaking: isSpeaking
            }, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 1000
            });
            
            console.log(`[UnifiedPipeline] Agent speaking state updated: ${sessionId} -> ${isSpeaking}`);
            
        } catch (error) {
            console.error(`[UnifiedPipeline] Failed to update speaker state for ${sessionId}:`, error);
        }
    }

    /**
     * Start pipeline processing loop
     */
    startPipelineProcessing() {
        console.log('[UnifiedPipeline] Starting optimized pipeline processing...');
        
        // Process frames in batches for efficiency
        setInterval(() => {
            this.processPipelineBatch();
        }, 10);  // Every 10ms
        
        // Monitor pipeline health
        setInterval(() => {
            this.monitorPipelineHealth();
        }, 1000);  // Every second
        
        // Cleanup inactive sessions
        setInterval(() => {
            this.cleanupInactiveSessions();
        }, 30000);  // Every 30 seconds
    }

    /**
     * Process pipeline batch for optimization
     */
    async processPipelineBatch() {
        if (this.processingInProgress || this.frameQueue.length === 0) {
            return;
        }
        
        this.processingInProgress = true;
        
        try {
            // Process frames in batches
            const batchSize = Math.min(this.config.frameProcessingBatchSize, this.frameQueue.length);
            const batch = this.frameQueue.splice(0, batchSize);
            
            // Process each frame in the batch
            const processingPromises = batch.map(async (frameData) => {
                try {
                    return await this.processAudioFrame(
                        frameData.sessionId, 
                        frameData.audioData, 
                        frameData.timestamp
                    );
                } catch (error) {
                    console.error(`[UnifiedPipeline] Batch frame processing error:`, error);
                    return { status: 'error', error: error.message };
                }
            });
            
            // Wait for all frames to process
            await Promise.all(processingPromises);
            
        } catch (error) {
            console.error('[UnifiedPipeline] Batch processing error:', error);
        } finally {
            this.processingInProgress = false;
        }
    }

    /**
     * Monitor pipeline health and performance
     */
    monitorPipelineHealth() {
        try {
            // Calculate current metrics
            const currentTime = Date.now();
            const activeSessionCount = this.activeSessions.size;
            const queueSize = this.frameQueue.length;
            
            // Update pipeline state
            this.pipelineState.sessionsActive = activeSessionCount;
            this.pipelineState.framesInQueue = queueSize;
            
            // Calculate processing load
            const maxCapacity = this.config.maxConcurrentSessions * 50;  // 50 fps per session
            const currentLoad = (queueSize / maxCapacity) * 100;
            this.pipelineState.processingLoad = currentLoad;
            
            // Determine health status
            if (currentLoad > 90) {
                this.pipelineState.health = 'overloaded';
                this.triggerBackpressure();
            } else if (currentLoad > 70) {
                this.pipelineState.health = 'stressed';
            } else {
                this.pipelineState.health = 'healthy';
                this.releaseBackpressure();
            }
            
            // Emit health update
            this.emit('pipelineHealthUpdate', {
                state: this.pipelineState,
                timestamp: currentTime
            });
            
            // Log health issues
            if (this.pipelineState.health !== 'healthy') {
                console.warn(`[UnifiedPipeline] Pipeline health: ${this.pipelineState.health} (load: ${currentLoad.toFixed(1)}%)`);
            }
            
        } catch (error) {
            console.error('[UnifiedPipeline] Health monitoring error:', error);
        }
    }

    /**
     * Trigger backpressure handling
     */
    triggerBackpressure() {
        if (this.backpressureState.isActive) {
            return;  // Already active
        }
        
        console.warn('[UnifiedPipeline] Triggering backpressure handling...');
        
        this.backpressureState.isActive = true;
        this.backpressureState.lastDegradationTime = Date.now();
        
        // Apply degradation steps
        this.applyDegradationSteps();
        
        this.emit('backpressureTriggered', {
            processingLoad: this.pipelineState.processingLoad,
            queueSize: this.pipelineState.framesInQueue,
            timestamp: Date.now()
        });
    }

    /**
     * Apply performance degradation steps
     */
    applyDegradationSteps() {
        const loadLevel = this.pipelineState.processingLoad / 100;
        this.backpressureState.currentLevel = loadLevel;
        
        this.backpressureState.degradationActions = [];
        
        if (loadLevel > 0.9) {
            // Critical load - aggressive measures
            this.backpressureState.degradationActions.push('drop_frames');
            this.config.frameProcessingBatchSize = 2;  // Reduce batch size
        } else if (loadLevel > 0.8) {
            // High load - moderate measures
            this.backpressureState.degradationActions.push('reduce_quality');
            this.config.frameProcessingBatchSize = 3;
        }
        
        console.log(`[UnifiedPipeline] Applied degradation: ${this.backpressureState.degradationActions.join(', ')}`);
    }

    /**
     * Release backpressure handling
     */
    releaseBackpressure() {
        if (!this.backpressureState.isActive) {
            return;
        }
        
        console.log('[UnifiedPipeline] Releasing backpressure...');
        
        this.backpressureState.isActive = false;
        this.backpressureState.currentLevel = 0;
        this.backpressureState.degradationActions = [];
        
        // Restore normal processing parameters
        this.config.frameProcessingBatchSize = 5;
        
        this.emit('backpressureReleased', {
            timestamp: Date.now()
        });
    }

    /**
     * Handle backpressure for specific session
     */
    async handleBackpressure(sessionId) {
        const session = this.activeSessions.get(sessionId);
        if (!session) return false;
        
        // Drop frames based on degradation level
        if (this.backpressureState.degradationActions.includes('drop_frames')) {
            // Drop every other frame under high load
            if (session.frameCount % 2 === 0) {
                console.log(`[UnifiedPipeline] Dropping frame for session ${sessionId} due to backpressure`);
                return true;
            }
        }
        
        return false;
    }

    /**
     * Update frame processing metrics
     */
    updateFrameMetrics(sessionId, processingTime) {
        const session = this.activeSessions.get(sessionId);
        if (!session) return;
        
        // Update session metrics
        session.metrics.framesProcessed++;
        session.metrics.averageLatency = (
            session.metrics.averageLatency * 0.9 + processingTime * 0.1
        );
        
        // Update global performance monitoring
        this.performanceMonitor.frameProcessingTimes.push(processingTime);
        if (this.performanceMonitor.frameProcessingTimes.length > 1000) {
            this.performanceMonitor.frameProcessingTimes = 
                this.performanceMonitor.frameProcessingTimes.slice(-500);
        }
        
        // Check for performance issues
        if (processingTime > this.config.targetFrameProcessingTime * 2) {
            console.warn(`[UnifiedPipeline] High frame processing time: ${processingTime}ms for session ${sessionId}`);
            this.performanceMonitor.warningCounts++;
        }
    }

    /**
     * Update session metrics
     */
    updateSessionMetrics(sessionId, metricType, data = null) {
        const session = this.activeSessions.get(sessionId);
        if (!session) return;
        
        session.lastActivity = Date.now();
        
        switch (metricType) {
            case 'transcription':
                session.metrics.transcriptionsCompleted++;
                break;
                
            case 'interruption':
                session.metrics.interruptionsHandled++;
                break;
                
            case 'error':
                session.metrics.errorCount++;
                this.performanceMonitor.errorCounts++;
                break;
                
            case 'interruption_metrics':
                if (data) {
                    // Update detailed interruption metrics
                    session.interruptionMetrics = data;
                }
                break;
        }
    }

    /**
     * Cleanup inactive sessions
     */
    cleanupInactiveSessions() {
        const now = Date.now();
        const timeout = 5 * 60 * 1000;  // 5 minutes
        
        for (const [sessionId, session] of this.activeSessions.entries()) {
            if (now - session.lastActivity > timeout) {
                console.log(`[UnifiedPipeline] Cleaning up inactive session: ${sessionId}`);
                this.removeSession(sessionId);
            }
        }
    }

    /**
     * Remove session and cleanup resources
     */
    async removeSession(sessionId) {
        try {
            // Cleanup conversation flow
            const conversationFlow = this.conversationFlows.get(sessionId);
            if (conversationFlow) {
                conversationFlow.cleanup();
                this.conversationFlows.delete(sessionId);
            }
            
            // Cleanup interruption handler
            const interruptionHandler = this.interruptionHandlers.get(sessionId);
            if (interruptionHandler) {
                interruptionHandler.cleanup();
                this.interruptionHandlers.delete(sessionId);
            }
            
            // Remove session data
            this.activeSessions.delete(sessionId);
            this.sessionMetrics.delete(sessionId);
            
            // Cleanup session in unified processor
            try {
                await axios.delete(`${this.config.unifiedProcessorUrl}/session/${sessionId}`, {
                    timeout: 2000
                });
            } catch (error) {
                console.warn(`[UnifiedPipeline] Failed to cleanup session in processor: ${error.message}`);
            }
            
            // Update pipeline state
            this.pipelineState.sessionsActive = this.activeSessions.size;
            
            console.log(`[UnifiedPipeline] Session ${sessionId} removed and cleaned up`);
            this.emit('sessionRemoved', { sessionId, timestamp: Date.now() });
            
        } catch (error) {
            console.error(`[UnifiedPipeline] Error removing session ${sessionId}:`, error);
        }
    }

    /**
     * Setup performance monitoring
     */
    setupPerformanceMonitoring() {
        // Monitor memory usage
        setInterval(() => {
            const memUsage = process.memoryUsage();
            const memoryMB = memUsage.heapUsed / 1024 / 1024;
            
            this.pipelineState.memoryUsage = memoryMB;
            this.performanceMonitor.memorySnapshots.push(memoryMB);
            
            if (this.performanceMonitor.memorySnapshots.length > 60) {
                this.performanceMonitor.memorySnapshots = 
                    this.performanceMonitor.memorySnapshots.slice(-30);
            }
            
            // Check memory limits
            if (memoryMB > this.config.maxMemoryUsageMB) {
                console.warn(`[UnifiedPipeline] High memory usage: ${memoryMB.toFixed(1)}MB`);
                this.triggerMemoryOptimization();
            }
            
        }, 5000);  // Every 5 seconds
    }

    /**
     * Start performance monitoring thread
     */
    startPerformanceMonitoring() {
        setInterval(() => {
            this.collectPerformanceMetrics();
        }, 1000);  // Every second
    }

    /**
     * Collect comprehensive performance metrics
     */
    async collectPerformanceMetrics() {
        try {
            // Get unified processor metrics
            const processorResponse = await axios.get(`${this.config.unifiedProcessorUrl}/metrics`, {
                timeout: 2000
            });
            
            const processorMetrics = processorResponse.data;
            
            // Combine with coordinator metrics
            const combinedMetrics = {
                coordinator: {
                    activeSessions: this.activeSessions.size,
                    frameQueueSize: this.frameQueue.length,
                    processingLoad: this.pipelineState.processingLoad,
                    memoryUsage: this.pipelineState.memoryUsage,
                    health: this.pipelineState.health
                },
                processor: processorMetrics,
                performance: {
                    averageFrameTime: this.calculateAverageFrameTime(),
                    throughputFPS: this.calculateThroughput(),
                    errorRate: this.calculateErrorRate(),
                    uptime: Date.now() - this.startTime
                }
            };
            
            this.emit('metricsUpdate', combinedMetrics);
            
        } catch (error) {
            console.warn('[UnifiedPipeline] Metrics collection error:', error.message);
        }
    }

    /**
     * Calculate average frame processing time
     */
    calculateAverageFrameTime() {
        if (this.performanceMonitor.frameProcessingTimes.length === 0) {
            return 0;
        }
        
        const times = this.performanceMonitor.frameProcessingTimes.slice(-100);  // Last 100 frames
        return times.reduce((sum, time) => sum + time, 0) / times.length;
    }

    /**
     * Calculate pipeline throughput
     */
    calculateThroughput() {
        const uptime = (Date.now() - this.startTime) / 1000;  // seconds
        const totalFrames = Array.from(this.sessionMetrics.values())
            .reduce((sum, metrics) => sum + metrics.framesProcessed, 0);
        
        return uptime > 0 ? totalFrames / uptime : 0;
    }

    /**
     * Calculate error rate
     */
    calculateErrorRate() {
        const totalFrames = Array.from(this.sessionMetrics.values())
            .reduce((sum, metrics) => sum + metrics.framesProcessed, 0);
        
        return totalFrames > 0 ? 
            (this.performanceMonitor.errorCounts / totalFrames) * 100 : 0;
    }

    /**
     * Trigger memory optimization
     */
    triggerMemoryOptimization() {
        console.log('[UnifiedPipeline] Triggering memory optimization...');
        
        // Clear old performance data
        this.performanceMonitor.frameProcessingTimes = 
            this.performanceMonitor.frameProcessingTimes.slice(-100);
        this.performanceMonitor.pipelineLatencies = 
            this.performanceMonitor.pipelineLatencies.slice(-100);
        this.performanceMonitor.memorySnapshots = 
            this.performanceMonitor.memorySnapshots.slice(-30);
        
        // Force garbage collection if available
        if (global.gc) {
            global.gc();
            console.log('[UnifiedPipeline] Forced garbage collection');
        }
        
        this.emit('memoryOptimized', {
            memoryBefore: this.pipelineState.memoryUsage,
            timestamp: Date.now()
        });
    }

    /**
     * Get unified pipeline status
     */
    getStatus() {
        return {
            pipelineState: this.pipelineState,
            backpressureState: this.backpressureState,
            activeSessions: Array.from(this.activeSessions.keys()),
            sessionMetrics: Object.fromEntries(this.sessionMetrics),
            performanceMonitor: {
                averageFrameTime: this.calculateAverageFrameTime(),
                throughput: this.calculateThroughput(),
                errorRate: this.calculateErrorRate(),
                memoryTrend: this.performanceMonitor.memorySnapshots.slice(-10)
            },
            config: this.config
        };
    }

    /**
     * Shutdown unified pipeline
     */
    async shutdown() {
        console.log('[UnifiedPipeline] Shutting down unified pipeline...');
        
        this.pipelineState.isRunning = false;
        
        // Cleanup all sessions
        for (const sessionId of this.activeSessions.keys()) {
            await this.removeSession(sessionId);
        }
        
        // Clear processing queue
        this.frameQueue = [];
        
        this.emit('shutdown', { timestamp: Date.now() });
        
        console.log('[UnifiedPipeline] Unified pipeline shutdown complete');
    }
}

module.exports = UnifiedPipelineCoordinator;
