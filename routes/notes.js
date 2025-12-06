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
 * Helper function to generate audio for text responses
 */
async function generateAudioForResponse(responseText, requestParams) {
    try {
        const voice_id = requestParams.voice_id || 'onwK4e9ZLuTAKqWW03F9';
        const engine = requestParams.engine || 'elevenlabs';
        const speed = requestParams.speed || 1;
        
        console.log(`[Audio Generation] Using engine: ${engine}, voice: ${voice_id}`);
        
        // Use alfred helper to preprocess text for TTS
        const alfredHelper = require('../helpers/alfred');
        const processedText = alfredHelper.preprocessTextForTTS(responseText);
        
        // Limit text length for TTS
        const maxTextLength = 1000;
        const textForTTS = processedText.length > maxTextLength 
            ? processedText.substring(0, maxTextLength) + '...'
            : processedText;
        
        if (engine === 'elevenlabs' && process.env.ELEVENLABS_API_KEY) {
            // Use ElevenLabs API
            const axios = require('axios');
            const elevenLabsResponse = await axios.post(
                `https://api.elevenlabs.io/v1/text-to-speech/${voice_id}`,
                {
                    text: textForTTS,
                    model_id: 'eleven_turbo_v2',
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.75,
                        style: 0.0,
                        use_speaker_boost: true
                    },
                    output_format: 'mp3_44100_128'
                },
                {
                    headers: {
                        'xi-api-key': process.env.ELEVENLABS_API_KEY,
                        'Content-Type': 'application/json'
                    },
                    responseType: 'arraybuffer',
                    timeout: 10000
                }
            );
            
            const buffer = Buffer.from(elevenLabsResponse.data);
            console.log(`[Audio Generation] ✅ Generated ElevenLabs audio: ${buffer.length} bytes`);
            return buffer.toString('base64');
        } else {
            // Fallback to local TTS service
            const TTS_SERVICE_URL = process.env.TTS_SERVICE_URL || 'http://localhost:5002';
            const axios = require('axios');
            
            const ttsParams = {
                text: textForTTS,
                engine: engine,
                voice_id: voice_id,
                speed: speed,
                gender: 'male',
                emotion: 'expressive',
                exaggeration: 0.5,
                cfg_weight: 0.7,
                voice_cloning: false
            };
            
            const ttsResponse = await axios.post(
                `${TTS_SERVICE_URL}/synthesize`,
                ttsParams,
                {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    responseType: 'arraybuffer',
                    timeout: 30000
                }
            );
            
            const buffer = Buffer.from(ttsResponse.data);
            console.log(`[Audio Generation] ✅ Generated ${engine} audio: ${buffer.length} bytes`);
            return buffer.toString('base64');
        }
    } catch (audioError) {
        console.error('[Audio Generation] ⚠️ Audio generation failed:', audioError.message);
        return null;
    }
}

/**
 * Helper function to detect self-referential questions about the AI
 */
function isSelfReferentialQuestion(text) {
    const lowerText = text.toLowerCase();
    
    // Don't treat system prompts as self-referential (avoid "You are a professional..." false positives)
    if (lowerText.startsWith('you are a ') || lowerText.includes('based on this request')) {
        return false;
    }
    
    const selfReferentialPatterns = [
        /\b(tell me about yourself|about yourself|who are you|what are you|introduce yourself|describe yourself)\b/,
        /\b(your capabilities|what can you do|what do you do|your purpose|your role)\b/,
        /\b(are you alfred|are you an ai|what are you|who are you)\b/,  // More specific - avoid "you are" at start
        /\b(hello.*yourself|hi.*yourself|greet.*yourself)\b/,
        /\b(how do you work|how were you made|how were you created)\b/,
        /\b(what is your function|what is your job|what is your mission)\b/
    ];
    
    return selfReferentialPatterns.some(pattern => pattern.test(lowerText));
}

/**
 * Helper function to handle self-referential questions with special prompt
 */
async function handleSelfReferentialQuestion(inputText, model, conversationHistory) {
    console.log(`[ALFRED Notes] Self-referential question detected: "${inputText}" - using special prompt`);
    
    const systemPrompt = "You are ALFRED (Autonomous Linguistic Framework for Retrieval & Enhanced Dialogue), a versatile and articulate AI assistant. You help by answering questions and retrieving information from stored records. You prioritize clarity, speed, and relevance. IMPORTANT: Do not use emojis, asterisks, or other markdown formatting in your responses, as they interfere with text-to-speech synthesis. When asked about yourself, explain your role as an AI assistant that helps with information retrieval and explanation.";
    
    const conversationWithSystem = [
        {
            role: "system",
            content: systemPrompt
        },
        ...conversationHistory
    ];

    try {
        // Call LLM directly for self-referential questions
        const alfredInstance = require('../helpers/alfred');
        
        const alfredOptions = {
            model: model,
            conversationHistory: conversationWithSystem,
            useFieldExtraction: false,
            bypassRAG: true  // Skip RAG search for self-referential questions
        };

        const alfredResponse = await alfredInstance.query(inputText, alfredOptions);
        
        const responseText = alfredResponse.answer || "Hello! I'm ALFRED, your AI assistant designed to help with information retrieval and content creation.";
        
        return {
            answer: responseText,
            sources: [],
            context_used: false,
            search_results_count: 0,
            search_results: [],
            applied_filters: { bypass_reason: "Self-referential question detected" },
            model: alfredResponse.model || model
        };
        
    } catch (llmError) {
        console.error('[ALFRED Notes] Direct LLM call failed:', llmError);
        const fallbackResponse = "Hello! I'm ALFRED, your AI assistant. I'm designed to help you stay informed and productive by answering questions, and retrieving information from stored records. How can I assist you today?";
        
        return {
            answer: fallbackResponse,
            sources: [],
            context_used: false,
            search_results_count: 0,
            search_results: [],
            applied_filters: { bypass_reason: "Self-referential question - LLM fallback" }
        };
    }
}

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
        // Either audio file OR transcript must be provided
        const hasAudioFile = !!req.file;
        const hasTranscript = !!req.body.transcript;
        
        if (!hasAudioFile && !hasTranscript) {
            return res.status(400).json({
                success: false,
                error: 'Either audio file or transcript must be provided'
            });
        }
        
        if (hasTranscript && !hasAudioFile) {
            console.log('📝 [Step 1] Transcript provided without audio file (text-only mode)');
        }

        const {
            start_time,
            end_time,
            note_type,
            device_type,
            capture_location,
            transcription_engine_id,
            transcript, // Optional: Pre-existing transcript to skip speech-to-text
            chunking_strategy = 'BY_TIME_30S',
            participant_display_names,
            participant_roles,
            calendar_event_id,
            calendar_start_time,
            calendar_end_time,
            model = 'parallel', // LLM model selection (supports 'parallel', 'gpt-4o-mini', 'grok-beta', etc.)
            addToWebServer = 'false',
            addToBitTorrent = 'false',
            addToIPFS = 'false',
            generateChunkTags = 'false' // Optional: Enable LLM-based tag generation for chunks (increases processing time)
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
                error: `Invalid chunking_strategy. Must be one of: BY_TIME_15S, BY_TIME_30S, BY_TIME_60S, BY_SENTENCE, BY_PARAGRAPH, BY_SPEAKER`
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

        if (hasAudioFile) {
            tempFilePath = req.file.path;
        }
        const userPublicKey = req.user.publicKey || req.user.publisherPubKey;
        const token = req.headers.authorization.split(' ')[1];

        if (!userPublicKey) {
            return res.status(401).json({
                success: false,
                error: 'User public key not available'
            });
        }

        // ========================================
        // STEP 2: Upload Audio File via /api/media/upload (Skip if no audio)
        // ========================================
        let audioBuffer, audioSize, audioHash, durationSec;
        
        if (hasAudioFile) {
            console.log('📼 [Step 2] Uploading audio file...');
            
            audioBuffer = fs.readFileSync(tempFilePath);
            audioSize = audioBuffer.length;
            audioHash = crypto.createHash('sha256').update(audioBuffer).digest('hex');
            durationSec = Math.round((endDate - startDate) / 1000);
        } else {
            console.log('📝 [Step 2] No audio file, skipping upload...');
            durationSec = Math.round((endDate - startDate) / 1000);
        }

        const notesRecordsService = getNotesRecordsService();
        
        let audioMeta = null;
        
        if (hasAudioFile) {
            // Parse boolean params
            const shouldAddToWebServer = addToWebServer === 'true' || addToWebServer === true;
            const shouldAddToBitTorrent = addToBitTorrent === 'true' || addToBitTorrent === true;
            const shouldAddToIPFS = addToIPFS === 'true' || addToIPFS === true;

            console.log(`📤 [Step 2] Storage options: WebServer=${shouldAddToWebServer}, BitTorrent=${shouldAddToBitTorrent}, IPFS=${shouldAddToIPFS}`);

            audioMeta = {
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
        } // End if (hasAudioFile)

        // ========================================
        // STEP 3: Resolve Transcription Engine (Skip if transcript provided)
        // ========================================
        let transcriptionEngineRecord = null;
        let transcriptionEngineDid = null;
        
        if (transcript) {
            console.log('📝 [Step 3] Transcript provided, skipping transcription engine resolution');
        } else {
            console.log('🔍 [Step 3] Resolving transcription engine...');
            
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
        }

        // ========================================
        // STEP 4: Run Speech-to-Text (Skip if transcript provided)
        // ========================================
        let transcriptionResult;
        
        if (transcript) {
            console.log('📝 [Step 4] Using provided transcript, skipping speech-to-text...');
            console.log(`   Text length: ${transcript.length} chars`);
            
            // Create a transcriptionResult object compatible with the rest of the flow
            transcriptionResult = {
                text: transcript,
                language: 'en', // Default to English when transcript is provided
                segments: [] // Empty segments array when using pre-existing transcript
            };
            
            console.log('✅ [Step 4] Transcript ready');
        } else {
            console.log('🎤 [Step 4] Running speech-to-text...');
            
            const sttService = getSTTService();
            
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
        // STEP 9: Generate Tags for Chunks (Optional)
        // ========================================
        const shouldGenerateChunkTags = generateChunkTags === 'true' || generateChunkTags === true;
        
        if (shouldGenerateChunkTags) {
            console.log(`🗂️ [Step 9] Generating tags for ${chunks.length} chunks (batched)...`);
            
            // Batch chunk tag generation to avoid overwhelming the system
            const BATCH_SIZE = parseInt(process.env.CHUNK_TAG_BATCH_SIZE) || 10;
            const BATCH_DELAY_MS = parseInt(process.env.CHUNK_TAG_BATCH_DELAY_MS) || 1000;
            
            for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
                const batch = chunks.slice(i, i + BATCH_SIZE);
                const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
                const totalBatches = Math.ceil(chunks.length / BATCH_SIZE);
                
                console.log(`🏷️ [Step 9] Processing batch ${batchNumber}/${totalBatches} (${batch.length} chunks)...`);
                
                const batchPromises = batch.map(chunk => 
                    summarizationService.generateChunkTags(chunk.text, note_type, model)
                        .catch(err => {
                            console.warn(`⚠️ [Step 9] Failed to generate tags for chunk: ${err.message}`);
                            return [];
                        })
                );
                
                const batchTags = await Promise.all(batchPromises);
                
                // Attach tags to chunks
                batch.forEach((chunk, batchIndex) => {
                    chunk.tags = batchTags[batchIndex] || [];
                });
                
                // Add delay between batches to avoid overwhelming the LLM
                if (i + BATCH_SIZE < chunks.length) {
                    await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
                }
            }
            
            console.log('✅ [Step 9] Chunk tags generated');
        } else {
            console.log('⏭️  [Step 9] Chunk tag generation skipped (disabled)');
            // Set empty tags for all chunks
            chunks.forEach(chunk => {
                chunk.tags = [];
            });
        }

        // ========================================
        // STEP 10: Create Notes Record (before chunks so they can reference it)
        // ========================================
        console.log('📋 [Step 10] Creating main note record...');
        
        // Extract action item fields for parallel arrays
        const actionItemTexts = summary.action_items.map(item => item.text || '');
        const actionItemAssignees = summary.action_items.map(item => item.assignee || 'unassigned');
        const actionItemDueDates = summary.action_items.map(item => item.due_text || 'no date');

        // Use only LLM-generated tags
        const noteTags = summary.tags || [];

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
            chunk_count: chunks.length,
            chunk_ids: [] // Will be populated after chunks are created
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
        // STEP 11: Create Note Chunk Records (with note_ref)
        // ========================================
        console.log(`🗂️ [Step 11] Creating note chunk records with note reference...`);
        
        const captureDate = new Date(start_time).getTime();
        const chunkResults = await notesRecordsService.createAllNoteChunks(
            noteHash,
            chunks,
            note_type,
            captureDate,
            userPublicKey,
            token,
            noteRecordDid // Pass note DID so chunks can reference it
        );
        
        // Extract chunk DIDs
        const chunkDids = chunkResults.map(chunk => chunk.did);
        
        console.log(`✅ [Step 11] Created ${chunkResults.length} chunk records`);

        // Update note record with chunk_ids by re-publishing
        try {
            await notesRecordsService.updateNoteChunkIds(
                noteHash,
                notePayload,
                chunkDids,
                userPublicKey,
                token
            );
            console.log('✅ [Step 11] Note re-published with chunk IDs');
        } catch (error) {
            console.warn('⚠️ [Step 11] Failed to update note with chunk IDs (non-fatal):', error.message);
        }

        // ========================================
        // STEP 12: Cleanup & Return Response
        // ========================================
        console.log('🧹 [Step 12] Cleaning up...');
        
        // Delete temporary audio file
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
            console.log('✅ [Step 12] Temporary file deleted');
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

/**
 * POST /api/notes/converse
 * RAG (Retrieval Augmented Generation) endpoint for conversing about notes
 * Accepts a note DID and question, retrieves full context, finds related content, and generates AI response
 */
router.post('/converse', authenticateToken, async (req, res) => {
    try {
        const { 
            noteDid,
            question,
            model = 'llama3.2:3b',
            conversationHistory = [],
            includeRelated = true,
            maxRelated = 5,
            allNotes = false  // NEW: Search across all user's notes
        } = req.body;

        console.log(`\n${'='.repeat(80)}`);
        console.log(`[ALFRED Notes] Processing question${noteDid ? ` about note: ${noteDid}` : allNotes ? ' (All Notes Search)' : ' (Direct LLM mode)'}`);
        console.log(`[ALFRED Notes] Question: "${question}"`);
        console.log(`[ALFRED Notes] Model: ${model}`);
        if (noteDid) {
            console.log(`[ALFRED Notes] Mode: Selected Note RAG (using full transcript + summary + chunks)`);
        } else if (allNotes) {
            console.log(`[ALFRED Notes] Mode: Search across all notes`);
        } else if (allNotes === false && !noteDid) {
            console.log(`[ALFRED Notes] Mode: Direct LLM (skip RAG)`);
        }
        console.log(`${'='.repeat(80)}\n`);

        // Validate inputs
        if (!question) {
            return res.status(400).json({
                success: false,
                error: 'Question is required'
            });
        }

        const userPublicKey = req.user.publicKey || req.user.publisherPubKey;
        
        // ========================================
        // FAST PATH: Explicit Direct LLM Mode (allNotes=false)
        // ========================================
        // When allNotes is explicitly set to false, skip all RAG/classification
        // and go directly to LLM for fastest response
        if (allNotes === false && !noteDid) {
            console.log('[ALFRED Notes Fast Path] allNotes=false, going directly to LLM...');
            
            // Check if this is a self-referential question
            if (isSelfReferentialQuestion(question)) {
                console.log('[ALFRED Notes Fast Path] Self-referential question detected');
                
                const alfredResponse = await handleSelfReferentialQuestion(question, model, conversationHistory);
                
                // Generate audio if requested
                let audioData = null;
                if (req.body.return_audio) {
                    audioData = await generateAudioForResponse(alfredResponse.answer, req.body);
                }

                const response = {
                    success: true,
                    answer: alfredResponse.answer,
                    context: {
                        mode: 'direct_llm',
                        fastPath: true,
                        selfReferential: true
                    },
                    model: alfredResponse.model || model,
                    sources: alfredResponse.sources || [],
                    error: alfredResponse.error || undefined,
                    error_code: alfredResponse.error_code || undefined
                };
                
                if (audioData) {
                    response.audio_data = audioData;
                    response.has_audio = true;
                    response.engine_used = req.body.engine || 'elevenlabs';
                }
                
                return res.json(response);
            }
            
            const alfredInstance = require('../helpers/alfred');
            
            const alfredOptions = {
                model: model,
                conversationHistory: conversationHistory,
                useFieldExtraction: false
            };

            const alfredResponse = await alfredInstance.query(question, alfredOptions);
            
            console.log(`[ALFRED Notes Fast Path] ✅ Response generated (${alfredResponse.answer.length} chars)`);

            // Generate audio if requested
            let audioData = null;
            if (req.body.return_audio) {
                audioData = await generateAudioForResponse(alfredResponse.answer, req.body);
            }

            const response = {
                success: true,
                answer: alfredResponse.answer,
                context: {
                    mode: 'direct_llm',
                    fastPath: true
                },
                model: alfredResponse.model || model,
                sources: alfredResponse.sources || [],
                error: alfredResponse.error || undefined,
                error_code: alfredResponse.error_code || undefined
            };
            
            if (audioData) {
                response.audio_data = audioData;
                response.has_audio = true;
                response.engine_used = req.body.engine || 'elevenlabs';
            }
            
            return res.json(response);
        }
        
        // ========================================
        // MODE 1: All Notes Search (no specific noteDid)
        // ========================================
        if (!noteDid && allNotes) {
            console.log('[ALFRED Notes All Notes Mode] Extracting search parameters from question...');
            
            // Get today's date for the prompt
            const today = new Date();
            const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD format
            
            // Use LLM to extract date range, attendee names, and primary subject from the question
            const extractionPrompt = `You are helping extract structured information from a user's question about their meeting notes.

Today's date is: ${todayStr}

User's question: "${question}"

Please extract the following information and respond ONLY with a JSON object (no markdown, no explanation):

{
  "dateRange": {
    "hasDate": true/false,
    "startDate": "YYYY-MM-DD" or null,
    "endDate": "YYYY-MM-DD" or null
  },
  "attendees": ["Name1", "Name2"] or [],
  "primarySubject": "main topic or subject they're asking about"
}

Rules:
- If they mention a specific date, use that for both startDate and endDate
- If they mention "last week", calculate the date range
- If they mention "yesterday", calculate that date (${todayStr} minus 1 day)
- If they mention "today", use today's date (${todayStr})
- If they mention a date range like "last month", calculate the range
- If no date mentioned, set hasDate to false and dates to null
- Extract any person names mentioned as attendees (not generic terms like "we" or "the team")
- The primarySubject should be the main topic they're asking about (2-5 words)
- Respond with ONLY the JSON object, no markdown code blocks`;

            try {
                console.log('[ALFRED Notes] Calling LLM directly to extract search parameters...');
                
                // Call LLM directly without RAG to avoid searching for records
                const axios = require('axios');
                let extractionResponse;
                
                // Try Ollama first
                try {
                    const ollamaResponse = await axios.post('http://localhost:11434/api/generate', {
                        model: model,
                        prompt: extractionPrompt,
                        stream: false
                    }, { timeout: 30000 });
                    
                    extractionResponse = { answer: ollamaResponse.data.response };
                } catch (ollamaError) {
                    console.warn('[ALFRED Notes] Ollama unavailable, falling back to simpler extraction');
                    // Fallback: do simple extraction ourselves
                    extractionResponse = { answer: null };
                }
                
                console.log('[ALFRED Notes] LLM extraction response:', extractionResponse.answer ? extractionResponse.answer.substring(0, 200) : 'null');
                
                // Parse the LLM response to extract structured data
                let extractedInfo;
                if (extractionResponse.answer) {
                    try {
                        // Try to parse the response as JSON
                        const jsonMatch = extractionResponse.answer.match(/\{[\s\S]*\}/);
                        if (jsonMatch) {
                            extractedInfo = JSON.parse(jsonMatch[0]);
                        } else {
                            throw new Error('No JSON found in response');
                        }
                    } catch (parseError) {
                        console.warn('[ALFRED Notes] Failed to parse LLM extraction, using fallback:', parseError.message);
                        extractedInfo = null;
                    }
                }
                
                // Fallback: Simple keyword-based extraction if LLM failed
                if (!extractedInfo) {
                    console.log('[ALFRED Notes] Using simple keyword-based extraction');
                    const questionLower = question.toLowerCase();
                    
                    // Extract date information
                    let dateRange = { hasDate: false, startDate: null, endDate: null };
                    
                    if (questionLower.includes('today')) {
                        dateRange = {
                            hasDate: true,
                            startDate: todayStr,
                            endDate: todayStr
                        };
                    } else if (questionLower.includes('yesterday')) {
                        const yesterday = new Date(today);
                        yesterday.setDate(yesterday.getDate() - 1);
                        const yesterdayStr = yesterday.toISOString().split('T')[0];
                        dateRange = {
                            hasDate: true,
                            startDate: yesterdayStr,
                            endDate: yesterdayStr
                        };
                    } else if (questionLower.includes('last week')) {
                        const weekAgo = new Date(today);
                        weekAgo.setDate(weekAgo.getDate() - 7);
                        const weekAgoStr = weekAgo.toISOString().split('T')[0];
                        dateRange = {
                            hasDate: true,
                            startDate: weekAgoStr,
                            endDate: todayStr
                        };
                    }
                    
                    // Simple subject extraction (remove common words)
                    const words = question.split(/\s+/).filter(w => 
                        w.length > 3 && 
                        !['what', 'when', 'where', 'who', 'how', 'did', 'the', 'was', 'were', 'are', 'about', 'from', 'meeting', 'today', 'yesterday'].includes(w.toLowerCase())
                    );
                    const primarySubject = words.slice(0, 5).join(' ');
                    
                    extractedInfo = {
                        dateRange,
                        attendees: [],
                        primarySubject: primarySubject || question.substring(0, 50)
                    };
                }
                
                console.log('[ALFRED Notes] Extracted info:');
                console.log(`  - Date Range: ${extractedInfo.dateRange.hasDate ? `${extractedInfo.dateRange.startDate} to ${extractedInfo.dateRange.endDate}` : 'none'}`);
                console.log(`  - Attendees: ${extractedInfo.attendees.length > 0 ? extractedInfo.attendees.join(', ') : 'none'}`);
                console.log(`  - Primary Subject: ${extractedInfo.primarySubject}`);
                
                // Build search parameters
                const searchParams = {
                    noteSearchQuery: extractedInfo.primarySubject,
                    user: req.user,
                    isAuthenticated: true,
                    limit: 10
                };
                
                // Add date filtering if dates were extracted
                if (extractedInfo.dateRange.hasDate) {
                    if (extractedInfo.dateRange.startDate) {
                        // Convert to Unix timestamp (start of day)
                        const startDate = new Date(extractedInfo.dateRange.startDate + 'T00:00:00Z');
                        searchParams.dateStart = Math.floor(startDate.getTime() / 1000);
                    }
                    if (extractedInfo.dateRange.endDate) {
                        // Convert to Unix timestamp (end of day)
                        const endDate = new Date(extractedInfo.dateRange.endDate + 'T23:59:59Z');
                        searchParams.dateEnd = Math.floor(endDate.getTime() / 1000);
                    }
                }
                
                // Add attendee filtering if attendees were extracted
                if (extractedInfo.attendees.length > 0) {
                    searchParams.noteAttendees = extractedInfo.attendees.join(',');
                }
                
                console.log('[ALFRED Notes] Searching notes with parameters:', searchParams);
                
                // Search for matching notes
                const searchResults = await getRecords(searchParams);
                
                console.log(`[ALFRED Notes] Found ${searchResults.searchResults} matching notes`);
                
                if (searchResults.searchResults === 0) {
                    return res.json({
                        success: true,
                        answer: `I couldn't find any notes matching your search criteria. ${extractedInfo.dateRange.hasDate ? `I looked for notes from ${extractedInfo.dateRange.startDate} to ${extractedInfo.dateRange.endDate}` : 'Try providing a date range or more specific details about the meeting.'} ${extractedInfo.attendees.length > 0 ? `with attendees: ${extractedInfo.attendees.join(', ')}` : ''}`,
                        context: {
                            mode: 'allNotes',
                            searchQuery: extractedInfo.primarySubject,
                            dateRange: extractedInfo.dateRange,
                            attendees: extractedInfo.attendees,
                            resultsFound: 0
                        },
                        model: model,
                        sources: []
                    });
                }
                
                // Get the top-ranked note
                const topNote = searchResults.records[0];
                const searchScores = topNote.searchScores;
                
                // Debug: Log the full note structure
                console.log('[ALFRED Notes] Top note structure:', {
                    hasDid: !!topNote.did,
                    hasOip: !!topNote.oip,
                    oipDid: topNote.oip?.did,
                    oipDidTx: topNote.oip?.didTx,
                    name: topNote.data?.basic?.name
                });
                
                // The DID should be in note.did (set by elasticsearch.js from oip.did)
                // If not there, try oip.did directly
                const topNoteDid = topNote.did || topNote.oip?.did || topNote.oip?.didTx;
                
                if (!topNoteDid) {
                    console.error('[ALFRED Notes] Error: Top note has no DID!');
                    console.error('Note object keys:', Object.keys(topNote));
                    console.error('Note.oip keys:', topNote.oip ? Object.keys(topNote.oip) : 'no oip');
                    return res.status(500).json({
                        success: false,
                        error: 'Found matching note but it has no DID',
                        details: 'Internal error: note record missing DID field'
                    });
                }
                
                console.log('[ALFRED Notes] Top note selected:', topNote.data?.basic?.name);
                console.log(`  - DID: ${topNoteDid}`);
                console.log(`  - Final Score: ${searchScores.finalScore}`);
                console.log(`  - Chunk Score: ${searchScores.chunkScore} (${searchScores.chunkCount} chunks)`);
                console.log(`  - Attendee Score: ${searchScores.attendeeScore} (${searchScores.attendeeMatches} matches)`);
                
                // Now proceed to RAG mode with the top note
                // We'll use the existing RAG logic below by setting noteDid
                // and falling through to the RAG section
                console.log('[ALFRED Notes] Proceeding to RAG mode with top-ranked note...');
                
                // Override noteDid with the top result and continue to RAG mode below
                req.body.noteDid = topNoteDid;
                
                // Add search context to be included in the response
                req.searchContext = {
                    mode: 'allNotes',
                    searchQuery: extractedInfo.primarySubject,
                    dateRange: extractedInfo.dateRange,
                    attendees: extractedInfo.attendees,
                    totalResults: searchResults.searchResults,
                    topNoteScore: searchScores
                };
                
                // Continue to RAG mode with the selected note
                // (Don't return here, let it fall through to the RAG logic below)
                
            } catch (error) {
                console.error('[ALFRED Notes] Error in all notes search:', error);
                return res.status(500).json({
                    success: false,
                    error: 'Failed to search notes',
                    details: error.message
                });
            }
        }
        
        // ========================================
        // MODE 2: Pure LLM Mode (no noteDid, no allNotes)
        // ========================================
        if (!req.body.noteDid && !allNotes) {
            console.log('[ALFRED Notes] Running in pure LLM mode (no note context)');
            
            // Check if this is a self-referential question
            if (isSelfReferentialQuestion(question)) {
                console.log('[ALFRED Notes Pure LLM] Self-referential question detected');
                
                const alfredResponse = await handleSelfReferentialQuestion(question, model, conversationHistory);
                
                // Generate audio if requested
                let audioData = null;
                if (req.body.return_audio) {
                    audioData = await generateAudioForResponse(alfredResponse.answer, req.body);
                }

                const response = {
                    success: true,
                    answer: alfredResponse.answer,
                    context: {
                        mode: 'llm',
                        selfReferential: true
                    },
                    model: alfredResponse.model || model,
                    sources: alfredResponse.sources || [],
                    error: alfredResponse.error || undefined,
                    error_code: alfredResponse.error_code || undefined
                };
                
                if (audioData) {
                    response.audio_data = audioData;
                    response.has_audio = true;
                    response.engine_used = req.body.engine || 'elevenlabs';
                }
                
                return res.json(response);
            }
            
            const alfredInstance = require('../helpers/alfred');
            
            const alfredOptions = {
                model: model,
                conversationHistory: conversationHistory,
                useFieldExtraction: false
            };

            const alfredResponse = await alfredInstance.query(question, alfredOptions);
            
            console.log(`[ALFRED Notes] ✅ Response generated (${alfredResponse.answer.length} chars)`);

            // Generate audio if requested
            let audioData = null;
            if (req.body.return_audio) {
                audioData = await generateAudioForResponse(alfredResponse.answer, req.body);
            }

            const response = {
                success: true,
                answer: alfredResponse.answer,
                context: {
                    mode: 'llm'
                },
                model: alfredResponse.model || model,
                sources: alfredResponse.sources || [],
                error: alfredResponse.error || undefined,
                error_code: alfredResponse.error_code || undefined
            };
            
            if (audioData) {
                response.audio_data = audioData;
                response.has_audio = true;
                response.engine_used = req.body.engine || 'elevenlabs';
            }
            
            return res.json(response);
        }

        // ========================================
        // MODE 3: RAG Mode with Specific Note
        // ========================================
        // Get the noteDid (either from request or from allNotes search above)
        const targetNoteDid = req.body.noteDid;
        
        // Check if this is a self-referential question (even with note context)
        if (isSelfReferentialQuestion(question)) {
            console.log('[ALFRED Notes RAG Mode] Self-referential question detected - bypassing note context');
            
            const alfredResponse = await handleSelfReferentialQuestion(question, model, conversationHistory);
            
            // Generate audio if requested
            let audioData = null;
            if (req.body.return_audio) {
                audioData = await generateAudioForResponse(alfredResponse.answer, req.body);
            }

            const response = {
                success: true,
                answer: alfredResponse.answer,
                context: {
                    mode: 'rag',
                    selfReferential: true,
                    note: {
                        did: targetNoteDid
                    }
                },
                model: alfredResponse.model || model,
                sources: alfredResponse.sources || [],
                error: alfredResponse.error || undefined,
                error_code: alfredResponse.error_code || undefined
            };
            
            if (audioData) {
                response.audio_data = audioData;
                response.has_audio = true;
                response.engine_used = req.body.engine || 'elevenlabs';
            }
            
            return res.json(response);
        }
        
        // Step 1: Retrieve the main note record with resolveDepth=1 to include transcript
        console.log('[ALFRED Notes RAG Mode] Step 1: Fetching note record with embedded references...');
        const noteResults = await getRecords({
            source: 'gun',
            did: targetNoteDid,
            limit: 1,
            resolveDepth: 1,  // Resolve nested references (transcript, chunks)
            user: req.user,
            isAuthenticated: true
        });

        if (!noteResults.records || noteResults.records.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Note not found'
            });
        }

        const noteRecord = noteResults.records[0];
        const noteData = noteRecord.data?.notes || {};
        const noteBasic = noteRecord.data?.basic || {};
        
        console.log(`[ALFRED Notes RAG] ✅ Found note: "${noteBasic.name}"`);

        // Step 2: Extract the full transcript (already embedded with resolveDepth=1)
        let transcriptText = '';
        const transcriptData = noteData.transcript_full_text;
        
        if (transcriptData) {
            console.log('[ALFRED Notes RAG] Step 2: Extracting embedded transcript...');
            
            // Check if transcript is already resolved (embedded object)
            if (typeof transcriptData === 'object' && transcriptData.data?.text?.value) {
                transcriptText = transcriptData.data.text.value;
                console.log(`[ALFRED Notes RAG] ✅ Extracted embedded transcript (${transcriptText.length} chars)`);
            } 
            // Fallback: if it's just a DID string, fetch it separately
            else if (typeof transcriptData === 'string') {
                try {
                    const transcriptResults = await getRecords({
                        source: 'gun',
                        did: transcriptData,
                        limit: 1,
                        user: req.user,
                        isAuthenticated: true
                    });
                    
                    if (transcriptResults.records && transcriptResults.records.length > 0) {
                        transcriptText = transcriptResults.records[0].data?.text?.value || '';
                        console.log(`[ALFRED Notes RAG] ✅ Fetched transcript separately (${transcriptText.length} chars)`);
                    }
                } catch (error) {
                    console.warn('[ALFRED Notes RAG] ⚠️ Failed to fetch transcript:', error.message);
                }
            }
        }

        // Step 3: Retrieve all note chunks (if not already empty/missing)
        const chunkDids = noteData.chunk_ids || [];
        let chunks = [];
        
        if (chunkDids.length > 0) {
            console.log(`[ALFRED Notes RAG] Step 3: Fetching ${chunkDids.length} chunks...`);
            try {
                // Check if first item is already an object (resolved via resolveDepth)
                if (typeof chunkDids[0] === 'object' && chunkDids[0].data) {
                    // Chunks are already embedded
                    chunks = chunkDids;
                    console.log(`[ALFRED Notes RAG] ✅ Using ${chunks.length} embedded chunks`);
                } else {
                    // Chunks are DIDs, need to fetch them
                    const chunkPromises = chunkDids.map(chunkDid =>
                        getRecords({
                            source: 'gun',
                            did: chunkDid,
                            limit: 1,
                            user: req.user,
                            isAuthenticated: true
                        })
                    );
                    
                    const chunkResults = await Promise.all(chunkPromises);
                    chunks = chunkResults
                        .filter(result => result.records && result.records.length > 0)
                        .map(result => result.records[0]);
                    
                    console.log(`[ALFRED Notes RAG] ✅ Retrieved ${chunks.length} chunks`);
                }
            } catch (error) {
                console.warn('[ALFRED Notes RAG] ⚠️ Failed to fetch chunks:', error.message);
            }
        } else {
            console.log('[ALFRED Notes RAG] Step 3: No chunks found (chunk_ids is empty)');
        }

        // Step 4: Find related notes and chunks using tags
        let relatedContent = [];
        
        if (includeRelated && noteBasic.tagItems && noteBasic.tagItems.length > 0) {
            console.log(`[ALFRED Notes RAG] Step 4: Finding related content using tags: ${noteBasic.tagItems.join(', ')}`);
            
            try {
                // Search for related note chunks
                const relatedChunksResults = await getRecords({
                    source: 'gun',
                    recordType: 'noteChunks',
                    tags: noteBasic.tagItems.join(','),
                    limit: maxRelated,
                    user: req.user,
                    isAuthenticated: true
                });
                
                if (relatedChunksResults.records && relatedChunksResults.records.length > 0) {
                    // Filter out chunks from the current note
                    const otherChunks = relatedChunksResults.records.filter(chunk => 
                        chunk.data?.noteChunks?.note_ref !== noteDid
                    );
                    
                    relatedContent.push(...otherChunks);
                    console.log(`[ALFRED Notes RAG] ✅ Found ${otherChunks.length} related chunks from other notes`);
                }

                // Search for related notes
                const relatedNotesResults = await getRecords({
                    source: 'gun',
                    recordType: 'notes',
                    tags: noteBasic.tagItems.join(','),
                    limit: maxRelated,
                    user: req.user,
                    isAuthenticated: true
                });
                
                if (relatedNotesResults.records && relatedNotesResults.records.length > 0) {
                    // Filter out the current note
                    const otherNotes = relatedNotesResults.records.filter(note => 
                        note.did !== noteDid
                    );
                    
                    relatedContent.push(...otherNotes);
                    console.log(`[ALFRED Notes RAG] ✅ Found ${otherNotes.length} related notes`);
                }
            } catch (error) {
                console.warn('[ALFRED Notes RAG] ⚠️ Failed to fetch related content:', error.message);
            }
        }

        // Step 5: Build comprehensive context
        console.log('[ALFRED Notes RAG] Step 5: Building context for ALFRED...');
        
        // Safe date conversion
        let noteDateStr = 'Unknown';
        try {
            if (noteData.created_at) {
                const noteDate = new Date(noteData.created_at);
                if (!isNaN(noteDate.getTime())) {
                    noteDateStr = noteDate.toISOString();
                }
            }
        } catch (dateError) {
            console.warn('[ALFRED Notes RAG] Invalid date for note:', dateError.message);
        }
        
        const context = {
            currentNote: {
                title: noteBasic.name,
                type: noteData.note_type,
                date: noteDateStr,
                participants: noteData.participant_display_names || [],
                roles: noteData.participant_roles || [],
                tags: noteBasic.tagItems || [],
                summary: {
                    key_points: noteData.summary_key_points || [],
                    decisions: noteData.summary_decisions || [],
                    action_items: {
                        texts: noteData.summary_action_item_texts || [],
                        assignees: noteData.summary_action_item_assignees || [],
                        due_dates: noteData.summary_action_item_due_texts || []
                    },
                    open_questions: noteData.summary_open_questions || []
                },
                topics: noteData.topics_auto || [],
                keywords: noteData.keywords_auto || [],
                sentiment: noteData.sentiment_overall || 'NEUTRAL'
            },
            transcript: transcriptText,
            chunks: chunks.map(chunk => ({
                index: chunk.data?.noteChunks?.chunk_index,
                text: chunk.data?.noteChunks?.text,
                time_range: {
                    start_ms: chunk.data?.noteChunks?.start_time_ms,
                    end_ms: chunk.data?.noteChunks?.end_time_ms
                },
                tags: chunk.data?.basic?.tagItems || []
            })),
            relatedContent: relatedContent.slice(0, maxRelated).map(item => {
                if (item.recordType === 'noteChunks') {
                    return {
                        type: 'chunk',
                        text: item.data?.noteChunks?.text,
                        tags: item.data?.basic?.tagItems || [],
                        from_note: item.data?.noteChunks?.note_ref
                    };
                } else if (item.recordType === 'notes') {
                    return {
                        type: 'note',
                        title: item.data?.basic?.name,
                        summary: item.data?.notes?.summary_key_points?.slice(0, 3) || [],
                        tags: item.data?.basic?.tagItems || [],
                        did: item.did
                    };
                }
                return null;
            }).filter(Boolean)
        };

        console.log('[ALFRED Notes RAG] Context built:');
        console.log(`  - Transcript: ${transcriptText.length} chars`);
        console.log(`  - Chunks: ${chunks.length}`);
        console.log(`  - Related content: ${relatedContent.length} items`);

        // Step 6: Prepare ALFRED query with note-specific context
        const alfredInstance = require('../helpers/alfred');
        
        // Build a comprehensive context string that includes all note information
        const contextString = `You are answering questions about a specific meeting note.

Note Title: ${context.currentNote.title}
Note Type: ${context.currentNote.type}
Date: ${context.currentNote.date}
${context.currentNote.participants.length > 0 ? `Participants: ${context.currentNote.participants.join(', ')}` : ''}

${context.currentNote.summary.key_points.length > 0 ? `Key Points from Summary:
${context.currentNote.summary.key_points.map((point, i) => `${i + 1}. ${point}`).join('\n')}` : ''}

${context.currentNote.summary.decisions.length > 0 ? `Decisions Made:
${context.currentNote.summary.decisions.map((decision, i) => `${i + 1}. ${decision}`).join('\n')}` : ''}

${context.currentNote.summary.action_items.texts.length > 0 ? `Action Items:
${context.currentNote.summary.action_items.texts.map((text, i) => 
    `${i + 1}. ${text} (Assignee: ${context.currentNote.summary.action_items.assignees[i]}, Due: ${context.currentNote.summary.action_items.due_dates[i]})`
).join('\n')}` : ''}

${transcriptText ? `Full Transcript:
${transcriptText}` : ''}

${context.relatedContent.length > 0 ? `Related Content from Other Notes:
${context.relatedContent.map((item, i) => {
    if (item.type === 'chunk') {
        return `${i + 1}. [Chunk] ${item.text.substring(0, 200)}... (Tags: ${item.tags.join(', ')})`;
    } else {
        return `${i + 1}. [Note] ${item.title} - ${item.summary.join('; ')}`;
    }
}).join('\n')}` : ''}`;

        console.log('[ALFRED Notes RAG] Step 6: Calling ALFRED for response...');
        console.log(`[ALFRED Notes RAG] Context string length: ${contextString.length} chars`);
        
        // Call ALFRED with the pre-formatted context string
        // By passing pinnedJsonData AND existingContext, the existingContext will be used as the prompt context
        const alfredOptions = {
            model: model,
            conversationHistory: conversationHistory,
            pinnedJsonData: context, // Pass structured context (for metadata)
            existingContext: contextString, // Pass formatted context string (for LLM prompt)
            useFieldExtraction: true
        };

        const alfredResponse = await alfredInstance.query(question, alfredOptions);
        
        console.log(`[ALFRED Notes RAG] ✅ Response generated (${alfredResponse.answer.length} chars)`);

        // Generate audio if requested
        let audioData = null;
        if (req.body.return_audio) {
            audioData = await generateAudioForResponse(alfredResponse.answer, req.body);
        }

        // Return the response
        const responseContext = {
                note: {
                did: targetNoteDid,
                    title: context.currentNote.title,
                    type: context.currentNote.type
                },
                chunks_count: chunks.length,
                related_content_count: relatedContent.length,
                transcript_length: transcriptText.length
        };
        
        // If this came from an allNotes search, include the search context
        if (req.searchContext) {
            responseContext.search = req.searchContext;
        }
        
        const response = {
            success: true,
            answer: alfredResponse.answer,
            context: responseContext,
            model: alfredResponse.model || model,
            sources: alfredResponse.sources || [],
            // Include error info if present (e.g., Ollama unavailable)
            error: alfredResponse.error || undefined,
            error_code: alfredResponse.error_code || undefined
        };
        
        // Add audio data if generated
        if (audioData) {
            response.audio_data = audioData;
            response.has_audio = true;
            response.engine_used = req.body.engine || 'elevenlabs';
        }
        
        res.json(response);

    } catch (error) {
        console.error('[ALFRED Notes RAG] ❌ Error:', error);
        
        // Provide specific error messages for common issues
        let errorMessage = 'Failed to process question about note';
        let errorDetails = error.message;
        
        if (error.message.includes('Ollama') || error.code === 'ECONNREFUSED') {
            errorMessage = 'AI service unavailable';
            errorDetails = 'Ollama is not running. Please start it with: make backend-only';
        }
        
        res.status(500).json({
            success: false,
            error: errorMessage,
            details: errorDetails,
            error_code: error.code
        });
    }
});

module.exports = router;

