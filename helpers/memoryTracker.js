/**
 * Real-time Memory Leak Tracker
 * Tracks memory growth and identifies likely sources
 */

const v8 = require('v8');

class MemoryLeakTracker {
    constructor(options = {}) {
        this.trackingInterval = options.trackingInterval || 60000; // 1 minute
        this.samples = [];
        this.maxSamples = options.maxSamples || 60; // Keep last 60 samples
        this.alertThreshold = options.alertThreshold || 5000; // 5GB growth
        this.tracking = false;
        this.suspects = new Map();
    }

    start() {
        if (this.tracking) {
            console.log('⚠️  Memory tracker already running');
            return;
        }

        console.log('🔍 Starting memory leak tracker...');
        this.tracking = true;
        this.trackingIntervalId = setInterval(() => this.takeSample(), this.trackingInterval);
        
        // Take initial sample
        this.takeSample();
    }

    stop() {
        if (!this.tracking) return;
        
        console.log('🛑 Stopping memory leak tracker...');
        clearInterval(this.trackingIntervalId);
        this.tracking = false;
    }

    takeSample() {
        const memUsage = process.memoryUsage();
        const heapStats = v8.getHeapStatistics();
        const handles = process._getActiveHandles();
        const requests = process._getActiveRequests();

        const sample = {
            timestamp: Date.now(),
            rss: memUsage.rss,
            heapTotal: memUsage.heapTotal,
            heapUsed: memUsage.heapUsed,
            external: memUsage.external,
            arrayBuffers: memUsage.arrayBuffers,
            heapLimit: heapStats.heap_size_limit,
            activeHandles: handles.length,
            activeRequests: requests.length,
            
            // Track handle types
            handleTypes: this._countTypes(handles),
            requestTypes: this._countTypes(requests),
        };

        this.samples.push(sample);
        
        // Keep only recent samples
        if (this.samples.length > this.maxSamples) {
            this.samples.shift();
        }

        // Analyze for leaks
        if (this.samples.length >= 3) {
            this.analyzeGrowth();
        }
    }

    _countTypes(objects) {
        const counts = {};
        for (const obj of objects) {
            const type = obj.constructor.name;
            counts[type] = (counts[type] || 0) + 1;
        }
        return counts;
    }

    analyzeGrowth() {
        if (this.samples.length < 3) return;

        const recent = this.samples[this.samples.length - 1];
        const previous = this.samples[this.samples.length - 2];
        const oldest = this.samples[0];

        // Calculate growth rates
        const externalGrowthRecent = recent.external - previous.external;
        const externalGrowthTotal = recent.external - oldest.external;
        const timeSpan = (recent.timestamp - oldest.timestamp) / 1000 / 60; // minutes

        const externalGrowthRateMB = (externalGrowthTotal / 1024 / 1024) / timeSpan; // MB per minute

        // Check for suspicious growth
        if (externalGrowthRateMB > 50) { // > 50MB/min
            const externalMB = recent.external / 1024 / 1024;
            const growthMB = externalGrowthRecent / 1024 / 1024;
            
            console.warn(`\n🚨 [Memory Leak Tracker] EXTERNAL MEMORY LEAK DETECTED`);
            console.warn(`   Current: ${externalMB.toFixed(0)}MB`);
            console.warn(`   Growth: +${growthMB.toFixed(0)}MB in last ${(this.trackingInterval / 1000 / 60).toFixed(1)} minutes`);
            console.warn(`   Rate: ${externalGrowthRateMB.toFixed(1)} MB/min`);
            console.warn(`   Time to crash (if 32GB heap): ${((32768 - externalMB) / externalGrowthRateMB).toFixed(0)} minutes\n`);

            this.identifySuspects(recent, previous);
        }

        // Check handle/request growth
        const handleGrowth = recent.activeHandles - oldest.activeHandles;
        const requestGrowth = recent.activeRequests - oldest.activeRequests;

        if (handleGrowth > 100 || requestGrowth > 50) {
            console.warn(`\n⚠️  [Memory Leak Tracker] HANDLE/REQUEST LEAK DETECTED`);
            console.warn(`   Active Handles: ${recent.activeHandles} (+${handleGrowth})`);
            console.warn(`   Active Requests: ${recent.activeRequests} (+${requestGrowth})`);
            
            // Show which types are growing
            this._compareTypeCounts(oldest.handleTypes, recent.handleTypes, 'Handles');
            this._compareTypeCounts(oldest.requestTypes, recent.requestTypes, 'Requests');
        }
    }

    _compareTypeCounts(oldCounts, newCounts, label) {
        console.warn(`\n   ${label} growth by type:`);
        const allTypes = new Set([...Object.keys(oldCounts), ...Object.keys(newCounts)]);
        
        for (const type of allTypes) {
            const oldCount = oldCounts[type] || 0;
            const newCount = newCounts[type] || 0;
            const growth = newCount - oldCount;
            
            if (growth > 5) {
                console.warn(`     ${type}: ${oldCount} → ${newCount} (+${growth})`);
            }
        }
    }

    identifySuspects(recent, previous) {
        const suspects = [];

        // Check ArrayBuffers specifically
        const arrayBufferGrowth = recent.arrayBuffers - previous.arrayBuffers;
        if (arrayBufferGrowth > 10 * 1024 * 1024) { // > 10MB
            suspects.push({
                type: 'ArrayBuffer',
                growth: arrayBufferGrowth / 1024 / 1024,
                source: 'Likely: Axios responses (arraybuffer), Elasticsearch bulk operations'
            });
        }

        // Check if external is growing without heap growing
        const heapGrowth = recent.heapUsed - previous.heapUsed;
        const externalGrowth = recent.external - previous.external;
        
        if (externalGrowth > heapGrowth * 10) { // External growing 10x faster than heap
            suspects.push({
                type: 'External Memory (non-V8)',
                growth: externalGrowth / 1024 / 1024,
                source: 'Likely: Native modules, C++ addons, or leaked buffers'
            });
        }

        // Report suspects
        if (suspects.length > 0) {
            console.warn('\n   🔍 Likely culprits:');
            for (const suspect of suspects) {
                console.warn(`     • ${suspect.type}: +${suspect.growth.toFixed(1)}MB`);
                console.warn(`       ${suspect.source}`);
            }
        }
    }

    getReport() {
        if (this.samples.length === 0) {
            return { error: 'No samples collected yet' };
        }

        const latest = this.samples[this.samples.length - 1];
        const oldest = this.samples[0];
        const timeSpan = (latest.timestamp - oldest.timestamp) / 1000 / 60; // minutes

        return {
            samples: this.samples.length,
            timeSpan: timeSpan.toFixed(1),
            current: {
                rss: (latest.rss / 1024 / 1024).toFixed(0) + 'MB',
                heap: (latest.heapUsed / 1024 / 1024).toFixed(0) + 'MB',
                external: (latest.external / 1024 / 1024).toFixed(0) + 'MB',
                handles: latest.activeHandles,
                requests: latest.activeRequests,
            },
            growth: {
                rss: ((latest.rss - oldest.rss) / 1024 / 1024).toFixed(0) + 'MB',
                heap: ((latest.heapUsed - oldest.heapUsed) / 1024 / 1024).toFixed(0) + 'MB',
                external: ((latest.external - oldest.external) / 1024 / 1024).toFixed(0) + 'MB',
                handles: latest.activeHandles - oldest.activeHandles,
                requests: latest.activeRequests - oldest.activeRequests,
            },
            growthRate: {
                externalMBPerMin: (((latest.external - oldest.external) / 1024 / 1024) / timeSpan).toFixed(1),
                heapMBPerMin: (((latest.heapUsed - oldest.heapUsed) / 1024 / 1024) / timeSpan).toFixed(1),
            }
        };
    }
}

// Singleton instance
let trackerInstance = null;

function getTracker(options) {
    if (!trackerInstance) {
        trackerInstance = new MemoryLeakTracker(options);
    }
    return trackerInstance;
}

module.exports = {
    MemoryLeakTracker,
    getTracker
};

