/**
 * DID Resolution API Endpoints
 * 
 * Provides W3C DID Document resolution and verification endpoints.
 * Part of the oip-daemon-service.
 */

const express = require('express');
const router = express.Router();
const { resolveCreator } = require('../../helpers/core/sync-verification');
const { verifyRecord, VerificationMode } = require('../../helpers/core/oip-verification');

// ═══════════════════════════════════════════════════════════════════════════
// DID RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/did/:did
 * Resolves a DID to its W3C DID Document.
 * 
 * @param {string} did - DID to resolve (URL encoded)
 * @returns {object} DID Document in W3C format
 */
router.get('/:did', async (req, res) => {
    try {
        const { did } = req.params;
        const decodedDid = decodeURIComponent(did);
        
        const creatorData = await resolveCreator(decodedDid);
        
        if (!creatorData) {
            return res.status(404).json({
                success: false,
                error: 'DID not found'
            });
        }
        
        // Format as W3C DID Document
        const didDocument = formatAsW3C(creatorData);
        
        res.json({
            success: true,
            didDocument,
            metadata: {
                isV09: creatorData.isV09,
                resolvedAt: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('[DID API] Resolution error:', error);
        res.status(500).json({
            success: false,
            error: 'DID resolution failed'
        });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// SIGNATURE VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/did/verify
 * Verifies a signed record payload.
 * 
 * @body {object} payload - Signed record payload
 * @body {number} blockHeight - Optional block height for validity check
 * @returns {object} Verification result
 */
router.post('/verify', async (req, res) => {
    try {
        const { payload, blockHeight } = req.body;
        
        if (!payload) {
            return res.status(400).json({
                success: false,
                error: 'payload is required'
            });
        }
        
        const result = await verifyRecord(
            payload,
            resolveCreator,
            blockHeight || 0
        );
        
        res.json({
            success: true,
            verification: {
                isValid: result.isValid,
                mode: result.mode,
                error: result.error,
                keyIndex: result.keyIndex,
                creatorDid: result.creatorDid,
                blockHeight: result.blockHeight
            }
        });
        
    } catch (error) {
        console.error('[DID API] Verification error:', error);
        res.status(500).json({
            success: false,
            error: 'Verification failed'
        });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICATION METHODS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/did/:did/verification-methods
 * Gets all verification methods for a DID.
 * 
 * @param {string} did - DID to lookup
 * @returns {object} List of verification methods
 */
router.get('/:did/verification-methods', async (req, res) => {
    try {
        const { did } = req.params;
        const decodedDid = decodeURIComponent(did);
        
        const creatorData = await resolveCreator(decodedDid);
        
        if (!creatorData) {
            return res.status(404).json({
                success: false,
                error: 'DID not found'
            });
        }
        
        const verificationMethods = creatorData.verificationMethods || [];
        
        res.json({
            success: true,
            did: decodedDid,
            isV09: creatorData.isV09,
            verificationMethods: verificationMethods.map(vm => ({
                vmId: vm.vmId,
                vmType: vm.vmType,
                xpub: vm.xpub,
                validFromBlock: vm.validFromBlock,
                revokedFromBlock: vm.revokedFromBlock,
                isActive: !vm.revokedFromBlock
            }))
        });
        
    } catch (error) {
        console.error('[DID API] Verification methods error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get verification methods'
        });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Formats OIP creator data as W3C DID Document.
 * 
 * @param {object} creatorData - Creator data from resolver
 * @returns {object} W3C DID Document
 */
function formatAsW3C(creatorData) {
    if (creatorData.isV09 && creatorData.didDocument) {
        const doc = creatorData.didDocument.oip?.data || {};
        return {
            '@context': ['https://www.w3.org/ns/did/v1', 'https://oip.dev/ns/v1'],
            id: doc.did,
            controller: doc.controller,
            verificationMethod: creatorData.verificationMethods?.map(vm => ({
                id: `${doc.did}${vm.vmId}`,
                type: vm.vmType,
                controller: doc.did,
                'oip:xpub': vm.xpub,
                'oip:derivationPathPrefix': vm.derivationPathPrefix,
                'oip:leafIndexPolicy': vm.leafIndexPolicy
            })),
            authentication: doc.authentication?.map(ref => 
                ref.startsWith('#') ? `${doc.did}${ref}` : ref
            ),
            assertionMethod: doc.assertionMethod?.map(ref => 
                ref.startsWith('#') ? `${doc.did}${ref}` : ref
            ),
            keyAgreement: doc.keyAgreement?.map(ref => 
                ref.startsWith('#') ? `${doc.did}${ref}` : ref
            ),
            service: doc.service,
            alsoKnownAs: doc.alsoKnownAs,
            'oip:profile': {
                handle: doc.oipHandle,
                handleRaw: doc.oipHandleRaw,
                name: doc.oipName,
                surname: doc.oipSurname,
                language: doc.oipLanguage
            },
            'oip:social': {
                x: doc.oipSocialX,
                youtube: doc.oipSocialYoutube,
                instagram: doc.oipSocialInstagram,
                tiktok: doc.oipSocialTiktok
            }
        };
    }
    
    // Legacy v0.8 format
    const legacy = creatorData.legacyRecord?.oip?.data || {};
    return {
        '@context': ['https://www.w3.org/ns/did/v1'],
        id: creatorData.did,
        verificationMethod: [{
            id: `${creatorData.did}#legacy`,
            type: 'EcdsaSecp256k1VerificationKey2019',
            controller: creatorData.did,
            'oip:signingXpub': creatorData.signingXpub
        }],
        authentication: [`${creatorData.did}#legacy`],
        assertionMethod: [`${creatorData.did}#legacy`],
        'oip:profile': {
            handle: legacy.handle,
            surname: legacy.surname
        },
        'oip:isLegacy': true
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = router;

