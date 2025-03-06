const express = require('express');
const router = express.Router();

const { authenticateToken } = require('../helpers/utils'); // Import the authentication middleware
const { TurboFactory, ArDriveUploadDriver } = require('@ardrive/turbo-sdk');
const { encryptContent } = require('../helpers/lit-protocol');
const fs = require('fs').promises;
const path = require('path');
const { getRecords } = require('../helpers/elasticsearch');
const { publishNewRecord} = require('../helpers/templateHelper');
const arweaveWallet = require('../helpers/arweave-wallet');
const paymentManager = require('../helpers/payment-manager');

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

router.post('/newRecipe', async (req, res) => {

    try {
        console.log('POST /api/records/newRecord', req.body)
        const record = req.body;
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
        ingredientDidRefs[name] = match.oip.didTx;
        nutritionalInfo.push({
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
      missingIngredientNames.map(name => createNewNutritionalInfoRecord(name))
    );

    // Restart the function now that all ingredients have nutritional info
    return await fetchParsedRecipeData(url, scrapeId, options);
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

  // console.log('Ingredient DidRefs:', ingredientDidRefs);

    // console.log('Ingredient DID References:', ingredientDidRefs);
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
    const prep_time_mins = record.recipe.prep_time_mins || null;
    const cook_time_mins = record.recipe.cook_time_mins || null;
    const total_time_mins = record.recipe.total_time_mins || null;
    const servings = record.recipe.servings || null;
    const cuisine = record.recipe.cuisine || null;
    const course = record.recipe.course || null;
    const notes = record.recipe.notes || null;

    console.log('Missing Ingredients:', missingIngredientNames);
    // console.log('Nutritional Info Array:', nutritionalInfoArray);
 
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

const recipeDate = Math.floor(new Date(metadata.publishedTime).getTime() / 1) || Date.now() / 1;
     
    
    // Assign to recipeData
    const recipeData = {
      basic: {
        name: metadata.ogTitle || metadata.title || null,
        language: "En",
        date: recipeDate,
        description,
        webUrl: url || null,
        nsfw: false,
        // tagItems: [],
      },
      recipe: {
        prep_time_mins,
        cook_time_mins,
        total_time_mins,
        servings,
        ingredient_amount: ingredientAmounts.length ? ingredientAmounts : null,
        ingredient_unit: ingredientUnits.length ? ingredientUnits : null,
        ingredient: ingredientDRefs,
        instructions: instructions.length ? instructions : null,
        notes,
        cuisine,
        course,
        author: metadata.author || null
      },
      image: {
        webUrl: imageUrl,
        // contentType: imageFileType
      },
    };

    // TO DO, use this so that it doesnt break if there is no image included
    // if (articleData.embeddedImage) {
    //   recordToPublish.post.featuredImage = 
    //     {
    //       "basic": {
    //         "name": articleData.title,
    //         "language": "en",
    //         "nsfw": false,
    //         // "urlItems": [
    //         //   {
    //         //     "associatedUrlOnWeb": {
    //         //       "url": articleData.embeddedImage
    //         //     }
    //         //   }
    //         // ]
    //       },
    //       // "associatedUrlOnWeb": {
    //       //   "url": articleData.embeddedImageUrl
    //       // },
    //       "image": {
    //         "webUrl": articleData.embeddedImageUrl,
    //         // "bittorrentAddress": imageBittorrentAddress,
    //         "height": imageHeight,
    //         "width": imageWidth,
    //         "size": imageSize,
    //         "contentType": imageFileType
    //       }
    //     }
      
    // }



// console.log('nutritionalInfo:', nutritionalInfo);
    console.log('Recipe data:', recipeData);
    recipeRecord = await publishNewRecord(recipeData, "recipe");


    // const newRecord = await publishNewRecord(record, recordType, publishFiles, addMediaToArweave, addMediaToIPFS, youtubeUrl);
    const transactionId = newRecord.transactionId;
    const recordToIndex = newRecord.recordToIndex;
    // const dataForSignature = newRecord.dataForSignature;
    // const creatorSig = newRecord.creatorSig;
    res.status(200).json(transactionId, recordToIndex);
} catch (error) {
    console.error('Error publishing record:', error);
    res.status(500).json({ error: 'Failed to publish record' });
}
});

router.post('/newVideo', async (req, res) => {
    try {
        const {
            videoFile, // Base64 encoded video file
            accessControl, // Access control settings
            basicMetadata // Title, description, etc.
        } = req.body;

        // 1. Generate payment addresses for supported currencies
        const btcAddress = await paymentManager.getPaymentAddress('btc');
        // const zcashAddress = await paymentManager.getPaymentAddress('zcash'); // When implemented

        // 2. Encrypt video content using Lit Protocol
        const litConditions = {
            // We'll define access conditions based on payment verification
            conditionType: "evmBasic",
            contractAddress: "",
            standardContractType: "",
            chain: "polygon",
            method: "eth_getBalance",
            parameters: [":userAddress", "latest"],
            returnValueTest: {
                comparator: ">",
                value: "0"
            }
        };

        const { encryptedContent, encryptedSymmetricKey } = await encryptContent(
            videoFile,
            litConditions
        );

        // 3. Upload encrypted video to Arweave using Turbo
        const videoBuffer = Buffer.from(encryptedContent, 'base64');
        const uploadResult = await arweaveWallet.uploadFile(
            videoBuffer, 
            'video/mp4',
            'high'
        );

        // 4. Create the OIP record with access control and payment info
        const record = {
            basic: {
                ...basicMetadata,
                createdAt: new Date().toISOString(),
            },
            accessControl: {
                ...accessControl,
                encryptedContent: uploadResult.id,
                litConditions: JSON.stringify(litConditions),
                encryptedSymmetricKey
            },
            payment: {
                addresses: {
                    bitcoin: {
                        address: btcAddress.address,
                        path: btcAddress.path,
                        publicKey: btcAddress.publicKey
                    }
                    // Add Zcash when implemented
                },
                price: accessControl.price || 0,
                currency: accessControl.currency || 'USD'
            }
        };

        // 5. Upload the record to Arweave
        const recordBuffer = Buffer.from(JSON.stringify(record));
        const recordResult = await arweaveWallet.uploadFile(
            recordBuffer,
            'application/json',
            'medium'
        );

        // 6. Store payment tracking info in Elasticsearch
        const contentDidTx = `did:arweave:${recordResult.id}`; // Convert to DID format
        await client.index({
            index: 'content_payments',
            body: {
                contentId: contentDidTx, // Use DID format
                videoTxId: uploadResult.id,
                userId: req.user.id,
                createdAt: new Date().toISOString(),
                paymentAddresses: {
                    bitcoin: btcAddress.address
                    // Add other currencies here
                },
                payments: [], // Will be populated as payments are received
                price: accessControl.price || 0,
                currency: accessControl.currency || 'USD'
            }
        });

        res.json({
            status: 'success',
            data: {
                recordTx: contentDidTx, // Return DID format
                videoTx: uploadResult.id,
                paymentAddresses: {
                    bitcoin: btcAddress.address
                    // Add other currencies when implemented
                }
            }
        });

    } catch (error) {
        console.error('Error publishing locked video:', error);
        res.status(500).json({
            error: 'Failed to publish locked video',
            details: error.message
        });
    }
});

// Add template publishing endpoint
router.post('/newTemplate', authenticateToken, async (req, res) => {
    try {
        const rawTemplate = req.body;
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

        // Upload template to Arweave using Turbo
        const templateBuffer = Buffer.from(JSON.stringify(processedTemplate));
        const uploadResult = await arweaveWallet.uploadFile(
            templateBuffer,
            'application/json'
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

module.exports = router;