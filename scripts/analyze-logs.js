const fs = require('fs');

const file = process.argv[2] || 'heap-snapshot-real.heapsnapshot';
console.log('Searching for log accumulation patterns...\n');

const patterns = {
  'GET /api': 0,
  'POST /api': 0,
  'PM]': 0,
  'AM]': 0,
  '\\[PERIODIC\\]': 0,
  '\\[GROWTH\\]': 0,
  '\\[SUMMARY\\]': 0,
  'console': 0,
  'operationLog': 0,
  'recentOperations': 0,
  'categoryStats': 0,
  'growthHistory': 0,
  'operationHistory': 0,
};

let bytesRead = 0;
const stream = fs.createReadStream(file, { encoding: 'utf8', highWaterMark: 256 * 1024 });

stream.on('data', (chunk) => {
  bytesRead += chunk.length;
  for (const p of Object.keys(patterns)) {
    const regex = new RegExp(p, 'gi');
    const m = chunk.match(regex);
    if (m) patterns[p] += m.length;
  }
  if (bytesRead % (1024*1024*1024) < 256*1024) {
    console.log(`${(bytesRead/1024/1024/1024).toFixed(1)} GB...`);
  }
});

stream.on('end', () => {
  console.log('\n=== LOG ACCUMULATION ANALYSIS ===\n');
  Object.entries(patterns).sort((a,b) => b[1]-a[1]).forEach(([p,c]) => {
    console.log(`${p}: ${c.toLocaleString()}`);
  });
});