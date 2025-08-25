import Foundation
import Combine

class SmartTurnDetector: ObservableObject {
    @Published var isEndpointDetected = false
    @Published var endpointProbability: Float = 0.0
    
    // Configuration parameters
    private let endpointThreshold: Float = 0.65
    private let requiredSilenceDuration: TimeInterval = 0.8
    private let minTranscriptLength = 3
    
    // State tracking
    private var silenceStartTime: Date?
    private var lastAudioLevel: Float = 0.0
    private var audioLevelHistory: [Float] = []
    private let historySize = 10
    
    // Analysis weights
    private let transcriptWeight: Float = 0.6
    private let audioWeight: Float = 0.25
    private let silenceWeight: Float = 0.15
    
    init() {
        resetState()
    }
    
    func analyzeForEndpoint(
        transcript: String,
        audioLevel: Float,
        isVADActive: Bool
    ) -> (prediction: Int, probability: Float) {
        
        // Update audio level history
        updateAudioHistory(audioLevel)
        
        // Calculate component scores
        let transcriptScore = analyzeTranscriptFeatures(transcript)
        let audioScore = analyzeAudioFeatures(audioLevel: audioLevel, isVADActive: isVADActive)
        let silenceScore = analyzeSilencePattern(isVADActive: isVADActive)
        
        // Weighted combination
        var endpointScore = (transcriptScore * transcriptWeight) +
                           (audioScore * audioWeight) +
                           (silenceScore * silenceWeight)
        
        // Apply transcript length penalty for very short utterances
        if transcript.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: " ").count < minTranscriptLength {
            endpointScore *= 0.7 // Reduce confidence for short utterances
        }
        
        // Clamp to [0, 1]
        endpointScore = max(0.0, min(1.0, endpointScore))
        
        // Make prediction
        let prediction = endpointScore >= endpointThreshold ? 1 : 0
        
        // Update published properties
        DispatchQueue.main.async { [weak self] in
            self?.endpointProbability = endpointScore
            self?.isEndpointDetected = prediction == 1
        }
        
        return (prediction: prediction, probability: endpointScore)
    }
    
    private func analyzeTranscriptFeatures(_ transcript: String) -> Float {
        let text = transcript.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return 0.3 } // Neutral score for empty text
        
        var score: Float = 0.5 // Base score
        
        // Endpoint phrases (strong indicators)
        let endpointPhrases = [
            "thank you", "thanks", "goodbye", "bye", "see you", "talk later",
            "that's all", "that's it", "done", "finished", "complete",
            "any questions", "questions?", "that's everything", "all set",
            "over and out", "signing off", "end of message", "that'll do"
        ]
        
        for phrase in endpointPhrases {
            if text.contains(phrase) {
                score += 0.4
                break // Only apply bonus once
            }
        }
        
        // Continuation phrases (negative indicators)
        let continuationPhrases = [
            "and", "but", "however", "also", "furthermore", "moreover",
            "in addition", "besides", "actually", "by the way",
            "oh", "um", "uh", "so", "well", "now", "then"
        ]
        
        // Check if transcript starts or ends with continuation words
        let words = text.split(separator: " ")
        if let firstWord = words.first, continuationPhrases.contains(String(firstWord)) {
            score -= 0.3
        }
        if let lastWord = words.last, continuationPhrases.contains(String(lastWord)) {
            score -= 0.2
        }
        
        // Question indicators (usually incomplete)
        let questionWords = ["what", "how", "when", "where", "why", "who", "which", "can", "could", "would", "should"]
        if text.contains("?") {
            score -= 0.3
        } else if questionWords.contains(where: text.hasPrefix) {
            score -= 0.2
        }
        
        // Punctuation analysis
        if text.hasSuffix(".") || text.hasSuffix("!") {
            score += 0.3 // Strong completion indicator
        } else if text.hasSuffix(",") || text.hasSuffix(";") {
            score -= 0.2 // Continuation indicator
        } else if text.hasSuffix("...") {
            score -= 0.3 // Incomplete thought
        }
        
        // Sentence structure analysis
        let sentenceCount = text.components(separatedBy: CharacterSet(charactersIn: ".!?")).filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }.count
        if sentenceCount > 1 {
            score += 0.1 // Multiple sentences suggest completion
        }
        
        // Word count analysis
        let wordCount = words.count
        if wordCount > 15 {
            score += 0.1 // Longer statements more likely complete
        } else if wordCount < 3 {
            score -= 0.2 // Very short likely incomplete
        }
        
        return score
    }
    
    private func analyzeAudioFeatures(audioLevel: Float, isVADActive: Bool) -> Float {
        var score: Float = 0.5 // Base score
        
        // Current silence is a positive indicator
        if !isVADActive {
            score += 0.4
        }
        
        // Analyze energy trend (falling energy suggests completion)
        if audioLevelHistory.count >= 5 {
            let recentLevels = Array(audioLevelHistory.suffix(5))
            let earlyAvg = recentLevels[0..<2].reduce(0, +) / 2
            let lateAvg = recentLevels[3..<5].reduce(0, +) / 2
            
            if lateAvg < earlyAvg * 0.7 {
                score += 0.3 // Energy decreasing
            } else if lateAvg > earlyAvg * 1.3 {
                score -= 0.2 // Energy increasing
            }
        }
        
        // Very low audio levels suggest completion
        if audioLevel < 0.01 {
            score += 0.2
        }
        
        return score
    }
    
    private func analyzeSilencePattern(isVADActive: Bool) -> Float {
        if !isVADActive {
            // Start tracking silence
            if silenceStartTime == nil {
                silenceStartTime = Date()
            }
            
            // Calculate silence duration
            let silenceDuration = Date().timeIntervalSince(silenceStartTime ?? Date())
            
            // Progressive scoring based on silence duration
            if silenceDuration >= requiredSilenceDuration {
                return 1.0 // Strong endpoint indicator
            } else if silenceDuration >= requiredSilenceDuration * 0.5 {
                return 0.6 // Moderate indicator
            } else {
                return 0.3 // Weak indicator
            }
        } else {
            // Reset silence tracking when speech is detected
            silenceStartTime = nil
            return 0.0
        }
    }
    
    private func updateAudioHistory(_ audioLevel: Float) {
        audioLevelHistory.append(audioLevel)
        
        // Keep history size manageable
        if audioLevelHistory.count > historySize {
            audioLevelHistory.removeFirst()
        }
        
        lastAudioLevel = audioLevel
    }
    
    // MARK: - Public Methods
    
    func resetState() {
        silenceStartTime = nil
        audioLevelHistory.removeAll()
        lastAudioLevel = 0.0
        
        DispatchQueue.main.async { [weak self] in
            self?.isEndpointDetected = false
            self?.endpointProbability = 0.0
        }
    }
    
    func updateThreshold(_ newThreshold: Float) {
        // Allow runtime threshold adjustment
        // endpointThreshold = max(0.3, min(0.9, newThreshold))
    }
    
    func getDetectionStatistics() -> [String: Any] {
        return [
            "threshold": endpointThreshold,
            "current_probability": endpointProbability,
            "is_endpoint_detected": isEndpointDetected,
            "silence_duration": silenceStartTime?.timeIntervalSinceNow ?? 0,
            "audio_history_size": audioLevelHistory.count,
            "weights": [
                "transcript": transcriptWeight,
                "audio": audioWeight,
                "silence": silenceWeight
            ]
        ]
    }
    
    // MARK: - Configuration
    
    struct Configuration {
        let endpointThreshold: Float
        let requiredSilenceDuration: TimeInterval
        let minTranscriptLength: Int
        let transcriptWeight: Float
        let audioWeight: Float
        let silenceWeight: Float
        
        static let `default` = Configuration(
            endpointThreshold: 0.65,
            requiredSilenceDuration: 0.8,
            minTranscriptLength: 3,
            transcriptWeight: 0.6,
            audioWeight: 0.25,
            silenceWeight: 0.15
        )
        
        static let sensitive = Configuration(
            endpointThreshold: 0.55,
            requiredSilenceDuration: 0.6,
            minTranscriptLength: 2,
            transcriptWeight: 0.7,
            audioWeight: 0.2,
            silenceWeight: 0.1
        )
        
        static let conservative = Configuration(
            endpointThreshold: 0.75,
            requiredSilenceDuration: 1.2,
            minTranscriptLength: 5,
            transcriptWeight: 0.5,
            audioWeight: 0.3,
            silenceWeight: 0.2
        )
    }
}
