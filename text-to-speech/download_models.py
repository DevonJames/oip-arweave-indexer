#!/usr/bin/env python3

import torch
import torchaudio

def download_silero_models():
    """Download Silero TTS models for GPU acceleration."""
    try:
        print("Downloading Silero TTS models...")
        
        # Download Silero TTS models
        model, example_text = torch.hub.load(
            repo_or_dir='snakers4/silero-models', 
            model='silero_tts', 
            language='en', 
            speaker='v3_en'
        )
        
        print("✅ GPU TTS models pre-loaded successfully")
        return True
        
    except Exception as e:
        print(f"⚠️ Failed to pre-load models: {e}")
        print("Models will be downloaded on first use")
        return False

if __name__ == "__main__":
    download_silero_models() 