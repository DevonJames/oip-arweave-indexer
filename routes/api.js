const express = require('express');
const path = require('path');
const fs = require('fs');
const { authenticateToken } = require('../helpers/utils'); // Import the authentication middleware

const router = express.Router();
const mediaDirectory = path.join(__dirname, '../media');

router.get('/', (req, res) => {
    res.status(200).send('Welcome to OIP server!');
});

// Route to serve media files
// router.get('/media', authenticateToken, (req, res) => {
router.get('/media', (req, res) => {
    const { id } = req.query;
    const filePath = path.join(mediaDirectory, id);
    console.log('filepath:', filePath);
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).send("File not found");
    }
});

module.exports = router;