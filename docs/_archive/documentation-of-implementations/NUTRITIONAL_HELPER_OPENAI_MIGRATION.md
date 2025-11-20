# Nutritional Helper OpenAI Migration Guide

## Overview

This document describes the migration from the deprecated Nutritionix API to OpenAI's web search and structured outputs for nutritional data lookup in the OIP system.

## Why This Migration?

The Nutritionix API has been deprecated, requiring a replacement solution. The new system uses:
- **OpenAI Web Search**: Real-time access to current nutritional data
- **Structured Outputs**: Guaranteed JSON schema compliance
- **Domain Filtering**: Focus on authoritative nutrition sources
- **Standard Unit Conversion**: Integrated unit standardization

## New System Architecture

### Core Components

1. **`nutritional-helper-openai.js`** - Main implementation
2. **`nutritional-helper.js`** - Legacy wrapper for backward compatibility
3. **`migrate-nutritional-helper.js`** - Migration script
4. **`test-nutritional-helper.js`** - Test script

### Key Features

#### 1. OpenAI Web Search Integration
```javascript
// Uses OpenAI's web search with domain filtering
const response = await axios.post('https://api.openai.com/v1/responses', {
  model: 'gpt-5-mini',
  tools: [{
    type: 'web_search',
    filters: {
      allowed_domains: [
        'nutritionix.com',
        'usda.gov',
        'fdc.nal.usda.gov',
        'nutritiondata.self.com',
        'cronometer.com',
        'myfitnesspal.com',
        'webmd.com',
        'healthline.com',
        'mayoclinic.org'
      ]
    }
  }]
});
```

#### 2. Structured Outputs Schema
```javascript
// Guaranteed JSON schema compliance
const schema = {
  type: 'object',
  properties: {
    basic: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        date: { type: 'number' },
        language: { type: 'string' },
        nsfw: { type: 'boolean' },
        webUrl: { type: 'string' }
      },
      required: ['name', 'date', 'language', 'nsfw'],
      additionalProperties: false
    },
    nutritionalInfo: {
      type: 'object',
      properties: {
        standardAmount: { type: 'number' },
        standardUnit: { type: 'string' },
        calories: { type: 'number' },
        proteinG: { type: 'number' },
        // ... all nutritional fields
      },
      required: ['standardAmount', 'standardUnit', 'calories', 'proteinG', 'fatG'],
      additionalProperties: false
    }
  },
  required: ['basic', 'nutritionalInfo'],
  additionalProperties: false
};
```

#### 3. Standard Unit Conversion
```javascript
// Integrated unit standardization
const standardUnit = findStandardUnit(ingredientName, amount, unit);
const convertedData = convertNutritionalValues(
  nutritionalData,
  fromAmount, fromUnit,
  toAmount, toUnit
);
```

## Migration Process

### Step 1: Run Migration Script
```bash
cd helpers
node migrate-nutritional-helper.js
```

### Step 2: Set Environment Variables
```bash
# Required
export OPENAI_API_KEY="your-openai-api-key"

# Optional (for cleanup)
unset NUTRITIONIX_APP_ID
unset NUTRITIONIX_API_KEY
unset FIRECRAWL
```

### Step 3: Test the System
```bash
# Test individual ingredients
node -e "require('./helpers/nutritional-helper').fetchNutritionalData('apple').then(console.log)"

# Run comprehensive test suite
node helpers/test-nutritional-helper.js
```

## API Changes

### Before (Nutritionix API)
```javascript
const { fetchNutritionalData } = require('./helpers/nutritional-helper');

const result = await fetchNutritionalData('apple');
// Returns structured nutritional data
```

### After (OpenAI System)
```javascript
const { fetchNutritionalData } = require('./helpers/nutritional-helper');

const result = await fetchNutritionalData('apple');
// Returns same structured nutritional data format
// + Enhanced with standard unit conversion
// + Real-time web search data
// + Better error handling
```

## New Features

### 1. Standard Unit Conversion
The system automatically converts nutritional data to standard units:
- **Weight-based ingredients**: Converted to grams (g)
- **Volume-based ingredients**: Converted to milliliters (ml)
- **Count-based ingredients**: Kept as pieces/units

### 2. Enhanced Error Handling
```javascript
// Multiple fallback mechanisms
try {
  // Primary: OpenAI web search
  const data = await fetchNutritionalData(ingredientName);
} catch (error) {
  // Fallback 1: Manual parsing
  // Fallback 2: Basic structure with zeros
  // Fallback 3: Minimal viable data
}
```

### 3. Real-time Data
Unlike the static Nutritionix API, the new system:
- Searches current web sources
- Gets up-to-date nutritional information
- Handles new ingredients automatically

### 4. Domain Filtering
Focused on authoritative sources:
- USDA FoodData Central
- Nutritionix (for consistency)
- Medical/nutrition websites
- Government health sources

## Configuration

### Environment Variables
```bash
# Required
OPENAI_API_KEY=your-openai-api-key

# Optional (deprecated, will be ignored)
NUTRITIONIX_APP_ID=deprecated
NUTRITIONIX_API_KEY=deprecated
FIRECRAWL=deprecated
```

### Customization Options
```javascript
// Modify allowed domains in nutritional-helper-openai.js
const allowedDomains = [
  'nutritionix.com',
  'usda.gov',
  'fdc.nal.usda.gov',
  // Add your preferred sources
];

// Adjust standard unit preferences
const STANDARD_UNITS = {
  weight: { 'g': 1, 'oz': 28.3495, 'lb': 453.592 },
  volume: { 'ml': 1, 'cup': 236.588, 'tbsp': 14.7868 },
  count: ['whole', 'piece', 'slice', 'clove']
};
```

## Performance Considerations

### Cost Optimization
- **Web Search**: ~$0.01-0.05 per request
- **Structured Outputs**: ~$0.001-0.01 per request
- **Total**: ~$0.02-0.06 per nutritional lookup

### Caching Strategy
```javascript
// Consider implementing caching for frequently requested ingredients
const cache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

async function fetchNutritionalDataWithCache(ingredientName) {
  const cacheKey = ingredientName.toLowerCase();
  const cached = cache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  
  const data = await fetchNutritionalData(ingredientName);
  cache.set(cacheKey, { data, timestamp: Date.now() });
  return data;
}
```

## Troubleshooting

### Common Issues

#### 1. OpenAI API Key Not Set
```bash
Error: OpenAI API key not configured
```
**Solution**: Set the `OPENAI_API_KEY` environment variable

#### 2. Rate Limiting
```bash
Error: Rate limit exceeded
```
**Solution**: Implement request queuing or caching

#### 3. No Nutritional Data Found
```bash
Warning: No nutritional data found for ingredient
```
**Solution**: Check ingredient name spelling, try alternative names

### Debug Mode
```javascript
// Enable detailed logging
process.env.DEBUG_NUTRITIONAL = 'true';

// Check response structure
const result = await fetchNutritionalData('apple');
console.log('Response structure:', JSON.stringify(result, null, 2));
```

## Rollback Instructions

If you need to rollback to the original system:

```bash
# Restore original file
cp helpers/nutritional-helper.js.backup helpers/nutritional-helper.js

# Restore environment variables
export NUTRITIONIX_APP_ID="your-app-id"
export NUTRITIONIX_API_KEY="your-api-key"
export FIRECRAWL="your-firecrawl-token"
```

## Testing

### Manual Testing
```javascript
// Test basic functionality
const { fetchNutritionalData } = require('./helpers/nutritional-helper');

async function test() {
  const ingredients = ['apple', 'chicken breast', 'olive oil'];
  
  for (const ingredient of ingredients) {
    try {
      const result = await fetchNutritionalData(ingredient);
      console.log(`${ingredient}: ${result.nutritionalInfo.calories} calories`);
    } catch (error) {
      console.error(`${ingredient}: ${error.message}`);
    }
  }
}

test();
```

### Automated Testing
```bash
# Run the comprehensive test suite
node helpers/test-nutritional-helper.js
```

## Future Enhancements

### Planned Features
1. **Batch Processing**: Handle multiple ingredients in one request
2. **Caching Layer**: Redis-based caching for frequently requested data
3. **Custom Domains**: User-configurable domain filtering
4. **Nutritional Analysis**: Advanced nutritional analysis and recommendations
5. **Image Recognition**: OCR-based nutritional label reading

### Integration Opportunities
1. **Recipe Analysis**: Complete recipe nutritional analysis
2. **Diet Planning**: Nutritional goal tracking
3. **Allergy Detection**: Enhanced allergen identification
4. **Dietary Restrictions**: Support for various dietary needs

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review the test script output
3. Check OpenAI API status and rate limits
4. Verify environment variable configuration

## Conclusion

The new OpenAI-powered nutritional helper provides:
- ✅ **Real-time data** from current web sources
- ✅ **Structured outputs** with guaranteed schema compliance
- ✅ **Standard unit conversion** for consistent data
- ✅ **Enhanced error handling** with multiple fallbacks
- ✅ **Backward compatibility** with existing code
- ✅ **Cost-effective** operation with OpenAI's pricing

The migration maintains full backward compatibility while providing enhanced functionality and reliability.
