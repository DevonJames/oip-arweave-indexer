#!/usr/bin/env python3

import os
import io
import tempfile
import logging
import asyncio
from typing import Optional, Dict, Any, List
from abc import ABC, abstractmethod
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
import pyttsx3
import edge_tts
from gtts import gTTS
import subprocess

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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
    voice_id: str = "default"
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

# Chatterbox Engine (Primary - using pyttsx3)
class ChatterboxEngine(TTSEngine):
    def __init__(self):
        super().__init__("chatterbox")
        
    def _initialize(self):
        try:
            self.engine = pyttsx3.init()
            self.voice_configs = {
                "default": {"rate": 200, "volume": 0.9, "voice_id": 0},
                "female_1": {"rate": 180, "volume": 0.9, "voice_id": 0},
                "male_1": {"rate": 200, "volume": 0.9, "voice_id": 1},
                "expressive": {"rate": 220, "volume": 1.0, "voice_id": 0},
                "calm": {"rate": 160, "volume": 0.8, "voice_id": 0}
            }
            self.available = True
            logger.info("Chatterbox engine initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize Chatterbox engine: {str(e)}")
            self.available = False
    
    async def synthesize(self, text: str, voice_id: str = "default", speed: float = 1.0) -> bytes:
        try:
            config = self.voice_configs.get(voice_id, self.voice_configs["default"])
            
            # Configure voice properties
            voices = self.engine.getProperty('voices')
            if voices and len(voices) > config["voice_id"]:
                self.engine.setProperty('voice', voices[config["voice_id"]].id)
            
            # Apply speed and volume
            rate = int(config["rate"] * speed)
            self.engine.setProperty('rate', rate)
            self.engine.setProperty('volume', config["volume"])
            
            # Generate audio to temporary file
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
                self.engine.save_to_file(text, tmp_file.name)
                self.engine.runAndWait()
                
                # Read generated audio
                with open(tmp_file.name, 'rb') as f:
                    audio_data = f.read()
                
                os.unlink(tmp_file.name)
                return audio_data
                
        except Exception as e:
            logger.error(f"Chatterbox synthesis error: {str(e)}")
            raise
    
    def get_voices(self) -> List[VoiceInfo]:
        return [
            VoiceInfo(
                id="female_1", 
                name="Chatterbox Female",
                language="en",
                gender="female",
                engine="chatterbox",
                description="Natural female voice"
            ),
            VoiceInfo(
                id="male_1",
                name="Chatterbox Male", 
                language="en",
                gender="male",
                engine="chatterbox",
                description="Deep male voice"
            ),
            VoiceInfo(
                id="expressive",
                name="Chatterbox Expressive",
                language="en", 
                gender="neutral",
                engine="chatterbox",
                description="Expressive, dynamic voice"
            ),
            VoiceInfo(
                id="calm",
                name="Chatterbox Calm",
                language="en",
                gender="neutral",
                engine="chatterbox",
                description="Calm, soothing voice"
            )
        ]

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
if chatterbox_engine.available:
    engines.append(chatterbox_engine)

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
                    "X-Voice-ID": request.voice_id
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