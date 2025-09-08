#!/usr/bin/env python3
"""
Simple script to start just the unified voice processor for testing
"""

import sys
import os

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Import and run the unified voice processor
if __name__ == "__main__":
    print("🚀 Starting Unified Voice Processor with CORS support...")
    print("Port: 8015")
    print("CORS: Enabled for localhost:3001")
    print("Models: MLX Whisper + Silero VAD")
    print("=" * 50)
    
    # Import the app from unified_voice_processor
    from unified_voice_processor import app
    import uvicorn
    
    # Run the server
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8015,
        log_level="info"
    )
