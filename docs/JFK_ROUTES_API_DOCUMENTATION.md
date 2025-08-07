# JFK Routes API Documentation

This document provides comprehensive documentation for the JFK routes API endpoints (`/routes/jfk.js`). This API handles processing, publishing, and serving historical documents related to JFK assassination files and RFK records.

## Overview

The JFK routes API provides functionality for:
- Processing PDF documents (both JFK and RFK collections)
- Converting PDFs to images
- AI-powered document analysis using Grok Vision API
- OCR text extraction using Tesseract
- Publishing documents to Arweave blockchain
- Searching and retrieving processed documents
- Serving document media files

## Base Path

All endpoints are prefixed with `/api/jfk/`

## Collections Support

The API supports two document collections:
- **JFK**: John F. Kennedy assassination files (default)
- **RFK**: Robert F. Kennedy records

Collection is automatically detected from document URLs or can be specified via query parameters.

---

## Endpoints

### 1. Process Document
**POST** `/process`

Processes a document from a URL through the complete pipeline: download → convert to images → analyze with AI → publish to blockchain.

#### Request Body
```json
{
  "documentUrl": "https://example.com/path/to/document.pdf"
}
```

#### Response
Server-Sent Events (SSE) stream with real-time processing updates:

**Event Types:**
- `processing` - General processing status updates
- `download` - PDF download progress
- `conversion` - PDF to image conversion status
- `analysis` - AI analysis progress
- `publishing` - Blockchain publishing status
- `complete` - Final completion status
- `error` - Error notifications
- `heartbeat` - Connection keepalive

**Example Events:**
```
event: processing
data: {"status": "starting", "message": "Beginning JFK document processing", "documentId": "doc123", "collection": "jfk"}

event: download
data: {"status": "progress", "progress": 50, "downloaded": 1024000, "total": 2048000}

event: complete
data: {"status": "success", "documentId": "doc123", "collection": "jfk", "documentDidTx": "did:arweave:abc123", "pageCount": 15}
```

#### Features
- **Duplicate Detection**: Checks if document already exists in database
- **Caching**: Uses cached results if document previously processed
- **Error Recovery**: Continues processing even if individual pages fail
- **Progress Tracking**: Real-time updates via SSE
- **Timeout Protection**: 20-minute processing timeout

---

### 2. List Documents
**GET** `/list`

Retrieves a paginated list of all processed documents with filtering and sorting options.

#### Query Parameters
- `page` (integer, default: 1) - Page number for pagination
- `limit` (integer, default: 20) - Number of documents per page
- `search` (string) - Search term for document ID, summary, or names
- `excludeNoAnalysis` (boolean) - Exclude documents without analysis
- `onlyNoAnalysis` (boolean) - Show only documents without analysis
- `sortBy` (string, default: 'id') - Sort field: `id`, `date`, `pageCount`
- `sortOrder` (string, default: 'asc') - Sort order: `asc`, `desc`

#### Response
```json
{
  "documents": [
    {
      "id": "doc123",
      "name": "JFK Document doc123",
      "url": "https://example.com/doc.pdf",
      "pageCount": 15,
      "processingDate": "2024-01-15T10:30:00.000Z",
      "summary": "Document summary...",
      "names": ["Lee Harvey Oswald", "Jack Ruby"],
      "hasAnalysis": true
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8,
    "hasNext": true,
    "hasPrev": false
  },
  "sorting": {
    "sortBy": "id",
    "sortOrder": "asc"
  },
  "filtering": {
    "search": null,
    "excludeNoAnalysis": false,
    "onlyNoAnalysis": false
  }
}
```

---

### 3. Search Documents
**GET** `/search`

Advanced search through document content and metadata with relevance scoring.

#### Query Parameters
- `person` (string) - Search for person names
- `place` (string) - Search for locations
- `date` (string) - Search for specific dates
- `object` (string) - Search for objects/items
- `text` (string) - Full-text search
- `startDate` (string) - Date range start (YYYY-MM-DD)
- `endDate` (string) - Date range end (YYYY-MM-DD)
- `page` (integer, default: 1) - Page number
- `limit` (integer, default: 20) - Results per page
- `sortBy` (string, default: 'relevance') - Sort by: `relevance`, `date`, `id`
- `sortOrder` (string, default: 'desc') - Sort order: `asc`, `desc`

#### Response
```json
{
  "documents": [
    {
      "id": "doc123",
      "name": "JFK Document doc123",
      "url": "https://example.com/doc.pdf",
      "pageCount": 15,
      "processingDate": "2024-01-15T10:30:00.000Z",
      "summary": "Document summary...",
      "names": ["Lee Harvey Oswald", "Jack Ruby"],
      "places": ["Dallas", "Texas"],
      "dates": ["November 22, 1963"],
      "objects": ["rifle", "bullet"],
      "relevance": 85,
      "matchingPages": [
        {
          "pageNumber": 3,
          "matches": [
            {"type": "person", "term": "Oswald"},
            {"type": "place", "term": "Dallas"}
          ]
        }
      ]
    }
  ],
  "pagination": { /* same as list endpoint */ },
  "sorting": { /* same as list endpoint */ },
  "search": {
    "person": "Oswald",
    "place": "Dallas",
    "date": null,
    "object": null,
    "text": null,
    "startDate": null,
    "endDate": null
  }
}
```

#### Search Features
- **Multi-field Search**: Combine person, place, date, object, and text searches
- **Relevance Scoring**: Documents ranked by relevance to search terms
- **Date Range Filtering**: Filter by document date ranges
- **Page-level Matching**: Shows which pages contain matches
- **Fuzzy Matching**: Case-insensitive partial matching

---

### 4. Processing Status
**GET** `/process/status`

Monitor the real-time status of document processing via Server-Sent Events.

#### Query Parameters
- `documentId` (string, required) - Document ID to monitor
- `collection` (string, default: 'jfk') - Document collection

#### Response
SSE stream with status updates:

```
event: connected
data: {"status": "monitoring", "message": "Monitoring status for document doc123", "collection": "jfk"}

event: processing
data: {"status": "cached", "message": "Document has already been processed"}

event: complete
data: {"status": "success", "documentId": "doc123", "documentDidTx": "did:arweave:abc123"}
```

#### Status Types
- `connected` - Connection established
- `processing` - Various processing states
- `complete` - Processing finished successfully
- `error` - Processing errors
- `heartbeat` - Connection keepalive

---

### 5. Serve Media Files
**GET** `/media`

Serves document media files (PDFs, images, analysis data).

#### Query Parameters
- `id` (string, required) - Document ID
- `type` (string, required) - Media type: `pdf`, `image`, `analysis`
- `filename` (string) - Specific filename (for images)
- `getLatestPageData` (boolean) - Get updated analysis data (for analysis type)
- `collection` (string, default: 'jfk') - Document collection

#### Examples

**Serve PDF:**
```
GET /api/jfk/media?id=doc123&type=pdf&collection=jfk
```

**Serve Image:**
```
GET /api/jfk/media?id=doc123&type=image&filename=page-1.png&collection=jfk
```

**Serve Analysis Data:**
```
GET /api/jfk/media?id=doc123&type=analysis&getLatestPageData=true&collection=jfk
```

#### Response
- **PDF/Image**: Binary file data
- **Analysis**: JSON metadata

```json
{
  "documentId": "doc123",
  "documentUrl": "https://example.com/doc.pdf",
  "processingDate": "2024-01-15T10:30:00.000Z",
  "pageCount": 15,
  "collection": "jfk",
  "pages": [
    {
      "pageNumber": 1,
      "imagePath": "/path/to/image.png",
      "summary": "Page summary...",
      "fullText": "Extracted text...",
      "dates": ["November 22, 1963"]
    }
  ],
  "summary": "Document summary...",
  "allNames": ["Lee Harvey Oswald", "Jack Ruby"],
  "allDates": ["November 22, 1963"],
  "allPlaces": ["Dallas", "Texas"],
  "allObjects": ["rifle", "bullet"],
  "handwrittenNotes": [
    {
      "pageNumber": 1,
      "content": "Handwritten note text",
      "location": "top margin"
    }
  ],
  "stamps": [
    {
      "pageNumber": 1,
      "type": "classification",
      "date": "1963-11-22",
      "text": "CONFIDENTIAL"
    }
  ]
}
```

---

## Document Processing Pipeline

### 1. Document Download
- Downloads PDF from provided URL
- Supports progress tracking
- Caches downloaded files to avoid re-downloading

### 2. PDF to Image Conversion
- Uses `poppler-utils` (pdftoppm) for high-quality conversion
- Generates PNG images at 300 DPI resolution
- Validates image dimensions and filters invalid images
- Handles multi-page documents

### 3. AI Analysis
- **OCR**: Tesseract.js for text extraction
- **Vision AI**: Grok Vision API for document analysis
- **Structured Data**: Extracts names, dates, places, objects
- **Content Analysis**: Identifies handwritten notes, stamps, redactions

### 4. Data Publishing
- Publishes individual pages to Arweave blockchain
- Creates document records with page references
- Supports both mock and production publishing modes
- Handles duplicate detection and updates

---

## Data Models

### Document Template (JFK)
```json
{
  "basic": {
    "name": "JFK Document doc123",
    "date": 1705320600,
    "language": "en",
    "nsfw": false,
    "description": "Document description",
    "webUrl": "https://example.com/doc.pdf",
    "tagItems": ["JFK", "assassination", "document", "declassified"]
  },
  "jfkFilesDocument": {
    "naraRecordNumber": "doc123",
    "documentType": "Government Record",
    "declassificationStatus": "Declassified",
    "releaseBatch": "November 2017 Release",
    "releaseDate": "2017-11-22",
    "releaseTimeEST": "12:00:00 PM",
    "releasePagesCount": 15,
    "originatingAgency": "FBI",
    "relatedNames": ["Lee Harvey Oswald", "Jack Ruby"],
    "relatedTopics": ["Kennedy Assassination"],
    "internalReferenceCodes": [],
    "pages": ["did:arweave:page1", "did:arweave:page2"]
  }
}
```

### Page Template (JFK)
```json
{
  "basic": {
    "name": "Page 1 of JFK Document doc123",
    "date": 1705320600,
    "language": "en",
    "nsfw": false,
    "description": "Page summary",
    "text": "Extracted text content",
    "webUrl": "/api/jfk/media?id=doc123&type=image",
    "tagItems": ["JFK", "assassination", "document", "declassified"]
  },
  "jfkFilesPageOfDocument": {
    "pageNumber": 1,
    "fullText": "Extracted text content",
    "summary": "Page summary",
    "handwrittenNotes": ["Note 1", "Note 2"],
    "stamps": [
      {
        "type": "classification",
        "date": "1963-11-22",
        "text": "CONFIDENTIAL"
      }
    ],
    "names": ["Lee Harvey Oswald"],
    "dates": ["November 22, 1963"],
    "places": ["Dallas", "Texas"],
    "objects": ["rifle"],
    "redactions": ["Name redacted in paragraph 2"],
    "relevance": "High relevance to JFK assassination",
    "image": {
      "webUrl": "/api/jfk/media?id=doc123&type=image",
      "contentType": "image/png",
      "size": 1024000,
      "width": 1200,
      "height": 1600
    }
  }
}
```

---

## Error Handling

### Common Error Responses

**400 Bad Request**
```json
{
  "error": "Document URL is required"
}
```

**404 Not Found**
```json
{
  "error": "File not found: /path/to/file"
}
```

**500 Internal Server Error**
```json
{
  "error": "Failed to process document"
}
```

### SSE Error Events
```
event: error
data: {"error": "XAI_API_KEY is not set in environment variables", "status": "error"}
```

---

## Environment Variables

Required environment variables:
- `XAI_API_KEY` - X.AI API key for Grok Vision analysis
- `NODE_ENV` - Environment mode (development/production)

---

## File Structure

Documents are organized in collection-specific directories:

```
media/
├── jfk/
│   ├── pdf/           # Downloaded PDF files
│   ├── images/        # Converted page images
│   └── analysis/      # Analysis results and metadata
└── rfk/
    ├── pdf/
    ├── images/
    └── analysis/
```

---

## Rate Limiting and Performance

- **Processing Timeout**: 20 minutes per document
- **Connection Timeout**: 4 minutes for status monitoring
- **Heartbeat Interval**: 15 seconds for SSE connections
- **Image Validation**: Filters out images smaller than 10x10 pixels
- **Batch Processing**: Sequential page processing to manage API limits

---

## Security Features

- **Path Sanitization**: Prevents directory traversal attacks
- **Document ID Sanitization**: Removes unsafe characters from file paths
- **CORS Support**: Configurable cross-origin access
- **File Validation**: Validates file existence and dimensions

---

## Integration Notes

### Blockchain Publishing
- Uses mock publishing by default (for development)
- Generates realistic transaction IDs for testing
- Supports real Arweave publishing when enabled

### AI Analysis
- Requires X.AI API key for Grok Vision analysis
- Falls back gracefully if AI analysis fails
- Preserves OCR text even if vision analysis fails

### Database Integration
- Integrates with Elasticsearch for document storage
- Supports document updates and duplicate detection
- Maintains references between documents and pages