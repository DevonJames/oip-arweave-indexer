const express = require('express');
const multer = require('multer');
const axios = require('axios');
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
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
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
            console.error(`[${serviceName}] Request aborted (15s timeout)`);
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
router.post('/synthesize', async (req, res) => {
    try {
        const { text, voice_id = 'female_1', speed = 1.0, language = 'en' } = req.body;

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

        // Use TTS service with appropriate engine selection
                    // Map voice names to high-quality alternatives
                    const voiceMapping = {
                        'edge_female': 'female_1',
                        'edge_male': 'male_1', 
                        'edge_expressive': 'female_2',
                        'chatterbox': 'female_1',
                        'female': 'female_1', 
                        'male': 'male_1',
                        'female_1': 'female_1',
                        'male_1': 'male_1',
                        'default': 'female_1'
                    };
                    
                    // Determine best engine based on voice selection
                    const useEdgeTTS = voice_id.startsWith('edge_');
                    const enginePreference = useEdgeTTS ? 'edge' : 'auto';
                    
                    const mappedVoice = voiceMapping[voice_id] || voice_id;
                    
                    const ttsResponse = await safeAxiosCall(
                        `${TTS_SERVICE_URL}/synthesize`,
                        {
                            method: 'POST',
                            data: {
                                text: finalText,
                                voice: mappedVoice,
                                engine: enginePreference  // Use edge for edge_ voices, auto for others
                            },
                            responseType: 'arraybuffer'
                        }
                    );

        // Set appropriate headers
        res.set({
            'Content-Type': 'audio/wav',
            'X-Engine-Used': 'chatterbox',
            'X-Voice-ID': voice_id,
            'Content-Length': ttsResponse.data.length.toString()
        });

        // Check if audio data is empty
        if (!ttsResponse.data || ttsResponse.data.length === 0) {
            throw new Error('Chatterbox returned empty audio data');
        }

        // Send audio data directly
        res.send(ttsResponse.data);

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
            // Safely access text from req.body in case of scope issues
            const { text: requestText, voice_id: requestVoiceId = 'chatterbox', speed: requestSpeed = 1.0 } = req.body;
            
            if (!requestText || !requestText.trim()) {
                throw new Error('No text available for eSpeak fallback');
            }
            
            const audioData = await synthesizeWithEspeak(requestText.trim(), requestVoiceId, requestSpeed);
            
            res.set({
                'Content-Type': 'audio/wav',
                'X-Engine-Used': 'espeak-fallback',
                'X-Voice-ID': requestVoiceId,
                'Content-Length': audioData.length.toString(),
                'X-Fallback-Reason': 'chatterbox-unavailable'
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
                    
                    // Map voice names to high-quality alternatives
                    const voiceMapping = {
                        'edge_female': 'female_1',
                        'edge_male': 'male_1', 
                        'edge_expressive': 'female_2',
                        'chatterbox': 'female_1',
                        'female': 'female_1', 
                        'male': 'male_1',
                        'female_1': 'female_1',
                        'male_1': 'male_1',
                        'default': 'female_1'
                    };
                    
                    // Determine best engine based on voice selection
                    const useEdgeTTS = voice_id.startsWith('edge_');
                    const enginePreference = useEdgeTTS ? 'edge' : 'auto';
                    
                    const mappedVoice = voiceMapping[voice_id] || voice_id;
                    
                    const ttsResponse = await safeAxiosCall(
                        `${TTS_SERVICE_URL}/synthesize`,
                        {
                            method: 'POST',
                            data: {
                                text: textForTTS,
                                voice: mappedVoice,
                                engine: enginePreference  // Use edge for edge_ voices, auto for others
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
                    
                    audioData = await synthesizeWithEspeak(textForEspeak, voice_id, speed);
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

    res.json({
        status: allHealthy ? 'healthy' : 'degraded',
        services,
        tts_status: ttsStatus,
        timestamp: new Date().toISOString()
    });
});

module.exports = router; 