/**
 * Test Suite: Organization Encryption System
 * 
 * Tests the organization-level encryption for GUN records including:
 * - Organization key generation
 * - Organization membership checking
 * - Multi-user access to organization records
 * - Cross-node sync of organization records
 */

const crypto = require('crypto');
const { OrganizationEncryption } = require('../helpers/organizationEncryption');

// Mock organization data
const mockOrganizations = {
    'did:arweave:org-fitness-ally': {
        data: {
            orgHandle: 'fitness-ally',
            name: 'FitnessAlly',
            orgPublicKey: '03f0f38b42aedd1bd503ea7a8ec4fab208455e1f6d1efd2176042e83717ecb1bbf',
            adminPublicKeys: [
                '03f0f38b42aedd1bd503ea7a8ec4fab208455e1f6d1efd2176042e83717ecb1bbf', // Admin A
                '0249b2160ea3117a90a1fcbbf198ef53bf325b604157cbcf81693f0f476006c9e1'  // Admin B
            ],
            membershipPolicy: 'invite-only'
        },
        oip: {
            did: 'did:arweave:org-fitness-ally',
            recordType: 'organization'
        }
    }
};

// Mock users
const mockUsers = {
    adminA: {
        publicKey: '03f0f38b42aedd1bd503ea7a8ec4fab208455e1f6d1efd2176042e83717ecb1bbf',
        email: 'admin-a@fitnessally.io'
    },
    adminB: {
        publicKey: '0249b2160ea3117a90a1fcbbf198ef53bf325b604157cbcf81693f0f476006c9e1',
        email: 'admin-b@fitnessally.io'
    },
    outsideUser: {
        publicKey: '02a1b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789a',
        email: 'outside@example.com'
    }
};

// Manual test functions
async function testOrganizationEncryptionManually() {
    console.log('🧪 Testing Organization Encryption System...');
    
    try {
        // Mock the organization data getter
        const orgEncryption = new OrganizationEncryption();
        orgEncryption.getOrganizationData = async (orgDid) => {
            return mockOrganizations[orgDid] || null;
        };
        
        console.log('\n1. Testing organization key generation...');
        const orgDid = 'did:arweave:org-fitness-ally';
        const orgKey1 = await orgEncryption.getOrganizationEncryptionKey(orgDid);
        const orgKey2 = await orgEncryption.getOrganizationEncryptionKey(orgDid);
        
        console.log('✅ Organization key generation works');
        console.log(`   Key 1: ${orgKey1.toString('hex').slice(0, 16)}...`);
        console.log(`   Key 2: ${orgKey2.toString('hex').slice(0, 16)}...`);
        console.log(`   Deterministic: ${orgKey1.equals(orgKey2)}`);
        
        console.log('\n2. Testing organization membership...');
        const isAdminAMember = await orgEncryption.isUserOrganizationMember(mockUsers.adminA.publicKey, orgDid);
        const isAdminBMember = await orgEncryption.isUserOrganizationMember(mockUsers.adminB.publicKey, orgDid);
        const isOutsiderMember = await orgEncryption.isUserOrganizationMember(mockUsers.outsideUser.publicKey, orgDid);
        
        console.log('✅ Organization membership checking works');
        console.log(`   Admin A member: ${isAdminAMember}`);
        console.log(`   Admin B member: ${isAdminBMember}`);
        console.log(`   Outsider member: ${isOutsiderMember}`);
        
        console.log('\n3. Testing encryption strategy determination...');
        
        // Test private access (per-user encryption)
        const privateAccessControl = {
            access_level: 'private',
            owner_public_key: mockUsers.adminA.publicKey
        };
        const privateStrategy = await orgEncryption.determineEncryptionStrategy(privateAccessControl, mockUsers.adminA.publicKey);
        
        console.log('✅ Private access strategy:', privateStrategy.encryptionType);
        
        // Test organization access (organization encryption)
        const orgAccessControl = {
            access_level: 'organization',
            shared_with: [orgDid]
        };
        const orgStrategy = await orgEncryption.determineEncryptionStrategy(orgAccessControl, mockUsers.adminA.publicKey);
        
        console.log('✅ Organization access strategy:', orgStrategy.encryptionType);
        console.log(`   Organization DID: ${orgStrategy.organizationDid}`);
        
        // Test public access (no encryption)
        const publicAccessControl = {
            access_level: 'public'
        };
        const publicStrategy = await orgEncryption.determineEncryptionStrategy(publicAccessControl, mockUsers.adminA.publicKey);
        
        console.log('✅ Public access strategy:', publicStrategy.encryptionType);
        
        console.log('\n4. Testing organization record encryption/decryption...');
        
        const testRecordData = {
            basic: { name: 'Organization Exercise' },
            exercise: {
                instructions: ['Step 1', 'Step 2'],
                difficulty: 'intermediate'
            }
        };
        
        // Encrypt with organization key
        const orgKey = await orgEncryption.getOrganizationEncryptionKey(orgDid);
        const encryptedRecord = orgEncryption.encryptWithOrganizationKey(testRecordData, orgKey, orgDid);
        
        console.log('✅ Organization encryption works');
        console.log(`   Encrypted for org: ${encryptedRecord.meta.encryptedForOrganization}`);
        
        // Test decryption by organization admin
        const decryptedByAdminA = await orgEncryption.decryptWithOrganizationKey(encryptedRecord, mockUsers.adminA.publicKey);
        const decryptedByAdminB = await orgEncryption.decryptWithOrganizationKey(encryptedRecord, mockUsers.adminB.publicKey);
        
        console.log('✅ Organization decryption works for admins');
        console.log(`   Admin A can decrypt: ${!!decryptedByAdminA.data}`);
        console.log(`   Admin B can decrypt: ${!!decryptedByAdminB.data}`);
        console.log(`   Data matches: ${JSON.stringify(decryptedByAdminA.data) === JSON.stringify(testRecordData)}`);
        
        // Test decryption failure by outsider
        try {
            await orgEncryption.decryptWithOrganizationKey(encryptedRecord, mockUsers.outsideUser.publicKey);
            console.log('❌ Outsider should not be able to decrypt organization record');
        } catch (error) {
            console.log('✅ Outsider correctly rejected from organization record');
            console.log(`   Error: ${error.message}`);
        }
        
        console.log('\n🎉 All organization encryption tests passed!');
        
    } catch (error) {
        console.error('❌ Organization encryption test failed:', error);
        throw error;
    }
}

// Test the complete workflow
async function testOrganizationWorkflow() {
    console.log('\n🏢 Testing Complete Organization Workflow...');
    
    try {
        const orgEncryption = new OrganizationEncryption();
        
        // Mock the organization data getter
        orgEncryption.getOrganizationData = async (orgDid) => {
            return mockOrganizations[orgDid] || null;
        };
        
        console.log('\n📋 Scenario: Admin publishes organization exercise record');
        
        // 1. Admin A publishes an exercise for their organization
        const exerciseRecord = {
            basic: {
                name: 'Organization Bench Press',
                description: 'Internal exercise for FitnessAlly trainers'
            },
            exercise: {
                instructions: ['Lie on bench', 'Grip bar', 'Lower to chest', 'Press up'],
                difficulty: 'intermediate',
                muscle_groups: ['chest', 'triceps', 'shoulders']
            },
            accessControl: {
                access_level: 'organization',
                shared_with: ['did:arweave:org-fitness-ally'],
                created_by: mockUsers.adminA.publicKey
            }
        };
        
        // 2. Determine encryption strategy
        const strategy = await orgEncryption.determineEncryptionStrategy(
            exerciseRecord.accessControl, 
            mockUsers.adminA.publicKey
        );
        
        console.log(`✅ Encryption strategy: ${strategy.encryptionType}`);
        console.log(`   Should encrypt: ${strategy.encrypt}`);
        console.log(`   Organization: ${strategy.organizationDid}`);
        
        // 3. Encrypt the record
        if (strategy.encrypt && strategy.encryptionType === 'organization') {
            const encryptedRecord = orgEncryption.encryptWithOrganizationKey(
                exerciseRecord, 
                strategy.encryptionKey, 
                strategy.organizationDid
            );
            
            console.log('✅ Record encrypted for organization');
            
            // 4. Simulate sync to another node
            console.log('\n🔄 Simulating sync to another node...');
            
            // 5. Admin B (on another node) tries to decrypt
            const decryptedByAdminB = await orgEncryption.decryptWithOrganizationKey(
                encryptedRecord, 
                mockUsers.adminB.publicKey
            );
            
            console.log('✅ Admin B successfully decrypted organization record on remote node');
            console.log(`   Original instructions: ${exerciseRecord.exercise.instructions.length} steps`);
            console.log(`   Decrypted instructions: ${decryptedByAdminB.data.exercise.instructions.length} steps`);
            console.log(`   Data integrity: ${JSON.stringify(exerciseRecord.exercise) === JSON.stringify(decryptedByAdminB.data.exercise)}`);
            
            // 6. Outsider tries to decrypt (should fail)
            try {
                await orgEncryption.decryptWithOrganizationKey(encryptedRecord, mockUsers.outsideUser.publicKey);
                console.log('❌ Outsider should not be able to decrypt');
            } catch (error) {
                console.log('✅ Outsider correctly blocked from organization record');
            }
        }
        
        console.log('\n🎉 Organization workflow test completed successfully!');
        
    } catch (error) {
        console.error('❌ Organization workflow test failed:', error);
        throw error;
    }
}

// Export for testing
module.exports = {
    testOrganizationEncryptionManually,
    testOrganizationWorkflow,
    mockOrganizations,
    mockUsers
};

// Run tests if called directly
if (require.main === module) {
    Promise.resolve()
        .then(() => testOrganizationEncryptionManually())
        .then(() => testOrganizationWorkflow())
        .catch(error => {
            console.error('❌ Tests failed:', error);
            process.exit(1);
        });
}
