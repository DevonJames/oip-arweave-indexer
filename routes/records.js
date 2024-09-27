const express = require('express');
const { getRecords } = require('../helpers/elasticsearch');
// const { resolveRecords } = require('../helpers/utils');
const { publishNewRecord} = require('../helpers/templateHelper');

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        const { template, resolveDepth = 0, creator_name, creator_did_address, txid, url, didTx, didTxRef, tags, sortBy } = req.query;
        const queryParams = {
            template,
            resolveDepth,
            creator_name,
            creator_did_address,
            txid,
            url,
            didTx,
            didTxRef,
            tags,
            sortBy
        };
        const records = await getRecords(queryParams);
        res.status(200).json({
            qtyRecordsInDB: records.qtyRecordsInDB,
            maxArweaveBlockInDB: records.maxArweaveBlockInDB,
            qtyReturned: records.length,
            records: records
        });
    } catch (error) {
        console.error('Error at /api/records:', error);
        res.status(500).json({ error: 'Failed to retrieve and process records' });
    }
});

router.post('/newRecord', async (req, res) => {
    try {
        const record = req.body;
        const recordType = req.query.recordType;
        const publishFiles = req.query.publishFiles === 'true';
        const addMediaToArweave = req.query.addMediaToArweave === 'true';
        const addMediaToIPFS = req.query.addMediaToIPFS === 'true';
        const youtubeUrl = req.query.youtubeUrl || null;
        const newRecord = await publishNewRecord(record, recordType, publishFiles, addMediaToArweave, addMediaToIPFS, youtubeUrl);
        const transactionId = newRecord.transactionId;
        const dataForSignature = newRecord.dataForSignature;
        const creatorSig = newRecord.creatorSig;
        res.status(200).json({ transactionId, dataForSignature, creatorSig });
    } catch (error) {
        console.error('Error publishing record:', error);
        res.status(500).json({ error: 'Failed to publish record' });
    }
});

module.exports = router;