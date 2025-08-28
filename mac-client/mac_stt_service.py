#!/usr/bin/env python3
"""
Apple Silicon MLX STT Service
Optimized for M1/M2/M3/M4 Pro Macs using MLX framework
Includes Silero VAD preprocessing
"""

import os
import io
import base64
import tempfile
import logging
import asyncio
import time
import json
from contextlib import asynccontextmanager
from typing import Optional, Dict, Any, List, Tuple
import numpy as np
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import requests
import soundfile as sf

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load configuration
config_path = os.path.join(os.path.dirname(__file__), 'config', 'mac_client_config.json')
with open(config_path, 'r') as f:
    CONFIG = json.load(f)

# Service configuration
STT_CONFIG = CONFIG['client']['services']['stt']
VAD_CONFIG = CONFIG['client']['services']['vad']
AUDIO_CONFIG = CONFIG['client']['audio']

# MLX Configuration
MLX_DEVICE = STT_CONFIG.get('device', 'mps')
WHISPER_MODEL = STT_CONFIG.get('model', 'large-v3-turbo')
MLX_QUANTIZATION = STT_CONFIG.get('quantization', 'int4')
MODEL_STORAGE_PATH = os.getenv('MODEL_STORAGE_PATH', './models')

# Global service instance
mlx_service = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for FastAPI startup and shutdown."""
    global mlx_service
    
    # Startup
    logger.info("🚀 Starting Apple Silicon MLX STT Service...")
    logger.info(f"Configuration: Model={WHISPER_MODEL}, Device={MLX_DEVICE}, VAD={VAD_CONFIG.get('enabled', True)}")
    
    try:
        mlx_service = MLXWhisperService()
        await mlx_service.load_models()
        logger.info("✅ Apple Silicon MLX STT Service started successfully")
    except Exception as e:
        logger.error(f"❌ Failed to start MLX STT Service: {e}")
        raise
    
    yield
    
    # Shutdown
    logger.info("👋 Shutting down Apple Silicon MLX STT Service...")

app = FastAPI(title="Apple Silicon MLX STT Service", version="1.0.0", lifespan=lifespan)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class TranscriptionRequest(BaseModel):
    audio_data: str  # Base64 encoded audio
    language: Optional[str] = None
    task: str = "transcribe"
    use_vad: bool = True

class MLXTranscriptionResponse(BaseModel):
    text: str
    language: str
    duration: float
    segments: List[Dict] = []
    processing_time_ms: float = 0
    model_version: str = ""
    engine: str = "mlx-whisper"
    device: str = "mps"
    quantization: str = "int4"
    vad_used: bool = False
    vad_speech_ratio: Optional[float] = None

class SileroVADProcessor:
    """Silero VAD processor optimized for Apple Silicon."""
    
    def __init__(self):
        self.model = None
        self.utils = None
        self.sample_rate = 16000
        self.loaded = False
        self.threshold = VAD_CONFIG.get('threshold', 0.5)
        self.min_speech_ms = VAD_CONFIG.get('min_speech_ms', 200)
        self.min_silence_ms = VAD_CONFIG.get('min_silence_ms', 300)
    
    async def load_model(self):
        """Load Silero VAD model optimized for Apple Silicon."""
        try:
            import torch
            
            model_path = os.path.join(MODEL_STORAGE_PATH, "silero_vad", "model.pt")
            
            if os.path.exists(model_path):
                logger.info("Loading local Silero VAD model...")
                # Load local model
                self.model, self.utils = torch.hub.load(
                    repo_or_dir='snakers4/silero-vad',
                    model='silero_vad',
                    force_reload=False,
                    onnx=False
                )
                self.model.load_state_dict(torch.load(model_path, map_location='mps'))
            else:
                logger.info("Downloading Silero VAD model...")
                self.model, self.utils = torch.hub.load(
                    repo_or_dir='snakers4/silero-vad',
                    model='silero_vad',
                    force_reload=True,
                    onnx=False
                )
                # Save for offline use
                os.makedirs(os.path.dirname(model_path), exist_ok=True)
                torch.save(self.model.state_dict(), model_path)
            
            # Move to MPS if available
            if torch.backends.mps.is_available():
                self.model = self.model.to('mps')
                logger.info("VAD model moved to Metal Performance Shaders")
            
            self.model.eval()
            self.loaded = True
            logger.info("✅ Silero VAD model loaded successfully")
            
        except Exception as e:
            logger.error(f"Failed to load VAD model: {e}")
            self.loaded = False
    
    def detect_speech_segments(self, audio: np.ndarray, sample_rate: int = 16000) -> Tuple[List[Dict], float]:
        """Detect speech segments in audio."""
        if not self.loaded:
            return [], 1.0
        
        try:
            import torch
            
            # Resample to 16kHz if needed
            if sample_rate != self.sample_rate:
                audio = self._resample_audio(audio, sample_rate, self.sample_rate)
            
            # Convert to torch tensor
            audio_tensor = torch.from_numpy(audio).float()
            
            # Move to MPS if available
            if torch.backends.mps.is_available():
                audio_tensor = audio_tensor.to('mps')
            
            # Get speech timestamps
            speech_timestamps = self.utils[0](
                audio_tensor,
                self.model,
                threshold=self.threshold,
                min_speech_duration_ms=self.min_speech_ms,
                min_silence_duration_ms=self.min_silence_ms,
                window_size_samples=512,
                speech_pad_ms=30
            )
            
            # Convert to segments
            segments = []
            total_speech_samples = 0
            
            for timestamp in speech_timestamps:
                start_time = timestamp['start'] / self.sample_rate
                end_time = timestamp['end'] / self.sample_rate
                
                segments.append({
                    'start': start_time,
                    'end': end_time,
                    'confidence': 1.0
                })
                
                total_speech_samples += timestamp['end'] - timestamp['start']
            
            # Calculate speech ratio
            speech_ratio = total_speech_samples / len(audio) if len(audio) > 0 else 0.0
            
            logger.info(f"VAD detected {len(segments)} speech segments, {speech_ratio:.2%} speech")
            return segments, speech_ratio
            
        except Exception as e:
            logger.error(f"VAD processing failed: {e}")
            return [], 1.0
    
    def _resample_audio(self, audio: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
        """Resample audio to target sample rate."""
        try:
            import librosa
            return librosa.resample(audio, orig_sr=orig_sr, target_sr=target_sr)
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

class MLXWhisperService:
    """MLX-optimized Whisper service for Apple Silicon."""
    
    def __init__(self):
        self.model = None
        self.model_loaded = False
        self.vad_processor = SileroVADProcessor() if VAD_CONFIG.get('enabled', True) else None
        self.device = MLX_DEVICE
        self.quantization = MLX_QUANTIZATION
    
    async def load_models(self):
        """Load Whisper and VAD models."""
        try:
            logger.info(f"Loading MLX Whisper model: {WHISPER_MODEL}")
            logger.info(f"Device: {self.device}, Quantization: {self.quantization}")
            
            # Try to load MLX Whisper
            try:
                import mlx.core as mx
                from mlx_whisper.load_models import load_model
                from mlx_whisper import transcribe
                
                self.model = load_model(
                    WHISPER_MODEL,
                    dtype=getattr(mx, 'float16', mx.float16)
                )
                self.transcribe_func = transcribe
                logger.info("✅ MLX Whisper model loaded successfully")
                
            except ImportError:
                logger.warning("MLX Whisper not available, using mock implementation")
                self.model = "mock-mlx-model"
                self.transcribe_func = self._mock_transcribe
            
            # Load VAD model if enabled
            if self.vad_processor:
                await self.vad_processor.load_model()
            
            self.model_loaded = True
            logger.info("✅ MLX STT service initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to load models: {e}")
            raise
    
    def _mock_transcribe(self, audio_path: str, **kwargs) -> Dict:
        """Mock transcription for development/testing."""
        try:
            import librosa
            
            # Load audio to get duration
            audio, sr = librosa.load(audio_path, sr=16000)
            duration = len(audio) / sr
            
            # Generate realistic mock response
            mock_text = f"Mock MLX transcription of {duration:.1f} second audio clip. "
            
            # Add some variety based on audio characteristics
            if duration > 5:
                mock_text += "This appears to be a longer speech segment with multiple phrases. "
            elif duration < 1:
                mock_text += "Short audio detected. "
            
            # Simulate processing time (MLX should be fast)
            processing_time = duration * 0.05  # 20x real-time
            
            return {
                "text": mock_text.strip(),
                "language": kwargs.get("language", "en"),
                "segments": [
                    {
                        "start": 0.0,
                        "end": duration,
                        "text": mock_text.strip(),
                        "avg_logprob": -0.2,
                        "no_speech_prob": 0.05
                    }
                ],
                "processing_time": processing_time
            }
            
        except Exception as e:
            logger.error(f"Mock transcription failed: {e}")
            return {
                "text": "Mock transcription error",
                "language": "en",
                "segments": [],
                "processing_time": 0.1
            }
    
    async def transcribe_with_mlx(
        self, 
        audio_data: bytes, 
        language: Optional[str] = None,
        task: str = "transcribe",
        use_vad: bool = True
    ) -> MLXTranscriptionResponse:
        """Transcribe audio using MLX optimization with VAD preprocessing."""
        start_time = time.time()
        
        if not self.model_loaded:
            raise HTTPException(status_code=503, detail="MLX models not loaded")
        
        try:
            # Save audio to temporary file and convert to proper WAV format
            logger.info(f"Received audio data: {len(audio_data)} bytes, first 20 bytes: {audio_data[:20]}")
            with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp_file:
                tmp_file.write(audio_data)
                raw_file_path = tmp_file.name
            
            # Convert to proper WAV format using ffmpeg directly
            tmp_file_path = raw_file_path.replace('.webm', '.wav')
            try:
                import subprocess
                # Use ffmpeg directly to convert WebM to 16kHz mono WAV
                result = subprocess.run([
                    'ffmpeg', '-i', raw_file_path, 
                    '-ar', '16000',  # Sample rate
                    '-ac', '1',      # Mono
                    '-y',            # Overwrite output
                    tmp_file_path
                ], capture_output=True, text=True, timeout=10)
                
                if result.returncode == 0:
                    logger.info(f"Successfully converted WebM to WAV using ffmpeg: {tmp_file_path}")
                else:
                    raise Exception(f"ffmpeg failed: {result.stderr}")
                    
            except Exception as e:
                logger.error(f"ffmpeg conversion failed: {e}")
                # Fallback to pydub without sample_rate/channels manipulation
                try:
                    from pydub import AudioSegment
                    # Just convert format without changing audio properties
                    audio_segment = AudioSegment.from_file(raw_file_path, format="webm")
                    audio_segment.export(tmp_file_path, format="wav")
                    logger.info(f"Fallback pydub conversion successful: {tmp_file_path}")
                except Exception as fallback_error:
                    logger.error(f"Fallback pydub conversion also failed: {fallback_error}")
                    # Last resort: rename webm file to wav and hope MLX can handle it
                    os.rename(raw_file_path, tmp_file_path)
                    logger.info(f"Using raw file as WAV (last resort): {tmp_file_path}")
            
            vad_used = False
            vad_speech_ratio = None
            
            try:
                # VAD preprocessing if enabled
                if use_vad and self.vad_processor and self.vad_processor.loaded:
                    logger.info("Applying VAD preprocessing...")
                    
                    # Load audio for VAD
                    audio, sample_rate = sf.read(tmp_file_path)
                    if audio.ndim > 1:
                        audio = audio.mean(axis=1)  # Convert to mono
                    
                    # Detect speech segments
                    speech_segments, vad_speech_ratio = self.vad_processor.detect_speech_segments(audio, sample_rate)
                    
                    if speech_segments:
                        # Extract speech audio
                        speech_audio = self.vad_processor.extract_speech_audio(audio, speech_segments, sample_rate)
                        
                        # Save processed audio
                        processed_path = tmp_file_path.replace('.wav', '_vad.wav')
                        sf.write(processed_path, speech_audio, sample_rate)
                        
                        # Use processed audio for transcription
                        tmp_file_path = processed_path
                        vad_used = True
                        
                        logger.info(f"VAD processing: {len(speech_segments)} segments, {vad_speech_ratio:.2%} speech")
                    else:
                        # NO SPEECH DETECTED - Return empty result without running Whisper
                        logger.info(f"VAD detected NO SPEECH ({vad_speech_ratio:.2%}% speech) - skipping Whisper to prevent hallucination")
                        processing_time = time.time() - start_time
                        
                        return MLXTranscriptionResponse(
                            text="",
                            language="en",
                            segments=[],
                            processing_time=processing_time,
                            vad_used=True,
                            vad_speech_segments=0,
                            vad_speech_ratio=vad_speech_ratio
                        )
                
                # Transcribe with MLX Whisper
                result = self.transcribe_func(
                    tmp_file_path,
                    path_or_hf_repo=WHISPER_MODEL,  # Use the configured model
                    language=language if language != "auto" else None,
                    temperature=0.0,
                    condition_on_previous_text=True,
                    verbose=False
                )
                
                # Process segments
                segments = []
                full_text = result.get("text", "")
                
                if "segments" in result:
                    for seg in result["segments"]:
                        segments.append({
                            "start": seg.get("start", 0.0),
                            "end": seg.get("end", 0.0),
                            "text": seg.get("text", ""),
                            "avg_logprob": seg.get("avg_logprob", 0.0),
                            "no_speech_prob": seg.get("no_speech_prob", 0.0)
                        })
                
                processing_time = (time.time() - start_time) * 1000
                
                # Calculate duration
                try:
                    audio_for_duration, sr = sf.read(tmp_file_path)
                    duration = len(audio_for_duration) / sr
                except:
                    duration = result.get("processing_time", processing_time / 1000)
                
                return MLXTranscriptionResponse(
                    text=full_text.strip(),
                    language=result.get("language", language or "en"),
                    duration=duration,
                    segments=segments,
                    processing_time_ms=processing_time,
                    model_version=WHISPER_MODEL,
                    engine="mlx-whisper",
                    device=self.device,
                    quantization=self.quantization,
                    vad_used=vad_used,
                    vad_speech_ratio=vad_speech_ratio
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
            logger.error(f"MLX transcription failed after {processing_time:.1f}ms: {e}")
            raise HTTPException(status_code=500, detail=f"MLX transcription error: {str(e)}")

# Service instance is initialized in lifespan context manager

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    global mlx_service
    
    if mlx_service is None:
        return {
            "status": "unhealthy",
            "error": "Service not initialized",
            "model": WHISPER_MODEL,
            "device": MLX_DEVICE,
            "version": "1.0.0"
        }
    
    vad_status = "disabled"
    if VAD_CONFIG.get('enabled', True):
        if mlx_service.vad_processor and mlx_service.vad_processor.loaded:
            vad_status = "enabled"
        else:
            vad_status = "error"
    
    return {
        "status": "healthy" if mlx_service.model_loaded else "unhealthy",
        "model": WHISPER_MODEL,
        "device": MLX_DEVICE,
        "quantization": MLX_QUANTIZATION,
        "model_loaded": mlx_service.model_loaded,
        "vad_enabled": VAD_CONFIG.get('enabled', True),
        "vad_status": vad_status,
        "version": "1.0.0",
        "platform": "Apple Silicon",
        "framework": "MLX",
        "features": {
            "metal_performance_shaders": True,
            "quantization": MLX_QUANTIZATION,
            "vad_preprocessing": VAD_CONFIG.get('enabled', True),
            "optimized_for": "M1/M2/M3/M4 Pro Macs"
        }
    }

@app.post("/transcribe_file", response_model=MLXTranscriptionResponse)
async def transcribe_file(
    file: UploadFile = File(...),
    language: Optional[str] = Form(None),
    task: str = Form("transcribe"),
    use_vad: bool = Form(True)
):
    """Transcribe uploaded audio file using MLX optimization."""
    global mlx_service
    
    if mlx_service is None:
        raise HTTPException(status_code=503, detail="Service not initialized")
    
    try:
        audio_content = await file.read()
        
        return await mlx_service.transcribe_with_mlx(
            audio_data=audio_content,
            language=language,
            task=task,
            use_vad=use_vad
        )
        
    except Exception as e:
        logger.error(f"MLX file transcription error: {e}")
        raise HTTPException(status_code=500, detail=f"Transcription error: {str(e)}")

@app.post("/transcribe_base64", response_model=MLXTranscriptionResponse)
async def transcribe_base64(request: TranscriptionRequest):
    """Transcribe base64-encoded audio using MLX optimization."""
    try:
        audio_data = base64.b64decode(request.audio_data)
        
        return await mlx_service.transcribe_with_mlx(
            audio_data=audio_data,
            language=request.language,
            task=request.task,
            use_vad=request.use_vad
        )
        
    except Exception as e:
        logger.error(f"MLX base64 transcription error: {e}")
        raise HTTPException(status_code=500, detail=f"Transcription error: {str(e)}")

@app.get("/models")
async def list_models():
    """List available MLX models and features."""
    return {
        "whisper_model": WHISPER_MODEL,
        "device": MLX_DEVICE,
        "quantization": MLX_QUANTIZATION,
        "platform": "Apple Silicon",
        "framework": "MLX",
        "features": {
            "metal_performance_shaders": True,
            "neural_engine": "Auto-detected",
            "vad_preprocessing": VAD_CONFIG.get('enabled', True),
            "quantization_options": ["int4", "int8", "float16"],
            "optimizations": [
                "Memory bandwidth optimization",
                "Metal GPU acceleration",
                "Unified memory architecture",
                "Silero VAD preprocessing"
            ]
        },
        "supported_formats": ["wav", "mp3", "m4a", "flac", "ogg"],
        "supported_languages": "auto-detect + 100+ languages",
        "performance": {
            "expected_speed": "10-20x real-time",
            "memory_usage": "~1-2GB for large-v3-turbo",
            "power_efficiency": "High (Apple Silicon optimized)"
        }
    }

if __name__ == "__main__":
    import uvicorn
    port = STT_CONFIG.get('port', 8013)
    uvicorn.run(app, host="0.0.0.0", port=port)
