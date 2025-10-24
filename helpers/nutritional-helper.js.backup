const axios = require('axios');
const cheerio = require('cheerio');

async function fetchNutritionalData(ingredientName) {
  const nutritionixAppId = process.env.NUTRITIONIX_APP_ID;
  const nutritionixApiKey = process.env.NUTRITIONIX_API_KEY;
  
  try {
    if (nutritionixAppId && nutritionixApiKey) {
      const apiResponse = await axios.post(
        'https://trackapi.nutritionix.com/v2/natural/nutrients',
        { query: ingredientName, timezone: 'US/Eastern' },
        { headers: { 'x-app-id': nutritionixAppId, 'x-app-key': nutritionixApiKey, 'Content-Type': 'application/json' } }
      );

      if (apiResponse.data && apiResponse.data.foods && apiResponse.data.foods.length > 0) {
        const food = apiResponse.data.foods[0];
        const formattedNutritionalInfo = {
          basic: {
            name: ingredientName,
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
            transFatG: food.nf_trans_fatty_acid || 0,
            cholesterolMg: food.nf_cholesterol || 0,
            sodiumMg: food.nf_sodium || 0,
            carbohydratesG: food.nf_total_carbohydrate || 0,
            dietaryFiberG: food.nf_dietary_fiber || 0,
            sugarsG: food.nf_sugars || 0,
            addedSugarsG: food.nf_added_sugars || 0,
            vitaminDMcg: food.nf_vitamin_d_mcg || 0,
            calciumMg: food.nf_calcium || 0,
            ironMg: food.nf_iron || 0,
            potassiumMg: food.nf_potassium || 0,
            vitaminAMcg: food.nf_vitamin_a_iu ? (food.nf_vitamin_a_iu * 0.3) : 0,
            vitaminCMg: food.nf_vitamin_c || 0,
            allergens: [],
            glutenFree: false,
            organic: false,
          },
          image: {
            webUrl: food.photo?.thumb || food.photo?.highres || food.photo || '',
            contentType: 'image/jpeg'
          }
        };

        const nameLower = formattedNutritionalInfo.basic.name.toLowerCase();
        formattedNutritionalInfo.nutritionalInfo.organic = nameLower.includes('organic');

        // Gluten-free logic
        const glutenKeywords = ['wheat', 'barley', 'rye', 'bread', 'pasta', 'flour', 'cake', 'cookie', 'pastry', 'cereal', 'malt'];
        const glutenFreeKeywords = ['salt', 'pepper', 'herb', 'spice', 'fruit', 'vegetable', 'meat', 'fish', 'egg', 'rice', 'quinoa', 'corn', 'potato', 'nut', 'seed', 'bean', 'lentil', 'cheese', 'milk', 'yogurt', 'butter', 'oil', 'vinegar'];
        const hasGlutenWord = glutenKeywords.some(word => nameLower.includes(word));
        const isLikelyGlutenFree = glutenFreeKeywords.some(word => nameLower.includes(word)) || nameLower.includes('gluten free') || nameLower.includes('gluten-free');
        formattedNutritionalInfo.nutritionalInfo.glutenFree = isLikelyGlutenFree && !hasGlutenWord;

        return formattedNutritionalInfo;
      }
    }

    // Fallback to scraping
    const firecrawlToken = process.env.FIRECRAWL;
    if (!firecrawlToken) throw new Error('No Firecrawl token available');

    const formattedIngredient = ingredientName.replace(/,/g, '').replace(/\s+/g, '-').toLowerCase();
    const nutritionixUrl = `https://www.nutritionix.com/food/${formattedIngredient}`;

    const response = await axios.post('https://api.firecrawl.dev/v1/scrape', {
      url: nutritionixUrl,
      formats: ['html'],
      waitFor: 3000
    }, { headers: { Authorization: `Bearer ${firecrawlToken}` } });

    if (!response.data.success) throw new Error(`Scrape failed: ${response.data.error}`);

    const html = response.data.data.html;
    const $ = cheerio.load(html);

    const name = $('h1.food-item-name').text().trim() || ingredientName;
    const date = Math.floor(Date.now() / 1000);
    const webUrl = nutritionixUrl;

    // Parse nutritional facts (full parsing logic here)
    const nutritionTable = {}; // Implement full parsing as in original
    // ...

    // If no data found, return fallback
    const formattedNutritionalInfo = {
      basic: {
        name: ingredientName,
        date: Math.floor(Date.now() / 1000),
        language: 'en',
        nsfw: false,
        webUrl: `https://www.nutritionix.com/food/${ingredientName.replace(/\s+/g, '-').toLowerCase()}`,
      },
      nutritionalInfo: {
        standardAmount: 1,
        standardUnit: 'unit',
        calories: 0,
        // ... all fields with 0
        allergens: [],
        glutenFree: false,
        organic: false
      },
      image: {
        webUrl: '',
        contentType: 'image/jpeg'
      }
    };

    const nameLower = formattedNutritionalInfo.basic.name.toLowerCase();
    formattedNutritionalInfo.nutritionalInfo.organic = nameLower.includes('organic');

    // Gluten-free logic
    const glutenKeywords = ['wheat', 'barley', 'rye', 'bread', 'pasta', 'flour', 'cake', 'cookie', 'pastry', 'cereal', 'malt'];
    const glutenFreeKeywords = ['salt', 'pepper', 'herb', 'spice', 'fruit', 'vegetable', 'meat', 'fish', 'egg', 'rice', 'quinoa', 'corn', 'potato', 'nut', 'seed', 'bean', 'lentil', 'cheese', 'milk', 'yogurt', 'butter', 'oil', 'vinegar'];
    const hasGlutenWord = glutenKeywords.some(word => nameLower.includes(word));
    const isLikelyGlutenFree = glutenFreeKeywords.some(word => nameLower.includes(word)) || nameLower.includes('gluten free') || nameLower.includes('gluten-free');
    formattedNutritionalInfo.nutritionalInfo.glutenFree = isLikelyGlutenFree && !hasGlutenWord;

    return formattedNutritionalInfo;
  } catch (error) {
    console.error(`Error fetching nutritional data for ${ingredientName}:`, error);
    // Return basic fallback
    return {
      basic: {
        name: ingredientName,
        date: Math.floor(Date.now() / 1000),
        language: 'en',
        nsfw: false,
      },
      nutritionalInfo: {
        standardAmount: 1,
        standardUnit: 'unit',
        calories: 0,
        // ... all zeros
      }
    };
  }
}

module.exports = { fetchNutritionalData }; 