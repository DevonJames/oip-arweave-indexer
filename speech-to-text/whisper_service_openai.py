#!/usr/bin/env python3

import os
import io
import base64
import tempfile
import logging
import torch
from typing import Optional, Dict, Any
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import whisper
from pydantic import BaseModel

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "base")  # tiny, base, small, medium, large
MODEL_PATH = "/app/models"
DEVICE = os.getenv("WHISPER_DEVICE", "cpu")  # "cpu" or "cuda"

app = FastAPI(title="Whisper STT Service", version="1.0.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global whisper model
whisper_model = None

class TranscriptionRequest(BaseModel):
    audio_data: str  # Base64 encoded audio
    language: Optional[str] = None
    task: str = "transcribe"  # "transcribe" or "translate"

class TranscriptionResponse(BaseModel):
    text: str
    language: str
    duration: float
    segments: list = []

@app.on_event("startup")
async def startup_event():
    """Initialize Whisper model on startup."""
    global whisper_model
    
    # Check device availability
    if DEVICE == "cuda" and not torch.cuda.is_available():
        logger.warning("CUDA requested but not available, falling back to CPU")
        device = "cpu"
    else:
        device = DEVICE
    
    logger.info(f"Loading Whisper model: {WHISPER_MODEL}")
    logger.info(f"Device: {device}")
    logger.info(f"CUDA available: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        logger.info(f"CUDA device: {torch.cuda.get_device_name(0)}")
    
    try:
        whisper_model = whisper.load_model(WHISPER_MODEL, device=device, download_root=MODEL_PATH)
        logger.info("Whisper model loaded successfully")
    except Exception as e:
        logger.error(f"Failed to load Whisper model: {str(e)}")
        raise

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "model": WHISPER_MODEL,
        "device": DEVICE,
        "cuda_available": torch.cuda.is_available(),
        "model_loaded": whisper_model is not None
    }

@app.post("/transcribe_file", response_model=TranscriptionResponse)
async def transcribe_file(
    file: UploadFile = File(...),
    language: Optional[str] = Form(None),
    task: str = Form("transcribe")
):
    """Transcribe uploaded audio file."""
    if not whisper_model:
        raise HTTPException(status_code=503, detail="Whisper model not loaded")
    
    try:
        # Read audio file
        audio_content = await file.read()
        
        # Save to temporary file
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_file:
            tmp_file.write(audio_content)
            tmp_file_path = tmp_file.name
        
        try:
            # Transcribe
            result = whisper_model.transcribe(
                tmp_file_path,
                language=language,
                task=task,
                verbose=False
            )
            
            # Process segments
            text_segments = []
            for segment in result.get("segments", []):
                segment_data = {
                    "start": segment.get("start", 0),
                    "end": segment.get("end", 0),
                    "text": segment.get("text", "").strip()
                }
                text_segments.append(segment_data)
            
            # Get audio duration from result
            duration = result.get("segments", [{}])[-1].get("end", 0) if result.get("segments") else 0
            
            return TranscriptionResponse(
                text=result["text"].strip(),
                language=result.get("language", language or "unknown"),
                duration=duration,
                segments=text_segments
            )
            
        finally:
            # Clean up temporary file
            if os.path.exists(tmp_file_path):
                os.unlink(tmp_file_path)
                
    except Exception as e:
        logger.error(f"Transcription error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Transcription error: {str(e)}")

@app.post("/transcribe_base64", response_model=TranscriptionResponse)
async def transcribe_base64(request: TranscriptionRequest):
    """Transcribe base64-encoded audio data."""
    if not whisper_model:
        raise HTTPException(status_code=503, detail="Whisper model not loaded")
    
    try:
        # Decode base64 audio
        audio_data = base64.b64decode(request.audio_data)
        
        # Save to temporary file
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_file:
            tmp_file.write(audio_data)
            tmp_file_path = tmp_file.name
        
        try:
            # Transcribe
            result = whisper_model.transcribe(
                tmp_file_path,
                language=request.language,
                task=request.task,
                verbose=False
            )
            
            # Process segments
            text_segments = []
            for segment in result.get("segments", []):
                segment_data = {
                    "start": segment.get("start", 0),
                    "end": segment.get("end", 0),
                    "text": segment.get("text", "").strip()
                }
                text_segments.append(segment_data)
            
            # Get audio duration from result
            duration = result.get("segments", [{}])[-1].get("end", 0) if result.get("segments") else 0
            
            return TranscriptionResponse(
                text=result["text"].strip(),
                language=result.get("language", request.language or "unknown"),
                duration=duration,
                segments=text_segments
            )
            
        finally:
            # Clean up temporary file
            if os.path.exists(tmp_file_path):
                os.unlink(tmp_file_path)
                
    except Exception as e:
        logger.error(f"Transcription error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Transcription error: {str(e)}")

@app.get("/models")
async def list_models():
    """List available Whisper models."""
    return {
        "current_model": WHISPER_MODEL,
        "available_models": [
            "tiny", "tiny.en", 
            "base", "base.en",
            "small", "small.en", 
            "medium", "medium.en",
            "large", "large-v1", "large-v2", "large-v3"
        ],
        "device": DEVICE,
        "cuda_available": torch.cuda.is_available()
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8003)

