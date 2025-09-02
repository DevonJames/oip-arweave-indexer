const { preprocessTextForTTS } = require('./alfred');

/**
 * AdaptiveChunking - Manages real-time text segmentation for optimal TTS streaming
 * 
 * This module implements sophisticated chunking logic that:
 * - Creates immediate bootstrap chunks for <300ms first-word latency
 * - Adapts chunk sizes based on LLM generation speed vs TTS playback speed
 * - Respects natural language boundaries (sentences, clauses, phrases)
 * - Provides smooth transitions between chunks
 */
class AdaptiveChunking {
    constructor() {
        // Timing constants
        this.BOOTSTRAP_TIMEOUT = 300; // Max time to wait for bootstrap chunk (ms)
        this.BOOTSTRAP_MIN_WORDS = 12; // Min words for bootstrap chunk
        this.BOOTSTRAP_MAX_WORDS = 22; // Max words for bootstrap chunk
        this.MAX_CHUNK_DISPATCH_DELAY = 100; // Max delay between chunks (ms)
        
        // Chunk sizing constants
        this.MIN_CHUNK_CHARS = 40; // Minimum chunk size in characters
        this.MAX_CHUNK_CHARS = 800; // Maximum chunk size in characters
        this.GROWTH_FACTOR = 1.4; // How much to grow chunk size each iteration
        
        // Natural boundary patterns (ordered by preference)
        this.SENTENCE_ENDINGS = /[.!?]+\s*/g;
        this.STRONG_PUNCTUATION = /[;:]+\s*/g;
        this.COMMA_BREAKS = /[,]+\s*/g;
        this.CLAUSE_BREAKS = /\s+(?:and|but|or|however|therefore|meanwhile|furthermore|moreover|consequently)\s+/gi;
        this.NATURAL_PAUSES = /\s+(?:after|before|during|while|when|where|since|because|although|unless|until)\s+/gi;
        
        // Speech rate estimation (words per minute -> words per second)
        this.AVERAGE_SPEECH_RATE = 120 / 60; // ~3 words/second
        this.FAST_SPEECH_RATE = 180 / 60; // ~3.67 words/second
        this.SLOW_SPEECH_RATE = 100 / 60; // ~2.33 words/second
    }

    /**
     * Initialize a new chunking session
     * @param {Object} options - Configuration options
     * @returns {Object} Session state object
     */
    initSession(options = {}) {
        return {
            // Text accumulation
            buffer: '',
            processedLength: 0,
            
            // Chunk tracking
            chunkCount: 0,
            totalWordsProcessed: 0,
            
            // Timing metrics
            sessionStartTime: Date.now(),
            lastChunkTime: Date.now(),
            bootstrapSent: false,
            
            // Adaptive sizing
            currentChunkSize: this.MIN_CHUNK_CHARS,
            generationSpeed: 0, // words/second
            synthesisSpeed: this.AVERAGE_SPEECH_RATE, // words/second
            
            // Quality metrics
            naturalBreakHits: 0,
            forcedBreaks: 0,
            
            // Configuration
            targetLatency: options.targetLatency || 300,
            maxChunkSize: options.maxChunkSize || this.MAX_CHUNK_CHARS,
            speechRate: options.speechRate || this.AVERAGE_SPEECH_RATE,
            
            // State flags
            isComplete: false,
            pendingFlush: false
        };
    }

    /**
     * Add new text to the session and check if chunks are ready
     * @param {Object} session - Session state
     * @param {string} newText - New text from LLM
     * @returns {Object} Result with chunks ready for processing
     */
    addText(session, newText) {
        if (!newText || session.isComplete) {
            return { chunks: [], session };
        }

        // Clean and preprocess text
        const cleanText = preprocessTextForTTS(newText);
        session.buffer += cleanText;

        // Update generation speed metrics
        this.updateGenerationSpeed(session);

        const chunks = [];
        
        // Handle bootstrap chunk (first chunk sent ASAP)
        if (!session.bootstrapSent) {
            const bootstrapChunk = this.extractBootstrapChunk(session);
            if (bootstrapChunk) {
                chunks.push(bootstrapChunk);
                session.bootstrapSent = true;
                session.lastChunkTime = Date.now();
                // Note: chunkCount is set in extractBootstrapChunk
            }
        }

        // Extract additional ready chunks
        while (this.hasReadyChunk(session)) {
            const chunk = this.extractNextChunk(session);
            if (chunk) {
                chunks.push(chunk);
                session.lastChunkTime = Date.now();
                // Note: chunkCount is incremented in extractNextChunk
            } else {
                break;
            }
        }

        return { chunks, session };
    }

    /**
     * Extract the bootstrap chunk for immediate playback
     * @param {Object} session - Session state
     * @returns {Object|null} Bootstrap chunk or null if not ready
     */
    extractBootstrapChunk(session) {
        const timeSinceStart = Date.now() - session.sessionStartTime;
        const words = this.getWords(session.buffer);
        
        // Send bootstrap if we have enough words OR timeout reached
        const hasEnoughWords = words.length >= this.BOOTSTRAP_MIN_WORDS;
        const timeoutReached = timeSinceStart >= this.BOOTSTRAP_TIMEOUT;
        
        if (!hasEnoughWords && !timeoutReached) {
            return null;
        }

        // Extract bootstrap text (prefer natural boundary)
        const targetWords = Math.min(words.length, this.BOOTSTRAP_MAX_WORDS);
        const bootstrapWords = words.slice(0, targetWords);
        const bootstrapText = bootstrapWords.join(' ');
        
        // Find best break point within bootstrap text
        const breakPoint = this.findBestBreakPoint(bootstrapText, bootstrapText.length);
        const finalText = bootstrapText.substring(0, breakPoint).trim();
        
        if (finalText.length < 10) { // Too short, wait for more
            return null;
        }

        // Update session state
        session.processedLength = breakPoint;
        session.totalWordsProcessed += this.getWords(finalText).length;
        session.chunkCount = 1; // Set chunk count to 1 for bootstrap (don't increment here)

        return {
            text: finalText,
            type: 'bootstrap',
            chunkIndex: 1, // Start at 1 to match client expectations
            wordCount: this.getWords(finalText).length,
            naturalBreak: this.hasNaturalEnding(finalText),
            latency: timeSinceStart
        };
    }

    /**
     * Check if there's a chunk ready for processing
     * @param {Object} session - Session state
     * @returns {boolean} True if chunk is ready
     */
    hasReadyChunk(session) {
        const unprocessedText = session.buffer.substring(session.processedLength);
        if (unprocessedText.length < this.MIN_CHUNK_CHARS) {
            return false;
        }

        // Check if we have enough text for current chunk size
        if (unprocessedText.length >= session.currentChunkSize) {
            return true;
        }

        // Check timeout-based chunking (don't let text sit too long)
        const timeSinceLastChunk = Date.now() - session.lastChunkTime;
        const maxWaitTime = this.calculateMaxWaitTime(session);
        
        return timeSinceLastChunk >= maxWaitTime && unprocessedText.length >= this.MIN_CHUNK_CHARS;
    }

    /**
     * Extract the next ready chunk
     * @param {Object} session - Session state
     * @returns {Object|null} Chunk object or null
     */
    extractNextChunk(session) {
        const unprocessedText = session.buffer.substring(session.processedLength);
        if (unprocessedText.length < this.MIN_CHUNK_CHARS) {
            return null;
        }

        // Determine chunk size based on adaptive algorithm
        const targetSize = Math.min(
            session.currentChunkSize,
            unprocessedText.length,
            session.maxChunkSize
        );

        // Find best break point
        const breakPoint = this.findBestBreakPoint(unprocessedText, targetSize);
        const chunkText = unprocessedText.substring(0, breakPoint).trim();

        if (chunkText.length < 10) { // Too short
            return null;
        }

        // Increment chunk count first to ensure sequential numbering
        session.chunkCount++;
        
        // Update session state
        session.processedLength += breakPoint;
        session.totalWordsProcessed += this.getWords(chunkText).length;
        
        // Adapt chunk size for next iteration
        this.adaptChunkSize(session);

        // Track quality metrics
        if (this.hasNaturalEnding(chunkText)) {
            session.naturalBreakHits++;
        } else {
            session.forcedBreaks++;
        }
        
        return {
            text: chunkText,
            type: 'adaptive',
            chunkIndex: session.chunkCount, // Use current count for sequential chunks
            wordCount: this.getWords(chunkText).length,
            naturalBreak: this.hasNaturalEnding(chunkText),
            chunkSize: session.currentChunkSize,
            generationSpeed: session.generationSpeed
        };
    }

    /**
     * Flush any remaining text as the final chunk
     * @param {Object} session - Session state
     * @returns {Object|null} Final chunk or null
     */
    flushRemaining(session) {
        if (session.isComplete) {
            return null;
        }

        const remainingText = session.buffer.substring(session.processedLength).trim();
        if (remainingText.length < 5) {
            return null;
        }

        // Increment for final chunk
        session.chunkCount++;
        
        session.isComplete = true;
        session.processedLength = session.buffer.length;

        return {
            text: remainingText,
            type: 'final',
            chunkIndex: session.chunkCount, // Use current count
            wordCount: this.getWords(remainingText).length,
            naturalBreak: true, // Final chunk is always considered complete
            isFinal: true
        };
    }

    /**
     * Find the best break point within target size, preferring natural boundaries
     * @param {string} text - Text to analyze
     * @param {number} targetSize - Target chunk size
     * @returns {number} Break point index
     */
    findBestBreakPoint(text, targetSize) {
        if (text.length <= targetSize) {
            return text.length;
        }

        // Define search ranges (prefer breaks closer to target)
        const minSearch = Math.floor(targetSize * 0.7); // Don't go below 70% of target
        const maxSearch = Math.min(text.length, targetSize * 1.2); // Don't exceed 120% of target
        const searchText = text.substring(minSearch, maxSearch);
        
        // Try to find natural boundaries in order of preference
        const boundaries = [
            { pattern: this.SENTENCE_ENDINGS, priority: 4 },
            { pattern: this.STRONG_PUNCTUATION, priority: 3 },
            { pattern: this.COMMA_BREAKS, priority: 2 },
            { pattern: this.CLAUSE_BREAKS, priority: 1 },
            { pattern: this.NATURAL_PAUSES, priority: 1 }
        ];

        let bestBreak = { index: targetSize, priority: 0 };

        for (const boundary of boundaries) {
            const matches = Array.from(searchText.matchAll(boundary.pattern));
            
            for (const match of matches) {
                const absoluteIndex = minSearch + match.index + match[0].length;
                
                // Prefer breaks closer to target size with higher priority
                const distanceFromTarget = Math.abs(absoluteIndex - targetSize);
                const score = boundary.priority - (distanceFromTarget / targetSize);
                
                if (score > bestBreak.priority || 
                   (score === bestBreak.priority && distanceFromTarget < Math.abs(bestBreak.index - targetSize))) {
                    bestBreak = { index: absoluteIndex, priority: score };
                }
            }
        }

        // Ensure we don't break mid-word
        let finalIndex = bestBreak.index;
        while (finalIndex > 0 && finalIndex < text.length && !/\s/.test(text[finalIndex - 1])) {
            finalIndex--;
        }

        return Math.max(minSearch, finalIndex);
    }

    /**
     * Adapt chunk size based on generation and synthesis speeds
     * @param {Object} session - Session state
     */
    adaptChunkSize(session) {
        if (session.generationSpeed <= 0 || session.synthesisSpeed <= 0) {
            return; // Can't adapt without speed data
        }

        // Calculate optimal chunk size based on speed ratio
        const speedRatio = session.generationSpeed / session.synthesisSpeed;
        
        if (speedRatio > 1.2) {
            // LLM is generating faster than TTS can speak - increase chunk size
            session.currentChunkSize = Math.min(
                session.currentChunkSize * this.GROWTH_FACTOR,
                session.maxChunkSize
            );
        } else if (speedRatio < 0.8) {
            // TTS is speaking faster than LLM generates - decrease chunk size
            session.currentChunkSize = Math.max(
                session.currentChunkSize / this.GROWTH_FACTOR,
                this.MIN_CHUNK_CHARS
            );
        }
        // If ratio is between 0.8-1.2, keep current size (balanced)

        console.log(`[AdaptiveChunking] Speed ratio: ${speedRatio.toFixed(2)}, new chunk size: ${Math.round(session.currentChunkSize)}`);
    }

    /**
     * Update generation speed metrics
     * @param {Object} session - Session state
     */
    updateGenerationSpeed(session) {
        const currentTime = Date.now();
        const timeDelta = (currentTime - session.sessionStartTime) / 1000; // seconds
        
        if (timeDelta > 0.5) { // Only calculate after reasonable time
            const totalWords = this.getWords(session.buffer).length;
            session.generationSpeed = totalWords / timeDelta;
        }
    }

    /**
     * Calculate maximum wait time before forcing a chunk
     * @param {Object} session - Session state
     * @returns {number} Max wait time in milliseconds
     */
    calculateMaxWaitTime(session) {
        // Base wait time increases with chunk count (later chunks can wait longer)
        const baseWait = session.chunkCount < 3 ? 800 : 2000;
        
        // Adjust based on generation speed
        if (session.generationSpeed > 0) {
            const speedMultiplier = Math.max(0.5, Math.min(2.0, this.AVERAGE_SPEECH_RATE / session.generationSpeed));
            return baseWait * speedMultiplier;
        }
        
        return baseWait;
    }

    /**
     * Check if text has a natural ending
     * @param {string} text - Text to check
     * @returns {boolean} True if has natural ending
     */
    hasNaturalEnding(text) {
        const trimmed = text.trim();
        return /[.!?;:]$/.test(trimmed);
    }

    /**
     * Split text into words
     * @param {string} text - Text to split
     * @returns {Array} Array of words
     */
    getWords(text) {
        return text.trim().split(/\s+/).filter(word => word.length > 0);
    }

    /**
     * Get session diagnostics
     * @param {Object} session - Session state
     * @returns {Object} Diagnostic information
     */
    getDiagnostics(session) {
        const totalTime = Date.now() - session.sessionStartTime;
        const wordsPerSecond = session.totalWordsProcessed / (totalTime / 1000);
        const naturalBreakRate = session.naturalBreakHits / Math.max(1, session.chunkCount);
        
        return {
            sessionDuration: totalTime,
            chunksGenerated: session.chunkCount,
            totalWords: session.totalWordsProcessed,
            wordsPerSecond: wordsPerSecond,
            naturalBreakRate: naturalBreakRate,
            forcedBreaks: session.forcedBreaks,
            currentChunkSize: session.currentChunkSize,
            generationSpeed: session.generationSpeed,
            synthesisSpeed: session.synthesisSpeed,
            bufferSize: session.buffer.length,
            processedLength: session.processedLength,
            bootstrapLatency: session.bootstrapSent ? 'sent' : 'pending'
        };
    }
}

module.exports = new AdaptiveChunking();
