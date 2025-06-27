#!/usr/bin/env python3

import torch
import torchaudio

def download_silero_models():
    """Download Silero TTS models for GPU acceleration."""
    try:
        print("🚀 Downloading Silero Neural TTS models...")
        
        # Download Silero TTS models with correct API
        model, symbols, sample_rate, example_text, apply_tts = torch.hub.load(
            repo_or_dir='snakers4/silero-models', 
            model='silero_tts', 
            language='en', 
            speaker='v3_en',
            trust_repo=True
        )
        
        print(f"✅ Silero Neural TTS models downloaded successfully")
        print(f"   Sample rate: {sample_rate}Hz")
        print(f"   Available voices: en_0, en_1, en_2, en_3")
        print(f"   GPU support: {torch.cuda.is_available()}")
        
        # Test synthesis to ensure everything works
        if torch.cuda.is_available():
            model = model.cuda()
            print("   GPU acceleration enabled")
        
        return True
        
    except Exception as e:
        print(f"⚠️ Failed to pre-load Silero models: {e}")
        print("   Models will be downloaded on first use")
        return False

if __name__ == "__main__":
    download_silero_models() 