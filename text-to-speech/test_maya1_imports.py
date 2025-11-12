#!/usr/bin/env python3
"""
Diagnostic script to test Maya1 TTS imports and initialization
Run this inside the TTS container to debug Maya1 issues
"""

import sys
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def test_imports():
    """Test all required imports for Maya1"""
    logger.info("🔍 Testing Maya1 TTS imports...")
    
    # Test 1: PyTorch
    try:
        import torch
        logger.info(f"✅ torch imported: {torch.__version__}")
        logger.info(f"   CUDA available: {torch.cuda.is_available()}")
        if torch.cuda.is_available():
            logger.info(f"   GPU: {torch.cuda.get_device_name(0)}")
            logger.info(f"   VRAM: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB")
    except ImportError as e:
        logger.error(f"❌ Failed to import torch: {e}")
        return False
    
    # Test 2: Transformers
    try:
        from transformers import AutoModelForCausalLM, AutoTokenizer
        import transformers
        logger.info(f"✅ transformers imported: {transformers.__version__}")
    except ImportError as e:
        logger.error(f"❌ Failed to import transformers: {e}")
        return False
    
    # Test 3: SNAC
    try:
        from snac import SNAC
        logger.info(f"✅ snac imported successfully")
    except ImportError as e:
        logger.error(f"❌ Failed to import snac: {e}")
        return False
    
    # Test 4: Soundfile
    try:
        import soundfile as sf
        logger.info(f"✅ soundfile imported successfully")
    except ImportError as e:
        logger.error(f"❌ Failed to import soundfile: {e}")
        return False
    
    logger.info("✅ All imports successful!")
    return True

def test_model_loading():
    """Test loading Maya1 model"""
    logger.info("\n🔍 Testing Maya1 model loading...")
    
    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
        
        logger.info("📥 Loading Maya1 model (this may take a moment)...")
        model = AutoModelForCausalLM.from_pretrained(
            "maya-research/maya1",
            torch_dtype=torch.bfloat16,
            device_map="auto",
            trust_remote_code=True
        )
        logger.info(f"✅ Maya1 model loaded successfully")
        logger.info(f"   Device: {next(model.parameters()).device}")
        
        logger.info("📥 Loading Maya1 tokenizer...")
        tokenizer = AutoTokenizer.from_pretrained(
            "maya-research/maya1",
            trust_remote_code=True
        )
        logger.info(f"✅ Maya1 tokenizer loaded successfully")
        
        return True
        
    except Exception as e:
        logger.error(f"❌ Failed to load Maya1 model: {e}")
        import traceback
        logger.error(f"   Traceback:\n{traceback.format_exc()}")
        return False

def test_snac_loading():
    """Test loading SNAC codec"""
    logger.info("\n🔍 Testing SNAC codec loading...")
    
    try:
        import torch
        from snac import SNAC
        
        logger.info("📥 Loading SNAC codec...")
        snac_model = SNAC.from_pretrained("hubertsiuzdak/snac_24khz").eval()
        
        if torch.cuda.is_available():
            snac_model = snac_model.to("cuda")
            logger.info(f"✅ SNAC codec loaded on GPU")
        else:
            logger.info(f"✅ SNAC codec loaded on CPU")
        
        return True
        
    except Exception as e:
        logger.error(f"❌ Failed to load SNAC codec: {e}")
        import traceback
        logger.error(f"   Traceback:\n{traceback.format_exc()}")
        return False

def test_synthesis():
    """Test full synthesis pipeline"""
    logger.info("\n🔍 Testing full Maya1 synthesis pipeline...")
    
    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
        from snac import SNAC
        import soundfile as sf
        import tempfile
        
        # Load models
        logger.info("📥 Loading models...")
        model = AutoModelForCausalLM.from_pretrained(
            "maya-research/maya1",
            torch_dtype=torch.bfloat16,
            device_map="auto",
            trust_remote_code=True
        )
        tokenizer = AutoTokenizer.from_pretrained(
            "maya-research/maya1",
            trust_remote_code=True
        )
        snac_model = SNAC.from_pretrained("hubertsiuzdak/snac_24khz").eval()
        if torch.cuda.is_available():
            snac_model = snac_model.to("cuda")
        
        # Test synthesis
        test_text = "Hello, this is a test of Maya1 text to speech."
        voice_description = "A clear, natural voice with balanced articulation"
        prompt = f'<description="{voice_description}"> {test_text}'
        
        logger.info(f"🎵 Synthesizing test text...")
        inputs = tokenizer(prompt, return_tensors="pt")
        if torch.cuda.is_available():
            inputs = {k: v.to("cuda") for k, v in inputs.items()}
        
        with torch.inference_mode():
            outputs = model.generate(
                **inputs,
                max_new_tokens=500,
                temperature=0.4,
                top_p=0.9,
                do_sample=True,
                pad_token_id=tokenizer.eos_token_id
            )
        
        generated_ids = outputs[0, inputs['input_ids'].shape[1]:]
        snac_tokens = [t.item() for t in generated_ids if 128266 <= t <= 156937]
        
        logger.info(f"   Generated {len(snac_tokens)} SNAC tokens")
        
        if len(snac_tokens) < 7:
            logger.error(f"❌ Insufficient SNAC tokens generated")
            return False
        
        # Decode to audio
        frames = len(snac_tokens) // 7
        codes = [[], [], []]
        
        for i in range(frames):
            frame_tokens = snac_tokens[i*7:(i+1)*7]
            codes[0].append((frame_tokens[0] - 128266) % 4096)
            codes[1].extend([
                (frame_tokens[1] - 128266) % 4096,
                (frame_tokens[4] - 128266) % 4096
            ])
            codes[2].extend([
                (frame_tokens[2] - 128266) % 4096,
                (frame_tokens[3] - 128266) % 4096,
                (frame_tokens[5] - 128266) % 4096,
                (frame_tokens[6] - 128266) % 4096
            ])
        
        device = "cuda" if torch.cuda.is_available() else "cpu"
        codes_tensor = [
            torch.tensor(c, dtype=torch.long, device=device).unsqueeze(0) 
            for c in codes
        ]
        
        with torch.inference_mode():
            audio_tensor = snac_model.decoder(
                snac_model.quantizer.from_codes(codes_tensor)
            )
            audio_np = audio_tensor[0, 0].cpu().numpy()
        
        logger.info(f"   Generated {len(audio_np)} audio samples")
        
        # Save test file
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
            sf.write(tmp_file.name, audio_np, 24000)
            logger.info(f"✅ Test synthesis successful: {tmp_file.name}")
            logger.info(f"   Duration: {len(audio_np) / 24000:.1f}s")
        
        return True
        
    except Exception as e:
        logger.error(f"❌ Full synthesis test failed: {e}")
        import traceback
        logger.error(f"   Traceback:\n{traceback.format_exc()}")
        return False

if __name__ == "__main__":
    logger.info("=" * 60)
    logger.info("Maya1 TTS Diagnostic Test")
    logger.info("=" * 60)
    
    # Test 1: Imports
    if not test_imports():
        logger.error("\n❌ Import test failed - fix dependencies first")
        sys.exit(1)
    
    # Test 2: Model loading
    if not test_model_loading():
        logger.error("\n❌ Model loading test failed - check HuggingFace connection")
        sys.exit(1)
    
    # Test 3: SNAC loading
    if not test_snac_loading():
        logger.error("\n❌ SNAC loading test failed")
        sys.exit(1)
    
    # Test 4: Full synthesis
    if not test_synthesis():
        logger.error("\n❌ Synthesis test failed")
        sys.exit(1)
    
    logger.info("\n" + "=" * 60)
    logger.info("✅ All tests passed! Maya1 TTS is working correctly.")
    logger.info("=" * 60)
    sys.exit(0)

