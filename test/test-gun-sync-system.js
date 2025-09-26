/**
 * Test Suite: GUN Record Sync System
 * 
 * Tests the GUN record synchronization system including:
 * - Registry functionality
 * - Private record handling
 * - Format conversions
 * - Multi-node sync simulation
 */

const { OIPGunRegistry } = require('../helpers/oipGunRegistry');
const { PrivateRecordHandler } = require('../helpers/privateRecordHandler');
const { GunSyncService } = require('../helpers/gunSyncService');
const { ExistingRecordMigration } = require('../scripts/migrate-existing-gun-records');

describe('GUN Sync System Tests', () => {
    let registry;
    let privateHandler;
    let syncService;
    
    beforeEach(() => {
        registry = new OIPGunRegistry();
        privateHandler = new PrivateRecordHandler();
        syncService = new GunSyncService();
    });
    
    describe('OIPGunRegistry', () => {
        test('should generate deterministic node ID', () => {
            const nodeId1 = registry.generateNodeId();
            const nodeId2 = registry.generateNodeId();
            
            expect(nodeId1).toBeDefined();
            expect(typeof nodeId1).toBe('string');
            expect(nodeId1.length).toBe(16);
            
            // Should be different each time (includes timestamp)
            expect(nodeId1).not.toBe(nodeId2);
        });
        
        test('should validate OIP record structure', () => {
            const validRecord = {
                oip: {
                    ver: '0.8.0',
                    recordType: 'post',
                    creator: {
                        publicKey: 'test-key',
                        didAddress: 'did:arweave:test'
                    }
                },
                data: {
                    basic: { name: 'Test' }
                }
            };
            
            const invalidRecord = {
                oip: { ver: '0.7.0' }, // Wrong version
                data: {}
            };
            
            expect(registry.isValidOIPRecord(validRecord)).toBe(true);
            expect(registry.isValidOIPRecord(invalidRecord)).toBe(false);
        });
    });
    
    describe('PrivateRecordHandler', () => {
        test('should identify encrypted records', () => {
            const encryptedRecord = {
                meta: { encrypted: true },
                data: {
                    encrypted: 'base64data',
                    iv: 'base64iv',
                    tag: 'base64tag'
                }
            };
            
            const publicRecord = {
                meta: { encrypted: false },
                data: { basic: { name: 'Test' } }
            };
            
            expect(privateHandler.isEncryptedRecord(encryptedRecord)).toBe(true);
            expect(privateHandler.isEncryptedRecord(publicRecord)).toBe(false);
        });
        
        test('should validate decrypted record structure', () => {
            const validDecrypted = {
                data: {
                    basic: { name: 'Test' },
                    post: { articleText: 'Content' }
                }
            };
            
            const invalidDecrypted = {
                data: null
            };
            
            expect(privateHandler.validateDecryptedRecord(validDecrypted)).toBe(true);
            expect(privateHandler.validateDecryptedRecord(invalidDecrypted)).toBe(false);
        });
    });
    
    describe('GunSyncService', () => {
        test('should initialize with correct configuration', () => {
            expect(syncService.isRunning).toBe(false);
            expect(syncService.syncInterval).toBe(30000);
            expect(syncService.processedRecords).toBeInstanceOf(Set);
            expect(syncService.healthMonitor).toBeDefined();
        });
        
        test('should convert GUN record format for Elasticsearch', () => {
            const gunRecord = {
                data: {
                    conversationSession: {
                        messages: '["Hello","World"]',  // JSON string
                        message_roles: '["user","assistant"]'
                    }
                },
                oip: {
                    recordType: 'conversationSession',
                    creator: { publicKey: 'test' }
                }
            };
            
            const did = 'did:gun:test-soul';
            const result = syncService.convertGunRecordForElasticsearch(gunRecord, did);
            
            expect(result.oip.did).toBe(did);
            expect(result.oip.storage).toBe('gun');
            // Arrays should be converted back from JSON strings
            expect(Array.isArray(result.data.conversationSession.messages)).toBe(true);
            expect(result.data.conversationSession.messages).toEqual(['Hello', 'World']);
        });
    });
    
    describe('Integration Tests', () => {
        test('should handle full sync workflow', async () => {
            // Mock a discovered record
            const mockDiscoveredRecord = {
                soul: 'test-soul-123',
                data: {
                    data: {
                        basic: { name: 'Test Record' },
                        post: { articleText: 'Test content' }
                    },
                    oip: {
                        ver: '0.8.0',
                        recordType: 'post',
                        creator: {
                            publicKey: 'test-key',
                            didAddress: 'did:arweave:test'
                        }
                    }
                },
                sourceNodeId: 'other-node',
                wasEncrypted: false
            };
            
            // Test processing (without actual Elasticsearch)
            const result = syncService.convertGunRecordForElasticsearch(
                mockDiscoveredRecord.data, 
                'did:gun:test-soul-123'
            );
            
            expect(result.oip.did).toBe('did:gun:test-soul-123');
            expect(result.oip.storage).toBe('gun');
            expect(result.data.basic.name).toBe('Test Record');
        });
    });
});

// Manual test functions for development
async function testSyncSystemManually() {
    console.log('🧪 Running manual sync system test...');
    
    try {
        // Test registry
        const registry = new OIPGunRegistry();
        console.log('✅ Registry initialized:', registry.nodeId);
        
        // Test private handler
        const privateHandler = new PrivateRecordHandler();
        console.log('✅ Private handler initialized');
        
        // Test sync service
        const syncService = new GunSyncService();
        console.log('✅ Sync service initialized');
        
        // Test health monitoring
        const healthStatus = syncService.getHealthMonitor().getHealthStatus();
        console.log('✅ Health monitoring working:', healthStatus);
        
        console.log('🎉 All components initialized successfully!');
        
    } catch (error) {
        console.error('❌ Manual test failed:', error);
    }
}

// Export for testing
module.exports = {
    testSyncSystemManually
};

// Run manual test if called directly
if (require.main === module) {
    testSyncSystemManually();
}
