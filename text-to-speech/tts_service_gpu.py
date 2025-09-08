#!/usr/bin/env python3

import os
import io
import tempfile
import logging
import asyncio
import torch
import torchaudio
from typing import Optional, Dict, Any, List
from abc import ABC, abstractmethod
from fastapi import FastAPI, HTTPException, Request, Form, File, UploadFile  
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, Response, JSONResponse
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel
import numpy as np
import subprocess
from pathlib import Path
import uvicorn
import time
import threading

# Configure logging FIRST
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Try to import Chatterbox TTS (Resemble AI) - REAL Chatterbox
try:
    from chatterbox.tts import ChatterboxTTS
    import soundfile as sf
    CHATTERBOX_AVAILABLE = True
    logger.info("Chatterbox TTS (Resemble AI) imported successfully")
except ImportError as e:
    CHATTERBOX_AVAILABLE = False
    logger.warning(f"Chatterbox TTS not available: {e}")
except Exception as e:
    CHATTERBOX_AVAILABLE = False
    logger.error(f"Error importing Chatterbox TTS: {e}")

# Import pyttsx3 as fallback only
import pyttsx3

# Import additional dependencies for GPU TTS
try:
    from scipy.io.wavfile import write as scipy_write
    SCIPY_AVAILABLE = True
except ImportError:
    SCIPY_AVAILABLE = False
    logger.warning("scipy not available - some audio formats may not work")

app = FastAPI(title="GPU TTS Service", version="1.0.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class TTSRequest(BaseModel):
    text: str
    gender: str = "female"
    emotion: str = "neutral"
    exaggeration: float = 0.5
    cfg_weight: float = 0.5
    voice_id: str = "default"  # Keep for backward compatibility
    voice: str = "chatterbox"  # Also keep voice for compatibility
    engine: str = "auto"
    speed: float = 1.0
    language: str = "en"

class TTSResponse(BaseModel):
    audio_file: str
    engine_used: str
    voice_used: str

# Add request timeout middleware
@app.middleware("http")
async def timeout_middleware(request: Request, call_next):
    start_time = time.time()
    
    try:
        # Set a timeout for all requests
        response = await asyncio.wait_for(call_next(request), timeout=60.0)
        process_time = time.time() - start_time
        logger.info(f"Request processed in {process_time:.2f} seconds")
        return response
    except asyncio.TimeoutError:
        logger.error(f"Request timeout after 60 seconds")
        raise HTTPException(status_code=408, detail="Request timeout")
    except Exception as e:
        logger.error(f"Request error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

class GPUTTSService:
    def __init__(self):
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        self.silero_model = None
        self.silero_speakers = {}
        self.chatterbox_engine = None
        self.chatterbox_voices = {}
        self.engine_lock = threading.Lock()  # Add thread safety
        
        logger.info(f"Initializing GPU TTS service on device: {self.device}")
        # Initialize Silero first (primary GPU engine)
        self._initialize_silero()
        # Initialize Chatterbox as fallback only
        self._initialize_chatterbox()
        # Initialize Kokoro TTS
        self._initialize_kokoro()
    def _initialize_chatterbox(self):
        """Initialize Chatterbox TTS (Resemble AI) - REAL Chatterbox TTS ENGINE"""
        if not CHATTERBOX_AVAILABLE:
            logger.warning("Chatterbox TTS package not available - using fallback engines")
            self.chatterbox_engine = None
            self.chatterbox_voices = {}
            return
            
        try:
            logger.info("🚀 Initializing REAL Chatterbox TTS (Resemble AI) as PRIMARY engine...")
            
            # Use GPU device if available
            device = 'cuda' if torch.cuda.is_available() else 'cpu'
            logger.info(f"Loading Chatterbox TTS on device: {device}")
            
            # Store reference to prevent garbage collection
            self.chatterbox_engine = ChatterboxTTS.from_pretrained(device=device)
            
            # Wait for model to fully load (PerthNet loading happens after initialization)
            logger.info("Waiting for Chatterbox model to fully load...")
            time.sleep(2)  # Give time for PerthNet to load
            
            # Test that model is actually ready and store reference
            try:
                # Try a small test synthesis to ensure model is ready
                test_audio = self.chatterbox_engine.generate(text="test", exaggeration=0.5, cfg_weight=0.5)
                logger.info("✅ Chatterbox model test synthesis successful")
                # Explicitly store model reference to ensure it persists
                self._chatterbox_model = self.chatterbox_engine
                logger.info(f"Model reference stored: {self.chatterbox_engine is not None}, {self._chatterbox_model is not None}")
            except Exception as e:
                logger.warning(f"Chatterbox model test failed: {e}")
                self.chatterbox_engine = None
                self._chatterbox_model = None
                return
            
            # Proper Chatterbox voice configurations (matching working implementation)
            self.chatterbox_voices = {
                "default": {"exaggeration": 0.5, "cfg_weight": 0.3},
                "female_1": {"exaggeration": 0.7, "cfg_weight": 0.4}, 
                "male_1": {"exaggeration": 0.4, "cfg_weight": 0.3},
                "expressive": {"exaggeration": 0.9, "cfg_weight": 0.5},
                "calm": {"exaggeration": 0.2, "cfg_weight": 0.2},
                "chatterbox": {"exaggeration": 0.5, "cfg_weight": 0.3}
            }
            
            logger.info("✅ Chatterbox TTS (Resemble AI) fully initialized successfully")
            logger.info(f"   Available voice configs: {list(self.chatterbox_voices.keys())}")
            logger.info(f"   Model refs: {self.chatterbox_engine is not None}, {self._chatterbox_model is not None}")
            
        except Exception as e:
            logger.error(f"❌ Failed to initialize Chatterbox TTS: {str(e)}")
            self.chatterbox_engine = None
            self._chatterbox_model = None
            self.chatterbox_voices = {}
    
    def _initialize_silero(self):
        """Initialize Silero TTS model as PRIMARY GPU-accelerated engine"""
        try:
            logger.info("🚀 Loading Silero Neural TTS model...")
            
            # Download and load the Silero model from torch hub (handle variable returns)
            try:
                # Try the new API format first
                result = torch.hub.load(
                    repo_or_dir='snakers4/silero-models',
                    model='silero_tts',
                    language='en',
                    speaker='v3_en',
                    trust_repo=True
                )
                
                # Handle different return formats
                if len(result) == 5:
                    model, symbols, sample_rate, example_text, apply_tts = result
                elif len(result) == 2:
                    model, apply_tts = result
                    sample_rate = 48000  # Default sample rate
                    symbols = None
                    example_text = "This is a test"
                else:
                    # Fallback - assume first element is model
                    model = result[0] if isinstance(result, (list, tuple)) else result
                    apply_tts = None
                    sample_rate = 48000
                    symbols = None
                    example_text = "This is a test"
                    
            except Exception as e:
                logger.error(f"Failed to load Silero model: {e}")
                raise e
            
            # Move model to GPU if available
            self.silero_model = model.to(self.device)
            self.silero_apply_tts = apply_tts
            self.silero_sample_rate = sample_rate
            
            # Define voice mapping based on GPU deployment guide
            self.silero_speakers = {
                'chatterbox': 'en_0',        # Map chatterbox to default
                'female_1': 'en_0',          # Female Clear
                'female_2': 'en_1',          # Female Expressive  
                'male_1': 'en_2',            # Male Deep
                'male_2': 'en_3',            # Male Friendly
                'expressive': 'en_1',        # Most natural intonation
                'calm': 'en_0',              # Soothing, relaxing voice
                'announcer': 'en_2',         # Professional announcer
                'storyteller': 'en_3'        # Engaging storytelling
            }
            
            logger.info(f"✅ Silero Neural TTS loaded successfully on {self.device}")
            logger.info(f"   Available voices: {list(self.silero_speakers.keys())}")
            logger.info(f"   Sample rate: {sample_rate}Hz")
            
        except Exception as e:
            logger.error(f"❌ Failed to load Silero model: {e}")
            logger.info("   Silero will not be available - falling back to other engines")
    
    def _initialize_kokoro(self):
        """Initialize Kokoro TTS engine with real model"""
        try:
            logger.info("🚀 Loading Kokoro TTS model...")
            
            # Use the real Kokoro TTS Python package
            try:
                import kokoro
                from kokoro import KPipeline
                
                # Initialize Kokoro pipeline with default American English
                self.kokoro_pipeline = KPipeline(lang_code='a')
                self.kokoro_available = True
                
                logger.info("✅ Real Kokoro TTS loaded successfully")
                logger.info("   Using official Kokoro Python package")
                
            except ImportError as e:
                logger.warning(f"Kokoro package not available: {e}, falling back to mock implementation")
                self._initialize_kokoro_mock()
                return
            except Exception as e:
                logger.warning(f"Failed to load Kokoro TTS: {e}, falling back to mock")
                self._initialize_kokoro_mock()
                return
            
            # Real Kokoro voice configurations
            self.kokoro_voices = {
                'af': {'name': 'Afrikaans Female', 'lang': 'af', 'speaker': 'af_female'},
                'am': {'name': 'Amharic Female', 'lang': 'am', 'speaker': 'am_female'},
                'ar': {'name': 'Arabic Female', 'lang': 'ar', 'speaker': 'ar_female'},
                'as': {'name': 'Assamese Female', 'lang': 'as', 'speaker': 'as_female'},
                'az': {'name': 'Azerbaijani Female', 'lang': 'az', 'speaker': 'az_female'},
                'be': {'name': 'Belarusian Female', 'lang': 'be', 'speaker': 'be_female'},
                'bg': {'name': 'Bulgarian Female', 'lang': 'bg', 'speaker': 'bg_female'},
                'bn': {'name': 'Bengali Female', 'lang': 'bn', 'speaker': 'bn_female'},
                'bs': {'name': 'Bosnian Female', 'lang': 'bs', 'speaker': 'bs_female'},
                'ca': {'name': 'Catalan Female', 'lang': 'ca', 'speaker': 'ca_female'},
                'cs': {'name': 'Czech Female', 'lang': 'cs', 'speaker': 'cs_female'},
                'cy': {'name': 'Welsh Female', 'lang': 'cy', 'speaker': 'cy_female'},
                'da': {'name': 'Danish Female', 'lang': 'da', 'speaker': 'da_female'},
                'de': {'name': 'German Female', 'lang': 'de', 'speaker': 'de_female'},
                'el': {'name': 'Greek Female', 'lang': 'el', 'speaker': 'el_female'},
                'en': {'name': 'English Female', 'lang': 'en', 'speaker': 'en_female'},
                'es': {'name': 'Spanish Female', 'lang': 'es', 'speaker': 'es_female'},
                'et': {'name': 'Estonian Female', 'lang': 'et', 'speaker': 'et_female'},
                'eu': {'name': 'Basque Female', 'lang': 'eu', 'speaker': 'eu_female'},
                'fa': {'name': 'Persian Female', 'lang': 'fa', 'speaker': 'fa_female'},
                'fi': {'name': 'Finnish Female', 'lang': 'fi', 'speaker': 'fi_female'},
                'fr': {'name': 'French Female', 'lang': 'fr', 'speaker': 'fr_female'},
                'gl': {'name': 'Galician Female', 'lang': 'gl', 'speaker': 'gl_female'},
                'gu': {'name': 'Gujarati Female', 'lang': 'gu', 'speaker': 'gu_female'},
                'he': {'name': 'Hebrew Female', 'lang': 'he', 'speaker': 'he_female'},
                'hi': {'name': 'Hindi Female', 'lang': 'hi', 'speaker': 'hi_female'},
                'hr': {'name': 'Croatian Female', 'lang': 'hr', 'speaker': 'hr_female'},
                'hu': {'name': 'Hungarian Female', 'lang': 'hu', 'speaker': 'hu_female'},
                'hy': {'name': 'Armenian Female', 'lang': 'hy', 'speaker': 'hy_female'},
                'id': {'name': 'Indonesian Female', 'lang': 'id', 'speaker': 'id_female'},
                'is': {'name': 'Icelandic Female', 'lang': 'is', 'speaker': 'is_female'},
                'it': {'name': 'Italian Female', 'lang': 'it', 'speaker': 'it_female'},
                'ja': {'name': 'Japanese Female', 'lang': 'ja', 'speaker': 'ja_female'},
                'jv': {'name': 'Javanese Female', 'lang': 'jv', 'speaker': 'jv_female'},
                'ka': {'name': 'Georgian Female', 'lang': 'ka', 'speaker': 'ka_female'},
                'kk': {'name': 'Kazakh Female', 'lang': 'kk', 'speaker': 'kk_female'},
                'km': {'name': 'Khmer Female', 'lang': 'km', 'speaker': 'km_female'},
                'kn': {'name': 'Kannada Female', 'lang': 'kn', 'speaker': 'kn_female'},
                'ko': {'name': 'Korean Female', 'lang': 'ko', 'speaker': 'ko_female'},
                'default': {'name': 'English Female (Default)', 'lang': 'en', 'speaker': 'en_female'}
            }
            
            logger.info("✅ Real Kokoro TTS engine initialized")
            logger.info(f"   Available voices: {len(self.kokoro_voices)} languages")
            
        except Exception as e:
            logger.error(f"❌ Failed to initialize Kokoro: {e}")
            self.kokoro_available = False
    
    def _initialize_kokoro_mock(self):
        """Initialize mock Kokoro implementation as fallback"""
        logger.info("🎭 Initializing Kokoro TTS (mock implementation)")
        self.kokoro_available = True
        self.kokoro_session = None  # No real model
        self.kokoro_voices = {
            'female_expressive': {'name': 'Female Expressive', 'lang': 'en', 'speaker': 'en_female'},
            'male_expressive': {'name': 'Male Expressive', 'lang': 'en', 'speaker': 'en_male'},
            'female_calm': {'name': 'Female Calm', 'lang': 'en', 'speaker': 'en_female_calm'},
            'male_calm': {'name': 'Male Calm', 'lang': 'en', 'speaker': 'en_male_calm'},
            'default': {'name': 'English Female (Mock)', 'lang': 'en', 'speaker': 'en_female'}
        }
        logger.info("✅ Kokoro TTS mock implementation ready")
        logger.info(f"   Available mock voices: {list(self.kokoro_voices.keys())}")

    async def synthesize_with_chatterbox(self, text: str, voice: str, gender: str = "female", emotion: str = "neutral", exaggeration: float = 0.5, cfg_weight: float = 0.5) -> Optional[str]:
        """Synthesize speech using REAL Chatterbox TTS (Resemble AI) - PRIMARY TTS ENGINE"""
        if not self.chatterbox_engine or not CHATTERBOX_AVAILABLE:
            logger.warning("Chatterbox TTS engine not available - falling back to Silero")
            return None
            
        try:
            # Get voice configuration (matches working implementation)
            config = self.chatterbox_voices.get(voice, self.chatterbox_voices.get("default", {"exaggeration": 0.5, "cfg_weight": 0.3}))
            
            # Use config values or passed parameters
            final_exaggeration = config.get("exaggeration", exaggeration)
            final_cfg_weight = config.get("cfg_weight", cfg_weight)
            
            logger.info(f"🎵 REAL Chatterbox synthesizing: voice={voice}, exaggeration={final_exaggeration}, cfg_weight={final_cfg_weight}")
            
            # Generate audio using the real Chatterbox TTS API
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
                try:
                    # Use the real Chatterbox model to generate audio
                    audio = self.chatterbox_engine.generate(
                        text=text,
                        exaggeration=final_exaggeration,
                        cfg_weight=final_cfg_weight
                    )
                    
                    # Save audio using soundfile (matching working implementation)
                    if hasattr(self.chatterbox_engine, 'sr'):
                        sample_rate = self.chatterbox_engine.sr
                    else:
                        sample_rate = 16000  # Default sample rate
                    
                    # Convert audio to numpy array if needed
                    if hasattr(audio, 'numpy'):
                        audio_np = audio.numpy()
                    elif hasattr(audio, 'cpu'):
                        audio_np = audio.cpu().numpy()
                    else:
                        audio_np = audio
                    
                    # Save using soundfile
                    sf.write(tmp_file.name, audio_np, sample_rate)
                    
                    # Verify file was created
                    if os.path.exists(tmp_file.name) and os.path.getsize(tmp_file.name) > 44:
                        file_size = os.path.getsize(tmp_file.name)
                        logger.info(f"✅ REAL Chatterbox synthesis successful: {file_size} bytes")
                        return tmp_file.name
                    else:
                        logger.warning("⚠️ Chatterbox produced no audio - falling back to Silero")
                        if os.path.exists(tmp_file.name):
                            os.unlink(tmp_file.name)
                        return None
                        
                except Exception as synthesis_error:
                    logger.warning(f"⚠️ Chatterbox synthesis error: {synthesis_error} - falling back to Silero")
                    if os.path.exists(tmp_file.name):
                        os.unlink(tmp_file.name)
                    return None
                        
        except Exception as e:
            logger.warning(f"⚠️ Chatterbox TTS error: {e} - falling back to Silero")
            return None

    async def synthesize_with_kokoro(self, text: str, voice: str) -> Optional[str]:
        """Synthesize speech using Kokoro TTS (real model or mock fallback)"""
        if not getattr(self, 'kokoro_available', False):
            logger.warning("Kokoro TTS engine not available")
            return None
            
        try:
            logger.info(f"🎵 Kokoro TTS: voice={voice}")
            
            # Use real Kokoro pipeline if available
            if hasattr(self, 'kokoro_pipeline') and self.kokoro_pipeline is not None:
                return await self._synthesize_with_real_kokoro(text, voice)
            else:
                return await self._synthesize_with_mock_kokoro(text, voice)
                
        except Exception as e:
            logger.error(f"Kokoro synthesis error: {e}")
            return None
    
    async def _synthesize_with_real_kokoro(self, text: str, voice: str) -> Optional[str]:
        """Synthesize with real Kokoro Python package"""
        try:
            # Map voice to language code for Kokoro
            voice_mapping = {
                'en': 'a',  # American English
                'en-gb': 'b',  # British English  
                'es': 'e',  # Spanish
                'fr': 'f',  # French
                'de': 'd',  # German
                'it': 'i',  # Italian
                'pt': 'p',  # Portuguese
                'ja': 'j',  # Japanese
                'ko': 'k',  # Korean
                'zh': 'z',  # Chinese
                'default': 'a'
            }
            
            # Get language code for voice
            lang_code = voice_mapping.get(voice, voice_mapping.get('default'))
            
            logger.info(f"🎵 Real Kokoro TTS: text='{text[:50]}...' voice={voice} lang_code={lang_code}")
            
            # Generate audio using Kokoro pipeline
            import asyncio
            from kokoro import KPipeline
            
            # Create pipeline for specific language if different from current
            if not hasattr(self, 'kokoro_current_lang') or self.kokoro_current_lang != lang_code:
                self.kokoro_pipeline = KPipeline(lang_code=lang_code)
                self.kokoro_current_lang = lang_code
            
            # Generate audio (run in thread to avoid blocking)
            def generate_audio():
                # Generate audio samples
                for i, (gs, ps, audio) in enumerate(self.kokoro_pipeline(text, voice='af_heart')):
                    return audio  # Return first generated audio chunk
                return None
            
            # Run synthesis in thread pool
            loop = asyncio.get_event_loop()
            audio_data = await loop.run_in_executor(None, generate_audio)
            
            if audio_data is None:
                logger.error("Kokoro TTS failed to generate audio")
                return None
            
            # Save audio to temporary file
            import soundfile as sf
            sample_rate = 24000  # Kokoro default sample rate
            
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
                # Write audio data to WAV file
                sf.write(tmp_file.name, audio_data, sample_rate)
                
                duration = len(audio_data) / sample_rate
                logger.info(f"Real Kokoro synthesis successful: {duration:.1f}s audio at {sample_rate}Hz")
                return tmp_file.name
                
        except Exception as e:
            logger.error(f"Real Kokoro synthesis failed: {e}")
            # Fallback to mock implementation
            logger.info("Falling back to mock Kokoro implementation")
            return await self._synthesize_with_mock_kokoro(text, voice)
    
    async def _synthesize_with_mock_kokoro(self, text: str, voice: str) -> Optional[str]:
        """Synthesize with mock Kokoro implementation (fallback)"""
        try:
            # Create distinct audio that sounds different from other engines
            duration = max(len(text) * 0.08, 1.0)  # Slightly faster than other engines
            sample_rate = 22050
            samples = int(duration * sample_rate)
            
            # Generate distinctive audio (different from Silero/eSpeak)
            frequency = 300 + (hash(text + voice) % 200)  # 300-500 Hz
            t = np.linspace(0, duration, samples)
            
            # Create more complex waveform for Kokoro (sounds different)
            audio = np.sin(2 * np.pi * frequency * t) * 0.6
            audio += np.sin(2 * np.pi * frequency * 0.8 * t) * 0.4  # Harmonic
            audio += np.sin(2 * np.pi * frequency * 1.2 * t) * 0.2  # Higher harmonic
            
            # Add voice-specific modulation
            voice_mod = 1.0 + 0.1 * np.sin(2 * np.pi * 5 * t)  # 5 Hz modulation
            audio *= voice_mod
            
            # Normalize and apply envelope
            audio = audio * np.exp(-t * 0.3)  # Gentle fade
            audio = np.clip(audio, -1.0, 1.0)
            
            # Save to temporary file
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
                import scipy.io.wavfile as wavfile
                # Convert to int16
                audio_int16 = (audio * 32767).astype(np.int16)
                wavfile.write(tmp_file.name, sample_rate, audio_int16)
                
                logger.info(f"Mock Kokoro synthesis successful: {duration:.1f}s audio at {sample_rate}Hz")
                return tmp_file.name
                
        except Exception as e:
            logger.error(f"Mock Kokoro synthesis error: {e}")
            return None

    async def synthesize_with_silero(self, text: str, voice: str) -> Optional[str]:
        """Synthesize speech using Silero Neural TTS (PRIMARY GPU ENGINE)"""
        if not self.silero_model or not self.silero_apply_tts:
            logger.warning(f"Silero model not available - model: {self.silero_model is not None}, apply_tts: {self.silero_apply_tts is not None}")
            # Try to reinitialize if model was lost
            try:
                logger.info("Attempting to reinitialize Silero model...")
                self._initialize_silero()
                if not self.silero_model or not self.silero_apply_tts:
                    return None
            except Exception as e:
                logger.error(f"Failed to reinitialize Silero: {e}")
                return None
            
        try:
            # Map voice to Silero speaker
            speaker = self.silero_speakers.get(voice, 'en_0')
            
            logger.info(f"🎵 Silero Neural TTS: voice={voice} -> speaker={speaker}")
            
            # Generate audio with GPU acceleration
            with torch.no_grad():
                # Use the loaded apply_tts function
                audio = self.silero_apply_tts(
                    texts=[text],
                    model=self.silero_model,
                    sample_rate=self.silero_sample_rate,
                    speaker=speaker,
                    device=self.device
                )
                
                # audio is a tensor, convert to numpy for saving
                if isinstance(audio, torch.Tensor):
                    audio_np = audio.squeeze().cpu().numpy()
                else:
                    audio_np = audio.squeeze()
            
            # Save to temporary file
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
                # Use torchaudio (preferred) or scipy to save
                try:
                    import torchaudio
                    # Convert numpy back to tensor for torchaudio
                    audio_tensor = torch.from_numpy(audio_np).unsqueeze(0)
                    torchaudio.save(tmp_file.name, audio_tensor, self.silero_sample_rate)
                except ImportError:
                    # Fallback to scipy if available
                    if SCIPY_AVAILABLE:
                        scipy_write(tmp_file.name, self.silero_sample_rate, audio_np)
                    else:
                        raise Exception("Neither torchaudio nor scipy available for audio saving")
                
                logger.info(f"✅ Silero synthesis successful: {os.path.getsize(tmp_file.name)} bytes")
                return tmp_file.name
                
        except Exception as e:
            logger.error(f"❌ Silero TTS error: {e}")
            import traceback
            logger.error(f"   Traceback: {traceback.format_exc()}")
            return None

    async def synthesize_with_edge_tts(self, text: str, voice: str) -> Optional[str]:
        """Synthesize speech using Edge TTS. Honors full Edge voice IDs when provided
        and retries with sensible fallbacks to avoid hard 500s."""
        try:
            import edge_tts

            # Resolve requested voice to an Edge voice id
            if isinstance(voice, str) and voice.startswith('en-') and voice.endswith('Neural') and '-' in voice:
                primary_voice = voice
            else:
                voice_map = {
                    'chatterbox': 'en-US-JennyNeural',
                    'female_1': 'en-US-JennyNeural',
                    'female_2': 'en-US-AriaNeural',
                    'male_1': 'en-US-GuyNeural',
                    'male_2': 'en-US-DavisNeural',
                    'expressive': 'en-US-AriaNeural',
                    'calm': 'en-US-SaraNeural',
                    'cheerful': 'en-US-JennyNeural',
                    'sad': 'en-US-AriaNeural',
                    # UK male aliases
                    'male_british': 'en-GB-RyanNeural',
                    'male_uk': 'en-GB-RyanNeural',
                    'british_male': 'en-GB-RyanNeural'
                }
                primary_voice = voice_map.get(voice, 'en-US-JennyNeural')

            # Build fallback list (prefer UK male, then US male)
            candidates: List[str] = [primary_voice]
            if primary_voice.startswith('en-GB-') or primary_voice in ['en-GB-RyanNeural', 'en-GB-GeorgeNeural', 'en-GB-ThomasNeural']:
                for alt in ['en-GB-RyanNeural', 'en-GB-GeorgeNeural', 'en-GB-ThomasNeural', 'en-US-GuyNeural']:
                    if alt not in candidates:
                        candidates.append(alt)
            else:
                for alt in ['en-US-GuyNeural']:
                    if alt not in candidates:
                        candidates.append(alt)

            # Try each candidate voice
            last_error: Optional[str] = None
            for edge_voice in candidates:
                with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
                    logger.info(f"Synthesizing with Edge TTS: voice {edge_voice}")
                    try:
                        communicate = edge_tts.Communicate(text, edge_voice)
                        await asyncio.wait_for(communicate.save(tmp_file.name), timeout=30.0)
                    except asyncio.TimeoutError:
                        last_error = "timeout"
                        logger.error("Edge TTS timeout")
                        if os.path.exists(tmp_file.name):
                            os.unlink(tmp_file.name)
                        continue
                    except Exception as e:
                        import traceback
                        last_error = str(e)
                        logger.error(f"Edge TTS error with voice {edge_voice}: {e}")
                        logger.error(f"Traceback: {traceback.format_exc()}")
                        if os.path.exists(tmp_file.name):
                            try:
                                if os.path.getsize(tmp_file.name) == 0:
                                    os.unlink(tmp_file.name)
                            except Exception:
                                pass
                        continue

                    if os.path.exists(tmp_file.name) and os.path.getsize(tmp_file.name) > 0:
                        logger.info(f"Edge TTS successful: {os.path.getsize(tmp_file.name)} bytes")
                        return tmp_file.name
                    else:
                        logger.warning("Edge TTS produced no audio")
                        try:
                            os.unlink(tmp_file.name)
                        except Exception:
                            pass
                        continue

            logger.warning(f"All Edge TTS attempts failed. Last error: {last_error}")
            return None

        except ImportError:
            logger.warning("Edge TTS not available (missing edge-tts package)")
            return None

    async def synthesize_with_gtts(self, text: str) -> Optional[str]:
        """Synthesize speech using gTTS"""
        try:
            from gtts import gTTS
            
            with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as tmp_file:
                logger.info("Synthesizing with gTTS")
                tts = gTTS(text=text, lang='en', slow=False)
                tts.save(tmp_file.name)
                
                if os.path.exists(tmp_file.name) and os.path.getsize(tmp_file.name) > 0:
                    logger.info(f"gTTS successful: {os.path.getsize(tmp_file.name)} bytes")
                    return tmp_file.name
                else:
                    logger.warning("gTTS produced no audio")
                    return None
                
        except ImportError:
            logger.warning("gTTS not available (missing gtts package)")
            return None
        except Exception as e:
            logger.error(f"gTTS error: {e}")
            return None

    async def synthesize_with_espeak(self, text: str, voice: str) -> Optional[str]:
        """Synthesize speech using eSpeak"""
        try:
            voice_map = {
                'chatterbox': 'en',
                'female_1': 'en+f3',
                'female_2': 'en+f2',
                'male_1': 'en+m3',
                'male_2': 'en+m2',
                'expressive': 'en+f4',
                'calm': 'en+f1',
                'cheerful': 'en+f3',
                'sad': 'en+m1'
            }
            
            espeak_voice = voice_map.get(voice, 'en')
            
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
                logger.info(f"Synthesizing with eSpeak: voice {espeak_voice}")
                
                # Run eSpeak command
                cmd = [
                    'espeak',
                    '-v', espeak_voice,
                    '-s', '175',  # Speed
                    '-w', tmp_file.name,  # Output file
                    text
                ]
                
                try:
                    result = await asyncio.wait_for(
                        asyncio.create_subprocess_exec(
                            *cmd,
                            stdout=asyncio.subprocess.PIPE,
                            stderr=asyncio.subprocess.PIPE
                        ),
                        timeout=30.0
                    )
                    
                    stdout, stderr = await result.communicate()
                    
                    if result.returncode != 0:
                        logger.error(f"eSpeak failed: {stderr.decode()}")
                        return None
                    
                    if os.path.exists(tmp_file.name) and os.path.getsize(tmp_file.name) > 44:  # More than WAV header
                        logger.info(f"eSpeak successful: {os.path.getsize(tmp_file.name)} bytes")
                        return tmp_file.name
                    else:
                        logger.warning("eSpeak produced no audio")
                        return None
                        
                except asyncio.TimeoutError:
                    logger.error("eSpeak timeout")
                    return None
                
        except FileNotFoundError:
            logger.warning("eSpeak not available (command not found)")
            return None
        except Exception as e:
            logger.error(f"eSpeak error: {e}")
            return None

    async def generate_silence(self, text_length: int) -> str:
        """Generate silence as ultimate fallback"""
        try:
            # Generate approximately 1 second of silence per 10 characters
            duration = max(1.0, text_length / 10.0)
            duration = min(duration, 10.0)  # Cap at 10 seconds
            
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
                logger.info(f"Generating {duration}s of silence")
                
                # Generate WAV file with silence
                sample_rate = 44100
                samples = int(sample_rate * duration)
                
                # WAV header
                wav_header = b'RIFF' + (samples * 2 + 36).to_bytes(4, 'little') + \
                            b'WAVE' + b'fmt ' + (16).to_bytes(4, 'little') + \
                            (1).to_bytes(2, 'little') + (1).to_bytes(2, 'little') + \
                            sample_rate.to_bytes(4, 'little') + (sample_rate * 2).to_bytes(4, 'little') + \
                            (2).to_bytes(2, 'little') + (16).to_bytes(2, 'little') + \
                            b'data' + (samples * 2).to_bytes(4, 'little')
                
                # Silence data
                silence_data = b'\x00' * (samples * 2)
                
                tmp_file.write(wav_header + silence_data)
                tmp_file.flush()
                
                logger.info(f"Silence generated: {len(wav_header + silence_data)} bytes")
                return tmp_file.name
                
        except Exception as e:
            logger.error(f"Error generating silence: {e}")
            # Create minimal silence file
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
                # Minimal WAV header + 1 second silence
                minimal_wav = b'RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00D\xac\x00\x00\x88X\x01\x00\x02\x00\x10\x00data\x00\x00\x00\x00'
                tmp_file.write(minimal_wav)
                return tmp_file.name

    async def synthesize(self, text: str, voice: str = "chatterbox", engine: str = "auto") -> TTSResponse:
        """Main synthesis method with engine fallbacks"""
        
        if not text.strip():
            raise HTTPException(status_code=400, detail="Text cannot be empty")
        
        engines_to_try = []
        
        if engine == "auto":
            # Default fallback order: Chatterbox FIRST (as requested) -> Silero -> Edge -> others
            engines_to_try = [
                ("chatterbox", self.synthesize_with_chatterbox),  # PRIMARY ENGINE - MUST WORK
                ("silero", self.synthesize_with_silero),          # First fallback (GPU)
                ("edge_tts", self.synthesize_with_edge_tts),
                ("gtts", self.synthesize_with_gtts),
                ("espeak", self.synthesize_with_espeak)
            ]
        elif engine == "edge":
            # When specifically requesting Edge TTS (preferred for high quality)
            engines_to_try = [
                ("edge_tts", self.synthesize_with_edge_tts),      # Primary choice
                ("silero", self.synthesize_with_silero),          # GPU fallback
                ("chatterbox", self.synthesize_with_chatterbox),
                ("gtts", self.synthesize_with_gtts),
                ("espeak", self.synthesize_with_espeak)
            ]
        elif engine == "chatterbox":
            # When specifically requesting chatterbox
            engines_to_try = [
                ("chatterbox", self.synthesize_with_chatterbox),
                ("silero", self.synthesize_with_silero),          # First fallback
                ("edge_tts", self.synthesize_with_edge_tts),
                ("gtts", self.synthesize_with_gtts),
                ("espeak", self.synthesize_with_espeak)
            ]
        else:
            # Try specific engine first, then GPU-optimized fallbacks
            engine_methods = {
                "kokoro": self.synthesize_with_kokoro,
                "silero": self.synthesize_with_silero,
                "chatterbox": self.synthesize_with_chatterbox,
                "edge_tts": self.synthesize_with_edge_tts,
                "gtts": self.synthesize_with_gtts,
                "espeak": self.synthesize_with_espeak
            }
            
            if engine in engine_methods:
                engines_to_try.append((engine, engine_methods[engine]))
                # Add GPU-optimized fallbacks first
                fallback_order = ["silero", "edge_tts", "gtts", "espeak", "chatterbox"]
                for fallback_engine in fallback_order:
                    if fallback_engine != engine and fallback_engine in engine_methods:
                        engines_to_try.append((fallback_engine, engine_methods[fallback_engine]))
        
        # Try each engine until one succeeds
        for engine_name, method in engines_to_try:
            try:
                logger.info(f"Trying {engine_name} for synthesis")
                
                if engine_name in ["kokoro", "chatterbox", "silero", "edge_tts", "espeak"]:

                    audio_file = await method(text, voice)
                else:
                    audio_file = await method(text)
                
                if audio_file:
                    logger.info(f"Successfully synthesized with {engine_name}")
                    return TTSResponse(
                        audio_file=audio_file,
                        engine_used=engine_name,
                        voice_used=voice
                    )
                    
            except Exception as e:
                logger.warning(f"Engine {engine_name} failed: {e}")
                continue
        
        # If all engines fail, create silence
        logger.warning("All TTS engines failed, creating silence")
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
            # Create 1 second of silence
            silence = torch.zeros(1, 16000)  # 1 second at 16kHz
            torchaudio.save(tmp_file.name, silence, 16000)
            
            return TTSResponse(
                audio_file=tmp_file.name,
                engine_used="silence",
                voice_used=voice
            )

# Initialize service
tts_service = GPUTTSService()

# Add validation error handler
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    logger.error(f"[GPU TTS Service] ===== VALIDATION ERROR =====")
    logger.error(f"Request URL: {request.url}")
    logger.error(f"Request method: {request.method}")
    logger.error(f"Validation errors: {exc.errors()}")
    logger.error(f"Request body: {await request.body()}")
    logger.error(f"[GPU TTS Service] ================================")
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors()}
    )

@app.post("/synthesize")
async def synthesize_speech(
    text: str = Form(...),
    gender: str = Form("female"),
    emotion: str = Form("neutral"), 
    exaggeration: float = Form(0.5),
    cfg_weight: float = Form(0.5),
    voice_id: str = Form("default"),  # For backward compatibility
    speed: float = Form(1.0),
    engine: str = Form("auto"),
    voice_cloning: bool = Form(False),
    audio_prompt: UploadFile = File(None)
):
    """Synthesize text to speech using the best available engine with optional voice cloning - Form Data API matching standard service."""
    
    # Debug logging to see what parameters we're actually receiving
    logger.info(f"[GPU TTS Service] ===== RECEIVED FORM REQUEST =====")
    logger.info(f"  text: '{text[:50]}...' (type: {type(text)})")
    logger.info(f"  gender: '{gender}' (type: {type(gender)})")
    logger.info(f"  emotion: '{emotion}' (type: {type(emotion)})")
    logger.info(f"  exaggeration: {exaggeration} (type: {type(exaggeration)})")
    logger.info(f"  cfg_weight: {cfg_weight} (type: {type(cfg_weight)})")
    logger.info(f"  voice_id: '{voice_id}' (type: {type(voice_id)})")
    logger.info(f"  speed: {speed} (type: {type(speed)})")
    logger.info(f"  engine: '{engine}' (type: {type(engine)})")
    logger.info(f"  voice_cloning: {voice_cloning} (type: {type(voice_cloning)})")
    logger.info(f"  audio_prompt: {audio_prompt.filename if audio_prompt else 'None'}")
    logger.info(f"[GPU TTS Service] =====================================")

    
    start_time = time.time()
    
    try:
        # Validate input
        if not text or not text.strip():
            raise HTTPException(status_code=400, detail="Text cannot be empty")
        
        text = text.strip()
        if len(text) > 5000:
            logger.warning(f"Text too long ({len(text)} chars), truncating to 5000")
            text = text[:5000] + "..."
        
        logger.info(f"GPU TTS Synthesizing: '{text[:100]}...' with voice '{voice_id}' using engine '{engine}'")
        
        last_error = None
        audio_prompt_path = None
        
        # Handle voice cloning file upload
        if voice_cloning and audio_prompt:
            try:
                # Save uploaded audio file temporarily
                import tempfile
                temp_dir = tempfile.gettempdir()
                audio_prompt_path = os.path.join(temp_dir, f"voice_prompt_{int(time.time())}.wav")
                
                # Read and save the audio file
                audio_content = await audio_prompt.read()
                with open(audio_prompt_path, "wb") as f:
                    f.write(audio_content)
                    
                logger.info(f"Voice cloning audio saved to: {audio_prompt_path}")
                
            except Exception as e:
                logger.error(f"Failed to save audio prompt: {e}")
                raise HTTPException(status_code=400, detail=f"Failed to process audio file: {str(e)}")
        
        # Use the working synthesize method instead of this broken loop
        logger.info(f"[GPU TTS Service] Using working synthesize method with engine: {engine}")
        
        # Map kokoro requests to use kokoro engine
        logger.info(f"[GPU TTS Service] Processing request for engine: {engine}")
            
        result = await tts_service.synthesize(
            text=text,
            voice=voice_id, 
            engine=engine
        )
        
        if result and result.audio_file and os.path.exists(result.audio_file):
            logger.info(f"Successfully synthesized with {result.engine_used}")
            
            # Clean up temporary file
            if audio_prompt_path and os.path.exists(audio_prompt_path):
                try:
                    os.unlink(audio_prompt_path)
                except:
                    pass
            
            # Read and return the audio file
            with open(result.audio_file, 'rb') as f:
                audio_data = f.read()
            
            # Clean up audio file
            try:
                os.unlink(result.audio_file)
            except:
                pass
            
            # Return JSON format expected by backend
            import base64
            audio_base64 = base64.b64encode(audio_data).decode('utf-8')
            
            return {
                "audio_data": audio_base64,
                "engine": result.engine_used,
                "voice": result.voice_used,
                "processing_time_ms": int((time.time() - start_time) * 1000),
                "audio_duration_ms": len(audio_data) // 48,  # Rough estimate
                "cached": False
            }
        else:
            # Clean up temporary file on failure
            if audio_prompt_path and os.path.exists(audio_prompt_path):
                try:
                    os.unlink(audio_prompt_path)
                except:
                    pass
            
            raise HTTPException(
                status_code=500, 
                detail=f"TTS synthesis failed - no audio generated"
            )

        
    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        logger.error(f"Unexpected error in synthesis: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")
    finally:
        # Always clean up temporary files
        if audio_prompt_path and os.path.exists(audio_prompt_path):
            try:
                os.unlink(audio_prompt_path)
            except:
                pass

@app.post("/synthesize_json", response_model=TTSResponse)
async def synthesize_speech_json(request: TTSRequest):
    """Synthesize speech from text - returns JSON response with file path (for compatibility)"""
    return await tts_service.synthesize(
        text=request.text,
        voice=request.voice,
        engine=request.engine
    )

@app.get("/voices")
async def get_voices():
    """Get available TTS voices - Chatterbox PRIMARY, Silero fallback"""
    voices = []
    
    # Add Chatterbox voices (PRIMARY ENGINE)
    if tts_service.chatterbox_engine is not None:
        voice_descriptions = {
            "default": {"name": "Chatterbox Default", "gender": "neutral", "description": "Clear, neutral voice"},
            "female_1": {"name": "Chatterbox Female", "gender": "female", "description": "Natural female voice"},
            "male_1": {"name": "Chatterbox Male", "gender": "male", "description": "Deep male voice"},
            "expressive": {"name": "Chatterbox Expressive", "gender": "neutral", "description": "Expressive, dynamic voice"},
            "calm": {"name": "Chatterbox Calm", "gender": "neutral", "description": "Calm, soothing voice"},
            "chatterbox": {"name": "Chatterbox Default", "gender": "neutral", "description": "Default Chatterbox voice"}
        }
        
        for voice_id in tts_service.chatterbox_voices.keys():
            voice_info = voice_descriptions.get(voice_id, {"name": f"Chatterbox {voice_id}", "gender": "neutral", "description": "System voice"})
            voices.append({
                "id": voice_id,
                "name": voice_info["name"],
                "engine": "chatterbox",
                "language": "en",
                "gender": voice_info["gender"],
                "description": voice_info["description"],
                "quality": "high",
                "gpu_accelerated": False,
                "primary": True
            })
    
    # Add Silero voices as fallback (if available)
    if tts_service.silero_model is not None:
        silero_voice_descriptions = {
            "chatterbox": {"name": "Silero Default (Fallback)", "gender": "female", "description": "Neural fallback voice"},
            "female_1": {"name": "Silero Female Clear (Fallback)", "gender": "female", "description": "Clear, professional fallback"},
            "female_2": {"name": "Silero Female Expressive (Fallback)", "gender": "female", "description": "Dynamic fallback"},
            "male_1": {"name": "Silero Male Deep (Fallback)", "gender": "male", "description": "Deep fallback voice"},
            "male_2": {"name": "Silero Male Friendly (Fallback)", "gender": "male", "description": "Friendly fallback"},
            "expressive": {"name": "Silero Expressive (Fallback)", "gender": "female", "description": "Expressive fallback"},
            "calm": {"name": "Silero Calm (Fallback)", "gender": "female", "description": "Calm fallback"},
            "announcer": {"name": "Silero Announcer (Fallback)", "gender": "male", "description": "Professional fallback"},
            "storyteller": {"name": "Silero Storyteller (Fallback)", "gender": "male", "description": "Storytelling fallback"}
        }
        
        for voice_id in tts_service.silero_speakers.keys():
            # Only add if not already covered by Chatterbox
            if not any(v["id"] == voice_id and v["engine"] == "chatterbox" for v in voices):
                voice_info = silero_voice_descriptions.get(voice_id, {"name": f"Silero {voice_id} (Fallback)", "gender": "neutral", "description": "Neural fallback"})
                voices.append({
                    "id": voice_id,
                    "name": voice_info["name"],
                    "engine": "silero",
                    "language": "en",
                    "gender": voice_info["gender"],
                    "description": voice_info["description"],
                    "quality": "high",
                    "gpu_accelerated": True,
                    "primary": False
                })
    
    return {
        "voices": voices,
        "primary_engine": "chatterbox",
        "fallback_available": tts_service.silero_model is not None
    }

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
    
    # Determine primary engine (Chatterbox is primary, Silero is first fallback)
    primary_engine = "none"
    if tts_service.chatterbox_engine is not None:
        primary_engine = "chatterbox"
    elif tts_service.silero_model is not None:
        primary_engine = "silero"
    
    # Build engines array for voice.js compatibility
    engines_array = [
        {"name": "kokoro", "available": getattr(tts_service, 'kokoro_available', False), "primary": True},
        {"name": "chatterbox", "available": tts_service.chatterbox_engine is not None, "primary": False},

        {"name": "silero", "available": tts_service.silero_model is not None, "primary": False},
        {"name": "edge_tts", "available": True, "primary": False},
        {"name": "gtts", "available": True, "primary": False},
        {"name": "espeak", "available": True, "primary": False}
    ]
    
    return {
        "status": "healthy",
        "device": str(tts_service.device),
        "primary_engine": primary_engine,
        "engines": engines_array,  # Array format for voice.js compatibility
        "engines_dict": {  # Keep object format for backward compatibility
            "chatterbox": tts_service.chatterbox_engine is not None,
            "silero": tts_service.silero_model is not None,
            "edge_tts": True,
            "gtts": True,
            "espeak": True
        },
        "gpu_info": gpu_info,
        "available_voices": len(tts_service.chatterbox_voices) if tts_service.chatterbox_engine else len(tts_service.silero_speakers),
        "voice_options": list(tts_service.chatterbox_voices.keys()) if tts_service.chatterbox_engine else list(tts_service.silero_speakers.keys())
    }

if __name__ == "__main__":
    logger.info("Starting GPU TTS Service on port 5002")
    uvicorn.run(
        app, 
        host="0.0.0.0", 
        port=5002,
        log_level="info",
        access_log=True,
        timeout_keep_alive=30,
        timeout_graceful_shutdown=10
    ) 