document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const micButton = document.getElementById('microphone-btn');
    const transcriptBtn = document.getElementById('transcript-btn');
    const stopBtn = document.getElementById('stop-btn');
    const transcriptPanel = document.getElementById('transcript-panel');
    const closeTranscriptBtn = document.getElementById('close-transcript');
    const transcriptContent = document.getElementById('transcript-content');
    const waveformCanvas = document.getElementById('waveform');
    
    // Canvas context for waveform
    const ctx = waveformCanvas.getContext('2d');
    
    // Adjust canvas resolution for better visualization
    function resizeCanvas() {
        waveformCanvas.width = waveformCanvas.offsetWidth * window.devicePixelRatio;
        waveformCanvas.height = waveformCanvas.offsetHeight * window.devicePixelRatio;
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    }
    
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    // Speech recognition setup
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
        alert("Speech recognition is not supported in your browser. Please use Chrome, Edge, or Safari.");
        micButton.disabled = true;
    }
    
    const recognition = SpeechRecognition ? new SpeechRecognition() : null;
    if (recognition) {
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';
        
        // Add proper error handling for Brave and other browsers
        recognition.onerror = function(event) {
            console.log('Speech recognition error:', event.error);
            
            // Track failures for fallback
            if (!window.speechRecognitionFailures) {
                window.speechRecognitionFailures = 0;
            }
            window.speechRecognitionFailures++;
            
            // Handle specific error types
            switch(event.error) {
                case 'not-allowed':
                    addMessageToTranscript("Microphone access denied. Please enable microphone permissions.", "system");
                    break;
                case 'network':
                    // Common in Brave due to privacy protections
                    setupTextInputFallback();
                    if (!document.getElementById('record-btn')) {
                        setupDirectRecording();
                    }
                    addMessageToTranscript("Network error with speech recognition. Using alternative input methods.", "system");
                    break;
                case 'no-speech':
                    addMessageToTranscript("No speech detected. Please try again.", "system");
                    break;
                case 'aborted':
                    // User or browser aborted the recognition
                    break;
                default:
                    addMessageToTranscript(`Speech recognition error: ${event.error}`, "system");
            }
            
            // Reset UI state
            isListening = false;
            micButton.classList.remove('active');
            
            // Don't try to stop recognition again as it may cause additional errors
            if (event.error !== 'aborted' && event.error !== 'network') {
                try {
                    recognition.stop();
                } catch (e) {
                    console.log('Error stopping recognition after error:', e);
                }
            }
        };
    }
    
    // Replace the audioContext variable and related functions with this updated implementation
    let audioContext;
    let userInteractionOccurred = false;
    let analyser; // For visualization
    let microphone; // Store microphone source
    
    // At the top of your file with other state variables, add this variable
    let isConnected = false;
    let heartbeatInterval = null;
    
    // State variables
    let isListening = false;
    let isPlaying = false;
    let currentTranscript = '';
    let conversationHistory = [];
    let eventSource = null;
    let currentSessionId = null;
    
    // Add a new audio recording fallback for Brave
    let mediaRecorder = null;
    let audioChunks = [];
    let isRecording = false;
    
    // Add these variables near the top of your file, with other global variables
    let audioQueue = [];
    let userHasInteracted = false;
    let playButtonVisible = false;
    
    // Add/update these variables near where audioContext is defined
    let audioSourceNode = null;
    let isPlayingAudio = false;
    
    // Flag to track if audio has been unlocked
    let audioUnlocked = false;
    
    // Initializes audio context with proper setup for browser compatibility
    function initAudioContext() {
        try {
            // Create audio context with proper options for maximum compatibility
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            audioContext = new AudioContext({
                latencyHint: 'interactive',
                sampleRate: 44100 // Standard sample rate supported across browsers
            });
            
            // Check if context is suspended (common in browsers)
            if (audioContext.state === 'suspended') {
                console.log('AudioContext is suspended. Will resume on user interaction.');
            } else {
                console.log('Audio context initialized successfully');
            }
        } catch (error) {
            console.error('Error initializing audio context:', error);
        }
    }
    
    // Resume audio context on user interaction
    function resumeAudioContext() {
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume().then(() => {
                console.log('AudioContext resumed successfully');
                userInteractionOccurred = true;
            }).catch(error => {
                console.error('Failed to resume AudioContext:', error);
            });
        }
    }
    
    // Update the startVisualization function to use our shared audioContext
    function startVisualization(stream) {
        try {
            // Make sure we have initialized our audioContext
            if (!audioContext) {
                initAudioContext();
            }
            
            // Create analyser if it doesn't exist
            if (!analyser) {
                analyser = audioContext.createAnalyser();
                analyser.fftSize = 256;
            }
            
            // Create microphone input source if not already created
            if (!microphone && stream) {
                microphone = audioContext.createMediaStreamSource(stream);
                microphone.connect(analyser);
                // Don't connect to destination to avoid feedback
            }
            
            // Continue with existing visualization code...
            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            
            // Draw visualization
            function draw() {
                requestAnimationFrame(draw);
                
                if (!analyser) return;
                
                analyser.getByteFrequencyData(dataArray);
                
                // Clear canvas
                ctx.clearRect(0, 0, waveformCanvas.width / window.devicePixelRatio, 
                              waveformCanvas.height / window.devicePixelRatio);
                
                // Draw visualization
                const barWidth = (waveformCanvas.width / window.devicePixelRatio) / bufferLength;
                let barHeight;
                let x = 0;
                
                for (let i = 0; i < bufferLength; i++) {
                    barHeight = dataArray[i] / 2;
                    
                    // Use a gradient color based on frequency
                    const hue = i / bufferLength * 270;
                    ctx.fillStyle = `hsl(${hue}, 90%, 50%)`;
                    
                    ctx.fillRect(x, (waveformCanvas.height / window.devicePixelRatio) - barHeight, 
                               barWidth, barHeight);
                    
                    x += barWidth;
                }
            }
            
            draw();
        } catch (error) {
            console.error('Error starting visualization:', error);
        }
    }
    
    // Add a text input fallback UI element
    function setupTextInputFallback() {
        // Check if the fallback already exists
        if (document.getElementById('text-input-fallback')) return;
        
        // Create a container for text input fallback
        const container = document.createElement('div');
        container.id = 'text-input-fallback';
        container.className = 'text-input-container';
        container.style.display = 'flex';
        container.style.marginTop = '10px';
        container.style.width = '100%';
        
        // Create text input
        const input = document.createElement('input');
        input.type = 'text';
        input.id = 'text-input';
        input.placeholder = 'Type your message here...';
        input.style.flex = '1';
        input.style.padding = '8px';
        input.style.borderRadius = '4px 0 0 4px';
        input.style.border = '1px solid #ccc';
        
        // Create send button
        const button = document.createElement('button');
        button.textContent = 'Send';
        button.style.padding = '8px 16px';
        button.style.backgroundColor = '#3498db';
        button.style.color = 'white';
        button.style.border = 'none';
        button.style.borderRadius = '0 4px 4px 0';
        button.style.cursor = 'pointer';
        
        // Add event listener for the button
        button.addEventListener('click', () => {
            const message = input.value.trim();
            if (message) {
                addMessageToTranscript(message, 'user');
                sendMessageToAI(message);
                input.value = '';
            }
        });
        
        // Add event listener for Enter key
        input.addEventListener('keyup', (event) => {
            if (event.key === 'Enter') {
                button.click();
            }
        });
        
        // Append elements to the container
        container.appendChild(input);
        container.appendChild(button);
        
        // Find where to insert the container (after the existing controls)
        const controlsContainer = document.querySelector('.controls-container') || 
                                 micButton.parentElement;
        controlsContainer.parentNode.insertBefore(container, controlsContainer.nextSibling);
        
        return input;
    }
    
    // Add a direct recording option that doesn't use SpeechRecognition
    function setupDirectRecording() {
        // Create a new recording button if microphone doesn't work
        const recordButton = document.createElement('button');
        recordButton.id = 'record-btn';
        recordButton.className = 'control-btn';
        recordButton.title = 'Record audio (fallback)';
        recordButton.innerHTML = '<i class="fas fa-circle"></i>'; // Requires FontAwesome
        recordButton.style.backgroundColor = '#e74c3c';
        
        // Add recording button next to microphone
        const controlsContainer = micButton.parentElement;
        controlsContainer.insertBefore(recordButton, micButton.nextSibling);
        
        // Recording button event handlers
        recordButton.addEventListener('click', () => {
            if (isRecording) {
                stopRecording();
                recordButton.innerHTML = '<i class="fas fa-circle"></i>';
                recordButton.classList.remove('active');
            } else {
                startRecording();
                recordButton.innerHTML = '<i class="fas fa-stop"></i>';
                recordButton.classList.add('active');
            }
        });
    }
    
    // Start direct audio recording (bypass SpeechRecognition)
    async function startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            // Start visualization with the stream
            startVisualization(stream);
            
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            isRecording = true;
            
            mediaRecorder.addEventListener('dataavailable', event => {
                audioChunks.push(event.data);
            });
            
            mediaRecorder.addEventListener('stop', async () => {
                isRecording = false;
                
                // Create audio blob from recorded chunks
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                
                // Create a form with the audio data to send to server
                const formData = new FormData();
                formData.append('audio', audioBlob);
                
                // Add loading indicator or message
                addMessageToTranscript("Processing your audio...", "system");
                
                // Send directly to our converse endpoint
                sendAudioToAI(formData);
            });
            
            mediaRecorder.start();
            addMessageToTranscript("Recording audio... (Click again to stop)", "system");
            
        } catch (error) {
            console.error('Error starting recording:', error);
            addMessageToTranscript("Error accessing microphone. Please check permissions.", "system");
        }
    }
    
    // Stop direct audio recording
    function stopRecording() {
        if (mediaRecorder && isRecording) {
            mediaRecorder.stop();
            addMessageToTranscript("Processing your audio...", "system");
        }
    }
    
    // Function to send audio to AI with fixed SSE handling
    function sendAudioToAI(formData) {
        // Add conversation history for context
        if (conversationHistory.length > 0) {
            formData.append('history', JSON.stringify(conversationHistory));
        }

        // Add personality configuration
        const personality = {
            name: "Assistant",
            description: "A helpful AI assistant.",
            model: "grok-4",
            temperature: 0.7,
            systemPrompt: "You are a helpful assistant. Answer questions concisely and accurately.",
            voices: {
                elevenLabs: {
                    voice_id: "pNInz6obpgDQGcFmaJgB",
                    model_id: "eleven_turbo_v2",
                    stability: 0.5,
                    similarity_boost: 0.75
                }
            }
        };
        
        formData.append('personality', JSON.stringify(personality));
        
        // Clear any existing event source
        if (eventSource) {
            eventSource.close();
            eventSource = null;
        }

        addMessageToTranscript("Processing...", "system");
        
        // Use a unique URL for each request to prevent caching issues
        const uniqueUrl = `/api/generate/converse?_=${Date.now()}`;
        
        fetch(uniqueUrl, {
            method: 'POST',
            body: formData
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`Server returned ${response.status}: ${response.statusText}`);
            }
            
            // Set up variables for streaming response handling
            let responseText = '';
            let audioQueue = [];
            let isAudioPlaying = false;
            
            // Handle the response as a stream
            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';
            
            function processStream({ done, value }) {
                if (done) {
                    console.log("Stream complete");
                    return;
                }
                
                // Decode the current chunk and add it to our buffer
                buffer += decoder.decode(value, { stream: true });
                
                // Process complete events in the buffer
                let lines = buffer.split('\n\n');
                buffer = lines.pop(); // Keep the last incomplete chunk in the buffer
                
                lines.forEach(line => {
                    // Skip empty lines
                    if (!line.trim()) return;
                    
                    // Parse the event type and data
                    const eventMatch = line.match(/^event: (.+)$/m);
                    const dataMatch = line.match(/^data: (.+)$/m);
                    
                    if (!eventMatch || !dataMatch) {
                        console.warn('Malformed SSE message:', line);
                        return;
                    }
                    
                    const eventType = eventMatch[1];
                    const data = dataMatch[1];
                    
                    console.log(`Received event: ${eventType}`);
                    
                    try {
                        // Process different event types
                        switch (eventType) {
                            case 'connected':
                                const connInfo = JSON.parse(data);
                                console.log('Connected to SSE with session ID:', connInfo.sessionId);
                                currentSessionId = connInfo.sessionId;
                                break;
                                
                            case 'transcribing':
                                console.log('Transcribing audio...');
                                break;
                                
                            case 'transcribed':
                                const transcript = JSON.parse(data);
                                addMessageToTranscript(transcript.text, 'user');
                                conversationHistory.push({ role: 'user', content: transcript.text });
                                break;
                                
                            case 'generatingResponse':
                                console.log('AI is generating a response...');
                                break;
                                
                            case 'responseChunk':
                                try {
                                    const jsonData = JSON.parse(data);
                                    if (jsonData.text) {
                                        responseText += jsonData.text;
                                        updateTranscriptMessage(responseText, 'ai');
                                    }
                                } catch (e) {
                                    // If not JSON, treat as plain text
                                    responseText += data;
                                    updateTranscriptMessage(responseText, 'ai');
                                }
                                break;
                                
                            case 'audioChunk':
                                // Handle audio chunks with extra debugging
                                try {
                                    const jsonData = JSON.parse(data);
                                    console.log("Received audio chunk, length:", jsonData.chunk.length);
                                    
                                    // Convert base64 to audio blob
                                    try {
                                        const binaryString = atob(jsonData.chunk);
                                        const len = binaryString.length;
                                        const bytes = new Uint8Array(len);
                                        for (let i = 0; i < len; i++) {
                                            bytes[i] = binaryString.charCodeAt(i);
                                        }
                                        
                                        // Create blob and URL for the audio
                                        const audioBlob = new Blob([bytes], { type: 'audio/mp3' });
                                        const audioUrl = URL.createObjectURL(audioBlob);
                                        
                                        // Add to queue and play
                                        audioQueue.push(audioUrl);
                                        console.log("Added audio to queue, length:", audioQueue.length);
                                        playNextAudioWithRetry();
                                    } catch (e) {
                                        console.error("Error processing audio chunk:", e);
                                    }
                                } catch (e) {
                                    console.error("Error parsing audio chunk JSON:", e);
                                }
                                break;
                                
                            case 'error':
                                const errorData = JSON.parse(data);
                                console.error('AI error:', errorData.message);
                                addMessageToTranscript(`Error: ${errorData.message}`, 'system');
                                break;
                                
                            case 'done':
                                console.log('Conversation complete, full response:', responseText);
                                if (responseText) {
                                    conversationHistory.push({ 
                                        role: 'assistant', 
                                        content: responseText 
                                    });
                                }
                                break;
                        }
                    } catch (e) {
                        console.error('Error handling event:', e, 'Raw data:', data);
                    }
                });
                
                // Continue reading
                return reader.read().then(processStream);
            }
            
            // Start reading the stream
            reader.read().then(processStream);
            
            // Function to play next audio with retry logic for Safari
            function playNextAudioWithRetry(retryCount = 0) {
                if (audioQueue.length === 0 || isAudioPlaying) return;
                
                isAudioPlaying = true;
                const audioUrl = audioQueue.shift();
                console.log("Playing audio from URL:", audioUrl);
                
                const audio = new Audio();
                
                // Safari needs these event listeners before setting the source
                audio.addEventListener('canplaythrough', () => {
                    console.log("Audio can play through");
                    // Initialize audio context if needed
                    if (!audioContext) {
                        try {
                            initAudioContext();
                        } catch (e) {
                            console.warn("Could not initialize audio context:", e);
                        }
                    }
                    
                    // Connect to analyser if possible
                    try {
                        if (audioContext && analyser) {
                            const source = audioContext.createMediaElementSource(audio);
                            source.connect(analyser);
                            analyser.connect(audioContext.destination);
                        }
                    } catch (e) {
                        console.warn("Could not connect to analyser:", e);
                        // Ensure audio still plays even if visualization fails
                        if (!audio.muted) {
                            try {
                                audio.play().catch(playError => {
                                    console.error("Play error after analyser failure:", playError);
                                });
                            } catch (playError) {
                                console.error("Exception during play after analyser failure:", playError);
                            }
                        }
                    }
                });
                
                audio.addEventListener('playing', () => {
                    console.log("Audio is playing");
                    isPlaying = true;
                });
                
                audio.addEventListener('ended', () => {
                    console.log("Audio playback ended");
                    isAudioPlaying = false;
                    URL.revokeObjectURL(audioUrl); // Clean up
                    
                    // Play next audio in queue
                    playNextAudioWithRetry();
                    
                    if (audioQueue.length === 0) {
                        isPlaying = false;
                    }
                });
                
                audio.addEventListener('error', (e) => {
                    console.error('Audio playback error:', e);
                    isAudioPlaying = false;
                    
                    // Retry logic for Safari
                    if (retryCount < 3) {
                        console.log(`Retrying audio playback (attempt ${retryCount + 1})`);
                        setTimeout(() => {
                            playNextAudioWithRetry(retryCount + 1);
                        }, 500);
                    } else {
                        // Move on to the next audio after 3 retries
                        playNextAudioWithRetry(0);
                    }
                });
                
                // Set the source and try to play
                audio.src = audioUrl;
                
                // For Safari, we need to try playing after a small delay
                setTimeout(() => {
                    audio.play().then(() => {
                        console.log("Audio playback started successfully");
                    }).catch(err => {
                        console.error('Error starting audio playback:', err);
                        
                        // Special handling for Safari autoplay restrictions
                        if (err.name === 'NotAllowedError') {
                            addMessageToTranscript("Audio playback was blocked. Please interact with the page first.", "system");
                            
                            // Create a button to manually start audio
                            const playButton = document.createElement('button');
                            playButton.textContent = "Click to Play Audio Response";
                            playButton.className = "play-audio-btn";
                            playButton.style.display = "block";
                            playButton.style.margin = "10px auto";
                            playButton.style.padding = "8px 16px";
                            playButton.style.backgroundColor = "#3498db";
                            playButton.style.color = "white";
                            playButton.style.border = "none";
                            playButton.style.borderRadius = "4px";
                            playButton.style.cursor = "pointer";
                            
                            playButton.onclick = function() {
                                audio.play().then(() => {
                                    playButton.remove();
                                }).catch(e => {
                                    console.error("Still couldn't play:", e);
                                });
                            };
                            
                            // Find a good place to add the button
                            const container = document.querySelector('.transcript-container') || document.body;
                            container.appendChild(playButton);
                        }
                        
                        isAudioPlaying = false;
                        playNextAudioWithRetry();
                    });
                }, 100);
            }
        })
        .catch(error => {
            console.error('Error communicating with AI:', error);
            addMessageToTranscript(`Error: ${error.message}`, 'system');
        });
    }
    
    // Add browser detection function
    function isSafari() {
        return /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    }
    
    // Safari-compatible audio processing function
    function processSpeechSafari(transcript) {
        console.log("Processing speech with Safari-compatible method:", transcript);
        addMessageToTranscript(transcript, "user");
        
        // Format conversation history properly
        const formattedHistory = conversationHistory.map(msg => {
            // Ensure each message has role and content properties
            return {
                role: msg.role || 'user',
                content: msg.content || msg.text || ''
            };
        });
        
        // Add the current message
        formattedHistory.push({
            role: 'user',
            content: transcript
        });
        
        // Log the formatted history
        console.log("Formatted conversation history:", 
                    JSON.stringify(formattedHistory).substring(0, 200) + "...");
        
        // Create form data
        const formData = new FormData();
        formData.append('userInput', transcript);
        
        // Add conversation history - use the previous messages, not including the current one
        if (formattedHistory.length > 1) {
            formData.append('conversationHistory', JSON.stringify(formattedHistory.slice(0, -1)));
        }
        
        // Add personality configuration
        const personality = {
            name: "Assistant",
            model: "grok-4",
            temperature: 0.7,
            systemPrompt: "You are a helpful assistant. Answer questions concisely and accurately.",
            voices: {
                elevenLabs: {
                    voice_id: "pNInz6obpgDQGcFmaJgB",
                    model_id: "eleven_turbo_v2",
                    stability: 0.5,
                    similarity_boost: 0.75
                }
            }
        };
        
        formData.append('personality', JSON.stringify(personality));
        
        // Show processing message
        const processingMessage = document.querySelector('.system-message:last-child');
        if (processingMessage?.textContent === "Processing your request...") {
            // Already showing a processing message
        } else {
            addMessageToTranscript("Processing your request...", "system");
        }
        
        // Generate a unique dialogue ID
        const dialogueId = 'dialogue-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        formData.append('dialogueId', dialogueId);
        
        // First, post the text request
        fetch('/api/generate/chat', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            console.log("Request submitted successfully:", data);
            
            if (!data.success) {
                throw new Error(data.error || "Failed to submit request");
            }
            
            // Now connect to SSE stream with the dialogue ID
            connectToStream(data.dialogueId);
            
            // Add to conversation history - do this after request is sent
            conversationHistory.push({ role: 'user', content: transcript });
        })
        .catch(error => {
            console.error("Error submitting chat request:", error);
            addMessageToTranscript(`Error: ${error.message}`, "system");
        });
    }
    
    // Update the connectToStream function with proper event handler references
    function connectToStream(dialogueId) {
        console.log(`Connecting to open-stream with dialogueId: "${dialogueId}"`);
        
        // Close any existing event source
        if (eventSource) {
            eventSource.close();
            eventSource = null;
        }
        
        // Generate a unique timestamp to prevent caching
        const timestamp = Date.now();
        const streamUrl = `/api/open-stream?id=${dialogueId}&t=${timestamp}`;
        console.log("Connecting to stream URL:", streamUrl);
        
        // Create a new EventSource connection
        eventSource = new EventSource(streamUrl);
        
        // Clear response text for new conversation
        responseText = '';
        
        // Handle connection open
        eventSource.addEventListener('open', function(event) {
            console.log("EventSource connection opened:", event);
            isConnected = true;
        });
        
        // Handle generic messages (when no event type is specified)
        eventSource.addEventListener('message', function(event) {
            console.log("Received generic message:", event.data);
            try {
                const data = JSON.parse(event.data);
                handleEventData('message', data);
            } catch (e) {
                console.error("Error parsing message data:", e);
            }
        });
        
        // Handle text chunks
        eventSource.addEventListener('textChunk', function(event) {
            try {
                const data = JSON.parse(event.data);
                if (data.text) {
                    responseText += data.text;
                    updateTranscriptMessage(responseText, 'ai');
                }
            } catch (e) {
                console.error("Error parsing textChunk data:", e);
            }
        });
        
        // Handle audio chunks
        eventSource.addEventListener('audio', function(event) {
            console.log("Audio event received:", typeof event.data, event.data.substring(0, 100) + "...");
            
            try {
                const data = JSON.parse(event.data);
                console.log("Audio data after parsing:", typeof data.audio, 
                    data.audio ? `length: ${data.audio.length}` : "no audio data");
                
                if (data.audio) {
                    console.log("Audio data received, first 20 chars:", data.audio.substring(0, 20));
                    
                    // For mobile, store chunks and play them together
                    if (isMobileDevice()) {
                        addAudioChunkToBuffer(data.audio);
                    } else {
                        // For desktop, play each chunk as it arrives
                        playSafariAudio(data.audio);
                    }
                } else {
                    console.warn("Received audio event with no audio data");
                }
            } catch (e) {
                console.error("Error parsing audio event data:", e, "Raw data:", event.data);
            }
        });
        
        // Handle stream completion
        eventSource.addEventListener('complete', function(event) {
            console.log("Stream completed, event data:", event.data);
            
            try {
                const data = JSON.parse(event.data);
                
                // If we're on mobile and have accumulated audio chunks, play them
                if (isMobileDevice() && audioChunks.length > 0) {
                    console.log(`Playing ${audioChunks.length} accumulated audio chunks`);
                    
                    // Combine all chunks into one base64 string
                    const combinedAudio = audioChunks.join('');
                    
                    // Convert to audio blob and play
                    const audioBlob = base64ToBlob(combinedAudio, 'audio/mp3');
                    const audioUrl = URL.createObjectURL(audioBlob);
                    
                    // Create and configure audio element
                    const audio = new Audio(audioUrl);
                    
                    // Add an explicit play button for mobile 
                    // that appears immediately rather than after an error
                    const playButton = document.createElement('button');
                    playButton.textContent = '▶️ Play Response';
                    playButton.className = 'play-button';
                    playButton.style.padding = '10px 20px';
                    playButton.style.margin = '10px auto';
                    playButton.style.display = 'block';
                    playButton.style.backgroundColor = '#4CAF50';
                    playButton.style.color = 'white';
                    playButton.style.border = 'none';
                    playButton.style.borderRadius = '4px';
                    playButton.style.cursor = 'pointer';
                    
                    // Find a safe location to insert the button
                    const transcript = document.getElementById('transcript-panel');
                    if (transcript) {
                        transcript.appendChild(playButton);
                    } else {
                        // Fallback to body if transcript element not found
                        document.body.appendChild(playButton);
                    }
                    
                    // Set up button click handler
                    playButton.addEventListener('click', () => {
                        console.log("Play button clicked, attempting playback");
                        
                        // Try to play the audio
                        audio.play()
                            .then(() => {
                                console.log("Audio playback started from button click");
                                playButton.style.display = 'none'; // Hide button while playing
                            })
                            .catch(e => {
                                console.error("Manual play failed:", e);
                            });
                    });
                    
                    // Reset audio chunks for next interaction
                    audioChunks = [];
                } else if (!isMobileDevice()) {
                    // For desktop, we can still try the fallback TTS if needed
                    if (data.type === 'complete' && responseText) {
                        console.log("Conversation complete, attempting fallback TTS for the complete response");
                        
                        // Fix the fetch call to use JSON instead of FormData
                        fetch('/api/generate/tts-fallback', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                text: responseText,
                                voice: 'default'
                            })
                        })
                        .then(response => {
                            if (!response.ok) {
                                throw new Error(`Server returned ${response.status}: ${response.statusText}`);
                            }
                            return response.blob();
                        })
                        .then(audioBlob => {
                            const audioUrl = URL.createObjectURL(audioBlob);
                            console.log("Playing complete response audio");
                            
                            // Use a simple audio play method for complete response
                            const audio = new Audio(audioUrl);
                            
                            // Try to prevent the "operation not supported" error
                            audio.load();
                            
                            // Add event listeners for debugging
                            audio.addEventListener('canplaythrough', () => {
                                console.log("Audio can play through, attempting to play");
                                
                                // Use a small delay to ensure audio is fully loaded
                                setTimeout(() => {
                                    audio.play()
                                        .then(() => console.log("Audio playback started"))
                                        .catch(err => {
                                            console.error("Play failed:", err);
                                            addPlayButton(() => {
                                                audio.play().catch(e => console.log("Manual play also failed:", e));
                                            });
                                        });
                                }, 100);
                            });
                            
                            audio.addEventListener('error', (e) => {
                                console.error("Audio error event:", e);
                            });
                            
                            // Clean up URL when done
                            audio.addEventListener('ended', () => {
                                console.log("Audio playback ended");
                                URL.revokeObjectURL(audioUrl);
                            });
                        })
                        .catch(err => {
                            console.error("Fallback TTS failed:", err);
                        });
                    }
                }
                
                // Clean up
                if (eventSource) {
                    console.log("Closing event source");
                    eventSource.close();
                    eventSource = null;
                }
            } catch (e) {
                console.error("Error in complete event handler:", e);
            }
        });
        
        // Handle connected event
        eventSource.addEventListener('connected', function(event) {
            console.log("Connected to stream:", event.data);
            try {
                const data = JSON.parse(event.data);
                // Add UI indication that we're connected if needed
            } catch (e) {
                console.error("Error parsing connected event data:", e);
            }
        });
        
        // Handle errors
        eventSource.addEventListener('error', function(event) {
            console.error("EventSource error:", event);
            if (eventSource.readyState === 2) { // CLOSED
                console.log("Connection closed due to error");
                // Handle reconnection if needed
            }
        });
        
        // Remove the heartbeat ping or update the URL
        // Instead of using a ping, modify the heartbeatInterval:
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
        }
        
        // Optional: only use heartbeat if really needed
        heartbeatInterval = setInterval(() => {
            if (isConnected) {
                console.log("Sending heartbeat ping...");
                fetch('/api/ping')
                    .then(response => {
                        if (!response.ok) {
                            console.warn("Heartbeat failed with status:", response.status);
                        }
                    })
                    .catch(error => {
                        console.error("Heartbeat error:", error);
                    });
            }
        }, 30000); // Send heartbeat every 30 seconds
    }
    
    // Modify recognition onresult to use Safari-specific function
    if (recognition) {
        recognition.onresult = function(event) {
            let interimTranscript = '';
            let finalTranscript = '';
            
            // Collect results
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript;
                } else {
                    interimTranscript += transcript;
                }
            }
            
            // Update the transcript with interim results
            if (interimTranscript) {
                updateTranscriptMessage(interimTranscript, 'user-interim');
            }
            
            // Process final results
            if (finalTranscript) {
                // Use either Safari-compatible or regular method
                if (isSafari()) {
                    processSpeechSafari(finalTranscript);
                } else {
                    // Original processing method
                    addMessageToTranscript(finalTranscript, 'user');
                    sendMessageToAI(finalTranscript);
                }
            }
        };
    }
    
    // Update the micButton click handler
    micButton.addEventListener('click', function() {
        // Unlock audio immediately when mic is clicked
        unlockAudioPlayback();
        
        // Rest of the mic button logic...
        if (!isListening) {
            startListening();
        } else {
            stopListening();
        }
    });
    
    // Start listening for user speech
    function startListening() {
        if (!recognition) return;
        
        // Check if the browser is likely Brave
        const isBrave = navigator.brave !== undefined || 
                       (navigator.userAgent.includes("Chrome") && 
                        !navigator.userAgent.includes("Edg") && 
                        !navigator.userAgent.includes("OPR") &&
                        !window.chrome.webstore);
        
        if (isBrave) {
            addMessageToTranscript("Note: Brave's privacy features may block speech recognition. If you experience issues, try using the text input or another browser.", "system");
        }
        
        // Request microphone permission explicitly
        navigator.mediaDevices.getUserMedia({ audio: true })
            .then(stream => {
                console.log('Microphone permission granted');
                // Start visualization with the stream
                startVisualization(stream);
                
                try {
                    recognition.start();
                    isListening = true;
                    micButton.classList.add('active');
                    addMessageToTranscript("Listening...", "system");
                } catch (error) {
                    console.error('Error starting speech recognition:', error);
                    addMessageToTranscript("Error starting speech recognition. Please try again.", "system");
                }
            })
            .catch(error => {
                console.error('Error accessing microphone:', error);
                addMessageToTranscript("Unable to access microphone. Please check your permissions.", "system");
            });
    }
    
    // Stop listening for user speech
    function stopListening() {
        if (!recognition) return;
        
        try {
            recognition.stop();
            console.log('Speech recognition stopped');
        } catch (error) {
            console.error('Error stopping speech recognition:', error);
        }
        
        isListening = false;
        micButton.classList.remove('active');
        
        // Submit the final transcript if it's not empty
        if (currentTranscript.trim()) {
            sendMessageToAI(currentTranscript);
            addMessageToTranscript(currentTranscript, 'user');
            currentTranscript = '';
        }
    }
    
    // Recognition event handlers
    if (recognition) {
        recognition.onend = () => {
            if (isListening) {
                // If we're still supposed to be listening, restart
                recognition.start();
            }
        };
    }
    
    // Send message to AI using SSE
    function sendMessageToAI(message) {
        // Create form data to send to the API
        const formData = new FormData();
        formData.append('text', message);
        
        // Add conversation history for context
        if (conversationHistory.length > 0) {
            formData.append('history', JSON.stringify(conversationHistory));
        }
        
        // Add personality configuration
        const personality = {
            name: "Assistant",
            description: "A helpful AI assistant.",
            model: "grok-4",
            temperature: 0.7,
            systemPrompt: "You are a helpful assistant. Answer questions concisely and accurately.",
            voices: {
                elevenLabs: {
                    voice_id: "pNInz6obpgDQGcFmaJgB",
                    model_id: "eleven_turbo_v2",
                    stability: 0.5,
                    similarity_boost: 0.75
                }
            }
        };
        
        formData.append('personality', JSON.stringify(personality));
        
        // Close any existing EventSource
        if (eventSource) {
            eventSource.close();
            eventSource = null;
        }
        
        // Send the request directly to the converse endpoint
        const base = (typeof window !== 'undefined' && window.API_BASE_URL) ? window.API_BASE_URL : '';
        fetch(`${base}/api/generate/converse`, {
            method: 'POST',
            body: formData
        }).then(response => {
            if (!response.ok) {
                throw new Error(`API response: ${response.status}`);
            }
            
            // Create EventSource from the response
            // We don't need to open a new connection, the response IS the SSE stream
            eventSource = new EventSource(`${base}/api/generate/converse`);
            
            let aiResponse = '';
            let audioQueue = [];
            let isAudioPlaying = false;
            
            eventSource.addEventListener('connected', (event) => {
                const data = JSON.parse(event.data);
                console.log('SSE Connected:', data);
                if (data.sessionId) {
                    currentSessionId = data.sessionId;
                }
            });
            
            eventSource.addEventListener('transcription', (event) => {
                const data = JSON.parse(event.data);
                console.log('Transcription:', data);
            });
            
            eventSource.addEventListener('responseChunk', (event) => {
                const data = JSON.parse(event.data);
                console.log('Response chunk:', data);
                
                if (data.text) {
                    aiResponse += data.text;
                    // Update the displayed response as chunks arrive
                    updateTranscriptMessage(aiResponse, 'ai');
                }
            });
            
            eventSource.addEventListener('audioChunk', (event) => {
                const data = JSON.parse(event.data);
                console.log('Audio chunk received');
                
                // Convert base64 to audio blob
                const binaryString = atob(data.chunk);
                const len = binaryString.length;
                const bytes = new Uint8Array(len);
                for (let i = 0; i < len; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                
                const audioBlob = new Blob([bytes], { type: 'audio/mp3' });
                const audioUrl = URL.createObjectURL(audioBlob);
                
                // Add to audio queue and play if not already playing
                audioQueue.push(audioUrl);
                playNextAudio();
            });
            
            eventSource.addEventListener('error', (event) => {
                console.error('SSE Error:', event);
                eventSource.close();
            });
            
            eventSource.addEventListener('done', (event) => {
                console.log('SSE Stream complete', event.data);
                
                // Update conversation history with completed message
                conversationHistory.push({ 
                    role: 'user', 
                    content: message 
                });
                
                conversationHistory.push({ 
                    role: 'assistant', 
                    content: aiResponse 
                });
                
                eventSource.close();
            });
            
            // Function to play audio sequentially
            function playNextAudio() {
                if (audioQueue.length === 0 || isAudioPlaying) return;
                
                isAudioPlaying = true;
                const audioUrl = audioQueue.shift();
                const audio = new Audio(audioUrl);
                
                if (!audioContext) initAudioContext();
                
                audio.addEventListener('play', () => {
                    isPlaying = true;
                    
                    // Create a media element source for visualization
                    const source = audioContext.createMediaElementSource(audio);
                    source.connect(analyser);
                    analyser.connect(audioContext.destination);
                });
                
                audio.addEventListener('ended', () => {
                    isAudioPlaying = false;
                    URL.revokeObjectURL(audioUrl); // Clean up the blob URL
                    playNextAudio(); // Play the next audio in queue
                    
                    if (audioQueue.length === 0) {
                        isPlaying = false;
                    }
                });
                
                audio.addEventListener('error', (e) => {
                    console.error('Audio playback error:', e);
                    isAudioPlaying = false;
                    playNextAudio(); // Try the next one
                });
                
                audio.play().catch(err => {
                    console.error('Error playing audio:', err);
                    isAudioPlaying = false;
                    playNextAudio();
                });
            }
        })
        .catch(error => {
            console.error('Error communicating with AI:', error);
            addMessageToTranscript('Sorry, there was an error processing your request.', 'ai');
        });
    }
    
    // New function to update an existing message
    function updateTranscriptMessage(message, role) {
        // Check if there's already a message from this role
        const existingMessages = transcriptContent.querySelectorAll(`.${role}-message`);
        const lastMessage = existingMessages[existingMessages.length - 1];
        
        if (lastMessage && role === 'ai' && existingMessages.length === conversationHistory.length / 2 + 1) {
            // Update the existing message
            lastMessage.textContent = message;
        } else {
            // Add a new message
            addMessageToTranscript(message, role);
        }
        
        // Scroll to bottom of transcript
        transcriptContent.scrollTop = transcriptContent.scrollHeight;
    }
    
    // Add message to transcript panel
    function addMessageToTranscript(message, role) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', `${role}-message`);
        messageElement.textContent = message;
        transcriptContent.appendChild(messageElement);
        
        // Scroll to bottom of transcript
        transcriptContent.scrollTop = transcriptContent.scrollHeight;
    }
    
    // Toggle transcript panel
    transcriptBtn.addEventListener('click', () => {
        transcriptPanel.classList.toggle('hidden');
    });
    
    closeTranscriptBtn.addEventListener('click', () => {
        transcriptPanel.classList.add('hidden');
    });
    
    // Stop button handler
    stopBtn.addEventListener('click', () => {
        if (isListening) {
            stopListening();
        }
        
        // Stop any playing audio
        const audios = document.querySelectorAll('audio');
        audios.forEach(audio => {
            audio.pause();
            audio.currentTime = 0;
        });
        
        // Close SSE connection
        if (eventSource) {
            eventSource.close();
        }
        
        isPlaying = false;
    });
    
    // Start waveform animation
    drawWaveform();

    // Ensure audio context is initialized on user interaction
    document.addEventListener('click', function() {
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume().catch(err => {
                console.warn('Failed to resume AudioContext on click:', err);
            });
        }
    }, { once: true });

    // Add a text input for Safari users
    document.addEventListener('DOMContentLoaded', function() {
        if (isSafari()) {
            const container = document.createElement('div');
            container.className = 'safari-text-input';
            container.style.marginTop = '10px';
            container.style.display = 'flex';
            container.style.width = '100%';
            
            const input = document.createElement('input');
            input.type = 'text';
            input.id = 'safari-text-input';
            input.placeholder = 'Type a message for Safari...';
            input.style.flex = '1';
            input.style.padding = '8px';
            input.style.borderRadius = '4px 0 0 4px';
            input.style.border = '1px solid #ccc';
            
            const button = document.createElement('button');
            button.textContent = 'Send';
            button.style.padding = '8px 16px';
            button.style.backgroundColor = '#3498db';
            button.style.color = 'white';
            button.style.border = 'none';
            button.style.borderRadius = '0 4px 4px 0';
            button.style.cursor = 'pointer';
            
            button.addEventListener('click', () => {
                const message = input.value.trim();
                if (message) {
                    processSpeechSafari(message);
                    input.value = '';
                }
            });
            
            input.addEventListener('keyup', (event) => {
                if (event.key === 'Enter') {
                    button.click();
                }
            });
            
            container.appendChild(input);
            container.appendChild(button);
            
            // Add to page
            const controls = document.querySelector('.controls-container');
            if (controls) {
                controls.parentNode.insertBefore(container, controls.nextSibling);
            } else {
                document.body.appendChild(container);
            }
        }
    });

    // Update the audio playback function
    function playAudioChunk(audioBlob) {
        // If already playing or no audio is available, just queue
        if (isPlayingAudio || !audioBlob) {
            if (audioBlob) audioQueue.push(audioBlob);
            return;
        }
        
        isPlayingAudio = true;
        
        try {
            // Create audio element with proper settings
            const audio = new Audio();
            const audioUrl = URL.createObjectURL(audioBlob);
            
            // Handle format issues with a more robust approach
            audio.onerror = function(error) {
                console.error('Audio format error:', error);
                URL.revokeObjectURL(audioUrl);
                isPlayingAudio = false;
                
                // Attempt to play the next chunk
                setTimeout(() => {
                    if (audioQueue.length > 0) {
                        const nextChunk = audioQueue.shift();
                        playAudioChunk(nextChunk);
                    }
                }, 100);
            };
            
            audio.onended = function() {
                URL.revokeObjectURL(audioUrl);
                isPlayingAudio = false;
                
                // Play next chunk if available
                if (audioQueue.length > 0) {
                    const nextChunk = audioQueue.shift();
                    playAudioChunk(nextChunk);
                }
            };
            
            // Set source and attempt to play
            audio.src = audioUrl;
            
            // Explicitly set MIME type to help Safari
            const preferredFormat = getSupportedAudioFormat();
            if (preferredFormat) {
                audio.type = `audio/${preferredFormat}`;
            }
            
            // For Safari: pre-load a small portion before playing
            audio.preload = 'auto';
            audio.load();
            
            const playPromise = audio.play();
            if (playPromise !== undefined) {
                playPromise.catch(error => {
                    console.error('Could not play audio automatically:', error);
                    
                    // Reset state and requeue
                    URL.revokeObjectURL(audioUrl);
                    isPlayingAudio = false;
                    
                    // Add the blob back to the beginning of the queue
                    audioQueue.unshift(audioBlob);
                });
            }
        } catch (error) {
            console.error('Error during audio playback:', error);
            isPlayingAudio = false;
        }
    }

    // Function to play all queued audio
    function playQueuedAudio() {
        if (audioQueue.length > 0) {
            const nextBlob = audioQueue.shift();
            playAudioChunk(nextBlob);
        }
    }

    // Function to unlock audio playback
    function unlockAudioPlayback() {
        if (audioUnlocked) return;
        
        console.log('Attempting to unlock audio playback...');
        
        // Resume audio context if suspended
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume().then(() => {
                console.log('AudioContext resumed successfully');
            }).catch(err => {
                console.error('Failed to resume AudioContext:', err);
            });
        }
        
        // Play a silent sound to unlock audio on Safari
        const silentSound = new Audio("data:audio/mp3;base64,SUQzBAAAAAAAI1TSU0UAAAAPAAADTGF2ZjU4LjI5LjEwMAAAAAAAAAAAAAAA/+M4wAAAAAAAAAAAAEluZm8AAAAPAAAAAwAAAbsBVFYAAAAAAABDb3B5cmlnaHQAAAAXAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+MYxAAAAANIAAAAAExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV/+MYxDsAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV");
        silentSound.play().then(() => {
            console.log('Silent sound played successfully, audio unlocked');
            audioUnlocked = true;
            
            // Play any queued audio
            playQueuedAudio();
        }).catch(err => {
            console.error('Silent sound failed to play:', err);
        });
    }

    // Initialize audio context when page loads
    document.addEventListener('DOMContentLoaded', initAudioContext);

    // Add this utility function to check audio compatibility
    function getSupportedAudioFormat() {
        const audio = document.createElement('audio');
        
        // Try formats from most desirable to least
        if (audio.canPlayType('audio/mp3')) {
            return 'mp3';
        } else if (audio.canPlayType('audio/aac') || audio.canPlayType('audio/m4a')) {
            return 'aac';
        } else if (audio.canPlayType('audio/wav')) {
            return 'wav';
        } else if (audio.canPlayType('audio/ogg')) {
            return 'ogg';
        }
        
        // Default fallback
        return 'mp3';
    }

    // Add this function to handle audio playback in a Safari-compatible way
    function playSafariCompatibleAudio(audioBase64) {
        // Create a Blob with MP3 MIME type (Safari compatible)
        const audioBlob = base64ToBlob(audioBase64, 'audio/mp3');
        
        // Create object URL and audio element
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        
        // Add error handling
        audio.onerror = (e) => {
            console.error('Audio playback error:', e);
            console.log('Audio format supported:', audio.canPlayType('audio/mp3'));
        };
        
        // Play with user interaction safety
        const playPromise = audio.play();
        if (playPromise !== undefined) {
            playPromise.catch(error => {
                console.error('Audio play promise error:', error);
                // Try again with user interaction
                document.addEventListener('click', () => audio.play(), { once: true });
            });
        }
        
        // Clean up the object URL after the audio has loaded to prevent memory leaks
        audio.oncanplaythrough = () => {
            // Only revoke after a timeout to ensure Safari has fully loaded the audio
            setTimeout(() => URL.revokeObjectURL(audioUrl), 1000);
        };
        
        return audio;
    }

    // Helper function to convert base64 to Blob
    function base64ToBlob(base64, mimeType) {
        try {
            const byteCharacters = atob(base64);
            const byteArrays = [];
            
            for (let offset = 0; offset < byteCharacters.length; offset += 512) {
                const slice = byteCharacters.slice(offset, offset + 512);
                
                const byteNumbers = new Array(slice.length);
                for (let i = 0; i < slice.length; i++) {
                    byteNumbers[i] = slice.charCodeAt(i);
                }
                
                const byteArray = new Uint8Array(byteNumbers);
                byteArrays.push(byteArray);
            }
            
            return new Blob(byteArrays, { type: mimeType });
        } catch (error) {
            console.error('Error converting base64 to blob:', error);
            return new Blob([], { type: mimeType });
        }
    }

    // Add these functions to handle the events and play audio

    // Add this function to handle different event types
    function handleEventData(eventType, data) {
        console.log(`Handling event type: ${eventType}`, data);
        
        switch (eventType) {
            case 'textChunk':
                if (data.text) {
                    responseText += data.text;
                    updateTranscriptMessage(responseText, 'ai');
                }
                break;
                
            case 'audio':
                if (data.audio) {
                    try {
                        // Convert base64 to a Blob and play
                        const audioBlob = base64ToBlob(data.audio, 'audio/mp3');
                        playAudioChunk(audioBlob);
                    } catch (e) {
                        console.error("Error processing audio data:", e);
                    }
                }
                break;
                
            case 'complete':
                console.log("Conversation complete:", data);
                break;
                
            case 'message':
            default:
                console.log("Received generic message:", data);
                // Handle generic messages if needed
                break;
        }
    }

    // Make sure this function exists to update transcript display
    function updateTranscriptMessage(text, role) {
        // Find or create message container
        let messageContainer = document.querySelector('.message-container[data-role="' + role + '"].current');
        
        if (!messageContainer) {
            // Create a new message container
            messageContainer = document.createElement('div');
            messageContainer.className = 'message-container current';
            messageContainer.setAttribute('data-role', role);
            
            // Create message content element
            const messageContent = document.createElement('div');
            messageContent.className = 'message-content';
            messageContainer.appendChild(messageContent);
            
            // Add to transcript
            transcriptContent.appendChild(messageContainer);
        }
        
        // Update message content
        const messageContent = messageContainer.querySelector('.message-content');
        messageContent.textContent = text;
        
        // Scroll to bottom
        transcriptContent.scrollTop = transcriptContent.scrollHeight;
    }

    // Define the playAudio function that's called from the event handler
    function playAudio(audioUrl) {
        console.log("Playing audio from URL:", audioUrl);
        
        // Unlock audio context if needed
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume().catch(err => console.error("Error resuming audio context:", err));
        }
        
        // Create an audio element
        const audio = new Audio();
        
        // Add error handling
        audio.onerror = function(e) {
            console.error("Audio playback error:", e);
            URL.revokeObjectURL(audioUrl);
        };
        
        // Clean up URL object when done
        audio.onended = function() {
            console.log("Audio finished playing");
            URL.revokeObjectURL(audioUrl);
        };
        
        // Set source and play
        audio.src = audioUrl;
        
        // Play with user interaction safety
        const playPromise = audio.play();
        if (playPromise !== undefined) {
            playPromise.catch(error => {
                console.error("Audio play error:", error);
                
                // If auto-play was prevented, add a play button
                if (!playButtonVisible) {
                    addPlayButton(() => {
                        audio.play().catch(e => console.error("Manual play failed:", e));
                    });
                    playButtonVisible = true;
                }
            });
        }
        
        return audio;
    }

    // Helper function to add a play button if autoplay fails
    function addPlayButton(callback) {
        const playButton = document.createElement('button');
        playButton.textContent = 'Play Response';
        playButton.className = 'play-button';
        playButton.style.padding = '10px 20px';
        playButton.style.margin = '10px auto';
        playButton.style.display = 'block';
        playButton.style.backgroundColor = '#4CAF50';
        playButton.style.color = 'white';
        playButton.style.border = 'none';
        playButton.style.borderRadius = '4px';
        playButton.style.cursor = 'pointer';
        
        playButton.addEventListener('click', () => {
            callback();
            playButton.remove();
            playButtonVisible = false;
            
            // Unlock audio for future playback
            unlockAudioPlayback();
        });
        
        // Find a safe location to insert the button
        const transcript = document.getElementById('transcript-content');
        if (transcript) {
            transcript.appendChild(playButton);
        } else {
            // Fallback to body if transcript element not found
            document.body.appendChild(playButton);
        }
    }

    // Add debug logging for events
    function addDebugLogging() {
        console.log("Adding debug logging to EventSource");
        
        // Monkey patch addEventListener to log all events
        const originalAddEventListener = EventSource.prototype.addEventListener;
        EventSource.prototype.addEventListener = function(type, listener, options) {
            const wrappedListener = function(event) {
                console.log(`EventSource received ${type} event:`, event.data);
                listener.call(this, event);
            };
            return originalAddEventListener.call(this, type, wrappedListener, options);
        };
        
        console.log("Debug logging added to EventSource");
    }

    // Call this early in your script
    addDebugLogging();

    // Enhanced audio playback for Safari
    function playSafariAudio(base64Data) {
        console.log("Attempting to play Safari audio from base64 data of length:", base64Data.length);
        
        try {
            // Create the audio context if it doesn't exist
            if (!audioContext) {
                initAudioContext();
            }
            
            // Make sure audio context is running
            if (audioContext.state === 'suspended') {
                audioContext.resume().catch(e => console.error("Could not resume audio context:", e));
            }
            
            // Create audio element for Safari
            const audio = new Audio();
            audio.controls = false;
            
            // Convert base64 to blob
            const audioBlob = base64ToBlob(base64Data, 'audio/mp3');
            const audioUrl = URL.createObjectURL(audioBlob);
            
            // Set up error handling
            audio.onerror = (err) => {
                console.error("Audio playback error:", err);
                URL.revokeObjectURL(audioUrl);
            };
            
            // Clean up when done
            audio.onended = () => {
                console.log("Audio playback finished");
                URL.revokeObjectURL(audioUrl);
            };
            
            // Set source and play
            audio.src = audioUrl;
            
            // Play with promise (for error handling)
            const playPromise = audio.play();
            if (playPromise !== undefined) {
                playPromise.catch(err => {
                    console.error("Audio play() failed:", err);
                    
                    // If autoplay is prevented, show play button
                    if (!playButtonVisible) {
                        console.log("Autoplay prevented, adding play button");
                        addPlayButton(() => {
                            audio.play().catch(e => console.error("Manual play failed:", e));
                        });
                        playButtonVisible = true;
                    }
                });
            }
        } catch (e) {
            console.error("Error in playSafariAudio:", e);
        }
    }

    // Add this function to test audio playback capability
    function testAudioPlayback() {
        console.log("Testing audio playback capability");
        
        // Create a short silent audio element
        const audio = new Audio();
        audio.src = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";
        
        // Log audio element capabilities
        console.log("Audio element state:", {
            canPlayType_mp3: audio.canPlayType('audio/mp3'),
            canPlayType_mpeg: audio.canPlayType('audio/mpeg'),
            canPlayType_wav: audio.canPlayType('audio/wav'),
            autoplay: audio.autoplay,
            preload: audio.preload
        });
        
        // Try playing
        audio.volume = 0.01; // Nearly silent
        const playPromise = audio.play();
        
        if (playPromise !== undefined) {
            playPromise
                .then(() => {
                    console.log("Audio test playback succeeded");
                    audio.pause();
                })
                .catch(err => {
                    console.error("Audio test playback failed:", err);
                });
        } else {
            console.log("Audio test: play() did not return a promise");
        }
    }

    // Call the test function on page load
    testAudioPlayback();

    // Add this function to handle initial user interaction and unlock audio
    function unlockAudioOnUserInteraction() {
        console.log("Setting up audio unlock on user interaction");
        
        // Create context on first user interaction
        const unlockAudio = () => {
            console.log("Unlocking audio playback capabilities");
            
            // Create a silent audio context if needed
            if (!audioContext) {
                try {
                    audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    console.log("Audio context created:", audioContext.state);
                    
                    // Resume it if suspended
                    if (audioContext.state === 'suspended') {
                        audioContext.resume().then(() => {
                            console.log("AudioContext successfully resumed");
                        });
                    }
                    
                    // Also create and play a silent sound to fully unlock
                    const silentSound = audioContext.createOscillator();
                    const gainNode = audioContext.createGain();
                    gainNode.gain.value = 0.01; // Almost silent
                    silentSound.connect(gainNode);
                    gainNode.connect(audioContext.destination);
                    silentSound.start(0);
                    silentSound.stop(0.1);
                    
                    console.log("Silent sound played to unlock audio");
                    
                    // Store that we've done this
                    window.sessionStorage.setItem('audioUnlocked', 'true');
                } catch (e) {
                    console.error("Error creating audio context:", e);
                }
            }
            
            // Remove the event listeners once we've unlocked audio
            document.removeEventListener('touchstart', unlockAudio);
            document.removeEventListener('touchend', unlockAudio);
            document.removeEventListener('click', unlockAudio);
        };
        
        // Add event listeners to common interaction events
        document.addEventListener('touchstart', unlockAudio, { once: true });
        document.addEventListener('touchend', unlockAudio, { once: true });
        document.addEventListener('click', unlockAudio, { once: true });
    }

    // Call this early in your initialization
    unlockAudioOnUserInteraction();

    // Add these helper functions
    function isMobileDevice() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }

    // For mobile, we'll collect audio chunks and play them together
    function addAudioChunkToBuffer(base64Audio) {
        if (!window.audioChunks) {
            window.audioChunks = [];
        }
        window.audioChunks.push(base64Audio);
        console.log(`Added audio chunk to buffer. Total chunks: ${window.audioChunks.length}`);
        
        // For iOS, immediately show the play button when we get the first chunk
        if (isIOS() && window.audioChunks.length === 1) {
            console.log("iOS detected, preparing play button for first audio chunk");
            createIOSPlayButton();
        }
    }

    // Handle stream completion with combined audio for mobile
    eventSource.addEventListener('complete', function(event) {
        console.log("Stream completed, event data:", event.data);
        
        try {
            const data = JSON.parse(event.data);
            
            // If we're on mobile and have accumulated audio chunks, play them
            if (isMobileDevice() && window.audioChunks.length > 0) {
                console.log(`Playing ${window.audioChunks.length} accumulated audio chunks`);
                
                // Combine all chunks into one base64 string
                const combinedAudio = window.audioChunks.join('');
                
                // Convert to audio blob and play
                const audioBlob = base64ToBlob(combinedAudio, 'audio/mp3');
                const audioUrl = URL.createObjectURL(audioBlob);
                
                // Create and configure audio element
                const audio = new Audio(audioUrl);
                
                // Add an explicit play button for mobile 
                // that appears immediately rather than after an error
                const playButton = document.createElement('button');
                playButton.textContent = '▶️ Play Response';
                playButton.className = 'play-button';
                playButton.style.padding = '10px 20px';
                playButton.style.margin = '10px auto';
                playButton.style.display = 'block';
                playButton.style.backgroundColor = '#4CAF50';
                playButton.style.color = 'white';
                playButton.style.border = 'none';
                playButton.style.borderRadius = '4px';
                playButton.style.cursor = 'pointer';
                
                // Find a safe location to insert the button
                const transcript = document.getElementById('transcript-panel');
                if (transcript) {
                    transcript.appendChild(playButton);
                } else {
                    // Fallback to body if transcript element not found
                    document.body.appendChild(playButton);
                }
                
                // Set up button click handler
                playButton.addEventListener('click', () => {
                    console.log("Play button clicked, attempting playback");
                    
                    // Try to play the audio
                    audio.play()
                        .then(() => {
                            console.log("Audio playback started from button click");
                            playButton.style.display = 'none'; // Hide button while playing
                        })
                        .catch(e => {
                            console.error("Manual play failed:", e);
                        });
                });
                
                // Reset audio chunks for next interaction
                window.audioChunks = [];
            } else if (!isMobileDevice()) {
                // For desktop, we can still try the fallback TTS if needed
                if (data.type === 'complete' && responseText) {
                    console.log("Conversation complete, attempting fallback TTS for the complete response");
                    
                    // Fix the fetch call to use JSON instead of FormData
                    fetch('/api/generate/tts-fallback', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            text: responseText,
                            voice: 'default'
                        })
                    })
                    .then(response => {
                        if (!response.ok) {
                            throw new Error(`Server returned ${response.status}: ${response.statusText}`);
                        }
                        return response.blob();
                    })
                    .then(audioBlob => {
                        const audioUrl = URL.createObjectURL(audioBlob);
                        console.log("Playing complete response audio");
                        
                        // Use a simple audio play method for complete response
                        const audio = new Audio(audioUrl);
                        
                        // Try to prevent the "operation not supported" error
                        audio.load();
                        
                        // Add event listeners for debugging
                        audio.addEventListener('canplaythrough', () => {
                            console.log("Audio can play through, attempting to play");
                            
                            // Use a small delay to ensure audio is fully loaded
                            setTimeout(() => {
                                audio.play()
                                    .then(() => console.log("Audio playback started"))
                                    .catch(err => {
                                        console.error("Play failed:", err);
                                        addPlayButton(() => {
                                            audio.play().catch(e => console.log("Manual play also failed:", e));
                                        });
                                    });
                            }, 100);
                        });
                        
                        audio.addEventListener('error', (e) => {
                            console.error("Audio error event:", e);
                        });
                        
                        // Clean up URL when done
                        audio.addEventListener('ended', () => {
                            console.log("Audio playback ended");
                            URL.revokeObjectURL(audioUrl);
                        });
                    })
                    .catch(err => {
                        console.error("Fallback TTS failed:", err);
                    });
                }
            }
            
            // Clean up
            if (eventSource) {
                console.log("Closing event source");
                eventSource.close();
                eventSource = null;
            }
        } catch (e) {
            console.error("Error in complete event handler:", e);
        }
    });

    // Add a function to specifically check for iOS
    function isIOS() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    }

    // Create a more prominent play button specifically for iOS
    function createIOSPlayButton() {
        // Remove any existing play buttons first
        const existingButtons = document.querySelectorAll('.ios-play-button');
        existingButtons.forEach(button => button.remove());
        
        // Create a prominent, fixed-position button
        const playButton = document.createElement('button');
        playButton.textContent = '🔊 Tap to Hear Response';
        playButton.className = 'ios-play-button';
        playButton.style.position = 'fixed';
        playButton.style.bottom = '20px';
        playButton.style.left = '50%';
        playButton.style.transform = 'translateX(-50%)';
        playButton.style.zIndex = '1000';
        playButton.style.padding = '15px 30px';
        playButton.style.fontSize = '18px';
        playButton.style.backgroundColor = '#4CAF50';
        playButton.style.color = 'white';
        playButton.style.border = 'none';
        playButton.style.borderRadius = '50px';
        playButton.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';
        playButton.style.display = 'block';
        
        // Add to body to ensure it's visible
        document.body.appendChild(playButton);
        
        // Set up click handler - will be updated when audio is complete
        playButton.addEventListener('click', () => {
            console.log("iOS play button clicked, but audio not ready yet");
            // Initially just show a message that audio is preparing
            playButton.textContent = "Preparing audio...";
            playButton.disabled = true;
        });
        
        return playButton;
    }
}); 