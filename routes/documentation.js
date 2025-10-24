const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

// Get list of documentation files
router.get('/files', (req, res) => {
    try {
        const docsPath = path.join(__dirname, '..', 'docs');
        const files = fs.readdirSync(docsPath)
            .filter(file => file.endsWith('.md'))
            .map(file => ({
                name: file.replace('.md', ''),
                path: path.join('docs', file)
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
        
        res.json(files);
    } catch (error) {
        console.error('Error reading documentation files:', error);
        res.status(500).json({ error: 'Failed to read documentation files' });
    }
});

// Get content of a specific documentation file
router.get('/content', (req, res) => {
    try {
        const { file } = req.query;
        if (!file) {
            return res.status(400).json({ error: 'File parameter is required' });
        }
        
        const filePath = path.join(__dirname, '..', file);
        
        // Security check: ensure the file is within the docs directory
        const docsPath = path.join(__dirname, '..', 'docs');
        const resolvedPath = path.resolve(filePath);
        const resolvedDocsPath = path.resolve(docsPath);
        
        if (!resolvedPath.startsWith(resolvedDocsPath)) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        const content = fs.readFileSync(filePath, 'utf8');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.send(content);
    } catch (error) {
        console.error('Error reading documentation file:', error);
        res.status(500).json({ error: 'Failed to read documentation file' });
    }
});

module.exports = router;
