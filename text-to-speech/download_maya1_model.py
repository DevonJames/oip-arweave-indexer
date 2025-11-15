#!/usr/bin/env python3
"""
Download Maya1 TTS model and SNAC codec for GPU TTS service
Pre-downloads models during Docker build to avoid first-use delays
"""

import torch
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def download_maya1_models():
    """Download Maya1 TTS model and SNAC codec."""
    try:
        logger.info("🚀 Downloading Maya1 TTS model (3B parameters)...")
        logger.info("   This may take several minutes on first run...")
        
        # Check GPU availability
        # NOTE: GPU is NOT available during Docker build - this is expected!
        # GPU will be available at runtime when container starts with proper GPU configuration
        if torch.cuda.is_available():
            logger.info(f"   ✅ GPU detected during build: {torch.cuda.get_device_name(0)}")
            logger.info(f"   ✅ VRAM: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB")
        else:
            logger.info("   ℹ️ No GPU detected during build (this is expected - GPU not available during Docker build)")
            logger.info("   ℹ️ Models will download on CPU, but will use GPU at runtime if configured correctly")
        
        # Download Maya1 model and tokenizer
        try:
            from transformers import AutoModelForCausalLM, AutoTokenizer
            
            logger.info("📥 Downloading Maya1 transformer model...")
            model = AutoModelForCausalLM.from_pretrained(
                "maya-research/maya1",
                torch_dtype=torch.bfloat16,
                device_map="auto",
                trust_remote_code=True
            )
            
            logger.info("📥 Downloading Maya1 tokenizer...")
            tokenizer = AutoTokenizer.from_pretrained(
                "maya-research/maya1",
                trust_remote_code=True
            )
            
            logger.info("✅ Maya1 model and tokenizer downloaded successfully")
            logger.info(f"   Model parameters: ~3 billion")
            logger.info(f"   Model dtype: bfloat16")
            
        except Exception as e:
            logger.error(f"❌ Failed to download Maya1 model: {e}")
            logger.info("   Model will be downloaded on first use")
            return False
        
        # Download SNAC codec model
        try:
            logger.info("📥 Downloading SNAC codec (24kHz)...")
            
            # Import SNAC package
            try:
                from snac import SNAC
            except ImportError:
                logger.error("❌ SNAC package not installed - please install with: pip install snac")
                return False
            
            # Download SNAC 24kHz model
            snac_model = SNAC.from_pretrained("hubertsiuzdak/snac_24khz").eval()
            
            # Move to GPU if available
            if torch.cuda.is_available():
                snac_model = snac_model.to("cuda")
                logger.info("   SNAC codec loaded on GPU")
            else:
                logger.info("   SNAC codec loaded on CPU")
            
            logger.info("✅ SNAC codec downloaded successfully")
            logger.info(f"   Sample rate: 24kHz")
            logger.info(f"   Codec type: Neural audio codec")
            
        except Exception as e:
            logger.error(f"❌ Failed to download SNAC codec: {e}")
            logger.info("   Codec will be downloaded on first use")
            return False
        
        logger.info("🎉 All Maya1 TTS components downloaded successfully!")
        logger.info("   Maya1 is ready for use in GPU TTS service")
        
        return True
        
    except Exception as e:
        logger.error(f"⚠️ Failed to pre-load Maya1 models: {e}")
        logger.info("   Models will be downloaded on first use")
        return False

if __name__ == "__main__":
    success = download_maya1_models()
    if success:
        logger.info("✅ Maya1 model download completed successfully")
    else:
        logger.warning("⚠️ Maya1 model download had issues - will retry on first use")

