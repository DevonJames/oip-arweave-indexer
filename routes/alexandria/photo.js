const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const axios = require('axios');
const sharp = require('sharp');
const router = express.Router();

// Configure multer for photo uploads with temporary storage
const photoUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 20 * 1024 * 1024, // 20MB limit for photos
    },
    fileFilter: (req, file, cb) => {
        const allowedMimes = [
            'image/jpeg',
            'image/jpg', 
            'image/png',
            'image/gif',
            'image/webp',
            'image/bmp',
            'image/tiff',
            'image/svg+xml'
        ];
        
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid image format. Supported: JPEG, PNG, GIF, WebP, BMP, TIFF, SVG'), false);
        }
    }
});

// Temporary cache directory
const TEMP_CACHE_DIR = path.join(__dirname, '..', 'temp_photos');
const CACHE_CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
const MAX_CACHE_AGE = 24 * 60 * 60 * 1000; // 24 hours

// Ensure temp directory exists
async function ensureTempDir() {
    try {
        await fs.access(TEMP_CACHE_DIR);
    } catch (error) {
        await fs.mkdir(TEMP_CACHE_DIR, { recursive: true });
        console.log(`[Photo] Created temp cache directory: ${TEMP_CACHE_DIR}`);
    }
}

// Initialize temp directory on startup
ensureTempDir();

// Cleanup old cached photos periodically
setInterval(async () => {
    try {
        const files = await fs.readdir(TEMP_CACHE_DIR);
        const now = Date.now();
        
        for (const file of files) {
            const filePath = path.join(TEMP_CACHE_DIR, file);
            const stats = await fs.stat(filePath);
            
            if (now - stats.mtime.getTime() > MAX_CACHE_AGE) {
                await fs.unlink(filePath);
                console.log(`[Photo] Cleaned up old cached photo: ${file}`);
            }
        }
    } catch (error) {
        console.warn('[Photo] Cache cleanup error:', error.message);
    }
}, CACHE_CLEANUP_INTERVAL);

// Generate unique photo ID
function generatePhotoId() {
    return crypto.randomBytes(16).toString('hex');
}

// Convert buffer to base64 for Grok API
function bufferToBase64(buffer) {
    return buffer.toString('base64');
}

// Compress and resize image for API efficiency
async function optimizeImageForAPI(buffer, mimetype) {
    try {
        // Skip optimization for SVG files
        if (mimetype === 'image/svg+xml') {
            return buffer;
        }

        const image = sharp(buffer);
        const metadata = await image.metadata();
        
        console.log(`[Photo] Original image: ${metadata.width}x${metadata.height}, ${buffer.length} bytes`);
        
        // Resize if image is too large (max 1920px on longest side)
        let processedImage = image;
        const maxDimension = 1920;
        
        if (metadata.width > maxDimension || metadata.height > maxDimension) {
            processedImage = image.resize(maxDimension, maxDimension, {
                fit: 'inside',
                withoutEnlargement: true
            });
            console.log(`[Photo] Resizing image to fit within ${maxDimension}px`);
        }
        
        // Convert to JPEG with quality optimization for better compression
        const optimizedBuffer = await processedImage
            .jpeg({ 
                quality: 85,
                progressive: true,
                mozjpeg: true 
            })
            .toBuffer();
            
        console.log(`[Photo] Optimized image: ${optimizedBuffer.length} bytes (${((1 - optimizedBuffer.length / buffer.length) * 100).toFixed(1)}% reduction)`);
        
        return optimizedBuffer;
    } catch (error) {
        console.warn('[Photo] Image optimization failed, using original:', error.message);
        return buffer;
    }
}

// Get file extension from mimetype
function getExtensionFromMime(mimetype) {
    const mimeMap = {
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'image/bmp': 'bmp',
        'image/tiff': 'tiff',
        'image/svg+xml': 'svg'
    };
    return mimeMap[mimetype] || 'jpg';
}

/**
 * POST /api/photo/upload
 * Upload and cache a photo temporarily for analysis
 */
router.post('/upload', photoUpload.single('photo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ 
                error: 'No photo provided',
                message: 'Please upload an image file'
            });
        }

        const photoId = generatePhotoId();
        const extension = getExtensionFromMime(req.file.mimetype);
        const filename = `${photoId}.${extension}`;
        const filePath = path.join(TEMP_CACHE_DIR, filename);

        // Save photo to temporary cache
        await fs.writeFile(filePath, req.file.buffer);

        // Store metadata
        const metadata = {
            photoId,
            originalName: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size,
            uploadedAt: new Date().toISOString(),
            filename,
            filePath
        };

        // Save metadata alongside photo
        const metadataPath = path.join(TEMP_CACHE_DIR, `${photoId}.meta.json`);
        await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

        console.log(`[Photo] Uploaded and cached: ${filename} (${req.file.size} bytes)`);

        res.json({
            success: true,
            photoId,
            filename: req.file.originalname,
            size: req.file.size,
            mimetype: req.file.mimetype,
            message: 'Photo uploaded and cached successfully',
            expiresIn: '24 hours'
        });

    } catch (error) {
        console.error('[Photo] Upload error:', error);
        res.status(500).json({
            error: 'Photo upload failed',
            message: error.message
        });
    }
});

/**
 * POST /api/photo/analyze
 * Analyze a cached photo using Grok-4 vision capabilities
 */
router.post('/analyze', async (req, res) => {
    try {
        const { photoId, question, model = 'grok-4' } = req.body;

        if (!photoId) {
            return res.status(400).json({
                error: 'Photo ID required',
                message: 'Please provide a photoId from uploaded photo'
            });
        }

        if (!question || !question.trim()) {
            return res.status(400).json({
                error: 'Question required',
                message: 'Please provide a question about the photo'
            });
        }

        // Load photo from cache
        const metadataPath = path.join(TEMP_CACHE_DIR, `${photoId}.meta.json`);
        
        let metadata;
        try {
            const metadataContent = await fs.readFile(metadataPath, 'utf8');
            metadata = JSON.parse(metadataContent);
        } catch (error) {
            return res.status(404).json({
                error: 'Photo not found',
                message: 'Photo may have expired or was not uploaded properly'
            });
        }

        // Load photo data
        const photoPath = path.join(TEMP_CACHE_DIR, metadata.filename);
        const originalBuffer = await fs.readFile(photoPath);
        
        // Optimize image for API efficiency
        const optimizedBuffer = await optimizeImageForAPI(originalBuffer, metadata.mimetype);
        const base64Image = bufferToBase64(optimizedBuffer);

        console.log(`[Photo] Analyzing ${metadata.filename} with Grok-4: "${question}"`);

        // Prepare Grok-4 API request
        const grokApiKey = process.env.GROK_API_KEY || process.env.XAI_API_KEY;
        if (!grokApiKey) {
            return res.status(500).json({
                error: 'Grok API key not configured',
                message: 'Please set GROK_API_KEY or XAI_API_KEY environment variable'
            });
        }

        const grokApiUrl = process.env.GROK_API_URL || 'https://api.x.ai/v1/chat/completions';

        // Construct the vision prompt
        const messages = [
            {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: `Please analyze this image and answer the following question: ${question.trim()}`
                    },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:${metadata.mimetype};base64,${base64Image}`
                        }
                    }
                ]
            }
        ];

        const requestBody = {
            model: model,
            messages: messages,
            max_tokens: 1000,
            temperature: 0.7
        };

        console.log(`[Photo] Sending request to Grok API: ${grokApiUrl}`);
        console.log(`[Photo] Payload size: ${JSON.stringify(requestBody).length} bytes`);

        const startTime = Date.now();
        const grokResponse = await axios.post(grokApiUrl, requestBody, {
            headers: {
                'Authorization': `Bearer ${grokApiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 120000, // Increased to 2 minutes for large images
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        const processingTime = Date.now() - startTime;
        const analysis = grokResponse.data.choices[0].message.content;

        console.log(`[Photo] Grok-4 analysis completed in ${processingTime}ms`);

        // Update metadata with analysis
        metadata.analyses = metadata.analyses || [];
        metadata.analyses.push({
            question: question.trim(),
            answer: analysis,
            model: model,
            analyzedAt: new Date().toISOString(),
            processingTimeMs: processingTime
        });

        await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

        res.json({
            success: true,
            photoId,
            question: question.trim(),
            analysis,
            model,
            processingTimeMs: processingTime,
            photoInfo: {
                filename: metadata.originalName,
                size: metadata.size,
                uploadedAt: metadata.uploadedAt
            }
        });

    } catch (error) {
        console.error('[Photo] Analysis error:', error);
        
        if (error.response) {
            // Grok API error
            const apiError = error.response.data;
            res.status(error.response.status).json({
                error: 'Image analysis failed',
                message: apiError.error?.message || 'Grok API error',
                details: apiError
            });
        } else if (error.code === 'ECONNABORTED' && error.message.includes('timeout')) {
            res.status(408).json({
                error: 'Request timeout',
                message: 'The image analysis request timed out. This may be due to a large image size or API server load. Try with a smaller image or retry later.',
                suggestion: 'Consider uploading a smaller image (under 1MB) for faster processing'
            });
        } else if (error.code === 'ENOENT') {
            res.status(404).json({
                error: 'Photo not found',
                message: 'Photo may have expired or was not uploaded properly'
            });
        } else if (error.code === 'ECONNRESET' || error.code === 'ENOTFOUND') {
            res.status(503).json({
                error: 'Service unavailable',
                message: 'Unable to connect to the image analysis service. Please try again later.'
            });
        } else {
            res.status(500).json({
                error: 'Analysis service error',
                message: error.message,
                code: error.code
            });
        }
    }
});

/**
 * POST /api/photo/chat
 * Combined photo analysis with voice/text chat - integrates with existing Alfred workflow
 */
router.post('/chat', async (req, res) => {
    try {
        const { 
            photoId, 
            question, 
            model = 'grok-4',
            processing_mode = 'rag',
            return_audio = false,
            voiceConfig,
            conversationHistory = []
        } = req.body;

        if (!photoId || !question) {
            return res.status(400).json({
                error: 'Photo ID and question required',
                message: 'Please provide both photoId and question'
            });
        }

        // First, get the photo analysis
        const analysisResponse = await axios.post(`${req.protocol}://${req.get('host')}/api/photo/analyze`, {
            photoId,
            question,
            model
        });

        const analysis = analysisResponse.data.analysis;
        const photoInfo = analysisResponse.data.photoInfo;

        // Create enhanced context for Alfred
        const enhancedQuestion = `I have uploaded an image (${photoInfo.filename}). Based on the image analysis: "${analysis}", please help me with: ${question}`;

        // If RAG mode, use Alfred's RAG system with image context
        let finalResponse;
        if (processing_mode === 'rag') {
            const alfred = require('../../helpers/alexandria/alfred');
            
            // Create context with image analysis
            const imageContext = {
                type: 'image_analysis',
                filename: photoInfo.filename,
                analysis: analysis,
                question: question,
                uploadedAt: photoInfo.uploadedAt
            };

            // Use Alfred's RAG system with enhanced context
            finalResponse = await alfred.processRAGQuery(enhancedQuestion, {
                conversationHistory,
                additionalContext: [imageContext],
                includeImageAnalysis: true
            });
        } else {
            // Direct LLM mode - use the analysis as context
            finalResponse = analysis;
        }

        // Handle TTS if requested
        let audioData = null;
        if (return_audio && voiceConfig) {
            try {
                const ttsResponse = await axios.post(`${req.protocol}://${req.get('host')}/api/voice/synthesize`, {
                    text: finalResponse,
                    ...JSON.parse(voiceConfig || '{}')
                });
                audioData = ttsResponse.data.audio_data;
            } catch (ttsError) {
                console.warn('[Photo] TTS generation failed:', ttsError.message);
            }
        }

        res.json({
            success: true,
            response: finalResponse,
            image_analysis: analysis,
            audio_data: audioData,
            processing_mode,
            model,
            photoInfo,
            processingTimeMs: analysisResponse.data.processingTimeMs
        });

    } catch (error) {
        console.error('[Photo] Chat error:', error);
        
        if (error.response?.status === 404) {
            res.status(404).json({
                error: 'Photo not found',
                message: 'Photo may have expired or was not uploaded properly'
            });
        } else {
            res.status(500).json({
                error: 'Photo chat failed',
                message: error.message
            });
        }
    }
});

/**
 * GET /api/photo/info/:photoId
 * Get information about a cached photo
 */
router.get('/info/:photoId', async (req, res) => {
    try {
        const { photoId } = req.params;
        const metadataPath = path.join(TEMP_CACHE_DIR, `${photoId}.meta.json`);
        
        const metadataContent = await fs.readFile(metadataPath, 'utf8');
        const metadata = JSON.parse(metadataContent);
        
        // Don't expose the full file path for security
        const safeMetadata = {
            photoId: metadata.photoId,
            originalName: metadata.originalName,
            mimetype: metadata.mimetype,
            size: metadata.size,
            uploadedAt: metadata.uploadedAt,
            analyses: metadata.analyses || [],
            expiresAt: new Date(Date.parse(metadata.uploadedAt) + MAX_CACHE_AGE).toISOString()
        };
        
        res.json({
            success: true,
            photo: safeMetadata
        });
        
    } catch (error) {
        if (error.code === 'ENOENT') {
            res.status(404).json({
                error: 'Photo not found',
                message: 'Photo may have expired or was not uploaded properly'
            });
        } else {
            res.status(500).json({
                error: 'Failed to get photo info',
                message: error.message
            });
        }
    }
});

/**
 * DELETE /api/photo/:photoId
 * Manually delete a cached photo
 */
router.delete('/:photoId', async (req, res) => {
    try {
        const { photoId } = req.params;
        
        // Delete photo file
        const photoFiles = await fs.readdir(TEMP_CACHE_DIR);
        const filesToDelete = photoFiles.filter(file => file.startsWith(photoId));
        
        if (filesToDelete.length === 0) {
            return res.status(404).json({
                error: 'Photo not found',
                message: 'Photo may have already been deleted or expired'
            });
        }
        
        for (const file of filesToDelete) {
            const filePath = path.join(TEMP_CACHE_DIR, file);
            await fs.unlink(filePath);
        }
        
        console.log(`[Photo] Manually deleted cached photo: ${photoId}`);
        
        res.json({
            success: true,
            message: 'Photo deleted successfully',
            deletedFiles: filesToDelete.length
        });
        
    } catch (error) {
        console.error('[Photo] Delete error:', error);
        res.status(500).json({
            error: 'Failed to delete photo',
            message: error.message
        });
    }
});

/**
 * GET /api/photo/health
 * Health check for photo service
 */
router.get('/health', async (req, res) => {
    try {
        // Check temp directory
        await fs.access(TEMP_CACHE_DIR);
        
        // Count cached files
        const files = await fs.readdir(TEMP_CACHE_DIR);
        const photoFiles = files.filter(f => !f.endsWith('.meta.json'));
        const metaFiles = files.filter(f => f.endsWith('.meta.json'));
        
        // Check Grok API key
        const hasGrokKey = !!(process.env.GROK_API_KEY || process.env.XAI_API_KEY);
        
        res.json({
            status: 'healthy',
            service: 'Photo Upload & Analysis',
            version: '1.0.0',
            cache: {
                directory: TEMP_CACHE_DIR,
                cachedPhotos: photoFiles.length,
                metadataFiles: metaFiles.length,
                maxCacheAge: `${MAX_CACHE_AGE / (1000 * 60 * 60)} hours`,
                cleanupInterval: `${CACHE_CLEANUP_INTERVAL / (1000 * 60)} minutes`
            },
            grokIntegration: {
                apiKeyConfigured: hasGrokKey,
                model: 'grok-4',
                supportedFormats: ['JPEG', 'PNG', 'GIF', 'WebP', 'BMP', 'TIFF', 'SVG']
            },
            limits: {
                maxFileSize: '20MB',
                maxCacheAge: '24 hours'
            }
        });
        
    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            error: error.message
        });
    }
});

module.exports = router;
