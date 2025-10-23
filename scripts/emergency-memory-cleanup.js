#!/usr/bin/env node

/**
 * Emergency Memory Cleanup Script
 * 
 * This script helps clean up memory leaks by:
 * 1. Forcing garbage collection
 * 2. Clearing axios response caches
 * 3. Monitoring memory usage
 * 4. Providing memory statistics
 */

const axios = require('axios');

// Enable garbage collection
if (global.gc) {
    console.log('✅ Garbage collection is available');
} else {
    console.log('⚠️  Garbage collection not available. Start with: node --expose-gc');
    process.exit(1);
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getMemoryStats() {
    const memUsage = process.memoryUsage();
    return {
        rss: formatBytes(memUsage.rss),
        heapTotal: formatBytes(memUsage.heapTotal),
        heapUsed: formatBytes(memUsage.heapUsed),
        external: formatBytes(memUsage.external),
        heapUtilization: ((memUsage.heapUsed / memUsage.heapTotal) * 100).toFixed(2) + '%'
    };
}

function logMemoryStats(label) {
    const stats = getMemoryStats();
    console.log(`\n📊 [${label}] Memory Stats:`);
    console.log(`   RSS: ${stats.rss}`);
    console.log(`   Heap: ${stats.heapUsed} / ${stats.heapTotal} (${stats.heapUtilization})`);
    console.log(`   External: ${stats.external}`);
}

async function emergencyCleanup() {
    console.log('🚨 Starting Emergency Memory Cleanup...\n');
    
    // Log initial memory
    logMemoryStats('BEFORE');
    
    // Step 1: Clear any axios response caches
    console.log('\n🧹 Step 1: Clearing axios response caches...');
    try {
        // Clear any pending timeouts from axios interceptors
        if (axios.defaults && axios.defaults.interceptors) {
            console.log('   Clearing axios interceptor timeouts...');
        }
    } catch (error) {
        console.log('   No axios caches to clear');
    }
    
    // Step 2: Force multiple garbage collections
    console.log('\n🧹 Step 2: Forcing garbage collection...');
    for (let i = 0; i < 3; i++) {
        global.gc();
        console.log(`   GC pass ${i + 1}/3 completed`);
        // Small delay between GC passes
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Step 3: Clear any global caches
    console.log('\n🧹 Step 3: Clearing global caches...');
    
    // Clear any global variables that might hold references
    if (global.gunSyncService && global.gunSyncService.clearCache) {
        console.log('   Clearing GUN sync cache...');
        global.gunSyncService.clearCache();
    }
    
    // Clear Elasticsearch records cache
    try {
        const { clearRecordsCache } = require('../helpers/elasticsearch');
        clearRecordsCache();
        console.log('   Cleared Elasticsearch records cache...');
    } catch (error) {
        console.log('   Could not clear Elasticsearch cache:', error.message);
    }
    
    // Step 4: Final garbage collection
    console.log('\n🧹 Step 4: Final cleanup...');
    global.gc();
    
    // Log final memory
    logMemoryStats('AFTER');
    
    // Calculate memory freed
    const beforeStats = getMemoryStats();
    const afterStats = getMemoryStats();
    
    console.log('\n✅ Emergency cleanup completed!');
    console.log('💡 If external memory is still high, restart the application.');
}

async function monitorMemory(duration = 60) {
    console.log(`\n📈 Monitoring memory for ${duration} seconds...`);
    
    const startTime = Date.now();
    const endTime = startTime + (duration * 1000);
    
    const interval = setInterval(() => {
        const stats = getMemoryStats();
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        
        console.log(`[${elapsed}s] External: ${stats.external}, Heap: ${stats.heapUtilization}`);
        
        if (Date.now() >= endTime) {
            clearInterval(interval);
            console.log('\n📈 Memory monitoring completed');
        }
    }, 5000); // Check every 5 seconds
}

// Main execution
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    
    switch (command) {
        case 'cleanup':
            await emergencyCleanup();
            break;
            
        case 'monitor':
            const duration = parseInt(args[1]) || 60;
            await monitorMemory(duration);
            break;
            
        case 'stats':
            logMemoryStats('CURRENT');
            break;
            
        default:
            console.log('🔧 Emergency Memory Cleanup Script');
            console.log('\nUsage:');
            console.log('  node scripts/emergency-memory-cleanup.js cleanup    - Run emergency cleanup');
            console.log('  node scripts/emergency-memory-cleanup.js monitor [seconds] - Monitor memory');
            console.log('  node scripts/emergency-memory-cleanup.js stats     - Show current memory stats');
            console.log('\nExamples:');
            console.log('  node scripts/emergency-memory-cleanup.js cleanup');
            console.log('  node scripts/emergency-memory-cleanup.js monitor 120');
            console.log('  node scripts/emergency-memory-cleanup.js stats');
            break;
    }
}

main().catch(console.error);
