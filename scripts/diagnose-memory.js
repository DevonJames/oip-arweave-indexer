/**
 * Memory Diagnostic Tool
 * 
 * This script helps diagnose memory issues in the OIP Arweave application
 * Run: node scripts/diagnose-memory.js
 */

const v8 = require('v8');
const fs = require('fs');
const path = require('path');

function formatBytes(bytes) {
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function getMemoryUsage() {
    const usage = process.memoryUsage();
    const heapStats = v8.getHeapStatistics();
    
    console.log('\n📊 MEMORY USAGE SNAPSHOT');
    console.log('═'.repeat(60));
    console.log(`RSS (Total Memory):        ${formatBytes(usage.rss)}`);
    console.log(`Heap Used:                 ${formatBytes(usage.heapUsed)}`);
    console.log(`Heap Total:                ${formatBytes(usage.heapTotal)}`);
    console.log(`External:                  ${formatBytes(usage.external)}`);
    console.log(`Array Buffers:             ${formatBytes(usage.arrayBuffers || 0)}`);
    console.log('─'.repeat(60));
    console.log(`Heap Size Limit:           ${formatBytes(heapStats.heap_size_limit)}`);
    console.log(`Total Available Size:      ${formatBytes(heapStats.total_available_size)}`);
    console.log(`Used Heap Size:            ${formatBytes(heapStats.used_heap_size)}`);
    console.log(`Heap Utilization:          ${((heapStats.used_heap_size / heapStats.heap_size_limit) * 100).toFixed(2)}%`);
    console.log('═'.repeat(60));
    
    // Warning thresholds
    const heapUtilization = (heapStats.used_heap_size / heapStats.heap_size_limit) * 100;
    if (heapUtilization > 80) {
        console.log('⚠️  WARNING: Heap utilization is above 80%!');
        console.log('   Consider increasing heap size or investigating memory leaks.');
    }
    if (heapUtilization > 90) {
        console.log('🚨 CRITICAL: Heap utilization is above 90%!');
        console.log('   Application is at risk of running out of memory.');
    }
    
    return {
        usage,
        heapStats,
        heapUtilization
    };
}

function writeHeapSnapshot() {
    const filename = path.join(
        __dirname,
        '..',
        'logs',
        `heap-${Date.now()}.heapsnapshot`
    );
    
    console.log('\n📸 Taking heap snapshot...');
    console.log(`Writing to: ${filename}`);
    
    try {
        // Ensure logs directory exists
        const logsDir = path.join(__dirname, '..', 'logs');
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }
        
        const snapshotStream = v8.writeHeapSnapshot(filename);
        console.log('✅ Heap snapshot saved successfully!');
        console.log('\nTo analyze:');
        console.log('1. Open Chrome DevTools');
        console.log('2. Go to Memory tab');
        console.log('3. Load the .heapsnapshot file');
        console.log(`4. File location: ${filename}`);
        
        return filename;
    } catch (error) {
        console.error('❌ Failed to write heap snapshot:', error);
        return null;
    }
}

function checkGCStats() {
    console.log('\n🔍 GARBAGE COLLECTION INFO');
    console.log('═'.repeat(60));
    
    const heapStats = v8.getHeapStatistics();
    console.log(`Does ZAP Garbage:          ${heapStats.does_zap_garbage}`);
    console.log(`Malloced Memory:           ${formatBytes(heapStats.malloced_memory)}`);
    console.log(`Peak Malloced Memory:      ${formatBytes(heapStats.peak_malloced_memory)}`);
    console.log(`Number of Native Contexts: ${heapStats.number_of_native_contexts}`);
    console.log(`Number of Detached Contexts: ${heapStats.number_of_detached_contexts}`);
    console.log('═'.repeat(60));
    
    if (heapStats.number_of_detached_contexts > 10) {
        console.log('⚠️  WARNING: High number of detached contexts detected!');
        console.log('   This may indicate memory leaks from event listeners or closures.');
    }
}

function monitorMemory(intervalSeconds = 5, durationSeconds = 60) {
    console.log(`\n🔄 MONITORING MEMORY USAGE`);
    console.log(`Interval: ${intervalSeconds}s, Duration: ${durationSeconds}s`);
    console.log('═'.repeat(60));
    
    const measurements = [];
    const startTime = Date.now();
    
    const interval = setInterval(() => {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        const usage = process.memoryUsage();
        const heapStats = v8.getHeapStatistics();
        
        measurements.push({
            time: elapsed,
            heapUsed: usage.heapUsed,
            heapTotal: usage.heapTotal,
            rss: usage.rss,
            heapUtilization: (heapStats.used_heap_size / heapStats.heap_size_limit) * 100
        });
        
        console.log(`[${elapsed}s] Heap: ${formatBytes(usage.heapUsed)} / ${formatBytes(usage.heapTotal)} (${((usage.heapUsed / usage.heapTotal) * 100).toFixed(1)}%)`);
        
        if (elapsed >= durationSeconds) {
            clearInterval(interval);
            
            console.log('\n📊 MONITORING SUMMARY');
            console.log('═'.repeat(60));
            
            const heapGrowth = measurements[measurements.length - 1].heapUsed - measurements[0].heapUsed;
            const heapGrowthRate = heapGrowth / durationSeconds;
            
            console.log(`Heap Growth:        ${formatBytes(heapGrowth)}`);
            console.log(`Growth Rate:        ${formatBytes(heapGrowthRate)}/second`);
            console.log(`Projected 1hr:      ${formatBytes(heapGrowthRate * 3600)}`);
            
            if (heapGrowthRate > 1024 * 1024) { // > 1MB/s
                console.log('\n🚨 CRITICAL: Memory is growing rapidly!');
                console.log('   Estimated time to OOM: ~' + Math.round((4000 - measurements[0].heapUsed / 1024 / 1024) / (heapGrowthRate / 1024 / 1024 / 60)) + ' minutes');
                console.log('   Immediate action required:');
                console.log('   1. Restart the application');
                console.log('   2. Investigate memory leaks');
                console.log('   3. Consider increasing heap size temporarily');
            }
        }
    }, intervalSeconds * 1000);
}

// Main execution
console.log('🔍 OIP ARWEAVE MEMORY DIAGNOSTICS');
console.log('═'.repeat(60));

const args = process.argv.slice(2);
const command = args[0];

switch (command) {
    case 'snapshot':
        getMemoryUsage();
        writeHeapSnapshot();
        break;
        
    case 'monitor':
        const interval = parseInt(args[1]) || 5;
        const duration = parseInt(args[2]) || 60;
        monitorMemory(interval, duration);
        break;
        
    case 'quick':
    default:
        getMemoryUsage();
        checkGCStats();
        
        console.log('\n💡 RECOMMENDATIONS');
        console.log('═'.repeat(60));
        console.log('1. To increase heap size, start Node with:');
        console.log('   NODE_OPTIONS="--max-old-space-size=8192" npm start');
        console.log('   (This sets heap limit to 8GB)');
        console.log('');
        console.log('2. To take a heap snapshot for detailed analysis:');
        console.log('   node scripts/diagnose-memory.js snapshot');
        console.log('');
        console.log('3. To monitor memory growth over time:');
        console.log('   node scripts/diagnose-memory.js monitor [interval] [duration]');
        console.log('   Example: node scripts/diagnose-memory.js monitor 10 120');
        console.log('');
        console.log('4. Check application logs for these patterns:');
        console.log('   - Growing cache sizes');
        console.log('   - Unclosed database connections');
        console.log('   - Event listener leaks');
        console.log('   - Large arrays or objects accumulating');
        break;
}

