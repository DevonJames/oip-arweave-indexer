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
        this.BOOTSTRAP_TIMEOUT = 200; // Max time to wait for bootstrap chunk (ms)
        this.BOOTSTRAP_MIN_WORDS = 20; // Min words for bootstrap chunk
        this.BOOTSTRAP_MAX_WORDS = 40; // Max words for bootstrap chunk
        this.MAX_CHUNK_DISPATCH_DELAY = 100; // Max delay between chunks (ms)
        
        // Chunk sizing constants - PROGRESSIVE SIZING
        this.MIN_CHUNK_CHARS = 40; // Start small for immediate response
        this.MAX_CHUNK_CHARS = 800; // Maximum chunk size in characters
        this.GROWTH_FACTOR = 1.4; // How much to grow chunk size each iteration
        
        // Progressive chunk sizing strategy - EACH STAGE BUILDS ON THE PREVIOUS
        this.BOOTSTRAP_CHUNK_SIZE = 80; // Small first chunk for immediate audio
        this.EARLY_CHUNK_SIZE = 150; // Larger chunks for chunks 2-4 (builds on bootstrap)
        this.MATURE_CHUNK_SIZE = 250; // Even larger chunks for chunks 5-8 (builds on early)
        this.LARGE_CHUNK_SIZE = 400; // Largest chunks for chunks 9+ (builds on mature)
        
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
     * Check if there's a chunk ready for processing - PROGRESSIVE STRATEGY
     * @param {Object} session - Session state
     * @returns {boolean} True if chunk is ready
     */
    hasReadyChunk(session) {
        const unprocessedText = session.buffer.substring(session.processedLength);
        if (unprocessedText.length < this.MIN_CHUNK_CHARS) {
            return false;
        }

        // PROGRESSIVE READINESS: Different strategies based on chunk number
        const timeSinceLastChunk = Date.now() - session.lastChunkTime;
        const maxWaitTime = this.calculateMaxWaitTime(session);
        
        if (session.chunkCount <= 1) {
            // Bootstrap: Send as soon as we have bootstrap-sized text OR timeout
            return unprocessedText.length >= this.BOOTSTRAP_CHUNK_SIZE || timeSinceLastChunk >= maxWaitTime;
            
        } else if (session.chunkCount <= 4) {
            // Early chunks: Larger than bootstrap, but still prioritize speed
            const hasNaturalEnding = /[.!?]+\s*$/.test(unprocessedText.trim());
            const hasCommaBreak = /[,;:]+\s*$/.test(unprocessedText.trim());
            
            // Use EARLY_CHUNK_SIZE as target (larger than bootstrap)
            return unprocessedText.length >= this.EARLY_CHUNK_SIZE || 
                   hasNaturalEnding || 
                   (hasCommaBreak && unprocessedText.length >= this.BOOTSTRAP_CHUNK_SIZE) ||
                   timeSinceLastChunk >= maxWaitTime;
                   
        } else if (session.chunkCount <= 8) {
            // Mature chunks: Even larger, prioritize natural boundaries
            const hasNaturalEnding = /[.!?]+\s*$/.test(unprocessedText.trim());
            const hasStrongPunctuation = /[;:]+\s*$/.test(unprocessedText.trim());
            
            // Use MATURE_CHUNK_SIZE as target (larger than early)
            return hasNaturalEnding || 
                   hasStrongPunctuation ||
                   unprocessedText.length >= this.MATURE_CHUNK_SIZE ||
                   timeSinceLastChunk >= maxWaitTime;
                   
        } else {
            // Large chunks: Largest size, wait for complete thoughts
            const hasNaturalEnding = /[.!?]+\s*$/.test(unprocessedText.trim());
            const hasStrongPunctuation = /[;:]+\s*$/.test(unprocessedText.trim());
            
            // Use LARGE_CHUNK_SIZE as target (largest)
            return hasNaturalEnding || 
                   hasStrongPunctuation ||
                   unprocessedText.length >= this.LARGE_CHUNK_SIZE ||
                   timeSinceLastChunk >= maxWaitTime;
        }
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
        
        // TEMPORARILY: Use only periods for cleaner speech (less fragmented)
        const boundaries = [
            { pattern: this.SENTENCE_ENDINGS, priority: 4 }
            // Commented out other patterns to test period-only chunking:
            // { pattern: this.STRONG_PUNCTUATION, priority: 3 },
            // { pattern: this.COMMA_BREAKS, priority: 2 },
            // { pattern: this.CLAUSE_BREAKS, priority: 1 },
            // { pattern: this.NATURAL_PAUSES, priority: 1 }
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
            baseWait = 500; // Very short wait for bootstrap (immediate response)
        } else if (session.chunkCount <= 4) {
            baseWait = 800; // Short wait for early chunks (quick follow-up)
        } else if (session.chunkCount <= 8) {
            baseWait = 1500; // Medium wait for mature chunks (natural pacing)
        } else {
            baseWait = 2500; // Longer wait for large chunks (complete thoughts)
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
