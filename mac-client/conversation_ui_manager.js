/**
 * Conversation UI Manager for ALFRED Voice Interface
 * 
 * This module manages the conversation interface including streaming text display,
 * conversation history, message formatting, and real-time user feedback.
 * 
 * Key Features:
 * - Streaming text display with typewriter effect
 * - Real-time partial transcription updates
 * - Conversation history management
 * - Message formatting and styling
 * - Interruption visualization
 * - Export and search functionality
 */

class ConversationUIManager {
    constructor(containerElement, options = {}) {
        this.container = containerElement;
        
        // Configuration
        this.config = {
            // Display settings
            maxMessages: options.maxMessages || 50,
            typewriterSpeed: options.typewriterSpeed || 30, // Characters per second
            animationDuration: options.animationDuration || 300,
            
            // Auto-scroll settings
            autoScroll: options.autoScroll !== false,
            scrollBehavior: options.scrollBehavior || 'smooth',
            
            // Message formatting
            timestampFormat: options.timestampFormat || 'short', // 'short', 'long', 'relative'
            showConfidence: options.showConfidence || false,
            showProcessingTime: options.showProcessingTime || false,
            
            // Streaming settings
            partialUpdateDelay: options.partialUpdateDelay || 100, // ms between partial updates
            finalizeDelay: options.finalizeDelay || 500, // ms before finalizing partial text
            
            ...options
        };
        
        // State management
        this.conversation = [];
        this.currentPartialMessage = null;
        this.streamingMessage = null;
        this.isStreaming = false;
        
        // Performance tracking
        this.metrics = {
            messagesDisplayed: 0,
            averageRenderTime: 0,
            streamingLatency: 0,
            partialUpdates: 0
        };
        
        // DOM elements
        this.messagesContainer = null;
        this.typingIndicator = null;
        
        this.initialize();
    }

    /**
     * Initialize conversation UI
     */
    initialize() {
        console.log('[ConversationUI] Initializing conversation UI manager...');
        
        // Create messages container if not exists
        this.messagesContainer = this.container.querySelector('.conversation-messages') ||
                                this.createMessagesContainer();
        
        // Create typing indicator if not exists
        this.typingIndicator = this.container.querySelector('.typing-indicator') ||
                              this.createTypingIndicator();
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Setup intersection observer for auto-scroll
        this.setupAutoScroll();
        
        console.log('[ConversationUI] Conversation UI manager initialized');
    }

    /**
     * Create messages container
     */
    createMessagesContainer() {
        const container = document.createElement('div');
        container.className = 'conversation-messages';
        container.style.cssText = `
            flex: 1;
            overflow-y: auto;
            max-height: 400px;
            padding: 16px;
        `;
        
        this.container.appendChild(container);
        return container;
    }

    /**
     * Create typing indicator
     */
    createTypingIndicator() {
        const indicator = document.createElement('div');
        indicator.className = 'typing-indicator';
        indicator.style.display = 'none';
        indicator.innerHTML = `
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <span style="margin-left: 8px; color: #666;">ALFRED is thinking...</span>
        `;
        
        this.container.appendChild(indicator);
        return indicator;
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Handle clicks on messages for interaction
        this.messagesContainer.addEventListener('click', (event) => {
            const message = event.target.closest('.message');
            if (message) {
                this.handleMessageClick(message);
            }
        });
        
        // Handle right-click for context menu
        this.messagesContainer.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            this.showContextMenu(event);
        });
    }

    /**
     * Setup auto-scroll functionality
     */
    setupAutoScroll() {
        if (!this.config.autoScroll) {
            return;
        }
        
        // Create intersection observer to detect when user scrolls up
        this.scrollObserver = new IntersectionObserver((entries) => {
            const lastMessage = entries[0];
            this.shouldAutoScroll = lastMessage.isIntersecting;
        }, {
            root: this.messagesContainer,
            threshold: 0.1
        });
        
        // Observe the last message when it's added
        this.observeLastMessage();
    }

    /**
     * Add message to conversation
     */
    addMessage(role, text, options = {}) {
        const startTime = Date.now();
        
        try {
            const message = {
                id: this.generateMessageId(),
                role: role, // 'user', 'assistant', 'system'
                text: text,
                timestamp: Date.now(),
                type: options.type || 'normal', // 'normal', 'partial', 'interrupted', 'error'
                confidence: options.confidence || null,
                processingTime: options.processingTime || null,
                metadata: options.metadata || {}
            };
            
            // Add to conversation history
            this.conversation.push(message);
            
            // Limit conversation length
            if (this.conversation.length > this.config.maxMessages) {
                this.removeOldestMessage();
            }
            
            // Create DOM element
            const messageElement = this.createMessageElement(message);
            
            // Add to UI
            this.messagesContainer.appendChild(messageElement);
            
            // Setup auto-scroll observation
            this.observeLastMessage();
            
            // Auto-scroll if needed
            if (this.shouldAutoScroll !== false) {
                this.scrollToBottom();
            }
            
            // Update metrics
            this.metrics.messagesDisplayed++;
            const renderTime = Date.now() - startTime;
            this.updateRenderMetrics(renderTime);
            
            console.log(`[ConversationUI] Added ${role} message: "${text.substring(0, 50)}..."`);
            
            return message;
            
        } catch (error) {
            console.error('[ConversationUI] Failed to add message:', error);
            throw error;
        }
    }

    /**
     * Show partial transcription with real-time updates
     */
    showPartialTranscription(text, confidence = 0) {
        if (!text.trim()) {
            return;
        }
        
        if (!this.currentPartialMessage) {
            // Create new partial message
            this.currentPartialMessage = this.addMessage('user', text, {
                type: 'partial',
                confidence: confidence
            });
            
            // Mark as partial for styling
            const messageElement = this.messagesContainer.lastElementChild;
            messageElement.classList.add('partial-message');
            
        } else {
            // Update existing partial message
            this.updatePartialMessage(text, confidence);
        }
        
        this.metrics.partialUpdates++;
    }

    /**
     * Update partial message text
     */
    updatePartialMessage(text, confidence = 0) {
        if (!this.currentPartialMessage) {
            return;
        }
        
        // Update message data
        this.currentPartialMessage.text = text;
        this.currentPartialMessage.confidence = confidence;
        
        // Update DOM
        const partialElement = this.messagesContainer.querySelector('.partial-message .message-bubble');
        if (partialElement) {
            partialElement.textContent = text + ' ⋯';
            
            // Update confidence indicator if shown
            if (this.config.showConfidence) {
                const metaElement = partialElement.parentElement.querySelector('.message-meta');
                if (metaElement) {
                    const confidenceSpan = metaElement.querySelector('.confidence') ||
                                         this.createConfidenceSpan(confidence);
                    confidenceSpan.textContent = `${Math.round(confidence * 100)}%`;
                    
                    if (!metaElement.contains(confidenceSpan)) {
                        metaElement.appendChild(confidenceSpan);
                    }
                }
            }
        }
    }

    /**
     * Finalize partial transcription
     */
    finalizePartialTranscription(finalText, confidence = 1.0) {
        if (!this.currentPartialMessage) {
            return;
        }
        
        // Update message data
        this.currentPartialMessage.text = finalText;
        this.currentPartialMessage.type = 'normal';
        this.currentPartialMessage.confidence = confidence;
        
        // Update DOM
        const partialElement = this.messagesContainer.querySelector('.partial-message');
        if (partialElement) {
            const bubble = partialElement.querySelector('.message-bubble');
            bubble.textContent = finalText;
            bubble.classList.remove('partial');
            partialElement.classList.remove('partial-message');
        }
        
        this.currentPartialMessage = null;
        
        console.log(`[ConversationUI] Finalized transcription: "${finalText}"`);
    }

    /**
     * Show streaming assistant response with typewriter effect
     */
    showStreamingResponse(text, options = {}) {
        if (this.isStreaming) {
            // Update existing streaming message
            this.updateStreamingResponse(text);
            return;
        }
        
        // Start new streaming message
        this.isStreaming = true;
        
        // Create message element
        this.streamingMessage = this.addMessage('assistant', '', {
            type: 'streaming',
            ...options
        });
        
        // Mark as streaming
        const messageElement = this.messagesContainer.lastElementChild;
        messageElement.classList.add('streaming-message');
        
        // Start typewriter effect
        this.startTypewriterEffect(text);
    }

    /**
     * Update streaming response
     */
    updateStreamingResponse(newText) {
        if (!this.streamingMessage) {
            return;
        }
        
        // Update message text
        this.streamingMessage.text = newText;
        
        // Update typewriter effect
        this.updateTypewriterEffect(newText);
    }

    /**
     * Start typewriter effect
     */
    startTypewriterEffect(targetText) {
        const messageElement = this.messagesContainer.querySelector('.streaming-message .message-bubble');
        if (!messageElement) {
            return;
        }
        
        let currentText = '';
        let currentIndex = 0;
        
        const typeInterval = setInterval(() => {
            if (currentIndex < targetText.length) {
                currentText += targetText[currentIndex];
                messageElement.textContent = currentText;
                currentIndex++;
                
                // Auto-scroll during typing
                if (this.shouldAutoScroll !== false) {
                    this.scrollToBottom();
                }
            } else {
                // Typing complete
                clearInterval(typeInterval);
                this.finalizeStreamingMessage();
            }
        }, 1000 / this.config.typewriterSpeed);
        
        // Store interval for potential interruption
        this.streamingMessage.typeInterval = typeInterval;
    }

    /**
     * Update typewriter effect with new text
     */
    updateTypewriterEffect(newText) {
        if (!this.streamingMessage || !this.streamingMessage.typeInterval) {
            return;
        }
        
        // Clear current interval
        clearInterval(this.streamingMessage.typeInterval);
        
        // Start new typewriter with updated text
        this.startTypewriterEffect(newText);
    }

    /**
     * Finalize streaming message
     */
    finalizeStreamingMessage() {
        if (!this.streamingMessage) {
            return;
        }
        
        // Clear typewriter interval
        if (this.streamingMessage.typeInterval) {
            clearInterval(this.streamingMessage.typeInterval);
        }
        
        // Remove streaming class
        const messageElement = this.messagesContainer.querySelector('.streaming-message');
        if (messageElement) {
            messageElement.classList.remove('streaming-message');
        }
        
        this.streamingMessage = null;
        this.isStreaming = false;
        
        console.log('[ConversationUI] Streaming message finalized');
    }

    /**
     * Show message as interrupted
     */
    markAsInterrupted(messageId, interruptedAt = null) {
        const message = this.conversation.find(m => m.id === messageId);
        if (!message) {
            return;
        }
        
        message.type = 'interrupted';
        message.interruptedAt = interruptedAt || Date.now();
        
        // Update DOM
        const messageElement = this.findMessageElement(messageId);
        if (messageElement) {
            const bubble = messageElement.querySelector('.message-bubble');
            bubble.classList.add('interrupted');
            
            // Add interruption indicator
            const text = bubble.textContent;
            bubble.textContent = `${text} [interrupted]`;
            
            // Update metadata
            const meta = messageElement.querySelector('.message-meta');
            const interruptedSpan = document.createElement('span');
            interruptedSpan.textContent = 'Interrupted';
            interruptedSpan.style.color = '#ff9500';
            meta.appendChild(interruptedSpan);
        }
        
        console.log(`[ConversationUI] Marked message as interrupted: ${messageId}`);
    }

    /**
     * Show typing indicator
     */
    showTypingIndicator(customText = null) {
        if (this.typingIndicator) {
            if (customText) {
                const textSpan = this.typingIndicator.querySelector('span');
                if (textSpan) {
                    textSpan.textContent = customText;
                }
            }
            this.typingIndicator.style.display = 'flex';
            
            // Auto-scroll to show typing indicator
            if (this.shouldAutoScroll !== false) {
                this.scrollToBottom();
            }
        }
    }

    /**
     * Hide typing indicator
     */
    hideTypingIndicator() {
        if (this.typingIndicator) {
            this.typingIndicator.style.display = 'none';
        }
    }

    /**
     * Create message DOM element
     */
    createMessageElement(message) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${message.role} slide-in`;
        messageDiv.setAttribute('data-message-id', message.id);
        
        // Create avatar
        const avatar = document.createElement('div');
        avatar.className = `message-avatar ${message.role}`;
        avatar.textContent = this.getAvatarIcon(message.role);
        
        // Create content container
        const content = document.createElement('div');
        content.className = 'message-content';
        
        // Create message bubble
        const bubble = document.createElement('div');
        bubble.className = `message-bubble ${message.role} ${message.type}`;
        bubble.textContent = message.text;
        
        // Create metadata
        const meta = document.createElement('div');
        meta.className = 'message-meta';
        meta.appendChild(this.createTimestamp(message.timestamp));
        
        // Add confidence if available and enabled
        if (this.config.showConfidence && message.confidence !== null) {
            meta.appendChild(this.createConfidenceSpan(message.confidence));
        }
        
        // Add processing time if available and enabled
        if (this.config.showProcessingTime && message.processingTime) {
            meta.appendChild(this.createProcessingTimeSpan(message.processingTime));
        }
        
        // Add type indicator
        meta.appendChild(this.createTypeSpan(message.type));
        
        // Assemble message
        content.appendChild(bubble);
        content.appendChild(meta);
        messageDiv.appendChild(avatar);
        messageDiv.appendChild(content);
        
        return messageDiv;
    }

    /**
     * Get avatar icon for role
     */
    getAvatarIcon(role) {
        switch (role) {
            case 'user': return '👤';
            case 'assistant': return '🤖';
            case 'system': return '⚙️';
            default: return '❓';
        }
    }

    /**
     * Create timestamp element
     */
    createTimestamp(timestamp) {
        const span = document.createElement('span');
        span.className = 'timestamp';
        span.textContent = this.formatTimestamp(timestamp);
        return span;
    }

    /**
     * Create confidence span
     */
    createConfidenceSpan(confidence) {
        const span = document.createElement('span');
        span.className = 'confidence';
        span.textContent = `${Math.round(confidence * 100)}%`;
        span.style.color = this.getConfidenceColor(confidence);
        return span;
    }

    /**
     * Create processing time span
     */
    createProcessingTimeSpan(processingTime) {
        const span = document.createElement('span');
        span.className = 'processing-time';
        span.textContent = `${processingTime}ms`;
        span.style.color = this.getProcessingTimeColor(processingTime);
        return span;
    }

    /**
     * Create type span
     */
    createTypeSpan(type) {
        const span = document.createElement('span');
        span.className = 'message-type';
        span.textContent = this.getTypeLabel(type);
        return span;
    }

    /**
     * Format timestamp based on configuration
     */
    formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        
        switch (this.config.timestampFormat) {
            case 'long':
                return date.toLocaleString();
            case 'relative':
                return this.getRelativeTime(timestamp);
            case 'short':
            default:
                return date.toLocaleTimeString();
        }
    }

    /**
     * Get relative time string
     */
    getRelativeTime(timestamp) {
        const now = Date.now();
        const diff = now - timestamp;
        
        if (diff < 60000) { // Less than 1 minute
            return 'Just now';
        } else if (diff < 3600000) { // Less than 1 hour
            const minutes = Math.floor(diff / 60000);
            return `${minutes}m ago`;
        } else {
            const hours = Math.floor(diff / 3600000);
            return `${hours}h ago`;
        }
    }

    /**
     * Get confidence color
     */
    getConfidenceColor(confidence) {
        if (confidence > 0.8) return '#34c759';
        if (confidence > 0.6) return '#ff9500';
        return '#ff3b30';
    }

    /**
     * Get processing time color
     */
    getProcessingTimeColor(processingTime) {
        if (processingTime < 100) return '#34c759';
        if (processingTime < 300) return '#ff9500';
        return '#ff3b30';
    }

    /**
     * Get type label
     */
    getTypeLabel(type) {
        switch (type) {
            case 'partial': return 'Partial';
            case 'interrupted': return 'Interrupted';
            case 'error': return 'Error';
            case 'streaming': return 'Streaming';
            default: return 'Complete';
        }
    }

    /**
     * Remove oldest message
     */
    removeOldestMessage() {
        if (this.conversation.length > 0) {
            const removedMessage = this.conversation.shift();
            
            // Remove from DOM
            const messageElement = this.findMessageElement(removedMessage.id);
            if (messageElement) {
                messageElement.remove();
            }
        }
    }

    /**
     * Find message element by ID
     */
    findMessageElement(messageId) {
        return this.messagesContainer.querySelector(`[data-message-id="${messageId}"]`);
    }

    /**
     * Observe last message for auto-scroll
     */
    observeLastMessage() {
        if (!this.scrollObserver) {
            return;
        }
        
        // Unobserve previous last message
        const previousLast = this.messagesContainer.querySelector('.observed');
        if (previousLast) {
            this.scrollObserver.unobserve(previousLast);
            previousLast.classList.remove('observed');
        }
        
        // Observe new last message
        const lastMessage = this.messagesContainer.lastElementChild;
        if (lastMessage) {
            this.scrollObserver.observe(lastMessage);
            lastMessage.classList.add('observed');
        }
    }

    /**
     * Scroll to bottom
     */
    scrollToBottom() {
        this.messagesContainer.scrollTo({
            top: this.messagesContainer.scrollHeight,
            behavior: this.config.scrollBehavior
        });
    }

    /**
     * Handle message click
     */
    handleMessageClick(messageElement) {
        const messageId = messageElement.getAttribute('data-message-id');
        const message = this.conversation.find(m => m.id === messageId);
        
        if (message) {
            console.log('[ConversationUI] Message clicked:', message);
            
            // Could implement message actions (copy, reply, etc.)
            this.showMessageActions(messageElement, message);
        }
    }

    /**
     * Show message actions menu
     */
    showMessageActions(messageElement, message) {
        // Simple implementation - could be enhanced with proper context menu
        const actions = ['Copy Text', 'Replay Audio', 'Show Details'];
        const action = prompt(`Select action for message:\n${actions.join('\n')}\n\nEnter number (1-${actions.length}):`);
        
        if (action && !isNaN(action)) {
            const actionIndex = parseInt(action) - 1;
            if (actionIndex >= 0 && actionIndex < actions.length) {
                this.executeMessageAction(actions[actionIndex], message);
            }
        }
    }

    /**
     * Execute message action
     */
    executeMessageAction(action, message) {
        switch (action) {
            case 'Copy Text':
                navigator.clipboard.writeText(message.text);
                console.log('[ConversationUI] Text copied to clipboard');
                break;
                
            case 'Replay Audio':
                // Would implement audio replay functionality
                console.log('[ConversationUI] Audio replay not implemented yet');
                break;
                
            case 'Show Details':
                alert(`Message Details:\n\nRole: ${message.role}\nTime: ${new Date(message.timestamp).toLocaleString()}\nConfidence: ${message.confidence || 'N/A'}\nType: ${message.type}`);
                break;
        }
    }

    /**
     * Clear conversation
     */
    clearConversation() {
        this.conversation = [];
        this.messagesContainer.innerHTML = '';
        this.currentPartialMessage = null;
        this.streamingMessage = null;
        this.isStreaming = false;
        
        console.log('[ConversationUI] Conversation cleared');
    }

    /**
     * Export conversation
     */
    exportConversation(format = 'json') {
        const exportData = {
            conversation: this.conversation,
            exportedAt: Date.now(),
            format: format,
            metrics: this.metrics
        };
        
        switch (format) {
            case 'json':
                return JSON.stringify(exportData, null, 2);
                
            case 'text':
                return this.conversation.map(m => 
                    `[${new Date(m.timestamp).toLocaleTimeString()}] ${m.role}: ${m.text}`
                ).join('\n');
                
            case 'csv':
                const csv = ['Timestamp,Role,Text,Type,Confidence'];
                csv.push(...this.conversation.map(m => 
                    `"${new Date(m.timestamp).toISOString()}","${m.role}","${m.text}","${m.type}","${m.confidence || ''}"`
                ));
                return csv.join('\n');
                
            default:
                return JSON.stringify(exportData, null, 2);
        }
    }

    /**
     * Search conversation
     */
    searchConversation(query, options = {}) {
        const caseSensitive = options.caseSensitive || false;
        const searchText = caseSensitive ? query : query.toLowerCase();
        
        return this.conversation.filter(message => {
            const messageText = caseSensitive ? message.text : message.text.toLowerCase();
            return messageText.includes(searchText);
        });
    }

    /**
     * Update render metrics
     */
    updateRenderMetrics(renderTime) {
        if (this.metrics.averageRenderTime === 0) {
            this.metrics.averageRenderTime = renderTime;
        } else {
            this.metrics.averageRenderTime = 
                (this.metrics.averageRenderTime * 0.9) + (renderTime * 0.1);
        }
    }

    /**
     * Generate unique message ID
     */
    generateMessageId() {
        return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    }

    /**
     * Get conversation statistics
     */
    getConversationStats() {
        const userMessages = this.conversation.filter(m => m.role === 'user').length;
        const assistantMessages = this.conversation.filter(m => m.role === 'assistant').length;
        const interruptedMessages = this.conversation.filter(m => m.type === 'interrupted').length;
        
        const totalDuration = this.conversation.length > 0 ?
            this.conversation[this.conversation.length - 1].timestamp - this.conversation[0].timestamp : 0;
        
        return {
            totalMessages: this.conversation.length,
            userMessages,
            assistantMessages,
            interruptedMessages,
            conversationDuration: totalDuration,
            averageMessageLength: this.conversation.reduce((sum, m) => sum + m.text.length, 0) / this.conversation.length,
            metrics: this.metrics
        };
    }

    /**
     * Get current status
     */
    getStatus() {
        return {
            messageCount: this.conversation.length,
            isStreaming: this.isStreaming,
            hasPartialMessage: !!this.currentPartialMessage,
            metrics: this.metrics,
            config: this.config
        };
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ConversationUIManager;
} else {
    window.ConversationUIManager = ConversationUIManager;
}
