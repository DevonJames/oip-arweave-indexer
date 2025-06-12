const assert = require('assert');
const sinon = require('sinon');

// Import modules to test
const mediaManager = require('../helpers/media-manager');
const publisherManager = require('../helpers/publisher-manager');

describe('Template System Integration Tests', function() {
    this.timeout(30000);

    let sandbox;

    beforeEach(() => {
        sandbox = sinon.createSandbox();
    });

    afterEach(() => {
        sandbox.restore();
    });

    describe('Template-Compatible Media Publishing', () => {
        
        it('should create template-compatible record structure for video', async () => {
            // Mock successful publishing
            const publishStub = sandbox.stub(publisherManager, 'publish');
            publishStub.resolves({ 
                id: 'video123', 
                blockchain: 'arweave', 
                provider: 'turbo',
                url: 'https://arweave.net/video123'
            });

            // Test data
            const mediaConfig = {
                source: 'base64',
                data: Buffer.from('fake video data').toString('base64'),
                contentType: 'video/mp4',
                publishTo: {
                    arweave: true,
                    ipfs: false,
                    bittorrent: false // Disable for test speed
                }
            };

            const result = await mediaManager.processMedia(mediaConfig);

            // Verify template-compatible structure
            assert(result.arweaveAddress, 'Should have arweaveAddress field');
            assert.equal(result.arweaveAddress, 'https://arweave.net/video123');
            
            // Should NOT have storageNetworks (old format)
            assert(!result.storageNetworks, 'Should not have storageNetworks array');
            
            console.log('✅ Template-compatible video structure:', result);
        });

        it('should populate video record with correct template fields', async () => {
            // Mock media processing result
            const mediaAddresses = {
                arweaveAddress: 'https://arweave.net/video123',
                bittorrentAddress: 'magnet:?xt=urn:btih:abcd1234',
                originalUrl: 'https://youtube.com/watch?v=test'
            };

            // Start with basic video record
            const videoRecord = {
                basic: {
                    name: 'Test Video',
                    description: 'A test video'
                },
                video: {
                    webUrl: 'https://youtube.com/watch?v=test',
                    contentType: 'video/mp4'
                }
            };

            // Update with media addresses
            const updatedRecord = mediaManager.updateRecordWithMediaAddresses(
                videoRecord,
                mediaAddresses,
                'video'
            );

            // Verify correct template fields are populated
            assert.equal(updatedRecord.video.arweaveAddress, 'https://arweave.net/video123');
            assert.equal(updatedRecord.video.bittorrentAddress, 'magnet:?xt=urn:btih:abcd1234');
            assert.equal(updatedRecord.video.webUrl, 'https://youtube.com/watch?v=test'); // Preserved
            assert.equal(updatedRecord.video.originalUrl, 'https://youtube.com/watch?v=test');
            
            // Should NOT have storageNetworks
            assert(!updatedRecord.video.storageNetworks, 'Should not have storageNetworks');
            
            console.log('✅ Video record with template fields:', updatedRecord.video);
        });

        it('should work with nested image structure like post.featuredImage', async () => {
            const mediaAddresses = {
                arweaveAddress: 'https://arweave.net/image456',
                ipfsAddress: 'https://ipfs.io/ipfs/QmTest123',
                originalUrl: 'https://example.com/image.jpg'
            };

            // Post record with nested image structure (like your examples)
            const postRecord = {
                basic: {
                    name: 'Test Post'
                },
                post: {
                    featuredImage: {
                        associatedUrlOnWeb: {
                            url: 'https://example.com/image.jpg'
                        }
                    }
                }
            };

            // Update the nested image field
            const updatedRecord = mediaManager.updateRecordWithMediaAddresses(
                postRecord,
                mediaAddresses,
                'post.featuredImage'
            );

            // Verify nested template fields
            assert.equal(updatedRecord.post.featuredImage.arweaveAddress, 'https://arweave.net/image456');
            assert.equal(updatedRecord.post.featuredImage.ipfsAddress, 'https://ipfs.io/ipfs/QmTest123');
            
            // Should preserve existing URL structure
            assert.equal(updatedRecord.post.featuredImage.associatedUrlOnWeb.url, 'https://example.com/image.jpg');
            
            console.log('✅ Nested image structure:', updatedRecord.post.featuredImage);
        });

        it('should demonstrate the protobuf-like compression benefit', () => {
            // This shows how your template system compresses JSON for blockchain storage
            
            // Input JSON (what user sends)
            const inputJSON = {
                video: {
                    webUrl: 'https://youtube.com/watch?v=test',
                    arweaveAddress: 'https://arweave.net/video123',
                    ipfsAddress: 'https://ipfs.io/ipfs/QmTest456',
                    bittorrentAddress: 'magnet:?xt=urn:btih:abcd1234',
                    contentType: 'video/mp4',
                    size: 1048576,
                    width: 1920,
                    height: 1080,
                    duration: 300
                }
            };

            // Template compression (what gets stored on blockchain)
            // Based on your video template: webUrl=index_0, arweaveAddress=index_1, etc.
            const compressedOIP = {
                "0": "https://youtube.com/watch?v=test",      // webUrl
                "1": "https://arweave.net/video123",         // arweaveAddress  
                "2": "https://ipfs.io/ipfs/QmTest456",       // ipfsAddress
                "3": "magnet:?xt=urn:btih:abcd1234",         // bittorrentAddress
                "9": "video/mp4",                            // contentType
                "5": 1048576,                                // size
                "6": 1920,                                   // width
                "7": 1080,                                   // height
                "8": 300,                                    // duration
                "t": "videoTemplateId"                       // template reference
            };

            // Calculate compression ratio
            const originalSize = JSON.stringify(inputJSON).length;
            const compressedSize = JSON.stringify(compressedOIP).length;
            const compressionRatio = (originalSize / compressedSize).toFixed(2);
            
            console.log(`📊 Compression: ${originalSize} → ${compressedSize} bytes (${compressionRatio}x smaller)`);
            console.log('✅ Template compression demonstration complete');
            
            assert(compressedSize < originalSize, 'Compressed version should be smaller');
        });
    });
});

module.exports = {}; 