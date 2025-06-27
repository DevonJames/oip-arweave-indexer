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
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import numpy as np
import subprocess
from pathlib import Path
import uvicorn
import time
import threading
import pyttsx3

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

# Add request timeout middleware
@app.middleware("http")
async def timeout_middleware(request: Request, call_next):
    start_time = time.time()
    
    try:
        # Set a timeout for all requests
        response = await asyncio.wait_for(call_next(request), timeout=60.0)
        process_time = time.time() - start_time
        logger.info(f"Request processed in {process_time:.2f} seconds")
        return response
    except asyncio.TimeoutError:
        logger.error(f"Request timeout after 60 seconds")
        raise HTTPException(status_code=408, detail="Request timeout")
    except Exception as e:
        logger.error(f"Request error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

class GPUTTSService:
    def __init__(self):
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        self.chatterbox_engine = None
        self.chatterbox_voices = {}
        self.silero_model = None
        self.silero_speakers = {}
        self.engine_lock = threading.Lock()  # Add thread safety
        
        logger.info(f"Initializing TTS service on device: {self.device}")
        self._initialize_chatterbox()
        self._initialize_silero()
    
    def _initialize_chatterbox(self):
        """Initialize Chatterbox (pyttsx3) TTS engine with better error handling"""
        try:
            with self.engine_lock:
                self.chatterbox_engine = pyttsx3.init()
                
                # Get available voices
                voices = self.chatterbox_engine.getProperty('voices')
                logger.info(f"Available voices: {len(voices) if voices else 0}")
                
                # Map voices by gender and quality
                self.chatterbox_voices = {}
                if voices:
                    for i, voice in enumerate(voices):
                        logger.info(f"Voice {i}: {voice.id} - {voice.name}")
                        
                        # Try to categorize voices by name/gender
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
                if not self.chatterbox_voices and voices:
                    self.chatterbox_voices = {
                        'female_1': voices[0].id,
                        'female_2': voices[1].id if len(voices) > 1 else voices[0].id,
                        'male_1': voices[0].id,
                        'male_2': voices[1].id if len(voices) > 1 else voices[0].id,
                        'expressive': voices[0].id,
                        'calm': voices[0].id,
                        'cheerful': voices[0].id,
                        'sad': voices[0].id
                    }
                
                # Set speech rate and volume with error handling
                try:
                    self.chatterbox_engine.setProperty('rate', 150)  # Speed
                    self.chatterbox_engine.setProperty('volume', 1.0)  # Volume
                except Exception as prop_error:
                    logger.warning(f"Could not set engine properties: {prop_error}")
                
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
        """Synthesize speech using Chatterbox (pyttsx3) with improved error handling"""
        if not self.chatterbox_engine:
            logger.error("Chatterbox engine not initialized")
            return None
            
        try:
            with self.engine_lock:
                # Map "chatterbox" to a sensible default
                if voice == "chatterbox":
                    voice = "female_1"  # Use female_1 as default for "chatterbox"
                
                # Set voice if available
                voice_id = self.chatterbox_voices.get(voice)
                if voice_id:
                    try:
                        self.chatterbox_engine.setProperty('voice', voice_id)
                    except Exception as voice_error:
                        logger.warning(f"Could not set voice {voice}: {voice_error}")
                
                # Generate audio to temporary file with timeout
                with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
                    logger.info(f"Synthesizing text with Chatterbox: '{text[:50]}...'")
                    
                    # Use a separate thread for the blocking operation
                    synthesis_done = threading.Event()
                    synthesis_error = None
                    
                    def synthesize_thread():
                        nonlocal synthesis_error
                        try:
                            self.chatterbox_engine.save_to_file(text, tmp_file.name)
                            self.chatterbox_engine.runAndWait()
                            synthesis_done.set()
                        except Exception as e:
                            synthesis_error = e
                            synthesis_done.set()
                    
                    thread = threading.Thread(target=synthesize_thread)
                    thread.daemon = True
                    thread.start()
                    
                    # Wait for synthesis with timeout
                    if not synthesis_done.wait(timeout=30):
                        logger.error("Chatterbox synthesis timeout (30s)")
                        return None
                    
                    if synthesis_error:
                        logger.error(f"Chatterbox synthesis error: {synthesis_error}")
                        return None
                    
                    # Check if file was created successfully
                    if os.path.exists(tmp_file.name) and os.path.getsize(tmp_file.name) > 44:  # More than WAV header
                        logger.info(f"Chatterbox synthesis successful: {os.path.getsize(tmp_file.name)} bytes")
                        return tmp_file.name
                    else:
                        logger.warning("Chatterbox produced no audio or empty file")
                        if os.path.exists(tmp_file.name):
                            os.unlink(tmp_file.name)
                        return None
                        
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
                logger.info(f"Synthesizing with Edge TTS: voice {edge_voice}")
                communicate = edge_tts.Communicate(text, edge_voice)
                
                # Add timeout for Edge TTS
                try:
                    await asyncio.wait_for(communicate.save(tmp_file.name), timeout=30.0)
                except asyncio.TimeoutError:
                    logger.error("Edge TTS timeout")
                    if os.path.exists(tmp_file.name):
                        os.unlink(tmp_file.name)
                    return None
                
                if os.path.exists(tmp_file.name) and os.path.getsize(tmp_file.name) > 0:
                    logger.info(f"Edge TTS successful: {os.path.getsize(tmp_file.name)} bytes")
                    return tmp_file.name
                else:
                    logger.warning("Edge TTS produced no audio")
                    return None
                
        except ImportError:
            logger.warning("Edge TTS not available (missing edge-tts package)")
            return None
        except Exception as e:
            logger.error(f"Edge TTS error: {e}")
            return None

    async def synthesize_with_gtts(self, text: str) -> Optional[str]:
        """Synthesize speech using gTTS"""
        try:
            from gtts import gTTS
            
            with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as tmp_file:
                logger.info("Synthesizing with gTTS")
                tts = gTTS(text=text, lang='en', slow=False)
                tts.save(tmp_file.name)
                
                if os.path.exists(tmp_file.name) and os.path.getsize(tmp_file.name) > 0:
                    logger.info(f"gTTS successful: {os.path.getsize(tmp_file.name)} bytes")
                    return tmp_file.name
                else:
                    logger.warning("gTTS produced no audio")
                    return None
                
        except ImportError:
            logger.warning("gTTS not available (missing gtts package)")
            return None
        except Exception as e:
            logger.error(f"gTTS error: {e}")
            return None

    async def synthesize_with_espeak(self, text: str, voice: str) -> Optional[str]:
        """Synthesize speech using eSpeak"""
        try:
            voice_map = {
                'chatterbox': 'en',
                'female_1': 'en+f3',
                'female_2': 'en+f2',
                'male_1': 'en+m3',
                'male_2': 'en+m2',
                'expressive': 'en+f4',
                'calm': 'en+f1',
                'cheerful': 'en+f3',
                'sad': 'en+m1'
            }
            
            espeak_voice = voice_map.get(voice, 'en')
            
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
                logger.info(f"Synthesizing with eSpeak: voice {espeak_voice}")
                
                # Run eSpeak command
                cmd = [
                    'espeak',
                    '-v', espeak_voice,
                    '-s', '175',  # Speed
                    '-w', tmp_file.name,  # Output file
                    text
                ]
                
                try:
                    result = await asyncio.wait_for(
                        asyncio.create_subprocess_exec(
                            *cmd,
                            stdout=asyncio.subprocess.PIPE,
                            stderr=asyncio.subprocess.PIPE
                        ),
                        timeout=30.0
                    )
                    
                    stdout, stderr = await result.communicate()
                    
                    if result.returncode != 0:
                        logger.error(f"eSpeak failed: {stderr.decode()}")
                        return None
                    
                    if os.path.exists(tmp_file.name) and os.path.getsize(tmp_file.name) > 44:  # More than WAV header
                        logger.info(f"eSpeak successful: {os.path.getsize(tmp_file.name)} bytes")
                        return tmp_file.name
                    else:
                        logger.warning("eSpeak produced no audio")
                        return None
                        
                except asyncio.TimeoutError:
                    logger.error("eSpeak timeout")
                    return None
                
        except FileNotFoundError:
            logger.warning("eSpeak not available (command not found)")
            return None
        except Exception as e:
            logger.error(f"eSpeak error: {e}")
            return None

    async def generate_silence(self, text_length: int) -> str:
        """Generate silence as ultimate fallback"""
        try:
            # Generate approximately 1 second of silence per 10 characters
            duration = max(1.0, text_length / 10.0)
            duration = min(duration, 10.0)  # Cap at 10 seconds
            
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
                logger.info(f"Generating {duration}s of silence")
                
                # Generate WAV file with silence
                sample_rate = 44100
                samples = int(sample_rate * duration)
                
                # WAV header
                wav_header = b'RIFF' + (samples * 2 + 36).to_bytes(4, 'little') + \
                            b'WAVE' + b'fmt ' + (16).to_bytes(4, 'little') + \
                            (1).to_bytes(2, 'little') + (1).to_bytes(2, 'little') + \
                            sample_rate.to_bytes(4, 'little') + (sample_rate * 2).to_bytes(4, 'little') + \
                            (2).to_bytes(2, 'little') + (16).to_bytes(2, 'little') + \
                            b'data' + (samples * 2).to_bytes(4, 'little')
                
                # Silence data
                silence_data = b'\x00' * (samples * 2)
                
                tmp_file.write(wav_header + silence_data)
                tmp_file.flush()
                
                logger.info(f"Silence generated: {len(wav_header + silence_data)} bytes")
                return tmp_file.name
                
        except Exception as e:
            logger.error(f"Error generating silence: {e}")
            # Create minimal silence file
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
                # Minimal WAV header + 1 second silence
                minimal_wav = b'RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00D\xac\x00\x00\x88X\x01\x00\x02\x00\x10\x00data\x00\x00\x00\x00'
                tmp_file.write(minimal_wav)
                return tmp_file.name

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
    """Synthesize speech from text"""
    start_time = time.time()
    
    try:
        # Validate input
        if not request.text or not request.text.strip():
            raise HTTPException(status_code=400, detail="Text cannot be empty")
        
        text = request.text.strip()
        if len(text) > 5000:
            logger.warning(f"Text too long ({len(text)} chars), truncating to 5000")
            text = text[:5000] + "..."
        
        logger.info(f"Synthesizing: '{text[:100]}...' with voice '{request.voice}' using engine '{request.engine}'")
        
        # Try synthesis with requested or fallback engines
        engines_to_try = []
        
        if request.engine == "chatterbox" or request.engine == "auto":
            engines_to_try.append("chatterbox")
        
        # Add fallbacks
        if request.engine == "auto":
            engines_to_try.extend(["edge_tts", "gtts", "espeak"])
        
        audio_file = None
        engine_used = None
        
        for engine in engines_to_try:
            try:
                if engine == "chatterbox":
                    audio_file = await tts_service.synthesize_with_chatterbox(text, request.voice)
                    if audio_file:
                        engine_used = "chatterbox"
                        break
                elif engine == "edge_tts":
                    audio_file = await tts_service.synthesize_with_edge_tts(text, request.voice)
                    if audio_file:
                        engine_used = "edge_tts"
                        break
                elif engine == "gtts":
                    audio_file = await tts_service.synthesize_with_gtts(text)
                    if audio_file:
                        engine_used = "gtts"
                        break
                elif engine == "espeak":
                    audio_file = await tts_service.synthesize_with_espeak(text, request.voice)
                    if audio_file:
                        engine_used = "espeak"
                        break
            except Exception as engine_error:
                logger.warning(f"Engine {engine} failed: {engine_error}")
                continue
        
        if not audio_file:
            # Generate silence as ultimate fallback
            logger.warning("All engines failed, generating silence")
            audio_file = await tts_service.generate_silence(len(text))
            engine_used = "silence"
        
        if not audio_file or not os.path.exists(audio_file):
            raise HTTPException(status_code=500, detail="Speech synthesis failed - no audio generated")
        
        # Read audio file and return as streaming response
        try:
            def iter_audio():
                try:
                    with open(audio_file, 'rb') as f:
                        while True:
                            chunk = f.read(8192)
                            if not chunk:
                                break
                            yield chunk
                finally:
                    # Clean up temp file
                    if os.path.exists(audio_file):
                        try:
                            os.unlink(audio_file)
                        except:
                            pass
            
            file_size = os.path.getsize(audio_file)
            process_time = time.time() - start_time
            
            logger.info(f"Synthesis successful: {engine_used}, {file_size} bytes, {process_time:.2f}s")
            
            headers = {
                "X-Engine-Used": engine_used,
                "X-Voice-Used": request.voice,
                "X-Process-Time": f"{process_time:.2f}s",
                "Content-Length": str(file_size)
            }
            
            return StreamingResponse(
                iter_audio(),
                media_type="audio/wav",
                headers=headers
            )
            
        except Exception as file_error:
            logger.error(f"Error reading audio file: {file_error}")
            raise HTTPException(status_code=500, detail="Error reading generated audio")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Synthesis error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"TTS synthesis failed: {str(e)}")

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
    """Get available TTS voices"""
    voices = []
    
    # Add Chatterbox voices
    for voice_id, system_voice_id in tts_service.chatterbox_voices.items():
        voices.append({
            "id": voice_id,
            "name": f"Chatterbox {voice_id.replace('_', ' ').title()}",
            "engine": "chatterbox",
            "language": "en",
            "gender": "female" if "female" in voice_id else "male" if "male" in voice_id else "neutral"
        })
    
    return {"voices": voices}

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    gpu_info = {}
    if torch.cuda.is_available():
        gpu_info = {
            "gpu_available": True,
            "gpu_name": torch.cuda.get_device_name(0),
            "gpu_memory_gb": round(torch.cuda.get_device_properties(0).total_memory / 1024**3, 1)
        }
    else:
        gpu_info = {"gpu_available": False}
    
    return {
        "status": "healthy",
        "device": str(tts_service.device),
        "engines": {
            "chatterbox": tts_service.chatterbox_engine is not None,
            "silero": tts_service.silero_model is not None
        },
        "gpu_info": gpu_info,
        "available_voices": len(tts_service.chatterbox_voices)
    }

if __name__ == "__main__":
    logger.info("Starting GPU TTS Service on port 5002")
    uvicorn.run(
        app, 
        host="0.0.0.0", 
        port=5002,
        log_level="info",
        access_log=True,
        timeout_keep_alive=30,
        timeout_graceful_shutdown=10
    ) 