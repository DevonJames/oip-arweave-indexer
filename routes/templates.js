const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../helpers/utils'); // Import the authentication middleware
const { getTemplatesInDB } = require('../helpers/elasticsearch');
const { publishNewTemplate } = require('../helpers/templateHelper');


router.get('/', async (req, res) => {
    try {
        const currentTemplatesInDB = await getTemplatesInDB();
        res.status(200).json({ 
            qtyTemplatesInDB: currentTemplatesInDB.length,
            templates: currentTemplatesInDB });
    } catch (error) {
        console.error('Error retrieving templates:', error);
        res.status(500).json({ error: 'Failed to retrieve templates' });
    }
});

router.post('/newTemplate', authenticateToken, async (req, res) => {
// router.post('/newTemplate', async (req, res) => {
    console.log('POST /api/templates/newTemplate', req.body)
    const template = req.body;
    const transactionId = await publishNewTemplate(template);
    res.status(200).json({ transactionId });
});

router.post('/newTemplateRemap', authenticateToken, async (req, res) => {
// router.post('/newTemplateRemap', async (req, res) => {
    try {
        const templateRemap = req.body;
        if (!validateTemplateRemap(templateRemap)) {
            return res.status(400).send('Invalid template remap data');
        }
        const result = await saveTemplateRemap(templateRemap);
        res.status(201).json({
            message: "Template remap saved successfully",
            data: result
        });
    } catch (error) {
        console.error('Error handling templateRemap:', error);
        res.status(500).send('Internal Server Error');
    }
});

module.exports = router;