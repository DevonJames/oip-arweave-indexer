# iOS Native Client Implementation Plan
## Enhanced Voice Pipeline - iPhone 15 Pro Integration

### 🎯 **Overview**
Create a native iOS app that handles STT/VAD/Smart Turn processing on iPhone 15 Pro using Apple's optimized frameworks, while maintaining integration with the existing PC backend for RAG/LLM/TTS processing.

---

## 📱 **iOS Client Architecture**

### **Core Components**
```
iOS App (Swift/SwiftUI)
├── VoiceProcessor.swift          # iOS Speech Recognition + VAD
├── SmartTurnDetector.swift       # Endpoint detection logic
├── BackendCommunicator.swift     # HTTP client for PC backend
├── AudioManager.swift            # Audio capture/playback management
├── ConfigurationManager.swift    # Settings and backend config
├── ContentView.swift             # Main SwiftUI interface
├── VoiceVisualizerView.swift     # Real-time audio visualization
└── SettingsView.swift            # Configuration UI
```

### **Technology Stack**
- **Language**: Swift 5.9+
- **UI Framework**: SwiftUI
- **Speech Recognition**: iOS Speech Framework
- **Audio Processing**: AVFoundation + AVAudioEngine
- **Voice Activity Detection**: AVAudioEngine + custom logic
- **Networking**: URLSession + Combine
- **Background Processing**: Background App Refresh
- **Data Storage**: UserDefaults + Core Data (if needed)

---

## 🚀 **Implementation Phases**

### **Phase 1: Foundation (Week 1)**
**Core Audio & Speech Setup**

#### 1.1 Project Setup
```swift
// iOS App Target Configuration
- Minimum iOS Version: 17.0
- Capabilities:
  - Speech Recognition
  - Microphone Access
  - Background App Refresh
  - Network Access
```

#### 1.2 Audio Manager Implementation
```swift
import AVFoundation
import Speech

class AudioManager: ObservableObject {
    private let audioEngine = AVAudioEngine()
    private let speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    
    @Published var isListening = false
    @Published var audioLevel: Float = 0.0
    @Published var isRecordingPermissionGranted = false
    @Published var isSpeechRecognitionPermissionGranted = false
    
    // Audio capture and processing methods
}
```

#### 1.3 Permissions & Setup
- Microphone access request
- Speech recognition permission
- Background processing setup
- Audio session configuration

### **Phase 2: Voice Processing (Week 2)**
**STT + VAD Implementation**

#### 2.1 iOS Native Voice Activity Detection
```swift
class VoiceActivityDetector: ObservableObject {
    private let audioEngine = AVAudioEngine()
    private let threshold: Float = 0.02
    private let silenceDuration: TimeInterval = 1.0
    
    @Published var isSpeechDetected = false
    @Published var audioLevel: Float = 0.0
    
    func startVAD() {
        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)
        
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
            self.processAudioBuffer(buffer)
        }
        
        try? audioEngine.start()
    }
    
    private func processAudioBuffer(_ buffer: AVAudioPCMBuffer) {
        // RMS calculation for voice activity detection
        guard let channelData = buffer.floatChannelData?[0] else { return }
        let frameLength = Int(buffer.frameLength)
        
        var rms: Float = 0.0
        for i in 0..<frameLength {
            rms += channelData[i] * channelData[i]
        }
        rms = sqrt(rms / Float(frameLength))
        
        DispatchQueue.main.async {
            self.audioLevel = rms
            self.isSpeechDetected = rms > self.threshold
        }
    }
}
```

#### 2.2 iOS Speech Recognition Integration
```swift
class SpeechRecognitionManager: ObservableObject {
    private let speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private let audioEngine = AVAudioEngine()
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    
    @Published var transcribedText = ""
    @Published var isTranscribing = false
    @Published var confidence: Float = 0.0
    
    func startTranscription() {
        guard let speechRecognizer = speechRecognizer,
              speechRecognizer.isAvailable else { return }
        
        recognitionRequest = SFSpeechAudioBufferRecognitionRequest()
        guard let recognitionRequest = recognitionRequest else { return }
        
        recognitionRequest.shouldReportPartialResults = true
        recognitionRequest.requiresOnDeviceRecognition = true // For privacy
        
        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)
        
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
            recognitionRequest.append(buffer)
        }
        
        audioEngine.prepare()
        try? audioEngine.start()
        
        recognitionTask = speechRecognizer.recognitionTask(with: recognitionRequest) { result, error in
            if let result = result {
                DispatchQueue.main.async {
                    self.transcribedText = result.bestTranscription.formattedString
                    self.confidence = result.bestTranscription.segments.last?.confidence ?? 0.0
                }
            }
        }
    }
}
```

### **Phase 3: Smart Turn Detection (Week 2)**
**Endpoint Detection Logic**

#### 3.1 Smart Turn Implementation
```swift
class SmartTurnDetector: ObservableObject {
    @Published var isEndpointDetected = false
    @Published var endpointProbability: Float = 0.0
    
    private let endpointThreshold: Float = 0.65
    private var silenceStartTime: Date?
    private let requiredSilenceDuration: TimeInterval = 0.8
    
    func analyzeForEndpoint(
        transcript: String,
        audioLevel: Float,
        isVADActive: Bool
    ) -> (prediction: Int, probability: Float) {
        
        var endpointScore: Float = 0.5
        
        // Transcript analysis
        endpointScore += analyzeTranscriptFeatures(transcript)
        
        // Audio analysis
        endpointScore += analyzeAudioFeatures(audioLevel: audioLevel, isVADActive: isVADActive)
        
        // Silence detection
        endpointScore += analyzeSilencePattern(isVADActive: isVADActive)
        
        // Clamp to [0, 1]
        endpointScore = max(0.0, min(1.0, endpointScore))
        
        let prediction = endpointScore >= endpointThreshold ? 1 : 0
        
        DispatchQueue.main.async {
            self.endpointProbability = endpointScore
            self.isEndpointDetected = prediction == 1
        }
        
        return (prediction: prediction, probability: endpointScore)
    }
    
    private func analyzeTranscriptFeatures(_ transcript: String) -> Float {
        let text = transcript.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        var score: Float = 0.0
        
        // Endpoint phrases
        let endpointPhrases = ["thank you", "that's all", "goodbye", "done", "finished"]
        if endpointPhrases.contains(where: text.contains) {
            score += 0.3
        }
        
        // Question indicators (usually incomplete)
        if text.contains("?") || text.hasPrefix("what") || text.hasPrefix("how") {
            score -= 0.2
        }
        
        // Sentence completion
        if text.hasSuffix(".") || text.hasSuffix("!") {
            score += 0.2
        } else if text.hasSuffix(",") {
            score -= 0.1
        }
        
        return score
    }
    
    private func analyzeAudioFeatures(audioLevel: Float, isVADActive: Bool) -> Float {
        var score: Float = 0.0
        
        // Falling energy suggests completion
        // (Implementation would track energy over time)
        
        // Current silence
        if !isVADActive {
            score += 0.2
        }
        
        return score
    }
    
    private func analyzeSilencePattern(isVADActive: Bool) -> Float {
        if !isVADActive {
            if silenceStartTime == nil {
                silenceStartTime = Date()
            }
            
            let silenceDuration = Date().timeIntervalSince(silenceStartTime ?? Date())
            if silenceDuration >= requiredSilenceDuration {
                return 0.3 // Strong indicator of endpoint
            }
        } else {
            silenceStartTime = nil
        }
        
        return 0.0
    }
}
```

### **Phase 4: Backend Communication (Week 3)**
**PC Backend Integration**

#### 4.1 Backend Communicator
```swift
import Combine

class BackendCommunicator: ObservableObject {
    @Published var isConnected = false
    @Published var backendResponse = ""
    @Published var audioResponse: Data?
    
    private var cancellables = Set<AnyCancellable>()
    
    // Configuration
    var backendHost = "192.168.1.100"
    var backendPort = 3005
    
    func sendRAGQuery(
        transcript: String,
        smartTurnProbability: Float,
        metadata: [String: Any] = [:]
    ) {
        let url = URL(string: "http://\(backendHost):\(backendPort)/api/alfred/query")!
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let payload: [String: Any] = [
            "query": transcript,
            "metadata": [
                "source": "ios_client",
                "smart_turn_probability": smartTurnProbability,
                "device": UIDevice.current.model,
                "ios_version": UIDevice.current.systemVersion
            ].merging(metadata) { _, new in new }
        ]
        
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        } catch {
            print("Failed to serialize request: \(error)")
            return
        }
        
        URLSession.shared.dataTaskPublisher(for: request)
            .map(\.data)
            .decode(type: RAGResponse.self, decoder: JSONDecoder())
            .receive(on: DispatchQueue.main)
            .sink(
                receiveCompletion: { completion in
                    if case .failure(let error) = completion {
                        print("RAG request failed: \(error)")
                    }
                },
                receiveValue: { [weak self] response in
                    self?.backendResponse = response.response
                    self?.requestTTSSynthesis(text: response.response)
                }
            )
            .store(in: &cancellables)
    }
    
    private func requestTTSSynthesis(text: String) {
        let url = URL(string: "http://\(backendHost):\(backendPort)/api/voice/synthesize")!
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let payload: [String: Any] = [
            "text": text,
            "voice": "default",
            "engine": "kokoro"
        ]
        
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        } catch {
            print("Failed to serialize TTS request: \(error)")
            return
        }
        
        URLSession.shared.dataTaskPublisher(for: request)
            .map(\.data)
            .decode(type: TTSResponse.self, decoder: JSONDecoder())
            .receive(on: DispatchQueue.main)
            .sink(
                receiveCompletion: { completion in
                    if case .failure(let error) = completion {
                        print("TTS request failed: \(error)")
                    }
                },
                receiveValue: { [weak self] response in
                    if let audioData = Data(base64Encoded: response.audioData) {
                        self?.audioResponse = audioData
                        self?.playAudioResponse(audioData)
                    }
                }
            )
            .store(in: &cancellables)
    }
    
    private func playAudioResponse(_ audioData: Data) {
        // Implementation for audio playback
        // Using AVAudioPlayer or AVAudioEngine
    }
}

// Response models
struct RAGResponse: Codable {
    let response: String
    let sources: [String]?
    let processingTimeMs: Double?
    
    enum CodingKeys: String, CodingKey {
        case response, sources
        case processingTimeMs = "processing_time_ms"
    }
}

struct TTSResponse: Codable {
    let audioData: String
    let engineUsed: String?
    let processingTimeMs: Double?
    
    enum CodingKeys: String, CodingKey {
        case audioData = "audio_data"
        case engineUsed = "engine_used"
        case processingTimeMs = "processing_time_ms"
    }
}
```

### **Phase 5: User Interface (Week 3)**
**SwiftUI Implementation**

#### 5.1 Main Content View
```swift
import SwiftUI

struct ContentView: View {
    @StateObject private var audioManager = AudioManager()
    @StateObject private var vadDetector = VoiceActivityDetector()
    @StateObject private var speechRecognizer = SpeechRecognitionManager()
    @StateObject private var smartTurn = SmartTurnDetector()
    @StateObject private var backendComm = BackendCommunicator()
    
    @State private var isListening = false
    @State private var showSettings = false
    
    var body: some View {
        NavigationView {
            VStack(spacing: 30) {
                // Status Indicator
                StatusIndicatorView(
                    isListening: isListening,
                    isVADActive: vadDetector.isSpeechDetected,
                    smartTurnProbability: smartTurn.endpointProbability
                )
                
                // Audio Visualizer
                VoiceVisualizerView(
                    audioLevel: vadDetector.audioLevel,
                    isActive: vadDetector.isSpeechDetected
                )
                
                // Transcript Display
                TranscriptView(
                    transcript: speechRecognizer.transcribedText,
                    confidence: speechRecognizer.confidence
                )
                
                // Response Display
                ResponseView(
                    response: backendComm.backendResponse,
                    isLoading: backendComm.isProcessing
                )
                
                // Control Buttons
                HStack(spacing: 40) {
                    // Listen Button
                    Button(action: toggleListening) {
                        Image(systemName: isListening ? "stop.circle.fill" : "mic.circle.fill")
                            .font(.system(size: 60))
                            .foregroundColor(isListening ? .red : .blue)
                    }
                    .disabled(!audioManager.isRecordingPermissionGranted)
                    
                    // Settings Button
                    Button(action: { showSettings = true }) {
                        Image(systemName: "gear.circle.fill")
                            .font(.system(size: 40))
                            .foregroundColor(.gray)
                    }
                }
                
                Spacer()
            }
            .padding()
            .navigationTitle("Voice Assistant")
            .sheet(isPresented: $showSettings) {
                SettingsView(backendComm: backendComm)
            }
        }
        .onAppear {
            setupPermissions()
        }
    }
    
    private func toggleListening() {
        if isListening {
            stopListening()
        } else {
            startListening()
        }
    }
    
    private func startListening() {
        vadDetector.startVAD()
        speechRecognizer.startTranscription()
        isListening = true
        
        // Monitor for endpoint detection
        Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { timer in
            if !isListening {
                timer.invalidate()
                return
            }
            
            let result = smartTurn.analyzeForEndpoint(
                transcript: speechRecognizer.transcribedText,
                audioLevel: vadDetector.audioLevel,
                isVADActive: vadDetector.isSpeechDetected
            )
            
            if result.prediction == 1 && !speechRecognizer.transcribedText.isEmpty {
                // Endpoint detected, send to backend
                backendComm.sendRAGQuery(
                    transcript: speechRecognizer.transcribedText,
                    smartTurnProbability: result.probability
                )
                stopListening()
                timer.invalidate()
            }
        }
    }
    
    private func stopListening() {
        vadDetector.stopVAD()
        speechRecognizer.stopTranscription()
        isListening = false
    }
    
    private func setupPermissions() {
        audioManager.requestPermissions()
    }
}
```

#### 5.2 Supporting Views
```swift
struct VoiceVisualizerView: View {
    let audioLevel: Float
    let isActive: Bool
    
    var body: some View {
        ZStack {
            Circle()
                .fill(isActive ? Color.green.opacity(0.3) : Color.gray.opacity(0.3))
                .frame(width: 200, height: 200)
                .scaleEffect(1 + CGFloat(audioLevel * 2))
                .animation(.easeInOut(duration: 0.1), value: audioLevel)
            
            Circle()
                .fill(isActive ? Color.green : Color.gray)
                .frame(width: 100, height: 100)
        }
    }
}

struct TranscriptView: View {
    let transcript: String
    let confidence: Float
    
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Transcript")
                .font(.headline)
            
            ScrollView {
                Text(transcript.isEmpty ? "Listening..." : transcript)
                    .font(.body)
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.gray.opacity(0.1))
                    .cornerRadius(10)
            }
            .frame(maxHeight: 150)
            
            if confidence > 0 {
                Text("Confidence: \(Int(confidence * 100))%")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
    }
}

struct SettingsView: View {
    @ObservedObject var backendComm: BackendCommunicator
    @Environment(\.dismiss) private var dismiss
    
    @State private var backendHost: String = ""
    @State private var backendPort: String = ""
    
    var body: some View {
        NavigationView {
            Form {
                Section("Backend Configuration") {
                    TextField("Host IP", text: $backendHost)
                        .textFieldStyle(RoundedBorderTextFieldStyle())
                    
                    TextField("Port", text: $backendPort)
                        .textFieldStyle(RoundedBorderTextFieldStyle())
                        .keyboardType(.numberPad)
                }
                
                Section("Connection Status") {
                    HStack {
                        Text("Status")
                        Spacer()
                        Text(backendComm.isConnected ? "Connected" : "Disconnected")
                            .foregroundColor(backendComm.isConnected ? .green : .red)
                    }
                }
                
                Section {
                    Button("Test Connection") {
                        testConnection()
                    }
                    
                    Button("Save Settings") {
                        saveSettings()
                    }
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
        .onAppear {
            loadSettings()
        }
    }
    
    private func loadSettings() {
        backendHost = backendComm.backendHost
        backendPort = String(backendComm.backendPort)
    }
    
    private func saveSettings() {
        backendComm.backendHost = backendHost
        backendComm.backendPort = Int(backendPort) ?? 3005
        
        // Save to UserDefaults
        UserDefaults.standard.set(backendHost, forKey: "backendHost")
        UserDefaults.standard.set(backendComm.backendPort, forKey: "backendPort")
        
        dismiss()
    }
    
    private func testConnection() {
        // Implementation for connection testing
    }
}
```

---

## 📊 **Performance Optimizations**

### **Battery Life Optimization**
```swift
class PowerManager {
    static func optimizeForBatteryLife() {
        // Reduce audio processing frequency when on battery
        // Use lower quality audio formats when possible
        // Implement smart sleep/wake cycles
    }
    
    static func enableHighPerformanceMode() {
        // Use when plugged in or high battery
        // Enable full quality processing
    }
}
```

### **Memory Management**
```swift
class MemoryManager {
    static func optimizeMemoryUsage() {
        // Release audio buffers promptly
        // Use autoreleasepool for audio processing
        // Monitor memory warnings
    }
}
```

---

## 🧪 **Testing Strategy**

### **Unit Tests**
- VAD accuracy testing
- Speech recognition accuracy
- Smart Turn endpoint detection
- Backend communication reliability

### **Integration Tests**
- End-to-end pipeline testing
- Network failure handling
- Background processing
- Permission handling

### **Performance Tests**
- Battery usage monitoring
- Memory consumption tracking
- CPU usage optimization
- Thermal throttling handling

---

## 📱 **App Store Preparation**

### **Required Permissions**
```xml
<key>NSMicrophoneUsageDescription</key>
<string>This app needs microphone access for voice recognition</string>

<key>NSSpeechRecognitionUsageDescription</key>
<string>This app uses speech recognition to process your voice commands</string>

<key>UIBackgroundModes</key>
<array>
    <string>audio</string>
    <string>background-processing</string>
</array>
```

### **App Store Metadata**
- Privacy policy for voice data
- Description of backend communication
- Feature list and capabilities
- Screenshots and demo video

---

## 🚀 **Deployment Timeline**

### **Week 1: Foundation**
- Project setup and basic UI
- Permission handling
- Audio capture implementation

### **Week 2: Core Features**
- iOS Speech Recognition integration
- VAD implementation
- Smart Turn detection logic

### **Week 3: Backend Integration**
- HTTP communication layer
- RAG query integration
- TTS response handling

### **Week 4: Polish & Testing**
- UI refinements
- Performance optimization
- Testing and bug fixes

### **Week 5: App Store Submission**
- Final testing
- App Store preparation
- Submission and review

---

## 💡 **Advantages of iOS Native Approach**

### **Performance Benefits**
- **Native Speech Recognition**: Highly optimized by Apple
- **Battery Efficiency**: Designed for mobile use
- **Real-time Processing**: Optimized for continuous operation
- **Privacy**: All voice processing on-device

### **User Experience**
- **Seamless Integration**: Native iOS UI/UX
- **Background Processing**: Continue listening in background
- **Siri Integration**: Potential future integration
- **Accessibility**: VoiceOver and accessibility support

### **Technical Advantages**
- **Automatic Updates**: iOS Speech improvements
- **Language Support**: 50+ languages supported
- **Noise Handling**: Advanced noise cancellation
- **Hardware Optimization**: A17 Pro specific optimizations

This iOS implementation would provide a premium mobile experience while leveraging your existing PC backend infrastructure for the heavy AI processing. The native iOS Speech Recognition will likely outperform Whisper on mobile devices while being much more battery efficient.

Would you like me to start implementing any specific component of this plan?

