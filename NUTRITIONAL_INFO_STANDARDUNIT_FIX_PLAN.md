# Nutritional Info standardUnit Fix Plan

## Problem Summary

The recipe nutritional calculation system breaks when LLMs generate `standardUnit` values that aren't actual weight or volume units. For example:

**Problematic Case (Salmon):**
```json
{
  "standardAmount": 1,
  "standardUnit": "fillet (≈170 g)",
  "qtyInStandardAmount": 1
}
```

When a recipe calls for "24 oz" of salmon, the system cannot convert because:
- Recipe wants: 24 oz (weight)
- Standard is: "1 fillet (≈170 g)" (not a recognized unit)
- Result: Ingredient skipped, no nutritional data calculated

## Root Cause Analysis

### 1. AI Prompt Issues (Two Locations)

#### Location 1: `helpers/nutritional-helper-openai.js` (fetchNutritionalData)
**Lines 207-360**

Current prompt allows descriptive units:
```
- For items typically counted: describe the count with weight (e.g., "1 medium breast (174g)", "1 whole avocado (150g)")
```

This prompt actually **encourages** the problematic format!

#### Location 2: `routes/recipes.js` (fixStandardUnitWithAI)
**Lines 364-441**

This function can regenerate standardUnit if problematic, but the prompt has the same issue - it allows descriptive formats.

### 2. Calculation Logic Issues

The `calculateRecipeNutrition` function in `helpers/elasticsearch.js` (lines 1486-1744) has multiple conversion strategies:

1. **Direct unit conversion** (line 1586) - Fails with descriptive units
2. **Base unit extraction** (lines 1589-1596) - Tries to extract "fillet" from "fillet (≈170 g)" but "fillet" is not a weight/volume unit
3. **qtyInStandardAmount conversion** (lines 1601-1607) - Only works if recipe unit is count-based
4. **Standard descriptor extraction** (lines 1608-1616) - Tries to parse "(1 medium breast)" but fails with "(≈170 g)"

## The Correct Design Pattern

### What Should Happen

**For Weight/Volume Ingredients (meats, liquids, grains):**
```json
{
  "standardAmount": 4,
  "standardUnit": "oz",
  "qtyInStandardAmount": 1  // 1 fillet = 4 oz
}
```

**For Count Ingredients (eggs, apples):**
```json
{
  "standardAmount": 182,
  "standardUnit": "g",
  "qtyInStandardAmount": 1  // 1 apple = 182g
}
```

**For Container Ingredients (canned beans):**
```json
{
  "standardAmount": 15,
  "standardUnit": "oz",
  "qtyInStandardAmount": 1  // 1 can = 15 oz
}
```

### Key Rule

**standardAmount + standardUnit must ALWAYS be weight or volume.**

The `qtyInStandardAmount` field bridges the gap when recipes use counts.

## Implementation Plan

### Fix 1: Update fetchNutritionalData Prompt

**File:** `helpers/nutritional-helper-openai.js`
**Lines:** 227-246

**Change the prompt to:**
```javascript
content: `What is the nutritional information for "${ingredientName}"?

CRITICAL RULES FOR STANDARD UNITS:
1. standardAmount and standardUnit MUST be weight (oz, g, kg, lb) or volume (cup, tbsp, tsp, ml, l)
2. NEVER use descriptive units like "fillet (≈170 g)" or "1 medium breast (174g)"
3. Extract the actual weight/volume from descriptions

Examples:
- For "1 medium chicken breast (174g)" → standardAmount: 174, standardUnit: "g"
- For "1 fillet (≈170 g)" → standardAmount: 4, standardUnit: "oz" (convert ~170g to oz)
- For "1 cup diced (≈150g)" → standardAmount: 1, standardUnit: "cup"

qtyInStandardAmount Field:
- How many whole items equal the standard amount
- For chicken breast at 174g standard: qtyInStandardAmount = 1 (1 breast = 174g)
- For avocado at 1 cup diced: qtyInStandardAmount = 2 (2 avocados = 1 cup diced)
- For liquids with no discrete count: qtyInStandardAmount = 1

Valid standardUnit values ONLY:
- Weight: oz, g, kg, lb, lbs
- Volume: cup, cups, tbsp, tsp, ml, l

Provide complete nutritional data: calories, protein, fat, saturated fat, trans fat, cholesterol, sodium, carbohydrates, fiber, sugars, added sugars, potassium, calcium, iron, vitamins A/C/D, allergens, gluten-free, organic status.`
```

### Fix 2: Update fixStandardUnitWithAI Prompt

**File:** `routes/recipes.js`
**Lines:** 372-399

**Update the prompt to:**
```javascript
const prompt = `You are a nutrition expert. Fix the non-standard unit for "${ingredientName}".

Current: ${nutritionalInfo.standardAmount} ${nutritionalInfo.standardUnit}

Nutritional Values:
- Calories: ${nutritionalInfo.calories}
- Protein: ${nutritionalInfo.proteinG}g
- Fat: ${nutritionalInfo.fatG}g
- Carbs: ${nutritionalInfo.carbohydratesG}g

CRITICAL RULES:
1. standardAmount and standardUnit MUST be weight (oz, g, kg, lb) or volume (cup, tbsp, tsp, ml, l)
2. NEVER use descriptive units like "fillet (≈170 g)" or "1 medium breast"
3. Convert descriptive units to actual weight/volume

Examples:
- "1 fillet (≈170 g)" → amount: 4, unit: "oz" (or 170, "g")
- "1 medium breast (174g)" → amount: 174, unit: "g"
- "1 cup diced" → amount: 1, unit: "cup"

For MEATS: Use weight (${weightUnits.join(', ')})
For LIQUIDS: Use volume (${volumeUnits.join(', ')})
For OTHER SOLIDS: Use volume (${volumeUnits.join(', ')})

Available units: ${weightUnits.join(', ')}, ${volumeUnits.join(', ')}

Respond ONLY with JSON:
{
  "amount": <number>,
  "unit": "<weight or volume unit only>",
  "reasoning": "<brief explanation>"
}`;
```

### Fix 3: Improve Calculation Logic Fallback

**File:** `helpers/elasticsearch.js`
**Lines:** 1568-1654

Add better handling for when standardUnit contains weight in parentheses:

```javascript
// NEW: Extract weight from parenthetical descriptions like "(≈170 g)"
const extractParentheticalWeight = (standardUnitStr) => {
    // Match patterns like "(≈170 g)", "(~4 oz)", "(174g)"
    const match = standardUnitStr.match(/\((?:≈|~)?(\d+(?:\.\d+)?)\s*([a-z]+)\)/i);
    if (match) {
        return {
            amount: parseFloat(match[1]),
            unit: match[2].toLowerCase().trim()
        };
    }
    return null;
};

const parentheticalWeight = extractParentheticalWeight(rawStandardUnit);

// If standardUnit is non-standard but has weight in parentheses, use that
if (parentheticalWeight && (convertedAmount === null || convertedAmount === undefined || isNaN(convertedAmount))) {
    console.log(`⚙️ Extracting weight from parentheses: ${rawStandardUnit} → ${parentheticalWeight.amount} ${parentheticalWeight.unit}`);
    
    // Try conversion using the extracted weight
    const extractedAmount = convertUnits(recipeAmount, cleanRecipeUnit, parentheticalWeight.unit);
    if (extractedAmount !== null && extractedAmount !== undefined && !isNaN(extractedAmount)) {
        multiplier = extractedAmount / parentheticalWeight.amount;
        conversionMethod = `parenthetical weight extraction (${parentheticalWeight.amount} ${parentheticalWeight.unit})`;
        console.log(`✅ Parenthetical weight conversion succeeded`);
    }
}
```

Add this logic after line 1596 (after base unit extraction fails).

## Testing Plan

### Test Case 1: Salmon with "fillet (≈170 g)"
**Before Fix:**
- standardAmount: 1, standardUnit: "fillet (≈170 g)"
- Recipe: 24 oz
- Result: Skipped (cannot convert)

**After Fix:**
- standardAmount: 4, standardUnit: "oz" (or 170, "g")
- qtyInStandardAmount: 1
- Recipe: 24 oz
- Result: Calculated (24 oz / 4 oz = 6x multiplier)

### Test Case 2: Chicken Breast
**Before Fix:**
- standardAmount: 1, standardUnit: "medium breast (174g)"
- Recipe: 2 whole
- Result: Inconsistent

**After Fix:**
- standardAmount: 174, standardUnit: "g"
- qtyInStandardAmount: 1
- Recipe: 2 whole → Uses qtyInStandardAmount conversion (2 / 1 = 2x multiplier)

### Test Case 3: Canned Beans
**Correct Format:**
- standardAmount: 15, standardUnit: "oz"
- qtyInStandardAmount: 1
- Recipe: 2 cans → Uses qtyInStandardAmount conversion (2 / 1 = 2x multiplier)

## Implementation Order

1. ✅ **Document the fix** (this file)
2. **Update fetchNutritionalData prompt** (highest priority - prevents new bad records)
3. **Update fixStandardUnitWithAI prompt** (fixes existing bad records during resolution)
4. **Add parenthetical weight extraction** (safety net for existing bad records)
5. **Test with real recipes**
6. **Consider migration script** for existing bad nutritionalInfo records

## Additional Considerations

### Migration of Existing Records

Consider creating a script to:
1. Find all nutritionalInfo records with non-standard standardUnit
2. Use fixStandardUnitWithAI to regenerate proper values
3. Update records in Elasticsearch

### Validation Function

Add a validation function that can be called before publishing:

```javascript
function validateNutritionalInfo(nutritionalInfo) {
    const validWeightUnits = ['oz', 'g', 'kg', 'lb', 'lbs'];
    const validVolumeUnits = ['cup', 'cups', 'tbsp', 'tsp', 'ml', 'l'];
    const validUnits = [...validWeightUnits, ...validVolumeUnits];
    
    const cleanUnit = parseUnit(nutritionalInfo.standardUnit);
    const normalizedUnit = normalizeUnit(cleanUnit);
    
    if (!validUnits.includes(normalizedUnit)) {
        return {
            valid: false,
            reason: `standardUnit "${nutritionalInfo.standardUnit}" is not a valid weight/volume unit`,
            suggestion: "Use weight (oz, g, kg, lb) or volume (cup, tbsp, tsp, ml, l)"
        };
    }
    
    return { valid: true };
}
```

## Success Criteria

- ✅ New nutritionalInfo records always have weight/volume standardUnit
- ✅ Existing problematic records get fixed during recipe resolution
- ✅ Recipes can successfully calculate nutrition when using weight units (oz, g)
- ✅ Recipes can successfully calculate nutrition when using count units (whole, pieces)
- ✅ qtyInStandardAmount properly bridges count-to-weight conversions
- ✅ No more "Cannot convert" errors for common ingredients


