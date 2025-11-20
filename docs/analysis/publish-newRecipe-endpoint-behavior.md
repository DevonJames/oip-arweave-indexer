## `/publish/newRecipe` Endpoint - Ingredient Processing Flow

### **Scenario 1: All ingredients are DID strings**

Example: `ingredient: ["did:arweave:abc123", "did:arweave:def456", "did:arweave:ghi789"]`

**Processing Steps:**

1. **Initial Parsing** (lines 537-555)
   - Creates ingredient objects with amount, unit, and name from parallel arrays
   - Identifies each ingredient string

2. **DID Detection** (lines 563-601)
   - Loop through each ingredient
   - Detects `startsWith('did:')` on line 568
   - Adds each DID to `ingredientDidTxMap` 
   - Handles DIDs with embedded comments: `"did:arweave:abc123, diced"` → splits into DID + comment
   - Skips adding to `ingredientNames` (lookup array) - **NO LOOKUP NEEDED**
   - All DIDs go to `ingredientNamesForDisplay`

3. **Lookup Process** (lines 960-966)
   - `cleanedNamesNeedingLookup.length === 0`
   - **Skips database search entirely** - logs "No ingredients need lookup"
   - `ingredientRecords = { ingredientDidRefs: {}, nutritionalInfo: [] }` (empty)

4. **Missing Ingredients** (lines 970-1032)
   - `missingIngredientNames.length === 0`
   - **Skips nutritional data fetching** - no new records created
   - **No OpenAI calls made**

5. **Final DID Array Assembly** (lines 1109-1123)
   - Builds `ingredientDRefs` array
   - Uses `ingredientDidTxMap` to get existing DIDs
   - Result: `["did:arweave:abc123", "did:arweave:def456", "did:arweave:ghi789"]`

6. **Recipe Data Assembly** (lines 1136-1162)
   - Creates `recipeData` object with:
     - `basic`: name, language, date, description, tags, avatar
     - `recipe.ingredient`: **array of DID strings**
     - `recipe.ingredient_amount`: amounts array
     - `recipe.ingredient_unit`: units array
     - `recipe.ingredient_comment`: comments array

7. **Nutritional Summary** (lines 1319-1381)
   - Checks if `summaryNutritionalInfoPerServing` already provided
   - If not, calculates it:
     - Fetches all nutritional info records from database
     - Calls `addRecipeNutritionalSummary()` (from elasticsearch.js)
     - Resolves each DID to its nutritional data
     - Calculates per-serving nutrition
     - Adds `summaryNutritionalInfoPerServing` to `recipeData`

8. **Publishing** (lines 1383-1391)
   - Calls `publishNewRecord(recipeData, "recipe", ...)`
   - Publishes to Arweave/GUN with all DIDs intact

---

### **Scenario 2: Mix of DID strings and ingredient names**

Example: `ingredient: ["did:arweave:abc123", "chicken breast", "did:arweave:def456", "olive oil"]`

**Processing Steps:**

1. **Initial Parsing** (same as Scenario 1)

2. **DID Detection & Separation** (lines 563-601)
   - `"did:arweave:abc123"` → added to `ingredientDidTxMap`, **skipped from lookup**
   - `"chicken breast"` → added to `ingredientNames` (needs lookup)
   - `"did:arweave:def456"` → added to `ingredientDidTxMap`, **skipped from lookup**
   - `"olive oil"` → added to `ingredientNames` (needs lookup)
   
   Result:
   - `ingredientNames = ["chicken breast", "olive oil"]` (needs lookup)
   - `ingredientDidTxMap = { "did:arweave:abc123": "did:arweave:abc123", "did:arweave:def456": "did:arweave:def456" }`

3. **Lookup Process** (lines 641-732, 960-966)
   - For each name in `cleanedNamesNeedingLookup`:
     - Calls `getRecords()` with:
       - `recordType: 'nutritionalInfo'`
       - `fieldName: 'basic.name'`
       - `fieldSearch: <ingredient name>`
       - `fieldMatchMode: 'exact'` (with dash/space normalization)
       - `noDuplicates: true`
       - `limit: 20`
     - Searches for existing nutritionalInfo records
     - Populates `recordMap` with results
     - **Only includes records with actual nutritionalInfo data**
   
4. **Best Match Selection** (lines 769-936)
   - For each ingredient name:
     - Checks synonym map first
     - Then checks exact match in `recordMap`
     - Uses `fieldSearchScore` (from elasticsearch) ≥ 900 threshold
     - Calculates internal score (50-80+ points) based on:
       - Term matches
       - Core vs descriptor terms
       - Exact sequence bonus
       - Completeness bonus
     - If match quality insufficient → `null` (will create new record)

5. **Missing Ingredients Handling** (lines 974-1059)
   - Ingredients that didn't match → creates new nutritionalInfo records
   - For each missing ingredient:
     - Calls `createNewNutritionalInfoRecord(cleanedName, blockchain)`
       - Which calls `fetchNutritionalData(ingredientName)` → **OpenAI API call**
       - Returns full nutritionalInfo record structure
       - Publishes to Arweave/GUN
       - Returns `{ oip: { did: "did:arweave:xyz..." }, data: {...} }`
     - Updates `ingredientRecords.ingredientDidRefs` with new DID

6. **Final DID Array Assembly** (lines 1109-1123)
   - Builds `ingredientDRefs` by merging:
     - Existing DIDs from `ingredientDidTxMap` (for items that were already DIDs)
     - Looked-up DIDs from `ingredientRecords.ingredientDidRefs` (for matched items)
     - Newly created DIDs from `ingredientRecords.ingredientDidRefs` (for new items)
   
   Result: `["did:arweave:abc123", "did:arweave:NEW123", "did:arweave:def456", "did:arweave:NEW456"]`

7. **Recipe Data Assembly** (same as Scenario 1, but with mixed old/new DIDs)

8. **Nutritional Summary** (same as Scenario 1)
   - Resolves all DIDs (both existing and newly created)
   - Calculates per-serving nutrition

9. **Publishing** (same as Scenario 1)

---

### **Scenario 3: Some ingredients are full record objects**

Example:
```javascript
ingredient: [
  "did:arweave:abc123", 
  { data: { basic: { name: "chicken breast" }, nutritionalInfo: {...} }, oip: { did: "..." } },
  "olive oil"
]
```

**Processing Steps:**

1. **Initial Parsing** (lines 537-541)
   - Maps each item to `{ amount, unit, name }`
   - For objects: `name` becomes the stringified object → **BUG POTENTIAL**
   - For strings: `name` is the string itself

2. **DID Detection** (lines 563-601)
   - Full objects don't `startsWith('did:')` → **treated as ingredient names**
   - Object gets stringified: `"[object Object]"`
   - Added to `ingredientNames` for lookup

3. **Lookup Process** (lines 641-732)
   - Searches for `"[object Object]"` → **NO MATCHES**
   - Object reference is lost

4. **Missing Ingredients** (lines 974-1032)
   - Tries to create nutritionalInfo for `"[object Object]"`
   - **OpenAI called with garbage input**
   - Creates bad record or fails

**⚠️ ISSUE:** The current code doesn't properly handle full record objects in the ingredients array. It expects either:
- DID strings (starting with `did:`)
- Plain ingredient names (strings)

It does **NOT** handle resolved record objects properly.

---

## Special Recipe Processing (Before Publishing)

After all ingredients are processed, the recipe goes through:

### **1. Null Filtering** (lines 1175-1190)
- Filters out ingredients with `null` DIDs
- Synchronizes all parallel arrays (amounts, units, comments)
- Only keeps valid ingredients

### **2. Intelligent Ingredient Resolution** (lines 1222-1316)
- **Only triggers if**:
  - Recipe has ingredient names (not all DIDs)
  - No pre-calculated nutritional summary provided
- Resolves, fixes standard units, calculates nutrition
- Publishes any new ingredients

### **3. Nutritional Summary Calculation** (lines 1319-1381)
- **Priority order**:
  1. Use `summaryNutritionalInfoPerServing` from intelligent resolution
  2. Use pre-calculated summary from request body
  3. Calculate new summary:
     - Fetches all nutritionalInfo records from database
     - Filters to only records with actual nutritional data
     - Calls `addRecipeNutritionalSummary()` from elasticsearch.js
     - For each ingredient DID:
       - Resolves to nutritionalInfo record
       - Converts units if needed (lines 1454-1647 in elasticsearch.js)
       - Calculates contribution to totals
     - Returns per-serving and total nutrition
     - Adds `summaryNutritionalInfoPerServing` to recipe

### **4. Final Publishing** (lines 1383-1391)
- Calls `publishNewRecord()` with complete `recipeData`
- Publishes to specified blockchain (Arweave/GUN)
- Returns transaction ID

---

## Key Takeaways

✅ **Scenario 1 (All DIDs)**: Fast - no lookups, no OpenAI calls, direct publishing
✅ **Scenario 2 (Mixed)**: Smart - lookups for names, creates missing ones, combines with existing DIDs  
❌ **Scenario 3 (Objects)**: Broken - doesn't handle resolved record objects properly

The nutritional summary calculation is the same for all scenarios and happens **after** ingredient resolution, using the final DID array to look up nutritional data.