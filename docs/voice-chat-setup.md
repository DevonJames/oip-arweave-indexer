# Voice Chat Setup Guide

## Overview

The OIPArweave project includes real-time voice chat functionality powered by ElevenLabs Conversational AI. This guide will help you set up and troubleshoot the voice chat feature.

## Prerequisites

1. **ElevenLabs API Key**: You need a valid ElevenLabs API key
2. **ElevenLabs Agent ID**: You need to create a conversational agent in the ElevenLabs dashboard
3. **HTTPS Connection**: Voice chat requires HTTPS in production (localhost works with HTTP)
4. **Modern Browser**: Chrome, Firefox, Safari, or Edge with WebRTC support

## Setup Steps

### 1. Configure Environment Variables

Add these to your `.env` file:

```env
# ElevenLabs Configuration
ELEVENLABS_API_KEY=your-elevenlabs-api-key
REACT_APP_ELEVENLABS_AGENT_ID=your-agent-id
```

### 2. Create an ElevenLabs Agent

1. Go to [ElevenLabs Dashboard](https://elevenlabs.io)
2. Navigate to "Conversational AI" section
3. Create a new agent with your desired settings:
   - Choose a voice
   - Set the system prompt
   - Configure conversation parameters
4. Copy the Agent ID

### 3. Build the Frontend

```bash
# Install dependencies
cd client
npm install

# Build the React app
npm run build
```

### 4. Start the Server

```bash
# From the root directory
npm start
```

## Features

### Primary Mode: ElevenLabs Widget
- Uses the official ElevenLabs conversation widget
- Provides the best user experience with built-in UI
- Automatic voice activity detection
- Real-time transcription

### Fallback Mode: Custom WebSocket
- Activates if the widget fails to load
- Direct WebSocket connection to ElevenLabs
- Custom recording controls
- Manual push-to-talk interface

## Troubleshooting

### Common Issues

#### 1. "Failed to get signed URL"
- **Cause**: Invalid API key or network issues
- **Solution**: 
  - Verify your `ELEVENLABS_API_KEY` is correct
  - Check your ElevenLabs account status
  - Ensure your API key has the necessary permissions

#### 2. "Widget load timeout - using fallback mode"
- **Cause**: Network issues or CORS problems
- **Solution**:
  - Check browser console for CORS errors
  - Ensure you're using HTTPS in production
  - Try refreshing the page

#### 3. "Microphone access denied"
- **Cause**: Browser permissions
- **Solution**:
  - Click the lock icon in the address bar
  - Allow microphone access for the site
  - Refresh the page

#### 4. "Agent not found"
- **Cause**: Invalid agent ID
- **Solution**:
  - Verify the agent ID in your `.env` file
  - Ensure the agent is active in ElevenLabs dashboard
  - Create a new agent if needed

### Browser Console Debugging

Enable debug logging by adding to your component:

```javascript
// In ElevenLabsConversation.jsx
console.log('Debug: Signed URL:', signedUrl);
console.log('Debug: Widget loaded:', window.ElevenLabsConversation);
console.log('Debug: WebSocket state:', webSocketRef.current?.readyState);
```

### Network Debugging

Check these endpoints:
- `/api/elevenlabs/get-signed-url?agentId=YOUR_AGENT_ID` - Should return a signed URL
- WebSocket connection to ElevenLabs servers
- CORS headers on your server

## Security Considerations

1. **API Key Protection**: Never expose your ElevenLabs API key on the frontend
2. **Signed URLs**: URLs are temporary and expire after a short time
3. **HTTPS Required**: Voice chat requires HTTPS in production for security
4. **Rate Limiting**: Implement rate limiting on the signed URL endpoint

## Customization

### Styling
Edit `client/src/styles/elevenlabs-conversation.css` to customize the appearance.

### Behavior
Modify `client/src/components/ElevenLabsConversation.jsx` to:
- Change the agent ID dynamically
- Add custom event handlers
- Implement conversation history
- Add voice commands

### Integration
You can integrate the voice chat with:
- Record publishing (voice-to-text for creating records)
- Search functionality (voice search)
- AI analysis (spoken content analysis)

## Performance Tips

1. **Lazy Loading**: Load the voice chat component only when needed
2. **Connection Management**: Close connections when not in use
3. **Audio Context**: Reuse audio context across sessions
4. **Transcript Limits**: Limit transcript history to prevent memory issues

## Example Usage

```javascript
// Dynamic agent selection
const agents = {
  assistant: 'agent-id-1',
  support: 'agent-id-2',
  sales: 'agent-id-3'
};

const [selectedAgent, setSelectedAgent] = useState('assistant');

// Pass to component
<ElevenLabsConversation agentId={agents[selectedAgent]} />
```

## API Reference

### Backend Endpoint
`GET /api/elevenlabs/get-signed-url`

Query Parameters:
- `agentId` (required): The ElevenLabs agent ID

Response:
```json
{
  "signedUrl": "https://..."
}
```

### Frontend Events

The component emits these events:
- `onConnect`: When successfully connected
- `onDisconnect`: When disconnected
- `onError`: When an error occurs
- `onMessage`: When receiving a message
- `onTranscript`: When transcript is updated

## Future Enhancements

1. **Multi-language Support**: Add language selection
2. **Voice Commands**: Implement custom voice commands
3. **Conversation History**: Store and retrieve past conversations
4. **Analytics**: Track usage and performance metrics
5. **Custom Wake Words**: Implement wake word detection 