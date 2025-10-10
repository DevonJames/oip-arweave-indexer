# Generating Meal Images Documentation

This document provides comprehensive information about the AI-powered meal image generation system used in FitnessAlly. The system automatically generates professional food photography for recipes that don't have images, particularly for AI-generated meals.

## Overview

The meal image generation system uses OpenAI's DALL-E 3 model to create high-quality, professional food photography for recipes. It includes both server-side and client-side caching mechanisms to optimize performance and reduce API costs.

## Architecture

### Backend API Endpoint
- **Location**: `server/routes.ts` (lines 13950-14037)
- **Endpoint**: `POST /api/recipes/generate-image`
- **Purpose**: Generates and caches recipe images using OpenAI DALL-E 3

### Frontend Integration
- **Main API Function**: `client/src/lib/api.ts` (lines 363-415)
- **Integration Points**: Multiple components across the application

## AI Model Configuration

### Model Details
- **Model**: DALL-E 3
- **Size**: 1024x1024 pixels
- **Quality**: Standard
- **Style**: Natural
- **Number of Images**: 1 per request

### Prompt Engineering

The system uses a carefully crafted prompt to ensure consistent, high-quality food photography:

```
Create a professional food blog style photo of {recipeTitle}. 
{description ? `Recipe description: ${description}` : ''}

Style requirements:
- High-quality food photography
- Hyper-realistic
- Professional lighting and composition
- Realistic ingredients
- Appetizing and visually appealing
- Clean, modern plating
- Bright, natural lighting
- Suitable for a food blog or cookbook
- Focus on making the dish look delicious and inviting
- NO TEXT, NO WORDS, NO LABELS anywhere in the image
- Pure food photography without any overlaid text or writing
```

## Backend Implementation

### API Endpoint Code

```typescript
app.post("/api/recipes/generate-image", async (req, res) => {
  try {
    const { recipeId, recipeTitle, description, forceRegenerate } = req.body;

    console.log('IMAGE Image generation request:', { recipeId, recipeTitle, description, forceRegenerate });

    if (!recipeId || !recipeTitle) {
      console.log('ERROR Missing required fields:', { recipeId: !!recipeId, recipeTitle: !!recipeTitle });
      return res.status(400).json({
        success: false,
        message: `Recipe ID and title are required. Got: recipeId=${recipeId}, recipeTitle=${recipeTitle}`
      });
    }

    // Create a cache directory if it doesn't exist
    const cacheDir = path.join(process.cwd(), 'generated-recipe-images');
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    // Check if image already exists in cache (skip if forceRegenerate is true)
    const cachedImagePath = path.join(cacheDir, `${recipeId}.png`);
    if (!forceRegenerate && fs.existsSync(cachedImagePath)) {
      return res.json({
        success: true,
        imageUrl: `/api/recipe-images/${recipeId}.png`,
        cached: true
      });
    }

    // Create professional food blog style prompt
    const prompt = `Create a professional food blog style photo of ${recipeTitle}. 
    ${description ? `Recipe description: ${description}` : ''}
    
    Style requirements:
    - High-quality food photography
    - Hyper-realistic
    - Professional lighting and composition
    - Realistic ingredients
    - Appetizing and visually appealing
    - Clean, modern plating
    - Bright, natural lighting
    - Suitable for a food blog or cookbook
    - Focus on making the dish look delicious and inviting
    - NO TEXT, NO WORDS, NO LABELS anywhere in the image
    - Pure food photography without any overlaid text or writing`;

    console.log(`Generating image for recipe: ${recipeTitle}`);

    const response = await openai.images.generate({
      model: "dall-e-3",
      prompt: prompt,
      size: "1024x1024",
      quality: "standard",
      style: "natural",
      n: 1,
    });

    const imageUrl = response.data?.[0]?.url;
    if (!imageUrl) {
      throw new Error("No image URL received from OpenAI");
    }

    // Download and cache the image
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to download image: ${imageResponse.statusText}`);
    }

    const imageBuffer = await imageResponse.buffer();
    fs.writeFileSync(cachedImagePath, imageBuffer);

    console.log(`Generated and cached image for recipe: ${recipeTitle}`);

    return res.json({
      success: true,
      imageUrl: `/api/recipe-images/${recipeId}.png`,
      cached: false
    });

  } catch (error: any) {
    console.error("Recipe image generation error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to generate recipe image"
    });
  }
});
```

### Image Serving Endpoint

```typescript
// Serve cached recipe images
app.get("/api/recipe-images/:filename", (req, res) => {
  try {
    const filename = req.params.filename;
    const imagePath = path.join(process.cwd(), 'generated-recipe-images', filename);
    
    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({ message: "Image not found" });
    }

    res.sendFile(imagePath);
  } catch (error) {
    console.error("Error serving recipe image:", error);
    res.status(500).json({ message: "Error serving image" });
  }
});
```

## Frontend Implementation

### Main API Function

```typescript
export async function generateRecipeImage(recipeTitle: string, description?: string, ingredients?: string[], forceRegenerate: boolean = false) {
  try {
    // Check localStorage cache first (unless forcing regeneration)
    const cacheKey = `recipe-image-${recipeTitle}`;
    if (!forceRegenerate) {
      const cachedUrl = localStorage.getItem(cacheKey);
      if (cachedUrl) {
        console.log('Using cached recipe image:', cachedUrl);
        return { success: true, imageUrl: cachedUrl, cached: true };
      }
    }

    const response = await fetch(`${API_BASE_URL}/api/recipes/generate-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ 
        recipeId: recipeTitle, // Use title as ID for caching
        recipeTitle, 
        description,
        ingredients: ingredients?.join(', '),
        forceRegenerate // Pass regenerate flag to backend
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to generate recipe image: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    
    // Convert relative URL to full URL and cache it
    if (data.success && data.imageUrl) {
      const fullImageUrl = data.imageUrl.startsWith('http') 
        ? data.imageUrl 
        : `${API_BASE_URL}${data.imageUrl}`;
      
      // Cache the full URL
      localStorage.setItem(cacheKey, fullImageUrl);
      
      // Return with full URL
      return { ...data, imageUrl: fullImageUrl };
    }
    
    return data;
  } catch (error) {
    console.error('Error generating recipe image:', error);
    throw error;
  }
}
```

## Integration Points

### 1. AI Meal Generator
- **File**: `client/src/pages/AIMealGeneratorPage.tsx`
- **Usage**: Generates images for newly created AI recipes
- **Features**: Supports force regeneration for better results

### 2. Recipe View Component
- **File**: `client/src/components/RecipeView.tsx`
- **Usage**: Automatically generates images for recipes without existing images
- **Behavior**: Loads cached images first, generates if not available

### 3. Dashboard Meal Cards
- **File**: `client/src/pages/DashboardPage.tsx`
- **Usage**: Generates background images for meal cards
- **Behavior**: Background generation without blocking UI

### 4. Setup Wizard
- **File**: `client/src/components/SetupWizard.tsx`
- **Usage**: Generates images during the initial setup process

## Caching Strategy

### Server-Side Caching
- **Location**: `generated-recipe-images/` directory
- **Format**: PNG files named by recipe ID
- **Purpose**: Avoid redundant API calls to OpenAI
- **Management**: Automatic directory creation and file storage

### Client-Side Caching
- **Storage**: Browser localStorage
- **Key Format**: `recipe-image-${recipeTitle}`
- **Purpose**: Fast image loading and reduced server requests
- **Management**: Automatic cache checking and storage

## Request Parameters

### Required Parameters
- `recipeId`: Unique identifier for the recipe
- `recipeTitle`: Name of the recipe for prompt generation

### Optional Parameters
- `description`: Recipe description to enhance prompt
- `ingredients`: List of ingredients (joined as comma-separated string)
- `forceRegenerate`: Boolean to bypass cache and generate new image

## Response Format

### Success Response
```json
{
  "success": true,
  "imageUrl": "/api/recipe-images/recipe-id.png",
  "cached": false
}
```

### Error Response
```json
{
  "success": false,
  "message": "Error description"
}
```

## Error Handling

### Common Error Scenarios
1. **Missing Parameters**: Returns 400 with specific field requirements
2. **OpenAI API Failures**: Returns 500 with error details
3. **Image Download Failures**: Returns 500 with download error
4. **File System Errors**: Returns 500 with file operation error

### Logging
- Request details logged with IMAGE prefix
- Error conditions logged with ERROR prefix
- Success operations logged with generation details

## Performance Considerations

### Optimization Features
1. **Dual Caching**: Both server and client-side caching
2. **Cache-First Strategy**: Check cache before API calls
3. **Background Generation**: Non-blocking image generation
4. **Force Regeneration**: Option to bypass cache when needed

### Cost Management
- Images are cached to minimize OpenAI API calls
- Client-side caching reduces server load
- Force regeneration only when explicitly requested

## File Structure

```
FitnessAlly/
├── server/
│   └── routes.ts (API endpoints)
├── client/src/
│   ├── lib/api.ts (main API function)
│   ├── pages/AIMealGeneratorPage.tsx
│   ├── components/RecipeView.tsx
│   ├── pages/DashboardPage.tsx
│   └── components/SetupWizard.tsx
└── generated-recipe-images/ (server-side cache)
    ├── recipe-id-1.png
    ├── recipe-id-2.png
    └── ...
```

## Usage Examples

### Basic Image Generation
```typescript
const result = await generateRecipeImage(
  "Grilled Chicken Salad",
  "A healthy and delicious salad with grilled chicken breast",
  ["chicken breast", "lettuce", "tomatoes", "cucumber"]
);
```

### Force Regeneration
```typescript
const result = await generateRecipeImage(
  "Grilled Chicken Salad",
  "A healthy and delicious salad with grilled chicken breast",
  ["chicken breast", "lettuce", "tomatoes", "cucumber"],
  true // Force regeneration
);
```

## Security Considerations

- API endpoint requires authentication (credentials: 'include')
- Input validation for required parameters
- File system operations are contained within the application directory
- No user-uploaded content in prompts (prevents prompt injection)

## Future Enhancements

1. **Image Quality Options**: Support for different quality levels
2. **Style Variations**: Multiple artistic styles beyond natural
3. **Batch Generation**: Generate multiple images per recipe
4. **Image Editing**: Post-generation image manipulation
5. **Alternative Models**: Support for other AI image generation models

---

*Last updated: 2024-12-19*
