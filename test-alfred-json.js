#!/usr/bin/env node

/**
 * Test script for ALFRED JSON object functionality
 * This script demonstrates how to use ALFRED with JSON data instead of DID strings
 */

const alfred = require('./helpers/alfred');

async function testAlfredJsonFunctionality() {
    console.log('🧪 Testing ALFRED JSON object functionality...\n');
    
    // Test JSON data (simulating a documentation file)
    const testJsonData = {
        recordType: 'documentation',
        title: 'OIP Technical Overview',
        description: 'Comprehensive guide to the Open Index Protocol system',
        content: `
# OIP Technical Overview

## Introduction
The Open Index Protocol (OIP) is a comprehensive blockchain-based data storage and retrieval system.

## Key Features
- Template-based compression system
- Dual storage architecture (Arweave + GUN)
- AI integration with ALFRED
- Cross-node synchronization

## Templates
Templates define the structure and field types for data records.

## Records
Records are data instances that conform to templates.

## AI Integration
ALFRED provides natural language processing with RAG capabilities.
        `,
        fileName: 'OIP_TECHNICAL_OVERVIEW.md',
        timestamp: Date.now()
    };
    
    // Test questions about the JSON data
    const testQuestions = [
        'What is OIP?',
        'What are the key features of OIP?',
        'How does the template system work?',
        'What is ALFRED?',
        'Explain the dual storage architecture'
    ];
    
    console.log('📄 Test JSON Data:');
    console.log(`Title: ${testJsonData.title}`);
    console.log(`Description: ${testJsonData.description}`);
    console.log(`Content length: ${testJsonData.content.length} characters\n`);
    
    for (const question of testQuestions) {
        console.log(`❓ Question: ${question}`);
        
        try {
            const result = await alfred.query(question, {
                pinnedJsonData: testJsonData,
                model: 'gpt-4o-mini'
            });
            
            console.log(`✅ Answer: ${result.answer}`);
            console.log(`📊 Sources: ${result.search_results_count}`);
            console.log(`🔍 Applied Filters: ${JSON.stringify(result.applied_filters, null, 2)}`);
            console.log('---\n');
            
        } catch (error) {
            console.error(`❌ Error: ${error.message}\n`);
        }
    }
    
    console.log('🎉 Test completed!');
}

// Run the test
if (require.main === module) {
    testAlfredJsonFunctionality().catch(console.error);
}

module.exports = { testAlfredJsonFunctionality };
