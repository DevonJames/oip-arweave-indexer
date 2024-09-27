const Arweave = require('arweave');
const { getIrysArweave } = require('./utils');
const { createData, ArweaveSigner, JWKInterface } = require('arbundles');
const fs = require('fs');
const path = require('path');
const axios = require('axios');


const arweaveConfig = require('../config/arweave.config');
const arweave = Arweave.init(arweaveConfig);

const getTransaction = async (transactionId) => {
    const endpoint = 'https://node1.bundlr.network/tx/';
    try {
        const response = await axios.get(`${endpoint}${transactionId}`);
        tags = response.data.tags;
        const data = await arweave.transactions.getData(transactionId, { decode: true, string: true });
        if (!data) {
            console.error(`Error fetching transaction data for ${transactionId}`);
        } else {
            const ver = tags.find(tag => tag.name === 'Ver')?.value || tags.find(tag => tag.name === 'ver')?.value;
            const creator = tags.find(tag => tag.name === 'Creator')?.value;
            const creatorSig = tags.find(tag => tag.name === 'CreatorSig')?.value;
            return ({ transactionId, tags, ver, creator, creatorSig, data });
        }
    } catch (error) {
        console.error('Error fetching transaction or transaction data:', error);
    }
};

const checkBalance = async () => {
    const irys = await getIrysArweave();
    const atomicBalance = await irys.getLoadedBalance();
    const convertedBalance = irys.utils.fromAtomic(atomicBalance);
    return convertedBalance;
};

async function getBlockHeightFromTxId(txId) {
    try {
        // Get the bundleTxId from the Bundlr network
        const bundlrResponse = await axios.get(`http://node1.bundlr.network/tx/${txId}/status`);
        const bundleTxId = bundlrResponse.data.bundleTxId;
        // Use the bundleTxId to get the block height from Arweave network
        const arweaveResponse = await axios.get(`https://arweave.net/tx/${bundleTxId}/status`);
        const blockHeight = arweaveResponse.data.block_height;
        return blockHeight;
    } catch (error) {
        console.error(`Error fetching block height for TxId ${txId}:`, error);
        throw error; // Rethrow to handle it in the calling function
    }
}

module.exports = {
    getTransaction,
    checkBalance,
    getBlockHeightFromTxId,
    arweave
};
// const { createData, ArweaveSigner, JWKInterface } = require('arbundles');
// const fs = require('fs');
// const path = require('path');
// const crypto = require('crypto');
// const { gql, request } = require('graphql-request');
// const templatesConfig = require('../config/templates.config.js');
// const dotenv = require('dotenv');
// dotenv.config();

// const arweaveConfig = require('../config/arweave.config.js');
// const arweave = Arweave.init(arweaveConfig);
// const walletFileLocation = process.env.WALLET_FILE;
// const jwk = JSON.parse(fs.readFileSync(walletFileLocation));
// const signer = new ArweaveSigner(jwk);

// const getIrysArweave = async () => {
//   const network = "mainnet";
//   const token = "arweave";
//   const key = JSON.parse(fs.readFileSync(walletFileLocation).toString());
//   const irys = new Irys({ network, token, key });
//   return irys;
// };

// const signMessage = async (data) => {
//   const myPublicKey = jwk.n;
//   const myAddress = crypto.createHash('sha256').update(myPublicKey).digest('base64');
//   const signatureObject = await arweave.crypto.sign(jwk, data)
//   const signatureBase64 = Buffer.from(signatureObject).toString('base64');
//   const isVerified = await ArweaveSigner.verify(myPublicKey, data, signatureObject);
//   return { signatureBase64, isVerified };
// };

// const getTransactionData = async (transactionId) => {
//   try {
//     const response = await axios.get(`http://localhost:3005/api/transaction/${transactionId}`, {
//       responseType: 'stream'
//     });
//     let data = '';
//     response.data.on('data', (chunk) => {
//       data += chunk;
//     });
//     return new Promise((resolve, reject) => {
//       response.data.on('end', () => {
//         try {
//           const parsedData = JSON.parse(data);
//           resolve(parsedData);
//         } catch (error) {
//           reject(`Error parsing JSON from transaction ${transactionId}: ${error.message}`);
//         }
//       });
//       response.data.on('error', (error) => {
//         reject(`Error while receiving chunked data for transaction ${transactionId}: ${error.message}`);
//       });
//     });
//   } catch (error) {
//     console.warn(`Error retrieving transaction ${transactionId}:`, error.message);
//     return null;
//   }
// };

// module.exports = {
//   getIrysArweave,
//   signMessage,
//   getTransactionData,
//   arweave
// };