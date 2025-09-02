const adaptiveChunking = require('./adaptiveChunking');
const { generateElevenLabsTTS } = require('./generators');
const axios = require('axios');

/**
 * StreamingCoordinator - Manages the real-time LLM-TTS pipeline
 * 
 * This module coordinates the timing between LLM text generation and TTS audio playback
 * using a rolling buffer system and adaptive chunking for minimal latency.
 */
class StreamingCoordinator {
    constructor() {
        // Service URLs
        this.TTS_SERVICE_URL = process.env.TTS_SERVICE_URL || 'http://localhost:5002';
        this.ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
        
        // Active sessions
        this.activeSessions = new Map();
        
        // Performance constants
        this.MAX_CONCURRENT_TTS = 3; // Max simultaneous TTS requests
        this.TTS_TIMEOUT = 30000; // 30 second timeout for TTS
        this.AUDIO_QUEUE_MAX_SIZE = 5; // Max chunks in audio queue
        
        // Timing targets
        this.TARGET_FIRST_AUDIO_LATENCY = 300; // ms
        this.TARGET_CHUNK_TRANSITION_DELAY = 100; // ms
        
        // Quality metrics
        this.sessionMetrics = new Map();
    }

    /**
     * Initialize a new streaming session
     * @param {string} sessionId - Unique session identifier
     * @param {Object} config - Session configuration
     * @returns {Object} Session state
     */
    async initSession(sessionId, config = {}) {
        console.log(`[StreamingCoordinator] Initializing session: ${sessionId}`);
        
        const session = {
            id: sessionId,
            startTime: Date.now(),
            
            // Chunking state
            chunkingSession: adaptiveChunking.initSession({
                targetLatency: config.targetLatency || this.TARGET_FIRST_AUDIO_LATENCY,
                maxChunkSize: config.maxChunkSize || 800,
                speechRate: config.speechRate || 3.0
            }),
            
            // Audio pipeline state
            audioQueue: [],
            currentlyPlaying: null,
            ttsRequests: new Map(), // Track active TTS requests
            
            // Voice configuration
            voiceConfig: {
                engine: config.engine || 'elevenlabs',
                voiceId: config.voiceId || 'onwK4e9ZLuTAKqWW03F9',
                settings: config.voiceSettings || {
                    stability: 0.5,
                    similarity_boost: 0.75,
                    style: 0.0,
                    use_speaker_boost: true
                },
                ...config.voiceConfig
            },
            
            // Callback functions
            onAudioChunk: config.onAudioChunk || null,
            onTextChunk: config.onTextChunk || null,
            onError: config.onError || null,
            onComplete: config.onComplete || null,
            
            // State flags
            isActive: true,
            isComplete: false,
            firstAudioSent: false,
            
            // Performance tracking
            metrics: {
                chunksGenerated: 0,
                audioChunksGenerated: 0,
                totalLatency: 0,
                ttsFailures: 0,
                naturalBreaks: 0,
                forcedBreaks: 0
            }
        };
        
        this.activeSessions.set(sessionId, session);
        return session;
    }

    /**
     * Add new text from LLM to the streaming pipeline
     * @param {string} sessionId - Session identifier
     * @param {string} newText - New text chunk from LLM
     * @returns {Promise<Object>} Processing result
     */
    async addText(sessionId, newText) {
        const session = this.activeSessions.get(sessionId);
        if (!session || !session.isActive) {
            console.warn(`[StreamingCoordinator] Session ${sessionId} not found or inactive`);
            return { success: false, error: 'Session not active' };
        }

        try {
            // Add text to chunking system
            const { chunks, session: updatedChunkingSession } = adaptiveChunking.addText(
                session.chunkingSession, 
                newText
            );
            
            session.chunkingSession = updatedChunkingSession;

            // Process any ready chunks
            for (const chunk of chunks) {
                await this.processChunk(session, chunk);
            }

            // Send text chunk to client if callback provided
            if (session.onTextChunk && typeof session.onTextChunk === 'function') {
                session.onTextChunk(newText);
            }

            return { 
                success: true, 
                chunksProcessed: chunks.length,
                queueSize: session.audioQueue.length 
            };

        } catch (error) {
            console.error(`[StreamingCoordinator] Error processing text for session ${sessionId}:`, error);
            if (session.onError) {
                session.onError(error);
            }
            return { success: false, error: error.message };
        }
    }

    /**
     * Process a text chunk through the TTS pipeline
     * @param {Object} session - Session state
     * @param {Object} chunk - Text chunk to process
     */
    async processChunk(session, chunk) {
        const chunkStartTime = Date.now();
        
        console.log(`[StreamingCoordinator] Processing ${chunk.type} chunk ${chunk.chunkIndex}: "${chunk.text.substring(0, 50)}..." (${chunk.wordCount} words)`);

        // Track metrics
        session.metrics.chunksGenerated++;
        if (chunk.naturalBreak) {
            session.metrics.naturalBreaks++;
        } else {
            session.metrics.forcedBreaks++;
        }

        try {
            // Generate audio for chunk
            const audioData = await this.synthesizeChunk(session, chunk);
            
            if (audioData) {
                const audioChunk = {
                    chunkIndex: chunk.chunkIndex,
                    text: chunk.text,
                    audioData: audioData,
                    type: chunk.type,
                    wordCount: chunk.wordCount,
                    naturalBreak: chunk.naturalBreak,
                    generatedAt: Date.now(),
                    processingTime: Date.now() - chunkStartTime,
                    isFinal: chunk.isFinal || false
                };

                // Add to queue and try to play immediately
                session.audioQueue.push(audioChunk);
                await this.processAudioQueue(session);
                
                session.metrics.audioChunksGenerated++;
                
                // Track first audio latency
                if (!session.firstAudioSent && chunk.type === 'bootstrap') {
                    const firstAudioLatency = Date.now() - session.startTime;
                    session.metrics.firstAudioLatency = firstAudioLatency;
                    session.firstAudioSent = true;
                    
                    console.log(`[StreamingCoordinator] 🎉 First audio sent in ${firstAudioLatency}ms`);
                }
            }

        } catch (error) {
            console.error(`[StreamingCoordinator] Failed to synthesize chunk ${chunk.chunkIndex}:`, error);
            session.metrics.ttsFailures++;
            
            if (session.onError) {
                session.onError(error);
            }
        }
    }

    /**
     * Synthesize audio for a text chunk
     * @param {Object} session - Session state
     * @param {Object} chunk - Text chunk
     * @returns {Promise<Buffer|string>} Audio data
     */
    async synthesizeChunk(session, chunk) {
        const ttsStartTime = Date.now();
        
        // Prevent too many concurrent requests
        if (session.ttsRequests.size >= this.MAX_CONCURRENT_TTS) {
            console.warn(`[StreamingCoordinator] TTS request limit reached, queuing chunk ${chunk.chunkIndex}`);
            // Wait for a slot to free up
            await this.waitForTTSSlot(session);
        }

        const requestId = `${session.id}-${chunk.chunkIndex}`;
        session.ttsRequests.set(requestId, ttsStartTime);

        try {
            let audioData;

            if (session.voiceConfig.engine === 'elevenlabs' && this.ELEVENLABS_API_KEY) {
                // Use ElevenLabs for high-quality synthesis
                audioData = await this.synthesizeWithElevenLabs(session, chunk);
            } else {
                // Use local TTS service
                audioData = await this.synthesizeWithLocalTTS(session, chunk);
            }

            const ttsTime = Date.now() - ttsStartTime;
            console.log(`[StreamingCoordinator] TTS completed for chunk ${chunk.chunkIndex} in ${ttsTime}ms`);

            return audioData;

        } finally {
            session.ttsRequests.delete(requestId);
        }
    }

    /**
     * Synthesize audio using ElevenLabs API
     * @param {Object} session - Session state
     * @param {Object} chunk - Text chunk
     * @returns {Promise<Buffer>} Audio buffer
     */
    async synthesizeWithElevenLabs(session, chunk) {
        const { voiceId, settings } = session.voiceConfig;
        
        return await generateElevenLabsTTS(
            chunk.text,
            voiceId,
            settings,
            'eleven_turbo_v2' // Use fastest model for real-time
        );
    }

    /**
     * Synthesize audio using local TTS service
     * @param {Object} session - Session state
     * @param {Object} chunk - Text chunk
     * @returns {Promise<Buffer>} Audio buffer
     */
    async synthesizeWithLocalTTS(session, chunk) {
        const FormData = require('form-data');
        const formData = new FormData();
        
        formData.append('text', chunk.text);
        
        // Configure based on voice settings
        if (session.voiceConfig.chatterbox) {
            const cb = session.voiceConfig.chatterbox;
            formData.append('gender', cb.gender || 'female');
            formData.append('emotion', cb.emotion || 'expressive');
            formData.append('exaggeration', cb.exaggeration || '0.6');
            formData.append('cfg_weight', cb.cfg_weight || '0.7');
            formData.append('voice_cloning', cb.voiceCloning?.enabled ? 'true' : 'false');
        } else {
            // Default settings
            formData.append('gender', 'female');
            formData.append('emotion', 'expressive');
            formData.append('exaggeration', '0.6');
            formData.append('cfg_weight', '0.7');
            formData.append('voice_cloning', 'false');
        }

        const response = await axios.post(`${this.TTS_SERVICE_URL}/synthesize`, formData, {
            headers: {
                ...formData.getHeaders()
            },
            responseType: 'arraybuffer',
            timeout: this.TTS_TIMEOUT
        });

        if (response.status === 200 && response.data) {
            return Buffer.from(response.data);
        } else {
            throw new Error('Local TTS service returned invalid response');
        }
    }

    /**
     * Process the audio queue and send chunks to client
     * @param {Object} session - Session state
     */
    async processAudioQueue(session) {
        // Send audio chunks in order
        while (session.audioQueue.length > 0) {
            const nextChunk = session.audioQueue[0];
            
            // Check if this chunk is ready to play
            if (this.isChunkReadyToPlay(session, nextChunk)) {
                session.audioQueue.shift(); // Remove from queue
                await this.sendAudioChunk(session, nextChunk);
                session.currentlyPlaying = nextChunk;
            } else {
                break; // Wait for current chunk to finish or timeout
            }
        }
    }

    /**
     * Check if an audio chunk is ready to play
     * @param {Object} session - Session state
     * @param {Object} chunk - Audio chunk
     * @returns {boolean} True if ready to play
     */
    isChunkReadyToPlay(session, chunk) {
        // First chunk can always play immediately
        if (chunk.chunkIndex === 0) {
            return true;
        }

        // If nothing is currently playing, can play next chunk
        if (!session.currentlyPlaying) {
            return true;
        }

        // Check if enough time has passed since last chunk started
        const timeSinceLastChunk = Date.now() - session.currentlyPlaying.playStartTime;
        const estimatedPlaybackTime = this.estimatePlaybackTime(session.currentlyPlaying);
        
        // Allow some overlap to prevent gaps
        const bufferTime = Math.max(100, estimatedPlaybackTime * 0.1);
        
        return timeSinceLastChunk >= (estimatedPlaybackTime - bufferTime);
    }

    /**
     * Send audio chunk to client
     * @param {Object} session - Session state
     * @param {Object} audioChunk - Audio chunk to send
     */
    async sendAudioChunk(session, audioChunk) {
        audioChunk.playStartTime = Date.now();
        
        console.log(`[StreamingCoordinator] 🎵 Sending audio chunk ${audioChunk.chunkIndex} (${audioChunk.wordCount} words, ${audioChunk.audioData.length} bytes)`);

        if (session.onAudioChunk && typeof session.onAudioChunk === 'function') {
            // Convert audio to base64 for transmission
            const audioBase64 = audioChunk.audioData.toString('base64');
            
            await session.onAudioChunk(
                audioBase64,
                audioChunk.chunkIndex,
                audioChunk.text,
                audioChunk.isFinal
            );
        }

        // Update latency metrics
        if (audioChunk.type === 'bootstrap') {
            session.metrics.totalLatency = audioChunk.playStartTime - session.startTime;
        }
    }

    /**
     * Estimate playback time for an audio chunk
     * @param {Object} audioChunk - Audio chunk
     * @returns {number} Estimated playback time in ms
     */
    estimatePlaybackTime(audioChunk) {
        // Rough estimation: ~3 words per second
        const wordsPerSecond = 3.0;
        return (audioChunk.wordCount / wordsPerSecond) * 1000;
    }

    /**
     * Wait for a TTS slot to become available
     * @param {Object} session - Session state
     * @returns {Promise<void>}
     */
    async waitForTTSSlot(session) {
        return new Promise((resolve) => {
            const checkSlot = () => {
                if (session.ttsRequests.size < this.MAX_CONCURRENT_TTS) {
                    resolve();
                } else {
                    setTimeout(checkSlot, 100);
                }
            };
            checkSlot();
        });
    }

    /**
     * Finish the streaming session
     * @param {string} sessionId - Session identifier
     * @returns {Promise<Object>} Final metrics
     */
    async finishSession(sessionId) {
        const session = this.activeSessions.get(sessionId);
        if (!session) {
            return { success: false, error: 'Session not found' };
        }

        console.log(`[StreamingCoordinator] Finishing session: ${sessionId}`);

        try {
            // Flush any remaining text
            const finalChunk = adaptiveChunking.flushRemaining(session.chunkingSession);
            if (finalChunk) {
                await this.processChunk(session, finalChunk);
            }

            // Wait for audio queue to empty
            while (session.audioQueue.length > 0) {
                await this.processAudioQueue(session);
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            // Mark session as complete
            session.isComplete = true;
            session.isActive = false;

            // Get final diagnostics
            const chunkingDiagnostics = adaptiveChunking.getDiagnostics(session.chunkingSession);
            const finalMetrics = {
                ...session.metrics,
                ...chunkingDiagnostics,
                sessionDuration: Date.now() - session.startTime,
                success: true
            };

            // Notify completion
            if (session.onComplete) {
                session.onComplete(finalMetrics);
            }

            // Clean up
            this.activeSessions.delete(sessionId);

            console.log(`[StreamingCoordinator] Session ${sessionId} completed:`, finalMetrics);
            return finalMetrics;

        } catch (error) {
            console.error(`[StreamingCoordinator] Error finishing session ${sessionId}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Abort a streaming session
     * @param {string} sessionId - Session identifier
     * @returns {Object} Result
     */
    abortSession(sessionId) {
        const session = this.activeSessions.get(sessionId);
        if (!session) {
            return { success: false, error: 'Session not found' };
        }

        console.log(`[StreamingCoordinator] Aborting session: ${sessionId}`);

        // Mark as inactive
        session.isActive = false;
        session.isComplete = true;

        // Clear queues
        session.audioQueue.length = 0;
        session.ttsRequests.clear();

        // Clean up
        this.activeSessions.delete(sessionId);

        return { success: true };
    }

    /**
     * Get session status and metrics
     * @param {string} sessionId - Session identifier
     * @returns {Object} Session status
     */
    getSessionStatus(sessionId) {
        const session = this.activeSessions.get(sessionId);
        if (!session) {
            return { exists: false };
        }

        const chunkingDiagnostics = adaptiveChunking.getDiagnostics(session.chunkingSession);
        
        return {
            exists: true,
            isActive: session.isActive,
            isComplete: session.isComplete,
            metrics: session.metrics,
            queueSize: session.audioQueue.length,
            activeTTSRequests: session.ttsRequests.size,
            chunkingDiagnostics: chunkingDiagnostics,
            sessionDuration: Date.now() - session.startTime
        };
    }

    /**
     * Get all active sessions
     * @returns {Array} Array of session statuses
     */
    getAllSessions() {
        return Array.from(this.activeSessions.keys()).map(sessionId => ({
            sessionId,
            ...this.getSessionStatus(sessionId)
        }));
    }
}

module.exports = new StreamingCoordinator();
