# Kokoro TTS Service

High-quality neural text-to-speech service with intelligent fallback engines.

## Overview

The Kokoro TTS Service provides advanced text-to-speech capabilities with multiple engine support:

- **Kokoro TTS**: Primary high-quality neural TTS engine
- **Coqui TTS**: Open-source high-quality alternative
- **Piper TTS**: Fast and lightweight synthesis
- **eSpeak NG**: Reliable fallback engine

## Features

### 🎯 **Multi-Engine Architecture**
- **Primary Engine**: Kokoro TTS for highest quality
- **Intelligent Fallback**: Automatic engine switching on failure
- **Performance Optimization**: Engine selection based on requirements

### 🚀 **High Performance**
- **Caching System**: Intelligent audio caching for repeated requests
- **Concurrent Processing**: Async synthesis for better throughput
- **Memory Optimization**: Efficient audio processing and storage

### 🔧 **Flexible Configuration**
- **Voice Selection**: Multiple voices per engine
- **Language Support**: Multi-language synthesis
- **Quality Settings**: Configurable sample rates and formats

### 📊 **Monitoring & Metrics**
- **Health Checks**: Comprehensive service monitoring
- **Performance Metrics**: Processing time and quality tracking
- **Engine Status**: Real-time engine availability

## API Endpoints

### Core Synthesis

#### `POST /synthesize`
Synthesize text to speech with JSON response.

```json
{
  "text": "Hello, this is a test.",
  "voice": "en_female_01",
  "language": "en",
  "speed": 1.0,
  "engine": "kokoro"
}
```

**Response:**
```json
{
  "audio_data": "base64_encoded_audio",
  "text": "Hello, this is a test.",
  "voice": "en_female_01",
  "language": "en",
  "engine": "kokoro",
  "processing_time_ms": 245.3,
  "audio_duration_ms": 1500.0,
  "format": "wav",
  "sample_rate": 22050,
  "cached": false
}
```

#### `POST /synthesize_to_file`
Synthesize text and return audio file directly.

### Service Information

#### `GET /health`
Service health check and engine status.

#### `GET /engines`
List available engines and their capabilities.

#### `GET /voices`
List available voices for each engine.

## Configuration

### Environment Variables

```bash
# Primary TTS engine
TTS_PRIMARY_ENGINE=kokoro

# Fallback engines (comma-separated)
TTS_FALLBACK_ENGINES=coqui,piper,espeak

# Model storage
MODEL_STORAGE_PATH=/app/models

# Caching
CACHE_ENABLED=true
CACHE_DIR=/app/cache

# Audio settings
DEFAULT_VOICE=en_female_01
SAMPLE_RATE=22050
AUDIO_FORMAT=wav
```

### Engine Priority

1. **Kokoro TTS** - Highest quality, natural speech
2. **Coqui TTS** - High quality, open-source
3. **Piper TTS** - Fast synthesis, good quality
4. **eSpeak NG** - Reliable fallback, always available

## Installation

### Docker (Recommended)

```bash
# Build the service
docker build -t kokoro-tts-service .

# Run the service
docker run -p 8000:8000 \
  -e TTS_PRIMARY_ENGINE=kokoro \
  -e CACHE_ENABLED=true \
  -v ./models:/app/models \
  kokoro-tts-service
```

### Local Development

```bash
# Install dependencies
pip install -r requirements.txt

# Run the service
uvicorn kokoro_tts_service:app --host 0.0.0.0 --port 8000
```

## Usage Examples

### Basic Synthesis

```python
import requests

response = requests.post('http://localhost:8000/synthesize', json={
    'text': 'Hello, world!',
    'voice': 'en_female_01'
})

result = response.json()
print(f"Synthesized with {result['engine']} in {result['processing_time_ms']:.1f}ms")
```

### Engine-Specific Synthesis

```python
# Request specific engine
response = requests.post('http://localhost:8000/synthesize', json={
    'text': 'This is a test of the Coqui TTS engine.',
    'engine': 'coqui',
    'voice': 'ljspeech'
})
```

### File Download

```python
response = requests.post('http://localhost:8000/synthesize_to_file', json={
    'text': 'Download this as an audio file.',
    'voice': 'en_male_01'
})

with open('synthesis.wav', 'wb') as f:
    f.write(response.content)
```

## Performance Characteristics

### Engine Comparison

| Engine | Quality | Speed | Memory | Use Case |
|--------|---------|-------|--------|----------|
| **Kokoro** | Excellent | Medium | High | Production speech |
| **Coqui** | Very Good | Medium | Medium | High-quality backup |
| **Piper** | Good | Fast | Low | Real-time applications |
| **eSpeak** | Basic | Very Fast | Very Low | Fallback/accessibility |

### Expected Performance

- **Processing Time**: 200-800ms for typical sentences
- **Audio Quality**: 22kHz, 16-bit WAV output
- **Cache Hit Rate**: 80-90% for repeated content
- **Memory Usage**: 500MB-2GB depending on loaded engines

## Integration

### With Voice Pipeline

The Kokoro TTS service integrates seamlessly with the enhanced voice pipeline:

```javascript
// In routes/voice.js
const TTS_SERVICE_URL = process.env.TTS_SERVICE_URL || 'http://kokoro-tts:8000';

const ttsResponse = await axios.post(`${TTS_SERVICE_URL}/synthesize`, {
    text: processedText,
    voice: selectedVoice,
    engine: 'kokoro'
});
```

### Health Monitoring

```javascript
// Check service health
const health = await axios.get(`${TTS_SERVICE_URL}/health`);
console.log(`Available engines: ${health.data.available_engines.join(', ')}`);
```

## Development Notes

### Mock Implementation

The current implementation includes mock engines for development and testing:

- **Kokoro Engine**: Generates sine wave audio based on text characteristics
- **Actual Integration**: Ready for real Kokoro TTS model integration
- **Fallback Testing**: All engines can be tested independently

### Production Deployment

For production deployment:

1. **Model Download**: Ensure Kokoro TTS models are available
2. **GPU Support**: Configure CUDA for accelerated synthesis
3. **Caching**: Enable Redis for distributed caching
4. **Monitoring**: Set up health check monitoring
5. **Load Balancing**: Deploy multiple instances for high availability

## Troubleshooting

### Common Issues

1. **Engine Not Loading**
   - Check model files are available
   - Verify dependencies are installed
   - Review logs for specific errors

2. **Poor Audio Quality**
   - Ensure correct sample rate settings
   - Check engine-specific configuration
   - Verify model integrity

3. **High Latency**
   - Enable caching for repeated requests
   - Consider using faster engines for real-time needs
   - Check system resources and GPU availability

### Debug Commands

```bash
# Check engine status
curl http://localhost:8000/engines

# Test synthesis
curl -X POST http://localhost:8000/synthesize \
  -H "Content-Type: application/json" \
  -d '{"text": "Test synthesis", "engine": "kokoro"}'

# Monitor health
curl http://localhost:8000/health
```

## Future Enhancements

### Planned Features

1. **Voice Cloning**: Custom voice model training
2. **SSML Support**: Advanced speech markup
3. **Streaming Synthesis**: Real-time audio streaming
4. **Multi-Speaker**: Conversation synthesis
5. **Emotion Control**: Emotional speech synthesis

### Model Upgrades

1. **Latest Kokoro Models**: Integration with newest releases
2. **Custom Models**: Support for fine-tuned models
3. **Multi-Language**: Extended language support
4. **Voice Conversion**: Real-time voice transformation

## License

This service is designed to work with various TTS engines, each with their own licensing:

- **Kokoro TTS**: Check Kokoro TTS repository for licensing
- **Coqui TTS**: Mozilla Public License 2.0
- **Piper TTS**: MIT License
- **eSpeak NG**: GNU General Public License v3.0

Ensure compliance with all engine licenses in production deployments.
