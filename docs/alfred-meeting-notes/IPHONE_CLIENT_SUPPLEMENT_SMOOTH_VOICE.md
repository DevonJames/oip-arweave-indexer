# Supplemental Guide: Smooth iPhone Voice Chat with Alfred

This document supplements the main `IPHONE_CLIENT_IMPLEMENTATION_GUIDE.md` with specific implementation details for achieving a smooth, native-feeling voice conversation experience on iOS. These patterns were extracted from a production React Native app that successfully implements continuous voice chat with Alfred.

---

## Table of Contents

1. [Overview: Key Differences for iPhone](#overview-key-differences-for-iphone)
2. [Native Speech Recognition (No Local Voice Processor)](#native-speech-recognition-no-local-voice-processor)
3. [Continuous Conversation Flow](#continuous-conversation-flow)
4. [SSE Streaming in React Native](#sse-streaming-in-react-native)
5. [Audio Playback Best Practices](#audio-playback-best-practices)
6. [Haptic Feedback Integration](#haptic-feedback-integration)
7. [UI State Machine (Bottom Sheet Pattern)](#ui-state-machine-bottom-sheet-pattern)
8. [Thinking Indicator & Animations](#thinking-indicator--animations)
9. [Required Dependencies](#required-dependencies)
10. [Complete Voice Session Lifecycle](#complete-voice-session-lifecycle)

---

## Overview: Key Differences for iPhone

The main implementation guide describes a **hybrid architecture** using a local Python voice processor running on the Mac. For iPhone, this approach won't work because:

1. iPhones can't run a local Python server
2. Streaming raw audio frames to a remote server adds latency
3. iOS has native speech recognition that's faster and more reliable

**Instead, the iPhone implementation uses:**

| Component | Mac Version | iPhone Version |
|-----------|-------------|----------------|
| Speech-to-Text | MLX Whisper (local Python) | iOS Speech Framework (`@react-native-voice/voice`) |
| Audio Capture | ScriptProcessor (256ms frames) | Native voice activity detection |
| Silence Detection | Manual 2s timeout | Native + manual fallback |
| Audio Playback | Web Audio API | `expo-av` |
| SSE Streaming | Native EventSource | `react-native-sse` library |

---

## Native Speech Recognition (No Local Voice Processor)

### Using @react-native-voice/voice

For iPhone, **do NOT** use the `/process_frame` endpoint with streaming audio. Instead, use iOS's native speech recognition:

```bash
# Install the library
npm install @react-native-voice/voice
```

### Setup Voice Handlers

The key insight is to set up Voice handlers **immediately before** starting recognition, not in a `useEffect`:

```typescript
import Voice from '@react-native-voice/voice';

// Refs to track state across callbacks
const isVoiceActiveRef = useRef(false);
const finalTranscriptRef = useRef<string>('');
const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
const processingTranscriptRef = useRef(false);

const setupVoiceHandlers = () => {
  console.log('🎤 Setting up Voice event handlers...');
  
  Voice.onSpeechStart = () => {
    console.log('🎤 Speech started');
    isVoiceActiveRef.current = true;
    setIsRecording(true);
    finalTranscriptRef.current = ''; // Reset on new speech
  };
  
  Voice.onSpeechEnd = async () => {
    console.log('🎤 Speech ended (native event)');
    
    // Clear any pending silence timeout
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    
    isVoiceActiveRef.current = false;
    setIsRecording(false);
    
    // Process transcript if we haven't already
    if (finalTranscriptRef.current.trim() && !processingTranscriptRef.current) {
      processingTranscriptRef.current = true;
      const textToSend = finalTranscriptRef.current;
      finalTranscriptRef.current = '';
      await handleVoiceResult(textToSend);
      processingTranscriptRef.current = false;
    }
  };
  
  // iOS sometimes only fires onSpeechPartialResults, not onSpeechResults
  Voice.onSpeechPartialResults = (event) => {
    if (event.value && event.value.length > 0) {
      finalTranscriptRef.current = event.value[0];
      
      // Reset silence timeout on each partial result
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
      }
      
      // Manual silence detection: 2 seconds of no updates = speech ended
      silenceTimeoutRef.current = setTimeout(async () => {
        if (finalTranscriptRef.current.trim() && !processingTranscriptRef.current) {
          console.log('🔕 Silence detected (2s timeout)');
          processingTranscriptRef.current = true;
          
          const textToSend = finalTranscriptRef.current;
          finalTranscriptRef.current = '';
          isVoiceActiveRef.current = false;
          setIsRecording(false);
          
          try {
            await Voice.stop();
          } catch (e) {
            // Ignore stop errors
          }
          
          await handleVoiceResult(textToSend);
          processingTranscriptRef.current = false;
        }
      }, 2000); // 2 second silence timeout
    }
  };
  
  Voice.onSpeechResults = (event) => {
    // Also handle final results (some iOS versions fire this)
    if (event.value && event.value.length > 0) {
      finalTranscriptRef.current = event.value[0];
    }
  };
  
  Voice.onSpeechError = async (error) => {
    // Handle "No speech detected" gracefully
    const isNoSpeechError = error?.error?.code === 'recognition_fail' && 
                           error?.error?.message?.includes('No speech detected');
    
    if (!isNoSpeechError) {
      console.error('❌ Speech error:', error);
    }
    
    isVoiceActiveRef.current = false;
    setIsRecording(false);
    
    // Check for permissions error
    if (error?.message?.includes('Permission') || error?.code === '7') {
      Alert.alert(
        'Microphone Permission Required',
        'Please enable microphone and speech recognition in Settings.'
      );
      return;
    }
  };
};
```

### Starting Voice Recognition

```typescript
const startRecording = async () => {
  try {
    // Prevent duplicate starts
    if (isVoiceActiveRef.current) {
      console.log('⚠️ Voice recognition already active');
      return;
    }
    
    // Stop any existing session first
    try {
      await Voice.stop();
    } catch (e) {
      // Ignore errors from stopping non-existent session
    }
    
    // Check availability
    const available = await Voice.isAvailable();
    if (!available) {
      Alert.alert('Voice Recognition', 'Not available on this device.');
      return;
    }
    
    // Setup handlers RIGHT BEFORE starting (ensures fresh handlers)
    setupVoiceHandlers();
    
    // Set state BEFORE Voice.start() to prevent race conditions
    isVoiceActiveRef.current = true;
    setIsRecording(true);
    finalTranscriptRef.current = '';
    processingTranscriptRef.current = false;
    
    // Start recognition - iOS handles audio session automatically
    await Voice.start('en-US');
    
    // Haptic feedback
    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  } catch (error) {
    console.error('Failed to start recording:', error);
    isVoiceActiveRef.current = false;
    setIsRecording(false);
  }
};
```

### Critical: Cleanup on Unmount Only

**Do NOT call `Voice.destroy()` when stopping a conversation.** Only destroy on component unmount:

```typescript
// Stop conversation - just stop, don't destroy
const stopConversation = async () => {
  try {
    await Voice.stop(); // Just stop, keeps handlers intact
    setIsRecording(false);
  } catch (error) {
    console.error('Failed to stop voice:', error);
  }
};

// Destroy ONLY on unmount
useEffect(() => {
  return () => {
    Voice.destroy().then(Voice.removeAllListeners);
  };
}, []);
```

---

## Continuous Conversation Flow

For a natural conversation experience, automatically restart listening after Alfred finishes speaking:

```typescript
const [autoSession, setAutoSession] = useState(false);
const [micEnabled, setMicEnabled] = useState(true);

// Auto-resume listening when conditions are right
useEffect(() => {
  // Skip if not in auto session mode
  if (!autoSession) return;
  if (!micEnabled) return;
  if (isRecording) return;  // Already recording
  if (isPlaying) return;    // Audio playing
  if (isLoading) return;    // Waiting for response
  
  // Brief delay to ensure audio playback is complete
  const timer = setTimeout(() => {
    // Double-check no audio is queued
    if (audioQueueRef.current.length === 0) {
      console.log('🎤 Auto-resuming listening...');
      startRecording();
    }
  }, 300); // 300ms delay
  
  return () => clearTimeout(timer);
}, [autoSession, micEnabled, isRecording, isPlaying, isLoading]);
```

---

## SSE Streaming in React Native

React Native doesn't have native `EventSource`. Use `react-native-sse`:

```bash
npm install react-native-sse
```

### Streaming Response Handler

```typescript
import EventSource from 'react-native-sse';

const streamDialogue = async (dialogueId: string) => {
  const streamUrl = `${API_BASE}/api/voice/open-stream?dialogueId=${dialogueId}`;
  
  // Add placeholder for assistant response
  addMessage('assistant', '');
  let accumulatedText = '';
  
  return new Promise<void>((resolve) => {
    const eventSource = new EventSource(streamUrl, {
      headers: {
        // Include auth headers if needed
      },
    });
    
    eventSource.addEventListener('textChunk', (event: any) => {
      try {
        const chunkData = JSON.parse(event.data);
        
        if (chunkData.text && chunkData.role === 'assistant') {
          // Stop thinking sound when first chunk arrives
          stopThinkingSound();
          
          accumulatedText += chunkData.text;
          
          // Update the assistant message
          setMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (updated[lastIdx]?.role === 'assistant') {
              updated[lastIdx] = { ...updated[lastIdx], content: accumulatedText };
            }
            return updated;
          });
        }
      } catch (error) {
        console.error('Error parsing text chunk:', error);
      }
    });
    
    eventSource.addEventListener('audioChunk', async (event: any) => {
      try {
        const chunkData = JSON.parse(event.data);
        if (chunkData.audio && ttsEnabled) {
          stopThinkingSound();
          await playTTSAudio(chunkData.audio);
        }
      } catch (error) {
        console.error('Error playing audio chunk:', error);
      }
    });
    
    eventSource.addEventListener('done', () => {
      console.log('✅ Stream complete');
      stopThinkingSound();
      eventSource.close();
      resolve();
    });

    eventSource.addEventListener('error', (error: any) => {
      console.error('❌ Stream error:', error);
      stopThinkingSound();
      eventSource.close();
      resolve();
    });
  });
};
```

---

## Audio Playback Best Practices

### Using expo-av for TTS Playback

```typescript
import { Audio } from 'expo-av';

const soundRef = useRef<Audio.Sound | null>(null);

const playTTSAudio = async (base64Audio: string) => {
  try {
    setIsPlaying(true);

    // IMPORTANT: Clean up previous sound first
    if (soundRef.current) {
      await soundRef.current.unloadAsync();
      soundRef.current = null;
    }

    // Create sound from base64 data URI
    const { sound } = await Audio.Sound.createAsync(
      { uri: `data:audio/mp3;base64,${base64Audio}` },
      { shouldPlay: true }
    );

    soundRef.current = sound;

    // Track playback completion
    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) {
        setIsPlaying(false);
        // This triggers auto-resume of listening via the useEffect above
      }
    });
  } catch (error) {
    console.error('Failed to play TTS audio:', error);
    setIsPlaying(false);
  }
};
```

### Thinking Sound Loop (Local Asset)

For the "thinking" indicator, use a local audio asset instead of base64:

```typescript
const thinkingSoundRef = useRef<Audio.Sound | null>(null);

// Play thinking sound from local asset
const playThinkingSound = async () => {
  try {
    const { sound } = await Audio.Sound.createAsync(
      require('../../assets/thinking-v1.wav'), // Local asset
      { shouldPlay: true, isLooping: true, volume: 0.6 }
    );
    thinkingSoundRef.current = sound;
  } catch (error) {
    console.warn('Failed to play thinking sound:', error);
  }
};

const stopThinkingSound = async () => {
  if (thinkingSoundRef.current) {
    try {
      await thinkingSoundRef.current.stopAsync();
      await thinkingSoundRef.current.unloadAsync();
      thinkingSoundRef.current = null;
    } catch (error) {
      // Ignore cleanup errors
    }
  }
};
```

---

## Haptic Feedback Integration

Use `expo-haptics` for tactile feedback on all voice interactions:

```bash
npm install expo-haptics
```

```typescript
import * as Haptics from 'expo-haptics';

// Light feedback for button presses
if (Platform.OS === 'ios') {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

// Medium feedback for stopping conversation
if (Platform.OS === 'ios') {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}
```

**When to use haptics:**

| Action | Haptic Style |
|--------|--------------|
| Start conversation | Light |
| Stop conversation | Medium |
| Toggle mic mute | Light |
| Toggle TTS | Light |
| State transitions (pill → sheet) | Light |

---

## UI State Machine (Bottom Sheet Pattern)

For a premium feel, implement a 3-state bottom sheet:

```typescript
type AlfredState = 'pill' | 'sheet' | 'minimized';

const [state, setState] = useState<AlfredState>('pill');
```

### State Diagram

```
           ┌──────────────────────────────────────────┐
           │                                          │
           ▼                                          │
       ┌───────┐    tap     ┌─────────┐              │
       │ PILL  │ ─────────▶ │  SHEET  │              │
       │       │            │         │              │
       │ 56x56 │            │  Full   │              │
       │ icon  │            │ controls│              │
       └───────┘            └────┬────┘              │
           ▲                     │                   │
           │                     │ start             │
           │                     │ conversation      │
           │                     ▼                   │
           │               ┌───────────┐             │
           │               │ MINIMIZED │             │
           └───────────────│           │─────────────┘
              stop         │  Compact  │    tap
              conversation │  controls │
                          └───────────┘
```

### Minimized State Implementation

When conversation is active, show a compact floating control:

```tsx
{state === 'minimized' && (
  <TouchableOpacity
    style={styles.minimizedContainer}
    onPress={() => setState('sheet')}
  >
    {/* Avatar */}
    <Image source={getAlfredImage()} style={styles.minimizedAvatar} />
    
    {/* Waveform when recording/playing */}
    <View style={styles.minimizedStatus}>
      {isRecording && (
        <View style={styles.waveform}>
          <View style={[styles.waveBar, { height: waveHeights[0] }]} />
          <View style={[styles.waveBar, { height: waveHeights[1] }]} />
          <View style={[styles.waveBar, { height: waveHeights[2] }]} />
        </View>
      )}
    </View>
    
    {/* Mic mute toggle */}
    <TouchableOpacity
      onPress={(e) => {
        e.stopPropagation();
        setMicMuted(!micMuted);
      }}
    >
      <MicrophoneIcon color={micMuted ? '#888' : '#FFF'} />
    </TouchableOpacity>
    
    {/* Stop button */}
    <TouchableOpacity
      onPress={async (e) => {
        e.stopPropagation();
        await stopConversation();
        setState('pill');
      }}
    >
      <StopIcon color="#EF4444" />
    </TouchableOpacity>
  </TouchableOpacity>
)}
```

### Animated Waveform

```typescript
const [waveHeights, setWaveHeights] = useState([12, 20, 16]);

useEffect(() => {
  if (isRecording || isPlaying) {
    const interval = setInterval(() => {
      setWaveHeights([
        8 + Math.random() * 16,   // 8-24px
        12 + Math.random() * 20,  // 12-32px (tallest)
        10 + Math.random() * 14,  // 10-24px
      ]);
    }, 80); // Update every 80ms
    
    return () => clearInterval(interval);
  } else {
    setWaveHeights([12, 20, 16]); // Reset to default
  }
}, [isRecording, isPlaying]);
```

---

## Thinking Indicator & Animations

### Video-Based Alfred Animations

Use `expo-video` for smooth mascot animations:

```bash
expo install expo-video
```

```typescript
import { VideoView, useVideoPlayer } from 'expo-video';

const thinkingVideoPlayer = useVideoPlayer(
  isLoading ? require('./assets/alfred-thinking.mp4') : null,
  (player) => {
    player.loop = true;
    player.muted = true;
    player.play();
  }
);

// In render:
{isLoading ? (
  <VideoView
    player={thinkingVideoPlayer}
    style={styles.avatar}
    contentFit="cover"
    nativeControls={false}
  />
) : (
  <Image source={staticAlfredImage} style={styles.avatar} />
)}
```

### Theme-Aware Assets

Support both light and dark mode with different assets:

```typescript
const isDarkMode = Appearance.getColorScheme() === 'dark';

const getAlfredImage = () => {
  return isDarkMode
    ? require('./assets/alfred-dark.jpg')
    : require('./assets/alfred-light.jpg');
};

const getThinkingVideo = () => {
  return isDarkMode
    ? require('./assets/alfred-thinking-dark.mp4')
    : require('./assets/alfred-thinking-light.mp4');
};
```

---

## Required Dependencies

```json
{
  "dependencies": {
    "@react-native-voice/voice": "^3.2.4",
    "expo-av": "~16.0.7",
    "expo-haptics": "~15.0.7",
    "expo-video": "~3.0.1",
    "react-native-sse": "^1.2.1",
    "@react-native-async-storage/async-storage": "2.2.0"
  }
}
```

### Info.plist Requirements

Add to your `app.json` or `Info.plist`:

```json
{
  "expo": {
    "ios": {
      "infoPlist": {
        "NSSpeechRecognitionUsageDescription": "Alfred uses speech recognition to understand your voice commands.",
        "NSMicrophoneUsageDescription": "Alfred needs microphone access to hear your questions."
      }
    }
  }
}
```

---

## Complete Voice Session Lifecycle

Here's the complete lifecycle of a voice conversation on iPhone:

```
1. User taps "Start Conversation" button
   │
   ├── Haptic feedback (Light)
   ├── Setup Voice handlers (setupVoiceHandlers())
   ├── Set state refs BEFORE Voice.start()
   │   ├── isVoiceActiveRef = true
   │   ├── setIsRecording(true)
   │   ├── setAutoSession(true)
   │   └── finalTranscriptRef = ''
   └── await Voice.start('en-US')
   
2. User speaks
   │
   ├── Voice.onSpeechStart fires → setIsRecording(true)
   │
   ├── Voice.onSpeechPartialResults fires (multiple times)
   │   ├── Update finalTranscriptRef
   │   └── Reset 2-second silence timeout
   │
   └── Voice.onSpeechEnd fires (or 2s silence timeout)
       ├── setIsRecording(false)
       └── Call handleVoiceResult(finalTranscript)

3. Send to Alfred API
   │
   ├── Play thinking sound (local looping WAV)
   │
   ├── POST /api/voice/converse
   │   └── Response includes dialogueId for streaming
   │
   └── Open SSE stream: /api/voice/open-stream?dialogueId=xxx

4. Stream response
   │
   ├── First textChunk arrives → Stop thinking sound
   │
   ├── textChunk events → Update message in UI
   │
   ├── audioChunk events → Play via expo-av
   │   └── setIsPlaying(true)
   │
   └── done event → Close SSE, setIsPlaying(false)

5. Audio finishes playing
   │
   └── Auto-resume useEffect triggers
       └── Wait 300ms, then startRecording() again

6. User taps "Stop Conversation"
   │
   ├── Haptic feedback (Medium)
   ├── setAutoSession(false)
   ├── await Voice.stop() (NOT destroy)
   ├── Stop any playing audio
   ├── Stop thinking sound
   └── setState('pill')

7. Component unmounts (only then)
   │
   └── Voice.destroy().then(Voice.removeAllListeners)
```

---

## Summary: iOS-Specific Optimizations

| Aspect | What to Do |
|--------|------------|
| **Speech Recognition** | Use `@react-native-voice/voice`, NOT streaming to backend |
| **Silence Detection** | 2-second manual timeout + native onSpeechEnd |
| **SSE Streaming** | Use `react-native-sse` library |
| **Audio Playback** | Use `expo-av` with base64 data URIs |
| **Thinking Sound** | Local WAV asset, not base64 from server |
| **Haptic Feedback** | `expo-haptics` on all interactions |
| **Voice Cleanup** | Only `Voice.destroy()` on unmount, use `Voice.stop()` otherwise |
| **Auto-Resume** | 300ms delay after audio finishes before restarting |
| **State Management** | Refs for cross-callback state, useState for UI |
| **Animations** | `expo-video` for Alfred mascot, animated waveform bars |

These optimizations result in a seamless, native-feeling conversation experience that matches iOS Human Interface Guidelines and user expectations.
