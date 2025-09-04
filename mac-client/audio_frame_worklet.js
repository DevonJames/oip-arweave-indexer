/**
 * Audio Frame Worklet for 20ms Frame Processing
 * 
 * This AudioWorklet processor runs in the audio thread and provides
 * precise 20ms frame extraction from the microphone input stream.
 * It's designed for real-time voice processing with minimal latency.
 */

class AudioFrameProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        
        // Configuration from options
        this.sampleRate = options.processorOptions?.sampleRate || 16000;
        this.frameSize = Math.floor(this.sampleRate * 0.02); // 20ms frame = 320 samples at 16kHz
        
        // Frame buffer
        this.frameBuffer = new Float32Array(this.frameSize);
        this.bufferIndex = 0;
        
        // Processing state
        this.frameCount = 0;
        this.isActive = true;
        
        // Performance tracking
        this.lastFrameTime = 0;
        this.averageFrameInterval = 20; // Target 20ms
        
        console.log(`[AudioWorklet] Initialized with frameSize: ${this.frameSize}, sampleRate: ${this.sampleRate}`);
        
        // Listen for messages from main thread
        this.port.onmessage = (event) => {
            this.handleMessage(event.data);
        };
    }
    
    /**
     * Process audio data in real-time
     * This runs in the audio thread for minimal latency
     */
    process(inputs, outputs, parameters) {
        if (!this.isActive) {
            return true;
        }
        
        const input = inputs[0];
        if (!input || input.length === 0) {
            return true;
        }
        
        // Get the first channel (mono audio)
        const inputChannel = input[0];
        if (!inputChannel) {
            return true;
        }
        
        // Process each sample in the input buffer
        for (let i = 0; i < inputChannel.length; i++) {
            // Add sample to frame buffer
            this.frameBuffer[this.bufferIndex] = inputChannel[i];
            this.bufferIndex++;
            
            // When frame is complete, send it for processing
            if (this.bufferIndex >= this.frameSize) {
                this.sendFrame();
                this.bufferIndex = 0;
            }
        }
        
        return true; // Keep processor alive
    }
    
    /**
     * Send completed frame to main thread
     */
    sendFrame() {
        const currentTime = performance.now();
        
        // Calculate frame interval
        if (this.lastFrameTime > 0) {
            const interval = currentTime - this.lastFrameTime;
            this.averageFrameInterval = (this.averageFrameInterval * 0.9) + (interval * 0.1);
        }
        this.lastFrameTime = currentTime;
        
        // Create a copy of the frame buffer
        const frameData = new Float32Array(this.frameBuffer);
        
        // Calculate frame energy for basic VAD
        let energy = 0;
        for (let i = 0; i < frameData.length; i++) {
            energy += frameData[i] * frameData[i];
        }
        const rmsEnergy = Math.sqrt(energy / frameData.length);
        
        // Send frame to main thread
        this.port.postMessage({
            type: 'audioFrame',
            data: {
                frameIndex: this.frameCount,
                audioData: frameData,
                timestamp: currentTime,
                energy: rmsEnergy,
                frameInterval: this.averageFrameInterval,
                sampleRate: this.sampleRate
            }
        });
        
        this.frameCount++;
    }
    
    /**
     * Handle messages from main thread
     */
    handleMessage(message) {
        switch (message.type) {
            case 'start':
                this.isActive = true;
                this.frameCount = 0;
                this.bufferIndex = 0;
                console.log('[AudioWorklet] Started processing');
                break;
                
            case 'stop':
                this.isActive = false;
                console.log('[AudioWorklet] Stopped processing');
                break;
                
            case 'reset':
                this.frameCount = 0;
                this.bufferIndex = 0;
                this.frameBuffer.fill(0);
                console.log('[AudioWorklet] Reset buffers');
                break;
                
            case 'getStats':
                this.port.postMessage({
                    type: 'stats',
                    data: {
                        frameCount: this.frameCount,
                        bufferIndex: this.bufferIndex,
                        averageFrameInterval: this.averageFrameInterval,
                        isActive: this.isActive
                    }
                });
                break;
                
            default:
                console.warn(`[AudioWorklet] Unknown message type: ${message.type}`);
        }
    }
}

// Register the processor
registerProcessor('audio-frame-processor', AudioFrameProcessor);
