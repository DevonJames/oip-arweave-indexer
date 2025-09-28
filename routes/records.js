const express = require('express');
const router = express.Router();
const { authenticateToken, optionalAuthenticateToken } = require('../helpers/utils'); // Import authentication middleware

// const path = require('path');
const { getRecords, searchRecordInDB, getRecordTypesSummary } = require('../helpers/elasticsearch');
// const { resolveRecords } = require('../helpers/utils');
const { publishNewRecord} = require('../helpers/templateHelper');
// const paymentManager = require('../helpers/payment-manager');
const { decryptContent } = require('../helpers/lit-protocol');
const arweaveWallet = require('../helpers/arweave-wallet');
const { GunHelper } = require('../helpers/gun');

// TODO: Implement these payment verification functions
async function verifyBitcoinPayment(txid, expectedAmount, address) {
    console.warn('Bitcoin payment verification not yet implemented');
    // Placeholder - should verify the transaction on the Bitcoin blockchain
    return false;
}

async function verifyLightningPayment(paymentProof) {
    console.warn('Lightning payment verification not yet implemented');
    // Placeholder - should verify the Lightning payment proof
    return false;
}

async function verifyZcashPayment(txid, expectedAmount, address) {
    console.warn('Zcash payment verification not yet implemented');
    // Placeholder - should verify the transaction on the Zcash blockchain
    return false;
}

async function handleSubscriptionNFT(walletAddress, nftContract) {
    console.warn('Subscription NFT handling not yet implemented');
    // Placeholder - should mint or verify NFT ownership
    return { valid: false };
}

async function getRecordByDidTx(didTx) {
    // Use the existing searchRecordInDB function
    const records = await getRecords({ didTx, limit: 1 });
    return records.records && records.records.length > 0 ? records.records[0] : null;
}

router.get('/', optionalAuthenticateToken, async (req, res) => {
    try {
        const queryParams = { 
            ...req.query,
            user: req.user,                    // NEW: Pass user info
            isAuthenticated: req.isAuthenticated, // NEW: Pass auth status
            requestInfo: {                     // NEW: Pass request info for domain validation
                origin: req.headers.origin,
                referer: req.headers.referer,
                host: req.headers.host,
                headers: req.headers
            }
        };
        
        // Normalize DID parameter (backward compatibility)
        if (queryParams.didTx && !queryParams.did) {
            queryParams.did = queryParams.didTx;
        }
        // Also support legacy didTx parameter
        if (queryParams.did && !queryParams.didTx) {
            queryParams.didTx = queryParams.did;
        }
        
        // Add storage filtering if source parameter provided
        if (queryParams.source && queryParams.source !== 'all') {
            queryParams.storage = queryParams.source; // maps to oip.storage field
        }
        
        const records = await getRecords(queryParams);
        console.log('records.js enhanced with GUN support, records:', {
            ...records,
            records: `${records.records?.length || 0} records` // Don't log full records, just count
        });
        
        // Debug: Log if we found records but they're being filtered out
        if (records.searchResults > 0 && (!records.records || records.records.length === 0)) {
            console.log('🚨 DEBUG: Found', records.searchResults, 'records but final records array is empty!');
            console.log('🚨 DEBUG: This suggests pagination or filtering issue');
        }
        
        // NEW: Add authentication status to response for client awareness
        const response = {
            ...records,
            auth: {
                authenticated: req.isAuthenticated,
                user: req.isAuthenticated ? {
                    email: req.user.email,
                    userId: req.user.userId,
                    publicKey: req.user.publicKey || req.user.publisherPubKey // Include user's public key
                } : null
            }
        };
        
        res.status(200).json(response);
    } catch (error) {
        console.error('Error at /api/records:', error);
        res.status(500).json({ error: 'Failed to retrieve and process records' });
    }
});

router.get('/recordTypes', async (req, res) => {
    try {
        const recordTypesSummary = await getRecordTypesSummary();
        console.log('records.js recordTypes endpoint, summary:', recordTypesSummary);
        res.status(200).json(recordTypesSummary);
    } catch (error) {
        console.error('Error at /api/records/recordTypes:', error);
        res.status(500).json({ error: 'Failed to retrieve record types summary' });
    }
});

router.post('/newRecord', authenticateToken, async (req, res) => {
// router.post('/newRecord', authenticateToken, async (req, res) => {
    try {
        console.log('POST /api/records/newRecord', req.body)
        const record = req.body;
        const blockchain = req.body.blockchain || req.query.blockchain || 'arweave'; // Accept blockchain from body or query
        const storage = req.body.storage || req.query.storage || blockchain; // Support storage parameter
        let recordType = req.query.recordType;
        const publishFiles = req.query.publishFiles === 'true';
        const addMediaToArweave = req.query.addMediaToArweave !== 'false'; // Default to true
        const addMediaToIPFS = req.query.addMediaToIPFS === 'true';
        const addMediaToArFleet = req.query.addMediaToArFleet === 'true'; // Default to false
        const youtubeUrl = req.query.youtubeUrl || null;
        
        // GUN-specific options
        const gunOptions = {
            storage: storage,
            localId: req.query.localId || req.body.localId,
            accessControl: req.body.accessControl || req.query.accessControl
        };
        
        const newRecord = await publishNewRecord(
            record, 
            recordType, 
            publishFiles, 
            addMediaToArweave, 
            addMediaToIPFS, 
            youtubeUrl, 
            blockchain, 
            addMediaToArFleet,
            gunOptions
        );
        
        const responseData = {
            recordToIndex: newRecord.recordToIndex,
            storage: storage
        };
        
        // Use appropriate ID field based on storage type
        if (storage === 'gun') {
            responseData.did = newRecord.did;
            responseData.soul = newRecord.soul;
            responseData.encrypted = newRecord.encrypted;
        } else {
            responseData.transactionId = newRecord.transactionId;
            responseData.blockchain = blockchain;
        }
        
        res.status(200).json(responseData);
    } catch (error) {
        console.error('Error publishing record:', error);
        res.status(500).json({ error: 'Failed to publish record' });
    }
});

// Moved decrypt route from access.js
router.post('/decrypt', async (req, res) => {
    try {
        const { contentId } = req.body;
        
        // 1. Fetch the content record from Arweave
        const recordTxId = contentId.replace('did:arweave:', '');
        const recordData = await arweaveWallet.getTransaction(recordTxId);
        const record = JSON.parse(recordData.toString());
        
        // 2. Fetch the encrypted content
        const encryptedContentTxId = record.accessControl.encryptedContent;
        const encryptedContent = await arweaveWallet.getTransaction(encryptedContentTxId);
        
        // 3. Parse the Lit conditions
        const litConditions = JSON.parse(record.accessControl.litConditions);
        
        // 4. Attempt to decrypt with Lit Protocol
        // Lit Protocol will automatically verify the access conditions
        const decryptedContent = await decryptContent(
            encryptedContent.toString(),
            record.accessControl.encryptedSymmetricKey,
            litConditions
        );
        
        // 5. Return the decrypted content
        res.json({
            status: 'success',
            data: {
                content: decryptedContent,
                metadata: record.basic
            }
        });
    } catch (error) {
        console.error('Error decrypting content:', error);
        res.status(403).json({
            error: 'Access denied or content not found',
            details: error.message
        });
    }
});

// New endpoint for unlocking content
// router.post('/unlock/:didTx', async (req, res) => {
//     try {
//         const { didTx } = req.params;
//         const { mediaType, paymentProof, walletAddress } = req.body;
        
//         // 1. Fetch the record
//         const record = await getRecordByDidTx(didTx);
//         if (!record) {
//             return res.status(404).json({ error: 'Record not found' });
//         }

//         const accessControl = record.accessControl;
        
//         // 2. Convert price to appropriate currency
//         const expectedAmount = await paymentManager.convertPrice(
//             accessControl.price,
//             accessControl.units,
//             accessControl.magnitude,
//             accessControl.currency.toUpperCase()
//         );

//         // 3. Verify payment
//         let isValid = false;
//         switch(accessControl.currency) {
//             case 'btc':
//                 isValid = await verifyBitcoinPayment(
//                     paymentProof.txid,
//                     expectedAmount,
//                     paymentProof.address
//                 );
//                 break;
//             case 'lightning':
//                 isValid = await verifyLightningPayment(paymentProof);
//                 break;
//             case 'zcash':
//                 isValid = await verifyZcashPayment(
//                     paymentProof.txid,
//                     expectedAmount,
//                     paymentProof.address
//                 );
//                 break;
//         }

//         if (!isValid) {
//             return res.status(400).json({ error: 'Invalid payment' });
//         }

//         // 4. For subscriptions, mint/verify NFT
//         if (accessControl.paymentType === 'subscription') {
//             const nftStatus = await handleSubscriptionNFT(walletAddress, accessControl.subscriptionNFTContract);
//             if (!nftStatus.valid) {
//                 return res.status(400).json({ error: 'Subscription NFT creation failed' });
//             }
//         }

//         // 5. Decrypt content
//         const decryptedContent = await decryptContent(
//             accessControl.encryptedContent,
//             accessControl.iv,
//             // We'd need a secure way to store/retrieve encryption keys
//             process.env.CONTENT_ENCRYPTION_KEY
//         );

//         // 6. Return decrypted content based on type
//         const response = {
//             contentType: accessControl.contentType,
//             content: decryptedContent
//         };

//         res.json(response);

//     } catch (error) {
//         console.error('Error unlocking content:', error);
//         res.status(500).json({ error: 'Failed to unlock content' });
//     }
// });

// // disabling /gun routes for now while we work on adding optionalAuthentication to the main get route
// // GET /api/records/gun/:soul - Get specific GUN record
// router.get('/gun/:soul', authenticateToken, async (req, res) => {
//     try {
//         const { soul } = req.params;
//         const { decrypt = true } = req.query;

//         const gunHelper = new GunHelper();
//         const record = await gunHelper.getRecord(soul, { decrypt });

//         if (!record) {
//             return res.status(404).json({ error: 'Record not found' });
//         }

//         console.log('🔍 Backend returning GUN record:', {
//             recordStructure: record,
//             dataStructure: record.data,
//             metaStructure: record.meta,
//             hasConversationSession: !!record.data?.conversationSession,
//             messageCount: record.data?.conversationSession?.message_count || 0,
//             messagesLength: record.data?.conversationSession?.messages?.length || 0
//         });

//         // The getRecord method should now return the actual decrypted data directly
//         console.log('🔍 Record data to return:', record.data);
//         console.log('🔍 Record meta.wasEncrypted:', record.meta?.wasEncrypted);

//         res.status(200).json({
//             message: 'GUN record retrieved successfully',
//             record: {
//                 data: record.data,
//                 meta: record.meta,
//                 oip: {
//                     ...record.oip,
//                     did: `did:gun:${soul}`,
//                     storage: 'gun'
//                 }
//             }
//         });
//     } catch (error) {
//         console.error('Error retrieving GUN record:', error);
//         res.status(500).json({ error: 'Failed to retrieve GUN record' });
//     }
// });

// // GET /api/records/gun - List user's GUN records
// router.get('/gun', authenticateToken, async (req, res) => {
//     try {
//         const { limit = 20, offset = 0, recordType } = req.query;
//         const userPubKey = req.user.publisherPubKey;

//         if (!userPubKey) {
//             return res.status(400).json({ error: 'Publisher public key not found in token' });
//         }

//         const gunHelper = new GunHelper();
//         const records = await gunHelper.listUserRecords(userPubKey, { limit, offset, recordType });

//         res.status(200).json({
//             message: 'GUN records retrieved successfully',
//             records: records.map(record => ({
//                 ...record,
//                 oip: {
//                     ...record.oip,
//                     did: `did:gun:${record.soul}`,
//                     storage: 'gun'
//                 }
//             })),
//             pagination: { limit, offset, total: records.length }
//         });
//     } catch (error) {
//         console.error('Error retrieving GUN records:', error);
//         res.status(500).json({ error: 'Failed to retrieve GUN records' });
//     }
// });

module.exports = router;