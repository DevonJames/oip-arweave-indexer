/**
 * Real-Time Audio Visualizer for ALFRED Voice Interface
 * 
 * This module provides sophisticated audio visualization including
 * waveforms, frequency analysis, and speech activity indicators.
 * 
 * Key Features:
 * - Real-time waveform visualization
 * - Frequency spectrum analysis
 * - Speech activity detection visualization
 * - Voice quality indicators
 * - Performance-optimized rendering
 */

class AudioVisualizer {
    constructor(canvasElement, options = {}) {
        this.canvas = canvasElement;
        this.ctx = this.canvas.getContext('2d');
        
        // Configuration
        this.config = {
            // Canvas settings
            width: options.width || 400,
            height: options.height || 200,
            backgroundColor: options.backgroundColor || '#ffffff',
            
            // Waveform settings
            waveformColor: options.waveformColor || '#007aff',
            waveformLineWidth: options.waveformLineWidth || 2,
            waveformSmoothing: options.waveformSmoothing || 0.8,
            
            // Frequency spectrum settings
            spectrumColor: options.spectrumColor || '#34c759',
            spectrumBarWidth: options.spectrumBarWidth || 2,
            spectrumBarGap: options.spectrumBarGap || 1,
            
            // Speech detection visualization
            speechThreshold: options.speechThreshold || 0.1,
            speechColor: options.speechColor || '#ff9500',
            speechIndicatorSize: options.speechIndicatorSize || 20,
            
            // Animation settings
            animationSpeed: options.animationSpeed || 60, // 60 FPS
            fadeSpeed: options.fadeSpeed || 0.95,
            
            // Performance settings
            maxDataPoints: options.maxDataPoints || 256,
            updateInterval: options.updateInterval || 16, // ~60 FPS
            
            ...options
        };
        
        // Audio analysis
        this.audioContext = null;
        this.analyser = null;
        this.dataArray = null;
        this.frequencyData = null;
        
        // Visualization state
        this.isActive = false;
        this.animationId = null;
        this.lastUpdateTime = 0;
        
        // Waveform data
        this.waveformData = new Array(this.config.maxDataPoints).fill(0);
        this.waveformIndex = 0;
        
        // Speech detection
        this.speechDetection = {
            isActive: false,
            confidence: 0,
            energy: 0,
            lastSpeechTime: 0
        };
        
        // Performance tracking
        this.performance = {
            frameCount: 0,
            averageFPS: 0,
            renderTime: 0,
            lastFPSUpdate: Date.now()
        };
        
        this.setupCanvas();
    }

    /**
     * Setup canvas properties
     */
    setupCanvas() {
        // Set canvas size
        this.canvas.width = this.config.width;
        this.canvas.height = this.config.height;
        
        // Set canvas styles
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.borderRadius = '8px';
        
        // Setup context properties
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        
        // Initial clear
        this.clearCanvas();
    }

    /**
     * Initialize with audio context and analyser
     */
    initialize(audioContext, analyser) {
        this.audioContext = audioContext;
        this.analyser = analyser;
        
        // Setup audio data arrays
        this.analyser.fftSize = 2048;
        this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
        
        console.log('[AudioVisualizer] Initialized with audio context');
    }

    /**
     * Start visualization
     */
    start() {
        if (this.isActive) {
            return;
        }
        
        this.isActive = true;
        this.lastUpdateTime = Date.now();
        this.performance.lastFPSUpdate = Date.now();
        
        console.log('[AudioVisualizer] Starting audio visualization');
        this.animate();
    }

    /**
     * Stop visualization
     */
    stop() {
        this.isActive = false;
        
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        
        this.clearCanvas();
        console.log('[AudioVisualizer] Stopped audio visualization');
    }

    /**
     * Main animation loop
     */
    animate() {
        if (!this.isActive) {
            return;
        }
        
        const now = Date.now();
        const deltaTime = now - this.lastUpdateTime;
        
        // Throttle updates for performance
        if (deltaTime >= this.config.updateInterval) {
            this.update();
            this.render();
            this.lastUpdateTime = now;
            
            // Update performance metrics
            this.updatePerformanceMetrics();
        }
        
        this.animationId = requestAnimationFrame(() => this.animate());
    }

    /**
     * Update audio data
     */
    update() {
        if (!this.analyser) {
            return;
        }
        
        // Get time domain data for waveform
        this.analyser.getByteTimeDomainData(this.dataArray);
        
        // Get frequency domain data for spectrum
        this.analyser.getByteFrequencyData(this.frequencyData);
        
        // Update waveform data
        this.updateWaveformData();
        
        // Update speech detection
        this.updateSpeechDetection();
    }

    /**
     * Update waveform data array
     */
    updateWaveformData() {
        // Calculate average amplitude
        let sum = 0;
        for (let i = 0; i < this.dataArray.length; i++) {
            const normalized = (this.dataArray[i] - 128) / 128;
            sum += normalized * normalized;
        }
        
        const rms = Math.sqrt(sum / this.dataArray.length);
        
        // Add to waveform data
        this.waveformData[this.waveformIndex] = rms;
        this.waveformIndex = (this.waveformIndex + 1) % this.waveformData.length;
    }

    /**
     * Update speech detection visualization
     */
    updateSpeechDetection() {
        // Calculate energy level
        const energy = this.calculateAudioEnergy();
        this.speechDetection.energy = energy;
        
        // Detect speech activity
        const wasSpeechActive = this.speechDetection.isActive;
        this.speechDetection.isActive = energy > this.config.speechThreshold;
        
        if (this.speechDetection.isActive) {
            this.speechDetection.lastSpeechTime = Date.now();
            
            // Calculate confidence based on energy and consistency
            this.speechDetection.confidence = Math.min(1.0, energy / this.config.speechThreshold);
            
            if (!wasSpeechActive) {
                console.log('[AudioVisualizer] Speech activity detected');
            }
        } else {
            this.speechDetection.confidence *= 0.9; // Fade confidence
        }
    }

    /**
     * Calculate audio energy
     */
    calculateAudioEnergy() {
        if (!this.dataArray) {
            return 0;
        }
        
        let energy = 0;
        for (let i = 0; i < this.dataArray.length; i++) {
            const normalized = (this.dataArray[i] - 128) / 128;
            energy += normalized * normalized;
        }
        
        return Math.sqrt(energy / this.dataArray.length);
    }

    /**
     * Render visualization
     */
    render() {
        const startRenderTime = Date.now();
        
        // Clear canvas
        this.clearCanvas();
        
        // Draw background
        this.drawBackground();
        
        // Draw waveform
        this.drawWaveform();
        
        // Draw frequency spectrum
        this.drawFrequencySpectrum();
        
        // Draw speech indicator
        this.drawSpeechIndicator();
        
        // Draw performance info (if enabled)
        if (this.config.showPerformanceInfo) {
            this.drawPerformanceInfo();
        }
        
        // Update render time
        this.performance.renderTime = Date.now() - startRenderTime;
    }

    /**
     * Clear canvas
     */
    clearCanvas() {
        this.ctx.fillStyle = this.config.backgroundColor;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    /**
     * Draw background elements
     */
    drawBackground() {
        // Draw subtle grid
        this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.05)';
        this.ctx.lineWidth = 1;
        
        // Horizontal lines
        for (let y = 0; y < this.canvas.height; y += 20) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.canvas.width, y);
            this.ctx.stroke();
        }
        
        // Vertical lines
        for (let x = 0; x < this.canvas.width; x += 20) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.canvas.height);
            this.ctx.stroke();
        }
        
        // Center line
        this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.moveTo(0, this.canvas.height / 2);
        this.ctx.lineTo(this.canvas.width, this.canvas.height / 2);
        this.ctx.stroke();
    }

    /**
     * Draw waveform visualization
     */
    drawWaveform() {
        if (!this.waveformData) {
            return;
        }
        
        const width = this.canvas.width;
        const height = this.canvas.height / 2; // Top half for waveform
        const centerY = height / 2;
        
        // Set waveform style
        this.ctx.strokeStyle = this.speechDetection.isActive ? 
            this.config.speechColor : this.config.waveformColor;
        this.ctx.lineWidth = this.config.waveformLineWidth;
        this.ctx.globalAlpha = this.speechDetection.isActive ? 0.9 : 0.6;
        
        // Draw waveform
        this.ctx.beginPath();
        
        for (let i = 0; i < this.waveformData.length; i++) {
            const x = (i / this.waveformData.length) * width;
            const dataIndex = (this.waveformIndex + i) % this.waveformData.length;
            const amplitude = this.waveformData[dataIndex] * centerY;
            const y = centerY + amplitude;
            
            if (i === 0) {
                this.ctx.moveTo(x, y);
            } else {
                this.ctx.lineTo(x, y);
            }
        }
        
        this.ctx.stroke();
        
        // Reset alpha
        this.ctx.globalAlpha = 1.0;
    }

    /**
     * Draw frequency spectrum
     */
    drawFrequencySpectrum() {
        if (!this.frequencyData) {
            return;
        }
        
        const width = this.canvas.width;
        const height = this.canvas.height / 2; // Bottom half for spectrum
        const startY = this.canvas.height / 2;
        
        const barWidth = (width / this.frequencyData.length) - this.config.spectrumBarGap;
        
        // Set spectrum style
        this.ctx.fillStyle = this.speechDetection.isActive ? 
            this.config.speechColor : this.config.spectrumColor;
        this.ctx.globalAlpha = 0.7;
        
        // Draw frequency bars
        for (let i = 0; i < this.frequencyData.length; i += 4) { // Skip some for performance
            const barHeight = (this.frequencyData[i] / 255) * height;
            const x = (i / this.frequencyData.length) * width;
            const y = startY + height - barHeight;
            
            this.ctx.fillRect(x, y, barWidth, barHeight);
        }
        
        // Reset alpha
        this.ctx.globalAlpha = 1.0;
    }

    /**
     * Draw speech activity indicator
     */
    drawSpeechIndicator() {
        if (!this.speechDetection.isActive) {
            return;
        }
        
        const centerX = this.canvas.width - 30;
        const centerY = 30;
        const radius = this.config.speechIndicatorSize;
        
        // Draw pulsing circle for speech
        const pulseRadius = radius * (1 + Math.sin(Date.now() * 0.01) * 0.3);
        
        // Outer glow
        this.ctx.globalAlpha = 0.3;
        this.ctx.fillStyle = this.config.speechColor;
        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, pulseRadius, 0, Math.PI * 2);
        this.ctx.fill();
        
        // Inner circle
        this.ctx.globalAlpha = 0.8;
        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        this.ctx.fill();
        
        // Speech confidence text
        this.ctx.globalAlpha = 1.0;
        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = 'bold 12px -apple-system';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(
            Math.round(this.speechDetection.confidence * 100) + '%',
            centerX,
            centerY + 4
        );
    }

    /**
     * Draw performance information
     */
    drawPerformanceInfo() {
        const x = 10;
        const y = this.canvas.height - 40;
        
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        this.ctx.fillRect(x - 5, y - 25, 200, 35);
        
        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = '12px monospace';
        this.ctx.textAlign = 'left';
        
        const fps = this.performance.averageFPS.toFixed(1);
        const renderTime = this.performance.renderTime.toFixed(1);
        
        this.ctx.fillText(`FPS: ${fps} | Render: ${renderTime}ms`, x, y - 10);
        this.ctx.fillText(`Energy: ${this.speechDetection.energy.toFixed(3)}`, x, y + 5);
    }

    /**
     * Update performance metrics
     */
    updatePerformanceMetrics() {
        this.performance.frameCount++;
        
        const now = Date.now();
        const timeSinceLastUpdate = now - this.performance.lastFPSUpdate;
        
        if (timeSinceLastUpdate >= 1000) { // Update every second
            this.performance.averageFPS = this.performance.frameCount / (timeSinceLastUpdate / 1000);
            this.performance.frameCount = 0;
            this.performance.lastFPSUpdate = now;
        }
    }

    /**
     * Set speech detection state
     */
    setSpeechDetection(isActive, confidence = 0, energy = 0) {
        this.speechDetection.isActive = isActive;
        this.speechDetection.confidence = confidence;
        this.speechDetection.energy = energy;
        
        if (isActive) {
            this.speechDetection.lastSpeechTime = Date.now();
        }
    }

    /**
     * Update visualization theme
     */
    setTheme(theme) {
        switch (theme) {
            case 'dark':
                this.config.backgroundColor = '#1e1e1e';
                this.config.waveformColor = '#007aff';
                this.config.spectrumColor = '#34c759';
                this.config.speechColor = '#ff9500';
                break;
                
            case 'light':
                this.config.backgroundColor = '#ffffff';
                this.config.waveformColor = '#007aff';
                this.config.spectrumColor = '#34c759';
                this.config.speechColor = '#ff9500';
                break;
                
            case 'minimal':
                this.config.backgroundColor = '#f8f9fa';
                this.config.waveformColor = '#6c757d';
                this.config.spectrumColor = '#6c757d';
                this.config.speechColor = '#007aff';
                break;
        }
    }

    /**
     * Resize canvas
     */
    resize(width, height) {
        this.config.width = width;
        this.config.height = height;
        this.setupCanvas();
    }

    /**
     * Get current visualization data
     */
    getVisualizationData() {
        return {
            waveformData: [...this.waveformData],
            frequencyData: this.frequencyData ? [...this.frequencyData] : [],
            speechDetection: { ...this.speechDetection },
            performance: { ...this.performance }
        };
    }

    /**
     * Export visualization as image
     */
    exportAsImage(format = 'png') {
        return this.canvas.toDataURL(`image/${format}`);
    }
}

/**
 * Advanced Audio Visualizer with 3D Effects
 */
class AdvancedAudioVisualizer extends AudioVisualizer {
    constructor(canvasElement, options = {}) {
        super(canvasElement, options);
        
        // 3D visualization settings
        this.config.enable3D = options.enable3D || false;
        this.config.perspective = options.perspective || 1000;
        this.config.rotationSpeed = options.rotationSpeed || 0.01;
        
        // 3D state
        this.rotation = 0;
        this.perspective = this.config.perspective;
    }

    /**
     * Enhanced render with 3D effects
     */
    render() {
        if (this.config.enable3D) {
            this.render3D();
        } else {
            super.render();
        }
    }

    /**
     * Render 3D visualization
     */
    render3D() {
        const startRenderTime = Date.now();
        
        // Clear canvas
        this.clearCanvas();
        
        // Setup 3D transformation
        this.ctx.save();
        this.ctx.translate(this.canvas.width / 2, this.canvas.height / 2);
        
        // Update rotation
        this.rotation += this.config.rotationSpeed;
        
        // Draw 3D waveform
        this.draw3DWaveform();
        
        // Draw 3D spectrum
        this.draw3DSpectrum();
        
        this.ctx.restore();
        
        // Draw 2D overlays
        this.drawSpeechIndicator();
        
        if (this.config.showPerformanceInfo) {
            this.drawPerformanceInfo();
        }
        
        this.performance.renderTime = Date.now() - startRenderTime;
    }

    /**
     * Draw 3D waveform
     */
    draw3DWaveform() {
        if (!this.waveformData) {
            return;
        }
        
        this.ctx.strokeStyle = this.speechDetection.isActive ? 
            this.config.speechColor : this.config.waveformColor;
        this.ctx.lineWidth = this.config.waveformLineWidth;
        
        this.ctx.beginPath();
        
        for (let i = 0; i < this.waveformData.length; i++) {
            const angle = (i / this.waveformData.length) * Math.PI * 2 + this.rotation;
            const amplitude = this.waveformData[i] * 50;
            const radius = 50 + amplitude;
            
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius * 0.5; // Flatten for 3D effect
            
            if (i === 0) {
                this.ctx.moveTo(x, y);
            } else {
                this.ctx.lineTo(x, y);
            }
        }
        
        this.ctx.closePath();
        this.ctx.stroke();
    }

    /**
     * Draw 3D frequency spectrum
     */
    draw3DSpectrum() {
        if (!this.frequencyData) {
            return;
        }
        
        this.ctx.fillStyle = this.speechDetection.isActive ? 
            this.config.speechColor : this.config.spectrumColor;
        this.ctx.globalAlpha = 0.6;
        
        const numBars = 32;
        const angleStep = (Math.PI * 2) / numBars;
        
        for (let i = 0; i < numBars; i++) {
            const dataIndex = Math.floor((i / numBars) * this.frequencyData.length);
            const amplitude = this.frequencyData[dataIndex] / 255;
            const angle = i * angleStep + this.rotation;
            
            const innerRadius = 60;
            const outerRadius = innerRadius + amplitude * 40;
            
            // Draw 3D bar
            const x1 = Math.cos(angle) * innerRadius;
            const y1 = Math.sin(angle) * innerRadius * 0.5;
            const x2 = Math.cos(angle) * outerRadius;
            const y2 = Math.sin(angle) * outerRadius * 0.5;
            
            this.ctx.beginPath();
            this.ctx.moveTo(x1, y1);
            this.ctx.lineTo(x2, y2);
            this.ctx.lineWidth = 3;
            this.ctx.stroke();
        }
        
        this.ctx.globalAlpha = 1.0;
    }
}

// Export classes
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AudioVisualizer, AdvancedAudioVisualizer };
} else {
    window.AudioVisualizer = AudioVisualizer;
    window.AdvancedAudioVisualizer = AdvancedAudioVisualizer;
}
