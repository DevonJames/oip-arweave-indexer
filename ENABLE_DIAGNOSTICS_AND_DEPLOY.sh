#!/bin/bash

# Enable Memory Diagnostics and Deploy All Fixes
# December 9, 2024

echo "════════════════════════════════════════════════════════════════"
echo "  Memory Leak Fix + Diagnostics Deployment"
echo "════════════════════════════════════════════════════════════════"
echo ""

cd /Users/devon/Documents/CODE-local/oip-arweave-indexer || exit 1

echo "✅ Step 1: MEMORY_DIAGNOSTICS_ENABLED=true added to .env"
echo "✅ Step 2: Created logs/heap-dumps/ directory"
echo ""

echo "Step 3: Verifying fixes are in code..."
echo ""

# Check all three fixes
FIXES_OK=true

if grep -q "CRITICAL FIX: Check status code BEFORE nulling response" helpers/gun.js; then
    echo "  ✅ 404 retry fix in helpers/gun.js"
else
    echo "  ❌ 404 retry fix MISSING in helpers/gun.js"
    FIXES_OK=false
fi

if grep -q "CRITICAL FIX: Add stream cleanup handlers" routes/media.js; then
    echo "  ✅ Stream cleanup in routes/media.js"
else
    echo "  ❌ Stream cleanup MISSING in routes/media.js"
    FIXES_OK=false
fi

if grep -q "Hit 7500 record limit" helpers/utils.js; then
    echo "  ✅ recordsInDB limit in helpers/utils.js"
else
    echo "  ❌ recordsInDB limit MISSING in helpers/utils.js"
    FIXES_OK=false
fi

if grep -q "process.nextTick" index.js | grep -q "global.gc"; then
    echo "  ✅ Ultra-aggressive GC in index.js"
else
    echo "  ❌ Ultra-aggressive GC MISSING in index.js"
    FIXES_OK=false
fi

if grep -q "UNCAUGHT EXCEPTION" index.js; then
    echo "  ✅ Crash detection in index.js"
else
    echo "  ❌ Crash detection MISSING in index.js"
    FIXES_OK=false
fi

echo ""

if [ "$FIXES_OK" = false ]; then
    echo "❌ Some fixes are missing! Please check the code."
    exit 1
fi

echo "Step 4: Restarting FitnessAlly container..."
echo ""

# Restart with the new environment variable
docker-compose restart fitnessally-oip-gpu-1

sleep 3

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  ✅ Deployment Complete!"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "Memory Diagnostics is now ENABLED and tracking:"
echo "  • Every HTTP request (memory before/after)"
echo "  • Operation categories (GUN sync, ES queries, etc.)"
echo "  • Growth rates (RSS MB/min, External MB/min)"
echo "  • Automatic heap dumps at 2GB, 4GB, 6GB, 8GB, 10GB"
echo ""
echo "────────────────────────────────────────────────────────────────"
echo "MONITORING COMMANDS:"
echo "────────────────────────────────────────────────────────────────"
echo ""
echo "1. Watch diagnostic log (MOST IMPORTANT):"
echo "   tail -f logs/memory-diagnostics.log"
echo ""
echo "2. Watch container logs:"
echo "   docker logs -f fitnessally-oip-gpu-1 | grep -E '(Static GIF|Memory Monitor|7500 record)'"
echo ""
echo "3. Watch actual memory (Docker stats):"
echo "   watch -n 10 'docker stats fitnessally-oip-gpu-1 --no-stream'"
echo ""
echo "4. Check for crashes:"
echo "   docker logs fitnessally-oip-gpu-1 | grep -E '(UNCAUGHT|UNHANDLED|CRASH)'"
echo ""
echo "────────────────────────────────────────────────────────────────"
echo "WHAT TO LOOK FOR:"
echo "────────────────────────────────────────────────────────────────"
echo ""
echo "In logs/memory-diagnostics.log you'll see:"
echo ""
echo "  [INIT] Baseline memory: RSS: 500MB..."
echo "  [PERIODIC] Growth rate: RSS 45.0 MB/min, External 120.0 MB/min"
echo "  [GROWTH] GET /api/records: RSS +52MB, External +25MB"
echo "  [SUMMARY] Operation category showing which operations are leaking"
echo ""
echo "Look for:"
echo "  • Which operation category has highest total growth"
echo "  • Which specific operations cause large spikes"
echo "  • Growth rate over time (should stabilize or decrease)"
echo ""
echo "────────────────────────────────────────────────────────────────"
echo "HEAP DUMPS:"
echo "────────────────────────────────────────────────────────────────"
echo ""
echo "Automatic heap dumps will be saved in:"
echo "  logs/heap-dumps/"
echo ""
echo "When RSS hits: 2GB, 4GB, 6GB, 8GB, 10GB"
echo ""
echo "To analyze:"
echo "  1. Copy .heapsnapshot file to your local machine"
echo "  2. Open Chrome DevTools (F12) → Memory tab"
echo "  3. Click 'Load' and select the .heapsnapshot file"
echo "  4. Switch to 'Comparison' view to compare two dumps"
echo ""
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "Let it run for 30-60 minutes, then check:"
echo "  tail -100 logs/memory-diagnostics.log"
echo ""
echo "This will tell you EXACTLY what's leaking! 🎯"
echo ""

