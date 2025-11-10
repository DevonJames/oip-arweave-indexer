const express = require('express');
const router = express.Router();
const { authenticateToken, optionalAuthenticateToken, userOwnsRecord, isServerAdmin, getServerPublicKey } = require('../helpers/utils'); // Import authentication middleware

// const path = require('path');
const { getRecords, searchRecordInDB, getRecordTypesSummary, deleteRecordsByDID } = require('../helpers/elasticsearch');
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
        
        // CACHE BYPASS: Check for forceRefresh parameter
        const forceRefresh = queryParams.forceRefresh === 'true' || queryParams.forceRefresh === true;
        if (forceRefresh) {
            console.log('🔄 [Records API] Force refresh requested - bypassing cache');
            queryParams.forceRefresh = true;
        }
        
        const records = await getRecords(queryParams);
        
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
        res.status(200).json(recordTypesSummary);
    } catch (error) {
        console.error('Error at /api/records/recordTypes:', error);
        res.status(500).json({ error: 'Failed to retrieve record types summary' });
    }
});

// Cache management endpoints
router.post('/clear-cache', async (req, res) => {
    try {
        const { clearRecordsCache } = require('../helpers/elasticsearch');
        clearRecordsCache();
        console.log('🧹 [Records API] Cache cleared manually');
        res.status(200).json({ 
            status: 'success', 
            message: 'Records cache cleared successfully',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error clearing records cache:', error);
        res.status(500).json({ error: 'Failed to clear records cache' });
    }
});

router.post('/newRecord', authenticateToken, async (req, res) => {
    try {
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

// Delete record endpoint - allows authenticated users to delete their own records
// Also publishes blockchain delete messages for Arweave records to propagate deletion across all nodes
router.post('/deleteRecord', authenticateToken, async (req, res) => {
    try {
        console.log('POST /api/records/deleteRecord', req.body);
        
        // Validate request format
        if (!req.body.delete || !req.body.delete.did) {
            return res.status(400).json({ 
                error: 'Invalid request format. Expected: {"delete": {"did": "did:gun:..."}}' 
            });
        }
        
        const didToDelete = req.body.delete.did;
        const user = req.user;
        
        // Validate DID format
        if (!didToDelete || typeof didToDelete !== 'string') {
            return res.status(400).json({ 
                error: 'Invalid DID format. DID must be a non-empty string.' 
            });
        }
        
        console.log('Attempting to delete record:', didToDelete, 'for user:', user.publicKey?.slice(0, 12));
        
        // First, find the record to verify ownership
        const recordToDelete = await searchRecordInDB(didToDelete);
        
        if (!recordToDelete) {
            return res.status(404).json({ 
                error: 'Record not found',
                did: didToDelete
            });
        }
        
        // Verify that the authenticated user owns this record
        const ownsRecord = userOwnsRecord(recordToDelete, user);
        
        if (!ownsRecord) {
            console.log('User does not own record. User:', user.publicKey?.slice(0, 12), 'Record owner checks failed');
            return res.status(403).json({ 
                error: 'Access denied. You can only delete records that you own.',
                did: didToDelete
            });
        }
        
        console.log('Ownership verified. Proceeding with deletion.');
        
        // For Arweave records, publish a blockchain delete message first
        // This ensures deletion propagates to all nodes in the network
        // NOTE: Publishing the delete message also deletes the record locally via deleteRecordFromDB
        let deleteMessageTxId = null;
        let alreadyDeleted = false;
        const recordStatus = recordToDelete.oip?.recordStatus;
        const isPendingRecord = recordStatus === "pending confirmation in Arweave";
        
        if (didToDelete.startsWith('did:arweave:')) {
            // For pending records, skip blockchain delete message and just delete locally
            // since the record hasn't been confirmed on the blockchain yet
            if (isPendingRecord) {
                console.log('⚠️ Record has pending status - skipping blockchain delete message');
                console.log('ℹ️ Will delete locally only (record not yet confirmed on blockchain)');
            } else {
                try {
                    console.log('📝 Publishing blockchain delete message for Arweave record...');
                    
                    // Check if this is a server admin deleting a server-created record
                    const isAdmin = isServerAdmin(user);
                    const serverPubKey = getServerPublicKey();
                    const creatorPubKey = recordToDelete.oip?.creator?.publicKey;
                    const isServerCreated = serverPubKey && creatorPubKey === serverPubKey;
                    
                    if (isAdmin && isServerCreated) {
                        console.log('✅ Admin deleting server-created record - using server wallet for delete message');
                    }
                    
                    // Publish delete message (will be signed by server wallet automatically via publishNewRecord)
                    // This also triggers deleteRecordFromDB which deletes the target record immediately
                    const deleteMessage = {
                        delete: {
                            // didTx: didToDelete,
                            did: didToDelete
                        }
                    };
                    
                    const publishResult = await publishNewRecord(
                        deleteMessage,
                        'deleteMessage', // recordType
                        false, // publishFiles
                        true,  // addMediaToArweave
                        false, // addMediaToIPFS
                        null,  // youtubeUrl
                        'arweave', // blockchain
                        false  // addMediaToArFleet
                    );
                    
                    deleteMessageTxId = publishResult.transactionId;
                    alreadyDeleted = true; // The record was deleted by deleteRecordFromDB during publishing
                    console.log('✅ Delete message published to blockchain:', deleteMessageTxId);
                    console.log('✅ Record deleted locally via deleteRecordFromDB during message publishing');
                } catch (error) {
                    console.error('⚠️ Failed to publish blockchain delete message:', error);
                    // Continue with local deletion even if blockchain message fails
                }
            }
        }
        
        // Only try to delete from local index if not already deleted during blockchain message publishing
        let deleteResponse = { deleted: 0 };
        if (!alreadyDeleted) {
            deleteResponse = await deleteRecordsByDID('records', didToDelete);
        } else {
            // Mark as deleted since it was already handled
            deleteResponse = { deleted: 1 };
        }
        
        if (deleteResponse.deleted > 0 || alreadyDeleted) {
            console.log(`Successfully deleted record with DID: ${didToDelete}`);
            
            const response = {
                success: true,
                message: 'Record deleted successfully',
                did: didToDelete,
                deletedCount: 1,
                recordStatus: recordStatus
            };
            
            if (deleteMessageTxId) {
                response.deleteMessageTxId = deleteMessageTxId;
                response.blockchainDeletion = true;
                response.propagationNote = 'Delete message published to blockchain. Deletion will propagate to all nodes during sync.';
            } else if (isPendingRecord) {
                response.blockchainDeletion = false;
                response.propagationNote = 'Record was pending confirmation - deleted locally without blockchain message (record not yet confirmed on chain).';
            } else {
                response.blockchainDeletion = false;
                response.propagationNote = 'Local deletion only. To delete from all nodes, ensure blockchain delete message is published.';
            }
            
            res.status(200).json(response);
        } else {
            console.log('No records were deleted. Record may not exist in index.');
            res.status(404).json({
                error: 'Record not found in index or already deleted',
                did: didToDelete
            });
        }
        
    } catch (error) {
        console.error('Error deleting record:', error);
        res.status(500).json({ 
            error: 'Failed to delete record',
            details: error.message
        });
    }
});

module.exports = router;