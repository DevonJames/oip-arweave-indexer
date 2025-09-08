import SwiftUI

struct SettingsView: View {
    @ObservedObject var backendComm: BackendCommunicator
    @Environment(\.dismiss) private var dismiss
    
    @State private var backendHost: String = ""
    @State private var backendPort: String = ""
    @State private var backendProtocol: String = "http"
    @State private var isTestingConnection = false
    @State private var connectionTestResult: String = ""
    
    private let protocols = ["http", "https"]
    
    var body: some View {
        NavigationView {
            Form {
                // Backend Configuration Section
                Section("Backend Configuration") {
                    HStack {
                        Text("Protocol")
                        Spacer()
                        Picker("Protocol", selection: $backendProtocol) {
                            ForEach(protocols, id: \.self) { protocol in
                                Text(protocol.uppercased()).tag(protocol)
                            }
                        }
                        .pickerStyle(SegmentedPickerStyle())
                    }
                    
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Host IP Address")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        TextField(ProcessInfo.processInfo.environment["BACKEND_HOST"] ?? "192.168.1.100", text: $backendHost)
                            .textFieldStyle(RoundedBorderTextFieldStyle())
                            .keyboardType(.decimalPad)
                            .autocapitalization(.none)
                            .disableAutocorrection(true)
                    }
                    
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Port")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        TextField(ProcessInfo.processInfo.environment["BACKEND_PORT"] ?? "3000", text: $backendPort)
                            .textFieldStyle(RoundedBorderTextFieldStyle())
                            .keyboardType(.numberPad)
                    }
                    
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Full URL")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        Text("\(backendProtocol)://\(backendHost):\(backendPort)")
                            .font(.system(.body, design: .monospaced))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(Color.gray.opacity(0.1))
                            .cornerRadius(8)
                    }
                }
                
                // Connection Status Section
                Section("Connection Status") {
                    HStack {
                        Text("Status")
                        Spacer()
                        HStack(spacing: 8) {
                            Circle()
                                .fill(backendComm.isConnected ? Color.green : Color.red)
                                .frame(width: 12, height: 12)
                            Text(backendComm.isConnected ? "Connected" : "Disconnected")
                                .foregroundColor(backendComm.isConnected ? .green : .red)
                                .fontWeight(.medium)
                        }
                    }
                    
                    if !connectionTestResult.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Test Result")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            Text(connectionTestResult)
                                .font(.caption)
                                .foregroundColor(connectionTestResult.contains("Success") ? .green : .red)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(Color.gray.opacity(0.1))
                                .cornerRadius(6)
                        }
                    }
                    
                    if let lastError = backendComm.lastError {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Last Error")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            Text(lastError)
                                .font(.caption)
                                .foregroundColor(.red)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(Color.red.opacity(0.1))
                                .cornerRadius(6)
                        }
                    }
                }
                
                // Actions Section
                Section("Actions") {
                    Button(action: testConnection) {
                        HStack {
                            if isTestingConnection {
                                ProgressView()
                                    .scaleEffect(0.8)
                            } else {
                                Image(systemName: "network")
                            }
                            Text("Test Connection")
                        }
                    }
                    .disabled(isTestingConnection || backendHost.isEmpty || backendPort.isEmpty)
                    
                    Button(action: saveSettings) {
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.green)
                            Text("Save Settings")
                        }
                    }
                    .disabled(backendHost.isEmpty || backendPort.isEmpty)
                    
                    Button(action: resetToDefaults) {
                        HStack {
                            Image(systemName: "arrow.clockwise")
                                .foregroundColor(.orange)
                            Text("Reset to Defaults")
                        }
                    }
                }
                
                // Information Section
                Section("Information") {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Setup Instructions")
                            .font(.subheadline)
                            .fontWeight(.semibold)
                        
                        VStack(alignment: .leading, spacing: 4) {
                            Text("1. Find your PC's IP address:")
                                .font(.caption)
                                .fontWeight(.medium)
                            Text("   • Windows: ipconfig")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            Text("   • Mac/Linux: ifconfig")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        
                        VStack(alignment: .leading, spacing: 4) {
                            Text("2. Ensure backend is running:")
                                .font(.caption)
                                .fontWeight(.medium)
                            Text("   • Docker: ./deploy-backend-only.sh")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            Text("   • Native: npm start")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        
                        VStack(alignment: .leading, spacing: 4) {
                            Text("3. Check firewall settings:")
                                .font(.caption)
                                .fontWeight(.medium)
                            Text("   • Allow port 3005 (or 3000 for Docker)")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                }
                
                // App Information Section
                Section("App Information") {
                    HStack {
                        Text("Version")
                        Spacer()
                        Text(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0")
                            .foregroundColor(.secondary)
                    }
                    
                    HStack {
                        Text("Device")
                        Spacer()
                        Text(UIDevice.current.model)
                            .foregroundColor(.secondary)
                    }
                    
                    HStack {
                        Text("iOS Version")
                        Spacer()
                        Text(UIDevice.current.systemVersion)
                            .foregroundColor(.secondary)
                    }
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        loadCurrentSettings()
                        dismiss()
                    }
                }
                
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        saveSettings()
                        dismiss()
                    }
                    .fontWeight(.semibold)
                    .disabled(backendHost.isEmpty || backendPort.isEmpty)
                }
            }
        }
        .onAppear {
            loadCurrentSettings()
        }
    }
    
    private func loadCurrentSettings() {
        backendHost = backendComm.backendHost
        backendPort = String(backendComm.backendPort)
        backendProtocol = backendComm.backendProtocol
    }
    
    private func saveSettings() {
        // Validate inputs
        guard !backendHost.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let port = Int(backendPort.trimmingCharacters(in: .whitespacesAndNewlines)),
              port > 0 && port <= 65535 else {
            connectionTestResult = "Invalid host or port"
            return
        }
        
        // Update backend communicator
        backendComm.backendHost = backendHost.trimmingCharacters(in: .whitespacesAndNewlines)
        backendComm.backendPort = port
        backendComm.backendProtocol = backendProtocol
        
        // Save to persistent storage
        backendComm.saveSettings()
        
        // Test connection with new settings
        testConnection()
        
        connectionTestResult = "Settings saved successfully"
    }
    
    private func testConnection() {
        isTestingConnection = true
        connectionTestResult = "Testing connection..."
        
        // Update backend communicator with current form values
        if let port = Int(backendPort.trimmingCharacters(in: .whitespacesAndNewlines)) {
            let originalHost = backendComm.backendHost
            let originalPort = backendComm.backendPort
            let originalProtocol = backendComm.backendProtocol
            
            // Temporarily update for testing
            backendComm.backendHost = backendHost.trimmingCharacters(in: .whitespacesAndNewlines)
            backendComm.backendPort = port
            backendComm.backendProtocol = backendProtocol
            
            // Test connection
            backendComm.testConnection()
            
            // Wait for result and update UI
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                isTestingConnection = false
                
                if backendComm.isConnected {
                    connectionTestResult = "✅ Connection successful!"
                } else {
                    connectionTestResult = "❌ Connection failed: \(backendComm.lastError ?? "Unknown error")"
                    
                    // Restore original settings if test failed
                    backendComm.backendHost = originalHost
                    backendComm.backendPort = originalPort
                    backendComm.backendProtocol = originalProtocol
                }
            }
        } else {
            isTestingConnection = false
            connectionTestResult = "Invalid port number"
        }
    }
    
    private func resetToDefaults() {
        backendHost = ProcessInfo.processInfo.environment["BACKEND_HOST"] ?? "192.168.1.100"
        backendPort = ProcessInfo.processInfo.environment["BACKEND_PORT"] ?? "3000"
        backendProtocol = ProcessInfo.processInfo.environment["BACKEND_PROTOCOL"] ?? "http"
        connectionTestResult = "Reset to environment/default values"
    }
}

#Preview {
    SettingsView(backendComm: BackendCommunicator())
}
