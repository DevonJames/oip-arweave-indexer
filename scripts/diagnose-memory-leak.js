#!/usr/bin/env node
/**
 * Memory Leak Diagnostic Tool
 * Connects to the running Node.js process via inspector protocol
 * and takes heap snapshots + analyzes external memory
 */

const inspector = require('inspector');
const fs = require('fs');
const v8 = require('v8');
const path = require('path');

const SNAPSHOT_DIR = path.join(__dirname, '../memory-snapshots');

// Create snapshot directory
if (!fs.existsSync(SNAPSHOT_DIR)) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
}

async function analyzeExternalMemory() {
    console.log('\n🔍 ANALYZING EXTERNAL MEMORY SOURCES\n');
    console.log('═'.repeat(80));
    
    // Get all heap statistics
    const heapStats = v8.getHeapStatistics();
    const heapSpaceStats = v8.getHeapSpaceStatistics();
    
    console.log('\n📊 V8 Heap Statistics:');
    console.log(`  Total Heap Size: ${(heapStats.total_heap_size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Used Heap Size: ${(heapStats.used_heap_size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Heap Size Limit: ${(heapStats.heap_size_limit / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  External Memory: ${(heapStats.external_memory / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Malloced Memory: ${(heapStats.malloced_memory / 1024 / 1024).toFixed(2)} MB`);
    
    console.log('\n📦 Heap Space Breakdown:');
    for (const space of heapSpaceStats) {
        console.log(`  ${space.space_name}:`);
        console.log(`    Size: ${(space.space_size / 1024 / 1024).toFixed(2)} MB`);
        console.log(`    Used: ${(space.space_used_size / 1024 / 1024).toFixed(2)} MB`);
        console.log(`    Available: ${(space.space_available_size / 1024 / 1024).toFixed(2)} MB`);
    }
    
    const memUsage = process.memoryUsage();
    console.log('\n💾 Process Memory Usage:');
    console.log(`  RSS: ${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Heap Total: ${(memUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Heap Used: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  External: ${(memUsage.external / 1024 / 1024).toFixed(2)} MB ⚠️`);
    console.log(`  Array Buffers: ${(memUsage.arrayBuffers / 1024 / 1024).toFixed(2)} MB`);
    
    console.log('\n🔴 CRITICAL RATIOS:');
    const externalToHeap = ((memUsage.external / memUsage.heapUsed) * 100).toFixed(1);
    const externalToRSS = ((memUsage.external / memUsage.rss) * 100).toFixed(1);
    console.log(`  External/Heap: ${externalToHeap}% (normal: <50%)`);
    console.log(`  External/RSS: ${externalToRSS}% (normal: <100%)`);
    
    if (memUsage.external > memUsage.rss) {
        console.log('\n🚨 SMOKING GUN: External memory exceeds RSS!');
        console.log('   This indicates buffers are being tracked but not properly released.');
        console.log('   Likely culprits:');
        console.log('   - ArrayBuffers from Axios/HTTP responses');
        console.log('   - Elasticsearch bulk operations');
        console.log('   - Stream buffers not being destroyed');
    }
}

async function trackLiveHandles() {
    console.log('\n🔗 TRACKING LIVE HANDLES\n');
    console.log('═'.repeat(80));
    
    // Get active handles and requests
    const activeHandles = process._getActiveHandles();
    const activeRequests = process._getActiveRequests();
    
    console.log(`\n📍 Active Handles: ${activeHandles.length}`);
    const handleTypes = {};
    for (const handle of activeHandles) {
        const type = handle.constructor.name;
        handleTypes[type] = (handleTypes[type] || 0) + 1;
    }
    
    console.log('  Breakdown:');
    for (const [type, count] of Object.entries(handleTypes).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${type}: ${count}`);
    }
    
    console.log(`\n📍 Active Requests: ${activeRequests.length}`);
    const requestTypes = {};
    for (const request of activeRequests) {
        const type = request.constructor.name;
        requestTypes[type] = (requestTypes[type] || 0) + 1;
    }
    
    console.log('  Breakdown:');
    for (const [type, count] of Object.entries(requestTypes).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${type}: ${count}`);
    }
}

async function inspectGlobalObjects() {
    console.log('\n🌍 INSPECTING GLOBAL OBJECTS\n');
    console.log('═'.repeat(80));
    
    // Check for known potential leaks
    const suspects = {
        'global.rateLimitBackoffUntil': global.rateLimitBackoffUntil,
        'global.gunSyncService': !!global.gunSyncService,
        'global.gc': !!global.gc,
    };
    
    console.log('\n🔍 Global State:');
    for (const [key, value] of Object.entries(suspects)) {
        console.log(`  ${key}: ${value}`);
    }
    
    // Try to access known caches
    if (global.gunSyncService) {
        console.log('\n📦 GUN Sync Service State:');
        console.log(`  Registry exists: ${!!global.gunSyncService.registry}`);
        if (global.gunSyncService.processedRecords) {
            console.log(`  Processed Records Set size: ${global.gunSyncService.processedRecords.size}`);
        }
    }
}

async function takeHeapSnapshot() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = path.join(SNAPSHOT_DIR, `heap-${timestamp}.heapsnapshot`);
    
    console.log('\n📸 Taking heap snapshot...');
    console.log(`   Writing to: ${filename}`);
    
    v8.writeHeapSnapshot(filename);
    
    console.log('✅ Heap snapshot saved!');
    console.log(`   Analyze with: chrome://inspect > Memory > Load`);
    
    return filename;
}

async function suggestFixes(memUsage) {
    console.log('\n💡 RECOMMENDED ACTIONS\n');
    console.log('═'.repeat(80));
    
    const externalMB = memUsage.external / 1024 / 1024;
    const arrayBuffersMB = memUsage.arrayBuffers / 1024 / 1024;
    
    if (externalMB > 100000) { // > 100GB
        console.log('\n🚨 CRITICAL: External memory > 100GB');
        console.log('   1. Check Elasticsearch client connection pooling');
        console.log('   2. Verify Axios response interceptors are working');
        console.log('   3. Look for streams/buffers not being .destroy()ed');
        console.log('   4. Check if keepDBUpToDate is accumulating data');
    }
    
    if (arrayBuffersMB > 10000) { // > 10GB
        console.log('\n⚠️  ArrayBuffers > 10GB detected');
        console.log('   - This is likely HTTP response buffers');
        console.log('   - Check all axios.get/post calls for responseType: arraybuffer');
        console.log('   - Ensure buffers are nullified after use');
    }
    
    console.log('\n🔧 Immediate Actions:');
    console.log('   1. Force garbage collection: docker exec <container> kill -USR2 <pid>');
    console.log('   2. Check file descriptors: lsof -p <pid> | wc -l');
    console.log('   3. Review heap snapshot for retained objects');
    console.log('   4. Enable --trace-gc flag to see GC behavior');
}

async function main() {
    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║      MEMORY LEAK DIAGNOSTIC TOOL - OIP Arweave Indexer       ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');
    
    try {
        await analyzeExternalMemory();
        await trackLiveHandles();
        await inspectGlobalObjects();
        
        const memUsage = process.memoryUsage();
        await suggestFixes(memUsage);
        
        // Optionally take snapshot
        if (process.argv.includes('--snapshot')) {
            await takeHeapSnapshot();
        } else {
            console.log('\n💾 To take a heap snapshot, run with --snapshot flag');
        }
        
        console.log('\n' + '═'.repeat(80));
        console.log('✅ Diagnostic complete!\n');
        
    } catch (error) {
        console.error('❌ Diagnostic failed:', error);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
} else {
    // Export for use in other scripts
    module.exports = {
        analyzeExternalMemory,
        trackLiveHandles,
        takeHeapSnapshot
    };
}

