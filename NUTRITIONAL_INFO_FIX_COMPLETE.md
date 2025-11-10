# Nutritional Info standardUnit Fix - Complete Documentation

## Executive Summary

The recipe nutritional calculation system was failing when AI-generated `standardUnit` values weren't actual weight or volume units. For example, "fillet (≈170 g)" prevented conversion of recipe amounts like "24 oz" of salmon.

**Root Cause:** AI prompts allowed descriptive units instead of enforcing weight/volume units.

**Solution:** Three-layer fix:
1. **Prevention:** Updated AI prompts to enforce weight/volume units only
2. **Detection:** Enhanced validation to catch problematic units
3. **Safety Net:** Added parenthetical weight extraction for legacy records

## The Problem in Detail

### Example: Salmon Recipe Failure

**Problematic nutritionalInfo Record:**
```json
{
  "standardAmount": 1,
  "standardUnit": "fillet (≈170 g)",
  "qtyInStandardAmount": 1,
  "calories": 280,
  "proteinG": 40
}
```

**Recipe Calls For:**
```
24 oz salmon
```

**What Happened:**
1. System tried to convert 24 oz to "fillet" → Failed (not a recognized unit)
2. System tried to extract "fillet" from "fillet (≈170 g)" → Failed (fillet is not weight/volume)
3. Ingredient skipped
4. Recipe nutritional summary incomplete

**What Should Have Been:**
```json
{
  "standardAmount": 4,
  "standardUnit": "oz",
  "qtyInStandardAmount": 1,
  "calories": 280,
  "proteinG": 40
}
```

Then: 24 oz / 4 oz = 6x multiplier → 280 × 6 = 1,680 calories ✅

## The Correct Design

### Core Rule

**standardAmount + standardUnit MUST ALWAYS be weight or volume**

### Examples

#### Weight-Based Ingredients
```json
{
  "name": "Salmon Fillet",
  "standardAmount": 4,
  "standardUnit": "oz",
  "qtyInStandardAmount": 1,  // 1 fillet = 4 oz
  "calories": 140
}
```

**Recipe Usage:**
- "24 oz salmon" → 24 / 4 = 6x multiplier
- "2 fillets" → Uses qtyInStandardAmount: 2 / 1 = 2x multiplier

#### Count-Based Ingredients
```json
{
  "name": "Apple",
  "standardAmount": 182,
  "standardUnit": "g",
  "qtyInStandardAmount": 1,  // 1 apple = 182g
  "calories": 95
}
```

**Recipe Usage:**
- "3 whole apples" → Uses qtyInStandardAmount: 3 / 1 = 3x multiplier
- "200 g apples" → Direct: 200 / 182 = 1.1x multiplier

#### Volume-Based Ingredients
```json
{
  "name": "Diced Avocado",
  "standardAmount": 1,
  "standardUnit": "cup",
  "qtyInStandardAmount": 2,  // 2 avocados = 1 cup diced
  "calories": 240
}
```

**Recipe Usage:**
- "2 cups diced" → Direct: 2 / 1 = 2x multiplier
- "4 whole avocados" → Uses qtyInStandardAmount: 4 / 2 = 2x multiplier

## Implementation Details

### 1. AI Prompt Updates (Prevention Layer)

#### File: `helpers/nutritional-helper-openai.js` (Lines 227-256)

**Before:**
```
For items typically counted: describe the count with weight 
(e.g., "1 medium breast (174g)", "1 whole avocado (150g)")
```

**After:**
```
CRITICAL RULES FOR STANDARD UNITS:
1. standardAmount and standardUnit MUST ALWAYS be weight (oz, g, kg, lb) 
   or volume (cup, tbsp, tsp, ml, l)
2. NEVER use descriptive units like "fillet (≈170 g)", "1 medium breast (174g)", or "piece"
3. Extract the actual weight/volume number from any descriptions

Valid standardUnit values ONLY:
- Weight units: oz, g, kg, lb, lbs
- Volume units: cup, cups, tbsp, tsp, ml, l

Examples of CORRECT formatting:
- Chicken breast: standardAmount=4, standardUnit="oz", qtyInStandardAmount=1
- Salmon fillet: standardAmount=6, standardUnit="oz", qtyInStandardAmount=1
```

#### File: `routes/recipes.js` - fixStandardUnitWithAI (Lines 383-421)

**Changes:**
- Removed "whole" from available units
- Added explicit "DO NOT use: whole, piece, item, unit, fillet, breast"
- Provided examples of correct fixes:
  - "1 fillet (≈170 g)" → amount: 6, unit: "oz"
  - "1 medium breast (174g)" → amount: 174, unit: "g"

#### File: `routes/recipes.js` - find-standard-unit endpoint (Lines 136-174)

**Changes:**
- Same updates as fixStandardUnitWithAI
- Enforces weight/volume units only

### 2. Validation Updates (Detection Layer)

#### File: `routes/recipes.js` - needsStandardUnitFix (Lines 346-375)

**Before:**
```javascript
const validUnits = [
  'lb', 'lbs', 'oz', 'g', 'kg',
  'cup', 'cups', 'tbsp', 'tsp', 'ml', 'l',
  'whole'  // ← Allowed "whole"
];
```

**After:**
```javascript
const validUnits = [
  'oz', 'g', 'kg', 'lb', 'lbs', 'gram', 'grams', 'ounce', 'ounces', 'pound', 'pounds',
  'cup', 'cups', 'tbsp', 'tsp', 'ml', 'l', 'tablespoon', 'tablespoons', 'teaspoon', 'teaspoons'
  // NO "whole", "piece", "item" - must be weight or volume
];

// Added parenthetical description check
if (unit.includes('(') && unit.includes(')') && !validUnits.includes(firstWord)) {
  return true; // Needs fixing
}
```

### 3. Safety Net (Fallback Layer)

#### File: `helpers/elasticsearch.js` (Lines 1598-1636)

**New Function: extractParentheticalWeight**
```javascript
const extractParentheticalWeight = (unitStr) => {
  // Match patterns like "(≈170 g)", "(~4 oz)", "(174g)", "(6 oz)"
  const match = unitStr.match(/\((?:≈|~)?(\d+(?:\.\d+)?)\s*([a-zA-Z]+)\)/i);
  if (match) {
    return {
      amount: parseFloat(match[1]),
      unit: match[2].toLowerCase().trim()
    };
  }
  return null;
};
```

**Usage:**
```javascript
// If direct conversion fails and unit has parentheses
if (rawStandardUnit.includes('(')) {
  const parentheticalWeight = extractParentheticalWeight(rawStandardUnit);
  
  if (parentheticalWeight) {
    // Extract: "(≈170 g)" → 170 g
    // Convert recipe amount to extracted unit
    // Calculate multiplier
    
    if (standardAmount === 1) {
      // Parenthetical weight IS the standard
      multiplier = extractedAmount / parentheticalWeight.amount;
    }
  }
}
```

## How Each Layer Works

### Layer 1: Prevention (AI Prompts)

**When:** Creating new nutritionalInfo records

**What:** AI generates proper format from the start

**Example:**
```
User requests: "salmon fillet"

AI generates:
{
  "standardAmount": 6,
  "standardUnit": "oz",
  "qtyInStandardAmount": 1,
  "calories": 280,
  "proteinG": 40
}
```

**Result:** ✅ Proper format, no issues

### Layer 2: Detection (Validation)

**When:** Recipe resolution looks up ingredient

**What:** Detects bad units and triggers AI fix

**Example:**
```
Existing record:
{
  "standardAmount": 1,
  "standardUnit": "fillet (≈170 g)"
}

needsStandardUnitFix() detects problem → triggers fixStandardUnitWithAI()

AI regenerates:
{
  "standardAmount": 6,
  "standardUnit": "oz",
  "qtyInStandardAmount": 1
}
```

**Result:** ✅ Record fixed during resolution

### Layer 3: Safety Net (Parenthetical Extraction)

**When:** Calculation encounters bad unit that wasn't caught

**What:** Extracts weight from parentheses as fallback

**Example:**
```
Legacy record bypassed validation:
{
  "standardAmount": 1,
  "standardUnit": "fillet (≈170 g)"
}

Recipe: 24 oz

1. Direct conversion fails (fillet not recognized)
2. Base unit extraction fails (fillet not weight/volume)
3. SAFETY NET TRIGGERS
4. Extract: 170 g from "(≈170 g)"
5. Convert: 24 oz → ~680 g
6. Calculate: 680 / 170 = 4x multiplier
```

**Result:** ✅ Calculation succeeds despite bad format

## Testing Scenarios

### Test 1: New Record (Layer 1 - Prevention)

**Setup:**
- Create new nutritionalInfo via OpenAI
- Ingredient: "salmon fillet"

**Expected:**
```json
{
  "standardAmount": 6,
  "standardUnit": "oz",
  "qtyInStandardAmount": 1
}
```

**Recipe Test:**
```
24 oz salmon → 24 / 6 = 4x multiplier ✅
2 fillets → 2 / 1 = 2x multiplier ✅
```

### Test 2: Existing Bad Record Fixed (Layer 2 - Detection)

**Setup:**
- Existing record with bad unit
- Recipe resolution triggers fix

**Before:**
```json
{
  "standardAmount": 1,
  "standardUnit": "fillet (≈170 g)"
}
```

**After (fixStandardUnitWithAI):**
```json
{
  "standardAmount": 6,
  "standardUnit": "oz",
  "qtyInStandardAmount": 1
}
```

**Recipe Test:**
```
24 oz salmon → 24 / 6 = 4x multiplier ✅
```

### Test 3: Legacy Record Fallback (Layer 3 - Safety Net)

**Setup:**
- Legacy record with bad unit
- Not caught by validation (edge case)

**Record:**
```json
{
  "standardAmount": 1,
  "standardUnit": "fillet (≈170 g)",
  "calories": 280
}
```

**Recipe:**
```
24 oz salmon
```

**Process:**
1. Direct conversion: 24 oz → "fillet" ❌ Fails
2. Base unit: "fillet" ❌ Fails
3. Parenthetical extraction: "(≈170 g)" → 170 g ✅
4. Convert: 24 oz → ~680 g
5. Calculate: 680 / 170 = 4x multiplier
6. Nutrition: 280 cal × 4 = 1,120 cal ✅

## Files Modified

### 1. helpers/nutritional-helper-openai.js
- **Lines 227-256:** Updated fetchNutritionalData prompt
- **Changes:** Enforced weight/volume units, added examples

### 2. routes/recipes.js  
- **Lines 136-174:** Updated find-standard-unit endpoint prompt
- **Lines 346-375:** Updated needsStandardUnitFix validation
- **Lines 383-421:** Updated fixStandardUnitWithAI prompt
- **Changes:** Removed "whole" from valid units, added parenthetical check

### 3. helpers/elasticsearch.js
- **Lines 1598-1636:** Added parenthetical weight extraction
- **Changes:** Safety net for legacy records

## Success Metrics

✅ **Prevention:** New records always have proper weight/volume units  
✅ **Detection:** Problematic records fixed during resolution  
✅ **Safety Net:** Legacy records handled gracefully  
✅ **Compatibility:** qtyInStandardAmount bridges count-to-weight  
✅ **Reliability:** No "Cannot convert" errors for common ingredients  
✅ **Flexibility:** Supports weight recipes (oz, g) and count recipes (whole, pieces)  

## Future Enhancements (Optional)

### 1. Proactive Migration Script

Fix all existing bad records:

```javascript
// scripts/fix-nutritional-units.js
const badRecords = await findNutritionalRecordsWithBadUnits();

for (const record of badRecords) {
  const fixed = await fixStandardUnitWithAI(
    record.data.basic.name,
    record.data.nutritionalInfo
  );
  await updateRecord(record.id, fixed);
}
```

### 2. Validation Endpoint

Pre-publish validation:

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

### 3. Monitoring Dashboard

Track:
- New records created with proper units
- fixStandardUnitWithAI trigger frequency
- Parenthetical extraction usage
- Conversion failure rate

## Conclusion

The fix addresses the root cause (AI prompts) while providing robust fallbacks (validation and extraction) for legacy data. This three-layer defense ensures reliable nutritional calculations:

1. **Layer 1 (Prevention):** Stop bad data at the source
2. **Layer 2 (Detection):** Fix bad data during resolution
3. **Layer 3 (Safety Net):** Handle edge cases gracefully

The system now correctly handles both weight-based recipes ("24 oz salmon") and count-based recipes ("2 fillets") through the proper use of `standardUnit` (weight/volume only) and `qtyInStandardAmount` (count bridge).


