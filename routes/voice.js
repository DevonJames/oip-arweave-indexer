const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const ragService = require('../helpers/ragService');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');
const router = express.Router();

// Configure axios with better connection management
const axiosConfig = {
    timeout: 15000, // Reduced from 30000ms to 15000ms
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
            text
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
        formData.append('file', new Blob([req.file.buffer]), {
            filename: req.file.originalname || 'recording.wav',
            contentType: req.file.mimetype || 'audio/wav'
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

        const textToSynthesize = text.trim();
        console.log(`[TTS] Synthesizing with Chatterbox: "${textToSynthesize.substring(0, 50)}..." (${textToSynthesize.length} chars) with voice ${voice_id}`);
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

        console.log(`[TTS] Using Chatterbox params:`, chatterboxParams);

        // Create FormData for TTS service (required for compatibility with voice cloning)
        const formData = new FormData();
        formData.append('text', finalText);
        formData.append('gender', chatterboxParams.gender);
        formData.append('emotion', chatterboxParams.emotion);  
        formData.append('exaggeration', chatterboxParams.exaggeration.toString());
        formData.append('cfg_weight', chatterboxParams.cfg_weight.toString());
        
        // Handle voice cloning if enabled and audio file is provided
        if (voice_cloning === 'true' && audioFile) {
            console.log(`[TTS] Voice cloning enabled with audio file: ${audioFile.originalname} (${audioFile.size} bytes)`);
            formData.append('voice_cloning', 'true'); // FastAPI will convert string 'true' to boolean
            // Create a proper stream from the buffer for the TTS service
            const { Readable } = require('stream');
            const audioStream = new Readable();
            audioStream.push(audioFile.buffer);
            audioStream.push(null); // End the stream
            
            formData.append('audio_prompt', audioStream, {
                filename: audioFile.originalname,
                contentType: audioFile.mimetype,
                knownLength: audioFile.size
            });
        } else {
            formData.append('voice_cloning', 'false'); // TTS service expects string 'false'
            if (voice_cloning === 'true') {
                console.log(`[TTS] Voice cloning requested but no audio file provided`);
            }
        }
        
        console.log(`[TTS] Sending FormData with text length: ${finalText.length} chars, voice_cloning: ${voice_cloning}`);

        const ttsResponse = await safeAxiosCall(
            `${TTS_SERVICE_URL}/synthesize`,
            {
                method: 'POST',
                data: formData,
                headers: {
                    ...formData.getHeaders(),
                },
                responseType: 'arraybuffer'
            },
            'Chatterbox TTS'
        );
        
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
        res.set({
            'Content-Type': 'audio/wav',
            'X-Engine-Used': 'chatterbox',
            'X-Voice-ID': voice_id,
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
            formData.append('file', new Blob([req.file.buffer]), {
                filename: req.file.originalname || 'recording.wav',
                contentType: req.file.mimetype || 'audio/wav'
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

        // Step 2: Generate text response using RAG (search + LLM)
        const {
            model = 'llama3.2:3b',
            voice_id = 'female_1',
            speed = 1.0,
            return_audio = true,
            creator_filter = null,
            record_type_filter = null,
            tag_filter = null
        } = req.body;

        // Use RAG service to get context-aware response
        const ragOptions = {
            model,
            searchParams: {
                creatorHandle: creator_filter,
                recordType: record_type_filter,
                tags: tag_filter
            }
        };

        const ragResponse = await ragService.query(inputText, ragOptions);

        if (!ragResponse.answer) {
            return res.status(500).json({ error: 'No response generated' });
        }

        const responseText = ragResponse.answer;

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
                    const textForTTS = responseText.length > maxTextLength 
                        ? responseText.substring(0, maxTextLength) + '...'
                        : responseText;
                        
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
                    
                    // Use the same text truncation for eSpeak
                    const maxTextLength = 1000;
                    const textForEspeak = responseText.length > maxTextLength 
                        ? responseText.substring(0, maxTextLength) + '...'
                        : responseText;
                    
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
        
        console.log('[TTS] Returning Chatterbox voices from TTS service');
        res.json(response.data);
        
    } catch (error) {
        console.warn('[TTS] Chatterbox service unavailable, returning fallback voices:', error.message);
        
        // Fallback voices if service is down
        const fallbackVoices = {
            voices: [
                { id: 'edge_female', name: 'Edge Female (Jenny) - High Quality', engine: 'Edge TTS' },
                { id: 'edge_male', name: 'Edge Male (Guy) - High Quality', engine: 'Edge TTS' },
                { id: 'edge_expressive', name: 'Edge Expressive (Aria) - Natural', engine: 'Edge TTS' },
                { id: 'female_1', name: 'Chatterbox Female 1', engine: 'Chatterbox' },
                { id: 'male_1', name: 'Chatterbox Male 1', engine: 'Chatterbox' },
                { id: 'female_2', name: 'Female Voice 2 (eSpeak)', engine: 'eSpeak' },
                { id: 'male_2', name: 'Male Voice 2 (eSpeak)', engine: 'eSpeak' }
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
        const ragResponse = await ragService.query(text, ragOptions);

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

module.exports = router; 