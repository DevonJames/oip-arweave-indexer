/**
 * Notes API Routes
 * Handles Alfred Meeting Notes endpoints for audio ingestion, retrieval, and management
 */
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { authenticateToken } = require('../helpers/utils');
const { getRecords, searchRecordInDB } = require('../helpers/elasticsearch');
const { getSTTService } = require('../services/sttService');
const { getSummarizationService } = require('../services/summarizationService');
const { getChunkingService } = require('../services/chunkingService');
const { getNotesRecordsService } = require('../services/notesRecordsService');

const router = express.Router();

// Configure multer for file uploads
const uploadDir = path.join(__dirname, '../data/temp/notes');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `audio_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: 500 * 1024 * 1024 // 500MB limit
    }
});

/**
 * POST /api/notes/from-audio
 * Main ingestion endpoint for audio notes
 * Processes: Audio → Transcription → Chunking → Summary → OIP Records
 */
router.post('/from-audio', authenticateToken, upload.single('audio'), async (req, res) => {
    let tempFilePath = null;
    
    try {
        console.log('🎙️ [POST /api/notes/from-audio] Starting audio note ingestion');
        console.log('📋 [Request] User:', req.user.email);
        console.log('📋 [Request] File:', req.file ? req.file.originalname : 'none');
        console.log('📋 [Request] Body:', Object.keys(req.body));

        // ========================================
        // STEP 1: Validate Request
        // ========================================
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No audio file provided'
            });
        }

        const {
            start_time,
            end_time,
            note_type,
            device_type,
            capture_location,
            transcription_engine_id,
            chunking_strategy = 'BY_TIME_30S',
            participant_display_names,
            participant_roles,
            calendar_event_id,
            calendar_start_time,
            calendar_end_time,
            model = 'parallel', // LLM model selection (supports 'parallel', 'gpt-4o-mini', 'grok-beta', etc.)
            addToWebServer = 'false',
            addToBitTorrent = 'false',
            addToIPFS = 'false'
        } = req.body;

        // Validate required fields
        if (!start_time || !end_time) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: start_time and end_time'
            });
        }

        if (!note_type) {
            return res.status(400).json({
                success: false,
                error: 'Missing required field: note_type'
            });
        }

        if (!device_type) {
            return res.status(400).json({
                success: false,
                error: 'Missing required field: device_type'
            });
        }

        // Validate note_type
        const validNoteTypes = ['MEETING', 'ONE_ON_ONE', 'STANDUP', 'IDEA', 'REFLECTION', 'INTERVIEW', 'OTHER'];
        if (!validNoteTypes.includes(note_type)) {
            return res.status(400).json({
                success: false,
                error: `Invalid note_type. Must be one of: ${validNoteTypes.join(', ')}`
            });
        }

        // Validate device_type
        const validDeviceTypes = ['IPHONE', 'MAC', 'WATCH', 'OTHER'];
        if (!validDeviceTypes.includes(device_type)) {
            return res.status(400).json({
                success: false,
                error: `Invalid device_type. Must be one of: ${validDeviceTypes.join(', ')}`
            });
        }

        // Validate time range
        const startDate = new Date(start_time);
        const endDate = new Date(end_time);
        if (startDate >= endDate) {
            return res.status(400).json({
                success: false,
                error: 'start_time must be before end_time'
            });
        }

        // Validate chunking strategy
        const chunkingService = getChunkingService();
        if (!chunkingService.isValidStrategy(chunking_strategy)) {
            return res.status(400).json({
                success: false,
                error: `Invalid chunking_strategy. Must be one of: BY_TIME_15S, BY_TIME_30S, BY_TIME_60S, BY_SENTENCE, BY_PARAGRAPH`
            });
        }

        // Parse participant arrays if provided
        let participantNames = [];
        let participantRolesArray = [];
        if (participant_display_names) {
            try {
                participantNames = JSON.parse(participant_display_names);
            } catch (e) {
                participantNames = [participant_display_names];
            }
        }
        if (participant_roles) {
            try {
                participantRolesArray = JSON.parse(participant_roles);
            } catch (e) {
                participantRolesArray = [participant_roles];
            }
        }

        // Validate participant arrays have same length if both provided
        if (participantNames.length > 0 && participantRolesArray.length > 0) {
            if (participantNames.length !== participantRolesArray.length) {
                return res.status(400).json({
                    success: false,
                    error: 'participant_display_names and participant_roles must have same length'
                });
            }
        }

        tempFilePath = req.file.path;
        const userPublicKey = req.user.publicKey || req.user.publisherPubKey;
        const token = req.headers.authorization.split(' ')[1];

        if (!userPublicKey) {
            return res.status(401).json({
                success: false,
                error: 'User public key not available'
            });
        }

        // ========================================
        // STEP 2: Upload Audio File via /api/media/upload
        // ========================================
        console.log('📼 [Step 2] Uploading audio file...');
        
        const audioBuffer = fs.readFileSync(tempFilePath);
        const audioSize = audioBuffer.length;
        const audioHash = crypto.createHash('sha256').update(audioBuffer).digest('hex');
        const durationSec = Math.round((endDate - startDate) / 1000);

        // Parse boolean params
        const shouldAddToWebServer = addToWebServer === 'true' || addToWebServer === true;
        const shouldAddToBitTorrent = addToBitTorrent === 'true' || addToBitTorrent === true;
        const shouldAddToIPFS = addToIPFS === 'true' || addToIPFS === true;

        console.log(`📤 [Step 2] Storage options: WebServer=${shouldAddToWebServer}, BitTorrent=${shouldAddToBitTorrent}, IPFS=${shouldAddToIPFS}`);

        let audioMeta = {
            audioHash,
            durationSec,
            audioCodec: router._detectCodecFromMime(req.file.mimetype),
            contentType: req.file.mimetype,
            size: audioSize,
            filename: req.file.originalname || `note_audio_${Date.now()}.${router._getExtensionFromMime(req.file.mimetype)}`,
            webUrl: null,
            arweaveAddress: null,
            ipfsAddress: null,
            bittorrentAddress: null,
            magnetURI: null
        };

        const notesRecordsService = getNotesRecordsService();
        
        // Upload audio file using /api/media/upload endpoint
        try {
            const FormData = require('form-data');
            const uploadForm = new FormData();
            uploadForm.append('file', audioBuffer, {
                filename: audioMeta.filename,
                contentType: req.file.mimetype
            });
            uploadForm.append('access_level', 'private');

            const axios = require('axios');
            const uploadResponse = await axios.post(
                `http://localhost:${process.env.PORT || 3005}/api/media/upload`,
                uploadForm,
                {
                    headers: {
                        ...uploadForm.getHeaders(),
                        'Authorization': `Bearer ${token}`
                    },
                    timeout: 60000
                }
            );

            if (uploadResponse.data && uploadResponse.data.success) {
                const mediaId = uploadResponse.data.mediaId;
                audioMeta.mediaId = mediaId;
                audioMeta.httpUrl = uploadResponse.data.httpUrl;
                audioMeta.bittorrentAddress = uploadResponse.data.magnetURI;
                audioMeta.magnetURI = uploadResponse.data.magnetURI;
                console.log('✅ [Step 2] Audio uploaded to media server:', mediaId);

                // Web server setup if requested
                if (shouldAddToWebServer) {
                    try {
                        const webSetupResponse = await axios.post(
                            `http://localhost:${process.env.PORT || 3005}/api/media/web-setup`,
                            {
                                mediaId: mediaId,
                                filename: audioMeta.filename
                            },
                            {
                                headers: { 'Authorization': `Bearer ${token}` },
                                timeout: 30000
                            }
                        );
                        if (webSetupResponse.data && webSetupResponse.data.success) {
                            audioMeta.webUrl = webSetupResponse.data.webUrl;
                            console.log('✅ [Step 2] Audio web URL configured:', audioMeta.webUrl);
                        }
                    } catch (webError) {
                        console.warn('⚠️ [Step 2] Web setup failed (non-fatal):', webError.message);
                    }
                }

                // IPFS upload if requested
                if (shouldAddToIPFS) {
                    try {
                        const ipfsResponse = await axios.post(
                            `http://localhost:${process.env.PORT || 3005}/api/media/ipfs-upload`,
                            { mediaId: mediaId },
                            {
                                headers: { 'Authorization': `Bearer ${token}` },
                                timeout: 120000
                            }
                        );
                        if (ipfsResponse.data && ipfsResponse.data.success) {
                            audioMeta.ipfsAddress = ipfsResponse.data.ipfsHash;
                            console.log('✅ [Step 2] Audio uploaded to IPFS:', audioMeta.ipfsAddress);
                        }
                    } catch (ipfsError) {
                        console.warn('⚠️ [Step 2] IPFS upload failed (non-fatal):', ipfsError.message);
                    }
                }
            }
        } catch (uploadError) {
            console.warn('⚠️ [Step 2] Media upload failed (continuing with basic metadata):', uploadError.message);
        }

        // ========================================
        // STEP 3: Resolve Transcription Engine
        // ========================================
        console.log('🔍 [Step 3] Resolving transcription engine...');
        
        let transcriptionEngineRecord = null;
        let transcriptionEngineDid = null;
        
        if (transcription_engine_id) {
            try {
                const engineResults = await getRecords({
                    recordType: 'transcriptionEngine',
                    fieldName: 'transcriptionEngine.engine_id',
                    fieldSearch: transcription_engine_id,
                    fieldMatchMode: 'exact',
                    limit: 1
                });

                if (engineResults.records && engineResults.records.length > 0) {
                    transcriptionEngineRecord = engineResults.records[0];
                    transcriptionEngineDid = transcriptionEngineRecord.oip?.did || transcriptionEngineRecord.oip?.didTx;
                    console.log('✅ [Step 3] Found transcription engine:', transcription_engine_id);
                } else {
                    console.warn('⚠️ [Step 3] Transcription engine not found:', transcription_engine_id);
                    return res.status(422).json({
                        success: false,
                        error: `Transcription engine not configured: ${transcription_engine_id}`
                    });
                }
            } catch (error) {
                console.error('❌ [Step 3] Engine lookup failed:', error.message);
                return res.status(500).json({
                    success: false,
                    error: 'Failed to lookup transcription engine'
                });
            }
        }

        // ========================================
        // STEP 4: Run Speech-to-Text
        // ========================================
        console.log('🎤 [Step 4] Running speech-to-text...');
        
        const sttService = getSTTService();
        let transcriptionResult;
        
        try {
            transcriptionResult = await sttService.transcribe(tempFilePath, transcriptionEngineRecord);
            console.log('✅ [Step 4] Transcription complete');
            console.log(`   Language: ${transcriptionResult.language}`);
            console.log(`   Text length: ${transcriptionResult.text.length} chars`);
            console.log(`   Segments: ${transcriptionResult.segments.length}`);
        } catch (error) {
            console.error('❌ [Step 4] Transcription failed:', error.message);
            return res.status(502).json({
                success: false,
                error: 'Speech-to-text processing failed',
                details: error.message
            });
        }

        // ========================================
        // STEP 5: Compute Note Hash
        // ========================================
        console.log('🔐 [Step 5] Computing note hash...');
        
        const noteHash = notesRecordsService.computeNoteHash(transcriptionResult.text);
        console.log(`✅ [Step 5] Note hash: ${noteHash.substring(0, 16)}...`);

        // ========================================
        // STEP 6: Chunk Transcript
        // ========================================
        console.log('📦 [Step 6] Chunking transcript...');
        
        const chunks = chunkingService.chunk({
            segments: transcriptionResult.segments,
            strategy: chunking_strategy,
            fullText: transcriptionResult.text
        });
        
        console.log(`✅ [Step 6] Created ${chunks.length} chunks`);

        // ========================================
        // STEP 7: Create Transcript Text Record
        // ========================================
        console.log('📄 [Step 7] Creating transcript text record...');
        
        let transcriptTextDid = null;
        try {
            const transcriptRecord = await notesRecordsService.createTranscriptTextRecord(
                noteHash,
                transcriptionResult.text,
                transcriptionResult.language,
                userPublicKey,
                token
            );
            transcriptTextDid = transcriptRecord.did;
            console.log('✅ [Step 7] Transcript record created:', transcriptTextDid);
        } catch (error) {
            console.error('❌ [Step 7] Transcript record creation failed:', error.message);
            // Continue - not fatal
        }

        // ========================================
        // STEP 8: Generate Summary with LLM-based Tags
        // ========================================
        console.log(`📝 [Step 8] Generating summary with model: ${model}...`);
        
        const summarizationService = getSummarizationService();
        let summary;
        
        try {
            summary = await summarizationService.summarize({
                text: transcriptionResult.text,
                note_type: note_type,
                participants: participantNames,
                calendar: calendar_event_id ? {
                    calendar_event_id,
                    calendar_start_time,
                    calendar_end_time
                } : null,
                model: model
            });
            console.log('✅ [Step 8] Summary generated');
            console.log(`   Key points: ${summary.key_points.length}`);
            console.log(`   Decisions: ${summary.decisions.length}`);
            console.log(`   Action items: ${summary.action_items.length}`);
            console.log(`   Topics: ${summary.topics.length}`);
            console.log(`   Keywords: ${summary.keywords.length}`);
            console.log(`   Tags: ${summary.tags.length}`);
        } catch (error) {
            console.error('❌ [Step 8] Summarization failed:', error.message);
            // Continue with empty summary
            summary = {
                key_points: [],
                decisions: [],
                action_items: [],
                open_questions: [],
                sentiment_overall: 'NEUTRAL',
                topics: [],
                keywords: [],
                tags: []
            };
        }

        // ========================================
        // STEP 9: Generate Tags for Chunks & Create Records
        // ========================================
        console.log(`🗂️ [Step 9] Generating tags for ${chunks.length} chunks...`);
        
        // Generate tags for each chunk in parallel
        const chunkTagPromises = chunks.map(chunk => 
            summarizationService.generateChunkTags(chunk.text, note_type, model)
        );
        const chunkTags = await Promise.all(chunkTagPromises);
        
        // Attach tags to chunks
        chunks.forEach((chunk, index) => {
            chunk.tags = chunkTags[index] || [];
        });
        
        console.log('✅ [Step 9] Chunk tags generated');
        console.log(`🗂️ [Step 9] Creating note chunk records...`);
        
        const captureDate = new Date(start_time).getTime();
        const chunkResults = await notesRecordsService.createAllNoteChunks(
            noteHash,
            chunks,
            note_type,
            captureDate,
            userPublicKey,
            token
        );
        
        console.log(`✅ [Step 9] Created ${chunkResults.length} chunk records`);

        // ========================================
        // STEP 10: Create Notes Record
        // ========================================
        console.log('📋 [Step 10] Creating main note record...');
        
        // Extract action item fields for parallel arrays
        const actionItemTexts = summary.action_items.map(item => item.text || '');
        const actionItemAssignees = summary.action_items.map(item => item.assignee || 'unassigned');
        const actionItemDueDates = summary.action_items.map(item => item.due_text || 'no date');

        // Build tag list: LLM-generated tags + base tags
        const noteTags = [
            ...summary.tags, // LLM-generated tags from summary
            'alfred-note', // Base tag (hyphenated for consistency)
            `note-type-${note_type.toLowerCase()}` // Note type tag
        ];

        const notePayload = {
            title: router._generateNoteTitle(note_type, participantNames, transcriptionResult.text),
            description: 'Alfred Notes capture',
            language: transcriptionResult.language,
            tags: noteTags,
            note_type,
            created_at: start_time,
            ended_at: end_time,
            device_type,
            capture_location,
            transcription_engine_did: transcriptionEngineDid,
            transcription_status: 'COMPLETE',
            transcript_did: transcriptTextDid,
            audio_ref: null, // Will be populated with audio DID if created
            audio_meta: audioMeta, // Store audio metadata
            summary_key_points: summary.key_points,
            summary_decisions: summary.decisions,
            summary_action_item_texts: actionItemTexts,
            summary_action_item_assignees: actionItemAssignees,
            summary_action_item_due_texts: actionItemDueDates,
            summary_open_questions: summary.open_questions,
            sentiment_overall: summary.sentiment_overall,
            topics_auto: summary.topics,
            keywords_auto: summary.keywords,
            participant_display_names: participantNames,
            participant_roles: participantRolesArray,
            calendar_event_id,
            calendar_start_time,
            calendar_end_time,
            chunking_strategy,
            chunk_count: chunks.length
        };

        let noteRecordDid = null;
        try {
            const noteRecord = await notesRecordsService.createNoteRecord(
                noteHash,
                notePayload,
                userPublicKey,
                token
            );
            noteRecordDid = noteRecord.did;
            console.log('✅ [Step 10] Note record created:', noteRecordDid);
        } catch (error) {
            console.error('❌ [Step 10] Note record creation failed:', error.message);
            return res.status(500).json({
                success: false,
                error: 'Failed to create note record',
                details: error.message
            });
        }

        // ========================================
        // STEP 11: Cleanup & Return Response
        // ========================================
        console.log('🧹 [Step 11] Cleaning up...');
        
        // Delete temporary audio file
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
            console.log('✅ [Step 11] Temporary file deleted');
        }

        // Return success response
        console.log('✅ [POST /api/notes/from-audio] Ingestion complete');
        res.status(200).json({
            success: true,
            noteHash: noteHash,
            noteDid: noteRecordDid,
            transcriptionStatus: 'COMPLETE',
            chunkCount: chunks.length,
            summary: {
                keyPoints: summary.key_points.length,
                decisions: summary.decisions.length,
                actionItems: summary.action_items.length,
                openQuestions: summary.open_questions.length
            }
        });

    } catch (error) {
        console.error('❌ [POST /api/notes/from-audio] Fatal error:', error);
        
        // Cleanup temp file on error
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            try {
                fs.unlinkSync(tempFilePath);
            } catch (cleanupError) {
                console.warn('⚠️ Failed to cleanup temp file:', cleanupError.message);
            }
        }

        res.status(500).json({
            success: false,
            error: 'Audio note ingestion failed',
            details: error.message
        });
    }
});

/**
 * GET /api/notes/:noteHash
 * Get single note with all related data
 */
router.get('/:noteHash', authenticateToken, async (req, res) => {
    try {
        const { noteHash } = req.params;
        const userPublicKey = req.user.publicKey || req.user.publisherPubKey;

        console.log(`📖 [GET /api/notes/${noteHash}] Fetching note`);

        // Get main note record
        const noteResults = await getRecords({
            source: 'gun',
            recordType: 'notes',
            did: `did:gun:${userPublicKey.substring(0, 12)}:${noteHash}`,
            limit: 1,
            user: req.user,
            isAuthenticated: true
        });

        if (!noteResults.records || noteResults.records.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Note not found'
            });
        }

        const note = noteResults.records[0];

        // Get transcript text if available
        let transcript = null;
        if (note.data?.notes?.transcript_full_text) {
            try {
                const transcriptResults = await getRecords({
                    source: 'gun',
                    did: note.data.notes.transcript_full_text,
                    limit: 1,
                    user: req.user,
                    isAuthenticated: true
                });
                if (transcriptResults.records && transcriptResults.records.length > 0) {
                    transcript = transcriptResults.records[0];
                }
            } catch (error) {
                console.warn('⚠️ Failed to fetch transcript:', error.message);
            }
        }

        // Get chunks metadata (summary only, not full text)
        const chunkCount = note.data?.notes?.chunk_count || 0;
        const chunksInfo = {
            count: chunkCount,
            strategy: note.data?.notes?.chunking_strategy || 'BY_TIME_30S'
        };

        res.status(200).json({
            success: true,
            note: note,
            transcript: transcript,
            chunks: chunksInfo
        });

    } catch (error) {
        console.error('❌ [GET /api/notes/:noteHash] Error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve note'
        });
    }
});

/**
 * GET /api/notes
 * List and search notes
 */
router.get('/', authenticateToken, async (req, res) => {
    try {
        const {
            note_type,
            from,
            to,
            search,
            limit = 20,
            page = 1,
            sortBy = 'date:desc'
        } = req.query;

        console.log('📚 [GET /api/notes] Listing notes');

        const queryParams = {
            source: 'gun',
            recordType: 'notes',
            limit: parseInt(limit),
            page: parseInt(page),
            sortBy: sortBy,
            user: req.user,
            isAuthenticated: true
        };

        // Add filters
        if (note_type) {
            queryParams.fieldName = 'notes.note_type';
            queryParams.fieldSearch = note_type;
            queryParams.fieldMatchMode = 'exact';
        }

        if (from || to) {
            queryParams.dateStart = from;
            queryParams.dateEnd = to;
        }

        if (search) {
            queryParams.search = search;
        }

        const results = await getRecords(queryParams);

        res.status(200).json({
            success: true,
            ...results
        });

    } catch (error) {
        console.error('❌ [GET /api/notes] Error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to list notes'
        });
    }
});

/**
 * PATCH /api/notes/:noteHash
 * Update note metadata
 */
router.patch('/:noteHash', authenticateToken, async (req, res) => {
    try {
        const { noteHash } = req.params;
        const updates = req.body;

        console.log(`✏️ [PATCH /api/notes/${noteHash}] Updating note`);

        // TODO: Implement record update logic
        // This would involve:
        // 1. Verify user owns the note
        // 2. Update allowed fields
        // 3. Increment version/timestamp
        // 4. Re-publish to GUN

        res.status(501).json({
            success: false,
            error: 'Update endpoint not yet implemented'
        });

    } catch (error) {
        console.error('❌ [PATCH /api/notes/:noteHash] Error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update note'
        });
    }
});

/**
 * POST /api/notes/:noteHash/regenerate-summary
 * Regenerate summary for existing note
 */
router.post('/:noteHash/regenerate-summary', authenticateToken, async (req, res) => {
    try {
        const { noteHash } = req.params;
        const { model } = req.body;

        console.log(`🔄 [POST /api/notes/${noteHash}/regenerate-summary] Regenerating summary`);

        // TODO: Implement summary regeneration
        // 1. Fetch note and transcript
        // 2. Re-run summarization with specified model
        // 3. Update note record with new summary
        // 4. Increment summary_version

        res.status(501).json({
            success: false,
            error: 'Summary regeneration not yet implemented'
        });

    } catch (error) {
        console.error('❌ [POST /api/notes/:noteHash/regenerate-summary] Error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to regenerate summary'
        });
    }
});

/**
 * PATCH /api/noteChunks/:localId
 * Update chunk (e.g., mark important)
 */
router.patch('/chunks/:localId', authenticateToken, async (req, res) => {
    try {
        const { localId } = req.params;
        const updates = req.body;

        console.log(`✏️ [PATCH /api/noteChunks/${localId}] Updating chunk`);

        // TODO: Implement chunk update logic
        // Typically used for marking chunks as important

        res.status(501).json({
            success: false,
            error: 'Chunk update endpoint not yet implemented'
        });

    } catch (error) {
        console.error('❌ [PATCH /api/noteChunks/:localId] Error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update chunk'
        });
    }
});

// ========================================
// Helper Functions
// ========================================

/**
 * Detect audio codec from MIME type
 * @private
 */
function _detectCodecFromMime(mimeType) {
    const codecMap = {
        'audio/mpeg': 'MP3',
        'audio/mp4': 'AAC',
        'audio/x-m4a': 'AAC',
        'audio/wav': 'PCM',
        'audio/webm': 'OPUS',
        'audio/flac': 'FLAC',
        'audio/ogg': 'VORBIS'
    };

    return codecMap[mimeType] || 'UNKNOWN';
}

// Attach helper to router for access in handlers
router._detectCodecFromMime = _detectCodecFromMime;

/**
 * Generate note title from content
 * @private
 */
function _generateNoteTitle(note_type, participants, transcriptText) {
    if (participants && participants.length > 0) {
        return `${note_type}: ${participants.join(', ')}`;
    }
    
    // Extract first few words from transcript
    const words = transcriptText.split(/\s+/).slice(0, 8).join(' ');
    return `${note_type}: ${words}...`;
}

/**
 * Get file extension from MIME type
 * @private
 */
function _getExtensionFromMime(mimeType) {
    const extMap = {
        'audio/mpeg': 'mp3',
        'audio/mp4': 'm4a',
        'audio/x-m4a': 'm4a',
        'audio/wav': 'wav',
        'audio/webm': 'webm',
        'audio/flac': 'flac',
        'audio/ogg': 'ogg'
    };

    return extMap[mimeType] || 'audio';
}

// Attach helpers to router for access in handlers
router._generateNoteTitle = _generateNoteTitle;
router._getExtensionFromMime = _getExtensionFromMime;

module.exports = router;

