# OIP Reference Client - API Documentation

## Overview

The OIP Reference Client is a sophisticated web interface that provides browsing, searching, and AI-powered interaction with Open Index Protocol (OIP) records. This document outlines all APIs used by the client and explains the integration between the RAG (Retrieval-Augmented Generation) system and OIP records.

## Table of Contents

1. [Core Record APIs](#core-record-apis)
2. [AI/RAG System APIs](#airag-system-apis)
3. [Authentication APIs](#authentication-apis)
4. [Template Management APIs](#template-management-apis)
5. [Media APIs](#media-apis)
6. [RAG System Architecture](#rag-system-architecture)
7. [Data Flow Diagrams](#data-flow-diagrams)
8. [Error Handling](#error-handling)

---

## Core Record APIs

### GET `/api/records`

**Purpose**: Fetch OIP records with filtering, searching, and pagination.

**Parameters**:
```javascript
{
  limit: "12",              // Records per page
  page: "1",                // Page number
  search: "iran news",      // Search terms (space-separated)
  recordType: "post",       // Filter by record type
  sortBy: "date:desc",      // Sort options: date:desc|asc, inArweaveBlock:desc|asc
  resolveDepth: "3",        // How deep to resolve nested data
  dateStart: "1640995200",  // Unix timestamp for date range start
  dateEnd: "1672531200",    // Unix timestamp for date range end
  tags: "politics",         // Filter by tags
  includeSigs: "false",     // Include signature data
  includePubKeys: "false",  // Include public key data
  summarizeTags: "true",    // Return tag summary for filters
  tagCount: "25"            // Number of top tags to return
}
```

**Response Structure**:
```javascript
{
  "records": [
    {
      "oip": {
        "recordType": "post",
        "inArweaveBlock": 1699419,
        "tags": ["news", "politics"]
      },
      "data": {
        "basic": {
          "name": "Article Title",
          "description": "Article summary...",
          "dateCreated": 1672531200
        },
        "post": {
          "articleText": {
            "data": {
              "text": {
                "webUrl": "https://api.oip.onl/api/media?id=abc123.txt"
              }
            }
          }
        }
      }
    }
  ],
  "totalRecords": 1543,
  "totalPages": 129,
  "currentPage": 1,
  "tagSummary": [
    {"tag": "news", "count": 245},
    {"tag": "politics", "count": 189}
  ]
}
```

**Used By**:
- Main record browsing
- Filter application
- Search functionality
- AI-driven record filtering

---

## AI/RAG System APIs

### POST `/api/voice/chat`

**Purpose**: Process natural language queries using RAG to provide intelligent responses with automatic filtering.

**Request Body**:
```javascript
{
  "text": "What's the latest news about Iran?",
  "model": "llama3.2:3b",
  "return_audio": false,
  "include_filter_analysis": true
}
```

**Response Structure**:
```javascript
{
  "response_text": "Based on the latest records, here are recent developments about Iran...",
  "sources": [
    {
      "title": "Iran Nuclear Deal Update",
      "url": "https://example.com/article",
      "date": "2024-01-15",
      "relevance": 0.95
    }
  ],
  "applied_filters": {
    "search": "iran",
    "recordType": "post", 
    "sortBy": "date:desc",
    "rationale": "Found 5 recent news articles about Iran"
  },
  "search_results_count": 5,
  "context_used": true
}
```

**RAG Processing Flow**:
1. **Query Analysis**: Extract intent, keywords, and record type preferences
2. **Filter Generation**: Convert natural language to specific database filters
3. **Record Retrieval**: Fetch relevant records using generated filters
4. **Full Text Fetching**: For posts, retrieve complete article text via media URLs
5. **Context Building**: Combine record data into coherent context (max 8000 chars)
6. **LLM Generation**: Generate response using context and original query
7. **Filter Metadata**: Return applied filters for UI synchronization

---

## Authentication APIs

### POST `/api/user/login`

**Request Body**:
```javascript
{
  "email": "user@example.com",
  "password": "securepassword"
}
```

**Response**:
```javascript
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "email": "user@example.com",
    "role": "user"
  }
}
```

### POST `/api/user/register`

**Request Body**:
```javascript
{
  "email": "newuser@example.com", 
  "password": "securepassword"
}
```

**Response**: Same as login

### Authentication Flow:
1. Credentials sent to `/api/user/login` or `/api/user/register`
2. JWT token returned and stored in `localStorage`
3. Token included in `Authorization: Bearer <token>` header for protected endpoints
4. Token validates user access to publishing features

---

## Template Management APIs

### GET `/api/templates`

**Purpose**: Fetch available record templates for publishing and filtering.

**Parameters**:
```javascript
{
  limit: "25",
  page: "1"
}
```

**Response**:
```javascript
{
  "templates": [
    {
      "data": {
        "template": "post",
        "name": "News Article Template",
        "fields": {
          "title": {"type": "string", "required": true},
          "content": {"type": "string", "required": true},
          "tags": {"type": "array", "required": false}
        }
      }
    }
  ],
  "totalTemplates": 24
}
```

**Used By**:
- Record type filter population
- Publishing interface
- RAG system record type detection

---

## Media APIs

### GET `/api/media`

**Purpose**: Retrieve media files (text, audio, images) referenced in records.

**Parameters**:
```javascript
{
  id: "c1bc39d820562e309a0eb119eeb9bb5573b902e8df2e1170c7d5fd61b489e63f.txt"
}
```

**Response**: Raw file content (text, audio blob, image data)

**Usage Examples**:
- **Full Text Articles**: `https://api.oip.onl/api/media?id=abc123.txt`
- **Audio Files**: `https://api.oip.onl/api/media?id=def456.mp3`
- **Images**: `https://api.oip.onl/api/media?id=ghi789.jpg`

**Integration Points**:
- RAG system fetches full article text for better context
- Audio player streams media files
- Image galleries display media content

---

## RAG System Architecture

### Core Components

#### 1. Query Processing (`helpers/ragService.js`)
```javascript
class RAGService {
  async query(question, options = {}) {
    // 1. Analyze query for intent and record types
    const relevantTypes = this.analyzeRecordTypes(question);
    
    // 2. Extract keywords and search parameters  
    const searchParams = this.extractSearchParameters(question);
    
    // 3. Query records database
    const searchResults = await this.searchRecords(searchParams);
    
    // 4. Fetch full text content for posts
    const enrichedResults = await this.enrichWithFullText(searchResults);
    
    // 5. Build LLM context from results
    const context = await this.buildContext(enrichedResults);
    
    // 6. Generate response
    const response = await this.generateResponse(question, context);
    
    // 7. Return response with metadata
    return {
      answer: response,
      sources: searchResults.records,
      applied_filters: searchParams,
      context_used: context.length > 0
    };
  }
}
```

#### 2. Record Type Analysis
The RAG system intelligently determines which record types are relevant:

```javascript
const recordTypePriorities = {
  'post': 9,      // News articles, blog posts
  'video': 7,     // Video content  
  'image': 5,     // Image posts
  'recipe': 6,    // Cooking recipes
  'workout': 6    // Exercise routines
};

// Query: "What's the latest news?" → Prioritizes 'post' records
// Query: "Show me workout routines" → Prioritizes 'workout' records
```

#### 3. Full Text Integration
For enhanced context, the RAG system fetches complete article text:

```javascript
async extractFullTextUrl(record) {
  const recordType = record.oip?.recordType;
  if (recordType === 'post') {
    const articleText = record.data?.post?.articleText;
    if (articleText?.data?.text?.webUrl) {
      return articleText.data.text.webUrl;
    }
  }
  return null;
}

async fetchFullTextContent(url) {
  // Fetches up to 3000 characters of article text
  // Caches results to avoid duplicate requests
  // Falls back to record description if fetch fails
}
```

#### 4. Context Building
Creates structured context for the LLM:

```javascript
buildContext(searchResults) {
  const contextParts = [];
  
  // Add record information with full text
  searchResults.records.forEach((record, index) => {
    contextParts.push(`RECORD ${index + 1}:`);
    contextParts.push(`TITLE: ${record.data.basic.name}`);
    
    // Use full article text if available
    if (record._fullTextContent) {
      contextParts.push(`FULL CONTENT: ${record._fullTextContent}`);
    } else {
      contextParts.push(`SUMMARY: ${record.data.basic.description}`);
    }
    
    contextParts.push(`DATE: ${record.data.basic.dateReadable}`);
    contextParts.push(`SOURCE: ${record.data.basic.webUrl || 'Internal'}`);
    contextParts.push(''); // Separator
  });
  
  return contextParts.join('\n');
}
```

### RAG-OIP Integration Flow

```
User Query: "What's the latest Iran news?"
     ↓
1. Query Analysis
   - Intent: News/current events  
   - Keywords: ["iran", "news"]
   - Record Types: ["post"] (high priority)
   ↓
2. Filter Generation
   - search: "iran"
   - recordType: "post" 
   - sortBy: "date:desc"
   - limit: 5
   ↓
3. Database Query (/api/records)
   - Returns 5 most recent Iran-related posts
   - Includes metadata: titles, descriptions, URLs
   ↓
4. Full Text Retrieval
   - For each post with articleText.data.text.webUrl
   - Fetch complete article via /api/media
   - Cache results for performance
   ↓
5. Context Assembly
   - Combine full article text (up to 8000 chars total)
   - Include titles, dates, sources
   - Structure for LLM consumption
   ↓
6. LLM Processing (Ollama)
   - Send context + original question
   - Generate comprehensive response
   - Include source citations
   ↓
7. Response Enhancement
   - Add applied filters for UI sync
   - Include source metadata
   - Return rationale for filter choices
   ↓
8. UI Integration
   - Display AI response in chat
   - Apply filters to record browser
   - Show filter chips with explanations
   - Update record display automatically
```

### Filter Synchronization

The RAG system ensures UI filters match AI analysis:

```javascript
// RAG determines these filters automatically
const appliedFilters = {
  search: "iran",
  recordType: "post", 
  sortBy: "date:desc",
  rationale: "Found 5 recent news articles about Iran"
};

// UI automatically updates to match
document.getElementById('voice-search-input').value = appliedFilters.search;
document.getElementById('voice-record-type-filter').value = appliedFilters.recordType;
document.getElementById('voice-sort-by').value = appliedFilters.sortBy;

// Records reload with AI-selected filters
await loadVoiceRecords(true);
```

---

## Data Flow Diagrams

### Main Browsing Flow
```
User Input (Search/Filters) → /api/records → Record Display → Media Loading (/api/media)
```

### AI Chat Flow  
```
User Question → /api/voice/chat → RAG Processing → Context Building → LLM Response
     ↓                              ↓
Filter Sync ← UI Update ← Applied Filters ← Record Retrieval (/api/records)
```

### Authentication Flow
```
Login Form → /api/user/login → JWT Token → localStorage → Protected Routes
```

---

## Error Handling

### API Error Responses
All APIs return consistent error structures:

```javascript
{
  "success": false,
  "error": "Descriptive error message",
  "code": "ERROR_CODE",
  "details": { /* Additional context */ }
}
```

### Common Error Scenarios

1. **Network Timeouts**: 25-second timeout for AI requests, 15 seconds for others
2. **Authentication Failures**: Invalid tokens return 401, redirect to login
3. **Rate Limiting**: 429 status with retry-after headers
4. **Media Not Found**: 404 for missing files, graceful fallback in UI
5. **RAG Failures**: Fallback to basic search when AI processing fails

### Client-Side Error Handling

```javascript
// Robust error handling with user feedback
try {
  const response = await fetch('/api/voice/chat', {
    method: 'POST',
    body: JSON.stringify(requestData),
    signal: AbortSignal.timeout(25000)
  });
  
  if (!response.ok) {
    throw new Error(`API Error: ${response.status}`);
  }
  
  const data = await response.json();
  // Process successful response
  
} catch (error) {
  if (error.name === 'AbortError') {
    updateAIStatus('Request timeout', 'Please try again');
  } else {
    updateAIStatus('Error occurred', error.message);
  }
}
```

---

## Performance Considerations

### Caching Strategies
- **Full Text Content**: Cached in RAG service to avoid repeated fetches
- **Template Data**: Cached in client for filter population
- **Media Files**: Browser caching with appropriate headers

### Optimization Techniques
- **Pagination**: Load 12 records per page to balance performance and UX
- **Lazy Loading**: Media files loaded on demand
- **Debounced Search**: 300ms delay on search input to reduce API calls
- **Parallel Requests**: Multiple API calls executed simultaneously when possible

### Resource Management
- **Context Length**: RAG context limited to 8000 characters for optimal LLM performance
- **Record Limits**: AI queries limited to 5 most relevant records
- **Timeout Management**: Progressive timeouts prevent hanging requests

---

## Future Enhancements

### Planned API Improvements
1. **GraphQL Integration**: More efficient data fetching with field selection
2. **WebSocket Support**: Real-time updates for new records
3. **Advanced Search**: Semantic search with vector embeddings
4. **Batch Operations**: Bulk record operations for efficiency

### RAG System Evolution
1. **Multi-Modal RAG**: Integration with image and video content analysis
2. **Conversation Memory**: Persistent context across chat sessions
3. **Source Quality Scoring**: Relevance ranking for better context selection
4. **Custom Prompt Templates**: Domain-specific response formatting

---

This documentation provides a comprehensive overview of how the OIP Reference Client integrates with various APIs and leverages the RAG system for intelligent record interaction. The system demonstrates sophisticated natural language processing capabilities while maintaining robust error handling and performance optimization. 