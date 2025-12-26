# Alfred Waveform Visualization

This document describes how the real-time audio waveform visualization is rendered over Alfred's face when he speaks in the Alfred Notes interface.

## Overview

When Alfred speaks (plays TTS audio), a dynamic soundwave visualization appears overlaid on his avatar image. The visualization uses the **Web Audio API** to analyze real-time audio frequency data and renders a **mirrored bar graph** on an HTML5 canvas element positioned over Alfred's mouth area.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Alfred Visualization Panel                    │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                                                           │  │
│  │                     Alfred Avatar                         │  │
│  │                    (alfred.png)                           │  │
│  │                                                           │  │
│  │              ┌─────────────────────┐                      │  │
│  │              │   Canvas Overlay    │  ← Soundwave bars    │  │
│  │              │   (60px × 24px)     │    rendered here     │  │
│  │              └─────────────────────┘                      │  │
│  │                                                           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│                   [ Ready to speak ]  ← Status indicator        │
└─────────────────────────────────────────────────────────────────┘
```

## Component Structure

### HTML Elements

```html
<div id="alfredVizPanel" class="alfred-viz-panel collapsed">
    <div class="alfred-viz-header" onclick="alfredApp.toggleAlfredViz()">
        <div class="alfred-viz-title">Alfred</div>
        <button class="alfred-viz-toggle">◐</button>
    </div>
    <div class="alfred-viz-content">
        <div class="alfred-avatar-container">
            <img src="/alfred.png" alt="Alfred" class="alfred-avatar-img">
            <canvas id="alfredSoundwave" class="alfred-soundwave-overlay" width="60" height="24"></canvas>
        </div>
        <div id="alfredVizStatus" class="alfred-viz-status">Ready to speak</div>
    </div>
</div>
```

### Key Elements

| Element | Purpose |
|---------|---------|
| `#alfredVizPanel` | Container panel, can be collapsed/expanded |
| `.alfred-avatar-img` | Alfred's face image (280×280px container) |
| `#alfredSoundwave` | Canvas element for waveform rendering (60×24px) |
| `#alfredVizStatus` | Status text ("Ready to speak" / "Speaking...") |

## CSS Positioning

The canvas overlay is positioned using absolute positioning relative to the avatar container:

```css
.alfred-avatar-container {
    position: relative;
    width: 280px;
    height: 280px;
}

.alfred-soundwave-overlay {
    position: absolute;
    left: 50%;                  /* Center horizontally */
    top: calc(33% + 25px);      /* Position over mouth area */
    transform: translateX(-50%);
    opacity: 0;                 /* Hidden by default */
    transition: opacity 0.3s ease;
}

.alfred-soundwave-overlay.active {
    opacity: 1;                 /* Visible when speaking */
}
```

The `top: calc(33% + 25px)` positioning places the soundwave approximately where Alfred's mouth would be (about 1/3 down from the top of the image, plus a small offset).

## Web Audio API Setup

### Audio Context Initialization

When audio playback begins, the Web Audio API components are initialized:

```javascript
// Create audio context (once)
if (!this.state.audioContext) {
    this.state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
}

// Create analyser node (once)
if (!this.state.audioAnalyser) {
    this.state.audioAnalyser = this.state.audioContext.createAnalyser();
    this.state.audioAnalyser.fftSize = 64;              // Small FFT for 16 frequency bins
    this.state.audioAnalyser.smoothingTimeConstant = 0.8; // Smooth transitions
}
```

### Audio Routing

The audio is routed through the analyser before reaching the speakers:

```
Audio Element → MediaElementSource → Analyser → Destination (Speakers)
```

```javascript
// Connect audio element to analyser
this.state.audioSource = this.state.audioContext.createMediaElementSource(audio);
this.state.audioSource.connect(this.state.audioAnalyser);
this.state.audioAnalyser.connect(this.state.audioContext.destination);
```

### FFT Configuration

| Setting | Value | Purpose |
|---------|-------|---------|
| `fftSize` | 64 | Results in 32 frequency bins (16 used per side for mirrored display) |
| `smoothingTimeConstant` | 0.8 | Creates smooth transitions between frames (0 = no smoothing, 1 = max smoothing) |
| `frequencyBinCount` | 32 | Half of fftSize, number of data points available |

## Visualization Rendering

### Start Visualization

The `startSoundwaveVisualization()` function initiates the animation loop:

```javascript
startSoundwaveVisualization() {
    const canvas = document.getElementById('alfredSoundwave');
    if (!canvas || !this.state.audioAnalyser) return;
    
    const ctx = canvas.getContext('2d');
    
    // Add visual indicators
    overlay.classList.add('active');      // Show canvas
    status.classList.add('speaking');     // Highlight status
    status.textContent = 'Speaking...';
    panel.classList.add('speaking');      // Add pulse animation
    
    // Configuration
    const barsPerSide = 8;                // 8 bars on each side (16 total)
    const totalBars = barsPerSide * 2;
    const barWidth = canvas.width / totalBars;
    const bufferLength = this.state.audioAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    // Animation loop
    const animate = () => {
        if (!this.state.isStreamingAudio) return;
        
        // Get real-time frequency data
        this.state.audioAnalyser.getByteFrequencyData(dataArray);
        
        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Draw mirrored bars (see next section)
        // ...
        
        this.state.soundwaveAnimationId = requestAnimationFrame(animate);
    };
    
    animate();
}
```

### Bar Drawing Algorithm

The visualization creates a **mirrored effect** where bars extend outward from the center:

```javascript
for (let i = 0; i < barsPerSide; i++) {
    // Sample frequency data
    const dataIndex = Math.floor((i / barsPerSide) * bufferLength);
    const value = dataArray[dataIndex];  // 0-255
    
    // Calculate height
    const normalizedHeight = value / 255;
    const height = normalizedHeight * canvas.height * 0.8 + canvas.height * 0.15;
    const y = (canvas.height - height) / 2;  // Center vertically
    
    // Create gradient (dark grey tones)
    const gradient = ctx.createLinearGradient(0, y, 0, y + height);
    const alpha = 0.7 + (normalizedHeight * 0.3);
    gradient.addColorStop(0, `rgba(100, 100, 100, ${alpha})`);
    gradient.addColorStop(0.5, `rgba(50, 50, 50, ${alpha})`);
    gradient.addColorStop(1, `rgba(20, 20, 20, ${alpha})`);
    
    ctx.fillStyle = gradient;
    
    // Subtle glow effect
    ctx.shadowColor = '#333333';
    ctx.shadowBlur = 3 + (normalizedHeight * 5);
    
    // Draw LEFT bar (from center going left)
    const xLeft = (canvas.width / 2) - ((i + 1) * barWidth) + barWidth * 0.1;
    ctx.fillRect(xLeft, y, barWidth * 0.8, height);
    
    // Draw RIGHT bar (from center going right) - mirror
    const xRight = (canvas.width / 2) + (i * barWidth) + barWidth * 0.1;
    ctx.fillRect(xRight, y, barWidth * 0.8, height);
    
    ctx.shadowBlur = 0;  // Reset for next iteration
}
```

### Visual Layout

```
Canvas (60px × 24px)
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  ▐█▌ ▐█▌ ▐█▌ ▐█▌ ▐█▌ ▐█▌ ▐█▌ ▐█▌ ▐█▌ ▐█▌ ▐█▌ ▐█▌ ▐█▌ ▐█▌ │
│                     ↑ CENTER ↑                           │
│                                                          │
└──────────────────────────────────────────────────────────┘
       ← 8 bars        mirror        8 bars →
```

- **16 total bars** (8 per side, mirrored from center)
- **Bar width**: ~3.75px each (with 0.8 multiplier for spacing = 3px visible)
- **Colors**: Dark grey gradient (matches Alfred's aesthetic)
- **Minimum height**: 15% of canvas height (bars always visible)
- **Maximum height**: 95% of canvas height

### Stop Visualization

```javascript
stopSoundwaveVisualization() {
    // Stop animation loop
    this.state.isStreamingAudio = false;
    
    if (this.state.soundwaveAnimationId) {
        cancelAnimationFrame(this.state.soundwaveAnimationId);
        this.state.soundwaveAnimationId = null;
    }
    
    // Clear canvas
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    
    // Remove visual indicators
    overlay.classList.remove('active');
    status.classList.remove('speaking');
    status.textContent = 'Ready to speak';
    panel.classList.remove('speaking');
}
```

## State Management

The visualization state is tracked in `alfredApp.state`:

```javascript
state: {
    // ...
    soundwaveAnimationId: null,  // requestAnimationFrame ID
    isStreamingAudio: false,     // Controls animation loop
    audioContext: null,          // Web Audio API context
    audioAnalyser: null,         // AnalyserNode for frequency data
    audioSource: null            // MediaElementSourceNode
}
```

## Panel Interactions

### Collapsed State

When collapsed, the panel shows only a circular icon (48×48px) that pulses when speaking:

```css
.alfred-viz-panel.collapsed {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    padding: 0;
    overflow: hidden;
}

.alfred-viz-panel.collapsed.speaking {
    animation: vizPulse 1.5s ease-in-out infinite;
}

@keyframes vizPulse {
    0%, 100% { box-shadow: 0 4px 16px rgba(95, 252, 249, 0.3); }
    50% { box-shadow: 0 4px 24px rgba(95, 252, 249, 0.6); }
}
```

### Expand/Collapse Toggle

```javascript
toggleAlfredViz() {
    const panel = document.getElementById('alfredVizPanel');
    if (panel) {
        panel.classList.toggle('collapsed');
    }
}
```

## Mobile Behavior

The visualization panel is hidden on mobile devices (screens < 768px):

```css
@media (max-width: 768px) {
    .alfred-viz-panel {
        display: none !important;
    }
}
```

## Lifecycle

1. **User clicks play on audio** → Audio element created
2. **Audio connected to Web Audio API** → Analyser receives audio stream
3. **`startSoundwaveVisualization()` called** → Animation loop begins
4. **Each frame**: Frequency data sampled, canvas cleared, bars drawn
5. **Audio ends or user pauses** → `stopSoundwaveVisualization()` called
6. **Animation stopped** → Canvas cleared, UI reset

## Customization Options

To modify the visualization:

| Parameter | Location | Current Value | Effect |
|-----------|----------|---------------|--------|
| `barsPerSide` | startSoundwaveVisualization() | 8 | Number of bars on each side |
| `fftSize` | Audio setup | 64 | Frequency resolution (must be power of 2) |
| `smoothingTimeConstant` | Audio setup | 0.8 | Animation smoothness |
| Canvas `width` | HTML | 60 | Total visualization width |
| Canvas `height` | HTML | 24 | Total visualization height |
| `top` position | CSS | calc(33% + 25px) | Vertical placement on avatar |
| Bar colors | gradient stops | Grey tones | Visual appearance |

## Browser Compatibility

The visualization requires:
- **Web Audio API** (Chrome 35+, Firefox 25+, Safari 6+, Edge 12+)
- **requestAnimationFrame** (All modern browsers)
- **Canvas 2D API** (All modern browsers)

Fallback behavior: If Web Audio API is unavailable, audio plays normally without visualization.

