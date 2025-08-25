import Foundation
import AVFoundation
import Speech
import Combine

class AudioManager: ObservableObject {
    @Published var isRecordingPermissionGranted = false
    @Published var isSpeechRecognitionPermissionGranted = false
    @Published var audioLevel: Float = 0.0
    
    private let audioSession = AVAudioSession.sharedInstance()
    
    init() {
        checkPermissions()
    }
    
    func requestPermissions() {
        requestMicrophonePermission()
        requestSpeechRecognitionPermission()
    }
    
    private func checkPermissions() {
        // Check microphone permission
        switch audioSession.recordPermission {
        case .granted:
            isRecordingPermissionGranted = true
        case .denied, .undetermined:
            isRecordingPermissionGranted = false
        @unknown default:
            isRecordingPermissionGranted = false
        }
        
        // Check speech recognition permission
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized:
            isSpeechRecognitionPermissionGranted = true
        case .denied, .restricted, .notDetermined:
            isSpeechRecognitionPermissionGranted = false
        @unknown default:
            isSpeechRecognitionPermissionGranted = false
        }
    }
    
    private func requestMicrophonePermission() {
        audioSession.requestRecordPermission { [weak self] granted in
            DispatchQueue.main.async {
                self?.isRecordingPermissionGranted = granted
                if granted {
                    self?.configureAudioSession()
                }
            }
        }
    }
    
    private func requestSpeechRecognitionPermission() {
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            DispatchQueue.main.async {
                switch status {
                case .authorized:
                    self?.isSpeechRecognitionPermissionGranted = true
                case .denied, .restricted, .notDetermined:
                    self?.isSpeechRecognitionPermissionGranted = false
                @unknown default:
                    self?.isSpeechRecognitionPermissionGranted = false
                }
            }
        }
    }
    
    private func configureAudioSession() {
        do {
            try audioSession.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker, .allowBluetooth])
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            print("Failed to configure audio session: \(error)")
        }
    }
    
    func prepareForRecording() {
        guard isRecordingPermissionGranted else { return }
        
        do {
            try audioSession.setCategory(.record, mode: .measurement, options: [.allowBluetooth])
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            print("Failed to prepare for recording: \(error)")
        }
    }
    
    func prepareForPlayback() {
        do {
            try audioSession.setCategory(.playback, mode: .default, options: [.defaultToSpeaker])
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            print("Failed to prepare for playback: \(error)")
        }
    }
    
    func deactivateAudioSession() {
        do {
            try audioSession.setActive(false, options: .notifyOthersOnDeactivation)
        } catch {
            print("Failed to deactivate audio session: \(error)")
        }
    }
}
