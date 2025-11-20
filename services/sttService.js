/**
 * Speech-to-Text Service
 * Handles transcription of audio files using configured transcription engines
 */
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const { Readable } = require('stream');

const STT_SERVICE_URL = process.env.STT_SERVICE_URL || 'http://localhost:8003';

class STTService {
    constructor() {
        this.sttServiceUrl = STT_SERVICE_URL;
    }

    /**
     * Transcribe audio file using the specified transcription engine
     * @param {string|Buffer} audioFile - Path to audio file or buffer
     * @param {object} transcriptionEngineRecord - TranscriptionEngine record with config
     * @returns {Promise<object>} Transcription result with text, language, and segments
     */
    async transcribe(audioFile, transcriptionEngineRecord = null) {
        try {
            console.log('🎙️ [STT Service] Starting transcription...');
            
            // Determine engine configuration from record
            const engineConfig = this._extractEngineConfig(transcriptionEngineRecord);
            
            // Route to appropriate STT provider based on engine kind
            if (engineConfig.kind === 'REMOTE_API') {
                return await this._transcribeWithRemoteAPI(audioFile, engineConfig);
            } else {
                // Default to local/self-hosted Whisper
                return await this._transcribeWithLocalWhisper(audioFile, engineConfig);
            }
        } catch (error) {
            console.error('❌ [STT Service] Transcription failed:', error.message);
            throw new Error(`Transcription failed: ${error.message}`);
        }
    }

    /**
     * Extract engine configuration from transcriptionEngine record
     * @private
     */
    _extractEngineConfig(transcriptionEngineRecord) {
        if (!transcriptionEngineRecord) {
            return {
                kind: 'LOCAL',
                provider: 'whisper',
                model: 'base',
                language: null
            };
        }

        const engineData = transcriptionEngineRecord.data?.transcriptionEngine || {};
        
        return {
            kind: engineData.engine_kind || 'LOCAL',
            provider: engineData.provider || 'whisper',
            model: engineData.model_name || 'base',
            language: engineData.default_language || null,
            maxDuration: engineData.max_duration_seconds || 7200, // 2 hours default
            streamingSupported: engineData.streaming_supported || false
        };
    }

    /**
     * Transcribe using local/self-hosted Whisper service
     * @private
     */
    async _transcribeWithLocalWhisper(audioFile, engineConfig) {
        try {
            const formData = new FormData();
            
            // Handle file path or buffer
            if (typeof audioFile === 'string') {
                // File path
                formData.append('file', fs.createReadStream(audioFile));
            } else if (Buffer.isBuffer(audioFile)) {
                // Buffer - convert to stream
                const bufferStream = new Readable();
                bufferStream.push(audioFile);
                bufferStream.push(null);
                formData.append('file', bufferStream, {
                    filename: 'audio.webm',
                    contentType: 'audio/webm'
                });
            } else {
                throw new Error('Invalid audio file format. Expected path or buffer.');
            }

            // Add optional parameters
            if (engineConfig.language) {
                formData.append('language', engineConfig.language);
            }
            formData.append('task', 'transcribe');
            
            console.log(`🔊 [STT Service] Calling Whisper at ${this.sttServiceUrl}/transcribe_file`);
            
            const response = await axios.post(
                `${this.sttServiceUrl}/transcribe_file`,
                formData,
                {
                    headers: formData.getHeaders(),
                    timeout: engineConfig.maxDuration * 1000 + 30000, // Add 30s buffer
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity
                }
            );

            // Normalize response format
            return this._normalizeTranscriptionResponse(response.data);
        } catch (error) {
            console.error('❌ [STT Service] Whisper transcription failed:', error.message);
            throw error;
        }
    }

    /**
     * Transcribe using remote API (OpenAI, etc.)
     * @private
     */
    async _transcribeWithRemoteAPI(audioFile, engineConfig) {
        // TODO: Implement remote API transcription (OpenAI Whisper API, etc.)
        throw new Error('Remote API transcription not yet implemented');
    }

    /**
     * Normalize transcription response to consistent format
     * @private
     */
    _normalizeTranscriptionResponse(response) {
        // Handle different response formats from STT services
        const text = response.text || response.transcription || '';
        const language = response.language || response.detected_language || 'en';
        
        // Normalize segments format
        let segments = [];
        if (response.segments && Array.isArray(response.segments)) {
            segments = response.segments.map(seg => ({
                start_ms: Math.round((seg.start || seg.start_time || 0) * 1000),
                end_ms: Math.round((seg.end || seg.end_time || 0) * 1000),
                text: seg.text || '',
                speaker: seg.speaker || seg.speaker_label || null,
                confidence: seg.confidence || seg.prob || null
            }));
        } else if (response.words && Array.isArray(response.words)) {
            // If only word-level timestamps, create sentence-level segments
            segments = this._createSegmentsFromWords(response.words);
        } else {
            // No timing information - create single segment
            segments = [{
                start_ms: 0,
                end_ms: 0,
                text: text,
                speaker: null,
                confidence: response.confidence || null
            }];
        }

        return {
            language,
            text,
            segments
        };
    }

    /**
     * Create segments from word-level timestamps
     * @private
     */
    _createSegmentsFromWords(words) {
        // Group words into sentence-level segments (approximately 30 seconds each)
        const segments = [];
        let currentSegment = {
            start_ms: 0,
            end_ms: 0,
            text: '',
            words: []
        };

        for (const word of words) {
            const wordStart = Math.round((word.start || word.start_time || 0) * 1000);
            const wordEnd = Math.round((word.end || word.end_time || 0) * 1000);
            const wordText = word.word || word.text || '';

            if (currentSegment.words.length === 0) {
                currentSegment.start_ms = wordStart;
            }

            currentSegment.words.push(wordText);
            currentSegment.end_ms = wordEnd;

            // Create new segment after punctuation or 30 seconds
            const duration = currentSegment.end_ms - currentSegment.start_ms;
            const hasPunctuation = wordText.match(/[.!?]$/);
            
            if (hasPunctuation || duration >= 30000) {
                currentSegment.text = currentSegment.words.join(' ').trim();
                delete currentSegment.words;
                segments.push({ ...currentSegment });
                
                currentSegment = {
                    start_ms: wordEnd,
                    end_ms: wordEnd,
                    text: '',
                    words: []
                };
            }
        }

        // Add final segment if it has content
        if (currentSegment.words.length > 0) {
            currentSegment.text = currentSegment.words.join(' ').trim();
            delete currentSegment.words;
            segments.push(currentSegment);
        }

        return segments;
    }

    /**
     * Validate audio file before transcription
     * @param {string} filePath - Path to audio file
     * @param {object} engineConfig - Engine configuration
     * @returns {Promise<object>} File metadata
     */
    async validateAudioFile(filePath, engineConfig = {}) {
        try {
            const stats = fs.statSync(filePath);
            const fileSizeGB = stats.size / (1024 * 1024 * 1024);

            // Check file size (default max 500MB)
            const maxSizeGB = engineConfig.maxSizeGB || 0.5;
            if (fileSizeGB > maxSizeGB) {
                throw new Error(`Audio file too large: ${fileSizeGB.toFixed(2)}GB (max: ${maxSizeGB}GB)`);
            }

            // TODO: Add codec validation using ffprobe
            
            return {
                size: stats.size,
                sizeGB: fileSizeGB,
                valid: true
            };
        } catch (error) {
            console.error('❌ [STT Service] Audio validation failed:', error.message);
            throw error;
        }
    }
}

// Singleton instance
let sttServiceInstance = null;

function getSTTService() {
    if (!sttServiceInstance) {
        sttServiceInstance = new STTService();
    }
    return sttServiceInstance;
}

module.exports = {
    STTService,
    getSTTService
};

