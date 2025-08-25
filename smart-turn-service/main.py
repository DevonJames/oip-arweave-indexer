"""
Smart Turn v2 Microservice
Advanced Language-enabled Research and Forensics Engine for Data

This service provides intelligent conversation endpoint detection using Smart Turn v2.
"""

import os
import logging
import traceback
from typing import Dict, Any, Optional
import base64
import tempfile
import time

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
import uvicorn

from inference import SmartTurnInference

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Smart Turn v2 Service",
    description="Intelligent conversation endpoint detection for ALFRED voice pipeline",
    version="1.0.0"
)

# Global inference engine
inference_engine: Optional[SmartTurnInference] = None

# Request/Response models
class AudioRequest(BaseModel):
    audio_base64: str = Field(..., description="Base64 encoded audio data")
    transcript: Optional[str] = Field(None, description="Optional transcript for enhanced prediction")

class PredictionResponse(BaseModel):
    prediction: int = Field(..., description="0 = incomplete turn, 1 = complete turn")
    probability: float = Field(..., description="Confidence probability (0.0 to 1.0)")
    processing_time_ms: float = Field(..., description="Processing time in milliseconds")
    model_version: str = Field(..., description="Smart Turn model version")

class HealthResponse(BaseModel):
    status: str = Field(..., description="Service health status")
    model_loaded: bool = Field(..., description="Whether the model is loaded")
    model_path: Optional[str] = Field(None, description="Path to loaded model")
    uptime_seconds: float = Field(..., description="Service uptime in seconds")

class InfoResponse(BaseModel):
    service_name: str = Field(..., description="Service name")
    version: str = Field(..., description="Service version")
    model_info: Dict[str, Any] = Field(..., description="Model information")
    capabilities: Dict[str, Any] = Field(..., description="Service capabilities")

# Service startup time
startup_time = time.time()

@app.on_event("startup")
async def startup_event():
    """Initialize the Smart Turn inference engine on startup."""
    global inference_engine
    
    try:
        logger.info("🚀 Starting Smart Turn v2 Service...")
        
        # Initialize inference engine
        model_path = os.getenv('MODEL_PATH', '/app/models')
        inference_engine = SmartTurnInference(model_path=model_path)
        
        # Load the model
        await inference_engine.load_model()
        
        logger.info("✅ Smart Turn v2 Service started successfully")
        
    except Exception as e:
        logger.error(f"❌ Failed to start Smart Turn v2 Service: {e}")
        logger.error(traceback.format_exc())
        raise

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on service shutdown."""
    global inference_engine
    
    logger.info("🔄 Shutting down Smart Turn v2 Service...")
    
    if inference_engine:
        await inference_engine.cleanup()
    
    logger.info("✅ Smart Turn v2 Service shutdown complete")

@app.post("/predict_endpoint", response_model=PredictionResponse)
async def predict_endpoint(
    audio_file: Optional[UploadFile] = File(None),
    audio_base64: Optional[str] = Form(None),
    transcript: Optional[str] = Form(None)
):
    """
    Predict whether audio represents a complete conversation turn.
    
    Accepts either:
    - audio_file: Uploaded WAV file
    - audio_base64: Base64 encoded audio data
    
    Returns prediction (0=incomplete, 1=complete) with confidence.
    """
    if not inference_engine:
        raise HTTPException(status_code=503, detail="Model not loaded")
    
    start_time = time.time()
    
    try:
        # Handle audio input
        audio_data = None
        
        if audio_file:
            # Read uploaded file
            audio_data = await audio_file.read()
            logger.info(f"Received audio file: {audio_file.filename}, size: {len(audio_data)} bytes")
            
        elif audio_base64:
            # Decode base64 audio
            try:
                audio_data = base64.b64decode(audio_base64)
                logger.info(f"Received base64 audio, size: {len(audio_data)} bytes")
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Invalid base64 audio data: {e}")
        
        else:
            raise HTTPException(status_code=400, detail="Either audio_file or audio_base64 must be provided")
        
        # Perform prediction
        result = await inference_engine.predict(
            audio_data=audio_data,
            transcript=transcript
        )
        
        processing_time = (time.time() - start_time) * 1000
        
        response = PredictionResponse(
            prediction=result['prediction'],
            probability=result['probability'],
            processing_time_ms=processing_time,
            model_version=result.get('model_version', 'smart-turn-v2')
        )
        
        logger.info(f"Prediction completed: {result['prediction']} (prob: {result['probability']:.3f}, time: {processing_time:.1f}ms)")
        
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        processing_time = (time.time() - start_time) * 1000
        logger.error(f"Prediction failed after {processing_time:.1f}ms: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Check service health and model status."""
    uptime = time.time() - startup_time
    
    if not inference_engine:
        return HealthResponse(
            status="unhealthy",
            model_loaded=False,
            uptime_seconds=uptime
        )
    
    model_info = await inference_engine.get_model_info()
    
    return HealthResponse(
        status="healthy" if model_info.get('loaded', False) else "unhealthy",
        model_loaded=model_info.get('loaded', False),
        model_path=model_info.get('model_path'),
        uptime_seconds=uptime
    )

@app.get("/info", response_model=InfoResponse)
async def service_info():
    """Get detailed service and model information."""
    if not inference_engine:
        raise HTTPException(status_code=503, detail="Model not loaded")
    
    model_info = await inference_engine.get_model_info()
    
    return InfoResponse(
        service_name="Smart Turn v2 Service",
        version="1.0.0",
        model_info=model_info,
        capabilities={
            "audio_formats": ["wav", "mp3", "webm"],
            "input_methods": ["file_upload", "base64"],
            "features": ["endpoint_detection", "confidence_scoring", "transcript_enhancement"],
            "max_audio_length_seconds": 30,
            "supported_sample_rates": [16000, 22050, 44100, 48000]
        }
    )

@app.get("/")
async def root():
    """Root endpoint with service information."""
    return {
        "service": "Smart Turn v2 Service",
        "version": "1.0.0",
        "description": "Intelligent conversation endpoint detection for ALFRED voice pipeline",
        "endpoints": {
            "predict": "/predict_endpoint",
            "health": "/health", 
            "info": "/info"
        }
    }

# Error handlers
@app.exception_handler(Exception)
async def general_exception_handler(request, exc):
    """Handle unexpected exceptions."""
    logger.error(f"Unhandled exception: {exc}")
    logger.error(traceback.format_exc())
    
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal server error",
            "detail": str(exc),
            "type": type(exc).__name__
        }
    )

if __name__ == "__main__":
    # Development server
    port = int(os.getenv('PORT', 8000))
    host = os.getenv('HOST', '0.0.0.0')
    
    logger.info(f"Starting Smart Turn v2 Service on {host}:{port}")
    
    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=True,
        log_level="info"
    )
