const fs = require('fs');
const readline = require('readline');

const file = process.argv[2] || 'heap-snapshot-real.heapsnapshot';
console.log('Streaming analysis of:', file, '\n');

const patterns = {
  'txid': 0,
  'arweave': 0,
  'recordsCache': 0,
  'templatesCache': 0,
  'resolvedRefs': 0,
  'userFitnessProfile': 0,
  'workoutSchedule': 0,
  'mealPlan': 0,
  'gun': 0,
  'keepDBUpToDate': 0,
  'getRecordsInDB': 0,
  'resolveRecords': 0,
  'elasticsearch': 0,
  'Buffer': 0,
  'socket': 0,
  'EventEmitter': 0,
};

let bytesRead = 0;
let lastReport = 0;
const GB = 1024 * 1024 * 1024;

const stream = fs.createReadStream(file, { encoding: 'utf8', highWaterMark: 64 * 1024 });

stream.on('data', (chunk) => {
  bytesRead += chunk.length;
  
  // Count patterns
  for (const [pattern, count] of Object.entries(patterns)) {
    const regex = new RegExp(pattern, 'gi');
    const matches = chunk.match(regex);
    if (matches) patterns[pattern] += matches.length;
  }
  
  // Progress every 500MB
  if (bytesRead - lastReport > 500 * 1024 * 1024) {
    lastReport = bytesRead;
    console.log(`Progress: ${(bytesRead / GB).toFixed(2)} GB processed...`);
  }
});

stream.on('end', () => {
  console.log('\n=== HEAP PATTERN ANALYSIS ===\n');
  console.log('Total size:', (bytesRead / GB).toFixed(2), 'GB\n');
  
  const sorted = Object.entries(patterns).sort((a, b) => b[1] - a[1]);
  sorted.forEach(([pattern, count]) => {
    console.log(`${pattern}: ${count.toLocaleString()} occurrences`);
  });
});

stream.on('error', (e) => console.error('Error:', e.message));