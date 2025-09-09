# Alfred Private Session History Using GUN

## Overview

This implementation plan outlines the creation of a conversation session history feature for Alfred that stores conversations as private encrypted records in GUN, ensuring only authenticated users can access their own session data.

## Current System Analysis

### OIP Architecture
- **Templates**: Schema definitions for data structure
- **Records**: Data instances conforming to templates
- **GUN Integration**: Private/temporary encrypted storage alongside permanent Arweave storage
- **Authentication**: JWT-based user authentication system

### Current State
- Alfred interface has mock history (Session 1, Session 2, etc.)
- User registration/login endpoints exist in `/api/user`
- GUN integration supports encrypted private records
- `authenticateToken` middleware validates JWT tokens

## Implementation Plan

### Phase 1: Backend Infrastructure

#### 1.1 Enhanced Authentication Middleware
**File**: `helpers/utils.js`

Update `authenticateToken` function to verify user ownership of GUN records:

```javascript
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    try {
        const verified = jwt.verify(token, process.env.JWT_SECRET);
        req.user = verified;

        // For GUN record requests, verify user owns the record
        if (req.params.soul || req.query.soul) {
            const soul = req.params.soul || req.query.soul;
            const userPubKey = verified.publisherPubKey; // Extract from JWT

            // Verify soul belongs to authenticated user
            if (!soul.startsWith(userPubKey.substring(0, 12))) {
                return res.status(403).json({ error: 'Access denied to this record' });
            }
        }

        next();
    } catch (error) {
        return res.status(403).json({ error: 'Invalid token' });
    }
};
```

#### 1.2 New API Endpoint for GUN Records
**File**: `routes/records.js`

Add new route to retrieve encrypted GUN records with user verification:

```javascript
// GET /api/records/gun/:soul - Get specific GUN record
router.get('/gun/:soul', authenticateToken, async (req, res) => {
    try {
        const { soul } = req.params;
        const { decrypt = true } = req.query;

        const gunHelper = new GunHelper();
        const record = await gunHelper.getRecord(soul, { decrypt });

        if (!record) {
            return res.status(404).json({ error: 'Record not found' });
        }

        res.status(200).json({
            message: 'GUN record retrieved successfully',
            record: {
                ...record,
                oip: {
                    ...record.oip,
                    did: `did:gun:${soul}`,
                    storage: 'gun'
                }
            }
        });
    } catch (error) {
        console.error('Error retrieving GUN record:', error);
        res.status(500).json({ error: 'Failed to retrieve GUN record' });
    }
});

// GET /api/records/gun - List user's GUN records
router.get('/gun', authenticateToken, async (req, res) => {
    try {
        const { limit = 20, offset = 0 } = req.query;
        const userPubKey = req.user.publisherPubKey;

        const gunHelper = new GunHelper();
        const records = await gunHelper.listUserRecords(userPubKey, { limit, offset });

        res.status(200).json({
            message: 'GUN records retrieved successfully',
            records: records.map(record => ({
                ...record,
                oip: {
                    ...record.oip,
                    did: `did:gun:${record.soul}`,
                    storage: 'gun'
                }
            })),
            pagination: { limit, offset, total: records.length }
        });
    } catch (error) {
        console.error('Error retrieving GUN records:', error);
        res.status(500).json({ error: 'Failed to retrieve GUN records' });
    }
});
```

#### 1.3 Session Template Definition
**File**: `config/templates.config.js`

Add conversation session template:

```javascript
conversationSession: {
  "basic": {
    "name": "string",
    "index_name": 0,
    "description": "string",
    "index_description": 1,
    "date": "long",
    "index_date": 2,
    "language": "enum",
    "languageValues": [
      { "code": "en", "name": "English" }
    ],
    "index_language": 3
  },
  "session": {
    "conversationId": "string",
    "index_conversationId": 4,
    "messages": "repeated string",
    "index_messages": 5,
    "startTime": "long",
    "index_startTime": 6,
    "endTime": "long",
    "index_endTime": 7,
    "model": "string",
    "index_model": 8,
    "totalTokens": "long",
    "index_totalTokens": 9
  },
  "accessControl": {
    "private": "bool",
    "index_private": 10,
    "ownerPubKey": "string",
    "index_ownerPubKey": 11
  }
}
```

### Phase 2: Frontend Authentication

#### 2.1 Login/Register Interface
**File**: `mac-client/alfred.html`

Add authentication modal before main interface:

```html
<!-- Authentication Modal -->
<dialog id="auth-modal" class="auth-modal">
  <form method="dialog" id="auth-form">
    <h2 id="auth-title">Sign In to Alfred</h2>

    <div id="login-section">
      <div class="form-group">
        <label for="login-email">Email</label>
        <input type="email" id="login-email" required>
      </div>
      <div class="form-group">
        <label for="login-password">Password</label>
        <input type="password" id="login-password" required>
      </div>
      <button type="button" id="btn-login" class="btn-primary">Sign In</button>
    </div>

    <div id="register-section" style="display:none">
      <div class="form-group">
        <label for="register-email">Email</label>
        <input type="email" id="register-email" required>
      </div>
      <div class="form-group">
        <label for="register-password">Password</label>
        <input type="password" id="register-password" required>
      </div>
      <button type="button" id="btn-register" class="btn-primary">Create Account</button>
    </div>

    <div class="auth-toggle">
      <button type="button" id="toggle-auth-mode">Need to register?</button>
    </div>
  </form>
</dialog>
```

#### 2.2 Authentication JavaScript
**File**: `mac-client/alfred.html` (in script section)

```javascript
class AuthManager {
  constructor() {
    this.token = localStorage.getItem('alfred_token');
    this.user = null;
    this.setupEventListeners();
  }

  setupEventListeners() {
    // Login/Register buttons
    document.getElementById('btn-login').addEventListener('click', () => this.login());
    document.getElementById('btn-register').addEventListener('click', () => this.register());

    // Toggle between login/register
    document.getElementById('toggle-auth-mode').addEventListener('click', () => {
      const loginSection = document.getElementById('login-section');
      const registerSection = document.getElementById('register-section');
      const title = document.getElementById('auth-title');
      const toggleBtn = document.getElementById('toggle-auth-mode');

      if (loginSection.style.display !== 'none') {
        loginSection.style.display = 'none';
        registerSection.style.display = 'block';
        title.textContent = 'Create Account';
        toggleBtn.textContent = 'Already have an account?';
      } else {
        loginSection.style.display = 'block';
        registerSection.style.display = 'none';
        title.textContent = 'Sign In to Alfred';
        toggleBtn.textContent = 'Need to register?';
      }
    });
  }

  async login() {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    try {
      const response = await fetch(`${this.backendUrl}/api/user/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (data.success) {
        this.token = data.token;
        this.user = jwt_decode(data.token); // Decode JWT to get user info
        localStorage.setItem('alfred_token', this.token);

        document.getElementById('auth-modal').close();
        this.onAuthenticated();
      } else {
        alert(data.error || 'Login failed');
      }
    } catch (error) {
      alert('Login failed: ' + error.message);
    }
  }

  async register() {
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;

    try {
      const response = await fetch(`${this.backendUrl}/api/user/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (data.success) {
        alert('Registration successful! Please login.');
        // Switch back to login mode
        document.getElementById('toggle-auth-mode').click();
      } else {
        alert(data.error || 'Registration failed');
      }
    } catch (error) {
      alert('Registration failed: ' + error.message);
    }
  }

  isAuthenticated() {
    return !!this.token;
  }

  logout() {
    this.token = null;
    this.user = null;
    localStorage.removeItem('alfred_token');
    this.showAuthModal();
  }

  showAuthModal() {
    document.getElementById('auth-modal').showModal();
  }

  onAuthenticated() {
    // Initialize main Alfred interface
    alfred.initializeInterface();
  }
}
```

### Phase 3: Session Management

#### 3.1 Session Manager Class
**File**: `mac-client/alfred.html` (in script section)

```javascript
class SessionManager {
  constructor(authManager) {
    this.authManager = authManager;
    this.currentSession = null;
    this.sessions = [];
    this.modelProviderCache = {}; // Cache for model provider lookups
  }

  // Lookup model provider DID by model name
  async lookupModelProviderDID(modelName) {
    // Check cache first
    if (this.modelProviderCache[modelName]) {
      return this.modelProviderCache[modelName];
    }

    try {
      const response = await fetch(`https://api.oip.onl/api/records?recordType=modelProvider&model=${encodeURIComponent(modelName)}&sortBy=inArweaveBlock:desc&limit=1`);

      if (!response.ok) {
        console.warn(`Failed to lookup model provider for ${modelName}`);
        return null;
      }

      const data = await response.json();

      if (data.records && data.records.length > 0) {
        const providerDID = data.records[0].oip.didTx;

        // Cache the result
        this.modelProviderCache[modelName] = providerDID;

        console.log(`Found model provider DID for ${modelName}: ${providerDID}`);
        return providerDID;
      }

      console.warn(`No model provider found for ${modelName}`);
      return null;
    } catch (error) {
      console.error(`Error looking up model provider for ${modelName}:`, error);
      return null;
    }
  }

  async loadUserSessions() {
    if (!this.authManager.isAuthenticated()) return;

    try {
      const response = await fetch(`${this.backendUrl}/api/records/gun`, {
        headers: {
          'Authorization': `Bearer ${this.authManager.token}`
        }
      });

      const data = await response.json();
      this.sessions = data.records || [];
      this.updateHistoryUI();
    } catch (error) {
      console.error('Failed to load sessions:', error);
    }
  }

  async createNewSession(title = null, modelName = 'llama3.2:3b') {
    if (!this.authManager.isAuthenticated()) return null;

    const sessionId = `session_${Date.now()}`;

    // Lookup the model provider DID for the specified model
    const modelProviderDID = await this.lookupModelProviderDID(modelName);

    const sessionData = {
      basic: {
        name: title || `Session ${this.sessions.length + 1}`,
        description: 'Alfred conversation session',
        date: Date.now(),
        language: 'en'
      },
      conversationSession: {
        session_id: sessionId,
        title: title || `Session ${this.sessions.length + 1}`,
        description: 'Alfred conversation session',
        start_timestamp: Date.now(),
        end_timestamp: null,
        duration_seconds: 0,
        message_count: 0,
        messages: [],
        message_timestamps: [],
        message_roles: [],
        model_name: modelName,
        model_provider: modelProviderDID ? [modelProviderDID] : [], // Reference to model provider
        total_tokens: 0,
        input_tokens: 0,
        output_tokens: 0,
        processing_mode: 'rag',
        conversation_type: 'voice',
        language: 'en',
        tags: [],
        is_private: true,
        owner_pubkey: this.authManager.user.publisherPubKey,
        version: '1.0.0'
      }
    };

    try {
      const response = await fetch(`${this.backendUrl}/api/records/newRecord?recordType=conversationSession&storage=gun&localId=${sessionId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.authManager.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(sessionData)
      });

      const data = await response.json();

      if (data.transactionId || data.did) {
        this.currentSession = {
          ...sessionData,
          oip: {
            did: data.did || data.transactionId,
            storage: 'gun'
          }
        };

        this.sessions.unshift(this.currentSession);
        this.updateHistoryUI();
        return this.currentSession;
      }
    } catch (error) {
      console.error('Failed to create session:', error);
    }

    return null;
  }

  async updateCurrentSession(messages, model, tokens, processingMode = 'rag', conversationType = 'voice') {
    if (!this.currentSession) return;

    const endTime = Date.now();
    const duration = Math.round((endTime - this.currentSession.conversationSession.start_timestamp) / 1000);

    // Extract messages, timestamps, and roles from the conversation
    const messageTexts = [];
    const messageTimestamps = [];
    const messageRoles = [];

    messages.forEach(msg => {
      if (typeof msg === 'object') {
        messageTexts.push(msg.content || msg.text || '');
        messageTimestamps.push(msg.timestamp || Date.now());
        messageRoles.push(msg.role || 'user');
      } else {
        // Handle string messages
        messageTexts.push(msg);
        messageTimestamps.push(Date.now());
        messageRoles.push('user');
      }
    });

    // Lookup model provider DID if model changed
    let modelProviderDID = this.currentSession.conversationSession.model_provider?.[0];
    if (model !== this.currentSession.conversationSession.model_name) {
      modelProviderDID = await this.lookupModelProviderDID(model);
    }

    this.currentSession.conversationSession.end_timestamp = endTime;
    this.currentSession.conversationSession.duration_seconds = duration;
    this.currentSession.conversationSession.message_count = messages.length;
    this.currentSession.conversationSession.messages = messageTexts;
    this.currentSession.conversationSession.message_timestamps = messageTimestamps;
    this.currentSession.conversationSession.message_roles = messageRoles;
    this.currentSession.conversationSession.model_name = model;
    this.currentSession.conversationSession.model_provider = modelProviderDID ? [modelProviderDID] : [];
    this.currentSession.conversationSession.total_tokens = tokens || 0;
    this.currentSession.conversationSession.processing_mode = processingMode;
    this.currentSession.conversationSession.conversation_type = conversationType;

    try {
      const response = await fetch(`${this.backendUrl}/api/records/newRecord?recordType=conversationSession&storage=gun&localId=${this.currentSession.conversationSession.session_id}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.authManager.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(this.currentSession)
      });

      const data = await response.json();
      console.log('Session updated:', data);
    } catch (error) {
      console.error('Failed to update session:', error);
    }
  }

  async loadSession(sessionDid) {
    try {
      const response = await fetch(`${this.backendUrl}/api/records/gun/${sessionDid.split(':')[2]}`, {
        headers: {
          'Authorization': `Bearer ${this.authManager.token}`
        }
      });

      const data = await response.json();

      if (data.record) {
        // Load session messages into conversation
        if (data.record.conversationSession && data.record.conversationSession.messages) {
          const messages = [];
          for (let i = 0; i < data.record.conversationSession.messages.length; i++) {
            messages.push({
              role: data.record.conversationSession.message_roles[i] || 'user',
              content: data.record.conversationSession.messages[i],
              timestamp: data.record.conversationSession.message_timestamps[i] || Date.now()
            });
          }
          // Note: You would need to call alfred.loadSessionMessages(messages) here
        }
      }

      return data.record;
    } catch (error) {
      console.error('Failed to load session:', error);
      return null;
    }
  }

  updateHistoryUI() {
    const historyList = document.getElementById('historyList');
    historyList.innerHTML = '';

    this.sessions.forEach((session, index) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <a href="#" onclick="sessionManager.selectSession('${session.oip.did}')" style="display:block;padding:10px;border-radius:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:var(--text);text-decoration:none">
          <strong>${session.basic.name}</strong><br>
          <small style="color:var(--muted)">${new Date(session.conversationSession.start_timestamp).toLocaleDateString()} • ${session.conversationSession.message_count} messages • ${session.conversationSession.model_name}</small>
        </a>
      `;
      historyList.appendChild(li);
    });
  }

  async selectSession(sessionDid) {
    const session = await this.loadSession(sessionDid);
    if (session) {
      this.currentSession = session;

      // Reconstruct conversation messages from stored data
      if (session.conversationSession && session.conversationSession.messages) {
        const messages = [];
        for (let i = 0; i < session.conversationSession.messages.length; i++) {
          messages.push({
            role: session.conversationSession.message_roles[i] || 'user',
            content: session.conversationSession.messages[i],
            timestamp: session.conversationSession.message_timestamps[i] || Date.now()
          });
        }

        // Load messages into Alfred's conversation interface
        if (window.alfred && window.alfred.loadSessionMessages) {
          window.alfred.loadSessionMessages(messages);
        }
      }
    }
  }
}
```

#### 3.2 Update History UI
Replace the mock history setup with real session management:

```javascript
// Replace the mock history setup
(function(){
  // Initialize session manager instead of mock data
  const authManager = new AuthManager();
  const sessionManager = new SessionManager(authManager);

  // Make sessionManager globally available
  window.sessionManager = sessionManager;

  // Check authentication on load
  if (authManager.isAuthenticated()) {
    sessionManager.loadUserSessions();
  } else {
    authManager.showAuthModal();
  }
})();
```

### Phase 4: Integration with Alfred Voice Processing

#### 4.1 Update ALFREDInterface Class
**File**: `mac-client/alfred.html`

Integrate session management with voice processing:

```javascript
class ALFREDInterface {
  constructor() {
    // ... existing constructor code ...

    // Add session management
    this.sessionManager = window.sessionManager;
    this.conversationMessages = [];
  }

  async initializeInterface() {
    // ... existing code ...
    this.sessionManager.loadUserSessions();
  }

  async sendToALFREDBackend(audioBlob) {
    // ... existing code ...

    // Create session if this is the first message
    if (this.conversationMessages.length === 0 && this.sessionManager) {
      await this.sessionManager.createNewSession(null, model); // Pass the current model
    }

    // Add user message to conversation
    this.conversationMessages.push({
      role: 'user',
      content: transcribedText,
      timestamp: Date.now()
    });

    // ... existing backend communication ...

    // Add assistant response to conversation
    this.conversationMessages.push({
      role: 'assistant',
      content: fullResponse,
      timestamp: Date.now()
    });

    // Update session with new messages and current parameters
    if (this.sessionManager && this.sessionManager.currentSession) {
      this.sessionManager.updateCurrentSession(
        this.conversationMessages,
        model, // Current model name
        0, // Token count (would be provided by backend)
        processingMode, // 'rag' or 'llm'
        'voice' // Conversation type
      );
    }
  }

  addMessage(role, text) {
    // ... existing code ...

    // Add to conversation messages for session tracking
    this.conversationMessages.push({
      role: role === 'system' ? 'user' : role,
      content: text,
      timestamp: Date.now()
    });
  }
}
```

## Security Considerations

1. **Private Records**: All conversation sessions are stored as encrypted GUN records
2. **User Verification**: `authenticateToken` middleware verifies user ownership of records
3. **Access Control**: Only authenticated users can access their own sessions
4. **Encryption**: GUN SEA encryption for sensitive conversation data

## Data Structure

### Conversation Session Record
```javascript
{
  "basic": {
    "name": "Morning Chat with Alfred",
    "description": "Daily conversation session",
    "language": "en",
    "nsfw": false,
    "tagItems": ["productivity", "planning", "morning"]
  },
  "conversationSession": {
    "session_id": "session_1703123456789",
    "title": "Morning Chat with Alfred",
    "description": "Daily conversation session",
    "start_timestamp": 1703123456789,
    "end_timestamp": 1703123457000,
    "duration_seconds": 111,
    "message_count": 6,
    "messages": [
      "Good morning Alfred, what's on the agenda today?",
      "Good morning! Based on your recent activity...",
      "Can you help me organize my priorities for today?",
      "Certainly! Here's your prioritized task list...",
      "That looks good. Can you set a reminder for the team meeting?",
      "Reminder set for 2:00 PM team meeting. I'll notify you 15 minutes before."
    ],
    "message_timestamps": [
      1703123456789,
      1703123458901,
      1703123460123,
      1703123461456,
      1703123566789,
      1703123567890
    ],
    "message_roles": [
      "user", "assistant", "user", "assistant", "user", "assistant"
    ],
    "model_name": "llama3.2:3b",
    "model_provider": ["did:arweave:GOXsTqwMTlDwQN2AT-oCjSy_yrwJ7V0Qg7sGX4vzloY"],
    "total_tokens": 1247,
    "input_tokens": 892,
    "output_tokens": 355,
    "processing_mode": "rag",
    "conversation_type": "voice",
    "language": "en",
    "tags": ["productivity", "planning", "morning", "tasks"],
    "audio_quality_score": 0.95,
    "response_time_avg_ms": 850,
    "interruption_count": 1,
    "error_count": 0,
    "is_private": true,
    "owner_pubkey": "user_public_key_hash",
    "version": "1.0.0"
  },
  "oip": {
    "did": "did:gun:userhash123:session_1703123456789",
    "storage": "gun",
    "encrypted": true
  }
}
```

## Testing Plan

1. **Authentication Testing**
   - User registration and login
   - JWT token validation
   - Access control for GUN records

2. **Session Management Testing**
   - Create new conversation sessions
   - Update sessions with messages
   - Load and display session history
   - Switch between sessions

3. **Integration Testing**
   - Voice processing creates/updates sessions
   - Session data persists across browser sessions
   - Multiple users have isolated session data

## Implementation Timeline

- **Week 1**: Backend authentication and GUN record endpoints
- **Week 2**: Frontend authentication UI and session management
- **Week 3**: Integration with Alfred voice processing
- **Week 4**: Testing, bug fixes, and deployment

## Files to Modify/Create

1. `helpers/utils.js` - Enhanced authenticateToken
2. `routes/records.js` - New GUN record endpoints
3. `config/templates.config.js` - Conversation session template
4. `mac-client/alfred.html` - Authentication UI and session management
5. `helpers/gun.js` - Enhanced GUN helper methods (if needed)

This implementation provides a secure, private conversation history system that integrates seamlessly with Alfred's existing voice processing capabilities while maintaining user privacy through GUN's encrypted storage.
