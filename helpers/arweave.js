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

            // Try local AR.IO gateway first, then fallback to arweave.net
            const useLocalGateway = process.env.ARIO_GATEWAY_ENABLED === 'true';
            const gatewayHost = process.env.ARIO_GATEWAY_HOST || 'http://ario-gateway:4000';
            const graphqlEndpoints = [];
            
            // Add local gateway first if enabled
            if (useLocalGateway) {
                try {
                    const url = new URL(gatewayHost);
                    graphqlEndpoints.push(`${url.protocol}//${url.host}/graphql`);
                } catch (error) {
                    console.warn(`⚠️  Invalid ARIO_GATEWAY_HOST format: ${error.message}`);
                }
            }
            
            // Always add arweave.net as fallback
            graphqlEndpoints.push('https://arweave.net/graphql');
            
            let graphqlResponse = null;
            let lastError = null;
            
            // Try each endpoint in order
            for (const graphqlEndpoint of graphqlEndpoints) {
                try {
                    graphqlResponse = await axios.post(graphqlEndpoint, graphqlQuery, {
                        headers: { 'Content-Type': 'application/json' },
                        timeout: 15000
                    });
                    if (graphqlEndpoint !== graphqlEndpoints[0]) {
                        console.log(`✅ Using fallback GraphQL endpoint: ${graphqlEndpoint}`);
                    }
                    break; // Success, exit loop
                } catch (error) {
                    lastError = error;
                    if (graphqlEndpoint !== graphqlEndpoints[graphqlEndpoints.length - 1]) {
                        console.warn(`⚠️  GraphQL query failed on ${graphqlEndpoint}: ${error.message}. Trying fallback...`);
                    }
                }
            }
            
            if (!graphqlResponse) {
                throw lastError || new Error('All GraphQL endpoints failed');
            }

            if (graphqlResponse.data && graphqlResponse.data.data && graphqlResponse.data.data.transaction) {
                const txData = graphqlResponse.data.data.transaction;
                tags = txData.tags || [];
                blockHeight = txData.block ? txData.block.height : null;
                // console.log(`GraphQL found ${tags.length} tags for ${transactionId}, block height: ${blockHeight}`);
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
            // Try local AR.IO gateway first, then fallback to arweave.net
            const useLocalGateway = process.env.ARIO_GATEWAY_ENABLED === 'true';
            const gatewayHost = process.env.ARIO_GATEWAY_HOST || 'http://ario-gateway:4000';
            const gatewayUrls = [];
            
            // Add local gateway first if enabled
            if (useLocalGateway) {
                try {
                    const url = new URL(gatewayHost);
                    gatewayUrls.push(`${url.protocol}//${url.host}`);
                } catch (error) {
                    console.warn(`⚠️  Invalid ARIO_GATEWAY_HOST format: ${error.message}`);
                }
            }
            
            // Always add arweave.net as fallback
            gatewayUrls.push('https://arweave.net');
            
            let dataResponse = null;
            let gatewayError = null;
            
            // Try each gateway URL in order
            for (const gatewayBaseUrl of gatewayUrls) {
                try {
                    // Try direct gateway fetch first for data items (avoids the native client bug)
                    dataResponse = await axios.get(`${gatewayBaseUrl}/${transactionId}`, {
                        responseType: 'text',
                        timeout: 30000
                    });
                    data = dataResponse.data;
                    if (gatewayBaseUrl !== gatewayUrls[0]) {
                        console.log(`✅ Using fallback gateway: ${gatewayBaseUrl}`);
                    }
                    // console.log(`Successfully fetched data from gateway for ${transactionId}`);
                    break; // Success, exit loop
                } catch (error) {
                    gatewayError = error;
                    if (gatewayBaseUrl !== gatewayUrls[gatewayUrls.length - 1]) {
                        console.log(`⚠️  Gateway fetch failed on ${gatewayBaseUrl}: ${error.message}. Trying fallback...`);
                    }
                }
            }
            
            if (!dataResponse) {
                throw gatewayError || new Error('All gateway URLs failed');
            }
        } catch (gatewayError) {
            console.log(`All gateway fetches failed for ${transactionId}, trying native client...`);
            
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
        
        // console.log(`Extracted from tags - Creator: ${creator ? 'found' : 'missing'}, CreatorSig: ${creatorSig ? 'found' : 'missing'}, Ver: ${ver || 'missing'}`);
        if (creatorSigRaw && creatorSigRaw !== creatorSig) {
            // console.log(`Fixed CreatorSig format: converted ${creatorSigRaw.split(' ').length - 1} spaces to + characters`);
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
        // Try local AR.IO gateway first, then fallback to arweave.net
        const useLocalGateway = process.env.ARIO_GATEWAY_ENABLED === 'true';
        const gatewayHost = process.env.ARIO_GATEWAY_HOST || 'http://ario-gateway:4000';
        const gatewayUrls = [];
        
        // Debug logging
        if (process.env.DEBUG_ARIO === 'true') {
            console.log(`🔍 [getBlockHeightFromTxId] ARIO_GATEWAY_ENABLED=${process.env.ARIO_GATEWAY_ENABLED}, useLocalGateway=${useLocalGateway}, gatewayHost=${gatewayHost}`);
        }
        
        // Add local gateway first if enabled
        if (useLocalGateway) {
            try {
                const url = new URL(gatewayHost);
                const localGatewayUrl = `${url.protocol}//${url.host}`;
                gatewayUrls.push(localGatewayUrl);
                if (process.env.DEBUG_ARIO === 'true') {
                    console.log(`🔍 [getBlockHeightFromTxId] Added local gateway: ${localGatewayUrl}`);
                }
            } catch (error) {
                console.warn(`⚠️  Invalid ARIO_GATEWAY_HOST format: ${error.message}`);
            }
        } else {
            if (process.env.DEBUG_ARIO === 'true') {
                console.log(`🔍 [getBlockHeightFromTxId] Local gateway disabled, skipping`);
            }
        }
        
        // Always add arweave.net as fallback
        gatewayUrls.push('https://arweave.net');
        
        let arweaveResponse = null;
        let lastError = null;
        
        // Try each gateway URL in order
        for (const gatewayBaseUrl of gatewayUrls) {
            try {
                const requestUrl = `${gatewayBaseUrl}/tx/${txId}/status`;
                if (process.env.DEBUG_ARIO === 'true') {
                    console.log(`🔍 [getBlockHeightFromTxId] Trying: ${requestUrl}`);
                }
                arweaveResponse = await axios.get(requestUrl, {
                    timeout: 10000 // 10 second timeout
                });
                if (gatewayBaseUrl !== gatewayUrls[0]) {
                    console.log(`✅ Using fallback gateway for tx status: ${gatewayBaseUrl}`);
                } else if (process.env.DEBUG_ARIO === 'true') {
                    console.log(`✅ Successfully used local gateway: ${gatewayBaseUrl}`);
                }
                break; // Success, exit loop
            } catch (error) {
                lastError = error;
                // Only log warnings for non-404 errors (404 might be expected if tx doesn't exist)
                if (error.response?.status !== 404 && gatewayBaseUrl !== gatewayUrls[gatewayUrls.length - 1]) {
                    console.warn(`⚠️  Failed to get tx status from ${gatewayBaseUrl}: ${error.message} (status: ${error.response?.status || 'N/A'}). Trying fallback...`);
                } else if (process.env.DEBUG_ARIO === 'true') {
                    console.log(`🔍 [getBlockHeightFromTxId] Failed ${gatewayBaseUrl}: ${error.message} (status: ${error.response?.status || 'N/A'})`);
                }
            }
        }
        
        if (!arweaveResponse) {
            throw lastError || new Error('All gateway URLs failed');
        }
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
        // Try local AR.IO gateway first, then fallback to arweave.net
        const useLocalGateway = process.env.ARIO_GATEWAY_ENABLED === 'true';
        const gatewayHost = process.env.ARIO_GATEWAY_HOST || 'http://ario-gateway:4000';
        const gatewayUrls = [];
        
        // Add local gateway first if enabled
        if (useLocalGateway) {
            try {
                const url = new URL(gatewayHost);
                gatewayUrls.push(`${url.protocol}//${url.host}`);
            } catch (error) {
                console.warn(`⚠️  Invalid ARIO_GATEWAY_HOST format: ${error.message}`);
            }
        }
        
        // Always add arweave.net as fallback
        gatewayUrls.push('https://arweave.net');
        
        let response = null;
        let lastError = null;
        
        // Try each gateway URL in order
        for (const gatewayBaseUrl of gatewayUrls) {
            try {
                response = await axios.get(`${gatewayBaseUrl}/info`);
                if (gatewayBaseUrl !== gatewayUrls[0]) {
                    console.log(`✅ Using fallback gateway for info: ${gatewayBaseUrl}`);
                }
                break; // Success, exit loop
            } catch (error) {
                lastError = error;
                if (gatewayBaseUrl !== gatewayUrls[gatewayUrls.length - 1]) {
                    console.warn(`⚠️  Failed to get info from ${gatewayBaseUrl}: ${error.message}. Trying fallback...`);
                }
            }
        }
        
        if (!response) {
            throw lastError || new Error('All gateway URLs failed');
        }
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
        console.log(`Starting upfront funding for ${amount} AR...`);
        const turbo = await getTurboArweave();
        console.log('Turbo SDK obtained successfully for upfront funding');
        
        // Convert amount from AR to Winston (1 AR = 1000000000000 Winston)
        // Use the Turbo SDK's utility functions for proper conversion
        const arweaveLib = require('arweave/node'); // Import arweave for conversion utilities
        const arweave = arweaveLib.init({}); // Initialize for utilities
        const atomicAmount = arweave.ar.arToWinston(amount.toString());
        
        console.log(`Converting ${amount} AR to ${atomicAmount} Winston for funding`);
        console.log('Calling topUpWithTokens with:', { tokenAmount: atomicAmount, feeMultiplier: multiplier });
        
        const response = await turbo.topUpWithTokens({ 
            tokenAmount: atomicAmount, 
            feeMultiplier: multiplier 
        });
        console.log('Upfront funding successful:', response);
        return response;
    } catch (error) {
        console.error('Error in upfront funding at step:', error.message);
        console.error('Full upfront funding error:', error);
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
        console.log(`Starting lazy funding for ${size} bytes...`);
        const turbo = await getTurboArweave();
        console.log('Turbo SDK obtained successfully, getting upload costs...');
        
        // Get upload costs in Winston Credits
        console.log('Calling getUploadCosts with bytes:', [size]);
        const costs = await turbo.getUploadCosts({ bytes: [size] });
        console.log('Upload costs received:', costs);
        
        const requiredWinc = costs[0].winc;
        console.log(`Upload size: ${size} bytes, required credits: ${requiredWinc} Winston`);
        
        // For lazy funding, we use the required Winston credits directly
        // as the topUpWithTokens expects the amount in atomic units
        console.log('Calling topUpWithTokens with:', { tokenAmount: requiredWinc, feeMultiplier: multiplier });
        const response = await turbo.topUpWithTokens({ 
            tokenAmount: requiredWinc, 
            feeMultiplier: multiplier 
        });
        console.log('Lazy funding successful:', response);
        return response;
    } catch (error) {
        console.error('Error in lazy funding at step:', error.message);
        console.error('Full error:', error);
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