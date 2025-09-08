#!/usr/bin/env python3
"""
Kokoro TTS Service
High-quality neural text-to-speech with fallback engines
"""

import os
import io
import base64
import tempfile
import logging
import asyncio
import time
import hashlib
from typing import Optional, Dict, Any, List
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
import soundfile as sf

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
TTS_PRIMARY_ENGINE = os.getenv("TTS_PRIMARY_ENGINE", "kokoro")
TTS_FALLBACK_ENGINES = os.getenv("TTS_FALLBACK_ENGINES", "coqui,piper,espeak").split(",")
MODEL_STORAGE_PATH = os.getenv("MODEL_STORAGE_PATH", "/app/models")
CACHE_ENABLED = os.getenv("CACHE_ENABLED", "true").lower() == "true"
CACHE_DIR = os.getenv("CACHE_DIR", "/app/cache")

# Voice Configuration
DEFAULT_VOICE = os.getenv("DEFAULT_VOICE", "en_female_01")
SAMPLE_RATE = int(os.getenv("SAMPLE_RATE", "22050"))
AUDIO_FORMAT = os.getenv("AUDIO_FORMAT", "wav")

app = FastAPI(title="Kokoro TTS Service", version="1.0.0")

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
    voice: Optional[str] = None
    language: Optional[str] = "en"
    speed: Optional[float] = 1.0
    engine: Optional[str] = None
    format: Optional[str] = "wav"

class TTSResponse(BaseModel):
    audio_data: str  # Base64 encoded audio
    text: str
    voice: str
    language: str
    engine: str
    processing_time_ms: float
    audio_duration_ms: float
    format: str
    sample_rate: int
    cached: bool = False

class TTSEngine:
    """Base class for TTS engines."""
    
    def __init__(self, name: str):
        self.name = name
        self.loaded = False
        self.sample_rate = SAMPLE_RATE
    
    async def load_model(self):
        """Load the TTS model."""
        raise NotImplementedError
    
    async def synthesize(self, text: str, voice: str = None, **kwargs) -> np.ndarray:
        """Synthesize speech from text."""
        raise NotImplementedError
    
    def is_available(self) -> bool:
        """Check if engine is available and loaded."""
        return self.loaded

class KokoroEngine(TTSEngine):
    """Kokoro TTS Engine (Mock implementation for development)."""
    
    def __init__(self):
        super().__init__("kokoro")
        self.model = None
    
    async def load_model(self):
        """Load Kokoro TTS model."""
        try:
            logger.info("Loading Kokoro TTS model...")
            
            # Mock implementation - in production, this would load the actual Kokoro model
            # from transformers import AutoModel, AutoTokenizer
            # self.model = AutoModel.from_pretrained("kokoro-tts/model")
            # self.tokenizer = AutoTokenizer.from_pretrained("kokoro-tts/model")
            
            # For now, use a mock model
            self.model = "kokoro-mock-model"
            self.loaded = True
            
            logger.info("✅ Kokoro TTS model loaded successfully")
            
        except Exception as e:
            logger.error(f"Failed to load Kokoro TTS model: {e}")
            self.loaded = False
    
    async def synthesize(self, text: str, voice: str = None, **kwargs) -> np.ndarray:
        """Synthesize speech using Kokoro TTS."""
        if not self.loaded:
            raise RuntimeError("Kokoro model not loaded")
        
        try:
            # Mock synthesis - generates sine wave audio based on text
            duration = max(len(text) * 0.1, 1.0)  # Rough duration estimate
            samples = int(duration * self.sample_rate)
            
            # Generate mock audio (sine wave with text-based frequency)
            frequency = 200 + (hash(text) % 400)  # 200-600 Hz based on text
            t = np.linspace(0, duration, samples)
            
            # Create a more natural-sounding mock audio
            audio = np.sin(2 * np.pi * frequency * t) * 0.5
            audio += np.sin(2 * np.pi * frequency * 1.5 * t) * 0.3
            audio *= np.exp(-t * 0.5)  # Fade out
            
            logger.info(f"Kokoro synthesis: {len(text)} chars → {duration:.1f}s audio")
            return audio
            
        except Exception as e:
            logger.error(f"Kokoro synthesis failed: {e}")
            raise RuntimeError(f"Kokoro synthesis failed: {e}")

class CoquiEngine(TTSEngine):
    """Coqui TTS Engine for high-quality synthesis."""
    
    def __init__(self):
        super().__init__("coqui")
        self.tts = None
    
    async def load_model(self):
        """Load Coqui TTS model."""
        try:
            logger.info("Loading Coqui TTS model...")
            
            from TTS.api import TTS
            
            # Use a fast, high-quality model
            self.tts = TTS(model_name="tts_models/en/ljspeech/tacotron2-DDC", 
                          progress_bar=False)
            
            self.loaded = True
            logger.info("✅ Coqui TTS model loaded successfully")
            
        except Exception as e:
            logger.error(f"Failed to load Coqui TTS model: {e}")
            self.loaded = False
    
    async def synthesize(self, text: str, voice: str = None, **kwargs) -> np.ndarray:
        """Synthesize speech using Coqui TTS."""
        if not self.loaded:
            raise RuntimeError("Coqui model not loaded")
        
        try:
            # Create temporary file for Coqui output
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_file:
                tmp_path = tmp_file.name
            
            # Synthesize with Coqui
            self.tts.tts_to_file(text=text, file_path=tmp_path)
            
            # Load generated audio
            audio, sr = sf.read(tmp_path)
            
            # Resample if needed
            if sr != self.sample_rate:
                import librosa
                audio = librosa.resample(audio, orig_sr=sr, target_sr=self.sample_rate)
            
            # Clean up
            os.unlink(tmp_path)
            
            logger.info(f"Coqui synthesis: {len(text)} chars → {len(audio)/self.sample_rate:.1f}s audio")
            return audio
            
        except Exception as e:
            logger.error(f"Coqui synthesis failed: {e}")
            raise RuntimeError(f"Coqui synthesis failed: {e}")

class PiperEngine(TTSEngine):
    """Piper TTS Engine for fast synthesis."""
    
    def __init__(self):
        super().__init__("piper")
        self.piper = None
    
    async def load_model(self):
        """Load Piper TTS model."""
        try:
            logger.info("Loading Piper TTS model...")
            
            # Mock Piper implementation
            # In production: import piper
            # self.piper = piper.PiperTTS(model_path="...")
            
            self.piper = "piper-mock-model"
            self.loaded = True
            logger.info("✅ Piper TTS model loaded successfully")
            
        except Exception as e:
            logger.error(f"Failed to load Piper TTS model: {e}")
            self.loaded = False
    
    async def synthesize(self, text: str, voice: str = None, **kwargs) -> np.ndarray:
        """Synthesize speech using Piper TTS."""
        if not self.loaded:
            raise RuntimeError("Piper model not loaded")
        
        try:
            # Mock fast synthesis
            duration = len(text) * 0.08  # Faster than Kokoro
            samples = int(duration * self.sample_rate)
            
            # Generate mock audio with different characteristics
            frequency = 150 + (hash(text) % 300)  # 150-450 Hz
            t = np.linspace(0, duration, samples)
            
            # Piper-style mock audio (more robotic)
            audio = np.sin(2 * np.pi * frequency * t) * 0.6
            audio += np.random.normal(0, 0.1, samples) * 0.2  # Add some noise
            
            logger.info(f"Piper synthesis: {len(text)} chars → {duration:.1f}s audio")
            return audio
            
        except Exception as e:
            logger.error(f"Piper synthesis failed: {e}")
            raise RuntimeError(f"Piper synthesis failed: {e}")

class EspeakEngine(TTSEngine):
    """eSpeak NG Engine for fallback synthesis."""
    
    def __init__(self):
        super().__init__("espeak")
        self.espeak_available = False
    
    async def load_model(self):
        """Check if eSpeak NG is available."""
        try:
            import subprocess
            result = subprocess.run(["espeak", "--version"], 
                                  capture_output=True, text=True, timeout=5)
            if result.returncode == 0:
                self.espeak_available = True
                self.loaded = True
                logger.info("✅ eSpeak NG available")
            else:
                logger.warning("eSpeak NG not available")
        except Exception as e:
            logger.warning(f"eSpeak NG check failed: {e}")
            self.loaded = False
    
    async def synthesize(self, text: str, voice: str = None, **kwargs) -> np.ndarray:
        """Synthesize speech using eSpeak NG."""
        if not self.loaded:
            raise RuntimeError("eSpeak not available")
        
        try:
            import subprocess
            
            # Use eSpeak to generate audio
            cmd = [
                "espeak",
                "-s", "150",  # Speed
                "-v", "en",   # Voice
                "-w", "/dev/stdout",  # Output to stdout
                text
            ]
            
            result = subprocess.run(cmd, capture_output=True, timeout=30)
            
            if result.returncode == 0:
                # Load audio from bytes
                audio_bytes = io.BytesIO(result.stdout)
                audio, sr = sf.read(audio_bytes)
                
                # Resample if needed
                if sr != self.sample_rate:
                    import librosa
                    audio = librosa.resample(audio, orig_sr=sr, target_sr=self.sample_rate)
                
                logger.info(f"eSpeak synthesis: {len(text)} chars")
                return audio
            else:
                raise RuntimeError("eSpeak synthesis failed")
                
        except Exception as e:
            logger.error(f"eSpeak synthesis failed: {e}")
            raise RuntimeError(f"eSpeak synthesis failed: {e}")

class KokoroTTSService:
    """Main Kokoro TTS service with fallback engines."""
    
    def __init__(self):
        self.engines = {}
        self.cache = {}
        self.primary_engine = TTS_PRIMARY_ENGINE
        self.fallback_engines = TTS_FALLBACK_ENGINES
        
        # Initialize engines
        self.engines["kokoro"] = KokoroEngine()
        self.engines["coqui"] = CoquiEngine()
        self.engines["piper"] = PiperEngine()
        self.engines["espeak"] = EspeakEngine()
    
    async def load_engines(self):
        """Load all available TTS engines."""
        logger.info("Loading TTS engines...")
        
        for name, engine in self.engines.items():
            try:
                await engine.load_model()
                if engine.is_available():
                    logger.info(f"✅ {name} engine loaded successfully")
                else:
                    logger.warning(f"⚠️ {name} engine failed to load")
            except Exception as e:
                logger.error(f"❌ {name} engine error: {e}")
    
    def get_cache_key(self, text: str, voice: str, engine: str) -> str:
        """Generate cache key for TTS request."""
        content = f"{text}|{voice}|{engine}"
        return hashlib.md5(content.encode()).hexdigest()
    
    async def synthesize_with_fallback(
        self, 
        text: str, 
        voice: str = None, 
        engine: str = None,
        **kwargs
    ) -> Dict[str, Any]:
        """Synthesize speech with fallback engines."""
        start_time = time.time()
        
        # Determine engine order
        if engine and engine in self.engines:
            engine_order = [engine] + [e for e in self.fallback_engines if e != engine]
        else:
            engine_order = [self.primary_engine] + self.fallback_engines
        
        # Check cache first
        cache_key = None
        if CACHE_ENABLED:
            cache_key = self.get_cache_key(text, voice or DEFAULT_VOICE, engine_order[0])
            if cache_key in self.cache:
                logger.info(f"Cache hit for: {text[:50]}...")
                cached_result = self.cache[cache_key].copy()
                cached_result["cached"] = True
                cached_result["processing_time_ms"] = (time.time() - start_time) * 1000
                return cached_result
        
        # Try engines in order
        last_error = None
        for engine_name in engine_order:
            if engine_name not in self.engines:
                continue
                
            engine_obj = self.engines[engine_name]
            if not engine_obj.is_available():
                continue
            
            try:
                logger.info(f"Attempting synthesis with {engine_name}...")
                
                # Synthesize audio
                audio = await engine_obj.synthesize(
                    text=text,
                    voice=voice or DEFAULT_VOICE,
                    **kwargs
                )
                
                # Convert to bytes
                audio_bytes = io.BytesIO()
                sf.write(audio_bytes, audio, engine_obj.sample_rate, format='WAV')
                audio_bytes.seek(0)
                
                # Encode to base64
                audio_b64 = base64.b64encode(audio_bytes.read()).decode()
                
                processing_time = (time.time() - start_time) * 1000
                duration_ms = (len(audio) / engine_obj.sample_rate) * 1000
                
                result = {
                    "audio_data": audio_b64,
                    "text": text,
                    "voice": voice or DEFAULT_VOICE,
                    "language": kwargs.get("language", "en"),
                    "engine": engine_name,
                    "processing_time_ms": processing_time,
                    "audio_duration_ms": duration_ms,
                    "format": "wav",
                    "sample_rate": engine_obj.sample_rate,
                    "cached": False
                }
                
                # Cache result
                if CACHE_ENABLED and cache_key:
                    self.cache[cache_key] = result.copy()
                    
                    # Limit cache size
                    if len(self.cache) > 100:
                        # Remove oldest entry
                        oldest_key = next(iter(self.cache))
                        del self.cache[oldest_key]
                
                logger.info(f"✅ Synthesis successful with {engine_name} in {processing_time:.1f}ms")
                return result
                
            except Exception as e:
                logger.warning(f"❌ {engine_name} synthesis failed: {e}")
                last_error = e
                continue
        
        # All engines failed
        processing_time = (time.time() - start_time) * 1000
        error_msg = f"All TTS engines failed. Last error: {last_error}"
        logger.error(error_msg)
        raise HTTPException(status_code=500, detail=error_msg)

# Global service instance
kokoro_service = KokoroTTSService()

@app.on_event("startup")
async def startup_event():
    """Initialize Kokoro TTS service on startup."""
    logger.info("🚀 Starting Kokoro TTS Service...")
    logger.info(f"Primary engine: {TTS_PRIMARY_ENGINE}")
    logger.info(f"Fallback engines: {TTS_FALLBACK_ENGINES}")
    
    try:
        await kokoro_service.load_engines()
        logger.info("✅ Kokoro TTS Service started successfully")
    except Exception as e:
        logger.error(f"❌ Failed to start Kokoro TTS Service: {e}")
        raise

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    engine_status = {}
    for name, engine in kokoro_service.engines.items():
        engine_status[name] = {
            "loaded": engine.is_available(),
            "name": engine.name
        }
    
    available_engines = [name for name, engine in kokoro_service.engines.items() 
                        if engine.is_available()]
    
    return {
        "status": "healthy" if available_engines else "unhealthy",
        "primary_engine": TTS_PRIMARY_ENGINE,
        "fallback_engines": TTS_FALLBACK_ENGINES,
        "available_engines": available_engines,
        "engine_status": engine_status,
        "cache_enabled": CACHE_ENABLED,
        "cache_size": len(kokoro_service.cache),
        "version": "1.0.0",
        "features": {
            "high_quality_synthesis": "kokoro" in available_engines,
            "fast_synthesis": "piper" in available_engines,
            "fallback_synthesis": "espeak" in available_engines,
            "caching": CACHE_ENABLED
        }
    }

@app.post("/synthesize", response_model=TTSResponse)
async def synthesize_text(request: TTSRequest):
    """Synthesize text to speech."""
    try:
        result = await kokoro_service.synthesize_with_fallback(
            text=request.text,
            voice=request.voice,
            engine=request.engine,
            language=request.language,
            speed=request.speed
        )
        
        return TTSResponse(**result)
        
    except Exception as e:
        logger.error(f"TTS synthesis error: {e}")
        raise HTTPException(status_code=500, detail=f"Synthesis error: {str(e)}")

@app.post("/synthesize_to_file")
async def synthesize_to_file(request: TTSRequest):
    """Synthesize text to speech and return as audio file."""
    try:
        result = await kokoro_service.synthesize_with_fallback(
            text=request.text,
            voice=request.voice,
            engine=request.engine,
            language=request.language,
            speed=request.speed
        )
        
        # Decode audio data
        audio_bytes = base64.b64decode(result["audio_data"])
        
        # Return as audio response
        return Response(
            content=audio_bytes,
            media_type="audio/wav",
            headers={
                "Content-Disposition": "attachment; filename=synthesis.wav",
                "X-Engine": result["engine"],
                "X-Processing-Time": str(result["processing_time_ms"]),
                "X-Duration": str(result["audio_duration_ms"])
            }
        )
        
    except Exception as e:
        logger.error(f"TTS file synthesis error: {e}")
        raise HTTPException(status_code=500, detail=f"Synthesis error: {str(e)}")

@app.get("/engines")
async def list_engines():
    """List available TTS engines and their status."""
    engines_info = {}
    
    for name, engine in kokoro_service.engines.items():
        engines_info[name] = {
            "name": engine.name,
            "available": engine.is_available(),
            "sample_rate": engine.sample_rate,
            "description": {
                "kokoro": "High-quality neural TTS with natural speech",
                "coqui": "Open-source TTS with multiple models",
                "piper": "Fast and lightweight TTS engine",
                "espeak": "Reliable fallback TTS engine"
            }.get(name, "TTS engine")
        }
    
    return {
        "primary_engine": TTS_PRIMARY_ENGINE,
        "fallback_engines": TTS_FALLBACK_ENGINES,
        "engines": engines_info,
        "total_engines": len(engines_info),
        "available_engines": len([e for e in engines_info.values() if e["available"]])
    }

@app.get("/voices")
async def list_voices():
    """List available voices for each engine."""
    return {
        "kokoro": [
            "en_female_01", "en_female_02", "en_male_01", "en_male_02"
        ],
        "coqui": [
            "ljspeech", "vctk", "mailabs"
        ],
        "piper": [
            "en_US-lessac-medium", "en_US-amy-medium", "en_GB-alan-medium"
        ],
        "espeak": [
            "en", "en-us", "en-gb", "es", "fr", "de"
        ]
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
