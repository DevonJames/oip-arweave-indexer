import SwiftUI

struct ContentView: View {
    @StateObject private var audioManager = AudioManager()
    @StateObject private var vadDetector = VoiceActivityDetector()
    @StateObject private var speechRecognizer = SpeechRecognitionManager()
    @StateObject private var smartTurn = SmartTurnDetector()
    @StateObject private var backendComm = BackendCommunicator()
    
    @State private var isListening = false
    @State private var showSettings = false
    @State private var currentTranscript = ""
    @State private var processingTimer: Timer?
    
    var body: some View {
        NavigationView {
            VStack(spacing: 30) {
                // Header
                Text("Enhanced Voice Assistant")
                    .font(.title2)
                    .fontWeight(.semibold)
                    .foregroundColor(.primary)
                
                // Status Indicator
                StatusIndicatorView(
                    isListening: isListening,
                    isVADActive: vadDetector.isSpeechDetected,
                    smartTurnProbability: smartTurn.endpointProbability,
                    backendConnected: backendComm.isConnected
                )
                
                // Audio Visualizer
                VoiceVisualizerView(
                    audioLevel: vadDetector.audioLevel,
                    isActive: vadDetector.isSpeechDetected,
                    isListening: isListening
                )
                
                // Transcript Display
                TranscriptView(
                    transcript: speechRecognizer.transcribedText,
                    confidence: speechRecognizer.confidence,
                    isProcessing: speechRecognizer.isTranscribing
                )
                
                // Response Display
                ResponseView(
                    response: backendComm.backendResponse,
                    isLoading: backendComm.isProcessing,
                    error: backendComm.lastError
                )
                
                Spacer()
                
                // Control Buttons
                HStack(spacing: 40) {
                    // Settings Button
                    Button(action: { showSettings = true }) {
                        Image(systemName: "gear.circle.fill")
                            .font(.system(size: 40))
                            .foregroundColor(.secondary)
                    }
                    
                    // Main Listen Button
                    Button(action: toggleListening) {
                        ZStack {
                            Circle()
                                .fill(isListening ? Color.red : Color.blue)
                                .frame(width: 80, height: 80)
                                .scaleEffect(isListening ? 1.1 : 1.0)
                                .animation(.easeInOut(duration: 0.1), value: isListening)
                            
                            Image(systemName: isListening ? "stop.fill" : "mic.fill")
                                .font(.system(size: 30))
                                .foregroundColor(.white)
                        }
                    }
                    .disabled(!audioManager.isRecordingPermissionGranted || !audioManager.isSpeechRecognitionPermissionGranted)
                    
                    // Clear Button
                    Button(action: clearSession) {
                        Image(systemName: "clear.fill")
                            .font(.system(size: 40))
                            .foregroundColor(.orange)
                    }
                }
                
                // Permission Status
                if !audioManager.isRecordingPermissionGranted || !audioManager.isSpeechRecognitionPermissionGranted {
                    VStack {
                        Text("Permissions Required")
                            .font(.caption)
                            .foregroundColor(.red)
                        
                        Button("Grant Permissions") {
                            audioManager.requestPermissions()
                        }
                        .font(.caption)
                        .foregroundColor(.blue)
                    }
                }
            }
            .padding()
            .navigationBarHidden(true)
            .sheet(isPresented: $showSettings) {
                SettingsView(backendComm: backendComm)
            }
            .onAppear {
                setupApp()
            }
            .onDisappear {
                stopListening()
            }
        }
    }
    
    private func setupApp() {
        audioManager.requestPermissions()
        backendComm.loadSettings()
        backendComm.testConnection()
    }
    
    private func toggleListening() {
        if isListening {
            stopListening()
        } else {
            startListening()
        }
    }
    
    private func startListening() {
        guard audioManager.isRecordingPermissionGranted && audioManager.isSpeechRecognitionPermissionGranted else {
            return
        }
        
        // Clear previous session
        speechRecognizer.transcribedText = ""
        backendComm.backendResponse = ""
        backendComm.lastError = nil
        
        // Start voice processing
        vadDetector.startVAD()
        speechRecognizer.startTranscription()
        isListening = true
        
        // Start monitoring for endpoint detection
        processingTimer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { timer in
            guard isListening else {
                timer.invalidate()
                return
            }
            
            // Update current transcript
            currentTranscript = speechRecognizer.transcribedText
            
            // Analyze for endpoint detection
            let result = smartTurn.analyzeForEndpoint(
                transcript: currentTranscript,
                audioLevel: vadDetector.audioLevel,
                isVADActive: vadDetector.isSpeechDetected
            )
            
            // Check if we should send to backend
            if result.prediction == 1 && !currentTranscript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                // Endpoint detected with valid transcript
                sendToBackend(transcript: currentTranscript, probability: result.probability)
                stopListening()
                timer.invalidate()
            }
        }
    }
    
    private func stopListening() {
        isListening = false
        processingTimer?.invalidate()
        processingTimer = nil
        
        vadDetector.stopVAD()
        speechRecognizer.stopTranscription()
    }
    
    private func sendToBackend(transcript: String, probability: Float) {
        let metadata: [String: Any] = [
            "device_model": UIDevice.current.model,
            "ios_version": UIDevice.current.systemVersion,
            "app_version": "1.0.0",
            "processing_type": "ios_native",
            "vad_used": true,
            "smart_turn_probability": probability
        ]
        
        backendComm.sendRAGQuery(
            transcript: transcript,
            smartTurnProbability: probability,
            metadata: metadata
        )
    }
    
    private func clearSession() {
        stopListening()
        speechRecognizer.transcribedText = ""
        backendComm.backendResponse = ""
        backendComm.lastError = nil
        smartTurn.resetState()
    }
}

// MARK: - Supporting Views

struct StatusIndicatorView: View {
    let isListening: Bool
    let isVADActive: Bool
    let smartTurnProbability: Float
    let backendConnected: Bool
    
    var body: some View {
        HStack(spacing: 20) {
            // Listening Status
            HStack(spacing: 5) {
                Circle()
                    .fill(isListening ? Color.green : Color.gray)
                    .frame(width: 12, height: 12)
                Text(isListening ? "Listening" : "Ready")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            
            // VAD Status
            HStack(spacing: 5) {
                Circle()
                    .fill(isVADActive ? Color.orange : Color.gray)
                    .frame(width: 12, height: 12)
                Text("Voice")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            
            // Smart Turn Probability
            if smartTurnProbability > 0.1 {
                HStack(spacing: 5) {
                    Circle()
                        .fill(smartTurnProbability > 0.6 ? Color.red : Color.yellow)
                        .frame(width: 12, height: 12)
                    Text("\(Int(smartTurnProbability * 100))%")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            
            // Backend Connection
            HStack(spacing: 5) {
                Circle()
                    .fill(backendConnected ? Color.blue : Color.red)
                    .frame(width: 12, height: 12)
                Text("Backend")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(Color.gray.opacity(0.1))
        .cornerRadius(20)
    }
}

struct VoiceVisualizerView: View {
    let audioLevel: Float
    let isActive: Bool
    let isListening: Bool
    
    var body: some View {
        ZStack {
            // Outer ring - listening state
            Circle()
                .stroke(isListening ? Color.blue.opacity(0.3) : Color.gray.opacity(0.3), lineWidth: 4)
                .frame(width: 180, height: 180)
            
            // Middle ring - voice activity
            Circle()
                .fill(isActive ? Color.green.opacity(0.2) : Color.gray.opacity(0.1))
                .frame(width: 140, height: 140)
                .scaleEffect(1 + CGFloat(audioLevel * 3))
                .animation(.easeInOut(duration: 0.1), value: audioLevel)
            
            // Inner circle - microphone
            Circle()
                .fill(isListening ? (isActive ? Color.green : Color.blue) : Color.gray)
                .frame(width: 80, height: 80)
            
            // Microphone icon
            Image(systemName: "mic.fill")
                .font(.system(size: 30))
                .foregroundColor(.white)
        }
    }
}

struct TranscriptView: View {
    let transcript: String
    let confidence: Float
    let isProcessing: Bool
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Transcript")
                    .font(.headline)
                    .foregroundColor(.primary)
                
                Spacer()
                
                if isProcessing {
                    ProgressView()
                        .scaleEffect(0.8)
                }
                
                if confidence > 0 {
                    Text("\(Int(confidence * 100))%")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Color.blue.opacity(0.1))
                        .cornerRadius(8)
                }
            }
            
            ScrollView {
                Text(transcript.isEmpty ? (isProcessing ? "Listening for speech..." : "Tap microphone to start") : transcript)
                    .font(.body)
                    .multilineTextAlignment(.leading)
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.gray.opacity(0.05))
                    .cornerRadius(12)
            }
            .frame(maxHeight: 120)
        }
        .padding(.horizontal)
    }
}

struct ResponseView: View {
    let response: String
    let isLoading: Bool
    let error: String?
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Response")
                    .font(.headline)
                    .foregroundColor(.primary)
                
                Spacer()
                
                if isLoading {
                    ProgressView()
                        .scaleEffect(0.8)
                }
            }
            
            ScrollView {
                if let error = error {
                    Text("Error: \(error)")
                        .font(.body)
                        .foregroundColor(.red)
                        .padding()
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.red.opacity(0.1))
                        .cornerRadius(12)
                } else {
                    Text(response.isEmpty ? (isLoading ? "Processing your request..." : "Response will appear here") : response)
                        .font(.body)
                        .multilineTextAlignment(.leading)
                        .padding()
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.blue.opacity(0.05))
                        .cornerRadius(12)
                }
            }
            .frame(maxHeight: 120)
        }
        .padding(.horizontal)
    }
}

#Preview {
    ContentView()
}
