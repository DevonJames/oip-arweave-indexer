const alfred = require('../helpers/alfred');

// Use ALFRED instance for testing
const alfredInstance = alfred;

function testKeywordExtraction() {
    console.log('🧪 Testing Keyword Extraction\n');

    const testQuestions = [
        "What is the latest news on Iran?",
        "Tell me about Iran's nuclear program",
        "What's happening with Biden and Iran?",
        "Any updates on the Iran nuclear deal?",
        "What are the latest developments in Iran?",
        "How is the economy doing?",
        "What's the weather like?",
        "Tell me about Trump's policies on Iran"
    ];

    testQuestions.forEach(question => {
        console.log(`Question: "${question}"`);
        const keywords = alfredInstance.extractSearchKeywords(question);
        console.log(`Keywords: "${keywords}"`);
        console.log('---');
    });
}

if (require.main === module) {
    testKeywordExtraction();
}

module.exports = { testKeywordExtraction }; 