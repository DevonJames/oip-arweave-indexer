const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../helpers/utils'); // Import the authentication middleware
const { getTemplatesInDB } = require('../helpers/elasticsearch');
const { publishNewTemplate } = require('../helpers/templateHelper');


router.get('/', async (req, res) => {
    try {
        const currentTemplatesInDB = await getTemplatesInDB();
        console.log('currentTemplatesInDB:', currentTemplatesInDB);

        let templates = currentTemplatesInDB.templatesInDB;
        let qtyTemplatesInDB = currentTemplatesInDB.qtyTemplatesInDB;
        let finalMaxArweaveBlock = currentTemplatesInDB.finalMaxArweaveBlock;

        const { sortBy, creatorHandle, creatorDidAddress, didTx, templateName } = req.query;

        // Filter by creatorHandle
        if (creatorHandle) {
            templates = templates.filter(template => template.creatorHandle === creatorHandle);
            console.log('after filtering by creatorHandle, there are', templates.length, 'templates');
        }

        // Filter by creatorDidAddress
        if (creatorDidAddress) {
            templates = templates.filter(template => template.creatorDidAddress === creatorDidAddress);
            console.log('after filtering by creatorDidAddress, there are', templates.length, 'templates');
        }

        // Filter by didTx
        if (didTx) {
            templates = templates.filter(template => template.oip.didTx === didTx);
            console.log('after filtering by didTx, there are', templates.length, 'templates');
        }

        // Filter by template name
        if (templateName) {
            templates = templates.filter(template => template.name.toLowerCase().includes(templateName.toLowerCase()));
            console.log('after filtering by templateName, there are', templates.length, 'templates');
        }

        // Sort by inArweaveBlock
        if (sortBy) {
            const [field, order] = sortBy.split(':');
            if (field === 'inArweaveBlock') {
                templates.sort((a, b) => {
                    if (order === 'asc') {
                        return a.inArweaveBlock - b.inArweaveBlock;
                    } else {
                        return b.inArweaveBlock - a.inArweaveBlock;
                    }
                });
            }
        }

        templates.forEach(template => {
            const fields = JSON.parse(template.data.fields);
            const fieldsInTemplate = Object.keys(fields).reduce((acc, key) => {
            if (key.startsWith('index_')) {
                const fieldName = key.replace('index_', '');
                acc[fieldName] = {
                type: fields[fieldName],
                index: fields[key]
                };
            }
            return acc;
            }, {});
            template.data.fieldsInTemplate = fieldsInTemplate;
            const fieldsInTemplateArray = Object.keys(fieldsInTemplate).map(key => {
            return {
                name: key,
                type: fieldsInTemplate[key].type,
                index: fieldsInTemplate[key].index
            };
            });
            template.data.fieldsInTemplateArray = fieldsInTemplateArray;

            // Move creator and creatorSig from data to oip
            if (!template.oip) {
            template.oip = {};
            }
            template.oip.creator = {
            // creatorHandle: template.data.creatorHandle,
            didAddress: template.data.creator,
            creatorSig: template.data.creatorSig
            };
            // template.oip.creatorSig = template.data.creatorSig;

            // Remove creator and creatorSig from data
            delete template.data.creator;
            delete template.data.creatorSig;

            // Remove fields from data
            delete template.data.fields;
        });
        let searchResults = templates.length;
        res.status(200).json({ message: "Templates retreived successfully", latestArweaveBlockInDB: finalMaxArweaveBlock, totalTemplates: qtyTemplatesInDB, searchResults, templates });
        // res.status(200).json(templates);
    } catch (error) {
        console.error('Error retrieving templates:', error);
        res.status(500).json({ error: 'Failed to retrieve templates' });
    }
});


router.post('/newTemplate', authenticateToken, async (req, res) => {
    try {
        const template = req.body;
        const result = await publishNewTemplate(template);

        // Check if the transaction was confirmed and verified
        if (!result.status.confirmed) {
            return res.status(202).json({
                message: 'Template submitted but not yet confirmed',
                ...result
            });
        }

        if (!result.verification.verified) {
            return res.status(202).json({
                message: 'Template submitted but verification failed',
                ...result
            });
        }

        // Template was successfully published and verified
        res.status(200).json({
            message: 'Template successfully published and confirmed',
            ...result
        });

    } catch (error) {
        console.error('Error in /newTemplate:', error);
        res.status(500).json({
            error: 'Failed to publish template',
            details: error.message
        });
    }
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