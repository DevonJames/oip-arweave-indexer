#!/usr/bin/env python3
"""
Enhanced Whisper STT Service with Silero VAD Integration
Supports Whisper Large v3 Turbo with advanced preprocessing
"""

import os
import io
import base64
import tempfile
import logging
import asyncio
import time
from typing import Optional, Dict, Any, List, Tuple
import numpy as np
import torch
import torchaudio
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel
from pydantic import BaseModel
import requests

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "large-v3-turbo")
MODEL_PATH = os.getenv("MODEL_STORAGE_PATH", "/app/models")
DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8_float16")

# VAD Configuration
VAD_ENABLED = os.getenv("VAD_ENABLED", "false").lower() == "true"
VAD_THRESHOLD = float(os.getenv("VAD_THRESHOLD", "0.5"))
VAD_MIN_SPEECH_MS = int(os.getenv("VAD_MIN_SPEECH_MS", "200"))
VAD_MIN_SILENCE_MS = int(os.getenv("VAD_MIN_SILENCE_MS", "300"))

# Smart Turn Integration
SMART_TURN_ENABLED = os.getenv("SMART_TURN_ENABLED", "false").lower() == "true"
SMART_TURN_URL = os.getenv("SMART_TURN_URL", "http://smart-turn:8000")

app = FastAPI(title="Enhanced Whisper STT Service", version="2.0.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global models
whisper_model = None
vad_model = None
vad_utils = None

class TranscriptionRequest(BaseModel):
    audio_data: str  # Base64 encoded audio
    language: Optional[str] = None
    task: str = "transcribe"
    use_vad: bool = True
    use_smart_turn: bool = True

class EnhancedTranscriptionResponse(BaseModel):
    text: str
    language: str
    duration: float
    segments: List[Dict] = []
    # Enhanced features
    vad_used: bool = False
    vad_speech_ratio: Optional[float] = None
    processing_time_ms: float = 0
    smart_turn_prediction: Optional[Dict] = None
    model_version: str = ""
    engine: str = "enhanced-whisper"

class VADProcessor:
    """Silero VAD processor for speech activity detection."""
    
    def __init__(self):
        self.model = None
        self.utils = None
        self.sample_rate = 16000
        self.loaded = False
    
    def load_model(self):
        """Load Silero VAD model."""
        try:
            model_path = os.path.join(MODEL_PATH, "silero_vad", "model.pt")
            utils_path = os.path.join(MODEL_PATH, "silero_vad", "utils.pt")
            
            if os.path.exists(model_path) and os.path.exists(utils_path):
                # Load local model files
                logger.info("Loading local Silero VAD model...")
                
                # Create model architecture
                self.model, self.utils = torch.hub.load(
                    repo_or_dir='snakers4/silero-vad',
                    model='silero_vad',
                    force_reload=False,
                    onnx=False
                )
                
                # Load saved state
                self.model.load_state_dict(torch.load(model_path, map_location='cpu'))
                self.model.eval()
                
                self.loaded = True
                logger.info("Silero VAD model loaded successfully (local)")
                
            else:
                # Download model if not available locally
                logger.info("Downloading Silero VAD model...")
                self.model, self.utils = torch.hub.load(
                    repo_or_dir='snakers4/silero-vad',
                    model='silero_vad',
                    force_reload=True,
                    onnx=False
                )
                
                # Save model for future offline use
                os.makedirs(os.path.dirname(model_path), exist_ok=True)
                torch.save(self.model.state_dict(), model_path)
                torch.save(self.utils, utils_path)
                
                self.loaded = True
                logger.info("Silero VAD model downloaded and cached")
                
        except Exception as e:
            logger.error(f"Failed to load VAD model: {e}")
            self.loaded = False
    
    def detect_speech_segments(self, audio: np.ndarray, sample_rate: int = 16000) -> List[Dict]:
        """Detect speech segments in audio."""
        if not self.loaded:
            return []
        
        try:
            # Resample to 16kHz if needed
            if sample_rate != self.sample_rate:
                audio = self._resample_audio(audio, sample_rate, self.sample_rate)
            
            # Convert to torch tensor
            audio_tensor = torch.from_numpy(audio).float()
            
            # Get speech timestamps
            speech_timestamps = self.utils[0](
                audio_tensor,
                self.model,
                threshold=VAD_THRESHOLD,
                min_speech_duration_ms=VAD_MIN_SPEECH_MS,
                min_silence_duration_ms=VAD_MIN_SILENCE_MS,
                window_size_samples=512,
                speech_pad_ms=30
            )
            
            # Convert to segments
            segments = []
            for timestamp in speech_timestamps:
                segments.append({
                    'start': timestamp['start'] / self.sample_rate,
                    'end': timestamp['end'] / self.sample_rate,
                    'confidence': 1.0  # VAD doesn't provide confidence scores
                })
            
            return segments
            
        except Exception as e:
            logger.error(f"VAD processing failed: {e}")
            return []
    
    def _resample_audio(self, audio: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
        """Resample audio to target sample rate."""
        try:
            audio_tensor = torch.from_numpy(audio).float().unsqueeze(0)
            resampled = torchaudio.transforms.Resample(orig_sr, target_sr)(audio_tensor)
            return resampled.squeeze(0).numpy()
        except Exception as e:
            logger.error(f"Audio resampling failed: {e}")
            return audio
    
    def extract_speech_audio(self, audio: np.ndarray, segments: List[Dict], sample_rate: int = 16000) -> np.ndarray:
        """Extract only speech segments from audio."""
        if not segments:
            return audio
        
        speech_audio = []
        for segment in segments:
            start_sample = int(segment['start'] * sample_rate)
            end_sample = int(segment['end'] * sample_rate)
            speech_audio.append(audio[start_sample:end_sample])
        
        if speech_audio:
            return np.concatenate(speech_audio)
        else:
            return audio

class EnhancedWhisperService:
    """Enhanced Whisper service with VAD and Smart Turn integration."""
    
    def __init__(self):
        self.whisper_model = None
        self.vad_processor = VADProcessor() if VAD_ENABLED else None
        self.model_loaded = False
    
    async def load_models(self):
        """Load Whisper and VAD models."""
        try:
            # Load Whisper model
            logger.info(f"Loading Whisper model: {WHISPER_MODEL}")
            logger.info(f"Device: {DEVICE}, Compute type: {COMPUTE_TYPE}")
            
            self.whisper_model = WhisperModel(
                WHISPER_MODEL,
                device=DEVICE,
                compute_type=COMPUTE_TYPE,
                download_root=os.path.join(MODEL_PATH, "whisper")
            )
            
            # Load VAD model if enabled
            if self.vad_processor:
                self.vad_processor.load_model()
            
            self.model_loaded = True
            logger.info("Enhanced Whisper service initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to load models: {e}")
            raise
    
    async def transcribe_with_enhancements(
        self, 
        audio_data: bytes, 
        language: Optional[str] = None,
        task: str = "transcribe",
        use_vad: bool = True,
        use_smart_turn: bool = True
    ) -> EnhancedTranscriptionResponse:
        """Transcribe audio with VAD and Smart Turn enhancements."""
        start_time = time.time()
        
        if not self.model_loaded:
            raise HTTPException(status_code=503, detail="Models not loaded")
        
        try:
            # Save audio to temporary file
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_file:
                tmp_file.write(audio_data)
                tmp_file_path = tmp_file.name
            
            vad_used = False
            vad_speech_ratio = None
            smart_turn_prediction = None
            
            try:
                # Load audio for VAD processing
                if use_vad and self.vad_processor and self.vad_processor.loaded:
                    logger.info("Applying VAD preprocessing...")
                    
                    # Load audio as numpy array
                    audio, sample_rate = torchaudio.load(tmp_file_path)
                    audio = audio.squeeze(0).numpy()
                    
                    # Detect speech segments
                    speech_segments = self.vad_processor.detect_speech_segments(audio, sample_rate)
                    
                    if speech_segments:
                        # Extract speech audio
                        speech_audio = self.vad_processor.extract_speech_audio(audio, speech_segments, sample_rate)
                        
                        # Calculate speech ratio
                        vad_speech_ratio = len(speech_audio) / len(audio)
                        
                        # Save processed audio
                        processed_path = tmp_file_path.replace('.wav', '_vad.wav')
                        torchaudio.save(
                            processed_path, 
                            torch.from_numpy(speech_audio).unsqueeze(0), 
                            sample_rate
                        )
                        
                        # Use processed audio for transcription
                        tmp_file_path = processed_path
                        vad_used = True
                        
                        logger.info(f"VAD processing: {len(speech_segments)} segments, {vad_speech_ratio:.2%} speech")
                
                # Transcribe with Whisper
                segments, info = self.whisper_model.transcribe(
                    tmp_file_path,
                    language=language,
                    task=task
                )
                
                # Process segments
                text_segments = []
                full_text = ""
                
                for segment in segments:
                    segment_data = {
                        "start": segment.start,
                        "end": segment.end,
                        "text": segment.text.strip(),
                        "avg_logprob": segment.avg_logprob,
                        "no_speech_prob": segment.no_speech_prob
                    }
                    text_segments.append(segment_data)
                    full_text += segment.text.strip() + " "
                
                full_text = full_text.strip()
                
                # Smart Turn prediction if enabled
                if use_smart_turn and SMART_TURN_ENABLED and full_text:
                    try:
                        smart_turn_prediction = await self._predict_smart_turn(audio_data, full_text)
                    except Exception as e:
                        logger.warning(f"Smart Turn prediction failed: {e}")
                
                processing_time = (time.time() - start_time) * 1000
                
                return EnhancedTranscriptionResponse(
                    text=full_text,
                    language=info.language,
                    duration=info.duration,
                    segments=text_segments,
                    vad_used=vad_used,
                    vad_speech_ratio=vad_speech_ratio,
                    processing_time_ms=processing_time,
                    smart_turn_prediction=smart_turn_prediction,
                    model_version=WHISPER_MODEL,
                    engine="enhanced-whisper"
                )
                
            finally:
                # Clean up temporary files
                for path in [tmp_file_path, tmp_file_path.replace('.wav', '_vad.wav')]:
                    if os.path.exists(path):
                        try:
                            os.unlink(path)
                        except:
                            pass
                            
        except Exception as e:
            processing_time = (time.time() - start_time) * 1000
            logger.error(f"Enhanced transcription failed after {processing_time:.1f}ms: {e}")
            raise HTTPException(status_code=500, detail=f"Transcription error: {str(e)}")
    
    async def _predict_smart_turn(self, audio_data: bytes, transcript: str) -> Optional[Dict]:
        """Get Smart Turn prediction for endpoint detection."""
        try:
            # Prepare request to Smart Turn service
            files = {'audio_file': ('audio.wav', audio_data, 'audio/wav')}
            data = {'transcript': transcript}
            
            response = requests.post(
                f"{SMART_TURN_URL}/predict_endpoint",
                files=files,
                data=data,
                timeout=10
            )
            
            if response.status_code == 200:
                result = response.json()
                return {
                    'prediction': result.get('prediction'),
                    'probability': result.get('probability'),
                    'processing_time_ms': result.get('processing_time_ms'),
                    'is_complete': result.get('prediction') == 1
                }
            else:
                logger.warning(f"Smart Turn service returned {response.status_code}")
                
        except Exception as e:
            logger.warning(f"Smart Turn prediction failed: {e}")
        
        return None

# Global service instance
enhanced_service = EnhancedWhisperService()

@app.on_event("startup")
async def startup_event():
    """Initialize enhanced service on startup."""
    logger.info("🚀 Starting Enhanced Whisper STT Service...")
    logger.info(f"Configuration: Model={WHISPER_MODEL}, Device={DEVICE}, VAD={VAD_ENABLED}")
    
    try:
        await enhanced_service.load_models()
        logger.info("✅ Enhanced Whisper STT Service started successfully")
    except Exception as e:
        logger.error(f"❌ Failed to start Enhanced Whisper STT Service: {e}")
        raise

@app.get("/health")
async def health_check():
    """Enhanced health check endpoint."""
    vad_status = "disabled"
    if VAD_ENABLED:
        if enhanced_service.vad_processor and enhanced_service.vad_processor.loaded:
            vad_status = "enabled"
        else:
            vad_status = "error"
    
    return {
        "status": "healthy" if enhanced_service.model_loaded else "unhealthy",
        "model": WHISPER_MODEL,
        "device": DEVICE,
        "model_loaded": enhanced_service.model_loaded,
        "vad_enabled": VAD_ENABLED,
        "vad_status": vad_status,
        "smart_turn_enabled": SMART_TURN_ENABLED,
        "version": "2.0.0",
        "features": {
            "vad_preprocessing": VAD_ENABLED,
            "smart_turn_integration": SMART_TURN_ENABLED,
            "large_v3_turbo": WHISPER_MODEL == "large-v3-turbo"
        }
    }

@app.post("/transcribe_file", response_model=EnhancedTranscriptionResponse)
async def transcribe_file(
    file: UploadFile = File(...),
    language: Optional[str] = Form(None),
    task: str = Form("transcribe"),
    use_vad: bool = Form(True),
    use_smart_turn: bool = Form(True)
):
    """Enhanced transcription with VAD and Smart Turn."""
    try:
        audio_content = await file.read()
        
        return await enhanced_service.transcribe_with_enhancements(
            audio_data=audio_content,
            language=language,
            task=task,
            use_vad=use_vad,
            use_smart_turn=use_smart_turn
        )
        
    except Exception as e:
        logger.error(f"File transcription error: {e}")
        raise HTTPException(status_code=500, detail=f"Transcription error: {str(e)}")

@app.post("/transcribe_base64", response_model=EnhancedTranscriptionResponse)
async def transcribe_base64(request: TranscriptionRequest):
    """Enhanced transcription from base64 audio."""
    try:
        audio_data = base64.b64decode(request.audio_data)
        
        return await enhanced_service.transcribe_with_enhancements(
            audio_data=audio_data,
            language=request.language,
            task=request.task,
            use_vad=request.use_vad,
            use_smart_turn=request.use_smart_turn
        )
        
    except Exception as e:
        logger.error(f"Base64 transcription error: {e}")
        raise HTTPException(status_code=500, detail=f"Transcription error: {str(e)}")

@app.get("/models")
async def list_models():
    """List available models and features."""
    return {
        "whisper_model": WHISPER_MODEL,
        "device": DEVICE,
        "compute_type": COMPUTE_TYPE,
        "features": {
            "vad": {
                "enabled": VAD_ENABLED,
                "threshold": VAD_THRESHOLD,
                "min_speech_ms": VAD_MIN_SPEECH_MS,
                "min_silence_ms": VAD_MIN_SILENCE_MS
            },
            "smart_turn": {
                "enabled": SMART_TURN_ENABLED,
                "url": SMART_TURN_URL if SMART_TURN_ENABLED else None
            }
        },
        "supported_formats": ["wav", "mp3", "m4a", "flac", "ogg"],
        "supported_languages": "auto-detect + 100+ languages"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
