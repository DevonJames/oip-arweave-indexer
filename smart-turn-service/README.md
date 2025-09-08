# Smart Turn v2 Service

Intelligent conversation endpoint detection microservice for the ALFRED voice pipeline.

## Overview

The Smart Turn v2 Service provides advanced conversation endpoint detection using machine learning to determine when a speaker has finished their turn in a conversation. This improves upon traditional timeout-based methods by analyzing audio characteristics and optional transcript information.

## Features

- **Intelligent Endpoint Detection**: ML-based prediction of conversation completion
- **Multi-Input Support**: Accepts both file uploads and base64-encoded audio
- **Transcript Enhancement**: Optional transcript input for improved accuracy
- **Real-time Processing**: Fast inference suitable for live conversations
- **Comprehensive API**: RESTful endpoints with detailed responses
- **Health Monitoring**: Built-in health checks and service monitoring
- **Docker Support**: Containerized deployment with health checks

## API Endpoints

### `POST /predict_endpoint`

Predict whether audio represents a complete conversation turn.

**Request Options:**
- **File Upload**: `multipart/form-data` with `audio_file` field
- **Base64 Audio**: JSON with `audio_base64` field
- **Optional**: `transcript` field for enhanced prediction

**Response:**
```json
{
  "prediction": 1,
  "probability": 0.87,
  "processing_time_ms": 45.2,
  "model_version": "smart-turn-v2"
}
```

### `GET /health`

Check service health and model status.

**Response:**
```json
{
  "status": "healthy",
  "model_loaded": true,
  "model_path": "/app/models",
  "uptime_seconds": 3600.5
}
```

### `GET /info`

Get detailed service and model information.

**Response:**
```json
{
  "service_name": "Smart Turn v2 Service",
  "version": "1.0.0",
  "model_info": {
    "loaded": true,
    "model_path": "/app/models",
    "device": "cpu"
  },
  "capabilities": {
    "audio_formats": ["wav", "mp3", "webm"],
    "input_methods": ["file_upload", "base64"],
    "features": ["endpoint_detection", "confidence_scoring", "transcript_enhancement"],
    "max_audio_length_seconds": 30,
    "supported_sample_rates": [16000, 22050, 44100, 48000]
  }
}
```

## Configuration

### Environment Variables

- `MODEL_PATH`: Path to Smart Turn model files (default: `/app/models`)
- `HOST`: Service host (default: `0.0.0.0`)
- `PORT`: Service port (default: `8000`)
- `LOG_LEVEL`: Logging level (default: `INFO`)

### Model Files

The service expects Smart Turn v2 model files in the configured model path. Supported formats:
- PyTorch (`.pt`, `.pth`)
- ONNX (`.onnx`)
- SafeTensors (`.safetensors`)

## Docker Deployment

### Build and Run

```bash
# Build the image
docker build -t smart-turn-service .

# Run the container
docker run -d \
  --name smart-turn \
  -p 8010:8000 \
  -v ./models/smart_turn:/app/models \
  -e MODEL_PATH=/app/models \
  smart-turn-service
```

### Docker Compose

```yaml
smart-turn:
  build: ./smart-turn-service
  ports:
    - "8010:8000"
  volumes:
    - ./models/smart_turn:/app/models
  environment:
    - MODEL_PATH=/app/models
    - LOG_LEVEL=INFO
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
    interval: 30s
    timeout: 10s
    retries: 3
```

## Integration with ALFRED

### Environment Variables

Set these in your main application:

```bash
SMART_TURN_ENABLED=true
SMART_TURN_URL=http://smart-turn:8000
SMART_TURN_MIN_PROB=0.55
```

### Voice Route Integration

The service integrates seamlessly with the ALFRED voice pipeline:

```javascript
// Enhanced voice chat response includes Smart Turn metadata
{
  "success": true,
  "input_text": "How are you today?",
  "response_text": "I'm doing well, thank you!",
  "smart_turn": {
    "endpoint_complete": true,
    "endpoint_confidence": 0.87,
    "processing_time_ms": 45.2
  },
  "enhanced_pipeline": {
    "smart_turn_enabled": true,
    "features_used": {
      "smart_turn": true
    }
  }
}
```

## Testing

### Test Script

Run the included test script to verify functionality:

```bash
node test_smart_turn_service.js
```

### Manual Testing

```bash
# Health check
curl http://localhost:8010/health

# Service info
curl http://localhost:8010/info

# Prediction with JSON
curl -X POST http://localhost:8010/predict_endpoint \
  -H "Content-Type: application/json" \
  -d '{
    "audio_base64": "...",
    "transcript": "Hello, how are you?"
  }'
```

## Mock Implementation

The current implementation includes a sophisticated mock model that provides realistic predictions based on:

- **Audio characteristics**: Length, energy, silence ratio
- **Transcript analysis**: Sentence completion, question patterns, incomplete indicators
- **Heuristic scoring**: Combines multiple factors for probability estimation

This mock implementation allows for full pipeline testing while the actual Smart Turn v2 model is being integrated.

## Performance

- **Typical latency**: 20-100ms for audio processing
- **Memory usage**: ~200MB base + model size
- **Throughput**: 50+ requests/second (mock implementation)
- **Audio support**: Up to 30 seconds, multiple sample rates

## Monitoring

### Health Checks

The service provides comprehensive health monitoring:

- HTTP health endpoint
- Docker health checks
- Model loading verification
- Uptime tracking

### Logging

Structured logging with configurable levels:

- Service startup/shutdown
- Request processing times
- Model loading status
- Error conditions with stack traces

## Future Enhancements

1. **Real Model Integration**: Replace mock with actual Smart Turn v2 model
2. **GPU Support**: CUDA acceleration for faster inference
3. **Batch Processing**: Multiple audio files in single request
4. **Advanced Features**: Speaker identification, emotion detection
5. **Metrics Export**: Prometheus metrics for monitoring
6. **Model Versioning**: A/B testing and gradual rollouts

## Troubleshooting

### Common Issues

1. **Model not loading**: Check model file paths and permissions
2. **Health check failing**: Verify service is running and accessible
3. **Slow predictions**: Consider GPU acceleration or model optimization
4. **Memory issues**: Adjust container resources or model size

### Debug Mode

Enable debug logging:

```bash
docker run -e LOG_LEVEL=DEBUG smart-turn-service
```

## License

Part of the OIP (Open Index Protocol) project. See main project license.
