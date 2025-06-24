const express = require('express');
const multer = require('multer');
const axios = require('axios');
const ragService = require('../helpers/ragService');
const router = express.Router();

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

        const response = await axios.post(
            `${STT_SERVICE_URL}/transcribe_file`,
            formData,
            {
                headers: {
                    'Content-Type': 'multipart/form-data',
                },
                timeout: 30000, // 30 second timeout
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
 * Convert text to speech audio
 */
router.post('/synthesize', async (req, res) => {
    try {
        const { text, voice_id = 'default', speed = 1.0, language = 'en' } = req.body;

        if (!text || !text.trim()) {
            return res.status(400).json({ error: 'Text is required' });
        }

        // Forward to TTS service
        const response = await axios.post(
            `${TTS_SERVICE_URL}/synthesize`,
            {
                text: text.trim(),
                voice_id,
                speed,
                language
            },
            {
                responseType: 'stream',
                timeout: 30000,
            }
        );

        // Set appropriate headers
        res.set({
            'Content-Type': 'audio/wav',
            'X-Engine-Used': response.headers['x-engine-used'] || 'unknown',
            'X-Voice-ID': response.headers['x-voice-id'] || voice_id
        });

        // Stream audio back to client
        response.data.pipe(res);

    } catch (error) {
        console.error('TTS Error:', error.message);
        
        if (error.response) {
            res.status(error.response.status).json({
                error: 'Speech synthesis failed',
                details: error.response.data
            });
        } else {
            res.status(500).json({
                error: 'TTS service unavailable',
                details: error.message
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

            const sttResponse = await axios.post(
                `${STT_SERVICE_URL}/transcribe_file`,
                formData,
                {
                    headers: { 'Content-Type': 'multipart/form-data' },
                    timeout: 30000,
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
            voice_id = 'default',
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
                const ttsResponse = await axios.post(
                    `${TTS_SERVICE_URL}/synthesize`,
                    {
                        text: responseText,
                        voice_id,
                        speed
                    },
                    {
                        responseType: 'stream',
                        timeout: 30000,
                    }
                );

                // Return combined response with RAG metadata
                res.json({
                    success: true,
                    input_text: inputText,
                    response_text: responseText,
                    model_used: model,
                    voice_id,
                    has_audio: true,
                    engine_used: ttsResponse.headers['x-engine-used'] || 'unknown',
                    sources: ragResponse.sources,
                    context_used: ragResponse.context_used,
                    search_results_count: ragResponse.search_results_count
                });

                // Note: In a production setup, you might want to:
                // 1. Save audio to temporary file/storage
                // 2. Return audio URL instead of streaming
                // 3. Implement WebSocket for real-time streaming

            } catch (ttsError) {
                console.warn('TTS failed, returning text only:', ttsError.message);
                
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
                    search_results_count: ragResponse.search_results_count
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
                search_results_count: ragResponse.search_results_count
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
 * List available TTS voices
 */
router.get('/voices', async (req, res) => {
    try {
        const response = await axios.get(`${TTS_SERVICE_URL}/voices`, {
            timeout: 10000
        });

        res.json(response.data);

    } catch (error) {
        console.error('Error fetching voices:', error.message);
        
        res.status(500).json({
            error: 'Failed to fetch voices',
            details: error.message
        });
    }
});

/**
 * GET /api/voice/engines
 * List available TTS engines
 */
router.get('/engines', async (req, res) => {
    try {
        const response = await axios.get(`${TTS_SERVICE_URL}/engines`, {
            timeout: 10000
        });

        res.json(response.data);

    } catch (error) {
        console.error('Error fetching engines:', error.message);
        
        res.status(500).json({
            error: 'Failed to fetch engines',
            details: error.message
        });
    }
});

/**
 * GET /api/voice/models
 * List available STT models
 */
router.get('/models', async (req, res) => {
    try {
        const response = await axios.get(`${STT_SERVICE_URL}/models`, {
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
        tts: { url: TTS_SERVICE_URL, status: 'unknown' },
        text_generator: { url: TEXT_GENERATOR_URL, status: 'unknown' }
    };

    // Check each service
    const healthChecks = Object.keys(services).map(async (serviceName) => {
        try {
            const response = await axios.get(
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

    res.json({
        status: allHealthy ? 'healthy' : 'degraded',
        services,
        timestamp: new Date().toISOString()
    });
});

module.exports = router; 