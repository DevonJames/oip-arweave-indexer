const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { generateRecipeImage } = require('../helpers/generators');

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
    
    // Standard measurable units (excluding count-based units)
    const standardUnits = [
      'lb', 'lbs', 'oz', 'g', 'kg',  // Weight
      'cup', 'cups', 'tbsp', 'tsp', 'ml', 'l'  // Volume
    ];
    
    // Construct the AI prompt
    const prompt = `You are a nutrition expert. Analyze this nutritional information for "${ingredientName}".

Current Standard: ${nutritionalInfo.standardAmount} ${nutritionalInfo.standardUnit}

Nutritional Values:
- Calories: ${nutritionalInfo.calories}
- Protein: ${nutritionalInfo.proteinG}g
- Fat: ${nutritionalInfo.fatG}g
- Carbs: ${nutritionalInfo.carbohydratesG}g
- Sodium: ${nutritionalInfo.sodiumMg}mg

The current unit "${nutritionalInfo.standardUnit}" is non-standard and makes conversions difficult.

Please suggest a standard unit of measurement from this list: ${standardUnits.join(', ')}

Consider:
1. The type of food (solid vs liquid)
2. Common usage in recipes
3. Ease of conversion
4. The nutritional values provided

Respond ONLY with a JSON object in this exact format (no other text):
{
  "amount": <number>,
  "unit": "<one of the standard units>",
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
    if (!suggestion.amount || !suggestion.unit || !standardUnits.includes(suggestion.unit)) {
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

module.exports = router;

