const express = require('express');
const router = express.Router();
const axios = require('axios');
const cheerio = require('cheerio');

const { authenticateToken } = require('../helpers/utils'); // Import the authentication middleware
const { TurboFactory, ArDriveUploadDriver } = require('@ardrive/turbo-sdk');
const { 
  encryptContent,
  decryptContent,
  createBitcoinPaymentCondition 
} = require('../helpers/lit-protocol');
const fs = require('fs').promises;
const path = require('path');
const { getRecords } = require('../helpers/elasticsearch');
const { publishNewRecord} = require('../helpers/templateHelper');
const arweaveWallet = require('../helpers/arweave-wallet');
const paymentManager = require('../helpers/payment-manager');
const publisherManager = require('../helpers/publisher-manager');
const mediaManager = require('../helpers/media-manager');

// Kaggle integration for exercise data
let kaggleDataset = null;

/**
 * Initialize Kaggle dataset for exercise data
 */
async function initializeKaggleDataset() {
    if (kaggleDataset) return kaggleDataset;
    
    try {
        console.log('Initializing Kaggle fitness exercises dataset...');
        
        kaggleDataset = {
            searchExercise: async (exerciseName) => {
                return await searchKaggleExercise(exerciseName);
            }
        };
        
        console.log('Kaggle dataset initialized');
        return kaggleDataset;
    } catch (error) {
        console.error('Error initializing Kaggle dataset:', error);
        throw error;
    }
}

/**
 * Search for exercise data using Python Kaggle integration
 */
async function searchKaggleExercise(exerciseName) {
    try {
        console.log(`Searching Kaggle dataset for exercise: ${exerciseName}`);
        
        const { spawn } = require('child_process');
        const pythonScript = path.join(__dirname, '..', 'kaggle-exercise-fetcher.py');
        
        return new Promise((resolve, reject) => {
            const python = spawn('python3', [pythonScript, exerciseName, '--format', 'json']);
            
            let stdout = '';
            let stderr = '';
            
            python.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            
            python.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            
            python.on('close', (code) => {
                if (code === 0) {
                    try {
                        const exerciseData = JSON.parse(stdout);
                        console.log(`Found exercise data for ${exerciseName}:`, exerciseData);
                        resolve(exerciseData);
                    } catch (parseError) {
                        console.error('Error parsing exercise data JSON:', parseError);
                        resolve(null);
                    }
                } else {
                    console.log(`Python script exited with code ${code}`);
                    console.log('stderr:', stderr);
                    
                    // Fallback to mock data if Python script fails
                    console.log('Falling back to mock exercise data...');
                    const mockExerciseData = {
                        name: exerciseName,
                        instructions: [
                            "Set up in starting position",
                            "Perform the movement with proper form", 
                            "Return to starting position"
                        ],
                        muscle_groups: ["general"],
                        difficulty: "intermediate",
                        category: "strength",
                        equipment_required: [],
                        alternative_equipment: [],
                        is_bodyweight: true,
                        exercise_type: "compound",
                        recommended_sets: 3,
                        recommended_reps: 12,
                        duration_minutes: 0,
                        goal_tags: ["general fitness"],
                        image_url: "",
                        video_url: "",
                        source_url: "https://www.kaggle.com/datasets/edoardoba/fitness-exercises-with-animations"
                    };
                    resolve(mockExerciseData);
                }
            });
            
            python.on('error', (error) => {
                console.error('Error running Python script:', error);
                // Resolve with null to trigger fallback
                resolve(null);
            });
        });
        
    } catch (error) {
        console.error(`Error searching for exercise ${exerciseName}:`, error);
        return null;
    }
}

/**
 * Create new exercise record from Kaggle data
 */
async function createNewExerciseRecord(exerciseName, blockchain = 'arweave') {
    try {
        console.log(`Fetching exercise info for missing exercise: ${exerciseName}`);
        
        // Initialize Kaggle dataset
        const dataset = await initializeKaggleDataset();
        
        // Search for exercise in Kaggle dataset
        const exerciseData = await dataset.searchExercise(exerciseName);
        
        if (!exerciseData) {
            console.log(`No exercise found in Kaggle dataset for: ${exerciseName}`);
            return null;
        }
        
        // Format the exercise data according to OIP exercise template
        const formattedExerciseInfo = {
            basic: {
                name: exerciseData.name,
                date: Math.floor(Date.now() / 1000),
                language: 'en',
                nsfw: false,
                webUrl: exerciseData.source_url,
                description: `${exerciseData.name} - ${exerciseData.category} exercise targeting ${exerciseData.muscle_groups.join(', ')}`,
                tagItems: exerciseData.goal_tags || []
            },
            exercise: {
                instructions: exerciseData.instructions,
                muscleGroups: exerciseData.muscle_groups,
                difficulty: exerciseData.difficulty,
                category: exerciseData.category,
                imageUrl: exerciseData.image_url || '',
                videoUrl: exerciseData.video_url || '',
                gitUrl: '', // Not available in Kaggle dataset
                equipmentRequired: exerciseData.equipment_required || [],
                alternativeEquipment: exerciseData.alternative_equipment || [],
                isBodyweight: exerciseData.is_bodyweight || false,
                exercise_type: exerciseData.exercise_type,
                duration_minutes: exerciseData.duration_minutes || 0,
                duration_target: exerciseData.duration_minutes || 0,
                recommended_sets: exerciseData.recommended_sets || 3,
                recommended_reps: exerciseData.recommended_reps || 12,
                goalTags: exerciseData.goal_tags || []
            }
        };
        
        // Publish the exercise record
        const exerciseTx = await publishNewRecord(formattedExerciseInfo, "exercise", false, false, false, null, blockchain);
        console.log(`Successfully retrieved and published exercise info for ${exerciseName}:`, formattedExerciseInfo, exerciseTx);
        return exerciseTx.recordToIndex;
    } catch (error) {
        console.error(`Error fetching exercise info for ${exerciseName}:`, error);
        return null;
    }
}

// Initialize ArDrive Turbo with wallet file
const initTurbo = async () => {
    try {
        const walletData = await fs.readFile(process.env.WALLET_FILE, 'utf8');
        const wallet = JSON.parse(walletData);
        
        const turbo = await TurboFactory.init({
            wallet,
            turboUrl: process.env.TURBO_URL || 'https://turbo.ardrive.io'
        });

        return turbo;
    } catch (error) {
        console.error('Failed to initialize Turbo with wallet file:', error);
        throw error;
    }
};

let turboInstance = null;

// Get or initialize Turbo instance
const getTurbo = async () => {
    if (!turboInstance) {
        turboInstance = await initTurbo();
    }
    return turboInstance;
};

// Add schema/example endpoints for proper JSON formatting
router.get('/newRecipe/schema', (req, res) => {
    try {
        const recipeSchema = {
            "description": "Complete JSON schema for publishing a new recipe via POST /api/publish/newRecipe",
            "example": {
                "basic": {
                    "name": "Mediterranean Grilled Chicken",
                    "language": "en",
                    "date": Math.floor(Date.now() / 1000),
                    "description": "Juicy grilled chicken thighs marinated in a bold Mediterranean-style blend of garlic, lemon, and spices.",
                    "webUrl": "https://example.com/recipe",
                    "nsfw": false,
                    "tagItems": ["grilled", "mediterranean", "chicken", "healthy"]
                },
                "recipe": {
                    "prep_time_mins": 15,
                    "cook_time_mins": 25,
                    "total_time_mins": 40,
                    "servings": 4,
                    "ingredient_amount": [4, 2, 1, 0.5, 2],
                    "ingredient_unit": ["pieces", "tbsp", "lemon", "tsp", "cloves"],
                    "ingredient": [
                        "chicken thighs, boneless skinless",
                        "olive oil, extra virgin", 
                        "lemon, juiced",
                        "oregano, dried",
                        "garlic, minced"
                    ],
                    "instructions": "1. Marinate chicken in olive oil, lemon juice, oregano, and garlic for 30 minutes.\n2. Preheat grill to medium-high heat.\n3. Grill chicken for 6-7 minutes per side until cooked through.\n4. Let rest for 5 minutes before serving.",
                    "notes": "For best results, marinate for at least 30 minutes or up to 4 hours.",
                    "cuisine": "Mediterranean",
                    "course": "Main Course",
                    "author": "Chef Example"
                },
                "image": {
                    "webUrl": "https://example.com/recipe-image.jpg",
                    "contentType": "image/jpeg"
                },
                "blockchain": "arweave"
            },
            "field_descriptions": {
                "basic.name": "Recipe title (required)",
                "basic.language": "Language code (default: 'en')",
                "basic.date": "Unix timestamp (default: current time)",
                "basic.description": "Recipe description (required)",
                "basic.webUrl": "Optional source URL",
                "basic.nsfw": "Boolean for adult content (default: false)",
                "basic.tagItems": "Array of tags for categorization",
                "recipe.prep_time_mins": "Preparation time in minutes",
                "recipe.cook_time_mins": "Cooking time in minutes", 
                "recipe.total_time_mins": "Total time in minutes",
                "recipe.servings": "Number of servings",
                "recipe.ingredient_amount": "Array of amounts (numbers)",
                "recipe.ingredient_unit": "Array of units (strings)",
                "recipe.ingredient": "Array of ingredient names with optional descriptors",
                "recipe.instructions": "Step-by-step cooking instructions",
                "recipe.notes": "Optional additional notes",
                "recipe.cuisine": "Cuisine type (e.g., 'Italian', 'Mexican')",
                "recipe.course": "Course type (e.g., 'Main Course', 'Dessert')",
                "recipe.author": "Recipe author name",
                "image.webUrl": "URL to recipe image",
                "image.contentType": "Image MIME type",
                "blockchain": "Target blockchain ('arweave' or 'turbo')"
            },
            "ingredient_parsing_notes": {
                "format": "Ingredients support automatic parsing of comments in parentheses or after commas",
                "examples": [
                    "chicken thighs, boneless skinless",
                    "flour tortillas (12-inch)",
                    "garlic cloves (minced)",
                    "olive oil, extra virgin"
                ],
                "automatic_processing": "The system will automatically separate base ingredients from descriptive comments and look up nutritional information"
            }
        };

        res.status(200).json(recipeSchema);
    } catch (error) {
        console.error('Error generating recipe schema:', error);
        res.status(500).json({ error: 'Failed to generate recipe schema' });
    }
});

// Add workout schema endpoint
router.get('/newWorkout/schema', (req, res) => {
    try {
        const workoutSchema = {
            "description": "Complete JSON schema for publishing a new workout via POST /api/publish/newWorkout",
            "example": {
                "basic": {
                    "name": "Upper Body Strength Training",
                    "language": "en", 
                    "date": Math.floor(Date.now() / 1000),
                    "description": "A comprehensive upper body workout focusing on strength and muscle building.",
                    "webUrl": "https://example.com/workout",
                    "nsfw": false,
                    "tagItems": ["strength", "upper body", "muscle building", "intermediate"]
                },
                "workout_duration_minutes": 45,
                "workout_difficulty": "intermediate",
                "workout_category": "strength",
                "equipment_required": ["dumbbells", "bench", "pull-up bar"],
                "target_muscle_groups": ["chest", "shoulders", "arms", "back"],
                "goal_tags": ["muscle building", "strength"],
                "workout": [
                    {
                        "section_name": "Warm-up",
                        "section_duration_minutes": 5,
                        "exercises": [
                            {
                                "name": "arm circles",
                                "sets": 1,
                                "reps": 10,
                                "duration_seconds": null,
                                "rest_seconds": 30,
                                "weight_lbs": null,
                                "notes": "Forward and backward"
                            }
                        ]
                    },
                    {
                        "section_name": "Main Workout", 
                        "section_duration_minutes": 35,
                        "exercises": [
                            {
                                "name": "push-ups",
                                "sets": 3,
                                "reps": 12,
                                "duration_seconds": null,
                                "rest_seconds": 60,
                                "weight_lbs": null,
                                "notes": "Focus on proper form"
                            },
                            {
                                "name": "dumbbell bench press",
                                "sets": 3,
                                "reps": 10,
                                "duration_seconds": null,
                                "rest_seconds": 90,
                                "weight_lbs": 25,
                                "notes": "Control the weight"
                            }
                        ]
                    }
                ],
                "notes": "Ensure proper form throughout all exercises",
                "created_by": "Trainer Example",
                "nonStandardWorkout": false,
                "image": {
                    "webUrl": "https://example.com/workout-image.jpg",
                    "contentType": "image/jpeg"
                },
                "blockchain": "arweave"
            },
            "field_descriptions": {
                "basic.*": "Same structure as recipe basic fields",
                "workout_duration_minutes": "Total workout duration",
                "workout_difficulty": "Difficulty level: 'beginner', 'intermediate', 'advanced'",
                "workout_category": "Category: 'strength', 'cardio', 'flexibility', 'sports'",
                "equipment_required": "Array of required equipment",
                "target_muscle_groups": "Array of targeted muscle groups",
                "goal_tags": "Array of fitness goals",
                "workout": "Array of workout sections",
                "workout[].section_name": "Name of workout section",
                "workout[].exercises": "Array of exercises in this section",
                "workout[].exercises[].name": "Exercise name (will be looked up in exercise database)",
                "nonStandardWorkout": "Set to true to skip exercise database lookup",
                "blockchain": "Target blockchain ('arweave' or 'turbo')"
            },
            "exercise_lookup_notes": {
                "automatic_processing": "Exercise names are automatically looked up in the exercise database",
                "fallback": "Missing exercises are created from Kaggle fitness dataset",
                "bypass": "Set 'nonStandardWorkout: true' to skip exercise lookup and use custom exercises"
            }
        };

        res.status(200).json(workoutSchema);
    } catch (error) {
        console.error('Error generating workout schema:', error);
        res.status(500).json({ error: 'Failed to generate workout schema' });
    }
});

// Add post schema endpoint
router.get('/newPost/schema', (req, res) => {
    try {
        const postSchema = {
            "description": "Complete JSON schema for publishing a new post via POST /api/publish/newPost",
            "example": {
                "basic": {
                    "name": "Breaking: New Discovery in AI Research",
                    "language": "en",
                    "date": Math.floor(Date.now() / 1000),
                    "description": "Scientists announce breakthrough in neural network efficiency",
                    "webUrl": "https://example.com/article",
                    "nsfw": false,
                    "tagItems": ["AI", "research", "technology", "science"]
                },
                "post": {
                    "webUrl": "https://example.com/full-article",
                    "bylineWriter": "Dr. Jane Smith",
                    "bylineWritersTitle": "Senior AI Researcher",
                    "bylineWritersLocation": "Stanford University",
                    "articleText": "In a groundbreaking study published today, researchers have developed a new neural network architecture that...",
                    "featuredImage": "did:arweave:abc123...",
                    "imageItems": ["did:arweave:img1...", "did:arweave:img2..."],
                    "imageCaptionItems": ["Figure 1: Neural network diagram", "Figure 2: Performance comparison"],
                    "videoItems": ["did:arweave:vid1..."],
                    "audioItems": ["did:arweave:aud1..."],
                    "audioCaptionItems": ["Interview with lead researcher"],
                    "replyTo": "did:arweave:original-post..."
                },
                "blockchain": "arweave"
            },
            "field_descriptions": {
                "basic.*": "Same structure as recipe basic fields",
                "post.webUrl": "URL to full article or source",
                "post.bylineWriter": "Author name",
                "post.bylineWritersTitle": "Author title/position",
                "post.bylineWritersLocation": "Author location/organization",
                "post.articleText": "Main article content",
                "post.featuredImage": "DID reference to main image",
                "post.imageItems": "Array of DID references to images",
                "post.imageCaptionItems": "Array of image captions (parallel to imageItems)",
                "post.videoItems": "Array of DID references to videos",
                "post.audioItems": "Array of DID references to audio files",
                "post.audioCaptionItems": "Array of audio captions",
                "post.replyTo": "DID reference to post being replied to (for comments/replies)",
                "blockchain": "Target blockchain ('arweave' or 'turbo')"
            }
        };

        res.status(200).json(postSchema);
    } catch (error) {
        console.error('Error generating post schema:', error);
        res.status(500).json({ error: 'Failed to generate post schema' });
    }
});

// Add general schema endpoint that lists all available schemas
router.get('/schemas', (req, res) => {
    try {
        const availableSchemas = {
            "description": "Available JSON schemas for OIP publishing endpoints",
            "schemas": {
                "recipe": {
                    "endpoint": "POST /api/publish/newRecipe",
                    "schema_url": "GET /api/publish/newRecipe/schema",
                    "description": "Publish recipe records with automatic ingredient processing"
                },
                "workout": {
                    "endpoint": "POST /api/publish/newWorkout", 
                    "schema_url": "GET /api/publish/newWorkout/schema",
                    "description": "Publish workout records with automatic exercise lookup"
                },
                "post": {
                    "endpoint": "POST /api/publish/newPost",
                    "schema_url": "GET /api/publish/newPost/schema", 
                    "description": "Publish article/blog post records"
                },
                "video": {
                    "endpoint": "POST /api/publish/newVideo",
                    "description": "Publish video records with YouTube support"
                },
                "image": {
                    "endpoint": "POST /api/publish/newImage",
                    "description": "Publish image records"
                },
                "media": {
                    "endpoint": "POST /api/publish/newMedia",
                    "description": "General media publishing endpoint"
                }
            },
            "common_parameters": {
                "blockchain": "Target blockchain: 'arweave' (default) or 'turbo'",
                "publishFiles": "Boolean to enable file publishing (default: varies by endpoint)",
                "addMediaToArweave": "Boolean to store media on Arweave (default: true)",
                "addMediaToIPFS": "Boolean to store media on IPFS (default: false)",
                "addMediaToArFleet": "Boolean to store media on ArFleet (default: false)"
            }
        };

        res.status(200).json(availableSchemas);
    } catch (error) {
        console.error('Error generating schemas list:', error);
        res.status(500).json({ error: 'Failed to generate schemas list' });
    }
});

// Function to parse ingredient strings and separate base ingredient from comments
function parseIngredientString(ingredientString) {
    const original = ingredientString.trim();
    let ingredient = original;
    let comment = '';
    
    // Strategy: Identify the core ingredient (usually a noun) and separate descriptive modifiers
    
    // Handle complex ingredient alternatives (e.g., "bacon, or prosciutto, pancetta, or sausage patties, crisped")
    // These should be treated as the primary ingredient with alternatives as comments
    if (ingredient.includes(' or ') && ingredient.includes(',')) {
        // Split on first comma to get primary ingredient vs alternatives
        const firstCommaIndex = ingredient.indexOf(',');
        const primaryIngredient = ingredient.substring(0, firstCommaIndex).trim();
        const alternatives = ingredient.substring(firstCommaIndex + 1).trim();
        
        // If alternatives start with "or", it's likely an ingredient choice
        if (alternatives.startsWith('or ')) {
            ingredient = primaryIngredient;
            comment = alternatives;
            return { originalString: original, ingredient, comment };
        }
    }
    
    // 1. Handle parentheses first (e.g., "flour tortillas (12-inch)")
    const parenMatch = ingredient.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    if (parenMatch) {
        const beforeParen = parenMatch[1].trim();
        const inParen = parenMatch[2].trim();
        
        // Common parenthetical comments
        const isComment = 
            /\d+\s*-?\s*inch/i.test(inParen) ||
            /\d+\s*oz/i.test(inParen) ||
            /each|optional|plus more|for garnish|to taste/i.test(inParen);
        
        if (isComment) {
            ingredient = beforeParen;
            comment = inParen;
            return { originalString: original, ingredient, comment };
        }
    }
    
    // 2. Handle comma-separated descriptors (e.g., "ground beef, grass-fed")
    const commaIndex = ingredient.indexOf(',');
    if (commaIndex !== -1) {
        const beforeComma = ingredient.substring(0, commaIndex).trim();
        const afterComma = ingredient.substring(commaIndex + 1).trim();
        
        // Check if after comma is a descriptor
        const isDescriptor = 
            /^(grass[- ]?fed|pasture[- ]?raised|free[- ]?range|wild[- ]?caught)$/i.test(afterComma) ||
            /^(organic|fresh|frozen|dried|raw|canned|bottled)$/i.test(afterComma) ||
            /^(extra|virgin|pure|unfiltered|cold[- ]?pressed)$/i.test(afterComma) ||
            /^(minced|diced|chopped|sliced|shredded|grated|crushed)$/i.test(afterComma) ||
            /^(to taste|optional|as needed|for serving|for garnish)$/i.test(afterComma) ||
            /^(boneless|skinless|trimmed|lean)$/i.test(afterComma) ||
            /^(fried|baked|roasted|grilled|steamed|boiled)$/i.test(afterComma);
        
        if (isDescriptor) {
            ingredient = beforeComma;
            comment = afterComma;
            return { originalString: original, ingredient, comment };
        }
    }
    
    // 3. Handle leading descriptors (e.g., "ground beef" -> ingredient: "beef", comment: "ground")
    const words = ingredient.split(' ');
    if (words.length >= 2) {
        const firstWord = words[0].toLowerCase();
        const restOfWords = words.slice(1).join(' ');
        
        // Common leading descriptors
        const leadingDescriptors = [
            'ground', 'whole', 'fresh', 'dried', 'frozen', 'organic', 'raw', 'cooked',
            'boneless', 'skinless', 'trimmed', 'lean', 'extra', 'virgin', 'pure'
        ];
        
        if (leadingDescriptors.includes(firstWord) && restOfWords.length > 2) {
            // Special case: don't separate "ground beef" or "ground pork" - these are distinct ingredients
            if (firstWord === 'ground' && /^(beef|pork|turkey|chicken|lamb)$/i.test(words[1])) {
                ingredient = `${words[0]} ${words[1]}`;
                if (words.length > 2) {
                    comment = words.slice(2).join(' ');
                }
            } else {
                ingredient = restOfWords;
                comment = firstWord;
            }
            return { originalString: original, ingredient, comment };
        }
    }
    
    return {
        originalString: original,
        ingredient: ingredient,
        comment: comment
    };
}

// Function to create new nutritional info records for missing ingredients
async function createNewNutritionalInfoRecord(ingredientName, blockchain = 'arweave') {
    // Try Nutritionix API first, fallback to scraping if needed
  const nutritionixAppId = process.env.NUTRITIONIX_APP_ID;
  const nutritionixApiKey = process.env.NUTRITIONIX_API_KEY;
  
  try {
    console.log(`Fetching nutritional info for missing ingredient: ${ingredientName}`);

    // Option 1: Use Nutritionix API (preferred)
    if (nutritionixAppId && nutritionixApiKey) {
       try {
         console.log('Using Nutritionix API...');
         const apiResponse = await axios.post(
           'https://trackapi.nutritionix.com/v2/natural/nutrients',
           {
             query: ingredientName,
             timezone: "US/Eastern"
           },
           {
             headers: {
               'x-app-id': nutritionixAppId,
               'x-app-key': nutritionixApiKey,
               'Content-Type': 'application/json'
             }
           }
         );

         if (apiResponse.data && apiResponse.data.foods && apiResponse.data.foods.length > 0) {
           const food = apiResponse.data.foods[0];
           
           // CRITICAL FIX: Always use the original ingredient name, not the API's normalized name
           // This ensures that "grass-fed butter" creates a record called "grass-fed butter", not "butter"
           const formattedNutritionalInfo = {
             basic: {
               name: ingredientName, // Use original name instead of food.food_name
               date: Math.floor(Date.now() / 1000),
               language: 'en',
               nsfw: false,
               webUrl: `https://www.nutritionix.com/food/${ingredientName.replace(/\s+/g, '-').toLowerCase()}`,
             },
             nutritionalInfo: {
               standardAmount: food.serving_qty || 1,
               standardUnit: food.serving_unit || 'g',
               calories: food.nf_calories || 0,
               proteinG: food.nf_protein || 0,
               fatG: food.nf_total_fat || 0,
               saturatedFatG: food.nf_saturated_fat || 0,
               transFatG: food.nf_trans_fatty_acid || 0, // Available in API
               cholesterolMg: food.nf_cholesterol || 0,
               sodiumMg: food.nf_sodium || 0,
               carbohydratesG: food.nf_total_carbohydrate || 0,
               dietaryFiberG: food.nf_dietary_fiber || 0,
               sugarsG: food.nf_sugars || 0,
               addedSugarsG: food.nf_added_sugars || 0, // Available in API
               vitaminDMcg: food.nf_vitamin_d_mcg || 0, // Available in API
               calciumMg: food.nf_calcium || 0,
               ironMg: food.nf_iron || 0,
               potassiumMg: food.nf_potassium || 0,
               vitaminAMcg: food.nf_vitamin_a_iu ? (food.nf_vitamin_a_iu * 0.3) : 0, // Convert IU to mcg
               vitaminCMg: food.nf_vitamin_c || 0,
               allergens: [],
               glutenFree: false,
               organic: false,
               // Store the API's normalized name for reference
               nutritionixName: food.food_name || ingredientName,
             },
             image: {
               webUrl: food.photo?.thumb || food.photo?.highres || food.photo || '',
               contentType: 'image/jpeg'
             }
           };

           console.log(`Successfully fetched from Nutritionix API for ${ingredientName}:`, formattedNutritionalInfo);
           const ingredientTx = await publishNewRecord(formattedNutritionalInfo, "nutritionalInfo", false, false, false, null, blockchain);
           return ingredientTx.recordToIndex;
         } else {
           console.log(`No foods found in Nutritionix API response for ${ingredientName}`);
         }
       } catch (apiError) {
         console.error(`Nutritionix API error for ${ingredientName}:`, apiError.response?.status, apiError.response?.data || apiError.message);
       }
     }

    // Option 2: Fallback to scraping (won't work with current implementation)
    console.log('Nutritionix API not available, falling back to scraping...');
    const firecrawlToken = process.env.FIRECRAWL;
    if (!firecrawlToken) {
      throw new Error('Neither Nutritionix API nor Firecrawl token available');
    }

    // Construct a Nutritionix search URL
    const formattedIngredient = ingredientName.replace(/,/g, '').replace(/\s+/g, '-').toLowerCase();
    const nutritionixUrl = `https://www.nutritionix.com/food/${formattedIngredient}`;

    // Scrape the Nutritionix page using FireCrawl
    const response = await axios.post(
      'https://api.firecrawl.dev/v1/scrape',
      {
        url: nutritionixUrl,
        formats: ['html'],
        waitFor: 3000, // Wait for JavaScript to load
        screenshot: false
      },
      {
        headers: {
          Authorization: `Bearer ${firecrawlToken}`,
        },
      }
    );

    if (!response.data.success) {
      console.log(`Scrape failed for ${ingredientName}: ${response.data.error}`);
      // Return fallback data
      return await createFallbackNutritionalInfo(ingredientName, blockchain);
    }

    // console.log('Scrape successful:', response.data);
    const html = response.data.data.html;
    const $ = cheerio.load(html);

    // Extract basic information
    const name = $('h1.food-item-name').text().trim() || ingredientName;
    const date = Math.floor(Date.now() / 1000); // Current timestamp
    const webUrl = nutritionixUrl;
    const language = 'en';

    // Initialize nutritional data object
    const nutritionTable = {
      calories: 0,
      protein_g: 0,
      fat_g: 0,
      saturated_fat_g: 0,
      trans_fat_g: 0,
      carbohydrates_g: 0,
      dietary_fiber_g: 0,
      sugars_g: 0,
      added_sugars_g: 0,
      cholesterol_mg: 0,
      sodium_mg: 0,
      vitamin_d_mcg: 0,
      calcium_mg: 0,
      iron_mg: 0,
      potassium_mg: 0,
      vitamin_a_mcg: 0,
      vitamin_c_mg: 0,
      allergens: [],
      gluten_free: false,
      organic: false,
    };

    // Parse nutritional facts using the HTML structure
    const nfLines = $('.nf-line');
    console.log(`Found ${nfLines.length} .nf-line elements`);
    
    if (nfLines.length === 0) {
      console.log('No .nf-line elements found. Trying alternative selectors...');
      console.log('Available classes in HTML:', $('*').map((i, el) => $(el).attr('class')).get().filter(c => c).slice(0, 20));
    }
    
    $('.nf-line').each((_, element) => {
      const label = $(element).find('span:first-child').text().trim().toLowerCase();
      const valueRaw = $(element).find('span[itemprop]').text().trim();
      const value = parseFloat(valueRaw.replace(/[^\d.]/g, '')) || 0;

      console.log(`Label: ${label}, Raw Value: ${valueRaw}, Parsed Value: ${value}`);

      if (label.includes('calories')) {
        console.log(`*** CALORIES FOUND! Setting nutritionTable.calories = ${value}`);
        nutritionTable.calories = value;
      } else if (label.includes('protein')) {
        nutritionTable.protein_g = value;
      } else if (label.includes('saturated fat')) {
        nutritionTable.saturated_fat_g = value;
      } else if (label.includes('trans fat')) {
        nutritionTable.trans_fat_g = value;
      } else if (label.includes('fat') && !label.includes('saturated') && !label.includes('trans')) {
        nutritionTable.fat_g = value;
      } else if (label.includes('cholesterol')) {
        nutritionTable.cholesterol_mg = value;
      } else if (label.includes('sodium')) {
        nutritionTable.sodium_mg = value;
      } else if (label.includes('dietary fiber')) {
        nutritionTable.dietary_fiber_g = value;
      } else if (label.includes('total sugars') || (label.includes('sugars') && !label.includes('added'))) {
        nutritionTable.sugars_g = value;
      } else if (label.includes('added sugars')) {
        nutritionTable.added_sugars_g = value;
      } else if (label.includes('carbohydrates')) {
        nutritionTable.carbohydrates_g = value;
      } else if (label.includes('vitamin d')) {
        nutritionTable.vitamin_d_mcg = value;
      } else if (label.includes('calcium')) {
        nutritionTable.calcium_mg = value;
      } else if (label.includes('iron')) {
        nutritionTable.iron_mg = value;
      } else if (label.includes('potassium')) {
        nutritionTable.potassium_mg = value;
      } else if (label.includes('vitamin a')) {
        nutritionTable.vitamin_a_mcg = value;
      } else if (label.includes('vitamin c')) {
        nutritionTable.vitamin_c_mg = value;
      }
    });

    // Debug: Check final nutritionTable values
    console.log(`*** FINAL nutritionTable.calories = ${nutritionTable.calories}`);
    console.log(`*** FINAL nutritionTable object:`, nutritionTable);

    // Check if scraping found any data - if calories is still 0 and no elements found, use fallback
    if (nutritionTable.calories === 0 && nfLines.length === 0) {
      console.log(`No nutritional data found via scraping for ${ingredientName}, using fallback`);
      return await createFallbackNutritionalInfo(ingredientName, blockchain);
    }

    // Get serving size
    const servingSizeText = $('.nf-serving-unit-name').text().trim();
    const servingSizeMatch = servingSizeText.match(/(\d+)\s*(\w+)/);
    const standardAmount = servingSizeMatch ? parseInt(servingSizeMatch[1], 10) : 1;
    const standardUnit = servingSizeMatch ? servingSizeMatch[2].toLowerCase() : 'g';

    // Format the extracted data into the required structure
    const formattedNutritionalInfo = {
      basic: {
        name,
        date,
        language,
        nsfw: false,
        webUrl,
      },
      nutritionalInfo: {
        standardAmount: standardAmount,
        standardUnit: standardUnit,
        calories: nutritionTable.calories,
        proteinG: nutritionTable.protein_g,
        fatG: nutritionTable.fat_g,
        saturatedFatG: nutritionTable.saturated_fat_g || 0,
        transFatG: nutritionTable.trans_fat_g || 0,
        cholesterolMg: nutritionTable.cholesterol_mg,
        sodiumMg: nutritionTable.sodium_mg,
        carbohydratesG: nutritionTable.carbohydrates_g,
        dietaryFiberG: nutritionTable.dietary_fiber_g || 0,
        sugarsG: nutritionTable.sugars_g || 0,
        addedSugarsG: nutritionTable.added_sugars_g || 0,
        vitaminDMcg: nutritionTable.vitamin_d_mcg || 0,
        calciumMg: nutritionTable.calcium_mg || 0,
        ironMg: nutritionTable.iron_mg || 0,
        potassiumMg: nutritionTable.potassium_mg || 0,
        vitaminAMcg: nutritionTable.vitamin_a_mcg || 0,
        vitaminCMg: nutritionTable.vitamin_c_mg || 0,
        allergens: nutritionTable.allergens || [],
        glutenFree: nutritionTable.gluten_free || false,
        organic: nutritionTable.organic || false,
      },
      image: {
        webUrl: '', // No image available from scraping
        contentType: 'image/jpeg'
      }
    };

    console.log(`*** PUBLISHING nutritionalInfo with calories = ${formattedNutritionalInfo.nutritionalInfo.calories}`);
    ingredientTx = await publishNewRecord(formattedNutritionalInfo, "nutritionalInfo", false, false, false, null, blockchain)
    console.log(`Successfully retrieved and published nutritional info for ${ingredientName}:`, formattedNutritionalInfo, ingredientTx);
    return ingredientTx.recordToIndex;
  } catch (error) {
    console.error(`Error fetching nutritional info for ${ingredientName}:`, error);
    // Return fallback data instead of null
    return await createFallbackNutritionalInfo(ingredientName, blockchain);
  }
}

// Fallback function to create basic nutritional info when API/scraping fails
async function createFallbackNutritionalInfo(ingredientName, blockchain = 'arweave') {
  try {
    console.log(`Creating fallback nutritional info for ${ingredientName}`);
    
    const formattedNutritionalInfo = {
      basic: {
        name: ingredientName, // Always preserve the original ingredient name
        date: Math.floor(Date.now() / 1000),
        language: 'en',
        nsfw: false,
        webUrl: `https://www.nutritionix.com/food/${ingredientName.replace(/\s+/g, '-').toLowerCase()}`,
      },
      nutritionalInfo: {
        standardAmount: 1,
        standardUnit: 'unit',
        calories: 0, // Will need to be updated manually
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
        glutenFree: false,
        organic: false,
        isFallback: true, // Mark as fallback for future reference
      },
      image: {
        webUrl: '', // No image available for fallback
        contentType: 'image/jpeg'
      }
    };

    console.log(`Creating fallback record for ${ingredientName}:`, formattedNutritionalInfo);
    const ingredientTx = await publishNewRecord(formattedNutritionalInfo, "nutritionalInfo", false, false, false, null, blockchain);
    return ingredientTx.recordToIndex;
  } catch (error) {
    console.error(`Error creating fallback nutritional info for ${ingredientName}:`, error);
    return null;
  }
}

router.post('/newRecipe', async (req, res) => {

    try {
        console.log('POST /api/publish/newRecipe', req.body)
        console.log('ENV CHECK - NUTRITIONIX_APP_ID:', process.env.NUTRITIONIX_APP_ID ? 'EXISTS' : 'MISSING');
        console.log('ENV CHECK - NUTRITIONIX_API_KEY:', process.env.NUTRITIONIX_API_KEY ? 'EXISTS' : 'MISSING');
        const record = req.body;
        const blockchain = req.body.blockchain || 'arweave'; // Get blockchain parameter, default to arweave
        let recordType = 'recipe';

    // Process ingredients directly from the single recipe object
    const ingredients = record.recipe.ingredient.map((name, i) => ({
        amount: parseFloat(record.recipe.ingredient_amount[i]) || null,
        unit: record.recipe.ingredient_unit[i] || '',
        name: name || '',
    }));

    console.log('Processing single recipe section with', ingredients.length, 'ingredients');

  // Extract instructions directly from recipe object
  const instructions = record.recipe.instructions || '';

  console.log('Instructions:', instructions);

  // Parse ingredient strings to separate base ingredients from comments
  const parsedIngredients = ingredients.map(ing => {
    const parsed = parseIngredientString(ing.name);
    console.log(`Parsed ingredient: "${parsed.originalString}" -> ingredient: "${parsed.ingredient}", comment: "${parsed.comment}"`);
    return parsed;
  });

  // Use the cleaned ingredient names for nutritional lookup
  const ingredientNames = parsedIngredients.map(parsed => {
    // Remove all commas and extra whitespace, convert to lowercase
    const normalizedIngredientName = parsed.ingredient.trim().toLowerCase().replace(/,/g, '').replace(/\s+/g, ' ');
    return normalizedIngredientName;
  });
  
  // Store the comments for the recipe record
  const ingredientComments = parsedIngredients.map(parsed => parsed.comment);
  
  const ingredientAmounts = ingredients.map(ing => ing.amount ?? 1);
  const ingredientUnits = ingredients.map(ing => (ing.unit && ing.unit.trim()) || 'unit'); // Default unit to 'unit'

  console.log('Parsed ingredients:', parsedIngredients);
  console.log('Cleaned ingredient names for lookup:', ingredientNames);
  console.log('Ingredient comments:', ingredientComments);
  console.log('Ingredient units:', ingredientUnits);
    
  // Define ingredient synonyms for better matching
  const synonymMap = {
      "garlic cloves": "minced garlic",
      "ground green cardamom": "ground cardamom",
      "chicken breast": "boneless skinless chicken breast",
      "chicken thighs": "boneless skinless chicken thighs",
      "olive oil": "extra virgin olive oil",
      "vegetable oil": "seed oil",
      "all-purpose flour": "flour",
      "green onions": "scallions",
      "cilantro": "fresh cilantro",
      "parsley": "fresh parsley",
      "basil": "fresh basil",
      "oregano": "fresh oregano",
      "thyme": "fresh thyme",
      "rosemary": "fresh rosemary",
      "sage": "fresh sage",
      "dill": "fresh dill",
      "mint": "fresh mint",
      "chives": "fresh chives",
      "tarragon": "fresh tarragon",
      "bay leaves": "dried bay leaves",
      "red pepper flakes": "crushed red pepper",
      "red pepper": "red bell pepper",
      // Add more as needed
  };

  let recordMap = {};
    
  async function fetchIngredientRecordData(cleanedIngredientNames, originalIngredientNames) {
    // CRITICAL FIX: Use the full cleaned ingredient names for search
    // This ensures "grass-fed butter" searches for "grass-fed butter" and creates "grass-fed butter"
    // Instead of searching for "butter" but creating "grass-fed butter"
    const coreIngredientTerms = cleanedIngredientNames.map(name => {
      // Clean the name completely - remove commas, extra spaces
      const cleanName = name.replace(/,/g, '').replace(/\s+/g, ' ').trim();
      
      // For consistency, use the full cleaned name for both search and record creation
      // This prevents the mismatch where we search for "butter" but create "grass-fed butter"
      return cleanName;
    });

    console.log('Core ingredient search terms (using full names):', coreIngredientTerms);
    
    // Search for each ingredient individually to avoid comma splitting issues
    recordMap = {};  // Reset before populating
    let totalRecordsFound = 0;
    
    for (const searchTerm of coreIngredientTerms) {
        try {
            const queryParams = {
                recordType: 'nutritionalInfo',
                template: 'nutritionalInfo',
                search: searchTerm,
                sortBy: 'inArweaveBlock:desc',
                limit: 20
            };
            
            console.log(`Searching for: "${searchTerm}"`);
            const recordsInDB = await getRecords(queryParams);
            console.log(`Found ${recordsInDB.searchResults} results for "${searchTerm}"`);
            
            // Add results to recordMap
            recordsInDB.records.forEach(record => {
                const recordName = record.data.basic.name.toLowerCase();
                if (!recordMap[recordName]) {  // Avoid duplicates
                    recordMap[recordName] = record;
                    totalRecordsFound++;
                }
            });
        } catch (error) {
            console.error(`Error searching for ingredient "${searchTerm}":`, error);
        }
    }
    
    console.log(`recordMap populated with ${Object.keys(recordMap).length} unique records from ${totalRecordsFound} total results`);

    const ingredientDidRefs = {};
    const nutritionalInfo = [];

    // Use cleaned names for searching, but map back to original names for keys
    for (let i = 0; i < cleanedIngredientNames.length; i++) {
        const cleanedName = cleanedIngredientNames[i];
        const originalName = originalIngredientNames[i];
        const coreSearchTerm = coreIngredientTerms[i];
        
        console.log(`Processing ingredient ${i + 1}:`);
        console.log(`  Original: "${originalName}"`);
        console.log(`  Cleaned: "${cleanedName}"`);
        console.log(`  Search term: "${coreSearchTerm}"`);
        
        const bestMatch = findBestMatch(cleanedName);
        if (bestMatch) {
            ingredientDidRefs[originalName] = bestMatch.oip.didTx;
            nutritionalInfo.push({
                ingredientName: bestMatch.data.basic.name,
                nutritionalInfo: bestMatch.data.nutritionalInfo || {},
                ingredientSource: bestMatch.data.basic.webUrl,
                ingredientDidRef: bestMatch.oip.didTx
            });
            console.log(`  ✅ Match found: "${bestMatch.data.basic.name}" (${bestMatch.oip.didTx})`);
        } else {
            ingredientDidRefs[originalName] = null;
            console.log(`  ❌ No match found`);
        }
    }

    return { ingredientDidRefs, nutritionalInfo };

    
  }

// } catch (error) {
// console.error('Error fetching parsed recipe data:', error);
// sendUpdate('error', { message: 'Failed to fetch recipe data.' });
// res.end();
// ongoingScrapes.delete(scrapeId);
// }



    
  // Function to calculate minimum score threshold for accepting a match
  function calculateMinimumScoreThreshold(totalTerms, matchedTerms) {
    // More lenient thresholds to avoid creating duplicate records
    // Focus on finding reasonable matches rather than perfect ones
    
    // Calculate threshold based on ingredient complexity
    if (totalTerms === 1) {
        // Single word: require exact match
        return 10; // Just the base score
    } else if (totalTerms === 2) {
        // Two words: require at least one core term match
        // Example: "grass-fed butter" should match "butter" (score = 10)
        return 8; // Allow matches with just one term
    } else if (totalTerms === 3) {
        // Three words: require at least one core term match
        // Example: "raw grass-fed butter" should match "butter" (score = 10)
        return 8; // Allow matches with just one key term
    } else {
        // More than 3 words: require at least some terms to match
        return Math.max(15, Math.ceil(totalTerms * 0.3) * 10); // 30% of terms minimum
    }
  }

  // Function to find the best match
  function findBestMatch(ingredientName) {
    if (!recordMap || Object.keys(recordMap).length === 0) {
        console.log(`No records available in recordMap for matching ${ingredientName}`);
        return null;
    }

    const searchTerms = ingredientName.split(/\s+/).filter(Boolean);
    console.log(`Searching for ingredient: ${ingredientName}, Search terms:`, searchTerms);

    // Check if the ingredient has a predefined synonym
    const synonym = synonymMap[ingredientName];
    if (synonym && recordMap[synonym]) {
        console.log(`Found synonym match for ${ingredientName}: ${synonym}`);
        return recordMap[synonym];
    }

    // Direct exact match
    if (recordMap[ingredientName]) {
        console.log(`Direct match found for ${ingredientName}, nutritionalInfo:`, recordMap[ingredientName].data.nutritionalInfo);
        return recordMap[ingredientName];
    }

    // Define descriptor words that are less important for matching
    const descriptorWords = [
        'grass-fed', 'free-range', 'organic', 'raw', 'fresh', 'frozen', 'dried', 'canned',
        'whole', 'ground', 'chopped', 'minced', 'sliced', 'diced', 'shredded', 'grated',
        'extra', 'virgin', 'pure', 'unrefined', 'unsweetened', 'unsalted', 'salted',
        'lean', 'fat-free', 'low-fat', 'reduced-fat', 'light', 'heavy', 'thick', 'thin',
        'large', 'medium', 'small', 'baby', 'mature', 'young', 'old',
        'hot', 'mild', 'sweet', 'sour', 'bitter', 'spicy', 'bland',
        'cooked', 'raw', 'roasted', 'baked', 'fried', 'grilled', 'steamed', 'boiled',
        'boneless', 'skinless', 'trimmed', 'untrimmed', 'with', 'without',
        'pastured', 'wild', 'farm-raised', 'cage-free', 'antibiotic-free', 'hormone-free'
    ];

    // Identify core ingredient terms (non-descriptors)
    const coreTerms = searchTerms.filter(term => !descriptorWords.includes(term.toLowerCase()));
    const descriptorTermsInSearch = searchTerms.filter(term => descriptorWords.includes(term.toLowerCase()));

    console.log(`Core terms: [${coreTerms.join(', ')}], Descriptor terms: [${descriptorTermsInSearch.join(', ')}]`);

    // Look for matches and score them properly
    const scoredMatches = Object.keys(recordMap)
        .map(recordName => {
            const normalizedRecordName = recordName.toLowerCase();
            const recordTerms = normalizedRecordName.split(/\s+/).filter(Boolean);
            
            // Calculate match score
            let score = 0;
            let matchedTerms = 0;
            let coreMatchedTerms = 0;
            let exactSequenceBonus = 0;
            
            // Count exact term matches, with higher weight for core terms
            searchTerms.forEach(term => {
                if (recordTerms.includes(term)) {
                    matchedTerms++;
                    const isCoreIngredient = coreTerms.includes(term);
                    if (isCoreIngredient) {
                        coreMatchedTerms++;
                        score += 15; // Higher points for core ingredient matches
                    } else {
                        score += 5; // Lower points for descriptor matches
                    }
                }
            });
            
            // Bonus for exact sequence matches (e.g., "beef liver" in that order)
            if (searchTerms.length >= 2) {
                const searchSequence = searchTerms.join(' ');
                if (normalizedRecordName.includes(searchSequence)) {
                    exactSequenceBonus = 50; // Big bonus for exact sequence
                    score += exactSequenceBonus;
                }
            }
            
            // Bonus for completeness (all search terms found)
            if (matchedTerms === searchTerms.length) {
                score += 20;
            }
            
            // Big bonus for matching all core terms
            if (coreMatchedTerms === coreTerms.length && coreTerms.length > 0) {
                score += 30;
            }
            
            // Penalty for extra terms in record name (prefer simpler matches)
            const extraTerms = recordTerms.length - matchedTerms;
            score -= extraTerms * 2;
            
            // Only consider matches that have at least one matching term
            if (matchedTerms === 0) {
                score = 0;
            }
            
            return {
                record: recordMap[recordName],
                recordName: normalizedRecordName,
                score: score,
                matchedTerms: matchedTerms,
                coreMatchedTerms: coreMatchedTerms,
                totalTerms: searchTerms.length,
                totalCoreTerms: coreTerms.length,
                exactSequence: exactSequenceBonus > 0
            };
        })
        .filter(match => match.score > 0) // Only keep matches with positive scores
        .sort((a, b) => b.score - a.score); // Sort by score descending

    if (scoredMatches.length > 0) {
        const bestMatch = scoredMatches[0];
        
        // Calculate minimum score threshold based on ingredient complexity
        const minScoreThreshold = calculateMinimumScoreThreshold(searchTerms.length, bestMatch.matchedTerms);
        
        console.log(`Best candidate for "${ingredientName}": "${bestMatch.recordName}" (score: ${bestMatch.score}, threshold: ${minScoreThreshold})`);
        console.log(`   - Matched ${bestMatch.matchedTerms}/${bestMatch.totalTerms} terms (${bestMatch.coreMatchedTerms}/${bestMatch.totalCoreTerms} core)`);
        console.log(`   - Exact sequence match: ${bestMatch.exactSequence}`);
        
        // Log other close matches for debugging
        if (scoredMatches.length > 1) {
            console.log(`   Other candidates:`, 
                scoredMatches.slice(1, 3).map(m => `"${m.recordName}" (${m.score})`)
            );
        }
        
        // Only accept the match if it meets the quality threshold
        if (bestMatch.score >= minScoreThreshold) {
            console.log(`✅ Match accepted: "${bestMatch.recordName}" (score ${bestMatch.score} >= threshold ${minScoreThreshold})`);
            return bestMatch.record;
        } else {
            console.log(`❌ Match rejected: score ${bestMatch.score} below threshold ${minScoreThreshold}. Will create new record.`);
        }
    }

    console.log(`No match found for ${ingredientName}`);
    return null;
  }

  // Create arrays for the function call
  const originalIngredientNames = parsedIngredients.map(parsed => parsed.originalString);
  
  // Create a mapping from original names to cleaned names
  const nameMapping = {};
  parsedIngredients.forEach(parsed => {
    nameMapping[parsed.originalString] = parsed.ingredient;
  });
  
  const ingredientRecords = await fetchIngredientRecordData(ingredientNames, originalIngredientNames);
  console.log('Ingredient records:', ingredientRecords);
  
  let missingIngredientNames = Object.keys(ingredientRecords.ingredientDidRefs).filter(
    name => ingredientRecords.ingredientDidRefs[name] === null
  );
  
  if (missingIngredientNames.length > 0) {
    
    // Send the CLEANED names through findBestMatch to get the best match for each
    const bestMatches = await Promise.all(
      missingIngredientNames.map(originalName => {
        const cleanedName = nameMapping[originalName];
        console.log(`Looking for best match for cleaned name: "${cleanedName}" (original: "${originalName}")`);
        return findBestMatch(cleanedName);
      })
    );
    console.log('Best matches for missing ingredients:', bestMatches);

    // Assign matches and update ingredientDidRefs
    bestMatches.forEach((match, index) => {
      if (match) {
        const originalName = missingIngredientNames[index];
        ingredientRecords.ingredientDidRefs[originalName] = match.oip.didTx;
        ingredientRecords.nutritionalInfo.push({
          ingredientName: match.data.basic.name,
          nutritionalInfo: match.data.nutritionalInfo || {},
          ingredientSource: match.data.basic.webUrl,
          ingredientDidRef: match.oip.didTx
        });
      }
    });

    // Remove matched names from missingIngredientNames
    let matchedNames = bestMatches
      .map((match, index) => (match ? missingIngredientNames[index] : null))
      .filter(name => name !== null);
    missingIngredientNames = missingIngredientNames.filter(name => !matchedNames.includes(name));

    // Create nutritional info records using CLEANED names, not original names
    const nutritionalInfoArray = await Promise.all(
      missingIngredientNames.map(originalName => {
        const cleanedName = nameMapping[originalName];
        console.log(`Creating nutritional info record for cleaned name: "${cleanedName}" (original: "${originalName}")`);
        return createNewNutritionalInfoRecord(cleanedName, blockchain);
      })
    );

    // Update ingredientDidRefs with the newly created nutritional info records
    nutritionalInfoArray.forEach((newRecord, index) => {
      if (newRecord) {
        const originalName = missingIngredientNames[index];
        const cleanedName = nameMapping[originalName];
        ingredientRecords.ingredientDidRefs[originalName] = newRecord.oip?.didTx || `did:arweave:${newRecord.transactionId}`;
        ingredientRecords.nutritionalInfo.push({
          ingredientName: newRecord.data?.basic?.name || cleanedName,
          nutritionalInfo: newRecord.data?.nutritionalInfo || {},
          ingredientSource: newRecord.data?.basic?.webUrl || '',
          ingredientDidRef: newRecord.oip?.didTx || `did:arweave:${newRecord.transactionId}`
        });
      }
    });

    // Update missingIngredientNames to remove those that were successfully created
    missingIngredientNames = missingIngredientNames.filter((name, index) => !nutritionalInfoArray[index]);
  }
  // Check for empty values in ingredientUnits and assign standard_unit from nutritionalInfoArray
  missingIngredientNames.forEach((originalName, index) => {
    const cleanedName = nameMapping[originalName];
    const unitIndex = ingredientNames.findIndex(ingredientName => ingredientName === cleanedName);

    console.log(`Processing missing ingredient: ${cleanedName} (original: ${originalName}), Found at index: ${unitIndex}`);

    if (unitIndex !== -1 && !ingredientUnits[unitIndex]) {
        const nutritionalInfo = nutritionalInfoArray[index];
        console.log(`Found nutritional info for: ${cleanedName}`, nutritionalInfo);

        if (nutritionalInfo && nutritionalInfo.nutritionalInfo) {
            ingredientUnits[unitIndex] = nutritionalInfo.nutritionalInfo.standardUnit || 'unit';
            ingredientAmounts[unitIndex] *= nutritionalInfo.nutritionalInfo.standardAmount || 1;

            console.log(`Updated Units: ${ingredientUnits[unitIndex]}, Updated Amounts: ${ingredientAmounts[unitIndex]}`);
        } else {
            console.log(`No nutritional info found for: ${cleanedName}`);
            ingredientUnits[unitIndex] = 'unit'; // Fallback unit
        }
    } else {
        console.log(`Ingredient not found in ingredientNames or already has a unit: ${cleanedName}`);
    }
});
  // You can now use nutritionalInfoArray as needed

  console.log('Ingredient Did Refs:', ingredientRecords);

    // console.log('Ingredient DID References:', ingredientRecords.ingredientDidRefs);
    // now we want to look up the record.oip.didTx value from the top ranked record for each ingredient and assign it to ingredientDidRef, we may need to add pagination (there are 20 records limit per page by default) to check all returned records
    
    
    


    // now filter each one by the ingredientName matching against this json structure: data: { basic: { name: ,and get the nutritional info
    // for each ingredient, if it exists
    // const nutritionalInfo = records.map(record => {
    //   const ingredientName = record.data.basic.name;
    //   const nutritionalInfo = record.data.nutritionalInfo || {}; // Ensure it's an object, not undefined
    //   const ingredientSource = record.data.basic.webUrl;
    //   const ingredientDidRef = ingredientDidRefs[ingredientName.toLowerCase()] || null; // Ensure case-insensitive lookup
    //   return {
    //     ingredientName,
    //     nutritionalInfo,
    //     ingredientSource,
    //     ingredientDidRef
    //   };
    // });

    // console.log('Nutritional info:', nutritionalInfo);


    // Extract prep time, cook time, total time, cuisine, and course directly from recipe object
    const prep_time_mins = record.recipe.prep_time_mins || null;
    const cook_time_mins = record.recipe.cook_time_mins || null;
    const total_time_mins = record.recipe.total_time_mins || null;
    const servings = record.recipe.servings || null;
    const cuisine = record.recipe.cuisine || null;
    const course = record.recipe.course || null;
    const notes = record.recipe.notes || null;

    console.log('Missing Ingredients:', missingIngredientNames);
    console.log('Original Ingredient Names:', ingredientNames);
    console.log('Units Before Assignment:', ingredientUnits);
    console.log('Amounts Before Assignment:', ingredientAmounts);
    console.log('Ingredient Did Refs:', ingredientRecords);

  // This section is now redundant since we handled the unit processing above
  // The logic has been moved to the previous section to use proper name mapping

let ingredientDRefs = [];
originalIngredientNames.forEach((originalName, index) => {
  // get the ingredientDidRef for each ingredient and put it in an array so that we can use it in the recipeData object
  const ingredientDidRef = ingredientRecords.ingredientDidRefs[originalName] || null;
  ingredientDRefs.push(ingredientDidRef);
  console.log(`Ingredient DID Ref for ${originalName}:`, ingredientDidRef);
});

console.log('Final Units:', ingredientUnits);
console.log('Final Amounts:', ingredientAmounts);


console.log('Units After Assignment:', ingredientUnits);
console.log('Amounts After Assignment:', ingredientAmounts);

// Extract values from the first recipe section for the main recipe data
const recipeDate = record.basic.date || Math.floor(Date.now() / 1000);

// Assign to recipeData
const recipeData = {
  basic: {
    name: record.basic.name,
    language: record.basic.language || "En",
    date: recipeDate,
    description: record.basic.description,
    webUrl: record.basic.webUrl,
    nsfw: record.basic.nsfw || false,
    tagItems: record.basic.tagItems || [],
  },
  recipe: {
    prep_time_mins: record.recipe.prep_time_mins,
    cook_time_mins: record.recipe.cook_time_mins,
    total_time_mins: record.recipe.total_time_mins,
    servings: record.recipe.servings,
    ingredient_amount: ingredientAmounts.length ? ingredientAmounts : null,
    ingredient_unit: ingredientUnits.length ? ingredientUnits : null,
    ingredient: ingredientDRefs,
    ingredient_comment: ingredientComments.length ? ingredientComments : null,
    instructions: record.recipe.instructions,
    notes: record.recipe.notes,
    cuisine: record.recipe.cuisine,
    course: record.recipe.course,
    author: record.recipe.author || null
  },
  image: {
    webUrl: record.image?.webUrl,
    contentType: record.image?.contentType
  },
};

// Debug: Check array lengths before filtering
console.log('Array lengths before filtering:');
console.log('- ingredientDRefs:', ingredientDRefs.length);
console.log('- ingredientComments:', ingredientComments.length);
console.log('- ingredientAmounts:', ingredientAmounts.length);
console.log('- ingredientUnits:', ingredientUnits.length);

// Only filter if there are actually null values
const hasNulls = ingredientDRefs.some(ref => ref === null);
console.log('Has null ingredient references:', hasNulls);

if (hasNulls) {
  console.log('Filtering out null ingredients...');
  const validIndices = ingredientDRefs.map((ref, index) => ref !== null ? index : null).filter(index => index !== null);
  console.log('Valid indices:', validIndices);
  
  ingredientDRefs = validIndices.map(index => ingredientDRefs[index]);
  ingredientComments = validIndices.map(index => ingredientComments[index]);
  ingredientAmounts = validIndices.map(index => ingredientAmounts[index]);
  ingredientUnits = validIndices.map(index => ingredientUnits[index]);
  
  console.log('Array lengths after filtering:');
  console.log('- ingredientDRefs:', ingredientDRefs.length);
  console.log('- ingredientComments:', ingredientComments.length);
  console.log('- ingredientAmounts:', ingredientAmounts.length);
  console.log('- ingredientUnits:', ingredientUnits.length);
}

// Validate final recipe data structure
console.log('Final recipe data validation:');
console.log('- Recipe has basic data:', !!recipeData.basic);
console.log('- Recipe has recipe data:', !!recipeData.recipe);
console.log('- All ingredient arrays same length:', 
  recipeData.recipe.ingredient_amount.length === recipeData.recipe.ingredient_unit.length &&
  recipeData.recipe.ingredient_unit.length === recipeData.recipe.ingredient.length &&
  recipeData.recipe.ingredient.length === recipeData.recipe.ingredient_comment.length);

console.log('Final array lengths:');
console.log('- ingredient_amount:', recipeData.recipe.ingredient_amount?.length || 0);
console.log('- ingredient_unit:', recipeData.recipe.ingredient_unit?.length || 0);
console.log('- ingredient:', recipeData.recipe.ingredient?.length || 0);
console.log('- ingredient_comment:', recipeData.recipe.ingredient_comment?.length || 0);

console.log('Sample ingredient data:');
if (recipeData.recipe.ingredient && recipeData.recipe.ingredient.length > 0) {
  console.log('- First ingredient DID:', recipeData.recipe.ingredient[0]);
  console.log('- First ingredient amount:', recipeData.recipe.ingredient_amount[0]);
  console.log('- First ingredient unit:', recipeData.recipe.ingredient_unit[0]);
  console.log('- First ingredient comment:', recipeData.recipe.ingredient_comment[0]);
}

console.log('Recipe data:', recipeData);
console.log('Final ingredient processing summary:');
console.log('- Original ingredients:', originalIngredientNames);
console.log('- Cleaned ingredients for nutrition lookup:', ingredientNames);
console.log('- Ingredient comments:', ingredientComments);
console.log('- Ingredient DID references:', ingredientDRefs);

try {
  console.log('Attempting to publish recipe...');
  recipeRecord = await publishNewRecord(recipeData, "recipe", false, false, false, null, blockchain);
  console.log('Recipe published successfully:', recipeRecord.transactionId);
} catch (publishError) {
  console.error('Error publishing recipe:', publishError);
  console.error('Recipe data that failed to publish:', JSON.stringify(recipeData, null, 2));
  throw publishError;
}


    // const newRecord = await publishNewRecord(record, recordType, publishFiles, addMediaToArweave, addMediaToIPFS, youtubeUrl);
    const transactionId = recipeRecord.transactionId;
    const recordToIndex = recipeRecord.recordToIndex;
    // const dataForSignature = newRecord.dataForSignature;
    // const creatorSig = newRecord.creatorSig;
    res.status(200).json({ transactionId, recordToIndex, blockchain });
} catch (error) {
    console.error('Error publishing record:', error);
    res.status(500).json({ error: 'Failed to publish record' });
}
});

// Add workout publishing endpoint
router.post('/newWorkout', async (req, res) => {
    try {
        console.log('POST /api/publish/newWorkout', req.body);
        const record = req.body;
        const blockchain = req.body.blockchain || 'arweave';
        const nonStandardWorkout = req.body.nonStandardWorkout || false;
        let recordType = 'workout';

        // Extract workout sections from JSON
        const workoutSections = req.body.workout || [];
        
        // Extract exercise names from all sections
        let allExerciseNames = [];
        workoutSections.forEach(section => {
            if (section.exercises && Array.isArray(section.exercises)) {
                section.exercises.forEach(exercise => {
                    if (exercise.name) {
                        allExerciseNames.push(exercise.name.trim().toLowerCase());
                    }
                });
            }
        });

        console.log('All exercise names found:', allExerciseNames);
        console.log('Non-standard workout flag:', nonStandardWorkout);

        let exerciseDidRefs = {};

        // Only process exercise lookups if NOT a non-standard workout
        if (!nonStandardWorkout && allExerciseNames.length > 0) {
            // Step 1: Query existing exercise records in OIP
            const queryParams = {
                recordType: 'exercise',
                search: allExerciseNames.join(','),
                limit: 50
            };

            const existingExercises = await getRecords(queryParams);
            console.log('Existing exercises found:', existingExercises.searchResults);

            // Create exercise record map for fast lookup
            const exerciseRecordMap = {};
            existingExercises.records.forEach(record => {
                const recordName = record.data.basic.name.toLowerCase();
                exerciseRecordMap[recordName] = record;
            });

            // Step 2: Find best matches for each exercise
            for (const exerciseName of allExerciseNames) {
                const bestMatch = findBestExerciseMatch(exerciseName, exerciseRecordMap);
                if (bestMatch) {
                    exerciseDidRefs[exerciseName] = bestMatch.oip.didTx;
                    console.log(`Found existing exercise for ${exerciseName}:`, bestMatch.oip.didTx);
                } else {
                    exerciseDidRefs[exerciseName] = null;
                }
            }

            // Step 3: Create missing exercise records from Kaggle data
            const missingExerciseNames = Object.keys(exerciseDidRefs).filter(
                name => exerciseDidRefs[name] === null
            );

            if (missingExerciseNames.length > 0) {
                console.log('Creating exercise records for missing exercises:', missingExerciseNames);
                
                const newExerciseRecords = await Promise.all(
                    missingExerciseNames.map(name => createNewExerciseRecord(name, blockchain))
                );

                // Update exerciseDidRefs with newly created records
                newExerciseRecords.forEach((newRecord, index) => {
                    if (newRecord) {
                        const exerciseName = missingExerciseNames[index];
                        exerciseDidRefs[exerciseName] = newRecord.oip?.didTx || `did:arweave:${newRecord.transactionId}`;
                        console.log(`Created new exercise record for ${exerciseName}:`, exerciseDidRefs[exerciseName]);
                    }
                });
            }

            // Step 4: Replace exercise names with didTx references in workout sections
            workoutSections.forEach(section => {
                if (section.exercises && Array.isArray(section.exercises)) {
                    section.exercises.forEach(exercise => {
                        if (exercise.name) {
                            const exerciseName = exercise.name.trim().toLowerCase();
                            const didTx = exerciseDidRefs[exerciseName];
                            if (didTx) {
                                exercise.exerciseDidTx = didTx;
                                console.log(`Replaced ${exercise.name} with didTx: ${didTx}`);
                            }
                        }
                    });
                }
            });
        }

        // Step 5: Create final workout data structure
        const workoutData = {
            basic: {
                name: record.basic.name,
                language: record.basic.language || "en",
                date: record.basic.date || Math.floor(Date.now() / 1000),
                description: record.basic.description,
                webUrl: record.basic.webUrl,
                nsfw: record.basic.nsfw || false,
                tagItems: record.basic.tagItems || [],
            },
            workout: {
                duration_minutes: record.workout_duration_minutes || null,
                difficulty: record.workout_difficulty || 'intermediate',
                category: record.workout_category || 'general',
                equipment_required: record.equipment_required || [],
                target_muscle_groups: record.target_muscle_groups || [],
                goal_tags: record.goal_tags || [],
                workout_sections: workoutSections,
                is_non_standard: nonStandardWorkout,
                notes: record.notes || '',
                created_by: record.created_by || null
            },
            image: {
                webUrl: record.image?.webUrl,
                contentType: record.image?.contentType
            }
        };

        console.log('Final workout data:', workoutData);

        // Step 6: Publish workout record
        const workoutRecord = await publishNewRecord(workoutData, "workout", false, false, false, null, blockchain);

        const transactionId = workoutRecord.transactionId;
        const recordToIndex = workoutRecord.recordToIndex;

        res.status(200).json({ 
            transactionId, 
            recordToIndex, 
            blockchain,
            exerciseDidRefs: !nonStandardWorkout ? exerciseDidRefs : null,
            message: `Workout published successfully${!nonStandardWorkout ? ' with exercise references' : ' as non-standard workout'}`
        });

    } catch (error) {
        console.error('Error publishing workout:', error);
        res.status(500).json({ error: 'Failed to publish workout' });
    }
});

// Function to find best exercise match (similar to ingredient matching)
function findBestExerciseMatch(exerciseName, exerciseRecordMap) {
    if (!exerciseRecordMap || Object.keys(exerciseRecordMap).length === 0) {
        return null;
    }

    const searchTerms = exerciseName.split(/\s+/).filter(Boolean);
    console.log(`Searching for exercise: ${exerciseName}, Search terms:`, searchTerms);

    // Direct match
    if (exerciseRecordMap[exerciseName]) {
        console.log(`Direct match found for ${exerciseName}`);
        return exerciseRecordMap[exerciseName];
    }

    // Looser match using search terms
    const matches = Object.keys(exerciseRecordMap)
        .filter(recordName => {
            const normalizedRecordName = recordName.toLowerCase();
            return searchTerms.some(term => normalizedRecordName.includes(term));
        })
        .map(recordName => exerciseRecordMap[recordName]);

    if (matches.length > 0) {
        matches.sort((a, b) => {
            const aMatchCount = searchTerms.filter(term => a.data.basic.name.toLowerCase().includes(term)).length;
            const bMatchCount = searchTerms.filter(term => b.data.basic.name.toLowerCase().includes(term)).length;
            return bMatchCount - aMatchCount;
        });

        console.log(`Loose matches found for ${exerciseName}:`, matches.length);
        return matches[0];
    }

    console.log(`No match found for ${exerciseName}`);
    return null;
}

// Add specific video record endpoint with YouTube support
router.post('/newVideo', async (req, res) => {
    try {
        const {
            youtubeUrl,
            videoUrl, // Direct video URL
            videoFile, // Base64 encoded video
            basicMetadata,
            blockchain = 'arweave',
            publishTo = { arweave: true, bittorrent: true }
        } = req.body;

        // Extract media publishing flags from query params or body
        const publishFiles = req.query.publishFiles !== 'false' && req.body.publishFiles !== false; // Default to true for video endpoint
        const addMediaToArweave = req.query.addMediaToArweave !== 'false' && publishTo.arweave !== false;
        const addMediaToIPFS = req.query.addMediaToIPFS === 'true' || publishTo.ipfs === true;
        const addMediaToArFleet = req.query.addMediaToArFleet === 'true' || publishTo.arfleet === true;

        // Create video record structure
        const videoRecord = {
            basic: {
                name: basicMetadata?.name || 'Video Record',
                description: basicMetadata?.description || '',
                language: basicMetadata?.language || 'en',
                date: Math.floor(Date.now() / 1000),
                nsfw: basicMetadata?.nsfw || false,
                tagItems: basicMetadata?.tagItems || []
            },
            video: {}
        };

        // Add video URL to record structure
        if (youtubeUrl) {
            videoRecord.video.webUrl = youtubeUrl;
            videoRecord.video.contentType = 'video/mp4';
        } else if (videoUrl) {
            videoRecord.video.webUrl = videoUrl;
            videoRecord.video.contentType = 'video/mp4';
        }

        // Publish the record with media processing
        const result = await publishNewRecord(
            videoRecord,
            'video',
            publishFiles,
            addMediaToArweave,
            addMediaToIPFS,
            youtubeUrl, // Pass YouTube URL for special processing
            blockchain,
            addMediaToArFleet
        );

        res.status(200).json({
            success: true,
            transactionId: result.transactionId,
            recordToIndex: result.recordToIndex,
            blockchain: blockchain,
            message: 'Video record published successfully'
        });

    } catch (error) {
        console.error('Error publishing video record:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to publish video record',
            details: error.message 
        });
    }
});

// Add specific image record endpoint
router.post('/newImage', async (req, res) => {
    try {
        const {
            imageUrl, // Direct image URL
            imageFile, // Base64 encoded image
            basicMetadata,
            blockchain = 'arweave',
            publishTo = { arweave: true, bittorrent: true }
        } = req.body;

        // Extract media publishing flags from query params or body
        const publishFiles = req.query.publishFiles !== 'false' && req.body.publishFiles !== false; // Default to true for image endpoint
        const addMediaToArweave = req.query.addMediaToArweave !== 'false' && publishTo.arweave !== false;
        const addMediaToIPFS = req.query.addMediaToIPFS === 'true' || publishTo.ipfs === true;
        const addMediaToArFleet = req.query.addMediaToArFleet === 'true' || publishTo.arfleet === true;

        if (!imageUrl && !imageFile) {
            return res.status(400).json({
                success: false,
                error: 'Either imageUrl or imageFile must be provided'
            });
        }

        // Create image record structure
        const imageRecord = {
            basic: {
                name: basicMetadata?.name || 'Image Record',
                description: basicMetadata?.description || '',
                language: basicMetadata?.language || 'en',
                date: Math.floor(Date.now() / 1000),
                nsfw: basicMetadata?.nsfw || false,
                tagItems: basicMetadata?.tagItems || []
            },
            image: {}
        };

        // Add image URL or file to record structure
        if (imageUrl) {
            imageRecord.image.webUrl = imageUrl;
            imageRecord.image.contentType = 'image/jpeg'; // Default, will be detected from URL
        }

        // Publish the record with media processing
        const result = await publishNewRecord(
            imageRecord,
            'image',
            publishFiles,
            addMediaToArweave,
            addMediaToIPFS,
            null, // No YouTube URL for images
            blockchain,
            addMediaToArFleet
        );

        res.status(200).json({
            success: true,
            transactionId: result.transactionId,
            recordToIndex: result.recordToIndex,
            blockchain: blockchain,
            message: 'Image record published successfully'
        });

    } catch (error) {
        console.error('Error publishing image record:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to publish image record',
            details: error.message 
        });
    }
});

// Add a new general media publishing endpoint
router.post('/newMedia', async (req, res) => {
    try {
        const {
            mediaFile, // Base64 encoded file
            mediaUrl, // Direct URL to media
            youtubeUrl, // YouTube URL (for videos)
            contentType, // MIME type
            basicMetadata, // Title, description, etc.
            blockchain = 'arweave', // Default to arweave
            publishTo = { arweave: true, bittorrent: true } // Media publishing options
        } = req.body;

        let mediaConfig = {
            publishTo: publishTo,
            blockchain: blockchain,
            contentType: contentType
        };

        // Determine media source
        if (youtubeUrl) {
            mediaConfig.source = 'youtube';
            mediaConfig.data = youtubeUrl;
            mediaConfig.contentType = 'video/mp4';
        } else if (mediaUrl) {
            mediaConfig.source = 'url';
            mediaConfig.data = mediaUrl;
        } else if (mediaFile) {
            mediaConfig.source = 'base64';
            mediaConfig.data = mediaFile;
        } else {
            return res.status(400).json({ error: 'No media source provided' });
        }

        // Process the media
        const mediaDIDs = await mediaManager.processMedia(mediaConfig);

        // Create record with media DIDs
        const record = {
            basic: {
                ...basicMetadata,
                createdAt: new Date().toISOString(),
            },
            media: {
                storageNetworks: mediaDIDs.storageNetworks,
                originalUrl: youtubeUrl || mediaUrl,
                contentType: contentType
            }
        };

        const newRecord = await publishNewRecord(record, 'media', false, false, false, null, blockchain);
        
        res.json({
            status: 'success',
            blockchain: blockchain,
            transactionId: newRecord.transactionId,
            data: {
                contentId: newRecord.didTx,
                mediaDIDs: mediaDIDs
            }
        });

    } catch (error) {
        console.error('Error publishing media:', error);
        res.status(500).json({
            error: 'Failed to publish media',
            details: error.message
        });
    }
});

// Add template publishing endpoint
router.post('/newTemplate', authenticateToken, async (req, res) => {
    try {
        const rawTemplate = req.body.template || req.body;
        const blockchain = req.body.blockchain || 'arweave'; // Default to arweave
        const sectionName = Object.keys(rawTemplate)[0];
        let currentIndex = 0;
        const processedTemplate = {};
        processedTemplate[sectionName] = {};

        // Process each field in the section
        Object.entries(rawTemplate[sectionName]).forEach(([fieldName, fieldType]) => {
            // Skip if this is a values array - we'll handle it with its enum
            if (fieldName.endsWith('Values')) return;

            // Add the field type
            processedTemplate[sectionName][fieldName] = fieldType;

            // Add index for the field
            processedTemplate[sectionName][`index_${fieldName}`] = currentIndex++;

            // If this is an enum field, add its values array if provided
            if (fieldType === 'enum') {
                const valuesKey = `${fieldName}Values`;
                if (rawTemplate[sectionName][valuesKey]) {
                    processedTemplate[sectionName][valuesKey] = rawTemplate[sectionName][valuesKey];
                }
            }
        });

        // Upload template to blockchain using publisher manager
        const templateBuffer = Buffer.from(JSON.stringify(processedTemplate));
        const uploadResult = await publisherManager.publish(
            templateBuffer,
            {
                blockchain: blockchain,
                tags: [
                    { name: 'Content-Type', value: 'application/json' },
                    { name: 'Type', value: 'Template' },
                    { name: 'App-Name', value: 'OIPArweave' }
                ]
            }
        );

        // Create the DID
        const templateDid = `did:arweave:${uploadResult.id}`;

        // Store template info in Elasticsearch
        await client.index({
            index: 'templates',
            id: templateDid,
            body: {
                templateId: templateDid,
                name: sectionName,
                type: 'template',
                txid: uploadResult.id
            }
        });

        res.json({
            status: 'success',
            blockchain: blockchain,
            data: {
                templateId: templateDid,
                txid: uploadResult.id,
                template: processedTemplate // Include processed template for verification
            }
        });

    } catch (error) {
        console.error('Error publishing template:', error);
        res.status(500).json({
            error: 'Failed to publish template',
            details: error.message
        });
    }
});

router.post('/testEncrypt', async (req, res) => {
    try {
        const { content } = req.body;
        
        // Use the test condition for simplicity
        const testCondition = createTestCondition();
        
        // Test encryption with minimal payload
        const { encryptedContent, encryptedSymmetricKey } = await encryptContent(
            content || "Test content for encryption",
            testCondition
        );
        
        res.json({
            success: true,
            encryptedContent,
            encryptedSymmetricKey,
            accessControlConditions: testCondition
        });
    } catch (error) {
        console.error('Error in test encryption:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            details: error
        });
    }
});

// Add newPost endpoint for publishing post records
router.post('/newPost', async (req, res) => {
    try {
        console.log('POST /api/publish/newPost', req.body);
        const record = req.body;
        const blockchain = req.body.blockchain || 'arweave'; // Get blockchain parameter, default to arweave
        let recordType = 'post';

        // Create post record structure using the correct post template fields
        const postRecord = {
            basic: {
                name: record.basic?.name || 'Post Record',
                description: record.basic?.description || '',
                language: record.basic?.language || 'en',
                date: record.basic?.date || Math.floor(Date.now() / 1000),
                nsfw: record.basic?.nsfw || false,
                tagItems: record.basic?.tagItems || []
            },
            post: {
                webUrl: record.post?.webUrl || '',
                bylineWriter: record.post?.bylineWriter || '',
                bylineWritersTitle: record.post?.bylineWritersTitle || '',
                bylineWritersLocation: record.post?.bylineWritersLocation || '',
                articleText: record.post?.articleText || '',
                featuredImage: record.post?.featuredImage || '',
                imageItems: record.post?.imageItems || [],
                imageCaptionItems: record.post?.imageCaptionItems || [],
                videoItems: record.post?.videoItems || [],
                audioItems: record.post?.audioItems || [],
                audioCaptionItems: record.post?.audioCaptionItems || [],
                replyTo: record.post?.replyTo || ''
            }
        };

        console.log('Final post data:', postRecord);

        // Publish the post record
        const postResult = await publishNewRecord(postRecord, recordType, false, false, false, null, blockchain);

        const transactionId = postResult.transactionId;
        const recordToIndex = postResult.recordToIndex;

        res.status(200).json({ 
            transactionId, 
            recordToIndex, 
            blockchain,
            message: 'Post published successfully'
        });

    } catch (error) {
        console.error('Error publishing post:', error);
        res.status(500).json({ error: 'Failed to publish post' });
    }
});

module.exports = router;