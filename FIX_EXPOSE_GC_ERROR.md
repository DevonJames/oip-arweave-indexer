# Fix: "node: --expose-gc is not allowed in NODE_OPTIONS" Error

## 🔴 The Problem

If you see this error:
```
node: --expose-gc is not allowed in NODE_OPTIONS
```

This means your `.env` file has `--expose-gc` in `NODE_OPTIONS`, which is not allowed by Node.js security policy.

## ✅ Quick Fix

Run this command to update your `.env`:
```bash
# Remove --expose-gc from NODE_OPTIONS
sed -i.bak 's/--expose-gc//' .env && sed -i.bak 's/  / /g' .env
```

Or manually edit `.env` and change:
```bash
# FROM:
NODE_OPTIONS=--max-old-space-size=32768 --expose-gc

# TO:
NODE_OPTIONS=--max-old-space-size=32768
```

## 🔄 Reconfigure (Recommended)

The easiest way is to reconfigure using the updated script:

```bash
# This will automatically fix it
make set-memory-32gb
```

Then restart your services:
```bash
make down
make standard-gpu  # or whatever profile you're using
```

## ℹ️ About --expose-gc

- `--expose-gc` is **optional** and **not required** for the memory fix
- It only enables manual garbage collection via API (rarely needed)
- The important flag is `--max-old-space-size` which **does work** in NODE_OPTIONS
- The memory leak fix works perfectly without `--expose-gc`

## ✅ Verify Fix

Check your configuration:
```bash
make check-memory-config
```

Should show:
```
✓ Heap Size: 32768 MB (32.00GB)
  Full Options: --max-old-space-size=32768
```

**No --expose-gc should appear!**

---

**Status:** Fixed in latest version  
**Date:** 2025-10-11

