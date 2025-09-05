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
        // Timing constants - More patient for sentence-only chunking
        this.BOOTSTRAP_TIMEOUT = 1000; // Longer wait for bootstrap chunk (ms)
        this.BOOTSTRAP_MIN_WORDS = 20; // Min words for bootstrap chunk
        this.BOOTSTRAP_MAX_WORDS = 40; // Max words for bootstrap chunk
        this.MAX_CHUNK_DISPATCH_DELAY = 100; // Max delay between chunks (ms)
        
        // Chunk sizing constants - CONSERVATIVE SIZING for period-only chunking
        this.MIN_CHUNK_CHARS = 80; // Larger minimum to ensure we reach sentence endings
        this.MAX_CHUNK_CHARS = 800; // Maximum chunk size in characters
        this.GROWTH_FACTOR = 1.4; // How much to grow chunk size each iteration
        
        // Progressive chunk sizing strategy - LARGER SIZES for period-only chunking
        this.BOOTSTRAP_CHUNK_SIZE = 120; // Larger first chunk to reach first period
        this.EARLY_CHUNK_SIZE = 200; // Larger chunks for chunks 2-4 
        this.MATURE_CHUNK_SIZE = 350; // Even larger chunks for chunks 5-8
        this.LARGE_CHUNK_SIZE = 500; // Largest chunks for chunks 9+
        
        // Natural boundary patterns (ordered by preference)
        this.SENTENCE_ENDINGS = /[.!?]+\s*/g;
        this.STRONG_PUNCTUATION = /[;:]+\s*/g;
        this.COMMA_BREAKS = /[,]+\s*/g;
        this.CLAUSE_BREAKS = /\s+(?:and|but|or|however|therefore|meanwhile|furthermore|moreover|consequently)\s+/gi;
        this.NATURAL_PAUSES = /\s+(?:after|before|during|while|when|where|since|because|although|unless|until)\s+/gi;
        
        // Speech rate estimation (words per minute -> words per second)
        this.AVERAGE_SPEECH_RATE = 120 / 60; // ~2 words/second
        this.FAST_SPEECH_RATE = 180 / 60; // ~3 words/second
        this.SLOW_SPEECH_RATE = 100 / 60; // ~1.67 words/second
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
            
            // Adaptive sizing - starts small and grows progressively
            currentChunkSize: this.BOOTSTRAP_CHUNK_SIZE, // Start with bootstrap size, then grow
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
                
                // Return immediately after bootstrap - don't process additional chunks
                // This prevents conflicts between bootstrap and adaptive chunking
                return { chunks, session };
            }
        }

        // Extract additional ready chunks (only if bootstrap already sent)
        if (session.bootstrapSent) {
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
        
        // For bootstrap, look for the FIRST complete sentence in the buffer
        const sentencePattern = /[.!?]+\s*/g;
        let firstSentenceEnd = 0;
        let match = sentencePattern.exec(session.buffer);
        
        if (match) {
            firstSentenceEnd = match.index + match[0].length;
        }
        
        // If we found a complete sentence, use it
        if (firstSentenceEnd > 0) {
            const finalText = session.buffer.substring(0, firstSentenceEnd).trim();
            
            if (finalText.length >= 15) { // Must be substantial
                console.log(`[AdaptiveChunking] Bootstrap: Found first sentence (${finalText.length} chars): "${finalText.slice(-30)}"`);
                
                // Update session state
                session.processedLength = firstSentenceEnd;
                session.totalWordsProcessed += this.getWords(finalText).length;
                session.chunkCount = 1;

                return {
                    text: finalText,
                    type: 'bootstrap',
                    chunkIndex: 1,
                    wordCount: this.getWords(finalText).length,
                    naturalBreak: true, // Bootstrap is always a complete sentence
                    latency: timeSinceStart
                };
            }
        }
        
        // If no complete sentence found, check timeout
        const timeoutReached = timeSinceStart >= this.BOOTSTRAP_TIMEOUT;
        if (timeoutReached && session.buffer.length >= 30) {
            console.log(`[AdaptiveChunking] Bootstrap timeout: No sentence found in ${timeSinceStart}ms, forcing partial chunk`);
            // Emergency fallback - send partial text but try to end at word boundary
            const words = this.getWords(session.buffer);
            const partialWords = words.slice(0, Math.min(words.length, this.BOOTSTRAP_MIN_WORDS));
            const partialText = partialWords.join(' ');
            
            session.processedLength = partialText.length;
            session.totalWordsProcessed += partialWords.length;
            session.chunkCount = 1;

            return {
                text: partialText,
                type: 'bootstrap',
                chunkIndex: 1,
                wordCount: partialWords.length,
                naturalBreak: false,
                latency: timeSinceStart
            };
        }
        
        console.log(`[AdaptiveChunking] Bootstrap: No complete sentence found in ${session.buffer.length} chars, waiting...`);
        return null;
    }

    /**
     * Check if there's a chunk ready for processing - SENTENCE-ONLY STRATEGY
     * @param {Object} session - Session state
     * @returns {boolean} True if chunk is ready
     */
    hasReadyChunk(session) {
        const unprocessedText = session.buffer.substring(session.processedLength);
        if (unprocessedText.length < this.MIN_CHUNK_CHARS) {
            return false;
        }

        // SENTENCE-ONLY STRATEGY: Only send chunks when we have complete sentences
        const hasNaturalEnding = /[.!?]+\s*$/.test(unprocessedText.trim());
        
        if (hasNaturalEnding) {
            console.log(`[AdaptiveChunking] Found sentence ending in ${unprocessedText.length} chars: "${unprocessedText.trim().slice(-20)}"`);
            return true;
        }

        // EMERGENCY TIMEOUT: Only break after a very long wait to prevent infinite waiting
        const timeSinceLastChunk = Date.now() - session.lastChunkTime;
        const emergencyTimeout = 5000; // 5 seconds emergency timeout
        
        if (timeSinceLastChunk >= emergencyTimeout) {
            console.log(`[AdaptiveChunking] Emergency timeout reached (${timeSinceLastChunk}ms), forcing chunk`);
            return true;
        }

        // Otherwise, wait for a sentence ending
        return false;
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
     * Find the best break point within target size, ONLY using sentence endings
     * @param {string} text - Text to analyze
     * @param {number} targetSize - Target chunk size
     * @returns {number} Break point index
     */
    findBestBreakPoint(text, targetSize) {
        if (text.length <= targetSize) {
            return text.length;
        }

        // PERIOD-ONLY STRATEGY: Only break at sentence endings
        // Look for the closest sentence ending to our target size
        const sentencePattern = /[.!?]+\s*/g;
        let bestBreak = null;
        let match;

        // Find all sentence endings in the text
        while ((match = sentencePattern.exec(text)) !== null) {
            const endIndex = match.index + match[0].length;
            
            // If this sentence ending is within reasonable range, consider it
            if (endIndex >= this.MIN_CHUNK_CHARS && endIndex <= text.length) {
                if (!bestBreak) {
                    bestBreak = endIndex;
                } else {
                    // Prefer the sentence ending closest to our target size
                    const currentDistance = Math.abs(endIndex - targetSize);
                    const bestDistance = Math.abs(bestBreak - targetSize);
                    
                    if (currentDistance < bestDistance) {
                        bestBreak = endIndex;
                    }
                }
            }
        }

        // If we found a sentence ending, use it
        if (bestBreak !== null) {
            return bestBreak;
        }

        // If no sentence ending found, DON'T break - return full text length
        // This will cause the system to wait longer for a natural break
        console.log(`[AdaptiveChunking] No sentence ending found in text of length ${text.length}, waiting for more text`);
        return text.length;
    }

    /**
     * Adapt chunk size based on generation and synthesis speeds AND progressive strategy
     * @param {Object} session - Session state
     */
    adaptChunkSize(session) {
        // PROGRESSIVE CHUNK SIZING: Start small, grow larger over time
        let targetSize;
        
        if (session.chunkCount <= 1) {
            // Bootstrap chunk: very small for immediate response
            targetSize = this.BOOTSTRAP_CHUNK_SIZE;
        } else if (session.chunkCount <= 4) {
            // Early chunks: small for quick follow-up
            targetSize = this.EARLY_CHUNK_SIZE;
        } else if (session.chunkCount <= 8) {
            // Mature chunks: medium size for balanced flow
            targetSize = this.MATURE_CHUNK_SIZE;
        } else {
            // Large chunks: for smooth long-form speech
            targetSize = this.LARGE_CHUNK_SIZE;
        }

        // Fine-tune based on LLM vs TTS speed if we have data
        if (session.generationSpeed > 0 && session.synthesisSpeed > 0) {
            const speedRatio = session.generationSpeed / session.synthesisSpeed;
            
            if (speedRatio > 1.5) {
                // LLM much faster than TTS - can afford larger chunks
                targetSize = Math.min(targetSize * 1.3, this.MAX_CHUNK_CHARS);
            } else if (speedRatio < 0.7) {
                // TTS faster than LLM - use smaller chunks to prevent delays
                targetSize = Math.max(targetSize * 0.8, this.MIN_CHUNK_CHARS);
            }
            
            console.log(`[AdaptiveChunking] Chunk ${session.chunkCount}: Progressive target=${targetSize}, speed ratio=${speedRatio.toFixed(2)}`);
        } else {
            console.log(`[AdaptiveChunking] Chunk ${session.chunkCount}: Progressive target=${targetSize} (no speed data yet)`);
        }

        session.currentChunkSize = targetSize;
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
     * Calculate maximum wait time before forcing a chunk - PROGRESSIVE TIMING
     * @param {Object} session - Session state
     * @returns {number} Max wait time in milliseconds
     */
    calculateMaxWaitTime(session) {
        // PROGRESSIVE WAIT TIMES: Short waits for early chunks, longer for later chunks
        let baseWait;
        
        if (session.chunkCount <= 1) {
            baseWait = 800; // Longer wait for bootstrap to find first period
        } else if (session.chunkCount <= 4) {
            baseWait = 1200; // More wait for early chunks to find periods
        } else if (session.chunkCount <= 8) {
            baseWait = 2000; // More wait for mature chunks (complete sentences)
        } else {
            baseWait = 3000; // Even longer wait for large chunks (complete thoughts)
        }
        
        // Adjust based on generation speed
        if (session.generationSpeed > 0) {
            const speedMultiplier = Math.max(0.5, Math.min(2.0, this.AVERAGE_SPEECH_RATE / session.generationSpeed));
            const finalWait = baseWait * speedMultiplier;
            console.log(`[AdaptiveChunking] Chunk ${session.chunkCount}: Wait time=${finalWait}ms (base=${baseWait}, speed=${speedMultiplier.toFixed(2)})`);
            return finalWait;
        }
        
        console.log(`[AdaptiveChunking] Chunk ${session.chunkCount}: Wait time=${baseWait}ms (no speed data)`);
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
