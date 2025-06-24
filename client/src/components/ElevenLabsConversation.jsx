import React, { useEffect, useRef, useState, useCallback } from 'react';

function VoiceAssistant() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isConnected, setIsConnected] = useState(true); // Always connected for local services
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isInConversationMode, setIsInConversationMode] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const [audioContext, setAudioContext] = useState(null);
  const [availableVoices, setAvailableVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState('female_1');
  const [selectedModel, setSelectedModel] = useState('llama3.2:3b');
  
  const mediaStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const vadIntervalRef = useRef(null);
  const silenceTimeoutRef = useRef(null);
  const lastSpeechTimeRef = useRef(0);
  const isRecordingRef = useRef(false);
  const isInConversationModeRef = useRef(false);
  const audioRef = useRef(null);
  const analyserRef = useRef(null);

  // Voice Activity Detection configuration
  const VAD_CONFIG = {
    silenceThreshold: 0.01,     // Volume threshold for silence
    silenceTimeoutMs: 2000,     // Wait 2s of silence before auto-send
    minRecordingMs: 1500,       // Minimum recording time
    volumeThreshold: 0.12,      // Speech detection threshold
  };

  // API endpoints
  const API_BASE = process.env.REACT_APP_API_URL || '';
  const STT_ENDPOINT = `${API_BASE}/api/voice/transcribe`;
  const TTS_ENDPOINT = `${API_BASE}/api/voice/synthesize`;
  const CHAT_ENDPOINT = `${API_BASE}/api/voice/chat`;
  const VOICES_ENDPOINT = `${API_BASE}/api/voice/voices`;

  // Initialize audio context on user interaction
  const initializeAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioContextRef.current = new AudioContextClass();
      setAudioContext(audioContextRef.current);
      
      // Resume if suspended
      if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }
    }
  }, []);

  useEffect(() => {
    // Load available voices when component mounts
    loadAvailableVoices();
    
    // Cleanup on unmount
    return () => {
      cleanup();
    };
  }, []);

  const cleanup = () => {
    // Stop media stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    
    // Clear intervals and timeouts
    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }
    
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    
    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
  };

  const loadAvailableVoices = async () => {
    try {
      const response = await fetch(VOICES_ENDPOINT);
      const data = await response.json();
      
      if (response.ok && data.voices) {
        setAvailableVoices(data.voices);
        // Set default voice if not already set
        if (data.voices.length > 0 && !selectedVoice) {
          setSelectedVoice(data.voices[0].id);
        }
      }
    } catch (err) {
      console.warn('Failed to load voices:', err);
    }
  };

  // Setup Voice Activity Detection
  const setupVAD = useCallback(async (stream) => {
    if (!audioContextRef.current) {
      initializeAudioContext();
    }

    const audioContext = audioContextRef.current;
    analyserRef.current = audioContext.createAnalyser();
    analyserRef.current.fftSize = 512;
    
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyserRef.current);

    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const monitorAudio = () => {
      if (!analyserRef.current) return;
      
      analyserRef.current.getByteFrequencyData(dataArray);
      
      // Calculate RMS (Root Mean Square) for volume level
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / bufferLength) / 255;
      
      const now = Date.now();
      
      if (rms > VAD_CONFIG.volumeThreshold) {
        // Speech detected
        lastSpeechTimeRef.current = now;
        setIsListening(true);
        
        // Clear any existing silence timeout
        if (silenceTimeoutRef.current) {
          clearTimeout(silenceTimeoutRef.current);
          silenceTimeoutRef.current = null;
        }
      } else {
        // Silence detected
        const recordingDuration = now - (lastSpeechTimeRef.current || now);
        
        if (recordingDuration > VAD_CONFIG.minRecordingMs && lastSpeechTimeRef.current > 0) {
          if (!silenceTimeoutRef.current) {
            silenceTimeoutRef.current = setTimeout(() => {
              if (isInConversationModeRef.current) {
                stopRecordingAndSend();
              }
            }, VAD_CONFIG.silenceTimeoutMs);
          }
        }
        
        setIsListening(false);
      }
    };
    
    vadIntervalRef.current = setInterval(monitorAudio, 100);
  }, []);

  // Clean up VAD
  const cleanupVAD = () => {
    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }
    
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    
    if (analyserRef.current) {
      analyserRef.current = null;
    }
  };

  const startRecording = async () => {
    try {
      // Initialize audio context on first user interaction
      initializeAudioContext();
      
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000
        } 
      });
      
      mediaStreamRef.current = stream;
      
      // Setup Voice Activity Detection
      await setupVAD(stream);
      
      // Create MediaRecorder
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });
      
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      mediaRecorder.onstop = async () => {
        if (audioChunksRef.current.length > 0) {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          await processAudioBlob(audioBlob);
        }
      };
      
      mediaRecorder.start();
      isRecordingRef.current = true;
      setIsRecording(true);
      
    } catch (err) {
      console.error('Error starting recording:', err);
      setError('Microphone access denied or not available');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecordingRef.current) {
      mediaRecorderRef.current.stop();
      isRecordingRef.current = false;
      setIsRecording(false);
    }
    
    cleanupVAD();
    
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
  };

  const stopRecordingAndSend = () => {
    stopRecording();
  };

  const processAudioBlob = async (audioBlob) => {
    try {
      setIsTranscribing(true);
      
      // Convert to WAV for better compatibility
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');
      
      // Transcribe audio
      const sttResponse = await fetch(STT_ENDPOINT, {
        method: 'POST',
        body: formData,
      });
      
      if (!sttResponse.ok) {
        throw new Error('Speech transcription failed');
      }
      
      const sttData = await sttResponse.json();
      const transcribedText = sttData.text?.trim();
      
      if (!transcribedText) {
        console.warn('No text transcribed from audio');
        return;
      }
      
      // Add user message to transcript
      const userMessage = {
        role: 'user',
        content: transcribedText,
        timestamp: new Date().toISOString()
      };
      
      setTranscript(prev => [...prev, userMessage]);
      
      // Send to LLM and get TTS response
      await processTextWithLLM(transcribedText);
      
    } catch (err) {
      console.error('Error processing audio:', err);
      setError('Failed to process audio: ' + err.message);
    } finally {
      setIsTranscribing(false);
    }
  };

  const processTextWithLLM = async (text) => {
    try {
      setIsLoading(true);
      
      // Send to complete voice chat endpoint
      const response = await fetch(CHAT_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: text,
          model: selectedModel,
          voice_id: selectedVoice,
          speed: 1.0,
          return_audio: true
        }),
      });
      
      if (!response.ok) {
        throw new Error('Voice chat failed');
      }
      
      const data = await response.json();
      
      if (!data.response_text) {
        throw new Error('No response generated');
      }
      
      // Add assistant message to transcript
      const assistantMessage = {
        role: 'assistant',
        content: data.response_text,
        timestamp: new Date().toISOString()
      };
      
      setTranscript(prev => [...prev, assistantMessage]);
      
      // Synthesize and play response
      await speak(data.response_text);
      
    } catch (err) {
      console.error('Error processing with LLM:', err);
      setError('Failed to generate response: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const speak = async (text) => {
    try {
      setIsSpeaking(true);
      
      // Pause recording during TTS to prevent echo
      const wasRecording = isRecordingRef.current;
      const wasInConversationMode = isInConversationModeRef.current;
      
      if (wasRecording) {
        stopRecording();
      }
      
      const response = await fetch(TTS_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: text,
          voice_id: selectedVoice,
          speed: 1.0
        }),
      });
      
      if (!response.ok) {
        throw new Error('Speech synthesis failed');
      }
      
      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      
      audioRef.current = new Audio(audioUrl);
      
      audioRef.current.onended = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
        
        // Resume conversation mode recording after TTS ends
        if (wasInConversationMode && isInConversationModeRef.current) {
          setTimeout(() => {
            if (isInConversationModeRef.current && !isRecordingRef.current) {
              startRecording();
            }
          }, 1000); // 1 second delay to prevent echo
        }
      };
      
      await audioRef.current.play();
      
    } catch (err) {
      console.error('Error synthesizing speech:', err);
      setError('Failed to synthesize speech: ' + err.message);
      setIsSpeaking(false);
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const toggleConversationMode = async () => {
    if (isInConversationMode) {
      // Stop conversation mode
      setIsInConversationMode(false);
      isInConversationModeRef.current = false;
      stopRecording();
    } else {
      // Start conversation mode
      setIsInConversationMode(true);
      isInConversationModeRef.current = true;
      await startRecording();
    }
  };

  const clearTranscript = () => {
    setTranscript([]);
  };

  return (
    <div className="elevenlabs-conversation">
      <div className="conversation-header">
        <h2>AI Voice Assistant</h2>
        <p className="subtitle">
          {isInConversationMode 
            ? (isListening ? 'Listening...' : isRecording ? 'Recording...' : isSpeaking ? 'Speaking...' : 'Ready')
            : 'Click microphone to start'
          }
        </p>
        {error && (
          <div className="error-banner">
            <p>{error}</p>
            <button onClick={() => setError(null)} className="close-error">×</button>
          </div>
        )}
      </div>
      
      {/* Voice Controls */}
      <div className="voice-controls">
        <div className="primary-controls">
          <button 
            onClick={toggleRecording}
            className={`mic-button ${isRecording ? 'recording' : ''} ${isListening ? 'listening' : ''}`}
            disabled={isLoading || isTranscribing || isSpeaking}
          >
            <span className="mic-icon">
              {isRecording ? (isListening ? '🎙️' : '🔴') : '🎤'}
            </span>
            <span className="mic-text">
              {isRecording ? 'Stop Recording' : 'Start Recording'}
            </span>
          </button>
          
          <button 
            onClick={toggleConversationMode}
            className={`conversation-button ${isInConversationMode ? 'active' : ''}`}
            disabled={isLoading || isTranscribing}
          >
            <span className="conversation-icon">
              {isInConversationMode ? '⏹️' : '💬'}
            </span>
            <span className="conversation-text">
              {isInConversationMode ? 'Stop Conversation' : 'Conversation Mode'}
            </span>
          </button>
        </div>
        
        {/* Settings */}
        <div className="voice-settings">
          <div className="setting-group">
            <label htmlFor="voice-select">Voice:</label>
            <select 
              id="voice-select"
              value={selectedVoice} 
              onChange={(e) => setSelectedVoice(e.target.value)}
              disabled={isRecording || isSpeaking}
            >
              {availableVoices.map(voice => (
                <option key={voice.id} value={voice.id}>
                  {voice.name} ({voice.engine})
                </option>
              ))}
            </select>
          </div>
          
          <div className="setting-group">
            <label htmlFor="model-select">Model:</label>
            <select 
              id="model-select"
              value={selectedModel} 
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={isRecording || isLoading}
            >
              <option value="llama3.2:3b">LLaMA 3.2 3B (Fast)</option>
              <option value="llama3.2:11b">LLaMA 3.2 11B (Quality)</option>
            </select>
          </div>
        </div>
      </div>
      
      {/* Status Indicators */}
      <div className="status-indicators">
        <div className={`status-item ${isConnected ? 'connected' : 'disconnected'}`}>
          <span className="status-dot"></span>
          <span>Services {isConnected ? 'Connected' : 'Disconnected'}</span>
        </div>
        
        {isLoading && (
          <div className="status-item processing">
            <span className="status-dot"></span>
            <span>Processing...</span>
          </div>
        )}
        
        {isTranscribing && (
          <div className="status-item transcribing">
            <span className="status-dot"></span>
            <span>Transcribing...</span>
          </div>
        )}
        
        {isSpeaking && (
          <div className="status-item speaking">
            <span className="status-dot"></span>
            <span>Speaking...</span>
          </div>
        )}
      </div>
      
      {/* Transcript Display */}
      {transcript.length > 0 && (
        <div className="transcript-display">
          <div className="transcript-header">
            <h3>Conversation</h3>
            <button onClick={clearTranscript} className="clear-button">
              Clear
            </button>
          </div>
          <div className="transcript-messages">
            {transcript.map((msg, idx) => (
              <div key={idx} className={`transcript-message ${msg.role}`}>
                <div className="message-header">
                  <span className="role">{msg.role === 'user' ? 'You' : 'Assistant'}:</span>
                  <span className="timestamp">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div className="content">{msg.content}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Instructions */}
      <div className="instructions">
        <h4>How to use:</h4>
        <ul>
          <li><strong>Single Recording:</strong> Click microphone, speak, then click stop</li>
          <li><strong>Conversation Mode:</strong> Enable for hands-free conversation with automatic voice detection</li>
          <li><strong>Voice Selection:</strong> Choose from multiple high-quality voice engines</li>
          <li><strong>Model Selection:</strong> 3B for speed, 11B for higher quality responses</li>
        </ul>
      </div>
    </div>
  );
}

export default VoiceAssistant; 