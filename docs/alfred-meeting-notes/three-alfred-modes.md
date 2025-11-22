# Alfred's Three Conversation Modes

## Overview

Alfred supports three distinct conversation modes, each optimized for different use cases. This guide is designed for interface developers integrating Alfred into mobile, desktop, or web applications.

---

## Quick Reference

| Mode | API Parameter | Use Case | Response Type |
|------|---------------|----------|---------------|
| **Chat** | *(none)* | General AI conversation | Pure LLM response |
| **All Notes** | `allNotes: true` | Search across all user's notes | RAG with best-match note |
| **Selected Note** | `noteDid: "did:gun:..."` | Query specific note | RAG with specific note |

---

## Mode 1: Chat Mode (General AI)

### Description
Pure LLM conversation without any note context. Use this for general questions, tasks, creative projects, or any topic not related to the user's notes.

### API Request
```javascript
POST /api/notes/converse
Authorization: Bearer {JWT_TOKEN}
Content-Type: application/json

{
  "question": "What is the capital of France?",
  "model": "llama3.2:3b",
  "conversationHistory": [
    { "role": "user", "content": "previous question" },
    { "role": "assistant", "content": "previous answer" }
  ]
}
```

### API Response
```javascript
{
  "success": true,
  "answer": "The capital of France is Paris...",
  "context": {
    "mode": "llm"
  },
  "model": "llama3.2:3b",
  "sources": []
}
```

### UI Considerations
- **Placeholder**: "Ask Alfred anything..."
- **Welcome Message**: "Hello! I'm Alfred, your AI assistant. I can help you with any questions, tasks, or creative projects."
- **Icon**: General chat icon (💬)
- **No Note Reference**: Don't show which note is being used

### State Management
```javascript
{
  chatMode: 'chat',
  currentNote: null,
  selectedNoteForChat: null
}
```

---

## Mode 2: All Notes Mode (Search Across Notes)

### Description
Alfred searches across ALL of the user's meeting notes to find the most relevant one, then answers the question based on that note's content. The backend uses LLM-powered extraction to understand:
- Date ranges mentioned (e.g., "last week", "yesterday", "Nov 15th")
- Attendee names (e.g., "with John")
- Primary subject/topic

### API Request
```javascript
POST /api/notes/converse
Authorization: Bearer {JWT_TOKEN}
Content-Type: application/json

{
  "question": "What did we discuss about the API architecture last week?",
  "model": "llama3.2:3b",
  "allNotes": true,  // ⚠️ KEY PARAMETER
  "conversationHistory": []
}
```

### API Response
```javascript
{
  "success": true,
  "answer": "Based on the meeting, several key decisions were made about the API architecture...",
  "context": {
    "mode": "allNotes",
    "search": {
      "searchQuery": "API architecture",
      "dateRange": {
        "hasDate": true,
        "startDate": "2025-11-14",
        "endDate": "2025-11-21"
      },
      "attendees": [],
      "totalResults": 5,
      "topNoteScore": {
        "finalScore": 8.5,
        "chunkScore": 7.2,
        "chunkCount": 3,
        "attendeeScore": 0,
        "attendeeMatches": 0
      }
    },
    "note": {
      "did": "did:gun:034d41b0c8bd:a3f8c9d2...",
      "title": "Team Standup - Nov 18",
      "type": "meeting"
    },
    "chunks_count": 3,
    "related_content_count": 5,
    "transcript_length": 1523
  },
  "model": "llama3.2:3b",
  "sources": []
}
```

### UI Considerations
- **Placeholder**: "Ask about your notes (e.g., 'What did we discuss about the API last week?')"
- **Welcome Message**: "Hello! I'm Alfred. I can search across all your meeting notes to help you find information. Try asking questions like 'What did we discuss about the API last week?' or 'Who was assigned to the design task?'"
- **Icon**: Notes/library icon (📚)
- **Show Found Note**: Display which note was found and used
  ```
  📝 Found in "Team Standup - Nov 18"
  
  Based on the meeting, several key decisions...
  ```
- **No Results Handling**: If `totalResults === 0`, the response will explain what was searched:
  ```javascript
  {
    "success": true,
    "answer": "I couldn't find any notes matching your search criteria. I looked for notes from 2025-11-14 to 2025-11-21. Try providing a date range or more specific details about the meeting."
  }
  ```

### State Management
```javascript
{
  chatMode: 'notes',
  currentNote: null,
  selectedNoteForChat: null
}
```

### Example Questions
- "What did we discuss about the API last week?"
- "Who was assigned to the design task?"
- "What decisions were made in yesterday's meeting?"
- "What action items came out of the standup with Sarah and Mike?"
- "What were the open questions from the meeting on November 15th?"

---

## Mode 3: Selected Note Mode (Query Specific Note)

### Description
Ask questions about a specific note the user is viewing. This mode is automatically activated when the user clicks "Chat with Alfred about this note" from a note detail view.

### API Request
```javascript
POST /api/notes/converse
Authorization: Bearer {JWT_TOKEN}
Content-Type: application/json

{
  "question": "What were the main action items?",
  "model": "llama3.2:3b",
  "noteDid": "did:gun:034d41b0c8bd:a3f8c9d2...",  // ⚠️ KEY PARAMETER
  "conversationHistory": []
}
```

### API Response
```javascript
{
  "success": true,
  "answer": "The main action items from this meeting were: 1) Create technical spec for API refactoring (assigned to Jane Doe, due by Friday)...",
  "context": {
    "note": {
      "did": "did:gun:034d41b0c8bd:a3f8c9d2...",
      "title": "Team Standup - Nov 18",
      "type": "meeting"
    },
    "chunks_count": 3,
    "related_content_count": 5,
    "transcript_length": 1523
  },
  "model": "llama3.2:3b",
  "sources": []
}
```

### UI Considerations
- **Placeholder**: "Ask about '{note.title}'..."
- **Welcome Message**: "Hello! I've analyzed your note '{note.title}'. Ask me anything about it - I have access to the full transcript, summary, and related content."
- **Icon**: Document/note icon (📝)
- **Mode Indicator**: Show "Selected Note" badge or indicator
- **Persistent Context**: Keep the note DID throughout the conversation
- **Auto-Activation**: When user taps "Chat with Alfred about this note" from note detail:
  1. Navigate to chat/Alfred view
  2. Automatically set mode to "Selected Note"
  3. Show which note is selected
  4. Store the note DID

### State Management
```javascript
{
  chatMode: 'selected',
  currentNote: { /* full note object */ },
  selectedNoteForChat: 'did:gun:034d41b0c8bd:a3f8c9d2...'
}
```

### Transitioning to Selected Note Mode

**From Note Detail View:**
```javascript
function chatAboutNote(note) {
  // Store the note DID
  state.selectedNoteForChat = note.did || note.oip?.did;
  state.currentNote = note;
  state.chatMode = 'selected';
  
  // Clear conversation history
  state.conversationHistory = [];
  
  // Show Selected Note UI
  showSelectedNoteButton();
  activateSelectedNoteMode();
  
  // Navigate to chat
  navigateToChat();
}
```

### Example Questions
- "What were the main action items?"
- "Who attended this meeting?"
- "Summarize the key decisions"
- "What did Sarah say about the API?"
- "Were there any open questions?"

---

## Implementation Guide

### 1. State Structure

Maintain these state variables in your application:

```typescript
interface AlfredState {
  chatMode: 'chat' | 'notes' | 'selected';
  currentNote: Note | null;
  selectedNoteForChat: string | null; // DID
  conversationHistory: Message[];
  currentAI: 'alfred' | 'alice'; // Optional: multiple AI personalities
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}
```

### 2. Mode Toggle Component

**Three-Button Toggle:**
```
[  Chat  ] [  All Notes  ] [  Selected Note  ]
   ✓                            (hidden by default)
```

**Visibility Rules:**
- **Chat**: Always visible
- **All Notes**: Always visible
- **Selected Note**: Only visible when `selectedNoteForChat !== null`

### 3. Request Building Logic

```javascript
function buildConverseRequest(question) {
  const baseRequest = {
    question: question,
    model: state.settings.model,
    conversationHistory: state.conversationHistory.slice(-10)
  };

  // Determine mode and add appropriate parameter
  if (state.chatMode === 'selected' && state.selectedNoteForChat) {
    // Selected Note mode
    baseRequest.noteDid = state.selectedNoteForChat;
  } else if (state.chatMode === 'notes') {
    // All Notes mode
    baseRequest.allNotes = true;
  }
  // Chat mode: no additional parameters

  return baseRequest;
}
```

### 4. Response Handling

```javascript
function handleConverseResponse(data) {
  if (!data.success) {
    showError(data.error);
    return;
  }

  let displayAnswer = data.answer;

  // If All Notes mode and a note was found, prepend note title
  if (state.chatMode === 'notes' && data.context?.search) {
    const noteTitle = data.context.note?.title || 'a note';
    displayAnswer = `📝 Found in "${noteTitle}"\n\n${data.answer}`;
  }

  addMessage('assistant', displayAnswer);
  
  // Update conversation history
  state.conversationHistory.push({
    role: 'assistant',
    content: data.answer
  });
}
```

### 5. Mode Switching

**Rules:**
- Clear conversation history when switching modes
- Clear `selectedNoteForChat` when switching away from "Selected Note"
- Update placeholder text appropriately
- Show/hide "Selected Note" button
- Display appropriate welcome message

```javascript
function switchMode(newMode) {
  state.chatMode = newMode;
  state.conversationHistory = [];

  if (newMode !== 'selected') {
    state.selectedNoteForChat = null;
    state.currentNote = null;
    hideSelectedNoteButton();
  }

  updatePlaceholder();
  showWelcomeMessage();
}
```

---

## Mobile-Specific Considerations

### iOS Implementation

**SwiftUI State:**
```swift
@Published var chatMode: ChatMode = .chat
@Published var selectedNoteDID: String? = nil
@Published var conversationHistory: [Message] = []

enum ChatMode {
    case chat
    case allNotes
    case selectedNote
}
```

**Mode Picker:**
```swift
Picker("Mode", selection: $chatMode) {
    Text("Chat").tag(ChatMode.chat)
    Text("All Notes").tag(ChatMode.allNotes)
    if selectedNoteDID != nil {
        Text("Selected Note").tag(ChatMode.selectedNote)
    }
}
.pickerStyle(SegmentedPickerStyle())
```

### Android Implementation

**Kotlin State:**
```kotlin
data class AlfredState(
    var chatMode: ChatMode = ChatMode.CHAT,
    var selectedNoteDID: String? = null,
    var conversationHistory: MutableList<Message> = mutableListOf()
)

enum class ChatMode {
    CHAT,
    ALL_NOTES,
    SELECTED_NOTE
}
```

**TabLayout:**
```kotlin
tabLayout.addTab(tabLayout.newTab().setText("Chat"))
tabLayout.addTab(tabLayout.newTab().setText("All Notes"))

// Only show Selected Note tab if DID is set
if (selectedNoteDID != null) {
    tabLayout.addTab(tabLayout.newTab().setText("Selected Note"))
}
```

---

## Edge Cases & Best Practices

### 1. No Results in All Notes Mode
**Scenario**: User asks about notes that don't exist.

**Response**:
```javascript
{
  "success": true,
  "answer": "I couldn't find any notes matching your search criteria...",
  "context": {
    "mode": "allNotes",
    "searchQuery": "...",
    "resultsFound": 0
  }
}
```

**UI Handling**: Display the message naturally, suggest trying:
- Different date ranges
- More specific keywords
- Checking if notes exist

### 2. Note Deleted While in Selected Note Mode
**Scenario**: User is in Selected Note mode, but the note is deleted.

**API Response**: `404 Not Found`

**UI Handling**:
- Show error: "This note is no longer available"
- Automatically switch to Chat mode
- Clear `selectedNoteForChat`

### 3. Conversation History Management
**Best Practice**: Only keep last 5 exchanges (10 messages)

```javascript
conversationHistory: state.conversationHistory.slice(-10)
```

**Why**: Prevents token limits, keeps context relevant

### 4. Mode Transitions
**Clear history when**:
- Switching between modes
- Starting chat about a different note
- User manually clears chat

**Don't clear history when**:
- App goes to background
- User navigates away temporarily
- Switching between Alfred/Alice personalities (optional)

### 5. Network Errors
Handle gracefully:
```javascript
try {
  const response = await fetch('/api/notes/converse', ...);
  const data = await response.json();
  handleResponse(data);
} catch (error) {
  if (error.code === 'NETWORK_ERROR') {
    showMessage("Unable to connect. Please check your internet connection.");
  } else {
    showMessage("Something went wrong. Please try again.");
  }
}
```

---

## Testing Checklist

### Chat Mode
- [ ] Ask general questions (non-note related)
- [ ] Maintains conversation history
- [ ] Switches from other modes cleanly
- [ ] Placeholder shows "Ask Alfred anything..."

### All Notes Mode
- [ ] Finds relevant notes by date
- [ ] Finds relevant notes by attendee
- [ ] Finds relevant notes by topic/keywords
- [ ] Handles "no results found" gracefully
- [ ] Shows which note was found
- [ ] Placeholder shows search-specific text

### Selected Note Mode
- [ ] Activates when clicking "Chat with Alfred"
- [ ] Correct note DID is sent
- [ ] Button shows "Selected Note"
- [ ] Placeholder shows note title
- [ ] Hides button when switching modes
- [ ] Handles deleted notes gracefully

### Mode Switching
- [ ] History clears on mode change
- [ ] Placeholder updates
- [ ] Welcome message changes
- [ ] Selected Note button shows/hides
- [ ] State persists correctly

### Conversation Flow
- [ ] History maintains last 10 messages
- [ ] Responses format correctly
- [ ] Newlines render properly
- [ ] Error messages display
- [ ] Loading states work

---

## API Authentication

All requests require JWT authentication:

```javascript
headers: {
  'Authorization': `Bearer ${jwtToken}`,
  'Content-Type': 'application/json'
}
```

**JWT Token Contents:**
- `userId`
- `email`
- `publicKey`
- `isAdmin`

**Token Expiry**: 45 days (configure in backend)

---

## Available LLM Models

Configure which model to use:

| Model | Speed | Quality | Use Case |
|-------|-------|---------|----------|
| `llama3.2:3b` | Fast | Good | Default, recommended |
| `llama3.2:1b` | Fastest | Lower | Quick responses |
| `llama3.1:8b` | Slower | Best | Complex questions |
| `gemma2:2b` | Fast | Good | Alternative |

**Setting Model:**
```javascript
{
  "model": "llama3.2:3b",  // in request body
  ...
}
```

---

## Error Codes

| Code | Meaning | Action |
|------|---------|--------|
| 400 | Bad Request | Check request parameters |
| 401 | Unauthorized | Refresh JWT token |
| 404 | Note Not Found | Switch to Chat mode |
| 500 | Server Error | Retry or show error |

---

## Performance Considerations

### Response Times
- **Chat Mode**: ~1-3 seconds
- **All Notes Mode**: ~3-8 seconds (includes search + extraction)
- **Selected Note Mode**: ~2-5 seconds (includes RAG retrieval)

### Optimization Tips
1. **Show loading indicators** for all modes
2. **Cache conversation history** locally
3. **Debounce typing** if implementing typing indicators
4. **Prefetch** user's notes on app launch (for All Notes mode)
5. **Lazy load** Selected Note button (only show when needed)

---

## UI/UX Best Practices

### 1. Visual Mode Indicators
Make it clear which mode is active:
- **Color coding**: Different accent colors per mode
- **Icons**: 💬 Chat | 📚 All Notes | 📝 Selected Note
- **Badge**: Show note title for Selected Note mode

### 2. Smooth Transitions
- Animate mode switching
- Fade in/out welcome messages
- Slide in Selected Note button

### 3. Feedback
- Show loading spinner while API responds
- Display "Searching notes..." for All Notes mode
- Show note match confidence (optional)

### 4. Accessibility
- Label mode buttons clearly
- Provide voice-over descriptions
- Support keyboard navigation
- High contrast mode support

### 5. Onboarding
First-time users should see:
- Brief explanation of three modes
- Example questions for each mode
- Info button for detailed help

---

## Example Integration (React Native)

```javascript
import React, { useState } from 'react';
import { View, Text, TextInput, Button, SegmentedControl } from 'react-native';

const AlfredChat = () => {
  const [chatMode, setChatMode] = useState('chat');
  const [selectedNoteDID, setSelectedNoteDID] = useState(null);
  const [conversationHistory, setConversationHistory] = useState([]);
  const [question, setQuestion] = useState('');

  const sendMessage = async () => {
    if (!question.trim()) return;

    const request = {
      question,
      model: 'llama3.2:3b',
      conversationHistory
    };

    if (chatMode === 'selected' && selectedNoteDID) {
      request.noteDid = selectedNoteDID;
    } else if (chatMode === 'notes') {
      request.allNotes = true;
    }

    const response = await fetch('https://api.oip.onl/api/notes/converse', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwtToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(request)
    });

    const data = await response.json();

    if (data.success) {
      setConversationHistory([
        ...conversationHistory,
        { role: 'user', content: question },
        { role: 'assistant', content: data.answer }
      ]);
      setQuestion('');
    }
  };

  const modes = selectedNoteDID
    ? ['chat', 'notes', 'selected']
    : ['chat', 'notes'];

  return (
    <View>
      <SegmentedControl
        values={modes.map(m => m.charAt(0).toUpperCase() + m.slice(1))}
        selectedIndex={modes.indexOf(chatMode)}
        onChange={(event) => {
          setChatMode(modes[event.nativeEvent.selectedSegmentIndex]);
          setConversationHistory([]);
        }}
      />

      {/* Messages Display */}
      {conversationHistory.map((msg, i) => (
        <Text key={i}>{msg.role}: {msg.content}</Text>
      ))}

      {/* Input */}
      <TextInput
        value={question}
        onChangeText={setQuestion}
        placeholder={getPlaceholder(chatMode)}
      />
      <Button title="Send" onPress={sendMessage} />
    </View>
  );
};

function getPlaceholder(mode) {
  switch (mode) {
    case 'notes': return 'Ask about your notes...';
    case 'selected': return 'Ask about this note...';
    default: return 'Ask Alfred anything...';
  }
}
```

---

## Support & Resources

- **API Documentation**: `/docs/alfred-meeting-notes/ALFRED_NOTES_API_FRONTEND_GUIDE.md`
- **OIP Technical Overview**: `/docs/OIP_TECHNICAL_OVERVIEW.md`
- **Records API**: `/docs/API_RECORDS_ENDPOINT_DOCUMENTATION.md`

---

## Changelog

**v1.0.0** (November 2025)
- Initial three-mode implementation
- Chat, All Notes, and Selected Note modes
- LLM-powered search extraction
- Conversation history support
- Multi-model support

---

**Last Updated**: November 22, 2025

