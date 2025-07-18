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
const { resolveDrefsInRecord } = require('../helpers/dref-resolver');
const { fetchNutritionalData } = require('../helpers/nutritional-helper');

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
        
        if (!exerciseData || !exerciseData.name) {
            console.log(`No valid exercise data found for: ${exerciseName}`);
            return null;
        }
        
        // Format the exercise data according to OIP exercise template
        const formattedExerciseInfo = {
            basic: {
                name: exerciseData.name || exerciseName, // Use exerciseName as fallback
                date: Math.floor(Date.now() / 1000),
                language: 'en',
                nsfw: false,
                webUrl: exerciseData.source_url || '',
                description: `${exerciseData.name || exerciseName} - ${exerciseData.category || 'exercise'} exercise targeting ${(exerciseData.muscle_groups || ['general']).join(', ')}`,
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
                // measurement_type: 
                est_duration_minutes: exerciseData.duration_minutes || 0,
                target_duration_seconds: exerciseData.duration_minutes * 60 || 0,
                recommended_sets: exerciseData.recommended_sets || 3,
                recommended_reps: exerciseData.recommended_reps || 12,
                goalTags: exerciseData.goal_tags || []
            }
        };
        
        // Add measurement_type determination logic after creating formattedExerciseInfo
        let measurementType = 'reps'; // default

        const exerciseNameLower = (exerciseData.name || exerciseName).toLowerCase();
        const categoryLower = (exerciseData.category || '').toLowerCase();
        const exerciseTypeLower = (exerciseData.exercise_type || '').toLowerCase();

        // Check for timed exercises
        if (exerciseData.duration_minutes > 0 || 
            categoryLower.includes('cardio') || 
            exerciseTypeLower.includes('cardio') ||
            exerciseNameLower.includes('running') ||
            exerciseNameLower.includes('cycling') ||
            exerciseNameLower.includes('walking') ||
            exerciseNameLower.includes('jogging')) {
          measurementType = 'timed';
        }
        // Check for hold exercises
        else if (exerciseNameLower.includes('plank') ||
                 exerciseNameLower.includes('hold') ||
                 exerciseNameLower.includes('wall sit') ||
                 exerciseNameLower.includes('static') ||
                 exerciseNameLower.includes('isometric') ||
                 exerciseNameLower.includes('bridge') ||
                 exerciseNameLower.includes('pose')) {
          measurementType = 'hold';
        }
        // Check for max duration exercises
        else if ((exerciseNameLower.includes('max') && exerciseNameLower.includes('duration')) ||
                 exerciseNameLower.includes('as long as possible') ||
                 exerciseNameLower.includes('until failure')) {
          measurementType = 'maxdur';
        }

        // Add measurement_type to the exercise object
        formattedExerciseInfo.exercise.measurement_type = measurementType;
        
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
                "workout": {
                    "total_duration_minutes": 45,
                    "estimated_calories_burned": 300,
                    "includesWarmup": true,
                    "includesMain": true,
                    "includesCooldown": true,
                    "nonStandardWorkout": false,
                    "exercise_amount": [1, 3, 3, 2],
                    "exercise_unit": ["sets", "sets", "sets", "sets"],
                    "exercise": ["did:arweave:arm-circles", "did:arweave:push-ups", "did:arweave:dumbbell-bench-press", "did:arweave:stretching"],
                    "instructions": "1. Start with 5-minute warm-up\n2. Perform main exercises with proper form\n3. Rest 60-90 seconds between sets\n4. Finish with cooldown stretches",
                    "goalTags": ["muscle building", "strength", "upper body"],
                    "author": "Trainer Example",
                    "authorDRef": "did:arweave:trainer-example",
                    "notes": "Ensure proper form throughout all exercises. Adjust weights as needed."
                },
                "image": {
                    "webUrl": "https://example.com/workout-image.jpg",
                    "contentType": "image/jpeg"
                },
                "blockchain": "arweave"
            },
            "field_descriptions": {
                "basic.*": "Same structure as recipe basic fields",
                "workout.total_duration_minutes": "Total workout duration in minutes",
                "workout.estimated_calories_burned": "Estimated calories burned during workout",
                "workout.includesWarmup": "Boolean indicating if workout includes warm-up",
                "workout.includesMain": "Boolean indicating if workout includes main workout",
                "workout.includesCooldown": "Boolean indicating if workout includes cooldown",
                "workout.nonStandardWorkout": "Set to true to skip exercise database lookup",
                "workout.exercise_amount": "Array of amounts for each exercise (e.g., number of sets)",
                "workout.exercise_unit": "Array of units for each exercise (e.g., 'sets', 'minutes', 'reps')",
                "workout.exercise": "Array of exercise DID references or names (names will be looked up)",
                "workout.instructions": "Step-by-step workout instructions",
                "workout.goalTags": "Array of fitness goals and tags",
                "workout.author": "Workout creator name",
                "workout.authorDRef": "DID reference to workout author",
                "workout.notes": "Additional notes about the workout",
                "image.webUrl": "URL to workout image",
                "image.contentType": "Image MIME type",
                "blockchain": "Target blockchain ('arweave' or 'turbo')"
            },
            "exercise_lookup_notes": {
                "automatic_processing": "Exercise names in workout.exercise array are automatically looked up in the exercise database",
                "fallback": "Missing exercises are created from Kaggle fitness dataset",
                "bypass": "Set 'workout.nonStandardWorkout: true' to skip exercise lookup and use custom exercises",
                "array_alignment": "exercise_amount, exercise_unit, and exercise arrays must have the same length"
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
                "nutritionalInfo": {
                    "endpoint": "POST /api/publish/newNutritionalInfo",
                    "schema_url": "GET /api/publish/newNutritionalInfo/schema",
                    "description": "Publish nutritional information records"
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




// Function to create new nutritional info records for missing ingredients
async function createNewNutritionalInfoRecord(ingredientName, blockchain = 'arweave') {
  try {
    const formattedNutritionalInfo = await fetchNutritionalData(ingredientName);
    const ingredientTx = await publishNewRecord(formattedNutritionalInfo, "nutritionalInfo", false, false, false, null, blockchain);
    console.log(`Successfully published nutritional info for ${ingredientName}:`, ingredientTx);
    return ingredientTx.recordToIndex;
  } catch (error) {
    console.error(`Error creating nutritional info for ${ingredientName}:`, error);
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

  // Since ingredient_comment is now provided explicitly, use ingredients as-is
  const parsedIngredients = ingredients.map(ing => ({
    originalString: ing.name,
    ingredient: ing.name,
    comment: ''
  }));

  // Separate ingredients that are didTx values from those that need lookup
  const ingredientNames = []; // Only names that need lookup
  const ingredientNamesForDisplay = []; // All cleaned names for display
  const ingredientComments = record.recipe.ingredient_comment || [];
  const ingredientDidTxMap = {}; // Map original ingredient string to didTx if it's already a didTx
  
  parsedIngredients.forEach((parsed, index) => {
    const originalString = parsed.originalString;
    const ingredient = parsed.ingredient;
    
    // Check if this ingredient string starts with a didTx value
    if (originalString.startsWith('did:')) {
      // Handle didTx with potential comment: "did:arweave:abc123, comment text"
      const commaIndex = originalString.indexOf(',');
      if (commaIndex !== -1) {
        // Extract didTx and comment separately
        const didTx = originalString.substring(0, commaIndex).trim();
        const comment = originalString.substring(commaIndex + 1).trim();
        
        // Store the clean didTx value
        ingredientDidTxMap[originalString] = didTx;
        ingredientNamesForDisplay.push(didTx); // For display purposes
        
        // Comments are already provided in ingredient_comment array
        
        console.log(`Found didTx with comment at index ${index}: ${didTx} (comment: "${comment}")`);
      } else {
        // didTx without comment
        ingredientDidTxMap[originalString] = originalString;
        ingredientNamesForDisplay.push(originalString); // For display purposes
        console.log(`Found didTx without comment at index ${index}: ${originalString}`);
      }
    } else if (ingredient.startsWith('did:')) {
      // This handles the case where ingredient is already a didTx
      ingredientDidTxMap[originalString] = ingredient;
      ingredientNamesForDisplay.push(ingredient); // For display purposes
      console.log(`Found existing didTx at index ${index}: ${ingredient}`);
    } else {
      // This is a name that needs to be looked up
      const normalizedName = ingredient.trim().toLowerCase().replace(/,/g, '').replace(/\s+/g, ' ');
      ingredientNames.push(normalizedName);
      ingredientNamesForDisplay.push(normalizedName);
      console.log(`Need to lookup ingredient at index ${index}: ${normalizedName}`);
    }
  });
  
  const ingredientAmounts = ingredients.map(ing => ing.amount ?? 1);
  const ingredientUnits = ingredients.map(ing => (ing.unit && ing.unit.trim()) || 'unit'); // Default unit to 'unit'

  console.log('Ingredient names for lookup only:', ingredientNames);
  console.log('All ingredient names for display:', ingredientNamesForDisplay);
  console.log('Ingredient comments:', ingredientComments);
  console.log('Ingredient units:', ingredientUnits);
  console.log('Existing didTx values:', ingredientDidTxMap);
    
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

  // Create arrays for the function call - only process names that need lookup
  const originalIngredientNames = parsedIngredients.map(parsed => parsed.originalString);
  const originalNamesNeedingLookup = [];
  const cleanedNamesNeedingLookup = [];
  
  // Create a mapping from original names to cleaned names
  const nameMapping = {};
  parsedIngredients.forEach(parsed => {
    nameMapping[parsed.originalString] = parsed.ingredient;
    
    // Only add to lookup arrays if it's not already a didTx
    if (!parsed.ingredient.startsWith('did:')) {
      originalNamesNeedingLookup.push(parsed.originalString);
      const normalizedName = parsed.ingredient.trim().toLowerCase().replace(/,/g, '').replace(/\s+/g, ' ');
      cleanedNamesNeedingLookup.push(normalizedName);
    }
  });
  
  console.log('Names needing lookup:', cleanedNamesNeedingLookup);
  console.log('Original names needing lookup:', originalNamesNeedingLookup);
  
  // Only call lookup function if there are names that need lookup
  let ingredientRecords = { ingredientDidRefs: {}, nutritionalInfo: [] };
  
  if (cleanedNamesNeedingLookup.length > 0) {
    ingredientRecords = await fetchIngredientRecordData(cleanedNamesNeedingLookup, originalNamesNeedingLookup);
  } else {
    console.log('No ingredients need lookup - all are already didTx values');
  }
  console.log('Ingredient records:', ingredientRecords);
  
  // Only check for missing ingredients among those that needed lookup (not didTx values)
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
    
    // Check for empty values in ingredientUnits and assign standard_unit from nutritionalInfoArray
    missingIngredientNames.forEach((originalName, index) => {
      const cleanedName = nameMapping[originalName];
      const originalIndex = originalIngredientNames.findIndex(name => name === originalName);

      console.log(`Processing missing ingredient: ${cleanedName} (original: ${originalName}), Found at original index: ${originalIndex}`);

      if (originalIndex !== -1 && !ingredientUnits[originalIndex]) {
          const nutritionalInfo = nutritionalInfoArray[index];
          console.log(`Found nutritional info for: ${cleanedName}`, nutritionalInfo);

          if (nutritionalInfo && nutritionalInfo.nutritionalInfo) {
              ingredientUnits[originalIndex] = nutritionalInfo.nutritionalInfo.standardUnit || 'unit';
              ingredientAmounts[originalIndex] *= nutritionalInfo.nutritionalInfo.standardAmount || 1;

              console.log(`Updated Units: ${ingredientUnits[originalIndex]}, Updated Amounts: ${ingredientAmounts[originalIndex]}`);
          } else {
              console.log(`No nutritional info found for: ${cleanedName}`);
              ingredientUnits[originalIndex] = 'unit'; // Fallback unit
          }
      } else {
          console.log(`Ingredient not found in original array or already has a unit: ${cleanedName}`);
      }
    });
  } else {
    console.log('No missing ingredients to process');
  }
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
    console.log('Original Ingredient Names:', originalIngredientNames);
    console.log('Names needing lookup:', cleanedNamesNeedingLookup);
    console.log('Units Before Assignment:', ingredientUnits);
    console.log('Amounts Before Assignment:', ingredientAmounts);
    console.log('Ingredient Did Refs:', ingredientRecords);

  // This section is now redundant since we handled the unit processing above
  // The logic has been moved to the previous section to use proper name mapping

// Build final ingredientDRefs array by combining looked-up values with existing didTx values
let ingredientDRefs = [];
originalIngredientNames.forEach((originalName, index) => {
  // Check if this ingredient is already a didTx value
  if (ingredientDidTxMap[originalName]) {
    // Use the existing didTx value directly
    const didTx = ingredientDidTxMap[originalName];
    ingredientDRefs.push(didTx);
    console.log(`Using existing didTx for ${originalName}: ${didTx}`);
  } else {
    // Get the looked-up didTx value
    const ingredientDidRef = ingredientRecords.ingredientDidRefs[originalName] || null;
    ingredientDRefs.push(ingredientDidRef);
    console.log(`Looked-up DID Ref for ${originalName}: ${ingredientDidRef}`);
  }
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
    cuisine: record.basic.cuisine || record.recipe.cuisine || '',
    course: record.basic.course || record.recipe.course || '',
    author: record.recipe.author || ''
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
console.log('- Ingredients for nutrition lookup:', ingredientNames);
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
        const nonStandardWorkout = req.body.workout?.nonStandardWorkout || false;
        let recordType = 'workout';

        let resolvedWorkout;
        if (!nonStandardWorkout) {
          resolvedWorkout = await resolveDrefsInRecord(req.body, 'workout', {exercise: 'exercise'}, blockchain);
        } else {
          resolvedWorkout = req.body;
        }

        if (!resolvedWorkout.workout.total_duration_minutes) {
          let total = 0;
          const exercises = Array.isArray(resolvedWorkout.workout.exercise) ? resolvedWorkout.workout.exercise : [];
          for (const exDid of exercises) {
            if (typeof exDid === 'string' && exDid.startsWith('did:')) {
              const exResults = await getRecords({ didTx: exDid, recordType: 'exercise', sortBy: 'inArweaveBlock:desc', limit: 1 });
              if (exResults.searchResults > 0) {
                const exRecord = exResults.records[0];
                total += exRecord.data.exercise.est_duration_minutes || 0;
              }
            }
          }
          // Add 2 minutes between each exercise (exercises.length - 1 transitions)
          if (exercises.length > 1) {
            total += (exercises.length - 1) * 2;
          }
          resolvedWorkout.workout.total_duration_minutes = total;
        }

        const workoutData = {
          basic: {
            name: resolvedWorkout.basic?.name || '',
            language: resolvedWorkout.basic?.language || 'en',
            date: resolvedWorkout.basic?.date || Math.floor(Date.now() / 1000),
            description: resolvedWorkout.basic?.description || '',
            webUrl: resolvedWorkout.basic?.webUrl || '',
            nsfw: resolvedWorkout.basic?.nsfw || false,
            tagItems: resolvedWorkout.workout?.goalTags || [],
          },
          workout: {
            total_duration_minutes: resolvedWorkout.workout?.total_duration_minutes || 0,
            estimated_calories_burned: resolvedWorkout.workout?.estimated_calories_burned || 0,
            includesWarmup: resolvedWorkout.workout?.includesWarmup || false,
            includesMain: resolvedWorkout.workout?.includesMain || false,
            includesCooldown: resolvedWorkout.workout?.includesCooldown || false,
            nonStandardWorkout: nonStandardWorkout,
            exercise_amount: resolvedWorkout.workout?.exercise_amount || [],
            exercise_unit: resolvedWorkout.workout?.exercise_unit || [],
            exercise: resolvedWorkout.workout?.exercise || [],
            exercise_comment: resolvedWorkout.workout?.exercise_comment || [],
            instructions: resolvedWorkout.workout?.instructions || '',
            // goalTags: resolvedWorkout.workout?.goalTags || [],
            author: resolvedWorkout.workout?.author || '',
            authorDRef: resolvedWorkout.workout?.authorDRef || null,
            notes: resolvedWorkout.workout?.notes || ''
        //   },
        //   image: {
        //     webUrl: resolvedWorkout.image?.webUrl || '',
        //     contentType: resolvedWorkout.image?.contentType || ''
          }
        };

        const workoutRecord = await publishNewRecord(workoutData, "workout", false, false, false, null, blockchain);

        const transactionId = workoutRecord.transactionId;
        const recordToIndex = workoutRecord.recordToIndex;

        res.status(200).json({ 
            transactionId, 
            recordToIndex, 
            blockchain,
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
router.post('/newVideo', authenticateToken, async (req, res) => {
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
router.post('/newImage', authenticateToken, async (req, res) => {
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
router.post('/newMedia', authenticateToken, async (req, res) => {
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

// Add nutritionalInfo schema endpoint
router.get('/newNutritionalInfo/schema', (req, res) => {
    try {
        const nutritionalInfoSchema = {
            "description": "Complete JSON schema for publishing nutritional info via POST /api/publish/newNutritionalInfo",
            "example": {
                "data": {
                    "basic": {
                        "name": "raw, grass-fed sharp cheddar cheese",
                        "date": 1752015668,
                        "language": "en",
                        "nsfw": false,
                        "webUrl": "https://www.nutritionix.com/food/raw,-grass-fed-sharp-cheddar-cheese"
                    },
                    "nutritionalInfo": {
                        "standardAmount": 1,
                        "standardUnit": "slice (1 oz)",
                        "calories": 114.8,
                        "proteinG": 6.79,
                        "fatG": 9.47,
                        "saturatedFatG": 5.42,
                        "transFatG": 0,
                        "cholesterolMg": 27.72,
                        "sodiumMg": 180.32,
                        "carbohydratesG": 0.6,
                        "dietaryFiberG": 0,
                        "sugarsG": 0.08,
                        "addedSugarsG": 0,
                        "vitaminDMcg": 0,
                        "calciumMg": 0,
                        "ironMg": 0,
                        "potassiumMg": 21.28,
                        "vitaminAMcg": 0,
                        "vitaminCMg": 0,
                        "allergens": [],
                        "glutenFree": false,
                        "organic": false
                    },
                    "image": {
                        "webUrl": "https://nix-tag-images.s3.amazonaws.com/2203_thumb.jpg",
                        "contentType": "image/jpeg"
                    }
                },
                "blockchain": "arweave"
            },
            "field_descriptions": {
                "basic.name": "Food item name (required)",
                "basic.date": "Unix timestamp (default: current time)",
                "basic.language": "Language code (default: 'en')",
                "basic.nsfw": "Boolean for adult content (default: false)",
                "basic.webUrl": "Optional source URL",
                "nutritionalInfo.standardAmount": "Standard serving amount (default: 1)",
                "nutritionalInfo.standardUnit": "Standard serving unit (default: 'unit')",
                "nutritionalInfo.calories": "Calories per serving",
                "nutritionalInfo.proteinG": "Protein in grams",
                "nutritionalInfo.fatG": "Total fat in grams",
                "nutritionalInfo.saturatedFatG": "Saturated fat in grams",
                "nutritionalInfo.transFatG": "Trans fat in grams",
                "nutritionalInfo.cholesterolMg": "Cholesterol in milligrams",
                "nutritionalInfo.sodiumMg": "Sodium in milligrams",
                "nutritionalInfo.carbohydratesG": "Total carbohydrates in grams",
                "nutritionalInfo.dietaryFiberG": "Dietary fiber in grams",
                "nutritionalInfo.sugarsG": "Total sugars in grams",
                "nutritionalInfo.addedSugarsG": "Added sugars in grams",
                "nutritionalInfo.vitaminDMcg": "Vitamin D in micrograms",
                "nutritionalInfo.calciumMg": "Calcium in milligrams",
                "nutritionalInfo.ironMg": "Iron in milligrams",
                "nutritionalInfo.potassiumMg": "Potassium in milligrams",
                "nutritionalInfo.vitaminAMcg": "Vitamin A in micrograms",
                "nutritionalInfo.vitaminCMg": "Vitamin C in milligrams",
                "nutritionalInfo.allergens": "Array of allergen strings",
                "nutritionalInfo.glutenFree": "Boolean indicating if gluten-free",
                "nutritionalInfo.organic": "Boolean indicating if organic",
                "image.webUrl": "URL to food image",
                "image.contentType": "Image MIME type",
                "blockchain": "Target blockchain ('arweave' or 'turbo')"
            }
        };

        res.status(200).json(nutritionalInfoSchema);
    } catch (error) {
        console.error('Error generating nutritional info schema:', error);
        res.status(500).json({ error: 'Failed to generate nutritional info schema' });
    }
});

// Add newNutritionalInfo endpoint for publishing nutritional info records
router.post('/newNutritionalInfo', authenticateToken, async (req, res) => {
    try {
        console.log('POST /api/publish/newNutritionalInfo', req.body);
        const inputData = req.body.data || req.body; // Handle both wrapped and unwrapped formats
        const blockchain = req.body.blockchain || 'arweave';
        let recordType = 'nutritionalInfo';

        // Map the input format to the correct template format (camelCase)
        const nutritionalInfoRecord = {
            basic: {
                name: inputData.basic?.name || 'Nutritional Info Record',
                date: inputData.basic?.date || Math.floor(Date.now() / 1000),
                language: inputData.basic?.language || 'en',
                nsfw: inputData.basic?.nsfw || false,
                webUrl: inputData.basic?.webUrl || '',
                tagItems: inputData.basic?.tagItems || []
            },
            nutritionalInfo: {
                // Use camelCase field names to match the template
                standardAmount: inputData.nutritionalInfo?.standardAmount || 1,
                standardUnit: inputData.nutritionalInfo?.standardUnit || 'unit',
                calories: inputData.nutritionalInfo?.calories || 0,
                proteinG: inputData.nutritionalInfo?.proteinG || 0,
                fatG: inputData.nutritionalInfo?.fatG || 0,
                saturatedFatG: inputData.nutritionalInfo?.saturatedFatG || 0,
                transFatG: inputData.nutritionalInfo?.transFatG || 0,
                cholesterolMg: inputData.nutritionalInfo?.cholesterolMg || 0,
                sodiumMg: inputData.nutritionalInfo?.sodiumMg || 0,
                carbohydratesG: inputData.nutritionalInfo?.carbohydratesG || 0,
                dietaryFiberG: inputData.nutritionalInfo?.dietaryFiberG || 0,
                sugarsG: inputData.nutritionalInfo?.sugarsG || 0,
                addedSugarsG: inputData.nutritionalInfo?.addedSugarsG || 0,
                vitaminDMcg: inputData.nutritionalInfo?.vitaminDMcg || 0,
                calciumMg: inputData.nutritionalInfo?.calciumMg || 0,
                ironMg: inputData.nutritionalInfo?.ironMg || 0,
                potassiumMg: inputData.nutritionalInfo?.potassiumMg || 0,
                vitaminAMcg: inputData.nutritionalInfo?.vitaminAMcg || 0,
                vitaminCMg: inputData.nutritionalInfo?.vitaminCMg || 0,
                allergens: inputData.nutritionalInfo?.allergens || [],
                glutenFree: inputData.nutritionalInfo?.glutenFree || false,
                organic: inputData.nutritionalInfo?.organic || false
            }
        };

        // Add image data if provided
        if (inputData.image?.webUrl) {
            nutritionalInfoRecord.image = {
                webUrl: inputData.image.webUrl,
                contentType: inputData.image.contentType || 'image/jpeg'
            };
        }

        console.log('Final nutritional info data:', nutritionalInfoRecord);

        // Publish the nutritional info record
        const nutritionalInfoResult = await publishNewRecord(nutritionalInfoRecord, recordType, false, false, false, null, blockchain);

        const transactionId = nutritionalInfoResult.transactionId;
        const recordToIndex = nutritionalInfoResult.recordToIndex;

        res.status(200).json({ 
            transactionId, 
            recordToIndex, 
            blockchain,
            message: 'Nutritional info published successfully'
        });

    } catch (error) {
        console.error('Error publishing nutritional info:', error);
        res.status(500).json({ error: 'Failed to publish nutritional info' });
    }
});

// Add newPost endpoint for publishing post records
router.post('/newPost', authenticateToken, async (req, res) => {
    try {
        console.log('POST /api/publish/newPost', req.body);
        const record = req.body;
        const blockchain = req.body.blockchain || 'arweave'; // Get blockchain parameter, default to arweave
        let recordType = 'post';

        // Helper function to check if an object has meaningful data
        function hasData(obj) {
            if (!obj || typeof obj !== 'object') return false;
            if (Array.isArray(obj)) return obj.length > 0;
            
            // Check if object has any non-empty, non-null values
            return Object.values(obj).some(value => {
                if (value === null || value === undefined || value === '') return false;
                if (Array.isArray(value)) return value.length > 0;
                if (typeof value === 'object') return hasData(value);
                return true;
            });
        }

        // Filter out empty arrays and objects before passing to publishNewRecord
        const cleanedRecord = { ...record };
        
        // Clean post section
        if (cleanedRecord.post) {
            // Remove empty arrays to prevent empty record creation
            if (Array.isArray(cleanedRecord.post.imageItems) && cleanedRecord.post.imageItems.length === 0) {
                delete cleanedRecord.post.imageItems;
            }
            if (Array.isArray(cleanedRecord.post.videoItems) && cleanedRecord.post.videoItems.length === 0) {
                delete cleanedRecord.post.videoItems;
            }
            if (Array.isArray(cleanedRecord.post.audioItems) && cleanedRecord.post.audioItems.length === 0) {
                delete cleanedRecord.post.audioItems;
            }
            if (Array.isArray(cleanedRecord.post.imageCaptionItems) && cleanedRecord.post.imageCaptionItems.length === 0) {
                delete cleanedRecord.post.imageCaptionItems;
            }
            if (Array.isArray(cleanedRecord.post.audioCaptionItems) && cleanedRecord.post.audioCaptionItems.length === 0) {
                delete cleanedRecord.post.audioCaptionItems;
            }
            
            // Remove empty string fields that would create empty records
            if (!cleanedRecord.post.replyTo || cleanedRecord.post.replyTo === '') {
                delete cleanedRecord.post.replyTo;
            }
        }

        console.log('Final post data:', cleanedRecord);

        // Publish the post record - let translateJSONtoOIPData handle the dref processing
        const postResult = await publishNewRecord(cleanedRecord, recordType, false, false, false, null, blockchain);

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