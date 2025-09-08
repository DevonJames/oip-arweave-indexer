#!/usr/bin/env python3
"""
Silero VAD Model Download Script
Downloads the Silero VAD model for offline use
"""

import os
import torch
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def download_silero_vad():
    """Download Silero VAD model for offline use."""
    try:
        logger.info("Downloading Silero VAD model...")
        
        # Download the model
        model, utils = torch.hub.load(
            repo_or_dir='snakers4/silero-vad',
            model='silero_vad',
            force_reload=True,
            onnx=False
        )
        
        # Save the model locally
        model_path = '/app/models/silero_vad/model.pt'
        os.makedirs(os.path.dirname(model_path), exist_ok=True)
        
        torch.save(model.state_dict(), model_path)
        logger.info(f"Silero VAD model saved to: {model_path}")
        
        # Also save the utils
        utils_path = '/app/models/silero_vad/utils.pt'
        torch.save(utils, utils_path)
        logger.info(f"Silero VAD utils saved to: {utils_path}")
        
        return True
        
    except Exception as e:
        logger.error(f"Failed to download Silero VAD model: {e}")
        return False

if __name__ == "__main__":
    success = download_silero_vad()
    if success:
        print("✅ Silero VAD model downloaded successfully")
    else:
        print("❌ Failed to download Silero VAD model")
        exit(1)
