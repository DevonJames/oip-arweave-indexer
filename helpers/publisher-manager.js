const { getIrysArweave } = require('./utils');
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
     * Publish to Arweave using Turbo
     */
    async publishToArweave(data, tags, waitForConfirmation) {
        console.log('Publishing to Arweave via Turbo...');
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
    }

    /**
     * Publish to Irys network
     */
    async publishToIrys(data, tags) {
        console.log('Publishing to Irys network...');
        const irys = await getIrysArweave();
        
        // Convert data to Buffer if it's not already
        const dataBuffer = Buffer.isBuffer(data) ? data : 
                          typeof data === 'string' ? Buffer.from(data) :
                          Buffer.from(JSON.stringify(data));

        // Convert tags to Irys format
        const irysTagsObject = {};
        tags.forEach(tag => {
            irysTagsObject[tag.name] = tag.value;
        });

        const receipt = await irys.upload(dataBuffer, { tags: irysTagsObject });
        
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
    async getBalance(blockchain = 'arweave') {
        if (blockchain === 'arweave') {
            return await arweaveWallet.getBalance();
        } else if (blockchain === 'irys') {
            const irys = await getIrysArweave();
            const balance = await irys.getLoadedBalance();
            return {
                balance: balance.toString(),
                formatted: irys.utils.fromAtomic(balance)
            };
        } else {
            throw new Error(`Unsupported blockchain: ${blockchain}`);
        }
    }

    /**
     * Fund the wallet for the specified blockchain
     */
    async fund(amount, blockchain = 'arweave') {
        if (blockchain === 'arweave') {
            return await arweaveWallet.fund(amount);
        } else if (blockchain === 'irys') {
            const irys = await getIrysArweave();
            return await irys.fund(amount);
        } else {
            throw new Error(`Unsupported blockchain: ${blockchain}`);
        }
    }

    /**
     * Get price estimate for data size
     */
    async getPrice(size, blockchain = 'arweave') {
        if (blockchain === 'arweave') {
            return await arweaveWallet.getPrice(size);
        } else if (blockchain === 'irys') {
            const irys = await getIrysArweave();
            return await irys.getPrice(size);
        } else {
            throw new Error(`Unsupported blockchain: ${blockchain}`);
        }
    }
}

module.exports = new PublisherManager(); 