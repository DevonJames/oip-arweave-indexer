/**
 * Chunking Service
 * Segments transcripts into searchable chunks based on different strategies
 */

class ChunkingService {
    constructor() {
        this.defaultStrategy = 'BY_TIME_30S';
    }

    /**
     * Chunk transcript segments based on strategy
     * @param {object} options - Chunking options
     * @param {array} options.segments - Array of transcript segments from STT
     * @param {string} options.strategy - Chunking strategy (BY_TIME_15S, BY_TIME_30S, BY_TIME_60S, BY_SENTENCE, BY_PARAGRAPH)
     * @param {string} options.fullText - Full transcript text (for sentence/paragraph strategies)
     * @returns {array} Array of chunks
     */
    chunk(options) {
        const {
            segments = [],
            strategy = this.defaultStrategy,
            fullText = ''
        } = options;

        console.log(`📦 [Chunking] Creating chunks with strategy: ${strategy}`);

        if (!segments || segments.length === 0) {
            // If no segments, create single chunk from full text
            if (fullText) {
                return [{
                    chunk_index: 0,
                    start_time_ms: 0,
                    end_time_ms: 0,
                    text: fullText,
                    speaker_label: null,
                    confidence_score: null
                }];
            }
            return [];
        }

        // Route to appropriate chunking strategy
        switch (strategy) {
            case 'BY_TIME_15S':
                return this._chunkByTime(segments, 15000);
            case 'BY_TIME_30S':
                return this._chunkByTime(segments, 30000);
            case 'BY_TIME_60S':
                return this._chunkByTime(segments, 60000);
            case 'BY_SENTENCE':
                return this._chunkBySentence(segments, fullText);
            case 'BY_PARAGRAPH':
                return this._chunkByParagraph(segments, fullText);
            case 'BY_SPEAKER':
                return this._chunkBySpeaker(segments);
            default:
                console.warn(`⚠️ [Chunking] Unknown strategy ${strategy}, using BY_TIME_30S`);
                return this._chunkByTime(segments, 30000);
        }
    }

    /**
     * Chunk by time windows (most common strategy)
     * @private
     */
    _chunkByTime(segments, windowMs) {
        const chunks = [];
        let currentChunk = null;
        let chunkIndex = 0;

        for (const segment of segments) {
            const segmentStart = segment.start_ms || 0;
            const segmentEnd = segment.end_ms || 0;
            const segmentText = (segment.text || '').trim();

            if (!segmentText) continue;

            // Start new chunk if needed
            if (!currentChunk) {
                currentChunk = {
                    chunk_index: chunkIndex++,
                    start_time_ms: segmentStart,
                    end_time_ms: segmentEnd,
                    text: segmentText,
                    speaker_label: segment.speaker || null,
                    confidence_score: segment.confidence || null,
                    _segments: [segment]
                };
            } else {
                // Check if this segment fits in current chunk window
                const chunkDuration = segmentEnd - currentChunk.start_time_ms;
                
                if (chunkDuration <= windowMs) {
                    // Add to current chunk
                    currentChunk.text += ' ' + segmentText;
                    currentChunk.end_time_ms = segmentEnd;
                    currentChunk._segments.push(segment);
                    
                    // Update speaker if consistent, otherwise mark as mixed
                    if (segment.speaker && currentChunk.speaker_label) {
                        if (segment.speaker !== currentChunk.speaker_label) {
                            currentChunk.speaker_label = 'MIXED';
                        }
                    }
                    
                    // Average confidence scores
                    if (segment.confidence && currentChunk.confidence_score) {
                        const segmentCount = currentChunk._segments.length;
                        currentChunk.confidence_score = 
                            ((currentChunk.confidence_score * (segmentCount - 1)) + segment.confidence) / segmentCount;
                    }
                } else {
                    // Finish current chunk and start new one
                    delete currentChunk._segments; // Remove temp data
                    chunks.push(currentChunk);
                    
                    currentChunk = {
                        chunk_index: chunkIndex++,
                        start_time_ms: segmentStart,
                        end_time_ms: segmentEnd,
                        text: segmentText,
                        speaker_label: segment.speaker || null,
                        confidence_score: segment.confidence || null,
                        _segments: [segment]
                    };
                }
            }
        }

        // Add final chunk
        if (currentChunk) {
            delete currentChunk._segments;
            chunks.push(currentChunk);
        }

        console.log(`✅ [Chunking] Created ${chunks.length} chunks (${windowMs}ms windows)`);
        return chunks;
    }

    /**
     * Chunk by sentence boundaries
     * @private
     */
    _chunkBySentence(segments, fullText) {
        // Split text into sentences
        const sentences = this._splitIntoSentences(fullText || segments.map(s => s.text).join(' '));
        
        const chunks = [];
        let chunkIndex = 0;
        let currentTimeMs = 0;
        const avgWordsPerMinute = 150; // Average speaking rate
        
        for (const sentence of sentences) {
            if (!sentence.trim()) continue;
            
            const wordCount = sentence.split(/\s+/).length;
            const durationMs = (wordCount / avgWordsPerMinute) * 60000;
            
            chunks.push({
                chunk_index: chunkIndex++,
                start_time_ms: Math.round(currentTimeMs),
                end_time_ms: Math.round(currentTimeMs + durationMs),
                text: sentence.trim(),
                speaker_label: null,
                confidence_score: null
            });
            
            currentTimeMs += durationMs;
        }

        console.log(`✅ [Chunking] Created ${chunks.length} sentence-based chunks`);
        return chunks;
    }

    /**
     * Chunk by paragraph boundaries
     * @private
     */
    _chunkByParagraph(segments, fullText) {
        // Split text into paragraphs
        const paragraphs = (fullText || segments.map(s => s.text).join(' '))
            .split(/\n\n+/)
            .filter(p => p.trim());
        
        const chunks = [];
        let chunkIndex = 0;
        let currentTimeMs = 0;
        const avgWordsPerMinute = 150;
        
        for (const paragraph of paragraphs) {
            if (!paragraph.trim()) continue;
            
            const wordCount = paragraph.split(/\s+/).length;
            const durationMs = (wordCount / avgWordsPerMinute) * 60000;
            
            chunks.push({
                chunk_index: chunkIndex++,
                start_time_ms: Math.round(currentTimeMs),
                end_time_ms: Math.round(currentTimeMs + durationMs),
                text: paragraph.trim(),
                speaker_label: null,
                confidence_score: null
            });
            
            currentTimeMs += durationMs;
        }

        console.log(`✅ [Chunking] Created ${chunks.length} paragraph-based chunks`);
        return chunks;
    }

    /**
     * Chunk by speaker changes
     * @private
     */
    _chunkBySpeaker(segments) {
        const chunks = [];
        let currentChunk = null;
        let chunkIndex = 0;

        for (const segment of segments) {
            const segmentText = (segment.text || '').trim();
            if (!segmentText) continue;

            const speaker = segment.speaker || 'Unknown';

            if (!currentChunk || currentChunk.speaker_label !== speaker) {
                // Start new chunk for new speaker
                if (currentChunk) {
                    chunks.push(currentChunk);
                }
                
                currentChunk = {
                    chunk_index: chunkIndex++,
                    start_time_ms: segment.start_ms || 0,
                    end_time_ms: segment.end_ms || 0,
                    text: segmentText,
                    speaker_label: speaker,
                    confidence_score: segment.confidence || null
                };
            } else {
                // Continue current speaker's chunk
                currentChunk.text += ' ' + segmentText;
                currentChunk.end_time_ms = segment.end_ms || currentChunk.end_time_ms;
            }
        }

        // Add final chunk
        if (currentChunk) {
            chunks.push(currentChunk);
        }

        console.log(`✅ [Chunking] Created ${chunks.length} speaker-based chunks`);
        return chunks;
    }

    /**
     * Split text into sentences (simple heuristic)
     * @private
     */
    _splitIntoSentences(text) {
        // Split on sentence-ending punctuation followed by whitespace
        // This is a simple heuristic and could be improved with NLP
        return text
            .replace(/([.!?])\s+/g, '$1\n')
            .split('\n')
            .filter(s => s.trim());
    }

    /**
     * Validate chunking strategy
     * @param {string} strategy - Strategy code
     * @returns {boolean} True if valid
     */
    isValidStrategy(strategy) {
        const validStrategies = [
            'BY_TIME_15S',
            'BY_TIME_30S',
            'BY_TIME_60S',
            'BY_SENTENCE',
            'BY_PARAGRAPH',
            'BY_SPEAKER'
        ];
        return validStrategies.includes(strategy);
    }

    /**
     * Get strategy duration in milliseconds (for time-based strategies)
     * @param {string} strategy - Strategy code
     * @returns {number|null} Duration in ms or null
     */
    getStrategyDuration(strategy) {
        const durations = {
            'BY_TIME_15S': 15000,
            'BY_TIME_30S': 30000,
            'BY_TIME_60S': 60000
        };
        return durations[strategy] || null;
    }

    /**
     * Merge small chunks (post-processing)
     * @param {array} chunks - Array of chunks
     * @param {number} minChunkSize - Minimum chunk size in characters
     * @returns {array} Merged chunks
     */
    mergeSmallChunks(chunks, minChunkSize = 50) {
        if (!chunks || chunks.length === 0) return chunks;

        const merged = [];
        let currentChunk = null;

        for (const chunk of chunks) {
            if (!currentChunk) {
                currentChunk = { ...chunk };
            } else if (currentChunk.text.length < minChunkSize) {
                // Merge with previous chunk if too small
                currentChunk.text += ' ' + chunk.text;
                currentChunk.end_time_ms = chunk.end_time_ms;
                if (chunk.speaker_label && currentChunk.speaker_label !== chunk.speaker_label) {
                    currentChunk.speaker_label = 'MIXED';
                }
            } else {
                // Current chunk is big enough, save it and start new one
                merged.push(currentChunk);
                currentChunk = { ...chunk };
            }
        }

        // Add final chunk
        if (currentChunk) {
            merged.push(currentChunk);
        }

        // Re-index chunks
        merged.forEach((chunk, index) => {
            chunk.chunk_index = index;
        });

        return merged;
    }
}

// Singleton instance
let chunkingServiceInstance = null;

function getChunkingService() {
    if (!chunkingServiceInstance) {
        chunkingServiceInstance = new ChunkingService();
    }
    return chunkingServiceInstance;
}

module.exports = {
    ChunkingService,
    getChunkingService
};

