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
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
import numpy as np
import subprocess

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="GPU-Accelerated TTS Service", version="2.0.0")

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
    voice_id: str = "default"
    speed: float = 1.0
    language: str = "en"

class VoiceInfo(BaseModel):
    id: str
    name: str
    language: str
    gender: str
    engine: str
    description: str

# Check GPU availability
DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
logger.info(f"Using device: {DEVICE}")

if torch.cuda.is_available():
    logger.info(f"GPU: {torch.cuda.get_device_name()}")
    logger.info(f"CUDA Version: {torch.version.cuda}")
    logger.info(f"GPU Memory: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB")

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

# Silero TTS Engine (Primary - GPU Accelerated)
class SileroEngine(TTSEngine):
    def __init__(self):
        super().__init__("silero")
        
    def _initialize(self):
        try:
            # Load Silero TTS model
            self.model, self.example_text = torch.hub.load(
                repo_or_dir='snakers4/silero-models',
                model='silero_tts',
                language='en',
                speaker='v3_en'
            )
            
            # Move model to GPU if available
            self.model = self.model.to(DEVICE)
            
            # Available speakers
            self.speakers = {
                "default": "en_0",
                "female_1": "en_0",     # Clear female voice
                "female_2": "en_1",     # Expressive female voice  
                "male_1": "en_2",       # Deep male voice
                "male_2": "en_3",       # Friendly male voice
                "expressive": "en_1",   # Most expressive
                "calm": "en_0",         # Most calm
                "announcer": "en_2",    # Announcer style
                "storyteller": "en_3",  # Storytelling style
            }
            
            self.sample_rate = 48000
            self.available = True
            logger.info("Silero GPU engine initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize Silero engine: {str(e)}")
            self.available = False
    
    async def synthesize(self, text: str, voice_id: str = "default", speed: float = 1.0) -> bytes:
        try:
            speaker = self.speakers.get(voice_id, self.speakers["default"])
            
            # Generate audio with GPU acceleration
            with torch.no_grad():
                audio = self.model.apply_tts(
                    text=text,
                    speaker=speaker,
                    sample_rate=self.sample_rate,
                    put_accent=True,
                    put_yo=True
                )
            
            # Move to CPU for processing
            audio = audio.cpu()
            
            # Apply speed adjustment
            if speed != 1.0:
                # Time-stretch the audio
                audio = torchaudio.functional.time_stretch(
                    audio.unsqueeze(0), 
                    1.0 / speed, 
                    n_fft=1024
                ).squeeze(0)
            
            # Convert to wav bytes
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
                torchaudio.save(
                    tmp_file.name,
                    audio.unsqueeze(0),
                    self.sample_rate,
                    format='wav'
                )
                
                with open(tmp_file.name, 'rb') as f:
                    audio_data = f.read()
                
                os.unlink(tmp_file.name)
                return audio_data
                
        except Exception as e:
            logger.error(f"Silero synthesis error: {str(e)}")
            raise
    
    def get_voices(self) -> List[VoiceInfo]:
        return [
            VoiceInfo(
                id="female_1",
                name="Silero Female Clear",
                language="en",
                gender="female",
                engine="silero",
                description="Clear, professional female voice (GPU accelerated)"
            ),
            VoiceInfo(
                id="female_2",
                name="Silero Female Expressive",
                language="en",
                gender="female",
                engine="silero",
                description="Expressive, dynamic female voice (GPU accelerated)"
            ),
            VoiceInfo(
                id="male_1",
                name="Silero Male Deep",
                language="en",
                gender="male",
                engine="silero",
                description="Deep, authoritative male voice (GPU accelerated)"
            ),
            VoiceInfo(
                id="male_2",
                name="Silero Male Friendly",
                language="en",
                gender="male",
                engine="silero",
                description="Friendly, warm male voice (GPU accelerated)"
            ),
            VoiceInfo(
                id="expressive",
                name="Silero Expressive",
                language="en",
                gender="female",
                engine="silero",
                description="Most expressive voice with natural intonation (GPU accelerated)"
            ),
            VoiceInfo(
                id="calm",
                name="Silero Calm",
                language="en",
                gender="female",
                engine="silero",
                description="Calm, soothing voice for relaxation (GPU accelerated)"
            ),
            VoiceInfo(
                id="announcer",
                name="Silero Announcer",
                language="en",
                gender="male",
                engine="silero",
                description="Professional announcer voice (GPU accelerated)"
            ),
            VoiceInfo(
                id="storyteller",
                name="Silero Storyteller",
                language="en",
                gender="male",
                engine="silero",
                description="Engaging storytelling voice (GPU accelerated)"
            )
        ]

# Coqui TTS Engine (High Quality - GPU Accelerated)
class CoquiEngine(TTSEngine):
    def __init__(self):
        super().__init__("coqui")
        
    def _initialize(self):
        try:
            from TTS.api import TTS
            
            # Use GPU if available
            device_name = "cuda" if torch.cuda.is_available() else "cpu"
            
            # Load high-quality VITS model
            self.tts = TTS(
                model_name="tts_models/en/ljspeech/vits",
                gpu=torch.cuda.is_available()
            ).to(device_name)
            
            self.available = True
            logger.info("Coqui GPU engine initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize Coqui engine: {str(e)}")
            self.available = False
    
    async def synthesize(self, text: str, voice_id: str = "default", speed: float = 1.0) -> bytes:
        try:
            # Generate audio with GPU acceleration
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
                self.tts.tts_to_file(
                    text=text,
                    file_path=tmp_file.name,
                    speed=speed
                )
                
                with open(tmp_file.name, 'rb') as f:
                    audio_data = f.read()
                
                os.unlink(tmp_file.name)
                return audio_data
                
        except Exception as e:
            logger.error(f"Coqui synthesis error: {str(e)}")
            raise
    
    def get_voices(self) -> List[VoiceInfo]:
        return [
            VoiceInfo(
                id="default",
                name="Coqui VITS",
                language="en",
                gender="female",
                engine="coqui",
                description="High-quality neural voice synthesis (GPU accelerated)"
            )
        ]

# Enhanced Edge TTS Engine
class EdgeTTSEngine(TTSEngine):
    def __init__(self):
        super().__init__("edge_tts")
        
    def _initialize(self):
        try:
            import edge_tts
            self.voice_map = {
                "default": "en-US-AriaNeural",
                "female_1": "en-US-AriaNeural",
                "female_2": "en-US-JennyNeural",
                "male_1": "en-US-GuyNeural",
                "male_2": "en-US-DavisNeural",
                "expressive": "en-US-JennyNeural",
                "calm": "en-US-SaraNeural",
                "announcer": "en-US-GuyNeural",
                "storyteller": "en-US-DavisNeural"
            }
            self.available = True
            logger.info("Edge TTS engine initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize Edge TTS engine: {str(e)}")
            self.available = False
    
    async def synthesize(self, text: str, voice_id: str = "default", speed: float = 1.0) -> bytes:
        try:
            import edge_tts
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
                id="female_2",
                name="Edge Jenny",
                language="en",
                gender="female",
                engine="edge_tts",
                description="Microsoft Jenny neural voice"
            ),
            VoiceInfo(
                id="male_1",
                name="Edge Guy",
                language="en",
                gender="male",
                engine="edge_tts",
                description="Microsoft Guy neural voice"
            ),
            VoiceInfo(
                id="male_2",
                name="Edge Davis",
                language="en",
                gender="male",
                engine="edge_tts",
                description="Microsoft Davis neural voice"
            )
        ]

# Fallback engines (same as before)
class GTTSEngine(TTSEngine):
    def __init__(self):
        super().__init__("gtts")
        
    def _initialize(self):
        try:
            from gtts import gTTS
            self.available = True
            logger.info("gTTS engine initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize gTTS engine: {str(e)}")
            self.available = False
    
    async def synthesize(self, text: str, voice_id: str = "default", speed: float = 1.0) -> bytes:
        try:
            from gtts import gTTS
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

class ESpeakEngine(TTSEngine):
    def __init__(self):
        super().__init__("espeak")
        
    def _initialize(self):
        try:
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
            wpm = int(175 * speed)
            
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
                cmd = ['espeak', '-w', tmp_file.name, '-s', str(wpm), text]
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

# Initialize engines in priority order (GPU-optimized first)
engines = []

# Add GPU-accelerated engines first
silero_engine = SileroEngine()
if silero_engine.available:
    engines.append(silero_engine)

coqui_engine = CoquiEngine()
if coqui_engine.available:
    engines.append(coqui_engine)

# Add cloud engines
edge_tts_engine = EdgeTTSEngine()
if edge_tts_engine.available:
    engines.append(edge_tts_engine)

gtts_engine = GTTSEngine()
if gtts_engine.available:
    engines.append(gtts_engine)

# Add offline fallback
espeak_engine = ESpeakEngine()
if espeak_engine.available:
    engines.append(espeak_engine)

logger.info(f"Initialized {len(engines)} TTS engines: {[e.name for e in engines]}")
if torch.cuda.is_available():
    logger.info("🚀 GPU acceleration enabled for neural TTS models")

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    gpu_info = {}
    if torch.cuda.is_available():
        gpu_info = {
            "gpu_available": True,
            "gpu_name": torch.cuda.get_device_name(),
            "cuda_version": torch.version.cuda,
            "gpu_memory_gb": round(torch.cuda.get_device_properties(0).total_memory / 1024**3, 1)
        }
    
    return {
        "status": "healthy",
        "engines": [{"name": e.name, "available": e.available} for e in engines],
        "primary_engine": engines[0].name if engines else "none",
        "gpu_info": gpu_info,
        "device": str(DEVICE)
    }

@app.post("/synthesize")
async def synthesize_text(request: TTSRequest):
    """Synthesize text to speech using the best available engine."""
    
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")
    
    last_error = None
    
    # Try engines in priority order
    for engine in engines:
        if not engine.available:
            continue
            
        try:
            logger.info(f"Attempting synthesis with {engine.name}")
            audio_data = await engine.synthesize(
                request.text, 
                request.voice_id, 
                request.speed
            )
            
            logger.info(f"Successfully synthesized with {engine.name}")
            return Response(
                content=audio_data,
                media_type="audio/wav",
                headers={
                    "X-Engine-Used": engine.name,
                    "X-Voice-ID": request.voice_id,
                    "X-GPU-Accelerated": str(engine.name in ["silero", "coqui"] and torch.cuda.is_available())
                }
            )
            
        except Exception as e:
            last_error = str(e)
            logger.warning(f"Engine {engine.name} failed: {str(e)}")
            continue
    
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
        "engine_count": len([e for e in engines if e.available]),
        "gpu_accelerated": torch.cuda.is_available()
    }

@app.get("/engines")
async def list_engines():
    """List all TTS engines and their status."""
    return {
        "engines": [
            {
                "name": e.name,
                "available": e.available,
                "voice_count": len(e.get_voices()) if e.available else 0,
                "gpu_accelerated": e.name in ["silero", "coqui"] and torch.cuda.is_available()
            }
            for e in engines
        ],
        "gpu_info": {
            "available": torch.cuda.is_available(),
            "device": str(DEVICE)
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8005) 