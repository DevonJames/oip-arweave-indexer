import React from 'react';
import { createRoot } from 'react-dom/client';
import ElevenLabsConversation from './components/ElevenLabsConversation';
import './styles/elevenlabs-conversation.css';

// When the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  // Mount React app if the root element exists
  const rootElement = document.getElementById('voice-assistant-root');
  
  if (rootElement) {
    const root = createRoot(rootElement);
    root.render(<ElevenLabsConversation />);
  }
}); 