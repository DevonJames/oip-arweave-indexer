#!/usr/bin/env python3
"""
Unified Voice Processor for ALFRED Voice Agent

This service combines VAD, STT, and Smart Turn processing into a single
coordinated pipeline, eliminating IPC overhead and optimizing performance.

Key Features:
- Single process for all voice processing
- Shared memory and state management
- Frame-level pipeline coordination
- Optimized resource utilization
- Real-time performance monitoring
"""

import asyncio
import io
import json
import logging
import os
import time
import wave
import threading
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass
from queue import Queue, Empty
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, BackgroundTasks
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import torch
from mlx_whisper.load_models import load_model
from mlx_whisper import transcribe

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@dataclass
class AudioFrame:
    """Audio frame data structure"""
    data: np.ndarray
    frame_index: int
    timestamp: float
    energy: float
    session_id: str

@dataclass
class ProcessingResult:
    """Combined processing result from all components"""
    frame_index: int
    timestamp: float
    session_id: str
    
    # VAD results
    has_speech: bool
    speech_confidence: float
    speech_state: str  # 'silence', 'speech_start', 'speech_continue', 'speech_end'
    
    # STT results
    partial_text: str
    final_text: str
    stt_confidence: float
    transcription_complete: bool
    
    # Smart Turn results
    interruption_probability: float
    is_interruption: bool
    interruption_reason: str
    can_interrupt: bool
    
    # Performance metrics
    processing_time_ms: float
    pipeline_latency_ms: float

class UnifiedVoiceProcessor:
    """Unified voice processing pipeline combining VAD, STT, and Smart Turn"""
    
    def __init__(self):
        # Configuration
        self.sample_rate = 16000
        self.frame_duration_ms = 20
        self.frame_size = int(self.sample_rate * self.frame_duration_ms / 1000)  # 320 samples
        
        # Models
        self.whisper_model = None
        self.vad_model = None
        
        # Processing pipeline
        self.frame_queue = Queue(maxsize=500)  # 10 seconds of frames
        self.processing_thread = None
        self.is_processing = False
        
        # Session management
        self.active_sessions = {}  # session_id -> session_data
        self.session_lock = threading.Lock()
        
        # Shared pipeline state
        self.pipeline_state = {
            'frames_processed': 0,
            'sessions_active': 0,
            'processing_load': 0.0,
            'memory_usage_mb': 0,
            'pipeline_health': 'healthy'
        }
        
        # Performance optimization
        self.batch_processing = True
        self.max_batch_size = 5  # Process up to 5 frames together
        self.processing_timeout = 0.010  # 10ms processing timeout per frame
        
        # Interruption configuration
        self.interruption_config = {
            'energy_threshold': 0.02,
            'confidence_threshold': 0.7,
            'temporal_threshold': 0.5,
            'context_window_frames': 25,
            'silence_frames_for_endpoint': 10,
            'cooldown_frames': 50  # 1 second cooldown
        }
        
        # Performance metrics
        self.metrics = {
            'total_frames_processed': 0,
            'average_processing_time': 0,
            'pipeline_throughput': 0,
            'memory_efficiency': 100,
            'interruptions_detected': 0,
            'transcriptions_completed': 0,
            'uptime_seconds': 0
        }
        
        self.start_time = time.time()
        
        logger.info("🚀 Initializing Unified Voice Processor...")
    
    async def initialize(self):
        """Initialize all models and components in the unified pipeline"""
        try:
            logger.info("📥 Loading models for unified pipeline...")
            
            # Load Whisper model
            logger.info("Loading MLX Whisper model...")
            self.whisper_model = load_model("mlx-community/whisper-large-v3-mlx-4bit")
            logger.info("✅ MLX Whisper model loaded")
            
            # Load Silero VAD
            logger.info("Loading Silero VAD model...")
            try:
                self.vad_model, utils = torch.hub.load(
                    repo_or_dir='snakers4/silero-vad',
                    model='silero_vad',
                    force_reload=False,
                    onnx=False
                )
                self.vad_model.eval()
                logger.info("✅ Silero VAD model loaded")
            except Exception as e:
                logger.warning(f"⚠️ Failed to load Silero VAD: {e}")
                self.vad_model = None
            
            # Initialize processing thread
            self.start_processing_thread()
            
            # Start metrics collection
            self.start_metrics_collection()
            
            logger.info("✅ Unified Voice Processor initialized successfully")
            
        except Exception as e:
            logger.error(f"❌ Failed to initialize Unified Voice Processor: {e}")
            raise
    
    def start_processing_thread(self):
        """Start the unified processing thread"""
        self.is_processing = True
        self.processing_thread = threading.Thread(
            target=self._processing_loop,
            daemon=True,
            name="UnifiedVoiceProcessor"
        )
        self.processing_thread.start()
        logger.info("🔄 Unified processing thread started")
    
    def _processing_loop(self):
        """Main processing loop - runs in separate thread"""
        logger.info("🎯 Starting unified processing loop...")
        
        while self.is_processing:
            try:
                # Process frames in batches for efficiency
                frames_batch = []
                
                # Collect frames for batch processing
                batch_start_time = time.time()
                while len(frames_batch) < self.max_batch_size:
                    try:
                        frame = self.frame_queue.get(timeout=0.005)  # 5ms timeout
                        frames_batch.append(frame)
                    except Empty:
                        break
                
                if frames_batch:
                    # Process the batch
                    self._process_frame_batch(frames_batch)
                    
                    # Update pipeline metrics
                    batch_processing_time = (time.time() - batch_start_time) * 1000
                    self._update_pipeline_metrics(len(frames_batch), batch_processing_time)
                
                # Small sleep to prevent CPU spinning
                time.sleep(0.001)  # 1ms
                
            except Exception as e:
                logger.error(f"Processing loop error: {e}")
                time.sleep(0.01)  # Longer sleep on error
    
    def _process_frame_batch(self, frames_batch: List[AudioFrame]):
        """Process a batch of audio frames through the unified pipeline"""
        for frame in frames_batch:
            try:
                start_time = time.time()
                
                # Get or create session
                session = self._get_or_create_session(frame.session_id)
                
                # Process through unified pipeline
                result = self._process_frame_unified(frame, session)
                
                # Update session state
                self._update_session_state(session, result)
                
                # Emit result (this would be sent to WebRTC client)
                self._emit_processing_result(result)
                
                # Update performance metrics
                processing_time = (time.time() - start_time) * 1000
                self.metrics['average_processing_time'] = (
                    self.metrics['average_processing_time'] * 0.9 + processing_time * 0.1
                )
                
            except Exception as e:
                logger.error(f"Frame processing error: {e}")
    
    def _process_frame_unified(self, frame: AudioFrame, session: Dict) -> ProcessingResult:
        """Process single frame through unified VAD + STT + Smart Turn pipeline"""
        
        # Step 1: Voice Activity Detection
        has_speech, speech_confidence = self._process_vad(frame.data)
        
        # Update speech state
        speech_state = self._update_speech_state(session, has_speech, frame.frame_index)
        
        # Step 2: Speech-to-Text Processing (only if speech detected)
        partial_text = ""
        final_text = ""
        stt_confidence = 0.0
        transcription_complete = False
        
        if has_speech or session['speech_active']:
            # Add frame to STT buffer
            session['stt_buffer'].append(frame.data)
            
            # Generate partial transcription every 10 frames (200ms)
            if len(session['stt_buffer']) >= 10:
                partial_text = self._get_partial_transcription(session['stt_buffer'])
                stt_confidence = 0.8  # Placeholder confidence
                
                # Keep buffer manageable
                if len(session['stt_buffer']) > 50:  # 1 second
                    session['stt_buffer'] = session['stt_buffer'][-25:]  # Keep last 500ms
            
            # Generate final transcription when speech ends
            if speech_state == 'speech_end' and session['stt_buffer']:
                final_text = self._get_final_transcription(session['stt_buffer'])
                transcription_complete = True
                session['stt_buffer'] = []  # Clear buffer
        
        # Step 3: Smart Turn / Interruption Detection
        interruption_probability = 0.0
        is_interruption = False
        interruption_reason = "no_analysis"
        can_interrupt = False
        
        if has_speech and session['agent_speaking']:
            # Analyze for interruption intent
            interruption_result = self._analyze_interruption(
                frame.data, 
                session, 
                partial_text or final_text
            )
            
            interruption_probability = interruption_result['probability']
            is_interruption = interruption_result['is_interruption']
            interruption_reason = interruption_result['reason']
            can_interrupt = interruption_result['can_interrupt']
        
        # Create unified result
        return ProcessingResult(
            frame_index=frame.frame_index,
            timestamp=frame.timestamp,
            session_id=frame.session_id,
            
            # VAD results
            has_speech=has_speech,
            speech_confidence=speech_confidence,
            speech_state=speech_state,
            
            # STT results
            partial_text=partial_text,
            final_text=final_text,
            stt_confidence=stt_confidence,
            transcription_complete=transcription_complete,
            
            # Smart Turn results
            interruption_probability=interruption_probability,
            is_interruption=is_interruption,
            interruption_reason=interruption_reason,
            can_interrupt=can_interrupt,
            
            # Performance
            processing_time_ms=(time.time() - frame.timestamp) * 1000,
            pipeline_latency_ms=(time.time() - frame.timestamp) * 1000
        )
    
    def _process_vad(self, audio_data: np.ndarray) -> Tuple[bool, float]:
        """Process VAD with optimized shared model"""
        if self.vad_model is None:
            # Energy-based fallback
            energy = np.sqrt(np.mean(audio_data ** 2))
            return energy > self.interruption_config['energy_threshold'], energy
        
        try:
            # Silero VAD requires exactly 512 samples for 16kHz
            if len(audio_data) != 512:
                if len(audio_data) > 512:
                    # Take first 512 samples
                    audio_data = audio_data[:512]
                else:
                    # Pad to 512 samples
                    padded = np.zeros(512)
                    padded[:len(audio_data)] = audio_data
                    audio_data = padded
            
            # Process with shared VAD model
            audio_tensor = torch.FloatTensor(audio_data).unsqueeze(0)
            with torch.no_grad():
                speech_prob = self.vad_model(audio_tensor, self.sample_rate).item()
            
            return speech_prob > 0.5, speech_prob
            
        except Exception as e:
            logger.warning(f"VAD processing error: {e}")
            # Fallback to energy
            energy = np.sqrt(np.mean(audio_data ** 2))
            return energy > self.interruption_config['energy_threshold'], energy
    
    def _update_speech_state(self, session: Dict, has_speech: bool, frame_index: int) -> str:
        """Update speech state with transition detection"""
        prev_speech = session.get('speech_active', False)
        
        if has_speech and not prev_speech:
            # Speech started
            session['speech_active'] = True
            session['speech_start_frame'] = frame_index
            session['silence_frame_count'] = 0
            return 'speech_start'
            
        elif has_speech and prev_speech:
            # Speech continues
            session['silence_frame_count'] = 0
            return 'speech_continue'
            
        elif not has_speech and prev_speech:
            # Potential speech end
            session['silence_frame_count'] += 1
            
            if session['silence_frame_count'] >= self.interruption_config['silence_frames_for_endpoint']:
                # Speech ended
                session['speech_active'] = False
                session['speech_end_frame'] = frame_index
                return 'speech_end'
            else:
                # Still in speech (brief pause)
                return 'speech_continue'
        else:
            # Silence continues
            return 'silence'
    
    def _get_partial_transcription(self, audio_buffer: List[np.ndarray]) -> str:
        """Get partial transcription from audio buffer"""
        try:
            if len(audio_buffer) < 5:  # Need at least 100ms
                return ""
            
            # Combine recent frames
            combined_audio = np.concatenate(audio_buffer[-10:])  # Last 200ms
            
            if len(combined_audio) < self.sample_rate * 0.2:  # Less than 200ms
                return ""
            
            # Quick transcription with minimal processing
            result = transcribe(
                combined_audio,
                path_or_hf_repo="mlx-community/whisper-large-v3-mlx-4bit",
                language="en",
                task="transcribe",
                temperature=0.0,
                condition_on_previous_text=False,
                fp16=True,
                no_speech_threshold=0.6
            )
            
            return result.get('text', '').strip()
            
        except Exception as e:
            logger.warning(f"Partial transcription error: {e}")
            return ""
    
    def _get_final_transcription(self, audio_buffer: List[np.ndarray]) -> str:
        """Get final transcription with full quality processing"""
        try:
            if not audio_buffer:
                return ""
            
            # Combine all audio
            combined_audio = np.concatenate(audio_buffer)
            
            if len(combined_audio) < self.sample_rate * 0.3:  # Less than 300ms
                return ""
            
            # Full quality transcription
            result = transcribe(
                combined_audio,
                path_or_hf_repo="mlx-community/whisper-large-v3-mlx-4bit",
                language="en",
                task="transcribe",
                temperature=0.0,
                condition_on_previous_text=True,
                fp16=True,
                no_speech_threshold=0.6
            )
            
            text = result.get('text', '').strip()
            logger.info(f"Final transcription: '{text}'")
            return text
            
        except Exception as e:
            logger.error(f"Final transcription error: {e}")
            return ""
    
    def _analyze_interruption(self, audio_data: np.ndarray, session: Dict, 
                            transcript: str = "") -> Dict:
        """Analyze interruption intent using unified smart-turn equivalent"""
        try:
            # Check if interruption is possible
            can_interrupt = self._can_interrupt(session)
            if not can_interrupt:
                return {
                    'probability': 0.0,
                    'is_interruption': False,
                    'reason': 'interruption_not_allowed',
                    'can_interrupt': False
                }
            
            # Multi-factor interruption analysis
            scores = {}
            
            # Energy analysis
            current_energy = np.sqrt(np.mean(audio_data ** 2))
            if len(session.get('energy_history', [])) > 0:
                avg_energy = np.mean(session['energy_history'][-5:])
                if current_energy > avg_energy * 2.0:
                    scores['energy_increase'] = min(1.0, current_energy / avg_energy / 2.0)
            
            # Update energy history
            if 'energy_history' not in session:
                session['energy_history'] = []
            session['energy_history'].append(current_energy)
            if len(session['energy_history']) > 25:  # Keep last 500ms
                session['energy_history'] = session['energy_history'][-25:]
            
            # Speech pattern analysis
            speech_frames = session.get('recent_speech_frames', [])
            if len(speech_frames) >= 5:
                speech_density = sum(speech_frames[-5:]) / 5.0
                if speech_density > 0.6:
                    scores['sustained_speech'] = speech_density
            
            # Transcript analysis
            if transcript:
                transcript_lower = transcript.lower()
                interruption_keywords = ['wait', 'stop', 'excuse me', 'actually', 'but', 'however']
                keyword_matches = sum(1 for keyword in interruption_keywords 
                                    if keyword in transcript_lower)
                if keyword_matches > 0:
                    scores['interruption_keywords'] = min(1.0, keyword_matches / 2.0)
            
            # Calculate weighted probability
            weights = {
                'energy_increase': 0.3,
                'sustained_speech': 0.4,
                'interruption_keywords': 0.3
            }
            
            total_score = 0
            total_weight = 0
            for pattern, score in scores.items():
                if pattern in weights:
                    total_score += score * weights[pattern]
                    total_weight += weights[pattern]
            
            probability = total_score / max(total_weight, 1.0)
            is_interruption = probability > self.interruption_config['confidence_threshold']
            
            return {
                'probability': probability,
                'is_interruption': is_interruption,
                'reason': 'multi_factor_analysis',
                'can_interrupt': can_interrupt,
                'pattern_scores': scores
            }
            
        except Exception as e:
            logger.error(f"Interruption analysis error: {e}")
            return {
                'probability': 0.0,
                'is_interruption': False,
                'reason': f'analysis_error: {e}',
                'can_interrupt': False
            }
    
    def _can_interrupt(self, session: Dict) -> bool:
        """Check if interruption is allowed for session"""
        # Must be during agent speech
        if not session.get('agent_speaking', False):
            return False
        
        # Must respect temporal threshold
        if session.get('agent_speech_start_frame'):
            frames_elapsed = session['frame_count'] - session['agent_speech_start_frame']
            time_elapsed = frames_elapsed * self.frame_duration_ms / 1000
            if time_elapsed < self.interruption_config['temporal_threshold']:
                return False
        
        # Must respect cooldown period
        if session.get('last_interruption_frame'):
            frames_since_interruption = session['frame_count'] - session['last_interruption_frame']
            if frames_since_interruption < self.interruption_config['cooldown_frames']:
                return False
        
        return True
    
    def _get_or_create_session(self, session_id: str) -> Dict:
        """Get or create session with thread safety"""
        with self.session_lock:
            if session_id not in self.active_sessions:
                self.active_sessions[session_id] = {
                    'session_id': session_id,
                    'created_at': time.time(),
                    'frame_count': 0,
                    'speech_active': False,
                    'speech_start_frame': None,
                    'speech_end_frame': None,
                    'silence_frame_count': 0,
                    'stt_buffer': [],
                    'energy_history': [],
                    'recent_speech_frames': [],
                    'agent_speaking': False,
                    'agent_speech_start_frame': None,
                    'last_interruption_frame': None,
                    'conversation_context': [],
                    'performance_metrics': {
                        'frames_processed': 0,
                        'transcriptions_completed': 0,
                        'interruptions_detected': 0
                    }
                }
                self.pipeline_state['sessions_active'] += 1
                logger.info(f"Created new session: {session_id}")
            
            return self.active_sessions[session_id]
    
    def _update_session_state(self, session: Dict, result: ProcessingResult):
        """Update session state with processing result"""
        session['frame_count'] = result.frame_index
        session['performance_metrics']['frames_processed'] += 1
        
        # Update speech tracking
        session['recent_speech_frames'].append(result.has_speech)
        if len(session['recent_speech_frames']) > 25:  # Keep last 500ms
            session['recent_speech_frames'] = session['recent_speech_frames'][-25:]
        
        # Update transcription counts
        if result.transcription_complete:
            session['performance_metrics']['transcriptions_completed'] += 1
            self.metrics['transcriptions_completed'] += 1
        
        # Update interruption counts
        if result.is_interruption:
            session['performance_metrics']['interruptions_detected'] += 1
            session['last_interruption_frame'] = result.frame_index
            self.metrics['interruptions_detected'] += 1
    
    def _emit_processing_result(self, result: ProcessingResult):
        """Emit processing result (would be sent to WebRTC client)"""
        # This would integrate with the WebRTC signaling server
        # For now, just log significant events
        
        if result.speech_state == 'speech_start':
            logger.info(f"Speech started in session {result.session_id}")
        
        if result.partial_text:
            logger.info(f"Partial transcription: '{result.partial_text}'")
        
        if result.final_text:
            logger.info(f"Final transcription: '{result.final_text}'")
        
        if result.is_interruption:
            logger.info(f"Interruption detected! Confidence: {result.interruption_probability:.3f}")
    
    def _update_pipeline_metrics(self, frames_processed: int, processing_time_ms: float):
        """Update pipeline performance metrics"""
        self.metrics['total_frames_processed'] += frames_processed
        self.pipeline_state['frames_processed'] += frames_processed
        
        # Calculate throughput (frames per second)
        uptime = time.time() - self.start_time
        self.metrics['pipeline_throughput'] = self.metrics['total_frames_processed'] / uptime
        self.metrics['uptime_seconds'] = uptime
        
        # Update processing load
        target_processing_time = frames_processed * self.frame_duration_ms  # Target time
        processing_load = (processing_time_ms / target_processing_time) * 100
        self.pipeline_state['processing_load'] = (
            self.pipeline_state['processing_load'] * 0.9 + processing_load * 0.1
        )
        
        # Update pipeline health
        if processing_load > 150:  # >150% of target time
            self.pipeline_state['pipeline_health'] = 'overloaded'
        elif processing_load > 100:
            self.pipeline_state['pipeline_health'] = 'stressed'
        else:
            self.pipeline_state['pipeline_health'] = 'healthy'
    
    def start_metrics_collection(self):
        """Start background metrics collection"""
        def metrics_loop():
            while self.is_processing:
                try:
                    # Update memory usage
                    import psutil
                    process = psutil.Process()
                    memory_mb = process.memory_info().rss / 1024 / 1024
                    self.pipeline_state['memory_usage_mb'] = memory_mb
                    
                    # Calculate memory efficiency
                    sessions = len(self.active_sessions)
                    if sessions > 0:
                        memory_per_session = memory_mb / sessions
                        self.metrics['memory_efficiency'] = max(0, 100 - memory_per_session)
                    
                    time.sleep(5)  # Update every 5 seconds
                    
                except Exception as e:
                    logger.warning(f"Metrics collection error: {e}")
                    time.sleep(10)
        
        metrics_thread = threading.Thread(target=metrics_loop, daemon=True)
        metrics_thread.start()
    
    # Public API methods
    
    async def process_audio_frame(self, session_id: str, audio_bytes: bytes) -> Dict:
        """Process single audio frame through unified pipeline - SYNCHRONOUS for real-time results"""
        try:
            # Preprocess audio
            audio_data = self._preprocess_audio(audio_bytes)
            
            # Create frame object
            frame = AudioFrame(
                data=audio_data,
                frame_index=self.pipeline_state['frames_processed'],
                timestamp=time.time(),
                energy=np.sqrt(np.mean(audio_data ** 2)),
                session_id=session_id
            )
            
            # Process synchronously for real-time feedback
            result = self._process_pipeline_frame(frame)
            
            # Update metrics
            self.pipeline_state['frames_processed'] += 1
            
            # Return the actual processing results for real-time feedback
            return {
                "status": "processed",
                "frame_index": result.frame_index,
                "session_id": session_id,
                # VAD results
                "has_speech": result.has_speech,
                "speech_confidence": result.speech_confidence,
                "speech_state": result.speech_state,
                # STT results - THE KEY REAL-TIME DATA
                "partial_text": result.partial_text,
                "final_text": result.final_text,
                "stt_confidence": result.stt_confidence,
                "transcription_complete": result.transcription_complete,
                # Smart Turn results
                "interruption_probability": result.interruption_probability,
                "is_interruption": result.is_interruption,
                "can_interrupt": result.can_interrupt,
                # Performance
                "processing_time_ms": result.processing_time_ms
            }
            
        except Exception as e:
            logger.error(f"Frame processing error: {e}")
            raise HTTPException(status_code=500, detail=f"Processing failed: {e}")
    
    def _preprocess_audio(self, audio_bytes: bytes) -> np.ndarray:
        """Preprocess audio bytes (handles WebM, WAV, etc.)"""
        try:
            # For WebM/Opus audio, we need to use a different approach
            # First try to save and use external tool, then fallback to raw processing
            
            import tempfile
            import subprocess
            
            try:
                # Save audio to temporary file
                with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as temp_file:
                    temp_file.write(audio_bytes)
                    temp_path = temp_file.name
                
                try:
                    # Try to convert WebM to WAV using ffmpeg (if available)
                    wav_path = temp_path.replace('.webm', '.wav')
                    result = subprocess.run([
                        'ffmpeg', '-i', temp_path, '-ar', '16000', '-ac', '1', 
                        '-f', 'wav', wav_path, '-y'
                    ], capture_output=True, timeout=10)
                    
                    if result.returncode == 0:
                        # Read the converted WAV file
                        with open(wav_path, 'rb') as wav_file:
                            wav_data = wav_file.read()
                        
                        # Clean up temp files
                        os.unlink(temp_path)
                        os.unlink(wav_path)
                        
                        # Process WAV data
                        with io.BytesIO(wav_data) as wav_io:
                            with wave.open(wav_io, 'rb') as wav:
                                frames = wav.readframes(-1)
                                audio_data = np.frombuffer(frames, dtype=np.int16)
                                return audio_data.astype(np.float32) / 32768.0
                    
                except (subprocess.TimeoutExpired, subprocess.CalledProcessError, FileNotFoundError):
                    # ffmpeg not available or failed, try other methods
                    pass
                finally:
                    # Clean up temp file
                    try:
                        os.unlink(temp_path)
                    except:
                        pass
                
            except Exception:
                pass
            
            # Fallback: Try to treat as WAV
            try:
                with io.BytesIO(audio_bytes) as wav_io:
                    with wave.open(wav_io, 'rb') as wav_file:
                        frames = wav_file.readframes(-1)
                        audio_data = np.frombuffer(frames, dtype=np.int16)
                        return audio_data.astype(np.float32) / 32768.0
            except:
                pass
            
            # Final fallback: Try as raw PCM (but check buffer size first)
            if len(audio_bytes) % 2 != 0:
                # Odd number of bytes, can't be 16-bit PCM
                logger.error(f"Invalid audio data: {len(audio_bytes)} bytes (not 16-bit PCM compatible)")
                raise ValueError("Invalid audio format - cannot process")
            
            try:
                audio_data = np.frombuffer(audio_bytes, dtype=np.int16)
                return audio_data.astype(np.float32) / 32768.0
            except Exception as e:
                logger.error(f"Final fallback failed: {e}")
                raise ValueError(f"Cannot process audio format: {e}")
                
        except Exception as e:
            logger.error(f"Audio preprocessing error: {e}")
            raise HTTPException(status_code=400, detail=f"Invalid audio format: {e}")
    
    async def set_agent_speaking_state(self, session_id: str, is_speaking: bool):
        """Set agent speaking state for session"""
        session = self._get_or_create_session(session_id)
        
        if is_speaking and not session['agent_speaking']:
            session['agent_speaking'] = True
            session['agent_speech_start_frame'] = session['frame_count']
            logger.info(f"Agent started speaking in session {session_id}")
            
        elif not is_speaking and session['agent_speaking']:
            session['agent_speaking'] = False
            session['agent_speech_start_frame'] = None
            logger.info(f"Agent stopped speaking in session {session_id}")
    
    async def cleanup_session(self, session_id: str):
        """Clean up session data"""
        with self.session_lock:
            if session_id in self.active_sessions:
                del self.active_sessions[session_id]
                self.pipeline_state['sessions_active'] -= 1
                logger.info(f"Cleaned up session: {session_id}")
    
    def get_pipeline_status(self) -> Dict:
        """Get unified pipeline status"""
        return {
            'pipeline_state': self.pipeline_state,
            'metrics': self.metrics,
            'active_sessions': len(self.active_sessions),
            'queue_size': self.frame_queue.qsize(),
            'is_processing': self.is_processing,
            'models_loaded': {
                'whisper': self.whisper_model is not None,
                'vad': self.vad_model is not None
            }
        }
    
    def shutdown(self):
        """Shutdown the unified processor"""
        logger.info("🛑 Shutting down Unified Voice Processor...")
        
        self.is_processing = False
        
        if self.processing_thread and self.processing_thread.is_alive():
            self.processing_thread.join(timeout=5)
        
        # Clear all sessions
        with self.session_lock:
            self.active_sessions.clear()
        
        logger.info("✅ Unified Voice Processor shutdown complete")


# Initialize unified processor
unified_processor = UnifiedVoiceProcessor()

# FastAPI application
app = FastAPI(
    title="Unified Voice Processor",
    description="Combined VAD, STT, and Smart Turn processing in single pipeline",
    version="4.0.0"
)

# Add CORS middleware to allow requests from the voice interface
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3001",  # Voice interface
        "http://localhost:3000",  # Other interfaces
        "http://localhost:8080",  # Development
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup_event():
    """Initialize the unified processor on startup"""
    await unified_processor.initialize()

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    unified_processor.shutdown()

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    status = unified_processor.get_pipeline_status()
    return {
        "status": "healthy" if status['pipeline_state']['pipeline_health'] == 'healthy' else "degraded",
        "service": "Unified Voice Processor",
        "version": "4.0.0",
        "pipeline": status
    }

@app.post("/process_frame")
async def process_frame(
    session_id: str = Form(...),
    audio_file: UploadFile = File(...)
):
    """Process single audio frame through unified pipeline"""
    audio_bytes = await audio_file.read()
    result = await unified_processor.process_audio_frame(session_id, audio_bytes)
    return result

@app.post("/set_speaker_state")
async def set_speaker_state(
    session_id: str = Form(...),
    agent_speaking: bool = Form(...)
):
    """Set agent speaking state"""
    await unified_processor.set_agent_speaking_state(session_id, agent_speaking)
    return {"status": "updated", "session_id": session_id, "agent_speaking": agent_speaking}

@app.get("/session/{session_id}/status")
async def get_session_status(session_id: str):
    """Get session status"""
    if session_id not in unified_processor.active_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session = unified_processor.active_sessions[session_id]
    return {
        "session_id": session_id,
        "session_data": session,
        "can_interrupt": unified_processor._can_interrupt(session)
    }

@app.delete("/session/{session_id}")
async def cleanup_session(session_id: str):
    """Clean up session"""
    await unified_processor.cleanup_session(session_id)
    return {"message": f"Session {session_id} cleaned up"}

@app.get("/metrics")
async def get_metrics():
    """Get pipeline metrics"""
    return unified_processor.get_pipeline_status()

@app.get("/pipeline/status")
async def get_pipeline_status():
    """Get detailed pipeline status"""
    return unified_processor.get_pipeline_status()

# Legacy compatibility endpoints
@app.post("/transcribe_file")
async def transcribe_file_legacy(
    file: UploadFile = File(...),
    language: str = Form("en"),
    task: str = Form("transcribe")
):
    """Legacy transcription endpoint"""
    start_time = time.time()
    
    try:
        # Read audio file
        audio_bytes = await file.read()
        
        # Preprocess audio
        audio_data = unified_processor._preprocess_audio(audio_bytes)
        
        # Check for speech
        has_speech, confidence = unified_processor._process_vad(audio_data)
        
        if not has_speech and len(audio_data) < unified_processor.sample_rate:
            # Very short audio with no speech
            return {
                "text": "",
                "language": language,
                "duration": len(audio_data) / unified_processor.sample_rate,
                "confidence": 0.0,
                "has_speech": False
            }
        
        # Get transcription using the model path (not model object)
        if len(audio_data) < unified_processor.sample_rate * 0.3:  # Less than 300ms
            text = ""
        else:
            result = transcribe(
                audio_data,
                path_or_hf_repo="mlx-community/whisper-large-v3-mlx-4bit",  # Use model path, not object
                language=language,
                task=task,
                temperature=0.0,
                condition_on_previous_text=False,
                fp16=True,
                no_speech_threshold=0.6
            )
            text = result.get('text', '').strip()
        
        duration = len(audio_data) / unified_processor.sample_rate
        processing_time = (time.time() - start_time) * 1000
        
        logger.info(f"Transcribed ({processing_time:.1f}ms): '{text}'")
        
        return {
            "text": text,
            "language": result.get('language', language) if 'result' in locals() else language,
            "duration": duration,
            "confidence": 1.0 - result.get('no_speech_prob', 0.0) if 'result' in locals() else confidence,
            "has_speech": has_speech,
            "processing_time_ms": processing_time
        }
        
    except Exception as e:
        logger.error(f"Transcription error: {e}")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}")

@app.post("/process_audio_stream")
async def process_audio_stream(
    audio_data: str = Form(...),
    client_id: str = Form(...),
    format: Optional[str] = Form("raw")
):
    """Process streaming audio data from WebRTC client"""
    try:
        logger.info(f"Processing audio stream from client {client_id}, format: {format}")
        
        # Convert audio data from array format
        if isinstance(audio_data, str):
            # Parse JSON array of PCM samples from WebRTC
            import json
            try:
                pcm_samples = json.loads(audio_data)
                # Convert to numpy array and then to bytes
                import numpy as np
                pcm_array = np.array(pcm_samples, dtype=np.int16)
                audio_bytes = pcm_array.tobytes()
            except Exception as e:
                logger.warning(f"Failed to parse WebRTC audio data: {e}")
                # Fallback: treat as raw bytes
                audio_bytes = audio_data.encode() if isinstance(audio_data, str) else audio_data
        else:
            audio_bytes = audio_data
        
        logger.info(f"Processing {len(audio_bytes)} bytes of streaming audio")
        
        # For WebRTC streaming, accumulate audio and process when we have enough
        session_id = f"webrtc_{client_id}"
        
        # Convert bytes directly to numpy array for WebRTC PCM data
        try:
            import numpy as np
            if len(audio_bytes) % 2 == 0:  # Valid 16-bit PCM
                audio_data = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
                
                # Use unified processor's frame processing (accumulates audio over time)
                result = await unified_processor.process_audio_frame(session_id, audio_bytes)
                
            else:
                logger.error(f"Invalid PCM data length: {len(audio_bytes)} bytes")
                result = {"text": "", "confidence": 0.0, "has_speech": False, "processing_time_ms": 0}
                
        except Exception as e:
            logger.error(f"WebRTC audio processing error: {e}")
            result = {"text": "", "confidence": 0.0, "has_speech": False, "processing_time_ms": 0}
        
        return {
            "text": str(result.get("text", "")),
            "confidence": float(result.get("confidence", 0.0)),
            "has_speech": bool(result.get("has_speech", False)),
            "processing_time_ms": int(result.get("processing_time_ms", 0)),
            "session_id": str(session_id)
        }
        
    except Exception as e:
        logger.error(f"Streaming audio processing error: {e}")
        raise HTTPException(status_code=500, detail=f"Streaming processing failed: {e}")

@app.post("/predict_endpoint")
async def predict_endpoint_legacy(
    audio_file: UploadFile = File(...),
    transcript: Optional[str] = Form(None)
):
    """Legacy Smart Turn endpoint"""
    # Redirect to unified processing
    session_id = f"legacy_st_{int(time.time())}"
    audio_bytes = await audio_file.read()
    
    result = await unified_processor.process_audio_frame(session_id, audio_bytes)
    
    return {
        "prediction": 0,
        "probability": 0.5,
        "processing_time_ms": 50
    }

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Unified Voice Processor")
    parser.add_argument("--port", type=int, default=8015, help="Port to run the service on")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="Host to bind to")
    args = parser.parse_args()
    
    logger.info(f"🚀 Starting Unified Voice Processor on {args.host}:{args.port}")
    
    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level="info"
    )
