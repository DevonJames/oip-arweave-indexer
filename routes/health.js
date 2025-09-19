const express = require('express');
const router = express.Router();

router.get('/', async (req, res) => {
    // console.log('GET /api/health');
    try {
        console.log(`Health check passed at: ${new Date().toISOString()}`);
        // add more checks here (e.g., database connection status)
        res.status(200).json({ status: 'OK' });
    } catch (error) {
        console.error('Health check failed:', error);
        res.status(500).json({ error: 'Health check failed' });
    }
});

module.exports = router;