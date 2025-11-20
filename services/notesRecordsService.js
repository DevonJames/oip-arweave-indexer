/**
 * Notes Records Service
 * Helper functions for creating OIP records for notes, transcripts, and chunks
 */
const axios = require('axios');
const crypto = require('crypto');

class NotesRecordsService {
    constructor() {
        this.apiBaseUrl = `http://localhost:${process.env.PORT || 3005}`;
    }

    /**
     * Create audio record in GUN storage
     * @param {object} audioMeta - Audio metadata
     * @param {string} userPublicKey - User's HD wallet public key
     * @param {string} token - JWT token
     * @returns {Promise<object>} Created record info
     */
    async createAudioRecord(audioMeta, userPublicKey, token) {
        try {
            const {
                audioHash,
                durationSec,
                audioCodec,
                contentType,
                size,
                webUrl
            } = audioMeta;

            const recordData = {
                basic: {
                    name: `Audio recording ${new Date().toISOString()}`,
                    description: 'Alfred Notes audio capture',
                    date: Math.floor(Date.now() / 1000),
                    language: 'en'
                },
                audio: {
                    durationSec: durationSec || 0,
                    audioCodec: audioCodec || 'UNKNOWN',
                    contentType: contentType || 'audio/webm',
                    size: size || 0,
                    webUrl: webUrl || ''
                },
                accessControl: {
                    access_level: 'private',
                    owner_public_key: userPublicKey,
                    created_by: userPublicKey,
                    created_timestamp: Date.now(),
                    last_modified_timestamp: Date.now(),
                    version: '1.0.0'
                }
            };

            console.log(`📼 [Notes Records] Creating audio record with hash: ${audioHash}`);

            const response = await axios.post(
                `${this.apiBaseUrl}/api/records/newRecord?recordType=audio&storage=gun&localId=${audioHash}`,
                recordData,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                }
            );

            return {
                did: response.data.did,
                audioHash: audioHash
            };
        } catch (error) {
            console.error('❌ [Notes Records] Failed to create audio record:', error.message);
            throw new Error(`Audio record creation failed: ${error.message}`);
        }
    }

    /**
     * Create transcript text record in GUN storage
     * @param {string} noteHash - Note hash for localId
     * @param {string} transcriptText - Full transcript text
     * @param {string} language - Detected language
     * @param {string} userPublicKey - User's HD wallet public key
     * @param {string} token - JWT token
     * @returns {Promise<object>} Created record info
     */
    async createTranscriptTextRecord(noteHash, transcriptText, language, userPublicKey, token) {
        try {
            const localId = `${noteHash}:transcript`;

            const recordData = {
                basic: {
                    name: `Transcript for note ${noteHash.substring(0, 8)}...`,
                    description: 'Full transcript from Alfred Notes',
                    date: Math.floor(Date.now() / 1000),
                    language: language || 'en',
                    tagItems: ['alfred_note_transcript']
                },
                text: {
                    value: transcriptText
                },
                accessControl: {
                    access_level: 'private',
                    owner_public_key: userPublicKey,
                    created_by: userPublicKey,
                    created_timestamp: Date.now(),
                    last_modified_timestamp: Date.now(),
                    version: '1.0.0'
                }
            };

            console.log(`📄 [Notes Records] Creating transcript text record: ${localId}`);

            const response = await axios.post(
                `${this.apiBaseUrl}/api/records/newRecord?recordType=text&storage=gun&localId=${localId}`,
                recordData,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                }
            );

            return {
                did: response.data.did,
                localId: localId
            };
        } catch (error) {
            console.error('❌ [Notes Records] Failed to create transcript record:', error.message);
            throw new Error(`Transcript record creation failed: ${error.message}`);
        }
    }

    /**
     * Create note chunk record in GUN storage
     * @param {string} noteHash - Note hash
     * @param {object} chunk - Chunk data
     * @param {string} noteType - Type of note
     * @param {number} captureDate - Capture date (ms)
     * @param {string} userPublicKey - User's HD wallet public key
     * @param {string} token - JWT token
     * @returns {Promise<object>} Created record info
     */
    async createNoteChunkRecord(noteHash, chunk, noteType, captureDate, userPublicKey, token) {
        try {
            const localId = `${noteHash}:${chunk.chunk_index}`;

            // Use only LLM-generated tags
            const chunkTags = chunk.tags && chunk.tags.length > 0 
                ? chunk.tags
                : [];

            const recordData = {
                basic: {
                    name: `Note chunk ${chunk.chunk_index}`,
                    description: `Chunk from ${noteType} note`,
                    date: Math.floor(captureDate / 1000),
                    language: 'en',
                    tagItems: chunkTags
                },
                noteChunks: {
                    note_ref: null, // Can be populated later
                    chunk_index: chunk.chunk_index,
                    start_time_ms: chunk.start_time_ms,
                    end_time_ms: chunk.end_time_ms,
                    text: chunk.text,
                    speaker_label: chunk.speaker_label || null,
                    is_marked_important: false,
                    sentiment: null,
                    confidence_score: chunk.confidence_score || null
                },
                accessControl: {
                    access_level: 'private',
                    owner_public_key: userPublicKey,
                    created_by: userPublicKey,
                    created_timestamp: Date.now(),
                    last_modified_timestamp: Date.now(),
                    version: '1.0.0'
                }
            };

            const response = await axios.post(
                `${this.apiBaseUrl}/api/records/newRecord?recordType=noteChunks&storage=gun&localId=${localId}`,
                recordData,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                }
            );

            return {
                did: response.data.did,
                localId: localId
            };
        } catch (error) {
            console.error(`❌ [Notes Records] Failed to create chunk ${chunk.chunk_index}:`, error.message);
            // Don't throw - allow partial success
            return null;
        }
    }

    /**
     * Create note record in GUN storage
     * @param {string} noteHash - Note hash
     * @param {object} payload - Note data payload
     * @param {string} userPublicKey - User's HD wallet public key
     * @param {string} token - JWT token
     * @returns {Promise<object>} Created record info
     */
    async createNoteRecord(noteHash, payload, userPublicKey, token) {
        try {
            const recordData = {
                basic: {
                    name: payload.title || `Note ${new Date().toISOString()}`,
                    description: payload.description || 'Alfred Notes capture',
                    date: Math.floor(Date.now() / 1000),
                    language: payload.language || 'en',
                    tagItems: payload.tags || []
                },
                // Add audio object with full template fields if audio metadata provided
                audio: payload.audio_meta ? {
                    webUrl: payload.audio_meta.webUrl || '',
                    arweaveAddress: payload.audio_meta.arweaveAddress || '',
                    ipfsAddress: payload.audio_meta.ipfsAddress || '',
                    bittorrentAddress: payload.audio_meta.bittorrentAddress || '',
                    filename: payload.audio_meta.filename || '',
                    size: payload.audio_meta.size || 0,
                    durationSec: payload.audio_meta.durationSec || 0,
                    audioCodec: payload.audio_meta.audioCodec || 'UNKNOWN',
                    contentType: payload.audio_meta.contentType || '',
                    thumbnails: [],
                    creator: userPublicKey
                } : undefined,
                notes: {
                    note_type: payload.note_type,
                    created_at: payload.created_at,
                    ended_at: payload.ended_at,
                    device_type: payload.device_type,
                    capture_location: payload.capture_location || null,
                    
                    audio_ref: payload.audio_ref || null,
                    
                    transcription_engine: payload.transcription_engine_did || null,
                    transcription_status: payload.transcription_status,
                    transcript_full_text: payload.transcript_did || null,
                    user_edits_present: false,
                    
                    summary_key_points: payload.summary_key_points || [],
                    summary_decisions: payload.summary_decisions || [],
                    summary_action_item_texts: payload.summary_action_item_texts || [],
                    summary_action_item_assignees: payload.summary_action_item_assignees || [],
                    summary_action_item_due_texts: payload.summary_action_item_due_texts || [],
                    summary_open_questions: payload.summary_open_questions || [],
                    summary_version: 1,
                    
                    participant_display_names: payload.participant_display_names || [],
                    participant_person_refs: [],
                    participant_emails: [],
                    participant_roles: payload.participant_roles || [],
                    
                    calendar_event_id: payload.calendar_event_id || null,
                    calendar_start_time: payload.calendar_start_time || null,
                    calendar_end_time: payload.calendar_end_time || null,
                    linked_projects: [],
                    
                    topics_auto: payload.topics_auto || [],
                    keywords_auto: payload.keywords_auto || [],
                    sentiment_overall: payload.sentiment_overall || 'NEUTRAL',
                    
                    chunking_strategy: payload.chunking_strategy,
                    chunk_count: payload.chunk_count,
                    chunk_ids: payload.chunk_ids || []
                },
                accessControl: {
                    access_level: 'private',
                    owner_public_key: userPublicKey,
                    created_by: userPublicKey,
                    created_timestamp: Date.now(),
                    last_modified_timestamp: Date.now(),
                    version: '1.0.0'
                }
            };

            console.log(`📝 [Notes Records] Creating note record: ${noteHash}`);

            const response = await axios.post(
                `${this.apiBaseUrl}/api/records/newRecord?recordType=notes&storage=gun&localId=${noteHash}`,
                recordData,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                }
            );

            return {
                did: response.data.did,
                noteHash: noteHash
            };
        } catch (error) {
            console.error('❌ [Notes Records] Failed to create note record:', error.message);
            throw new Error(`Note record creation failed: ${error.message}`);
        }
    }

    /**
     * Compute deterministic note hash from transcript
     * @param {string} transcriptText - Full transcript text
     * @returns {string} SHA256 hash (hex)
     */
    computeNoteHash(transcriptText) {
        // Normalize transcript
        const normalized = transcriptText
            .trim()
            .replace(/\r\n/g, '\n') // Normalize line endings
            .normalize('NFC'); // NFC normalization for unicode

        // Compute hash
        const hash = crypto.createHash('sha256')
            .update(normalized, 'utf8')
            .digest('hex');

        console.log(`#️⃣ [Notes Records] Computed note hash: ${hash.substring(0, 16)}...`);
        return hash;
    }

    /**
     * Create all note chunks (batch operation)
     * @param {string} noteHash - Note hash
     * @param {array} chunks - Array of chunk data
     * @param {string} noteType - Type of note
     * @param {number} captureDate - Capture date (ms)
     * @param {string} userPublicKey - User's HD wallet public key
     * @param {string} token - JWT token
     * @returns {Promise<array>} Array of created chunk DIDs
     */
    async createAllNoteChunks(noteHash, chunks, noteType, captureDate, userPublicKey, token) {
        console.log(`📦 [Notes Records] Creating ${chunks.length} note chunks...`);

        const chunkPromises = chunks.map(chunk =>
            this.createNoteChunkRecord(noteHash, chunk, noteType, captureDate, userPublicKey, token)
        );

        // Execute in parallel with some concurrency control
        const results = [];
        const batchSize = 5; // Process 5 chunks at a time
        
        for (let i = 0; i < chunkPromises.length; i += batchSize) {
            const batch = chunkPromises.slice(i, i + batchSize);
            const batchResults = await Promise.all(batch);
            results.push(...batchResults);
        }

        // Filter out nulls from failed chunks
        const successfulChunks = results.filter(r => r !== null);
        
        console.log(`✅ [Notes Records] Created ${successfulChunks.length}/${chunks.length} chunks`);
        
        return successfulChunks;
    }
}

// Singleton instance
let notesRecordsServiceInstance = null;

function getNotesRecordsService() {
    if (!notesRecordsServiceInstance) {
        notesRecordsServiceInstance = new NotesRecordsService();
    }
    return notesRecordsServiceInstance;
}

module.exports = {
    NotesRecordsService,
    getNotesRecordsService
};

