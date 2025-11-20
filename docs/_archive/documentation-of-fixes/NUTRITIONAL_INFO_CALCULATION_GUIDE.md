# Recipe Nutritional Calculation System - Complete Guide

## Table of Contents
1. [Overview](#overview)
2. [The Problem We Solved](#the-problem-we-solved)
3. [Core Concepts](#core-concepts)
4. [How Recipe Nutritional Calculations Work](#how-recipe-nutritional-calculations-work)
5. [Implementation Details](#implementation-details)
6. [Testing Scenarios](#testing-scenarios)
7. [Files Modified](#files-modified)

## Overview

This guide explains how the OIP system calculates nutritional information for recipes by combining ingredient nutritional data with recipe amounts to produce accurate `summaryNutritionalInfoPerServing` values.

## The Problem We Solved

### The Issue

When LLMs created nutritional info records, they sometimes generated `standardUnit` values like **"fillet (≈170 g)"** or **"1 medium breast (174g)"** instead of actual weight/volume units. This broke recipe calculations.

**Example - Salmon Recipe Failure:**
```json
// Problematic nutritionalInfo record
{
  "name": "Salmon Fillet",
  "standardAmount": 1,
  "standardUnit": "fillet (≈170 g)",  // ❌ Not a valid unit
  "qtyInStandardAmount": 1,
  "calories": 280,
  "proteinG": 40
}

// Recipe calls for:
{
  "ingredient": ["did:arweave:salmon-fillet-id"],
  "ingredient_amount": [24],
  "ingredient_unit": ["oz"]
}

// Result: ❌ Cannot convert 24 oz to "fillet" → Ingredient skipped
```

### The Solution

**Three-Layer Fix:**
1. **Prevention:** Updated AI prompts to enforce weight/volume units only
2. **Detection:** Enhanced validation to catch problematic units during recipe resolution
3. **Safety Net:** Added parenthetical weight extraction for legacy records

**Core Rule:**
> `standardAmount` + `standardUnit` MUST ALWAYS be weight (oz, g, kg, lb) or volume (cup, tbsp, tsp, ml, l)

## Core Concepts

### The Three Required Fields

Every nutritionalInfo record needs these three fields to work with recipe calculations:

#### 1. standardAmount (number)
The quantity that the nutritional values are based on.

**Examples:**
- `4` (4 ounces)
- `182` (182 grams)
- `1` (1 cup)

#### 2. standardUnit (string)
The unit for the standardAmount - MUST be weight or volume.

**Valid Weight Units:** oz, g, kg, lb, lbs  
**Valid Volume Units:** cup, cups, tbsp, tsp, ml, l

**Examples:**
- `"oz"` ✅
- `"g"` ✅
- `"cup"` ✅
- `"fillet (≈170 g)"` ❌ (Not valid - descriptive)
- `"whole"` ❌ (Not valid - count-based)

#### 3. qtyInStandardAmount (number)
How many whole/discrete items equal the standardAmount. Bridges count-based recipes.

**Examples:**
- For "4 oz" of chicken breast where 1 breast = 4 oz: `qtyInStandardAmount = 1`
- For "1 cup diced" avocado where 2 avocados = 1 cup: `qtyInStandardAmount = 2`
- For olive oil (no discrete count): `qtyInStandardAmount = 1`

### Correct Record Examples

#### Weight-Based Ingredient (Salmon)
```json
{
  "data": {
    "basic": {
      "name": "Salmon Fillet"
    },
    "nutritionalInfo": {
      "standardAmount": 4,
      "standardUnit": "oz",
      "qtyInStandardAmount": 1,  // 1 fillet = 4 oz
      "calories": 140,
      "proteinG": 25,
      "fatG": 5,
      "carbohydratesG": 0,
      "sodiumMg": 50,
      "cholesterolMg": 60
    }
  }
}
```

#### Count-Based Ingredient (Apple)
```json
{
  "data": {
    "basic": {
      "name": "Apple"
    },
    "nutritionalInfo": {
      "standardAmount": 182,
      "standardUnit": "g",
      "qtyInStandardAmount": 1,  // 1 apple = 182g
      "calories": 95,
      "proteinG": 0.5,
      "fatG": 0.3,
      "carbohydratesG": 25,
      "sodiumMg": 2,
      "cholesterolMg": 0
    }
  }
}
```

#### Volume-Based Ingredient (Diced Avocado)
```json
{
  "data": {
    "basic": {
      "name": "Diced Avocado"
    },
    "nutritionalInfo": {
      "standardAmount": 1,
      "standardUnit": "cup",
      "qtyInStandardAmount": 2,  // 2 whole avocados = 1 cup diced
      "calories": 240,
      "proteinG": 3,
      "fatG": 22,
      "carbohydratesG": 13,
      "sodiumMg": 11,
      "cholesterolMg": 0
    }
  }
}
```

## How Recipe Nutritional Calculations Work

### Step-by-Step Process

#### Step 1: Recipe Data Structure

A recipe contains parallel arrays for ingredients:

```json
{
  "data": {
    "basic": {
      "name": "Grilled Salmon Bowl"
    },
    "recipe": {
      "servings": 4,
      "ingredient": [
        "did:arweave:salmon-id",
        "did:arweave:avocado-id",
        "did:arweave:rice-id"
      ],
      "ingredient_amount": [24, 2, 2],
      "ingredient_unit": ["oz", "whole", "cup"],
      "ingredient_comment": ["", "", "cooked"]
    }
  }
}
```

#### Step 2: Ingredient Resolution

For each ingredient, the system resolves the DID to get the full nutritionalInfo:

```javascript
// Example: Resolve salmon DID
const salmonRecord = await getRecordByDid("did:arweave:salmon-id");
const nutritionalInfo = salmonRecord.data.nutritionalInfo;

// Extract needed values
const standardAmount = 4;           // 4 oz
const standardUnit = "oz";
const qtyInStandardAmount = 1;      // 1 fillet
const calories = 140;               // per 4 oz
const proteinG = 25;                // per 4 oz
```

#### Step 3: Unit Conversion

The system converts the recipe amount to match the standardAmount:

```javascript
// Recipe wants: 24 oz
// Standard is: 4 oz
// Conversion: Direct (both are oz)

const recipeAmount = 24;  // from ingredient_amount[0]
const recipeUnit = "oz";  // from ingredient_unit[0]

// Convert recipe amount to standard unit
const convertedAmount = convertUnits(24, "oz", "oz");  // → 24

// Calculate multiplier
const multiplier = convertedAmount / standardAmount;  // 24 / 4 = 6
```

#### Step 4: Nutritional Value Calculation

Multiply the standardAmount nutritional values by the multiplier:

```javascript
const contribution = {
  calories: 140 * 6 = 840,
  proteinG: 25 * 6 = 150,
  fatG: 5 * 6 = 30,
  carbohydratesG: 0 * 6 = 0,
  sodiumMg: 50 * 6 = 300,
  cholesterolMg: 60 * 6 = 360
};
```

#### Step 5: Sum All Ingredients

Repeat steps 2-4 for all ingredients and sum the contributions:

```javascript
// Salmon (24 oz)
totals.calories += 840;
totals.proteinG += 150;

// Avocado (2 whole)
// standardAmount: 1 cup, qtyInStandardAmount: 2
// Recipe: 2 whole → multiplier = 2 / 2 = 1
totals.calories += 240 * 1 = 240;
totals.proteinG += 3 * 1 = 3;

// Rice (2 cups)
totals.calories += 400;
totals.proteinG += 8;

// TOTALS for 4 servings:
totals = {
  calories: 1480,
  proteinG: 161,
  fatG: 52,
  carbohydratesG: 78,
  sodiumMg: 450,
  cholesterolMg: 360
};
```

#### Step 6: Calculate Per-Serving Values

Divide totals by number of servings:

```javascript
const servings = 4;

const summaryNutritionalInfoPerServing = {
  calories: Math.round(1480 / 4) = 370,
  proteinG: Math.round(161 / 4 * 10) / 10 = 40.3,
  fatG: Math.round(52 / 4 * 10) / 10 = 13.0,
  carbohydratesG: Math.round(78 / 4 * 10) / 10 = 19.5,
  sodiumMg: Math.round(450 / 4) = 113,
  cholesterolMg: Math.round(360 / 4) = 90
};
```

#### Step 7: Add to Recipe Record

The calculated values are added to the recipe record:

```json
{
  "data": {
    "basic": {
      "name": "Grilled Salmon Bowl"
    },
    "recipe": {
      "servings": 4,
      "ingredient": [...],
      "ingredient_amount": [24, 2, 2],
      "ingredient_unit": ["oz", "whole", "cup"]
    },
    "summaryNutritionalInfoPerServing": {
      "calories": 370,
      "proteinG": 40.3,
      "fatG": 13.0,
      "carbohydratesG": 19.5,
      "sodiumMg": 113,
      "cholesterolMg": 90
    },
    "summaryNutritionalInfo": {
      "calories": 1480,
      "proteinG": 161,
      "fatG": 52,
      "carbohydratesG": 78,
      "sodiumMg": 450,
      "cholesterolMg": 360
    }
  }
}
```

### Conversion Strategies

The system uses multiple conversion strategies in priority order:

#### 1. Direct Unit Conversion (Highest Priority)

When recipe unit and standard unit are both weight or both volume:

```javascript
// Example: Recipe wants 24 oz, standard is 4 oz
convertUnits(24, "oz", "oz") → 24
multiplier = 24 / 4 = 6
```

#### 2. Count-to-Weight via qtyInStandardAmount

When recipe uses count units (whole, pieces) and standard is weight/volume:

```javascript
// Example: Recipe wants 2 whole avocados
// Standard: 1 cup, qtyInStandardAmount: 2 (2 avocados = 1 cup)
multiplier = 2 / 2 = 1  // Recipe amount / qtyInStandardAmount
```

#### 3. Parenthetical Weight Extraction (Safety Net)

When standardUnit has weight in parentheses (legacy records):

```javascript
// Example: standardUnit = "fillet (≈170 g)"
// Recipe wants 24 oz

// Extract: 170 g from "(≈170 g)"
// Convert: 24 oz → ~680 g
// Calculate: 680 / 170 = 4
multiplier = 4
```

#### 4. Gram Conversion (Fallback)

When units are different but both convertible to grams:

```javascript
// Example: Recipe wants 1 lb, standard is 500 g
const recipeGrams = convertToGrams(1, "lb");  // → 453.592
const standardGrams = convertToGrams(500, "g");  // → 500
multiplier = 453.592 / 500 = 0.91
```

### Real-World Example: Complete Recipe Calculation

**Recipe: Salmon Salad (2 servings)**

```json
{
  "recipe": {
    "servings": 2,
    "ingredient": [
      "did:arweave:salmon-id",
      "did:arweave:lettuce-id",
      "did:arweave:olive-oil-id"
    ],
    "ingredient_amount": [12, 3, 2],
    "ingredient_unit": ["oz", "cup", "tbsp"]
  }
}
```

**Ingredient 1: Salmon**
```json
{
  "standardAmount": 4,
  "standardUnit": "oz",
  "qtyInStandardAmount": 1,
  "calories": 140,
  "proteinG": 25,
  "fatG": 5
}
```
- Recipe: 12 oz
- Conversion: 12 oz / 4 oz = 3x multiplier
- Contribution: 140 × 3 = 420 cal, 25 × 3 = 75g protein

**Ingredient 2: Lettuce**
```json
{
  "standardAmount": 1,
  "standardUnit": "cup",
  "qtyInStandardAmount": 1,
  "calories": 5,
  "proteinG": 0.5,
  "fatG": 0.1
}
```
- Recipe: 3 cups
- Conversion: 3 cups / 1 cup = 3x multiplier
- Contribution: 5 × 3 = 15 cal, 0.5 × 3 = 1.5g protein

**Ingredient 3: Olive Oil**
```json
{
  "standardAmount": 1,
  "standardUnit": "tbsp",
  "qtyInStandardAmount": 1,
  "calories": 120,
  "proteinG": 0,
  "fatG": 14
}
```
- Recipe: 2 tbsp
- Conversion: 2 tbsp / 1 tbsp = 2x multiplier
- Contribution: 120 × 2 = 240 cal, 0 × 2 = 0g protein

**Total for Recipe (2 servings):**
- Calories: 420 + 15 + 240 = 675
- Protein: 75 + 1.5 + 0 = 76.5g
- Fat: 15 + 0.3 + 28 = 43.3g

**Per Serving (1 of 2):**
```json
{
  "summaryNutritionalInfoPerServing": {
    "calories": 338,      // 675 / 2
    "proteinG": 38.3,     // 76.5 / 2
    "fatG": 21.7          // 43.3 / 2
  }
}
```

## Implementation Details

### Prevention Layer: AI Prompt Updates

**File:** `helpers/nutritional-helper-openai.js` (Lines 227-256)

**Updated Prompt:**
```javascript
content: `What is the nutritional information for "${ingredientName}"?

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
- Apple: standardAmount=182, standardUnit="g", qtyInStandardAmount=1
...`
```

**Also Updated:**
- `routes/recipes.js` - fixStandardUnitWithAI prompt (Lines 383-421)
- `routes/recipes.js` - find-standard-unit endpoint prompt (Lines 136-174)

### Detection Layer: Validation

**File:** `routes/recipes.js` - needsStandardUnitFix (Lines 346-375)

```javascript
function needsStandardUnitFix(nutritionalInfo, ingredientName) {
  if (!nutritionalInfo || !nutritionalInfo.standardUnit) {
    return false;
  }
  
  const unit = nutritionalInfo.standardUnit.toLowerCase();
  
  // Valid weight and volume units ONLY
  const validUnits = [
    'oz', 'g', 'kg', 'lb', 'lbs', 'gram', 'grams', 'ounce', 'ounces', 'pound', 'pounds',
    'cup', 'cups', 'tbsp', 'tsp', 'ml', 'l', 'tablespoon', 'tablespoons', 'teaspoon', 'teaspoons'
  ];
  
  const firstWord = unit.trim().split(' ')[0].split('(')[0];
  
  if (!validUnits.includes(firstWord)) {
    console.log(`⚠️ Non-standard unit detected: "${nutritionalInfo.standardUnit}"`);
    return true;  // Triggers fixStandardUnitWithAI
  }
  
  return false;
}
```

### Safety Net Layer: Parenthetical Extraction

**File:** `helpers/elasticsearch.js` (Lines 1598-1636)

```javascript
// Extract weight from parenthetical descriptions like "(≈170 g)" or "(6 oz)"
const extractParentheticalWeight = (unitStr) => {
  const match = unitStr.match(/\((?:≈|~)?(\d+(?:\.\d+)?)\s*([a-zA-Z]+)\)/i);
  if (match) {
    return {
      amount: parseFloat(match[1]),
      unit: match[2].toLowerCase().trim()
    };
  }
  return null;
};

if (rawStandardUnit.includes('(')) {
  const parentheticalWeight = extractParentheticalWeight(rawStandardUnit);
  
  if (parentheticalWeight) {
    console.log(`⚙️ Extracting weight from parentheses: "${rawStandardUnit}" → ${parentheticalWeight.amount} ${parentheticalWeight.unit}`);
    
    const extractedAmount = convertUnits(recipeAmount, cleanRecipeUnit, parentheticalWeight.unit);
    if (extractedAmount !== null && !isNaN(extractedAmount)) {
      if (standardAmount === 1) {
        multiplier = extractedAmount / parentheticalWeight.amount;
      } else {
        multiplier = extractedAmount / standardAmount;
      }
      console.log(`✅ Parenthetical weight conversion succeeded: ${multiplier}x standard`);
    }
  }
}
```

### Core Calculation Function

**File:** `helpers/elasticsearch.js` - calculateRecipeNutrition (Lines 1486-1744)

```javascript
const calculateRecipeNutrition = async (ingredients, servings, recordsInDB = []) => {
  const totals = { calories: 0, proteinG: 0, fatG: 0, carbohydratesG: 0, sodiumMg: 0, cholesterolMg: 0 };
  
  for (let i = 0; i < ingredients.length; i++) {
    const ingredient = ingredients[i];
    let nutritionalInfo = ingredient.nutritionalInfo;
    
    // Resolve DID if needed
    if (!nutritionalInfo && ingredient.did) {
      const record = recordsInDB.find(r => r.oip.didTx === ingredient.did);
      nutritionalInfo = record?.data?.nutritionalInfo;
    }
    
    if (!nutritionalInfo) continue;
    
    const standardAmount = nutritionalInfo.standardAmount;
    const rawStandardUnit = nutritionalInfo.standardUnit;
    const qtyInStandardAmount = nutritionalInfo.qtyInStandardAmount || 1;
    const recipeAmount = ingredient.amount;
    const recipeUnit = ingredient.unit;
    
    // Calculate multiplier using conversion strategies
    let multiplier = calculateMultiplier(recipeAmount, recipeUnit, standardAmount, rawStandardUnit, qtyInStandardAmount);
    
    // Calculate contribution
    totals.calories += (nutritionalInfo.calories || 0) * multiplier;
    totals.proteinG += (nutritionalInfo.proteinG || 0) * multiplier;
    totals.fatG += (nutritionalInfo.fatG || 0) * multiplier;
    totals.carbohydratesG += (nutritionalInfo.carbohydratesG || 0) * multiplier;
    totals.sodiumMg += (nutritionalInfo.sodiumMg || 0) * multiplier;
    totals.cholesterolMg += (nutritionalInfo.cholesterolMg || 0) * multiplier;
  }
  
  return {
    perServing: {
      calories: Math.round(totals.calories / servings),
      proteinG: Math.round(totals.proteinG / servings * 10) / 10,
      fatG: Math.round(totals.fatG / servings * 10) / 10,
      carbohydratesG: Math.round(totals.carbohydratesG / servings * 10) / 10,
      sodiumMg: Math.round(totals.sodiumMg / servings),
      cholesterolMg: Math.round(totals.cholesterolMg / servings)
    },
    total: totals
  };
};
```

## Testing Scenarios

### Test 1: Weight-Based Recipe (24 oz Salmon)

**Ingredient Record:**
```json
{
  "standardAmount": 4,
  "standardUnit": "oz",
  "calories": 140,
  "proteinG": 25
}
```

**Recipe:**
```json
{
  "ingredient_amount": [24],
  "ingredient_unit": ["oz"],
  "servings": 4
}
```

**Calculation:**
- Multiplier: 24 oz / 4 oz = 6
- Total: 140 cal × 6 = 840 cal
- Per serving: 840 / 4 = 210 cal ✅

### Test 2: Count-Based Recipe (2 Apples)

**Ingredient Record:**
```json
{
  "standardAmount": 182,
  "standardUnit": "g",
  "qtyInStandardAmount": 1,
  "calories": 95
}
```

**Recipe:**
```json
{
  "ingredient_amount": [2],
  "ingredient_unit": ["whole"],
  "servings": 1
}
```

**Calculation:**
- Multiplier: 2 whole / 1 whole = 2 (using qtyInStandardAmount)
- Total: 95 cal × 2 = 190 cal
- Per serving: 190 / 1 = 190 cal ✅

### Test 3: Legacy Record with Parenthetical (Safety Net)

**Ingredient Record (Legacy):**
```json
{
  "standardAmount": 1,
  "standardUnit": "fillet (≈170 g)",
  "calories": 280
}
```

**Recipe:**
```json
{
  "ingredient_amount": [24],
  "ingredient_unit": ["oz"],
  "servings": 2
}
```

**Calculation:**
- Direct conversion fails
- Safety net: Extract 170 g from "(≈170 g)"
- Convert: 24 oz → ~680 g
- Multiplier: 680 / 170 = 4
- Total: 280 cal × 4 = 1,120 cal
- Per serving: 1,120 / 2 = 560 cal ✅

## Critical Bugs Fixed (Nov 2025 - Quinoa Bowl 5697 cal Issue)

### Bug #1: Unknown Units Assumed 1:1 Ratio (MAJOR - Caused 5697 cal Error)

**The Core Issue:** Existing nutritional records in the database had invalid `standardUnit` values like "onion", "lime yields", "avocado, NS as to Florida" that weren't being caught and regenerated.

**Real-World Example from Quinoa Bowl Recipe:**
```javascript
// Red onion record in database had:
standardUnit: "onion"  // ❌ Invalid unit!
standardAmount: 1
calories: 40

// Recipe called for: 1 cup red onion

// convertToGrams tried to convert:
convertToGrams(1, "cup") → 240 grams
convertToGrams(1, "onion") → 1 (old code assumed 1:1 ratio!)

// multiplier calculation:
240 / 1 = 240x multiplier ❌❌❌

// calories:
40 × 240 = 9,600 calories from ONE CUP OF ONION!
```

**The Two-Part Fix:**

**Part A - Prevent Bogus Multipliers:**
```javascript
// File: helpers/elasticsearch.js (Lines 1214-1218)

// OLD (DANGEROUS):
console.warn(`Unknown unit for conversion: ${unit}, assuming 1:1 ratio`);
return amount;  // ❌ Caused 240x multipliers!

// NEW (SAFE):
console.warn(`❌ Unknown unit for conversion: ${unit}, cannot convert (returning null)`);
return null;  // ✅ Fails gracefully, ingredient gets skipped
```

**Part B - Catch Bad Records Early:**
```javascript
// File: routes/publish.js (Lines 751-773)

// NEW: Comprehensive validation that catches invalid units BEFORE calculation

const validWeightVolumeUnits = ['oz', 'g', 'kg', 'lb', 'cup', 'tbsp', 'tsp', 'ml', 'l'];
const firstWordOfUnit = standardUnit.toLowerCase().trim().split(' ')[0].split('(')[0];
const hasInvalidUnit = !validWeightVolumeUnits.includes(firstWordOfUnit);

// Check for descriptive units
const hasDescriptiveUnit = standardUnit.includes(',') || 
                          standardUnit.includes('yields') || 
                          standardUnit.includes(' as ') || 
                          standardUnit.includes('(');

// Force regeneration if unit is invalid or descriptive
if (hasInvalidUnit || hasDescriptiveUnit || unitsIncompatible) {
  console.log(`⚠️ "${ingredient}" needs regeneration: standardUnit="${standardUnit}"`);
  ingredientDidRefs[originalName] = null;  // ← Forces AI to create new record
}
```

**Result:** Bad records like "red onion" (standardUnit="onion") now get **automatically regenerated** with proper units before they reach the calculation.

**Part C - Detect Volume↔Weight Mismatches:**
```javascript
// File: routes/publish.js (Lines 764-769)

// NEW: Catch problematic volume↔weight mismatches
const recipeIsVolume = recipeUnit && (recipeUnit.includes('cup') || recipeUnit.includes('tbsp') || recipeUnit.includes('tsp'));
const standardIsWeight = standardUnit && (standardUnit.includes('g') || standardUnit.includes('oz') || standardUnit.includes('lb'));
const volumeWeightMismatch = recipeIsVolume && standardIsWeight;

if (volumeWeightMismatch) {
  console.log(`⚠️ Volume↔weight mismatch: recipe uses "${recipeUnit}", ingredient has "${standardUnit}"`);
  ingredientDidRefs[originalName] = null;  // Force regeneration
}
```

**Why This Matters:**
```javascript
// Quinoa with volume↔weight mismatch:
standardUnit: "g"  // ← Weight unit
recipeUnit: "cup"  // ← Volume unit

// Backend's convertToGrams treats "cup" as liquid:
1 cup → 240 grams (assumes water density!)

// For dry quinoa: 1 cup = ~170g, NOT 240g
// Multiplier: 240/100 = 2.4x ❌ (should be 1.7x)
// Calories: 368 × 2.4 = 883 cal ❌ (should be 625 cal)
```

**After Regeneration:**
```javascript
// Quinoa regenerated with volume unit:
standardUnit: "cup"  // ← Matches recipe!
standardAmount: 1
calories: 625  // Already calculated for 1 cup dry

// Recipe: 1 cup
// Multiplier: 1 / 1 = 1x ✅
// Calories: 625 × 1 = 625 cal ✅
```

### Bug #2: Empty Units Converted to 'unit' String

**File:** `routes/publish.js` (Line 632)

**The Problem:**
Empty ingredient units were being converted to the string `'unit'`, which triggered count-based conversion logic but didn't work properly when nutritional records had volume-based units.

**Example:**
```javascript
// Recipe ingredient:
amount: 1, unit: '' (empty)

// OLD CODE converted empty → 'unit':
const ingredientUnits = ingredients.map(ing => (ing.unit && ing.unit.trim()) || 'unit');

// Result: 'unit' treated as count-based, but nutritional record might have "cup"
// Caused mismatched conversions
```

**The Fix:**
```javascript
// Keep empty units as empty strings
const ingredientUnits = ingredients.map(ing => (ing.unit && ing.unit.trim()) || '');
```

Empty units are now handled by the existing logic in `calculateRecipeNutrition` that converts empty → 'whole'.

### Bug #3: Invalid Units Not Caught by Validation

**File:** `routes/recipes.js` (Lines 346-382)

**Enhanced needsStandardUnitFix to catch:**
- **Parenthetical descriptions:** "teaspoon (2 g)", "tsp (≈6 g)"
- **Descriptive units:** "lime yields", "avocado, NS as to Florida", "onion"
- **Units with commas:** Any unit containing commas

**New Validation Checks:**
```javascript
// Check for parenthetical descriptions
if (unit.includes('(') && unit.includes(')')) {
  return true;  // Needs fixing
}

// Check for descriptive multi-word units
if (unit.includes(',') || unit.includes('yields') || unit.includes(' as ')) {
  return true;  // Needs fixing
}
```

These units will now trigger `fixStandardUnitWithAI` during recipe resolution.

## Files Modified

### 1. helpers/nutritional-helper-openai.js
- **Lines 227-257:** Updated fetchNutritionalData prompt
- **Changes:** Enforced weight/volume units, added qtyInStandardAmount guidance for volume units

### 2. routes/recipes.js
- **Lines 136-174:** Updated find-standard-unit endpoint prompt
- **Lines 346-382:** Updated needsStandardUnitFix validation (catches parentheses, commas, "yields")
- **Lines 383-421:** Updated fixStandardUnitWithAI prompt
- **Changes:** Removed "whole" from valid units, enhanced validation to catch invalid descriptive units

### 3. routes/publish.js
- **Line 632:** Changed empty unit default from 'unit' to '' (empty string)
- **Changes:** Prevents wrong count-based conversions for empty units

### 4. helpers/elasticsearch.js
- **Lines 1214-1218:** Changed unknown unit handling from 1:1 assumption to null return
- **Lines 1598-1636:** Added parenthetical weight extraction safety net
- **Changes:** Prevents massive multiplier errors from invalid units, adds safety net for legacy records

## Success Metrics

✅ **Prevention:** New records always have proper weight/volume units  
✅ **Detection:** Problematic records fixed during recipe resolution  
✅ **Safety Net:** Legacy records handled gracefully  
✅ **Accuracy:** Correct summaryNutritionalInfoPerServing calculations  
✅ **Compatibility:** Supports weight recipes (oz, g) and count recipes (whole, pieces)  
✅ **Reliability:** No "Cannot convert" errors for properly formatted ingredients  
✅ **Flexibility:** qtyInStandardAmount bridges count-to-weight conversions  

## Quick Reference: Field Definitions

| Field | Type | Purpose | Example |
|-------|------|---------|---------|
| `standardAmount` | number | Quantity for nutritional values | `4` |
| `standardUnit` | string | Unit (MUST be weight/volume) | `"oz"` |
| `qtyInStandardAmount` | number | Whole items in standardAmount | `1` |
| `calories` | number | Calories per standardAmount | `140` |
| `proteinG` | number | Protein grams per standardAmount | `25` |
| `fatG` | number | Fat grams per standardAmount | `5` |
| `ingredient_amount` | array | Recipe amounts (parallel to ingredient array) | `[24, 2, 1]` |
| `ingredient_unit` | array | Recipe units (parallel to ingredient array) | `["oz", "cup", "tbsp"]` |
| `servings` | number | Number of servings in recipe | `4` |

## Conclusion

The recipe nutritional calculation system now reliably converts ingredient nutritional data to recipe nutritional summaries by:

1. **Enforcing proper standardUnit values** (weight/volume only) through AI prompts
2. **Validating units** during recipe resolution and triggering fixes for problematic records
3. **Providing a safety net** that extracts weight from parenthetical descriptions in legacy records
4. **Using multiple conversion strategies** to handle weight-based, volume-based, and count-based recipes
5. **Calculating accurate multipliers** by comparing recipe amounts to standard amounts
6. **Summing contributions** from all ingredients
7. **Dividing by servings** to produce `summaryNutritionalInfoPerServing`

This three-layer approach (Prevention → Detection → Safety Net) ensures robust calculations whether ingredients are specified by weight ("24 oz salmon"), volume ("2 cups rice"), or count ("2 whole apples").

