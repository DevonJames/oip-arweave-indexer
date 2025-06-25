const express = require('express');
const multer = require('multer');
const axios = require('axios');
const ragService = require('../helpers/ragService');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');
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
 * Convert text to speech audio using embedded TTS
 */
router.post('/synthesize', async (req, res) => {
    try {
        const { text, voice_id = 'default', speed = 1.0, language = 'en' } = req.body;

        if (!text || !text.trim()) {
            return res.status(400).json({ error: 'Text is required' });
        }

        console.log(`[TTS] Synthesizing: "${text.substring(0, 50)}..." with voice ${voice_id}`);

        // Use embedded espeak TTS
        const audioData = await synthesizeWithEspeak(text.trim(), voice_id, speed);

        // Set appropriate headers
        res.set({
            'Content-Type': 'audio/wav',
            'X-Engine-Used': 'espeak',
            'X-Voice-ID': voice_id,
            'Content-Length': audioData.length.toString()
        });

        // Send audio data directly
        res.send(audioData);

    } catch (error) {
        console.error('TTS Error:', error.message);
        res.status(500).json({
            error: 'Speech synthesis failed',
            details: error.message
        });
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
                console.log(`[Voice Chat] Synthesizing response audio with voice ${voice_id}`);
                
                // Use embedded TTS instead of external service
                const audioData = await synthesizeWithEspeak(responseText, voice_id, speed);

                // Return combined response with RAG metadata  
                res.json({
                    success: true,
                    input_text: inputText,
                    response_text: responseText,
                    model_used: model,
                    voice_id,
                    has_audio: true,
                    engine_used: 'espeak',
                    audio_data: audioData.toString('base64'), // Include audio as base64
                    sources: ragResponse.sources,
                    context_used: ragResponse.context_used,
                    search_results_count: ragResponse.search_results_count
                });

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
 * List available TTS voices (embedded)
 */
router.get('/voices', async (req, res) => {
    // Return embedded eSpeak voices
    const embeddedVoices = {
        voices: [
            { id: 'default', name: 'Default English', engine: 'eSpeak' },
            { id: 'female_1', name: 'Female Voice 1', engine: 'eSpeak' },
            { id: 'male_1', name: 'Male Voice 1', engine: 'eSpeak' },
            { id: 'female_2', name: 'Female Voice 2', engine: 'eSpeak' },
            { id: 'male_2', name: 'Male Voice 2', engine: 'eSpeak' }
        ]
    };
    
    console.log('[TTS] Returning embedded eSpeak voices');
    res.json(embeddedVoices);
});

/**
 * GET /api/voice/engines
 * List available TTS engines (embedded)
 */
router.get('/engines', async (req, res) => {
    res.json({
        engines: [
            { id: 'espeak', name: 'eSpeak TTS', available: true }
        ]
    });
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
        tts: { embedded: true, status: 'healthy' }, // Embedded TTS
        text_generator: { url: TEXT_GENERATOR_URL, status: 'unknown' }
    };

    // Check external services
    const healthChecks = ['stt', 'text_generator'].map(async (serviceName) => {
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