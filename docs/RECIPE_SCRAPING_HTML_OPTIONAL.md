# Recipe Scraping - HTML Parameter Now Optional

## Overview

The `/api/scrape/recipe` endpoint now supports **two use cases**:

1. **Browser Extension** - Provides the HTML content directly
2. **Web Application** - Provides only the URL (HTML is fetched automatically)

This makes the endpoint flexible for different client types while maintaining backward compatibility.

## Changes Made

### 1. Updated Function Signature

The `fetchParsedRecipeData` function now accepts an optional `html` parameter:

```javascript
async function fetchParsedRecipeData(url, html, scrapeId, screenshots, totalHeight, options) {
  // html parameter is now optional
}
```

### 2. Conditional HTML Fetching

If HTML is not provided, the function automatically fetches it using FireCrawl:

```javascript
let htmlContent = html;
let metadata = {};

if (!htmlContent) {
  // Fetch HTML using FireCrawl if not provided
  console.log('HTML not provided, fetching from URL using FireCrawl...');
  sendUpdate('processing', { message: 'Fetching recipe page...' });
  
  const response = await axios.post('https://api.firecrawl.dev/v1/scrape', {
    url: url,
    formats: ['html']
  }, {
    headers: {
      Authorization: `Bearer ${process.env.FIRECRAWL}`
    }
  });

  if (!response.data.success) throw new Error(`Scrape failed: ${response.data.error}`);

  htmlContent = response.data.data.html;
  metadata = response.data.data.metadata || {};
  console.log('HTML fetched successfully from FireCrawl');
} else {
  console.log('Using HTML provided in request');
  // Extract metadata from provided HTML
  const tempDom = cheerio.load(htmlContent);
  metadata = {
    title: tempDom('title').text() || tempDom('meta[property="og:title"]').attr('content') || '',
    ogTitle: tempDom('meta[property="og:title"]').attr('content') || '',
    ogDescription: tempDom('meta[property="og:description"]').attr('content') || '',
    ogImage: tempDom('meta[property="og:image"]').attr('content') || '',
    author: tempDom('meta[name="author"]').attr('content') || '',
    publishedTime: tempDom('meta[property="article:published_time"]').attr('content') || new Date().toISOString()
  };
}

const $ = cheerio.load(htmlContent);
```

### 3. Metadata Extraction

- **FireCrawl Response**: When HTML is fetched, metadata comes from FireCrawl API
- **Provided HTML**: When HTML is provided, metadata is extracted using Cheerio from meta tags

## API Usage

### Use Case 1: Browser Extension (With HTML)

**Request:**
```http
POST /api/scrape/recipe
Content-Type: application/json

{
  "url": "https://example.com/recipe",
  "html": "<html>...</html>",
  "userId": "user123",
  "blockchain": "arweave",
  "screenshots": ["base64..."],
  "totalHeight": 5000
}
```

**Workflow:**
1. Client scrapes the page and sends full HTML
2. Server uses provided HTML immediately
3. Metadata extracted from HTML meta tags
4. Recipe parsed and published

**Benefits:**
- No additional HTTP request needed
- Works with JavaScript-rendered pages
- Captures exact page state from browser

### Use Case 2: Web Application (URL Only)

**Request:**
```http
POST /api/scrape/recipe
Content-Type: application/json

{
  "url": "https://example.com/recipe",
  "userId": "user123",
  "blockchain": "arweave"
}
```

**Note:** `html`, `screenshots`, and `totalHeight` are optional and can be omitted.

**Workflow:**
1. Client sends only the URL
2. Server fetches HTML using FireCrawl API
3. Metadata extracted from FireCrawl response
4. Recipe parsed and published

**Benefits:**
- Simpler client implementation
- No need to handle page rendering
- Works with standard web forms

## Response Format

Both use cases return the same response format:

**Initial Response:**
```json
{
  "scrapeId": "abc123...",
  "blockchain": "arweave"
}
```

**SSE Events:**
```
event: scrapeId
data: {"scrapeId": "abc123..."}

event: processing
data: {"message": "Fetching recipe page..."}  // Only when HTML not provided

event: processing
data: {"message": "Parsing recipe..."}

event: recipePublished
data: {
  "jobId": "recipe_publish_xyz...",
  "status": "pending",
  "message": "Recipe publishing initiated...",
  "recipeData": { ... }
}
```

## Implementation Examples

### Browser Extension Example

```javascript
// In content script
const html = document.documentElement.outerHTML;

// Send to API
fetch('/api/scrape/recipe', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    url: window.location.href,
    html: html,
    userId: currentUserId,
    blockchain: 'arweave',
    screenshots: capturedScreenshots,
    totalHeight: document.documentElement.scrollHeight
  })
});
```

### Web App Example

```javascript
// In React/Vue component
const handleScrape = async (recipeUrl) => {
  const response = await fetch('/api/scrape/recipe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      url: recipeUrl,
      userId: currentUserId,
      blockchain: 'arweave'
    })
  });

  const { scrapeId } = await response.json();
  
  // Listen for SSE updates
  const eventSource = new EventSource(
    `/api/scrape/open-stream?streamId=${scrapeId}`
  );
  
  eventSource.addEventListener('recipePublished', (event) => {
    const data = JSON.parse(event.data);
    console.log('Recipe published:', data);
    displayRecipe(data.recipeData);
  });
};
```

## Error Handling

### HTML Fetching Errors

If FireCrawl fails to fetch the HTML:

```javascript
if (!response.data.success) {
  throw new Error(`Scrape failed: ${response.data.error}`);
}
```

**SSE Error Event:**
```
event: error
data: {"message": "Failed to fetch recipe page", "details": "..."}
```

### Fallback Behavior

- If HTML is provided but invalid, parsing will fail gracefully
- If FireCrawl is unavailable, an error is returned immediately
- Metadata extraction has fallbacks for missing fields

## Environment Variables

Required for URL-only mode:

```bash
# .env
FIRECRAWL=your_firecrawl_api_key_here
```

**Note:** If `FIRECRAWL` is not set and HTML is not provided, the request will fail.

## Migration Guide

### For Existing Browser Extension Users

No changes required! The endpoint maintains backward compatibility. Continue sending HTML as before.

### For New Web App Integrations

Simply omit the `html` field from your requests:

**Before (not supported):**
```json
{
  "url": "...",
  "html": null  // Don't do this
}
```

**After (correct):**
```json
{
  "url": "..."
  // Simply omit html field
}
```

## Logging

The function logs which mode it's operating in:

```
Using HTML provided in request
```
or
```
HTML not provided, fetching from URL using FireCrawl...
Scraped Data type: string
HTML fetched successfully from FireCrawl
```

## Performance Considerations

| Aspect | With HTML | Without HTML |
|--------|-----------|--------------|
| **Client Complexity** | Higher (needs to scrape) | Lower (just send URL) |
| **Server Load** | Lower (no HTTP request) | Higher (FireCrawl API call) |
| **Latency** | Faster (~0-1s) | Slower (~2-5s) |
| **JavaScript Support** | Full (browser renders) | Limited (server-side) |
| **Cost** | Free | FireCrawl API credits |

## Testing

### Test with HTML (Browser Extension Mode)

```bash
curl -X POST http://localhost:3005/api/scrape/recipe \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "url": "https://example.com/recipe",
    "html": "<html><head><title>Test Recipe</title></head><body>...</body></html>",
    "userId": "test-user",
    "blockchain": "arweave"
  }'
```

### Test without HTML (Web App Mode)

```bash
curl -X POST http://localhost:3005/api/scrape/recipe \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "url": "https://example.com/recipe",
    "userId": "test-user",
    "blockchain": "arweave"
  }'
```

## Benefits Summary

✅ **Flexibility** - Supports both client-side and server-side scraping
✅ **Backward Compatible** - Existing integrations continue to work
✅ **Simplified Web Apps** - No need for complex scraping logic
✅ **Maintained Performance** - Browser extension path still fast
✅ **Better Metadata** - Extracts metadata from both sources
✅ **Error Resilience** - Graceful fallbacks for missing data

## Related Documentation

- [Recipe Scraping Update](./RECIPE_SCRAPING_UPDATE.md) - Main recipe scraping documentation
- [Recipe Publishing](./publish-newRecipe-endpoint-behavior.md) - Publishing endpoint details
- [Scrape Analysis](./scrape-recipe-analysis.md) - Original scraping workflow

## Technical Notes

- The function now has two duplicate definitions in the codebase (lines 1572 and 1761)
- The second definition (line 1761) overrides the first and is the active version
- The first definition (line 1572) should be considered deprecated
- Future refactoring should consolidate these into a single implementation

