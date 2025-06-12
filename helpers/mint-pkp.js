const LitJsSdk = require('@lit-protocol/sdk-nodejs');
const ethers = require('ethers');

async function mintNewPKP() {
    try {
        // Initialize Lit Node Client
        const litNodeClient = new LitJsSdk.LitNodeClient({
            litNetwork: "serrano"
        });
        await litNodeClient.connect();

        // Connect to Polygon network
        const provider = new ethers.providers.JsonRpcProvider('https://polygon-rpc.com');
        
        // Your Polygon wallet private key (the one with MATIC)
        const wallet = new ethers.Wallet(process.env.POLYGON_PRIVATE_KEY, provider);
        
        // Get PKP contract
        const pkpContract = new ethers.Contract(
            LitJsSdk.PKP_CONTRACT_ADDRESS,
            LitJsSdk.PKP_NFT_ABI,
            wallet
        );
        
        // Mint new PKP
        const tx = await pkpContract.mint();
        const receipt = await tx.wait();
        
        console.log("PKP minted:", receipt);
        
        // Get token ID from receipt
        const tokenId = receipt.events[0].args.tokenId;
        console.log("Token ID:", tokenId);
        
        // Get PKP public key
        const pubKey = await pkpContract.getPubkey(tokenId);
        console.log("Public Key:", pubKey);
        
        return {
            tokenId,
            pubKey,
            receipt
        };
    } catch (error) {
        console.error("Error minting PKP:", error);
        throw error;
    }
}

// Run if called directly
if (require.main === module) {
    // Make sure POLYGON_PRIVATE_KEY is set in your environment
    if (!process.env.POLYGON_PRIVATE_KEY) {
        console.error("Please set POLYGON_PRIVATE_KEY environment variable");
        process.exit(1);
    }
    
    mintNewPKP()
        .then(console.log)
        .catch(console.error);
}

module.exports = { mintNewPKP }; 