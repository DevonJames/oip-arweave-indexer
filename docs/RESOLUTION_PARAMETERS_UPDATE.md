# Resolution Parameters Update

## Overview

This document details the behavior of record resolution parameters in the OIP system, specifically `resolveDepth`, `resolveNamesOnly`, and the new `resolveFieldName` parameter. These parameters control how deeply and selectively dref (decentralized reference) fields are resolved when fetching records via the `/api/records` endpoint.

## Problem Statement

### Original Issue with `resolveNamesOnly`

The user suspected that `resolveNamesOnly` was applying at all depths of resolution, which was not the desired behavior. The intended behavior was:

- `resolveNamesOnly` should **only apply at the deepest level** of resolution
- If `resolveDepth=2`, then at depth 1, full records should be resolved, and only at depth 2 should names be resolved

### Need for Selective Field Resolution

There was no way to specify which specific dref fields should be resolved. All drefs in a record were resolved, which could lead to:
- Excessive data fetching
- Larger API response payloads
- Unnecessary resolution of unused fields

## Solution Implementation

### 1. `resolveNamesOnly` - Deepest Level Only

The `resolveRecords` function now correctly applies `resolveNamesOnly` **only at the deepest level** of resolution.

**Implementation Details:**

```javascript
// In helpers/utils.js, line 235-237
const isDeepestLevel = resolveDepth === 1;
const shouldResolveNamesOnly = resolveNamesOnly && isDeepestLevel;
```

**How it works:**
- At each level of recursion, we check if `resolveDepth === 1` (the deepest level)
- `resolveNamesOnly` is only applied when we're at the deepest level
- At all other levels, full records are resolved

**Example:**

```javascript
// Query with resolveDepth=2 and resolveNamesOnly=true
GET /api/records?recordType=workout&resolveDepth=2&resolveNamesOnly=true

// Behavior:
// - At depth 1 (resolveDepth=2): Full exercise records are resolved
// - At depth 2 (resolveDepth=1): Only exercise names are resolved (if exercises reference other records)
```

**Before/After Comparison:**

```javascript
// BEFORE (incorrect behavior):
// resolveDepth=2, resolveNamesOnly=true
{
  workout: {
    exercise: ["Push-ups", "Squats"]  // Names only at ALL levels
  }
}

// AFTER (correct behavior):
// resolveDepth=2, resolveNamesOnly=true
{
  workout: {
    exercise: [
      {
        // Full exercise record at depth 1
        data: {
          basic: { name: "Push-ups" },
          exercise: {
            exerciseType: "main",
            equipmentRequired: "none"
            // If exercise references another record, THAT would be resolved as name only
          }
        }
      },
      { /* full Squats record */ }
    ]
  }
}
```

### 2. `resolveFieldName` - Selective Field Resolution

A new parameter `resolveFieldName` allows you to specify which dref fields should be resolved, rather than resolving all drefs.

**Implementation Details:**

```javascript
// In helpers/elasticsearch.js, lines 3435-3451
let resolveFieldNamesArray = null;
if (resolveFieldName) {
    if (typeof resolveFieldName === 'string') {
        // Split comma-separated string and trim whitespace
        resolveFieldNamesArray = resolveFieldName
            .split(',')
            .map(field => field.trim())
            .filter(field => field.length > 0);
    } else if (Array.isArray(resolveFieldName)) {
        resolveFieldNamesArray = resolveFieldName;
    }
    
    if (resolveFieldNamesArray && resolveFieldNamesArray.length > 0) {
        console.log(`Resolving only specified fields: ${resolveFieldNamesArray.join(', ')}`);
    }
}
```

**Field Matching Logic:**

The `shouldResolveField` helper function supports flexible field path matching:

```javascript
// In helpers/utils.js, lines 240-258
const shouldResolveField = (category, key) => {
    // If no resolveFieldNames specified, resolve all fields
    if (!resolveFieldNames || resolveFieldNames.length === 0) {
        return true;
    }
    
    // Check if this field matches any of the specified paths
    // Support both "data.category.key" and "category.key" formats
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

**Supported Field Path Formats:**

- Full path: `data.basic.avatar`
- Short path: `basic.avatar`
- Prefix matching: `data.workout` (matches all fields in workout category)
- Short prefix: `workout` (matches all fields in workout category)

## API Usage

### Parameter: `resolveFieldName`

**Type:** String (comma-separated field paths)

**Format:** `field1,field2,field3`

**Examples:**

```bash
# Resolve only avatar field
GET /api/records?resolveDepth=2&resolveFieldName=data.basic.avatar

# Resolve only exercise field in workout
GET /api/records?recordType=workout&resolveDepth=2&resolveFieldName=data.workout.exercise

# Resolve multiple fields
GET /api/records?resolveDepth=2&resolveFieldName=data.basic.avatar,data.workout.exercise

# Resolve all fields in a category (prefix matching)
GET /api/records?resolveDepth=2&resolveFieldName=data.workout
```

### Combined Parameters

You can combine `resolveDepth`, `resolveNamesOnly`, and `resolveFieldName`:

```bash
# Example 1: Resolve only exercise field, names only at deepest level
GET /api/records?recordType=workout&resolveDepth=2&resolveNamesOnly=true&resolveFieldName=data.workout.exercise

# Example 2: Resolve multiple fields, full records
GET /api/records?recordType=recipe&resolveDepth=3&resolveFieldName=data.recipe.ingredient,data.basic.avatar

# Example 3: Resolve all workout fields, names at deepest level
GET /api/records?recordType=workout&resolveDepth=2&resolveNamesOnly=true&resolveFieldName=data.workout
```

## Use Cases

### Use Case 1: Workout with Exercise Names Only at Deepest Level

**Scenario:** You want to show a workout with full exercise details, but if exercises reference other records, only show those names.

**Query:**
```javascript
{
  recordType: 'workout',
  resolveDepth: 2,
  resolveNamesOnly: true
}
```

**Result:**
```javascript
{
  data: {
    workout: {
      exercise: [
        {
          // Full exercise record
          data: {
            basic: { name: "Push-ups" },
            exercise: {
              exerciseType: "main",
              equipmentRequired: "none",
              videoReference: "Tutorial Video"  // Name only (if this was a dref)
            }
          }
        }
      ]
    }
  }
}
```

### Use Case 2: Resolve Only Avatar, Not Exercise References

**Scenario:** You want to show user avatars but not resolve exercise references in a workout.

**Query:**
```javascript
{
  recordType: 'workout',
  resolveDepth: 2,
  resolveFieldName: 'data.basic.avatar'
}
```

**Result:**
```javascript
{
  data: {
    basic: {
      avatar: {
        // Full avatar record
        data: {
          basic: { name: "User Avatar" },
          image: { url: "https://..." }
        }
      }
    },
    workout: {
      exercise: [
        "did:arweave:exercise1",  // NOT resolved (not in resolveFieldName)
        "did:arweave:exercise2"
      ]
    }
  }
}
```

### Use Case 3: Resolve Multiple Specific Fields

**Scenario:** You want to show recipe ingredients and the creator's avatar, but nothing else.

**Query:**
```javascript
{
  recordType: 'recipe',
  resolveDepth: 2,
  resolveFieldName: 'data.recipe.ingredient,data.basic.avatar'
}
```

**Result:**
```javascript
{
  data: {
    basic: {
      avatar: {
        // Full avatar record
        data: { /* ... */ }
      }
    },
    recipe: {
      ingredient: [
        {
          // Full ingredient record
          data: { /* ... */ }
        }
      ],
      featuredImage: "did:arweave:img123"  // NOT resolved (not in resolveFieldName)
    }
  }
}
```

## Performance Implications

### Benefits of `resolveFieldName`

**Before (resolving all drefs):**
```javascript
// Query without resolveFieldName
GET /api/records?recordType=workout&resolveDepth=2

// Resolves:
// - basic.avatar (100KB)
// - basic.featuredImage (500KB)
// - workout.exercise (10 exercises × 50KB = 500KB)
// - workout.videoTutorial (200KB)
// Total: ~1.3MB response
```

**After (selective resolution):**
```javascript
// Query with resolveFieldName
GET /api/records?recordType=workout&resolveDepth=2&resolveFieldName=data.workout.exercise

// Resolves only:
// - workout.exercise (10 exercises × 50KB = 500KB)
// Total: ~500KB response (60% reduction!)
```

### Performance Recommendations

1. **Use `resolveFieldName` when you know which fields you need**
   - Reduces payload size
   - Faster response times
   - Lower memory usage

2. **Use `resolveNamesOnly` for preview/list views**
   - Even faster than selective resolution
   - Minimal payload
   - Great for displaying lists of related items

3. **Combine both for optimal performance**
   ```javascript
   {
     resolveDepth: 2,
     resolveNamesOnly: true,
     resolveFieldName: 'data.workout.exercise'
   }
   ```

## Code Changes Summary

### Files Modified

1. **`helpers/utils.js`**
   - Modified `resolveRecords` function signature to accept `resolveFieldNames` and `currentDepth`
   - Added `isDeepestLevel` and `shouldResolveNamesOnly` flags
   - Added `shouldResolveField` helper function
   - Updated field resolution loop to check `shouldResolveField`
   - Pass `resolveFieldNames` and `currentDepth + 1` in recursive calls

2. **`helpers/elasticsearch.js`**
   - Added `resolveFieldName` to `getRecords` function parameters
   - Added parsing logic for comma-separated `resolveFieldName` string
   - Pass `resolveFieldNamesArray` and `currentDepth` to `resolveRecords`

### Key Implementation Points

**1. Depth Tracking:**
```javascript
// helpers/utils.js, line 204
const resolveRecords = async (record, resolveDepth, recordsInDB, resolveNamesOnly = false, 
    summarizeRecipe = false, addRecipeNutritionalSummary = null, visited = new Set(), 
    resolveFieldNames = null, currentDepth = 0) => {
```

**2. Deepest Level Check:**
```javascript
// helpers/utils.js, lines 235-237
const isDeepestLevel = resolveDepth === 1;
const shouldResolveNamesOnly = resolveNamesOnly && isDeepestLevel;
```

**3. Field Filtering:**
```javascript
// helpers/utils.js, lines 264-267
if (!shouldResolveField(category, key)) {
    continue; // Skip this field if it's not in the resolveFieldNames list
}
```

**4. Recursive Resolution:**
```javascript
// helpers/utils.js, line 281
let resolvedRef = await resolveRecords(refRecord, resolveDepth - 1, recordsInDB, 
    resolveNamesOnly, summarizeRecipe, addRecipeNutritionalSummary, branchVisited, 
    resolveFieldNames, currentDepth + 1);
```

## Backward Compatibility

### No Breaking Changes

- **Existing behavior preserved:** If `resolveFieldName` is not provided, all fields are resolved (default behavior)
- **`resolveNamesOnly` fix:** The correction to apply it only at the deepest level is the intended behavior and fixes a bug
- **All existing API calls continue to work**

### Migration Guide

**No migration needed!** Existing code will continue to work exactly as before (or better, with the `resolveNamesOnly` fix).

**Optional enhancements:**

```javascript
// Old way (still works)
fetch('/api/records?recordType=workout&resolveDepth=2')

// New way (more efficient)
fetch('/api/records?recordType=workout&resolveDepth=2&resolveFieldName=data.workout.exercise')
```

## Testing Recommendations

### Test Case 1: Verify `resolveNamesOnly` at Deepest Level

```javascript
// Test with resolveDepth=2 and resolveNamesOnly=true
const response = await fetch('/api/records?recordType=workout&resolveDepth=2&resolveNamesOnly=true&limit=1');
const workout = response.records[0];

// Verify:
// 1. workout.exercise should be full records (depth 1)
console.assert(typeof workout.data.workout.exercise[0] === 'object');
console.assert(workout.data.workout.exercise[0].data !== undefined);

// 2. If exercises have drefs, those should be names only (depth 2)
// (if applicable to your data structure)
```

### Test Case 2: Verify Selective Field Resolution

```javascript
// Test with resolveFieldName
const response = await fetch('/api/records?recordType=workout&resolveDepth=2&resolveFieldName=data.workout.exercise&limit=1');
const workout = response.records[0];

// Verify:
// 1. workout.exercise should be resolved
console.assert(typeof workout.data.workout.exercise[0] === 'object');

// 2. Other drefs should NOT be resolved (still DIDs)
if (workout.data.basic.avatar) {
    console.assert(workout.data.basic.avatar.startsWith('did:'));
}
```

### Test Case 3: Verify Multiple Field Resolution

```javascript
// Test with multiple fields
const response = await fetch('/api/records?recordType=recipe&resolveDepth=2&resolveFieldName=data.recipe.ingredient,data.basic.avatar&limit=1');
const recipe = response.records[0];

// Verify:
// 1. recipe.ingredient should be resolved
console.assert(typeof recipe.data.recipe.ingredient[0] === 'object');

// 2. basic.avatar should be resolved
console.assert(typeof recipe.data.basic.avatar === 'object');

// 3. Other drefs should NOT be resolved
if (recipe.data.recipe.featuredImage) {
    console.assert(recipe.data.recipe.featuredImage.startsWith('did:'));
}
```

## Troubleshooting

### Issue: Fields Not Resolving

**Problem:** You specified `resolveFieldName` but fields are still showing as DIDs.

**Checklist:**
1. Verify `resolveDepth` is set and > 0
2. Check field path format (try both `data.category.field` and `category.field`)
3. Ensure the field actually contains a dref (DID string)
4. Check console logs for "Resolving only specified fields: ..." message

**Example:**
```javascript
// ❌ Wrong field path
resolveFieldName: 'workout.exercise'  // Missing 'data.' prefix

// ✅ Correct field paths
resolveFieldName: 'data.workout.exercise'  // Full path
resolveFieldName: 'workout.exercise'       // Short path (also works)
```

### Issue: All Fields Resolving (Not Selective)

**Problem:** Even with `resolveFieldName`, all drefs are being resolved.

**Cause:** Check if `resolveFieldName` is actually being passed to the API.

**Debug:**
```javascript
// Add to helpers/elasticsearch.js after line 3449
console.log('Parsed resolveFieldNamesArray:', resolveFieldNamesArray);
```

### Issue: `resolveNamesOnly` Still Applying at All Levels

**Problem:** Even after the update, names are resolved at all levels.

**Cause:** This should be fixed now. If still occurring:
1. Check that you're using the updated code
2. Verify the `isDeepestLevel` logic in `helpers/utils.js` line 236
3. Add debug logging:
   ```javascript
   console.log('Current depth:', currentDepth, 'resolveDepth:', resolveDepth, 'isDeepestLevel:', isDeepestLevel);
   ```

## Additional Resources

- **API Documentation:** See `docs/API_RECORDS_ENDPOINT_DOCUMENTATION.md` for full API reference
- **Technical Overview:** See `docs/OIP_TECHNICAL_OVERVIEW.md` for OIP system architecture
- **Source Code:**
  - Resolution logic: `helpers/utils.js` (line 204+)
  - API integration: `helpers/elasticsearch.js` (line 2372+)

## Conclusion

The updates to `resolveDepth`, `resolveNamesOnly`, and the addition of `resolveFieldName` provide:

✅ **Correct `resolveNamesOnly` behavior** - Only applies at the deepest level as intended  
✅ **Selective field resolution** - Resolve only the drefs you need  
✅ **Better performance** - Smaller payloads, faster responses  
✅ **Backward compatible** - Existing code continues to work  
✅ **Flexible API** - Multiple ways to specify field paths  

These improvements make the OIP records API more efficient and give developers fine-grained control over record resolution behavior.
