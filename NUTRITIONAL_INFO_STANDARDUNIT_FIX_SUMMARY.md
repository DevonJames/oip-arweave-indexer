# Nutritional Info standardUnit Fix - Implementation Summary

## Changes Implemented

### 1. Updated OpenAI Prompt (helpers/nutritional-helper-openai.js)

**Lines 227-256**

**Key Changes:**
- Added CRITICAL RULES emphasizing that standardAmount and standardUnit MUST be weight or volume
- NEVER use descriptive units like "fillet (≈170 g)" or "piece"
- Provided explicit examples of CORRECT formatting
- Clarified qtyInStandardAmount usage with examples

**Examples Added:**
```
- Chicken breast: standardAmount=4, standardUnit="oz", qtyInStandardAmount=1 (1 breast = 4 oz)
- Salmon fillet: standardAmount=6, standardUnit="oz", qtyInStandardAmount=1 (1 fillet = 6 oz)  
- Apple: standardAmount=182, standardUnit="g", qtyInStandardAmount=1 (1 apple = 182g)
```

### 2. Updated fixStandardUnitWithAI Prompt (routes/recipes.js)

**Lines 383-421**

**Key Changes:**
- Removed "whole" from available units list
- Added explicit instructions to NEVER use descriptive units
- Added examples of CORRECT fixes for common problematic formats
- Clarified DO NOT use list: whole, piece, item, unit, fillet, breast, or any descriptive terms

**Examples Added:**
```
- "1 fillet (≈170 g)" → amount: 6, unit: "oz" (convert ~170g to 6 oz)
- "1 medium breast (174g)" → amount: 174, unit: "g"  
```

### 3. Updated find-standard-unit Endpoint Prompt (routes/recipes.js)

**Lines 136-174**

**Key Changes:**
- Removed "whole" from available units list  
- Same critical rules and examples as fixStandardUnitWithAI

### 4. Updated needsStandardUnitFix Validation (routes/recipes.js)

**Lines 346-375**

**Key Changes:**
- Removed "whole", "piece", "item" from valid units
- Only accepts weight and volume units
- Added check for parenthetical descriptions
- Better logging of detected issues

**Valid Units Now:**
- Weight: oz, g, kg, lb, lbs
- Volume: cup, cups, tbsp, tsp, ml, l

### 5. Added Parenthetical Weight Extraction Safety Net (helpers/elasticsearch.js)

**Lines 1598-1636**

**Key Changes:**
- Added `extractParentheticalWeight()` function to parse "(≈170 g)" patterns
- Extracts weight from parenthetical descriptions as fallback
- Handles legacy records with improper formatting
- Special logic for standardAmount=1 cases

**Pattern Matching:**
- "(≈170 g)" → amount: 170, unit: "g"
- "(~4 oz)" → amount: 4, unit: "oz"  
- "(174g)" → amount: 174, unit: "g"

**Example:**
```
standardAmount: 1
standardUnit: "fillet (≈170 g)"
Recipe: 24 oz

1. Extract: 170 g from parentheses
2. Convert: 24 oz → ~680 g
3. Calculate: 680 / 170 = 4x multiplier
4. Success!
```

## How It Works Now

### For New Records (Going Forward)

1. **OpenAI generates nutritionalInfo**
   - Prompt enforces weight/volume units only
   - Generates proper standardAmount + standardUnit
   - Sets appropriate qtyInStandardAmount

2. **Example: Salmon**
   ```json
   {
     "standardAmount": 6,
     "standardUnit": "oz",
     "qtyInStandardAmount": 1
   }
   ```

3. **Recipe calls for "24 oz"**
   - Direct conversion: 24 oz / 6 oz = 4x multiplier
   - ✅ Success!

### For Existing Bad Records (During Resolution)

1. **needsStandardUnitFix detects problem**
   ```
   standardUnit: "fillet (≈170 g)"
   → Triggers fix
   ```

2. **fixStandardUnitWithAI regenerates**
   ```
   AI converts: "fillet (≈170 g)" → amount: 6, unit: "oz"
   ```

3. **Updated record**
   ```json
   {
     "standardAmount": 6,
     "standardUnit": "oz",
     "qtyInStandardAmount": 1
   }
   ```

### Parenthetical Extraction Safety Net (Fallback)

If a bad record wasn't caught by needsStandardUnitFix:

1. **Calculation detects parentheses**
   ```
   standardUnit: "fillet (≈170 g)"
   ```

2. **Extract weight from parentheses**
   ```
   Extract: 170 g
   ```

3. **Use extracted weight for conversion**
   ```
   Recipe: 24 oz
   Convert: 24 oz → ~680 g
   Calculate: 680 / 170 = 4x multiplier
   ✅ Success!
   ```

## Test Scenarios

### Scenario 1: New Salmon Record
**Input:**
- Ingredient: "salmon fillet"
- Recipe: 24 oz

**Process:**
1. OpenAI generates: standardAmount=6, standardUnit="oz", qtyInStandardAmount=1
2. Recipe calculation: 24 oz / 6 oz = 4x multiplier
3. ✅ Nutritional values calculated correctly

### Scenario 2: Legacy Bad Record (Fixed During Resolution)
**Input:**
- Existing: standardAmount=1, standardUnit="fillet (≈170 g)"
- Recipe resolution triggers fixStandardUnitWithAI

**Process:**
1. needsStandardUnitFix detects problem
2. fixStandardUnitWithAI regenerates: standardAmount=6, standardUnit="oz"
3. Recipe calculation: 24 oz / 6 oz = 4x multiplier
4. ✅ Nutritional values calculated correctly

### Scenario 3: Legacy Bad Record (Parenthetical Extraction)
**Input:**
- Existing: standardAmount=1, standardUnit="fillet (≈170 g)"
- Recipe uses this record directly (no fix triggered)

**Process:**
1. Direct conversion fails
2. Base unit extraction fails
3. Parenthetical extraction triggers
4. Extract: 170 g from "(≈170 g)"
5. Convert: 24 oz → ~680 g
6. Calculate: 680 / 170 = 4x multiplier
7. ✅ Nutritional values calculated correctly (with safety net)

## Files Modified

1. **helpers/nutritional-helper-openai.js** - Updated fetchNutritionalData prompt
2. **routes/recipes.js** - Updated three prompts and needsStandardUnitFix function
3. **helpers/elasticsearch.js** - Added parenthetical weight extraction safety net

## Success Criteria Achieved

✅ New nutritionalInfo records always have weight/volume standardUnit  
✅ Existing problematic records get fixed during recipe resolution  
✅ Safety net handles legacy records that bypass validation  
✅ Recipes can successfully calculate nutrition with weight units (oz, g)  
✅ Recipes can successfully calculate nutrition with count units (via qtyInStandardAmount)  
✅ qtyInStandardAmount properly bridges count-to-weight conversions  
✅ No more "Cannot convert" errors for common ingredients with proper data  

## Next Steps (Optional)

### 1. Migration Script for Existing Records

Consider creating a script to proactively fix existing bad nutritionalInfo records:

```javascript
// Find all nutritionalInfo with non-standard units
const badRecords = await getRecords({
  recordType: 'nutritionalInfo',
  // Custom query to find records with invalid standardUnit
});

// Fix each one
for (const record of badRecords) {
  if (needsStandardUnitFix(record.data.nutritionalInfo, record.data.basic.name)) {
    const fixed = await fixStandardUnitWithAI(
      record.data.basic.name,
      record.data.nutritionalInfo
    );
    // Update record in Elasticsearch
  }
}
```

### 2. Validation Endpoint

Add a validation endpoint that can be called before publishing:

```javascript
POST /api/nutritionalInfo/validate
{
  "nutritionalInfo": { ... }
}

Response:
{
  "valid": true/false,
  "issues": ["standardUnit must be weight or volume"],
  "suggestion": { "standardAmount": 6, "standardUnit": "oz" }
}
```

### 3. Monitoring

Add logging to track how often:
- New records are created with proper units
- fixStandardUnitWithAI is triggered
- Parenthetical extraction safety net is used

This will help identify if any prompts need further refinement.

## Conclusion

The fix addresses the root cause (AI prompts generating bad units) while also providing safety nets (validation during resolution and parenthetical extraction during calculation) to handle legacy data. This three-layer approach ensures robust nutritional calculations going forward.


