# Endpoint Comparison: `/api/records/newRecord` vs `/api/publish/newRecipe`

## Overview

This document analyzes the differences between the general-purpose record publishing endpoint and the specialized recipe publishing endpoint in the OIP system.

## Key Differences

### `/api/records/newRecord` (General Purpose)

**Location**: `routes/records.js` lines 116-167

**Characteristics**:
- **Purpose**: General-purpose endpoint for ANY record type
- **Record Type**: Specified via query parameter `?recordType=<type>`
- **Processing**: Minimal - passes directly to `publishNewRecord()`
- **DID Field**: Uses `oip.did` (✅ CORRECT - new standard)
- **Storage**: Supports both Arweave (`blockchain=arweave`) and GUN (`storage=gun`)
- **Ingredient Handling**: None - raw data pass-through
- **Authentication**: Required via `authenticateToken` middleware
- **Elasticsearch Indexing**: Standard indexing with proper DID handling

**Usage Pattern**:
```javascript
POST /api/records/newRecord?recordType=recipe&storage=gun
Body: {
  basic: { name, description, date, ... },
  recipe: {
    ingredient: ["did:arweave:xyz", "did:arweave:abc"],
    ingredient_comment: ["chopped", "diced"],
    ingredient_amount: [2, 1],
    ingredient_unit: ["cups", "whole"],
    instructions: ["Step 1", "Step 2"],
    ...
  },
  accessControl: { ... }
}
```

**Response**:
```javascript
{
  did: "did:gun:...",          // ✅ Correct field name
  soul: "...",
  storage: "gun",
  encrypted: true
}
```

---

### `/api/publish/newRecipe` (Specialized)

**Location**: `routes/publish.js` lines 524-1283

**Characteristics**:
- **Purpose**: Specialized endpoint ONLY for recipes with intelligent ingredient handling
- **Record Type**: Hardcoded to `recipe`
- **Processing**: Extensive ingredient intelligence:
  - Parses ingredient strings into components
  - Searches for existing `nutritionalInfo` records
  - Creates new `nutritionalInfo` records if not found (via `createNewNutritionalInfoRecord`)
  - Uses `nutritional-helper.js` to fetch nutritional data from Nutritionix API
  - Implements fuzzy matching with scoring algorithms
  - Handles ingredient synonyms
  - Builds parallel arrays for ingredient, amount, unit, comment
- **DID Field**: Uses `oip.didTx` (❌ WRONG - legacy field, should use `oip.did`)
- **Storage**: Defaults to Arweave
- **Ingredient Handling**: Advanced - automatic lookup and creation
- **Authentication**: Not required (no middleware)
- **Elasticsearch Indexing**: Uses legacy `didTx` field which may cause issues with newer queries

**Ingredient Processing Features**:
1. **Existing Record Lookup**: 
   ```javascript
   const recordsInDB = await getRecords({
     recordType: 'nutritionalInfo',
     search: searchTerm,
     sortBy: 'inArweaveBlock:desc',
     limit: 20
   });
   ```

2. **Fuzzy Matching Algorithm**:
   - Calculates match scores based on term overlap
   - Identifies core terms vs descriptor terms
   - Handles synonyms (e.g., "olive oil" → "extra virgin olive oil")
   - Minimum threshold varies by ingredient complexity

3. **Auto-Creation of Missing Ingredients**:
   ```javascript
   if (!bestMatch) {
     const newNutritionalRecord = await createNewNutritionalInfoRecord(ingredientName, 'arweave');
     ingredientDidRefs[originalName] = newNutritionalRecord.didTx;
   }
   ```

4. **Parallel Array Construction**:
   ```javascript
   recipe.ingredient = [didRef1, didRef2, ...];           // DID references
   recipe.ingredient_comment = ["chopped", "diced", ...]; // Comments
   recipe.ingredient_amount = [2, 1.5, ...];              // Amounts
   recipe.ingredient_unit = ["cups", "tbsp", ...];        // Units
   ```

**Usage Pattern**:
```javascript
POST /api/publish/newRecipe
Body: {
  basic: { name, description, ... },
  recipe: {
    ingredient: ["garlic", "olive oil"],            // RAW ingredient names
    ingredient_comment: ["minced", "extra virgin"],
    ingredient_amount: [2, 3],
    ingredient_unit: ["cloves", "tbsp"],
    instructions: "Cook the garlic in oil...",
    ...
  },
  blockchain: "arweave"
}
```

**Backend Processing**:
1. Parses raw ingredient names
2. Searches for existing nutritionalInfo records
3. Scores matches using fuzzy algorithm
4. Creates new nutritionalInfo records for missing ingredients
5. Replaces ingredient names with DID references
6. Publishes recipe with DID references in ingredient array

**Response**:
```javascript
{
  transactionId: "abc123...",
  recordToIndex: {
    data: { ... },
    oip: {
      didTx: "did:arweave:abc123...",  // ❌ Wrong field name
      recordType: "recipe",
      ...
    }
  }
}
```

---

## Ingredient Handling Comparison

| Feature | `/api/records/newRecord` | `/api/publish/newRecipe` |
|---------|--------------------------|--------------------------|
| **Ingredient Format** | Must provide DIDs | Accepts raw names |
| **Lookup Existing** | Manual (client-side) | Automatic (server-side) |
| **Create Missing** | Manual (client-side) | Automatic (server-side) |
| **Fuzzy Matching** | None | Advanced scoring |
| **Synonym Support** | None | Built-in mapping |
| **Nutritional Data** | Must fetch separately | Auto-fetched via Nutritionix |
| **Parallel Arrays** | Client must construct | Server constructs |

---

## Nutritional Info Record Creation

The `/api/publish/newRecipe` endpoint uses this helper function:

```javascript
// routes/publish.js line 512
async function createNewNutritionalInfoRecord(ingredientName, blockchain = 'arweave') {
  try {
    // Fetch nutritional data from Nutritionix API
    const nutritionalData = await fetchNutritionalData(ingredientName);
    
    // Publish as OIP record
    const newRecord = await publishNewRecord(
      nutritionalData,
      'nutritionalInfo',
      false, false, false, null,
      blockchain
    );
    
    return {
      didTx: newRecord.transactionId,
      nutritionalInfo: nutritionalData.nutritionalInfo
    };
  } catch (error) {
    console.error(`Failed to create nutritionalInfo record for ${ingredientName}:`, error);
    return null;
  }
}
```

This function:
1. Calls `fetchNutritionalData()` from `helpers/nutritional-helper.js`
2. Fetches data from Nutritionix API (or falls back to web scraping)
3. Publishes a complete `nutritionalInfo` record to Arweave
4. Returns the new DID for use in the recipe's ingredient array

---

## DID Field Issue

### The Problem

The `/api/publish/newRecipe` endpoint indexes records with `oip.didTx`, but newer queries expect `oip.did`. This causes inconsistency in the database.

**Legacy Approach** (publish/newRecipe):
```javascript
oip: {
  didTx: "did:arweave:abc123",  // ❌ Legacy field
  recordType: "recipe"
}
```

**Modern Approach** (records/newRecord):
```javascript
oip: {
  did: "did:arweave:abc123",     // ✅ Current standard
  didTx: "did:arweave:abc123",   // Also included for backward compatibility
  recordType: "recipe"
}
```

### Impact

Recipes published via `/api/publish/newRecipe` may not appear in queries that filter by `oip.did`.

---

## Recommendation

For a **Recipe Bundle** feature in `reference-client.html`:

1. **Use `/api/records/newRecord`** for final recipe publishing (ensures proper DID handling)

2. **Implement intelligent ingredient handling client-side**:
   ```javascript
   async function processIngredients(ingredients) {
     const processedIngredients = [];
     
     for (const ing of ingredients) {
       if (ing.mode === 'existing') {
         // User selected existing ingredient
         processedIngredients.push({
           did: ing.selectedDID,
           amount: ing.amount,
           unit: ing.unit,
           comment: ing.comment
         });
       } else if (ing.mode === 'new') {
         // Check if ingredient already exists
         const existing = await searchIngredient(ing.name);
         if (existing) {
           processedIngredients.push({
             did: existing.oip.did,
             amount: ing.amount,
             unit: ing.unit,
             comment: ing.comment
           });
         } else {
           // Lookup nutritional info and create new record
           const newDID = await createNewIngredient(ing.name);
           processedIngredients.push({
             did: newDID,
             amount: ing.amount,
             unit: ing.unit,
             comment: ing.comment
           });
         }
       }
     }
     
     return processedIngredients;
   }
   ```

3. **Search Endpoint**:
   ```javascript
   GET /api/records?recordType=nutritionalInfo&noDuplicates=true&fieldName=basic.name&fieldSearch=<search>
   ```

4. **Create New Ingredient**:
   ```javascript
   // Option A: Use existing nutritionalInfo lookup endpoint
   POST /api/publish/nutritionalInfo
   Body: { basic: { name: ingredientName }, ... }
   
   // Option B: Let server auto-create
   // Call the backend's createNewNutritionalInfoRecord function
   // (Would need to expose as separate endpoint)
   ```

5. **Final Recipe Record**:
   ```javascript
   POST /api/records/newRecord?recordType=recipe&storage=gun
   Body: {
     basic: { ... },
     recipe: {
       ingredient: [did1, did2, did3],           // ✅ DID references
       ingredient_comment: ["chopped", "", "diced"],
       ingredient_amount: [2, 1, 3],
       ingredient_unit: ["cups", "whole", "tbsp"],
       ...
     }
   }
   ```

---

## Summary

| Aspect | records/newRecord | publish/newRecipe |
|--------|-------------------|-------------------|
| **Use Case** | Any record type | Recipes only |
| **Complexity** | Simple pass-through | Complex ingredient processing |
| **DID Field** | ✅ `oip.did` | ❌ `oip.didTx` |
| **Ingredient Handling** | Manual (pre-processed) | Automatic (server-side) |
| **Authentication** | Required | Not required |
| **Best For** | Recipe Bundle UI | Server-side automation |
| **Recommendation** | ✅ Use for Recipe Bundle | ⚠️ Use for ingredient lookup logic only |

---

## Conclusion

For implementing a Recipe Bundle feature in `reference-client.html`:

- **Use** `/api/records/newRecord` for final recipe publishing (proper DID handling)
- **Borrow** the ingredient lookup logic from `/api/publish/newRecipe` 
- **Implement** ingredient search and creation client-side
- **Ensure** all ingredient references are DIDs before publishing
- **Follow** the Exercise Bundle pattern for UI/UX consistency

This approach combines the best of both worlds: intelligent ingredient handling with proper DID standardization.

