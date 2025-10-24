#!/usr/bin/env node

/**
 * Test script for the new OpenAI nutritional helper
 */

const { fetchNutritionalData } = require('./nutritional-helper');

async function testNutritionalHelper() {
  console.log('🧪 Testing OpenAI nutritional helper...');
  
  const testIngredients = [
    'apple',
    'chicken breast',
    'olive oil',
    'brown rice',
    'spinach'
  ];
  
  for (const ingredient of testIngredients) {
    try {
      console.log(`\n🔍 Testing: ${ingredient}`);
      const result = await fetchNutritionalData(ingredient);
      console.log(`✅ Success: ${result.basic.name}`);
      console.log(`   Calories: ${result.nutritionalInfo.calories}`);
      console.log(`   Protein: ${result.nutritionalInfo.proteinG}g`);
      console.log(`   Standard: ${result.nutritionalInfo.standardAmount} ${result.nutritionalInfo.standardUnit}`);
    } catch (error) {
      console.log(`❌ Error with ${ingredient}: ${error.message}`);
    }
  }
  
  console.log('\n✅ Test completed!');
}

if (require.main === module) {
  testNutritionalHelper().catch(console.error);
}

module.exports = { testNutritionalHelper };
