const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
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

module.exports = router;

