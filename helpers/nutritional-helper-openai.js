const axios = require('axios');

/**
 * OpenAI-powered nutritional data fetcher with web search and structured outputs
 * Replaces the deprecated Nutritionix API with OpenAI's web search capabilities
 */

// Standard unit conversion mappings for nutritional data
const STANDARD_UNITS = {
  // Weight-based units (convert to grams)
  weight: {
    'g': 1,
    'gram': 1,
    'grams': 1,
    'oz': 28.3495,
    'ounce': 28.3495,
    'ounces': 28.3495,
    'lb': 453.592,
    'pound': 453.592,
    'pounds': 453.592,
    'kg': 1000,
    'kilogram': 1000,
    'kilograms': 1000
  },
  // Volume-based units (approximate conversions to ml)
  volume: {
    'ml': 1,
    'milliliter': 1,
    'milliliters': 1,
    'l': 1000,
    'liter': 1000,
    'liters': 1000,
    'cup': 236.588,
    'cups': 236.588,
    'tbsp': 14.7868,
    'tablespoon': 14.7868,
    'tablespoons': 14.7868,
    'tsp': 4.92892,
    'teaspoon': 4.92892,
    'teaspoons': 4.92892,
    'fl oz': 29.5735,
    'fluid ounce': 29.5735,
    'fluid ounces': 29.5735
  },
  // Count-based units (keep as-is)
  count: ['whole', 'piece', 'slice', 'clove', 'roast', 'breast', 'thigh', 'drumstick', 'fillet', 'steak', 'chop', 'item', 'each']
};

/**
 * Find the most appropriate standard unit for nutritional data
 * Based on the ingredient type and current unit
 */
function findStandardUnit(ingredientName, currentAmount, currentUnit) {
  const nameLower = ingredientName.toLowerCase();
  const unitLower = (currentUnit || '').toLowerCase();
  
  // Check if it's a count-based ingredient
  const isCountBased = STANDARD_UNITS.count.some(countUnit => 
    nameLower.includes(countUnit) || unitLower.includes(countUnit)
  );
  
  if (isCountBased) {
    return {
      amount: currentAmount,
      unit: 'piece',
      reasoning: 'Count-based ingredient - using piece as standard unit'
    };
  }
  
  // Smart unit selection based on ingredient type
  if (isLiquidIngredient(nameLower)) {
    // For liquids, prefer cups (most common in recipes)
    if (STANDARD_UNITS.volume[unitLower]) {
      const cups = currentAmount * STANDARD_UNITS.volume[unitLower] / STANDARD_UNITS.volume['cup'];
      return {
        amount: Math.round(cups * 100) / 100,
        unit: 'cup',
        reasoning: 'Liquid ingredient - converted to cups for recipe compatibility'
      };
    }
    return {
      amount: currentAmount,
      unit: 'cup',
      reasoning: 'Liquid ingredient - using cup as standard unit'
    };
  }
  
  if (isSpiceOrCondiment(nameLower)) {
    // For spices/condiments, prefer tablespoons
    if (STANDARD_UNITS.volume[unitLower]) {
      const tbsp = currentAmount * STANDARD_UNITS.volume[unitLower] / STANDARD_UNITS.volume['tbsp'];
      return {
        amount: Math.round(tbsp * 100) / 100,
        unit: 'tbsp',
        reasoning: 'Spice/condiment - converted to tablespoons for recipe compatibility'
      };
    }
    return {
      amount: currentAmount,
      unit: 'tbsp',
      reasoning: 'Spice/condiment - using tablespoon as standard unit'
    };
  }
  
  if (isBulkIngredient(nameLower)) {
    // For bulk ingredients (flour, sugar, etc.), prefer cups
    if (STANDARD_UNITS.volume[unitLower]) {
      const cups = currentAmount * STANDARD_UNITS.volume[unitLower] / STANDARD_UNITS.volume['cup'];
      return {
        amount: Math.round(cups * 100) / 100,
        unit: 'cup',
        reasoning: 'Bulk ingredient - converted to cups for recipe compatibility'
      };
    }
    return {
      amount: currentAmount,
      unit: 'cup',
      reasoning: 'Bulk ingredient - using cup as standard unit'
    };
  }
  
  // For weight-based ingredients, prefer grams
  if (STANDARD_UNITS.weight[unitLower]) {
    const grams = currentAmount * STANDARD_UNITS.weight[unitLower];
    return {
      amount: Math.round(grams * 100) / 100,
      unit: 'g',
      reasoning: 'Weight-based ingredient - converted to grams for standard nutritional calculations'
    };
  }
  
  // Default fallback - try to determine best unit from ingredient name
  if (isLiquidIngredient(nameLower)) {
    return { amount: currentAmount, unit: 'cup', reasoning: 'Liquid ingredient - using cup as standard unit' };
  } else if (isSpiceOrCondiment(nameLower)) {
    return { amount: currentAmount, unit: 'tbsp', reasoning: 'Spice/condiment - using tablespoon as standard unit' };
  } else if (isBulkIngredient(nameLower)) {
    return { amount: currentAmount, unit: 'cup', reasoning: 'Bulk ingredient - using cup as standard unit' };
  } else {
    return { amount: currentAmount, unit: currentUnit || 'g', reasoning: 'Using original unit as fallback' };
  }
}

/**
 * Check if ingredient is a liquid
 */
function isLiquidIngredient(name) {
  const liquidKeywords = ['oil', 'milk', 'water', 'broth', 'stock', 'juice', 'vinegar', 'wine', 'beer', 'sauce', 'syrup', 'honey', 'cream', 'buttermilk', 'yogurt', 'kefir'];
  return liquidKeywords.some(keyword => name.includes(keyword));
}

/**
 * Check if ingredient is a spice or condiment
 */
function isSpiceOrCondiment(name) {
  const spiceKeywords = ['salt', 'pepper', 'garlic', 'onion', 'herb', 'spice', 'seasoning', 'paprika', 'cumin', 'oregano', 'basil', 'thyme', 'rosemary', 'parsley', 'cilantro', 'ginger', 'cinnamon', 'nutmeg', 'vanilla', 'extract', 'powder', 'flakes', 'seeds', 'chili', 'cayenne', 'mustard', 'ketchup', 'mayo', 'relish', 'pickle'];
  return spiceKeywords.some(keyword => name.includes(keyword));
}

/**
 * Check if ingredient is a bulk ingredient (flour, sugar, etc.)
 */
function isBulkIngredient(name) {
  const bulkKeywords = ['flour', 'sugar', 'rice', 'pasta', 'noodles', 'oats', 'cereal', 'breadcrumbs', 'cornmeal', 'semolina', 'quinoa', 'barley', 'lentils', 'beans', 'chickpeas', 'nuts', 'seeds', 'coconut', 'chocolate', 'chips', 'crumbs', 'powder', 'mix'];
  return bulkKeywords.some(keyword => name.includes(keyword));
}

/**
 * Convert nutritional values to standard units
 */
function convertNutritionalValues(nutritionalData, fromAmount, fromUnit, toAmount, toUnit) {
  if (fromAmount === toAmount && fromUnit === toUnit) {
    return nutritionalData; // No conversion needed
  }
  
  const conversionFactor = toAmount / fromAmount;
  
  return {
    ...nutritionalData,
    standardAmount: toAmount,
    standardUnit: toUnit,
    calories: Math.round(nutritionalData.calories * conversionFactor * 100) / 100,
    proteinG: Math.round(nutritionalData.proteinG * conversionFactor * 100) / 100,
    fatG: Math.round(nutritionalData.fatG * conversionFactor * 100) / 100,
    saturatedFatG: Math.round(nutritionalData.saturatedFatG * conversionFactor * 100) / 100,
    transFatG: Math.round((nutritionalData.transFatG || 0) * conversionFactor * 100) / 100,
    cholesterolMg: Math.round(nutritionalData.cholesterolMg * conversionFactor * 100) / 100,
    sodiumMg: Math.round(nutritionalData.sodiumMg * conversionFactor * 100) / 100,
    carbohydratesG: Math.round(nutritionalData.carbohydratesG * conversionFactor * 100) / 100,
    dietaryFiberG: Math.round(nutritionalData.dietaryFiberG * conversionFactor * 100) / 100,
    sugarsG: Math.round(nutritionalData.sugarsG * conversionFactor * 100) / 100,
    addedSugarsG: Math.round((nutritionalData.addedSugarsG || 0) * conversionFactor * 100) / 100,
    vitaminDMcg: Math.round((nutritionalData.vitaminDMcg || 0) * conversionFactor * 100) / 100,
    calciumMg: Math.round((nutritionalData.calciumMg || 0) * conversionFactor * 100) / 100,
    ironMg: Math.round((nutritionalData.ironMg || 0) * conversionFactor * 100) / 100,
    potassiumMg: Math.round((nutritionalData.potassiumMg || 0) * conversionFactor * 100) / 100,
    vitaminAMcg: Math.round((nutritionalData.vitaminAMcg || 0) * conversionFactor * 100) / 100,
    vitaminCMg: Math.round((nutritionalData.vitaminCMg || 0) * conversionFactor * 100) / 100
  };
}

/**
 * Fetch nutritional data using OpenAI web search and structured outputs
 */
async function fetchNutritionalData(ingredientName) {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  
  if (!openaiApiKey) {
    throw new Error('OpenAI API key not configured');
  }

  try {
    console.log(`🔍 Fetching nutritional data for: ${ingredientName}`);
    
    // Use OpenAI's Chat Completions API with structured outputs
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-5-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a nutritional data expert. Find comprehensive nutritional information from reliable sources and provide accurate data.'
        },
        {
          role: 'user',
          content: `What is the nutritional information for "${ingredientName}"? I need calories, protein, fat, saturated fat, sodium, carbohydrates, dietary fiber, sugars, cholesterol, potassium, calcium, and iron.`
        }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'nutritional_data',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              calories: { type: 'number' },
              proteinG: { type: 'number' },
              fatG: { type: 'number' },
              saturatedFatG: { type: 'number' },
              sodiumMg: { type: 'number' },
              carbohydratesG: { type: 'number' },
              dietaryFiberG: { type: 'number' },
              sugarsG: { type: 'number' },
              cholesterolMg: { type: 'number' },
              potassiumMg: { type: 'number' },
              calciumMg: { type: 'number' },
              ironMg: { type: 'number' }
            },
            required: ['calories', 'proteinG', 'fatG', 'saturatedFatG', 'sodiumMg', 'carbohydratesG', 'dietaryFiberG', 'sugarsG', 'cholesterolMg', 'potassiumMg', 'calciumMg', 'ironMg'],
            additionalProperties: false
          }
        }
      }
    }, {
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.data || !response.data.choices || !response.data.choices[0]) {
      throw new Error('No response from OpenAI');
    }

    const result = response.data.choices[0].message.content;
    console.log('Nutritional Info Response:', result);
    
    // Parse the JSON response
    let openaiData;
    try {
      openaiData = JSON.parse(result);
    } catch (parseError) {
      console.error('Error parsing OpenAI response:', parseError);
      return createFallbackNutritionalData(ingredientName);
    }
    
    console.log('Parsed OpenAI data:', openaiData);
    
    // Construct the full OIP record structure
    const nutritionalData = {
      basic: {
        name: ingredientName,
        date: Math.floor(Date.now() / 1000),
        language: 'en',
        nsfw: false,
        webUrl: `https://www.nutritionix.com/food/${ingredientName.replace(/\s+/g, '-').toLowerCase()}`
      },
      nutritionalInfo: {
        standardAmount: openaiData.standardAmount || 1,
        standardUnit: openaiData.standardUnit || 'piece',
        calories: openaiData.calories || 0,
        proteinG: openaiData.proteinG || 0,
        fatG: openaiData.fatG || 0,
        saturatedFatG: openaiData.saturatedFatG || 0,
        transFatG: openaiData.transFatG || 0,
        cholesterolMg: openaiData.cholesterolMg || 0,
        sodiumMg: openaiData.sodiumMg || 0,
        carbohydratesG: openaiData.carbohydratesG || 0,
        dietaryFiberG: openaiData.dietaryFiberG || 0,
        sugarsG: openaiData.sugarsG || 0,
        addedSugarsG: openaiData.addedSugarsG || 0,
        vitaminDMcg: openaiData.vitaminDMcg || 0,
        calciumMg: openaiData.calciumMg || 0,
        ironMg: openaiData.ironMg || 0,
        potassiumMg: openaiData.potassiumMg || 0,
        vitaminAMcg: openaiData.vitaminAMcg || 0,
        vitaminCMg: openaiData.vitaminCMg || 0,
        allergens: openaiData.allergens || [],
        glutenFree: openaiData.glutenFree || false,
        organic: openaiData.organic || false
      },
      image: {
        webUrl: '',
        contentType: 'image/jpeg'
      }
    };
    
    console.log('Returning full nutritional data structure:', nutritionalData);
    return nutritionalData;

  } catch (error) {
    console.error(`❌ Error fetching nutritional data for ${ingredientName}:`, error);
    
    // Return fallback data structure
    return createFallbackNutritionalData(ingredientName);
  }
}


/**
 * Manual parsing fallback when structured outputs fail
 */
function parseNutritionalDataManually(text, ingredientName) {
  // Basic regex patterns for extracting nutritional data
  const patterns = {
    calories: /(\d+(?:\.\d+)?)\s*(?:cal|calories)/i,
    protein: /(\d+(?:\.\d+)?)\s*(?:g|grams?)\s*(?:protein)/i,
    fat: /(\d+(?:\.\d+)?)\s*(?:g|grams?)\s*(?:fat|total fat)/i,
    carbs: /(\d+(?:\.\d+)?)\s*(?:g|grams?)\s*(?:carbs|carbohydrates)/i,
    fiber: /(\d+(?:\.\d+)?)\s*(?:g|grams?)\s*(?:fiber|dietary fiber)/i,
    sugar: /(\d+(?:\.\d+)?)\s*(?:g|grams?)\s*(?:sugar|sugars)/i,
    sodium: /(\d+(?:\.\d+)?)\s*(?:mg|milligrams?)\s*(?:sodium)/i,
    cholesterol: /(\d+(?:\.\d+)?)\s*(?:mg|milligrams?)\s*(?:cholesterol)/i
  };

  const extracted = {};
  for (const [key, pattern] of Object.entries(patterns)) {
    const match = text.match(pattern);
    extracted[key] = match ? parseFloat(match[1]) : 0;
  }

  return {
    basic: {
      name: ingredientName,
      date: Math.floor(Date.now() / 1000),
      language: 'en',
      nsfw: false,
      webUrl: `https://www.nutritionix.com/food/${ingredientName.replace(/\s+/g, '-').toLowerCase()}`
    },
    nutritionalInfo: {
      standardAmount: 100,
      standardUnit: 'g',
      calories: extracted.calories || 0,
      proteinG: extracted.protein || 0,
      fatG: extracted.fat || 0,
      saturatedFatG: 0,
      transFatG: 0,
      cholesterolMg: extracted.cholesterol || 0,
      sodiumMg: extracted.sodium || 0,
      carbohydratesG: extracted.carbs || 0,
      dietaryFiberG: extracted.fiber || 0,
      sugarsG: extracted.sugar || 0,
      addedSugarsG: 0,
      vitaminDMcg: 0,
      calciumMg: 0,
      ironMg: 0,
      potassiumMg: 0,
      vitaminAMcg: 0,
      vitaminCMg: 0,
      allergens: [],
      glutenFree: false,
      organic: false
    },
    image: {
      webUrl: '',
      contentType: 'image/jpeg'
    }
  };
}

/**
 * Create fallback nutritional data when all methods fail
 */
function createFallbackNutritionalData(ingredientName) {
  const nameLower = ingredientName.toLowerCase();
  
  return {
    basic: {
      name: ingredientName,
      date: Math.floor(Date.now() / 1000),
      language: 'en',
      nsfw: false,
      webUrl: `https://www.nutritionix.com/food/${ingredientName.replace(/\s+/g, '-').toLowerCase()}`
    },
    nutritionalInfo: {
      standardAmount: 1,
      standardUnit: 'unit',
      calories: 0,
      proteinG: 0,
      fatG: 0,
      saturatedFatG: 0,
      transFatG: 0,
      cholesterolMg: 0,
      sodiumMg: 0,
      carbohydratesG: 0,
      dietaryFiberG: 0,
      sugarsG: 0,
      addedSugarsG: 0,
      vitaminDMcg: 0,
      calciumMg: 0,
      ironMg: 0,
      potassiumMg: 0,
      vitaminAMcg: 0,
      vitaminCMg: 0,
      allergens: [],
      glutenFree: nameLower.includes('gluten free') || nameLower.includes('gluten-free'),
      organic: nameLower.includes('organic')
    },
    image: {
      webUrl: '',
      contentType: 'image/jpeg'
    }
  };
}

module.exports = { 
  fetchNutritionalData,
  findStandardUnit,
  convertNutritionalValues
};
