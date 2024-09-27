const express = require('express');
const { getTemplatesInDB } = require('../helpers/elasticsearch');
// const { verifySignature, signMessage } = require('../helpers/utils');
const { publishNewTemplate } = require('../helpers/templateHelper');


const router = express.Router();

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

router.post('/newTemplate', async (req, res) => {
    console.log('POST /api/templates/newTemplate', req.body)
    const template = req.body;
    const transactionId = await publishNewTemplate(template);
    res.status(200).json({ transactionId });
});

router.post('/newTemplateRemap', async (req, res) => {
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