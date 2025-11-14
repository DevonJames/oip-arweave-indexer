#!/usr/bin/env node
/**
 * Test script for hardcoded creator registration fallback
 * 
 * This script verifies that the hardcoded transaction data is correctly formatted
 * and can be processed by the system when the Arweave gateway is unavailable.
 * 
 * Usage: node test/test-hardcoded-fallback.js
 */

const path = require('path');

// Set up path to helpers
const arweaveHelperPath = path.join(__dirname, '../helpers/arweave.js');

console.log('🧪 Testing Hardcoded Creator Registration Fallback\n');
console.log('═══════════════════════════════════════════════════\n');

// Test 1: Verify hardcoded transactions are accessible
console.log('Test 1: Verifying hardcoded transaction constants...');
try {
    const arweaveModule = require(arweaveHelperPath);
    console.log('✅ arweave.js module loaded successfully\n');
} catch (error) {
    console.error('❌ Failed to load arweave.js:', error.message);
    process.exit(1);
}

// Test 2: Verify transaction data format
console.log('Test 2: Verifying hardcoded transaction data format...');

const expectedTransactions = {
    'eqUwpy6et2egkGlkvS7c5GKi0aBsCXT6Dhlydf3GA3Y': {
        blockHeight: 1463761,
        expectedFields: ['transactionId', 'blockHeight', 'tags', 'ver', 'creator', 'creatorSig', 'data'],
        expectedVer: '0.7.2',
        expectedCreator: 'u4B6d5ddggsotOiG86D-KPkeW23qQNdqaXo_ZcdI3k0'
    },
    'iZq_A50yy5YpHNZZfQ5E5Xres3fhMa-buPOlotxbEtU': {
        blockHeight: 1579572,
        expectedFields: ['transactionId', 'blockHeight', 'tags', 'ver', 'creator', 'creatorSig', 'data'],
        expectedVer: '0.8.0',
        expectedCreator: 'iZq_A50yy5YpHNZZfQ5E5Xres3fhMa-buPOlotxbEtU'
    }
};

// Read the source code to extract the hardcoded transactions
const fs = require('fs');
const arweaveSource = fs.readFileSync(arweaveHelperPath, 'utf8');

// Check if HARDCODED_TRANSACTIONS exists
if (arweaveSource.includes('HARDCODED_TRANSACTIONS')) {
    console.log('✅ HARDCODED_TRANSACTIONS constant found in arweave.js');
} else {
    console.error('❌ HARDCODED_TRANSACTIONS constant not found in arweave.js');
    process.exit(1);
}

// Check if both transaction IDs are present
for (const txId of Object.keys(expectedTransactions)) {
    if (arweaveSource.includes(txId)) {
        console.log(`✅ Transaction ${txId} found in hardcoded data`);
    } else {
        console.error(`❌ Transaction ${txId} NOT found in hardcoded data`);
        process.exit(1);
    }
}

console.log('\n');

// Test 3: Verify data can be parsed
console.log('Test 3: Verifying transaction data can be parsed...');

// Extract the HARDCODED_TRANSACTIONS object
const hardcodedStart = arweaveSource.indexOf('const HARDCODED_TRANSACTIONS = {');
const hardcodedEnd = arweaveSource.indexOf('};', hardcodedStart) + 2;
const hardcodedCode = arweaveSource.substring(hardcodedStart, hardcodedEnd);

// Use eval in a controlled way to extract the data (test environment only)
let HARDCODED_TRANSACTIONS;
try {
    // Create a safe evaluation context
    const evalCode = hardcodedCode.replace('const HARDCODED_TRANSACTIONS = ', 'HARDCODED_TRANSACTIONS = ');
    eval(evalCode);
    console.log('✅ Successfully extracted hardcoded transactions\n');
} catch (error) {
    console.error('❌ Failed to parse hardcoded transactions:', error.message);
    process.exit(1);
}

// Test 4: Validate transaction structure
console.log('Test 4: Validating transaction structure...');

for (const [txId, expected] of Object.entries(expectedTransactions)) {
    const tx = HARDCODED_TRANSACTIONS[txId];
    
    if (!tx) {
        console.error(`❌ Transaction ${txId} not found in parsed data`);
        process.exit(1);
    }
    
    console.log(`\n📝 Validating transaction: ${txId}`);
    
    // Check all expected fields exist
    for (const field of expected.expectedFields) {
        if (tx[field] !== undefined) {
            console.log(`  ✅ Field '${field}' exists`);
        } else {
            console.error(`  ❌ Field '${field}' missing`);
            process.exit(1);
        }
    }
    
    // Check blockHeight matches
    if (tx.blockHeight === expected.blockHeight) {
        console.log(`  ✅ Block height correct: ${tx.blockHeight}`);
    } else {
        console.error(`  ❌ Block height incorrect: expected ${expected.blockHeight}, got ${tx.blockHeight}`);
        process.exit(1);
    }
    
    // Check version
    if (tx.ver === expected.expectedVer) {
        console.log(`  ✅ Version correct: ${tx.ver}`);
    } else {
        console.error(`  ❌ Version incorrect: expected ${expected.expectedVer}, got ${tx.ver}`);
        process.exit(1);
    }
    
    // Check creator
    if (tx.creator === expected.expectedCreator) {
        console.log(`  ✅ Creator correct: ${tx.creator}`);
    } else {
        console.error(`  ❌ Creator incorrect: expected ${expected.expectedCreator}, got ${tx.creator}`);
        process.exit(1);
    }
    
    // Check tags array
    if (Array.isArray(tx.tags) && tx.tags.length > 0) {
        console.log(`  ✅ Tags array valid (${tx.tags.length} tags)`);
        
        // Check for required tags
        const requiredTags = ['Content-Type', 'Index-Method', 'Ver', 'Type', 'Creator', 'CreatorSig'];
        for (const tagName of requiredTags) {
            const tag = tx.tags.find(t => t.name === tagName);
            if (tag) {
                console.log(`    ✅ Tag '${tagName}' present`);
            } else {
                console.error(`    ❌ Required tag '${tagName}' missing`);
                process.exit(1);
            }
        }
    } else {
        console.error(`  ❌ Tags array invalid or empty`);
        process.exit(1);
    }
    
    // Check data can be parsed as JSON
    try {
        const parsedData = JSON.parse(tx.data);
        if (Array.isArray(parsedData) && parsedData.length > 0) {
            console.log(`  ✅ Data is valid JSON array (${parsedData.length} elements)`);
            
            // Check first element has expected fields
            const firstElement = parsedData[0];
            if (firstElement["0"] && firstElement["1"] && firstElement["2"] && firstElement["t"]) {
                console.log(`  ✅ First data element has expected structure`);
            } else {
                console.error(`  ❌ First data element missing required fields`);
                process.exit(1);
            }
        } else {
            console.error(`  ❌ Parsed data is not a valid array`);
            process.exit(1);
        }
    } catch (error) {
        console.error(`  ❌ Data is not valid JSON:`, error.message);
        process.exit(1);
    }
    
    // Check CreatorSig format (should use + not spaces)
    if (tx.creatorSig && !tx.creatorSig.includes(' ')) {
        console.log(`  ✅ CreatorSig format correct (no spaces, uses + for base64)`);
    } else {
        console.error(`  ❌ CreatorSig format incorrect (contains spaces instead of +)`);
        process.exit(1);
    }
}

console.log('\n');

// Test 5: Verify getTransaction fallback logic exists
console.log('Test 5: Verifying getTransaction fallback logic...');

if (arweaveSource.includes('if (HARDCODED_TRANSACTIONS[transactionId])')) {
    console.log('✅ Fallback check for hardcoded transactions found in catch block');
} else {
    console.error('❌ Fallback check NOT found in catch block');
    process.exit(1);
}

if (arweaveSource.includes('using hardcoded fallback data')) {
    console.log('✅ Fallback logging message found');
} else {
    console.error('❌ Fallback logging message NOT found');
    process.exit(1);
}

if (arweaveSource.includes('return HARDCODED_TRANSACTIONS[transactionId]')) {
    console.log('✅ Fallback returns complete hardcoded transaction object');
} else {
    console.error('❌ Fallback does NOT return hardcoded transaction');
    process.exit(1);
}

console.log('\n');

// Summary
console.log('═══════════════════════════════════════════════════');
console.log('✅ ALL TESTS PASSED');
console.log('═══════════════════════════════════════════════════');
console.log('\n📋 Summary:');
console.log('  • 2 hardcoded transactions configured');
console.log('  • All required fields present and valid');
console.log('  • Data format matches expected structure');
console.log('  • Fallback logic properly implemented');
console.log('  • CreatorSig format correct');
console.log('\n✅ Hardcoded creator registration fallback is ready!\n');

process.exit(0);

