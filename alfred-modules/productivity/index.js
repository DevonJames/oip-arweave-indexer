/**
 * ALFRED Productivity Module - Main Server
 * Express server for productivity features
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

// Import routes
const productivityRoutes = require('./routes/productivity');

// Import configurations
const defaultSettings = require('./config/default-settings');

// Create Express app
const app = express();
const PORT = process.env.PRODUCTIVITY_PORT || 3006;

// Middleware
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(cors({
    origin: process.env.NODE_ENV === 'production' ?
        ['http://localhost:3005', 'https://api.oip.onl'] :
        ['http://localhost:3005', 'http://localhost:3000', 'http://localhost:3001'],
    credentials: true
}));

app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        module: 'alfred-productivity',
        version: '1.0.0',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// API Routes
app.use('/api/productivity', productivityRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Productivity module error:', err);

    // Handle different types of errors
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            error: 'Validation Error',
            details: err.message
        });
    }

    if (err.name === 'UnauthorizedError') {
        return res.status(401).json({
            error: 'Unauthorized',
            details: 'Invalid or missing authentication token'
        });
    }

    // Generic error response
    res.status(500).json({
        error: 'Internal Server Error',
        details: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.originalUrl} not found in productivity module`
    });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down productivity module gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down productivity module gracefully');
    process.exit(0);
});

// Start server
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`🚀 ALFRED Productivity Module running on port ${PORT}`);
        console.log(`📊 Health check: http://localhost:${PORT}/health`);
        console.log(`📋 API endpoints: http://localhost:${PORT}/api/productivity`);
        console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    });
}

module.exports = app;
