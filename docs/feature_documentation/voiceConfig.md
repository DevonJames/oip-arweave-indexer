Here are the `voiceConfig` JSON structures to pass:

## For ElevenLabs:

```json
{
  "engine": "elevenlabs",
  "enabled": true,
  "voice_id": "onwK4e9ZLuTAKqWW03F9",
  "speed": 1.0,
  "elevenlabs": {
    "selectedVoice": "onwK4e9ZLuTAKqWW03F9",
    "model_id": "eleven_turbo_v2",
    "stability": 0.5,
    "similarity_boost": 0.75,
    "style": 0.0,
    "use_speaker_boost": true
  }
}
```

**Minimal version** (uses defaults):
```json
{
  "engine": "elevenlabs",
  "voice_id": "onwK4e9ZLuTAKqWW03F9"
}
```

## For Maya1 with Alfred (British Male Voice):

```json
{
  "engine": "maya1",
  "enabled": true,
  "voice_id": "alfred",
  "maya1": {
    "selectedVoice": "alfred",
    "exaggeration": 0.7,
    "cfg_weight": 0.3
  }
}
```

## For Maya1 with Alice (Mid-Atlantic Female Voice):

```json
{
  "engine": "maya1",
  "enabled": true,
  "voice_id": "alice",
  "maya1": {
    "selectedVoice": "alice",
    "exaggeration": 0.7,
    "cfg_weight": 0.3
  }
}
```

**Minimal version** (uses defaults):
```json
{
  "engine": "maya1",
  "voice_id": "alfred"
}
```

## How to send it:

When calling `/api/voice/converse`, include `voiceConfig` as a **JSON string** in the request body:

```javascript
// Example fetch call
const response = await fetch('/api/voice/converse', {
  method: 'POST',
  body: formData, // FormData with audio file
  headers: {
    'voiceConfig': JSON.stringify({
      engine: 'maya1',
      voice_id: 'alfred',
      maya1: {
        selectedVoice: 'alfred',
        exaggeration: 0.7,
        cfg_weight: 0.3
      }
    })
  }
});
```

Or if using FormData:
```javascript
formData.append('voiceConfig', JSON.stringify({
  engine: 'maya1',
  voice_id: 'male_british',
  maya1: {
    selectedVoice: 'male_british',
    exaggeration: 0.7,
    cfg_weight: 0.3
  }
}));
```

**Note:** The endpoint parses `voiceConfig` from `req.body.voiceConfig` as a JSON string, so make sure to `JSON.stringify()` it before sending.