const Arweave = require('arweave');
const { getTurboArweave, getWalletFilePath } = require('./utils');
const { createData, ArweaveSigner, JWKInterface } = require('arbundles');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { crypto, createHash } = require('crypto');
const base64url = require('base64url');


const arweaveConfig = require('../config/arweave.config');
const arweave = Arweave.init(arweaveConfig);

/**
 * Retrieves a transaction/data item from Arweave with its tags and data.
 * Handles both native Arweave transactions and bundled data items.
 * Uses GraphQL to get proper tags and block height information.
 * @param {string} transactionId 
 * @returns {Object} Transaction data and tags
 */
const getTransaction = async (transactionId) => {
    try {
        let transaction, tags, data, blockHeight;
        
        // First, try GraphQL to get transaction metadata including tags and block height
        try {
            const graphqlQuery = {
                query: `
                    query($id: ID!) {
                        transaction(id: $id) {
                            id
                            tags {
                                name
                                value
                            }
                            block {
                                height
                                timestamp
                            }
                            data {
                                size
                            }
                        }
                    }
                `,
                variables: { id: transactionId }
            };

            const graphqlResponse = await axios.post('https://arweave.net/graphql', graphqlQuery, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 15000
            });

            if (graphqlResponse.data && graphqlResponse.data.data && graphqlResponse.data.data.transaction) {
                const txData = graphqlResponse.data.data.transaction;
                tags = txData.tags || [];
                blockHeight = txData.block ? txData.block.height : null;
                console.log(`GraphQL found ${tags.length} tags for ${transactionId}, block height: ${blockHeight}`);
            } else {
                console.log(`GraphQL returned no data for ${transactionId}`);
                tags = [];
                blockHeight = null;
            }
        } catch (graphqlError) {
            console.log(`GraphQL query failed for ${transactionId}:`, graphqlError.message);
            tags = [];
            blockHeight = null;
        }

        // Now get the actual data content
        try {
            // Try direct gateway fetch first for data items (avoids the native client bug)
            const dataResponse = await axios.get(`https://arweave.net/${transactionId}`, {
                responseType: 'text',
                timeout: 30000
            });
            data = dataResponse.data;
            console.log(`Successfully fetched data from gateway for ${transactionId}`);
        } catch (gatewayError) {
            console.log(`Gateway fetch failed for ${transactionId}, trying native client...`);
            
            // Fallback to native client if gateway fails
            try {
                data = await arweave.transactions.getData(transactionId, { decode: true, string: true });
                
                // If we didn't get tags from GraphQL, try to get them from native client
                if (tags.length === 0) {
                    try {
                        transaction = await arweave.transactions.get(transactionId);
                        tags = transaction.tags.map(tag => ({
                            name: tag.get('name', { decode: true, string: true }),
                            value: tag.get('value', { decode: true, string: true })
                        }));
                    } catch (nativeTagError) {
                        console.log(`Native client tags failed for ${transactionId}`);
                    }
                }
            } catch (nativeError) {
                console.error(`Both gateway and native client failed for ${transactionId}`);
                throw new Error(`${transactionId} data was not found!`);
            }
        }
        
        if (!data) {
            console.error(`No data found for ${transactionId}`);
            throw new Error(`${transactionId} data was not found!`);
        }
        
        // Extract OIP-specific tags from GraphQL or native response
        const ver = tags.find(tag => tag.name === 'Ver')?.value || tags.find(tag => tag.name === 'ver')?.value;
        const creator = tags.find(tag => tag.name === 'Creator')?.value;
        const creatorSigRaw = tags.find(tag => tag.name === 'CreatorSig')?.value;
        
        // Fix CreatorSig format - convert spaces back to + characters for proper base64
        const creatorSig = creatorSigRaw ? creatorSigRaw.replace(/ /g, '+') : undefined;
        
        console.log(`Extracted from tags - Creator: ${creator ? 'found' : 'missing'}, CreatorSig: ${creatorSig ? 'found' : 'missing'}, Ver: ${ver || 'missing'}`);
        if (creatorSigRaw && creatorSigRaw !== creatorSig) {
            console.log(`Fixed CreatorSig format: converted ${creatorSigRaw.split(' ').length - 1} spaces to + characters`);
        }
        
        return { 
            transactionId, 
            tags, 
            ver, 
            creator, 
            creatorSig, 
            data,
            blockHeight 
        };
        
    } catch (error) {
        console.error('Error fetching transaction or transaction data:', error);
        throw error;
    }
};

/**
 * Checks the balance of the connected account using Turbo SDK.
 * @returns {Promise<number>} The account balance in standard units.
 */
const checkBalance = async () => {
    const turbo = await getTurboArweave();
    const balance = await turbo.getBalance();
    const convertedBalance = turbo.utils ? turbo.utils.fromAtomic(balance.winc) : balance.winc;
    const jwk = JSON.parse(fs.readFileSync(getWalletFilePath()));
            
    const myPublicKey = jwk.n;
    const myAddress = base64url(createHash('sha256').update(Buffer.from(myPublicKey, 'base64')).digest()); 
    // const creatorDid = `did:arweave:${myAddress}`;
    return {convertedBalance, myAddress};
};

/**
 * Retrieves the block height of a given transaction ID from the Arweave network.
 * @param {string} txId 
 * @returns {Promise<number>} The block height of the transaction.
 */
async function getBlockHeightFromTxId(txId) {
    try {
        // Use the txId to get the block height from Arweave network
        const arweaveResponse = await axios.get(`https://arweave.net/tx/${txId}/status`);
        const blockHeight = arweaveResponse.data.block_height;
        return blockHeight;
    } catch (error) {
        console.error(`Error fetching block height for TxId ${txId}:`, error);
        throw error; // Rethrow to handle it in the calling function
    }
}

/**
 * Retrieves the current block height of the Arweave blockchain.
 * @returns {Promise<number>} The current block height.
 */
const getCurrentBlockHeight = async () => {
    try {
        const response = await axios.get('https://arweave.net/info');
        const blockHeight = response.data.height;
        // console.log('Current block height:', blockHeight);
        return blockHeight;
    } catch (error) {
        console.error('Error fetching current block height:', error);
        throw error; // Rethrow the error to handle it in the calling function
    }
};

/**
 * Funds the account with a specified upfront amount using Turbo SDK.
 * @param {number} amount - The amount to fund in AR (will be converted to Winston).
 * @param {number} multiplier - Optional fee multiplier to prioritize processing.
 * @returns {Promise<Object>} The transaction response from the funding action.
 */
const upfrontFunding = async (amount, multiplier = 1) => {
    try {
        const turbo = await getTurboArweave();
        
        // Convert amount from AR to Winston (1 AR = 1000000000000 Winston)
        // Use the Turbo SDK's utility functions for proper conversion
        const arweaveLib = require('arweave/node'); // Import arweave for conversion utilities
        const arweave = arweaveLib.init({}); // Initialize for utilities
        const atomicAmount = arweave.ar.arToWinston(amount.toString());
        
        console.log(`Converting ${amount} AR to ${atomicAmount} Winston for funding`);
        
        const response = await turbo.topUpWithTokens({ 
            tokenAmount: atomicAmount, 
            feeMultiplier: multiplier 
        });
        console.log('Upfront funding successful:', response);
        return response;
    } catch (error) {
        console.error('Error in upfront funding:', error);
        throw error;
    }
};

/**
 * Funds the account lazily, based on the size of the data to be uploaded using Turbo SDK.
 * @param {number} size - Size of the data in bytes.
 * @param {number} multiplier - Optional fee multiplier to prioritize processing.
 * @returns {Promise<Object>} The transaction response from the funding action.
 */
const lazyFunding = async (size, multiplier = 1) => {
    try {
        const turbo = await getTurboArweave();
        
        // Get upload costs in Winston Credits
        const costs = await turbo.getUploadCosts({ bytes: [size] });
        const requiredWinc = costs[0].winc;
        
        console.log(`Upload size: ${size} bytes, required credits: ${requiredWinc} Winston`);
        
        // For lazy funding, we use the required Winston credits directly
        // as the topUpWithTokens expects the amount in atomic units
        const response = await turbo.topUpWithTokens({ 
            tokenAmount: requiredWinc, 
            feeMultiplier: multiplier 
        });
        console.log('Lazy funding successful:', response);
        return response;
    } catch (error) {
        console.error('Error in lazy funding:', error);
        throw error;
    }
};

module.exports = {
    getTransaction,
    checkBalance,
    getBlockHeightFromTxId,
    getCurrentBlockHeight,
    upfrontFunding,
    lazyFunding,
    arweave,
};