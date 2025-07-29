# Podcast Generation with didTx Records

## Overview

The `/api/generate/podcast` endpoint now supports generating podcasts directly from OIP records using their `didTx` identifiers, in addition to the existing `articles` parameter. This enhancement allows you to create podcasts from any OIP records that contain text content, automatically extracting and processing the content as needed.

## New Parameters

### `didTx` (string)
- **Description**: Single didTx identifier for a record to include in the podcast
- **Format**: `"did:arweave:transactionId"`
- **Example**: `"did:arweave:abc123def456ghi789"`

### `didTxs` (array of strings)
- **Description**: Array of didTx identifiers for multiple records to include in the podcast
- **Format**: `["did:arweave:txId1", "did:arweave:txId2", ...]`
- **Example**: `["did:arweave:abc123", "did:arweave:def456", "did:arweave:ghi789"]`

## Usage Examples

### Single Record Podcast
```javascript
const response = await fetch('/api/generate/podcast', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
    },
    body: JSON.stringify({
        didTx: "did:arweave:your-record-id-here",
        selectedHosts: ["socrates", "hypatia"],
        targetLengthSeconds: 3500
    })
});
```

### Multiple Records Podcast
```javascript
const response = await fetch('/api/generate/podcast', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
    },
    body: JSON.stringify({
        didTxs: [
            "did:arweave:record1-id",
            "did:arweave:record2-id",
            "did:arweave:record3-id"
        ],
        selectedHosts: ["thomasJefferson", "machiavelli"],
        targetLengthSeconds: 2500
    })
});
```

### Mixed Content (Articles + Records)
```javascript
const response = await fetch('/api/generate/podcast', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
    },
    body: JSON.stringify({
        articles: [
            {
                title: "Manual Article",
                content: "Article content...",
                url: "https://example.com/article"
            }
        ],
        didTxs: [
            "did:arweave:record1-id",
            "did:arweave:record2-id"
        ],
        selectedHosts: ["socrates", "hypatia"],
        targetLengthSeconds: 4000
    })
});
```

## Supported Record Types

### `post` Records
- **Primary source**: `data.post.webUrl` - External article URL
- **Secondary source**: `data.post.articleText.data.text.webUrl` - Resolved text dref URL
- **Fallback**: `data.post.articleText` - Direct text content

### `text` Records
- **Primary source**: `data.text.webUrl` - Text content URL
- **Fallback**: `data.text.text` - Direct text content

### Other Record Types
- **Automatic extraction**: Uses RAG service to find full text URLs
- **Fallback**: `data.basic.description` - Record description

## Content Processing

The system automatically:

1. **Fetches records** with `resolveDepth: 3` to ensure all dref references are resolved
2. **Extracts URLs** based on record type and structure
3. **Fetches content** from web URLs using the built-in content fetching service
4. **Converts to articles format** with the following structure:
   ```javascript
   {
       didTx: "did:arweave:...",
       title: "Record title",
       description: "Record description", 
       tags: "tag1,tag2,tag3",
       relatedScore: 1.0,
       url: "https://source-url.com", // if available
       content: "Full text content..."
   }
   ```

## Response Format

The response follows the same Server-Sent Events (SSE) format as the original podcast endpoint:

```
event: generatingPodcast
data: "Podcast generation starting for ID: abc123..."

event: podcastProductionUpdate  
data: "Socrates & Hypatia are hosting"

event: podcastProductionUpdate
data: "Socrates is writing intro"

event: podcastComplete
data: {"message": "Podcast generation complete!", "podcastFile": "podcast-id.mp3"}
```

## Error Handling

### Common Errors

- **No valid articles**: No content could be extracted from provided didTx records
- **Record not found**: One or more didTx records don't exist in the database
- **Content extraction failed**: Unable to fetch content from URLs in the records
- **Missing hosts**: `selectedHosts` parameter is required

### Error Response Format
```javascript
{
    "error": "Error message describing the issue"
}
```

## Best Practices

1. **Use specific records**: Records with clear content URLs work best
2. **Mix content types**: Combine different record types for varied discussion
3. **Check record availability**: Ensure records exist and are accessible
4. **Content quality**: Records with substantial text content produce better podcasts
5. **Host selection**: Choose hosts that match the content topic for better discussions

## Limitations

1. **Content accessibility**: URLs must be publicly accessible for content fetching
2. **Content size**: Very large articles may be truncated
3. **Processing time**: Multiple records with external URLs take longer to process
4. **Network dependencies**: Requires internet access to fetch external content

This enhancement makes it easy to create podcasts directly from your OIP records without manual content preparation. 