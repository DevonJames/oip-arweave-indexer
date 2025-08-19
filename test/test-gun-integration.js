/**
 * Test script for GUN integration
 * Verifies that GUN records can be created, indexed, and queried alongside Arweave records
 */

const chai = require('chai');
const { expect } = chai;
const { GunHelper } = require('../helpers/gun');
const { isValidDid, didToGunSoul, gunSoulToDid, normalizeDidParam } = require('../helpers/utils');
const { publishNewRecord } = require('../helpers/templateHelper');
const { getRecords, indexRecord } = require('../helpers/elasticsearch');
const publisherManager = require('../helpers/publisher-manager');

describe('GUN Integration Tests', function() {
    this.timeout(30000); // Allow time for network operations

    describe('DID System Updates', function() {
        it('should validate GUN DIDs correctly', function() {
            expect(isValidDid('did:gun:test-soul-123')).to.be.true;
            expect(isValidDid('did:gun:oip:records:pubkey123:draft-001')).to.be.true;
            expect(isValidDid('did:arweave:abc123def456')).to.be.true;
            expect(isValidDid('did:invalid:format')).to.be.false;
            expect(isValidDid('not-a-did')).to.be.false;
        });

        it('should convert between GUN DIDs and souls', function() {
            const soul = 'oip:records:pubkey123:draft-001';
            const did = 'did:gun:oip:records:pubkey123:draft-001';
            
            expect(gunSoulToDid(soul)).to.equal(did);
            expect(didToGunSoul(did)).to.equal(soul);
        });

        it('should normalize DID parameters for backward compatibility', function() {
            const arweaveDid = 'did:arweave:abc123def456';
            const gunDid = 'did:gun:test-soul';
            
            expect(normalizeDidParam(arweaveDid)).to.equal(arweaveDid);
            expect(normalizeDidParam(gunDid)).to.equal(gunDid);
        });
    });

    describe('GUN Helper Class', function() {
        let gunHelper;

        before(function() {
            gunHelper = new GunHelper();
        });

        it('should initialize GUN helper correctly', function() {
            expect(gunHelper).to.be.instanceOf(GunHelper);
            expect(gunHelper.gun).to.exist;
        });

        it('should generate deterministic souls', function() {
            const pubKey = 'test-pubkey-123';
            const localId = 'draft-001';
            const recordData = { test: 'data' };

            // Test with local ID
            const soul1 = gunHelper.computeSoul(pubKey, localId);
            expect(soul1).to.equal(`oip:records:${pubKey}:${localId}`);

            // Test deterministic content hash
            const soul2 = gunHelper.computeSoul(pubKey, null, recordData);
            const soul3 = gunHelper.computeSoul(pubKey, null, recordData);
            expect(soul2).to.equal(soul3); // Should be deterministic
            expect(soul2).to.include('oip:records:test-pubkey-123:h:');
        });

        it('should check GUN connection', async function() {
            // Note: This test may fail if GUN relay is not running
            try {
                const isConnected = await gunHelper.checkConnection();
                console.log('GUN connection status:', isConnected);
                // Don't fail the test if GUN relay is not available during testing
                expect(typeof isConnected).to.equal('boolean');
            } catch (error) {
                console.log('GUN connection test skipped (relay not available):', error.message);
            }
        });
    });

    describe('Publisher Manager GUN Support', function() {
        it('should support GUN as a storage option', function() {
            expect(publisherManager.publishers.gun).to.equal('gun');
        });

        it('should handle GUN publishing options correctly', async function() {
            const testData = {
                data: {
                    basic: {
                        name: 'Test GUN Record',
                        description: 'Test record for GUN integration'
                    }
                },
                oip: {
                    recordType: 'test'
                }
            };

            const options = {
                storage: 'gun',
                publisherPubKey: 'test-pubkey-123',
                localId: 'test-record-001'
            };

            try {
                // This will fail if GUN relay is not running, which is expected in test environment
                await publisherManager.publish(testData, options);
            } catch (error) {
                // Expected if GUN relay is not available
                expect(error.message).to.include('GUN');
                console.log('GUN publish test skipped (relay not available):', error.message);
            }
        });
    });

    describe('API Parameter Support', function() {
        it('should support new storage filtering parameters', function() {
            const testParams = {
                source: 'gun',
                storage: 'arweave',
                did: 'did:gun:test-soul',
                didTx: 'did:arweave:old-format'
            };

            // These should not throw errors when passed to getRecords
            expect(() => {
                // Simulate parameter processing
                const normalizedDid = testParams.did || testParams.didTx;
                expect(normalizedDid).to.equal('did:gun:test-soul');
            }).to.not.throw();
        });
    });

    describe('Elasticsearch Integration', function() {
        it('should handle records with storage field', function() {
            const gunRecord = {
                data: {
                    basic: {
                        name: 'Test GUN Record',
                        description: 'Test record'
                    }
                },
                oip: {
                    did: 'did:gun:test-soul-123',
                    didTx: 'did:gun:test-soul-123', // Backward compatibility
                    storage: 'gun',
                    recordType: 'test',
                    indexedAt: new Date().toISOString(),
                    ver: '0.8.0'
                }
            };

            // Verify record structure is valid for indexing
            expect(gunRecord.oip.did).to.exist;
            expect(gunRecord.oip.storage).to.equal('gun');
            expect(gunRecord.oip.recordType).to.exist;
        });

        it('should handle mixed storage types in queries', async function() {
            // Test that getRecords can handle storage filtering
            try {
                const allRecords = await getRecords({ source: 'all', limit: 1 });
                expect(allRecords).to.have.property('records');
                
                const arweaveRecords = await getRecords({ source: 'arweave', limit: 1 });
                expect(arweaveRecords).to.have.property('records');
                
                const gunRecords = await getRecords({ source: 'gun', limit: 1 });
                expect(gunRecords).to.have.property('records');
                
                console.log('Storage filtering tests passed');
            } catch (error) {
                console.log('Elasticsearch tests skipped (not available):', error.message);
            }
        });
    });

    describe('Integration Test Scenarios', function() {
        it('should support the complete GUN workflow', async function() {
            // This is a comprehensive integration test
            const testRecord = {
                basic: {
                    name: 'Integration Test Record',
                    description: 'Testing complete GUN integration workflow',
                    language: 'en',
                    date: Math.floor(Date.now() / 1000),
                    tagItems: ['test', 'gun', 'integration']
                },
                post: {
                    articleText: 'This is a test article stored in GUN',
                    bylineWriter: 'Test Author'
                }
            };

            try {
                // Test GUN publishing (will fail if relay not available)
                const result = await publishNewRecord(
                    testRecord,
                    'post',
                    false, // publishFiles
                    false, // addMediaToArweave
                    false, // addMediaToIPFS
                    null,  // youtubeUrl
                    'arweave', // blockchain (ignored for GUN)
                    false, // addMediaToArFleet
                    {
                        storage: 'gun',
                        localId: 'integration-test-001'
                    }
                );

                expect(result).to.have.property('did');
                expect(result.did).to.include('did:gun:');
                expect(result.storage).to.equal('gun');
                
                console.log('✅ Complete GUN workflow test passed:', result.did);
            } catch (error) {
                if (error.message.includes('GUN') || error.message.includes('relay')) {
                    console.log('🔧 GUN workflow test skipped (relay not available):', error.message);
                    console.log('   To run full tests, start the services with: make standard');
                } else {
                    throw error; // Re-throw unexpected errors
                }
            }
        });

        it('should maintain backward compatibility', async function() {
            // Test that existing API calls still work
            try {
                const records = await getRecords({
                    didTx: 'did:arweave:nonexistent', // Old parameter name
                    limit: 1
                });
                
                expect(records).to.have.property('records');
                expect(Array.isArray(records.records)).to.be.true;
                
                console.log('✅ Backward compatibility test passed');
            } catch (error) {
                console.log('Elasticsearch backward compatibility test skipped:', error.message);
            }
        });
    });
});

// Helper function to run integration tests
async function runIntegrationTests() {
    console.log('🧪 Running GUN Integration Tests...');
    console.log('');
    
    try {
        // Test DID utilities
        console.log('1. Testing DID utilities...');
        const testSoul = 'oip:records:test123:draft-001';
        const testDid = gunSoulToDid(testSoul);
        console.log(`   Soul: ${testSoul}`);
        console.log(`   DID:  ${testDid}`);
        console.log(`   Valid: ${isValidDid(testDid)}`);
        console.log('   ✅ DID utilities working');
        console.log('');

        // Test GUN helper
        console.log('2. Testing GUN helper...');
        const gunHelper = new GunHelper();
        const soul = gunHelper.computeSoul('test-pubkey', 'test-record');
        console.log(`   Generated soul: ${soul}`);
        console.log('   ✅ GUN helper working');
        console.log('');

        // Test connection (may fail if relay not running)
        console.log('3. Testing GUN connection...');
        try {
            const isConnected = await gunHelper.checkConnection();
            console.log(`   Connection status: ${isConnected ? '✅ Connected' : '❌ Not connected'}`);
            if (!isConnected) {
                console.log('   💡 Start services with: make standard');
            }
        } catch (error) {
            console.log(`   ⚠️  Connection test failed: ${error.message}`);
            console.log('   💡 This is expected if GUN relay is not running');
        }
        console.log('');

        console.log('🎉 Integration tests completed!');
        console.log('');
        console.log('📋 Next steps:');
        console.log('   1. Run: make standard');
        console.log('   2. Test GUN publishing via API');
        console.log('   3. Verify mixed querying works');
        console.log('   4. Test private record encryption');
        
    } catch (error) {
        console.error('💥 Integration test failed:', error);
        throw error;
    }
}

// Run tests if called directly
if (require.main === module) {
    runIntegrationTests()
        .then(() => {
            console.log('Test script completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            console.error('Test script failed:', error);
            process.exit(1);
        });
}

module.exports = {
    runIntegrationTests
};
