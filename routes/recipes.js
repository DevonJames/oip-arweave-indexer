const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { generateRecipeImage } = require('../helpers/generators');
const { getRecords, calculateRecipeNutrition } = require('../helpers/elasticsearch');
const { fetchNutritionalData } = require('../helpers/nutritional-helper');

/**
 * Generate a recipe image using OpenAI DALL-E 3
 * POST /api/recipes/generate-image
 */
router.post('/generate-image', async (req, res) => {
  try {
    const { recipeId, recipeTitle, description, ingredients, forceRegenerate } = req.body;
    
    if (!recipeTitle) {
      return res.status(400).json({
        success: false,
        error: 'recipeTitle is required'
      });
    }
    
    console.log(`Recipe image generation request: ${recipeTitle}, forceRegenerate: ${forceRegenerate}`);
    
    // Parse ingredients if provided as string
    let ingredientArray = ingredients;
    if (typeof ingredients === 'string') {
      ingredientArray = ingredients.split(',').map(i => i.trim()).filter(i => i);
    }
    
    const result = await generateRecipeImage(
      recipeTitle,
      description,
      ingredientArray,
      forceRegenerate === true  // Explicitly check for true
    );
    
    res.json(result);
    
  } catch (error) {
    console.error('Error in recipe image generation endpoint:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate recipe image'
    });
  }
});

/**
 * Serve cached recipe images
 * GET /api/recipes/images/:filename
 */
router.get('/images/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    const imagePath = path.join(__dirname, '../generated-recipe-images', filename);
    
    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({ 
        success: false,
        error: 'Image not found' 
      });
    }
    
    // Set proper content type and caching headers
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
    res.sendFile(imagePath);
    
  } catch (error) {
    console.error('Error serving recipe image:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to serve image' 
    });
  }
});

/**
 * Calculate nutritional summary for a recipe (preview before publishing)
 * POST /api/recipes/calculate-nutrition
 */
router.post('/calculate-nutrition', async (req, res) => {
  try {
    const { ingredients, servings } = req.body;
    
    if (!ingredients || !Array.isArray(ingredients) || !servings) {
      return res.status(400).json({
        success: false,
        error: 'ingredients array and servings are required'
      });
    }
    
    // Import the elasticsearch helper to use the same calculation logic
    const { calculateRecipeNutrition } = require('../helpers/elasticsearch');
    
    const result = await calculateRecipeNutrition(ingredients, servings);
    
    res.json({
      success: true,
      ...result
    });
    
  } catch (error) {
    console.error('Error calculating recipe nutrition:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to calculate nutrition'
    });
  }
});

/**
 * Use AI to find a better standard unit for nutritional info
 * POST /api/recipes/find-standard-unit
 */
router.post('/find-standard-unit', async (req, res) => {
  try {
    const { ingredientName, nutritionalInfo } = req.body;
    
    if (!ingredientName || !nutritionalInfo) {
      return res.status(400).json({
        success: false,
        error: 'ingredientName and nutritionalInfo are required'
      });
    }
    
    // Standard measurable units (excluding count-based units like piece, slice, etc.)
    const weightUnits = ['lb', 'lbs', 'oz', 'g', 'kg'];
    const volumeUnits = ['cup', 'cups', 'tbsp', 'tsp', 'ml', 'l'];
    const allStandardUnits = [...weightUnits, ...volumeUnits];
    
    // Construct the AI prompt with improved guidance
    const prompt = `You are a nutrition expert. Fix the non-standard unit for "${ingredientName}".

Current Standard: ${nutritionalInfo.standardAmount} ${nutritionalInfo.standardUnit}

Nutritional Values:
- Calories: ${nutritionalInfo.calories}
- Protein: ${nutritionalInfo.proteinG}g
- Fat: ${nutritionalInfo.fatG}g
- Carbs: ${nutritionalInfo.carbohydratesG}g
- Sodium: ${nutritionalInfo.sodiumMg}mg

The current unit "${nutritionalInfo.standardUnit}" is non-standard and makes conversions difficult.

CRITICAL RULES:
1. standardAmount and standardUnit MUST ALWAYS be weight (oz, g, kg, lb) or volume (cup, tbsp, tsp, ml, l)
2. NEVER use descriptive units like "fillet (≈170 g)", "1 medium breast", "whole", "piece", or "item"
3. Convert descriptive units to actual weight/volume
4. Extract numbers from parenthetical descriptions like "(≈170 g)" → 170, "g" or convert to oz

Examples of CORRECT fixes:
- "1 fillet (≈170 g)" → amount: 6, unit: "oz" (convert ~170g to 6 oz)
- "1 medium breast (174g)" → amount: 174, unit: "g"  
- "1 cup diced" → amount: 1, unit: "cup"
- "piece" → amount: 4, unit: "oz" (estimate appropriate weight for this ingredient)

UNIT SELECTION RULES:
- For MEATS (beef, chicken, pork, fish, etc.): Use WEIGHT units (${weightUnits.join(', ')})
- For LIQUIDS: Use VOLUME units (${volumeUnits.join(', ')})
- For OTHER SOLIDS (vegetables, fruits, grains, etc.): Use VOLUME units (${volumeUnits.join(', ')})

Available units: ${weightUnits.join(', ')}, ${volumeUnits.join(', ')}
DO NOT use: whole, piece, item, unit, fillet, breast, or any descriptive terms

Respond ONLY with JSON (no other text):
{
  "amount": <number>,
  "unit": "<weight or volume unit only>",
  "reasoning": "<brief explanation>"
}`;

    console.log('🤖 Calling OpenAI GPT-4o to find standard unit for:', ingredientName);
    
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 200
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    const aiResponse = response.data.choices[0].message.content.trim();
    console.log('✅ AI response:', aiResponse);
    
    // Parse the JSON response
    let suggestion;
    try {
      suggestion = JSON.parse(aiResponse);
    } catch (parseError) {
      // Try to extract JSON if there's extra text
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        suggestion = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Failed to parse AI response as JSON');
      }
    }
    
    // Validate the suggestion
    if (!suggestion.amount || !suggestion.unit || !allStandardUnits.includes(suggestion.unit)) {
      throw new Error('Invalid suggestion format from AI');
    }
    
    res.json({
      success: true,
      suggestion: suggestion
    });
    
  } catch (error) {
    console.error('Error finding standard unit with AI:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to find standard unit'
    });
  }
});

/**
 * Helper: Search for existing ingredient by name
 * Returns best match with nutritional info, or null
 */
async function searchIngredientByName(ingredientName) {
  try {
    console.log(`🔍 Searching for ingredient: "${ingredientName}"`);
    
    // Use the same endpoint logic as the frontend dropdown
    const results = await getRecords({
      recordType: 'nutritionalInfo',
      limit: 10,
      sortBy: 'basic.name:asc'
    });
    
    if (!results || !results.records || results.records.length === 0) {
      console.log('   No nutritional ingredients found in database');
      return null;
    }
    
    // Filter to only records with nutritional info
    const withNutrition = results.records.filter(r => 
      r.data && r.data.nutritionalInfo && 
      r.data.nutritionalInfo.standardAmount && 
      r.data.nutritionalInfo.standardUnit
    );
    
    if (withNutrition.length === 0) {
      console.log('   No ingredients with valid nutritional info found');
      return null;
    }
    
    // Calculate similarity scores
    const scoredResults = withNutrition.map(record => {
      const recordName = (record.data.basic?.name || '').toLowerCase();
      const searchName = ingredientName.toLowerCase();
      
      // Exact match
      if (recordName === searchName) {
        return { record, score: 100 };
      }
      
      // Contains match
      if (recordName.includes(searchName)) {
        return { record, score: 80 };
      }
      
      // Reverse contains
      if (searchName.includes(recordName)) {
        return { record, score: 70 };
      }
      
      // Fuzzy match using Levenshtein-like scoring
      const words1 = recordName.split(/\s+/);
      const words2 = searchName.split(/\s+/);
      const commonWords = words1.filter(w => words2.includes(w)).length;
      const maxWords = Math.max(words1.length, words2.length);
      const wordScore = (commonWords / maxWords) * 60;
      
      return { record, score: wordScore };
    });
    
    // Sort by score
    scoredResults.sort((a, b) => b.score - a.score);
    
    const bestMatch = scoredResults[0];
    
    // Only return if score is above threshold (50%)
    if (bestMatch && bestMatch.score >= 50) {
      console.log(`   ✅ Found match: "${bestMatch.record.data.basic?.name}" (score: ${bestMatch.score})`);
      return bestMatch.record;
    }
    
    console.log(`   ⚠️ No good match found (best score: ${bestMatch?.score || 0})`);
    return null;
    
  } catch (error) {
    console.error('Error searching for ingredient:', error);
    return null;
  }
}

/**
 * Helper: Fetch nutritional data from Nutritionix and create ingredient object
 */
async function fetchAndCreateIngredient(ingredientName) {
  try {
    console.log(`🌐 Fetching nutritional data from Nutritionix for: "${ingredientName}"`);
    
    const nutritionalData = await fetchNutritionalData(ingredientName);
    
    if (!nutritionalData || !nutritionalData.nutritionalInfo) {
      console.error('   ❌ Failed to fetch nutritional data');
      return null;
    }
    
    console.log(`   ✅ Fetched nutritional data:`, nutritionalData.nutritionalInfo);
    
    return {
      name: ingredientName,
      basic: nutritionalData.basic || { name: ingredientName },
      nutritionalInfo: nutritionalData.nutritionalInfo,
      image: nutritionalData.image || {},
      isNew: true // Mark as newly created
    };
    
  } catch (error) {
    console.error('Error fetching nutritional data:', error);
    return null;
  }
}

/**
 * Helper: Check if standard unit is problematic and needs AI fixing
 */
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
  
  // Extract first word to check if unit is valid
  const firstWord = unit.trim().split(' ')[0].split('(')[0]; // Handle "cup(diced)" or "cup diced"
  
  // If first word is not a valid unit, it needs fixing
  if (!validUnits.includes(firstWord)) {
    console.log(`   ⚠️ Non-standard unit detected: "${nutritionalInfo.standardUnit}" (normalized: "${firstWord}")`);
    return true;
  }
  
  // Check for parenthetical descriptions that indicate improper formatting
  // e.g., "fillet (≈170 g)" or "oz (1 medium breast)" should be fixed to extract the weight
  if (unit.includes('(') && unit.includes(')') && !validUnits.includes(firstWord)) {
    console.log(`   ⚠️ Parenthetical description detected: "${nutritionalInfo.standardUnit}"`);
    return true;
  }
  
  return false;
}

/**
 * Helper: Fix standard unit using AI
 */
async function fixStandardUnitWithAI(ingredientName, nutritionalInfo) {
  try {
    console.log(`🤖 Asking AI to fix standard unit for: "${ingredientName}"`);
    
    const weightUnits = ['lb', 'lbs', 'oz', 'g', 'kg'];
    const volumeUnits = ['cup', 'cups', 'tbsp', 'tsp', 'ml', 'l'];
    const allStandardUnits = [...weightUnits, ...volumeUnits];
    
    const prompt = `You are a nutrition expert. Fix the non-standard unit for "${ingredientName}".

Current Standard: ${nutritionalInfo.standardAmount} ${nutritionalInfo.standardUnit}

Nutritional Values:
- Calories: ${nutritionalInfo.calories}
- Protein: ${nutritionalInfo.proteinG}g
- Fat: ${nutritionalInfo.fatG}g
- Carbs: ${nutritionalInfo.carbohydratesG}g
- Sodium: ${nutritionalInfo.sodiumMg}mg

The current unit "${nutritionalInfo.standardUnit}" is non-standard and makes conversions difficult.

CRITICAL RULES:
1. standardAmount and standardUnit MUST ALWAYS be weight (oz, g, kg, lb) or volume (cup, tbsp, tsp, ml, l)
2. NEVER use descriptive units like "fillet (≈170 g)", "1 medium breast", "whole", "piece", or "item"
3. Convert descriptive units to actual weight/volume
4. Extract numbers from parenthetical descriptions like "(≈170 g)" → 170, "g" or convert to oz

Examples of CORRECT fixes:
- "1 fillet (≈170 g)" → amount: 6, unit: "oz" (convert ~170g to 6 oz)
- "1 medium breast (174g)" → amount: 174, unit: "g"  
- "1 cup diced" → amount: 1, unit: "cup"
- "piece" → amount: 4, unit: "oz" (estimate appropriate weight for this ingredient)

UNIT SELECTION RULES:
- For MEATS (beef, chicken, pork, fish, etc.): Use WEIGHT units (${weightUnits.join(', ')})
- For LIQUIDS: Use VOLUME units (${volumeUnits.join(', ')})
- For OTHER SOLIDS (vegetables, fruits, grains, etc.): Use VOLUME units (${volumeUnits.join(', ')})

Available units: ${weightUnits.join(', ')}, ${volumeUnits.join(', ')}
DO NOT use: whole, piece, item, unit, fillet, breast, or any descriptive terms

Respond ONLY with JSON (no other text):
{
  "amount": <number>,
  "unit": "<weight or volume unit only>",
  "reasoning": "<brief explanation>"
}`;

    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 200
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    const aiResponse = response.data.choices[0].message.content.trim();
    
    // Parse JSON
    let suggestion;
    try {
      suggestion = JSON.parse(aiResponse);
    } catch (parseError) {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        suggestion = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Failed to parse AI response');
      }
    }
    
    console.log(`   ✅ AI suggestion: ${suggestion.amount} ${suggestion.unit} - ${suggestion.reasoning}`);
    
    // Update nutritional info with new standard unit
    return {
      ...nutritionalInfo,
      standardAmount: suggestion.amount,
      standardUnit: suggestion.unit
    };
    
  } catch (error) {
    console.error('Error fixing standard unit with AI:', error);
    return nutritionalInfo; // Return original if AI fails
  }
}

/**
 * Main function: Resolve all ingredients for a recipe
 * Takes ingredient names/DIDs and returns resolved ingredient objects with nutritional info
 */
async function resolveRecipeIngredients(ingredientArray, ingredientAmounts, ingredientUnits, userPublicKey) {
  const resolvedIngredients = [];
  
  for (let i = 0; i < ingredientArray.length; i++) {
    const ingredientRef = ingredientArray[i];
    const amount = ingredientAmounts[i];
    const unit = ingredientUnits[i];
    
    console.log(`\n📋 Processing ingredient ${i + 1}/${ingredientArray.length}: "${ingredientRef}"`);
    
    let ingredient = null;
    let ingredientDID = null;
    
    // Check if it's already a DID
    if (typeof ingredientRef === 'string' && ingredientRef.startsWith('did:')) {
      console.log('   ℹ️ Already a DID, looking up...');
      
      // Fetch the ingredient by DID
      try {
        const PUBLIC_API_BASE_URL = process.env.PUBLIC_API_BASE_URL || 'http://localhost:3000';
        const response = await axios.get(`${PUBLIC_API_BASE_URL}/api/records`, {
          params: { did: ingredientRef }
        });
        
        if (response.data && response.data.records && response.data.records.length > 0) {
          ingredient = response.data.records[0];
          ingredientDID = ingredientRef;
          console.log(`   ✅ Found ingredient by DID: ${ingredient.data?.basic?.name}`);
        }
      } catch (error) {
        console.error('   ❌ Failed to fetch ingredient by DID:', error.message);
      }
    } else if (typeof ingredientRef === 'string') {
      // It's a name, try to resolve it
      console.log('   ℹ️ Ingredient name provided, searching...');
      
      // Step 1: Search for existing ingredient
      ingredient = await searchIngredientByName(ingredientRef);
      
      if (ingredient) {
        ingredientDID = ingredient.oip?.didTx || ingredient.oip?.did;
        console.log(`   ✅ Using existing ingredient DID: ${ingredientDID}`);
      } else {
        // Step 2: Fetch from Nutritionix
        console.log('   ⚠️ No existing ingredient found, fetching from Nutritionix...');
        ingredient = await fetchAndCreateIngredient(ingredientRef);
        
        if (ingredient) {
          // We'll need to publish this as a new ingredient
          console.log('   ✅ Created new ingredient from Nutritionix data');
        } else {
          console.error(`   ❌ Failed to resolve ingredient: ${ingredientRef}`);
          resolvedIngredients.push({
            name: ingredientRef,
            amount,
            unit,
            error: 'Could not resolve ingredient',
            ingredientRef: ingredientRef
          });
          continue;
        }
      }
    }
    
    if (!ingredient) {
      console.error(`   ❌ No ingredient data available for: ${ingredientRef}`);
      resolvedIngredients.push({
        name: ingredientRef,
        amount,
        unit,
        error: 'No ingredient data',
        ingredientRef: ingredientRef
      });
      continue;
    }
    
    // Step 3: Check if standard unit needs fixing
    if (ingredient.data && ingredient.data.nutritionalInfo) {
      if (needsStandardUnitFix(ingredient.data.nutritionalInfo, ingredient.data.basic?.name || ingredientRef)) {
        console.log('   🔧 Fixing problematic standard unit...');
        ingredient.data.nutritionalInfo = await fixStandardUnitWithAI(
          ingredient.data.basic?.name || ingredientRef,
          ingredient.data.nutritionalInfo
        );
      }
    }
    
    resolvedIngredients.push({
      name: ingredient.data?.basic?.name || ingredientRef,
      amount,
      unit,
      did: ingredientDID,
      data: ingredient.data,
      isNew: ingredient.isNew || false,
      ingredientRef: ingredientRef
    });
  }
  
  return resolvedIngredients;
}

// Export the helper function
router.resolveRecipeIngredients = resolveRecipeIngredients;

module.exports = router;

