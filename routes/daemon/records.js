const express = require('express');
const router = express.Router();
const { authenticateToken, optionalAuthenticateToken, userOwnsRecord, isServerAdmin, getServerPublicKey } = require('../../helpers/utils'); // Import authentication middleware
const { enforceCalendarScope } = require('../../middleware/auth'); // Import scope enforcement

// const path = require('path');
const { getRecords, searchRecordInDB, getRecordTypesSummary, deleteRecordsByDID, indexRecord, searchCreatorByAddress } = require('../../helpers/core/elasticsearch');
// const { resolveRecords } = require('../../helpers/utils');
const { publishNewRecord} = require('../../helpers/core/templateHelper');
// const paymentManager = require('../../helpers/payment-manager');
// Lit Protocol is optional - lazy load only if needed
let decryptContent;
try {
    decryptContent = require('../../helpers/lit-protocol').decryptContent;
} catch (e) {
    decryptContent = async () => { throw new Error('Lit Protocol not available'); };
}
const arweaveWallet = require('../../helpers/core/arweave-wallet');
const { GunHelper } = require('../../helpers/core/gun');

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

router.get('/', optionalAuthenticateToken, enforceCalendarScope, async (req, res) => {
    // MEMORY LEAK FIX: Track large responses for cleanup
    let records = null;
    let response = null;
    
    try {
        // DEBUG: Log user info for calendar token debugging
        if (req.user) {
            console.log(`👤 [API Request] User: ${req.user.email || req.user.userId}, tokenType: ${req.user.tokenType}, scope: ${req.user.scope}, publicKey: ${req.user.publicKey?.slice(0,20)}...`);
        }
        
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
        
        records = await getRecords(queryParams);
        
        // NEW: Add authentication status to response for client awareness
        response = {
            ...records,
            auth: {
                authenticated: req.isAuthenticated,
                user: req.isAuthenticated ? {
                    email: req.user.email,
                    userId: req.user.userId,
                    publicKey: req.user.publicKey || req.user.publisherPubKey, // Include user's public key
                    scope: req.user?.scope || 'full', // Include scope information
                    tokenType: req.user?.tokenType || 'standard'
                } : null
            }
        };
        
        res.status(200).json(response);
        
        // MEMORY LEAK FIX: Explicitly null large objects after response is sent
        // This allows V8 to garbage collect the deeply-resolved records sooner
        // Without this, userFitnessProfile with deep resolution can hold 100+ MB
        records = null;
        response = null;
        
        // Hint to GC if response was large (deeply resolved records)
        if (queryParams.resolveDepth && parseInt(queryParams.resolveDepth) > 0) {
            setImmediate(() => {
                if (global.gc) {
                    global.gc();
                }
            });
        }
    } catch (error) {
        console.error('Error at /api/records:', error);
        res.status(500).json({ error: 'Failed to retrieve and process records' });
    } finally {
        // MEMORY LEAK FIX: Ensure cleanup happens even on error paths
        records = null;
        response = null;
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
        const { clearRecordsCache } = require('../../helpers/core/elasticsearch');
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

/**
 * Index a record directly to Elasticsearch
 * POST /api/records/index
 * 
 * This endpoint allows Alexandria service to index records via the daemon.
 * Used for scenarios where Alexandria creates records that need to be indexed.
 * 
 * @body {object} record - The record to index (must have oip.did or oip.didTx)
 */
router.post('/index', authenticateToken, async (req, res) => {
    try {
        const record = req.body;
        
        if (!record || (!record.oip?.did && !record.oip?.didTx)) {
            return res.status(400).json({ 
                success: false,
                error: 'Record must have oip.did or oip.didTx field' 
            });
        }
        
        const recordId = record.oip.did || record.oip.didTx;
        console.log(`[Records API] Indexing record: ${recordId}`);
        
        await indexRecord(record);
        
        res.status(200).json({ 
            success: true,
            message: 'Record indexed successfully',
            recordId
        });
        
    } catch (error) {
        console.error('[Records API] Error indexing record:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to index record',
            details: error.message 
        });
    }
});

/**
 * Search for a creator by DID address
 * GET /api/records/creator/:didAddress
 * 
 * This endpoint allows Alexandria service to look up creators via the daemon.
 * 
 * @param {string} didAddress - The creator's DID address (e.g., did:arweave:xxx)
 */
router.get('/creator/:didAddress', async (req, res) => {
    try {
        const { didAddress } = req.params;
        
        if (!didAddress) {
            return res.status(400).json({ 
                success: false,
                error: 'didAddress parameter is required' 
            });
        }
        
        console.log(`[Records API] Looking up creator: ${didAddress}`);
        
        const creatorData = await searchCreatorByAddress(didAddress);
        
        if (!creatorData) {
            return res.status(404).json({ 
                success: false,
                error: 'Creator not found' 
            });
        }
        
        res.status(200).json({ 
            success: true,
            creator: creatorData
        });
        
    } catch (error) {
        console.error('[Records API] Error searching for creator:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to search for creator',
            details: error.message 
        });
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

/**
 * POST /api/records/publishSigned
 * 
 * Login-less publishing endpoint for v0.9 pre-signed records.
 * Accepts a payload that has already been signed client-side (with CreatorSig, KeyIndex, PayloadDigest tags).
 * Server verifies the signature, wraps in Arweave transaction, and pays the fee.
 * 
 * This enables anonymous publishing without user accounts - users sign with their mnemonic client-side.
 */
router.post('/publishSigned', async (req, res) => {
    try {
        const { payload, verifySignature = true, destinations } = req.body;
        
        if (!payload) {
            return res.status(400).json({
                error: 'Missing payload',
                message: 'Request body must include a signed "payload" object with CreatorSig tag'
            });
        }
        
        // Extract signature data from payload tags
        const tags = payload.tags || [];
        const getTag = (name) => tags.find(t => t.name === name)?.value;
        
        const creatorSig = getTag('CreatorSig');
        const payloadDigest = getTag('PayloadDigest');
        const keyIndex = getTag('KeyIndex');
        const creator = getTag('Creator');
        const version = getTag('Ver') || '0.9.0';
        
        // Validate required v0.9 signature tags
        if (!creatorSig || !payloadDigest || !keyIndex) {
            return res.status(400).json({
                error: 'Invalid v0.9 payload',
                message: 'Payload must include CreatorSig, PayloadDigest, and KeyIndex tags. Use the OIP SDK to sign your payload client-side.',
                receivedTags: tags.map(t => t.name)
            });
        }
        
        if (!creator) {
            return res.status(400).json({
                error: 'Missing Creator',
                message: 'Payload must include a Creator tag with the signer\'s DID'
            });
        }
        
        console.log(`📝 [PublishSigned] Received v${version} payload from ${creator}`);
        console.log(`   PayloadDigest: ${payloadDigest.substring(0, 20)}...`);
        console.log(`   KeyIndex: ${keyIndex}`);
        
        // Optionally verify signature before accepting
        if (verifySignature) {
            try {
                const { verifyBeforeIndex } = require('../../helpers/core/sync-verification');
                const { shouldIndex, verificationResult } = await verifyBeforeIndex(payload, 0);
                
                if (!shouldIndex) {
                    console.log(`❌ [PublishSigned] Signature verification failed: ${verificationResult.error}`);
                    return res.status(400).json({
                        error: 'Signature verification failed',
                        message: verificationResult.error || 'The signature could not be verified against the creator\'s published xpub',
                        creator,
                        keyIndex
                    });
                }
                
                console.log(`✅ [PublishSigned] Signature verified (mode: ${verificationResult.mode})`);
            } catch (verifyError) {
                console.warn(`⚠️ [PublishSigned] Verification error (proceeding anyway): ${verifyError.message}`);
                // If verification fails due to missing creator DID doc, still allow publishing
                // The signature will be verified again during indexing
            }
        }
        
        // Prepare the data for Arweave
        // For v0.9, the payload structure is the Arweave transaction data
        const dataToPublish = payload.fragments ? payload : { fragments: [payload] };
        
        // Build tags for Arweave transaction
        const arweaveTags = [
            { name: 'Index-Method', value: 'OIP' },
            { name: 'Ver', value: version },
            { name: 'Content-Type', value: 'application/json' },
            { name: 'Creator', value: creator },
            { name: 'CreatorSig', value: creatorSig },
            { name: 'PayloadDigest', value: payloadDigest },
            { name: 'KeyIndex', value: keyIndex },
            { name: 'App-Name', value: 'OIP-OnionPress' }
        ];
        
        // Add any additional tags from payload (except signature tags which we already added)
        const sigTags = ['Index-Method', 'Ver', 'Content-Type', 'Creator', 'CreatorSig', 'PayloadDigest', 'KeyIndex'];
        for (const tag of tags) {
            if (!sigTags.includes(tag.name)) {
                arweaveTags.push(tag);
            }
        }
        
        // Submit to Arweave using server wallet
        console.log(`🚀 [PublishSigned] Submitting to Arweave...`);
        const result = await arweaveWallet.uploadFile(
            JSON.stringify(dataToPublish),
            'application/json',
            arweaveTags
        );
        
        const transactionId = result.id;
        const did = `did:arweave:${transactionId}`;
        
        console.log(`✅ [PublishSigned] Published! TxID: ${transactionId}`);
        
        res.status(200).json({
            success: true,
            transactionId,
            did,
            creator,
            version,
            blockchain: 'arweave',
            message: 'Record published successfully. It will be indexed after Arweave confirmation.',
            explorerUrl: `https://viewblock.io/arweave/tx/${transactionId}`
        });
        
    } catch (error) {
        console.error('❌ [PublishSigned] Error:', error);
        res.status(500).json({
            error: 'Publishing failed',
            message: error.message
        });
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
        // For GUN records, add to distributed deletion registry
        // This ensures deletion propagates to all nodes in the network
        // NOTE: Publishing the delete message also deletes the record locally via deleteRecordFromDB
        let deleteMessageTxId = null;
        let alreadyDeleted = false;
        let gunRegistryDeletion = false;
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
        } else if (didToDelete.startsWith('did:gun:')) {
            // For GUN records, add to distributed deletion registry
            // This ensures deletion propagates across all nodes during sync
            try {
                console.log('📝 Marking GUN record as deleted in distributed deletion registry...');
                
                const { GunDeletionRegistry } = require('../../helpers/core/gunDeletionRegistry');
                const gunHelper = new GunHelper();
                const deletionRegistry = new GunDeletionRegistry(gunHelper);
                
                const marked = await deletionRegistry.markDeleted(didToDelete, user.publicKey);
                
                if (marked) {
                    gunRegistryDeletion = true;
                    console.log('✅ GUN record marked as deleted in registry');
                    console.log('✅ Deletion will propagate to all nodes during sync');
                } else {
                    console.warn('⚠️ Failed to mark record in deletion registry, will still delete locally');
                }
            } catch (error) {
                console.error('⚠️ Failed to mark record in deletion registry:', error);
                // Continue with local deletion even if registry update fails
            }
        }
        
        // Only try to delete from local index if not already deleted during blockchain message publishing
        let deleteResponse = { deleted: 0 };
        if (!alreadyDeleted) {
            // Try deleting from records index first
            deleteResponse = await deleteRecordsByDID('records', didToDelete);
            
            // If not found in records, try organizations index
            if (deleteResponse.deleted === 0) {
                console.log('Record not found in records index, trying organizations index...');
                deleteResponse = await deleteRecordsByDID('organizations', didToDelete);
                
                if (deleteResponse.deleted > 0) {
                    console.log('✅ Record deleted from organizations index');
                }
            }
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
            
            if (gunRegistryDeletion) {
                response.blockchainDeletion = false;
                response.gunRegistryDeletion = true;
                response.propagationNote = 'GUN deletion registry updated. Deletion will propagate to all nodes during sync.';
            } else if (deleteMessageTxId) {
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