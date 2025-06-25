# Speech Synthesis and Playback Code - Complete Implementation

## 🎯 **Overview**

This document contains the complete code implementation for speech synthesis and audio playback in the Foundry AI Assistant. The system uses a multi-engine TTS approach with sophisticated audio playback handling.

## 🏗️ **Architecture Flow**

```
Frontend Request → API Service → TTS Service → Multi-Engine Synthesis → Audio Playback
     │                │            │                │                      │
  useVoice.ts    →  api.ts    →  tts_service.py  →  Audio Engines  →  Browser Audio
```

---

## 1. 🎵 **TTS Service - Speech Synthesis Backend**

**File: `backend/services/tts_service.py`**

### **Core Synthesis Endpoint**

```python
@app.post("/synthesize")
async def synthesize_speech(request: TTSRequest):
    """Synthesize speech from text using Chatterbox TTS"""
    try:
        # Validate input
        if not request.text.strip():
            raise HTTPException(status_code=400, detail="Text cannot be empty")
        
        if len(request.text) > 5000:
            raise HTTPException(status_code=400, detail="Text too long (max 5000 characters)")
        
        # Try each engine until one works
        last_error = None
        for engine in engines:
            if not engine.available:
                continue
                
            try:
                logger.info(f"🎵 Trying TTS synthesis with {engine.name} engine")
                audio_data = await engine.synthesize(
                    request.text, 
                    request.voice_id, 
                    request.speed
                )
                
                # Determine media type
                media_type = "audio/wav"
                if request.format == "mp3" and engine.name == "gtts":
                    media_type = "audio/mpeg"
                
                logger.info(f"✅ TTS synthesis successful with {engine.name}, {len(audio_data)} bytes")
                
                return StreamingResponse(
                    io.BytesIO(audio_data),
                    media_type=media_type,
                    headers={
                        "Content-Disposition": f"inline; filename=chatterbox_speech.{request.format}",
                        "X-TTS-Engine": engine.name,
                        "Content-Length": str(len(audio_data))
                    }
                )
                
            except Exception as e:
                logger.warning(f"❌ TTS engine {engine.name} failed: {str(e)}")
                last_error = e
                continue
        
        # If we get here, all engines failed
        logger.error(f"❌ All TTS engines failed. Last error: {last_error}")
        raise HTTPException(
            status_code=503, 
            detail=f"TTS synthesis failed with all engines. Last error: {str(last_error)}"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ TTS service error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"TTS service error: {str(e)}")
```

### **Chatterbox Engine - Primary TTS**

```python
class ChatterboxEngine(TTSEngine):
    """Chatterbox TTS engine using pyttsx3 - high-quality cross-platform voice synthesis"""
    
    def __init__(self):
        super().__init__("chatterbox")
        self.engine = None
        
        # Define available voice configurations
        self.voice_configs = {
            "default": {"rate": 200, "volume": 0.9, "voice_id": 0},
            "female_1": {"rate": 180, "volume": 0.9, "voice_id": 0},
            "male_1": {"rate": 200, "volume": 0.9, "voice_id": 1},
            "expressive": {"rate": 220, "volume": 1.0, "voice_id": 0},
            "calm": {"rate": 160, "volume": 0.8, "voice_id": 0}
        }
    
    async def synthesize(self, text: str, voice_id: str = "default", speed: float = 1.0) -> bytes:
        if not self.available:
            raise Exception("Chatterbox engine not available")
        
        if not self.engine:
            raise Exception("Chatterbox engine not properly initialized")
        
        try:
            # Get voice configuration
            config = self.voice_configs.get(voice_id, self.voice_configs["default"])
            
            # Set engine properties with error handling
            try:
                voices = self.engine.getProperty('voices')
                if voices and len(voices) > config["voice_id"]:
                    self.engine.setProperty('voice', voices[config["voice_id"]].id)
                else:
                    logger.warning(f"Voice {config['voice_id']} not available, using default")
            except Exception as voice_error:
                logger.warning(f"Could not set voice: {voice_error}")
            
            # Apply speed multiplier
            rate = int(config["rate"] * speed)
            try:
                self.engine.setProperty('rate', rate)
                self.engine.setProperty('volume', config["volume"])
            except Exception as prop_error:
                logger.warning(f"Could not set engine properties: {prop_error}")
            
            # Create temporary file for output
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
                logger.info(f"🎵 Chatterbox synthesizing - voice: {voice_id}, rate: {rate}")
                
                try:
                    # Save to file
                    self.engine.save_to_file(text, tmp_file.name)
                    self.engine.runAndWait()
                    
                    # Check if file was created and has content
                    if os.path.exists(tmp_file.name) and os.path.getsize(tmp_file.name) > 0:
                        # Read the generated audio file
                        with open(tmp_file.name, 'rb') as f:
                            audio_data = f.read()
                        
                        # Clean up
                        os.unlink(tmp_file.name)
                        
                        logger.info(f"✅ Chatterbox synthesis successful - {len(audio_data)} bytes")
                        return audio_data
                    else:
                        # Clean up empty file
                        if os.path.exists(tmp_file.name):
                            os.unlink(tmp_file.name)
                        raise Exception("Chatterbox produced no audio output (Docker audio system unavailable)")
                        
                except Exception as synthesis_error:
                    # Clean up on error
                    if os.path.exists(tmp_file.name):
                        os.unlink(tmp_file.name)
                    raise Exception(f"Chatterbox synthesis failed: {synthesis_error}")
                
        except Exception as e:
            logger.error(f"Chatterbox synthesis error: {str(e)}")
            raise
```

### **Edge TTS Engine - Microsoft Neural Voices**

```python
class EdgeTTSEngine(TTSEngine):
    """Edge TTS engine - Microsoft's high-quality TTS"""
    
    def __init__(self):
        super().__init__("edge-tts")
        self.voice_map = {
            "default": "en-US-AriaNeural",
            "female_1": "en-US-AriaNeural", 
            "male_1": "en-US-DavisNeural",
            "expressive": "en-US-JennyNeural",
            "calm": "en-US-GuyNeural"
        }
    
    async def synthesize(self, text: str, voice_id: str = "default", speed: float = 1.0) -> bytes:
        if not self.available:
            raise Exception("Edge TTS engine not available")
        
        try:
            import edge_tts
            
            # Get voice for this voice_id
            voice = self.voice_map.get(voice_id, self.voice_map["default"])
            
            # Create rate string for edge-tts
            rate_percent = int((speed - 1.0) * 50)  # Convert to percentage
            rate_str = f"{rate_percent:+d}%" if rate_percent != 0 else "+0%"
            
            # Create temporary file for output
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
                logger.info(f"🎵 Edge TTS synthesizing - voice: {voice}, rate: {rate_str}")
                
                try:
                    # Create TTS communicator with timeout
                    communicate = edge_tts.Communicate(text, voice, rate=rate_str)
                    
                    # Generate audio with timeout and error handling
                    audio_received = False
                    with open(tmp_file.name, 'wb') as f:
                        try:
                            # Add timeout for network operations
                            async for chunk in communicate.stream():
                                if chunk["type"] == "audio":
                                    f.write(chunk["data"])
                                    audio_received = True
                        except asyncio.TimeoutError:
                            raise Exception("Edge TTS timeout - network connectivity issue")
                        except Exception as stream_error:
                            raise Exception(f"Edge TTS streaming failed: {stream_error}")
                    
                    # Check if we received any audio data
                    if not audio_received or not os.path.exists(tmp_file.name) or os.path.getsize(tmp_file.name) == 0:
                        if os.path.exists(tmp_file.name):
                            os.unlink(tmp_file.name)
                        raise Exception("Edge TTS produced no audio - check network connectivity and voice parameters")
                    
                    # Read the generated audio file
                    with open(tmp_file.name, 'rb') as f:
                        audio_data = f.read()
                    
                    # Clean up
                    os.unlink(tmp_file.name)
                    
                    logger.info(f"✅ Edge TTS synthesis successful - {len(audio_data)} bytes")
                    return audio_data
                    
                except Exception as synthesis_error:
                    # Clean up on error
                    if os.path.exists(tmp_file.name):
                        os.unlink(tmp_file.name)
                    raise Exception(f"Edge TTS synthesis failed: {synthesis_error}")
                
        except Exception as e:
            logger.error(f"Edge TTS synthesis error: {str(e)}")
            raise
```

### **eSpeak Engine - Offline Fallback**

```python
class ESpeakEngine(TTSEngine):
    """eSpeak TTS engine - offline fallback"""
    
    def __init__(self):
        super().__init__("espeak")
    
    async def synthesize(self, text: str, voice_id: str = "default", speed: float = 1.0) -> bytes:
        if not self.available:
            raise Exception("eSpeak engine not available")
        
        try:
            # Prepare espeak command
            espeak_speed = max(80, min(450, int(175 * speed)))
            
            # Voice mapping
            voice_map = {
                "default": "en",
                "male_1": "en+m3",
                "female_1": "en+f3",
                "expressive": "en+m4",
                "calm": "en+f2"
            }
            voice = voice_map.get(voice_id, "en")
            
            # Create temporary file for output
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
                cmd = [
                    'espeak',
                    '-v', voice,
                    '-s', str(espeak_speed),
                    '-w', tmp_file.name,
                    text
                ]
                
                # Run espeak
                result = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                stdout, stderr = await result.communicate()
                
                if result.returncode != 0:
                    logger.error(f"eSpeak error: {stderr.decode()}")
                    raise Exception(f"eSpeak synthesis failed: {stderr.decode()}")
                
                # Read the generated audio file
                with open(tmp_file.name, 'rb') as f:
                    audio_data = f.read()
                
                # Clean up
                os.unlink(tmp_file.name)
                
                return audio_data
                
        except Exception as e:
            logger.error(f"eSpeak synthesis error: {str(e)}")
            raise
```

### **Engine Initialization and Fallback System**

```python
def init_engines():
    """Initialize available TTS engines - Chatterbox first, then high-quality alternatives"""
    global engines, chatterbox_engine
    engines = []
    
    logger.info("🚀 Initializing Chatterbox TTS engines...")
    
    # Initialize Chatterbox first (primary engine)
    chatterbox_engine = ChatterboxEngine()
    if chatterbox_engine.available:
        engines.append(chatterbox_engine)
    
    # Add Edge TTS as secondary high-quality option
    edge_tts = EdgeTTSEngine()
    if edge_tts.available:
        engines.append(edge_tts)
    
    # Add gTTS as tertiary option
    gtts = GTTSEngine()
    if gtts.available:
        engines.append(gtts)
    
    # Add eSpeak as offline fallback
    espeak = ESpeakEngine()
    if espeak.available:
        engines.append(espeak)
    
    # Always add silence fallback
    engines.append(SilenceEngine())
    
    logger.info(f"✅ Initialized {len(engines)} TTS engines: {[e.name for e in engines]}")
```

---

## 2. 🌐 **API Service - Frontend Integration**

**File: `frontend/src/services/api.ts`**

### **Voice API Integration**

```typescript
// Voice endpoints
export const voiceAPI = {
  transcribe: async (audioBlob: Blob) => {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.wav');
    
    const response = await api.post('/voice/recognize', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },
  
  synthesize: async (text: string, voiceId?: string) => {
    const response = await api.post('/voice/synthesize', 
      { text, voice_id: voiceId },
      { responseType: 'blob' }  // 👈 Important: Receive audio as blob
    );
    return response.data;
  },

  getVoices: async () => {
    const response = await api.get('/voice/voices');
    return response.data;
  },
};
```

---

## 3. 🎤 **Frontend Voice Hook - Audio Playback**

**File: `frontend/src/hooks/useVoice.ts`**

### **Core Speak Function with Echo Prevention**

```typescript
// Speak text using TTS
const speak = useCallback(async (text: string, voiceId?: string) => {
  try {
    setIsSpeaking(true);
    
    // Use selected voice as default if no voiceId provided
    const voiceToUse = voiceId || selectedVoice;
    console.log('🎤 Speaking with voice:', voiceToUse);
    
    // Capture conversation mode state at TTS start time
    const wasInConversationMode = isInConversationModeRef.current;
    const wasRecording = isRecordingRef.current;
    console.log('🎤 TTS starting - conversation mode:', wasInConversationMode, 'was recording:', wasRecording);
    
    if (wasInConversationMode && wasRecording) {
      console.log('🎤 Pausing recording during TTS to prevent echo');
      // Stop current recording but don't exit conversation mode
      if (mediaRecorderRef.current && isRecordingRef.current) {
        mediaRecorderRef.current.stop();
        setIsRecording(false);
        isRecordingRef.current = false;
        cleanupVAD();
        
        // Stop microphone stream
        if (microphoneStreamRef.current) {
          microphoneStreamRef.current.getTracks().forEach(track => track.stop());
          microphoneStreamRef.current = null;
        }
      }
    }
    
    // Get audio blob from TTS API
    const audioBlob = await voiceAPI.synthesize(text, voiceToUse) as Blob;
    
    // Create URL for the audio blob and play it
    const audioUrl = URL.createObjectURL(audioBlob);
    audioRef.current = new Audio(audioUrl);
    
    audioRef.current.onended = () => {
      console.log('🎤 TTS finished playing - will check for restart');
      console.log('🎤 TTS restart check - wasInConversationMode:', wasInConversationMode, 'currentConversationMode:', isInConversationModeRef.current);
      setIsSpeaking(false);
      URL.revokeObjectURL(audioUrl);
      
      // Resume conversation mode recording after TTS ends if we're in conversation mode
      // Always restart if in conversation mode, regardless of previous recording state
      if (wasInConversationMode) {
        console.log('🎤 TTS ended - will resume conversation mode recording after delay');
        setTimeout(() => {
          // Double-check we're still in conversation mode and not already recording
          console.log('🎤 TTS restart timeout - checking conditions...');
          console.log('🎤 - isInConversationModeRef.current:', isInConversationModeRef.current);
          console.log('🎤 - isRecordingRef.current:', isRecordingRef.current);
          console.log('🎤 - isSpeaking:', isSpeaking);
          
          if (isInConversationModeRef.current && !isRecordingRef.current && !isSpeaking) {
            console.log('🎤 Resuming conversation mode recording after TTS');
            autoRestartRecording();
          } else {
            console.log('🎤 Not resuming recording - conditions not met');
          }
        }, 1000); // Increased delay to 1 second to ensure audio system is clear
      } else {
        console.log('🎤 Not restarting - was not in conversation mode');
      }
    };

    audioRef.current.onerror = () => {
      console.log('🎤 TTS playback error');
      setIsSpeaking(false);
      URL.revokeObjectURL(audioUrl);
      
      // Resume conversation mode recording on error too
      if (wasInConversationMode) {
        console.log('🎤 TTS error - resuming conversation mode recording');
        setTimeout(() => {
          if (isInConversationModeRef.current && !isRecordingRef.current && !isSpeaking) {
            autoRestartRecording();
          }
        }, 1000);
      }
      
      options.onError?.(new Error('Failed to play audio'));
    };
    
    await audioRef.current.play();
  } catch (error) {
    console.error('Error playing speech:', error);
    setIsSpeaking(false);
    options.onError?.(error as Error);
  }
}, [options, autoRestartRecording, cleanupVAD, selectedVoice, isSpeaking]);
```

### **Voice Activity Detection (VAD) Setup**

```typescript
// Setup Voice Activity Detection
const setupVAD = useCallback(async (stream: MediaStream) => {
  try {
    console.log('🎤 Setting up Voice Activity Detection...');
    
    // Create AudioContext for analyzing audio levels
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    const audioContext = audioContextRef.current;
    
    console.log('🎤 AudioContext created:', audioContext.state);
    
    // Resume AudioContext if it's suspended (required on some browsers)
    if (audioContext.state === 'suspended') {
      console.log('🎤 AudioContext suspended, attempting to resume...');
      await audioContext.resume();
      console.log('🎤 AudioContext resumed, new state:', audioContext.state);
    }
    
    // Create analyser node
    analyserRef.current = audioContext.createAnalyser();
    analyserRef.current.fftSize = 512;
    analyserRef.current.smoothingTimeConstant = 0.8;
    
    console.log('🎤 Analyser created - FFT size:', analyserRef.current.fftSize);
    
    // Connect microphone to analyser
    const microphone = audioContext.createMediaStreamSource(stream);
    microphone.connect(analyserRef.current);
    
    console.log('🎤 Microphone connected to analyser');
    
    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    console.log('🎤 Audio analysis buffer length:', bufferLength);
    
    // Monitor audio levels for voice activity
    const monitorAudio = () => {
      if (!analyserRef.current || !isRecordingRef.current) {
        console.log('🎤 VAD monitoring stopped - analyser:', !!analyserRef.current, 'recording:', isRecordingRef.current);
        return;
      }
      
      analyserRef.current.getByteFrequencyData(dataArray);
      
      // Calculate RMS (Root Mean Square) for volume level
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / bufferLength) / 255;
      
      // Log audio levels every 50 iterations (every 5 seconds) for debugging
      if (Math.random() < 0.02) { // ~2% chance each iteration
        console.log('🎤 Audio level check - RMS:', rms.toFixed(4), 'Threshold:', VAD_CONFIG.volumeThreshold, 'Above threshold:', rms > VAD_CONFIG.volumeThreshold);
      }
      
      const now = Date.now();
      
      // Check if speech is detected
      if (rms > VAD_CONFIG.volumeThreshold) {
        lastSpeechTimeRef.current = now;
        setIsListening(true);
        isListeningRef.current = true;
        
        // Clear any existing silence timeout
        if (silenceTimeoutRef.current) {
          clearTimeout(silenceTimeoutRef.current);
          silenceTimeoutRef.current = null;
        }
      } else {
        // No speech detected
        setIsListening(false);
        isListeningRef.current = false;
        
        // Only start silence timeout if we've been recording for minimum time
        // and we've detected speech before
        const recordingDuration = now - recordingStartTimeRef.current;
        const timeSinceLastSpeech = now - lastSpeechTimeRef.current;
        
        if (recordingDuration > VAD_CONFIG.minRecordingMs && 
            lastSpeechTimeRef.current > 0 && 
            timeSinceLastSpeech > 300 && // 300ms buffer
            !silenceTimeoutRef.current) {
          
          console.log('🎤 Starting silence timeout - recording duration:', recordingDuration, 'time since speech:', timeSinceLastSpeech);
          silenceTimeoutRef.current = setTimeout(() => {
            console.log('🎤 Silence timeout reached - auto-stopping recording');
            stopRecordingAndSend();
          }, VAD_CONFIG.silenceTimeoutMs);
        }
      }
    };
    
    // Start monitoring
    vadIntervalRef.current = setInterval(monitorAudio, 100); // Check every 100ms
    console.log('🎤 VAD monitoring started - checking every 100ms');
    
  } catch (error) {
    console.error('🎤 Error setting up VAD:', error);
    // VAD setup failed, but recording can still work normally
  }
}, [isRecording]);
```

### **Audio Recording with Format Support**

```typescript
// Start recording audio with VAD
const startRecording = useCallback(async () => {
  try {
    // Check if microphone is available first
    const isAvailable = await checkMicrophoneAccess();
    if (!isAvailable) {
      const errorMsg = getErrorMessage(permissionStatus);
      throw new Error(errorMsg);
    }

    // Request microphone access with more specific constraints
    const constraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 16000, // Whisper works well with 16kHz
      }
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    microphoneStreamRef.current = stream;
    
    // Check if MediaRecorder is supported
    let mimeType = 'audio/wav';
    const supportedTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/wav'];
    
    for (const type of supportedTypes) {
      if (MediaRecorder.isTypeSupported(type)) {
        mimeType = type;
        break;
      }
    }
    
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      // Fallback for Safari - try without specific codec
      const fallbackTypes = ['audio/mp4', 'audio/wav', ''];
      let foundSupport = false;
      
      for (const type of fallbackTypes) {
        try {
          new MediaRecorder(stream, type ? { mimeType: type } : {});
          mimeType = type;
          foundSupport = true;
          break;
        } catch (e) {
          continue;
        }
      }
      
      if (!foundSupport) {
        stream.getTracks().forEach(track => track.stop());
        throw new Error('MediaRecorder not supported in this browser. Please try Chrome, Firefox, or Edge.');
      }
    }

    // Create MediaRecorder with supported format
    const recorderOptions = mimeType ? { mimeType } : {};
    const mediaRecorder = new MediaRecorder(stream, recorderOptions);
    
    mediaRecorderRef.current = mediaRecorder;
    audioChunksRef.current = [];
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunksRef.current.push(event.data);
      }
    };
    
    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
      await transcribeAudio(audioBlob);
      
      // Stop all tracks to release the microphone
      stream.getTracks().forEach(track => track.stop());
    };

    mediaRecorder.onerror = (event) => {
      console.error('MediaRecorder error:', event);
      setIsRecording(false);
      isRecordingRef.current = false; // Reset ref on error
      stream.getTracks().forEach(track => track.stop());
      cleanupVAD();
      options.onError?.(new Error('Recording failed'));
    };
    
    // Setup Voice Activity Detection
    await setupVAD(stream);
    
    recordingStartTimeRef.current = Date.now(); // Track start time for VAD
    mediaRecorder.start(1000); // Collect data every second
    setIsRecording(true);
    isRecordingRef.current = true; // Update ref for VAD monitoring
    console.log('🎤 Recording started with voice activity detection');
    console.log('🎤 isRecording state:', true, 'isRecordingRef:', isRecordingRef.current);
    console.log('🎤 VAD Config:', VAD_CONFIG);
    console.log('🎤 AudioContext state:', audioContextRef.current?.state);
    
  } catch (error) {
    console.error('Error starting recording:', error);
    setIsRecording(false);
    isRecordingRef.current = false; // Reset ref on error
    cleanupVAD();
    
    // Provide more helpful error messages
    let errorMessage = 'Failed to start recording';
    if (error instanceof Error) {
      if (error.name === 'NotFoundError') {
        errorMessage = 'No microphone found. Please check if a microphone is connected.';
      } else if (error.name === 'NotAllowedError') {
        errorMessage = 'Microphone access denied. Please allow microphone permission in your browser.';
      } else if (error.name === 'NotSupportedError') {
        errorMessage = 'Audio recording not supported in this browser. Please try Chrome, Firefox, or Edge.';
      } else if (error.message.includes('MediaRecorder')) {
        errorMessage = 'Voice recording not supported in this browser. Please try Chrome, Firefox, or Edge for the best experience.';
      } else {
        errorMessage = error.message;
      }
    }
    
    options.onError?.(new Error(errorMessage));
  }
}, [options, checkMicrophoneAccess, permissionStatus, setupVAD, cleanupVAD]);
```

### **Voice Configuration**

```typescript
// VAD Configuration
const VAD_CONFIG = {
  silenceThreshold: 0.01,     // Volume threshold below which is considered silence
  silenceTimeoutMs: 2000,     // Wait 2 seconds of silence before auto-sending (increased)
  minRecordingMs: 1500,       // Minimum recording time before allowing auto-send (increased)
  volumeThreshold: 0.12,      // Threshold for detecting speech (increased from 0.05 to reduce false positives)
};
```

---

## 4. 🎛️ **Voice Configuration and Management**

### **Available Voices Configuration**

```typescript
// Load available voices from TTS service
const loadAvailableVoices = useCallback(async () => {
  try {
    const response = await voiceAPI.getVoices() as { voices: any[] };
    setAvailableVoices(response.voices || []);
    console.log('🎤 Loaded available voices:', response.voices);
  } catch (error) {
    console.error('🎤 Error loading voices:', error);
    // Set default voices if service is unavailable
    setAvailableVoices([
      { id: 'default', name: 'Default English', language: 'en', gender: 'neutral' },
      { id: 'male_1', name: 'English Male', language: 'en', gender: 'male' },
      { id: 'female_1', name: 'English Female', language: 'en', gender: 'female' }
    ]);
  }
}, []);

// Change voice selection
const changeVoice = useCallback((voiceId: string) => {
  setSelectedVoice(voiceId);
  // Save to localStorage
  if (typeof window !== 'undefined') {
    localStorage.setItem('foundry-tts-voice', voiceId);
  }
  console.log('🎤 Voice changed to:', voiceId);
}, []);
```

---

## 5. 🔧 **Complete API Integration**

### **Request/Response Models**

```typescript
// TTS Request Model
interface TTSRequest {
  text: string;
  voice_id?: string;
  speed?: number;
  format?: string;
}

// Audio playback flow
const audioPlaybackFlow = async (text: string, voiceId: string) => {
  // 1. Call TTS API
  const audioBlob = await voiceAPI.synthesize(text, voiceId);
  
  // 2. Create audio URL
  const audioUrl = URL.createObjectURL(audioBlob);
  
  // 3. Create and configure audio element
  const audio = new Audio(audioUrl);
  
  // 4. Set up event handlers
  audio.onended = () => {
    URL.revokeObjectURL(audioUrl); // Clean up memory
    // Handle conversation mode restart
  };
  
  audio.onerror = () => {
    URL.revokeObjectURL(audioUrl);
    // Handle error recovery
  };
  
  // 5. Play audio
  await audio.play();
};
```

---

## 🎯 **Key Features Summary**

### **🔧 TTS Service Features**
- ✅ **Multi-Engine Fallback**: Chatterbox → Edge TTS → gTTS → eSpeak → Silence
- ✅ **Voice Variety**: Multiple voice personalities (male, female, expressive, calm)
- ✅ **Speed Control**: Adjustable speech rate (0.5x - 2.0x)
- ✅ **Format Support**: WAV and MP3 output formats
- ✅ **Error Resilience**: Graceful fallback between engines

### **🎤 Frontend Audio Features**
- ✅ **Echo Prevention**: Pauses recording during TTS playback
- ✅ **Voice Activity Detection**: Auto-detects speech and silence
- ✅ **Conversation Mode**: Continuous voice interaction
- ✅ **Browser Compatibility**: Works across Chrome, Firefox, Safari, Edge
- ✅ **Format Negotiation**: Automatically selects best audio format
- ✅ **Memory Management**: Proper cleanup of audio URLs and resources

### **🎛️ Audio Processing**
- ✅ **Real-time VAD**: RMS-based voice activity detection
- ✅ **Smart Timeouts**: Prevents hanging on silence
- ✅ **Microphone Management**: Proper stream handling and cleanup
- ✅ **Audio Context**: Web Audio API integration for analysis

This complete implementation provides robust, production-ready speech synthesis and playback with excellent error handling, browser compatibility, and user experience features. 