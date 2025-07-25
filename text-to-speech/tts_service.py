#!/usr/bin/env python3

import os
import io
import tempfile
import logging  
import asyncio
from typing import Optional, Dict, Any, List
from abc import ABC, abstractmethod
from fastapi import FastAPI, HTTPException, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
import pyttsx3
import edge_tts
from gtts import gTTS
import subprocess

# Configure logging first
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Try to import Chatterbox TTS
try:
    from chatterbox.tts import ChatterboxTTS
    import soundfile as sf
    CHATTERBOX_AVAILABLE = True
    logger.info("Chatterbox TTS imported successfully")
except ImportError as e:
    CHATTERBOX_AVAILABLE = False
    logger.warning(f"Chatterbox TTS not available: {e}")
except Exception as e:
    CHATTERBOX_AVAILABLE = False
    logger.error(f"Error importing Chatterbox TTS: {e}")

app = FastAPI(title="Multi-Engine TTS Service", version="1.0.0")

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
    speed: float = 1.0
    language: str = "en"

class TTSResponse(BaseModel):
    success: bool
    engine_used: str
    voice_id: str
    message: str = ""

class VoiceInfo(BaseModel):
    id: str
    name: str
    language: str
    gender: str
    engine: str
    description: str

# Abstract TTS Engine Base Class
class TTSEngine(ABC):
    def __init__(self, name: str):
        self.name = name
        self.available = False
        self._initialize()
    
    @abstractmethod
    def _initialize(self):
        """Initialize the TTS engine."""
        pass
    
    @abstractmethod
    async def synthesize(self, text: str, voice_id: str = "default", speed: float = 1.0) -> bytes:
        """Synthesize text to speech and return audio bytes."""
        pass
    
    @abstractmethod
    def get_voices(self) -> List[VoiceInfo]:
        """Return available voices for this engine."""
        pass

# Chatterbox Engine (Resemble AI Neural TTS)
class ChatterboxEngine(TTSEngine):
    def __init__(self):
        super().__init__("chatterbox")
        self.model = None
        
    def _initialize(self):
        if not CHATTERBOX_AVAILABLE:
            logger.warning("Chatterbox TTS package not available")
            self.available = False
            return
            
        try:
            import torch
            device = 'cuda' if torch.cuda.is_available() else 'cpu'
            logger.info(f"Initializing Chatterbox TTS on device: {device}")
            
            # Store reference to prevent garbage collection
            self.model = ChatterboxTTS.from_pretrained(device=device)
            
            # Wait for model to fully load (PerthNet loading happens after initialization)
            import time
            logger.info("Waiting for Chatterbox model to fully load...")
            time.sleep(2)  # Give time for PerthNet to load
            
            # Test that model is actually ready and store reference
            try:
                # Try a small test synthesis to ensure model is ready
                test_audio = self.model.generate(text="test", exaggeration=0.5, cfg_weight=0.5)
                logger.info("✅ Chatterbox model test synthesis successful")
                # Explicitly store model reference to ensure it persists
                self._chatterbox_model = self.model
                logger.info(f"Model reference stored: {self.model is not None}, {self._chatterbox_model is not None}")
            except Exception as e:
                logger.warning(f"Chatterbox model test failed: {e}")
                self.model = None
                self._chatterbox_model = None
                self.available = False
                return
            
            self.voice_configs = {
                "default": {"exaggeration": 0.5, "cfg_weight": 0.3},
                "female_1": {"exaggeration": 0.7, "cfg_weight": 0.4}, 
                "male_1": {"exaggeration": 0.4, "cfg_weight": 0.3},
                "expressive": {"exaggeration": 0.9, "cfg_weight": 0.5},
                "calm": {"exaggeration": 0.2, "cfg_weight": 0.2}
            }
            
            self.available = True
            logger.info(f"✅ Chatterbox TTS (Resemble AI) fully initialized. Model refs: {self.model is not None}, {self._chatterbox_model is not None}")
            
        except Exception as e:
            logger.error(f"Failed to initialize Chatterbox TTS: {str(e)}")
            self.model = None
            self._chatterbox_model = None
            self.available = False
    
    async def synthesize(self, text: str, gender: str = "female", emotion: str = "neutral", 
                          exaggeration: float = 0.5, cfg_weight: float = 0.5, 
                          audio_prompt_path: str = None, **kwargs) -> bytes:
        logger.info(f"ChatterboxEngine synthesize called: model={self.model is not None}, backup={hasattr(self, '_chatterbox_model') and self._chatterbox_model is not None}, available={self.available}")
        
        # Use backup model reference if primary is lost
        model_to_use = self.model
        if not model_to_use and hasattr(self, '_chatterbox_model'):
            logger.info("Primary model reference lost, using backup reference")
            model_to_use = self._chatterbox_model
            self.model = self._chatterbox_model  # Restore primary reference
        
        if not model_to_use:
            logger.error(f"Chatterbox model not initialized! Primary: {self.model is not None}, Backup: {hasattr(self, '_chatterbox_model') and self._chatterbox_model is not None}, Available: {self.available}")
            raise Exception("Chatterbox model not initialized")
            
        try:
            if audio_prompt_path:
                logger.info(f"Synthesizing with Chatterbox voice cloning: audio_prompt={audio_prompt_path}, exaggeration={exaggeration}, cfg_weight={cfg_weight}")
            else:
                logger.info(f"Synthesizing with Chatterbox: gender={gender}, emotion={emotion}, exaggeration={exaggeration}, cfg_weight={cfg_weight}")
            
            # Generate audio with Chatterbox TTS using the generate method
            if audio_prompt_path and os.path.exists(audio_prompt_path):
                # Voice cloning mode with audio prompt
                audio = model_to_use.generate(
                    text=text,
                    audio_prompt_path=audio_prompt_path,
                    exaggeration=exaggeration,
                    cfg_weight=cfg_weight
                )
            else:
                # Default voice mode
                audio = model_to_use.generate(
                    text=text,
                    exaggeration=exaggeration,
                    cfg_weight=cfg_weight
                )
            
            # Convert to bytes (assuming audio is a numpy array or tensor)
            import soundfile as sf
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
                # Write audio to temporary WAV file
                sf.write(tmp_file.name, audio, 22050)  # Chatterbox typically uses 22kHz
                
                # Read back as bytes
                with open(tmp_file.name, 'rb') as f:
                    audio_data = f.read()
                
                os.unlink(tmp_file.name)
                
            logger.info(f"✅ Chatterbox synthesis successful: {len(audio_data)} bytes")
            return audio_data
                
        except Exception as e:
            logger.error(f"Chatterbox synthesis error: {str(e)}")
            raise
    
    def get_voices(self) -> List[VoiceInfo]:
        voices = []
        
        # Generate voice combinations for gender + emotion matrix
        genders = ["female", "male"]
        emotions = ["expressive", "calm", "dramatic", "neutral"]
        
        for gender in genders:
            for emotion in emotions:
                voice_id = f"{gender}_{emotion}"
                name = f"Chatterbox {gender.title()} ({emotion.title()})"
                description = f"{gender.title()} voice with {emotion} emotional tone"
                
                voices.append(VoiceInfo(
                    id=voice_id,
                    name=name,
                    language="en",
                    gender=gender,
                    engine="chatterbox",
                    description=description
                ))
        
        return voices

# Edge TTS Engine (Microsoft)
class EdgeTTSEngine(TTSEngine):
    def __init__(self):
        super().__init__("edge_tts")
        
    def _initialize(self):
        try:
            # Test Edge TTS availability
            self.voice_map = {
                "default": "en-US-AriaNeural",
                "female_1": "en-US-AriaNeural",
                "male_1": "en-US-GuyNeural",
                "expressive": "en-US-JennyNeural",
                "calm": "en-US-SaraNeural"
            }
            self.available = True
            logger.info("Edge TTS engine initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize Edge TTS engine: {str(e)}")
            self.available = False
    
    async def synthesize(self, text: str, voice_id: str = "default", speed: float = 1.0) -> bytes:
        try:
            voice = self.voice_map.get(voice_id, self.voice_map["default"])
            
            # Calculate rate adjustment
            rate_adjust = "+0%" if speed == 1.0 else f"+{int((speed - 1) * 100)}%"
            
            communicate = edge_tts.Communicate(text, voice, rate=rate_adjust)
            
            # Generate audio
            audio_data = b""
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    audio_data += chunk["data"]
            
            return audio_data
            
        except Exception as e:
            logger.error(f"Edge TTS synthesis error: {str(e)}")
            raise
    
    def get_voices(self) -> List[VoiceInfo]:
        return [
            VoiceInfo(
                id="female_1",
                name="Edge Aria",
                language="en",
                gender="female", 
                engine="edge_tts",
                description="Microsoft Aria neural voice"
            ),
            VoiceInfo(
                id="male_1",
                name="Edge Guy",
                language="en",
                gender="male",
                engine="edge_tts", 
                description="Microsoft Guy neural voice"
            )
        ]

# Google TTS Engine
class GTTSEngine(TTSEngine):
    def __init__(self):
        super().__init__("gtts")
        
    def _initialize(self):
        try:
            self.available = True
            logger.info("gTTS engine initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize gTTS engine: {str(e)}")
            self.available = False
    
    async def synthesize(self, text: str, voice_id: str = "default", speed: float = 1.0) -> bytes:
        try:
            # gTTS doesn't support speed adjustment directly
            tts = gTTS(text=text, lang='en', slow=(speed < 0.8))
            
            with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as tmp_file:
                tts.save(tmp_file.name)
                
                with open(tmp_file.name, 'rb') as f:
                    audio_data = f.read()
                
                os.unlink(tmp_file.name)
                return audio_data
                
        except Exception as e:
            logger.error(f"gTTS synthesis error: {str(e)}")
            raise
    
    def get_voices(self) -> List[VoiceInfo]:
        return [
            VoiceInfo(
                id="default",
                name="Google TTS",
                language="en",
                gender="neutral",
                engine="gtts",
                description="Google Text-to-Speech"
            )
        ]

# eSpeak Engine (Offline fallback)
class ESpeakEngine(TTSEngine):
    def __init__(self):
        super().__init__("espeak")
        
    def _initialize(self):
        try:
            # Test eSpeak availability
            result = subprocess.run(['espeak', '--version'], 
                                  capture_output=True, text=True)
            if result.returncode == 0:
                self.available = True
                logger.info("eSpeak engine initialized successfully")
            else:
                self.available = False
        except Exception as e:
            logger.error(f"Failed to initialize eSpeak engine: {str(e)}")
            self.available = False
    
    async def synthesize(self, text: str, voice_id: str = "default", speed: float = 1.0) -> bytes:
        try:
            # Calculate words per minute
            wpm = int(175 * speed)  # Base 175 WPM
            
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
                cmd = [
                    'espeak',
                    '-w', tmp_file.name,
                    '-s', str(wpm),
                    text
                ]
                
                subprocess.run(cmd, check=True)
                
                with open(tmp_file.name, 'rb') as f:
                    audio_data = f.read()
                
                os.unlink(tmp_file.name)
                return audio_data
                
        except Exception as e:
            logger.error(f"eSpeak synthesis error: {str(e)}")
            raise
    
    def get_voices(self) -> List[VoiceInfo]:
        return [
            VoiceInfo(
                id="default",
                name="eSpeak",
                language="en",
                gender="neutral",
                engine="espeak",
                description="eSpeak offline voice"
            )
        ]

# Silence Engine (Ultimate fallback)
class SilenceEngine(TTSEngine):
    def __init__(self):
        super().__init__("silence")
        
    def _initialize(self):
        self.available = True
        logger.info("Silence engine initialized (ultimate fallback)")
    
    async def synthesize(self, text: str, voice_id: str = "default", speed: float = 1.0) -> bytes:
        # Return 1 second of silence (44.1kHz, 16-bit, mono WAV)
        duration = max(1, len(text) * 0.1)  # Approximate duration based on text length
        sample_rate = 44100
        samples = int(sample_rate * duration)
        
        # WAV header + silence
        wav_header = b'RIFF' + (samples * 2 + 36).to_bytes(4, 'little') + \
                    b'WAVE' + b'fmt ' + (16).to_bytes(4, 'little') + \
                    (1).to_bytes(2, 'little') + (1).to_bytes(2, 'little') + \
                    sample_rate.to_bytes(4, 'little') + (sample_rate * 2).to_bytes(4, 'little') + \
                    (2).to_bytes(2, 'little') + (16).to_bytes(2, 'little') + \
                    b'data' + (samples * 2).to_bytes(4, 'little')
        
        silence_data = b'\x00' * (samples * 2)
        return wav_header + silence_data
    
    def get_voices(self) -> List[VoiceInfo]:
        return [
            VoiceInfo(
                id="silence",
                name="Silence",
                language="en",
                gender="neutral",
                engine="silence",
                description="Silent fallback"
            )
        ]

# Initialize engines in priority order
engines = []

# Add engines in fallback order
chatterbox_engine = ChatterboxEngine()
logger.info(f"Created ChatterboxEngine: available={chatterbox_engine.available}, model={chatterbox_engine.model is not None if chatterbox_engine.model else None}")
if chatterbox_engine.available:
    engines.append(chatterbox_engine)
    logger.info(f"Added ChatterboxEngine to engines list at index 0")

edge_tts_engine = EdgeTTSEngine()
if edge_tts_engine.available:
    engines.append(edge_tts_engine)

gtts_engine = GTTSEngine()
if gtts_engine.available:
    engines.append(gtts_engine)

espeak_engine = ESpeakEngine()
if espeak_engine.available:
    engines.append(espeak_engine)

# Always add silence as ultimate fallback
engines.append(SilenceEngine())

logger.info(f"Initialized {len(engines)} TTS engines: {[e.name for e in engines]}")

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "engines": [{"name": e.name, "available": e.available} for e in engines],
        "primary_engine": engines[0].name if engines else "none"
    }

@app.post("/synthesize")
async def synthesize_text(
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
    """Synthesize text to speech using the best available engine with optional voice cloning."""
    
    # Debug logging to see what parameters we're actually receiving
    logger.info(f"[TTS Service] Received request:")
    logger.info(f"  text: {text[:50]}...")
    logger.info(f"  gender: {gender} (type: {type(gender)})")
    logger.info(f"  emotion: {emotion} (type: {type(emotion)})")
    logger.info(f"  exaggeration: {exaggeration} (type: {type(exaggeration)})")
    logger.info(f"  cfg_weight: {cfg_weight} (type: {type(cfg_weight)})")
    logger.info(f"  voice_cloning: {voice_cloning} (type: {type(voice_cloning)})")
    logger.info(f"  audio_prompt: {audio_prompt.filename if audio_prompt else 'None'}")
    
    if not text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")
    
    last_error = None
    audio_prompt_path = None
    
    # Handle voice cloning file upload
    if voice_cloning and audio_prompt:
        try:
            # Save uploaded audio file temporarily
            import tempfile
            temp_dir = tempfile.gettempdir()
            audio_prompt_path = os.path.join(temp_dir, f"voice_prompt_{int(asyncio.get_event_loop().time())}.wav")
            
            # Read and save the audio file
            audio_content = await audio_prompt.read()
            with open(audio_prompt_path, "wb") as f:
                f.write(audio_content)
                
            logger.info(f"Voice cloning audio saved to: {audio_prompt_path}")
            
        except Exception as e:
            logger.error(f"Failed to save audio prompt: {e}")
            raise HTTPException(status_code=400, detail=f"Failed to process audio file: {str(e)}")
    
    # Try engines in priority order
    for eng in engines:
        if not eng.available:
            continue
            
        try:
            logger.info(f"Attempting synthesis with {eng.name} (id: {id(eng)})")
            if eng.name == "chatterbox":
                logger.info(f"Chatterbox engine details: model={eng.model is not None if hasattr(eng, 'model') else 'no model attr'}, available={eng.available}")
            
            # Handle Chatterbox engine with new parameters
            if eng.name == "chatterbox":
                audio_data = await eng.synthesize(
                    text=text,
                    gender=gender,
                    emotion=emotion,
                    exaggeration=exaggeration,
                    cfg_weight=cfg_weight,
                    audio_prompt_path=audio_prompt_path
                )
            else:
                # Use legacy parameters for other engines
                audio_data = await eng.synthesize(text, voice_id, speed)
            
            logger.info(f"Successfully synthesized with {eng.name}")
            
            # Clean up temporary file
            if audio_prompt_path and os.path.exists(audio_prompt_path):
                try:
                    os.unlink(audio_prompt_path)
                except:
                    pass
            
            return Response(
                content=audio_data,
                media_type="audio/wav",
                headers={
                    "X-Engine-Used": eng.name,
                    "X-Voice-ID": voice_id if not voice_cloning else "voice_clone",
                    "X-Voice-Cloning": "true" if voice_cloning else "false"
                }
            )
            
        except Exception as e:
            last_error = str(e)
            logger.warning(f"Engine {eng.name} failed: {str(e)}")
            continue
    
    # Clean up temporary file on failure
    if audio_prompt_path and os.path.exists(audio_prompt_path):
        try:
            os.unlink(audio_prompt_path)
        except:
            pass
    
    # If all engines failed
    raise HTTPException(
        status_code=500, 
        detail=f"All TTS engines failed. Last error: {last_error}"
    )

@app.get("/voices")
async def list_voices():
    """List all available voices from all engines."""
    all_voices = []
    
    for engine in engines:
        if engine.available:
            voices = engine.get_voices()
            all_voices.extend(voices)
    
    return {
        "voices": all_voices,
        "primary_engine": engines[0].name if engines else "none",
        "engine_count": len([e for e in engines if e.available])
    }

@app.get("/engines")
async def list_engines():
    """List all TTS engines and their status."""
    return {
        "engines": [
            {
                "name": e.name,
                "available": e.available,
                "voice_count": len(e.get_voices()) if e.available else 0
            }
            for e in engines
        ]
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8005) 