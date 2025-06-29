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

// Function to create new nutritional info records for missing ingredients
async function createNewNutritionalInfoRecord(ingredientName, blockchain = 'arweave') {
  // Add Firecrawl token retrieval and validation
  const firecrawlToken = process.env.FIRECRAWL;
  if (!firecrawlToken) {
    throw new Error('FIRECRAWL environment variable is not set – cannot scrape Nutritionix');
  }
  try {
    console.log(`Fetching nutritional info for missing ingredient: ${ingredientName}`);

    // Construct a Nutritionix search URL
    const formattedIngredient = ingredientName.replace(/,/g, '').replace(/\s+/g, '-').toLowerCase();
    const nutritionixUrl = `https://www.nutritionix.com/food/${formattedIngredient}`;

    // Scrape the Nutritionix page using FireCrawl
    const response = await axios.post(
      'https://api.firecrawl.dev/v1/scrape',
      {
        url: nutritionixUrl,
        formats: ['html'],
      },
      {
        headers: {
          Authorization: `Bearer ${firecrawlToken}`,
        },
      }
    );

    if (!response.data.success) {
      throw new Error(`Scrape failed for ${ingredientName}: ${response.data.error}`);
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
      carbohydrates_g: 0,
      cholesterol_mg: 0,
      sodium_mg: 0,
    };

    // Parse nutritional facts using the HTML structure
    $('.nf-line').each((_, element) => {
      const label = $(element).find('span:first-child').text().trim().toLowerCase();
      const valueRaw = $(element).find('span[itemprop]').text().trim();
      const value = parseFloat(valueRaw.replace(/[^\d.]/g, '')) || 0;

      // console.log(`Label: ${label}, Raw Value: ${valueRaw}, Parsed Value: ${value}`);

      if (label.includes('calories')) {
        nutritionTable.calories = value;
      } else if (label.includes('protein')) {
        nutritionTable.protein_g = value;
      } else if (label.includes('fat')) {
        nutritionTable.fat_g = value;
      } else if (label.includes('cholesterol')) {
        nutritionTable.cholesterol_mg = value;
      } else if (label.includes('sodium')) {
        nutritionTable.sodium_mg = value;
      } else if (label.includes('carbohydrates')) {
        nutritionTable.carbohydrates_g = value;
      }
    });

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
        standard_amount: standardAmount,
        standard_unit: standardUnit,
        calories: nutritionTable.calories,
        protein_g: nutritionTable.protein_g,
        fat_g: nutritionTable.fat_g,
        carbohydrates_g: nutritionTable.carbohydrates_g,
        cholesterol_mg: nutritionTable.cholesterol_mg,
        sodium_mg: nutritionTable.sodium_mg,
      },
    };

    ingredientTx = await publishNewRecord(formattedNutritionalInfo, "nutritionalInfo", false, false, false, null, blockchain)
    console.log(`Successfully retrieved and published nutritional info for ${ingredientName}:`, formattedNutritionalInfo, ingredientTx);
    return ingredientTx.recordToIndex;
  } catch (error) {
    console.error(`Error fetching nutritional info for ${ingredientName}:`, error);
    return null; // Return null if fetching fails
  }
}

router.post('/newRecipe', async (req, res) => {

    try {
        console.log('POST /api/publish/newRecipe', req.body)
        const record = req.body;
        const blockchain = req.body.blockchain || 'arweave'; // Get blockchain parameter, default to arweave
        let recordType = 'recipe';


    // const recipeName = record.basic.name || null;
    // const description = record.basic.description || null;
    // const imageUrl = record.image.webUrl || null;

    // Parse ingredient sections from JSON
    const ingredientSections = req.body.recipe.map((section, index) => {
        const sectionName = section.section || `Section ${index + 1}`;
        const ingredients = section.ingredient.map((name, i) => ({
            amount: parseFloat(section.ingredient_amount[i]) || null,
            unit: section.ingredient_unit[i] || '',
            name: name || '',
        }));

        return {
            section: sectionName,
            ingredients,
        };
    });

    // Primary ingredient section logic
    let primaryIngredientSection = ingredientSections[0];
    if (ingredientSections.length > 1) {
        primaryIngredientSection = ingredientSections.reduce((prev, current) =>
            prev.ingredients.length > current.ingredients.length ? prev : current
        );
    }

    console.log('Ingredient sections count:', ingredientSections.length, ingredientSections);
    console.log('Primary ingredient section:', primaryIngredientSection);

    // Sort remaining ingredients sections by the number of ingredients
    const remainingIngredientSections = ingredientSections.filter(section => section !== primaryIngredientSection);
    remainingIngredientSections.sort((a, b) => b.ingredients.length - a.ingredients.length);

  // Extract instructions
  const instructions = record.recipe.instructions || [];

//   $('.wprm-recipe-instruction').each((i, elem) => {
    // const instruction = $(elem).text().replace(/\s+/g, ' ').trim();
    // if (instruction) instructions.push(instruction);
//   });

  console.log('Instructions:', instructions);

  const ingredientNames = primaryIngredientSection.ingredients.map(ing => {
    const normalizedIngredientName = ing.name.trim().toLowerCase().replace(/,$/, '');
    return normalizedIngredientName;
  });
  const ingredientAmounts = primaryIngredientSection.ingredients.map(ing => ing.amount ?? 1);
const ingredientUnits = primaryIngredientSection.ingredients.map(ing => (ing.unit && ing.unit.trim()) || 'unit'); // Default unit to 'unit'

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
    
  async function fetchIngredientRecordData(primaryIngredientSection) {
    const ingredientNames = primaryIngredientSection.ingredients.map(ing => ing.name.trim().toLowerCase().replace(/,$/, ''));

    // Query for all ingredients in one API call
    const queryParams = {
        recordType: 'nutritionalInfo',
        search: ingredientNames.join(','),
        limit: 50
    };

    const recordsInDB = await getRecords(queryParams);
    console.log('quantity of results:', recordsInDB.searchResults);
    // Populate the global recordMap
    recordMap = {};  // Reset before populating
    recordsInDB.records.forEach(record => {
        const recordName = record.data.basic.name.toLowerCase();
        recordMap[recordName] = record;
    });

    const ingredientDidRefs = {};
    const nutritionalInfo = [];

    for (const name of ingredientNames) {
        const bestMatch = findBestMatch(name);
        if (bestMatch) {
            ingredientDidRefs[name] = bestMatch.oip.didTx;
            nutritionalInfo.push({
                ingredientName: bestMatch.data.basic.name,
                nutritionalInfo: bestMatch.data.nutritionalInfo || {},
                ingredientSource: bestMatch.data.basic.webUrl,
                ingredientDidRef: bestMatch.oip.didTx
            });
            console.log(`Match found for ${name}:`, nutritionalInfo[nutritionalInfo.length - 1]);
        } else {
            ingredientDidRefs[name] = null;
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



    
  // Function to find the best match
  function findBestMatch(ingredientName) {
    if (!recordMap || Object.keys(recordMap).length === 0) {
        console.error("Error: recordMap is not populated before calling findBestMatch().");
        return null;
    }
    // const ingredientNames = primaryIngredientSection.ingredients.map(ing => {
    //   const normalizedIngredientName = ing.name.trim().toLowerCase().replace(/,$/, '');
    //   return normalizedIngredientName;
    // });
  
    // const normalizedIngredientName = ing.name.trim().toLowerCase().replace(/,$/, '');
    const searchTerms = ingredientName.split(/\s+/).filter(Boolean);

    console.log(`Searching for ingredient: ${ingredientName}, Search terms:`, searchTerms);

    // Check if the ingredient has a predefined synonym
    const synonym = synonymMap[ingredientName];
    if (synonym && recordMap[synonym]) {
        console.log(`Found synonym match for ${ingredientName}: ${synonym}`);
        return recordMap[synonym];
    }

    // Direct match
    if (recordMap[ingredientName]) {
        console.log(`Direct match found for ${ingredientName}, nutritionalInfo:`, recordMap[ingredientName].data.nutritionalInfo);
        return recordMap[ingredientName];
    }

    // Looser match using search terms
    const matches = Object.keys(recordMap)
        .filter(recordName => {
            const normalizedRecordName = recordName.toLowerCase();
            return searchTerms.some(term => normalizedRecordName.includes(term));
        })
        .map(recordName => recordMap[recordName]);

    if (matches.length > 0) {
        matches.sort((a, b) => {
            const aMatchCount = searchTerms.filter(term => a.data.basic.name.toLowerCase().includes(term)).length;
            const bMatchCount = searchTerms.filter(term => b.data.basic.name.toLowerCase().includes(term)).length;
            return bMatchCount - aMatchCount;
        });

        console.log(`Loose matches found for ${ingredientName}:`, matches);
        return matches[0];
    }

    console.log(`No match found for ${ingredientName}`);
    return null;
  }

  const ingredientRecords = await fetchIngredientRecordData(primaryIngredientSection);
  console.log('Ingredient records:', ingredientRecords);
  
  let missingIngredientNames = Object.keys(ingredientRecords.ingredientDidRefs).filter(
    name => ingredientRecords.ingredientDidRefs[name] === null
  );
  if (missingIngredientNames.length > 0) {
    // Send the names of the missing ingredients through findBestMatch(ingredientName) to get the best match for each
    const bestMatches = await Promise.all(
      missingIngredientNames.map(name => findBestMatch(name))
    );
    console.log('Best matches for missing ingredients:', bestMatches);

    // Assign matches and update ingredientDidRefs
    bestMatches.forEach((match, index) => {
      if (match) {
        const name = missingIngredientNames[index];
        ingredientRecords.ingredientDidRefs[name] = match.oip.didTx;
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

    const nutritionalInfoArray = await Promise.all(
      missingIngredientNames.map(name => createNewNutritionalInfoRecord(name, blockchain))
    );

    // Update ingredientDidRefs with the newly created nutritional info records
    nutritionalInfoArray.forEach((newRecord, index) => {
      if (newRecord) {
        const name = missingIngredientNames[index];
        ingredientRecords.ingredientDidRefs[name] = newRecord.oip?.didTx || `did:arweave:${newRecord.transactionId}`;
        ingredientRecords.nutritionalInfo.push({
          ingredientName: newRecord.data?.basic?.name || name,
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
  missingIngredientNames.forEach((name, index) => {
    const trimmedName = name.trim().replace(/,$/, '');
    const unitIndex = ingredientNames.findIndex(ingredientName => ingredientName === trimmedName);

    console.log(`Processing missing ingredient: ${trimmedName}, Found at index: ${unitIndex}`);

    if (unitIndex !== -1 && !ingredientUnits[unitIndex]) {
        const nutritionalInfo = nutritionalInfoArray[index];
        console.log(`Found nutritional info for: ${trimmedName}`, nutritionalInfo);

        if (nutritionalInfo && nutritionalInfo.nutritionalInfo) {
            ingredientUnits[unitIndex] = nutritionalInfo.nutritionalInfo.standard_unit || 'unit';
            ingredientAmounts[unitIndex] *= nutritionalInfo.nutritionalInfo.standard_amount || 1;

            console.log(`Updated Units: ${ingredientUnits[unitIndex]}, Updated Amounts: ${ingredientAmounts[unitIndex]}`);
        } else {
            console.log(`No nutritional info found for: ${trimmedName}`);
            ingredientUnits[unitIndex] = 'unit'; // Fallback unit
        }
    } else {
        console.log(`Ingredient not found in ingredientNames or already has a unit: ${trimmedName}`);
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


    // Extract prep time, cook time, total time, cuisine, and course
    const firstRecipeSection = record.recipe[0] || {};
    const prep_time_mins = firstRecipeSection.prep_time_mins || null;
    const cook_time_mins = firstRecipeSection.cook_time_mins || null;
    const total_time_mins = firstRecipeSection.total_time_mins || null;
    const servings = firstRecipeSection.servings || null;
    const cuisine = firstRecipeSection.cuisine || null;
    const course = firstRecipeSection.course || null;
    const notes = firstRecipeSection.notes || null;

    console.log('Missing Ingredients:', missingIngredientNames);
    console.log('Original Ingredient Names:', ingredientNames);
    console.log('Units Before Assignment:', ingredientUnits);
    console.log('Amounts Before Assignment:', ingredientAmounts);
    console.log('Ingredient Did Refs:', ingredientRecords);

  // Normalize all ingredient names in `ingredientNames` upfront
  const normalizedIngredientNames = ingredientNames.map(name => name.trim().replace(/,$/, '').toLowerCase());

  console.log('Normalized Ingredient Names:', normalizedIngredientNames);
  console.log('Missing Ingredient Names:', missingIngredientNames.map(name => name.trim().replace(/,$/, '').toLowerCase()));

  // Normalize missing ingredients and process them
  missingIngredientNames.forEach((name, index) => {
    const normalizedName = name.trim().replace(/,$/, '').toLowerCase();
    console.log(`Normalized Missing Ingredient Name: ${normalizedName}`);
    
    // Find the matching ingredient in the normalized array
    const unitIndex = normalizedIngredientNames.findIndex(
      ingredientName => ingredientName === normalizedName
    );

    console.log(`Processing ingredient: ${normalizedName}, Index in ingredientNames: ${unitIndex}`);
    
    if (unitIndex !== -1 && !ingredientUnits[unitIndex]) {
      const nutritionalInfo = nutritionalInfoArray[index];
      console.log(`Found nutritional info for: ${normalizedName}`, nutritionalInfo);
      
      if (nutritionalInfo && nutritionalInfo.nutritionalInfo) {
        ingredientUnits[unitIndex] = nutritionalInfo.nutritionalInfo.standard_unit || 'unit';
        ingredientAmounts[unitIndex] *= nutritionalInfo.nutritionalInfo.standard_amount || 1;
      } else {
        console.log(`No nutritional info found for: ${normalizedName}`);
        ingredientUnits[unitIndex] = 'unit'; // Fallback unit
      }
    } else {
      console.log(`Ingredient not found or already has unit: ${normalizedName}`);
    }
  });

let ingredientDRefs = [];
ingredientNames.forEach((name, index) => {
  // get the ingredientDidRef for each ingredient and put it in an array so that we can use it in the recipeData object
  const ingredientDidRef = ingredientRecords.ingredientDidRefs[name] || null;
  ingredientDRefs.push(ingredientDidRef);
  console.log(`Ingredient DID Ref for ${name}:`, ingredientDidRef);
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
    prep_time_mins: firstRecipeSection.prep_time_mins,
    cook_time_mins: firstRecipeSection.cook_time_mins,
    total_time_mins: firstRecipeSection.total_time_mins,
    servings: firstRecipeSection.servings,
    ingredient_amount: ingredientAmounts.length ? ingredientAmounts : null,
    ingredient_unit: ingredientUnits.length ? ingredientUnits : null,
    ingredient: ingredientDRefs,
    instructions: firstRecipeSection.instructions,
    notes: firstRecipeSection.notes,
    cuisine: firstRecipeSection.cuisine,
    course: firstRecipeSection.course,
    author: firstRecipeSection.author || null
  },
  image: {
    webUrl: record.image?.webUrl,
    contentType: record.image?.contentType
  },
};

// Remove any null ingredients from the final arrays
ingredientDRefs = ingredientDRefs.filter(ref => ref !== null);

console.log('Recipe data:', recipeData);
recipeRecord = await publishNewRecord(recipeData, "recipe", false, false, false, null, blockchain);


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