const assert = require('assert');
const sinon = require('sinon');
const publisherManager = require('../helpers/publisher-manager');

describe('Publisher Manager Tests', function() {
    this.timeout(15000);

    let sandbox;

    beforeEach(() => {
        sandbox = sinon.createSandbox();
    });

    afterEach(() => {
        sandbox.restore();
    });

    describe('publish method', () => {
        
        it('should publish to Arweave via Turbo by default', async () => {
            // Mock the turbo upload method
            const mockUpload = sandbox.stub().resolves({
                id: 'test-tx-id',
                target: 'test-address',
                anchor: 'test-anchor'
            });

            // Mock TurboFactory.init
            const mockTurbo = { upload: mockUpload };
            sandbox.stub(publisherManager, 'getTurbo').resolves(mockTurbo);

            const testData = Buffer.from('test content');
            const options = {
                blockchain: 'arweave',
                tags: [
                    { name: 'Content-Type', value: 'application/json' },
                    { name: 'App-Name', value: 'OIPArweave' }
                ]
            };

            const result = await publisherManager.publish(testData, options);

            assert.equal(result.id, 'test-tx-id');
            assert.equal(result.blockchain, 'arweave');
            assert.equal(result.provider, 'turbo');
            assert(mockUpload.calledOnce);
        });

        it('should publish to Irys when specified', async () => {
            // Mock Irys client
            const mockUpload = sandbox.stub().resolves({
                id: 'irys-tx-id'
            });

            const mockIrys = { upload: mockUpload };
            sandbox.stub(publisherManager, 'getIrys').resolves(mockIrys);

            const testData = Buffer.from('test content');
            const options = {
                blockchain: 'irys',
                tags: [
                    { name: 'Content-Type', value: 'application/json' }
                ]
            };

            const result = await publisherManager.publish(testData, options);

            assert.equal(result.id, 'irys-tx-id');
            assert.equal(result.blockchain, 'irys');
            assert.equal(result.provider, 'irys');
            assert(mockUpload.calledOnce);
        });

        it('should handle publishing errors gracefully', async () => {
            // Mock failed upload
            sandbox.stub(publisherManager, 'getTurbo').rejects(new Error('Network error'));

            const testData = Buffer.from('test content');
            const options = {
                blockchain: 'arweave',
                tags: []
            };

            try {
                await publisherManager.publish(testData, options);
                assert.fail('Should have thrown an error');
            } catch (error) {
                assert(error.message.includes('Network error'));
            }
        });

        it('should validate required parameters', async () => {
            try {
                await publisherManager.publish(null, {});
                assert.fail('Should have thrown validation error');
            } catch (error) {
                assert(error.message.includes('data') || error.message.includes('required'));
            }
        });

        it('should format tags correctly for different providers', async () => {
            const mockUpload = sandbox.stub().resolves({ id: 'test-id' });
            const mockTurbo = { upload: mockUpload };
            sandbox.stub(publisherManager, 'getTurbo').resolves(mockTurbo);

            const testData = Buffer.from('test content');
            const options = {
                blockchain: 'arweave',
                tags: [
                    { name: 'Content-Type', value: 'application/json' },
                    { name: 'Custom-Tag', value: 'custom-value' }
                ]
            };

            await publisherManager.publish(testData, options);

            // Verify upload was called with correct parameters
            assert(mockUpload.calledOnce);
            const uploadArgs = mockUpload.getCall(0).args;
            assert(uploadArgs[0] instanceof Buffer);
            assert(Array.isArray(uploadArgs[1].tags));
        });
    });

    describe('configuration validation', () => {
        
        it('should validate blockchain parameter', async () => {
            const testData = Buffer.from('test');
            
            try {
                await publisherManager.publish(testData, {
                    blockchain: 'invalid-blockchain'
                });
                assert.fail('Should reject invalid blockchain');
            } catch (error) {
                assert(error.message.includes('blockchain') || error.message.includes('invalid'));
            }
        });

        it('should use default blockchain if none specified', async () => {
            const mockUpload = sandbox.stub().resolves({ id: 'test-id' });
            const mockTurbo = { upload: mockUpload };
            sandbox.stub(publisherManager, 'getTurbo').resolves(mockTurbo);

            const testData = Buffer.from('test');
            const result = await publisherManager.publish(testData, {});

            assert.equal(result.blockchain, 'arweave'); // Default should be arweave
        });
    });
});

module.exports = {}; 