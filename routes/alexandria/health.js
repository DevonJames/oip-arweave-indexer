/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ALEXANDRIA SERVICE - Health Routes
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Health check endpoints for Alexandria service:
 *   - Basic health
 *   - AI services status (Ollama)
 *   - Voice services status (TTS/STT)
 *   - Daemon connectivity
 *   - Memory monitoring
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const axios = require('axios');
const router = express.Router();

const OIP_DAEMON_URL = process.env.OIP_DAEMON_URL || 'http://oip-daemon-service:3005';
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://ollama:11434';
const TTS_SERVICE_URL = process.env.TTS_SERVICE_URL || 'http://tts-service:5500';
const STT_SERVICE_URL = process.env.STT_SERVICE_URL || 'http://stt-service:8013';

/**
 * GET /api/health
 * Basic health check
 */
router.get('/', async (req, res) => {
    try {
        const timezone = process.env.LOG_TIMEZONE || process.env.TZ || 'UTC';
        const date = new Date();
        const localTimestamp = date.toLocaleString('en-US', { 
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        
        // Check daemon connectivity
        let daemonStatus = 'unknown';
        try {
            await axios.get(`${OIP_DAEMON_URL}/health`, { timeout: 3000 });
            daemonStatus = 'connected';
        } catch (e) {
            daemonStatus = 'disconnected';
        }
        
        res.status(200).json({ 
            status: 'OK',
            service: 'alexandria-service',
            daemon: daemonStatus,
            timestamp: localTimestamp
        });
    } catch (error) {
        console.error('Health check failed:', error);
        res.status(500).json({ error: 'Health check failed' });
    }
});

/**
 * GET /api/health/ai
 * AI services status (Ollama)
 */
router.get('/ai', async (req, res) => {
    try {
        let ollamaStatus = 'unknown';
        let ollamaModels = [];
        let ollamaError = null;
        
        try {
            const response = await axios.get(`${OLLAMA_HOST}/api/tags`, { timeout: 5000 });
            ollamaStatus = 'connected';
            ollamaModels = response.data.models || [];
        } catch (e) {
            ollamaStatus = 'disconnected';
            ollamaError = e.message;
        }
        
        // Check for OpenAI API key
        const hasOpenAI = !!process.env.OPENAI_API_KEY;
        const hasXAI = !!process.env.XAI_API_KEY;
        
        res.json({
            service: 'ai',
            status: ollamaStatus === 'connected' || hasOpenAI || hasXAI ? 'available' : 'unavailable',
            providers: {
                ollama: {
                    status: ollamaStatus,
                    host: OLLAMA_HOST,
                    models: ollamaModels.map(m => m.name),
                    error: ollamaError
                },
                openai: {
                    configured: hasOpenAI
                },
                xai: {
                    configured: hasXAI
                }
            },
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Error checking AI services:', error);
        res.status(500).json({
            service: 'ai',
            status: 'error',
            error: error.message
        });
    }
});

/**
 * GET /api/health/voice
 * Voice services status (TTS/STT)
 */
router.get('/voice', async (req, res) => {
    try {
        let ttsStatus = 'unknown';
        let sttStatus = 'unknown';
        let ttsError = null;
        let sttError = null;
        
        // Check TTS service
        try {
            await axios.get(`${TTS_SERVICE_URL}/health`, { timeout: 3000 });
            ttsStatus = 'connected';
        } catch (e) {
            ttsStatus = 'disconnected';
            ttsError = e.message;
        }
        
        // Check STT service
        try {
            await axios.get(`${STT_SERVICE_URL}/health`, { timeout: 3000 });
            sttStatus = 'connected';
        } catch (e) {
            sttStatus = 'disconnected';
            sttError = e.message;
        }
        
        const allConnected = ttsStatus === 'connected' && sttStatus === 'connected';
        const partialConnected = ttsStatus === 'connected' || sttStatus === 'connected';
        
        res.json({
            service: 'voice',
            status: allConnected ? 'healthy' : (partialConnected ? 'partial' : 'unavailable'),
            services: {
                tts: {
                    status: ttsStatus,
                    url: TTS_SERVICE_URL,
                    error: ttsError
                },
                stt: {
                    status: sttStatus,
                    url: STT_SERVICE_URL,
                    error: sttError
                }
            },
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Error checking voice services:', error);
        res.status(500).json({
            service: 'voice',
            status: 'error',
            error: error.message
        });
    }
});

/**
 * GET /api/health/daemon
 * OIP Daemon connectivity status
 */
router.get('/daemon', async (req, res) => {
    try {
        let daemonStatus = 'unknown';
        let daemonHealth = null;
        let daemonError = null;
        
        try {
            const response = await axios.get(`${OIP_DAEMON_URL}/health`, { timeout: 5000 });
            daemonStatus = 'connected';
            daemonHealth = response.data;
        } catch (e) {
            daemonStatus = 'disconnected';
            daemonError = e.message;
        }
        
        res.json({
            service: 'daemon',
            status: daemonStatus,
            url: OIP_DAEMON_URL,
            health: daemonHealth,
            error: daemonError,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Error checking daemon:', error);
        res.status(500).json({
            service: 'daemon',
            status: 'error',
            error: error.message
        });
    }
});

/**
 * GET /api/health/memory
 * Memory health check
 */
router.get('/memory', async (req, res) => {
    try {
        const v8 = require('v8');
        const memUsage = process.memoryUsage();
        const heapStats = v8.getHeapStatistics();
        
        const heapUtilization = (heapStats.used_heap_size / heapStats.heap_size_limit) * 100;
        
        let status = 'healthy';
        let warnings = [];
        
        if (heapUtilization > 90) {
            status = 'critical';
            warnings.push('Heap utilization above 90%');
        } else if (heapUtilization > 80) {
            status = 'warning';
            warnings.push('Heap utilization above 80%');
        }
        
        const response = {
            status,
            warnings,
            service: 'alexandria-service',
            timestamp: new Date().toISOString(),
            uptime: Math.round(process.uptime()),
            memory: {
                rss: {
                    bytes: memUsage.rss,
                    mb: Math.round(memUsage.rss / 1024 / 1024)
                },
                heapUsed: {
                    bytes: memUsage.heapUsed,
                    mb: Math.round(memUsage.heapUsed / 1024 / 1024)
                },
                heapTotal: {
                    bytes: memUsage.heapTotal,
                    mb: Math.round(memUsage.heapTotal / 1024 / 1024)
                },
                external: {
                    bytes: memUsage.external,
                    mb: Math.round(memUsage.external / 1024 / 1024)
                }
            },
            heap: {
                utilization: parseFloat(heapUtilization.toFixed(2)) + '%'
            }
        };
        
        res.json(response);
        
    } catch (error) {
        console.error('Error getting memory health:', error);
        res.status(500).json({
            status: 'error',
            error: error.message
        });
    }
});

/**
 * GET /api/health/full
 * Full health check for all services
 */
router.get('/full', async (req, res) => {
    try {
        const checks = {
            service: 'alexandria-service',
            timestamp: new Date().toISOString(),
            uptime: Math.round(process.uptime()),
            services: {}
        };
        
        // Check daemon
        try {
            await axios.get(`${OIP_DAEMON_URL}/health`, { timeout: 3000 });
            checks.services.daemon = { status: 'connected' };
        } catch (e) {
            checks.services.daemon = { status: 'disconnected', error: e.message };
        }
        
        // Check Ollama
        try {
            const ollamaResponse = await axios.get(`${OLLAMA_HOST}/api/tags`, { timeout: 3000 });
            checks.services.ollama = { 
                status: 'connected',
                models: (ollamaResponse.data.models || []).length
            };
        } catch (e) {
            checks.services.ollama = { status: 'disconnected', error: e.message };
        }
        
        // Check TTS
        try {
            await axios.get(`${TTS_SERVICE_URL}/health`, { timeout: 3000 });
            checks.services.tts = { status: 'connected' };
        } catch (e) {
            checks.services.tts = { status: 'disconnected', error: e.message };
        }
        
        // Check STT
        try {
            await axios.get(`${STT_SERVICE_URL}/health`, { timeout: 3000 });
            checks.services.stt = { status: 'connected' };
        } catch (e) {
            checks.services.stt = { status: 'disconnected', error: e.message };
        }
        
        // Determine overall status
        const allConnected = Object.values(checks.services).every(s => s.status === 'connected');
        const anyConnected = Object.values(checks.services).some(s => s.status === 'connected');
        
        checks.status = allConnected ? 'healthy' : (anyConnected ? 'degraded' : 'unhealthy');
        
        // Add memory info
        const memUsage = process.memoryUsage();
        checks.memory = {
            heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
            rssMB: Math.round(memUsage.rss / 1024 / 1024)
        };
        
        res.json(checks);
        
    } catch (error) {
        console.error('Error in full health check:', error);
        res.status(500).json({
            status: 'error',
            error: error.message
        });
    }
});

module.exports = router;

