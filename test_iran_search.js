const ragService = require('./helpers/ragService');

async function testIranSearch() {
    console.log('🔍 Testing Iran Search Functionality');
    console.log('=====================================');
    
    try {
        // Test the RAG service directly
        console.log('\n=== Testing RAG Query for "Iran" ===');
        const ragResult = await ragService.query('Iran', {
            model: 'llama3.2:3b'
        });
        
        console.log(`✅ RAG Query completed`);
        console.log(`Answer: ${ragResult.answer?.substring(0, 200)}...`);
        console.log(`Context used: ${ragResult.context_used}`);
        console.log(`Search results count: ${ragResult.search_results_count}`);
        console.log(`Relevant types: ${ragResult.relevant_types?.join(', ')}`);
        console.log(`Sources: ${ragResult.sources?.length || 0}`);
        
        if (ragResult.sources && ragResult.sources.length > 0) {
            console.log('\nFound sources:');
            ragResult.sources.slice(0, 3).forEach((source, idx) => {
                console.log(`${idx + 1}. ${source.title} (${source.recordType})`);
            });
        }
        
        return ragResult;
        
    } catch (error) {
        console.error('❌ RAG query failed:', error.message);
        return null;
    }
}

async function testDirectElasticsearch() {
    console.log('\n=== Testing Direct Elasticsearch Query ===');
    
    try {
        const { getRecords } = require('./helpers/elasticsearch');
        
        const searchParams = {
            search: 'iran',
            recordType: 'post',
            sortBy: 'date:desc',
            resolveDepth: 3,
            summarizeTags: true,
            tagCount: 5,
            tagPage: 1,
            limit: 5,
            page: 1
        };
        
        console.log('Search params:', searchParams);
        
        const result = await getRecords(searchParams);
        
        console.log(`✅ Elasticsearch query completed`);
        console.log(`Total records: ${result.totalRecords}`);
        console.log(`Search results: ${result.searchResults}`);
        console.log(`Records returned: ${result.records?.length || 0}`);
        
        if (result.records && result.records.length > 0) {
            console.log('\nFound records:');
            result.records.slice(0, 3).forEach((record, idx) => {
                console.log(`${idx + 1}. ${record.data?.basic?.name} (${record.oip?.recordType})`);
                console.log(`   Tags: ${record.data?.basic?.tagItems?.slice(0, 5).join(', ')}`);
            });
        }
        
        return result;
        
    } catch (error) {
        console.error('❌ Elasticsearch query failed:', error.message);
        return null;
    }
}

async function testRecordTypeAnalysis() {
    console.log('\n=== Testing Record Type Analysis ===');
    
    try {
        // Create a temporary RAG service instance to test the analysis
        const ragServiceInstance = new ragService.constructor();
        const relevantTypes = ragServiceInstance.analyzeQuestionForRecordTypes('Iran');
        
        console.log('✅ Record type analysis completed');
        console.log('Relevant types for "Iran":');
        relevantTypes.forEach(type => {
            console.log(`- ${type.type}: score ${type.score}, priority ${type.priority}`);
        });
        
        return relevantTypes;
        
    } catch (error) {
        console.error('❌ Record type analysis failed:', error.message);
        return null;
    }
}

async function main() {
    console.log('🧪 Iran Search Debugging Tool\n');
    
    // Test 1: Record type analysis
    await testRecordTypeAnalysis();
    
    // Test 2: Direct Elasticsearch
    await testDirectElasticsearch();
    
    // Test 3: Full RAG pipeline
    await testIranSearch();
    
    console.log('\n=== Analysis Complete ===');
    console.log('If Iran records are not found:');
    console.log('1. Check if the records exist with the manual API call');
    console.log('2. Verify record type filtering in RAG service');
    console.log('3. Check if search terms are being passed correctly');
    console.log('4. Examine the elasticsearch search logic');
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { testIranSearch, testDirectElasticsearch, testRecordTypeAnalysis }; 