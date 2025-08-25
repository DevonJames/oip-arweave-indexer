import Foundation
import Combine
import AVFoundation

class BackendCommunicator: ObservableObject {
    @Published var isConnected = false
    @Published var backendResponse = ""
    @Published var audioResponse: Data?
    @Published var isProcessing = false
    @Published var lastError: String?
    
    // Configuration - will be loaded from UserDefaults/environment
    var backendHost = ProcessInfo.processInfo.environment["BACKEND_HOST"] ?? "192.168.1.100"
    var backendPort = Int(ProcessInfo.processInfo.environment["BACKEND_PORT"] ?? "3000") ?? 3000
    var backendProtocol = ProcessInfo.processInfo.environment["BACKEND_PROTOCOL"] ?? "http"
    
    private var cancellables = Set<AnyCancellable>()
    private let session = URLSession.shared
    private var audioPlayer: AVAudioPlayer?
    
    // Settings keys
    private let hostKey = "backendHost"
    private let portKey = "backendPort"
    private let protocolKey = "backendProtocol"
    
    init() {
        loadSettings()
    }
    
    // MARK: - Settings Management
    
    func loadSettings() {
        // Load from UserDefaults first, then fall back to environment variables, then defaults
        backendHost = UserDefaults.standard.string(forKey: hostKey) 
                     ?? ProcessInfo.processInfo.environment["BACKEND_HOST"] 
                     ?? "192.168.1.100"
        
        let defaultPort = Int(ProcessInfo.processInfo.environment["BACKEND_PORT"] ?? "3000") ?? 3000
        backendPort = UserDefaults.standard.integer(forKey: portKey) != 0 
                     ? UserDefaults.standard.integer(forKey: portKey) 
                     : defaultPort
        
        backendProtocol = UserDefaults.standard.string(forKey: protocolKey) 
                         ?? ProcessInfo.processInfo.environment["BACKEND_PROTOCOL"] 
                         ?? "http"
    }
    
    func saveSettings() {
        UserDefaults.standard.set(backendHost, forKey: hostKey)
        UserDefaults.standard.set(backendPort, forKey: portKey)
        UserDefaults.standard.set(backendProtocol, forKey: protocolKey)
    }
    
    private var baseURL: String {
        return "\(backendProtocol)://\(backendHost):\(backendPort)"
    }
    
    // MARK: - Connection Testing
    
    func testConnection() {
        let url = URL(string: "\(baseURL)/api/voice/health")!
        
        var request = URLRequest(url: url)
        request.timeoutInterval = 5.0
        request.httpMethod = "GET"
        
        session.dataTaskPublisher(for: request)
            .map { $0.response as? HTTPURLResponse }
            .receive(on: DispatchQueue.main)
            .sink(
                receiveCompletion: { [weak self] completion in
                    switch completion {
                    case .finished:
                        break
                    case .failure(let error):
                        self?.isConnected = false
                        self?.lastError = "Connection failed: \(error.localizedDescription)"
                        print("❌ Backend connection test failed: \(error)")
                    }
                },
                receiveValue: { [weak self] response in
                    self?.isConnected = response?.statusCode == 200
                    if self?.isConnected == true {
                        self?.lastError = nil
                        print("✅ Backend connection successful")
                    } else {
                        self?.lastError = "Backend returned status: \(response?.statusCode ?? -1)"
                        print("⚠️ Backend connection issue: status \(response?.statusCode ?? -1)")
                    }
                }
            )
            .store(in: &cancellables)
    }
    
    // MARK: - RAG Query
    
    func sendRAGQuery(
        transcript: String,
        smartTurnProbability: Float,
        metadata: [String: Any] = [:]
    ) {
        guard !transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            lastError = "Empty transcript"
            return
        }
        
        let url = URL(string: "\(baseURL)/api/alfred/query")!
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 30.0
        
        let payload: [String: Any] = [
            "query": transcript,
            "metadata": [
                "source": "ios_client",
                "smart_turn_probability": smartTurnProbability,
                "device_model": UIDevice.current.model,
                "ios_version": UIDevice.current.systemVersion,
                "app_version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0",
                "timestamp": ISO8601DateFormatter().string(from: Date())
            ].merging(metadata) { _, new in new }
        ]
        
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        } catch {
            lastError = "Failed to serialize request: \(error.localizedDescription)"
            return
        }
        
        // Update UI state
        DispatchQueue.main.async { [weak self] in
            self?.isProcessing = true
            self?.lastError = nil
            self?.backendResponse = ""
        }
        
        session.dataTaskPublisher(for: request)
            .tryMap { data, response -> Data in
                guard let httpResponse = response as? HTTPURLResponse else {
                    throw URLError(.badServerResponse)
                }
                
                if httpResponse.statusCode != 200 {
                    throw URLError(.init(rawValue: httpResponse.statusCode))
                }
                
                return data
            }
            .decode(type: RAGResponse.self, decoder: JSONDecoder())
            .receive(on: DispatchQueue.main)
            .sink(
                receiveCompletion: { [weak self] completion in
                    self?.isProcessing = false
                    
                    if case .failure(let error) = completion {
                        self?.lastError = "RAG request failed: \(error.localizedDescription)"
                        print("❌ RAG request failed: \(error)")
                    }
                },
                receiveValue: { [weak self] response in
                    self?.backendResponse = response.response
                    print("✅ RAG response received: \(response.response.prefix(100))...")
                    
                    // Request TTS synthesis
                    self?.requestTTSSynthesis(text: response.response)
                }
            )
            .store(in: &cancellables)
    }
    
    // MARK: - TTS Synthesis
    
    private func requestTTSSynthesis(text: String) {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        
        let url = URL(string: "\(baseURL)/api/voice/synthesize")!
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 30.0
        
        let payload: [String: Any] = [
            "text": text,
            "voice": "default",
            "engine": "kokoro",
            "metadata": [
                "source": "ios_client",
                "device": UIDevice.current.model
            ]
        ]
        
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        } catch {
            lastError = "Failed to serialize TTS request: \(error.localizedDescription)"
            return
        }
        
        session.dataTaskPublisher(for: request)
            .tryMap { data, response -> Data in
                guard let httpResponse = response as? HTTPURLResponse else {
                    throw URLError(.badServerResponse)
                }
                
                if httpResponse.statusCode != 200 {
                    throw URLError(.init(rawValue: httpResponse.statusCode))
                }
                
                return data
            }
            .decode(type: TTSResponse.self, decoder: JSONDecoder())
            .receive(on: DispatchQueue.main)
            .sink(
                receiveCompletion: { [weak self] completion in
                    if case .failure(let error) = completion {
                        self?.lastError = "TTS request failed: \(error.localizedDescription)"
                        print("❌ TTS request failed: \(error)")
                    }
                },
                receiveValue: { [weak self] response in
                    if let audioData = Data(base64Encoded: response.audioData) {
                        self?.audioResponse = audioData
                        self?.playAudioResponse(audioData)
                        print("✅ TTS response received and playing")
                    } else {
                        self?.lastError = "Invalid audio data received"
                        print("❌ Invalid TTS audio data")
                    }
                }
            )
            .store(in: &cancellables)
    }
    
    // MARK: - Audio Playback
    
    private func playAudioResponse(_ audioData: Data) {
        do {
            // Configure audio session for playback
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.playback, mode: .default, options: [.defaultToSpeaker])
            try audioSession.setActive(true)
            
            // Create and play audio
            audioPlayer = try AVAudioPlayer(data: audioData)
            audioPlayer?.delegate = self
            audioPlayer?.volume = 1.0
            audioPlayer?.play()
            
        } catch {
            lastError = "Audio playback failed: \(error.localizedDescription)"
            print("❌ Audio playback failed: \(error)")
        }
    }
    
    func stopAudioPlayback() {
        audioPlayer?.stop()
        audioPlayer = nil
    }
    
    // MARK: - Utility Methods
    
    func clearResponse() {
        backendResponse = ""
        audioResponse = nil
        lastError = nil
        stopAudioPlayback()
    }
    
    func getConnectionInfo() -> [String: Any] {
        return [
            "host": backendHost,
            "port": backendPort,
            "protocol": backendProtocol,
            "base_url": baseURL,
            "is_connected": isConnected,
            "is_processing": isProcessing
        ]
    }
}

// MARK: - AVAudioPlayerDelegate

extension BackendCommunicator: AVAudioPlayerDelegate {
    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        if flag {
            print("✅ Audio playback completed successfully")
        } else {
            print("⚠️ Audio playback completed with issues")
        }
        
        // Reset audio session
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        } catch {
            print("Failed to deactivate audio session: \(error)")
        }
    }
    
    func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        if let error = error {
            DispatchQueue.main.async { [weak self] in
                self?.lastError = "Audio decode error: \(error.localizedDescription)"
            }
            print("❌ Audio decode error: \(error?.localizedDescription ?? "Unknown")")
        }
    }
}

// MARK: - Response Models

struct RAGResponse: Codable {
    let response: String
    let sources: [String]?
    let processingTimeMs: Double?
    let metadata: [String: AnyCodable]?
    
    enum CodingKeys: String, CodingKey {
        case response, sources, metadata
        case processingTimeMs = "processing_time_ms"
    }
}

struct TTSResponse: Codable {
    let audioData: String
    let engineUsed: String?
    let processingTimeMs: Double?
    let voiceUsed: String?
    let audioFormat: String?
    
    enum CodingKeys: String, CodingKey {
        case audioData = "audio_data"
        case engineUsed = "engine_used"
        case processingTimeMs = "processing_time_ms"
        case voiceUsed = "voice_used"
        case audioFormat = "audio_format"
    }
}

// Helper for dynamic JSON values
struct AnyCodable: Codable {
    let value: Any
    
    init<T>(_ value: T?) {
        self.value = value ?? ()
    }
    
    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        
        if let intValue = try? container.decode(Int.self) {
            value = intValue
        } else if let doubleValue = try? container.decode(Double.self) {
            value = doubleValue
        } else if let stringValue = try? container.decode(String.self) {
            value = stringValue
        } else if let boolValue = try? container.decode(Bool.self) {
            value = boolValue
        } else {
            value = ()
        }
    }
    
    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        
        if let intValue = value as? Int {
            try container.encode(intValue)
        } else if let doubleValue = value as? Double {
            try container.encode(doubleValue)
        } else if let stringValue = value as? String {
            try container.encode(stringValue)
        } else if let boolValue = value as? Bool {
            try container.encode(boolValue)
        }
    }
}
