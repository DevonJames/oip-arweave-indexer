# Silero VAD Model

This directory contains the Silero Voice Activity Detection (VAD) model for the enhanced STT service.

## Model Information

- **Model**: Silero VAD v4.0
- **Purpose**: Voice Activity Detection for speech preprocessing
- **Repository**: https://github.com/snakers4/silero-vad
- **License**: MIT

## Files

- `model.pt` - The main Silero VAD model (PyTorch state dict)
- `utils.pt` - Utility functions for VAD processing
- `download_model.py` - Script to download the model for offline use

## Usage

The model is automatically loaded by the enhanced STT service when `VAD_ENABLED=true`.

### Manual Download

```bash
cd models/silero_vad
python download_model.py
```

### Model Features

- **Sample Rate**: 16kHz (automatically resampled)
- **Window Size**: 512 samples (32ms at 16kHz)
- **Threshold**: Configurable (default: 0.5)
- **Performance**: ~99% accuracy on speech detection
- **Latency**: <10ms processing time

## Integration

The VAD model is integrated into the enhanced STT service:

1. **Preprocessing**: Audio is analyzed for speech segments
2. **Segmentation**: Non-speech segments are removed or reduced
3. **Optimization**: Only speech segments are sent to Whisper
4. **Performance**: Reduces Whisper processing time and improves accuracy

## Configuration

Environment variables for VAD configuration:

```bash
VAD_ENABLED=true
VAD_THRESHOLD=0.5
VAD_MIN_SPEECH_MS=200
VAD_MIN_SILENCE_MS=300
```

## Offline Operation

The model is designed for complete offline operation:
- No internet connection required after download
- Local model files stored in this directory
- No external API calls or dependencies
