/**
 * Test Suite: Corrected Organization Access Control Model
 * 
 * Tests the corrected understanding:
 * - Only admins can CREATE organization records
 * - Members can CONSUME (read) organization records based on membership policy
 * - Auto-Enroll App Users policy uses domain-based validation
 */

const { OrganizationEncryption } = require('../helpers/organizationEncryption');

// Mock organization with Auto-Enroll App Users policy
const fitnessAllyOrg = {
    data: {
        orgHandle: 'fitnessally1',
        name: 'FitnessAlly',
        webUrl: 'https://fitnessally.io',
        orgPublicKey: '03f0f38b42aedd1bd503ea7a8ec4fab208455e1f6d1efd2176042e83717ecb1bbf',
        adminPublicKeys: ['03f0f38b42aedd1bd503ea7a8ec4fab208455e1f6d1efd2176042e83717ecb1bbf'],
        membershipPolicy: 1 // Auto-Enroll App Users
    },
    oip: {
        did: 'did:arweave:org-fitness-ally',
        recordType: 'organization'
    }
};

// Mock users
const mockUsers = {
    admin: {
        publicKey: '03f0f38b42aedd1bd503ea7a8ec4fab208455e1f6d1efd2176042e83717ecb1bbf',
        email: 'admin@fitnessally.io',
        role: 'admin'
    },
    appUser: {
        publicKey: '0249b2160ea3117a90a1fcbbf198ef53bf325b604157cbcf81693f0f476006c9e1',
        email: 'user@fitnessally.io',
        role: 'user'
    },
    outsideUser: {
        publicKey: '02a1b2c3d4e5f6789abcdef0123456789abcdef0123456789abcdef0123456789a',
        email: 'outside@example.com',
        role: 'user'
    }
};

// Mock request scenarios
const requestScenarios = {
    fromFitnessAllyDomain: {
        origin: 'https://fitnessally.io',
        referer: 'https://fitnessally.io/dashboard',
        host: 'fitnessally.io',
        headers: {
            origin: 'https://fitnessally.io',
            referer: 'https://fitnessally.io/dashboard',
            host: 'fitnessally.io'
        }
    },
    fromSubdomain: {
        origin: 'https://app.fitnessally.io',
        referer: 'https://app.fitnessally.io/workout',
        host: 'app.fitnessally.io',
        headers: {
            origin: 'https://app.fitnessally.io',
            referer: 'https://app.fitnessally.io/workout',
            host: 'app.fitnessally.io'
        }
    },
    fromOtherDomain: {
        origin: 'https://example.com',
        referer: 'https://example.com/page',
        host: 'example.com',
        headers: {
            origin: 'https://example.com',
            referer: 'https://example.com/page',
            host: 'example.com'
        }
    },
    noHeaders: {
        headers: {}
    }
};

async function testCorrectedOrganizationModel() {
    console.log('🧪 Testing Corrected Organization Access Control Model...');
    
    const orgEncryption = new OrganizationEncryption();
    
    // Mock the organization data getter
    orgEncryption.getOrganizationData = async (orgDid) => {
        if (orgDid === 'did:arweave:org-fitness-ally') {
            return fitnessAllyOrg;
        }
        return null;
    };
    
    console.log('\\n📋 Organization Details:');
    console.log(`   Name: ${fitnessAllyOrg.data.name}`);
    console.log(`   Domain: ${new URL(fitnessAllyOrg.data.webUrl).hostname}`);
    console.log(`   Policy: Auto-Enroll App Users (${fitnessAllyOrg.data.membershipPolicy})`);
    console.log(`   Admin: ${fitnessAllyOrg.data.adminPublicKeys[0].slice(0, 12)}...`);
    
    console.log('\\n🔑 Testing Admin Access (Always Allowed):');
    
    // Test 1: Admin is always a member regardless of domain
    const adminMembershipFromOtherDomain = await orgEncryption.isUserOrganizationMember(
        mockUsers.admin.publicKey, 
        'did:arweave:org-fitness-ally', 
        requestScenarios.fromOtherDomain
    );
    
    console.log(`✅ Admin access from other domain: ${adminMembershipFromOtherDomain}`);
    
    console.log('\\n🌐 Testing Auto-Enroll App Users Policy:');
    
    // Test 2: App user from correct domain should be member
    const appUserFromCorrectDomain = await orgEncryption.isUserOrganizationMember(
        mockUsers.appUser.publicKey,
        'did:arweave:org-fitness-ally',
        requestScenarios.fromFitnessAllyDomain
    );
    
    console.log(`✅ App user from fitnessally.io: ${appUserFromCorrectDomain}`);
    
    // Test 3: App user from subdomain should be member
    const appUserFromSubdomain = await orgEncryption.isUserOrganizationMember(
        mockUsers.appUser.publicKey,
        'did:arweave:org-fitness-ally',
        requestScenarios.fromSubdomain
    );
    
    console.log(`✅ App user from app.fitnessally.io: ${appUserFromSubdomain}`);
    
    // Test 4: App user from wrong domain should NOT be member
    const appUserFromWrongDomain = await orgEncryption.isUserOrganizationMember(
        mockUsers.appUser.publicKey,
        'did:arweave:org-fitness-ally',
        requestScenarios.fromOtherDomain
    );
    
    console.log(`❌ App user from example.com: ${appUserFromWrongDomain}`);
    
    // Test 5: Outside user from correct domain should be member (Auto-Enroll)
    const outsideUserFromCorrectDomain = await orgEncryption.isUserOrganizationMember(
        mockUsers.outsideUser.publicKey,
        'did:arweave:org-fitness-ally',
        requestScenarios.fromFitnessAllyDomain
    );
    
    console.log(`✅ Outside user from fitnessally.io: ${outsideUserFromCorrectDomain}`);
    
    // Test 6: Outside user from wrong domain should NOT be member
    const outsideUserFromWrongDomain = await orgEncryption.isUserOrganizationMember(
        mockUsers.outsideUser.publicKey,
        'did:arweave:org-fitness-ally',
        requestScenarios.fromOtherDomain
    );
    
    console.log(`❌ Outside user from example.com: ${outsideUserFromWrongDomain}`);
    
    console.log('\\n🚫 Testing Edge Cases:');
    
    // Test 7: No headers/domain info should deny access
    const userWithNoHeaders = await orgEncryption.isUserOrganizationMember(
        mockUsers.appUser.publicKey,
        'did:arweave:org-fitness-ally',
        requestScenarios.noHeaders
    );
    
    console.log(`❌ User with no domain headers: ${userWithNoHeaders}`);
    
    console.log('\\n📊 Test Results Summary:');
    console.log(`   ✅ Admin always has access: ${adminMembershipFromOtherDomain}`);
    console.log(`   ✅ Correct domain grants access: ${appUserFromCorrectDomain && outsideUserFromCorrectDomain}`);
    console.log(`   ✅ Subdomains work: ${appUserFromSubdomain}`);
    console.log(`   ❌ Wrong domain blocks access: ${!appUserFromWrongDomain && !outsideUserFromWrongDomain}`);
    console.log(`   ❌ No headers blocks access: ${!userWithNoHeaders}`);
    
    const allTestsPassed = 
        adminMembershipFromOtherDomain && // Admin access
        appUserFromCorrectDomain && // Domain access
        appUserFromSubdomain && // Subdomain access
        outsideUserFromCorrectDomain && // Auto-enroll works
        !appUserFromWrongDomain && // Wrong domain blocked
        !outsideUserFromWrongDomain && // Wrong domain blocked
        !userWithNoHeaders; // No headers blocked
    
    if (allTestsPassed) {
        console.log('\\n🎉 All tests passed! Organization access control working correctly.');
    } else {
        console.log('\\n❌ Some tests failed. Check implementation.');
    }
    
    return allTestsPassed;
}

// Export for testing
module.exports = {
    testCorrectedOrganizationModel,
    fitnessAllyOrg,
    mockUsers,
    requestScenarios
};

// Run tests if called directly
if (require.main === module) {
    testCorrectedOrganizationModel()
        .then(() => {
            console.log('\\n🎉 All organization access control tests completed!');
        })
        .catch(error => {
            console.error('❌ Tests failed:', error);
            process.exit(1);
        });
}
