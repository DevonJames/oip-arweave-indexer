import Foundation
import AVFoundation
import Combine

class VoiceActivityDetector: ObservableObject {
    @Published var isSpeechDetected = false
    @Published var audioLevel: Float = 0.0
    
    private let audioEngine = AVAudioEngine()
    private let threshold: Float = 0.02
    private let smoothingFactor: Float = 0.8
    private var smoothedLevel: Float = 0.0
    
    // Voice activity parameters
    private let minSpeechDuration: TimeInterval = 0.3
    private let minSilenceDuration: TimeInterval = 0.5
    private var speechStartTime: Date?
    private var silenceStartTime: Date?
    private var lastVADState = false
    
    // Audio processing
    private var audioLevelTimer: Timer?
    
    init() {
        setupAudioEngine()
    }
    
    deinit {
        stopVAD()
    }
    
    private func setupAudioEngine() {
        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)
        
        // Install tap for audio level monitoring
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { [weak self] buffer, _ in
            self?.processAudioBuffer(buffer)
        }
    }
    
    func startVAD() {
        guard !audioEngine.isRunning else { return }
        
        do {
            audioEngine.prepare()
            try audioEngine.start()
            
            // Start periodic VAD state updates
            audioLevelTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
                self?.updateVADState()
            }
            
            print("✅ VAD started successfully")
        } catch {
            print("❌ Failed to start VAD: \(error)")
        }
    }
    
    func stopVAD() {
        guard audioEngine.isRunning else { return }
        
        audioLevelTimer?.invalidate()
        audioLevelTimer = nil
        
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        
        // Reset state
        DispatchQueue.main.async { [weak self] in
            self?.isSpeechDetected = false
            self?.audioLevel = 0.0
        }
        
        speechStartTime = nil
        silenceStartTime = nil
        lastVADState = false
        smoothedLevel = 0.0
        
        print("✅ VAD stopped")
    }
    
    private func processAudioBuffer(_ buffer: AVAudioPCMBuffer) {
        guard let channelData = buffer.floatChannelData?[0] else { return }
        let frameLength = Int(buffer.frameLength)
        
        // Calculate RMS (Root Mean Square) for audio level
        var rms: Float = 0.0
        for i in 0..<frameLength {
            let sample = channelData[i]
            rms += sample * sample
        }
        rms = sqrt(rms / Float(frameLength))
        
        // Apply smoothing to reduce noise
        smoothedLevel = smoothingFactor * smoothedLevel + (1.0 - smoothingFactor) * rms
        
        // Update audio level on main thread
        DispatchQueue.main.async { [weak self] in
            self?.audioLevel = self?.smoothedLevel ?? 0.0
        }
    }
    
    private func updateVADState() {
        let currentTime = Date()
        let isCurrentlySpeech = smoothedLevel > threshold
        
        // State machine for VAD
        if isCurrentlySpeech {
            // Potential speech detected
            if !lastVADState {
                // Transition from silence to speech
                speechStartTime = currentTime
                silenceStartTime = nil
            } else {
                // Continuing speech - check minimum duration
                if let startTime = speechStartTime,
                   currentTime.timeIntervalSince(startTime) >= minSpeechDuration {
                    // Confirmed speech
                    DispatchQueue.main.async { [weak self] in
                        self?.isSpeechDetected = true
                    }
                }
            }
        } else {
            // Potential silence detected
            if lastVADState {
                // Transition from speech to silence
                silenceStartTime = currentTime
                speechStartTime = nil
            } else {
                // Continuing silence - check minimum duration
                if let startTime = silenceStartTime,
                   currentTime.timeIntervalSince(startTime) >= minSilenceDuration {
                    // Confirmed silence
                    DispatchQueue.main.async { [weak self] in
                        self?.isSpeechDetected = false
                    }
                }
            }
        }
        
        lastVADState = isCurrentlySpeech
    }
    
    // MARK: - Configuration
    
    func updateThreshold(_ newThreshold: Float) {
        // Allow runtime threshold adjustment
        // threshold = max(0.001, min(0.1, newThreshold))
    }
    
    func getVADStatistics() -> [String: Any] {
        return [
            "threshold": threshold,
            "current_level": smoothedLevel,
            "is_speech": isSpeechDetected,
            "min_speech_duration": minSpeechDuration,
            "min_silence_duration": minSilenceDuration
        ]
    }
}
