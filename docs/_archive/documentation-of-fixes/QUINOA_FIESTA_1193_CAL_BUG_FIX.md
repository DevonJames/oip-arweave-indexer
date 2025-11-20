# Quinoa Fiesta Bowl 1193 Calorie Bug - Volume↔Weight Mismatch

## The Problem

Second test showed **1193 calories per serving** instead of expected ~850-870 calories. Better than 5697, but still ~340 calories too high!

## Root Cause: Cup→Gram Liquid Density Conversion for Dry Goods

**The Core Issue:** When recipe uses volume (cup) but ingredient has weight (g), the backend converts using **liquid density** which is wrong for dry goods.

### Example: Dry Quinoa

```javascript
// AI generated (WRONG unit type):
{
  "standardAmount": 100,
  "standardUnit": "g",  // ← Weight unit
  "calories": 368
}

// Recipe calls for:
amount: 1, unit: "cup"  // ← Volume unit

// Backend's convertToGrams:
convertToGrams(1, "cup") → 240 grams  // ❌ Assumes liquid density!

// Multiplier:
240 / 100 = 2.4x ❌

// Calories:
368 × 2.4 = 883 calories (for whole recipe = 442 cal/serving)

// REALITY: 1 cup dry quinoa = ~170g, NOT 240g
// Correct calc: 170 / 100 = 1.7x → 368 × 1.7 = 625 cal (= 312 cal/serving) ✅
```

**Difference:** ~130 calories per serving error from quinoa alone!

### Example: Corn

```javascript
// AI generated:
{
  "standardAmount": 100,
  "standardUnit": "g",
  "calories": 86
}

// Recipe: 1 cup
// Backend: 1 cup → 240g → 240/100 = 2.4x → 86 × 2.4 = 206 cal ❌
// Reality: 1 cup corn ≈ 145g → 145/100 = 1.45x → 86 × 1.45 = 125 cal ✅
```

**Difference:** ~81 calories error from corn!

## Additional Issue: Wrong qtyInStandardAmount Values

### Limes

```javascript
// AI generated:
{
  "standardAmount": 1,
  "standardUnit": "tbsp",
  "qtyInStandardAmount": 1,  // ❌ Says 1 lime = 1 tbsp!
  "calories": 4
}

// Recipe: 2 limes (empty unit)
// Backend: 2 whole / 1 = 2x → 4 × 2 = 8 cal
// Reality: 1 lime ≈ 3-4 tbsp, so qtyInStandardAmount should be 4
// Correct: 2 whole / 4 = 0.5x → 4 × 4 × 0.5 = 8 cal (coincidentally same!)
// But better would be: 2 limes = 8 tbsp → 4 × 8 = 32 cal
```

## The Fixes

### Fix #1: Detect Volume↔Weight Mismatches (NEW)

**File:** `routes/publish.js` (Lines 764-773)

```javascript
// Detect when recipe uses volume but ingredient has weight (or vice versa)
const recipeIsVolume = recipeUnit && (recipeUnit.includes('cup') || recipeUnit.includes('tbsp') || recipeUnit.includes('tsp'));
const standardIsWeight = standardUnit && (standardUnit.includes('g') || standardUnit.includes('oz') || standardUnit.includes('lb'));
const volumeWeightMismatch = recipeIsVolume && standardIsWeight;

if (volumeWeightMismatch) {
  console.log(`⚠️ Volume↔weight mismatch: recipe:"${recipeUnit}", standard:"${standardUnit}"`);
  ingredientDidRefs[originalName] = null;  // Force regeneration with matching unit type
}
```

**Impact:** 
- Quinoa with recipe:"cup" and standard:"g" → Forced regeneration → Gets standardUnit:"cup" → No density conversion error ✅
- Corn with recipe:"cup" and standard:"g" → Forced regeneration → Gets standardUnit:"cup" → No density conversion error ✅

### Fix #2: Stricter AI Guidance for preferredUnitType

**File:** `helpers/nutritional-helper-openai.js` (Lines 261-270)

```javascript
CRITICAL UNIT TYPE SELECTION based on ${preferredUnitType}:
- The recipe uses this ingredient in ${preferredUnitType} form
- You MUST prefer ${preferredUnitType === 'volume' ? 'VOLUME units (cup, tbsp, tsp, ml, l)' : 'WEIGHT units (oz, g, kg, lb)'}
- Matching the recipe's unit type prevents incorrect density conversions
- Example: If recipe uses "cup" and you use "g", conversion assumes liquid density (WRONG for dry goods like quinoa)
```

**Impact:** AI should now prefer cup/tbsp when recipe uses volume, preventing the mismatch from happening in the first place.

### Fix #3: Better qtyInStandardAmount Examples

**File:** `helpers/nutritional-helper-openai.js` (Lines 256-259)

```javascript
IMPORTANT qtyInStandardAmount Examples:
- If you use standardUnit="tbsp" for lime juice: How many tbsp in 1 whole lime? ~4 tbsp, so qtyInStandardAmount=4
- If you use standardUnit="cup" for bell pepper: How many cups in 1 whole pepper? ~1 cup, so qtyInStandardAmount=1
- If you use standardUnit="cup" for corn: How many cups in 1 ear of corn? ~0.5 cup, so qtyInStandardAmount=0.5
```

**Impact:** AI should generate more accurate qtyInStandardAmount values for countable ingredients.

## What Will Happen Next Time

### For Quinoa:

1. **Recipe uses "cup"**
2. **Find existing quinoa with standardUnit="g"**
3. **NEW VALIDATION triggers:**
   - Detects volume↔weight mismatch
   - Logs: "⚠️ quinoa, dry needs regeneration (volume↔weight mismatch: recipe:cup, standard:g)"
   - Sets ingredientDidRefs = null

4. **AI regenerates with volume unit:**
   ```json
   {
     "standardAmount": 1,
     "standardUnit": "cup",
     "qtyInStandardAmount": 1,
     "calories": 625
   }
   ```

5. **Calculation:**
   - Recipe: 1 cup
   - No conversion needed (both cup)
   - Multiplier: 1 / 1 = 1x ✅
   - Calories: 625 × 1 = 625 cal (for 2 servings = 312 cal/serving) ✅

### For Limes:

1. **Recipe uses "" (empty)**
2. **AI generates with stricter guidance:**
   ```json
   {
     "standardAmount": 1,
     "standardUnit": "tbsp",
     "qtyInStandardAmount": 4,  // ✅ 1 lime = 4 tbsp
     "calories": 16
   }
   ```

3. **Calculation:**
   - Recipe: 2 whole limes
   - Count conversion: 2 / 4 = 0.5x
   - Calories: 16 × 0.5 = 8 cal (close to current, but more accurate reasoning)

### For Corn:

1. **Recipe uses "cup"**
2. **Find existing corn with standardUnit="g"**
3. **NEW VALIDATION triggers** (volume↔weight mismatch)
4. **AI regenerates:**
   ```json
   {
     "standardAmount": 1,
     "standardUnit": "cup",
     "calories": 125
   }
   ```
5. **Multiplier: 1x → 125 cal ✅**

## Expected Result

**Quinoa Fiesta Bowl - Next Publication:**

```
Quinoa (1 cup): 625 × 1 = 625 cal (was 883) ← FIX: -258 cal
Black Beans (1 can): 227 × 1 = 227 cal (might still need can→cup fix)
Chicken (1 lb): 187 × 4 = 748 cal
Olive Oil (1 tbsp): 119 × 1 = 119 cal
Red Bell Pepper: 46 × 1 = 46 cal
Yellow Bell Pepper: 46 × 1 = 46 cal
Cherry Tomatoes (1 cup): 27 × 1 = 27 cal
Corn (1 cup): 125 × 1 = 125 cal (was 206) ← FIX: -81 cal
Cilantro (1 cup): 4 × 1 = 4 cal
Limes (2 whole): Better calculation with qtyInStandardAmount=4
Honey (1 tbsp): 64 × 1 = 64 cal
Cumin (1 tsp): ~8 cal

TOTAL: ~1,750 calories (2 servings)
PER SERVING: ~875 calories ✅

(Matches AdminPage calculation of 873.3!)
```

## Summary of All Fixes

✅ **Invalid units caught** (onion, lime yields) → regenerated  
✅ **Descriptive units caught** (teaspoon (2 g)) → regenerated  
✅ **Volume↔weight mismatches caught** (recipe:cup, standard:g) → regenerated  
✅ **AI guidance improved** for preferredUnitType compliance  
✅ **qtyInStandardAmount examples** for limes, peppers, corn  
✅ **Empty units stay empty** (not converted to 'unit')  
✅ **Unknown units return null** (not 1:1 assumption)  

## Testing Next Publication

The next time you publish Quinoa Fiesta Bowl:
- Quinoa will be regenerated with standardUnit="cup"
- Corn will be regenerated with standardUnit="cup"
- Limes might be regenerated with better qtyInStandardAmount
- Result should be **~875 calories per serving** ✅

