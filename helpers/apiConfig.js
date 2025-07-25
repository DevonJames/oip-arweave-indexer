/**
 * API Configuration for external services
 */

// LLM API Configuration
const llmConfig = {
    // console.log('running X AI API');
    // xAI Grok-2 API
    grok: {
        baseUrl: 'https://api.x.ai/v1',
        chatEndpoint: '/chat/completions',
        model: 'grok-4',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.XAI_API_KEY}`
        }
    }
};

// Audio Synthesis Configuration
const audioConfig = {
    elevenlabs: {
        baseUrl: 'https://api.elevenlabs.io/v1',
        textToSpeechEndpoint: '/text-to-speech',
        voiceId: 'EXAVITQu4vr4xnSDxMaL',
        headers: {
            'Content-Type': 'application/json',
            'xi-api-key': `${process.env.ELEVENLABS_API_KEY}`
        },
        outputFormat: 'mp3' // Safari-compatible format
    }
};

module.exports = {
    llm: llmConfig,
    audio: audioConfig,
    tts: {
        elevenLabs: {
            apiKey: process.env.ELEVENLABS_API_KEY,
            baseUrl: 'https://api.elevenlabs.io/v1'
        }
    },
    grok: {
        apiKey: process.env.GROK_API_KEY,
        baseUrl: 'https://api.groq.com/openai/v1'
    }
}; 