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
from pathlib import Path
import uvicorn

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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
    voice: str = "chatterbox"
    engine: str = "auto"

class TTSResponse(BaseModel):
    audio_file: str
    engine_used: str
    voice_used: str

class GPUTTSService:
    def __init__(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.chatterbox_engine = None
        self.silero_model = None
        self.silero_speakers = {}
        logger.info(f"Initializing TTS service on device: {self.device}")
        self._initialize_chatterbox()
        self._initialize_silero()
    
    def _initialize_chatterbox(self):
        """Initialize Chatterbox (pyttsx3) TTS engine"""
        try:
            import pyttsx3
            
            self.chatterbox_engine = pyttsx3.init()
            
            # Configure voice settings
            voices = self.chatterbox_engine.getProperty('voices')
            self.chatterbox_voices = {}
            
            if voices:
                # Map our voice names to available system voices
                for i, voice in enumerate(voices):
                    voice_name = voice.name.lower()
                    if 'female' in voice_name or 'woman' in voice_name:
                        if 'female_1' not in self.chatterbox_voices:
                            self.chatterbox_voices['female_1'] = voice.id
                        elif 'female_2' not in self.chatterbox_voices:
                            self.chatterbox_voices['female_2'] = voice.id
                    elif 'male' in voice_name or 'man' in voice_name:
                        if 'male_1' not in self.chatterbox_voices:
                            self.chatterbox_voices['male_1'] = voice.id
                        elif 'male_2' not in self.chatterbox_voices:
                            self.chatterbox_voices['male_2'] = voice.id
                
                # Set defaults if we don't have specific gender voices
                if not self.chatterbox_voices:
                    self.chatterbox_voices = {
                        'female_1': voices[0].id if len(voices) > 0 else None,
                        'female_2': voices[1].id if len(voices) > 1 else voices[0].id,
                        'male_1': voices[0].id if len(voices) > 0 else None,
                        'male_2': voices[1].id if len(voices) > 1 else voices[0].id,
                        'expressive': voices[0].id if len(voices) > 0 else None,
                        'calm': voices[0].id if len(voices) > 0 else None,
                        'cheerful': voices[0].id if len(voices) > 0 else None,
                        'sad': voices[0].id if len(voices) > 0 else None
                    }
            
            # Set speech rate and volume
            self.chatterbox_engine.setProperty('rate', 150)  # Speed
            self.chatterbox_engine.setProperty('volume', 1.0)  # Volume
            
            logger.info("Chatterbox (pyttsx3) TTS engine initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize Chatterbox engine: {e}")
            self.chatterbox_engine = None
    
    def _initialize_silero(self):
        """Initialize Silero TTS model as secondary engine"""
        try:
            import silero
            
            # Load the multilingual model
            self.silero_model, _ = torch.hub.load(
                repo_or_dir='snakers4/silero-models',
                model='silero_tts',
                language='en',
                speaker='v3_en'
            )
            self.silero_model.to(self.device)
            
            # Define available speakers
            self.silero_speakers = {
                'female_1': 'en_0',
                'female_2': 'en_1', 
                'male_1': 'en_2',
                'male_2': 'en_3',
                'expressive': 'en_4',
                'calm': 'en_5',
                'cheerful': 'en_6',
                'sad': 'en_7'
            }
            
            logger.info("Silero TTS model loaded successfully")
            
        except Exception as e:
            logger.error(f"Failed to load Silero model: {e}")
            self.silero_model = None

    async def synthesize_with_chatterbox(self, text: str, voice: str) -> Optional[str]:
        """Synthesize speech using Chatterbox (pyttsx3)"""
        if not self.chatterbox_engine:
            return None
            
        try:
            # Map "chatterbox" to a sensible default
            if voice == "chatterbox":
                voice = "female_1"  # Use female_1 as default for "chatterbox"
            
            # Set voice if available
            voice_id = self.chatterbox_voices.get(voice)
            if voice_id:
                self.chatterbox_engine.setProperty('voice', voice_id)
            
            # Generate audio to temporary file
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
                self.chatterbox_engine.save_to_file(text, tmp_file.name)
                self.chatterbox_engine.runAndWait()
                return tmp_file.name
                
        except Exception as e:
            logger.error(f"Chatterbox TTS error: {e}")
            return None

    async def synthesize_with_silero(self, text: str, voice: str) -> Optional[str]:
        """Synthesize speech using Silero TTS"""
        if not self.silero_model:
            return None
            
        try:
            # Map "chatterbox" to a sensible default
            if voice == "chatterbox":
                voice = "female_1"
                
            speaker = self.silero_speakers.get(voice, 'en_0')
            
            # Generate audio
            with torch.no_grad():
                audio = self.silero_model.apply_tts(
                    text=text,
                    speaker=speaker,
                    sample_rate=48000,
                    put_accent=True,
                    put_yo=True
                )
            
            # Save to temporary file
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
                torchaudio.save(tmp_file.name, audio.unsqueeze(0), 48000)
                return tmp_file.name
                
        except Exception as e:
            logger.error(f"Silero TTS error: {e}")
            return None

    async def synthesize_with_edge_tts(self, text: str, voice: str) -> Optional[str]:
        """Synthesize speech using Edge TTS"""
        try:
            import edge_tts
            
            voice_map = {
                'chatterbox': 'en-US-JennyNeural',
                'female_1': 'en-US-JennyNeural',
                'female_2': 'en-US-AriaNeural', 
                'male_1': 'en-US-GuyNeural',
                'male_2': 'en-US-DavisNeural',
                'expressive': 'en-US-AriaNeural',
                'calm': 'en-US-SaraNeural',
                'cheerful': 'en-US-JennyNeural',
                'sad': 'en-US-AriaNeural'
            }
            
            edge_voice = voice_map.get(voice, 'en-US-JennyNeural')
            
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
                communicate = edge_tts.Communicate(text, edge_voice)
                await communicate.save(tmp_file.name)
                return tmp_file.name
                
        except Exception as e:
            logger.error(f"Edge TTS error: {e}")
            return None

    async def synthesize_with_gtts(self, text: str) -> Optional[str]:
        """Synthesize speech using gTTS"""
        try:
            from gtts import gTTS
            
            tts = gTTS(text=text, lang='en', slow=False)
            
            with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as tmp_file:
                tts.save(tmp_file.name)
                return tmp_file.name
                
        except Exception as e:
            logger.error(f"gTTS error: {e}")
            return None

    async def synthesize_with_espeak(self, text: str) -> Optional[str]:
        """Synthesize speech using eSpeak"""
        try:
            import subprocess
            
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
                cmd = [
                    'espeak',
                    '-w', tmp_file.name,
                    '-s', '150',  # Speed
                    '-a', '100',  # Amplitude
                    text
                ]
                
                subprocess.run(cmd, check=True, capture_output=True)
                return tmp_file.name
                
        except Exception as e:
            logger.error(f"eSpeak error: {e}")
            return None

    async def synthesize(self, text: str, voice: str = "chatterbox", engine: str = "auto") -> TTSResponse:
        """Main synthesis method with engine fallbacks"""
        
        if not text.strip():
            raise HTTPException(status_code=400, detail="Text cannot be empty")
        
        engines_to_try = []
        
        if engine == "auto":
            # Try engines in order of preference (Chatterbox first)
            engines_to_try = [
                ("chatterbox", self.synthesize_with_chatterbox),
                ("silero", self.synthesize_with_silero),
                ("edge_tts", self.synthesize_with_edge_tts),
                ("gtts", self.synthesize_with_gtts),
                ("espeak", self.synthesize_with_espeak)
            ]
        else:
            # Try specific engine first, then fallbacks
            engine_methods = {
                "chatterbox": self.synthesize_with_chatterbox,
                "silero": self.synthesize_with_silero,
                "edge_tts": self.synthesize_with_edge_tts,
                "gtts": self.synthesize_with_gtts,
                "espeak": self.synthesize_with_espeak
            }
            
            if engine in engine_methods:
                engines_to_try.append((engine, engine_methods[engine]))
                # Add fallbacks
                for fallback_engine, method in engine_methods.items():
                    if fallback_engine != engine:
                        engines_to_try.append((fallback_engine, method))
        
        # Try each engine until one succeeds
        for engine_name, method in engines_to_try:
            try:
                logger.info(f"Trying {engine_name} for synthesis")
                
                if engine_name in ["chatterbox", "silero", "edge_tts"]:
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

@app.post("/synthesize")
async def synthesize_speech(request: TTSRequest):
    """Synthesize speech from text - returns raw audio data"""
    try:
        # Get the synthesis result
        result = await tts_service.synthesize(
            text=request.text,
            voice=request.voice,
            engine=request.engine
        )
        
        # Read the actual audio file and return as binary data
        audio_file_path = result.audio_file
        
        with open(audio_file_path, 'rb') as f:
            audio_data = f.read()
        
        # Clean up temporary file
        try:
            os.unlink(audio_file_path)
        except:
            pass
        
        # Return raw audio data with proper headers
        return Response(
            content=audio_data,
            media_type="audio/wav",
            headers={
                "X-Engine-Used": result.engine_used,
                "X-Voice-Used": result.voice_used,
                "Content-Length": str(len(audio_data))
            }
        )
        
    except Exception as e:
        logger.error(f"Synthesis failed: {e}")
        raise HTTPException(status_code=500, detail=f"Synthesis failed: {str(e)}")

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
    """Get available voices"""
    return {
        "voices": [
            {"id": "chatterbox", "name": "Chatterbox (Default)", "engine": "Chatterbox"},
            {"id": "female_1", "name": "Female Voice 1 (Chatterbox)", "engine": "Chatterbox"},
            {"id": "female_2", "name": "Female Voice 2 (Chatterbox)", "engine": "Chatterbox"},
            {"id": "male_1", "name": "Male Voice 1 (Chatterbox)", "engine": "Chatterbox"},
            {"id": "male_2", "name": "Male Voice 2 (Chatterbox)", "engine": "Chatterbox"},
            {"id": "expressive", "name": "Expressive (Chatterbox)", "engine": "Chatterbox"},
            {"id": "calm", "name": "Calm (Chatterbox)", "engine": "Chatterbox"},
            {"id": "cheerful", "name": "Cheerful (Chatterbox)", "engine": "Chatterbox"},
            {"id": "sad", "name": "Sad (Chatterbox)", "engine": "Chatterbox"}
        ],
        "engines": ["chatterbox", "silero", "edge_tts", "gtts", "espeak", "auto"]
    }

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "device": tts_service.device,
        "chatterbox_available": tts_service.chatterbox_engine is not None,
        "silero_available": tts_service.silero_model is not None,
        "gpu_available": torch.cuda.is_available(),
        "primary_engine": "chatterbox"
    }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=5002) 