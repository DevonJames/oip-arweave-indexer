# Photo Upload & Analysis Implementation Guide

## Overview

This implementation adds comprehensive photo upload and analysis functionality to the ALFRED voice assistant interface, integrating Grok-4's advanced image analysis capabilities with the existing conversational AI system.

## Architecture

### Backend Components

#### 1. Photo Upload Endpoint (`/api/photo/upload`)
- **Purpose**: Securely upload and cache photos temporarily
- **Storage**: Local filesystem with automatic cleanup
- **Security**: File type validation, size limits (20MB)
- **Caching**: 24-hour expiration with periodic cleanup

#### 2. Photo Analysis Endpoint (`/api/photo/analyze`)
- **Purpose**: Analyze cached photos using Grok-4 vision model
- **Integration**: Direct API calls to X.AI's Grok-4 service
- **Features**: Question-based analysis, metadata tracking

#### 3. Photo Chat Endpoint (`/api/photo/chat`)
- **Purpose**: Integrated photo analysis with ALFRED's conversational system
- **Features**: RAG integration, TTS support, conversation history
- **Workflow**: Photo analysis → Context enhancement → ALFRED processing

### Frontend Components

#### 1. Photo Upload UI
- **Location**: New camera button (📷) in control dock
- **Interface**: Modal dialog with drag-drop support
- **Features**: Live preview, file validation, progress feedback

#### 2. Integration with ALFRED
- **Seamless workflow**: Upload → Analyze → Chat response
- **Voice support**: TTS synthesis of analysis results
- **Visual feedback**: Status indicators and progress messages

## Implementation Details

### Backend Setup

1. **Environment Variables Required**:
```bash
GROK_API_KEY=your_grok_api_key_here
# OR
XAI_API_KEY=your_xai_api_key_here

# Optional: Custom API URL
GROK_API_URL=https://api.x.ai/v1/chat/completions
```

2. **Dependencies Added**:
- `multer` - File upload handling
- `crypto` - Unique ID generation
- `axios` - HTTP client for Grok API

3. **File Structure**:
```
routes/photo.js              # Main photo API routes
temp_photos/                 # Temporary photo cache (auto-created)
├── {photoId}.jpg           # Cached photo files
├── {photoId}.meta.json     # Photo metadata
└── ...
```

### Frontend Integration

1. **New UI Elements**:
```html
<!-- Added to control dock -->
<button class="btn" id="btnPhoto" title="Upload and analyze photo">📷</button>
```

2. **CSS Updates**:
```css
/* Updated grid layout for new photo button */
.control-dock {
  grid-template-columns: auto auto auto auto auto auto 1fr;
}
```

3. **JavaScript Enhancements**:
- Photo upload dialog creation
- File selection and preview
- Integration with existing chat system
- Error handling and status feedback

## API Endpoints

### POST /api/photo/upload
Upload a photo for analysis.

**Request**:
```javascript
FormData with 'photo' file field
```

**Response**:
```json
{
  "success": true,
  "photoId": "abc123...",
  "filename": "image.jpg",
  "size": 1234567,
  "mimetype": "image/jpeg",
  "message": "Photo uploaded and cached successfully",
  "expiresIn": "24 hours"
}
```

### POST /api/photo/analyze
Analyze a cached photo with Grok-4.

**Request**:
```json
{
  "photoId": "abc123...",
  "question": "What do you see in this image?",
  "model": "grok-4"
}
```

**Response**:
```json
{
  "success": true,
  "photoId": "abc123...",
  "question": "What do you see in this image?",
  "analysis": "I can see a beautiful landscape with mountains...",
  "model": "grok-4",
  "processingTimeMs": 1234,
  "photoInfo": {
    "filename": "image.jpg",
    "size": 1234567,
    "uploadedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

### POST /api/photo/chat
Integrated photo analysis with ALFRED's chat system.

**Request**:
```json
{
  "photoId": "abc123...",
  "question": "Explain what's happening in this photo",
  "model": "grok-4",
  "processing_mode": "rag",
  "return_audio": true,
  "voiceConfig": "{\"engine\":\"elevenlabs\",\"voice_id\":\"daniel\"}",
  "conversationHistory": []
}
```

**Response**:
```json
{
  "success": true,
  "response": "Based on the image analysis, I can see...",
  "image_analysis": "Raw Grok-4 analysis...",
  "audio_data": "base64_encoded_audio_data",
  "processing_mode": "rag",
  "model": "grok-4",
  "photoInfo": {
    "filename": "image.jpg",
    "uploadedAt": "2024-01-15T10:30:00.000Z"
  },
  "processingTimeMs": 2345
}
```

### GET /api/photo/info/:photoId
Get information about a cached photo.

### DELETE /api/photo/:photoId
Manually delete a cached photo.

### GET /api/photo/health
Health check for photo service.

## Security Considerations

### File Upload Security
- **File type validation**: Only image formats allowed
- **Size limits**: 20MB maximum file size
- **Temporary storage**: Files automatically deleted after 24 hours
- **Unique IDs**: Crypto-secure random IDs prevent guessing

### API Security
- **Environment variables**: API keys stored securely
- **Error handling**: Sanitized error messages
- **Rate limiting**: Inherits from main application
- **CORS**: Configured for mac-client origins

## Usage Workflow

### 1. User Interaction
1. User clicks camera button (📷) in ALFRED interface
2. Photo upload dialog appears
3. User selects image file (drag-drop or click)
4. Live preview shows selected image
5. User enters question about the image
6. Click "Upload & Analyze" button

### 2. Backend Processing
1. Photo uploaded to temporary cache
2. Unique photo ID generated and returned
3. Photo sent to Grok-4 for analysis
4. Analysis integrated with ALFRED's RAG system
5. Response generated (text + optional TTS)

### 3. Response Delivery
1. Analysis appears in chat conversation
2. Audio response plays (if enabled)
3. Visual text display (if on-screen mode)
4. Photo automatically expires after 24 hours

## Configuration Options

### Grok-4 Settings
```javascript
// In photo.js
const grokApiUrl = process.env.GROK_API_URL || 'https://api.x.ai/v1/chat/completions';

// Request parameters
{
  model: 'grok-4',
  max_tokens: 1000,
  temperature: 0.7
}
```

### Cache Settings
```javascript
// Cache cleanup interval (1 hour)
const CACHE_CLEANUP_INTERVAL = 60 * 60 * 1000;

// Maximum cache age (24 hours)
const MAX_CACHE_AGE = 24 * 60 * 60 * 1000;
```

### File Upload Limits
```javascript
// Maximum file size (20MB)
fileSize: 20 * 1024 * 1024

// Allowed MIME types
const allowedMimes = [
  'image/jpeg', 'image/jpg', 'image/png',
  'image/gif', 'image/webp', 'image/bmp',
  'image/tiff', 'image/svg+xml'
];
```

## Error Handling

### Common Errors and Solutions

#### 1. "Grok API key not configured"
**Solution**: Set `GROK_API_KEY` or `XAI_API_KEY` environment variable

#### 2. "Photo not found"
**Solution**: Photo may have expired (24h limit) or upload failed

#### 3. "Invalid image format"
**Solution**: Use supported formats: JPEG, PNG, GIF, WebP, BMP, TIFF, SVG

#### 4. "File too large"
**Solution**: Reduce image size to under 20MB

#### 5. "Analysis failed"
**Solution**: Check Grok API status and network connectivity

### Error Response Format
```json
{
  "error": "Error type",
  "message": "Human-readable error message",
  "details": "Additional technical details (optional)"
}
```

## Testing

### Manual Testing Steps

1. **Upload Test**:
   ```bash
   curl -X POST http://localhost:3005/api/photo/upload \
     -F "photo=@test-image.jpg"
   ```

2. **Analysis Test**:
   ```bash
   curl -X POST http://localhost:3005/api/photo/analyze \
     -H "Content-Type: application/json" \
     -d '{"photoId":"abc123","question":"What is in this image?"}'
   ```

3. **Health Check**:
   ```bash
   curl http://localhost:3005/api/photo/health
   ```

### Frontend Testing
1. Open ALFRED interface: `http://localhost:3001/alfred`
2. Click camera button (📷)
3. Upload test image
4. Enter analysis question
5. Verify response in conversation

## Performance Considerations

### Optimization Features
- **Temporary caching**: Reduces redundant uploads
- **Automatic cleanup**: Prevents storage bloat
- **Efficient file handling**: Streams and buffers
- **Error boundaries**: Graceful degradation

### Monitoring Metrics
- Upload success/failure rates
- Analysis response times
- Cache hit/miss ratios
- Storage usage trends

## Future Enhancements

### Planned Features
1. **Batch analysis**: Multiple photos in single request
2. **Advanced filters**: Image preprocessing options
3. **History tracking**: Photo analysis history
4. **Export options**: Save analyses to records
5. **Voice upload**: Describe photos via voice

### Integration Opportunities
1. **OIP Records**: Save analyses as permanent records
2. **Media distribution**: Share analyzed photos
3. **Workflow automation**: Trigger actions based on analysis
4. **Multi-modal**: Combine with audio/video analysis

## Troubleshooting

### Common Issues

#### Mac Client Connection
- Ensure backend is running on correct port
- Check CORS configuration for localhost:3001
- Verify API endpoints are accessible

#### Grok API Issues
- Validate API key format and permissions
- Check rate limiting and quota usage
- Monitor API response status codes

#### File Upload Problems
- Verify multer configuration
- Check disk space for temp directory
- Ensure file permissions are correct

### Debug Commands
```bash
# Check photo service health
curl http://localhost:3005/api/photo/health

# List cached photos
ls -la temp_photos/

# Monitor backend logs
tail -f logs/server.log

# Test Grok API directly
curl -H "Authorization: Bearer $GROK_API_KEY" \
     https://api.x.ai/v1/chat/completions
```

## Conclusion

This implementation provides a robust, secure, and user-friendly photo analysis system that seamlessly integrates with ALFRED's existing conversational AI capabilities. The modular architecture allows for easy maintenance and future enhancements while maintaining high performance and security standards.

The system successfully bridges the gap between visual content and conversational AI, enabling users to have natural discussions about images using state-of-the-art vision analysis technology.
