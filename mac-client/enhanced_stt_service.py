#!/usr/bin/env python3
"""
Enhanced STT Service with Frame-Based Processing and Streaming Support

This service extends the existing STT functionality to support:
- 20ms frame-based audio processing
- Streaming transcription with partial results
- Real-time VAD integration
- Frame synchronization with other services
"""

import asyncio
import io
import json
import logging
import time
import wave
from typing import Dict, List, Optional, Tuple
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
import uvicorn
import torch
import mlx_whisper

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class EnhancedSTTService:
    """Enhanced STT Service with frame-based processing and streaming support"""
    
    def __init__(self):
        self.model_name = "mlx-community/whisper-large-v3-mlx-4bit"
        self.device = "mps" if torch.backends.mps.is_available() else "cpu"
        self.sample_rate = 16000
        self.frame_duration_ms = 20
        self.frame_size = int(self.sample_rate * self.frame_duration_ms / 1000)  # 320 samples
        
        # Model and processing components
        self.whisper_model = None
        self.vad_model = None
        
        # Streaming state management
        self.active_sessions = {}  # session_id -> session_data
        
        # Performance metrics
        self.metrics = {
            'total_requests': 0,
            'streaming_sessions': 0,
            'average_latency': 0,
            'frame_processing_time': 0,
            'partial_results_sent': 0
        }
        
        logger.info("🚀 Initializing Enhanced STT Service...")
    
    async def initialize(self):
        """Initialize the STT models and components"""
        try:
            logger.info("📥 Loading MLX Whisper model...")
            self.whisper_model = mlx_whisper.load_model(self.model_name)
            logger.info("✅ MLX Whisper model loaded successfully")
            
            # Initialize Silero VAD for frame-level speech detection
            logger.info("📥 Loading Silero VAD model...")
            try:
                import torch
                self.vad_model, utils = torch.hub.load(
                    repo_or_dir='snakers4/silero-vad',
                    model='silero_vad',
                    force_reload=False,
                    onnx=False
                )
                self.vad_model.eval()
                logger.info("✅ Silero VAD model loaded successfully")
            except Exception as e:
                logger.warning(f"⚠️ Failed to load Silero VAD: {e}")
                self.vad_model = None
            
            logger.info("✅ Enhanced STT Service initialized successfully")
            
        except Exception as e:
            logger.error(f"❌ Failed to initialize Enhanced STT Service: {e}")
            raise
    
    def detect_speech_in_frame(self, audio_data: np.ndarray) -> Tuple[bool, float]:
        """
        Detect speech in a single audio frame using VAD
        
        Args:
            audio_data: Audio frame as numpy array (320 samples for 20ms)
            
        Returns:
            Tuple of (has_speech: bool, confidence: float)
        """
        if self.vad_model is None:
            # Fallback: simple energy-based VAD
            energy = np.sqrt(np.mean(audio_data ** 2))
            has_speech = energy > 0.01  # Simple threshold
            return has_speech, energy
        
        try:
            # Ensure audio is the right format for Silero VAD
            if len(audio_data) < 512:
                # Pad short frames for VAD
                padded = np.zeros(512)
                padded[:len(audio_data)] = audio_data
                audio_data = padded
            
            # Convert to tensor
            audio_tensor = torch.FloatTensor(audio_data).unsqueeze(0)
            
            # Get VAD prediction
            with torch.no_grad():
                speech_prob = self.vad_model(audio_tensor, self.sample_rate).item()
            
            has_speech = speech_prob > 0.5
            return has_speech, speech_prob
            
        except Exception as e:
            logger.warning(f"VAD processing error: {e}")
            # Fallback to energy-based detection
            energy = np.sqrt(np.mean(audio_data ** 2))
            return energy > 0.01, energy
    
    def preprocess_audio_frame(self, audio_bytes: bytes) -> np.ndarray:
        """
        Preprocess raw audio bytes into numpy array
        
        Args:
            audio_bytes: Raw audio data
            
        Returns:
            Numpy array of audio samples
        """
        try:
            # Try to parse as WAV first
            try:
                with io.BytesIO(audio_bytes) as wav_io:
                    with wave.open(wav_io, 'rb') as wav_file:
                        frames = wav_file.readframes(-1)
                        audio_data = np.frombuffer(frames, dtype=np.int16)
                        # Convert to float32 and normalize
                        audio_data = audio_data.astype(np.float32) / 32768.0
                        return audio_data
            except:
                # Assume raw PCM 16-bit
                audio_data = np.frombuffer(audio_bytes, dtype=np.int16)
                audio_data = audio_data.astype(np.float32) / 32768.0
                return audio_data
                
        except Exception as e:
            logger.error(f"Audio preprocessing error: {e}")
            raise HTTPException(status_code=400, detail=f"Invalid audio format: {e}")
    
    async def process_audio_frame(self, session_id: str, audio_bytes: bytes) -> Dict:
        """
        Process a single 20ms audio frame
        
        Args:
            session_id: Unique session identifier
            audio_bytes: Raw audio frame data
            
        Returns:
            Processing result dictionary
        """
        start_time = time.time()
        
        try:
            # Get or create session
            if session_id not in self.active_sessions:
                self.active_sessions[session_id] = {
                    'audio_buffer': [],
                    'frame_count': 0,
                    'speech_frames': 0,
                    'last_partial_text': '',
                    'accumulated_audio': np.array([]),
                    'speech_active': False,
                    'silence_frames': 0
                }
            
            session = self.active_sessions[session_id]
            session['frame_count'] += 1
            
            # Preprocess audio frame
            audio_frame = self.preprocess_audio_frame(audio_bytes)
            
            # Detect speech in frame
            has_speech, speech_confidence = self.detect_speech_in_frame(audio_frame)
            
            # Update speech state
            if has_speech:
                session['speech_frames'] += 1
                session['silence_frames'] = 0
                if not session['speech_active']:
                    session['speech_active'] = True
                    logger.info(f"Speech started in session {session_id}")
            else:
                session['silence_frames'] += 1
                if session['speech_active'] and session['silence_frames'] > 10:  # 200ms of silence
                    session['speech_active'] = False
                    logger.info(f"Speech ended in session {session_id}")
            
            # Accumulate audio for transcription
            if has_speech or session['speech_active']:
                session['accumulated_audio'] = np.concatenate([
                    session['accumulated_audio'], 
                    audio_frame
                ])
            
            # Generate partial transcription every 10 frames (200ms) if speech is active
            partial_text = ""
            if session['speech_active'] and session['frame_count'] % 10 == 0:
                if len(session['accumulated_audio']) > 0:
                    partial_text = await self.get_partial_transcription(
                        session['accumulated_audio']
                    )
                    session['last_partial_text'] = partial_text
            
            # Processing time metrics
            processing_time = (time.time() - start_time) * 1000
            self.metrics['frame_processing_time'] = (
                self.metrics['frame_processing_time'] * 0.9 + processing_time * 0.1
            )
            
            return {
                'session_id': session_id,
                'frame_index': session['frame_count'],
                'has_speech': has_speech,
                'speech_confidence': speech_confidence,
                'speech_active': session['speech_active'],
                'partial_text': partial_text,
                'processing_time_ms': processing_time,
                'buffer_length_ms': len(session['accumulated_audio']) / self.sample_rate * 1000
            }
            
        except Exception as e:
            logger.error(f"Frame processing error for session {session_id}: {e}")
            raise HTTPException(status_code=500, detail=f"Frame processing failed: {e}")
    
    async def get_partial_transcription(self, audio_data: np.ndarray) -> str:
        """
        Get partial transcription from accumulated audio
        
        Args:
            audio_data: Accumulated audio data
            
        Returns:
            Partial transcription text
        """
        try:
            if len(audio_data) < self.sample_rate * 0.5:  # Less than 500ms
                return ""
            
            # Limit audio length to prevent excessive processing
            max_length = self.sample_rate * 10  # 10 seconds max
            if len(audio_data) > max_length:
                audio_data = audio_data[-max_length:]
            
            # Transcribe with Whisper
            result = mlx_whisper.transcribe(
                audio_data,
                model=self.whisper_model,
                language="en",
                task="transcribe",
                temperature=0.0,
                best_of=1,
                beam_size=1,
                patience=1.0,
                length_penalty=1.0,
                suppress_tokens=[-1],
                initial_prompt=None,
                condition_on_previous_text=True,
                fp16=True,
                compression_ratio_threshold=2.4,
                logprob_threshold=-1.0,
                no_speech_threshold=0.6
            )
            
            text = result.get('text', '').strip()
            return text
            
        except Exception as e:
            logger.warning(f"Partial transcription error: {e}")
            return ""
    
    async def finalize_transcription(self, session_id: str) -> Dict:
        """
        Finalize transcription for a session
        
        Args:
            session_id: Session to finalize
            
        Returns:
            Final transcription result
        """
        if session_id not in self.active_sessions:
            raise HTTPException(status_code=404, detail="Session not found")
        
        session = self.active_sessions[session_id]
        
        try:
            if len(session['accumulated_audio']) == 0:
                return {
                    'session_id': session_id,
                    'text': '',
                    'confidence': 0.0,
                    'duration_ms': 0
                }
            
            # Get final transcription
            result = mlx_whisper.transcribe(
                session['accumulated_audio'],
                model=self.whisper_model,
                language="en",
                task="transcribe",
                temperature=0.0,
                best_of=5,
                beam_size=5,
                patience=1.0,
                length_penalty=1.0,
                suppress_tokens=[-1],
                initial_prompt=None,
                condition_on_previous_text=True,
                fp16=True,
                compression_ratio_threshold=2.4,
                logprob_threshold=-1.0,
                no_speech_threshold=0.6
            )
            
            text = result.get('text', '').strip()
            confidence = 1.0 - result.get('no_speech_prob', 0.0)
            duration_ms = len(session['accumulated_audio']) / self.sample_rate * 1000
            
            # Clean up session
            del self.active_sessions[session_id]
            
            logger.info(f"Finalized transcription for session {session_id}: '{text}'")
            
            return {
                'session_id': session_id,
                'text': text,
                'confidence': confidence,
                'duration_ms': duration_ms,
                'frame_count': session['frame_count'],
                'speech_frames': session['speech_frames']
            }
            
        except Exception as e:
            logger.error(f"Transcription finalization error: {e}")
            # Clean up session even on error
            if session_id in self.active_sessions:
                del self.active_sessions[session_id]
            raise HTTPException(status_code=500, detail=f"Finalization failed: {e}")
    
    def get_metrics(self) -> Dict:
        """Get service performance metrics"""
        return {
            **self.metrics,
            'active_sessions': len(self.active_sessions),
            'model_name': self.model_name,
            'device': self.device,
            'frame_size': self.frame_size,
            'sample_rate': self.sample_rate
        }

# Initialize service
stt_service = EnhancedSTTService()

# FastAPI application
app = FastAPI(
    title="Enhanced STT Service",
    description="Frame-based STT service with streaming support",
    version="2.0.0"
)

@app.on_event("startup")
async def startup_event():
    """Initialize the STT service on startup"""
    await stt_service.initialize()

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "Enhanced STT Service",
        "version": "2.0.0",
        "model": stt_service.model_name,
        "device": stt_service.device,
        "metrics": stt_service.get_metrics()
    }

@app.post("/transcribe_file")
async def transcribe_file(
    file: UploadFile = File(...),
    language: str = Form("en"),
    task: str = Form("transcribe"),
    partial: str = Form("false")
):
    """
    Legacy transcription endpoint for backward compatibility
    """
    start_time = time.time()
    stt_service.metrics['total_requests'] += 1
    
    try:
        # Read audio file
        audio_bytes = await file.read()
        
        # Preprocess audio
        audio_data = stt_service.preprocess_audio_frame(audio_bytes)
        
        # Check for speech
        has_speech, confidence = stt_service.detect_speech_in_frame(audio_data)
        
        if not has_speech and len(audio_data) < stt_service.sample_rate:
            # Very short audio with no speech
            return {
                "text": "",
                "language": language,
                "duration": len(audio_data) / stt_service.sample_rate,
                "confidence": 0.0,
                "has_speech": False
            }
        
        # Transcribe
        result = mlx_whisper.transcribe(
            audio_data,
            model=stt_service.whisper_model,
            language=language,
            task=task,
            temperature=0.0 if partial == "true" else 0.0,
            best_of=1 if partial == "true" else 5,
            beam_size=1 if partial == "true" else 5
        )
        
        text = result.get('text', '').strip()
        duration = len(audio_data) / stt_service.sample_rate
        processing_time = (time.time() - start_time) * 1000
        
        # Update metrics
        stt_service.metrics['average_latency'] = (
            stt_service.metrics['average_latency'] * 0.9 + processing_time * 0.1
        )
        
        logger.info(f"Transcribed ({processing_time:.1f}ms): '{text}'")
        
        return {
            "text": text,
            "language": result.get('language', language),
            "duration": duration,
            "confidence": 1.0 - result.get('no_speech_prob', 0.0),
            "has_speech": has_speech,
            "processing_time_ms": processing_time,
            "is_partial": partial == "true"
        }
        
    except Exception as e:
        logger.error(f"Transcription error: {e}")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}")

@app.post("/process_frame")
async def process_audio_frame(
    session_id: str = Form(...),
    audio_file: UploadFile = File(...)
):
    """
    Process a single 20ms audio frame
    """
    try:
        audio_bytes = await audio_file.read()
        result = await stt_service.process_audio_frame(session_id, audio_bytes)
        
        if result['partial_text']:
            stt_service.metrics['partial_results_sent'] += 1
        
        return result
        
    except Exception as e:
        logger.error(f"Frame processing error: {e}")
        raise HTTPException(status_code=500, detail=f"Frame processing failed: {e}")

@app.post("/finalize_session")
async def finalize_session(session_id: str = Form(...)):
    """
    Finalize transcription for a session
    """
    try:
        result = await stt_service.finalize_transcription(session_id)
        return result
        
    except Exception as e:
        logger.error(f"Session finalization error: {e}")
        raise HTTPException(status_code=500, detail=f"Finalization failed: {e}")

@app.get("/metrics")
async def get_metrics():
    """Get service metrics"""
    return stt_service.get_metrics()

@app.delete("/session/{session_id}")
async def cleanup_session(session_id: str):
    """Clean up a specific session"""
    if session_id in stt_service.active_sessions:
        del stt_service.active_sessions[session_id]
        return {"message": f"Session {session_id} cleaned up"}
    else:
        raise HTTPException(status_code=404, detail="Session not found")

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Enhanced STT Service")
    parser.add_argument("--port", type=int, default=8013, help="Port to run the service on")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="Host to bind to")
    args = parser.parse_args()
    
    logger.info(f"🚀 Starting Enhanced STT Service on {args.host}:{args.port}")
    
    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level="info"
    )
