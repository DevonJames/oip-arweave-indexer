# Deploy Memory Diagnostics to Remote FitnessAlly Server

## Step 1: Enable Memory Diagnostics

SSH to your remote server and run:

```bash
cd /path/to/oip-arweave-indexer  # (wherever your fitnessally stack is)

# Add the environment variable
echo "MEMORY_DIAGNOSTICS_ENABLED=true" >> .env

# Create the heap dumps directory
mkdir -p logs/heap-dumps

# Verify it was added
grep MEMORY_DIAGNOSTICS .env
```

You should see:
```
MEMORY_DIAGNOSTICS_ENABLED=true
```

## Step 2: Restart the Container

This will pick up the new environment variable:

```bash
docker-compose restart
```

Or if you have a specific service name:

```bash
docker-compose restart oip-gpu
# or whatever your service is called in docker-compose.yml
```

## Step 3: Start Monitoring

### Monitor the diagnostic log (MOST IMPORTANT):

```bash
tail -f logs/memory-diagnostics.log
```

You should immediately see output like:
```
[2025-12-09T...] [INIT] Memory Diagnostics enabled
[2025-12-09T...] [INIT] Baseline memory: RSS: 500MB, Heap: 250MB, External: 50MB
[2025-12-09T...] [PERIODIC] Current: RSS: 550MB... | Growth rate: RSS 5.0 MB/min
```

If you DON'T see this, the environment variable didn't get picked up. Try:
```bash
docker-compose down
docker-compose up -d
```

### Monitor Docker stats:

In another terminal:
```bash
watch -n 10 'docker stats --no-stream'
```

### Monitor container logs:

```bash
docker logs -f <container-name> | grep -E "(Memory Monitor|Static GIF|7500 record|404 cache)"
```

## Step 4: Let It Run

Let it run for **30-60 minutes** while you use the app normally (browsing exercises, viewing GIFs, etc.)

## Step 5: Check Results

After 30-60 minutes, check the diagnostic log:

```bash
tail -200 logs/memory-diagnostics.log | less
```

Look for:

### Good Signs ✅
```
[PERIODIC] Growth rate: RSS 2.0 MB/min, External 5.0 MB/min
# Low, steady growth
```

### Bad Signs ❌
```
[PERIODIC] Growth rate: RSS 50.0 MB/min, External 450.0 MB/min
[GROWTH] GET /api/records: RSS +250MB, External +500MB
[SUMMARY] api_records: 150 operations, Total Growth: External +12000MB
# High growth, specific operation causing massive spikes
```

### What the Categories Mean

The diagnostics will group operations into categories:

- **`api_records`** = `/api/records` queries (with resolveDepth, drefs)
- **`api_media`** = `/api/media/:id` (direct file serving)
- **`static_media`** = `/media/` static GIF files
- **`gun_sync`** = Background GUN synchronization
- **`es_query`** = Elasticsearch queries
- **`other_api`** = All other API routes

## Step 6: Analyze Heap Dumps (if needed)

If memory grows above 2GB, automatic heap dumps will be saved:

```bash
ls -lh logs/heap-dumps/
```

Copy one to your local machine:

```bash
scp user@server:/path/to/logs/heap-dumps/heapdump_threshold_2048MB_*.heapsnapshot ~/Downloads/
```

Then:
1. Open Chrome
2. Press F12 (DevTools)
3. Go to "Memory" tab
4. Click "Load" button
5. Select the `.heapsnapshot` file
6. Sort by "Retained Size" descending to see what's taking up memory

## Troubleshooting

### "No such file: logs/memory-diagnostics.log"

The environment variable isn't being read. Try:

```bash
# Check if it's really in .env
cat .env | grep MEMORY

# Force container rebuild
docker-compose down
docker-compose up -d
```

### "Memory Diagnostics not enabled"

In the container logs, you see:
```
⚠️ [Memory Diagnostics] MEMORY_DIAGNOSTICS_ENABLED is not set to 'true'. Skipping.
```

This means the `.env` file change didn't reach the container. Try:

```bash
# Check the container's environment
docker exec <container-name> env | grep MEMORY

# If empty, rebuild:
docker-compose down
docker-compose up -d --force-recreate
```

## What to Report Back

After 30-60 minutes of running, send me:

1. **Last 200 lines of diagnostic log:**
   ```bash
   tail -200 logs/memory-diagnostics.log
   ```

2. **Current Docker stats:**
   ```bash
   docker stats --no-stream
   ```

3. **Any SUMMARY entries from the log:**
   ```bash
   grep "\[SUMMARY\]" logs/memory-diagnostics.log | tail -20
   ```

This will tell us EXACTLY which operation is leaking! 🎯

