/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * RECIPES ROUTES - Alexandria Service
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Recipe image generation, nutritional calculations, and ingredient resolution.
 * Uses oipClient to communicate with oip-daemon-service for data operations.
 * 
 * Note: Core ingredient resolution logic is in helpers/core/recipe-resolver.js
 * and is shared with the daemon's publish route.
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { generateRecipeImage } = require('../../helpers/core/generators');
const OIPClient = require('../../helpers/oipClient');

// Import shared recipe resolution functions
const {
    searchIngredientByName,
    fetchAndCreateIngredient,
    needsStandardUnitFix,
    fixStandardUnitWithAI,
    resolveRecipeIngredients
} = require('../../helpers/core/recipe-resolver');

/**
 * Helper to get oipClient from request context
 * @param {object} req - Express request with user token
 * @returns {OIPClient} Configured client
 */
function getOIPClient(req) {
    const token = req?.headers?.authorization?.replace('Bearer ', '') || null;
    return new OIPClient(token);
}

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
 * 
 * Note: This proxies to the daemon for the actual calculation since it needs
 * access to the full nutritional database
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
        
        const oipClient = getOIPClient(req);
        
        // Proxy to daemon's calculation endpoint
        const result = await oipClient.request('POST', '/api/recipes/calculate-nutrition', {
            ingredients,
            servings
        });
        
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

// Export the helper function on the router (for backward compatibility)
// Note: New code should import directly from helpers/core/recipe-resolver.js
router.resolveRecipeIngredients = resolveRecipeIngredients;

module.exports = router;
