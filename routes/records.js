const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../helpers/utils'); // Import the authentication middleware

// const path = require('path');
const { getRecords } = require('../helpers/elasticsearch');
// const { resolveRecords } = require('../helpers/utils');
const { publishNewRecord} = require('../helpers/templateHelper');


router.get('/', async (req, res) => {
    try {
        const queryParams = { ...req.query };
        const records = await getRecords(queryParams);
        console.log('records.js 15, records', records);
        res.status(200).json(
            records
        );
    } catch (error) {
        console.error('Error at /api/records:', error);
        res.status(500).json({ error: 'Failed to retrieve and process records' });
    }
});

router.post('/newRecord', async (req, res) => {
// router.post('/newRecord', authenticateToken, async (req, res) => {
    try {
        console.log('POST /api/records/newRecord', req.body)
        const record = req.body;
        let recordType = req.query.recordType;
        const publishFiles = req.query.publishFiles === 'true';
        const addMediaToArweave = req.query.addMediaToArweave === 'false';
        const addMediaToIPFS = req.query.addMediaToIPFS === 'true';
        const youtubeUrl = req.query.youtubeUrl || null;
        const newRecord = await publishNewRecord(record, recordType, publishFiles, addMediaToArweave, addMediaToIPFS, youtubeUrl);
        const transactionId = newRecord.transactionId;
        const dataForSignature = newRecord.dataForSignature;
        const creatorSig = newRecord.creatorSig;
        res.status(200).json(transactionId,{ record });
    } catch (error) {
        console.error('Error publishing record:', error);
        res.status(500).json({ error: 'Failed to publish record' });
    }
});

module.exports = router;