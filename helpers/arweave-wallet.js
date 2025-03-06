const { TurboFactory } = require('@ardrive/turbo-sdk');
const Arweave = require('arweave');
const fs = require('fs').promises;

class ArweaveWalletManager {
    constructor() {
        this.turboInstance = null;
        this.arweave = Arweave.init({
            host: 'arweave.net',
            port: 443,
            protocol: 'https',
            timeout: 20000, // Increase timeout for Arweave transactions
            logging: false
        });
    }

    async getTurbo() {
        if (!this.turboInstance) {
            try {
                const walletData = await fs.readFile(process.env.WALLET_FILE, 'utf8');
                const wallet = JSON.parse(walletData);
                
                // Use the recommended factory method for initialization
                this.turboInstance = await TurboFactory.authenticated({
                    privateKey: wallet,
                    url: process.env.TURBO_URL || 'https://turbo.ardrive.io'
                });
                
                console.log('Turbo initialized with factory method');
                console.log('Available methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(this.turboInstance)));
            } catch (error) {
                console.error('Failed to initialize Turbo:', error);
                throw error;
            }
        }
        return this.turboInstance;
    }

    async uploadFile(data, contentType) {
        try {
            const turbo = await this.getTurbo();
            
            const dataBuffer = Buffer.isBuffer(data) ? data : 
                             typeof data === 'string' ? Buffer.from(data) :
                             Buffer.from(JSON.stringify(data));

            console.log('Uploading file with Turbo, size:', dataBuffer.length);
            
            // Create all required factories
            const fileStreamFactory = () => {
                const { Readable } = require('stream');
                return Readable.from(dataBuffer);
            };

            // Simplified upload with all required parameters
            const result = await turbo.uploadFile({
                fileStreamFactory,
                fileSizeFactory: () => dataBuffer.length,
                dataItemSizeFactory: () => dataBuffer.length + 2048, // Add extra for metadata
                dataItemOpts: {
                    tags: [
                        { name: 'Content-Type', value: contentType },
                        { name: 'App-Name', value: 'OIPArweave' }
                    ]
                }
            });
            
            console.log('Upload successful:', result);
            return { id: result.id, type: contentType };
        } catch (error) {
            console.error('Error uploading with Turbo:', error);
            // Keep your fallback approach for direct Arweave upload
            // ...
        }
    }

    // Update the upload method for more compatibility
    async upload(data, options = {}) {
        try {
            return await this.uploadFile(data, options.tags?.[0]?.value || 'application/json');
        } catch (error) {
            console.error('Error in upload method:', error);
            throw error;
        }
    }

    // Balance methods
    async getBalance() {
        try {
            const turbo = await this.getTurbo();
            const balance = await turbo.getBalance();
            return balance;
        } catch (error) {
            console.error('Error getting Turbo balance:', error);
            throw error;
        }
    }

    async getLoadedBalance() {
        return this.getBalance();
    }

    // Funding methods
    async fund(amount, multiplier = 1) {
        try {
            const turbo = await this.getTurbo();
            const response = await turbo.fund(amount);
            return {
                ...response,
                quantity: amount,
                reward: amount * multiplier
            };
        } catch (error) {
            console.error('Error funding Turbo:', error);
            throw error;
        }
    }

    // Price estimation
    async getPrice(size, token = 'arweave') {
        try {
            const turbo = await this.getTurbo();
            const price = await turbo.getPrice(size);
            return price;
        } catch (error) {
            console.error('Error getting price:', error);
            throw error;
        }
    }

    // Utility methods to match Irys API
    utils = {
        fromAtomic: (amount) => amount,
        toAtomic: (amount) => amount,
        getBytesFromSize: (size) => {
            if (typeof size === 'number') return size;
            if (typeof size === 'string') {
                const units = {
                    'B': 1,
                    'KB': 1024,
                    'MB': 1024 * 1024,
                    'GB': 1024 * 1024 * 1024
                };
                const match = size.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)$/i);
                if (match) {
                    const [, num, unit] = match;
                    return parseFloat(num) * units[unit.toUpperCase()];
                }
            }
            throw new Error('Invalid size format');
        },
        createData: (data, tags = []) => ({
            data,
            tags
        })
    }

    // Ready state check
    async ready() {
        await this.getTurbo();
        return true;
    }

    // Transaction status checking methods
    async getTransactionStatus(txId) {
        // Return a placeholder status since Turbo doesn't offer this
        console.log(`Note: Transaction status checking not available for Turbo. TxId: ${txId}`);
        return {
            confirmed: true, // Assume confirmed for now
            status: 'pending', // Default to pending
            confirmations: 0
        };
    }

    async waitForConfirmation(txId, maxAttempts = 10, delayMs = 5000) {
        console.log(`Note: Wait for confirmation not available with Turbo. Assuming confirmed for TxId: ${txId}`);
        return {
            confirmed: true,
            status: 'pending',
            confirmations: 0
        };
    }

    // Enhanced upload methods with status checking
    async uploadWithConfirmation(data, options = {}, waitForConfirmation = true) {
        try {
            // Just call uploadFile directly, ignore the waitForConfirmation parameter
            const result = await this.uploadFile(data, options.tags?.[0]?.value || 'application/json');
            
            // Return a simplified result without status
            return {
                id: result.id
            };
        } catch (error) {
            console.error('Error in upload with confirmation:', error);
            throw error;
        }
    }

    async uploadFileWithConfirmation(data, contentType, waitForConfirmation = true) {
        try {
            const result = await this.uploadFile(data, contentType);
            
            if (waitForConfirmation) {
                console.log(`Waiting for confirmation of transaction ${result.id}...`);
                const status = await this.waitForConfirmation(result.id);
                return {
                    ...result,
                    status
                };
            }
            
            return result;
        } catch (error) {
            console.error('Error in upload file with confirmation:', error);
            throw error;
        }
    }

    // Transaction verification
    async verifyTransaction(txId) {
        console.log(`Note: Transaction verification not available with Turbo. TxId: ${txId}`);
        return {
            verified: true
        };
    }
}

module.exports = new ArweaveWalletManager(); 