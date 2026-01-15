#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * OIP v0.9 Bootstrap Creator Script
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * This script bootstraps the first v0.9 creator and publishes the v0.9 templates.
 * 
 * Usage:
 *   node scripts/bootstrap-v09-creator.js                     # Generate new bootstrap creator
 *   node scripts/bootstrap-v09-creator.js --show              # Show current bootstrap config
 *   node scripts/bootstrap-v09-creator.js --publish-did       # Publish DID document
 *   node scripts/bootstrap-v09-creator.js --publish-templates # Publish template records
 *   node scripts/bootstrap-v09-creator.js --use-mnemonic "your mnemonic here"
 * 
 * Steps:
 *   1. Generate/import bootstrap mnemonic
 *   2. Display DID and xpub for hardcoding
 *   3. Publish DID document (verification method + document)
 *   4. Publish v0.9 template records
 *   5. Update TEMPLATE_DIDS with real txIds
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// OIP crypto modules
const {
    createIdentityFromMnemonic,
    generateMnemonic,
    validateMnemonic,
    computePayloadDigest,
    deriveIndexFromPayloadDigest,
    canonicalJson,
    OIP_PURPOSE,
    OIP_VERSION,
    SubPurpose,
    getXpubBasePath
} = require('../helpers/core/oip-crypto');

const { signPayload } = require('../helpers/core/oip-signing');
const { sha256 } = require('@noble/hashes/sha256');
const { secp256k1 } = require('@noble/curves/secp256k1');
const { bytesToHex } = require('@noble/hashes/utils');
const base64url = require('base64url');

// Template schemas
const { 
    V09_TEMPLATES,
    didDocumentSchema,
    didVerificationMethodSchema,
    socialMediaSchema,
    communicationSchema
} = require('../config/templates-v09');

// ═══════════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════════

const BOOTSTRAP_CONFIG_PATH = path.join(__dirname, '..', 'config', 'bootstrap-v09-creator.json');

// ═══════════════════════════════════════════════════════════════════════════════
// Bootstrap Creator Management
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Load or create bootstrap creator configuration
 */
function loadBootstrapConfig() {
    if (fs.existsSync(BOOTSTRAP_CONFIG_PATH)) {
        const config = JSON.parse(fs.readFileSync(BOOTSTRAP_CONFIG_PATH, 'utf8'));
        console.log('✅ Loaded existing bootstrap configuration');
        return config;
    }
    return null;
}

/**
 * Save bootstrap creator configuration
 */
function saveBootstrapConfig(config) {
    fs.writeFileSync(BOOTSTRAP_CONFIG_PATH, JSON.stringify(config, null, 2));
    console.log(`✅ Saved bootstrap configuration to ${BOOTSTRAP_CONFIG_PATH}`);
}

/**
 * Generate a new bootstrap creator
 */
function generateBootstrapCreator(mnemonic = null) {
    if (!mnemonic) {
        console.log('🎲 Generating new 24-word mnemonic...');
        mnemonic = generateMnemonic(256);
    } else if (!validateMnemonic(mnemonic)) {
        throw new Error('Invalid mnemonic phrase');
    }

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('🔐 BOOTSTRAP CREATOR MNEMONIC (KEEP SECURE!)');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(mnemonic);
    console.log('═══════════════════════════════════════════════════════════════\n');

    const identity = createIdentityFromMnemonic(mnemonic, 0);

    const config = {
        mnemonic, // ⚠️ In production, this should be stored securely!
        did: identity.did,
        signingXpub: identity.signingXpub,
        account: 0,
        derivationPath: getXpubBasePath(SubPurpose.IDENTITY_SIGN, 0),
        createdAt: new Date().toISOString(),
        publishedRecords: {
            didVerificationMethod: null,
            didDocument: null,
            templates: {}
        }
    };

    return config;
}

/**
 * Display bootstrap creator info
 */
function displayBootstrapInfo(config) {
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('📋 BOOTSTRAP CREATOR CONFIGURATION');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`DID:              ${config.did}`);
    console.log(`Signing xpub:     ${config.signingXpub}`);
    console.log(`Derivation Path:  ${config.derivationPath}`);
    console.log(`Created:          ${config.createdAt}`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    console.log('📝 HARDCODE DATA (for helpers/core/sync-verification.js):\n');
    console.log(`const BOOTSTRAP_V09_CREATOR = {
    did: '${config.did}',
    signingXpub: '${config.signingXpub}',
    validFromBlock: 0,
    isV09: true,
    verificationMethods: [{
        vmId: '#sign',
        vmType: 'oip:XpubDerivation2025',
        xpub: '${config.signingXpub}',
        validFromBlock: 0,
        revokedFromBlock: null
    }]
};`);
    console.log('\n');

    if (config.publishedRecords) {
        console.log('📦 PUBLISHED RECORDS:');
        console.log(`  DID Verification Method: ${config.publishedRecords.didVerificationMethod || '(not published)'}`);
        console.log(`  DID Document:            ${config.publishedRecords.didDocument || '(not published)'}`);
        console.log(`  Templates:`);
        for (const [name, txId] of Object.entries(config.publishedRecords.templates || {})) {
            console.log(`    - ${name}: ${txId || '(not published)'}`);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Record Building
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build the DID document payload for the bootstrap creator
 */
function buildDIDDocumentPayload(config) {
    const vmFragmentId = crypto.randomUUID ? crypto.randomUUID() : require('uuid').v4();
    const docFragmentId = crypto.randomUUID ? crypto.randomUUID() : require('uuid').v4();

    // Verification Method record (using hardcoded template structure)
    // Field indices from didVerificationMethodSchema
    const vmRecord = {
        t: 'didVerificationMethod', // Template name (will be replaced with real txId after publishing)
        0: '#sign',                              // vmId
        1: 'oip:XpubDerivation2025',            // vmType
        2: config.did,                          // controller
        5: config.signingXpub,                  // xpub
        6: 'identity.sign',                     // derivationSubPurpose
        7: config.account,                      // derivationAccount
        8: config.derivationPath,               // derivationPathPrefix
        9: 'payload_digest',                    // leafIndexPolicy
        11: false                               // leafHardened
    };

    // DID Document record
    // Field indices from didDocumentSchema
    const didDocRecord = {
        t: 'didDocument', // Template name
        0: config.did,                          // did
        1: config.did,                          // controller
        2: [`#${vmFragmentId}`],               // verificationMethod (refs VM fragment)
        3: ['#sign'],                          // authentication
        4: ['#sign'],                          // assertionMethod
        8: 'OIPBootstrap',                     // oipHandleRaw
        9: 'oipbootstrap',                     // oipHandle (normalized)
        10: 'OIP v0.9',                        // oipName
        11: 'Bootstrap Creator',               // oipSurname
        18: 'xpub'                             // keyBindingPolicy
    };

    // Build the full payload
    const payload = {
        '@context': config.did,
        tags: [
            { name: 'Index-Method', value: 'OIP' },
            { name: 'Ver', value: OIP_VERSION },
            { name: 'Content-Type', value: 'application/json' },
            { name: 'Creator', value: config.did },
            { name: 'RecordType', value: 'didDocument' }
        ],
        fragments: [
            {
                id: vmFragmentId,
                dataType: 'Record',
                recordType: 'didVerificationMethod',
                records: [vmRecord]
            },
            {
                id: docFragmentId,
                dataType: 'Record',
                recordType: 'didDocument',
                records: [didDocRecord]
            }
        ]
    };

    return payload;
}

/**
 * Build a template definition record
 */
function buildTemplateRecord(config, templateName, templateSchema) {
    const fragmentId = crypto.randomUUID ? crypto.randomUUID() : require('uuid').v4();

    // Convert schema to OIP template format
    const fields = {};
    for (const [index, fieldDef] of Object.entries(templateSchema.fields)) {
        fields[fieldDef.name] = fieldDef.type;
        fields[`index_${fieldDef.name}`] = parseInt(index);
    }

    const templateRecord = {
        t: 'template', // Meta-template for defining templates
        recordType: templateName,
        fields: JSON.stringify(fields)
    };

    const payload = {
        '@context': config.did,
        tags: [
            { name: 'Index-Method', value: 'OIP' },
            { name: 'Ver', value: OIP_VERSION },
            { name: 'Content-Type', value: 'application/json' },
            { name: 'Creator', value: config.did },
            { name: 'RecordType', value: 'template' },
            { name: 'TemplateName', value: templateName }
        ],
        fragments: [
            {
                id: fragmentId,
                dataType: 'Record',
                recordType: 'template',
                records: [templateRecord]
            }
        ]
    };

    return payload;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Signing
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sign a payload with the bootstrap creator's key
 */
function signWithBootstrapCreator(payload, config) {
    const identity = createIdentityFromMnemonic(config.mnemonic, config.account);
    
    // Compute payload digest
    const payloadDigest = computePayloadDigest(payload);
    const keyIndex = deriveIndexFromPayloadDigest(payloadDigest);
    
    // Get canonical JSON for signing
    const payloadBytes = canonicalJson(payload);
    const messageHash = sha256(new TextEncoder().encode(payloadBytes));
    
    // Derive child signing key
    const childKey = identity.signingKey.deriveChild(keyIndex);
    
    // Sign the message hash
    const signature = secp256k1.sign(messageHash, childKey.privateKey);
    const signatureBase64 = base64url.encode(Buffer.from(signature.toCompactRawBytes()));
    
    // Build signed payload
    const signedPayload = JSON.parse(JSON.stringify(payload));
    signedPayload.tags.push({ name: 'PayloadDigest', value: payloadDigest });
    signedPayload.tags.push({ name: 'KeyIndex', value: keyIndex.toString() });
    signedPayload.tags.push({ name: 'CreatorSig', value: signatureBase64 });
    
    return {
        signedPayload,
        payloadDigest,
        keyIndex,
        signature: signatureBase64
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Publishing (to be implemented with actual Arweave submission)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Publish a signed record to Arweave
 * NOTE: This is a placeholder - actual implementation requires Arweave wallet
 */
async function publishToArweave(signedPayload, config) {
    console.log('\n⚠️  PUBLISHING NOT YET IMPLEMENTED');
    console.log('To publish, you need to:');
    console.log('1. Set up an Arweave wallet with AR tokens');
    console.log('2. Call the OIP daemon /api/records/newRecord endpoint');
    console.log('\nSigned payload ready for submission:');
    console.log(JSON.stringify(signedPayload, null, 2));
    
    // Simulated txId for testing
    const simulatedTxId = 'SIMULATED_' + Date.now();
    return simulatedTxId;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main CLI
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
    const args = process.argv.slice(2);
    
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  🚀 OIP v0.9 BOOTSTRAP CREATOR TOOL');
    console.log('═══════════════════════════════════════════════════════════════\n');

    let config = loadBootstrapConfig();

    // Parse arguments
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Usage:
  node scripts/bootstrap-v09-creator.js [options]

Options:
  --help, -h            Show this help message
  --show                Show current bootstrap configuration
  --generate            Generate a new bootstrap creator
  --use-mnemonic "..."  Use an existing mnemonic
  --build-did           Build (but don't publish) DID document
  --build-templates     Build (but don't publish) template records
  --publish-did         Sign and publish DID document
  --publish-templates   Sign and publish template records
  --output-hardcode     Output the hardcode data for sync-verification.js
        `);
        process.exit(0);
    }

    // Show current config
    if (args.includes('--show')) {
        if (!config) {
            console.log('❌ No bootstrap configuration found. Run without --show to generate one.');
            process.exit(1);
        }
        displayBootstrapInfo(config);
        process.exit(0);
    }

    // Generate new creator
    if (args.includes('--generate') || !config) {
        let mnemonic = null;
        
        const mnemonicIndex = args.indexOf('--use-mnemonic');
        if (mnemonicIndex !== -1 && args[mnemonicIndex + 1]) {
            mnemonic = args[mnemonicIndex + 1];
        }
        
        config = generateBootstrapCreator(mnemonic);
        saveBootstrapConfig(config);
        displayBootstrapInfo(config);
    }

    // Build DID document
    if (args.includes('--build-did')) {
        if (!config) {
            console.log('❌ No bootstrap configuration. Generate one first.');
            process.exit(1);
        }

        console.log('\n📝 Building DID Document payload...\n');
        const payload = buildDIDDocumentPayload(config);
        console.log('Unsigned payload:');
        console.log(JSON.stringify(payload, null, 2));

        const signed = signWithBootstrapCreator(payload, config);
        console.log('\n✅ Signed payload:');
        console.log(JSON.stringify(signed.signedPayload, null, 2));
        
        console.log('\n📊 Signing details:');
        console.log(`  Payload Digest: ${signed.payloadDigest}`);
        console.log(`  Key Index:      ${signed.keyIndex}`);
        console.log(`  Signature:      ${signed.signature.substring(0, 60)}...`);
    }

    // Build templates
    if (args.includes('--build-templates')) {
        if (!config) {
            console.log('❌ No bootstrap configuration. Generate one first.');
            process.exit(1);
        }

        console.log('\n📝 Building template records...\n');
        
        for (const [name, schema] of Object.entries(V09_TEMPLATES)) {
            console.log(`\n━━━ ${name} Template ━━━`);
            const payload = buildTemplateRecord(config, name, schema);
            const signed = signWithBootstrapCreator(payload, config);
            console.log(`  Payload Digest: ${signed.payloadDigest}`);
            console.log(`  Key Index: ${signed.keyIndex}`);
        }
    }

    // Output hardcode data
    if (args.includes('--output-hardcode')) {
        if (!config) {
            console.log('❌ No bootstrap configuration. Generate one first.');
            process.exit(1);
        }

        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('📋 HARDCODE DATA FOR helpers/core/sync-verification.js');
        console.log('═══════════════════════════════════════════════════════════════\n');
        console.log(`/**
 * Bootstrap v0.9 Creator
 * Generated: ${new Date().toISOString()}
 * 
 * This creator is used to publish the first v0.9 records including:
 * - DID Document and Verification Method templates
 * - The bootstrap creator's own DID document
 * - Initial v0.9 template definitions
 */
const BOOTSTRAP_V09_CREATOR = {
    did: '${config.did}',
    signingXpub: '${config.signingXpub}',
    validFromBlock: 0,
    isV09: true,
    verificationMethods: [{
        vmId: '#sign',
        vmType: 'oip:XpubDerivation2025',
        xpub: '${config.signingXpub}',
        validFromBlock: 0,
        revokedFromBlock: null
    }]
};

// Use this to verify bootstrap creator records
async function resolveCreatorWithBootstrap(creatorDid) {
    // Check if this is the bootstrap creator
    if (creatorDid === BOOTSTRAP_V09_CREATOR.did) {
        return BOOTSTRAP_V09_CREATOR;
    }
    // Otherwise use normal resolution
    return await resolveCreator(creatorDid);
}

module.exports = { BOOTSTRAP_V09_CREATOR, resolveCreatorWithBootstrap };`);
    }

    console.log('\n✅ Done!\n');
}

// Run
main().catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});
