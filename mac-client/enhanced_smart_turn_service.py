#!/usr/bin/env python3
"""
Enhanced Smart Turn Service with Real-Time Interruption Detection

This service implements smart-turn v2 equivalent capabilities for sophisticated
turn-taking and interruption handling in voice conversations.

Key Features:
- Frame-level interruption detection (20ms frames)
- Context-aware turn-taking decisions
- Speaker state awareness to prevent self-interruption
- Confidence-based interruption classification
- Real-time processing with <200ms response time
"""

import asyncio
import io
import json
import logging
import time
import wave
from typing import Dict, List, Optional, Tuple, Any
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
import uvicorn
import torch

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class EnhancedSmartTurnService:
    """Enhanced Smart Turn Service with real-time interruption detection"""
    
    def __init__(self):
        self.sample_rate = 16000
        self.frame_duration_ms = 20
        self.frame_size = int(self.sample_rate * self.frame_duration_ms / 1000)  # 320 samples
        
        # Interruption detection configuration
        self.interruption_config = {
            'energy_threshold': 0.02,           # Minimum energy for potential speech
            'confidence_threshold': 0.7,        # Confidence required for interruption
            'temporal_threshold': 0.5,          # Seconds of agent speech before interruption allowed
            'context_window_frames': 25,        # 500ms context window for analysis
            'silence_frames_for_endpoint': 10,  # 200ms silence to confirm endpoint
        }
        
        # Speaker state management
        self.speaker_states = {}  # session_id -> speaker_state
        
        # Processing models (will be enhanced with actual smart-turn v2 model)
        self.vad_model = None
        self.turn_model = None  # Placeholder for smart-turn v2 model
        
        # Performance metrics
        self.metrics = {
            'total_requests': 0,
            'interruptions_detected': 0,
            'false_positives': 0,
            'average_processing_time': 0,
            'frame_processing_time': 0
        }
        
        logger.info("🚀 Initializing Enhanced Smart Turn Service...")
    
    async def initialize(self):
        """Initialize the Smart Turn models and components"""
        try:
            logger.info("📥 Loading VAD model for interruption detection...")
            
            # Load Silero VAD for speech detection
            try:
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
            
            # TODO: Load smart-turn v2 model when available
            # For now, implement sophisticated heuristic-based approach
            logger.info("📥 Initializing smart-turn v2 equivalent logic...")
            self.turn_model = SmartTurnV2Equivalent()
            
            logger.info("✅ Enhanced Smart Turn Service initialized successfully")
            
        } catch Exception as e:
            logger.error(f"❌ Failed to initialize Enhanced Smart Turn Service: {e}")
            raise
    
    def get_speaker_state(self, session_id: str) -> Dict:
        """Get or create speaker state for session"""
        if session_id not in self.speaker_states:
            self.speaker_states[session_id] = {
                'agent_speaking': False,
                'agent_speech_start_time': None,
                'user_speaking': False,
                'last_user_speech_end': None,
                'conversation_turn': 'user',  # 'user' or 'agent'
                'frame_count': 0,
                'speech_frames': [],
                'context_buffer': [],
                'last_interruption_time': None
            }
        return self.speaker_states[session_id]
    
    def set_agent_speaking_state(self, session_id: str, is_speaking: bool):
        """Update agent speaking state"""
        state = self.get_speaker_state(session_id)
        
        if is_speaking and not state['agent_speaking']:
            # Agent started speaking
            state['agent_speaking'] = True
            state['agent_speech_start_time'] = time.time()
            state['conversation_turn'] = 'agent'
            logger.info(f"Agent started speaking in session {session_id}")
            
        elif not is_speaking and state['agent_speaking']:
            # Agent stopped speaking
            state['agent_speaking'] = False
            state['agent_speech_start_time'] = None
            state['conversation_turn'] = 'user'
            logger.info(f"Agent stopped speaking in session {session_id}")
    
    def can_interrupt(self, session_id: str) -> bool:
        """Check if interruption is allowed based on speaker state"""
        state = self.get_speaker_state(session_id)
        
        # Only allow interruption when agent is speaking
        if not state['agent_speaking']:
            return False
        
        # Don't allow interruption too early in agent's speech
        if state['agent_speech_start_time']:
            elapsed = time.time() - state['agent_speech_start_time']
            if elapsed < self.interruption_config['temporal_threshold']:
                return False
        
        # Don't allow interruption too soon after last interruption
        if state['last_interruption_time']:
            elapsed = time.time() - state['last_interruption_time']
            if elapsed < 1.0:  # 1 second cooldown
                return False
        
        return True
    
    def detect_speech_in_frame(self, audio_data: np.ndarray) -> Tuple[bool, float]:
        """
        Detect speech in audio frame using VAD
        
        Args:
            audio_data: Audio frame as numpy array
            
        Returns:
            Tuple of (has_speech: bool, confidence: float)
        """
        if self.vad_model is None:
            # Fallback: energy-based detection
            energy = np.sqrt(np.mean(audio_data ** 2))
            has_speech = energy > self.interruption_config['energy_threshold']
            return has_speech, energy
        
        try:
            # Ensure audio is right format for Silero VAD
            if len(audio_data) < 512:
                # Pad short frames
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
            return energy > self.interruption_config['energy_threshold'], energy
    
    async def analyze_interruption(self, session_id: str, audio_data: np.ndarray, 
                                 transcript: Optional[str] = None) -> Dict:
        """
        Analyze audio frame for interruption intent
        
        Args:
            session_id: Session identifier
            audio_data: Audio frame data
            transcript: Optional partial transcript for context
            
        Returns:
            Interruption analysis result
        """
        start_time = time.time()
        
        try:
            state = self.get_speaker_state(session_id)
            state['frame_count'] += 1
            
            # Check if interruption is allowed
            can_interrupt = self.can_interrupt(session_id)
            if not can_interrupt:
                return {
                    'session_id': session_id,
                    'frame_index': state['frame_count'],
                    'prediction': 0,
                    'probability': 0.0,
                    'is_interruption': False,
                    'reason': 'interruption_not_allowed',
                    'agent_speaking': state['agent_speaking'],
                    'processing_time_ms': (time.time() - start_time) * 1000
                }
            
            # Detect speech in current frame
            has_speech, speech_confidence = self.detect_speech_in_frame(audio_data)
            
            # Add to context buffer
            state['context_buffer'].append({
                'frame_index': state['frame_count'],
                'has_speech': has_speech,
                'confidence': speech_confidence,
                'energy': speech_confidence,  # Using confidence as energy proxy
                'timestamp': time.time()
            })
            
            # Keep context buffer to reasonable size
            max_context = self.interruption_config['context_window_frames']
            if len(state['context_buffer']) > max_context:
                state['context_buffer'] = state['context_buffer'][-max_context:]
            
            # Analyze interruption intent using smart-turn v2 equivalent
            interruption_result = self.turn_model.analyze_interruption(
                audio_data=audio_data,
                context_buffer=state['context_buffer'],
                transcript=transcript,
                speaker_state=state
            )
            
            # Update state if interruption detected
            if interruption_result['is_interruption']:
                state['last_interruption_time'] = time.time()
                state['conversation_turn'] = 'user'
                self.metrics['interruptions_detected'] += 1
                
                logger.info(f"Interruption detected in session {session_id} "
                          f"(confidence: {interruption_result['probability']:.3f})")
            
            # Update metrics
            processing_time = (time.time() - start_time) * 1000
            self.metrics['frame_processing_time'] = (
                self.metrics['frame_processing_time'] * 0.9 + processing_time * 0.1
            )
            self.metrics['total_requests'] += 1
            
            return {
                **interruption_result,
                'session_id': session_id,
                'frame_index': state['frame_count'],
                'agent_speaking': state['agent_speaking'],
                'processing_time_ms': processing_time
            }
            
        except Exception as e:
            logger.error(f"Interruption analysis error for session {session_id}: {e}")
            raise HTTPException(status_code=500, detail=f"Analysis failed: {e}")
    
    def cleanup_session(self, session_id: str):
        """Clean up session data"""
        if session_id in self.speaker_states:
            del self.speaker_states[session_id]
            logger.info(f"Cleaned up session: {session_id}")
    
    def get_metrics(self) -> Dict:
        """Get service performance metrics"""
        return {
            **self.metrics,
            'active_sessions': len(self.speaker_states),
            'frame_size': self.frame_size,
            'sample_rate': self.sample_rate,
            'interruption_config': self.interruption_config
        }


class SmartTurnV2Equivalent:
    """
    Smart-Turn v2 equivalent implementation using sophisticated heuristics
    and contextual analysis for interruption detection
    """
    
    def __init__(self):
        self.interruption_patterns = {
            # Energy-based patterns
            'sudden_energy_increase': {'weight': 0.3, 'threshold': 2.0},
            'sustained_speech': {'weight': 0.4, 'threshold': 0.7},
            'speech_rhythm_change': {'weight': 0.2, 'threshold': 0.6},
            
            # Context-based patterns
            'overlapping_speech': {'weight': 0.5, 'threshold': 0.8},
            'interruption_keywords': {'weight': 0.3, 'threshold': 0.9},
            'urgency_indicators': {'weight': 0.4, 'threshold': 0.8}
        }
        
        # Keywords that often indicate interruption intent
        self.interruption_keywords = [
            'wait', 'stop', 'hold on', 'excuse me', 'sorry', 'actually',
            'but', 'however', 'no', 'yes', 'okay', 'right', 'exactly'
        ]
        
        # Urgency indicators (tone, pace, etc.)
        self.urgency_indicators = [
            'quick', 'fast', 'urgent', 'important', 'now', 'immediately'
        ]
    
    def analyze_interruption(self, audio_data: np.ndarray, context_buffer: List[Dict],
                           transcript: Optional[str], speaker_state: Dict) -> Dict:
        """
        Analyze audio and context for interruption intent
        
        Args:
            audio_data: Current audio frame
            context_buffer: Recent audio context
            transcript: Partial transcript if available
            speaker_state: Current speaker state
            
        Returns:
            Interruption analysis result
        """
        try:
            # Calculate individual pattern scores
            scores = {}
            
            # 1. Energy-based analysis
            scores.update(self._analyze_energy_patterns(audio_data, context_buffer))
            
            # 2. Speech rhythm analysis
            scores.update(self._analyze_speech_rhythm(context_buffer))
            
            # 3. Context-based analysis
            if transcript:
                scores.update(self._analyze_transcript_context(transcript))
            
            # 4. Temporal analysis
            scores.update(self._analyze_temporal_patterns(speaker_state, context_buffer))
            
            # Calculate weighted probability
            total_score = 0
            total_weight = 0
            
            for pattern, config in self.interruption_patterns.items():
                if pattern in scores:
                    score = scores[pattern]
                    weight = config['weight']
                    total_score += score * weight
                    total_weight += weight
            
            # Normalize probability
            probability = total_score / max(total_weight, 1.0)
            probability = max(0.0, min(1.0, probability))  # Clamp to [0, 1]
            
            # Determine if this is an interruption
            is_interruption = probability > 0.7  # High confidence threshold
            prediction = 1 if is_interruption else 0
            
            return {
                'prediction': prediction,
                'probability': probability,
                'is_interruption': is_interruption,
                'pattern_scores': scores,
                'analysis_method': 'smart_turn_v2_equivalent'
            }
            
        except Exception as e:
            logger.error(f"Interruption analysis error: {e}")
            return {
                'prediction': 0,
                'probability': 0.0,
                'is_interruption': False,
                'error': str(e),
                'analysis_method': 'error_fallback'
            }
    
    def _analyze_energy_patterns(self, current_audio: np.ndarray, context: List[Dict]) -> Dict:
        """Analyze energy patterns for interruption indicators"""
        scores = {}
        
        try:
            # Calculate current frame energy
            current_energy = np.sqrt(np.mean(current_audio ** 2))
            
            if len(context) < 5:  # Need some history
                return scores
            
            # Get recent energy levels
            recent_energies = [frame['energy'] for frame in context[-10:]]
            avg_recent_energy = np.mean(recent_energies)
            
            # Sudden energy increase (potential interruption start)
            if current_energy > avg_recent_energy * 2.0:
                scores['sudden_energy_increase'] = min(1.0, current_energy / avg_recent_energy / 2.0)
            
            # Sustained speech energy
            speech_frames = sum(1 for frame in context[-5:] if frame['has_speech'])
            if speech_frames >= 3:  # 3+ frames with speech
                scores['sustained_speech'] = speech_frames / 5.0
            
        except Exception as e:
            logger.warning(f"Energy analysis error: {e}")
        
        return scores
    
    def _analyze_speech_rhythm(self, context: List[Dict]) -> Dict:
        """Analyze speech rhythm changes"""
        scores = {}
        
        try:
            if len(context) < 10:
                return scores
            
            # Analyze speech frame patterns
            recent_speech = [frame['has_speech'] for frame in context[-10:]]
            older_speech = [frame['has_speech'] for frame in context[-20:-10]] if len(context) >= 20 else []
            
            # Calculate speech density
            recent_density = sum(recent_speech) / len(recent_speech)
            older_density = sum(older_speech) / len(older_speech) if older_speech else 0
            
            # Rhythm change (sudden increase in speech activity)
            if recent_density > older_density * 1.5 and recent_density > 0.6:
                scores['speech_rhythm_change'] = min(1.0, recent_density - older_density)
            
            # Overlapping speech detection (speech while agent should be speaking)
            if recent_density > 0.5:  # Significant speech activity
                scores['overlapping_speech'] = recent_density
            
        except Exception as e:
            logger.warning(f"Rhythm analysis error: {e}")
        
        return scores
    
    def _analyze_transcript_context(self, transcript: str) -> Dict:
        """Analyze transcript for interruption keywords and patterns"""
        scores = {}
        
        try:
            if not transcript:
                return scores
            
            transcript_lower = transcript.lower()
            
            # Check for interruption keywords
            keyword_matches = sum(1 for keyword in self.interruption_keywords 
                                if keyword in transcript_lower)
            if keyword_matches > 0:
                scores['interruption_keywords'] = min(1.0, keyword_matches / 3.0)
            
            # Check for urgency indicators
            urgency_matches = sum(1 for indicator in self.urgency_indicators 
                                if indicator in transcript_lower)
            if urgency_matches > 0:
                scores['urgency_indicators'] = min(1.0, urgency_matches / 2.0)
            
        except Exception as e:
            logger.warning(f"Transcript analysis error: {e}")
        
        return scores
    
    def _analyze_temporal_patterns(self, speaker_state: Dict, context: List[Dict]) -> Dict:
        """Analyze temporal patterns for interruption detection"""
        scores = {}
        
        try:
            # Check if we have enough speech history
            if len(context) < 5:
                return scores
            
            # Look for sudden onset of speech activity
            recent_frames = context[-5:]
            speech_start_detected = False
            
            # Check for transition from silence to speech
            for i in range(1, len(recent_frames)):
                prev_frame = recent_frames[i-1]
                curr_frame = recent_frames[i]
                
                if not prev_frame['has_speech'] and curr_frame['has_speech']:
                    # Speech started
                    speech_start_detected = True
                    break
            
            if speech_start_detected:
                # Calculate speech onset confidence
                speech_frames_after_start = sum(1 for frame in recent_frames[-3:] if frame['has_speech'])
                onset_confidence = speech_frames_after_start / 3.0
                scores['speech_onset'] = onset_confidence
            
        except Exception as e:
            logger.warning(f"Temporal analysis error: {e}")
        
        return scores


# Initialize service
smart_turn_service = EnhancedSmartTurnService()

# FastAPI application
app = FastAPI(
    title="Enhanced Smart Turn Service",
    description="Real-time interruption detection with smart-turn v2 equivalent",
    version="2.0.0"
)

@app.on_event("startup")
async def startup_event():
    """Initialize the Smart Turn service on startup"""
    await smart_turn_service.initialize()

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "Enhanced Smart Turn Service",
        "version": "2.0.0",
        "features": ["real_time_interruption", "smart_turn_v2_equivalent", "speaker_state_management"],
        "metrics": smart_turn_service.get_metrics()
    }

@app.post("/predict_endpoint")
async def predict_endpoint(
    audio_file: UploadFile = File(...),
    transcript: Optional[str] = Form(None),
    session_id: str = Form("default")
):
    """
    Legacy endpoint for backward compatibility
    """
    start_time = time.time()
    
    try:
        # Read and preprocess audio
        audio_bytes = await audio_file.read()
        
        # Simple preprocessing for legacy support
        try:
            with io.BytesIO(audio_bytes) as wav_io:
                with wave.open(wav_io, 'rb') as wav_file:
                    frames = wav_file.readframes(-1)
                    audio_data = np.frombuffer(frames, dtype=np.int16)
                    audio_data = audio_data.astype(np.float32) / 32768.0
        except:
            audio_data = np.frombuffer(audio_bytes, dtype=np.int16)
            audio_data = audio_data.astype(np.float32) / 32768.0
        
        # Analyze for interruption
        result = await smart_turn_service.analyze_interruption(
            session_id, audio_data, transcript
        )
        
        return result
        
    except Exception as e:
        logger.error(f"Endpoint prediction error: {e}")
        raise HTTPException(status_code=500, detail=f"Prediction failed: {e}")

@app.post("/analyze_frame")
async def analyze_audio_frame(
    session_id: str = Form(...),
    audio_file: UploadFile = File(...),
    transcript: Optional[str] = Form(None)
):
    """
    Analyze single audio frame for interruption
    """
    try:
        audio_bytes = await audio_file.read()
        
        # Convert to numpy array (assume 20ms frame)
        audio_data = np.frombuffer(audio_bytes, dtype=np.int16)
        audio_data = audio_data.astype(np.float32) / 32768.0
        
        # Analyze interruption
        result = await smart_turn_service.analyze_interruption(
            session_id, audio_data, transcript
        )
        
        return result
        
    except Exception as e:
        logger.error(f"Frame analysis error: {e}")
        raise HTTPException(status_code=500, detail=f"Frame analysis failed: {e}")

@app.post("/set_speaker_state")
async def set_speaker_state(
    session_id: str = Form(...),
    agent_speaking: bool = Form(...)
):
    """
    Update agent speaking state for session
    """
    try:
        smart_turn_service.set_agent_speaking_state(session_id, agent_speaking)
        
        state = smart_turn_service.get_speaker_state(session_id)
        
        return {
            'session_id': session_id,
            'agent_speaking': state['agent_speaking'],
            'conversation_turn': state['conversation_turn'],
            'can_interrupt': smart_turn_service.can_interrupt(session_id)
        }
        
    except Exception as e:
        logger.error(f"Speaker state update error: {e}")
        raise HTTPException(status_code=500, detail=f"State update failed: {e}")

@app.get("/session/{session_id}/status")
async def get_session_status(session_id: str):
    """Get status for specific session"""
    if session_id not in smart_turn_service.speaker_states:
        raise HTTPException(status_code=404, detail="Session not found")
    
    state = smart_turn_service.get_speaker_state(session_id)
    
    return {
        'session_id': session_id,
        'speaker_state': state,
        'can_interrupt': smart_turn_service.can_interrupt(session_id),
        'metrics': smart_turn_service.get_metrics()
    }

@app.delete("/session/{session_id}")
async def cleanup_session(session_id: str):
    """Clean up session data"""
    smart_turn_service.cleanup_session(session_id)
    return {"message": f"Session {session_id} cleaned up"}

@app.get("/metrics")
async def get_metrics():
    """Get service metrics"""
    return smart_turn_service.get_metrics()

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Enhanced Smart Turn Service")
    parser.add_argument("--port", type=int, default=8014, help="Port to run the service on")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="Host to bind to")
    args = parser.parse_args()
    
    logger.info(f"🚀 Starting Enhanced Smart Turn Service on {args.host}:{args.port}")
    
    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level="info"
    )
