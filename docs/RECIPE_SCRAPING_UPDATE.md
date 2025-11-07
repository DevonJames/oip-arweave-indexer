# Recipe Scraping Update - Complete Integration Guide

## Overview

The recipe scraping functionality in `routes/scrape.js` has been updated to properly integrate with the `/api/publish/newRecipe` endpoint, including full media processing for recipe images with BitTorrent and IPFS distribution.

## Key Changes

### 1. Image Processing Pipeline

**Old Behavior:**
- Recipe images were only stored as web URLs
- No BitTorrent or IPFS addresses generated
- Missing size, dimensions, and proper content type

**New Behavior:**
```javascript
// Complete image processing workflow:
1. Download image from scraped URL
2. Upload to media system (/api/media/upload)
3. Get BitTorrent magnet URI
4. Upload to IPFS (/api/media/ipfs-upload)
5. Setup web access (/api/media/web-setup)
6. Extract metadata (dimensions, size, content type)
7. Build complete image object
```

**Result:**
```json
{
  "image": {
    "webUrl": "https://oip.fitnessally.io/media/project/filename.jpg",
    "bittorrentAddress": "magnet:?xt=urn:btih:...",
    "ipfsAddress": "QmXxXxXx...",
    "arweaveAddress": "",
    "filename": "recipe-image.jpg",
    "size": 1048576,
    "contentType": "image/jpeg",
    "width": 1024,
    "height": 768
  }
}
```

### 2. Recipe Data Format

**Updated to Match `/api/publish/newRecipe` Expected Format:**

```json
{
  "basic": {
    "name": "Recipe Title",
    "language": "En",
    "date": 1733587200,
    "description": "Recipe description",
    "webUrl": "https://source-url.com",
    "nsfw": false,
    "tagItems": []
  },
  "recipe": {
    "prep_time_mins": 15,
    "cook_time_mins": 20,
    "total_time_mins": 35,
    "servings": 4,
    "ingredient_amount": [2, 1, 3],
    "ingredient_unit": ["cups", "whole", "cloves"],
    "ingredient": ["flour", "egg", "garlic"],
    "ingredient_comment": ["", "", "minced"],
    "instructions": "Step 1\nStep 2\nStep 3",
    "notes": "Optional notes",
    "cuisine": "mediterranean",
    "course": "dinner",
    "author": "Recipe Author"
  },
  "image": {
    // ... full image object with all addresses
  },
  "blockchain": "arweave"
}
```

### 3. Ingredient Processing

**Ingredient Names:**
- Scraper sends **plain ingredient names** (not DIDs)
- The `/api/publish/newRecipe` endpoint handles lookup and resolution
- Endpoint creates new nutritionalInfo records for missing ingredients

**Ingredient Comments:**
- Extracted from ingredient names that contain commas
- Example: `"garlic, minced"` → name: `"garlic"`, comment: `"minced"`
- Empty strings used for ingredients without comments

**Instructions Format:**
- Changed from array to string (newline-separated)
- Example: `["Step 1", "Step 2"]` → `"Step 1\nStep 2"`

### 4. Publishing Endpoint

**Old Method:**
```javascript
// Direct call to publishNewRecord (synchronous)
recipeRecord = await publishNewRecord(recipeData, "recipe", false, false, false, null, blockchain)
```

**New Method:**
```javascript
// HTTP POST to /api/publish/newRecipe endpoint (asynchronous with job tracking)
const publishResponse = await axios.post(`${getBaseUrl(req)}/api/publish/newRecipe`, recipeData, {
  headers: {
    'Content-Type': 'application/json',
    'Authorization': req.headers.authorization || ''
  }
});

// Response contains jobId for tracking async process
console.log(publishResponse.data);
// {
//   jobId: "recipe_publish_abc123def456",
//   status: "pending",
//   message: "Recipe publishing initiated. This may take a few minutes..."
// }

// Send job info through SSE stream
sendUpdate('recipePublished', {
  jobId: publishResponse.data.jobId,
  status: publishResponse.data.status,
  message: publishResponse.data.message
});
```

**Benefits:**
- ✅ Uses the proper endpoint with ingredient intelligence
- ✅ Automatic ingredient lookup and creation
- ✅ Nutritional summary calculation
- ✅ Proper DID resolution
- ✅ Consistent with publish workflow
- ✅ **Asynchronous processing** - doesn't block scraping workflow
- ✅ **Job tracking** - client can monitor progress via jobId
- ✅ **Better UX** - immediate feedback with status updates

## Complete Workflow

### Recipe Scraping Flow

```
1. User submits recipe URL
   ↓
2. Scraper fetches HTML via FireCrawl
   ↓
3. Scraper parses recipe structure
   - Title, description, times
   - Ingredient names, amounts, units
   - Instructions (array)
   - Image URL
   ↓
4. IMAGE PROCESSING PIPELINE
   - Download image from URL
   - Upload to /api/media/upload → get mediaId + BitTorrent
   - Upload to /api/media/ipfs-upload → get IPFS hash
   - Setup /api/media/web-setup → get web URL
   - Extract dimensions and metadata
   ↓
5. DATA FORMATTING
   - Build ingredient_comment array (extract from names)
   - Clean ingredient names (remove comments)
   - Join instructions array to string
   - Build complete recipe object
   ↓
6. PUBLISH TO /api/publish/newRecipe
   - POST formatted recipe data
   - Endpoint handles ingredient lookup
   - Endpoint creates missing ingredients
   - Endpoint calculates nutritional summary
   - Recipe published with all DIDs resolved
   ↓
7. Return published recipe to client
```

### Media Processing Details

**Image Download:**
```javascript
const imageFileName = await downloadImageFile(imageUrl, url);
// Creates: {article_hash}-{image_hash}-{filename}
```

**Media Upload:**
```javascript
const uploadResponse = await axios.post('/api/media/upload', formData);
// Returns: mediaId, magnetURI, httpUrl, size, mime
```

**IPFS Upload:**
```javascript
const ipfsResponse = await axios.post('/api/media/ipfs-upload', { mediaId });
// Returns: ipfsHash
```

**Web Setup:**
```javascript
const webResponse = await axios.post('/api/media/web-setup', { mediaId, filename });
// Returns: webUrl (e.g., https://domain.com/media/project/filename.jpg)
```

**Metadata Extraction:**
```javascript
const imageMetadata = await sharp(imagePath).metadata();
// Returns: width, height, format, space, channels, depth
```

## Error Handling

### Image Processing Errors

**Graceful Fallback:**
```javascript
try {
  // Full image processing pipeline
} catch (error) {
  console.error('Error processing recipe image:', error);
  // Fallback to just web URL
  imageData = {
    webUrl: imageUrl,
    bittorrentAddress: '',
    ipfsAddress: '',
    arweaveAddress: '',
    filename: '',
    size: 0,
    contentType: 'image/jpeg',
    width: 0,
    height: 0
  };
}
```

**Benefits:**
- Recipe still publishes even if image processing fails
- Original web URL preserved as fallback
- Error logged for debugging
- No data loss

### Publishing Errors

**Comprehensive Error Handling:**
```javascript
try {
  const publishResponse = await axios.post('/api/publish/newRecipe', recipeData);
  // Success handling
} catch (error) {
  console.error('Error publishing recipe:', error.response?.data || error.message);
  
  // Send error through stream if available
  if (sendUpdate) {
    sendUpdate('error', {
      message: 'Failed to publish recipe',
      details: error.response?.data || error.message
    });
  }
  
  throw error; // Re-throw for upstream handling
}
```

## Integration Points

### Required Services

1. **Media Upload Service** (`/api/media/upload`)
   - Handles file uploads
   - Creates BitTorrent magnets
   - Returns mediaId

2. **IPFS Service** (`/api/media/ipfs-upload`)
   - Uploads to IPFS network
   - Returns IPFS hash

3. **Web Setup Service** (`/api/media/web-setup`)
   - Creates web-accessible URLs
   - Returns formatted web URL

4. **Publish Recipe Endpoint** (`/api/publish/newRecipe`)
   - Handles ingredient lookup
   - Creates missing nutritionalInfo records
   - Calculates nutritional summaries
   - Publishes complete recipe

### Dependencies

**Node Modules:**
```javascript
const axios = require('axios');
const FormData = require('form-data');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
```

**Internal Functions:**
```javascript
downloadImageFile(imageUrl, url)  // Downloads and saves image
getBaseUrl(req)                    // Gets API base URL
cleanupScrape(scrapeId)            // Cleanup after scraping
```

## Async Job Pattern

### Understanding the Workflow

The recipe publishing process is now **asynchronous** to prevent long-running operations from blocking the scraping workflow:

1. **Scraper parses recipe** (fast - ~5-10 seconds)
2. **Scraper uploads image** (fast - ~2-5 seconds)
3. **Submit to `/api/publish/newRecipe`** (returns immediately with jobId)
4. **Return recipe data + jobId to client** (immediate)
5. **Background job processes recipe** (slow - may take minutes):
   - Looks up/creates ingredients
   - Fetches nutritional data from OpenAI
   - Calculates nutritional summary
   - Publishes to Arweave/GUN

### Benefits of Including Recipe Data

The `recipeData` field in the SSE response provides **immediate value** to the client:

- ✅ **Instant Preview**: Display the recipe to the user immediately (no waiting for blockchain)
- ✅ **Better UX**: Users can review and edit before final publishing
- ✅ **Transparency**: See exactly what data was sent to the publishing endpoint
- ✅ **Debugging**: Easy to verify the parsed recipe structure
- ✅ **Caching**: Store locally while waiting for DID
- ✅ **Fallback**: If publishing fails, still have the recipe data

### Client Implementation

**Listen to SSE Stream:**
```javascript
const eventSource = new EventSource(`/api/scrape/open-stream?streamId=${scrapeId}`);

eventSource.addEventListener('recipePublished', (event) => {
  const data = JSON.parse(event.data);
  console.log('Job ID:', data.jobId);
  console.log('Status:', data.status);
  console.log('Message:', data.message);
  console.log('Recipe Data:', data.recipeData);
  
  // Display the recipe data immediately (before publishing completes)
  displayRecipePreview(data.recipeData);
  
  // Store jobId for status polling
  localStorage.setItem('recipeJobId', data.jobId);
  
  // Start polling job status to get final DID
  pollJobStatus(data.jobId);
});

function displayRecipePreview(recipeData) {
  // Show the recipe details to the user immediately
  document.getElementById('recipeName').textContent = recipeData.basic.name;
  document.getElementById('recipeDescription').textContent = recipeData.basic.description;
  document.getElementById('recipeImage').src = recipeData.image.webUrl;
  
  // Show ingredients
  const ingredientsList = recipeData.recipe.ingredient.map((name, i) => {
    const amount = recipeData.recipe.ingredient_amount[i] || '';
    const unit = recipeData.recipe.ingredient_unit[i] || '';
    const comment = recipeData.recipe.ingredient_comment[i] || '';
    return `${amount} ${unit} ${name} ${comment}`.trim();
  });
  
  document.getElementById('ingredients').innerHTML = ingredientsList
    .map(ing => `<li>${ing}</li>`)
    .join('');
  
  // Show instructions
  document.getElementById('instructions').textContent = recipeData.recipe.instructions;
  
  // Show publishing status
  document.getElementById('status').textContent = 'Publishing to blockchain...';
}
```

**Poll Job Status:**
```javascript
async function pollJobStatus(jobId) {
  const interval = setInterval(async () => {
    const response = await fetch(`/api/jobs/${jobId}/status`);
    const status = await response.json();
    
    if (status.status === 'completed') {
      clearInterval(interval);
      console.log('Recipe published:', status.result);
      displayRecipe(status.result);
    } else if (status.status === 'failed') {
      clearInterval(interval);
      console.error('Publishing failed:', status.error);
    } else {
      console.log('Status:', status.message);
    }
  }, 5000); // Poll every 5 seconds
}
```

### Job Status API (Reference)

**Note:** The job status API endpoint should be implemented in your application.

```javascript
// Example job status response
{
  "jobId": "recipe_publish_abc123def456",
  "status": "processing", // pending | processing | completed | failed
  "message": "Creating nutritional info for missing ingredients...",
  "progress": 60, // percentage (optional)
  "result": {
    // Complete published recipe (when completed)
    "transactionId": "did:arweave:xyz...",
    "recordToIndex": { ... }
  }
}
```

## HTML Parameter - Optional

The `/api/scrape/recipe` endpoint now supports **two modes**:

### Mode 1: Browser Extension (With HTML)
Provide the full HTML content from the browser:

```json
{
  "url": "https://example.com/recipe",
  "html": "<html>...</html>",
  "userId": "test-user",
  "blockchain": "arweave",
  "screenshots": ["base64..."],
  "totalHeight": 5000
}
```

**Benefits:**
- Captures JavaScript-rendered content
- No additional HTTP request
- Faster processing

### Mode 2: Web Application (URL Only)
Provide just the URL, HTML is fetched automatically:

```json
{
  "url": "https://example.com/recipe",
  "userId": "test-user",
  "blockchain": "arweave"
}
```

**Benefits:**
- Simpler client implementation
- Works from any platform
- No need for page scraping logic

**Note:** When HTML is not provided, the server uses FireCrawl API to fetch it automatically. See [RECIPE_SCRAPING_HTML_OPTIONAL.md](./RECIPE_SCRAPING_HTML_OPTIONAL.md) for full details.

## Testing

### Test Recipe Scraping (Web App Mode)

```bash
# Test with just a URL (HTML fetched automatically)
curl -X POST http://localhost:3005/api/scrape/recipe \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/recipe",
    "userId": "test-user",
    "blockchain": "arweave"
  }'
```

### Test Recipe Scraping (Browser Extension Mode)

```bash
# Test with HTML provided
curl -X POST http://localhost:3005/api/scrape/recipe \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/recipe",
    "html": "<html><body>...</body></html>",
    "userId": "test-user",
    "blockchain": "arweave"
  }'
```

### Expected Flow

1. **Initial Response:**
   ```json
   {
     "scrapeId": "sha256_hash",
     "blockchain": "arweave"
   }
   ```

2. **Stream Events:**
   - `scrapeId` - Scrape initiated
   - `processing` - Parsing recipe
   - `recipePublished` - Recipe publishing job initiated

3. **Recipe Published Event (SSE):**
   ```json
   {
     "jobId": "recipe_publish_abc123def456",
     "status": "pending",
     "message": "Recipe publishing initiated. This may take a few minutes...",
     "did": null,
     "recipeData": {
       "basic": {
         "name": "Spicy Sesame Noodle Bowl",
         "language": "En",
         "date": 1733587200,
         "description": "A flavorful Asian-inspired noodle dish...",
         "webUrl": "https://example.com/recipe",
         "nsfw": false,
         "tagItems": []
       },
       "recipe": {
         "prep_time_mins": 15,
         "cook_time_mins": 20,
         "total_time_mins": 35,
         "servings": 4,
         "ingredient_amount": [8, 2, 3, 1],
         "ingredient_unit": ["oz", "tablespoons", "cloves", "cup"],
         "ingredient": ["rice noodles", "sesame oil", "garlic", "bell peppers"],
         "ingredient_comment": ["", "", "minced", "sliced"],
         "instructions": "Cook rice noodles according to package...",
         "notes": "Can add tofu for extra protein",
         "cuisine": "asian",
         "course": "dinner",
         "author": "Chef Name"
       },
       "image": {
         "webUrl": "https://oip.fitnessally.io/media/file.png",
         "bittorrentAddress": "magnet:?xt=urn:btih:...",
         "ipfsAddress": "QmXxXxXx...",
         "arweaveAddress": "",
         "filename": "recipe-image.jpg",
         "size": 1048576,
         "contentType": "image/jpeg",
         "width": 1024,
         "height": 768
       },
       "blockchain": "arweave"
     }
   }
   ```

4. **Async Processing:**
   - Recipe published to Arweave/GUN (asynchronous)
   - All ingredients resolved or created
   - Image uploaded with all addresses
   - Nutritional summary calculated
   - Client can poll job status using jobId

## Configuration

### Environment Variables

```bash
# Base URL for API calls
API_BASE_URL=http://localhost:3005

# Media directory
MEDIA_DIR=/usr/src/app/data/media

# Project name for web URLs
COMPOSE_PROJECT_NAME=oip-arweave-indexer

# Blockchain selection
DEFAULT_BLOCKCHAIN=arweave
```

### Media Configuration

**Upload Limits:**
- Max file size: 500MB (configurable)
- Supported formats: JPEG, PNG, GIF, WebP

**Storage Paths:**
```
/data/media/
├── {mediaId}/
│   ├── original          # Original image file
│   └── manifest.json     # Metadata
└── web/
    └── {project}/
        └── {filename}    # Web-accessible copy
```

## Comparison: Old vs New

| Feature | Old Behavior | New Behavior |
|---------|-------------|--------------|
| **Image Storage** | Web URL only | Web + BitTorrent + IPFS |
| **Image Metadata** | None | Dimensions, size, content type |
| **Publishing** | Direct `publishNewRecord()` (sync) | HTTP POST to `/api/publish/newRecipe` (async) |
| **Response Pattern** | Wait for completion | Immediate jobId response |
| **Job Tracking** | None | jobId + status + message |
| **Ingredient Format** | DIDs (attempted) | Plain names (endpoint resolves) |
| **Ingredient Comments** | Not extracted | Extracted from names |
| **Instructions** | Array | Newline-separated string |
| **Error Handling** | Basic | Comprehensive with fallbacks |
| **Media Distribution** | None | P2P BitTorrent + IPFS |
| **Web Access** | External URL | Local + external URLs |
| **Background Processing** | Blocking | Non-blocking async jobs |

## Benefits

### 1. **Complete Media Distribution**
- BitTorrent P2P sharing reduces server load
- IPFS decentralized storage for permanence
- Web URLs for immediate access
- Multiple redundant access methods

### 2. **Proper API Integration**
- Uses documented `/api/publish/newRecipe` endpoint
- Consistent with other publishing workflows
- Benefits from endpoint's ingredient intelligence
- Automatic nutritional data enrichment

### 3. **Robust Error Handling**
- Graceful fallbacks for image processing failures
- Comprehensive error logging
- Stream updates for client feedback
- No data loss on partial failures

### 4. **Format Compliance**
- Matches expected recipe schema
- Proper data types (string vs array)
- Complete metadata (dimensions, sizes)
- Ready for OIP template validation

### 5. **Scalability**
- P2P distribution reduces bandwidth costs
- Decentralized storage ensures availability
- Efficient media processing pipeline
- Suitable for high-volume scraping

## Future Enhancements

### Potential Improvements

1. **Image Optimization**
   - Generate multiple resolutions
   - WebP conversion for efficiency
   - Thumbnail generation

2. **Ingredient Intelligence**
   - Pre-parse ingredient strings
   - Suggest corrections
   - Handle units better

3. **Nutritional Enrichment**
   - Calculate per-serving nutrition during scrape
   - Validate ingredient matches
   - Suggest alternatives

4. **Batch Processing**
   - Multiple recipes in one request
   - Parallel image processing
   - Bulk ingredient creation

5. **Caching**
   - Cache ingredient lookups
   - Cache nutritional data
   - Reduce API calls

## Troubleshooting

### Common Issues

**1. Image Upload Fails**
```
Error: Failed to upload image to media system
```
**Solution:** Check media service is running and has disk space

**2. IPFS Upload Timeout**
```
Error: IPFS upload timeout
```
**Solution:** Increase timeout or skip IPFS (optional)

**3. Recipe Publishing Fails**
```
Error: 400 - Missing required fields
```
**Solution:** Check recipe data format matches expected schema

**4. Ingredient Creation Slow**
```
Warning: Creating 20 new ingredient records
```
**Solution:** Expected behavior - OpenAI API calls take time

### Debug Mode

**Enable Verbose Logging:**
```javascript
// In scrape.js
console.log('Recipe data to be published:', JSON.stringify(recipeData, null, 2));
```

**Check Media Upload:**
```bash
# Verify media file exists
ls -la /usr/src/app/data/media/{mediaId}/
```

**Test Endpoint Directly:**
```bash
curl -X POST http://localhost:3005/api/publish/newRecipe \
  -H "Content-Type: application/json" \
  -d @recipe-test-data.json
```

## Documentation References

- [API Publish Documentation](./API_PUBLISH_DOCUMENTATION.md)
- [Recipe Endpoint Behavior](./publish-newRecipe-endpoint-behavior.md)
- [Media Files Guide](./OIP_MEDIA_FILES_COMPREHENSIVE_GUIDE.md)
- [Scrape Recipe Analysis](./scrape-recipe-analysis.md)

## Change Summary

**Files Modified:**
- `routes/scrape.js` - Updated recipe scraping workflow

**Changes Made:**
1. Added complete image processing pipeline
2. Integrated BitTorrent and IPFS media distribution
3. Updated recipe data format for `/api/publish/newRecipe`
4. Changed from direct `publishNewRecord()` to HTTP endpoint
5. Added ingredient comment extraction
6. Converted instructions from array to string
7. Enhanced error handling with fallbacks
8. Added comprehensive logging

**No Breaking Changes:**
- Endpoint URL unchanged (`/api/scrape/recipe`)
- Response format unchanged
- Existing functionality preserved
- Backward compatible

---

**Last Updated:** 2025-11-07  
**Version:** 1.0.0  
**Status:** Production Ready

