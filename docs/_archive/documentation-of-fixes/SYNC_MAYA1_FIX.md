# Syncing Maya1 PyTorch 2.1 Fix to Server

## Quick Fix: Sync Updated Dockerfile

The `text-to-speech/Dockerfile.gpu` has been updated locally with PyTorch 2.1.0. 
You need to sync it to your server.

### Option A: Git Sync (Recommended)

```bash
# On your local machine
cd /Users/devon/Documents/CODE-local/oip-arweave-indexer
git add text-to-speech/Dockerfile.gpu text-to-speech/tts_service_gpu.py
git commit -m "Fix Maya1 TTS: Upgrade PyTorch to 2.1.0 for SNAC compatibility"
git push

# On your server
cd ~/Desktop/development/fitnessally/oip-arweave-indexer
git pull
make rebuild-standard-gpu
```

### Option B: Direct File Copy

```bash
# From your local machine, copy the file to server
scp text-to-speech/Dockerfile.gpu jfcc02@your-server:~/Desktop/development/fitnessally/oip-arweave-indexer/text-to-speech/Dockerfile.gpu
scp text-to-speech/tts_service_gpu.py jfcc02@your-server:~/Desktop/development/fitnessally/oip-arweave-indexer/text-to-speech/tts_service_gpu.py

# Then on server, rebuild
cd ~/Desktop/development/fitnessally/oip-arweave-indexer
make rebuild-standard-gpu
```

## What Changed

1. **PyTorch upgraded**: 2.0.0 → 2.1.0 (required for SNAC `weight_norm` import)
2. **CUDA wheels**: Using cu118 (backward compatible with CUDA 11.7 runtime)
3. **Better error handling**: Added PyTorch version checks and clearer error messages

## Verification

After rebuilding, check:
```bash
docker logs fitnessally-tts-service-gpu-1 | grep -i "pytorch\|weight_norm\|maya1"
```

You should see:
- `✅ PyTorch 2.1.x installed successfully`
- `✅ weight_norm import successful`
- `✅ Maya1 TTS dependencies imported successfully`

Test endpoint:
```bash
curl http://100.124.42.82:8015/test-maya1 | jq .
```

The `snac` import should now succeed.

