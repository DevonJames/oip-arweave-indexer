#!/usr/bin/env python3
"""
Standalone Maya1 TTS Service
Dedicated service for Maya1 TTS with PyTorch 2.1+ and SNAC codec
"""

import os
import tempfile
import logging
import torch
from typing import Optional
from fastapi import FastAPI, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
import numpy as np
import uvicorn
import time
import base64

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Import Maya1 dependencies
try:
    from transformers import AutoModelForCausalLM, AutoTokenizer
    logger.info("✅ transformers imported successfully")
    
    # Check PyTorch version
    torch_version = torch.__version__
    logger.info(f"   PyTorch version: {torch_version}")
    
    # Verify weight_norm is available (required by SNAC)
    try:
        from torch.nn.utils.parametrizations import weight_norm
        logger.info("✅ weight_norm available in torch.nn.utils.parametrizations")
    except ImportError:
        logger.error(f"❌ weight_norm not available - PyTorch {torch_version} incompatible")
        logger.error(f"   SNAC requires PyTorch >= 2.1.0")
        raise ImportError(f"PyTorch {torch_version} incompatible with SNAC")
    
    from snac import SNAC
    import soundfile as sf
    MAYA1_AVAILABLE = True
    logger.info("✅ Maya1 TTS dependencies imported successfully")
except ImportError as e:
    MAYA1_AVAILABLE = False
    logger.error(f"❌ Maya1 TTS not available: {e}")
    import traceback
    logger.error(f"   Traceback: {traceback.format_exc()}")
except Exception as e:
    MAYA1_AVAILABLE = False
    logger.error(f"❌ Error importing Maya1 TTS: {e}")
    import traceback
    logger.error(f"   Traceback: {traceback.format_exc()}")

app = FastAPI(title="Maya1 TTS Service", version="1.0.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class Maya1Service:
    def __init__(self):
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        self.model = None
        self.tokenizer = None
        self.snac = None
        self.voices = {}
        
        logger.info(f"Initializing Maya1 TTS service on device: {self.device}")
        self._initialize_maya1()
    
    def _initialize_maya1(self):
        """Initialize Maya1 TTS (3B parameter transformer with SNAC codec)"""
        if not MAYA1_AVAILABLE:
            logger.error("❌ Maya1 dependencies not available - check logs for import errors")
            return
        
        try:
            logger.info("🚀 Initializing Maya1 TTS (Maya Research - 3B params)...")
            
            # Load Maya1 transformer model
            logger.info("📥 Loading Maya1 model from maya-research/maya1...")
            self.model = AutoModelForCausalLM.from_pretrained(
                "maya-research/maya1",
                torch_dtype=torch.bfloat16,
                device_map="auto",
                trust_remote_code=True,
                low_cpu_mem_usage=True
            )
            logger.info(f"✅ Maya1 model loaded - Device: {next(self.model.parameters()).device}")
            
            # Load tokenizer
            logger.info("📥 Loading Maya1 tokenizer...")
            self.tokenizer = AutoTokenizer.from_pretrained(
                "maya-research/maya1",
                trust_remote_code=True
            )
            logger.info("✅ Maya1 tokenizer loaded")
            
            # Load SNAC codec
            logger.info("📥 Loading SNAC codec (24kHz neural audio codec)...")
            self.snac = SNAC.from_pretrained("hubertsiuzdak/snac_24khz").eval()
            
            # Move SNAC to GPU if available
            if torch.cuda.is_available():
                self.snac = self.snac.to("cuda")
                logger.info("   SNAC codec moved to GPU")
            
            logger.info("✅ SNAC codec loaded")
            
            # Define voice presets
            self.voices = {
                'female_expressive': {
                    'description': 'A warm, expressive female voice with clear articulation',
                    'emotion_tags': [],
                    'gender': 'female',
                    'style': 'expressive'
                },
                'female_calm': {
                    'description': 'A calm, soothing female voice with gentle tones',
                    'emotion_tags': [],
                    'gender': 'female',
                    'style': 'calm'
                },
                'male_expressive': {
                    'description': 'A clear, expressive male voice with good articulation',
                    'emotion_tags': [],
                    'gender': 'male',
                    'style': 'expressive'
                },
                'male_calm': {
                    'description': 'A deep, calm male voice with measured pacing',
                    'emotion_tags': [],
                    'gender': 'male',
                    'style': 'calm'
                },
                'female_cheerful': {
                    'description': 'An upbeat, cheerful female voice with positive energy',
                    'emotion_tags': ['<laugh>'],
                    'gender': 'female',
                    'style': 'cheerful'
                },
                'male_professional': {
                    'description': 'A professional, authoritative male voice',
                    'emotion_tags': [],
                    'gender': 'male',
                    'style': 'professional'
                },
                'default': {
                    'description': 'A clear, natural voice with balanced articulation',
                    'emotion_tags': [],
                    'gender': 'neutral',
                    'style': 'neutral'
                }
            }
            
            logger.info("✅ Maya1 TTS initialized successfully")
            logger.info(f"   Model: maya-research/maya1 (3B parameters)")
            logger.info(f"   Codec: SNAC 24kHz")
            logger.info(f"   Device: {next(self.model.parameters()).device}")
            logger.info(f"   Available voices: {list(self.voices.keys())}")
            
        except Exception as e:
            logger.error(f"❌ Failed to initialize Maya1 TTS: {str(e)}")
            import traceback
            logger.error(f"   Traceback: {traceback.format_exc()}")
            self.model = None
            self.tokenizer = None
            self.snac = None
    
    async def synthesize(self, text: str, voice: str = "default") -> Optional[str]:
        """Synthesize speech using Maya1 TTS with SNAC codec"""
        if not self.model or not self.tokenizer or not self.snac:
            logger.warning("Maya1 TTS not available - model, tokenizer, or codec missing")
            return None
        
        try:
            # Get voice configuration
            voice_config = self.voices.get(voice, self.voices.get('default'))
            voice_description = voice_config['description']
            emotion_tags = voice_config.get('emotion_tags', [])
            
            logger.info(f"🎵 Maya1 TTS: voice={voice}, description='{voice_description}'")
            
            # Build prompt with voice description and optional emotion tags
            emotion_tag_str = ' '.join(emotion_tags) if emotion_tags else ''
            prompt = f'<description="{voice_description}"> {emotion_tag_str} {text}'
            
            # Tokenize input
            inputs = self.tokenizer(prompt, return_tensors="pt")
            
            # Move to GPU if available
            if torch.cuda.is_available():
                inputs = {k: v.to("cuda") for k, v in inputs.items()}
            
            # Generate SNAC tokens
            with torch.inference_mode():
                outputs = self.model.generate(
                    **inputs,
                    max_new_tokens=500,
                    temperature=0.4,
                    top_p=0.9,
                    do_sample=True,
                    pad_token_id=self.tokenizer.eos_token_id
                )
            
            # Extract generated tokens
            generated_ids = outputs[0, inputs['input_ids'].shape[1]:]
            
            # Filter SNAC tokens (range: 128266 to 156937)
            snac_tokens = [t.item() for t in generated_ids if 128266 <= t <= 156937]
            
            logger.info(f"   Generated {len(snac_tokens)} SNAC tokens")
            
            if len(snac_tokens) < 7:
                logger.warning("   Insufficient SNAC tokens generated")
                return None
            
            # Decode SNAC tokens to audio codes
            frames = len(snac_tokens) // 7
            codes = [[], [], []]  # 3 layers
            
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
            
            # Convert codes to tensors
            device = "cuda" if torch.cuda.is_available() else "cpu"
            codes_tensor = [
                torch.tensor(c, dtype=torch.long, device=device).unsqueeze(0) 
                for c in codes
            ]
            
            # Decode to audio using SNAC codec
            with torch.inference_mode():
                audio_tensor = self.snac.decoder(
                    self.snac.quantizer.from_codes(codes_tensor)
                )
                audio_np = audio_tensor[0, 0].cpu().numpy()
            
            # Save to temporary WAV file
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
                sf.write(tmp_file.name, audio_np, 24000)  # 24kHz
                
                duration = len(audio_np) / 24000
                file_size = os.path.getsize(tmp_file.name)
                logger.info(f"✅ Maya1 synthesis successful: {duration:.1f}s audio, {file_size} bytes")
                return tmp_file.name
                
        except Exception as e:
            logger.error(f"❌ Maya1 TTS error: {e}")
            import traceback
            logger.error(f"   Traceback: {traceback.format_exc()}")
            return None

# Initialize service
maya1_service = Maya1Service()

@app.post("/synthesize")
async def synthesize_speech(
    text: str = Form(...),
    voice: str = Form("default")
):
    """Synthesize text to speech using Maya1"""
    if not text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")
    
    if maya1_service.model is None:
        raise HTTPException(status_code=503, detail="Maya1 TTS service not available - check logs")
    
    start_time = time.time()
    
    try:
        audio_file = await maya1_service.synthesize(text, voice)
        
        if audio_file and os.path.exists(audio_file):
            # Read audio file
            with open(audio_file, 'rb') as f:
                audio_data = f.read()
            
            # Clean up
            try:
                os.unlink(audio_file)
            except:
                pass
            
            # Return base64 encoded audio
            audio_base64 = base64.b64encode(audio_data).decode('utf-8')
            
            return {
                "audio_data": audio_base64,
                "engine": "maya1",
                "voice": voice,
                "processing_time_ms": int((time.time() - start_time) * 1000)
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to generate audio")
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.get("/voices")
async def get_voices():
    """Get available Maya1 voices"""
    voices = []
    for voice_id, voice_config in maya1_service.voices.items():
        voices.append({
            "id": voice_id,
            "name": f"Maya1 {voice_id.replace('_', ' ').title()}",
            "engine": "maya1",
            "gender": voice_config.get('gender', 'neutral'),
            "description": voice_config.get('description', ''),
            "quality": "very_high",
            "gpu_accelerated": True
        })
    
    return {"voices": voices}

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    gpu_info = {}
    if torch.cuda.is_available():
        gpu_info = {
            "gpu_available": True,
            "gpu_name": torch.cuda.get_device_name(0),
            "gpu_memory_gb": round(torch.cuda.get_device_properties(0).total_memory / 1024**3, 1),
            "cuda_version": torch.version.cuda if torch.version.cuda else "unknown"
        }
    else:
        gpu_info = {"gpu_available": False}
    
    return {
        "status": "healthy" if maya1_service.model is not None else "unavailable",
        "device": str(maya1_service.device),
        "maya1_available": maya1_service.model is not None,
        "model": "maya-research/maya1 (3B parameters)" if maya1_service.model else None,
        "codec": "SNAC 24kHz" if maya1_service.snac else None,
        "voices": list(maya1_service.voices.keys()) if maya1_service.voices else [],
        "gpu_info": gpu_info
    }

if __name__ == "__main__":
    port = int(os.getenv("MAYA1_SERVICE_PORT", "5003"))
    logger.info(f"Starting Maya1 TTS Service on port {port}")
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=port,
        log_level="info"
    )

