const Arweave = require('arweave');
const { getIrysArweave } = require('./utils');
const { createData, ArweaveSigner, JWKInterface } = require('arbundles');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { crypto, createHash } = require('crypto');
const base64url = require('base64url');


const arweaveConfig = require('../config/arweave.config');
const arweave = Arweave.init(arweaveConfig);

/**
 * Retrieves a transaction from Arweave with its tags and data.
 * @param {string} transactionId 
 * @returns {Object} Transaction data and tags
 */
const getTransaction = async (transactionId) => {
    try {
        console.log(`Fetching transaction: ${transactionId}`);
        
        // First try to get the transaction metadata and tags from Arweave
        let tags = [];
        let transactionInfo = null;
        
        try {
            // Try to get transaction info from Arweave
            transactionInfo = await arweave.transactions.get(transactionId);
            tags = transactionInfo.tags.map(tag => ({
                name: tag.get('name', { decode: true, string: true }),
                value: tag.get('value', { decode: true, string: true })
            }));
            console.log(`Found ${tags.length} tags for transaction ${transactionId}`);
        } catch (txError) {
            console.log(`Could not get transaction info from Arweave: ${txError.message}`);
            
            // For bundled transactions, try using GraphQL to get tags
            try {
                const gqlQuery = `
                    query($txId: ID!) {
                        transaction(id: $txId) {
                            id
                            tags {
                                name
                                value
                            }
                        }
                    }
                `;
                
                const gqlResponse = await axios.post('https://arweave.net/graphql', {
                    query: gqlQuery,
                    variables: { txId: transactionId }
                });
                
                if (gqlResponse.data?.data?.transaction?.tags) {
                    tags = gqlResponse.data.data.transaction.tags;
                    console.log(`Found ${tags.length} tags via GraphQL for ${transactionId}`);
                } else {
                    console.log(`No tags found via GraphQL for ${transactionId}`);
                }
            } catch (gqlError) {
                console.log(`GraphQL query also failed: ${gqlError.message}`);
                // Continue without tags - this will be a problem for OIP functionality
                console.warn(`⚠️  WARNING: No tags available for transaction ${transactionId}. This may cause OIP processing issues.`);
            }
        }
        
        // Get the transaction data
        let data = null;
        try {
            // Try using Arweave client first
            data = await arweave.transactions.getData(transactionId, { decode: true, string: true });
            console.log(`Successfully fetched data from Arweave client for ${transactionId}`);
        } catch (arweaveError) {
            console.log(`Arweave client failed: ${arweaveError.message}, trying direct HTTP request`);
            
            // If Arweave client fails, try direct HTTP request
            try {
                const response = await axios.get(`https://arweave.net/${transactionId}`, {
                    timeout: 10000,
                    headers: {
                        'Accept': 'application/json, text/plain, */*'
                    }
                });
                data = response.data;
                console.log(`Successfully fetched data via direct HTTP for ${transactionId}`);
                
                // If data is a string, try to parse it as JSON
                if (typeof data === 'string') {
                    try {
                        data = JSON.parse(data);
                    } catch (parseError) {
                        // If it's not JSON, keep as string
                        console.log('Data is not JSON, keeping as string');
                    }
                }
            } catch (httpError) {
                console.error(`HTTP request also failed: ${httpError.message}`);
                throw new Error(`Failed to fetch transaction data for ${transactionId}: ${httpError.message}`);
            }
        }
        
        if (!data) {
            throw new Error(`No data found for transaction ${transactionId}`);
        }
        
        // Extract common tag values
        const ver = tags.find(tag => tag.name === 'Ver')?.value || tags.find(tag => tag.name === 'ver')?.value;
        const creator = tags.find(tag => tag.name === 'Creator')?.value;
        const creatorSig = tags.find(tag => tag.name === 'CreatorSig')?.value;
        
        console.log(`Successfully retrieved transaction ${transactionId} with ${tags.length} tags`);
        return { transactionId, tags, ver, creator, creatorSig, data };
        
    } catch (error) {
        console.error(`Error fetching transaction ${transactionId}:`, error);
        throw error;
    }
};

/**
 * Checks the balance of the connected account using Irys SDK.
 * @returns {Promise<number>} The account balance in standard units.
 */
const checkBalance = async () => {
    const irys = await getIrysArweave();
    const atomicBalance = await irys.getLoadedBalance();
    const convertedBalance = irys.utils.fromAtomic(atomicBalance);
    const jwk = JSON.parse(fs.readFileSync(process.env.WALLET_FILE));
            
    const myPublicKey = jwk.n;
    const myAddress = base64url(createHash('sha256').update(Buffer.from(myPublicKey, 'base64')).digest()); 
    // const creatorDid = `did:arweave:${myAddress}`;
    return {convertedBalance, myAddress};
};

/**
 * Retrieves the block height of a given transaction ID from Arweave.
 * @param {string} txId 
 * @returns {Promise<number>} The block height of the transaction.
 */
async function getBlockHeightFromTxId(txId) {
    try {
        console.log(`Getting block height for transaction: ${txId}`);
        
        // Try to get block height directly from Arweave
        try {
            const arweaveResponse = await axios.get(`https://arweave.net/tx/${txId}/status`);
            const blockHeight = arweaveResponse.data.block_height;
            console.log(`Block height for ${txId}: ${blockHeight}`);
            return blockHeight;
        } catch (directError) {
            console.log(`Direct Arweave status check failed: ${directError.message}`);
            
            // For bundled transactions, try using the Arweave client
            try {
                const transaction = await arweave.transactions.get(txId);
                // If we can get the transaction, it means it's confirmed, but we may not have block height
                // Return a default block height or try to get current block height
                console.log(`Transaction found via Arweave client, but no block height available`);
                
                // For bundled transactions, we might not have block height info
                // Return 0 to indicate it exists but block height is unknown
                return 0;
            } catch (clientError) {
                console.error(`Arweave client also failed: ${clientError.message}`);
                throw new Error(`Unable to get block height for transaction ${txId}: ${clientError.message}`);
            }
        }
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
 * Funds the account with a specified upfront amount in standard units.
 * @param {number} amount - The amount to fund in standard units.
 * @param {number} multiplier - Optional fee multiplier to prioritize processing.
 * @returns {Promise<Object>} The transaction response from the funding action.
 */
const upfrontFunding = async (amount, multiplier = 1) => {
    try {
        const irys = await getIrysArweave();
        const atomicAmount = irys.utils.toAtomic(amount); // Convert to atomic units
        const response = await irys.fund(atomicAmount, multiplier);
        console.log('Upfront funding successful:', response);
        return response;
    } catch (error) {
        console.error('Error in upfront funding:', error);
        throw error;
    }
};

/**
 * Funds the account lazily, based on the size of the data to be uploaded.
 * @param {number} size - Size of the data in bytes.
 * @param {number} multiplier - Optional fee multiplier to prioritize processing.
 * @returns {Promise<Object>} The transaction response from the funding action.
 */
const lazyFunding = async (size, multiplier = 1) => {
    try {
        const irys = await getIrysArweave();
        const price = await irys.getPrice(size); // Get the cost in atomic units based on size
        const response = await irys.fund(price, multiplier); // Fund the calculated amount
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