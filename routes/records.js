const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../helpers/utils'); // Import the authentication middleware

// const path = require('path');
const { getRecords } = require('../helpers/elasticsearch');
// const { resolveRecords } = require('../helpers/utils');
const { publishNewRecord} = require('../helpers/templateHelper');
const paymentManager = require('../helpers/payment-manager');


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
        const recordToIndex = newRecord.recordToIndex;
        // const dataForSignature = newRecord.dataForSignature;
        // const creatorSig = newRecord.creatorSig;
        res.status(200).json(transactionId, recordToIndex);
    } catch (error) {
        console.error('Error publishing record:', error);
        res.status(500).json({ error: 'Failed to publish record' });
    }
});

// New endpoint for unlocking content
router.post('/unlock/:didTx', async (req, res) => {
    try {
        const { didTx } = req.params;
        const { mediaType, paymentProof, walletAddress } = req.body;
        
        // 1. Fetch the record
        const record = await getRecordByDidTx(didTx);
        if (!record) {
            return res.status(404).json({ error: 'Record not found' });
        }

        const accessControl = record.accessControl;
        
        // 2. Convert price to appropriate currency
        const expectedAmount = await paymentManager.convertPrice(
            accessControl.price,
            accessControl.units,
            accessControl.magnitude,
            accessControl.currency.toUpperCase()
        );

        // 3. Verify payment
        let isValid = false;
        switch(accessControl.currency) {
            case 'btc':
                isValid = await verifyBitcoinPayment(
                    paymentProof.txid,
                    expectedAmount,
                    paymentProof.address
                );
                break;
            case 'lightning':
                isValid = await verifyLightningPayment(paymentProof);
                break;
            case 'zcash':
                isValid = await verifyZcashPayment(
                    paymentProof.txid,
                    expectedAmount,
                    paymentProof.address
                );
                break;
        }

        if (!isValid) {
            return res.status(400).json({ error: 'Invalid payment' });
        }

        // 4. For subscriptions, mint/verify NFT
        if (accessControl.paymentType === 'subscription') {
            const nftStatus = await handleSubscriptionNFT(walletAddress, accessControl.subscriptionNFTContract);
            if (!nftStatus.valid) {
                return res.status(400).json({ error: 'Subscription NFT creation failed' });
            }
        }

        // 5. Decrypt content
        const decryptedContent = await decryptContent(
            accessControl.encryptedContent,
            accessControl.iv,
            // We'd need a secure way to store/retrieve encryption keys
            process.env.CONTENT_ENCRYPTION_KEY
        );

        // 6. Return decrypted content based on type
        const response = {
            contentType: accessControl.contentType,
            content: decryptedContent
        };

        res.json(response);

    } catch (error) {
        console.error('Error unlocking content:', error);
        res.status(500).json({ error: 'Failed to unlock content' });
    }
});

module.exports = router;