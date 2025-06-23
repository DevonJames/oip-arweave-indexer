const { getTurboArweave } = require('./utils');
const arweaveWallet = require('./arweave-wallet');

class PublisherManager {
    constructor() {
        this.publishers = {
            arweave: 'turbo',
            irys: 'irys'
        };
    }

    /**
     * Publish data to the specified blockchain
     * @param {string|Buffer} data - The data to publish
     * @param {Object} options - Publishing options
     * @param {string} options.blockchain - Either 'arweave' or 'irys'
     * @param {Array} options.tags - Array of tags for the transaction
     * @param {boolean} options.waitForConfirmation - Whether to wait for confirmation
     * @returns {Promise<Object>} - The publishing result with transaction ID
     */
    async publish(data, options = {}) {
        const {
            blockchain = 'arweave', // Default to Arweave
            tags = [],
            waitForConfirmation = true
        } = options;

        console.log(`Publishing to ${blockchain} using ${this.publishers[blockchain]} provider`);

        try {
            if (blockchain === 'arweave') {
                return await this.publishToArweave(data, tags, waitForConfirmation);
            } else if (blockchain === 'irys') {
                return await this.publishToIrys(data, tags);
            } else {
                throw new Error(`Unsupported blockchain: ${blockchain}. Use 'arweave' or 'irys'`);
            }
        } catch (error) {
            console.error(`Error publishing to ${blockchain}:`, error);
            throw error;
        }
    }

    /**
     * Publish to Arweave using Turbo via arweaveWallet wrapper
     */
    async publishToArweave(data, tags, waitForConfirmation) {
        console.log('Publishing to Arweave via Turbo...');
        
        try {
            const result = await arweaveWallet.uploadWithConfirmation(
                data,
                { tags },
                waitForConfirmation
            );
            
            return {
                id: result.id,
                blockchain: 'arweave',
                provider: 'turbo',
                url: `https://arweave.net/${result.id}`
            };
        } catch (error) {
            console.error('Error in Turbo upload:', error);
            console.error('Error details:', error.message);
            throw error;
        }
    }

    /**
     * Publish to Irys network
     */
    async publishToIrys(data, tags) {
        console.log('Publishing to Irys network...');
        const turbo = await getTurboArweave();
        
        // Ensure data is a buffer
        const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
        
        // Convert tags to Irys format
        const irysTagsObject = {};
        tags.forEach(tag => {
            irysTagsObject[tag.name] = tag.value;
        });

        const receipt = await turbo.upload({
            data: dataBuffer,
            dataItemOpts: {
                tags: irysTagsObject
            }
        });

        return {
            id: receipt.id,
            blockchain: 'irys',
            provider: 'irys',
            url: `https://gateway.irys.xyz/${receipt.id}`
        };
    }

    /**
     * Get the balance for the specified blockchain
     */
    async getBalance(blockchain) {
        if (blockchain === 'arweave') {
            const turbo = await getTurboArweave();
            const balance = await turbo.getBalance();
            return {
                raw: balance.winc,
                formatted: balance.winc / 1000000000000 // Convert Winston to AR
            };
        } else if (blockchain === 'irys') {
            const turbo = await getTurboArweave();
            const balance = await turbo.getBalance();
            return {
                raw: balance.winc,
                formatted: balance.winc / 1000000000000
            };
        }
        throw new Error(`Unsupported blockchain: ${blockchain}`);
    }

    /**
     * Fund the wallet for the specified blockchain
     */
    async fundWallet(blockchain, amount) {
        if (blockchain === 'arweave') {
            const turbo = await getTurboArweave();
            const atomicAmount = Math.floor(amount * 1000000000000); // Convert AR to Winston
            return await turbo.topUpWithTokens({ tokenAmount: atomicAmount });
        } else if (blockchain === 'irys') {
            const turbo = await getTurboArweave();
            const atomicAmount = Math.floor(amount * 1000000000000);
            return await turbo.topUpWithTokens({ tokenAmount: atomicAmount });
        }
        throw new Error(`Unsupported blockchain: ${blockchain}`);
    }

    /**
     * Get price estimate for data size
     */
    async getPrice(blockchain, size) {
        if (blockchain === 'arweave') {
            const turbo = await getTurboArweave();
            const costs = await turbo.getUploadCosts({ bytes: [size] });
            return costs[0].winc;
        } else if (blockchain === 'irys') {
            const turbo = await getTurboArweave();
            const costs = await turbo.getUploadCosts({ bytes: [size] });
            return costs[0].winc;
        }
        throw new Error(`Unsupported blockchain: ${blockchain}`);
    }
}

module.exports = new PublisherManager(); 