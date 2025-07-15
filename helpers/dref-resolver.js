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

  const response = await fetch(`https://api.oip.onl/api/templates?didTx=did:arweave:${txId}`);
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
    if (subObj.basic && subObj.basic.name) {
      exactMatch['data.basic.name'] = subObj.basic.name;
    }
    // Add more fields if needed

    const results = await getRecords({ exactMatch: JSON.stringify(exactMatch), recordType: subTemplateName, limit: 1, sortBy: 'inArweaveBlock:desc' });
    if (results.records.length > 0) {
      return results.records[0].oip.didTx;
    } else {
      let enhancedObj = { ...subObj };
      if (subTemplateName === 'nutritionalInfo' && enhancedObj.basic && enhancedObj.basic.name) {
        const fetched = await fetchNutritionalData(enhancedObj.basic.name);
        enhancedObj.nutritionalInfo = { ...(enhancedObj.nutritionalInfo || {}), ...fetched.nutritionalInfo };
        if (fetched.image) enhancedObj.image = { ...enhancedObj.image, ...fetched.image };
        // Optionally merge basic fields if needed
        enhancedObj.basic = { ...enhancedObj.basic, ...fetched.basic };
      }
      const newRecord = await publishNewRecord(enhancedObj, subTemplateName, false, false, false, null, blockchain);
      return newRecord.recordToIndex.oip.didTx;
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