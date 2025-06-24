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

export default function VoiceAssistant() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isInConversationMode, setIsInConversationMode] = useState(false);
  const [transcript, setTranscript] = useState<Message[]>([]);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [availableVoices, setAvailableVoices] = useState<Voice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState('female_1');
  const [selectedModel, setSelectedModel] = useState('llama3.2:3b');
  
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

  // Voice Activity Detection configuration
  const VAD_CONFIG = {
    silenceThreshold: 0.01,
    silenceTimeoutMs: 2000,
    minRecordingMs: 1500,
    volumeThreshold: 0.12,
  };

  // API endpoints
  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005';
  const STT_ENDPOINT = `${API_BASE}/api/voice/transcribe`;
  const TTS_ENDPOINT = `${API_BASE}/api/voice/synthesize`;
  const CHAT_ENDPOINT = `${API_BASE}/api/voice/chat`;
  const VOICES_ENDPOINT = `${API_BASE}/api/voice/voices`;

  // Initialize audio context on user interaction
  const initializeAudioContext = useCallback(() => {
    if (!audioContextRef.current && typeof window !== 'undefined') {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new AudioContextClass();
      setAudioContext(audioContextRef.current);
      
      if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }
    }
  }, []);

  useEffect(() => {
    loadAvailableVoices();
    
    return () => {
      cleanup();
    };
  }, []);

  const cleanup = () => {
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
        if (data.voices.length > 0 && !selectedVoice) {
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

    const audioContext = audioContextRef.current!;
    analyserRef.current = audioContext.createAnalyser();
    analyserRef.current.fftSize = 512;
    
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyserRef.current);

    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const monitorAudio = () => {
      if (!analyserRef.current) return;
      
      analyserRef.current.getByteFrequencyData(dataArray);
      
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / bufferLength) / 255;
      
      const now = Date.now();
      
      if (rms > VAD_CONFIG.volumeThreshold) {
        lastSpeechTimeRef.current = now;
        setIsListening(true);
        
        if (silenceTimeoutRef.current) {
          clearTimeout(silenceTimeoutRef.current);
          silenceTimeoutRef.current = null;
        }
      } else {
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
      initializeAudioContext();
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000
        } 
      });
      
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

  const processAudioBlob = async (audioBlob: Blob) => {
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
      
      if (!transcribedText) {
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
      setError('Failed to process audio: ' + (err as Error).message);
    } finally {
      setIsTranscribing(false);
    }
  };

  const processTextWithLLM = async (text: string) => {
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
      
      if (!data.response_text) {
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
      await speak(data.response_text);
      
    } catch (err) {
      console.error('Error processing with LLM:', err);
      setError('Failed to generate response: ' + (err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const speak = async (text: string) => {
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
      const audioUrl = URL.createObjectURL(audioBlob);
      
      audioRef.current = new Audio(audioUrl);
      
      audioRef.current.onended = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
        
        if (wasInConversationMode && isInConversationModeRef.current) {
          setTimeout(() => {
            if (isInConversationModeRef.current && !isRecordingRef.current) {
              startRecording();
            }
          }, 1000);
        }
      };
      
      await audioRef.current.play();
      
    } catch (err) {
      console.error('Error synthesizing speech:', err);
      setError('Failed to synthesize speech: ' + (err as Error).message);
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
            <span className="text-2xl mb-1">
              {isRecording ? (isListening ? '🎙️' : '🔴') : '🎤'}
            </span>
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
        <div className="flex justify-center gap-6">
          <div className="flex flex-col">
            <label htmlFor="voice-select" className="text-sm font-medium text-gray-700 mb-1">
              Voice:
            </label>
            <select 
              id="voice-select"
              value={selectedVoice} 
              onChange={(e) => setSelectedVoice(e.target.value)}
              disabled={isRecording || isSpeaking}
              className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {availableVoices.map(voice => (
                <option key={voice.id} value={voice.id}>
                  {voice.name} ({voice.engine})
                </option>
              ))}
            </select>
          </div>
          
          <div className="flex flex-col">
            <label htmlFor="model-select" className="text-sm font-medium text-gray-700 mb-1">
              Model:
            </label>
            <select 
              id="model-select"
              value={selectedModel} 
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={isRecording || isSpeaking}
              className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="llama3.2:3b">Llama 3.2 3B</option>
              <option value="mistral:7b">Mistral 7B</option>
              <option value="llama2:7b">Llama 2 7B</option>
              <option value="tinyllama">TinyLlama</option>
            </select>
          </div>
        </div>
      </div>
      
      {/* Transcript */}
      <div className="bg-gray-50 rounded-lg p-4">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-800">Conversation</h3>
          <button 
            onClick={clearTranscript}
            className="px-3 py-1 text-sm bg-gray-500 hover:bg-gray-600 text-white rounded"
          >
            Clear
          </button>
        </div>
        
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {transcript.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              No conversation yet. Start recording to begin!
            </p>
          ) : (
            transcript.map((message, index) => (
              <div 
                key={index}
                className={`
                  flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}
                `}
              >
                               <div 
                 className={`
                   max-w-[70%] px-4 py-2 rounded-lg
                   ${message.role === 'user' 
                     ? 'bg-blue-500 text-white' 
                     : 'bg-white text-gray-800 border border-gray-200'
                   }
                 `}
               >
                 <p className="text-sm">{message.content}</p>
                 
                 {/* RAG Sources for assistant messages */}
                 {message.role === 'assistant' && message.sources && message.sources.length > 0 && (
                   <div className="mt-2 pt-2 border-t border-gray-200">
                     <p className="text-xs text-gray-600 mb-1">
                       📚 Sources ({message.search_results_count} found):
                     </p>
                     <div className="space-y-1">
                       {message.sources.slice(0, 3).map((source, idx) => (
                         <div key={idx} className="text-xs bg-gray-50 p-2 rounded">
                           <div className="font-medium">{source.title}</div>
                           <div className="text-gray-500">
                             by {source.creator} • {source.recordType}
                           </div>
                           {source.preview && (
                             <div className="text-gray-600 mt-1">{source.preview}</div>
                           )}
                         </div>
                       ))}
                     </div>
                   </div>
                 )}
                 
                 {/* Context indicator */}
                 {message.role === 'assistant' && message.context_used && (
                   <div className="mt-2 flex items-center text-xs text-green-600">
                     <span className="inline-block w-2 h-2 bg-green-500 rounded-full mr-1"></span>
                     Context from knowledge base used
                   </div>
                 )}
                 
                 <div className="flex justify-between items-center mt-2">
                   <span className="text-xs opacity-70">
                     {new Date(message.timestamp).toLocaleTimeString()}
                   </span>
                   {message.role === 'assistant' && !message.context_used && (
                     <span className="text-xs text-yellow-600">No context found</span>
                   )}
                 </div>
               </div>
              </div>
            ))
          )}
        </div>
      </div>
      
      {/* Status Indicators */}
      <div className="mt-4 flex justify-center gap-4 text-sm">
        <div className={`flex items-center gap-1 ${isConnected ? 'text-green-600' : 'text-red-600'}`}>
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
          {isConnected ? 'Connected' : 'Disconnected'}
        </div>
        
        {isLoading && (
          <div className="flex items-center gap-1 text-blue-600">
            <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
            Processing...
          </div>
        )}
        
        {isTranscribing && (
          <div className="flex items-center gap-1 text-purple-600">
            <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse"></div>
            Transcribing...
          </div>
        )}
      </div>
    </div>
  );
} 