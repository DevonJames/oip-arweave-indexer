const express = require('express');
const router = express.Router();
const LitJsSdk = require('@lit-protocol/sdk-nodejs');
const { ethers } = require('ethers');
const { authenticateToken } = require('../helpers/utils');

// Datil network PKP NFT contract details - use lowercase to avoid checksum issues
const PKP_NFT_ADDRESS = "0x4ee6ecad1c2dae9f525404de8555724e3c35d07b"; // lowercase to avoid initialization errors
const PKP_NFT_ABI = [
    "function mint() public payable returns (uint256)",
    "function getPubkey(uint256 tokenId) public view returns (bytes memory)",
];

// Mint new PKP endpoint
router.post('/mint-pkp', authenticateToken, async (req, res) => {
    try {
        // Initialize Lit Node Client
        const litNodeClient = new LitJsSdk.LitNodeClient({
            litNetwork: "serrano"
        });
        await litNodeClient.connect();

        // Connect to Datil (Chronicle Yellowstone) network
        const provider = new ethers.providers.JsonRpcProvider('https://chain-rpc.litprotocol.com/http');
        
        // Get private key from environment
        const privateKey = process.env.POLYGON_PRIVATE_KEY;
        if (!privateKey) {
            throw new Error("POLYGON_PRIVATE_KEY not set in environment");
        }
        
        // Initialize wallet
        const wallet = new ethers.Wallet(privateKey, provider);
        
        // Get network info
        const network = await provider.getNetwork();
        console.log("Connected to network:", network.name, "Chain ID:", network.chainId);
        
        // Get checksummed address
        const checksummedAddress = ethers.utils.getAddress(PKP_NFT_ADDRESS);
        
        // Create transaction manually instead of using contract
        const txData = {
            to: checksummedAddress,
            value: ethers.utils.parseEther("0.01"),
            data: "0x1249c58b", // Function signature for mint()
            gasLimit: ethers.utils.hexlify(1000000), // Manual gas limit
        };
        
        console.log("Sending transaction:", txData);
        
        // Send transaction
        const tx = await wallet.sendTransaction(txData);
        console.log("Transaction sent:", tx.hash);
        
        // Wait for receipt
        const receipt = await tx.wait();
        console.log("Transaction confirmed:", receipt);
        
        // Since we're not using the contract directly, we need to parse events manually
        // This is a simplified approach - in production you'd want to decode the logs
        const tokenId = receipt.logs[0]?.topics?.[3] || "unknown";
        
        res.json({
            status: 'success',
            data: {
                transactionHash: receipt.transactionHash,
                blockNumber: receipt.blockNumber,
                tokenId: tokenId,
                // Note: To get the public key, we'd need separate call
                // with the token ID, which we may not have parsed correctly
            }
        });
    } catch (error) {
        console.error("Error minting PKP:", error);
        res.status(500).json({
            status: 'error',
            message: error.message,
            details: error
        });
    }
});

// Get PKP details endpoint
router.get('/pkp/:tokenId', authenticateToken, async (req, res) => {
    try {
        const { tokenId } = req.params;
        
        // Initialize Lit Node Client
        const litNodeClient = new LitJsSdk.LitNodeClient({
            litNetwork: "serrano"
        });
        await litNodeClient.connect();

        // Connect to Datil (Chronicle Yellowstone) network
        const provider = new ethers.providers.JsonRpcProvider('https://chain-rpc.litprotocol.com/http');
        
        // Get proper checksummed address (safely inside try/catch)
        const checksummedAddress = ethers.utils.getAddress(PKP_NFT_ADDRESS);
        
        // Get PKP contract (read-only, no private key needed)
        const pkpContract = new ethers.Contract(
            checksummedAddress,
            PKP_NFT_ABI,
            provider
        );
        
        // Get PKP public key
        const pubKey = await pkpContract.getPubkey(tokenId);
        
        res.json({
            status: 'success',
            data: {
                tokenId,
                publicKey: pubKey
            }
        });
    } catch (error) {
        console.error("Error getting PKP details:", error);
        res.status(500).json({
            status: 'error',
            message: error.message,
            details: error
        });
    }
});

module.exports = router; 