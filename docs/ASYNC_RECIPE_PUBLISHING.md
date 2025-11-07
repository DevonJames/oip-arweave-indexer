# Async Recipe Publishing System

## Overview

The recipe publishing endpoint now uses an asynchronous job-based system to handle long-running OpenAI nutritional data lookups without blocking the UI.

## Why Async Publishing?

With the migration from Nutritionix API to OpenAI for nutritional data:
- **Nutritional lookups take longer** (~2-5 seconds per ingredient via OpenAI)
- **Multiple ingredients = long wait times** (12 ingredients = 24-60 seconds)
- **UI becomes unresponsive** during synchronous processing
- **Better UX needed** for long-running operations

## How It Works

### **Step 1: Initiate Publishing**

**Endpoint:** `POST /api/publish/newRecipe`

**Request:** (same as before)
```json
{
  "basic": {
    "name": "Grilled Chicken Salad",
    "description": "Healthy and delicious..."
  },
  "recipe": {
    "ingredient": ["chicken breast", "olive oil", "lettuce"],
    "ingredient_amount": [200, 2, 100],
    "ingredient_unit": ["g", "tbsp", "g"],
    "ingredient_comment": ["", "", ""],
    "instructions": "1. Grill chicken...",
    "servings": 4
  }
}
```

**Response:** (immediate, <100ms)
```json
{
  "jobId": "recipe_publish_abc123def456",
  "status": "pending",
  "message": "Recipe publishing initiated. This may take a few minutes..."
}
```

### **Step 2: Poll for Status**

**Endpoint:** `GET /api/publish-status/:jobId`

**Response Formats:**

**Processing:**
```json
{
  "jobId": "recipe_publish_abc123def456",
  "status": "processing",
  "progress": 45,
  "message": "Creating ingredient 3 of 12: chicken breast..."
}
```

**Completed:**
```json
{
  "jobId": "recipe_publish_abc123def456",
  "status": "completed",
  "progress": 100,
  "message": "Job completed successfully",
  "transactionId": "h5FTJ2oFoA7xp4H7t7YI...",
  "recordToIndex": { /* full recipe record */ },
  "blockchain": "arweave"
}
```

**Failed:**
```json
{
  "jobId": "recipe_publish_abc123def456",
  "status": "failed",
  "progress": 0,
  "message": "Job failed: OpenAI API error",
  "error": "OpenAI API key not configured"
}
```

## Progress Stages

| Progress | Stage | Description |
|----------|-------|-------------|
| 0-5% | Initialization | Parsing ingredients, detecting DIDs |
| 5-15% | Database Search | Searching for existing nutritional info |
| 15-30% | Matching | Finding best matches for ingredients |
| 30-80% | OpenAI Lookups | Creating new nutritional info records (per ingredient) |
| 80-82% | Assembly | Building final ingredient arrays |
| 82-90% | Nutrition Calc | Calculating recipe nutritional summary |
| 90-100% | Publishing | Publishing recipe to blockchain |

## Frontend Integration

### **Simple Polling Example**

```javascript
// Step 1: Initiate publish
const publishResponse = await fetch('/api/publish/newRecipe', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify(recipeData)
});

const { jobId } = await publishResponse.json();

// Step 2: Poll for status
const pollInterval = setInterval(async () => {
  const statusResponse = await fetch(`/api/publish-status/${jobId}`);
  const status = await statusResponse.json();
  
  // Update UI with progress
  updateProgressBar(status.progress);
  updateStatusMessage(status.message);
  
  // Handle completion
  if (status.status === 'completed') {
    clearInterval(pollInterval);
    showSuccess(status.transactionId);
  }
  
  // Handle failure
  if (status.status === 'failed') {
    clearInterval(pollInterval);
    showError(status.error);
  }
}, 2000); // Poll every 2 seconds
```

### **Enhanced Polling with Exponential Backoff**

```javascript
async function pollJobStatus(jobId, maxAttempts = 60) {
  let attempts = 0;
  let delay = 1000; // Start with 1 second
  
  while (attempts < maxAttempts) {
    const response = await fetch(`/api/publish-status/${jobId}`);
    const status = await response.json();
    
    // Update UI
    updateProgress(status.progress, status.message);
    
    // Job complete
    if (status.status === 'completed') {
      return { success: true, data: status };
    }
    
    // Job failed
    if (status.status === 'failed') {
      return { success: false, error: status.error };
    }
    
    // Wait before next poll (exponential backoff)
    await new Promise(resolve => setTimeout(resolve, delay));
    delay = Math.min(delay * 1.2, 5000); // Max 5 seconds
    attempts++;
  }
  
  throw new Error('Polling timeout - job did not complete');
}
```

## Backend Architecture

### **Job Tracker** (`helpers/jobTracker.js`)

- **In-memory storage**: Jobs stored in Map for fast access
- **Auto-cleanup**: Jobs removed 1 hour after completion/failure
- **Progress tracking**: 0-100% with status messages
- **Thread-safe**: Designed for concurrent job updates

### **Async Processing** (`routes/publish.js`)

The `processRecipeAsync()` function:
1. **Runs in background** after response is sent
2. **Updates progress** at key stages
3. **Handles errors gracefully** without crashing server
4. **Stores results** for later retrieval via polling

## Error Handling

### **Job Failures**

Jobs can fail at various stages:
- **Ingredient lookup failed**: OpenAI API error
- **Publishing failed**: Arweave/GUN error
- **Invalid data**: Malformed recipe data

All failures are:
- **Logged to console** with full details
- **Stored in job tracker** with error message
- **Returned via status endpoint** for UI display

### **Job Expiration**

- Jobs auto-delete after **1 hour** 
- Status endpoint returns `404 Not Found` for expired jobs
- Frontend should handle missing jobs gracefully

## Performance Considerations

### **Memory Usage**

- **~1KB per job** in memory
- **Auto-cleanup** prevents indefinite growth
- **Maximum ~1000 concurrent jobs** before cleanup triggers

### **Polling Frequency**

**Recommended:**
- **Every 2 seconds** for active jobs
- **Exponential backoff** to reduce server load
- **Max 5 seconds** between polls

**Not Recommended:**
- ❌ Every 100ms (too aggressive)
- ❌ Every 30 seconds (too slow, poor UX)

## Migration Guide

### **Old Synchronous Code**

```javascript
const response = await fetch('/api/publish/newRecipe', {
  method: 'POST',
  body: JSON.stringify(recipeData)
});

const { transactionId } = await response.json();
showSuccess(transactionId);
```

### **New Async Code**

```javascript
// Initiate
const response = await fetch('/api/publish/newRecipe', {
  method: 'POST',
  body: JSON.stringify(recipeData)
});

const { jobId } = await response.json();

// Poll
const result = await pollJobStatus(jobId);
if (result.success) {
  showSuccess(result.data.transactionId);
} else {
  showError(result.error);
}
```

## Benefits

✅ **Responsive UI**: Returns immediately, doesn't block  
✅ **Progress Visibility**: Users see what's happening  
✅ **Better Error Handling**: Graceful failure without page freeze  
✅ **Scalable**: Handles long-running operations efficiently  
✅ **Backward Compatible**: Same request format, different response flow  

## Future Enhancements

- **WebSocket support**: Real-time progress updates instead of polling
- **Persistent storage**: Redis/database for job survival across restarts
- **Job cancellation**: Allow users to cancel in-progress jobs
- **Batch operations**: Queue multiple recipes for bulk publishing
- **Job history**: View past publish jobs and their results
