'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  sources?: Source[];
  context_used?: boolean;
  search_results_count?: number;
}

interface Source {
  type: string;
  title: string;
  creator: string;
  didTx: string;
  recordType: string;
  preview: string;
}

interface Voice {
  id: string;
  name: string;
  engine: string;
}

// Custom Microphone Icon Component
const MicrophoneIcon = ({ isRecording, isListening, className = "" }: { 
  isRecording: boolean; 
  isListening: boolean; 
  className?: string;
}) => {
  let color = '#6B7280'; // Default gray
  if (isRecording && isListening) {
    color = '#EF4444'; // Red when actively listening
  } else if (isRecording) {
    color = '#F59E0B'; // Amber when recording but not listening
  } else {
    color = '#3B82F6'; // Blue when ready
  }

  return (
    <svg 
      width="32" 
      height="32" 
      viewBox="0 0 1200 1200" 
      className={className}
      fill={color}
    >
      <path d="m420.84 524.53v16.922c0 64.547 34.312 121.22 85.547 152.76 18.703 11.531 39.844 19.688 62.297 23.625 10.219 1.7812 20.625 2.7656 31.312 2.7656s21.141-0.9375 31.312-2.7656c22.453-3.9375 43.547-12.141 62.297-23.625 51.234-31.547 85.547-88.219 85.547-152.76v-242.2c0-64.547-34.312-121.22-85.547-152.63-0.60938-0.375-1.2188-0.70312-1.7812-1.0781h-0.23438c-18.234-11.062-38.625-18.844-60.234-22.547-10.219-1.7812-20.625-2.7656-31.312-2.7656s-21.141 0.9375-31.312 2.7656c-21.609 3.8438-42 11.625-60.234 22.547h-0.23438c-0.60938 0.375-1.2188 0.60938-1.7812 1.0781-51.234 31.453-85.547 88.078-85.547 152.63v225.28zm24 12h90.469c6.6094 0 12-5.3906 12-12s-5.3906-12-12-12h-90.469v-47.062h90.469c6.6094 0 12-5.3906 12-12s-5.3906-12-12-12h-90.469v-47.062h90.469c6.6094 0 12-5.3906 12-12s-5.3906-12-12-12h-90.469v-47.062h90.469c6.6094 0 12-5.3906 12-12s-5.3906-12-12-12h-90.469v-0.23438c0-48 21.938-90.938 56.297-119.39v60.609c0 6.6094 5.3906 12 12 12s12-5.3906 12-12v-77.062c10.688-5.8594 22.078-10.547 33.938-13.781v90.844c0 6.6094 5.3906 12 12 12s12-5.3906 12-12v-95.391c5.5312-0.60938 11.156-0.9375 16.922-0.9375s11.391 0.375 16.922 0.9375v95.391c0 6.6094 5.3906 12 12 12s12-5.3906 12-12v-90.844c11.859 3.2344 23.297 7.9219 33.938 13.781v77.062c0 6.6094 5.3906 12 12 12s12-5.3906 12-12v-60.609c34.312 28.453 56.297 71.391 56.297 119.39v0.23438h-90.469c-6.6094 0-12 5.3906-12 12s5.3906 12 12 12h90.469v47.062h-90.469c-6.6094 0-12 5.3906-12 12s5.3906 12 12 12h90.469v47.062h-90.469c-6.6094 0-12 5.3906-12 12s5.3906 12 12 12h90.469v47.062h-90.469c-6.6094 0-12 5.3906-12 12s5.3906 12 12 12h90.469v4.9219c0 48-21.938 90.938-56.297 119.39v-60.469c0-6.6094-5.3906-12-12-12s-12 5.3906-12 12v76.922c-10.688 5.8594-22.078 10.547-33.938 13.781v-90.703c0-6.6094-5.3906-12-12-12s-12 5.3906-12 12v95.297c-5.5312 0.60938-11.156 0.9375-16.922 0.9375s-11.391-0.375-16.922-0.9375v-95.297c0-6.6094-5.3906-12-12-12s-12 5.3906-12 12v90.703c-11.859-3.2344-23.297-7.9219-33.938-13.781v-76.922c0-6.6094-5.3906-12-12-12s-12 5.3906-12 12v60.469c-34.312-28.453-56.297-71.391-56.297-119.39z"/>
      <path d="m338.16 444.37c-11.531 0-22.453 4.4531-30.703 12.703-8.1562 8.1562-12.703 19.219-12.703 30.703v53.625c0 152.76 111.7 280.78 261.71 302.16v126.94h-85.453c-31.219 0-56.531 25.312-56.531 56.391v28.781c0 13.312 10.922 24.234 24.375 24.234h322.31c13.453 0 24.375-10.922 24.375-24.234v-28.781c0-31.078-25.312-56.391-56.531-56.391h-85.453v-126.94c150-21.375 261.71-149.39 261.71-302.16v-53.625c0-11.531-4.5469-22.547-12.703-30.703-8.2969-8.2969-19.219-12.703-30.703-12.703-24 0-43.547 19.453-43.547 43.453v48c0 119.06-94.219 219.47-209.86 223.78-60 2.2969-116.53-19.453-159.71-60.938-43.219-41.531-66.938-97.312-66.938-157.22v-53.625c0-24-19.547-43.453-43.547-43.453zm93.844 271.55c47.859 46.078 110.86 70.078 177.24 67.688 128.53-4.7812 233.06-116.06 233.06-247.78v-48c0-10.688 8.7656-19.453 19.547-19.453 5.1562 0 10.078 2.0625 13.781 5.625 3.6094 3.7031 5.625 8.625 5.625 13.781v53.625c0 144.14-107.86 264.37-251.06 279.71l-10.688 1.0781v172.31h109.45c17.859 0 32.531 14.531 32.531 32.391l-0.375 29.062-322.69-0.23438v-28.781c0-17.859 14.625-32.391 32.531-32.391h109.45v-172.31l-10.688-1.0781c-143.16-15.375-251.06-135.61-251.06-279.71v-53.625c0-5.1562 2.0625-10.078 5.625-13.781 3.7031-3.6094 8.625-5.625 13.781-5.625 10.781 0 19.547 8.7656 19.547 19.453v53.625c0 66.375 26.391 128.39 74.297 174.47z"/>
    </svg>
  );
};

export default function VoiceAssistant() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isInConversationMode, setIsInConversationMode] = useState(false);
  const [transcript, setTranscript] = useState<Message[]>([]);
  const [availableVoices, setAvailableVoices] = useState<Voice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState('female_1');
  const [selectedModel, setSelectedModel] = useState('llama3.2:3b');
  const [isBrowserSupported, setIsBrowserSupported] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const vadIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSpeechTimeRef = useRef(0);
  const isRecordingRef = useRef(false);
  const isInConversationModeRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mountedRef = useRef(true);

  // Voice Activity Detection configuration
  const VAD_CONFIG = {
    silenceThreshold: 0.01,
    silenceTimeoutMs: 500,
    minRecordingMs: 1000,
    volumeThreshold: 0.12,
  };

  // API endpoints
  const API_BASE = '/api';
  const STT_ENDPOINT = `${API_BASE}/voice/transcribe`;
  const TTS_ENDPOINT = `${API_BASE}/voice/synthesize`;
  const CHAT_ENDPOINT = `${API_BASE}/voice/chat`;
  const VOICES_ENDPOINT = `${API_BASE}/voice/voices`;

  // Check browser support
  const checkBrowserSupport = useCallback(() => {
    if (typeof window === 'undefined') return false;
    
    const hasMediaDevices = !!(navigator?.mediaDevices?.getUserMedia);
    const hasMediaRecorder = typeof MediaRecorder !== 'undefined';
    const hasAudioContext = !!(window.AudioContext || (window as any).webkitAudioContext);
    
    return hasMediaDevices && hasMediaRecorder && hasAudioContext;
  }, []);

  // Initialize audio context safely
  const initializeAudioContext = useCallback(() => {
    if (!audioContextRef.current && typeof window !== 'undefined') {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        audioContextRef.current = new AudioContextClass();
        
        if (audioContextRef.current.state === 'suspended') {
          audioContextRef.current.resume().catch(console.warn);
        }
      } catch (err) {
        console.warn('Failed to initialize AudioContext:', err);
      }
    }
  }, []);

  useEffect(() => {
    // Only run on client side
    if (typeof window === 'undefined') return;
    
    const supported = checkBrowserSupport();
    setIsBrowserSupported(supported);
    
    if (supported) {
      loadAvailableVoices();
      setIsInitialized(true);
    } else {
      setError('Your browser does not support voice features. Please use a modern browser like Chrome, Firefox, or Safari.');
    }
    
    return () => {
      mountedRef.current = false;
      cleanup();
    };
  }, [checkBrowserSupport]);

  const cleanup = useCallback(() => {
    try {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
      }
      
      if (vadIntervalRef.current) {
        clearInterval(vadIntervalRef.current);
        vadIntervalRef.current = null;
      }
      
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
        silenceTimeoutRef.current = null;
      }
      
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(console.warn);
        audioContextRef.current = null;
      }
      
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    } catch (err) {
      console.warn('Cleanup error:', err);
    }
  }, []);

  const loadAvailableVoices = async () => {
    try {
      const response = await fetch(VOICES_ENDPOINT);
      const data = await response.json();
      
      if (response.ok && data.voices && mountedRef.current) {
        setAvailableVoices(data.voices);
        
        // Prefer Chatterbox voices over eSpeak
        const chatterboxVoice = data.voices.find((v: Voice) => v.id === 'chatterbox' || v.engine === 'Chatterbox');
        const femaleChatterboxVoice = data.voices.find((v: Voice) => v.name.includes('Female') && v.name.includes('Chatterbox'));
        
        if (chatterboxVoice) {
          console.log('Setting default voice to Chatterbox:', chatterboxVoice.id);
          setSelectedVoice(chatterboxVoice.id);
        } else if (femaleChatterboxVoice) {
          console.log('Setting default voice to Female Chatterbox:', femaleChatterboxVoice.id);
          setSelectedVoice(femaleChatterboxVoice.id);
        } else if (data.voices.length > 0) {
          console.log('Using first available voice:', data.voices[0].id);
          setSelectedVoice(data.voices[0].id);
        }
      }
    } catch (err) {
      console.warn('Failed to load voices:', err);
    }
  };

  const setupVAD = useCallback(async (stream: MediaStream) => {
    if (!audioContextRef.current) {
      initializeAudioContext();
    }

    if (!audioContextRef.current) return;

    try {
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 512;
      
      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);

      const bufferLength = analyserRef.current.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const monitorAudio = () => {
        if (!analyserRef.current || !mountedRef.current) return;
        
        analyserRef.current.getByteFrequencyData(dataArray);
        
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / bufferLength) / 255;
        
        const now = Date.now();
        
        if (rms > VAD_CONFIG.volumeThreshold) {
          lastSpeechTimeRef.current = now;
          if (mountedRef.current) setIsListening(true);
          
          if (silenceTimeoutRef.current) {
            clearTimeout(silenceTimeoutRef.current);
            silenceTimeoutRef.current = null;
          }
        } else {
          const recordingDuration = now - (lastSpeechTimeRef.current || now);
          
          if (recordingDuration > VAD_CONFIG.minRecordingMs && lastSpeechTimeRef.current > 0) {
            if (!silenceTimeoutRef.current) {
              silenceTimeoutRef.current = setTimeout(() => {
                if (isInConversationModeRef.current && mountedRef.current) {
                  stopRecordingAndSend();
                }
              }, VAD_CONFIG.silenceTimeoutMs);
            }
          }
          
          if (mountedRef.current) setIsListening(false);
        }
      };
      
      vadIntervalRef.current = setInterval(monitorAudio, 100);
    } catch (err) {
      console.warn('VAD setup failed:', err);
    }
  }, [initializeAudioContext]);

  const cleanupVAD = useCallback(() => {
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
  }, []);

  const startRecording = async () => {
    if (!isBrowserSupported || !mountedRef.current) return;
    
    try {
      initializeAudioContext();
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000
        } 
      });
      
      if (!mountedRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      
      mediaStreamRef.current = stream;
      await setupVAD(stream);
      
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
        if (audioChunksRef.current.length > 0 && mountedRef.current) {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          await processAudioBlob(audioBlob);
        }
      };
      
      mediaRecorder.start();
      isRecordingRef.current = true;
      if (mountedRef.current) setIsRecording(true);
      
    } catch (err) {
      console.error('Error starting recording:', err);
      if (mountedRef.current) {
        setError('Microphone access denied or not available');
      }
    }
  };

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecordingRef.current) {
      mediaRecorderRef.current.stop();
      isRecordingRef.current = false;
      if (mountedRef.current) setIsRecording(false);
    }
    
    cleanupVAD();
    
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
  }, [cleanupVAD]);

  const stopRecordingAndSend = useCallback(() => {
    stopRecording();
  }, [stopRecording]);

  const processAudioBlob = async (audioBlob: Blob) => {
    if (!mountedRef.current) return;
    
    try {
      setIsTranscribing(true);
      
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');
      
      const sttResponse = await fetch(STT_ENDPOINT, {
        method: 'POST',
        body: formData,
      });
      
      if (!sttResponse.ok) {
        throw new Error('Speech transcription failed');
      }
      
      const sttData = await sttResponse.json();
      const transcribedText = sttData.text?.trim();
      
      if (!transcribedText || !mountedRef.current) {
        console.warn('No text transcribed from audio');
        return;
      }
      
      const userMessage: Message = {
        role: 'user',
        content: transcribedText,
        timestamp: new Date().toISOString()
      };
      
      setTranscript(prev => [...prev, userMessage]);
      await processTextWithLLM(transcribedText);
      
    } catch (err) {
      console.error('Error processing audio:', err);
      if (mountedRef.current) {
        setError('Failed to process audio: ' + (err as Error).message);
      }
    } finally {
      if (mountedRef.current) setIsTranscribing(false);
    }
  };

  const processTextWithLLM = async (text: string) => {
    if (!mountedRef.current) return;
    
    try {
      setIsLoading(true);
      
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
      
      if (!data.response_text || !mountedRef.current) {
        throw new Error('No response generated');
      }
      
      const assistantMessage: Message = {
        role: 'assistant',
        content: data.response_text,
        timestamp: new Date().toISOString(),
        sources: data.sources || [],
        context_used: data.context_used || false,
        search_results_count: data.search_results_count || 0
      };
      
      setTranscript(prev => [...prev, assistantMessage]);
      
      // Handle audio if included in response
      if (data.has_audio && data.audio_data) {
        await speakFromBase64(data.audio_data);
      } else {
        // Fallback to separate TTS call if no audio in response
        await speak(data.response_text);
      }
      
    } catch (err) {
      console.error('Error processing with LLM:', err);
      if (mountedRef.current) {
        setError('Failed to generate response: ' + (err as Error).message);
      }
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  };

  const speakFromBase64 = async (audioBase64: string) => {
    if (!mountedRef.current) return;
    
    try {
      setIsSpeaking(true);
      
      const wasRecording = isRecordingRef.current;
      const wasInConversationMode = isInConversationModeRef.current;
      
      if (wasRecording) {
        stopRecording();
      }
      
      // Convert base64 to audio blob
      const audioBytes = atob(audioBase64);
      const arrayBuffer = new ArrayBuffer(audioBytes.length);
      const uint8Array = new Uint8Array(arrayBuffer);
      
      for (let i = 0; i < audioBytes.length; i++) {
        uint8Array[i] = audioBytes.charCodeAt(i);
      }
      
      const audioBlob = new Blob([arrayBuffer], { type: 'audio/wav' });
      
      if (!mountedRef.current) return;
      
      const audioUrl = URL.createObjectURL(audioBlob);
      
      audioRef.current = new Audio(audioUrl);
      
      audioRef.current.onended = () => {
        if (mountedRef.current) setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
        
        if (wasInConversationMode && isInConversationModeRef.current && mountedRef.current) {
          setTimeout(() => {
            if (isInConversationModeRef.current && !isRecordingRef.current && mountedRef.current) {
              startRecording();
            }
          }, 1000);
        }
      };
      
      audioRef.current.onerror = () => {
        if (mountedRef.current) setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
        if (mountedRef.current) {
          setError('Failed to play synthesized audio');
        }
      };
      
      await audioRef.current.play();
      
    } catch (err) {
      console.error('Error playing base64 audio:', err);
      if (mountedRef.current) {
        setError('Failed to play audio: ' + (err as Error).message);
        setIsSpeaking(false);
      }
    }
  };

  const speak = async (text: string) => {
    if (!mountedRef.current) return;
    
    try {
      setIsSpeaking(true);
      
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
      
      if (!mountedRef.current) return;
      
      const audioUrl = URL.createObjectURL(audioBlob);
      
      audioRef.current = new Audio(audioUrl);
      
      audioRef.current.onended = () => {
        if (mountedRef.current) setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
        
        if (wasInConversationMode && isInConversationModeRef.current && mountedRef.current) {
          setTimeout(() => {
            if (isInConversationModeRef.current && !isRecordingRef.current && mountedRef.current) {
              startRecording();
            }
          }, 1000);
        }
      };
      
      audioRef.current.onerror = () => {
        if (mountedRef.current) setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
      };
      
      await audioRef.current.play();
      
    } catch (err) {
      console.error('Error synthesizing speech:', err);
      if (mountedRef.current) {
        setError('Failed to synthesize speech: ' + (err as Error).message);
        setIsSpeaking(false);
      }
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
      setIsInConversationMode(false);
      isInConversationModeRef.current = false;
      stopRecording();
    } else {
      setIsInConversationMode(true);
      isInConversationModeRef.current = true;
      await startRecording();
    }
  };

  const clearTranscript = () => {
    setTranscript([]);
  };

  // Show loading state while initializing
  if (!isInitialized) {
    return (
      <div className="max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-lg">
        <div className="text-center">
          <h2 className="text-3xl font-bold text-gray-800 mb-4">AI Voice Assistant</h2>
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="text-gray-600 mt-4">Initializing voice features...</p>
        </div>
      </div>
    );
  }

  // Show error state if browser not supported
  if (!isBrowserSupported) {
    return (
      <div className="max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-lg">
        <div className="text-center">
          <h2 className="text-3xl font-bold text-gray-800 mb-4">AI Voice Assistant</h2>
          <div className="p-6 bg-red-100 border border-red-400 text-red-700 rounded-lg">
            <h3 className="text-xl font-semibold mb-2">Browser Not Supported</h3>
            <p>Your browser does not support voice features. Please use a modern browser like:</p>
            <ul className="list-disc list-inside mt-2">
              <li>Google Chrome (recommended)</li>
              <li>Mozilla Firefox</li>
              <li>Safari (macOS/iOS)</li>
              <li>Microsoft Edge</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-lg">
      {/* Header */}
      <div className="text-center mb-6">
        <h2 className="text-3xl font-bold text-gray-800 mb-2">AI Voice Assistant</h2>
        <p className="text-lg text-gray-600">
          {isInConversationMode 
            ? (isListening ? 'Listening...' : isRecording ? 'Recording...' : isSpeaking ? 'Speaking...' : 'Ready')
            : 'Click microphone to start'
          }
        </p>
        {error && (
          <div className="mt-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg flex justify-between items-center">
            <p>{error}</p>
            <button 
              onClick={() => setError(null)} 
              className="text-red-700 hover:text-red-900 font-bold text-xl"
            >
              ×
            </button>
          </div>
        )}
      </div>
      
      {/* Voice Controls */}
      <div className="mb-8">
        <div className="flex justify-center gap-4 mb-6">
          <button 
            onClick={toggleRecording}
            className={`
              flex flex-col items-center px-6 py-4 rounded-lg font-medium transition-all
              ${isRecording 
                ? 'bg-red-500 hover:bg-red-600 text-white' 
                : 'bg-blue-500 hover:bg-blue-600 text-white'
              }
              ${isListening ? 'animate-pulse' : ''}
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
            disabled={isLoading || isTranscribing || isSpeaking}
          >
            <MicrophoneIcon 
              isRecording={isRecording} 
              isListening={isListening}
              className={isListening ? 'animate-pulse' : ''}
            />
            <span className="text-sm">
              {isRecording ? 'Stop Recording' : 'Start Recording'}
            </span>
          </button>
          
          <button 
            onClick={toggleConversationMode}
            className={`
              flex flex-col items-center px-6 py-4 rounded-lg font-medium transition-all
              ${isInConversationMode 
                ? 'bg-green-500 hover:bg-green-600 text-white' 
                : 'bg-gray-500 hover:bg-gray-600 text-white'
              }
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
            disabled={isLoading || isTranscribing}
          >
            <span className="text-2xl mb-1">
              {isInConversationMode ? '⏹️' : '💬'}
            </span>
            <span className="text-sm">
              {isInConversationMode ? 'Stop Conversation' : 'Conversation Mode'}
            </span>
          </button>
        </div>
        
        {/* Settings */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Voice Model
            </label>
            <select 
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              disabled={isLoading || isRecording}
            >
              <option value="llama3.2:3b">LLaMA 3.2 3B (Fast)</option>
              <option value="mistral:latest">Mistral 7B (Balanced)</option>
              <option value="llama2:latest">LLaMA 2 7B (Quality)</option>
              <option value="tinyllama:latest">TinyLlama (Ultra Fast)</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Voice Style
            </label>
            <select 
              value={selectedVoice}
              onChange={(e) => setSelectedVoice(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              disabled={isLoading || isRecording}
            >
              {availableVoices.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.name} ({voice.engine})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Loading States */}
      {(isLoading || isTranscribing || isSpeaking) && (
        <div className="text-center mb-6">
          <div className="inline-flex items-center px-4 py-2 bg-blue-100 text-blue-800 rounded-lg">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
            {isTranscribing && 'Transcribing speech...'}
            {isLoading && 'Processing with AI...'}
            {isSpeaking && 'Speaking response...'}
          </div>
        </div>
      )}

      {/* Transcript */}
      <div className="bg-gray-50 rounded-lg p-4 min-h-[300px] max-h-[500px] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-800">Conversation</h3>
          {transcript.length > 0 && (
            <button
              onClick={clearTranscript}
              className="px-3 py-1 text-sm bg-gray-200 hover:bg-gray-300 text-gray-700 rounded transition-colors"
            >
              Clear
            </button>
          )}
        </div>
        
        {transcript.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            <p>No conversation yet. Click the microphone to start!</p>
          </div>
        ) : (
          <div className="space-y-4">
            {transcript.map((message, index) => (
              <div
                key={index}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`
                    max-w-xs lg:max-w-md px-4 py-2 rounded-lg
                    ${message.role === 'user'
                      ? 'bg-blue-500 text-white'
                      : 'bg-white text-gray-800 border border-gray-200'
                    }
                  `}
                >
                  <p className="text-sm">{message.content}</p>
                  <p className="text-xs opacity-70 mt-1">
                    {new Date(message.timestamp).toLocaleTimeString()}
                  </p>
                  
                  {/* Show sources for assistant messages */}
                  {message.role === 'assistant' && message.sources && message.sources.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-gray-200">
                      <p className="text-xs font-medium text-gray-600 mb-1">
                        Sources ({message.sources.length}):
                      </p>
                      <div className="space-y-1">
                        {message.sources.slice(0, 3).map((source, idx) => (
                          <div key={idx} className="text-xs bg-gray-100 p-2 rounded">
                            <div className="font-medium">{source.title}</div>
                            <div className="text-gray-600">by {source.creator}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Show context info */}
                  {message.role === 'assistant' && message.context_used && (
                    <div className="mt-1 text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                      ✓ Used knowledge base ({message.search_results_count} results)
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      
      {/* Instructions */}
      <div className="mt-6 text-sm text-gray-600 bg-blue-50 p-4 rounded-lg">
        <h4 className="font-medium mb-2">How to use:</h4>
        <ul className="list-disc list-inside space-y-1">
          <li><strong>Single Recording:</strong> Click microphone to record once, click again to stop</li>
          <li><strong>Conversation Mode:</strong> Automatic voice detection - speaks and listens continuously</li>
          <li><strong>Model Selection:</strong> Choose AI model based on speed vs quality preference</li>
          <li><strong>Voice Style:</strong> Select from multiple TTS voices and engines</li>
        </ul>
      </div>
    </div>
  );
} 