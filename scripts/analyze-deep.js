const fs = require('fs');

const file = process.argv[2] || 'heap-snapshot-real.heapsnapshot';
console.log('Deep analysis of:', file, '\n');

// Sample actual string content around key patterns
const samples = {
  gun: [],
  Buffer: [],
  socket: [],
  arweave: [],
};
const maxSamples = 10;

let bytesRead = 0;
const GB = 1024 * 1024 * 1024;

const stream = fs.createReadStream(file, { encoding: 'utf8', highWaterMark: 256 * 1024 });

stream.on('data', (chunk) => {
  bytesRead += chunk.length;
  
  // Extract context around pattern matches
  for (const pattern of Object.keys(samples)) {
    if (samples[pattern].length >= maxSamples) continue;
    
    const regex = new RegExp(`.{0,100}${pattern}.{0,100}`, 'gi');
    const matches = chunk.match(regex);
    if (matches) {
      for (const m of matches) {
        if (samples[pattern].length < maxSamples) {
          // Clean up the match for readability
          const clean = m.replace(/[\x00-\x1f]/g, ' ').trim();
          if (clean.length > 20) samples[pattern].push(clean);
        }
      }
    }
  }
  
  // Progress
  if (bytesRead % (GB) < 256 * 1024) {
    console.log(`Progress: ${(bytesRead / GB).toFixed(1)} GB...`);
  }
});

stream.on('end', () => {
  console.log('\n=== STRING SAMPLES ===\n');
  
  for (const [pattern, sampleList] of Object.entries(samples)) {
    console.log(`\n--- ${pattern.toUpperCase()} samples ---`);
    sampleList.forEach((s, i) => {
      console.log(`${i+1}. ${s.substring(0, 200)}`);
    });
  }
});