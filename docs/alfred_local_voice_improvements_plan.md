# ALFRED Local Voice Improvements Implementation Plan

## Overview

This plan focuses on implementing the key improvements identified from Kwindla's macos-local-voice-agents repository while maintaining the LLM/RAG + TTS processing on the remote RTX 4090 machine. The goal is to achieve <1 second response times and seamless user interruption capabilities.

## Architecture Strategy

### Hybrid Processing Model
```
┌─────────────────┐    WebRTC    ┌──────────────────┐
│   Mac Client    │◄────────────►│  Remote Backend  │
│                 │   (text only) │  (RTX 4090)      │
│ • WebRTC UI     │              │                  │
│ • VAD (local)   │              │ • LLM/RAG        │
│ • STT (local)   │              │ • TTS Generation │
│ • Smart Turn    │              │ • Response Gen   │
│ • Interruption  │              │                  │
│ • Audio Stream  │              │                  │
└─────────────────┘              └──────────────────┘
```

**Key Principle**: Keep audio processing local, send only text to remote backend, stream TTS audio back via WebRTC.

## Implementation Phases

### Phase 1: WebRTC Foundation (Week 1-2)
**Goal**: Replace WebSocket communication with WebRTC for audio streaming

#### Tasks:
- [ ] **1.1 WebRTC Client Setup** (3 days)
  - [ ] Install WebRTC dependencies in mac-client
  - [ ] Create WebRTC peer connection manager
  - [ ] Implement audio stream handling
  - [ ] Add STUN server configuration

- [ ] **1.2 WebRTC Server Integration** (2 days)
  - [ ] Add WebRTC support to voice_interface_server.js
  - [ ] Implement signaling server for peer connection
  - [ ] Create audio stream relay to backend

- [ ] **1.3 Audio Streaming Pipeline** (2 days)
  - [ ] Replace WebSocket audio upload with WebRTC streaming
  - [ ] Implement real-time audio chunk transmission
  - [ ] Add audio quality adaptation

#### Deliverables:
- [ ] WebRTC-based audio streaming (bidirectional)
- [ ] Reduced audio transmission latency (<100ms)
- [ ] Fallback to WebSocket if WebRTC fails

#### Success Metrics:
- [ ] Audio transmission latency < 100ms
- [ ] No audio dropouts during streaming
- [ ] Successful WebRTC connection establishment >95%

### Phase 2: Frame-Based Audio Processing (Week 2-3)
**Goal**: Implement 20ms frame-based audio processing for real-time capabilities

#### Tasks:
- [ ] **2.1 Audio Frame Processing** (3 days)
  - [ ] Modify mac_stt_service.py for frame-based input
  - [ ] Implement 20ms audio frame buffering
  - [ ] Add frame-level VAD processing
  - [ ] Create audio frame queue management

- [ ] **2.2 Real-Time STT Streaming** (2 days)
  - [ ] Implement streaming STT (partial results)
  - [ ] Add confidence-based transcription filtering
  - [ ] Create text accumulation and correction logic

- [ ] **2.3 Frame Coordination** (2 days)
  - [ ] Synchronize VAD, STT, and Smart Turn processing
  - [ ] Implement frame-level timing coordination
  - [ ] Add processing latency monitoring

#### Deliverables:
- [ ] 20ms audio frame processing pipeline
- [ ] Real-time STT with partial results
- [ ] Frame-synchronized processing across all local services

#### Success Metrics:
- [ ] Frame processing latency < 20ms
- [ ] STT partial results within 100ms of speech
- [ ] Frame synchronization accuracy >99%

### Phase 3: Real-Time Interruption System (Week 3-4)
**Goal**: Implement sophisticated interruption handling with smart-turn v2 capabilities

#### Tasks:
- [ ] **3.1 Enhanced Smart Turn Model** (3 days)
  - [ ] Research and implement smart-turn v2 or equivalent
  - [ ] Add frame-level interruption detection
  - [ ] Implement confidence scoring for interruptions
  - [ ] Create interruption intent classification

- [ ] **3.2 Mid-Speech Interruption** (3 days)
  - [ ] Add ability to interrupt TTS playback instantly
  - [ ] Implement audio crossfading for smooth transitions
  - [ ] Create interruption state management
  - [ ] Add user intent detection (interruption vs noise)

- [ ] **3.3 Conversation Flow Management** (2 days)
  - [ ] Implement turn-taking state machine
  - [ ] Add conversation context preservation during interruptions
  - [ ] Create smooth transition between speaking/listening modes

#### Deliverables:
- [ ] Real-time interruption detection (<200ms response)
- [ ] Seamless TTS interruption and audio crossfading
- [ ] Natural conversation flow with overlapping speech handling

#### Success Metrics:
- [ ] Interruption detection latency < 200ms
- [ ] Successful interruption handling >90% accuracy
- [ ] No audio artifacts during interruption transitions

### Phase 4: Unified Local Pipeline (Week 4-5)
**Goal**: Combine separate Mac services into a coordinated pipeline

#### Tasks:
- [ ] **4.1 Service Integration** (3 days)
  - [ ] Create unified voice processing service
  - [ ] Combine VAD, STT, and Smart Turn into single process
  - [ ] Implement shared memory for inter-component communication
  - [ ] Add centralized configuration management

- [ ] **4.2 Pipeline Coordination** (2 days)
  - [ ] Implement frame-level pipeline coordination
  - [ ] Add processing queue management
  - [ ] Create backpressure handling for overload situations
  - [ ] Implement graceful degradation under load

- [ ] **4.3 Performance Optimization** (2 days)
  - [ ] Optimize memory usage and CPU utilization
  - [ ] Add processing latency monitoring and alerts
  - [ ] Implement adaptive quality based on system load
  - [ ] Create performance profiling and debugging tools

#### Deliverables:
- [ ] Single unified voice processing service
- [ ] Coordinated pipeline with shared state
- [ ] Performance monitoring and optimization

#### Success Metrics:
- [ ] Reduced IPC overhead (50% improvement)
- [ ] Consistent processing latency (<100ms variation)
- [ ] System resource usage optimized

### Phase 5: Enhanced User Interface (Week 5-6)
**Goal**: Optimize interface for real-time voice interactions

#### Tasks:
- [ ] **5.1 Real-Time Visual Feedback** (2 days)
  - [ ] Add real-time audio level visualization
  - [ ] Implement speaking/listening state indicators
  - [ ] Create interruption feedback (visual confirmation)
  - [ ] Add processing latency display (debug mode)

- [ ] **5.2 Conversation Flow UI** (2 days)
  - [ ] Implement streaming text display (partial results)
  - [ ] Add conversation history with timing info
  - [ ] Create interruption indicators in conversation
  - [ ] Add voice activity visualization

- [ ] **5.3 Error Handling & Fallbacks** (3 days)
  - [ ] Implement graceful WebRTC fallback to WebSocket
  - [ ] Add local processing failure recovery
  - [ ] Create user-friendly error messages
  - [ ] Implement connection quality indicators

#### Deliverables:
- [ ] Real-time voice interaction UI
- [ ] Visual feedback for all processing stages
- [ ] Robust error handling and fallback mechanisms

#### Success Metrics:
- [ ] User can see real-time processing status
- [ ] <100ms UI response to voice activity
- [ ] Error recovery success rate >95%

## Technical Implementation Details

### WebRTC Integration Architecture

```javascript
// WebRTC Audio Pipeline
class WebRTCAudioPipeline {
    constructor() {
        this.peerConnection = new RTCPeerConnection(config);
        this.audioStream = null;
        this.dataChannel = null;
    }
    
    async setupAudioStreaming() {
        // Get microphone stream
        this.audioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                sampleRate: 16000,
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true
            }
        });
        
        // Add to peer connection
        this.audioStream.getTracks().forEach(track => {
            this.peerConnection.addTrack(track, this.audioStream);
        });
        
        // Setup data channel for text communication
        this.dataChannel = this.peerConnection.createDataChannel('text', {
            ordered: true,
            maxRetransmits: 0
        });
    }
    
    sendTextToBackend(text) {
        this.dataChannel.send(JSON.stringify({
            type: 'transcription',
            text: text,
            timestamp: Date.now()
        }));
    }
}
```

### Frame-Based Processing Architecture

```javascript
// Unified Voice Processor
class UnifiedVoiceProcessor {
    constructor() {
        this.frameSize = 320; // 20ms at 16kHz
        this.frameBuffer = new Float32Array(this.frameSize);
        this.frameIndex = 0;
        
        this.vadProcessor = new VADProcessor();
        this.sttProcessor = new STTProcessor();
        this.smartTurnProcessor = new SmartTurnProcessor();
    }
    
    processAudioFrame(audioData) {
        // Frame-level processing pipeline
        const vadResult = this.vadProcessor.process(audioData);
        if (vadResult.hasSpeech) {
            const sttResult = this.sttProcessor.process(audioData);
            const turnResult = this.smartTurnProcessor.process(audioData, sttResult);
            
            return {
                frame: this.frameIndex++,
                vad: vadResult,
                stt: sttResult,
                turn: turnResult,
                timestamp: Date.now()
            };
        }
        return null;
    }
}
```

### Interruption Handling System

```javascript
// Real-Time Interruption Handler
class InterruptionHandler {
    constructor() {
        this.isPlaying = false;
        this.currentAudioContext = null;
        this.interruptionThreshold = 0.7;
    }
    
    async handleInterruption(smartTurnResult) {
        if (smartTurnResult.probability > this.interruptionThreshold && this.isPlaying) {
            // Immediate interruption
            await this.stopCurrentPlayback();
            await this.crossfadeToListening();
            
            // Notify backend of interruption
            this.notifyBackendInterruption();
            
            return true;
        }
        return false;
    }
    
    async stopCurrentPlayback() {
        if (this.currentAudioContext) {
            await this.currentAudioContext.suspend();
            this.isPlaying = false;
        }
    }
    
    async crossfadeToListening() {
        // Implement smooth audio transition
        const fadeTime = 0.1; // 100ms crossfade
        // ... crossfade implementation
    }
}
```

## Progress Tracking

### Week 1-2: WebRTC Foundation
- [ ] Day 1-2: WebRTC client setup and peer connection
- [ ] Day 3-4: Server-side WebRTC integration
- [ ] Day 5-7: Audio streaming pipeline implementation
- [ ] Day 8-10: Testing and debugging WebRTC connection
- [ ] **Milestone**: WebRTC audio streaming functional

### Week 2-3: Frame-Based Processing
- [ ] Day 11-13: Frame-based audio processing implementation
- [ ] Day 14-15: Real-time STT streaming
- [ ] Day 16-17: Frame coordination and synchronization
- [ ] Day 18-21: Testing and optimization
- [ ] **Milestone**: 20ms frame processing achieved

### Week 3-4: Real-Time Interruption
- [ ] Day 22-24: Smart turn model enhancement
- [ ] Day 25-27: Mid-speech interruption implementation
- [ ] Day 28-29: Conversation flow management
- [ ] Day 30-32: Integration testing
- [ ] **Milestone**: Real-time interruption functional

### Week 4-5: Unified Pipeline
- [ ] Day 33-35: Service integration and unification
- [ ] Day 36-37: Pipeline coordination
- [ ] Day 38-39: Performance optimization
- [ ] Day 40-42: Load testing and tuning
- [ ] **Milestone**: Unified pipeline operational

### Week 5-6: Enhanced UI
- [ ] Day 43-44: Real-time visual feedback
- [ ] Day 45-46: Conversation flow UI
- [ ] Day 47-49: Error handling and fallbacks
- [ ] Day 50-52: User testing and refinement
- [ ] **Milestone**: Production-ready interface

## Key Performance Targets

### Latency Goals
- [ ] **Audio transmission**: <100ms (WebRTC)
- [ ] **Frame processing**: <20ms per frame
- [ ] **STT partial results**: <200ms from speech start
- [ ] **Interruption detection**: <200ms response time
- [ ] **End-to-end response**: <1 second for simple queries

### Quality Metrics
- [ ] **Interruption accuracy**: >90% correct detection
- [ ] **WebRTC connection success**: >95%
- [ ] **Audio quality**: No dropouts or artifacts
- [ ] **System stability**: >99% uptime during conversations

### User Experience Goals
- [ ] **Natural conversation flow**: Seamless interruptions
- [ ] **Responsive feedback**: Real-time visual indicators
- [ ] **Reliable operation**: Graceful error handling
- [ ] **Consistent performance**: <100ms latency variation

## Risk Mitigation

### Technical Risks
1. **WebRTC compatibility issues**
   - Mitigation: Implement WebSocket fallback
   - Testing: Multiple browser/network configurations

2. **Frame processing performance**
   - Mitigation: Adaptive quality based on system load
   - Monitoring: Real-time performance metrics

3. **Interruption detection accuracy**
   - Mitigation: Tunable thresholds and confidence scoring
   - Testing: Extensive real-world conversation testing

### Implementation Risks
1. **Integration complexity**
   - Mitigation: Incremental implementation with rollback capability
   - Testing: Parallel testing with existing system

2. **Performance degradation**
   - Mitigation: Performance monitoring and alerting
   - Optimization: Continuous profiling and optimization

## Success Criteria

### Phase Completion Criteria
Each phase must meet its success metrics before proceeding to the next phase.

### Overall Success Metrics
- [ ] **Response time**: <1 second average, <800ms for conversational responses
- [ ] **Interruption handling**: Natural, seamless user interruptions
- [ ] **Audio quality**: No degradation from current system
- [ ] **Reliability**: No regressions in system stability
- [ ] **User satisfaction**: Improved perceived responsiveness

## Testing Strategy

### Automated Testing
- [ ] Unit tests for each processing component
- [ ] Integration tests for pipeline coordination
- [ ] Performance benchmarks for latency measurement
- [ ] Load testing for system stability

### Manual Testing
- [ ] Real-world conversation testing
- [ ] Interruption scenario testing
- [ ] Network condition testing (poor connectivity)
- [ ] Multi-user concurrent testing

### User Acceptance Testing
- [ ] A/B testing against current system
- [ ] User feedback collection
- [ ] Usability testing for new interface features
- [ ] Performance perception testing

---

## Getting Started

### Prerequisites
- [ ] WebRTC library installation
- [ ] Frame processing libraries
- [ ] Enhanced Smart Turn model
- [ ] Development environment setup

### First Steps
1. Start with Phase 1: WebRTC Foundation
2. Set up development branch for voice improvements
3. Implement WebRTC client-side components
4. Test basic audio streaming functionality

This plan maintains your powerful RTX 4090 backend while dramatically improving the local voice interaction experience through real-time processing and seamless interruption handling.
