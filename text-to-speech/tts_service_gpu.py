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

# Import additional dependencies for GPU TTS
try:
    from scipy.io.wavfile import write as scipy_write
    SCIPY_AVAILABLE = True
except ImportError:
    SCIPY_AVAILABLE = False
    logger.warning("scipy not available - some audio formats may not work")

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
        self.silero_model = None
        self.silero_speakers = {}
        self.chatterbox_engine = None
        self.chatterbox_voices = {}
        self.engine_lock = threading.Lock()  # Add thread safety
        
        logger.info(f"Initializing GPU TTS service on device: {self.device}")
        # Initialize Silero first (primary GPU engine)
        self._initialize_silero()
        # Initialize Chatterbox as fallback only
        self._initialize_chatterbox()
    
    def _initialize_chatterbox(self):
        """Initialize Chatterbox (pyttsx3) TTS engine - PRIMARY TTS ENGINE"""
        try:
            logger.info("🚀 Initializing Chatterbox TTS (pyttsx3) as PRIMARY engine...")
            
            with self.engine_lock:
                # Initialize with debug disabled for stability
                self.chatterbox_engine = pyttsx3.init(debug=False)
                
                if not self.chatterbox_engine:
                    logger.error("❌ Failed to initialize pyttsx3 engine")
                    return
                
                # Get available voices with better error handling
                try:
                    voices = self.chatterbox_engine.getProperty('voices')
                    logger.info(f"🎵 Chatterbox found {len(voices) if voices else 0} system voices")
                except Exception as voice_error:
                    logger.warning(f"⚠️ Could not get voices: {voice_error}")
                    voices = None
                
                # Enhanced voice configuration matching working implementation
                self.chatterbox_voices = {
                    "default": {"rate": 200, "volume": 0.9, "voice_id": 0},
                    "female_1": {"rate": 180, "volume": 0.9, "voice_id": 0},
                    "male_1": {"rate": 200, "volume": 0.9, "voice_id": 1},
                    "expressive": {"rate": 220, "volume": 1.0, "voice_id": 0},
                    "calm": {"rate": 160, "volume": 0.8, "voice_id": 0},
                    "chatterbox": {"rate": 200, "volume": 0.9, "voice_id": 0}  # Map chatterbox request
                }
                
                # Map available system voices if found
                if voices:
                    for i, voice in enumerate(voices):
                        voice_name = voice.name.lower() if hasattr(voice, 'name') else f"voice_{i}"
                        logger.info(f"   Voice {i}: {voice.id} - {voice_name}")
                        
                        # Update voice IDs based on detected voices
                        if 'female' in voice_name and i < len(voices):
                            self.chatterbox_voices['female_1']['voice_id'] = i
                        elif 'male' in voice_name and i < len(voices):
                            self.chatterbox_voices['male_1']['voice_id'] = i
                
                # Test engine functionality with minimal settings
                try:
                    self.chatterbox_engine.setProperty('rate', 200)
                    self.chatterbox_engine.setProperty('volume', 0.9)
                    logger.info("✅ Chatterbox engine properties set successfully")
                except Exception as prop_error:
                    logger.warning(f"⚠️ Could not set engine properties: {prop_error}")
                
                logger.info("✅ Chatterbox TTS (PRIMARY) engine initialized successfully")
                logger.info(f"   Available voice configs: {list(self.chatterbox_voices.keys())}")
                
        except Exception as e:
            logger.error(f"❌ Failed to initialize Chatterbox engine: {e}")
            logger.error("   Will use fallback engines (Silero -> Edge TTS -> etc.)")
            self.chatterbox_engine = None
    
    def _initialize_silero(self):
        """Initialize Silero TTS model as PRIMARY GPU-accelerated engine"""
        try:
            logger.info("🚀 Loading Silero Neural TTS model...")
            
            # Download and load the Silero model from torch hub
            model, symbols, sample_rate, example_text, apply_tts = torch.hub.load(
                repo_or_dir='snakers4/silero-models',
                model='silero_tts',
                language='en',
                speaker='v3_en',
                trust_repo=True
            )
            
            # Move model to GPU if available
            self.silero_model = model.to(self.device)
            self.silero_apply_tts = apply_tts
            self.silero_sample_rate = sample_rate
            
            # Define voice mapping based on GPU deployment guide
            self.silero_speakers = {
                'chatterbox': 'en_0',        # Map chatterbox to default
                'female_1': 'en_0',          # Female Clear
                'female_2': 'en_1',          # Female Expressive  
                'male_1': 'en_2',            # Male Deep
                'male_2': 'en_3',            # Male Friendly
                'expressive': 'en_1',        # Most natural intonation
                'calm': 'en_0',              # Soothing, relaxing voice
                'announcer': 'en_2',         # Professional announcer
                'storyteller': 'en_3'        # Engaging storytelling
            }
            
            logger.info(f"✅ Silero Neural TTS loaded successfully on {self.device}")
            logger.info(f"   Available voices: {list(self.silero_speakers.keys())}")
            logger.info(f"   Sample rate: {sample_rate}Hz")
            
        except Exception as e:
            logger.error(f"❌ Failed to load Silero model: {e}")
            logger.info("   Silero will not be available - falling back to other engines")
            self.silero_model = None
            self.silero_apply_tts = None

    async def synthesize_with_chatterbox(self, text: str, voice: str) -> Optional[str]:
        """Synthesize speech using Chatterbox (pyttsx3) - PRIMARY TTS ENGINE"""
        if not self.chatterbox_engine:
            logger.warning("Chatterbox engine not initialized - falling back to Silero")
            return None
            
        try:
            with self.engine_lock:
                # Get voice configuration (matches working implementation pattern)
                config = self.chatterbox_voices.get(voice, self.chatterbox_voices["default"])
                
                logger.info(f"🎵 Chatterbox synthesizing - voice: {voice}, rate: {config['rate']}")
                
                # Configure voice properties (improved error handling)
                try:
                    voices = self.chatterbox_engine.getProperty('voices')
                    if voices and len(voices) > config["voice_id"]:
                        self.chatterbox_engine.setProperty('voice', voices[config["voice_id"]].id)
                    else:
                        logger.warning(f"Voice {config['voice_id']} not available, using default")
                except Exception as voice_error:
                    logger.warning(f"Could not set voice: {voice_error}")
                
                # Apply speed and volume (matching working implementation)
                try:
                    self.chatterbox_engine.setProperty('rate', config["rate"])
                    self.chatterbox_engine.setProperty('volume', config["volume"])
                except Exception as prop_error:
                    logger.warning(f"Could not set engine properties: {prop_error}")
                
                # Generate audio to temporary file with improved timeout handling
                with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
                    # Use async approach with shorter timeout (15s instead of 30s)
                    synthesis_done = threading.Event()
                    synthesis_error = None
                    
                    def synthesize_thread():
                        nonlocal synthesis_error
                        try:
                            # Save to file
                            self.chatterbox_engine.save_to_file(text, tmp_file.name)
                            self.chatterbox_engine.runAndWait()
                            synthesis_done.set()
                        except Exception as e:
                            synthesis_error = e
                            synthesis_done.set()
                    
                    thread = threading.Thread(target=synthesize_thread)
                    thread.daemon = True
                    thread.start()
                    
                    # Wait for synthesis with reduced timeout (15s matches backend fixes)
                    if not synthesis_done.wait(timeout=15):
                        logger.warning("⚠️ Chatterbox synthesis timeout (15s) - falling back to Silero")
                        # Clean up
                        if os.path.exists(tmp_file.name):
                            os.unlink(tmp_file.name)
                        return None
                    
                    if synthesis_error:
                        logger.warning(f"⚠️ Chatterbox synthesis error: {synthesis_error} - falling back to Silero")
                        if os.path.exists(tmp_file.name):
                            os.unlink(tmp_file.name)
                        return None
                    
                    # Check if file was created successfully (improved validation)
                    if os.path.exists(tmp_file.name) and os.path.getsize(tmp_file.name) > 44:  # More than WAV header
                        file_size = os.path.getsize(tmp_file.name)
                        logger.info(f"✅ Chatterbox synthesis successful: {file_size} bytes")
                        return tmp_file.name
                    else:
                        logger.warning("⚠️ Chatterbox produced no audio (Docker audio system unavailable) - falling back to Silero")
                        if os.path.exists(tmp_file.name):
                            os.unlink(tmp_file.name)
                        return None
                        
        except Exception as e:
            logger.warning(f"⚠️ Chatterbox TTS error: {e} - falling back to Silero")
            return None

    async def synthesize_with_silero(self, text: str, voice: str) -> Optional[str]:
        """Synthesize speech using Silero Neural TTS (PRIMARY GPU ENGINE)"""
        if not self.silero_model or not self.silero_apply_tts:
            logger.warning("Silero model not available")
            return None
            
        try:
            # Map voice to Silero speaker
            speaker = self.silero_speakers.get(voice, 'en_0')
            
            logger.info(f"🎵 Silero Neural TTS: voice={voice} -> speaker={speaker}")
            
            # Generate audio with GPU acceleration
            with torch.no_grad():
                # Use the loaded apply_tts function
                audio = self.silero_apply_tts(
                    texts=[text],
                    model=self.silero_model,
                    sample_rate=self.silero_sample_rate,
                    speaker=speaker,
                    device=self.device
                )
                
                # audio is a tensor, convert to numpy for saving
                if isinstance(audio, torch.Tensor):
                    audio_np = audio.squeeze().cpu().numpy()
                else:
                    audio_np = audio.squeeze()
            
            # Save to temporary file
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
                # Use torchaudio (preferred) or scipy to save
                try:
                    import torchaudio
                    # Convert numpy back to tensor for torchaudio
                    audio_tensor = torch.from_numpy(audio_np).unsqueeze(0)
                    torchaudio.save(tmp_file.name, audio_tensor, self.silero_sample_rate)
                except ImportError:
                    # Fallback to scipy if available
                    if SCIPY_AVAILABLE:
                        scipy_write(tmp_file.name, self.silero_sample_rate, audio_np)
                    else:
                        raise Exception("Neither torchaudio nor scipy available for audio saving")
                
                logger.info(f"✅ Silero synthesis successful: {os.path.getsize(tmp_file.name)} bytes")
                return tmp_file.name
                
        except Exception as e:
            logger.error(f"❌ Silero TTS error: {e}")
            import traceback
            logger.error(f"   Traceback: {traceback.format_exc()}")
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
            # Corrected fallback order: Chatterbox PRIMARY -> Silero fallback -> others
            engines_to_try = [
                ("chatterbox", self.synthesize_with_chatterbox),  # Primary engine
                ("silero", self.synthesize_with_silero),          # First fallback (GPU)
                ("edge_tts", self.synthesize_with_edge_tts),
                ("gtts", self.synthesize_with_gtts),
                ("espeak", self.synthesize_with_espeak)
            ]
        elif engine == "chatterbox":
            # When specifically requesting chatterbox
            engines_to_try = [
                ("chatterbox", self.synthesize_with_chatterbox),
                ("silero", self.synthesize_with_silero),          # First fallback
                ("edge_tts", self.synthesize_with_edge_tts),
                ("gtts", self.synthesize_with_gtts),
                ("espeak", self.synthesize_with_espeak)
            ]
        else:
            # Try specific engine first, then GPU-optimized fallbacks
            engine_methods = {
                "silero": self.synthesize_with_silero,
                "chatterbox": self.synthesize_with_chatterbox,
                "edge_tts": self.synthesize_with_edge_tts,
                "gtts": self.synthesize_with_gtts,
                "espeak": self.synthesize_with_espeak
            }
            
            if engine in engine_methods:
                engines_to_try.append((engine, engine_methods[engine]))
                # Add GPU-optimized fallbacks first
                fallback_order = ["silero", "edge_tts", "gtts", "espeak", "chatterbox"]
                for fallback_engine in fallback_order:
                    if fallback_engine != engine and fallback_engine in engine_methods:
                        engines_to_try.append((fallback_engine, engine_methods[fallback_engine]))
        
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
    """Get available TTS voices - Chatterbox PRIMARY, Silero fallback"""
    voices = []
    
    # Add Chatterbox voices (PRIMARY ENGINE)
    if tts_service.chatterbox_engine is not None:
        voice_descriptions = {
            "default": {"name": "Chatterbox Default", "gender": "neutral", "description": "Clear, neutral voice"},
            "female_1": {"name": "Chatterbox Female", "gender": "female", "description": "Natural female voice"},
            "male_1": {"name": "Chatterbox Male", "gender": "male", "description": "Deep male voice"},
            "expressive": {"name": "Chatterbox Expressive", "gender": "neutral", "description": "Expressive, dynamic voice"},
            "calm": {"name": "Chatterbox Calm", "gender": "neutral", "description": "Calm, soothing voice"},
            "chatterbox": {"name": "Chatterbox Default", "gender": "neutral", "description": "Default Chatterbox voice"}
        }
        
        for voice_id in tts_service.chatterbox_voices.keys():
            voice_info = voice_descriptions.get(voice_id, {"name": f"Chatterbox {voice_id}", "gender": "neutral", "description": "System voice"})
            voices.append({
                "id": voice_id,
                "name": voice_info["name"],
                "engine": "chatterbox",
                "language": "en",
                "gender": voice_info["gender"],
                "description": voice_info["description"],
                "quality": "high",
                "gpu_accelerated": False,
                "primary": True
            })
    
    # Add Silero voices as fallback (if available)
    if tts_service.silero_model is not None:
        silero_voice_descriptions = {
            "chatterbox": {"name": "Silero Default (Fallback)", "gender": "female", "description": "Neural fallback voice"},
            "female_1": {"name": "Silero Female Clear (Fallback)", "gender": "female", "description": "Clear, professional fallback"},
            "female_2": {"name": "Silero Female Expressive (Fallback)", "gender": "female", "description": "Dynamic fallback"},
            "male_1": {"name": "Silero Male Deep (Fallback)", "gender": "male", "description": "Deep fallback voice"},
            "male_2": {"name": "Silero Male Friendly (Fallback)", "gender": "male", "description": "Friendly fallback"},
            "expressive": {"name": "Silero Expressive (Fallback)", "gender": "female", "description": "Expressive fallback"},
            "calm": {"name": "Silero Calm (Fallback)", "gender": "female", "description": "Calm fallback"},
            "announcer": {"name": "Silero Announcer (Fallback)", "gender": "male", "description": "Professional fallback"},
            "storyteller": {"name": "Silero Storyteller (Fallback)", "gender": "male", "description": "Storytelling fallback"}
        }
        
        for voice_id in tts_service.silero_speakers.keys():
            # Only add if not already covered by Chatterbox
            if not any(v["id"] == voice_id and v["engine"] == "chatterbox" for v in voices):
                voice_info = silero_voice_descriptions.get(voice_id, {"name": f"Silero {voice_id} (Fallback)", "gender": "neutral", "description": "Neural fallback"})
                voices.append({
                    "id": voice_id,
                    "name": voice_info["name"],
                    "engine": "silero",
                    "language": "en",
                    "gender": voice_info["gender"],
                    "description": voice_info["description"],
                    "quality": "high",
                    "gpu_accelerated": True,
                    "primary": False
                })
    
    return {
        "voices": voices,
        "primary_engine": "chatterbox",
        "fallback_available": tts_service.silero_model is not None
    }

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    gpu_info = {}
    if torch.cuda.is_available():
        gpu_info = {
            "gpu_available": True,
            "gpu_name": torch.cuda.get_device_name(0),
            "gpu_memory_gb": round(torch.cuda.get_device_properties(0).total_memory / 1024**3, 1),
            "cuda_version": torch.version.cuda if torch.version.cuda else "unknown"
        }
    else:
        gpu_info = {"gpu_available": False}
    
    # Determine primary engine (Chatterbox is primary, Silero is first fallback)
    primary_engine = "none"
    if tts_service.chatterbox_engine is not None:
        primary_engine = "chatterbox"
    elif tts_service.silero_model is not None:
        primary_engine = "silero"
    
    return {
        "status": "healthy",
        "device": str(tts_service.device),
        "primary_engine": primary_engine,
        "engines": {
            "chatterbox": tts_service.chatterbox_engine is not None,  # PRIMARY
            "silero": tts_service.silero_model is not None,           # First fallback (GPU)
            "edge_tts": True,  # Always available if network works
            "gtts": True,      # Always available if network works  
            "espeak": True     # Usually available in most containers
        },
        "gpu_info": gpu_info,
        "available_voices": len(tts_service.chatterbox_voices) if tts_service.chatterbox_engine else len(tts_service.silero_speakers),
        "voice_options": list(tts_service.chatterbox_voices.keys()) if tts_service.chatterbox_engine else list(tts_service.silero_speakers.keys())
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