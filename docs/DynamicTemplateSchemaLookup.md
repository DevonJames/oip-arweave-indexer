# Dynamic Template Schema Lookup System

## Overview

The OIP Arweave system uses a dynamic template schema lookup system that allows the node to identify available templates and dynamically retrieve their field definitions (names, types, enum values) from the blockchain. This enables flexible record creation and validation without hardcoding template structures.

## Architecture Components

### 1. Template Configuration (`config/templates.config.js`)

This file defines the default templates that the node recognizes and their corresponding Arweave transaction IDs:

```javascript
module.exports = {
    defaultTemplates: {
        basic: "-9DirnjVO1FlbEW1lN8jITBESrTsQKEM_BoZ1ey_0mk",
        post: "op6y-d_6bqivJ2a2oWQnbylD4X_LH6eQyR6rCGqtVZ8",
        recipe: "SLsJ91-Z82rRBPkDrZlG87aIpbw6zOlmK96nh5uf6G4",
        exercise: "XVu78TY-4LX6-vOajc7AKAk9jn1amFSC87XMTGTz4Mw",
        // ... other templates
    }
}
```

**Purpose**: Maps template names to their blockchain transaction IDs for quick lookup.

### 2. Template Retrieval Functions (`helpers/elasticsearch.js`)

#### `getTemplatesInDB()`

```javascript
const getTemplatesInDB = async () => {
    const searchResponse = await elasticClient.search({
        index: 'templates',
        body: {
            query: { match_all: {} },
            size: 1000
        }
    });
    
    const templatesInDB = searchResponse.hits.hits.map(hit => hit._source);
    const qtyTemplatesInDB = templatesInDB.length;
    
    // Calculate max block height for syncing
    const confirmedTemplates = templatesInDB.filter(template => 
        template.oip.recordStatus !== "pending confirmation in Arweave"
    );
    const finalMaxArweaveBlock = Math.max(...confirmedTemplates.map(template => 
        template.oip.inArweaveBlock
    )) || 0;
    
    return { qtyTemplatesInDB, finalMaxArweaveBlock, templatesInDB };
};
```

**Purpose**: Retrieves all templates from the Elasticsearch index, used for bulk operations and API responses.

#### `searchTemplateByTxId(templateTxid)`

```javascript
async function searchTemplateByTxId(templateTxid) {
    const searchResponse = await elasticClient.search({
        index: 'templates',
        body: {
            query: { match: { "data.TxId": templateTxid } }
        }
    });
    
    if (searchResponse.hits.hits.length === 0) {
        console.log(`Template not found in database for TxId: ${templateTxid}`);
        return null;
    }
    
    return searchResponse.hits.hits[0]._source;
}
```

**Purpose**: Finds a specific template by its transaction ID, used during record creation and validation.

### 3. Template Name Resolution (`helpers/utils.js`)

#### `getTemplateTxidByName(templateName)`

```javascript
const getTemplateTxidByName = (templateName) => {
    const templateConfigTxid = templatesConfig.defaultTemplates[templateName];
    return templateConfigTxid ? templateConfigTxid : null;
};
```

**Purpose**: Converts human-readable template names (like "post", "recipe") to blockchain transaction IDs.

### 4. Field Schema Processing (`routes/templates.js`)

The `/api/templates` endpoint processes template data to extract field information:

```javascript
templates.forEach(template => {
    // Parse the raw fields JSON from blockchain data
    const fields = JSON.parse(template.data.fields);
    
    // Build structured field information
    const fieldsInTemplate = Object.keys(fields).reduce((acc, key) => {
        if (key.startsWith('index_')) {
            const fieldName = key.replace('index_', '');
            acc[fieldName] = {
                type: fields[fieldName],
                index: fields[key]
            };
            
            // Handle enum fields - look for enumValues
            if (fields[fieldName] === 'enum') {
                const enumValuesKey = `${fieldName}Values`;
                if (fields[enumValuesKey]) {
                    acc[fieldName].enumValues = fields[enumValuesKey];
                } else if (template.data[enumValuesKey]) {
                    acc[fieldName].enumValues = template.data[enumValuesKey];
                }
            }
        }
        return acc;
    }, {});
    
    // Add processed field info to template
    template.data.fieldsInTemplate = fieldsInTemplate;
    
    // Create array format for easier iteration
    const fieldsInTemplateArray = Object.keys(fieldsInTemplate).map(key => {
        const fieldInfo = {
            name: key,
            type: fieldsInTemplate[key].type,
            index: fieldsInTemplate[key].index
        };
        
        if (fieldsInTemplate[key].enumValues) {
            fieldInfo.enumValues = fieldsInTemplate[key].enumValues;
        }
        
        return fieldInfo;
    });
    
    template.data.fieldsInTemplateCount = fieldsInTemplateArray.length;
});
```

### 5. Record Translation (`helpers/templateHelper.js`)

#### `translateJSONtoOIPData(record, recordType)`

This function converts user-friendly JSON data to blockchain-compatible format using template schemas:

```javascript
const translateJSONtoOIPData = async (record, recordType) => {
    const { qtyTemplatesInDB } = await getTemplatesInDB();
    
    if (qtyTemplatesInDB === 0) {
        // Fallback to hardcoded translation
        return hardcodedTranslation(record);
    }
    
    const convertedTemplates = [];
    for (let i = 0; i < templates.length; i++) {
        const template = templates[i];
        const templateName = templateNames[i];
        const templateTxid = getTemplateTxidByName(templateName);
        
        const templateSchema = await searchTemplateByTxId(templateTxid);
        if (templateSchema !== null) {
            // Process fields based on template schema
            let fields = parseTemplateFields(templateSchema);
            
            const converted = {};
            for (const key in json) {
                const indexKey = `index_${key}`;
                const fieldType = fields[key];
                const fieldValuesKey = `${key}Values`;
                
                if (fields[indexKey] !== undefined) {
                    // Handle different field types (enum, string, number, etc.)
                    if (fieldType === 'enum' && fields[fieldValuesKey]) {
                        const enumValues = fields[fieldValuesKey];
                        const enumIndex = enumValues.indexOf(json[key]);
                        converted[fields[indexKey]] = enumIndex !== -1 ? enumIndex : json[key];
                    } else {
                        converted[fields[indexKey]] = json[key];
                    }
                }
            }
            
            converted.t = templateTxid;
            convertedTemplates.push(converted);
        }
    }
    
    return convertedTemplates;
};
```

## Template Field Structure

### Raw Blockchain Format

Templates stored on Arweave contain field definitions in this format:

```json
{
  "post": {
    "title": "string",
    "index_title": 0,
    "description": "string", 
    "index_description": 1,
    "category": "enum",
    "index_category": 2,
    "categoryValues": ["news", "opinion", "analysis", "feature"],
    "webUrl": "string",
    "index_webUrl": 3
  }
}
```

### Processed API Format

The `/api/templates` endpoint transforms this into:

```json
{
  "data": {
    "fieldsInTemplate": {
      "title": {
        "type": "string",
        "index": 0
      },
      "description": {
        "type": "string", 
        "index": 1
      },
      "category": {
        "type": "enum",
        "index": 2,
        "enumValues": ["news", "opinion", "analysis", "feature"]
      },
      "webUrl": {
        "type": "string",
        "index": 3
      }
    },
    "fieldsInTemplateCount": 4
  }
}
```

## Usage Flow

### 1. Template Discovery

1. Node starts up and calls `getTemplatesInDB()` to load all available templates
2. Templates are cached in Elasticsearch with their field schemas parsed
3. API endpoints can query templates by name or transaction ID

### 2. Record Creation

1. User submits record data with template name (e.g., "post")
2. `getTemplateTxidByName()` converts name to transaction ID
3. `searchTemplateByTxId()` retrieves full template schema
4. `translateJSONtoOIPData()` converts user data to blockchain format using schema
5. Record is published to blockchain with proper field indexing

### 3. Record Display

1. Frontend calls `/api/templates` to get all template schemas
2. Field information is used to dynamically render form fields
3. Enum values populate dropdown menus
4. Field types determine validation rules
5. Records are displayed with proper field labels and formatting

## Key Features

### Dynamic Field Types

- **string**: Text fields
- **number**: Numeric fields  
- **enum**: Dropdown selections with predefined values
- **dref**: References to other records (DIDs)
- **array**: Lists of values or references

### Enum Value Handling

Enum fields store both the possible values and the user's selection:
- `categoryValues`: `["news", "opinion", "analysis"]` 
- User selects "news" → stored as index `0` on blockchain
- Display converts index back to "news" for user interface

### Backward Compatibility

The system handles both old and new template field structures:
- **New format**: `fields` as JSON string
- **Old format**: `fieldsInTemplate` as flat object
- **Legacy format**: Nested field objects with type/index properties

## Error Handling

- **Missing templates**: Falls back to hardcoded translation
- **Invalid field types**: Logs warnings and continues processing
- **Missing enum values**: Uses raw value if enum index lookup fails
- **Template not found**: Returns null and logs error message

## Performance Considerations

- Templates are cached in Elasticsearch for fast retrieval
- Field parsing happens once during template processing
- Bulk operations use `getTemplatesInDB()` to minimize database queries
- Individual lookups use `searchTemplateByTxId()` for specific needs

This dynamic system allows the OIP network to evolve its data structures without requiring code changes, making it highly flexible and future-proof.