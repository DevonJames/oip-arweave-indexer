/**
 * Generate Elasticsearch mappings from OIP templates
 * This ensures field types defined in templates are respected in Elasticsearch
 */

const { elasticClient } = require('./elasticsearch');

/**
 * Map OIP field types to Elasticsearch types
 */
function mapOIPTypeToElasticsearchType(oipType) {
    const typeMap = {
        'string': { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 256 } } },
        'long': { type: 'long' },
        'uint64': { type: 'long' },
        'float': { type: 'float' },
        'bool': { type: 'boolean' },
        'enum': { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 256 } } },
        'dref': { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 256 } } },
        'repeated string': { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 256 } } },
        'repeated float': { type: 'float' },
        'repeated long': { type: 'long' },
        'repeated uint64': { type: 'long' },
        'repeated bool': { type: 'boolean' },
        'repeated dref': { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 256 } } }
    };

    return typeMap[oipType] || { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 256 } } };
}

/**
 * Generate Elasticsearch mapping properties from template fieldsInTemplate
 */
function generateMappingFromTemplate(templateName, fieldsInTemplate) {
    const properties = {};
    
    for (const [fieldName, fieldInfo] of Object.entries(fieldsInTemplate)) {
        // Skip index mappings and enum values
        if (fieldName.startsWith('index_') || fieldName.endsWith('Values')) {
            continue;
        }
        
        const fieldType = typeof fieldInfo === 'object' ? fieldInfo.type : fieldInfo;
        properties[fieldName] = mapOIPTypeToElasticsearchType(fieldType);
    }
    
    return properties;
}

/**
 * Update records index mapping for a specific template
 */
async function updateRecordsMappingForTemplate(templateName, fieldsInTemplate) {
    try {
        console.log(`📋 Generating Elasticsearch mapping for template: ${templateName}`);
        
        const properties = generateMappingFromTemplate(templateName, fieldsInTemplate);
        
        // Must preserve the nested type for data field when updating
        const mappingUpdate = {
            properties: {
                data: {
                    type: 'nested',  // Critical: must specify nested type when updating
                    properties: {
                        [templateName]: {
                            properties: properties
                        }
                    }
                }
            }
        };
        
        console.log(`🔧 Updating records mapping for ${templateName}:`, JSON.stringify(properties, null, 2));
        
        const response = await elasticClient.indices.putMapping({
            index: 'records',
            body: mappingUpdate
        });
        
        console.log(`✅ Mapping updated for template: ${templateName}`);
        return response;
        
    } catch (error) {
        console.error(`❌ Error updating mapping for template ${templateName}:`, error.message);
        throw error;
    }
}

/**
 * Update mappings for ALL templates in the system
 */
async function updateAllRecordsMappings() {
    try {
        console.log('🚀 Starting automatic mapping generation from templates...');
        
        // Get all templates from Elasticsearch
        const templatesResult = await elasticClient.search({
            index: 'templates',
            body: {
                size: 1000,
                query: { match_all: {} }
            }
        });
        
        // Handle both response formats (with and without .body wrapper)
        const templates = templatesResult.body?.hits?.hits || templatesResult.hits?.hits || [];
        console.log(`📚 Found ${templates.length} templates to process`);
        
        let successCount = 0;
        let skipCount = 0;
        
        for (const templateDoc of templates) {
            const template = templateDoc._source;
            const templateName = template.data?.template;
            const fieldsInTemplate = template.data?.fieldsInTemplate;
            
            if (!templateName || !fieldsInTemplate) {
                console.log(`⏭️  Skipping template (missing data):`, templateDoc._id);
                skipCount++;
                continue;
            }
            
            // Skip basic template (it's in every record)
            if (templateName === 'basic') {
                skipCount++;
                continue;
            }
            
            try {
                await updateRecordsMappingForTemplate(templateName, fieldsInTemplate);
                successCount++;
            } catch (error) {
                console.error(`Failed to update mapping for ${templateName}:`, error.message);
            }
        }
        
        console.log(`\n✅ Mapping generation complete!`);
        console.log(`   📊 Templates processed: ${templates.length}`);
        console.log(`   ✅ Mappings updated: ${successCount}`);
        console.log(`   ⏭️  Skipped: ${skipCount}`);
        
        // After updating mappings, reindex to apply them
        console.log('\n🔄 Reindexing records to apply new mappings...');
        const reindexResult = await elasticClient.updateByQuery({
            index: 'records',
            body: {
                query: { match_all: {} }
            },
            refresh: true,
            conflicts: 'proceed'
        });
        
        // Handle both response formats
        const reindexCount = reindexResult.body?.updated || reindexResult.updated || 0;
        console.log(`✅ Reindexed ${reindexCount} records`);
        
        return {
            templatesProcessed: templates.length,
            mappingsUpdated: successCount,
            skipped: skipCount,
            recordsReindexed: reindexCount
        };
        
    } catch (error) {
        console.error('❌ Error updating all mappings:', error);
        throw error;
    }
}

/**
 * Hook to update mapping when a new template is published
 */
async function updateMappingForNewTemplate(templateName, fieldsInTemplate) {
    try {
        await updateRecordsMappingForTemplate(templateName, fieldsInTemplate);
        console.log(`✅ Elasticsearch mapping auto-generated for new template: ${templateName}`);
    } catch (error) {
        console.warn(`⚠️  Could not auto-generate mapping for template ${templateName}:`, error.message);
        // Don't throw - template publishing should succeed even if mapping update fails
    }
}

/**
 * Update mapping for a single template by name (for testing/manual fixes)
 */
async function updateMappingForSingleTemplate(templateName, shouldReindex = false) {
    try {
        console.log(`🔍 Fetching template: ${templateName}`);
        
        // Search for the template by name
        const templateResult = await elasticClient.search({
            index: 'templates',
            body: {
                size: 1,
                query: {
                    term: {
                        'data.template.keyword': templateName
                    }
                }
            }
        });
        
        // Handle both response formats (with and without .body wrapper)
        const hits = templateResult.body?.hits?.hits || templateResult.hits?.hits || [];
        
        if (hits.length === 0) {
            throw new Error(`Template not found: ${templateName}`);
        }
        
        const template = hits[0]._source;
        const fieldsInTemplate = template.data?.fieldsInTemplate;
        
        if (!fieldsInTemplate) {
            throw new Error(`Template ${templateName} has no fieldsInTemplate`);
        }
        
        console.log(`📋 Found template with ${Object.keys(fieldsInTemplate).length} fields`);
        
        // Update the mapping
        await updateRecordsMappingForTemplate(templateName, fieldsInTemplate);
        
        let recordsReindexed = 0;
        
        // Optionally reindex only records using this template
        if (shouldReindex) {
            console.log(`\n🔄 Reindexing records of type ${templateName}...`);
            
            const reindexResult = await elasticClient.updateByQuery({
                index: 'records',
                body: {
                    query: {
                        term: {
                            'oip.recordType.keyword': templateName
                        }
                    }
                },
                refresh: true,
                conflicts: 'proceed'
            });
            
            // Handle both response formats
            recordsReindexed = reindexResult.body?.updated || reindexResult.updated || 0;
            console.log(`✅ Reindexed ${recordsReindexed} ${templateName} records`);
        }
        
        return {
            templateName,
            fieldsMapped: Object.keys(fieldsInTemplate).filter(k => !k.startsWith('index_') && !k.endsWith('Values')).length,
            recordsReindexed
        };
        
    } catch (error) {
        console.error(`❌ Error updating mapping for template ${templateName}:`, error.message);
        throw error;
    }
}

module.exports = {
    mapOIPTypeToElasticsearchType,
    generateMappingFromTemplate,
    updateRecordsMappingForTemplate,
    updateAllRecordsMappings,
    updateMappingForNewTemplate,
    updateMappingForSingleTemplate
};
