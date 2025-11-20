Based on my analysis of the recipe scraping workflow in `scrape.js`, here's the comprehensive breakdown:

---

## Recipe Scraping Workflow in `scrape.js`

### **Entry Point: `/scrape/recipe` Endpoint** (lines 2791-2865)

**Required Input:**
```javascript
POST /scrape/recipe
{
  url: "https://example.com/recipe",      // Required
  userId: "user123",                       // Required
  html: "<html>...</html>",               // Optional - fetched if not provided
  screenshots: [...],                     // Optional - generated if not provided
  totalHeight: 1200,                      // Optional - calculated if not provided
  blockchain: "arweave"                   // Optional - defaults to 'arweave'
}
```

**Immediate Response:**
- Returns `{ scrapeId, blockchain }` immediately
- `scrapeId` = SHA-256 hash of `url + userId`
- Initializes SSE (Server-Sent Events) stream for real-time updates

---

### **Main Processing Function: `fetchParsedRecipeData()`** (lines 1572-2353)

#### **Phase 1: Check for Existing Recipe** (lines 1762-1777)

1. **Database Search:**
   ```javascript
   queryParams = {
     resolveDepth: 1,
     url: url,
     sortBy: 'inArweaveBlock:desc',
     limit: 1
   }
   ```
   - Searches for existing recipe with same URL
   - If found → returns existing recipe data
   - **Stops processing**, doesn't re-publish

2. **If NOT Found → Proceeds to scraping**

---

#### **Phase 2: Fetch HTML** (lines 1783-1803)

**If HTML not provided:**
- Calls FireCrawl API:
  ```javascript
  POST https://api.firecrawl.dev/v1/scrape
  {
    url: url,
    formats: ['html']
  }
  ```
- Requires `FIRECRAWL` environment variable (API key)
- Returns: `{ success: true, data: { html, metadata } }`

---

#### **Phase 3: Site-Specific Selector Configuration** (lines 1591-1631)

**Selector Sets Defined For:**

1. **Default** (generic recipe sites):
   - Title: `['h1.entry-title', 'h1.recipe-title']`
   - Ingredients: `['[class*="ingredient-group"]']`
   - Instructions: `['.wprm-recipe-instruction']`
   - Servings: `['[data-servings]', '[class*="wprm-recipe-servings"]']`
   - Times: `['.wprm-recipe-prep_time']`, etc.

2. **`themediterraneandish.com`**: Custom selectors

3. **`wholelifestylenutrition.com`**: 
   - Uses `.tasty-recipes-*` class names
   - Different structure for ingredients and instructions

**Domain Detection:**
```javascript
const domain = new URL(url).hostname;
const siteSelectors = selectors[domain] || selectors.default;
```

---

#### **Phase 4: Parse Recipe Structure** (lines 1650-1853)

**1. Extract Metadata:**
```javascript
title = extractText($, siteSelectors.title)
description = extractText($, siteSelectors.description)
imageUrl = extractText($, siteSelectors.imageUrl)
servings = parseInt(...)
prepTime = parseInt(...) || null
cookTime = parseInt(...) || null
totalTime = parseInt(...) || null
cuisine = extractText($, siteSelectors.cuisine) || null
course = extractText($, siteSelectors.course) || null
```

**2. Parse Ingredient Sections** (lines 1679-1842):
- Looks for multiple ingredient groups
- For each section:
  - Extracts section name
  - Parses ingredients with amount, unit, name
  - Structure: `[{ amount, unit, name }, ...]`
- Identifies **primary ingredient section** (most ingredients)
- Sorts remaining sections by ingredient count

**3. Parse Instructions** (lines 1945-1950):
- Finds all instruction elements
- Extracts text, normalizes whitespace
- Returns array of instruction strings

**Example Output:**
```javascript
{
  section: "Main Ingredients",
  ingredients: [
    { amount: 2, unit: "cups", name: "flour" },
    { amount: 1, unit: "tsp", name: "salt" }
  ]
}
```

---

#### **Phase 5: AI Fallback for Missing Data** (line 1740)

**If title or ingredients missing:**
```javascript
const extractedRecipeData = await analyzeImageForRecipe(screenshotURL);
```
- Uses `xAI` (Grok) vision model
- Analyzes screenshot to extract recipe info
- **Not implemented in detail** - just called but result not used

---

#### **Phase 6: Ingredient Processing** (lines 1952-2093)

**1. Normalize Ingredient Names:**
```javascript
const ingredientNames = primaryIngredientSection.ingredients.map(ing => 
  ing.name.trim().toLowerCase().replace(/,$/, '')
);
```

**2. Database Lookup - `fetchIngredientRecordData()`** (lines 1990-2031):
- Searches for ALL ingredients in one call:
  ```javascript
  queryParams = {
    recordType: 'nutritionalInfo',
    search: ingredientNames.join(','),  // "chicken,olive oil,garlic"
    limit: 50
  }
  ```
- Populates `recordMap` with results
- For each ingredient:
  - Calls `findBestMatch(name)`
  - Checks synonym map
  - Checks direct match
  - Scores partial matches by term overlap
  - Returns best match or `null`

**3. Synonym Map** (lines 1962-1986):
```javascript
{
  "garlic cloves": "minced garlic",
  "olive oil": "extra virgin olive oil",
  "green onions": "scallions",
  "cilantro": "fresh cilantro"
  // etc.
}
```

**4. Best Match Scoring** (lines 2044-2093):
- Splits ingredient into search terms
- Checks synonym map first
- Checks direct match in `recordMap`
- Scores based on term matches
- Sorts by match count descending

**5. Handle Missing Ingredients** (lines 2098-2134):
- For ingredients with `null` DID:
  - Calls `createNewNutritionalInfoRecord(name, blockchain)`
  - **Creates new nutritionalInfo records**
  - **Recursive restart**: Calls `fetchParsedRecipeData()` again
  - Second pass will find the newly created records

---

#### **Phase 7: Build Recipe Data Structure** (lines 2276-2304)

```javascript
const recipeData = {
  basic: {
    name: metadata.ogTitle || metadata.title,
    language: "En",
    date: Math.floor(new Date(metadata.publishedTime).getTime() / 1000),
    description: description,
    webUrl: url,
    nsfw: false
  },
  recipe: {
    prep_time_mins: prepTime,
    cook_time_mins: cookTime,
    total_time_mins: totalTime,
    servings: servings,
    ingredient_amount: ingredientAmounts,
    ingredient_unit: ingredientUnits,
    ingredient: ingredientDRefs,  // Array of DIDs
    instructions: instructions,   // Array of strings
    notes: notes,
    cuisine: cuisine,
    course: course,
    author: metadata.author
  },
  image: {
    webUrl: imageUrl
  }
}
```

---

#### **Phase 8: Publish Recipe** (line 2341)

```javascript
recipeRecord = await publishNewRecord(
  recipeData, 
  "recipe", 
  false,  // publishFiles
  false,  // addMediaToArweave
  false,  // addMediaToIPFS
  null,   // youtubeUrl
  blockchain
);
```

**What This Does:**
- Calls `publishNewRecord()` from `templateHelper.js`
- Publishes to Arweave or GUN
- Returns `{ transactionId, recordToIndex }`

**Then:**
- Logs success
- Calls `cleanupScrape(scrapeId)` to close stream

---

### **Deprecated Function: `createNewNutritionalInfoRecord()`** (lines 1262-1368)

**This version uses FireCrawl scraping** (now replaced by OpenAI):

**Old Process:**
1. Format ingredient name: `"chicken breast"` → `"chicken-breast"`
2. Build Nutritionix URL: `https://www.nutritionix.com/food/chicken-breast`
3. Scrape with FireCrawl API
4. Parse HTML with Cheerio:
   - Extract name from `h1.food-item-name`
   - Parse nutrition table `.nf-line` elements
   - Extract serving size from `.nf-serving-unit-name`
5. Build nutritionalInfo record structure
6. Publish to Arweave/GUN
7. Return published record

**Fields Extracted:**
- calories, protein_g, fat_g, carbohydrates_g, cholesterol_mg, sodium_mg
- standard_amount, standard_unit

---

## Complete Workflow Summary

### **Input Requirements:**
- `url` - Recipe website URL ✅ **Required**
- `userId` - User identifier ✅ **Required**
- `html` - Page HTML ⚠️ Optional (fetched via FireCrawl if missing)
- `screenshots` - Page screenshots ⚠️ Optional (not used in this version)
- `totalHeight` - Screenshot height ⚠️ Optional (not used)
- `blockchain` - Storage type ⚠️ Optional (defaults to 'arweave')

### **Processing Steps:**

1. ✅ **Check Existing** → Search database by URL
2. ✅ **Fetch HTML** → FireCrawl API if not provided
3. ✅ **Detect Site** → Match domain to selector set
4. ✅ **Parse Structure** → Extract title, ingredients, instructions, times
5. ✅ **Lookup Ingredients** → Search for existing nutritionalInfo records
6. ✅ **Score Matches** → Use synonym map and term matching
7. ✅ **Create Missing** → Call OpenAI (now) or FireCrawl (old) for new ingredients
8. ⚠️ **Recursive Retry** → Re-run after creating missing ingredients
9. ✅ **Build Recipe** → Assemble complete recipe data structure
10. ✅ **Publish** → Call `publishNewRecord()` with complete data
11. ✅ **Cleanup** → Close SSE stream

### **Publishing Behavior:**

**New Ingredients Created:**
- Each missing ingredient → new `nutritionalInfo` record published
- Uses current OpenAI helper (`fetchNutritionalData()`)
- Published to specified blockchain (Arweave/GUN)

**Recipe Published:**
- Single `recipe` record with all DID references
- Includes nutritional summary (calculated in `/publish/newRecipe` endpoint)
- Published to specified blockchain

**No Nutritional Summary Here:**
- Scrape.js doesn't calculate nutritional summary
- That happens in `/publish/newRecipe` endpoint
- Nutritional summary added during final publish step

---

## Key Differences from `/publish/newRecipe`:

| Feature | scrape.js | publish.js |
|---------|-----------|------------|
| **Input** | URL + userId | Complete recipe object |
| **HTML Parsing** | ✅ Yes (Cheerio) | ❌ No |
| **Site Detection** | ✅ Yes (domain-specific selectors) | ❌ No |
| **Ingredient Lookup** | ✅ Yes (search ALL at once) | ✅ Yes (search individually) |
| **Missing Ingredients** | ✅ Creates + **Recursive retry** | ✅ Creates (no retry) |
| **Nutritional Summary** | ❌ No | ✅ Yes |
| **Publishing** | ✅ Yes (basic recipe) | ✅ Yes (complete recipe) |
| **DID Handling** | ❌ Only names | ✅ Names + DIDs + Objects |

The scrape.js workflow is **simpler** - it always starts with ingredient names (never DIDs), looks them up, creates missing ones, and publishes a basic recipe structure without nutritional summary.