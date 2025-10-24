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
  
  // For weight-based ingredients, prefer grams
  if (STANDARD_UNITS.weight[unitLower]) {
    const grams = currentAmount * STANDARD_UNITS.weight[unitLower];
    return {
      amount: Math.round(grams * 100) / 100, // Round to 2 decimal places
      unit: 'g',
      reasoning: 'Converted to grams for standard nutritional calculations'
    };
  }
  
  // For volume-based ingredients, prefer ml
  if (STANDARD_UNITS.volume[unitLower]) {
    const ml = currentAmount * STANDARD_UNITS.volume[unitLower];
    return {
      amount: Math.round(ml * 100) / 100,
      unit: 'ml',
      reasoning: 'Converted to milliliters for standard nutritional calculations'
    };
  }
  
  // Default fallback
  return {
    amount: currentAmount,
    unit: currentUnit || 'g',
    reasoning: 'Using original unit as fallback'
  };
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
    
    // Use OpenAI's web search with domain filtering for reliable nutrition sources
    const response = await axios.post('https://api.openai.com/v1/responses', {
      model: 'gpt-5-mini',
      tools: [{
        type: 'web_search',
        filters: {
          allowed_domains: [
            'nutritionix.com',
            'usda.gov',
            'fdc.nal.usda.gov',
            'nutritiondata.self.com',
            'cronometer.com',
            'myfitnesspal.com',
            'webmd.com',
            'healthline.com',
            'mayoclinic.org'
          ]
        }
      }],
      tool_choice: 'auto',
      input: `Find comprehensive nutritional information for "${ingredientName}". I need detailed nutritional facts including calories, protein, fat, carbohydrates, fiber, sugars, sodium, cholesterol, vitamins, and minerals. Please provide data per 100g or standard serving size.`
    }, {
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.data || !response.data.output) {
      throw new Error('No response from OpenAI');
    }

    // Extract nutritional data from the response
    const nutritionalData = await extractNutritionalDataFromResponse(response.data, ingredientName);
    
    // Apply standard unit conversion
    const standardUnit = findStandardUnit(ingredientName, nutritionalData.standardAmount, nutritionalData.standardUnit);
    const convertedData = convertNutritionalValues(
      nutritionalData,
      nutritionalData.standardAmount,
      nutritionalData.standardUnit,
      standardUnit.amount,
      standardUnit.unit
    );

    console.log(`✅ Successfully fetched nutritional data for ${ingredientName}`);
    return convertedData;

  } catch (error) {
    console.error(`❌ Error fetching nutritional data for ${ingredientName}:`, error);
    
    // Return fallback data structure
    return createFallbackNutritionalData(ingredientName);
  }
}

/**
 * Extract and structure nutritional data from OpenAI response
 */
async function extractNutritionalDataFromResponse(response, ingredientName) {
  try {
    // Use OpenAI's structured outputs to parse the nutritional data
    const structuredResponse = await axios.post('https://api.openai.com/v1/responses', {
      model: 'gpt-5-mini',
      input: `Extract nutritional information from this text and format it as JSON: ${response.output_text || response.output}`,
      text: {
        format: {
          type: 'json_schema',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              basic: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  date: { type: 'number' },
                  language: { type: 'string' },
                  nsfw: { type: 'boolean' },
                  webUrl: { type: 'string' }
                },
                required: ['name', 'date', 'language', 'nsfw'],
                additionalProperties: false
              },
              nutritionalInfo: {
                type: 'object',
                properties: {
                  standardAmount: { type: 'number' },
                  standardUnit: { type: 'string' },
                  calories: { type: 'number' },
                  proteinG: { type: 'number' },
                  fatG: { type: 'number' },
                  saturatedFatG: { type: 'number' },
                  transFatG: { type: 'number' },
                  cholesterolMg: { type: 'number' },
                  sodiumMg: { type: 'number' },
                  carbohydratesG: { type: 'number' },
                  dietaryFiberG: { type: 'number' },
                  sugarsG: { type: 'number' },
                  addedSugarsG: { type: 'number' },
                  vitaminDMcg: { type: 'number' },
                  calciumMg: { type: 'number' },
                  ironMg: { type: 'number' },
                  potassiumMg: { type: 'number' },
                  vitaminAMcg: { type: 'number' },
                  vitaminCMg: { type: 'number' },
                  allergens: { type: 'array', items: { type: 'string' } },
                  glutenFree: { type: 'boolean' },
                  organic: { type: 'boolean' }
                },
                required: ['standardAmount', 'standardUnit', 'calories', 'proteinG', 'fatG', 'saturatedFatG', 'cholesterolMg', 'sodiumMg', 'carbohydratesG', 'dietaryFiberG', 'sugarsG'],
                additionalProperties: false
              },
              image: {
                type: 'object',
                properties: {
                  webUrl: { type: 'string' },
                  contentType: { type: 'string' }
                },
                required: ['webUrl', 'contentType'],
                additionalProperties: false
              }
            },
            required: ['basic', 'nutritionalInfo', 'image'],
            additionalProperties: false
          }
        }
      }
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (structuredResponse.data && structuredResponse.data.output_parsed) {
      return structuredResponse.data.output_parsed;
    }

    // Fallback to manual parsing if structured output fails
    return parseNutritionalDataManually(response.output_text || response.output, ingredientName);

  } catch (error) {
    console.error('Error extracting nutritional data:', error);
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
