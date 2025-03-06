import React, { useState, useEffect, useRef } from 'react';
import { useConversation } from '@11labs/react';

function ElevenLabsConversation() {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [volume, setVolume] = useState(1.0);
  
  // Initialize the conversation with handlers
  const conversation = useConversation({
    onConnect: () => {
      console.log('Connected to ElevenLabs');
      setIsConnected(true);
    },
    onDisconnect: () => {
      console.log('Disconnected from ElevenLabs');
      setIsConnected(false);
      setIsListening(false);
    },
    onMessage: (message) => {
      console.log('Message received:', message);
      
      // Handle different message types
      if (message.type === 'transcript') {
        // Add user message to transcript
        setTranscript(prev => [...prev, { 
          role: 'user', 
          content: message.text 
        }]);
      } else if (message.type === 'assistant_response') {
        // Add AI response to transcript
        setTranscript(prev => [...prev, { 
          role: 'assistant', 
          content: message.text 
        }]);
      }
    },
    onError: (error) => {
      console.error('ElevenLabs error:', error);
    }
  });
  
  // Add a ref to store the agent ID
  const agentIdRef = useRef('YOUR_DEFAULT_AGENT_ID');
  
  // Volume control
  const handleVolumeChange = (e) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    conversation.setVolume({ volume: newVolume });
  };
  
  const startConversation = async () => {
    try {
      // Request microphone access
      await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Get a signed URL from your backend
      const response = await fetch(`/api/elevenlabs/get-signed-url?agentId=${agentIdRef.current}`);
      const data = await response.json();
      
      if (!data.signedUrl) {
        throw new Error('Failed to get signed URL');
      }
      
      // Start the conversation with the signed URL
      const conversationId = await conversation.startSession({ 
        url: data.signedUrl
      });
      
      console.log('Session started with ID:', conversationId);
      setIsListening(true);
    } catch (error) {
      console.error('Error starting conversation:', error);
    }
  };
  
  // Update the toggle function to use our new startConversation function
  const toggleListening = async () => {
    if (!isConnected) {
      await startConversation();
    } else if (isListening) {
      await conversation.endSession();
      setIsListening(false);
    } else {
      setIsListening(true);
    }
  };
  
  return (
    <div className="elevenlabs-conversation">
      <div className="conversation-status">
        Status: {isConnected ? 'Connected' : 'Disconnected'}
        {conversation.isSpeaking && ' (AI is speaking)'}
      </div>
      
      <div className="conversation-transcript">
        {transcript.map((message, index) => (
          <div key={index} className={`message ${message.role}`}>
            <strong>{message.role === 'user' ? 'You' : 'AI'}:</strong> {message.content}
          </div>
        ))}
      </div>
      
      <div className="conversation-controls">
        <button 
          onClick={toggleListening}
          className={isListening ? 'mic-active' : ''}
        >
          {isListening ? 'Stop Listening' : 'Start Conversation'}
        </button>
        
        <div className="volume-control">
          <label htmlFor="volume">Volume:</label>
          <input
            type="range"
            id="volume"
            min="0"
            max="1"
            step="0.1"
            value={volume}
            onChange={handleVolumeChange}
          />
        </div>
      </div>
      
      <div className="conversation-indicators">
        {isConnected && (
          <>
            <div className={`indicator ${conversation.isSpeaking ? 'active' : ''}`}>
              {conversation.isSpeaking ? 'AI Speaking' : 'AI Listening'}
            </div>
            
            <div className="conversation-status">
              Status: {conversation.status}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ElevenLabsConversation; 