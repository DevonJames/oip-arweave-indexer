# Recipe Scraping SSE Stream - Frontend Integration Guide

## Overview

The `/api/scrape/recipe` endpoint uses **Server-Sent Events (SSE)** to provide real-time updates throughout the recipe scraping and publishing process. This guide provides everything a frontend developer needs to integrate with the SSE stream.

## Quick Start

### 1. Submit Recipe URL

```javascript
const response = await fetch('/api/scrape/recipe', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${yourAuthToken}` // Optional
  },
  body: JSON.stringify({
    url: 'https://example.com/recipe',
    userId: 'user123',
    blockchain: 'arweave'  // Optional, defaults to 'arweave'
  })
});

const { scrapeId, blockchain } = await response.json();
console.log('Scrape initiated:', scrapeId);
```

### 2. Connect to SSE Stream

```javascript
const eventSource = new EventSource(
  `/api/scrape/open-stream?streamId=${scrapeId}`
);

// Listen for events
eventSource.addEventListener('scrapeId', handleScrapeId);
eventSource.addEventListener('processing', handleProcessing);
eventSource.addEventListener('recipePublished', handleRecipePublished);
eventSource.addEventListener('publishProgress', handlePublishProgress);
eventSource.addEventListener('recipeCompleted', handleRecipeCompleted);
eventSource.addEventListener('error', handleError);

// Close connection when done
eventSource.addEventListener('recipeCompleted', () => {
  eventSource.close();
});
```

## SSE Event Types

The stream sends 6 different event types during the scraping and publishing process:

### 1. `scrapeId` - Scraping Initiated

**When:** Immediately after scraping begins
**Purpose:** Confirms the scrape has started

```javascript
event: scrapeId
data: {
  "scrapeId": "abc123def456..."
}
```

**Example Handler:**
```javascript
function handleScrapeId(event) {
  const data = JSON.parse(event.data);
  console.log('Scrape started:', data.scrapeId);
  updateUI('Scraping recipe page...');
}
```

---

### 2. `processing` - Scraping in Progress

**When:** During HTML fetching (only if HTML not provided) and parsing
**Purpose:** Indicates what stage of scraping is happening

```javascript
event: processing
data: {
  "message": "Fetching recipe page..."
}
```

**Example Handler:**
```javascript
function handleProcessing(event) {
  const data = JSON.parse(event.data);
  updateStatusMessage(data.message);
}
```

---

### 3. `recipePublished` - Publishing Job Started

**When:** After recipe is parsed and sent to publishing endpoint
**Purpose:** Provides the parsed recipe data and initial job info

```javascript
event: recipePublished
data: {
  "jobId": "recipe_publish_abc123def456",
  "status": "pending",
  "message": "Recipe publishing initiated. This may take a few minutes...",
  "progress": 0,
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
      "instructions": "Cook rice noodles...",
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

**Example Handler:**
```javascript
function handleRecipePublished(event) {
  const data = JSON.parse(event.data);
  
  console.log('Publishing job started:', data.jobId);
  console.log('Recipe data:', data.recipeData);
  
  // Display recipe preview to user immediately
  displayRecipePreview(data.recipeData);
  
  // Show publishing status
  updatePublishStatus({
    status: 'Publishing to blockchain...',
    progress: 0
  });
}
```

---

### 4. `publishProgress` - Publishing in Progress

**When:** Every 5 seconds while job is processing
**Purpose:** Real-time progress updates during ingredient creation and publishing

```javascript
event: publishProgress
data: {
  "jobId": "recipe_publish_abc123def456",
  "status": "processing",
  "progress": 45,
  "message": "Creating ingredient 3 of 12: chicken breast...",
  "transactionId": null
}
```

**Progress Stages:**
- `0-30%` - Looking up ingredients in database
- `30-70%` - Creating missing ingredients with nutritional info
- `70-90%` - Calculating nutritional summary
- `90-100%` - Publishing to blockchain

**Example Handler:**
```javascript
function handlePublishProgress(event) {
  const data = JSON.parse(event.data);
  
  updateProgressBar(data.progress);
  updateStatusMessage(data.message);
  
  console.log(`Progress: ${data.progress}% - ${data.message}`);
}
```

---

### 5. `recipeCompleted` - Publishing Complete

**When:** Job has successfully completed
**Purpose:** Provides final transaction ID and complete record

```javascript
event: recipeCompleted
data: {
  "jobId": "recipe_publish_abc123def456",
  "status": "completed",
  "progress": 100,
  "message": "Recipe published successfully",
  "transactionId": "h5FTJ2oFoA7xp4H7t7YI...",
  "did": "h5FTJ2oFoA7xp4H7t7YI...",
  "blockchain": "arweave",
  "recordToIndex": {
    "oip": {
      "did": "h5FTJ2oFoA7xp4H7t7YI...",
      "templateName": "recipe"
    },
    "data": {
      "basic": { /* ... */ },
      "recipe": { /* ... */ },
      "nutritionalInfo": {
        "calories": 450,
        "protein": 25,
        "carbs": 55,
        "fat": 12
      }
    }
  }
}
```

**Example Handler:**
```javascript
function handleRecipeCompleted(event) {
  const data = JSON.parse(event.data);
  
  console.log('Recipe published!');
  console.log('Transaction ID:', data.transactionId);
  console.log('Complete record:', data.recordToIndex);
  
  // Show success message
  showSuccessNotification('Recipe published successfully!');
  
  // Display final recipe with DID
  displayPublishedRecipe(data.recordToIndex, data.transactionId);
  
  // Close the SSE connection
  eventSource.close();
  
  // Optionally redirect to recipe page
  window.location.href = `/recipes/${data.transactionId}`;
}
```

---

### 6. `error` - Error Occurred

**When:** At any point if an error occurs
**Purpose:** Provides error details for user feedback

```javascript
event: error
data: {
  "message": "Failed to publish recipe",
  "details": "Network timeout",
  "jobId": "recipe_publish_abc123def456"
}
```

**Example Handler:**
```javascript
function handleError(event) {
  const data = JSON.parse(event.data);
  
  console.error('Error:', data.message, data.details);
  
  showErrorNotification(
    `Failed to process recipe: ${data.message}`
  );
  
  // Close connection
  eventSource.close();
}
```

## Complete React Example

```javascript
import React, { useState, useEffect, useRef } from 'react';

function RecipeScraper() {
  const [recipeUrl, setRecipeUrl] = useState('');
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [recipeData, setRecipeData] = useState(null);
  const [publishedRecipe, setPublishedRecipe] = useState(null);
  const [error, setError] = useState(null);
  const eventSourceRef = useRef(null);

  const scrapeRecipe = async () => {
    try {
      setStatus('Initiating scrape...');
      setError(null);
      setProgress(0);
      
      // Step 1: Submit recipe URL
      const response = await fetch('/api/scrape/recipe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          url: recipeUrl,
          userId: localStorage.getItem('userId'),
          blockchain: 'arweave'
        })
      });

      if (!response.ok) {
        throw new Error('Failed to initiate scrape');
      }

      const { scrapeId } = await response.json();
      console.log('Scrape ID:', scrapeId);

      // Step 2: Connect to SSE stream
      const eventSource = new EventSource(
        `/api/scrape/open-stream?streamId=${scrapeId}`
      );
      eventSourceRef.current = eventSource;

      // Listen for events
      eventSource.addEventListener('scrapeId', (e) => {
        const data = JSON.parse(e.data);
        console.log('Scrape started:', data.scrapeId);
        setStatus('Scraping recipe page...');
      });

      eventSource.addEventListener('processing', (e) => {
        const data = JSON.parse(e.data);
        setStatus(data.message);
      });

      eventSource.addEventListener('recipePublished', (e) => {
        const data = JSON.parse(e.data);
        console.log('Recipe data:', data.recipeData);
        setRecipeData(data.recipeData);
        setStatus('Publishing to blockchain...');
        setProgress(data.progress || 0);
      });

      eventSource.addEventListener('publishProgress', (e) => {
        const data = JSON.parse(e.data);
        setStatus(data.message);
        setProgress(data.progress);
      });

      eventSource.addEventListener('recipeCompleted', (e) => {
        const data = JSON.parse(e.data);
        console.log('Recipe completed:', data);
        setPublishedRecipe(data.recordToIndex);
        setStatus('Recipe published successfully!');
        setProgress(100);
        eventSource.close();
      });

      eventSource.addEventListener('error', (e) => {
        const data = JSON.parse(e.data);
        console.error('Error:', data);
        setError(data.message);
        setStatus('Error occurred');
        eventSource.close();
      });

      eventSource.onerror = (err) => {
        console.error('EventSource error:', err);
        setError('Connection to server lost');
        eventSource.close();
      };

    } catch (err) {
      console.error('Error:', err);
      setError(err.message);
      setStatus('Failed to start scrape');
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  return (
    <div className="recipe-scraper">
      <h2>Scrape Recipe</h2>
      
      <div className="input-group">
        <input
          type="url"
          value={recipeUrl}
          onChange={(e) => setRecipeUrl(e.target.value)}
          placeholder="Enter recipe URL..."
          disabled={status && !error && !publishedRecipe}
        />
        <button 
          onClick={scrapeRecipe}
          disabled={!recipeUrl || (status && !error && !publishedRecipe)}
        >
          Scrape Recipe
        </button>
      </div>

      {status && (
        <div className="status">
          <p>{status}</p>
          {progress > 0 && (
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{ width: `${progress}%` }}
              />
              <span>{progress}%</span>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="error">
          <p>Error: {error}</p>
        </div>
      )}

      {recipeData && !publishedRecipe && (
        <div className="recipe-preview">
          <h3>Recipe Preview</h3>
          <h4>{recipeData.basic.name}</h4>
          <p>{recipeData.basic.description}</p>
          {recipeData.image && (
            <img src={recipeData.image.webUrl} alt={recipeData.basic.name} />
          )}
          <p className="publishing-note">Publishing to blockchain...</p>
        </div>
      )}

      {publishedRecipe && (
        <div className="recipe-published">
          <h3>✓ Recipe Published Successfully!</h3>
          <p><strong>Transaction ID:</strong> {publishedRecipe.oip.did}</p>
          <p><strong>Recipe:</strong> {publishedRecipe.data.basic.name}</p>
          <button onClick={() => window.location.href = `/recipes/${publishedRecipe.oip.did}`}>
            View Recipe
          </button>
        </div>
      )}
    </div>
  );
}

export default RecipeScraper;
```

## Complete Vue 3 Example

```vue
<template>
  <div class="recipe-scraper">
    <h2>Scrape Recipe</h2>
    
    <div class="input-group">
      <input
        v-model="recipeUrl"
        type="url"
        placeholder="Enter recipe URL..."
        :disabled="isProcessing"
      />
      <button 
        @click="scrapeRecipe"
        :disabled="!recipeUrl || isProcessing"
      >
        Scrape Recipe
      </button>
    </div>

    <div v-if="status" class="status">
      <p>{{ status }}</p>
      <div v-if="progress > 0" class="progress-bar">
        <div class="progress-fill" :style="{ width: `${progress}%` }" />
        <span>{{ progress }}%</span>
      </div>
    </div>

    <div v-if="error" class="error">
      <p>Error: {{ error }}</p>
    </div>

    <div v-if="recipeData && !publishedRecipe" class="recipe-preview">
      <h3>Recipe Preview</h3>
      <h4>{{ recipeData.basic.name }}</h4>
      <p>{{ recipeData.basic.description }}</p>
      <img v-if="recipeData.image" :src="recipeData.image.webUrl" :alt="recipeData.basic.name" />
      <p class="publishing-note">Publishing to blockchain...</p>
    </div>

    <div v-if="publishedRecipe" class="recipe-published">
      <h3>✓ Recipe Published Successfully!</h3>
      <p><strong>Transaction ID:</strong> {{ publishedRecipe.oip.did }}</p>
      <p><strong>Recipe:</strong> {{ publishedRecipe.data.basic.name }}</p>
      <button @click="viewRecipe">View Recipe</button>
    </div>
  </div>
</template>

<script setup>
import { ref, onUnmounted } from 'vue';

const recipeUrl = ref('');
const status = ref('');
const progress = ref(0);
const recipeData = ref(null);
const publishedRecipe = ref(null);
const error = ref(null);
const isProcessing = ref(false);
let eventSource = null;

const scrapeRecipe = async () => {
  try {
    status.value = 'Initiating scrape...';
    error.value = null;
    progress.value = 0;
    isProcessing.value = true;
    
    const response = await fetch('/api/scrape/recipe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify({
        url: recipeUrl.value,
        userId: localStorage.getItem('userId'),
        blockchain: 'arweave'
      })
    });

    if (!response.ok) throw new Error('Failed to initiate scrape');

    const { scrapeId } = await response.json();
    
    eventSource = new EventSource(`/api/scrape/open-stream?streamId=${scrapeId}`);

    eventSource.addEventListener('scrapeId', () => {
      status.value = 'Scraping recipe page...';
    });

    eventSource.addEventListener('processing', (e) => {
      const data = JSON.parse(e.data);
      status.value = data.message;
    });

    eventSource.addEventListener('recipePublished', (e) => {
      const data = JSON.parse(e.data);
      recipeData.value = data.recipeData;
      status.value = 'Publishing to blockchain...';
      progress.value = data.progress || 0;
    });

    eventSource.addEventListener('publishProgress', (e) => {
      const data = JSON.parse(e.data);
      status.value = data.message;
      progress.value = data.progress;
    });

    eventSource.addEventListener('recipeCompleted', (e) => {
      const data = JSON.parse(e.data);
      publishedRecipe.value = data.recordToIndex;
      status.value = 'Recipe published successfully!';
      progress.value = 100;
      isProcessing.value = false;
      eventSource.close();
    });

    eventSource.addEventListener('error', (e) => {
      const data = JSON.parse(e.data);
      error.value = data.message;
      status.value = 'Error occurred';
      isProcessing.value = false;
      eventSource.close();
    });

  } catch (err) {
    error.value = err.message;
    status.value = 'Failed to start scrape';
    isProcessing.value = false;
  }
};

const viewRecipe = () => {
  window.location.href = `/recipes/${publishedRecipe.value.oip.did}`;
};

onUnmounted(() => {
  if (eventSource) {
    eventSource.close();
  }
});
</script>
```

## Vanilla JavaScript Example

```html
<!DOCTYPE html>
<html>
<head>
  <title>Recipe Scraper</title>
  <style>
    .progress-bar {
      width: 100%;
      height: 30px;
      background: #f0f0f0;
      border-radius: 5px;
      overflow: hidden;
      position: relative;
    }
    .progress-fill {
      height: 100%;
      background: #4caf50;
      transition: width 0.3s ease;
    }
    .progress-text {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
    }
  </style>
</head>
<body>
  <h2>Recipe Scraper</h2>
  
  <input type="url" id="recipeUrl" placeholder="Enter recipe URL..." />
  <button id="scrapeBtn" onclick="scrapeRecipe()">Scrape Recipe</button>
  
  <div id="status"></div>
  <div id="progressBar" style="display:none;">
    <div class="progress-bar">
      <div id="progressFill" class="progress-fill" style="width: 0%"></div>
      <span id="progressText" class="progress-text">0%</span>
    </div>
  </div>
  
  <div id="recipePreview"></div>
  <div id="result"></div>
  <div id="error"></div>

  <script>
    let eventSource = null;

    async function scrapeRecipe() {
      const url = document.getElementById('recipeUrl').value;
      if (!url) {
        alert('Please enter a recipe URL');
        return;
      }

      // Clear previous results
      document.getElementById('status').textContent = 'Initiating scrape...';
      document.getElementById('error').textContent = '';
      document.getElementById('result').textContent = '';
      document.getElementById('recipePreview').innerHTML = '';
      document.getElementById('progressBar').style.display = 'none';
      document.getElementById('scrapeBtn').disabled = true;

      try {
        // Submit scrape request
        const response = await fetch('/api/scrape/recipe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            url: url,
            userId: 'demo-user',
            blockchain: 'arweave'
          })
        });

        if (!response.ok) {
          throw new Error('Failed to initiate scrape');
        }

        const { scrapeId } = await response.json();

        // Connect to SSE stream
        eventSource = new EventSource(`/api/scrape/open-stream?streamId=${scrapeId}`);

        eventSource.addEventListener('scrapeId', (e) => {
          document.getElementById('status').textContent = 'Scraping recipe page...';
        });

        eventSource.addEventListener('processing', (e) => {
          const data = JSON.parse(e.data);
          document.getElementById('status').textContent = data.message;
        });

        eventSource.addEventListener('recipePublished', (e) => {
          const data = JSON.parse(e.data);
          
          // Show recipe preview
          const preview = `
            <h3>Recipe Preview</h3>
            <h4>${data.recipeData.basic.name}</h4>
            <p>${data.recipeData.basic.description}</p>
            <img src="${data.recipeData.image?.webUrl}" style="max-width: 300px;" />
            <p>Publishing to blockchain...</p>
          `;
          document.getElementById('recipePreview').innerHTML = preview;
          
          document.getElementById('status').textContent = 'Publishing to blockchain...';
          document.getElementById('progressBar').style.display = 'block';
        });

        eventSource.addEventListener('publishProgress', (e) => {
          const data = JSON.parse(e.data);
          document.getElementById('status').textContent = data.message;
          document.getElementById('progressFill').style.width = data.progress + '%';
          document.getElementById('progressText').textContent = data.progress + '%';
        });

        eventSource.addEventListener('recipeCompleted', (e) => {
          const data = JSON.parse(e.data);
          document.getElementById('status').textContent = 'Recipe published successfully!';
          document.getElementById('progressFill').style.width = '100%';
          document.getElementById('progressText').textContent = '100%';
          
          document.getElementById('result').innerHTML = `
            <h3>✓ Recipe Published!</h3>
            <p><strong>Transaction ID:</strong> ${data.transactionId}</p>
            <p><strong>Recipe:</strong> ${data.recordToIndex.data.basic.name}</p>
            <a href="/recipes/${data.transactionId}">View Recipe</a>
          `;
          
          document.getElementById('scrapeBtn').disabled = false;
          eventSource.close();
        });

        eventSource.addEventListener('error', (e) => {
          const data = JSON.parse(e.data);
          document.getElementById('error').textContent = 'Error: ' + data.message;
          document.getElementById('status').textContent = 'Failed';
          document.getElementById('scrapeBtn').disabled = false;
          eventSource.close();
        });

        eventSource.onerror = (err) => {
          console.error('EventSource error:', err);
          document.getElementById('error').textContent = 'Connection lost';
          document.getElementById('scrapeBtn').disabled = false;
          eventSource.close();
        };

      } catch (err) {
        document.getElementById('error').textContent = 'Error: ' + err.message;
        document.getElementById('scrapeBtn').disabled = false;
      }
    }

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
      if (eventSource) {
        eventSource.close();
      }
    });
  </script>
</body>
</html>
```

## Event Flow Timeline

```
Time    Event                    Progress    Description
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
0s      scrapeId                 -           Scrape initiated
1s      processing               -           "Fetching recipe page..." (if URL only)
5s      processing               -           "Parsing recipe..."
10s     recipePublished          0%          Job started, recipe data available
15s     publishProgress          15%         "Looking up ingredient 1 of 12..."
20s     publishProgress          30%         "Creating ingredient 3 of 12..."
25s     publishProgress          45%         "Creating ingredient 6 of 12..."
30s     publishProgress          60%         "Creating ingredient 9 of 12..."
35s     publishProgress          75%         "Calculating nutritional summary..."
40s     publishProgress          90%         "Publishing to blockchain..."
45s     recipeCompleted          100%        Published! Transaction ID available
```

## Important Notes

### Connection Management

1. **Always close the connection** when done:
   ```javascript
   eventSource.close();
   ```

2. **Handle connection errors**:
   ```javascript
   eventSource.onerror = (err) => {
     console.error('Connection error:', err);
     eventSource.close();
   };
   ```

3. **Clean up on component unmount** (React/Vue):
   ```javascript
   useEffect(() => {
     return () => {
       if (eventSource) eventSource.close();
     };
   }, []);
   ```

### Timeout and Retry

- The backend polls for **up to 10 minutes** (120 attempts × 5 seconds)
- If the job doesn't complete, you'll receive an `error` event
- Consider implementing a client-side timeout as well

### Error Handling

Always handle these error scenarios:
- Network connection lost (`eventSource.onerror`)
- Job failed (`error` event)
- Polling timeout (`error` event with "timed out" message)

### CORS Considerations

If your frontend is on a different domain, ensure CORS is properly configured on the backend.

## Testing

### Test with cURL

```bash
# 1. Start scrape
curl -X POST http://localhost:3005/api/scrape/recipe \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/recipe","userId":"test"}' \
  | jq -r '.scrapeId'

# 2. Listen to SSE stream (replace SCRAPE_ID)
curl -N http://localhost:3005/api/scrape/open-stream?streamId=SCRAPE_ID
```

### Test with Postman

1. Send POST to `/api/scrape/recipe`
2. Copy the `scrapeId` from response
3. Create new request to `/api/scrape/open-stream?streamId={scrapeId}`
4. Click "Send" and watch events stream in

## Troubleshooting

### Events not received

- Check that `scrapeId` is correct
- Verify SSE connection is open (`eventSource.readyState === 1`)
- Check browser console for CORS errors

### Connection closes immediately

- Backend might have crashed - check server logs
- ScrapId might not exist or expired
- Network issues - try again

### Progress stuck

- Check backend logs for errors
- Ingredient creation might be slow (OpenAI API)
- Consider the 10-minute timeout

## API Reference

### POST `/api/scrape/recipe`

**Request:**
```json
{
  "url": "https://example.com/recipe",
  "userId": "user123",
  "blockchain": "arweave",
  "html": "<html>...</html>",  // Optional
  "screenshots": ["base64..."],  // Optional
  "totalHeight": 5000  // Optional
}
```

**Response:**
```json
{
  "scrapeId": "abc123...",
  "blockchain": "arweave"
}
```

### GET `/api/scrape/open-stream?streamId={scrapeId}`

**Response:** Server-Sent Events stream

**Headers:**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

## Related Documentation

- [Recipe Scraping Update](./RECIPE_SCRAPING_UPDATE.md) - Backend implementation details
- [HTML Optional Guide](./RECIPE_SCRAPING_HTML_OPTIONAL.md) - Browser extension vs web app modes
- [Publish Endpoint](./publish-newRecipe-endpoint-behavior.md) - Publishing endpoint details

