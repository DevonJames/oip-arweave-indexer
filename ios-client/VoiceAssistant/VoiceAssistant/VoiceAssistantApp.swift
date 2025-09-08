import SwiftUI

@main
struct VoiceAssistantApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.none) // Support both light and dark mode
        }
    }
}
