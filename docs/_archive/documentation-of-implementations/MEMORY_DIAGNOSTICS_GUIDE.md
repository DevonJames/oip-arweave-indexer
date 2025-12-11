# Memory Diagnostics System - Usage Guide

## Overview
This diagnostic system provides **safe, read-only** memory profiling to identify the exact sources of memory leaks without introducing new problems or making the leak worse.

## Features

1. **Operation-Level Tracking**: Tracks memory growth for each operation type (API routes, GUN sync, Elasticsearch queries, etc.)
2. **Automatic Categorization**: Groups operations into categories for easy analysis
3. **Minimal Overhead**: Uses minimal memory itself (<10MB) and doesn't interfere with GC
4. **Automatic Heap Dumps**: Takes heap snapshots at memory thresholds (2GB, 4GB, 6GB, 8GB, 10GB)
5. **Periodic Reporting**: Generates summaries every 60 seconds when significant growth is detected
6. **Safe Shutdown**: Cleans up resources properly on exit

## Enabling the System

Add this to your `.env` file:

```bash
MEMORY_DIAGNOSTICS_ENABLED=true
```

## How It Works

### 1. Automatic Request Tracking
Every HTTP request is automatically tracked via middleware. No code changes needed.

### 2. Manual Operation Tracking
For background operations (like GUN sync), tracking is added like this:

```javascript
const memoryDiagnostics = require('./helpers/memoryDiagnostics');

async function myOperation() {
    const endTracking = memoryDiagnostics.trackOperation('my_operation', 'details');
    
    try {
        // ... your code ...
    } finally {
        await endTracking(); // Always call this when done
    }
}
```

### 3. Output Files

#### Diagnostic Log (`logs/memory-diagnostics.log`)
Contains timestamped entries:
```
[2025-11-26T10:00:00.000Z] [INIT] Baseline memory: RSS: 250MB, Heap: 150MB, External: 30MB
[2025-11-26T10:01:00.000Z] [PERIODIC] Current: RSS: 300MB... | Growth rate: RSS 50.0 MB/min, External 10.0 MB/min
[2025-11-26T10:02:00.000Z] [GROWTH] GET /api/records (?limit=1000): RSS +52MB, External +25MB
[2025-11-26T10:03:00.000Z] [SUMMARY] === OPERATION CATEGORY SUMMARY ===
```

#### Heap Dumps (`logs/heap-dumps/`)
Binary snapshots taken at memory thresholds:
```
heapdump_threshold_2048MB_2025-11-26T10-05-00-000Z.heapsnapshot
heapdump_threshold_4096MB_2025-11-26T10-15-00-000Z.heapsnapshot
```

## Analyzing Results

### 1. Check the Diagnostic Log

```bash
tail -f logs/memory-diagnostics.log
```

Look for:
- High growth rates in PERIODIC entries
- Specific operations causing large GROWTH
- SUMMARY reports showing which categories are leaking

### 2. Generate a Report

You can trigger a manual report via the Node REPL or by adding an API endpoint:

```javascript
// In Node REPL (attach to process)
const memoryDiagnostics = require('./helpers/memoryDiagnostics');
await memoryDiagnostics.generateReport();
```

### 3. Analyze Heap Dumps

Use Chrome DevTools to analyze heap dumps:

1. Open Chrome DevTools (F12)
2. Go to Memory tab
3. Click "Load" button
4. Select a `.heapsnapshot` file
5. Look for:
   - Large retained sizes
   - Objects with high shallow size counts
   - Detached DOM nodes (shouldn't be any in Node.js)
   - ArrayBuffers and TypedArrays (external memory culprits)

### 4. Compare Heap Dumps

To find what's growing:

1. Load the 2GB threshold dump
2. Load the 4GB threshold dump
3. In the 4GB dump, switch to "Comparison" view
4. Select the 2GB dump as baseline
5. Sort by "Size Delta" descending
6. This shows what objects grew between 2GB and 4GB

## Interpreting Results

### Common Patterns

**Pattern 1: High External Memory Growth**
```
[PERIODIC] Growth rate: RSS 10 MB/min, External 450 MB/min
[api_records] 50 operations: Total Growth: External +5000MB
```
**Diagnosis**: API responses (likely GIFs/images/PDFs) not being cleaned up
**Solution**: Add buffer cleanup and force GC after responses

**Pattern 2: Steady Heap Growth**
```
[PERIODIC] Growth rate: Heap 50 MB/min
[gun_sync] 1 operation: Total Growth: Heap +450MB
```
**Diagnosis**: GUN sync accumulating objects (likely failed record retries)
**Solution**: Implement failed record tracking to prevent infinite retries

**Pattern 3: Specific Route Leaking**
```
[GROWTH] POST /api/voice/converse: External +250MB
```
**Diagnosis**: Voice processing creating large buffers that aren't cleaned up
**Solution**: Review voice route implementation for buffer management

## Safety Guarantees

1. **Read-Only**: Only reads memory stats, never modifies application state
2. **Minimal Footprint**: Stores max 100 operations per category (~5-10MB total)
3. **Auto-Cleanup**: Periodically removes old data to prevent self-leak
4. **Fail-Safe**: If it errors, it disables itself automatically
5. **No Performance Impact**: Uses `setImmediate()` to avoid blocking operations

## Disabling

Simply remove or set to false in `.env`:

```bash
MEMORY_DIAGNOSTICS_ENABLED=false
```

Or restart the application without the env var.

## Troubleshooting

### "Failed to initialize"
Check that the `logs/` directory is writable. The system will auto-disable if it can't write logs.

### "Memory diagnostics not enabled"
Verify `MEMORY_DIAGNOSTICS_ENABLED=true` is in your `.env` file and you've restarted the application.

### Heap dumps not being created
Ensure:
1. Node is running with `--expose-gc` flag (already done in your Docker setup)
2. The `logs/heap-dumps/` directory exists and is writable
3. You've actually reached a threshold (2GB+ RSS)

## Next Steps

After collecting data for 1-2 hours:

1. Review the diagnostic log for patterns
2. Generate a final report
3. Analyze heap dumps to identify specific object types
4. Correlate findings with application code
5. Implement targeted fixes based on evidence

This system gives you **bulletproof evidence** of what's leaking without any risk of making things worse.

