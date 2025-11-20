# RFK/JFK Document Analysis System - Current Status

## Overview

The OIP system includes a comprehensive document analysis pipeline for processing government documents related to:
- **JFK**: John F. Kennedy assassination files
- **RFK**: Robert F. Kennedy records

The system processes PDF documents from government archives, extracts text via OCR, analyzes pages with AI vision models (Grok-4), and publishes structured records to the OIP blockchain.

## Architecture

### File Structure

The system uses separate directory structures for each collection:

```
/media/
├── jfk/
│   ├── pdf/          # Original PDF files
│   ├── images/       # Converted page images (PNG)
│   └── analysis/     # Analysis results, metadata, OCR text
└── rfk/
    ├── pdf/          # Original PDF files
    ├── images/       # Converted page images (PNG)
    └── analysis/     # Analysis results, metadata, OCR text
```

### Collection Detection

The system automatically detects which collection a document belongs to based on the URL:
- URLs containing `/rfk/` → RFK collection
- URLs containing `/jfk/` → JFK collection
- Default → JFK collection (for backward compatibility)

## API Endpoints

All endpoints are mounted at `/api/jfk` (despite the name, they handle both JFK and RFK collections).

### 1. Process Document
**Endpoint**: `POST /api/jfk/process`

**Purpose**: Process a PDF document from a URL through the complete pipeline

**Request Body**:
```json
{
  "documentUrl": "https://www.archives.gov/research/jfk/releases/doc-123.pdf"
}
```

**Response**: Server-Sent Events (SSE) stream with progress updates

**Process Flow**:
1. Download PDF from URL
2. Convert PDF pages to PNG images (using `pdftoppm`)
3. Run OCR on each page (using Tesseract.js)
4. Analyze each page image with Grok-4 Vision API
5. Extract structured data (names, dates, places, objects, stamps, handwritten notes)
6. Generate metadata summary
7. Publish each page as a separate OIP record
8. Publish document summary as a parent OIP record

**SSE Events**:
- `processing` - Processing status updates
- `download` - PDF download progress
- `conversion` - PDF to image conversion progress
- `analysis` - AI analysis progress (OCR, Grok Vision)
- `publishing` - Record publishing progress
- `complete` - Final completion status
- `error` - Error notifications
- `heartbeat` - Keep-alive messages

### 2. List Documents
**Endpoint**: `GET /api/jfk/list`

**Purpose**: List all processed documents with pagination and filtering

**Query Parameters**:
- `page` (default: 1) - Page number
- `limit` (default: 20) - Items per page
- `search` - Search term (searches ID, summary, names)
- `excludeNoAnalysis` - Filter out documents without analysis
- `onlyNoAnalysis` - Show only documents without analysis
- `sortBy` - Sort field: `id`, `date`, `pageCount`
- `sortOrder` - Sort order: `asc`, `desc`

**Response**:
```json
{
  "documents": [
    {
      "id": "document-id",
      "name": "JFK Document document-id",
      "url": "https://...",
      "pageCount": 15,
      "processingDate": "2024-01-15T10:30:00.000Z",
      "summary": "Document summary...",
      "names": ["John Doe", "Jane Smith"],
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
  }
}
```

**Note**: Currently only reads from JFK analysis directory. RFK support needs to be added.

### 3. Search Documents
**Endpoint**: `GET /api/jfk/search`

**Purpose**: Search documents by extracted metadata (names, places, dates, objects, text)

**Query Parameters**:
- `person` - Search for person names
- `place` - Search for place names
- `date` - Search for specific dates
- `object` - Search for object mentions
- `text` - Full-text search across all pages
- `startDate` - Date range start (ISO format)
- `endDate` - Date range end (ISO format)
- `page` - Pagination page number
- `limit` - Items per page
- `sortBy` - Sort by: `relevance`, `date`, `id`
- `sortOrder` - Sort order: `asc`, `desc`

**Response**: Similar to `/list` but with relevance scoring

**Note**: Currently only searches JFK collection. RFK support needs to be added.

### 4. Process Status
**Endpoint**: `GET /api/jfk/process/status`

**Purpose**: Monitor the processing status of a document via SSE

**Query Parameters**:
- `documentId` - Document ID to monitor (required)
- `collection` - Collection type: `jfk` or `rfk` (optional, auto-detected)

**Response**: SSE stream with status updates

**Status Events**:
- `connected` - Connection established
- `processing` - Processing status updates
- `complete` - Processing complete
- `error` - Error occurred
- `heartbeat` - Keep-alive

### 5. Media Access
**Endpoint**: `GET /api/jfk/media`

**Purpose**: Serve PDF files and page images

**Query Parameters**:
- `id` - Document ID (required)
- `type` - File type: `pdf` or `image` (required)
- `filename` - Image filename (optional, for images)
- `collection` - Collection type: `jfk` or `rfk` (default: `jfk`)
- `getLatestPageData` - Return latest page analysis data (optional)

**Examples**:
```
GET /api/jfk/media?id=doc123&type=pdf&collection=jfk
GET /api/jfk/media?id=doc123&type=image&filename=page-1.png&collection=jfk
```

## Templates

### JFK Templates (Configured)

The system uses two OIP templates for JFK documents:

1. **jfkFilesDocument** (Template ID: `d3xoxXQ8hUlrgKTo1UZc4_GqaKTaApJs0tLFuK6Hxqk`)
   - Document-level record
   - Contains metadata, summary, page references

2. **jfkFilesPageOfDocument** (Template ID: `WP-tZ5nwxrMwr5wKHazTFUtGLRd6nQWRBl8E63Kqufg`)
   - Page-level record
   - Contains individual page analysis, OCR text, extracted entities

### RFK Templates (Not Configured)

The code references RFK templates but they are **NOT configured** in `config/templates.config.js`:
- `rfkFilesDocument` - Referenced but missing from config
- `rfkFilesPageOfDocument` - Referenced but missing from config

**Status**: RFK functionality exists in code but templates need to be created and registered.

## Data Structures

### Document Record Structure

```json
{
  "basic": {
    "name": "JFK Document document-id",
    "date": 1703721600,
    "language": "en",
    "nsfw": false,
    "description": "Document summary...",
    "webUrl": "https://www.archives.gov/research/jfk/releases/doc-123.pdf",
    "tagItems": ["JFK", "assassination", "document", "declassified"]
  },
  "jfkFilesDocument": {
    "naraRecordNumber": "document-id",
    "documentType": "Government Record",
    "declassificationStatus": "Declassified",
    "releaseBatch": "Batch-2024-01",
    "releaseDate": "2024-01-15",
    "releaseTimeEST": "10:30:00 AM",
    "releasePagesCount": 15,
    "originatingAgency": "CIA",
    "relatedNames": ["John Doe", "Jane Smith"],
    "relatedTopics": ["Kennedy Assassination"],
    "internalReferenceCodes": [],
    "pages": [
      "did:arweave:page1-txid",
      "did:arweave:page2-txid"
    ],
    "documentDates": ["1963-11-22"],
    "documentPlaces": ["Dallas, Texas"],
    "documentObjects": []
  }
}
```

### Page Record Structure

```json
{
  "basic": {
    "name": "Page 1 of JFK Document document-id",
    "date": 1703721600,
    "language": "en",
    "nsfw": false,
    "description": "Page summary...",
    "text": "Full OCR extracted text...",
    "webUrl": "/api/jfk/media?id=doc123&type=image&filename=page-1.png",
    "tagItems": ["JFK", "document", "page", "declassified"]
  },
  "jfkFilesPageOfDocument": {
    "pageNumber": 1,
    "documentId": "document-id",
    "summary": "AI-generated page summary",
    "fullText": "OCR extracted text",
    "relevanceToJFK": "High relevance to assassination investigation",
    "names": ["John Doe", "Jane Smith"],
    "dates": ["1963-11-22"],
    "places": ["Dallas, Texas"],
    "objects": ["rifle", "bullet"],
    "handwrittenNotes": [
      {
        "content": "Handwritten note text",
        "location": "top margin"
      }
    ],
    "stamps": [
      {
        "type": "CLASSIFIED",
        "text": "TOP SECRET"
      }
    ],
    "redactions": [
      {
        "type": "blackout",
        "reason": "National security"
      }
    ]
  }
}
```

## Processing Pipeline Details

### 1. PDF Download
- Downloads PDF from provided URL
- Saves to collection-specific directory: `{collection}-doc-{documentId}.pdf`
- Caches downloaded files (skips re-download if exists)
- Supports progress tracking via SSE

### 2. PDF to Image Conversion
- Uses `pdftoppm` (from poppler-utils) to convert PDF pages to PNG
- Creates directory structure: `images/{documentId}/page-{N}.png`
- Handles page numbering (1-indexed)
- Supports both single-page and multi-page documents

### 3. OCR Processing
- Uses Tesseract.js for text extraction
- Processes each page image individually
- Saves OCR text to: `analysis/{documentId}/page-{N}-ocr.txt`
- Handles OCR errors gracefully (continues processing)

### 4. AI Vision Analysis
- Uses Grok-4 Vision API for page analysis
- Collection-specific prompts:
  - JFK: "This is a page from a government document related to the JFK assassination"
  - RFK: "This is a page from a government document related to Robert F. Kennedy (RFK)"
- Extracts structured data:
  - Summary
  - Full text (validates against OCR)
  - Names (people mentioned)
  - Dates (temporal references)
  - Places (geographic locations)
  - Objects (physical items)
  - Handwritten notes
  - Stamps and markings
  - Redactions
  - Relevance assessment
- Saves analysis to: `analysis/{documentId}/page-{N}.json`

### 5. Metadata Generation
- Aggregates data from all pages
- Creates comprehensive document summary
- Collects unique names, dates, places, objects across all pages
- Generates metadata file: `analysis/{documentId}-metadata.json`

### 6. Record Publishing
- **Page Records**: Each page published as separate OIP record
- **Document Record**: Parent record linking to all pages via `pages` array
- Uses mock publishing (not actually publishing to Arweave - see below)
- Checks for existing records to avoid duplicates
- Supports updating incomplete records

## Current Limitations & Issues

### 1. Mock Publishing
**Status**: Publishing is currently **DISABLED** - uses mock transaction IDs

```javascript
// routes/jfk.js line 287-303
async function publishJFKContent(data, contentType) {
  // DISABLED PRODUCTION PUBLISHING - Always use mock publishing
  console.log(`Mock publishing ${contentType} (not sending to Arweave)...`);
  // Generates fake transaction IDs
}
```

**Impact**: Records are processed and stored locally but not published to blockchain.

### 2. Missing RFK Templates
**Status**: RFK templates referenced in code but not configured

**Missing**:
- `rfkFilesDocument` template ID
- `rfkFilesPageOfDocument` template ID

**Impact**: RFK documents cannot be published until templates are created and registered.

### 3. Collection-Specific Endpoints
**Status**: `/list` and `/search` endpoints only read from JFK directory

**Impact**: RFK documents won't appear in list/search results even if processed.

### 4. Template Helper Integration
**Status**: Uses `updateRecord` from `templateHelper` but may need full publishing integration

**Impact**: Document updates may not work correctly without proper template helper integration.

## Integration Points

### Elasticsearch
- Uses `getRecords()` to search for existing documents/pages
- Queries by template type (`jfkFilesDocument`, `jfkFilesPageOfDocument`)
- Searches by `naraRecordNumber` field for document matching
- Searches by `pageNumber` and document name for page matching

### Template Helper
- Uses `updateRecord()` for updating existing document records
- Needs `publishNewRecord()` integration for actual publishing

### RAG System
- JFK documents configured in `config/recordTypesForRAG.js`
- Currently disabled (`enabled: false`)
- Priority: 5
- Context fields: `['name', 'description', 'content', 'documentType', 'date', 'classification']`

## Next Steps for RFK Support

1. **Create RFK Templates**
   - Create `rfkFilesDocument` template
   - Create `rfkFilesPageOfDocument` template
   - Publish templates to Arweave
   - Add template IDs to `config/templates.config.js`

2. **Update List/Search Endpoints**
   - Add collection parameter support
   - Read from both JFK and RFK analysis directories
   - Filter by collection when specified

3. **Enable Production Publishing**
   - Replace mock publishing with real `publishNewRecord()` calls
   - Ensure proper template type handling
   - Add error handling for publishing failures

4. **Add RFK to RAG System**
   - Configure `rfkFilesDocument` in `recordTypesForRAG.js`
   - Enable for AI assistant queries

5. **Testing**
   - Test RFK document processing end-to-end
   - Verify template structure matches JFK templates
   - Test collection detection and routing

## Usage Examples

### Process a JFK Document
```bash
curl -X POST http://localhost:3005/api/jfk/process \
  -H "Content-Type: application/json" \
  -d '{
    "documentUrl": "https://www.archives.gov/research/jfk/releases/doc-123.pdf"
  }'
```

### Process an RFK Document
```bash
curl -X POST http://localhost:3005/api/jfk/process \
  -H "Content-Type: application/json" \
  -d '{
    "documentUrl": "https://www.archives.gov/research/rfk/releases/doc-456.pdf"
  }'
```

### List Processed Documents
```bash
curl "http://localhost:3005/api/jfk/list?page=1&limit=20&search=kennedy"
```

### Search Documents
```bash
curl "http://localhost:3005/api/jfk/search?person=Oswald&place=Dallas&page=1&limit=10"
```

### Get Document Status
```bash
curl "http://localhost:3005/api/jfk/process/status?documentId=doc123&collection=jfk"
```

### Access Media Files
```bash
# Get PDF
curl "http://localhost:3005/api/jfk/media?id=doc123&type=pdf&collection=jfk" -o document.pdf

# Get page image
curl "http://localhost:3005/api/jfk/media?id=doc123&type=image&filename=page-1.png&collection=jfk" -o page1.png
```

## File Locations

- **Route Handler**: `routes/jfk.js` (2,939 lines)
- **Template Config**: `config/templates.config.js`
- **RAG Config**: `config/recordTypesForRAG.js`
- **Media Storage**: `media/jfk/` and `media/rfk/`
- **Main Server**: `index.js` (mounts at `/api/jfk`)

## Summary

The RFK/JFK document analysis system is **functionally complete** for processing and analyzing documents, but has several limitations:

✅ **Working**:
- PDF download and conversion
- OCR text extraction
- AI vision analysis (Grok-4)
- Metadata generation
- Local file storage
- Collection detection (JFK/RFK)
- SSE progress streaming
- Media file serving

⚠️ **Partially Working**:
- Record publishing (mock mode only)
- List/search (JFK only, RFK needs updates)

❌ **Not Working**:
- RFK template publishing (templates missing)
- Production blockchain publishing (disabled)
- RFK list/search endpoints

The system is ready for RFK support once templates are created and endpoints are updated to handle both collections.

