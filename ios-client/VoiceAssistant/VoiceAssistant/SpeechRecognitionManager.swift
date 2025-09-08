import Foundation
import Speech
import AVFoundation
import Combine

class SpeechRecognitionManager: ObservableObject {
    @Published var transcribedText = ""
    @Published var isTranscribing = false
    @Published var confidence: Float = 0.0
    @Published var lastError: String?
    
    private let speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private let audioEngine = AVAudioEngine()
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    
    // Configuration
    private let maxRecognitionTime: TimeInterval = 30.0 // Maximum recognition time
    private var recognitionTimer: Timer?
    
    init() {
        setupSpeechRecognizer()
    }
    
    deinit {
        stopTranscription()
    }
    
    private func setupSpeechRecognizer() {
        speechRecognizer?.delegate = self
        
        // Check if speech recognition is available
        guard let speechRecognizer = speechRecognizer, speechRecognizer.isAvailable else {
            lastError = "Speech recognition not available"
            return
        }
        
        print("✅ Speech recognizer initialized for locale: \(speechRecognizer.locale?.identifier ?? "unknown")")
    }
    
    func startTranscription() {
        // Check permissions and availability
        guard let speechRecognizer = speechRecognizer,
              speechRecognizer.isAvailable,
              SFSpeechRecognizer.authorizationStatus() == .authorized else {
            lastError = "Speech recognition not authorized or available"
            return
        }
        
        // Stop any existing transcription
        stopTranscription()
        
        // Reset state
        transcribedText = ""
        confidence = 0.0
        lastError = nil
        
        do {
            // Configure audio session
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
            
            // Create recognition request
            recognitionRequest = SFSpeechAudioBufferRecognitionRequest()
            guard let recognitionRequest = recognitionRequest else {
                lastError = "Unable to create recognition request"
                return
            }
            
            // Configure recognition request
            recognitionRequest.shouldReportPartialResults = true
            recognitionRequest.requiresOnDeviceRecognition = true // For privacy
            recognitionRequest.taskHint = .dictation // Optimize for dictation
            
            // Setup audio input
            let inputNode = audioEngine.inputNode
            let recordingFormat = inputNode.outputFormat(forBus: 0)
            
            // Install audio tap
            inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
                recognitionRequest.append(buffer)
            }
            
            // Prepare and start audio engine
            audioEngine.prepare()
            try audioEngine.start()
            
            // Start recognition task
            recognitionTask = speechRecognizer.recognitionTask(with: recognitionRequest) { [weak self] result, error in
                self?.handleRecognitionResult(result: result, error: error)
            }
            
            // Start timeout timer
            recognitionTimer = Timer.scheduledTimer(withTimeInterval: maxRecognitionTime, repeats: false) { [weak self] _ in
                self?.stopTranscription()
            }
            
            DispatchQueue.main.async { [weak self] in
                self?.isTranscribing = true
            }
            
            print("✅ Speech recognition started")
            
        } catch {
            lastError = "Failed to start speech recognition: \(error.localizedDescription)"
            print("❌ Failed to start speech recognition: \(error)")
        }
    }
    
    func stopTranscription() {
        // Stop timer
        recognitionTimer?.invalidate()
        recognitionTimer = nil
        
        // Stop audio engine
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        
        // Finish recognition request
        recognitionRequest?.endAudio()
        recognitionRequest = nil
        
        // Cancel recognition task
        recognitionTask?.cancel()
        recognitionTask = nil
        
        DispatchQueue.main.async { [weak self] in
            self?.isTranscribing = false
        }
        
        print("✅ Speech recognition stopped")
    }
    
    private func handleRecognitionResult(result: SFSpeechRecognitionResult?, error: Error?) {
        if let error = error {
            DispatchQueue.main.async { [weak self] in
                self?.lastError = "Recognition error: \(error.localizedDescription)"
                self?.isTranscribing = false
            }
            print("❌ Speech recognition error: \(error)")
            return
        }
        
        guard let result = result else { return }
        
        // Update transcript and confidence
        let transcript = result.bestTranscription.formattedString
        let segments = result.bestTranscription.segments
        let avgConfidence = segments.isEmpty ? 0.0 : segments.reduce(0.0) { $0 + $1.confidence } / Float(segments.count)
        
        DispatchQueue.main.async { [weak self] in
            self?.transcribedText = transcript
            self?.confidence = avgConfidence
        }
        
        // If result is final, we can stop
        if result.isFinal {
            stopTranscription()
        }
    }
    
    // MARK: - Utility Methods
    
    func getRecognitionStatistics() -> [String: Any] {
        return [
            "is_transcribing": isTranscribing,
            "transcript_length": transcribedText.count,
            "confidence": confidence,
            "locale": speechRecognizer?.locale?.identifier ?? "unknown",
            "on_device": recognitionRequest?.requiresOnDeviceRecognition ?? false
        ]
    }
    
    func clearTranscript() {
        transcribedText = ""
        confidence = 0.0
        lastError = nil
    }
    
    // Check if device supports on-device recognition
    var supportsOnDeviceRecognition: Bool {
        guard let speechRecognizer = speechRecognizer else { return false }
        return speechRecognizer.supportsOnDeviceRecognition
    }
}

// MARK: - SFSpeechRecognizerDelegate

extension SpeechRecognitionManager: SFSpeechRecognizerDelegate {
    func speechRecognizer(_ speechRecognizer: SFSpeechRecognizer, availabilityDidChange available: Bool) {
        DispatchQueue.main.async { [weak self] in
            if !available {
                self?.lastError = "Speech recognition became unavailable"
                self?.stopTranscription()
            }
        }
        print("Speech recognizer availability changed: \(available)")
    }
}
