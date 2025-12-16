/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ALFRED ROUTES - Alexandria Service
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * AI assistant endpoints including RAG (Retrieval Augmented Generation) testing.
 * This file extends the voice router with additional Alfred-specific endpoints.
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const voiceRouter = require('./voice');
const alfred = require('../../helpers/alexandria/alfred');

// Create a new router that includes voice routes
const router = express.Router();

// Mount all voice routes on this router
router.use('/', voiceRouter);

/**
 * Test RAG (Retrieval Augmented Generation) functionality
 * POST /api/alfred/test-rag
 * 
 * This endpoint allows testing the RAG system by asking questions
 * and seeing how the AI retrieves and uses context from the database.
 * 
 * @body {string} question - The question to ask (default: "What records do I have?")
 * @body {string} model - Optional model override (default: 'llama3.2:3b')
 * @body {number} limit - Optional limit for search results (default: 3)
 */
router.post('/test-rag', async (req, res) => {
    try {
        const { 
            question = "What records do I have?",
            model = 'llama3.2:3b',
            limit = 3
        } = req.body;
        
        console.log(`[ALFRED] Testing RAG with question: ${question}`);
        
        const ragResponse = await alfred.query(question, {
            model,
            searchParams: { limit }
        });
        
        res.json({
            success: true,
            question,
            answer: ragResponse.answer,
            sources: ragResponse.sources,
            context_used: ragResponse.context_used,
            search_results_count: ragResponse.search_results_count,
            model: ragResponse.model
        });
        
    } catch (error) {
        console.error('[ALFRED] RAG test error:', error);
        res.status(500).json({
            success: false,
            error: 'RAG test failed',
            details: error.message
        });
    }
});

/**
 * Get Alfred status and capabilities
 * GET /api/alfred/status
 */
router.get('/status', async (req, res) => {
    try {
        res.json({
            success: true,
            service: 'alfred',
            capabilities: [
                'rag_query',
                'voice_interaction',
                'text_to_speech',
                'speech_to_text'
            ],
            status: 'operational'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
