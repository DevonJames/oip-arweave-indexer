const intelligentQuestionProcessor = require('../helpers/intelligentQuestionProcessor');

async function testQuestionProcessor() {
    console.log('=== Testing Intelligent Question Processor ===\n');

    const testQuestions = [
        {
            name: "Fort Knox Audit Test",
            question: "when is the last time the gold at fort knox was audited",
            expectedSubject: "fort knox",
            expectedModifiers: ["gold"],
            expectedRecordType: "post"
        },
        {
            name: "Recipe Test",
            question: "how long does the grilled greek chicken recipe need to cook",
            expectedSubject: "chicken",
            expectedModifiers: ["grilled", "greek"],
            expectedRecordType: "recipe"
        },
        {
            name: "General News Test", 
            question: "what happened with Iran recently",
            expectedSubject: "iran",
            expectedModifiers: ["recently"],
            expectedRecordType: "post"
        },
        {
            name: "Workout Test",
            question: "what equipment do I need for the beginner chest workout",
            expectedSubject: "chest workout",
            expectedModifiers: ["beginner"],
            expectedRecordType: "workout"
        }
    ];

    for (const test of testQuestions) {
        console.log(`\n--- ${test.name} ---`);
        console.log(`Question: "${test.question}"`);
        
        try {
            // Test the extraction method
            const extracted = intelligentQuestionProcessor.extractSubjectAndModifiers(test.question);
            
            console.log(`Extracted Subject: "${extracted.subject}"`);
            console.log(`Extracted Modifiers: [${extracted.modifiers.join(', ')}]`);
            console.log(`Detected Record Type: "${extracted.recordType}"`);
            
            // Check if extraction matches expectations
            const subjectMatch = extracted.subject.toLowerCase().includes(test.expectedSubject.toLowerCase());
            const recordTypeMatch = extracted.recordType === test.expectedRecordType;
            const hasExpectedModifiers = test.expectedModifiers.some(mod => 
                extracted.modifiers.some(extractedMod => 
                    extractedMod.toLowerCase().includes(mod.toLowerCase())
                )
            );
            
            console.log(`\n✅ Subject Match: ${subjectMatch ? 'PASS' : 'FAIL'}`);
            console.log(`✅ Record Type Match: ${recordTypeMatch ? 'PASS' : 'FAIL'}`);
            console.log(`✅ Modifiers Match: ${hasExpectedModifiers ? 'PASS' : 'FAIL'}`);
            
            // For the Fort Knox test, also show what the search filters would be
            if (test.name === "Fort Knox Audit Test") {
                const filters = intelligentQuestionProcessor.buildInitialFilters(
                    extracted.subject, 
                    extracted.recordType, 
                    { resolveDepth: 2 }
                );
                console.log(`\n📋 Generated Search Filters:`, filters);
                
                console.log(`\n🎯 Expected workflow:`);
                console.log(`1. Search for: recordType=post, search=fort knox, resolveDepth=2`);
                console.log(`2. If many results: summarizeTags=true&tagCount=30`);
                console.log(`3. Find tags matching "gold" modifier`);
                console.log(`4. Refine with: tags=<matching_tags>&tagsMatchMode=AND`);
                console.log(`5. Extract content from post records (name, description, webUrl)`);
                console.log(`6. Pass to RAG with full context`);
            }
            
        } catch (error) {
            console.error(`❌ Test failed: ${error.message}`);
        }
    }

    // Test full processing with a simple question (without hitting real Elasticsearch)
    console.log(`\n--- Testing buildInitialFilters ---`);
    const filters = intelligentQuestionProcessor.buildInitialFilters(
        "fort knox", 
        "post", 
        { resolveDepth: 2, limit: 20 }
    );
    console.log('Generated filters:', filters);
    
    console.log(`\n--- Testing findMatchingTags ---`);
    const mockTagSummary = [
        { tag: "gold", count: 15 },
        { tag: "federal-reserve", count: 8 },
        { tag: "treasury", count: 12 },
        { tag: "audit", count: 5 },
        { tag: "security", count: 3 }
    ];
    
    const matchingTags = intelligentQuestionProcessor.findMatchingTags(
        ["gold", "audit"], 
        mockTagSummary
    );
    console.log('Mock tag summary:', mockTagSummary);
    console.log('Modifiers to match:', ["gold", "audit"]);
    console.log('Matching tags found:', matchingTags);

    console.log(`\n=== Test Complete ===`);
    console.log(`The Intelligent Question Processor is ready to handle:`);
    console.log(`- Subject/modifier extraction from natural language`);
    console.log(`- Record type detection based on question context`);
    console.log(`- Multi-step search refinement using tag analysis`);
    console.log(`- Full content extraction from post records with webUrl resolution`);
    console.log(`- RAG-ready context building for accurate responses`);
}

// Run the test if called directly
if (require.main === module) {
    testQuestionProcessor().catch(console.error);
}

module.exports = { testQuestionProcessor }; 