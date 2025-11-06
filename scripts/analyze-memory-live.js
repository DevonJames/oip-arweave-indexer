#!/usr/bin/env node
/**
 * Analyze what's in memory RIGHT NOW without taking a full heap snapshot
 * Run inside the container to see what's consuming external memory
 */

const v8 = require('v8');

console.log('\n🔍 LIVE MEMORY ANALYSIS\n');
console.log('═'.repeat(80));

// Get heap statistics
const heapStats = v8.getHeapStatistics();
const memUsage = process.memoryUsage();

console.log('\n📊 Memory Breakdown:');
console.log(`  Heap Used: ${(memUsage.heapUsed / 1024 / 1024).toFixed(0)} MB`);
console.log(`  Heap Total: ${(memUsage.heapTotal / 1024 / 1024).toFixed(0)} MB`);
console.log(`  RSS: ${(memUsage.rss / 1024 / 1024).toFixed(0)} MB`);
console.log(`  External: ${(memUsage.external / 1024 / 1024).toFixed(0)} MB ⚠️`);
console.log(`  ArrayBuffers: ${(memUsage.arrayBuffers / 1024 / 1024).toFixed(0)} MB ⚠️`);

console.log('\n🔴 CRITICAL RATIOS:');
const externalToHeap = ((memUsage.external / memUsage.heapUsed) * 100).toFixed(1);
const arrayBufferToExternal = ((memUsage.arrayBuffers / memUsage.external) * 100).toFixed(1);
console.log(`  External/Heap: ${externalToHeap}% (normal: <50%)`);
console.log(`  ArrayBuffers/External: ${arrayBufferToExternal}%`);

// Get active handles and requests
const handles = process._getActiveHandles();
const requests = process._getActiveRequests();

console.log('\n🔗 Active Connections:');
console.log(`  Handles: ${handles.length}`);
console.log(`  Requests: ${requests.length}`);

// Count handle types
const handleTypes = {};
for (const handle of handles) {
    const type = handle.constructor.name;
    handleTypes[type] = (handleTypes[type] || 0) + 1;
}

console.log('\n📍 Handle Types:');
Object.entries(handleTypes)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
        if (count > 5) {
            console.log(`  ${type}: ${count}`);
        }
    });

// Count request types
const requestTypes = {};
for (const request of requests) {
    const type = request.constructor.name;
    requestTypes[type] = (requestTypes[type] || 0) + 1;
}

console.log('\n📍 Request Types:');
Object.entries(requestTypes)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
        if (count > 5) {
            console.log(`  ${type}: ${count}`);
        }
    });

// Check global variables
console.log('\n🌍 Global State:');
console.log(`  global.gc: ${!!global.gc}`);
console.log(`  global.gunSyncService: ${!!global.gunSyncService}`);
console.log(`  global.rateLimitBackoffUntil: ${global.rateLimitBackoffUntil || 'not set'}`);

// Heap space breakdown
console.log('\n📦 Heap Spaces:');
const spaces = v8.getHeapSpaceStatistics();
spaces.forEach(space => {
    const sizeMB = (space.space_size / 1024 / 1024).toFixed(0);
    const usedMB = (space.space_used_size / 1024 / 1024).toFixed(0);
    if (parseInt(sizeMB) > 10) {
        console.log(`  ${space.space_name}: ${usedMB}/${sizeMB} MB`);
    }
});

console.log('\n💡 Key Findings:');
if (memUsage.external > memUsage.rss) {
    console.log('  🚨 External memory > RSS - Virtual memory leak!');
}
if (memUsage.arrayBuffers > 1024 * 1024 * 1024) {
    console.log(`  🚨 ArrayBuffers: ${(memUsage.arrayBuffers / 1024 / 1024).toFixed(0)} MB - Check HTTP responses!`);
}
if (handleTypes.Socket > 100) {
    console.log(`  🚨 ${handleTypes.Socket} sockets - Connection leak!`);
}
if (requestTypes.TCPConnectWrap > 50) {
    console.log(`  🚨 ${requestTypes.TCPConnectWrap} TCP connections - Connection leak!`);
}

console.log('\n' + '═'.repeat(80));
console.log('✅ Analysis complete!\n');

