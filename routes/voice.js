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
const SMART_TURN_URL = process.env.SMART_TURN_URL || 'http://localhost:8010';

// Enhanced voice pipeline settings
const SMART_TURN_ENABLED = process.env.SMART_TURN_ENABLED === 'true';
const SMART_TURN_MIN_PROB = parseFloat(process.env.SMART_TURN_MIN_PROB || '0.55');
const VAD_ENABLED = process.env.VAD_ENABLED === 'true';
const ENHANCED_PIPELINE_ENABLED = SMART_TURN_ENABLED || VAD_ENABLED;

// Smart Turn endpoint prediction
async function predictSmartTurn(audioData, transcript = null) {
    if (!SMART_TURN_ENABLED) {
        return null;
    }
    
    try {
        console.log(`[Smart Turn] Predicting endpoint for ${audioData.length} bytes of audio`);
        
        const formData = new FormData();
        
        // Create a readable stream from the audio buffer
        const bufferStream = new Readable();
        bufferStream.push(audioData);
        bufferStream.push(null);
        
        formData.append('audio_file', bufferStream, {
            filename: 'audio.wav',
            contentType: 'audio/wav'
        });
        
        if (transcript) {
            formData.append('transcript', transcript);
        }
        
        const response = await safeAxiosCall(
            `${SMART_TURN_URL}/predict_endpoint`,
            {
                method: 'POST',
                data: formData,
                headers: {
                    'Content-Type': 'multipart/form-data',
                },
                timeout: 10000  // 10 second timeout for Smart Turn
            },
            'Smart Turn'
        );
        
        const result = response.data;
        console.log(`[Smart Turn] Prediction: ${result.prediction} (prob: ${result.probability.toFixed(3)}, time: ${result.processing_time_ms.toFixed(1)}ms)`);
        
        return {
            prediction: result.prediction,
            probability: result.probability,
            processing_time_ms: result.processing_time_ms,
            is_complete: result.prediction === 1 && result.probability >= SMART_TURN_MIN_PROB
        };
        
    } catch (error) {
        console.warn(`[Smart Turn] Prediction failed, falling back to timeout-based detection: ${error.message}`);
        return null;
    }
}

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

// Shared function to detect self-referential questions about the AI
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

// Shared function to handle self-referential questions with direct LLM
async function handleSelfReferentialQuestion(inputText, model, conversationHistory, handleTextChunk) {
    console.log(`Self-referential question detected: "${inputText}" - bypassing RAG`);
    
    // Call LLM directly with system prompt for self-referential questions
    const { generateStreamingResponse } = require('../helpers/generators');
    
    const systemPrompt = "You are ALFRED (Autonomous Linguistic Framework for Retrieval & Enhanced Dialogue), a versatile and articulate AI assistant. You help by answering questions and retrieving information from stored records. You prioritize clarity, speed, and relevance. IMPORTANT: Do not use emojis, asterisks, or other markdown formatting in your responses, as they interfere with text-to-speech synthesis. When asked about yourself, explain your role as an AI assistant that helps with information retrieval and explanation.";
    
    const conversationWithSystem = [
        {
            role: "system",
            content: systemPrompt
        },
        ...conversationHistory
    ];

    try {
        // Generate streaming response using the generalized function
        let fullResponse = '';
        const dialogueId = 'voice-self-ref-' + Date.now();

        if (handleTextChunk) {
            // Streaming mode (for /converse endpoint)
            await generateStreamingResponse(
                conversationWithSystem,
                String(dialogueId),
                {
                    temperature: 0.7,
                    model: model,
                    systemPrompt: systemPrompt
                },
                (chunk) => {
                    fullResponse += chunk;
                    handleTextChunk(chunk);
                }
            );
        } else {
            // Non-streaming mode (for /chat endpoint)
            await generateStreamingResponse(
                conversationWithSystem,
                String(dialogueId),
                {
                    temperature: 0.7,
                    model: model,
                    systemPrompt: systemPrompt
                },
                (chunk) => {
                    fullResponse += chunk;
                }
            );
        }

        const responseText = fullResponse || "Hello! I'm ALFRED, your AI assistant designed to help with information retrieval and content creation.";
        
        // Create a mock ragResponse for compatibility
        return {
            answer: responseText,
            sources: [],
            context_used: false,
            search_results_count: 0,
            search_results: [],
            applied_filters: { bypass_reason: "Self-referential question detected" }
        };
        
    } catch (llmError) {
        console.error('Direct LLM call failed:', llmError);
        const fallbackResponse = "Hello! I'm ALFRED, your AI assistant. I'm designed to help you stay informed and productive by answering questions, and retrieving information from stored records. How can I assist you today?";
        
        if (handleTextChunk) {
            handleTextChunk(fallbackResponse);
        }
        
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

// ========================================================================
// DIRECT LLM PROCESSING FUNCTIONS (for processing_mode bypass)
// ========================================================================

/**
 * Process question directly with LLM(s) bypassing RAG
 */
async function processDirectLLM(inputText, processingMode, model, conversationHistory, handleTextChunk) {
    try {
        const startTime = Date.now();
        
        // Build conversation for LLM
        const conversationWithSystem = [
            {
                role: "system",
                content: "You are ALFRED (Autonomous Linguistic Framework for Retrieval & Enhanced Dialogue), a versatile and articulate AI assistant. Answer questions directly and conversationally. Do not use emojis, asterisks, or markdown formatting."
            },
            ...conversationHistory
        ];

        let fullResponse = '';
        let modelUsed = '';
        
        if (processingMode === 'llm') {
            // Parallel requests to multiple models
            console.log(`[Direct LLM] Running parallel requests to: OpenAI, Grok-4, Mistral 7B, LLaMA 2 7B`);
            
            const requests = [];
            
            // OpenAI request
            if (process.env.OPENAI_API_KEY) {
                requests.push(callOpenAI(conversationWithSystem, 'gpt-4o-mini'));
            }
            
            // Grok-4 request  
            if (process.env.XAI_API_KEY) {
                requests.push(callGrok(conversationWithSystem, 'grok-4'));
            }
            
            // Ollama requests
            requests.push(callOllama(conversationWithSystem, 'mistral:7b'));
            requests.push(callOllama(conversationWithSystem, 'llama2:7b'));
            
            // Wait for first successful response
            const results = await Promise.allSettled(requests);
            const successfulResults = results
                .filter(result => result.status === 'fulfilled' && result.value !== null)
                .map(result => result.value)
                .filter(Boolean);
            
            if (successfulResults.length > 0) {
                const winner = successfulResults[0];
                fullResponse = winner.response;
                modelUsed = winner.source;
                console.log(`[Direct LLM] First response from ${winner.source} (${Date.now() - startTime}ms)`);
            } else {
                throw new Error('All LLM requests failed');
            }
            
        } else if (processingMode.startsWith('llm-')) {
            // Specific model request
            const modelName = processingMode.replace('llm-', '');
            console.log(`[Direct LLM] Using specific model: ${modelName}`);
            
            let result;
            if (modelName.startsWith('gpt-') || modelName.includes('openai')) {
                const actualModel = modelName.replace('openai-', '').replace('openai', 'gpt-4o-mini');
                result = await callOpenAI(conversationWithSystem, actualModel);
            } else if (modelName.startsWith('grok-')) {
                result = await callGrok(conversationWithSystem, modelName);
            } else {
                // Assume it's an Ollama model
                result = await callOllama(conversationWithSystem, modelName);
            }
            
            if (result && result.response) {
                fullResponse = result.response;
                modelUsed = result.source;
                console.log(`[Direct LLM] Response from ${modelName} (${Date.now() - startTime}ms)`);
            } else {
                throw new Error(`Failed to get response from ${modelName}`);
            }
        }
        
        // Stream the response
        if (fullResponse) {
            const words = fullResponse.split(' ');
            const chunkSize = 3;
            
            for (let i = 0; i < words.length; i += chunkSize) {
                const chunk = words.slice(i, i + chunkSize).join(' ');
                if (i + chunkSize < words.length) {
                    await handleTextChunk(chunk + ' ');
                } else {
                    await handleTextChunk(chunk);
                }
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }
        
        return {
            answer: fullResponse,
            sources: [],
            context_used: false,
            search_results_count: 0,
            search_results: [],
            applied_filters: { processing_mode: processingMode, model_used: modelUsed },
            model_used: modelUsed
        };
        
    } catch (error) {
        console.error(`[Direct LLM] Error in processDirectLLM:`, error);
        await handleTextChunk("I encountered an error processing your question directly. ");
        throw error;
    }
}

/**
 * Call OpenAI API directly
 */
async function callOpenAI(conversation, modelName = 'gpt-4o-mini') {
    try {
        const response = await axiosInstance.post('https://api.openai.com/v1/chat/completions', {
            model: modelName,
            messages: conversation,
            temperature: 0.7,
            max_tokens: 500
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });
        
        return {
            response: response.data.choices[0].message.content.trim(),
            source: `openai-${modelName}`
        };
    } catch (error) {
        console.warn(`[Direct LLM] OpenAI ${modelName} failed:`, error.message);
        return null;
    }
}

/**
 * Call Grok/XAI API directly
 */
async function callGrok(conversation, modelName = 'grok-4') {
    try {
        const response = await axiosInstance.post('https://api.x.ai/v1/chat/completions', {
            model: modelName,
            messages: conversation,
            temperature: 0.7,
            max_tokens: 500
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.XAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });
        
        return {
            response: response.data.choices[0].message.content.trim(),
            source: `xai-${modelName}`
        };
    } catch (error) {
        console.warn(`[Direct LLM] XAI ${modelName} failed:`, error.message);
        return null;
    }
}

/**
 * Call Ollama API directly
 */
async function callOllama(conversation, modelName) {
    try {
        // Convert conversation to single prompt for Ollama
        const prompt = conversation.map(msg => `${msg.role}: ${msg.content}`).join('\n') + '\nassistant:';
        
        const ollamaBaseUrl = process.env.OLLAMA_HOST || 'http://ollama:11434';
        const response = await axiosInstance.post(`${ollamaBaseUrl}/api/generate`, {
            model: modelName,
            prompt: prompt,
            stream: false,
            options: {
                temperature: 0.7,
                top_p: 0.9,
                top_k: 40,
                repeat_penalty: 1.1,
                num_predict: 500
            }
        }, {
            timeout: 20000
        });
        
        return {
            response: response.data.response?.trim() || '',
            source: `ollama-${modelName}`
        };
    } catch (error) {
        console.warn(`[Direct LLM] Ollama ${modelName} failed:`, error.message);
        return null;
    }
}

/**
 * Process question directly with LLM(s) bypassing RAG (non-streaming version)
 */
async function processDirectLLMNonStreaming(inputText, processingMode, model, conversationHistory) {
    try {
        const startTime = Date.now();
        
        // Build conversation for LLM
        const conversationWithSystem = [
            {
                role: "system",
                content: "You are ALFRED (Autonomous Linguistic Framework for Retrieval & Enhanced Dialogue), a versatile and articulate AI assistant. Answer questions directly and conversationally. Do not use emojis, asterisks, or markdown formatting."
            },
            ...conversationHistory
        ];

        let fullResponse = '';
        let modelUsed = '';
        
        if (processingMode === 'llm') {
            // Parallel requests to multiple models
            console.log(`[Direct LLM Non-Streaming] Running parallel requests to: OpenAI, Grok-4, Mistral 7B, LLaMA 2 7B`);
            
            const requests = [];
            
            // OpenAI request
            if (process.env.OPENAI_API_KEY) {
                requests.push(callOpenAI(conversationWithSystem, 'gpt-4o-mini'));
            }
            
            // Grok-4 request  
            if (process.env.XAI_API_KEY) {
                requests.push(callGrok(conversationWithSystem, 'grok-4'));
            }
            
            // Ollama requests
            requests.push(callOllama(conversationWithSystem, 'mistral:7b'));
            requests.push(callOllama(conversationWithSystem, 'llama2:7b'));
            
            // Wait for first successful response
            const results = await Promise.allSettled(requests);
            const successfulResults = results
                .filter(result => result.status === 'fulfilled' && result.value !== null)
                .map(result => result.value)
                .filter(Boolean);
            
            if (successfulResults.length > 0) {
                const winner = successfulResults[0];
                fullResponse = winner.response;
                modelUsed = winner.source;
                console.log(`[Direct LLM Non-Streaming] First response from ${winner.source} (${Date.now() - startTime}ms)`);
            } else {
                throw new Error('All LLM requests failed');
            }
            
        } else if (processingMode.startsWith('llm-')) {
            // Specific model request
            const modelName = processingMode.replace('llm-', '');
            console.log(`[Direct LLM Non-Streaming] Using specific model: ${modelName}`);
            
            let result;
            if (modelName.startsWith('gpt-') || modelName.includes('openai')) {
                const actualModel = modelName.replace('openai-', '').replace('openai', 'gpt-4o-mini');
                result = await callOpenAI(conversationWithSystem, actualModel);
            } else if (modelName.startsWith('grok-')) {
                result = await callGrok(conversationWithSystem, modelName);
            } else {
                // Assume it's an Ollama model
                result = await callOllama(conversationWithSystem, modelName);
            }
            
            if (result && result.response) {
                fullResponse = result.response;
                modelUsed = result.source;
                console.log(`[Direct LLM Non-Streaming] Response from ${modelName} (${Date.now() - startTime}ms)`);
            } else {
                throw new Error(`Failed to get response from ${modelName}`);
            }
        }
        
        return {
            answer: fullResponse,
            model_used: modelUsed
        };
        
    } catch (error) {
        console.error(`[Direct LLM Non-Streaming] Error in processDirectLLMNonStreaming:`, error);
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
                'default': { gender: 'female', emotion: 'expressive', exaggeration: 0.5, cfg_weight: 0.7 },
                'male_british': { gender: 'male', emotion: 'expressive', exaggeration: 0.5, cfg_weight: 0.7 }
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
            
            // Always send the engine parameter - this is required by TTS service
            fd.append('engine', String(engineTry || 'auto'));
            
            // Always send voice_id parameter - this is required by TTS service  
            fd.append('voice_id', String(voiceTry || voice_id || 'default'));
            
            // Required parameters for TTS service

            fd.append('gender', chatterboxParams.gender);
            fd.append('emotion', chatterboxParams.emotion);
            fd.append('exaggeration', chatterboxParams.exaggeration.toString());
            fd.append('cfg_weight', chatterboxParams.cfg_weight.toString());
            fd.append('speed', String(effectiveSpeed));
            
            // Voice cloning parameter (required)
            if (voice_cloning === 'true' && audioFile) {
                fd.append('voice_cloning', true);
                fd.append('audio_prompt', audioFile);
            } else {
                fd.append('voice_cloning', false);
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
                // Use new Kokoro TTS service JSON API
                // Send parameters directly to TTS service 
                const ttsParams = {
                    text: finalText,
                    engine: engine,
                    voice_id: voiceTry,
                    gender: chatterboxParams.gender,
                    emotion: chatterboxParams.emotion,
                    exaggeration: chatterboxParams.exaggeration,
                    cfg_weight: chatterboxParams.cfg_weight,
                    speed: effectiveSpeed,
                    voice_cloning: false
                };
                
                const kokoroResponse = await safeAxiosCall(
                    `${TTS_SERVICE_URL}/synthesize`,
                    {
                        method: 'POST',
                        data: ttsParams,
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        timeout: 30000
                    },
                    'Kokoro TTS'
                );
                
                // Convert base64 audio to buffer
                if (kokoroResponse.data && kokoroResponse.data.audio_data) {
                    const audioBuffer = Buffer.from(kokoroResponse.data.audio_data, 'base64');
                    ttsResponse = {
                        data: audioBuffer,
                        headers: {
                            'content-type': 'audio/wav',
                            'x-engine-used': kokoroResponse.data.engine,
                            'x-processing-time': kokoroResponse.data.processing_time_ms,
                            'x-audio-duration': kokoroResponse.data.audio_duration_ms,
                            'x-voice-used': kokoroResponse.data.voice,
                            'x-cached': kokoroResponse.data.cached
                        }
                    };
                } else {
                    throw new Error('Invalid response from Kokoro TTS service');
                }

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
            const fallbackSpeed = parseFloat(speed) || 1.0;
            console.log(`[TTS] Synthesizing with espeak: voice=en, speed=${fallbackSpeed}`);
            
            // Use the same text that was prepared for Chatterbox
            const audioData = await synthesizeWithEspeak(finalText, voice_id, fallbackSpeed);

            
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
    const startTime = Date.now();
    const processingMetrics = {
        stt_time_ms: 0,
        smart_turn_time_ms: 0,
        rag_time_ms: 0,
        tts_time_ms: 0,
        total_time_ms: 0
    };
    

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

            const sttStartTime = Date.now();

            const sttResponse = await safeAxiosCall(
                `${STT_SERVICE_URL}/transcribe_file`,
                {
                    method: 'POST',
                    data: formData,
                    headers: { 'Content-Type': 'multipart/form-data' },
                }
            );
            processingMetrics.stt_time_ms = Date.now() - sttStartTime;

            inputText = sttResponse.data.text;
            console.log(`[Voice Chat] STT transcription (${processingMetrics.stt_time_ms}ms): "${inputText}"`);
            
            // Enhanced: Smart Turn endpoint prediction (if enabled)
            let smartTurnResult = null;
            if (ENHANCED_PIPELINE_ENABLED) {
                try {
                    const smartTurnStartTime = Date.now();
                    smartTurnResult = await predictSmartTurn(req.file.buffer, inputText);
                    processingMetrics.smart_turn_time_ms = Date.now() - smartTurnStartTime;
                    
                    if (smartTurnResult) {
                        console.log(`[Voice Chat] Smart Turn result (${processingMetrics.smart_turn_time_ms}ms): complete=${smartTurnResult.is_complete}, prob=${smartTurnResult.probability.toFixed(3)}`);
                    }
                } catch (error) {
                    console.warn(`[Voice Chat] Smart Turn prediction failed: ${error.message}`);
                }
            }

        } else if (req.body.text) {
            inputText = req.body.text;
        } else {
            return res.status(400).json({ error: 'Either audio file or text is required' });
        }

        if (!inputText.trim()) {
            return res.status(400).json({ error: 'No text to process' });
        }

        // Step 2: Generate text response - use direct LLM for self-referential questions, RAG for others

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
            
            // Build conversation history for self-referential handling
            const conversationForSelfRef = [

                {
                    role: "user",
                    content: inputText
                }
            ];
            
            // Use shared function to handle self-referential questions (non-streaming mode)
            ragResponse = await handleSelfReferentialQuestion(inputText, model, conversationForSelfRef, null);
            responseText = ragResponse.answer;
        } else {
            // Check processing mode preference (new parameter)
            const processingMode = req.body.processing_mode || 'rag'; // Default to RAG
            console.log(`[Voice Chat] Processing mode: ${processingMode} for question: "${inputText}"`);
            
            if (processingMode === 'rag') {
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

            // Conversation history (array or JSON string) for context grounding
            try {
                let convo = req.body.conversationHistory;
                if (typeof convo === 'string') {
                    try { convo = JSON.parse(convo); } catch (_) { convo = []; }
                }
                if (Array.isArray(convo) && convo.length > 0) {
                    ragOptions.conversationHistory = convo;
                    console.log(`[Voice Chat] Using conversation history with ${convo.length} messages`);
                }
            } catch (_) { /* ignore */ }
            
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

            const ragStartTime = Date.now();
            ragResponse = await alfred.query(inputText, ragOptions);
            processingMetrics.rag_time_ms = Date.now() - ragStartTime;
            
            responseText = ragResponse.answer;
            console.log(`[Voice Chat] RAG processing (${processingMetrics.rag_time_ms}ms): Generated ${responseText.length} chars`);
            
            } else if (processingMode === 'llm' || processingMode.startsWith('llm-')) {
                console.log(`[Voice Chat] Using direct LLM mode: ${processingMode} for question: "${inputText}"`);
                
                try {
                    const llmStartTime = Date.now();
                    
                    // Build conversation history for LLM
                    const conversationForLLM = [
                        {
                            role: "user",
                            content: inputText
                        }
                    ];
                    
                    // Process with direct LLM (non-streaming version)
                    const llmResult = await processDirectLLMNonStreaming(inputText, processingMode, model, conversationForLLM);
                    processingMetrics.rag_time_ms = Date.now() - llmStartTime; // Reuse rag_time_ms field
                    
                    responseText = llmResult.answer;
                    console.log(`[Voice Chat] Direct LLM processing (${processingMetrics.rag_time_ms}ms): Generated ${responseText.length} chars`);
                    
                    // Create mock RAG response for compatibility
                    ragResponse = {
                        answer: responseText,
                        sources: [],
                        context_used: false,
                        search_results_count: 0,
                        search_results: [],
                        applied_filters: { processing_mode: processingMode, model_used: llmResult.model_used }
                    };
                    
                } catch (llmError) {
                    console.error('Error in direct LLM processing:', llmError);
                    responseText = "I encountered an error processing your question directly.";
                    ragResponse = {
                        answer: responseText,
                        sources: [],
                        context_used: false,
                        search_results_count: 0,
                        search_results: [],
                        applied_filters: { processing_mode: processingMode, error: llmError.message }
                    };
                }
            } else {
                // Invalid processing mode - fallback to RAG
                console.warn(`[Voice Chat] Invalid processing_mode: ${processingMode}, falling back to RAG`);
                
                const ragOptions = {
                    model,
                    searchParams: {
                        creatorHandle: creator_filter,
                        recordType: record_type_filter,
                        tags: tag_filter
                    }
                };
                
                const ragStartTime = Date.now();
                ragResponse = await alfred.query(inputText, ragOptions);
                processingMetrics.rag_time_ms = Date.now() - ragStartTime;
                
                responseText = ragResponse.answer;
                console.log(`[Voice Chat] Fallback RAG processing (${processingMetrics.rag_time_ms}ms): Generated ${responseText.length} chars`);
            }

        }

        if (!responseText || !responseText.trim()) {
            return res.status(500).json({ error: 'No response generated' });
        }

        // Step 3: Convert response to speech if requested
        if (return_audio) {
            try {
                console.log(`[Voice Chat] Synthesizing response audio with voice: ${voice_id} and engine: ${req.body.engine}`);
                
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
                    
                    // Send parameters as form data to TTS service
                    const ttsParams = {
                        text: textForTTS,
                        engine: req.body.engine || 'edge_tts',
                        voice_id: voice_id || 'en-GB-RyanNeural',
                        speed: 1.0,
                        gender: chatterboxParams.gender,
                        emotion: chatterboxParams.emotion,
                        exaggeration: chatterboxParams.exaggeration,
                        cfg_weight: chatterboxParams.cfg_weight,
                        voice_cloning: false
                    };

                    const ttsStartTime = Date.now();
                    console.log(`[Voice Chat] Sending TTS request with text length: ${textForTTS.length} chars`);

                    const ttsResponse = await safeAxiosCall(
                        `${TTS_SERVICE_URL}/synthesize`,
                        {
                            method: 'POST',
                            data: ttsParams,
                            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                            timeout: 30000
                        },
                        'Edge TTS'
                    );
                    processingMetrics.tts_time_ms = Date.now() - ttsStartTime;
                    
                    if (ttsResponse.data && ttsResponse.data.audio_data) {
                        audioData = Buffer.from(ttsResponse.data.audio_data, 'base64');
                        engineUsed = ttsResponse.data.engine || 'edge_tts';
                        console.log(`[Voice Chat] Successfully synthesized with ${engineUsed} (${processingMetrics.tts_time_ms}ms): ${audioData.length} bytes`);
                        console.log(`[Voice Chat] TTS processing time: ${ttsResponse.data.processing_time_ms || 'N/A'}ms, cached: ${ttsResponse.data.cached || false}`);
                    } else {
                        throw new Error('Edge TTS returned no audio data');
                    }
                    
                    // Check for empty audio
                    if (!audioData || audioData.length === 0) {
                        throw new Error('TTS service returned empty audio data');
                    }
                    
                } catch (ttsError) {
                    console.warn(`[Voice Chat] Edge TTS failed, falling back to eSpeak:`, ttsError.message);
                    if (ttsError.response) {
                        console.warn(`[Voice Chat] TTS response status:`, ttsError.response.status);
                    }
                    if (ttsError.code) {
                        console.warn(`[Voice Chat] TTS error code:`, ttsError.code);

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

                // Calculate total processing time
                processingMetrics.total_time_ms = Date.now() - startTime;
                
                // Return combined response with RAG metadata and enhanced pipeline info
                const response = {
                    success: true,
                    input_text: inputText,
                    response_text: responseText,
                    response: responseText,  // Mac client expects this field
                    answer: responseText,    // Fallback field that Mac client checks

                    model_used: model,
                    voice_id,
                    has_audio: true,
                    engine_used: engineUsed,
                    audio_data: audioData.toString('base64'), // Include audio as base64
                    audio_url: `/api/voice/audio/${Date.now()}.wav`, // Mac client expects this for audio
                    sources: ragResponse.sources,
                    context_used: ragResponse.context_used,
                    search_results_count: ragResponse.search_results_count,
                    search_results: ragResponse.search_results, // Include actual search results for debugging
                    applied_filters: ragResponse.applied_filters || {},
                    // Enhanced Week 4: Comprehensive processing metrics
                    processing_metrics: processingMetrics,
                    pipeline_version: "2.0",
                    timestamp: new Date().toISOString()
                };
                
                // Enhanced: Include Smart Turn metadata if available
                if (ENHANCED_PIPELINE_ENABLED && smartTurnResult) {
                    response.smart_turn = {
                        endpoint_complete: smartTurnResult.is_complete,
                        endpoint_confidence: smartTurnResult.probability,
                        processing_time_ms: smartTurnResult.processing_time_ms
                    };
                }
                
                // Enhanced: Include pipeline metadata
                if (ENHANCED_PIPELINE_ENABLED) {
                    response.enhanced_pipeline = {
                        smart_turn_enabled: SMART_TURN_ENABLED,
                        vad_enabled: VAD_ENABLED,
                        features_used: {
                            smart_turn: smartTurnResult !== null,
                            vad: false  // Will be true when VAD is implemented
                        }
                    };
                }
                
                res.json(response);

            } catch (ttsError) {
                console.warn('All TTS methods failed, returning text only:', ttsError.message);
                
                // Calculate total processing time
                processingMetrics.total_time_ms = Date.now() - startTime;
                
                // Return text response even if TTS fails
                const response = {
                    success: true,
                    input_text: inputText,
                    response_text: responseText,
                    response: responseText,  // Mac client expects this field
                    answer: responseText,    // Fallback field that Mac client checks

                    model_used: model,
                    has_audio: false,
                    tts_error: 'Speech synthesis failed',
                    sources: ragResponse.sources,
                    context_used: ragResponse.context_used,
                    search_results_count: ragResponse.search_results_count,
                    search_results: ragResponse.search_results, // Include actual search results for debugging
                    applied_filters: ragResponse.applied_filters || {},
                    // Enhanced Week 4: Comprehensive processing metrics
                    processing_metrics: processingMetrics,
                    pipeline_version: "2.0",
                    timestamp: new Date().toISOString()
                };
                
                // Enhanced: Include Smart Turn metadata if available
                if (ENHANCED_PIPELINE_ENABLED && smartTurnResult) {
                    response.smart_turn = {
                        endpoint_complete: smartTurnResult.is_complete,
                        endpoint_confidence: smartTurnResult.probability,
                        processing_time_ms: smartTurnResult.processing_time_ms
                    };
                }
                
                // Enhanced: Include pipeline metadata
                if (ENHANCED_PIPELINE_ENABLED) {
                    response.enhanced_pipeline = {
                        smart_turn_enabled: SMART_TURN_ENABLED,
                        vad_enabled: VAD_ENABLED,
                        features_used: {
                            smart_turn: smartTurnResult !== null,
                            vad: false  // Will be true when VAD is implemented
                        }
                    };
                }
                
                res.json(response);
            }
        } else {
            // Calculate total processing time
            processingMetrics.total_time_ms = Date.now() - startTime;
            
            // Text-only response with RAG metadata
            const response = {

                success: true,
                input_text: inputText,
                response_text: responseText,
                model_used: model,
                has_audio: false,
                sources: ragResponse.sources,
                context_used: ragResponse.context_used,
                search_results_count: ragResponse.search_results_count,
                search_results: ragResponse.search_results, // Include actual search results for debugging
                applied_filters: ragResponse.applied_filters || {},
                // Enhanced Week 4: Comprehensive processing metrics
                processing_metrics: processingMetrics,
                pipeline_version: "2.0",
                timestamp: new Date().toISOString()
            };
            
            // Enhanced: Include Smart Turn metadata if available
            if (ENHANCED_PIPELINE_ENABLED && smartTurnResult) {
                response.smart_turn = {
                    endpoint_complete: smartTurnResult.is_complete,
                    endpoint_confidence: smartTurnResult.probability,
                    processing_time_ms: smartTurnResult.processing_time_ms
                };
            }
            
            // Enhanced: Include pipeline metadata
            if (ENHANCED_PIPELINE_ENABLED) {
                response.enhanced_pipeline = {
                    smart_turn_enabled: SMART_TURN_ENABLED,
                    vad_enabled: VAD_ENABLED,
                    features_used: {
                        smart_turn: smartTurnResult !== null,
                        vad: false  // Will be true when VAD is implemented
                    }
                };
            }
            
            res.json(response);

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

        // Ensure a useful selection of Edge voices (especially UK male) is present
        const ensureEdgeVoice = (id, name, gender, language = 'en-GB') => {
            const exists = voices.some(v => v.id === id);
            if (!exists) {
                voices.push({ id, name, engine: 'Edge TTS', gender, language });
            }
        };

        const hasEdge = voices.some(v => String(v.engine || '').toLowerCase().includes('edge'));
        if (!hasEdge) {
            ensureEdgeVoice('en-GB-RyanNeural',   'Edge Ryan (UK Male)',     'male');
            ensureEdgeVoice('en-GB-ThomasNeural', 'Edge Thomas (UK Male)',   'male');
            ensureEdgeVoice('en-GB-GeorgeNeural', 'Edge George (UK Male)',   'male');
            ensureEdgeVoice('en-GB-SoniaNeural',  'Edge Sonia (UK Female)',  'female');
            ensureEdgeVoice('en-GB-LibbyNeural',  'Edge Libby (UK Female)',  'female');
        } else {
            // Even if some Edge voices exist, make sure the popular UK male options are present
            ensureEdgeVoice('en-GB-RyanNeural',   'Edge Ryan (UK Male)',     'male');
            ensureEdgeVoice('en-GB-ThomasNeural', 'Edge Thomas (UK Male)',   'male');
            ensureEdgeVoice('en-GB-GeorgeNeural', 'Edge George (UK Male)',   'male');
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
 * POST /api/voice/converse
 * Streaming voice conversation with ALFRED RAG integration
 * Similar to /generate/converse but uses ALFRED's RAG system
 */
router.post('/converse', upload.single('audio'), async (req, res) => {
    const startTime = Date.now();
    console.log('Voice converse request received');
    
    try {
        let inputText = '';
        const processingMetrics = {
            stt_time_ms: 0,
            smart_turn_time_ms: 0,
            rag_time_ms: 0,
            total_time_ms: 0
        };
        
        // Step 1: Handle audio transcription if provided
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

            const sttStartTime = Date.now();
            const sttResponse = await safeAxiosCall(
                `${STT_SERVICE_URL}/transcribe_file`,
                {
                    method: 'POST',
                    data: formData,
                    headers: { 'Content-Type': 'multipart/form-data' },
                }
            );
            processingMetrics.stt_time_ms = Date.now() - sttStartTime;

            inputText = sttResponse.data.text;
            console.log(`[Voice Converse] STT transcription (${processingMetrics.stt_time_ms}ms): "${inputText}"`);
            
            // Enhanced: Smart Turn endpoint prediction (if enabled)
            let smartTurnResult = null;
            if (ENHANCED_PIPELINE_ENABLED) {
                try {
                    const smartTurnStartTime = Date.now();
                    smartTurnResult = await predictSmartTurn(req.file.buffer, inputText);
                    processingMetrics.smart_turn_time_ms = Date.now() - smartTurnStartTime;
                    
                    if (smartTurnResult) {
                        console.log(`[Voice Converse] Smart Turn result (${processingMetrics.smart_turn_time_ms}ms): complete=${smartTurnResult.is_complete}, prob=${smartTurnResult.probability.toFixed(3)}`);
                    }
                } catch (error) {
                    console.warn(`[Voice Converse] Smart Turn prediction failed: ${error.message}`);
                }
            }
        } else if (req.body.userInput) {
            inputText = req.body.userInput;
        } else if (req.body.text) {
            inputText = req.body.text;
        } else {
            return res.status(400).json({ error: 'Either audio file or text is required' });
        }

        if (!inputText.trim()) {
            return res.status(400).json({ error: 'No text to process' });
        }

        // Generate a unique dialogue ID
        const dialogueId = req.body.dialogueId || `voice-dialogue-${Date.now()}-${Math.random().toString(36).substring(2, 12)}`;
        console.log(`[Voice Converse] Using dialogueId: ${dialogueId}`);
        
        // Get conversation history if provided
        let conversationHistory = [];
        if (req.body.conversationHistory) {
            try {
                // Handle both string and object cases
                let parsedHistory;
                if (typeof req.body.conversationHistory === 'string') {
                    parsedHistory = JSON.parse(req.body.conversationHistory);
                } else {
                    parsedHistory = req.body.conversationHistory;
                }
                
                // Debug the actual structure
                console.log('Raw conversation history structure:', 
                    JSON.stringify(parsedHistory, null, 2).substring(0, 300));
                
                // Ensure it's an array with the right format
                if (Array.isArray(parsedHistory)) {
                    conversationHistory = parsedHistory.map(msg => ({
                        role: msg.role || 'user',
                        content: msg.content || msg.text || ''
                    }));
                } else if (typeof parsedHistory === 'object') {
                    // If it's not an array but an object, try to convert it
                    conversationHistory = [{
                        role: parsedHistory.role || 'user',
                        content: parsedHistory.content || parsedHistory.text || ''
                    }];
                }
                
                console.log('Formatted conversation history:', 
                    JSON.stringify(conversationHistory, null, 2).substring(0, 300));
            } catch (error) {
                console.error('Error parsing conversation history:', error);
                // Continue with empty history rather than failing
            }
        }

        // Import required modules for streaming
        const { 
            generateStreamingResponse, 
            streamChunkedTextToSpeech, 
            flushRemainingText,
            streamAdaptiveTextToSpeech,
            finishAdaptiveTextToSpeech,
            getAdaptiveStreamingDiagnostics
        } = require('../helpers/generators');
        const { ongoingDialogues } = require('../helpers/sharedState');
        const socketManager = require('../socket/socketManager');

        // Initialize or reset ongoingStream for each new request
        // This ensures clean state for each conversation turn
        ongoingDialogues.set(dialogueId, {
            id: dialogueId,
            status: 'processing',
            clients: new Set(),
            data: [],
            startTime: Date.now()
        });
        
        const ongoingStream = ongoingDialogues.get(dialogueId);
        console.log(`🔄 Initialized fresh stream state for dialogueId: ${dialogueId}`);
        
        // Add the current user input to conversation history
        if (inputText) {
            conversationHistory.push({
                role: 'user',
                content: inputText
            });
        }
        
        // Parse voice configuration from frontend
        let voiceSettings = {
            engine: 'edge_tts', // Use remote backend TTS
            enabled: true,
            edge: {
                selectedVoice: 'en-GB-RyanNeural',
                speed: 1.0,
                pitch: 0,
                volume: 0
            }
        };
        
        if (req.body.voiceConfig) {
            try {
                const parsedVoiceConfig = JSON.parse(req.body.voiceConfig);
                voiceSettings = { ...voiceSettings, ...parsedVoiceConfig };
                console.log('🎵 Parsed voice configuration:', voiceSettings.engine, 'engine selected');
            } catch (error) {
                console.error('Error parsing voice configuration:', error);
                // Continue with defaults
            }
        }
        
        // Return success immediately, client will connect to SSE stream
        res.json({
            success: true,
            dialogueId: dialogueId
        });
        
        // Start background processing with ALFRED RAG integration
        (async () => {
            try {
                // Add the user message to the data
                ongoingStream.data.push({
                    event: 'textChunk',
                    data: {
                        role: 'user',
                        text: inputText
                    }
                });
                
                // Broadcast to all clients
                socketManager.sendToClients(dialogueId, {
                    type: 'textChunk',
                    role: 'user',
                    text: inputText
                });
                
                // All questions now go through ALFRED's RAG system

                // Step 3: Generate streaming response using ALFRED RAG system
                const {
                    model = 'grok-2',
                    voice_id = 'onwK4e9ZLuTAKqWW03F9', // Daniel - Male British voice
                    speed = 1.0,
                    creator_filter = null,
                    record_type_filter = null,
                    tag_filter = null
                } = req.body;

                let responseText = '';
                
                // Configure voice settings for adaptive TTS
                // Default to local TTS service if ElevenLabs key not available
                const hasElevenLabsKey = !!process.env.ELEVENLABS_API_KEY;
                
                const voiceConfig = {
                    engine: hasElevenLabsKey ? 'elevenlabs' : 'local',
                    voiceId: hasElevenLabsKey ? voice_id : null,
                    voiceSettings: {
                        stability: 0.5,
                        similarity_boost: 0.75,
                        style: 0.0,
                        use_speaker_boost: true
                    },
                    // Legacy format for fallback compatibility
                    elevenlabs: hasElevenLabsKey ? {
                        selectedVoice: voice_id,
                        speed: speed,
                        stability: 0.5,
                        similarity_boost: 0.75,
                        model_id: 'eleven_turbo_v2',
                        style: 0.0,
                        use_speaker_boost: true
                    } : null,
                    // Local TTS configuration
                    chatterbox: {
                        selectedVoice: 'female_expressive',
                        gender: 'female',
                        emotion: 'expressive',
                        exaggeration: 0.6,
                        cfg_weight: 0.7,
                        voiceCloning: { enabled: false }
                    }
                };
                
                console.log(`[Voice Converse] Using TTS engine: ${voiceConfig.engine} (ElevenLabs available: ${hasElevenLabsKey})`);

                const handleTextChunk = async (textChunk) => {
                    responseText += textChunk;
                    
                    // Send text chunk to client for real-time display
                    socketManager.sendToClients(dialogueId, {
                        type: 'textChunk',
                        role: 'assistant',
                        text: textChunk
                    });
                    
                    ongoingStream.data.push({
                        event: 'textChunk',
                        data: {
                            role: 'assistant',
                            text: textChunk
                        }
                    });
                    
                    // NEW: Use adaptive streaming TTS for near-real-time audio generation
                    try {
                        await streamAdaptiveTextToSpeech(
                            textChunk,
                            String(dialogueId), // Use dialogueId as session identifier
                            voiceConfig,
                            (audioChunk, chunkIndex, chunkText, isFinal = false) => {
                                console.log(`🎵 Adaptive audio chunk ${chunkIndex} for text: "${chunkText.substring(0, 50)}..." (${audioChunk.length} bytes)`);
                                
                                // Send audio chunk to client immediately (live only, don't buffer)
                                socketManager.sendToClients(dialogueId, {
                                    type: 'audioChunk',
                                    audio: audioChunk,
                                    chunkIndex: chunkIndex,
                                    text: chunkText,
                                    isFinal: isFinal,
                                    adaptive: true // Mark as adaptive streaming
                                });
                                
                                // DON'T buffer audio chunks - they should only play once in real-time
                                // ongoingStream.data.push() removed to prevent duplicate audio playback
                            },
                            (textChunk) => {
                                // Text chunk callback (already handled above)
                            }
                        );
                    } catch (ttsError) {
                        console.error('Error in adaptive TTS:', ttsError.message);
                        // Fallback to legacy chunked TTS if adaptive fails
                        console.log('Falling back to legacy chunked TTS...');
                        const textAccumulator = {}; // Initialize for fallback
                        try {
                            await streamChunkedTextToSpeech(
                                textChunk,
                                textAccumulator,
                                voiceConfig,
                                (audioChunk, chunkIndex, chunkText, isFinal = false) => {
                                    socketManager.sendToClients(dialogueId, {
                                        type: 'audioChunk',
                                        audio: audioChunk,
                                        chunkIndex: chunkIndex,
                                        text: chunkText,
                                        isFinal: isFinal,
                                        fallback: true
                                    });
                                },
                                String(dialogueId)
                            );
                        } catch (fallbackError) {
                            console.error('Fallback TTS also failed:', fallbackError.message);
                        }
                    }
                };

                // Check if this is a self-referential question about ALFRED
                if (isSelfReferentialQuestion(inputText)) {
                    console.log(`[Voice Converse] Self-referential question detected: "${inputText}" - using direct LLM`);
                    
                    // Use shared function to handle self-referential questions with streaming
                    const ragResponse = await handleSelfReferentialQuestion(inputText, model, conversationHistory, handleTextChunk);
                    
                    // Store RAG metadata for response
                    ongoingStream.ragMetadata = {
                        sources: ragResponse.sources,
                        context_used: ragResponse.context_used,
                        search_results_count: ragResponse.search_results_count,
                        search_results: ragResponse.search_results,
                        applied_filters: ragResponse.applied_filters || {}
                    };
                } else {
                    // Check processing mode preference (new parameter)
                    const processingMode = req.body.processing_mode || 'rag'; // Default to RAG
                    console.log(`[Voice Converse] Processing mode: ${processingMode} for question: "${inputText}"`);
                    
                    if (processingMode === 'rag') {
                        console.log(`[Voice Converse] Using ALFRED RAG for question: "${inputText}"`);
                        
                        // Send immediate "checking" response while RAG processes
                        const checkingResponses = [
                            "Let me check that for you.",
                            "One moment, checking...",
                            "Let me find out.",
                            "Searching for that information...",
                            "Looking that up now..."
                        ];
                        const checkingResponse = checkingResponses[Math.floor(Math.random() * checkingResponses.length)];
                        
                        // Send the checking response immediately
                        await handleTextChunk(checkingResponse + " ");
                        
                        // Use ALFRED RAG system for contextual queries
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

                    // Conversation history for context grounding
                    if (conversationHistory.length > 1) { // More than just the current message
                        ragOptions.conversationHistory = conversationHistory.slice(0, -1); // Exclude current message
                        console.log(`[Voice Converse] Using conversation history with ${ragOptions.conversationHistory.length} messages`);
                    }
                    
                    // Pass existing search results for context-aware processing
                    if (req.body.existing_search_results && Array.isArray(req.body.existing_search_results)) {
                        ragOptions.existingContext = req.body.existing_search_results.map(record => {
                            const recordType = record.oip?.recordType || record.recordType || 'unknown';
                            return {
                                data: record.data,
                                recordType: recordType,
                                matchCount: record.matchCount || 0
                            };
                        });
                        console.log(`[Voice Converse] Using existing context with ${ragOptions.existingContext.length} records`);
                    }
                    
                    // If a pinned DID is supplied by the client, bypass search and answer about that record
                    if (req.body.pinnedDidTx && typeof req.body.pinnedDidTx === 'string') {
                        console.log(`[Voice Converse] Pinned DID provided by client: ${req.body.pinnedDidTx}`);
                        ragOptions.pinnedDidTx = req.body.pinnedDidTx;
                        ragOptions.include_filter_analysis = false;
                    }

                    try {
                        const ragStartTime = Date.now();
                        
                        // ALFRED RAG query with streaming support
                        // We'll need to modify this to support streaming, but for now use the existing method
                        const ragResponse = await alfred.query(inputText, ragOptions);
                        processingMetrics.rag_time_ms = Date.now() - ragStartTime;
                        
                        const alfredResponseText = ragResponse.answer;
                        console.log(`[Voice Converse] RAG processing (${processingMetrics.rag_time_ms}ms): Generated ${alfredResponseText.length} chars`);
                        
                        // For now, send the complete RAG response as chunks to simulate streaming
                        // TODO: Implement true streaming RAG responses in future versions
                        const words = alfredResponseText.split(' ');
                        const chunkSize = 3; // Send 3 words at a time
                        
                        for (let i = 0; i < words.length; i += chunkSize) {
                            const chunk = words.slice(i, i + chunkSize).join(' ');
                            if (i + chunkSize < words.length) {
                                await handleTextChunk(chunk + ' ');
                            } else {
                                await handleTextChunk(chunk);
                            }
                            
                            // Small delay to simulate streaming
                            await new Promise(resolve => setTimeout(resolve, 50));
                        }
                        
                        // Store RAG metadata for response
                        ongoingStream.ragMetadata = {
                            sources: ragResponse.sources,
                            context_used: ragResponse.context_used,
                            search_results_count: ragResponse.search_results_count,
                            search_results: ragResponse.search_results,
                            applied_filters: ragResponse.applied_filters || {}
                        };
                        
                    } catch (ragError) {
                        console.error('Error in ALFRED RAG processing:', ragError);
                        
                        // Fallback to direct LLM if RAG fails
                        const fallbackResponse = "I encountered an issue accessing my knowledge base. Let me try to help you with a general response.";
                        await handleTextChunk(fallbackResponse);
                    }
                        
                    } else if (processingMode === 'llm' || processingMode.startsWith('llm-')) {
                        console.log(`[Voice Converse] Using direct LLM mode: ${processingMode} for question: "${inputText}"`);
                        
                        // Send immediate response for LLM mode
                        const llmResponses = [
                            "Let me think about that.",
                            "Processing your question...",
                            "Analyzing that for you...",
                            "Working on your question..."
                        ];
                        const llmResponse = llmResponses[Math.floor(Math.random() * llmResponses.length)];
                        await handleTextChunk(llmResponse + " ");
                        
                        try {
                            // Process with direct LLM
                            const ragResponse = await processDirectLLM(inputText, processingMode, model, conversationHistory, handleTextChunk);
                            
                            // Store metadata
                            ongoingStream.ragMetadata = {
                                sources: [],
                                context_used: false,
                                search_results_count: 0,
                                search_results: [],
                                applied_filters: { processing_mode: processingMode, bypass_reason: "Direct LLM mode" }
                            };
                            
                        } catch (llmError) {
                            console.error('Error in direct LLM processing:', llmError);
                            
                            // Fallback error message
                            const errorResponse = "I encountered an error processing your question. Please try again.";
                            await handleTextChunk(errorResponse);
                        }
                        
                    } else {
                        // Invalid processing mode - fallback to RAG
                        console.warn(`[Voice Converse] Invalid processing_mode: ${processingMode}, falling back to RAG`);
                        
                        // Send immediate "checking" response
                        await handleTextChunk("Let me check that for you. ");
                        
                        // Use RAG as fallback (simplified version)
                        try {
                            const ragOptions = {
                                model,
                                searchParams: {
                                    creatorHandle: creator_filter,
                                    recordType: record_type_filter,
                                    tags: tag_filter
                                }
                            };
                            
                            const ragResponse = await alfred.query(inputText, ragOptions);
                            
                            // Stream the fallback response
                            const words = ragResponse.answer.split(' ');
                            const chunkSize = 3;
                            
                            for (let i = 0; i < words.length; i += chunkSize) {
                                const chunk = words.slice(i, i + chunkSize).join(' ');
                                if (i + chunkSize < words.length) {
                                    await handleTextChunk(chunk + ' ');
                                } else {
                                    await handleTextChunk(chunk);
                                }
                                await new Promise(resolve => setTimeout(resolve, 50));
                            }
                            
                            ongoingStream.ragMetadata = {
                                sources: ragResponse.sources,
                                context_used: ragResponse.context_used,
                                search_results_count: ragResponse.search_results_count,
                                search_results: ragResponse.search_results,
                                applied_filters: ragResponse.applied_filters || {}
                            };
                            
                        } catch (fallbackError) {
                            console.error('Fallback RAG also failed:', fallbackError);
                            await handleTextChunk("I'm having trouble processing your question right now.");
                        }
                    }
                }
                
                // NEW: Finish adaptive streaming session and get final metrics
                try {
                    console.log(`🎯 Finishing adaptive streaming session: ${dialogueId}`);
                    const finalMetrics = await finishAdaptiveTextToSpeech(String(dialogueId));
                    
                    if (finalMetrics.success) {
                        console.log(`🎉 Adaptive streaming completed successfully:`, {
                            firstAudioLatency: finalMetrics.firstAudioLatency,
                            chunksGenerated: finalMetrics.chunksGenerated,
                            naturalBreakRate: finalMetrics.naturalBreakRate,
                            sessionDuration: finalMetrics.sessionDuration
                        });
                        
                        // Store final metrics in the ongoing stream for client access
                        ongoingStream.adaptiveMetrics = finalMetrics;
                    } else {
                        console.warn(`⚠️ Adaptive streaming session finished with issues:`, finalMetrics.error);
                    }
                } catch (finishError) {
                    console.error('Error finishing adaptive streaming session:', finishError.message);
                    
                    // Fallback: try to flush any remaining text with legacy system
                    try {
                        const textAccumulator = {}; // Initialize for fallback
                        await flushRemainingText(
                            textAccumulator,
                            voiceConfig,
                            (audioChunk, chunkIndex, chunkText, isFinal = true) => {
                                console.log(`🎤 Fallback final audio chunk ${chunkIndex} for text: "${chunkText.substring(0, 50)}..."`);
                                
                                socketManager.sendToClients(dialogueId, {
                                    type: 'audioChunk',
                                    audio: audioChunk,
                                    chunkIndex: chunkIndex,
                                    text: chunkText,
                                    isFinal: true,
                                    fallback: true
                                });
                            },
                            String(dialogueId)
                        );
                    } catch (fallbackFlushError) {
                        console.error('Fallback flush also failed:', fallbackFlushError.message);
                    }
                }
                
                // Calculate total processing time
                processingMetrics.total_time_ms = Date.now() - startTime;
                
                // Wait for TTS processing to complete before sending completion event
                console.log('🎤 Waiting for TTS processing to complete before sending done event...');
                await new Promise(resolve => setTimeout(resolve, 3000)); // 3 seconds for TTS completion
                
                // Check if stream still has clients before sending completion
                if (socketManager.hasClients(dialogueId)) {
                    console.log('✅ Sending voice conversation completion event');
                    
                    // Mark conversation as complete with enhanced metadata
                    ongoingStream.status = 'completed';
                    const completionData = {
                        type: 'done',
                        data: "Voice conversation complete",
                        processing_metrics: processingMetrics,
                        pipeline_version: "2.0-voice-streaming",
                        timestamp: new Date().toISOString()
                    };
                    
                    // Include RAG metadata if available
                    if (ongoingStream.ragMetadata) {
                        completionData.rag_metadata = ongoingStream.ragMetadata;
                    }
                    
                    // Include Smart Turn metadata if available
                    if (ENHANCED_PIPELINE_ENABLED && smartTurnResult) {
                        completionData.smart_turn = {
                            endpoint_complete: smartTurnResult.is_complete,
                            endpoint_confidence: smartTurnResult.probability,
                            processing_time_ms: smartTurnResult.processing_time_ms
                        };
                    }
                    
                    socketManager.sendToClients(dialogueId, completionData);
                    ongoingStream.data.push({
                        event: 'done',
                        data: completionData
                    });
                } else {
                    console.log('⚠️ No clients remaining, skipping completion event');
                }
                
                // Mark the stream as completed
                ongoingStream.status = 'completed';
                console.log(`✅ Voice streaming response completed for dialogueId: ${dialogueId}`);
                
            } catch (error) {
                console.error('Error in voice streaming process:', error);
                ongoingStream.status = 'error';
                
                socketManager.sendToClients(dialogueId, {
                    type: 'error',
                    data: {
                        message: error.message
                    }
                });
                
                ongoingStream.data.push({
                    event: 'error',
                    data: {
                        message: error.message
                    }
                });
            }
        })();
        
    } catch (error) {
        console.error('Error in voice converse endpoint:', error);
        
        // If we haven't sent a response yet, send an error
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
});

/**
 * GET /api/voice/open-stream
 * Server-sent events endpoint for voice streaming responses
 */
router.get('/open-stream', (req, res) => {
    const dialogueId = req.query.dialogueId;
    
    if (!dialogueId) {
        return res.status(400).json({ error: 'dialogueId is required' });
    }
    
    console.log(`Voice open-stream connection for dialogueId: ${dialogueId}`);
    
    try {
        // Set headers for SSE
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no'); // Important for nginx proxying
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
        
        // Send initial ping to establish connection
        res.write(`event: ping\n`);
        res.write(`data: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);
        
        const { ongoingDialogues } = require('../helpers/sharedState');
        const socketManager = require('../socket/socketManager');
        
        // Get or create the dialogue stream
        if (!ongoingDialogues.has(dialogueId)) {
            console.log(`🆕 Creating new stream for dialogueId: ${dialogueId}`);
            ongoingDialogues.set(dialogueId, {
                id: dialogueId,
                status: 'waiting',
                clients: new Set(),
                data: [],
                startTime: Date.now()
            });
        } else {
            console.log(`♻️ Using existing stream for dialogueId: ${dialogueId}`);
        }
        
        const stream = ongoingDialogues.get(dialogueId);
        
        // Ensure clients is a Set (defensive programming)
        if (!stream.clients || typeof stream.clients.add !== 'function') {
            console.log(`🔧 Fixing clients Set for dialogueId: ${dialogueId}`);
            stream.clients = new Set();
        }
        
        // Add this client to the stream
        stream.clients.add(res);
        console.log(`Voice stream client added. Total clients: ${stream.clients.size}`);
        
        // Send any buffered data to the new client
        if (stream.data && stream.data.length > 0) {
            console.log(`Sending ${stream.data.length} buffered messages to new voice client`);
            for (const message of stream.data) {
                if (message.event && message.data) {
                    res.write(`event: ${message.event}\n`);
                    res.write(`data: ${JSON.stringify(message.data)}\n\n`);
                }
            }
        }
        
        // Setup periodic pings to keep the connection alive
        const pingInterval = setInterval(() => {
            if (!res.destroyed && res.writable) {
                try {
                    res.write(`event: ping\n`);
                    res.write(`data: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);
                } catch (error) {
                    console.log(`Ping failed for dialogueId: ${dialogueId}, clearing interval`);
                    clearInterval(pingInterval);
                }
            } else {
                console.log(`Connection closed for dialogueId: ${dialogueId}, clearing interval`);
                clearInterval(pingInterval);
            }
        }, 30000);
        
        // Handle client disconnect
        req.on('close', () => {
            console.log(`Voice client disconnected from dialogueId: ${dialogueId}`);
            clearInterval(pingInterval);
            
            if (ongoingDialogues.has(dialogueId)) {
                const stream = ongoingDialogues.get(dialogueId);
                stream.clients.delete(res);
                
                console.log(`Voice stream client removed. Remaining clients: ${stream.clients.size}`);
                
                // Clean up if no more clients
                if (stream.clients.size === 0) {
                    console.log(`No more voice clients for dialogueId: ${dialogueId}. Cleaning up.`);
                    ongoingDialogues.delete(dialogueId);
                }
            }
        });
        
        req.on('error', (error) => {
            console.error(`Voice stream error for dialogueId: ${dialogueId}:`, error);
            clearInterval(pingInterval);
            if (ongoingDialogues.has(dialogueId)) {
                const stream = ongoingDialogues.get(dialogueId);
                stream.clients.delete(res);
            }
        });
        
    } catch (error) {
        console.error("Error in voice open-stream handler:", error);
        res.status(500).write(`event: error\n`);
        res.write(`data: ${JSON.stringify({ message: "Server error: " + error.message })}\n\n`);
        res.end();
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

        // Optional conversation history for better continuity
        try {
            let convo = req.body.conversationHistory;
            if (typeof convo === 'string') {
                try { convo = JSON.parse(convo); } catch (_) { convo = []; }
            }
            if (Array.isArray(convo) && convo.length > 0) {
                ragOptions.conversationHistory = convo;
                console.log(`[Voice RAG] Received conversation history with ${convo.length} messages`);
            }
        } catch (_) { /* ignore */ }

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
 * GET /api/voice/adaptive-diagnostics/:sessionId
 * Get adaptive streaming diagnostics for a session
 */
router.get('/adaptive-diagnostics/:sessionId', (req, res) => {
    try {
        const { sessionId } = req.params;
        const { getAdaptiveStreamingDiagnostics } = require('../helpers/generators');
        
        const diagnostics = getAdaptiveStreamingDiagnostics(sessionId);
        
        if (!diagnostics.exists) {
            return res.status(404).json({
                error: 'Session not found',
                sessionId: sessionId
            });
        }
        
        res.json({
            success: true,
            sessionId: sessionId,
            diagnostics: diagnostics,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error(`Error getting diagnostics for session ${req.params.sessionId}:`, error);
        res.status(500).json({
            error: 'Failed to get diagnostics',
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
        tts: { url: TTS_SERVICE_URL, status: 'unknown', engine: 'kokoro' }
    };
    
    // Enhanced: Add Smart Turn service if enabled
    if (SMART_TURN_ENABLED) {
        services.smart_turn = { url: SMART_TURN_URL, status: 'unknown', enabled: true };
    }

    // Check external services
    const serviceNames = ['stt', 'tts'];
    if (SMART_TURN_ENABLED) {
        serviceNames.push('smart_turn');
    }
    
    const healthChecks = serviceNames.map(async (serviceName) => {
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

    // Extract available engines from TTS details
    const availableEngines = [];
    if (services.tts?.details?.engines) {
        services.tts.details.engines.forEach(engine => {
            if (engine.available) {
                availableEngines.push(engine.name);
            }
        });
    }
    
    // Add kokoro if it's available in the TTS service
    if (services.tts?.status === 'healthy' && 
        services.tts?.details?.engines?.some(e => e.name === 'kokoro' && e.available)) {
        if (!availableEngines.includes('kokoro')) {
            availableEngines.unshift('kokoro'); // Add at beginning as primary
        }
    }
    
    // Determine TTS status based on actual available engines
    let ttsStatusMessage = 'No TTS Engines Available';
    if (availableEngines.length > 0) {
        const primaryEngine = availableEngines[0];
        const engineNames = {
            'kokoro': 'Kokoro',
            'chatterbox': 'Chatterbox', 
            'edge_tts': 'Edge TTS',
            'gtts': 'Google TTS',
            'espeak': 'eSpeak'
        };
        ttsStatusMessage = `${engineNames[primaryEngine] || primaryEngine} Available`;
        if (availableEngines.length > 1) {
            ttsStatusMessage += ` + ${availableEngines.length - 1} more`;
        }
    }
    
    const healthResponse = {
        status: allHealthy ? 'healthy' : 'degraded',
        services: {
            stt: services.stt,
            tts: services.tts
        },
        tts_status: ttsStatusMessage,
        available_engines: availableEngines,
        timestamp: new Date().toISOString()
    };
    
    res.json(healthResponse);
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