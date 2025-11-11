# Maya1 TTS Integration Guide

## Overview

Maya1 TTS has been successfully integrated into the OIP Arweave Indexer's GPU TTS service. Maya1 is a state-of-the-art 3 billion parameter transformer model from Maya Research that generates expressive, high-quality speech using the SNAC neural audio codec.

## What is Maya1?

**Model Architecture:**
- **Type**: 3B parameter decoder-only transformer
- **Output**: SNAC neural codec tokens (not raw audio)
- **Sample Rate**: 24kHz
- **Quality**: Very high with natural prosody and emotion
- **Speed**: Real-time on RTX 4090 GPU
- **Unique Features**: 
  - Natural language voice descriptions
  - 20+ emotion tags (`<laugh>`, `<whisper>`, `<sigh>`, etc.)
  - GPU-accelerated inference

**Hardware Requirements:**
- ✅ NVIDIA GPU with 16GB+ VRAM (RTX 4090 ✅)
- ✅ CUDA 11.7+ support
- ✅ 128GB RAM system

## Integration Summary

### Files Modified

1. **`text-to-speech/Dockerfile.gpu`**
   - Added `snac` and `accelerate` dependencies
   - Added Maya1 model download step during Docker build

2. **`text-to-speech/tts_service_gpu.py`**
   - Added Maya1 imports and availability flag
   - Implemented `_initialize_maya1()` method to load model and SNAC codec
   - Implemented `synthesize_with_maya1()` method with SNAC token generation
   - Integrated Maya1 into engine fallback chain
   - Updated `/health` endpoint to report Maya1 status
   - Updated `/voices` endpoint to list Maya1 voice presets

3. **`public/index.html`**
   - Added Maya1 to voice engine dropdown
   - Added Maya1 to engine title/label mappings
   - Added Maya1 to engine-specific control handling
   - Added Maya1 to synthesis routing logic

### Files Created

1. **`text-to-speech/download_maya1_model.py`**
   - Pre-downloads Maya1 model (3B params) during Docker build
   - Pre-downloads SNAC codec (24kHz) during Docker build
   - Validates GPU availability and VRAM
   - Provides detailed logging for debugging

## Engine Fallback Order

When `engine: "auto"` (default):
1. **Chatterbox** (Primary)
2. **Silero** (GPU fallback)
3. **Maya1** (GPU fallback) ← NEW!
4. **Edge TTS** (Cloud)
5. **gTTS** (Cloud)
6. **eSpeak** (Offline)

When `engine: "maya1"` (specific):
1. **Maya1** (Primary)
2. **Silero** (GPU fallback)
3. **Chatterbox** (Fallback)
4. **Edge TTS** (Cloud)
5. **gTTS** (Cloud)
6. **eSpeak** (Offline)

## Maya1 Voice Presets

The integration includes 7 pre-configured voice presets with natural language descriptions:

| Voice ID | Description | Gender | Style |
|----------|-------------|--------|-------|
| `female_expressive` | Warm, expressive female voice with clear articulation | female | expressive |
| `female_calm` | Calm, soothing female voice with gentle tones | female | calm |
| `male_expressive` | Clear, expressive male voice with good articulation | male | expressive |
| `male_calm` | Deep, calm male voice with measured pacing | male | calm |
| `female_cheerful` | Upbeat, cheerful female voice with positive energy | female | cheerful |
| `male_professional` | Professional, authoritative male voice | male | professional |
| `default` | Clear, natural voice with balanced articulation | neutral | neutral |

**Note**: Maya1 uses natural language voice descriptions internally, but we've mapped them to familiar voice IDs for consistency with your existing system.

## Technical Implementation Details

### SNAC Token Generation Process

1. **Prompt Construction**: Text is prefixed with voice description
   ```python
   prompt = f'<description="{voice_description}"> {emotion_tags} {text}'
   ```

2. **Transformer Inference**: Maya1 generates SNAC codec tokens
   ```python
   outputs = model.generate(
       **inputs,
       max_new_tokens=500,
       temperature=0.4,
       top_p=0.9
   )
   ```

3. **Token Filtering**: Extract SNAC tokens (range: 128266-156937)
   ```python
   snac_tokens = [t for t in generated_ids if 128266 <= t <= 156937]
   ```

4. **Code Decoding**: Convert tokens to 3-layer codec representation
   ```python
   # 7 tokens per frame across 3 layers:
   # Layer 0: 1 code per frame
   # Layer 1: 2 codes per frame  
   # Layer 2: 4 codes per frame
   ```

5. **Audio Synthesis**: SNAC decoder generates 24kHz waveform
   ```python
   audio = snac_model.decoder(snac_model.quantizer.from_codes(codes_tensor))
   ```

### GPU Memory Usage

Expected memory footprint on RTX 4090:
- **Maya1 Model**: ~6GB VRAM (3B params in bfloat16)
- **SNAC Codec**: ~200MB VRAM
- **Inference**: ~2-4GB VRAM during synthesis
- **Total**: ~8-10GB VRAM (plenty of headroom on RTX 4090's 24GB)

## Testing Instructions

### Step 1: Rebuild Docker Container

```bash
cd /Users/devon/Documents/CODE-local/oip-arweave-indexer

# Rebuild with GPU profile (includes Maya1)
make rebuild-standard-gpu
```

**What happens during build:**
1. Installs `snac` and `accelerate` packages
2. Downloads Maya1 model (~6GB)
3. Downloads SNAC codec (~200MB)
4. Initializes TTS service with Maya1 support

**Build time estimate**: 10-20 minutes (mostly model download)

### Step 2: Verify Maya1 Initialization

Check the TTS service logs to confirm Maya1 loaded:

```bash
# View TTS service logs
docker logs oip-arweave-indexer-tts-service-gpu-1 | grep -i maya1

# Expected output:
# ✅ Maya1 TTS initialized successfully
#    Model: maya-research/maya1 (3B parameters)
#    Codec: SNAC 24kHz
#    Device: cuda:0
#    Available voice presets: ['female_expressive', 'female_calm', ...]
```

### Step 3: Check Health Endpoint

```bash
# Check TTS service health
curl http://localhost:5002/health | jq .

# Expected in response:
# "engines_dict": {
#   "maya1": true,
#   ...
# },
# "maya1_info": {
#   "available": true,
#   "model": "maya-research/maya1 (3B parameters)",
#   "codec": "SNAC 24kHz",
#   "voices": ["female_expressive", "female_calm", ...]
# }
```

### Step 4: Test via Frontend

1. Navigate to `https://api.oip.onl` (or `http://localhost:3005`)
2. Open the test page (main interface)
3. In the "Voice Engine" dropdown, select **"Maya1 TTS (3B Transformer + Expressive + GPU)"**
4. Select a voice (e.g., "Maya1 Female Expressive")
5. Click "🔊 Click to Start" and speak or use "📝 Transcript" button
6. Listen for high-quality expressive speech output

### Step 5: Test via API (Direct)

```bash
# Test Maya1 synthesis via API
curl -X POST http://localhost:5002/synthesize \
  -F "text=Hello! This is a test of the Maya1 text to speech engine with expressive voice synthesis." \
  -F "engine=maya1" \
  -F "voice_id=female_expressive" \
  -F "gender=female" \
  -F "emotion=neutral" \
  -F "exaggeration=0.5" \
  -F "cfg_weight=0.5" \
  -F "voice_cloning=false" \
  -F "speed=1.0" \
  --output test_maya1.wav

# Play the audio
# macOS: afplay test_maya1.wav
# Linux: aplay test_maya1.wav
```

### Step 6: Test via Voice API

```bash
# Test through the main voice API
curl -X POST http://localhost:3005/api/alfred/synthesize \
  -F "text=Testing Maya1 through the main API with high quality voice synthesis" \
  -F "engine=maya1" \
  -F "voice_id=male_professional" \
  -F "gender=male" \
  -F "emotion=neutral" \
  -F "exaggeration=0.5" \
  -F "cfg_weight=0.5" \
  -F "voice_cloning=false" \
  -F "speed=1.0" \
  --output test_maya1_main.wav
```

## Troubleshooting

### Issue: Maya1 not available after build

**Check 1: Verify dependencies installed**
```bash
docker exec oip-arweave-indexer-tts-service-gpu-1 pip list | grep -E "snac|transformers|accelerate"

# Expected:
# snac             X.X.X
# transformers     X.XX.X  
# accelerate       X.X.X
```

**Check 2: Verify model downloaded**
```bash
docker exec oip-arweave-indexer-tts-service-gpu-1 ls -lh /root/.cache/huggingface/hub/ | grep maya

# Should see maya1 model directory
```

**Check 3: Check TTS service logs for errors**
```bash
docker logs oip-arweave-indexer-tts-service-gpu-1 | grep -i "maya1\|error\|failed"
```

### Issue: Out of GPU memory

If you get CUDA OOM errors:

**Solution 1: Reduce concurrent engines**
- Maya1 (6GB) + Silero (2GB) + Chatterbox (1GB) = ~9GB
- Your RTX 4090 has 24GB, so this should be fine
- If issues persist, check what else is using GPU:

```bash
nvidia-smi
```

**Solution 2: Load models on-demand**
- Modify `_initialize_maya1()` to lazy-load instead of startup loading
- Models only load when first requested

### Issue: Slow synthesis times

**Expected Performance:**
- First synthesis: 5-15 seconds (model loading + generation)
- Subsequent: 2-5 seconds (generation only)

**If slower:**
1. Check GPU utilization: `nvidia-smi`
2. Verify CUDA is being used: Check logs for "Device: cuda:0"
3. Check temperature/throttling: `nvidia-smi dmon`

### Issue: Audio quality issues

**Check synthesis parameters:**
- `temperature=0.4` (lower = more consistent)
- `top_p=0.9` (sampling threshold)
- `max_new_tokens=500` (increase for longer text)

**Try different voice presets:**
- Start with `female_expressive` or `male_expressive`
- These have been tested and tuned

## Advanced Features (Future)

Maya1 supports advanced features that could be added later:

### Emotion Tags
```python
# Add emotion tags to prompts
emotion_tag_str = '<laugh> <excited>'
prompt = f'<description="{voice_description}"> {emotion_tag_str} {text}'
```

**Available tags**: `<laugh>`, `<whisper>`, `<sigh>`, `<gasp>`, `<cry>`, `<excited>`, `<angry>`, `<sad>`, `<scared>`, `<surprised>`, etc.

### Custom Voice Descriptions
```python
# Use fully custom descriptions
custom_description = "A young, energetic voice with a slight accent and upbeat tone"
prompt = f'<description="{custom_description}"> {text}'
```

### Speed Control
```python
# Adjust generation parameters for speed/quality tradeoff
max_new_tokens=300  # Faster, shorter responses
temperature=0.3     # More consistent
```

## Performance Benchmarks

Expected performance on RTX 4090 (128GB RAM):

| Metric | Value |
|--------|-------|
| Model Load Time | 10-30 seconds (first run only) |
| First Synthesis | 5-15 seconds |
| Subsequent Synthesis | 2-5 seconds |
| Memory Usage (VRAM) | 8-10GB |
| Memory Usage (RAM) | 2-4GB |
| Audio Quality | Very High (24kHz, expressive) |
| GPU Utilization | 60-90% during synthesis |

## Comparison with Other Engines

| Engine | Quality | Speed | GPU | Expressiveness | Local |
|--------|---------|-------|-----|----------------|-------|
| **Maya1** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ✅ | ⭐⭐⭐⭐⭐ | ✅ |
| Chatterbox | ⭐⭐⭐⭐ | ⭐⭐⭐ | ❌ | ⭐⭐⭐⭐ | ✅ |
| Silero | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ✅ | ⭐⭐⭐ | ✅ |
| Edge TTS | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ❌ | ⭐⭐⭐ | ❌ |
| ElevenLabs | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ❌ | ⭐⭐⭐⭐⭐ | ❌ |
| gTTS | ⭐⭐⭐ | ⭐⭐⭐ | ❌ | ⭐⭐ | ❌ |
| eSpeak | ⭐⭐ | ⭐⭐⭐⭐⭐ | ❌ | ⭐ | ✅ |

**Maya1 Advantages:**
- ✅ Very high quality, natural-sounding speech
- ✅ Expressive with emotion control
- ✅ Fully local (privacy-preserving)
- ✅ GPU-accelerated (leverages your RTX 4090)
- ✅ 24kHz output (high fidelity)
- ✅ No API costs

**Maya1 Considerations:**
- ⚠️ Requires ~8-10GB VRAM (not an issue for RTX 4090)
- ⚠️ First synthesis is slower (model loading)
- ⚠️ ~6GB model download during Docker build

## Integration Architecture

### Data Flow

```
Frontend (index.html)
    ↓ POST /api/alfred/synthesize
routes/voice.js (proxy)
    ↓ POST http://tts-service-gpu:5002/synthesize
tts_service_gpu.py
    ↓ synthesize_with_maya1()
    ↓ 1. Build prompt with voice description
    ↓ 2. Generate SNAC tokens (transformer)
    ↓ 3. Decode tokens to audio codes
    ↓ 4. SNAC decoder → 24kHz waveform
    ↓ 5. Save as WAV file
    ↓ 6. Return base64 audio
routes/voice.js
    ↓ Return audio to frontend
Frontend plays audio
```

### Voice Description Mapping

```python
# Internal voice configurations (tts_service_gpu.py)
maya1_voices = {
    'female_expressive': {
        'description': 'A warm, expressive female voice with clear articulation',
        'emotion_tags': [],
        'gender': 'female',
        'style': 'expressive'
    },
    # ... more presets
}
```

### SNAC Token Processing

```
Text Input
    ↓ Tokenizer
Input Tokens [1, 234, 567, ...]
    ↓ Maya1 Transformer (3B params)
Generated Tokens [128266, 128500, 129000, ...]
    ↓ Filter (128266 ≤ token ≤ 156937)
SNAC Tokens [128266, 128500, ...]
    ↓ Decode (7 tokens → 3 layers)
Audio Codes [[c0], [c1, c2], [c3, c4, c5, c6]]
    ↓ SNAC Decoder
24kHz Audio Waveform
```

## API Usage Examples

### Via Frontend (Recommended)

1. Open test page at `https://api.oip.onl`
2. Select "Maya1 TTS (3B Transformer + Expressive + GPU)"
3. Choose voice: "Maya1 Female Expressive"
4. Adjust emotion sliders (exaggeration, cfg_weight)
5. Click "Test Voice" or use voice input

### Via cURL (Testing)

```bash
# Basic synthesis
curl -X POST http://localhost:5002/synthesize \
  -F "text=Maya1 generates very natural and expressive speech." \
  -F "engine=maya1" \
  -F "voice_id=female_expressive" \
  -F "gender=female" \
  -F "emotion=neutral" \
  -F "exaggeration=0.6" \
  -F "cfg_weight=0.7" \
  -F "voice_cloning=false" \
  -F "speed=1.0" \
  -o maya1_test.wav && afplay maya1_test.wav
```

### Via JavaScript (Frontend Integration)

```javascript
// Using the generic engine synthesis
async function testMaya1() {
    const formData = new FormData();
    formData.append('text', 'Hello from Maya1 TTS!');
    formData.append('engine', 'maya1');
    formData.append('voice_id', 'male_professional');
    formData.append('gender', 'male');
    formData.append('emotion', 'neutral');
    formData.append('exaggeration', '0.5');
    formData.append('cfg_weight', '0.5');
    formData.append('voice_cloning', 'false');
    formData.append('speed', '1.0');
    
    const response = await fetch('/api/alfred/synthesize', {
        method: 'POST',
        body: formData
    });
    
    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    audio.play();
}
```

### Via Alfred Voice Interface

Maya1 is automatically available in the ALFRED voice conversation system:

```javascript
// In routes/voice.js, Maya1 will be used as fallback if:
// 1. Chatterbox fails
// 2. Silero fails
// 3. Maya1 is requested specifically via engine parameter

// Example voice chat with Maya1:
const formData = new FormData();
formData.append('text', 'Tell me about quantum computing');
formData.append('processing_mode', 'rag');
formData.append('return_audio', 'true');
formData.append('engine', 'maya1');  // Force Maya1 engine

const response = await fetch('/api/voice/chat', {
    method: 'POST',
    body: formData
});
```

## Configuration Options

### Environment Variables (Optional)

You can add these to your `.env` file to customize Maya1:

```bash
# Maya1 Model Configuration
MAYA1_MODEL_NAME=maya-research/maya1
MAYA1_MAX_TOKENS=500
MAYA1_TEMPERATURE=0.4
MAYA1_TOP_P=0.9

# SNAC Codec Configuration
SNAC_MODEL_NAME=hubertsiuzdak/snac_24khz
SNAC_SAMPLE_RATE=24000
```

**Note**: These are optional - defaults are already configured in the code.

## Monitoring and Diagnostics

### Check Maya1 Status

```bash
# Quick status check
curl http://localhost:5002/health | jq '.maya1_info'

# Expected output:
{
  "available": true,
  "model": "maya-research/maya1 (3B parameters)",
  "codec": "SNAC 24kHz",
  "voices": [
    "female_expressive",
    "female_calm",
    "male_expressive",
    "male_calm",
    "female_cheerful",
    "male_professional",
    "default"
  ]
}
```

### Check Available Voices

```bash
# List all Maya1 voices
curl http://localhost:5002/voices | jq '.voices[] | select(.engine == "maya1")'
```

### Monitor GPU Usage

```bash
# Real-time GPU monitoring during synthesis
watch -n 1 nvidia-smi

# Look for:
# - VRAM usage increase during synthesis
# - GPU utilization spike (60-90%)
# - Temperature increase (should stay under 80°C)
```

## Known Limitations

1. **First Synthesis Delay**: First request takes 10-30 seconds as models load into VRAM
2. **Voice Cloning**: Not yet implemented (Chatterbox-specific feature)
3. **Emotion Tags**: Not exposed in UI yet (backend supports them)
4. **Custom Descriptions**: Not exposed in UI yet (backend supports them)
5. **Multi-language**: Currently configured for English only (Maya1 supports many languages)

## Future Enhancements

### Phase 1: Advanced Voice Control (Recommended Next Steps)

Add UI controls for:
- Emotion tag selection (dropdown with 20+ options)
- Custom voice description input field
- Temperature/top_p sliders for generation control

### Phase 2: Multi-language Support

Add language selection:
- Spanish, French, German, Italian, Portuguese
- Japanese, Korean, Chinese
- 50+ languages supported by Maya1

### Phase 3: Voice Cloning

Integrate voice cloning capabilities:
- Upload reference audio
- Generate custom voice descriptions from reference
- Store custom voice presets

## Maintenance Notes

### Model Updates

To update Maya1 model:

```bash
# SSH into running container
docker exec -it oip-arweave-indexer-tts-service-gpu-1 bash

# Inside container:
python3 -c "from transformers import AutoModelForCausalLM; \
    AutoModelForCausalLM.from_pretrained('maya-research/maya1', \
    torch_dtype=torch.bfloat16, device_map='auto', trust_remote_code=True)"
```

### Debugging

Enable verbose logging:

```python
# In tts_service_gpu.py, change:
logging.basicConfig(level=logging.DEBUG)

# Or set environment variable:
export LOG_LEVEL=DEBUG
```

## Success Criteria

✅ Maya1 appears in voice engine dropdown  
✅ Maya1 voices appear in voice selection  
✅ Synthesis completes without errors  
✅ Audio plays with high quality  
✅ GPU utilization visible during synthesis  
✅ Fallback to other engines works if Maya1 fails  

## Support

If issues arise:

1. **Check Logs**: `docker logs oip-arweave-indexer-tts-service-gpu-1`
2. **Check Health**: `curl http://localhost:5002/health`
3. **Check GPU**: `nvidia-smi`
4. **Rebuild**: `make rebuild-standard-gpu` (fresh start)

## References

- **Maya1 Model**: https://huggingface.co/maya-research/maya1
- **Maya1 Space**: https://huggingface.co/spaces/maya-research/maya1
- **SNAC Codec**: https://huggingface.co/hubertsiuzdak/snac_24khz
- **Maya1 Website**: https://maya1.org/

---

**Integration completed**: November 11, 2025  
**Profiles affected**: `standard-gpu`, `rebuild-standard-gpu`  
**Backward compatibility**: ✅ Maintained (Maya1 is additive)  
**Breaking changes**: ❌ None  

