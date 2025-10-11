# Quick Start: Memory Leak Fix for 128GB Systems

## 🎯 Two Simple Steps

### Step 1: Set Memory Allocation (Once)
```bash
make set-memory-16gb
```

### Step 2: Start Your Services (As Usual)
```bash
make standard
# or any other profile: backend-only, minimal, standard-gpu, etc.
```

That's it! The memory configuration persists in your `.env` file.

---

## 📋 Available Memory Presets

| Command | Heap Size | Best For |
|---------|-----------|----------|
| `make set-memory-8gb` | 8GB | Light usage, testing |
| `make set-memory-16gb` | 16GB | **Recommended for 128GB systems** |
| `make set-memory-32gb` | 32GB | High-volume indexing |
| `make set-memory-64gb` | 64GB | Maximum performance |

---

## 🔍 Check Your Configuration

```bash
# See current memory settings
make check-memory-config

# Example output:
# ✓ Heap Size: 16384 MB (16.00GB)
#   Full Options: --max-old-space-size=16384 --expose-gc
# System Memory: 131072MB
```

---

## 🚀 Complete Workflow Example

```bash
# 1. Configure memory (first time only)
make set-memory-16gb

# 2. Start your preferred profile
make standard

# 3. Monitor memory usage
curl http://localhost:3005/api/health/memory | jq

# 4. Check everything is running
make status
```

---

## 🔄 Change Memory Later

```bash
# If you need more memory later
make set-memory-32gb

# Then restart your services
make down
make standard
```

---

## 💡 What This Does

1. **Fixes the Memory Leak**: Auto-clears GUN sync cache every hour
2. **Increases Heap Size**: Sets Node.js to use 16GB+ instead of default ~4GB
3. **Persists Configuration**: Stored in `.env`, so it survives restarts
4. **Works with Make**: Use your existing `make` commands normally

---

## 📊 Before vs After

| Metric | Before Fix | After Fix |
|--------|------------|-----------|
| Heap Limit | ~4GB | 16GB+ (configurable) |
| Runtime | Crashes after hours | Runs indefinitely |
| Memory Growth | Unbounded | Stable, clears hourly |
| Cache Management | None | Automatic |

---

## 🆘 Troubleshooting

### Memory still growing?
```bash
# Check if configuration is active
make check-memory-config

# Manually clear cache if needed
curl -X POST http://localhost:3005/api/health/memory/clear-cache
```

### Want to monitor continuously?
```bash
# Watch memory usage
watch -n 5 'curl -s http://localhost:3005/api/health/memory | jq ".heap.utilization"'
```

### Need more detailed diagnostics?
```bash
# Run diagnostic tool
node scripts/diagnose-memory.js

# Take heap snapshot for analysis
node scripts/diagnose-memory.js snapshot
```

---

## 📁 Files Modified

- ✅ `helpers/gunSyncService.js` - Fixed unbounded cache
- ✅ `routes/health.js` - Added memory monitoring endpoints
- ✅ `Makefile` - Added memory configuration targets
- ✅ `set-memory.sh` - Memory configuration script
- ✅ `.env` - NODE_OPTIONS added (after running set-memory)

---

**Last Updated:** 2025-10-11  
**For Systems:** 128GB RAM  
**Recommended Setting:** 16GB-32GB heap

