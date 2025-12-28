const fs = require('fs');
const readline = require('readline');

const file = process.argv[2] || 'heap-snapshot-real.heapsnapshot';
console.log('Analyzing:', file);

const stream = fs.createReadStream(file, { encoding: 'utf8' });
let buffer = '';
let parsed = false;

stream.on('data', (chunk) => {
  if (parsed) return;
  buffer += chunk;
  
  // Try to parse once we have enough
  if (buffer.length > 100000000) { // 100MB
    try {
      const snapshot = JSON.parse(buffer.slice(0, buffer.indexOf('\n', 50000000) || buffer.length));
      analyzeSnapshot(snapshot);
      parsed = true;
    } catch (e) {
      // Keep buffering
    }
  }
});

stream.on('end', () => {
  if (!parsed) {
    try {
      const snapshot = JSON.parse(buffer);
      analyzeSnapshot(snapshot);
    } catch (e) {
      console.log('Parse error, trying partial analysis...');
      partialAnalysis(buffer);
    }
  }
});

function analyzeSnapshot(snapshot) {
  console.log('\n=== HEAP SNAPSHOT ANALYSIS ===\n');
  console.log('Nodes:', snapshot.nodes?.length / snapshot.snapshot?.meta?.node_fields?.length || 'unknown');
  console.log('Strings sample:', snapshot.strings?.slice(0, 50));
}

function partialAnalysis(data) {
  // Look for common patterns in the raw JSON
  const patterns = [
    { name: 'txid references', regex: /txid/gi },
    { name: 'arweave references', regex: /arweave/gi },
    { name: 'recordsCache', regex: /recordsCache/gi },
    { name: 'resolvedRefs', regex: /resolvedRefs/gi },
    { name: 'gun references', regex: /"gun[^"]*"/gi },
    { name: 'userFitnessProfile', regex: /userFitnessProfile/gi },
  ];
  
  console.log('\n=== PATTERN COUNTS IN HEAP ===\n');
  patterns.forEach(p => {
    const matches = data.match(p.regex);
    console.log(`${p.name}: ${matches ? matches.length : 0} occurrences`);
  });
}