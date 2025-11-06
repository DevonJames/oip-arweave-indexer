#!/usr/bin/env node
/**
 * Take a heap snapshot and analyze what's consuming memory
 * Run this while the app is running to see what's actually in memory
 */

const v8 = require('v8');
const fs = require('fs');
const path = require('path');

const snapshotDir = path.join(__dirname, '../heap-snapshots');

// Create directory if it doesn't exist
if (!fs.existsSync(snapshotDir)) {
    fs.mkdirSync(snapshotDir, { recursive: true });
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const filename = path.join(snapshotDir, `heap-${timestamp}.heapsnapshot`);

console.log('\n📸 Taking heap snapshot...');
console.log(`   This will show what's actually consuming memory`);
console.log(`   File: ${filename}\n`);

// Take snapshot
v8.writeHeapSnapshot(filename);

console.log('✅ Heap snapshot saved!');
console.log('\n📊 To analyze:');
console.log('   1. Copy file from container:');
console.log(`      docker cp fitnessally-oip-gpu-1:${filename} ./heap-snapshots/`);
console.log('   2. Open Chrome DevTools > Memory > Load');
console.log('   3. Look for:');
console.log('      - Large arrays');
console.log('      - ArrayBuffer objects');
console.log('      - Detached DOM nodes');
console.log('      - Objects with high "Retained Size"');
console.log('\n💡 Or analyze in terminal:');
console.log(`   node --inspect-brk ${__filename}`);
console.log('   Then open chrome://inspect\n');

