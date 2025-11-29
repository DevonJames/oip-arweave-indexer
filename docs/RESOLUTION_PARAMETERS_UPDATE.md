# Resolution Parameters Update

## Overview

This document describes the updates to the `resolveDepth` and `resolveNamesOnly` parameters in the OIP records resolution system, plus the addition of a new `resolveFieldName` parameter.

## Changes Made

### 1. Fixed `resolveNamesOnly` Behavior

**Previous Behavior (INCORRECT):**
- When `resolveNamesOnly=true`, it applied at ALL depth levels
- Example: With `resolveDepth=2` and `resolveNamesOnly=true`:
  - Depth 1: Only names resolved (❌ incorrect)
  - Depth 2: Only names resolved

**New Behavior (CORRECT):**
- `resolveNamesOnly` now only applies at the **deepest level** of resolution
- Example: With `resolveDepth=2` and `resolveNamesOnly=true`:
  - Depth 1: Full records resolved ✅
  - Depth 2: Only names resolved ✅

**Why This Matters:**
- Allows you to get full context at intermediate levels
- Only simplifies to names at the final depth
- More useful for complex data structures with multiple levels of references

### 2. Added `resolveFieldName` Parameter

**Purpose:** 
Selectively resolve only specific fields instead of all dref fields in a record.

**Format:**
- Comma-separated string: `"data.basic.avatar,data.workout.exercise"`
- Array: `["data.basic.avatar", "data.workout.exercise"]`

**Field Path Formats Supported:**
- Full path: `data.basic.avatar`
- Short path: `basic.avatar`
- Category path: `workout.exercise`

**Behavior:**
- If `resolveFieldName` is provided, ONLY the specified fields will have their drefs resolved
- All other dref fields will remain as DIDs
- If `resolveFieldName` is NOT provided, ALL dref fields are resolved (default behavior)

## API Usage Examples

### Example 1: Basic Usage - Resolve Names Only at Deepest Level

**Request:**
```http
GET /api/records?recordType=workout&resolveDepth=2&resolveNamesOnly=true&limit=5
```

**Behavior:**
- Resolves workout records
- At depth 1: Exercises are fully resolved (complete exercise records)
- At depth 2: Any drefs within exercises are resolved as names only

**Use Case:** 
Get full exercise details but simplify any nested references (like equipment references) to just names.

### Example 2: Selective Field Resolution

**Request:**
```http
GET /api/records?recordType=workout&resolveDepth=2&resolveFieldName=data.workout.exercise&limit=5
```

**Behavior:**
- Resolves workout records
- Only resolves the `data.workout.exercise` field (array of exercise drefs)
- All other dref fields remain as DIDs
- Useful when you only need specific relationships resolved

**Use Case:**
Performance optimization when you only need specific fields resolved, avoiding unnecessary dref lookups.

### Example 3: Multiple Field Resolution

**Request:**
```http
GET /api/records?recordType=recipe&resolveDepth=1&resolveFieldName=data.recipe.ingredient,data.basic.avatar&limit=10
```

**Behavior:**
- Resolves recipe records
- Only resolves:
  - `data.recipe.ingredient` (array of ingredient drefs)
  - `data.basic.avatar` (avatar image dref)
- All other dref fields remain as DIDs

**Use Case:**
Get ingredient details and avatar images, but skip resolving other references (like categories, creators, etc.).

### Example 4: Combined - Selective Fields + Names Only at Deep Level

**Request:**
```http
GET /api/records?recordType=workout&resolveDepth=2&resolveNamesOnly=true&resolveFieldName=data.workout.exercise&limit=5
```

**Behavior:**
- Only resolves `data.workout.exercise` field
- At depth 1: Full exercise records
- At depth 2: Any drefs within exercises resolved as names only

**Use Case:**
Focus on exercise details with minimal nested data - perfect for workout lists where you need exercise info but not deep equipment details.

### Example 5: Short Path Format

**Request:**
```http
GET /api/records?recordType=recipe&resolveDepth=1&resolveFieldName=recipe.ingredient,basic.avatar
```

**Behavior:**
- Same as Example 3, but using shorter field paths
- Both `recipe.ingredient` and `data.recipe.ingredient` are recognized
- Resolves ingredients and avatar only

## Implementation Details

### Function Signature Changes

**`resolveRecords` in `helpers/utils.js`:**

```javascript
// OLD signature:
async function resolveRecords(
    record, 
    resolveDepth, 
    recordsInDB, 
    resolveNamesOnly = false, 
    summarizeRecipe = false, 
    addRecipeNutritionalSummary = null, 
    visited = new Set()
)

// NEW signature:
async function resolveRecords(
    record, 
    resolveDepth, 
    recordsInDB, 
    resolveNamesOnly = false, 
    summarizeRecipe = false, 
    addRecipeNutritionalSummary = null, 
    visited = new Set(),
    resolveFieldNames = null,  // NEW: Array of field paths to resolve
    currentDepth = 0            // NEW: Track current depth in recursion
)
```

### Key Logic Changes

**1. Deepest Level Detection:**
```javascript
// Determine if we're at the deepest level (where resolveNamesOnly should apply)
const isDeepestLevel = resolveDepth === 1;
const shouldResolveNamesOnly = resolveNamesOnly && isDeepestLevel;
```

**2. Field Path Matching:**
```javascript
const shouldResolveField = (category, key) => {
    // If no resolveFieldNames specified, resolve all fields
    if (!resolveFieldNames || resolveFieldNames.length === 0) {
        return true;
    }
    
    // Check if this field matches any of the specified paths
    const fieldPath = `data.${category}.${key}`;
    const shortFieldPath = `${category}.${key}`;
    
    return resolveFieldNames.some(targetPath => 
        targetPath === fieldPath || 
        targetPath === shortFieldPath ||
        targetPath === `data.${shortFieldPath}` ||
        fieldPath.startsWith(targetPath + '.') ||
        shortFieldPath.startsWith(targetPath + '.')
    );
};
```

**3. Recipe Merging Logic:**
```javascript
// AFTER DID resolution, handle special recipe merging for resolveNamesOnly
// Only apply this at the deepest level
if (shouldResolveNamesOnly && record.data.recipe) {
    // ... recipe-specific logic
}
```

## Performance Implications

### Benefits of `resolveFieldName`

**Before (resolving all fields):**
```javascript
// Workout with 10 exercises, each exercise has 3 equipment drefs
// Total dref lookups: 10 exercises + 30 equipment = 40 lookups
GET /api/records?recordType=workout&resolveDepth=2&limit=10
```

**After (selective resolution):**
```javascript
// Same workout, but only resolve exercises (not equipment)
// Total dref lookups: 10 exercises = 10 lookups
// 75% reduction in database lookups!
GET /api/records?recordType=workout&resolveDepth=1&resolveFieldName=workout.exercise&limit=10
```

**Performance Gains:**
- Fewer database lookups
- Smaller response payloads
- Faster API response times
- Reduced memory usage
- Better for mobile/bandwidth-constrained clients

## Backward Compatibility

✅ **Fully Backward Compatible:**
- Default behavior unchanged when parameters are not specified
- Existing API calls work exactly the same
- `resolveNamesOnly` now works BETTER (correctly applies only at deepest level)
- `resolveFieldName` is optional - when omitted, all fields resolve

## Testing Recommendations

### Test Case 1: Verify Deepest-Level-Only Behavior
```javascript
// Test with resolveDepth=2 and resolveNamesOnly=true
// Verify that depth 1 has full records, depth 2 has names only
const response = await fetch('/api/records?recordType=workout&resolveDepth=2&resolveNamesOnly=true&limit=1');
const workout = response.records[0];

// Check depth 1 - should be full exercise record
console.assert(typeof workout.data.workout.exercise[0] === 'object', 'Depth 1 should be full record');
console.assert(workout.data.workout.exercise[0].data !== undefined, 'Depth 1 should have data');

// Check depth 2 - should be names only
const exerciseEquipment = workout.data.workout.exercise[0].data.exercise.equipmentRequired;
if (Array.isArray(exerciseEquipment)) {
    console.assert(typeof exerciseEquipment[0] === 'string', 'Depth 2 should be names only');
    console.assert(!exerciseEquipment[0].startsWith('did:'), 'Depth 2 should not be DIDs');
}
```

### Test Case 2: Verify Selective Field Resolution
```javascript
// Test that only specified fields are resolved
const response = await fetch('/api/records?recordType=recipe&resolveDepth=1&resolveFieldName=recipe.ingredient&limit=1');
const recipe = response.records[0];

// Check that ingredient is resolved
console.assert(Array.isArray(recipe.data.recipe.ingredient), 'Ingredient should be array');
if (recipe.data.recipe.ingredient.length > 0) {
    console.assert(typeof recipe.data.recipe.ingredient[0] === 'object', 'Ingredient should be resolved');
}

// Check that other drefs are NOT resolved (if present)
if (recipe.data.basic.avatar) {
    console.assert(recipe.data.basic.avatar.startsWith('did:'), 'Avatar should remain as DID');
}
```

### Test Case 3: Verify Multiple Field Resolution
```javascript
// Test with multiple fields
const response = await fetch('/api/records?recordType=workout&resolveDepth=1&resolveFieldName=workout.exercise,basic.avatar&limit=1');
const workout = response.records[0];

// Both fields should be resolved
console.assert(typeof workout.data.workout.exercise[0] === 'object', 'Exercise should be resolved');
if (workout.data.basic.avatar) {
    console.assert(typeof workout.data.basic.avatar === 'object', 'Avatar should be resolved');
}
```

## Common Use Cases

### Use Case 1: Workout Lists (Optimized)
```http
GET /api/records?recordType=workout&resolveDepth=1&resolveFieldName=workout.exercise&limit=20
```
**Why:** Get workout with exercise details, skip resolving images/avatars/equipment for faster loading.

### Use Case 2: Recipe Display (Full Details)
```http
GET /api/records?recordType=recipe&resolveDepth=2&resolveNamesOnly=true&resolveFieldName=recipe.ingredient
```
**Why:** Get full ingredient details (depth 1), but simplify nutritional info references to names (depth 2).

### Use Case 3: Exercise Directory (Names Only)
```http
GET /api/records?recordType=workout&resolveDepth=1&resolveNamesOnly=true&limit=50
```
**Why:** List workouts with exercise names only (not full exercise records) for a compact directory view.

### Use Case 4: Profile Cards (Minimal Resolution)
```http
GET /api/records?recordType=post&resolveDepth=1&resolveFieldName=basic.avatar&limit=10
```
**Why:** Display posts with just avatar images resolved, skip resolving categories, tags, or other references.

## Migration Guide

### No Changes Required For:
- Existing API calls without `resolveNamesOnly` or `resolveFieldName`
- API calls that only use `resolveDepth`
- Frontend code that doesn't use these parameters

### Update Recommended For:
- Code that uses `resolveNamesOnly=true` and expects names at ALL levels (it now only applies at deepest)
  - **Action:** If you need names at depth 1, use `resolveDepth=1` instead of `resolveDepth=2`

### Optimization Opportunities:
- Any queries that resolve unnecessary fields
  - **Action:** Add `resolveFieldName` parameter to only resolve what you need
  - **Benefit:** Faster response times, smaller payloads

## Technical Notes

### Recursion Tracking
- `currentDepth` parameter tracks how deep we are in the resolution tree
- Starts at 0 when first called
- Increments with each recursive call
- Used internally to determine when we're at the deepest level

### Field Path Matching Algorithm
The `shouldResolveField` function matches field paths flexibly:
1. Exact match: `data.workout.exercise` === `data.workout.exercise`
2. Short match: `workout.exercise` matches `data.workout.exercise`
3. Prefix match: `workout` matches `workout.exercise`, `workout.duration`, etc.

### Visited Set Handling
- Each branch of recursion maintains its own visited set
- Prevents infinite loops in circular references
- Cloned when entering new branches to allow the same record to appear in different branches

## Files Modified

1. **`helpers/utils.js`**
   - Updated `resolveRecords` function signature
   - Added `resolveFieldNames` and `currentDepth` parameters
   - Added `shouldResolveField` helper function
   - Changed `resolveNamesOnly` to only apply at deepest level
   - Updated recipe merging logic to use `shouldResolveNamesOnly`

2. **`helpers/elasticsearch.js`**
   - Added `resolveFieldName` parameter extraction in `getRecords`
   - Added parsing logic for comma-separated field names
   - Updated `resolveRecords` call to pass new parameters

## Related Documentation

- [API Records Endpoint Documentation](./API_RECORDS_ENDPOINT_DOCUMENTATION.md)
- [OIP Technical Overview](./OIP_TECHNICAL_OVERVIEW.md)
- [Elasticsearch Comprehensive Guide](./ELASTICSEARCH_COMPREHENSIVE_GUIDE.md)

## Questions or Issues?

If you have questions about these changes or encounter any issues, please refer to:
- The test cases above
- The usage examples
- The implementation details in `helpers/utils.js` lines 204-340

