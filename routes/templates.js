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
        // if (creatorHandle) {
        //     templates = templates.filter(template => template.oip.creatorHandle === creatorHandle);
        //     console.log('after filtering by creatorHandle, there are', templates.length, 'templates');
        // }

        // Filter by creatorDidAddress
        if (creatorDidAddress) {
            templates = templates.filter(template => template.oip.creator.didAddress === creatorDidAddress);
            console.log('after filtering by creatorDidAddress, there are', templates.length, 'templates');
        }

        // Filter by didTx
        if (didTx) {
            templates = templates.filter(template => template.oip.didTx === didTx);
            console.log('after filtering by didTx, there are', templates.length, 'templates');
        }

        // Filter by template name
        if (templateName) {
            templates = templates.filter(template => template.data.template.toLowerCase().includes(templateName.toLowerCase()));
            console.log('after filtering by templateName, there are', templates.length, 'templates');
        }

        // Sort by inArweaveBlock
        if (sortBy) {
            const [field, order] = sortBy.split(':');
            if (field === 'inArweaveBlock') {
                templates.sort((a, b) => {
                    if (order === 'asc') {
                        return a.oip.inArweaveBlock - b.oip.inArweaveBlock;
                    } else {
                        return b.oip.inArweaveBlock - a.oip.inArweaveBlock;
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
            template.data.fieldsInTemplateCount = fieldsInTemplateArray.length;

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


// router.post('/newTemplate', authenticateToken, async (req, res) => {
router.post('/newTemplate', async (req, res) => {
    try {
        console.log('POST /api/templates/newTemplate', req.body)
        const template = req.body;
        const blockchain = req.body.blockchain || 'arweave'; // Accept blockchain parameter
        const newTemplate = await publishNewTemplate(template, blockchain);
        res.status(200).json({ newTemplate, blockchain });
    } catch (error) {
        console.error('Error publishing template:', error);
        res.status(500).json({ error: 'Failed to publish template' });
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