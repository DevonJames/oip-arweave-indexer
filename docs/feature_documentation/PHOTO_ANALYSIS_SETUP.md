# 📷 Photo Analysis Setup Guide

## Quick Start

This guide will help you set up photo upload and analysis functionality for ALFRED using Grok-4's advanced image analysis capabilities.

## Prerequisites

1. **Grok API Access**: You need a Grok API key from X.AI
2. **Node.js Dependencies**: Already included in the project
3. **Running Backend**: The main ALFRED backend should be running

## Setup Steps

### 1. Environment Configuration

Add your Grok API key to your environment:

```bash
# Option 1: Add to your .env file
echo "GROK_API_KEY=your_grok_api_key_here" >> .env

# Option 2: Set as environment variable
export GROK_API_KEY=your_grok_api_key_here

# Alternative variable name (both work)
export XAI_API_KEY=your_grok_api_key_here
```

### 2. Install Dependencies

The required dependencies are already included in package.json, but if you need to install them manually:

```bash
npm install multer axios form-data crypto
```

### 3. Start the Backend

```bash
# From the main project directory
npm start
# OR
node index.js
```

### 4. Start the Mac Client

```bash
# Navigate to mac-client directory
cd mac-client/

# Start the interface (if not already running)
./start_interface_only.sh
```

### 5. Test the Implementation

```bash
# Run the automated test suite
node test/test-photo-analysis.js

# Or test manually by opening the interface
open http://localhost:3001/alfred
```

## Usage Instructions

### Using the Photo Analysis Feature

1. **Open ALFRED Interface**: Navigate to `http://localhost:3001/alfred`

2. **Connect to ALFRED**: Click the connect button (🔌) to enable voice/audio features

3. **Upload Photo**: 
   - Click the camera button (📷) in the control dock
   - Select an image file (JPEG, PNG, GIF, WebP, BMP, TIFF, SVG)
   - The image will preview in the dialog

4. **Ask Question**: 
   - Enter your question about the image
   - Examples:
     - "What do you see in this image?"
     - "Describe the scene in detail"
     - "What colors are prominent in this photo?"
     - "Are there any people in this image?"

5. **Get Analysis**: 
   - Click "Upload & Analyze"
   - The photo will be uploaded and analyzed by Grok-4
   - The response will appear in the conversation
   - If in "Spoken" mode, ALFRED will read the response aloud

### Integration with Existing Features

- **RAG Mode**: Photo analysis is enhanced with ALFRED's knowledge base
- **LLM Mode**: Direct response from Grok-4 vision analysis
- **Voice Output**: Responses can be spoken using TTS
- **On-Screen Mode**: Text displayed with speed-reading visualization
- **Conversation History**: Photo analyses are part of the conversation context

## API Endpoints

The following new endpoints are available:

- `POST /api/photo/upload` - Upload photos for analysis
- `POST /api/photo/analyze` - Analyze photos with Grok-4
- `POST /api/photo/chat` - Integrated photo analysis with ALFRED
- `GET /api/photo/info/:photoId` - Get photo information
- `DELETE /api/photo/:photoId` - Delete cached photos
- `GET /api/photo/health` - Service health check

## Configuration Options

### Grok API Settings

```bash
# Custom API URL (optional)
GROK_API_URL=https://api.x.ai/v1/chat/completions

# The system uses these default settings:
# - Model: grok-4
# - Max tokens: 1000
# - Temperature: 0.7
```

### File Upload Limits

```javascript
// Current limits (can be adjusted in routes/photo.js):
// - Maximum file size: 20MB
// - Cache duration: 24 hours
// - Cleanup interval: 1 hour
// - Supported formats: JPEG, PNG, GIF, WebP, BMP, TIFF, SVG
```

## Troubleshooting

### Common Issues

#### 1. "Grok API key not configured"
**Solution**: Set the `GROK_API_KEY` environment variable
```bash
export GROK_API_KEY=your_api_key_here
```

#### 2. Camera button not visible
**Solution**: Clear browser cache and refresh the page
```bash
# Force refresh in browser
Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows/Linux)
```

#### 3. "Photo not found" error
**Solution**: Photos expire after 24 hours. Upload a new photo.

#### 4. Upload fails with large images
**Solution**: Resize image to under 20MB or adjust the limit in `routes/photo.js`

#### 5. Analysis takes too long
**Solution**: Check your internet connection and Grok API status

### Debug Commands

```bash
# Check if photo service is healthy
curl http://localhost:3005/api/photo/health

# Test photo upload manually
curl -X POST http://localhost:3005/api/photo/upload \
  -F "photo=@/path/to/your/image.jpg"

# View cached photos
ls -la temp_photos/

# Run comprehensive tests
node test/test-photo-analysis.js
```

## Security Notes

- Photos are stored temporarily (24 hours max) and automatically deleted
- Unique IDs prevent unauthorized access to cached photos
- File type validation prevents malicious uploads
- Size limits prevent storage abuse
- API keys are never exposed to the frontend

## Performance Tips

1. **Optimize Images**: Compress images before upload for faster processing
2. **Specific Questions**: More specific questions get better analyses
3. **Network**: Ensure stable internet connection for Grok API calls
4. **Cache**: Reuse uploaded photos by referencing their ID (within 24 hours)

## Advanced Usage

### Batch Processing

You can upload multiple photos and analyze them sequentially:

```javascript
// Upload photos
const photo1 = await uploadPhoto(image1);
const photo2 = await uploadPhoto(image2);

// Analyze with context
const analysis1 = await analyzePhoto(photo1.photoId, "What's in the first image?");
const analysis2 = await analyzePhoto(photo2.photoId, "How does this compare to the previous image?");
```

### Integration with Voice

You can combine photo analysis with voice commands:

1. Upload photo via the interface
2. Use voice recording to ask questions about the photo
3. ALFRED will provide spoken responses about the image

### Custom Prompts

Modify the analysis prompts in `routes/photo.js` to customize the analysis style:

```javascript
// In routes/photo.js, around line 150
const messages = [
    {
        role: 'user',
        content: [
            {
                type: 'text',
                text: `You are an expert image analyst. Please analyze this image and answer: ${question.trim()}`
            },
            // ... image content
        ]
    }
];
```

## Next Steps

After setup is complete, you can:

1. **Customize the UI**: Modify the photo upload dialog styling
2. **Add Features**: Implement batch upload, image filters, etc.
3. **Integrate with Records**: Save analyses to the OIP record system
4. **Enhance Analysis**: Add specialized analysis modes (OCR, object detection, etc.)

## Support

If you encounter issues:

1. Check the console logs in your browser (F12)
2. Review backend logs for API errors
3. Run the test suite to identify problems
4. Verify your Grok API key is valid and has sufficient quota

## Example Questions to Try

- "What objects can you identify in this image?"
- "Describe the mood and atmosphere of this scene"
- "What text can you read in this image?"
- "Are there any safety concerns visible in this photo?"
- "What architectural style is shown in this building?"
- "Identify the plants or animals in this nature photo"
- "What emotions are expressed by people in this image?"
- "Describe the lighting and photographic composition"

Enjoy exploring the world through ALFRED's eyes! 📷✨
