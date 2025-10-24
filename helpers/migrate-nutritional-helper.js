#!/usr/bin/env node

/**
 * Migration script to replace Nutritionix API with OpenAI-powered nutritional helper
 * This script updates the existing nutritional-helper.js to use the new OpenAI-based system
 */

const fs = require('fs');
const path = require('path');

console.log('🔄 Starting migration from Nutritionix API to OpenAI nutritional helper...');

// Backup the original file
const originalFile = path.join(__dirname, 'nutritional-helper.js');
const backupFile = path.join(__dirname, 'nutritional-helper.js.backup');

try {
  if (fs.existsSync(originalFile)) {
    fs.copyFileSync(originalFile, backupFile);
    console.log('✅ Created backup of original nutritional-helper.js');
  }
} catch (error) {
  console.error('❌ Error creating backup:', error.message);
  process.exit(1);
}

// Create the new nutritional-helper.js that uses the OpenAI version
const newContent = `const { fetchNutritionalData, findStandardUnit, convertNutritionalValues } = require('./nutritional-helper-openai');

/**
 * Legacy wrapper for backward compatibility
 * This file now uses the OpenAI-powered nutritional helper
 */
async function fetchNutritionalData(ingredientName) {
  const { fetchNutritionalData: openaiFetchNutritionalData } = require('./nutritional-helper-openai');
  return await openaiFetchNutritionalData(ingredientName);
}

module.exports = { 
  fetchNutritionalData,
  findStandardUnit,
  convertNutritionalValues
};`;

try {
  fs.writeFileSync(originalFile, newContent);
  console.log('✅ Updated nutritional-helper.js to use OpenAI system');
} catch (error) {
  console.error('❌ Error updating nutritional-helper.js:', error.message);
  process.exit(1);
}

// Check if there are any route files that need updating
const routesDir = path.join(__dirname, '..', 'routes');
if (fs.existsSync(routesDir)) {
  console.log('🔍 Checking routes for nutritional helper usage...');
  
  const routeFiles = fs.readdirSync(routesDir).filter(file => file.endsWith('.js'));
  
  routeFiles.forEach(file => {
    const filePath = path.join(routesDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    
    if (content.includes('nutritional-helper') || content.includes('fetchNutritionalData')) {
      console.log(`📝 Found usage in routes/${file} - may need manual review`);
    }
  });
}

// Check for environment variable requirements
console.log('\n📋 Environment Variables Required:');
console.log('   OPENAI_API_KEY - Your OpenAI API key for web search and structured outputs');
console.log('\n📋 Optional Environment Variables:');
console.log('   NUTRITIONIX_APP_ID - (deprecated, will be ignored)');
console.log('   NUTRITIONIX_API_KEY - (deprecated, will be ignored)');
console.log('   FIRECRAWL - (deprecated, will be ignored)');

console.log('\n✅ Migration completed successfully!');
console.log('\n📖 Next Steps:');
console.log('   1. Set OPENAI_API_KEY environment variable');
console.log('   2. Test the new system with: node -e "require(\'./helpers/nutritional-helper\').fetchNutritionalData(\'apple\').then(console.log)"');
console.log('   3. Update any custom code that directly imports nutritional-helper functions');
console.log('   4. Remove old environment variables (NUTRITIONIX_APP_ID, NUTRITIONIX_API_KEY, FIRECRAWL)');

console.log('\n🔄 Rollback Instructions:');
console.log('   If you need to rollback, restore from backup:');
console.log(`   cp ${backupFile} ${originalFile}`);

// Create a test script
const testScript = `#!/usr/bin/env node

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
      console.log(\`\\n🔍 Testing: \${ingredient}\`);
      const result = await fetchNutritionalData(ingredient);
      console.log(\`✅ Success: \${result.basic.name}\`);
      console.log(\`   Calories: \${result.nutritionalInfo.calories}\`);
      console.log(\`   Protein: \${result.nutritionalInfo.proteinG}g\`);
      console.log(\`   Standard: \${result.nutritionalInfo.standardAmount} \${result.nutritionalInfo.standardUnit}\`);
    } catch (error) {
      console.log(\`❌ Error with \${ingredient}: \${error.message}\`);
    }
  }
  
  console.log('\\n✅ Test completed!');
}

if (require.main === module) {
  testNutritionalHelper().catch(console.error);
}

module.exports = { testNutritionalHelper };
`;

try {
  fs.writeFileSync(path.join(__dirname, 'test-nutritional-helper.js'), testScript);
  fs.chmodSync(path.join(__dirname, 'test-nutritional-helper.js'), '755');
  console.log('✅ Created test script: helpers/test-nutritional-helper.js');
} catch (error) {
  console.error('❌ Error creating test script:', error.message);
}

console.log('\n🎉 Migration completed successfully!');
console.log('\nTo test the new system, run:');
console.log('   node helpers/test-nutritional-helper.js');