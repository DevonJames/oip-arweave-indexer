const fetch = require('node-fetch');
const { getRecords } = require('./elasticsearch');
const { publishNewRecord } = require('./templateHelper');
const { defaultTemplates } = require('../config/templates.config');
const { fetchNutritionalData } = require('./nutritional-helper');
// Default template TxIds - move to config if needed
// const defaultTemplates = {
//   nutritionalInfo: 'SOME_TXID',
//   exercise: 'yxguXXKD_YSnCjC1ILYFBmQ6F20F5dKOoA6hxuqhNUk'
//   // Add more as needed
// };

async function fetchTemplate(templateName) {
  // First, get TxId from default or API if needed
  const txId = defaultTemplates[templateName];
  if (!txId) throw new Error(`No default TxId for ${templateName}`);

  const apiBase = require('./urlHelper').getBaseUrl();
  const response = await fetch(`${apiBase}/api/templates?didTx=did:arweave:${txId}`);
  const data = await response.json();
  if (data.templates && data.templates[0]) {
    return data.templates[0].data.fieldsInTemplate;
  }
  throw new Error(`Template ${templateName} not found`);
}

async function resolveDrefsInRecord(recordJson, templateName, fieldToSubTemplate = {}, blockchain = 'arweave') {
  const fields = await fetchTemplate(templateName);

  async function processSubObject(subObj, subTemplateName) {
    // Build exactMatch from subObj, focusing on basic.name
    const exactMatch = {};
    
    // Handle nested dref structure like {exercise: {basic: {name: "..."}}}
    let basicName = null;
    let recordData = null;
    
    if (subObj[subTemplateName]) {
      // This is the expected nested structure: {exercise: {basic: {name: "..."}}}
      recordData = subObj[subTemplateName];
      if (recordData.basic && recordData.basic.name) {
        basicName = recordData.basic.name;
      }
    } else if (subObj.basic && subObj.basic.name) {
      // Fallback: flat structure {basic: {name: "..."}}
      recordData = subObj;
      basicName = subObj.basic.name;
    }
    
    if (basicName) {
      exactMatch['data.basic.name'] = basicName;
    }
    
    console.log(`Processing subObject for ${subTemplateName}:`, JSON.stringify(subObj, null, 2));
    console.log(`Extracted recordData:`, JSON.stringify(recordData, null, 2));
    console.log(`Built exactMatch:`, exactMatch);
    
    const results = await getRecords({ exactMatch: JSON.stringify(exactMatch), recordType: subTemplateName, limit: 1, sortBy: 'inArweaveBlock:desc' });
    if (results.records.length > 0) {
      console.log(`Found existing record for ${basicName}:`, results.records[0].oip.didTx);
      return results.records[0].oip.didTx;
    } else {
      console.log(`No existing record found for ${basicName}, creating new one`);
      
      // Use the extracted recordData for publishing
      let enhancedObj = { ...recordData };
      
      // Ensure we have proper basic structure
      if (!enhancedObj.basic) {
        enhancedObj.basic = {};
      }
      if (basicName) {
        enhancedObj.basic.name = basicName;
      }
      
      // Add nutritional data enhancement if needed
      if (subTemplateName === 'nutritionalInfo' && basicName) {
        const fetched = await fetchNutritionalData(basicName);
        enhancedObj.nutritionalInfo = { ...(enhancedObj.nutritionalInfo || {}), ...fetched.nutritionalInfo };
        if (fetched.image) enhancedObj.image = { ...enhancedObj.image, ...fetched.image };
        enhancedObj.basic = { ...enhancedObj.basic, ...fetched.basic };
      }
      
      console.log(`Publishing new ${subTemplateName} record:`, JSON.stringify(enhancedObj, null, 2));
      const newRecord = await publishNewRecord(enhancedObj, subTemplateName, false, false, false, null, blockchain);
      console.log(`Created new record:`, newRecord.recordToIndex.oip.did);
      return newRecord.recordToIndex.oip.did;
    }
  }

  for (const section in recordJson) {
    const props = recordJson[section];
    for (const key in props) {
      const fieldType = fields[key]?.type;
      const subTemplate = fieldToSubTemplate[key] || key;

      if (fieldType === 'dref') {
        if (typeof props[key] === 'object' && props[key] !== null && !(typeof props[key] === 'string' && props[key].startsWith('did:'))) {
          props[key] = await processSubObject(props[key], subTemplate);
        }
      } else if (fieldType === 'repeated dref') {
        if (Array.isArray(props[key])) {
          props[key] = await Promise.all(props[key].map(async (item) => {
            if (typeof item === 'object' && item !== null && !(typeof item === 'string' && item.startsWith('did:'))) {
              return await processSubObject(item, subTemplate);
            }
            return item;
          }));
        }
      }
    }
  }
  return recordJson;
}

module.exports = { resolveDrefsInRecord }; 