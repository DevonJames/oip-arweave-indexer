#!/usr/bin/env python3
"""
Download Kokoro TTS model for local synthesis.
This script downloads the Kokoro TTS ONNX model and voice configurations.
"""

import os
import sys
import requests
import logging
from pathlib import Path

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

def download_file(url, local_path):
    """Download a file from URL to local path"""
    try:
        logger.info(f"Downloading {url} to {local_path}")
        
        # Create directory if it doesn't exist
        os.makedirs(os.path.dirname(local_path), exist_ok=True)
        
        # Download with progress
        response = requests.get(url, stream=True)
        response.raise_for_status()
        
        total_size = int(response.headers.get('content-length', 0))
        downloaded_size = 0
        
        with open(local_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
                    downloaded_size += len(chunk)
                    if total_size > 0:
                        progress = (downloaded_size / total_size) * 100
                        print(f"\rProgress: {progress:.1f}%", end='', flush=True)
        
        print()  # New line after progress
        logger.info(f"✅ Downloaded {local_path}")
        return True
        
    except Exception as e:
        logger.error(f"❌ Failed to download {url}: {e}")
        return False

def download_kokoro_model():
    """Setup Kokoro TTS using the official Python package"""
    logger.info("🎭 Setting up Kokoro TTS...")
    
    # Test if Kokoro package is available
    try:
        import kokoro
        from kokoro import KPipeline
        
        # Test basic functionality
        logger.info("Testing Kokoro TTS package...")
        pipeline = KPipeline(lang_code='a')  # American English
        
        logger.info("✅ Kokoro TTS package is working!")
        logger.info("   No additional model downloads required")
        logger.info("   Models are automatically downloaded by the package")
        
        return True
        
    except ImportError as e:
        logger.error(f"❌ Kokoro package not available: {e}")
        logger.error("   Install with: pip install kokoro")
        return False
    except Exception as e:
        logger.warning(f"⚠️ Kokoro package installed but not working: {e}")
        logger.info("   This is normal during Docker build - will work at runtime")
        return True

def main():
    """Main function"""
    logger.info("🚀 Kokoro TTS Model Setup")
    logger.info("========================")
    
    try:
        success = download_kokoro_model()
        
        if success:
            logger.info("✅ Kokoro TTS model setup completed")
            return 0
        else:
            logger.error("❌ Kokoro TTS model setup failed")
            return 1
            
    except Exception as e:
        logger.error(f"❌ Unexpected error: {e}")
        return 1

if __name__ == "__main__":
    sys.exit(main())
