const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const { Readable } = require('stream');
const alfred = require('../helpers/alfred');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');
const router = express.Router();

// Configure axios with better connection management
const axiosConfig = {
    // timeout: 15000, // Removed global timeout - let individual requests control timeouts
    headers: {
        'Connection': 'close', // Force connection close to prevent hanging
        'User-Agent': 'OIP-Voice-Service/1.0'
    },
    // Add retry configuration
    maxRedirects: 3,
    // Connection management
    httpAgent: new (require('http').Agent)({
        keepAlive: false, // Disable keep-alive to prevent socket issues
        maxSockets: 10
    }),
    httpsAgent: new (require('https').Agent)({
        keepAlive: false,
        maxSockets: 10
    })
};

// Create axios instance with configuration
const axiosInstance = axios.create(axiosConfig);

// Configure multer for audio file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    },
    fileFilter: (req, file, cb) => {
        const allowedMimes = [
            'audio/wav',
            'audio/mpeg',
            'audio/mp3',
            'audio/webm',
            'audio/ogg'
        ];
        
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid audio format'), false);
        }
    }
});

// Service URLs
const STT_SERVICE_URL = process.env.STT_SERVICE_URL || 'http://localhost:8003';
const TTS_SERVICE_URL = process.env.TTS_SERVICE_URL || 'http://localhost:5002';
const TEXT_GENERATOR_URL = process.env.TEXT_GENERATOR_URL || 'http://localhost:8002';

// Embedded TTS using espeak (available in Alpine container)
async function synthesizeWithEspeak(text, voiceId = 'default', speed = 1.0) {
    return new Promise((resolve, reject) => {
        const processedText = alfred.preprocessTextForTTS(text);
        const tempFile = path.join(os.tmpdir(), `tts_${Date.now()}.wav`);
        
        // Voice mapping
        const voiceMap = {
            'default': 'en',
            'female_1': 'en+f3',
            'male_1': 'en+m3',
            'female_2': 'en+f4',
            'male_2': 'en+m4'
        };
        
        const voice = voiceMap[voiceId] || 'en';
        const espeakSpeed = Math.max(80, Math.min(400, Math.round(175 * speed)));
        
        const args = [
            '-v', voice,
            '-s', espeakSpeed.toString(),
            '-w', tempFile,
            processedText
        ];
        
        console.log(`[TTS] Synthesizing with espeak: voice=${voice}, speed=${espeakSpeed}`);
        
        const espeak = spawn('espeak', args);
        
        espeak.on('close', (code) => {
            if (code === 0) {
                fs.readFile(tempFile, (err, data) => {
                    // Clean up temp file
                    fs.unlink(tempFile, () => {});
                    
                    if (err) {
                        reject(new Error(`Failed to read audio file: ${err.message}`));
                    } else {
                        console.log(`[TTS] Successfully synthesized ${data.length} bytes`);
                        resolve(data);
                    }
                });
            } else {
                // Clean up temp file on error
                fs.unlink(tempFile, () => {});
                reject(new Error(`espeak failed with code ${code}`));
            }
        });
        
        espeak.on('error', (err) => {
            // Clean up temp file on error
            fs.unlink(tempFile, () => {});
            reject(new Error(`espeak error: ${err.message}`));
        });
    });
}

// Utility function for safe axios calls with error handling
async function safeAxiosCall(url, options, serviceName = 'Service') {
    const controller = new AbortController();
    
    // Set timeout based on service type
    const timeout = serviceName.includes('TTS') || serviceName.includes('Chatterbox') ? 120000 : 15000; // 2 minutes for TTS, 15s for others
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
        const response = await axiosInstance({
            ...options,
            url,
            timeout: timeout, // Set timeout explicitly for this request
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        
        if (error.name === 'AbortError') {
            const timeoutSeconds = timeout / 1000;
            console.error(`[${serviceName}] Request aborted (${timeoutSeconds}s timeout)`);
            throw new Error(`${serviceName} timeout - service may be overloaded`);
        }
        
        if (error.code === 'ECONNRESET' || error.code === 'ECONNABORTED') {
            console.error(`[${serviceName}] Connection reset - ${error.code}`);
            throw new Error(`${serviceName} connection failed - service restarting`);
        }
        
        throw error;
    }
}

/**
 * POST /api/voice/transcribe
 * Transcribe uploaded audio file to text
 */
router.post('/transcribe', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No audio file provided' });
        }

        const { language, task = 'transcribe' } = req.body;

        // Forward to Whisper STT service
        const formData = new FormData();
        
        // Create a readable stream from the buffer (Node.js compatible approach)
        const bufferStream = new Readable();
        bufferStream.push(req.file.buffer);
        bufferStream.push(null);
        
        formData.append('file', bufferStream, {
            filename: req.file.originalname || 'recording.webm',
            contentType: req.file.mimetype || 'audio/webm'
        });
        
        if (language) {
            formData.append('language', language);
        }
        formData.append('task', task);

        const response = await safeAxiosCall(
            `${STT_SERVICE_URL}/transcribe_file`,
            {
                method: 'POST',
                data: formData,
                headers: {
                    'Content-Type': 'multipart/form-data',
                },
            }
        );

        res.json({
            success: true,
            text: response.data.text,
            language: response.data.language,
            duration: response.data.duration,
            segments: response.data.segments || []
        });

    } catch (error) {
        console.error('STT Error:', error.message);
        
        if (error.response) {
            res.status(error.response.status).json({
                error: 'Transcription failed',
                details: error.response.data
            });
        } else {
            res.status(500).json({
                error: 'STT service unavailable',
                details: error.message
            });
        }
    }
});

/**
 * POST /api/voice/synthesize
 * Convert text to speech audio using Chatterbox TTS service
 */
router.post('/synthesize', upload.single('audio_prompt'), async (req, res) => {
    try {
        const { 
            text, 
            voice_id = 'female_1', 
            speed = 1.0, 
            language = 'en',
            engine = 'auto',
            // New Chatterbox parameters
            gender,
            emotion,
            exaggeration,
            cfg_weight,
            voice_cloning = 'false'
        } = req.body;

        // Check if an audio file was uploaded for voice cloning
        const audioFile = req.file;

        if (!text || !text.trim()) {
            return res.status(400).json({ error: 'Text is required' });
        }

        const textToSynthesize = alfred.preprocessTextForTTS(text.trim());
        console.log(`[TTS] Synthesizing request: "${textToSynthesize.substring(0, 50)}..." (${textToSynthesize.length} chars) with voice ${voice_id} using engine ${engine}`);
        console.log(`[TTS] Using TTS service URL: ${TTS_SERVICE_URL}`);

        // Limit text length to prevent TTS service overload
        const maxTextLength = 1000; // Adjust as needed
        const finalText = textToSynthesize.length > maxTextLength 
            ? textToSynthesize.substring(0, maxTextLength) + '...'
            : textToSynthesize;

        if (textToSynthesize.length > maxTextLength) {
            console.log(`[TTS] Text truncated from ${textToSynthesize.length} to ${finalText.length} characters`);
        }

        // Convert legacy voice_id to gender/emotion format for Chatterbox
        function convertVoiceIdToChatterboxParams(voice_id) {
            const voiceMatrix = {
                'female_1': { gender: 'female', emotion: 'expressive', exaggeration: 0.5, cfg_weight: 0.7 },
                'female_2': { gender: 'female', emotion: 'dramatic', exaggeration: 0.8, cfg_weight: 0.8 },
                'female_expressive': { gender: 'female', emotion: 'expressive', exaggeration: 0.6, cfg_weight: 0.7 },
                'female_calm': { gender: 'female', emotion: 'calm', exaggeration: 0.2, cfg_weight: 0.5 },
                'female_dramatic': { gender: 'female', emotion: 'dramatic', exaggeration: 0.9, cfg_weight: 0.8 },
                'female_neutral': { gender: 'female', emotion: 'neutral', exaggeration: 0.3, cfg_weight: 0.6 },
                'male_1': { gender: 'male', emotion: 'expressive', exaggeration: 0.5, cfg_weight: 0.7 },
                'male_2': { gender: 'male', emotion: 'dramatic', exaggeration: 0.8, cfg_weight: 0.8 },
                'male_expressive': { gender: 'male', emotion: 'expressive', exaggeration: 0.6, cfg_weight: 0.7 },
                'male_calm': { gender: 'male', emotion: 'calm', exaggeration: 0.2, cfg_weight: 0.5 },
                'male_dramatic': { gender: 'male', emotion: 'dramatic', exaggeration: 0.9, cfg_weight: 0.8 },
                'male_neutral': { gender: 'male', emotion: 'neutral', exaggeration: 0.3, cfg_weight: 0.6 },
                'chatterbox': { gender: 'female', emotion: 'expressive', exaggeration: 0.5, cfg_weight: 0.7 },
                'edge_female': { gender: 'female', emotion: 'expressive', exaggeration: 0.5, cfg_weight: 0.7 },
                'edge_male': { gender: 'male', emotion: 'expressive', exaggeration: 0.5, cfg_weight: 0.7 },
                'edge_expressive': { gender: 'female', emotion: 'dramatic', exaggeration: 0.8, cfg_weight: 0.8 },
                'female': { gender: 'female', emotion: 'expressive', exaggeration: 0.5, cfg_weight: 0.7 },
                'male': { gender: 'male', emotion: 'expressive', exaggeration: 0.5, cfg_weight: 0.7 },
                'default': { gender: 'female', emotion: 'expressive', exaggeration: 0.5, cfg_weight: 0.7 }
            };
            
            return voiceMatrix[voice_id] || voiceMatrix['default'];
        }

        // Use provided Chatterbox parameters or convert from voice_id
        let chatterboxParams;
        if (gender && emotion) {
            // New format - use provided parameters
            chatterboxParams = {
                gender: gender,
                emotion: emotion,
                exaggeration: exaggeration || 0.5,
                cfg_weight: cfg_weight || 0.7
            };
        } else {
            // Legacy format - convert voice_id to Chatterbox parameters
            chatterboxParams = convertVoiceIdToChatterboxParams(voice_id);
        }

        console.log(`[TTS] Using synthesis params:`, { engine, ...chatterboxParams });

        // Utility to build a fresh FormData for each attempt
        const effectiveSpeed = (typeof speed === 'number' ? speed : parseFloat(speed)) || 1.0;
        const buildFormData = (engineTry, voiceTry) => {
            const fd = new FormData();
            fd.append('text', finalText);
            // Some TTS backends work best when engine is omitted (auto)
            if (engineTry && engineTry !== 'edge_tts') fd.append('engine', String(engineTry));
            if (voiceTry) fd.append('voice_id', String(voiceTry));
            fd.append('gender', chatterboxParams.gender);
            fd.append('emotion', chatterboxParams.emotion);
            fd.append('exaggeration', chatterboxParams.exaggeration.toString());
            fd.append('cfg_weight', chatterboxParams.cfg_weight.toString());
            fd.append('speed', String(effectiveSpeed));
            // Derive locale from voice if available (Edge voices: en-GB-*, en-US-*)
            const derivedLocale = (voiceTry && typeof voiceTry === 'string') ? voiceTry.split('-').slice(0,2).join('-') : null;
            const langToSend = derivedLocale || language;
            if (langToSend) fd.append('language', String(langToSend));
            if (voice_cloning === 'true' && audioFile) {
                fd.append('voice_cloning', 'true');
            } else {
                fd.append('voice_cloning', 'false');
            }
            return fd;
        };
        
        // Handle voice cloning if enabled and audio file is provided
        // (Voice cloning is handled inside buildFormData.)
        
        console.log(`[TTS] Sending FormData with text length: ${finalText.length} chars, voice_cloning: ${voice_cloning}`);

        // Attempt synthesis with retries for Edge voices if needed
        const voiceAttempts = [];
        if (engine === 'edge_tts') {
            // Try requested voice; if male UK desired (Ryan), try another UK male first, then male US, then female US
            voiceAttempts.push(voice_id);
            if (voice_id === 'en-GB-RyanNeural') {
                voiceAttempts.push('en-GB-GeorgeNeural'); // alternate UK male
            }
            if (!voiceAttempts.includes('en-GB-SoniaNeural')) voiceAttempts.push('en-GB-SoniaNeural');
            if (!voiceAttempts.includes('en-US-GuyNeural')) voiceAttempts.push('en-US-GuyNeural');
            if (!voiceAttempts.includes('en-US-JennyNeural')) voiceAttempts.push('en-US-JennyNeural');
        } else {
            // Non-edge: single attempt
            voiceAttempts.push(voice_id);
        }

        let ttsResponse;
        let lastError;
        for (const voiceTry of voiceAttempts) {
            try {
                const fd = buildFormData(engine, voiceTry);
                ttsResponse = await safeAxiosCall(
                    `${TTS_SERVICE_URL}/synthesize`,
                    {
                        method: 'POST',
                        data: fd,
                        headers: { ...fd.getHeaders() },
                        responseType: 'arraybuffer'
                    },
                    'Chatterbox TTS'
                );
                // Success
                break;
            } catch (err) {
                lastError = err;
                const msg = err?.response?.data ? err.response.data.toString() : err.message;
                console.warn(`[TTS] Attempt with voice ${voiceTry} failed:`, msg);
            }
        }
        if (!ttsResponse) {
            throw lastError || new Error('All TTS attempts failed');
        }
        
        // Log successful response
        console.log(`[TTS] Successfully synthesized ${ttsResponse.data.length} bytes`);

        // Check if audio data is valid
        if (!ttsResponse.data || ttsResponse.data.length === 0) {
            console.error('[TTS] Error: Chatterbox returned empty audio data');
            throw new Error('Chatterbox returned empty audio data');
        }

        // Log response details for debugging
        console.log(`[TTS] Response details: status=${ttsResponse.status}, headers=${JSON.stringify(ttsResponse.headers)}`);
        console.log(`[TTS] Audio data type: ${typeof ttsResponse.data}, length: ${ttsResponse.data.length}`);

        // Set appropriate headers
        const engineUsed = (ttsResponse.headers && (ttsResponse.headers['x-engine-used'] || ttsResponse.headers['X-Engine-Used'])) || engine || 'unknown';
        const voiceUsed = (ttsResponse.headers && (ttsResponse.headers['x-voice-id'] || ttsResponse.headers['X-Voice-Id'])) || voice_id || 'unknown';
        res.set({
            'Content-Type': 'audio/wav',
            'X-Engine-Used': engineUsed,
            'X-Voice-ID': voiceUsed,
            'X-Gender': chatterboxParams.gender,
            'X-Emotion': chatterboxParams.emotion,
            'X-Voice-Cloning': voice_cloning === 'true' ? 'enabled' : 'disabled',
            'Content-Length': ttsResponse.data.length.toString()
        });

        console.log(`[TTS] Sending ${ttsResponse.data.length} bytes to browser`);

        // Send audio data directly
        res.send(ttsResponse.data);

        console.log(`[TTS] Audio response sent successfully`);

    } catch (error) {
        console.error('[TTS] Chatterbox TTS Error:', error.message);
        if (error.response) {
            console.error('[TTS] Response status:', error.response.status);
            console.error('[TTS] Response data:', error.response.data);
        }
        if (error.code) {
            console.error('[TTS] Error code:', error.code);
        }
        
        // Fallback to eSpeak if Chatterbox service fails
        try {
            console.log('[TTS] Chatterbox failed, falling back to eSpeak...');
            console.log(`[TTS] Synthesizing with espeak: voice=en, speed=${speed || 175}`);
            
            // Use the same text that was prepared for Chatterbox
            const audioData = await synthesizeWithEspeak(finalText, voice_id, speed || 1.0);
            
            res.set({
                'Content-Type': 'audio/wav',
                'X-Engine-Used': 'espeak-fallback', 
                'X-Voice-ID': voice_id,
                'X-Fallback-Reason': 'chatterbox-unavailable',
                'Content-Length': audioData.length.toString()
            });
            
            res.send(audioData);
        } catch (fallbackError) {
            console.error('[TTS] Fallback TTS also failed:', fallbackError.message);
            res.status(500).json({
                error: 'Speech synthesis failed',
                details: `Chatterbox: ${error.message}, eSpeak: ${fallbackError.message}`,
                service_url: TTS_SERVICE_URL
            });
        }
    }
});

/**
 * POST /api/voice/chat
 * Complete voice chat: STT → LLM → TTS pipeline
 */
router.post('/chat', upload.single('audio'), async (req, res) => {
    try {
        let inputText = '';
        
        // Step 1: Transcribe audio if provided
        if (req.file) {
            const formData = new FormData();
            
            // Create a readable stream from the buffer (Node.js compatible approach)
            const bufferStream = new Readable();
            bufferStream.push(req.file.buffer);
            bufferStream.push(null);
            
            formData.append('file', bufferStream, {
                filename: req.file.originalname || 'recording.webm',
                contentType: req.file.mimetype || 'audio/webm'
            });

            const sttResponse = await safeAxiosCall(
                `${STT_SERVICE_URL}/transcribe_file`,
                {
                    method: 'POST',
                    data: formData,
                    headers: { 'Content-Type': 'multipart/form-data' },
                }
            );

            inputText = sttResponse.data.text;
        } else if (req.body.text) {
            inputText = req.body.text;
        } else {
            return res.status(400).json({ error: 'Either audio file or text is required' });
        }

        if (!inputText.trim()) {
            return res.status(400).json({ error: 'No text to process' });
        }

        // Step 2: Check if this is a self-referential question about the AI
        function isSelfReferentialQuestion(text) {
            const lowerText = text.toLowerCase();
            const selfReferentialPatterns = [
                /\b(tell me about yourself|about yourself|who are you|what are you|introduce yourself|describe yourself)\b/,
                /\b(your capabilities|what can you do|what do you do|your purpose|your role)\b/,
                /\b(are you|you are|yourself|your name|your identity)\b/,
                /\b(hello.*yourself|hi.*yourself|greet.*yourself)\b/,
                /\b(how do you work|how were you made|how were you created)\b/,
                /\b(what is your function|what is your job|what is your mission)\b/
            ];
            
            return selfReferentialPatterns.some(pattern => pattern.test(lowerText));
        }

        // Step 3: Generate text response - use direct LLM for self-referential questions, RAG for others
        const {
            model = 'llama3.2:3b',
            voice_id = 'female_1',
            speed = 1.0,
            return_audio = true,
            creator_filter = null,
            record_type_filter = null,
            tag_filter = null
        } = req.body;

        let responseText;
        let ragResponse = null;

        if (isSelfReferentialQuestion(inputText)) {
            console.log(`[Voice Chat] Self-referential question detected: "${inputText}" - bypassing RAG`);
            
            // Call LLM directly with system prompt for self-referential questions
            const { generateStreamingResponse } = require('../helpers/generators');
            
            const conversationHistory = [
                {
                    role: "system",
                    content: "You are ALFRED (Autonomous Linguistic Framework for Retrieval & Enhanced Dialogue), a versatile and articulate AI assistant. You help a high-profile content creator stay informed and productive by answering questions, retrieving information from stored records, summarizing documents, and generating media-ready content such as podcast scripts or segment outlines. You prioritize clarity, speed, and relevance. IMPORTANT: Do not use emojis, asterisks, or other markdown formatting in your responses, as they interfere with text-to-speech synthesis. When asked about yourself, explain your role as an AI assistant that helps with information retrieval, document analysis, and content creation."
                },
                {
                    role: "user",
                    content: inputText
                }
            ];

            try {
                const llmResponse = await generateStreamingResponse(conversationHistory, 'voice-chat-' + Date.now(), { model });
                responseText = llmResponse.response || "Hello! I'm ALFRED, your AI assistant designed to help with information retrieval and content creation.";
                
                // Create a mock ragResponse for compatibility
                ragResponse = {
                    answer: responseText,
                    sources: [],
                    context_used: false,
                    search_results_count: 0,
                    search_results: [],
                    applied_filters: { bypass_reason: "Self-referential question detected" }
                };
                
            } catch (llmError) {
                console.error('[Voice Chat] Direct LLM call failed:', llmError);
                responseText = "Hello! I'm ALFRED, your AI assistant. I'm designed to help you stay informed and productive by answering questions, retrieving information from stored records, and generating content. How can I assist you today?";
                ragResponse = {
                    answer: responseText,
                    sources: [],
                    context_used: false,
                    search_results_count: 0,
                    search_results: [],
                    applied_filters: { bypass_reason: "Self-referential question - LLM fallback" }
                };
            }
        } else {
            console.log(`[Voice Chat] Using RAG for question: "${inputText}"`);
            
            // Use RAG service to get context-aware response
            const ragOptions = {
                model,
                searchParams: {
                    creatorHandle: creator_filter,
                    recordType: record_type_filter,
                    tags: tag_filter
                }
            };

            // Enhance RAG options for intelligent processing
            ragOptions.include_filter_analysis = req.body.include_filter_analysis !== false;
            ragOptions.searchParams = ragOptions.searchParams || {};
            
            // Pass existing search results for context-aware processing
            // Strip out unnecessary metadata and keep only essential data
            if (req.body.existing_search_results && Array.isArray(req.body.existing_search_results)) {
                ragOptions.existingContext = req.body.existing_search_results.map(record => {
                    const recordType = record.oip?.recordType || record.recordType || 'unknown';
                    console.log(`[Voice Chat] Stripping record: ${record.data?.basic?.name || 'Untitled'} - recordType: ${recordType} (from ${record.oip ? 'oip' : 'existing recordType'})`);
                    return {
                        data: record.data,
                        recordType: recordType,
                        matchCount: record.matchCount || 0
                    };
                });
                console.log(`[Voice Chat] Using existing context with ${ragOptions.existingContext.length} records (stripped metadata)`);
            } else if (req.body.existingContext && Array.isArray(req.body.existingContext)) {
                ragOptions.existingContext = req.body.existingContext.map(record => {
                    const recordType = record.oip?.recordType || record.recordType || 'unknown';
                    console.log(`[Voice Chat] Stripping existing context record: ${record.data?.basic?.name || 'Untitled'} - recordType: ${recordType} (from ${record.oip ? 'oip' : 'existing recordType'})`);
                    return {
                        data: record.data,
                        recordType: recordType,
                        matchCount: record.matchCount || 0
                    };
                });
                console.log(`[Voice Chat] Using existing context with ${ragOptions.existingContext.length} records (stripped metadata)`);
            }
            
            // Pass searchParams for context-aware analysis (includes recordType for domain context)
            if (req.body.searchParams && typeof req.body.searchParams === 'object') {
                ragOptions.searchParams = { ...ragOptions.searchParams, ...req.body.searchParams };
                console.log(`[Voice Chat] Using search params:`, ragOptions.searchParams);
            }
            
            // If a pinned DID is supplied by the client, bypass search and answer about that record
            if (req.body.pinnedDidTx && typeof req.body.pinnedDidTx === 'string') {
                console.log(`[Voice Chat] Pinned DID provided by client: ${req.body.pinnedDidTx}`);
                ragOptions.pinnedDidTx = req.body.pinnedDidTx;
                // Disable filter analysis to skip interpretation/search in single-record mode
                ragOptions.include_filter_analysis = false;
            }

            ragResponse = await alfred.query(inputText, ragOptions);
            responseText = ragResponse.answer;
        }

        if (!responseText || !responseText.trim()) {
            return res.status(500).json({ error: 'No response generated' });
        }

        // Step 3: Convert response to speech if requested
        if (return_audio) {
            try {
                console.log(`[Voice Chat] Synthesizing response audio with Chatterbox voice ${voice_id}`);
                
                // Use Chatterbox TTS service first
                let audioData;
                let engineUsed = 'chatterbox';
                
                try {
                    console.log(`[Voice Chat] Attempting TTS with service at: ${TTS_SERVICE_URL}`);
                    
                    // Limit text length for TTS
                    const maxTextLength = 1000;
                    let processedText = alfred.preprocessTextForTTS(responseText);
                    const textForTTS = processedText.length > maxTextLength 
                        ? processedText.substring(0, maxTextLength) + '...'
                        : processedText;
                        
                    if (responseText.length > maxTextLength) {
                        console.log(`[Voice Chat] Text truncated from ${responseText.length} to ${textForTTS.length} characters`);
                    }
                    
                    // Convert legacy voice_id to gender/emotion format for Chatterbox
                    function convertVoiceIdToChatterboxParams(voice_id) {
                        const voiceMatrix = {
                            'female_1': { gender: 'female', emotion: 'expressive', exaggeration: 0.5, cfg_weight: 0.7 },
                            'female_2': { gender: 'female', emotion: 'dramatic', exaggeration: 0.8, cfg_weight: 0.8 },
                            'female_expressive': { gender: 'female', emotion: 'expressive', exaggeration: 0.6, cfg_weight: 0.7 },
                            'female_calm': { gender: 'female', emotion: 'calm', exaggeration: 0.2, cfg_weight: 0.5 },
                            'female_dramatic': { gender: 'female', emotion: 'dramatic', exaggeration: 0.9, cfg_weight: 0.8 },
                            'female_neutral': { gender: 'female', emotion: 'neutral', exaggeration: 0.3, cfg_weight: 0.6 },
                            'male_1': { gender: 'male', emotion: 'expressive', exaggeration: 0.5, cfg_weight: 0.7 },
                            'male_2': { gender: 'male', emotion: 'dramatic', exaggeration: 0.8, cfg_weight: 0.8 },
                            'male_expressive': { gender: 'male', emotion: 'expressive', exaggeration: 0.6, cfg_weight: 0.7 },
                            'male_calm': { gender: 'male', emotion: 'calm', exaggeration: 0.2, cfg_weight: 0.5 },
                            'male_dramatic': { gender: 'male', emotion: 'dramatic', exaggeration: 0.9, cfg_weight: 0.8 },
                            'male_neutral': { gender: 'male', emotion: 'neutral', exaggeration: 0.3, cfg_weight: 0.6 },
                            'chatterbox': { gender: 'female', emotion: 'expressive', exaggeration: 0.5, cfg_weight: 0.7 },
                            'edge_female': { gender: 'female', emotion: 'expressive', exaggeration: 0.5, cfg_weight: 0.7 },
                            'edge_male': { gender: 'male', emotion: 'expressive', exaggeration: 0.5, cfg_weight: 0.7 },
                            'edge_expressive': { gender: 'female', emotion: 'dramatic', exaggeration: 0.8, cfg_weight: 0.8 },
                            'female': { gender: 'female', emotion: 'expressive', exaggeration: 0.5, cfg_weight: 0.7 },
                            'male': { gender: 'male', emotion: 'expressive', exaggeration: 0.5, cfg_weight: 0.7 },
                            'default': { gender: 'female', emotion: 'expressive', exaggeration: 0.5, cfg_weight: 0.7 }
                        };
                        
                        return voiceMatrix[voice_id] || voiceMatrix['default'];
                    }

                    const chatterboxParams = convertVoiceIdToChatterboxParams(voice_id);
                    console.log(`[Voice Chat] Using Chatterbox params:`, chatterboxParams);
                    
                    // Create FormData for TTS service (required for compatibility with voice cloning)
                    const formData = new FormData();
                    formData.append('text', textForTTS);
                    formData.append('gender', chatterboxParams.gender);
                    formData.append('emotion', chatterboxParams.emotion);
                    formData.append('exaggeration', chatterboxParams.exaggeration.toString());
                    formData.append('cfg_weight', chatterboxParams.cfg_weight.toString());
                    formData.append('voice_cloning', 'false'); // Voice cloning typically not used in real-time chat
                    
                    console.log(`[Voice Chat] Sending FormData with text length: ${textForTTS.length} chars`);
                    
                    const ttsResponse = await safeAxiosCall(
                        `${TTS_SERVICE_URL}/synthesize`,
                        {
                            method: 'POST',
                            data: formData,
                            headers: {
                                ...formData.getHeaders(),
                            },
                            responseType: 'arraybuffer'
                        }
                    );
                    
                    audioData = Buffer.from(ttsResponse.data);
                    console.log(`[Voice Chat] Successfully synthesized with Chatterbox: ${audioData.length} bytes`);
                    
                    // Check for empty audio
                    if (!audioData || audioData.length === 0) {
                        throw new Error('Chatterbox returned empty audio data');
                    }
                    
                } catch (chatterboxError) {
                    console.warn(`[Voice Chat] Chatterbox failed, falling back to eSpeak:`, chatterboxError.message);
                    if (chatterboxError.response) {
                        console.warn(`[Voice Chat] Chatterbox response status:`, chatterboxError.response.status);
                    }
                    if (chatterboxError.code) {
                        console.warn(`[Voice Chat] Chatterbox error code:`, chatterboxError.code);
                    }
                    
                    // Use the same text preprocessing and truncation for eSpeak
                    const maxTextLength = 1000;
                    let processedTextForEspeak = alfred.preprocessTextForTTS(responseText);
                    const textForEspeak = processedTextForEspeak.length > maxTextLength 
                        ? processedTextForEspeak.substring(0, maxTextLength) + '...'
                        : processedTextForEspeak;
                    
                    audioData = await synthesizeWithEspeak(textForEspeak, voice_id, 1.0);
                    engineUsed = 'espeak-fallback';
                }

                // Return combined response with RAG metadata  
                res.json({
                    success: true,
                    input_text: inputText,
                    response_text: responseText,
                    model_used: model,
                    voice_id,
                    has_audio: true,
                    engine_used: engineUsed,
                    audio_data: audioData.toString('base64'), // Include audio as base64
                    sources: ragResponse.sources,
                    context_used: ragResponse.context_used,
                    search_results_count: ragResponse.search_results_count,
                    search_results: ragResponse.search_results, // Include actual search results for debugging
                    applied_filters: ragResponse.applied_filters || {}
                });

            } catch (ttsError) {
                console.warn('All TTS methods failed, returning text only:', ttsError.message);
                
                // Return text response even if TTS fails
                res.json({
                    success: true,
                    input_text: inputText,
                    response_text: responseText,
                    model_used: model,
                    has_audio: false,
                    tts_error: 'Speech synthesis failed',
                    sources: ragResponse.sources,
                    context_used: ragResponse.context_used,
                    search_results_count: ragResponse.search_results_count,
                    search_results: ragResponse.search_results, // Include actual search results for debugging
                    applied_filters: ragResponse.applied_filters || {}
                });
            }
        } else {
            // Text-only response with RAG metadata
            res.json({
                success: true,
                input_text: inputText,
                response_text: responseText,
                model_used: model,
                has_audio: false,
                sources: ragResponse.sources,
                context_used: ragResponse.context_used,
                search_results_count: ragResponse.search_results_count,
                search_results: ragResponse.search_results, // Include actual search results for debugging
                applied_filters: ragResponse.applied_filters || {}
            });
        }

    } catch (error) {
        console.error('Voice chat error:', error.message);
        
        res.status(500).json({
            error: 'Voice chat failed',
            details: error.message
        });
    }
});

/**
 * GET /api/voice/voices
 * List available TTS voices from Chatterbox service
 */
router.get('/voices', async (req, res) => {
    try {
        // Try to get voices from Chatterbox TTS service
        const response = await safeAxiosCall(
            `${TTS_SERVICE_URL}/voices`,
            {
                timeout: 10000
            }
        );
        // Normalize output so the client can reliably filter by engine
        const raw = response.data;
        const inputVoices = Array.isArray(raw?.voices)
            ? raw.voices
            : (Array.isArray(raw) ? raw : []);

        const voices = inputVoices
            .map(v => {
                const id = v.id || v.ShortName || v.shortName || v.VoiceId || v.voice_id;
                const name = v.name || v.LocalName || v.FriendlyName || v.DisplayName || v.shortName || id;
                // Heuristic: Edge payloads often use ShortName/Locale; Chatterbox typically returns simple ids
                const engine = v.engine || v.Engine || ((v.ShortName || v.shortName || v.Locale) ? 'Edge TTS' : 'Chatterbox');
                const gender = v.gender || v.Gender || '';
                const language = v.language || v.Locale || v.lang || '';
                if (!id || !name) return null;
                return { id, name, engine, gender, language };
            })
            .filter(Boolean);

        // Ensure at least a couple of Edge voices exist so the client dropdown isn't empty
        const hasEdge = voices.some(v => String(v.engine).toLowerCase().includes('edge'));
        if (!hasEdge) {
            voices.push(
                { id: 'en-GB-RyanNeural',  name: 'Edge Ryan (UK Male)',   engine: 'Edge TTS', gender: 'male',   language: 'en-GB' },
                { id: 'en-GB-SoniaNeural', name: 'Edge Sonia (UK Female)', engine: 'Edge TTS', gender: 'female', language: 'en-GB' }
            );
        }

        console.log(`[TTS] Returning ${voices.length} normalized voices`);
        res.json({ voices });
        
    } catch (error) {
        console.warn('[TTS] Chatterbox service unavailable, returning fallback voices:', error.message);
        
        // Fallback voices if service is down - comprehensive Edge TTS selection
        const fallbackVoices = {
            voices: [
                // Edge TTS voices (most popular ones)
                { id: 'en-US-AriaNeural', name: 'Edge Aria (US Female)', engine: 'Edge TTS', gender: 'female', language: 'en-US' },
                { id: 'en-US-JennyNeural', name: 'Edge Jenny (US Female)', engine: 'Edge TTS', gender: 'female', language: 'en-US' },
                { id: 'en-US-GuyNeural', name: 'Edge Guy (US Male)', engine: 'Edge TTS', gender: 'male', language: 'en-US' },
                { id: 'en-US-DavisNeural', name: 'Edge Davis (US Male)', engine: 'Edge TTS', gender: 'male', language: 'en-US' },
                { id: 'en-GB-SoniaNeural', name: 'Edge Sonia (UK Female)', engine: 'Edge TTS', gender: 'female', language: 'en-GB' },
                { id: 'en-GB-RyanNeural', name: 'Edge Ryan (UK Male)', engine: 'Edge TTS', gender: 'male', language: 'en-GB' },
                { id: 'en-AU-NatashaNeural', name: 'Edge Natasha (AU Female)', engine: 'Edge TTS', gender: 'female', language: 'en-AU' },
                { id: 'en-AU-WilliamNeural', name: 'Edge William (AU Male)', engine: 'Edge TTS', gender: 'male', language: 'en-AU' },
                { id: 'en-CA-ClaraNeural', name: 'Edge Clara (CA Female)', engine: 'Edge TTS', gender: 'female', language: 'en-CA' },
                { id: 'en-CA-LiamNeural', name: 'Edge Liam (CA Male)', engine: 'Edge TTS', gender: 'male', language: 'en-CA' },
                
                // Chatterbox voices
                { id: 'female_expressive', name: 'Chatterbox Female Expressive', engine: 'Chatterbox', gender: 'female' },
                { id: 'male_1', name: 'Chatterbox Male 1', engine: 'Chatterbox', gender: 'male' },
                { id: 'female_calm', name: 'Chatterbox Female Calm', engine: 'Chatterbox', gender: 'female' },
                
                // eSpeak fallback
                { id: 'espeak_female', name: 'eSpeak Female (Fallback)', engine: 'eSpeak', gender: 'female' },
                { id: 'espeak_male', name: 'eSpeak Male (Fallback)', engine: 'eSpeak', gender: 'male' }
            ]
        };
        
        res.json(fallbackVoices);
    }
});

/**
 * GET /api/voice/engines
 * List available TTS engines
 */
router.get('/engines', async (req, res) => {
    const engines = [
        { id: 'chatterbox', name: 'Chatterbox TTS (Default)', available: true, preferred: true },
        { id: 'espeak', name: 'eSpeak TTS (Fallback)', available: true, preferred: false }
    ];
    
    // Check if TTS service is available
    try {
        await safeAxiosCall(`${TTS_SERVICE_URL}/health`, { timeout: 5000 });
        engines[0].status = 'healthy';
    } catch (error) {
        engines[0].status = 'unavailable';
        engines[0].available = false;
    }
    
    res.json({ engines });
});

/**
 * GET /api/voice/models
 * List available STT models
 */
router.get('/models', async (req, res) => {
    try {
        const response = await safeAxiosCall(`${STT_SERVICE_URL}/models`, {
            timeout: 10000
        });

        res.json(response.data);

    } catch (error) {
        console.error('Error fetching STT models:', error.message);
        
        res.status(500).json({
            error: 'Failed to fetch STT models',
            details: error.message
        });
    }
});

/**
 * POST /api/voice/rag
 * Direct RAG query without TTS (for testing and text-only use)
 */
router.post('/rag', async (req, res) => {
    try {
        const { 
            text, 
            model = 'llama3.2:3b',
            creator_filter = null,
            record_type_filter = null,
            tag_filter = null,
            date_start = null,
            date_end = null,
            max_results = 5
        } = req.body;

        if (!text || !text.trim()) {
            return res.status(400).json({ error: 'Text query is required' });
        }

        // Configure RAG search parameters
        const ragOptions = {
            model,
            searchParams: {
                creatorHandle: creator_filter,
                recordType: record_type_filter,
                tags: tag_filter,
                dateStart: date_start,
                dateEnd: date_end,
                limit: max_results
            }
        };

        console.log(`[Voice RAG] Processing query: ${text}`);
        const ragResponse = await alfred.query(text, ragOptions);

        res.json({
            success: true,
            query: text,
            answer: ragResponse.answer,
            sources: ragResponse.sources,
            context_used: ragResponse.context_used,
            search_results_count: ragResponse.search_results_count,
            search_results: ragResponse.search_results, // Include actual search results for debugging
            model_used: ragResponse.model,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('RAG query error:', error.message);
        res.status(500).json({
            error: 'RAG query failed',
            details: error.message
        });
    }
});

/**
 * GET /api/voice/health
 * Check health of voice services
 */
router.get('/health', async (req, res) => {
    const services = {
        stt: { url: STT_SERVICE_URL, status: 'unknown' },
        tts: { url: TTS_SERVICE_URL, status: 'unknown', engine: 'chatterbox' },
        text_generator: { url: TEXT_GENERATOR_URL, status: 'unknown' }
    };

    // Check external services
    const healthChecks = ['stt', 'tts', 'text_generator'].map(async (serviceName) => {
        try {
            const response = await safeAxiosCall(
                `${services[serviceName].url}/health`,
                { timeout: 5000 }
            );
            
            services[serviceName].status = response.data.status || 'healthy';
            services[serviceName].details = response.data;
            
        } catch (error) {
            services[serviceName].status = 'unhealthy';
            services[serviceName].error = error.message;
        }
    });

    await Promise.all(healthChecks);

    const allHealthy = Object.values(services).every(
        service => service.status === 'healthy'
    );

    // Add fallback info for TTS
    const ttsStatus = services.tts.status === 'healthy' ? 'Chatterbox Available' : 'eSpeak Fallback Active';
    
    // Check if Chatterbox TTS is specifically available
    const chatterboxAvailable = services.tts.status === 'healthy' && 
        services.tts.details && 
        (services.tts.details.primary_engine === 'chatterbox' ||
         (services.tts.details.engines && 
          services.tts.details.engines.some(engine => engine.name === 'chatterbox' && engine.available)));

    res.json({
        status: allHealthy ? 'healthy' : 'degraded',
        services,
        tts_status: ttsStatus,
        chatterbox_available: chatterboxAvailable,
        timestamp: new Date().toISOString()
    });
});

// ElevenLabs TTS endpoint for reference client
router.post('/elevenlabs/:voiceId/synthesize', async (req, res) => {
    try {
        const { voiceId } = req.params;
        const { text, voice_settings = {}, model_id = 'eleven_turbo_v2' } = req.body;
        
        if (!text) {
            return res.status(400).json({ error: 'Text is required' });
        }
        
        const processedText = alfred.preprocessTextForTTS(text);
        console.log(`[ElevenLabs] Synthesizing with voice ${voiceId}: "${processedText.substring(0, 50)}..."`);
        
        // Check if ElevenLabs API key is available
        if (!process.env.ELEVENLABS_API_KEY) {
            return res.status(503).json({ error: 'ElevenLabs API key not configured' });
        }
        
        const response = await axios.post(
            `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
            {
                text: processedText,
                model_id: model_id,
                voice_settings: {
                    stability: voice_settings.stability || 0.5,
                    similarity_boost: voice_settings.similarity_boost || 0.75,
                    style: voice_settings.style || 0.0,
                    use_speaker_boost: voice_settings.use_speaker_boost || true
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
        
        console.log(`[ElevenLabs] Generated ${response.data.byteLength} bytes successfully`);
        
        res.set('Content-Type', 'audio/mp3');
        res.send(Buffer.from(response.data));
        
    } catch (error) {
        console.error('[ElevenLabs] Synthesis failed:', error.message);
        res.status(500).json({ error: 'ElevenLabs synthesis failed: ' + error.message });
    }
});

module.exports = router; 