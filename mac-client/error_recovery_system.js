/**
 * Error Recovery System for ALFRED Voice Interface
 * 
 * This module provides comprehensive error handling, graceful fallbacks,
 * and automatic recovery mechanisms for the voice interface.
 * 
 * Key Features:
 * - Automatic error detection and classification
 * - Graceful fallback mechanisms
 * - User-friendly error messages
 * - Automatic recovery attempts
 * - Performance monitoring and alerting
 */

const EventEmitter = require('events');

class ErrorRecoverySystem extends EventEmitter {
    constructor(options = {}) {
        super();
        
        // Configuration
        this.config = {
            // Recovery settings
            maxRetryAttempts: 3,
            retryDelay: 2000,              // 2 seconds
            exponentialBackoff: true,
            maxRetryDelay: 30000,          // 30 seconds max
            
            // Fallback settings
            enableWebSocketFallback: true,
            enableLocalProcessingFallback: true,
            enableOfflineMode: false,
            
            // User notification settings
            showTechnicalDetails: options.debug || false,
            autoHideSuccessMessages: 3000,  // 3 seconds
            autoHideErrorMessages: 5000,    // 5 seconds
            
            // Performance monitoring
            errorThreshold: 5,              // 5 errors per minute threshold
            performanceThreshold: {
                latency: 1000,              // 1 second max latency
                memoryUsage: 500,           // 500MB max memory
                errorRate: 10               // 10% max error rate
            },
            
            ...options
        };
        
        // Error tracking
        this.errorHistory = [];
        this.errorCounts = new Map();
        this.lastErrors = new Map(); // errorType -> lastOccurrence
        
        // Recovery state
        this.recoveryState = {
            isRecovering: false,
            currentAttempt: 0,
            lastRecoveryTime: null,
            fallbacksActive: new Set(),
            offlineMode: false
        };
        
        // Performance monitoring
        this.performanceMonitor = {
            errorRate: 0,
            averageLatency: 0,
            memoryUsage: 0,
            lastHealthCheck: Date.now()
        };
        
        // User interface elements
        this.uiElements = {
            errorBanner: null,
            successBanner: null,
            statusIndicator: null,
            recoveryIndicator: null
        };
        
        this.setupErrorTypes();
        this.startPerformanceMonitoring();
    }

    /**
     * Setup error type definitions
     */
    setupErrorTypes() {
        this.errorTypes = {
            // Connection errors
            CONNECTION_FAILED: {
                severity: 'high',
                userMessage: 'Connection to voice services failed',
                technicalMessage: 'WebRTC or WebSocket connection failed',
                fallbacks: ['websocket_fallback', 'retry_connection'],
                autoRetry: true
            },
            
            CONNECTION_LOST: {
                severity: 'high',
                userMessage: 'Connection lost unexpectedly',
                technicalMessage: 'Network connection interrupted',
                fallbacks: ['auto_reconnect', 'websocket_fallback'],
                autoRetry: true
            },
            
            // Audio processing errors
            MICROPHONE_ACCESS_DENIED: {
                severity: 'critical',
                userMessage: 'Microphone access is required for voice interaction',
                technicalMessage: 'getUserMedia permission denied',
                fallbacks: ['text_only_mode'],
                autoRetry: false
            },
            
            AUDIO_PROCESSING_FAILED: {
                severity: 'medium',
                userMessage: 'Audio processing encountered an issue',
                technicalMessage: 'Frame processing or STT service error',
                fallbacks: ['reduce_quality', 'retry_processing'],
                autoRetry: true
            },
            
            // Service errors
            STT_SERVICE_UNAVAILABLE: {
                severity: 'high',
                userMessage: 'Speech recognition service is temporarily unavailable',
                technicalMessage: 'STT service not responding',
                fallbacks: ['local_stt_fallback', 'text_input_mode'],
                autoRetry: true
            },
            
            SMART_TURN_SERVICE_UNAVAILABLE: {
                severity: 'medium',
                userMessage: 'Interruption detection may be limited',
                technicalMessage: 'Smart Turn service not responding',
                fallbacks: ['basic_endpoint_detection'],
                autoRetry: true
            },
            
            BACKEND_SERVICE_UNAVAILABLE: {
                severity: 'high',
                userMessage: 'AI response service is temporarily unavailable',
                technicalMessage: 'Backend LLM/RAG service not responding',
                fallbacks: ['cached_responses', 'offline_mode'],
                autoRetry: true
            },
            
            // Performance errors
            HIGH_LATENCY: {
                severity: 'medium',
                userMessage: 'Voice responses may be slower than usual',
                technicalMessage: 'Processing latency above threshold',
                fallbacks: ['reduce_quality', 'optimize_performance'],
                autoRetry: false
            },
            
            MEMORY_EXHAUSTION: {
                severity: 'high',
                userMessage: 'System resources are running low',
                technicalMessage: 'Memory usage above safe threshold',
                fallbacks: ['cleanup_resources', 'reduce_features'],
                autoRetry: false
            },
            
            // User interaction errors
            INTERRUPTION_FAILED: {
                severity: 'low',
                userMessage: 'Unable to interrupt at this time',
                technicalMessage: 'Interruption detection or execution failed',
                fallbacks: ['manual_stop', 'wait_for_completion'],
                autoRetry: true
            },
            
            TTS_PLAYBACK_FAILED: {
                severity: 'medium',
                userMessage: 'Audio playback encountered an issue',
                technicalMessage: 'TTS audio playback or crossfading failed',
                fallbacks: ['text_only_response', 'retry_playback'],
                autoRetry: true
            }
        };
    }

    /**
     * Handle error with automatic recovery
     */
    async handleError(errorType, error, context = {}) {
        const startTime = Date.now();
        
        try {
            console.error(`[ErrorRecovery] Handling error: ${errorType}`, error);
            
            // Record error
            this.recordError(errorType, error, context);
            
            // Get error definition
            const errorDef = this.errorTypes[errorType];
            if (!errorDef) {
                console.warn(`[ErrorRecovery] Unknown error type: ${errorType}`);
                return this.handleUnknownError(error, context);
            }
            
            // Show user notification
            this.showErrorNotification(errorDef, error, context);
            
            // Attempt automatic recovery
            let recoveryResult = null;
            if (errorDef.autoRetry && !this.recoveryState.isRecovering) {
                recoveryResult = await this.attemptRecovery(errorType, errorDef, context);
            }
            
            // Apply fallbacks if recovery failed
            if (!recoveryResult || !recoveryResult.success) {
                await this.applyFallbacks(errorType, errorDef, context);
            }
            
            // Update performance metrics
            const recoveryTime = Date.now() - startTime;
            this.updateErrorMetrics(errorType, recoveryTime, recoveryResult?.success || false);
            
            // Emit error event
            this.emit('errorHandled', {
                errorType,
                error: error.message || error,
                context,
                recoveryTime,
                recoverySuccess: recoveryResult?.success || false,
                fallbacksApplied: this.recoveryState.fallbacksActive
            });
            
        } catch (recoveryError) {
            console.error('[ErrorRecovery] Error recovery failed:', recoveryError);
            this.handleCriticalError(errorType, error, recoveryError);
        }
    }

    /**
     * Record error for tracking and analysis
     */
    recordError(errorType, error, context) {
        const errorRecord = {
            type: errorType,
            message: error.message || error.toString(),
            timestamp: Date.now(),
            context: context,
            stack: error.stack || null
        };
        
        this.errorHistory.push(errorRecord);
        
        // Update error counts
        const count = this.errorCounts.get(errorType) || 0;
        this.errorCounts.set(errorType, count + 1);
        this.lastErrors.set(errorType, Date.now());
        
        // Limit history size
        if (this.errorHistory.length > 100) {
            this.errorHistory = this.errorHistory.slice(-50);
        }
    }

    /**
     * Show user-friendly error notification
     */
    showErrorNotification(errorDef, error, context) {
        const userMessage = errorDef.userMessage;
        const technicalMessage = this.config.showTechnicalDetails ? 
            `${errorDef.technicalMessage}: ${error.message || error}` : null;
        
        // Show in UI
        this.showErrorBanner(userMessage, technicalMessage, errorDef.severity);
        
        // Log for debugging
        console.log(`[ErrorRecovery] User notification: ${userMessage}`);
        if (technicalMessage) {
            console.log(`[ErrorRecovery] Technical details: ${technicalMessage}`);
        }
    }

    /**
     * Attempt automatic recovery
     */
    async attemptRecovery(errorType, errorDef, context) {
        if (this.recoveryState.isRecovering) {
            console.log('[ErrorRecovery] Recovery already in progress');
            return { success: false, reason: 'recovery_in_progress' };
        }
        
        this.recoveryState.isRecovering = true;
        this.recoveryState.currentAttempt = 0;
        this.recoveryState.lastRecoveryTime = Date.now();
        
        console.log(`[ErrorRecovery] Starting recovery for ${errorType}...`);
        this.showRecoveryIndicator(true);
        
        try {
            // Try recovery with exponential backoff
            for (let attempt = 1; attempt <= this.config.maxRetryAttempts; attempt++) {
                this.recoveryState.currentAttempt = attempt;
                
                console.log(`[ErrorRecovery] Recovery attempt ${attempt}/${this.config.maxRetryAttempts}`);
                
                // Wait before retry (with exponential backoff)
                if (attempt > 1) {
                    const delay = this.config.exponentialBackoff ? 
                        Math.min(this.config.retryDelay * Math.pow(2, attempt - 1), this.config.maxRetryDelay) :
                        this.config.retryDelay;
                    
                    console.log(`[ErrorRecovery] Waiting ${delay}ms before retry...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
                
                // Attempt specific recovery
                const recoveryResult = await this.executeRecovery(errorType, context);
                
                if (recoveryResult.success) {
                    console.log(`[ErrorRecovery] Recovery successful on attempt ${attempt}`);
                    this.showSuccessNotification('Connection restored successfully!');
                    this.showRecoveryIndicator(false);
                    this.recoveryState.isRecovering = false;
                    return recoveryResult;
                }
                
                console.warn(`[ErrorRecovery] Recovery attempt ${attempt} failed: ${recoveryResult.reason}`);
            }
            
            // All recovery attempts failed
            console.error(`[ErrorRecovery] All recovery attempts failed for ${errorType}`);
            this.showRecoveryIndicator(false);
            this.recoveryState.isRecovering = false;
            
            return { 
                success: false, 
                reason: 'max_attempts_exceeded',
                attemptsUsed: this.config.maxRetryAttempts
            };
            
        } catch (recoveryError) {
            console.error('[ErrorRecovery] Recovery process error:', recoveryError);
            this.showRecoveryIndicator(false);
            this.recoveryState.isRecovering = false;
            throw recoveryError;
        }
    }

    /**
     * Execute specific recovery based on error type
     */
    async executeRecovery(errorType, context) {
        switch (errorType) {
            case 'CONNECTION_FAILED':
            case 'CONNECTION_LOST':
                return await this.recoverConnection(context);
                
            case 'STT_SERVICE_UNAVAILABLE':
                return await this.recoverSTTService(context);
                
            case 'SMART_TURN_SERVICE_UNAVAILABLE':
                return await this.recoverSmartTurnService(context);
                
            case 'BACKEND_SERVICE_UNAVAILABLE':
                return await this.recoverBackendService(context);
                
            case 'AUDIO_PROCESSING_FAILED':
                return await this.recoverAudioProcessing(context);
                
            default:
                return { success: false, reason: 'no_recovery_method' };
        }
    }

    /**
     * Recover WebRTC/WebSocket connection
     */
    async recoverConnection(context) {
        try {
            // Test connection to services
            const axios = require('axios');
            
            // Check unified processor
            await axios.get('http://localhost:8015/health', { timeout: 5000 });
            
            // Check WebRTC signaling
            await axios.get('http://localhost:3003/health', { timeout: 5000 }).catch(() => {
                // WebRTC server might not have health endpoint
                console.log('[ErrorRecovery] WebRTC server health check skipped');
            });
            
            console.log('[ErrorRecovery] Services are available, attempting reconnection...');
            
            // Services are available, try to reconnect
            // This would trigger a reconnection in the main interface
            this.emit('recoveryAction', {
                action: 'reconnect',
                type: 'connection',
                context
            });
            
            return { success: true, method: 'reconnection' };
            
        } catch (error) {
            console.warn('[ErrorRecovery] Connection recovery failed:', error.message);
            return { success: false, reason: 'services_unavailable' };
        }
    }

    /**
     * Recover STT service
     */
    async recoverSTTService(context) {
        try {
            const axios = require('axios');
            
            // Test STT service
            const response = await axios.get('http://localhost:8015/health', { timeout: 5000 });
            
            if (response.data.status === 'healthy') {
                console.log('[ErrorRecovery] STT service recovered');
                return { success: true, method: 'service_recovery' };
            } else {
                return { success: false, reason: 'service_unhealthy' };
            }
            
        } catch (error) {
            console.warn('[ErrorRecovery] STT service recovery failed:', error.message);
            return { success: false, reason: 'service_unavailable' };
        }
    }

    /**
     * Recover Smart Turn service
     */
    async recoverSmartTurnService(context) {
        try {
            const axios = require('axios');
            
            // Test Smart Turn functionality through unified processor
            const response = await axios.get('http://localhost:8015/health', { timeout: 5000 });
            
            if (response.data.status === 'healthy') {
                console.log('[ErrorRecovery] Smart Turn service recovered');
                return { success: true, method: 'service_recovery' };
            } else {
                return { success: false, reason: 'service_unhealthy' };
            }
            
        } catch (error) {
            console.warn('[ErrorRecovery] Smart Turn service recovery failed:', error.message);
            return { success: false, reason: 'service_unavailable' };
        }
    }

    /**
     * Recover backend service
     */
    async recoverBackendService(context) {
        try {
            const axios = require('axios');
            
            // Test backend connectivity
            const backendUrl = context.backendUrl || 'https://api.oip.onl';
            const response = await axios.get(`${backendUrl}/health`, { timeout: 10000 });
            
            console.log('[ErrorRecovery] Backend service recovered');
            return { success: true, method: 'backend_recovery' };
            
        } catch (error) {
            console.warn('[ErrorRecovery] Backend service recovery failed:', error.message);
            return { success: false, reason: 'backend_unavailable' };
        }
    }

    /**
     * Recover audio processing
     */
    async recoverAudioProcessing(context) {
        try {
            // Restart audio context if needed
            this.emit('recoveryAction', {
                action: 'restart_audio',
                type: 'audio_processing',
                context
            });
            
            console.log('[ErrorRecovery] Audio processing recovery initiated');
            return { success: true, method: 'audio_restart' };
            
        } catch (error) {
            console.warn('[ErrorRecovery] Audio processing recovery failed:', error.message);
            return { success: false, reason: 'audio_restart_failed' };
        }
    }

    /**
     * Apply fallback mechanisms
     */
    async applyFallbacks(errorType, errorDef, context) {
        console.log(`[ErrorRecovery] Applying fallbacks for ${errorType}...`);
        
        for (const fallback of errorDef.fallbacks) {
            try {
                const result = await this.executeFallback(fallback, context);
                
                if (result.success) {
                    this.recoveryState.fallbacksActive.add(fallback);
                    console.log(`[ErrorRecovery] Fallback applied successfully: ${fallback}`);
                    
                    this.showInfoNotification(
                        `Using fallback mode: ${this.getFallbackDescription(fallback)}`
                    );
                    
                    this.emit('fallbackApplied', {
                        fallback,
                        errorType,
                        context,
                        result
                    });
                    
                    return result;
                }
                
            } catch (fallbackError) {
                console.warn(`[ErrorRecovery] Fallback ${fallback} failed:`, fallbackError.message);
            }
        }
        
        console.error(`[ErrorRecovery] All fallbacks failed for ${errorType}`);
        return { success: false, reason: 'all_fallbacks_failed' };
    }

    /**
     * Execute specific fallback mechanism
     */
    async executeFallback(fallbackType, context) {
        switch (fallbackType) {
            case 'websocket_fallback':
                return await this.executeWebSocketFallback(context);
                
            case 'text_only_mode':
                return await this.executeTextOnlyMode(context);
                
            case 'local_stt_fallback':
                return await this.executeLocalSTTFallback(context);
                
            case 'basic_endpoint_detection':
                return await this.executeBasicEndpointDetection(context);
                
            case 'cached_responses':
                return await this.executeCachedResponses(context);
                
            case 'reduce_quality':
                return await this.executeReduceQuality(context);
                
            case 'cleanup_resources':
                return await this.executeCleanupResources(context);
                
            default:
                console.warn(`[ErrorRecovery] Unknown fallback type: ${fallbackType}`);
                return { success: false, reason: 'unknown_fallback' };
        }
    }

    /**
     * Execute WebSocket fallback
     */
    async executeWebSocketFallback(context) {
        if (!this.config.enableWebSocketFallback) {
            return { success: false, reason: 'fallback_disabled' };
        }
        
        console.log('[ErrorRecovery] Executing WebSocket fallback...');
        
        this.emit('recoveryAction', {
            action: 'enable_websocket_fallback',
            type: 'connection',
            context
        });
        
        return { success: true, method: 'websocket_fallback' };
    }

    /**
     * Execute text-only mode
     */
    async executeTextOnlyMode(context) {
        console.log('[ErrorRecovery] Executing text-only mode...');
        
        this.emit('recoveryAction', {
            action: 'enable_text_only_mode',
            type: 'interface',
            context
        });
        
        return { success: true, method: 'text_only_mode' };
    }

    /**
     * Execute resource cleanup
     */
    async executeCleanupResources(context) {
        console.log('[ErrorRecovery] Executing resource cleanup...');
        
        // Trigger garbage collection if available
        if (typeof global !== 'undefined' && global.gc) {
            global.gc();
        }
        
        this.emit('recoveryAction', {
            action: 'cleanup_resources',
            type: 'performance',
            context
        });
        
        return { success: true, method: 'resource_cleanup' };
    }

    /**
     * Get fallback description for user
     */
    getFallbackDescription(fallbackType) {
        const descriptions = {
            'websocket_fallback': 'Standard connection mode',
            'text_only_mode': 'Text-based interaction',
            'local_stt_fallback': 'Local speech recognition',
            'basic_endpoint_detection': 'Simplified interruption detection',
            'cached_responses': 'Offline response mode',
            'reduce_quality': 'Reduced processing quality',
            'cleanup_resources': 'Memory optimization'
        };
        
        return descriptions[fallbackType] || 'Alternative processing mode';
    }

    /**
     * Show error banner in UI
     */
    showErrorBanner(message, technicalDetails = null, severity = 'medium') {
        // This would integrate with the UI to show error banners
        const errorEvent = {
            type: 'error',
            message,
            technicalDetails,
            severity,
            timestamp: Date.now(),
            autoHide: this.config.autoHideErrorMessages
        };
        
        this.emit('showError', errorEvent);
        
        console.log(`[ErrorRecovery] Error banner: ${message}`);
    }

    /**
     * Show success notification
     */
    showSuccessNotification(message) {
        const successEvent = {
            type: 'success',
            message,
            timestamp: Date.now(),
            autoHide: this.config.autoHideSuccessMessages
        };
        
        this.emit('showSuccess', successEvent);
        
        console.log(`[ErrorRecovery] Success notification: ${message}`);
    }

    /**
     * Show info notification
     */
    showInfoNotification(message) {
        const infoEvent = {
            type: 'info',
            message,
            timestamp: Date.now(),
            autoHide: 4000 // 4 seconds for info messages
        };
        
        this.emit('showInfo', infoEvent);
        
        console.log(`[ErrorRecovery] Info notification: ${message}`);
    }

    /**
     * Show recovery indicator
     */
    showRecoveryIndicator(show, message = 'Attempting to recover...') {
        this.emit('showRecovery', {
            show,
            message,
            attempt: this.recoveryState.currentAttempt,
            maxAttempts: this.config.maxRetryAttempts
        });
    }

    /**
     * Start performance monitoring
     */
    startPerformanceMonitoring() {
        setInterval(() => {
            this.checkPerformanceThresholds();
        }, 10000); // Check every 10 seconds
        
        setInterval(() => {
            this.cleanupErrorHistory();
        }, 60000); // Cleanup every minute
    }

    /**
     * Check performance thresholds
     */
    checkPerformanceThresholds() {
        const now = Date.now();
        const timeSinceLastCheck = now - this.performanceMonitor.lastHealthCheck;
        
        // Calculate error rate (errors per minute)
        const recentErrors = this.errorHistory.filter(
            error => now - error.timestamp < 60000
        ).length;
        
        this.performanceMonitor.errorRate = recentErrors;
        
        // Check error rate threshold
        if (recentErrors > this.config.errorThreshold) {
            this.handleError('HIGH_ERROR_RATE', new Error(`${recentErrors} errors in last minute`), {
                errorRate: recentErrors,
                threshold: this.config.errorThreshold
            });
        }
        
        this.performanceMonitor.lastHealthCheck = now;
    }

    /**
     * Cleanup old error history
     */
    cleanupErrorHistory() {
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        
        this.errorHistory = this.errorHistory.filter(
            error => now - error.timestamp < maxAge
        );
        
        console.log(`[ErrorRecovery] Cleaned up error history, ${this.errorHistory.length} entries remaining`);
    }

    /**
     * Handle critical errors that can't be recovered
     */
    handleCriticalError(originalErrorType, originalError, recoveryError) {
        console.error('[ErrorRecovery] Critical error - recovery system failed:', {
            originalError: originalErrorType,
            recoveryError: recoveryError.message
        });
        
        // Show critical error notification
        this.showErrorBanner(
            'A critical error occurred. Please refresh the page to restart ALFRED.',
            `Original: ${originalErrorType}, Recovery: ${recoveryError.message}`,
            'critical'
        );
        
        // Emit critical error event
        this.emit('criticalError', {
            originalErrorType,
            originalError: originalError.message || originalError,
            recoveryError: recoveryError.message,
            timestamp: Date.now(),
            requiresManualIntervention: true
        });
    }

    /**
     * Handle unknown errors
     */
    handleUnknownError(error, context) {
        console.error('[ErrorRecovery] Unknown error encountered:', error);
        
        this.showErrorBanner(
            'An unexpected error occurred',
            this.config.showTechnicalDetails ? error.message : null,
            'medium'
        );
        
        return { success: false, reason: 'unknown_error_type' };
    }

    /**
     * Update error metrics
     */
    updateErrorMetrics(errorType, recoveryTime, success) {
        // Update recovery time metrics
        if (this.performanceMonitor.averageLatency === 0) {
            this.performanceMonitor.averageLatency = recoveryTime;
        } else {
            this.performanceMonitor.averageLatency = 
                (this.performanceMonitor.averageLatency * 0.9) + (recoveryTime * 0.1);
        }
        
        // Log metrics
        console.log(`[ErrorRecovery] Error metrics updated: ${errorType}, recovery: ${recoveryTime}ms, success: ${success}`);
    }

    /**
     * Get error statistics
     */
    getErrorStats() {
        const now = Date.now();
        const last24h = this.errorHistory.filter(e => now - e.timestamp < 24 * 60 * 60 * 1000);
        const lastHour = this.errorHistory.filter(e => now - e.timestamp < 60 * 60 * 1000);
        
        // Count by type
        const errorsByType = {};
        for (const [type, count] of this.errorCounts.entries()) {
            errorsByType[type] = count;
        }
        
        return {
            totalErrors: this.errorHistory.length,
            errorsLast24h: last24h.length,
            errorsLastHour: lastHour.length,
            errorsByType,
            averageRecoveryTime: this.performanceMonitor.averageLatency,
            activeFallbacks: Array.from(this.recoveryState.fallbacksActive),
            isRecovering: this.recoveryState.isRecovering,
            lastRecoveryTime: this.recoveryState.lastRecoveryTime
        };
    }

    /**
     * Reset error tracking
     */
    resetErrorTracking() {
        this.errorHistory = [];
        this.errorCounts.clear();
        this.lastErrors.clear();
        this.recoveryState.fallbacksActive.clear();
        
        console.log('[ErrorRecovery] Error tracking reset');
    }

    /**
     * Get current status
     */
    getStatus() {
        return {
            recoveryState: this.recoveryState,
            performanceMonitor: this.performanceMonitor,
            errorStats: this.getErrorStats(),
            config: this.config
        };
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ErrorRecoverySystem;
} else {
    window.ErrorRecoverySystem = ErrorRecoverySystem;
}
