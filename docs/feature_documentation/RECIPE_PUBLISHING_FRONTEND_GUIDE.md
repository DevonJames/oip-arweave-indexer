# Recipe Publishing Progress Tracking - Frontend Guide

## Overview

There are two ways to publish recipes, and both now support real-time progress tracking via Server-Sent Events (SSE):

1. **Via Scrape Endpoint**: `/api/scrape/recipe` - Scrapes recipe from URL
2. **Via Publish Endpoint**: `/api/publish/newRecipe` - Publishes pre-formatted recipe data

Both methods now support full ingredient resolution tracking before sending completion.

---

## Method 1: Scrape Recipe from URL

### Step 1: Initiate Scrape

```javascript
const response = await fetch('/api/scrape/recipe', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`  // Optional
    },
    body: JSON.stringify({
        url: 'https://www.simplyrecipes.com/recipe-url',
        userId: 'user123',
        blockchain: 'arweave'
    })
});

const { scrapeId, blockchain } = await response.json();
```

### Step 2: Connect to Stream

```javascript
const eventSource = new EventSource(`/api/scrape/open-stream?streamId=${scrapeId}`);

eventSource.addEventListener('ping', (e) => {
    console.log('Connection alive');
});

eventSource.addEventListener('processing', (e) => {
    const data = JSON.parse(e.data);
    console.log('Processing:', data.message);
    // UI: Show loading message
});

eventSource.addEventListener('publishProgress', (e) => {
    const data = JSON.parse(e.data);
    console.log(`Progress: ${data.progress}% - ${data.message}`);
    // UI: Update progress bar
});

eventSource.addEventListener('recipeCompleted', (e) => {
    const data = JSON.parse(e.data);
    
    if (data.alreadyExists) {
        console.log('Recipe already exists:', data.did);
        // UI: Show "Recipe already in database"
    } else {
        console.log('Recipe published:', data.did);
        // UI: Show success with link to recipe
    }
    
    eventSource.close();
    // Navigate to recipe page or show success
});

eventSource.addEventListener('error', (e) => {
    const data = JSON.parse(e.data);
    console.error('Error:', data.message);
    // UI: Show error message
    eventSource.close();
});
```

---

## Method 2: Publish Pre-Formatted Recipe

### Step 1: Publish Recipe

```javascript
const recipeData = {
    basic: {
        name: "Mediterranean Grilled Chicken",
        description: "A healthy and flavorful dish",
        language: "en",
        date: Math.floor(Date.now() / 1000),
        tagItems: ["mediterranean", "chicken", "healthy"]
    },
    recipe: {
        ingredient: ["chicken breast", "olive oil", "garlic"],
        ingredient_amount: [200, 2, 2],
        ingredient_unit: ["g", "tbsp", "cloves"],
        ingredient_comment: ["", "", "minced"],
        instructions: "1. Marinate chicken...",
        servings: 4,
        prep_time_mins: 15,
        cook_time_mins: 20,
        cuisine: "Mediterranean",
        course: "Dinner"
    },
    blockchain: "arweave"
};

const response = await fetch('/api/publish/newRecipe', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`  // Optional but recommended
    },
    body: JSON.stringify(recipeData)
});

const { jobId, status, message } = await response.json();
console.log(`Job started: ${jobId}`);
```

### Step 2: Connect to Job Status Stream

```javascript
const eventSource = new EventSource(`/api/publish-status/${jobId}/stream`);

eventSource.addEventListener('publishProgress', (e) => {
    const data = JSON.parse(e.data);
    console.log(`${data.status}: ${data.progress}% - ${data.message}`);
    
    // UI Updates based on status:
    if (data.status === 'processing') {
        // Show: "Creating ingredients..." with progress bar
        updateProgressBar(data.progress, data.message);
    } else if (data.status === 'resolving') {
        // Show: "Waiting for ingredients to resolve..."
        updateProgressBar(data.progress, 'Finalizing recipe...');
    }
});

eventSource.addEventListener('recipeCompleted', (e) => {
    const data = JSON.parse(e.data);
    console.log('Recipe completed:', data.did);
    
    if (data.partialResolution) {
        // Warning: Some ingredients may not be fully resolved
        showWarning('Recipe published, but some ingredients are still processing');
    } else {
        // Success: Everything is fully resolved
        showSuccess('Recipe published successfully!');
    }
    
    // Navigate to recipe page
    window.location.href = `/recipe/${data.did}`;
    
    eventSource.close();
});

eventSource.addEventListener('error', (e) => {
    const data = JSON.parse(e.data);
    console.error('Publishing failed:', data.message);
    showError(data.message);
    eventSource.close();
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    eventSource.close();
});
```

---

## Alternative: Manual Polling (Old Method)

If you prefer manual polling instead of SSE:

```javascript
async function pollJobStatus(jobId, token) {
    const maxAttempts = 120; // 10 minutes
    let attempts = 0;
    
    while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second intervals
        attempts++;
        
        const response = await fetch(`/api/publish-status/${jobId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const status = await response.json();
        console.log(`Attempt ${attempts}: ${status.progress}% - ${status.message}`);
        
        // Update UI
        updateProgressBar(status.progress, status.message);
        
        if (status.status === 'completed') {
            // Recipe published, but need to wait for ingredient resolution
            await waitForIngredientResolution(status.transactionId, token);
            return status;
        } else if (status.status === 'failed') {
            throw new Error(status.error || 'Publishing failed');
        }
    }
    
    throw new Error('Polling timeout');
}

async function waitForIngredientResolution(did, token) {
    const maxAttempts = 30; // 2.5 minutes
    let attempts = 0;
    
    while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        attempts++;
        
        const response = await fetch(
            `/api/records?did=${encodeURIComponent(did)}&resolveDepth=1&resolveNamesOnly=true&limit=1`,
            {
                headers: { 'Authorization': `Bearer ${token}` }
            }
        );
        
        const data = await response.json();
        
        if (data.records && data.records.length > 0) {
            const recipe = data.records[0];
            const ingredients = recipe.data?.recipe?.ingredient || [];
            
            // Check if all ingredients are resolved
            const allResolved = ingredients.every(ing => 
                typeof ing === 'string' && !ing.startsWith('did:')
            );
            
            if (allResolved && ingredients.length > 0) {
                console.log('All ingredients resolved!');
                return recipe;
            } else {
                const resolvedCount = ingredients.filter(i => 
                    typeof i === 'string' && !i.startsWith('did:')
                ).length;
                console.log(`Waiting... ${resolvedCount}/${ingredients.length} resolved`);
            }
        }
    }
    
    console.warn('Resolution timeout - ingredients may still be resolving');
}
```

---

## Comparison: Scrape vs Publish

| Feature | `/api/scrape/recipe` | `/api/publish/newRecipe` |
|---------|---------------------|-------------------------|
| **Input** | URL only | Full recipe data |
| **AI Extraction** | ✅ Yes (auto-extracts from webpage) | ❌ No |
| **Title Cleaning** | ✅ Yes (removes clickbait) | ❌ Manual |
| **Stream ID** | `scrapeId` | `jobId` |
| **Stream Endpoint** | `/api/scrape/open-stream?streamId={id}` | `/api/publish-status/{id}/stream` |
| **Existing Recipe Check** | ✅ Auto-detects duplicates | ❌ Manual check needed |
| **Ingredient Resolution** | ✅ Waits for full resolution | ✅ Waits for full resolution |
| **Authentication** | Optional | Optional (legacy) |

---

## Complete Frontend Example (React/Vue)

```javascript
class RecipePublisher {
    constructor(apiBaseUrl = '', authToken = null) {
        this.apiBaseUrl = apiBaseUrl;
        this.authToken = authToken;
    }
    
    // Method 1: Scrape from URL
    async scrapeRecipe(url, onProgress, onComplete, onError) {
        try {
            // Step 1: Initiate scrape
            const response = await fetch(`${this.apiBaseUrl}/api/scrape/recipe`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.authToken && { 'Authorization': `Bearer ${this.authToken}` })
                },
                body: JSON.stringify({
                    url: url,
                    userId: 'user123', // Get from your auth system
                    blockchain: 'arweave'
                })
            });
            
            const { scrapeId } = await response.json();
            
            // Step 2: Connect to stream
            const eventSource = new EventSource(
                `${this.apiBaseUrl}/api/scrape/open-stream?streamId=${scrapeId}`
            );
            
            eventSource.addEventListener('publishProgress', (e) => {
                const data = JSON.parse(e.data);
                onProgress(data.progress, data.message);
            });
            
            eventSource.addEventListener('recipeCompleted', (e) => {
                const data = JSON.parse(e.data);
                eventSource.close();
                onComplete(data);
            });
            
            eventSource.addEventListener('error', (e) => {
                const data = JSON.parse(e.data);
                eventSource.close();
                onError(data.message);
            });
            
            return eventSource; // Return so caller can close if needed
            
        } catch (error) {
            onError(error.message);
        }
    }
    
    // Method 2: Publish pre-formatted recipe
    async publishRecipe(recipeData, onProgress, onComplete, onError) {
        try {
            // Step 1: Initiate publishing
            const response = await fetch(`${this.apiBaseUrl}/api/publish/newRecipe`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.authToken && { 'Authorization': `Bearer ${this.authToken}` })
                },
                body: JSON.stringify(recipeData)
            });
            
            const { jobId } = await response.json();
            
            // Step 2: Connect to job status stream
            const eventSource = new EventSource(
                `${this.apiBaseUrl}/api/publish-status/${jobId}/stream`
            );
            
            eventSource.addEventListener('publishProgress', (e) => {
                const data = JSON.parse(e.data);
                onProgress(data.progress, data.message);
            });
            
            eventSource.addEventListener('recipeCompleted', (e) => {
                const data = JSON.parse(e.data);
                eventSource.close();
                onComplete(data);
            });
            
            eventSource.addEventListener('error', (e) => {
                const data = JSON.parse(e.data);
                eventSource.close();
                onError(data.message);
            });
            
            return eventSource;
            
        } catch (error) {
            onError(error.message);
        }
    }
}

// Usage Example
const publisher = new RecipePublisher('https://api.oip.onl', userToken);

// Scrape from URL
publisher.scrapeRecipe(
    'https://www.simplyrecipes.com/recipe-url',
    (progress, message) => {
        console.log(`${progress}%: ${message}`);
        document.getElementById('progress').value = progress;
        document.getElementById('status').textContent = message;
    },
    (result) => {
        console.log('Success!', result.did);
        alert(`Recipe published: ${result.did}`);
        window.location.href = `/recipe/${result.did}`;
    },
    (error) => {
        console.error('Failed:', error);
        alert(`Error: ${error}`);
    }
);

// Or publish formatted data
publisher.publishRecipe(
    myRecipeData,
    (progress, message) => {
        updateUI(progress, message);
    },
    (result) => {
        showSuccess(result.did);
    },
    (error) => {
        showError(error);
    }
);
```

---

## Event Types Reference

### All Methods Receive These Events:

#### `publishProgress`
```json
{
    "jobId": "job_abc123",
    "status": "processing|resolving",
    "progress": 45,
    "message": "Creating ingredient 3 of 10...",
    "transactionId": "did:arweave:..." // (optional, available after blockchain publish)
}
```

**Status Values:**
- `processing` - Publishing recipe and creating ingredients (0-80%)
- `resolving` - Waiting for ingredients to resolve (80-99%)

#### `recipeCompleted`
```json
{
    "jobId": "job_abc123",
    "status": "completed|exists",
    "progress": 100,
    "message": "Recipe published and fully resolved",
    "transactionId": "did:arweave:abc123...",
    "did": "did:arweave:abc123...",
    "blockchain": "arweave",
    "recordToIndex": { /* full recipe with resolved ingredients */ },
    "alreadyExists": true, // (only for scrape endpoint when recipe exists)
    "partialResolution": true // (only if timeout, some ingredients may not be resolved)
}
```

**Status Values:**
- `completed` - New recipe published successfully
- `exists` - Recipe already exists (scrape endpoint only)

#### `error`
```json
{
    "message": "Recipe publishing failed",
    "details": "Error details here",
    "jobId": "job_abc123"
}
```

---

## Progress Bar UI Example

```html
<div class="recipe-publish-progress">
    <h3 id="status-title">Publishing Recipe...</h3>
    <div class="progress-bar-container">
        <div class="progress-bar" id="progress-bar" style="width: 0%"></div>
    </div>
    <p id="status-message">Initializing...</p>
    <p id="status-details"></p>
</div>

<style>
.progress-bar-container {
    width: 100%;
    height: 30px;
    background: #e0e0e0;
    border-radius: 15px;
    overflow: hidden;
}

.progress-bar {
    height: 100%;
    background: linear-gradient(90deg, #4CAF50, #45a049);
    transition: width 0.3s ease;
}
</style>

<script>
function updateProgress(progress, message) {
    const bar = document.getElementById('progress-bar');
    const statusMsg = document.getElementById('status-message');
    
    bar.style.width = `${progress}%`;
    statusMsg.textContent = message;
    
    // Color coding
    if (progress < 50) {
        bar.style.background = 'linear-gradient(90deg, #2196F3, #1976D2)'; // Blue
    } else if (progress < 90) {
        bar.style.background = 'linear-gradient(90deg, #FF9800, #F57C00)'; // Orange
    } else {
        bar.style.background = 'linear-gradient(90deg, #4CAF50, #45a049)'; // Green
    }
}

function showCompletion(data) {
    const title = document.getElementById('status-title');
    const details = document.getElementById('status-details');
    
    if (data.alreadyExists) {
        title.textContent = 'Recipe Already Exists!';
        details.innerHTML = `Found in database: <a href="/recipe/${data.did}">${data.did}</a>`;
    } else if (data.partialResolution) {
        title.textContent = 'Recipe Published (Processing)';
        details.innerHTML = `Some ingredients may still be loading: <a href="/recipe/${data.did}">${data.did}</a>`;
    } else {
        title.textContent = 'Recipe Published Successfully!';
        details.innerHTML = `View your recipe: <a href="/recipe/${data.did}">${data.did}</a>`;
    }
}
</script>
```

---

## Key Differences Between Methods

### `/api/scrape/recipe`
- **Input**: Just a URL
- **AI Processing**: Automatically extracts and cleans recipe data
- **Title Cleaning**: Removes clickbait phrases (e.g., "Make This..." → "Simple Salad")
- **Duplicate Detection**: Auto-checks if recipe URL already exists
- **Stream ID**: `scrapeId` (hash of URL + userId)
- **Stream Endpoint**: `/api/scrape/open-stream?streamId={scrapeId}`

### `/api/publish/newRecipe`
- **Input**: Complete recipe data object
- **AI Processing**: None (uses data as provided)
- **Title Cleaning**: None (use what you provide)
- **Duplicate Detection**: None (publishes as new)
- **Stream ID**: `jobId` (unique job identifier)
- **Stream Endpoint**: `/api/publish-status/{jobId}/stream`

---

## Resolution Tracking Details

Both methods now wait for **full ingredient resolution** before sending `recipeCompleted`:

### What Gets Checked
```javascript
// Example ingredient array before resolution:
[
  "did:arweave:abc123",  // ❌ Still a DID reference
  "did:arweave:def456",  // ❌ Still a DID reference
  "olive oil"            // ✅ Resolved to name
]

// After resolution:
[
  "chicken breast",      // ✅ All resolved to names
  "garlic",              // ✅
  "olive oil"            // ✅
]
```

### Resolution Progress
- Checks every **5 seconds**
- Maximum **60 attempts** (5 minutes)
- Logs resolution count: `"7/10 ingredients resolved"`
- Only sends `recipeCompleted` when **all ingredients are resolved**

### Timeout Behavior
If resolution takes too long:
- Sends `recipeCompleted` with `partialResolution: true`
- Message: "Recipe published (ingredients may still be resolving)"
- Frontend can show warning and recipe is still usable

---

## Best Practices

1. **Always close EventSource** when done to avoid memory leaks
2. **Handle partialResolution flag** - show appropriate messaging
3. **Show progress updates** - keeps users engaged during long operations
4. **Provide feedback** for all status changes
5. **Handle network errors** - EventSource may disconnect
6. **Use timeouts** - Don't wait forever if connection fails

---

## Troubleshooting

### EventSource not receiving events
- Check CORS configuration
- Verify SSE headers are set correctly
- Check browser console for connection errors

### Progress stuck at 90%
- Ingredients are still resolving
- Wait up to 2.5 minutes
- Will eventually complete with `partialResolution: true` if needed

### Job not found
- JobId may have expired (jobs cleaned up after 1 hour)
- Check that jobId is being passed correctly
- Verify API endpoint is reachable

---

## Summary

**For scraping recipes from URLs**: Use `/api/scrape/recipe` → stream via `/api/scrape/open-stream`

**For publishing pre-formatted recipes**: Use `/api/publish/newRecipe` → stream via `/api/publish-status/{jobId}/stream`

Both methods now support:
- ✅ Real-time progress tracking
- ✅ Ingredient resolution verification
- ✅ Duplicate detection (scrape only)
- ✅ Clean, noun-based recipe titles (scrape only)
- ✅ Full error handling

