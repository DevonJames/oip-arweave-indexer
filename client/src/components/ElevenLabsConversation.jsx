import React, { useEffect, useRef, useState, useCallback } from 'react';

function ElevenLabsConversation() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [signedUrl, setSignedUrl] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const [audioContext, setAudioContext] = useState(null);
  
  const widgetRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const webSocketRef = useRef(null);
  const mediaRecorderRef = useRef(null);

  // Default agent ID - you can make this configurable
  const AGENT_ID = process.env.REACT_APP_ELEVENLABS_AGENT_ID || 'default-agent';

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
    // Fetch signed URL when component mounts
    fetchSignedUrl();
    
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
    
    // Close WebSocket
    if (webSocketRef.current) {
      webSocketRef.current.close();
      webSocketRef.current = null;
    }
    
    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
  };

  const fetchSignedUrl = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const response = await fetch(`/api/elevenlabs/get-signed-url?agentId=${AGENT_ID}`);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to get signed URL');
      }
      
      setSignedUrl(data.signedUrl);
    } catch (err) {
      console.error('Error fetching signed URL:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!signedUrl || !widgetRef.current) return;

    // First try to load the official ElevenLabs widget
    loadElevenLabsWidget();
  }, [signedUrl]);

  const loadElevenLabsWidget = () => {
    const script = document.createElement('script');
    script.src = 'https://elevenlabs.io/convai-widget/index.js';
    script.async = true;
    
    let widgetLoadTimeout = setTimeout(() => {
      console.warn('ElevenLabs widget load timeout, falling back to custom implementation');
      setError('Widget load timeout - using fallback mode');
      // Fallback to custom WebSocket implementation
      initializeCustomWebSocket();
    }, 5000);
    
    script.onload = () => {
      clearTimeout(widgetLoadTimeout);
      
      // Initialize the widget once script is loaded
      if (window.ElevenLabsConversation) {
        try {
          window.ElevenLabsConversation.init({
            container: widgetRef.current,
            url: signedUrl,
            config: {
              autoplay: false,
              theme: {
                primaryColor: '#4dd0e1',
                backgroundColor: '#e0f7fa',
                textColor: '#00796b'
              },
              ui: {
                showTranscript: true,
                showControls: true,
                showWaveform: true
              }
            },
            onConnect: () => {
              console.log('Connected to ElevenLabs conversation');
              setIsConnected(true);
              setError(null);
            },
            onDisconnect: () => {
              console.log('Disconnected from ElevenLabs conversation');
              setIsConnected(false);
            },
            onError: (error) => {
              console.error('ElevenLabs conversation error:', error);
              setError('Widget error: ' + error.message);
              // Fallback to custom implementation on widget error
              initializeCustomWebSocket();
            },
            onMessage: (message) => {
              console.log('Received message:', message);
              if (message.type === 'transcript') {
                setTranscript(prev => [...prev, message]);
              }
            }
          });
        } catch (initError) {
          console.error('Widget initialization error:', initError);
          setError('Failed to initialize widget');
          initializeCustomWebSocket();
        }
      } else {
        setError('ElevenLabs widget not found');
        initializeCustomWebSocket();
      }
    };

    script.onerror = () => {
      clearTimeout(widgetLoadTimeout);
      setError('Failed to load ElevenLabs conversation widget - using fallback');
      initializeCustomWebSocket();
    };

    document.body.appendChild(script);
  };

  // Custom WebSocket implementation as fallback
  const initializeCustomWebSocket = async () => {
    try {
      // Extract WebSocket URL from signed URL
      const wsUrl = signedUrl.replace('https://', 'wss://').replace('http://', 'ws://');
      
      webSocketRef.current = new WebSocket(wsUrl);
      
      webSocketRef.current.onopen = () => {
        console.log('WebSocket connected');
        setIsConnected(true);
        setError(null);
      };
      
      webSocketRef.current.onclose = () => {
        console.log('WebSocket disconnected');
        setIsConnected(false);
      };
      
      webSocketRef.current.onerror = (event) => {
        console.error('WebSocket error:', event);
        setError('Connection error - please try again');
      };
      
      webSocketRef.current.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'audio') {
            await playAudio(data.audio);
          } else if (data.type === 'transcript') {
            setTranscript(prev => [...prev, {
              role: data.role,
              content: data.content,
              timestamp: new Date().toISOString()
            }]);
          }
        } catch (err) {
          console.error('Error processing message:', err);
        }
      };
    } catch (err) {
      console.error('Failed to initialize WebSocket:', err);
      setError('Failed to establish connection');
    }
  };

  const playAudio = async (audioData) => {
    if (!audioContext) {
      initializeAudioContext();
    }
    
    try {
      // Decode base64 audio data
      const binaryString = atob(audioData);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      // Decode audio data
      const audioBuffer = await audioContext.decodeAudioData(bytes.buffer);
      
      // Create and play audio source
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.start(0);
    } catch (err) {
      console.error('Error playing audio:', err);
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
          autoGainControl: true
        } 
      });
      
      mediaStreamRef.current = stream;
      
      // If using custom WebSocket implementation
      if (webSocketRef.current && webSocketRef.current.readyState === WebSocket.OPEN) {
        const mediaRecorder = new MediaRecorder(stream, {
          mimeType: 'audio/webm;codecs=opus'
        });
        
        mediaRecorderRef.current = mediaRecorder;
        
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0 && webSocketRef.current.readyState === WebSocket.OPEN) {
            // Convert blob to base64 and send
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64data = reader.result.split(',')[1];
              webSocketRef.current.send(JSON.stringify({
                type: 'audio',
                data: base64data
              }));
            };
            reader.readAsDataURL(event.data);
          }
        };
        
        mediaRecorder.start(100); // Send chunks every 100ms
      }
      
      setIsRecording(true);
    } catch (err) {
      console.error('Error starting recording:', err);
      setError('Microphone access denied or not available');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    
    setIsRecording(false);
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  if (isLoading) {
    return (
      <div className="elevenlabs-conversation">
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Loading voice assistant...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="elevenlabs-conversation">
      <div className="conversation-header">
        <h2>AI Voice Assistant</h2>
        <p className="subtitle">
          {isConnected ? 'Connected - Click the microphone to start' : 'Connecting...'}
        </p>
        {error && (
          <div className="error-banner">
            <p>{error}</p>
          </div>
        )}
      </div>
      
      {/* Container for the ElevenLabs widget */}
      <div 
        ref={widgetRef} 
        className="elevenlabs-widget-container"
        style={{ minHeight: '400px' }}
      >
        {/* Fallback UI if widget doesn't load */}
        {error && error.includes('fallback') && (
          <div className="fallback-ui">
            <button 
              onClick={toggleRecording}
              className={`mic-button ${isRecording ? 'recording' : ''}`}
              disabled={!isConnected}
            >
              <span className="mic-icon">{isRecording ? '🔴' : '🎤'}</span>
              <span className="mic-text">
                {isRecording ? 'Stop Recording' : 'Start Recording'}
              </span>
            </button>
            
            {/* Transcript display */}
            {transcript.length > 0 && (
              <div className="transcript-display">
                <h3>Transcript</h3>
                <div className="transcript-messages">
                  {transcript.map((msg, idx) => (
                    <div key={idx} className={`transcript-message ${msg.role}`}>
                      <span className="role">{msg.role}:</span>
                      <span className="content">{msg.content}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      
      {/* Controls */}
      <div className="conversation-controls">
        <button 
          onClick={() => {
            if (window.ElevenLabsConversation && window.ElevenLabsConversation.toggleMute) {
              window.ElevenLabsConversation.toggleMute();
            }
          }}
          className="control-button"
          disabled={!isConnected}
        >
          Toggle Mute
        </button>
        
        <button 
          onClick={() => {
            cleanup();
            fetchSignedUrl();
          }}
          className="control-button restart-button"
        >
          Restart Conversation
        </button>
        
        <button 
          onClick={() => {
            setTranscript([]);
          }}
          className="control-button"
        >
          Clear Transcript
        </button>
      </div>
    </div>
  );
}

export default ElevenLabsConversation; 