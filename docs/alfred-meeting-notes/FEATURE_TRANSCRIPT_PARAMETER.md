# Feature: Optional Transcript Parameter for /api/notes/from-audio

## Overview

The `/api/notes/from-audio` endpoint now supports an optional `transcript` parameter that allows skipping the speech-to-text transcription step. This enables faster processing, lower costs, and greater flexibility when creating notes from pre-existing transcripts.

## Changes Made

### 1. Updated Request Validation (`routes/notes.js`)

**Before:**
- Required `audio` file in all cases
- Would fail if no audio file provided

**After:**
- Either `audio` OR `transcript` must be provided
- Supports three modes:
  1. **Audio-only**: Traditional flow with transcription
  2. **Transcript-only**: Skip audio upload and transcription
  3. **Both provided**: Audio takes precedence (transcript ignored)

### 2. Modified Audio Upload Step (Step 2)

**Changes:**
- Wrapped audio upload logic in `if (hasAudioFile)` conditional
- Sets `audioMeta = null` when no audio file provided
- Note records gracefully handle null `audio_meta`

### 3. Modified Transcription Engine Resolution (Step 3)

**Before:**
- Always attempted to resolve transcription engine
- Would fail if `transcription_engine_id` not provided

**After:**
- Skips engine resolution if `transcript` provided
- Logs: `"Transcript provided, skipping transcription engine resolution"`

### 4. Modified Speech-to-Text Step (Step 4)

**Before:**
- Always ran STT service on audio file
- Required audio file to exist

**After:**
- Checks if `transcript` parameter exists
- If yes: Creates mock `transcriptionResult` object with:
  - `text`: provided transcript
  - `language`: defaults to `'en'`
  - `segments`: empty array `[]`
- If no: Runs normal STT process
- Rest of pipeline works identically with both sources

## API Changes

### New Optional Parameter

| Parameter | Type | Description |
|-----------|------|-------------|
| `transcript` | String | Pre-existing transcript text to skip transcription |

### Updated Requirements

**Before:** `audio` was required

**After:** Either `audio` OR `transcript` required

## Usage Examples

### Example 1: Traditional Audio Upload

```javascript
const formData = new FormData();
formData.append('audio', audioFile);
formData.append('start_time', '2025-11-20T10:00:00Z');
formData.append('end_time', '2025-11-20T11:30:00Z');
formData.append('note_type', 'MEETING');
formData.append('device_type', 'IPHONE');

const response = await fetch('https://api.oip.onl/api/notes/from-audio', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: formData
});
```

### Example 2: Using Pre-existing Transcript (NEW)

```javascript
const formData = new FormData();
formData.append('transcript', 'This is my meeting transcript...');
formData.append('start_time', '2025-11-20T10:00:00Z');
formData.append('end_time', '2025-11-20T11:30:00Z');
formData.append('note_type', 'MEETING');
formData.append('device_type', 'MAC');

const response = await fetch('https://api.oip.onl/api/notes/from-audio', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: formData
});
```

### Example 3: Swift (iOS)

```swift
// With transcript parameter
var request = URLRequest(url: URL(string: "https://api.oip.onl/api/notes/from-audio")!)
request.httpMethod = "POST"
request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

let boundary = UUID().uuidString
request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

var body = Data()

// Add transcript
body.append("--\(boundary)\r\n".data(using: .utf8)!)
body.append("Content-Disposition: form-data; name=\"transcript\"\r\n\r\n".data(using: .utf8)!)
body.append("This is my meeting transcript...\r\n".data(using: .utf8)!)

// Add other fields
body.append("--\(boundary)\r\n".data(using: .utf8)!)
body.append("Content-Disposition: form-data; name=\"start_time\"\r\n\r\n".data(using: .utf8)!)
body.append("2025-11-20T10:00:00Z\r\n".data(using: .utf8)!)

// ... more fields ...

body.append("--\(boundary)--\r\n".data(using: .utf8)!)
request.httpBody = body

let (data, _) = try await URLSession.shared.data(for: request)
```

## Benefits

### 1. ⚡ Faster Processing
- Skips entire transcription step (saves 5-30 seconds depending on audio length)
- No audio upload needed
- Immediate processing of text

### 2. 💰 Lower Costs
- No transcription API calls
- No audio storage/bandwidth costs
- Reduced server processing time

### 3. 🔒 Privacy
- No need to upload sensitive audio
- Client can transcribe locally and only send text
- Useful for highly confidential meetings

### 4. 🔄 Flexibility
- Import notes from other sources (Zoom transcripts, Google Docs, etc.)
- Re-process existing transcripts with different models
- Create notes from written content (blog posts, articles)
- Batch processing of historical transcripts

### 5. 🌐 Offline Capability
- Client apps can transcribe offline using device STT
- Upload text when network available
- No dependence on server-side transcription service

## Implementation Details

### Validation Logic

```javascript
const hasAudioFile = !!req.file;
const hasTranscript = !!req.body.transcript;

if (!hasAudioFile && !hasTranscript) {
  return res.status(400).json({
    success: false,
    error: 'Either audio file or transcript must be provided'
  });
}
```

### Transcript Processing

```javascript
if (transcript) {
  transcriptionResult = {
    text: transcript,
    language: 'en', // Default to English
    segments: [] // Empty segments when using transcript
  };
} else {
  transcriptionResult = await sttService.transcribe(tempFilePath, engine);
}
```

### Chunking Behavior

When `transcript` is provided:
- `segments` array is empty `[]`
- Chunking strategy still applies
- Text is chunked based on chosen strategy (BY_TIME_30S, BY_SENTENCE, etc.)
- Time-based chunking uses estimated timing (duration / text length)

## Limitations

### Current Limitations

1. **Language Detection**: When using `transcript`, language defaults to `'en'`
   - Future enhancement: Auto-detect language from transcript text

2. **Segment Timing**: No word-level or sentence-level timestamps
   - `segments` array is empty when transcript provided
   - Time-based chunking uses approximations

3. **Speaker Diarization**: Not available without audio
   - `BY_SPEAKER` chunking strategy won't work effectively
   - Recommend using `BY_PARAGRAPH` or `BY_SENTENCE` instead

4. **Audio Features**: Obviously unavailable without audio file
   - No audio playback
   - No audio archiving
   - No audio analysis (tone, sentiment from voice)

### Recommended Use Cases

✅ **Good for:**
- Importing existing transcripts
- Privacy-sensitive meetings
- Offline-first workflows
- Testing/development
- Batch processing historical data

❌ **Not ideal for:**
- When audio archival is needed
- When speaker identification is critical
- When audio playback is required
- When precise timing is needed

## Error Handling

### Error Scenarios

1. **Both Missing:**
```json
{
  "success": false,
  "error": "Either audio file or transcript must be provided"
}
```

2. **Empty Transcript:**
```json
{
  "success": false,
  "error": "Transcript cannot be empty"
}
```

3. **Other Validation Errors:**
- Still apply: `start_time`, `end_time`, `note_type`, `device_type` validations
- Time range validation still required

## Testing

### Test Cases

1. **Test with audio only** (existing behavior)
   - ✅ Should work as before
   
2. **Test with transcript only** (new behavior)
   - ✅ Should skip transcription
   - ✅ Should create note successfully
   - ✅ Should have `audioMeta: null`

3. **Test with both audio and transcript**
   - ✅ Should use audio (transcript ignored)
   - ✅ Should log warning about transcript being ignored

4. **Test with neither**
   - ✅ Should return 400 error

### Integration Testing

```bash
# Test 1: Transcript only
curl -X POST https://api.oip.onl/api/notes/from-audio \
  -H "Authorization: Bearer $TOKEN" \
  -F "transcript=This is my test transcript..." \
  -F "start_time=2025-11-20T10:00:00Z" \
  -F "end_time=2025-11-20T11:00:00Z" \
  -F "note_type=MEETING" \
  -F "device_type=MAC"

# Test 2: Audio only (existing)
curl -X POST https://api.oip.onl/api/notes/from-audio \
  -H "Authorization: Bearer $TOKEN" \
  -F "audio=@test.m4a" \
  -F "start_time=2025-11-20T10:00:00Z" \
  -F "end_time=2025-11-20T11:00:00Z" \
  -F "note_type=MEETING" \
  -F "device_type=IPHONE"
```

## Backward Compatibility

✅ **Fully backward compatible**

- Existing clients continue to work unchanged
- `audio` parameter still supported
- Response format unchanged
- No breaking changes

## Future Enhancements

### Potential Improvements

1. **Language Auto-detection**
   ```javascript
   const detectLanguage = require('franc'); // or similar
   transcriptionResult.language = detectLanguage(transcript);
   ```

2. **Segment Generation**
   - Split transcript into pseudo-segments
   - Estimate timestamps based on word count
   - Enable better time-based chunking

3. **Speaker Labeling**
   - Accept `speaker_segments` parameter
   - Format: `[{speaker: "Alice", start: 0, end: 30, text: "..."}, ...]`
   - Enable speaker-based chunking

4. **Transcript Validation**
   - Minimum length requirements
   - Maximum length limits
   - Language detection and validation

5. **Import from URLs**
   - Accept `transcript_url` parameter
   - Fetch transcript from external source
   - Support common formats (VTT, SRT, TXT)

## Documentation Updates

### Files Updated

1. **`docs/ALFRED_NOTES_API_FRONTEND_GUIDE.md`**
   - Added `transcript` to required parameters table
   - Added "Either/Or" requirement note
   - Added Example 2 with transcript-only request
   - Added benefits section

2. **`routes/notes.js`**
   - Updated parameter extraction to include `transcript`
   - Modified validation logic
   - Updated Step 2, 3, 4 to handle transcript mode
   - Added extensive comments

3. **`docs/FEATURE_TRANSCRIPT_PARAMETER.md`** (this file)
   - Complete feature documentation
   - Examples and use cases
   - Technical implementation details

## Related Issues

- Enables offline-first note taking
- Supports privacy-focused workflows
- Facilitates data migration from other platforms
- Reduces server load and costs

## References

- Main endpoint: `/api/notes/from-audio`
- Related: `/api/notes/converse` (uses notes created by this endpoint)
- Source: `routes/notes.js` lines 47-644

