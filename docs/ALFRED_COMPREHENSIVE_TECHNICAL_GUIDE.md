# ALFRED: Comprehensive Technical Guide

**Advanced Language-enabled Research and Forensics Engine for Data**

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Class Structure](#class-structure)
4. [Core Functionality](#core-functionality)
5. [Question Processing Pipeline](#question-processing-pipeline)
6. [RAG Integration](#rag-integration)
7. [Search Algorithms](#search-algorithms)
8. [Content Extraction](#content-extraction)
9. [Response Generation](#response-generation)
10. [Configuration & Settings](#configuration--settings)
11. [API Integration Points](#api-integration-points)
12. [Error Handling](#error-handling)
13. [Performance Optimizations](#performance-optimizations)
14. [Usage Examples](#usage-examples)
15. [Troubleshooting](#troubleshooting)

---

## Overview

ALFRED is a sophisticated AI assistant system designed to intelligently answer questions by leveraging OIP (Open Index Protocol) records. It combines advanced natural language processing, intelligent search strategies, and retrieval-augmented generation (RAG) to provide contextually accurate responses.

### Key Capabilities

- **Intelligent Question Analysis**: Parses user questions to extract subjects, modifiers, and determine appropriate record types
- **Context-Aware Search**: Uses advanced search strategies with tag refinement and filtering
- **Multi-Modal Content Handling**: Processes posts, recipes, exercises, videos, and other record types
- **RAG-Powered Responses**: Generates contextually relevant answers using retrieved content
- **Follow-up Detection**: Recognizes conversational follow-up questions to maintain context
- **TTS Integration**: Preprocesses text for optimal text-to-speech pronunciation
- **Fallback Mechanisms**: Provides helpful responses even when specific data isn't available

---

## Architecture

ALFRED follows a modular, pipeline-based architecture:

```
User Question → Question Analysis → Search Strategy → Content Retrieval → 
RAG Processing → Response Generation → TTS Preprocessing → Final Answer
```

### Core Components

1. **Question Processor**: Analyzes and categorizes user input
2. **Search Engine**: Executes intelligent searches across OIP records
3. **Content Extractor**: Retrieves and formats relevant content
4. **RAG Engine**: Generates contextual responses using LLMs
5. **Response Formatter**: Prepares final output for delivery

---

## Class Structure

### ALFRED Class

The main class is a singleton that encapsulates all functionality:

```javascript
class ALFRED {
    constructor() {
        // Configuration
        this.ollamaBaseUrl = process.env.OLLAMA_HOST || 'http://ollama:11434';
        this.defaultModel = process.env.DEFAULT_LLM_MODEL || 'llama3.2:3b';
        
        // Processing limits
        this.maxRecordsForTagAnalysis = 50;
        this.maxTagsToAnalyze = 30;
        this.maxContextLength = 8000;
        this.maxResults = 5;
        
        // Caching
        this.fullTextCache = new Map();
    }
}
```

### Key Properties

- **`ollamaBaseUrl`**: LLM service endpoint for response generation
- **`defaultModel`**: Default language model (LLaMA 3.2 3B)
- **`maxRecordsForTagAnalysis`**: Limit for tag summarization processing
- **`maxTagsToAnalyze`**: Maximum tags to consider for refinement
- **`maxContextLength`**: Character limit for RAG context
- **`maxResults`**: Maximum search results to process
- **`fullTextCache`**: In-memory cache for fetched article content

---

## Core Functionality

### 1. Text Preprocessing for TTS

```javascript
preprocessTextForTTS(text) {
    // Replace number-dash-number patterns with "number to number" for better TTS
    // Examples: "3-5" becomes "3 to 5", "8-10" becomes "8 to 10"
    return text.replace(/(\d+)-(\d+)/g, '$1 to $2');
}
```

**Purpose**: Improves text-to-speech pronunciation by converting numerical ranges to more natural speech patterns.

**Usage**: Applied to all text before sending to TTS engines (Chatterbox, eSpeak, ElevenLabs).

### 2. Follow-up Question Detection

```javascript
isFollowUpQuestion(question) {
    const lowerQuestion = question.toLowerCase().trim();
    
    // Pattern 1: Direct follow-up phrases
    const followUpPatterns = [
        /^(tell me more|give me more details|more info)/,
        /^(how many calories|what about calories)/,
        /^(how long|cook time|cooking time)/,
        // ... more patterns
    ];
    
    // Pattern 2: Pronouns referring to existing context
    const pronounPatterns = [
        /^(it|this|that|the recipe)/,
        /^(what does it|how does it)/,
        // ... more patterns
    ];
    
    // Pattern 3: Attribute-only queries
    // Pattern 4: Short questions with attributes
    
    return /* complex logic combining all patterns */;
}
```

**Key Features**:
- **Pattern-based Detection**: Uses regex patterns to identify follow-up indicators
- **Context Awareness**: Recognizes pronouns and attribute-only questions
- **Conversational Flow**: Maintains context across question sequences
- **False Positive Prevention**: Sophisticated patterns avoid misclassification

### 3. Question Processing Pipeline

The main processing method orchestrates the entire workflow:

```javascript
async processQuestion(question, options = {}) {
    // Step 0: Check for follow-up questions
    if (existingContext && existingContext.length === 1) {
        const isFollowUp = this.isFollowUpQuestion(question);
        if (isFollowUp) {
            // Use existing context directly
            return this.extractAndFormatContent(question, existingContext, ...);
        }
    }
    
    // Step 1: Extract subject and modifiers
    const { subject, modifiers, recordType } = this.extractSubjectAndModifiers(question);
    
    // Step 2: Perform initial search
    const initialFilters = this.buildInitialFilters(subject, recordType, options);
    const initialResults = await this.performSearch(initialFilters);
    
    // Step 3: Refine with tags if needed
    if (initialResults.records.length > 1) {
        const refinedResult = await this.refineSearchWithTags(...);
        if (refinedResult) return refinedResult;
    }
    
    // Step 4: Extract and format content
    return this.extractAndFormatContent(question, initialResults.records, ...);
}
```

---

## Question Processing Pipeline

### Step 1: Subject and Modifier Extraction

#### Record Type Detection

ALFRED uses sophisticated pattern matching to determine the appropriate record type:

```javascript
extractSubjectAndModifiers(question) {
    const recordTypePatterns = {
        post: [
            /\b(post|article|news|story|report|when|where|who|audit|investigation)\b/i,
            /\b(fort knox|gold|government|federal|treasury)\b/i
        ],
        recipe: [
            /\b(recipe|cook|food|ingredient|meal|dish|grilled|baked)\b/i,
            /\b(greek|italian|mexican|indian|chinese|spicy|healthy)\b/i
        ],
        workout: [
            /\b(workout|exercise|fitness|gym|training|muscle)\b/i
        ],
        video: [
            /\b(video|watch|film|movie|youtube|streaming)\b/i
        ]
    };
    
    // Determine record type based on patterns
    let recordType = 'post'; // Default for news/information queries
    for (const [type, patterns] of Object.entries(recordTypePatterns)) {
        if (patterns.some(pattern => pattern.test(lowerQuestion))) {
            recordType = type;
            break;
        }
    }
    
    // Apply type-specific processing
    if (recordType === 'recipe') {
        return this.parseQuestionStructure(question, recordType);
    } else {
        // For posts, use full question for broader context
        return { subject: question, modifiers: [], recordType };
    }
}
```

#### Recipe-Specific Parsing

For recipe questions, ALFRED performs detailed parsing to extract cooking methods, cuisines, and ingredients:

```javascript
parseRecipeQuestion(cleanedQuestion) {
    const cookingMethods = ['grilled', 'baked', 'fried', 'roasted', 'steamed', ...];
    const cuisines = ['greek', 'italian', 'mexican', 'indian', 'chinese', ...];
    const characteristics = ['spicy', 'healthy', 'quick', 'easy', 'traditional', ...];
    
    const words = this.extractMeaningfulWords(cleanedQuestion);
    const foundModifiers = [];
    
    // Find cooking methods, cuisines, and characteristics
    words.forEach(word => {
        if (cookingMethods.includes(word) || cuisines.includes(word) || characteristics.includes(word)) {
            foundModifiers.push(word);
        }
    });
    
    // Find main ingredient
    const commonIngredients = ['chicken', 'beef', 'pork', 'fish', 'salmon', ...];
    const foundIngredient = commonIngredients.find(ingredient => words.includes(ingredient));
    
    // Combine for precise subject
    let subject;
    if (foundIngredient && foundModifiers.length > 0) {
        subject = `${foundModifiers[0]} ${foundIngredient}`; // e.g., "grilled chicken"
    } else if (foundIngredient) {
        subject = foundIngredient;
    } else if (foundModifiers.length > 0) {
        subject = foundModifiers[0];
    } else {
        subject = words.find(word => !['recipe', 'cook', 'cooking'].includes(word)) || 'recipe';
    }
    
    return { subject, modifiers: foundModifiers.filter(mod => !subject.includes(mod)) };
}
```

### Step 2: Search Filter Construction

#### Initial Filter Building

```javascript
buildInitialFilters(subject, recordType, options = {}) {
    const filters = {
        search: subject,
        recordType: recordType,
        resolveDepth: options.resolveDepth || 2,
        limit: options.limit || 20,
        sortBy: options.sortBy || 'matchCount:desc' // Relevance-based sorting
    };

    // Recipe-specific settings for precise search
    if (recordType === 'recipe') {
        filters.searchMatchMode = 'AND'; // Precise matching
        filters.summarizeRecipe = true;  // Get nutritional info
    } else {
        filters.searchMatchMode = 'OR';  // Broader matching for posts/news
    }

    return filters;
}
```

#### Search Match Modes

- **AND Mode** (Recipes): All search terms must match - provides precise results
- **OR Mode** (Posts/News): Any search term can match - provides broader coverage

### Step 3: Tag-Based Refinement

When multiple results are found, ALFRED uses intelligent tag analysis to refine results:

```javascript
async refineSearchWithTags(question, subject, modifiers, recordType, options = {}) {
    // Get tag summary for current results
    const tagSummaryFilters = {
        search: subject,
        recordType: recordType,
        summarizeTags: true,
        tagCount: recordType === 'recipe' ? 10 : this.maxTagsToAnalyze,
        limit: this.maxRecordsForTagAnalysis
    };
    
    // Get available tags
    const tagResults = await getRecords(tagSummaryFilters);
    
    // Find matching tags for modifiers
    const matchingTags = this.findMatchingTags(modifiers, tagResults.tagSummary);
    
    if (matchingTags.length === 0) {
        return null; // No refinement possible
    }
    
    // Perform refined search with tags
    const refinedFilters = {
        search: subject,
        recordType: recordType,
        tags: matchingTags.join(','),
        tagsMatchMode: 'AND',
        sortBy: 'matchCount:desc'
    };
    
    const refinedResults = await this.performSearch(refinedFilters);
    
    if (refinedResults.records && refinedResults.records.length > 0) {
        return this.extractAndFormatContent(question, refinedResults.records, refinedFilters, modifiers);
    }
    
    return null;
}
```

#### Tag Matching Algorithm

```javascript
findMatchingTags(modifiers, tagSummary) {
    const matchingTags = [];
    
    for (const modifier of modifiers) {
        const lowerModifier = modifier.toLowerCase();
        
        // Exact matches first
        const exactMatch = tagSummary.find(tagItem => 
            tagItem.tag.toLowerCase() === lowerModifier
        );
        
        if (exactMatch) {
            matchingTags.push(exactMatch.tag);
            continue;
        }
        
        // Partial matches
        const partialMatch = tagSummary.find(tagItem => 
            tagItem.tag.toLowerCase().includes(lowerModifier) || 
            lowerModifier.includes(tagItem.tag.toLowerCase())
        );
        
        if (partialMatch) {
            matchingTags.push(partialMatch.tag);
        }
    }
    
    return matchingTags;
}
```

---

## RAG Integration

### Main RAG Query Function

The `query()` method serves as the main entry point for RAG functionality:

```javascript
async query(question, options = {}) {
    const { include_filter_analysis = false, searchParams = {} } = options;
    
    // Check if we should use Intelligent Question Processor
    const shouldUseIQP = include_filter_analysis && 
        (!searchParams.recordType && !searchParams.tags && !searchParams.creatorHandle);
    
    if (shouldUseIQP) {
        // Use advanced IQP processing
        const iqpResult = await this.processQuestion(question, {
            resolveDepth: searchParams.resolveDepth || 2,
            limit: searchParams.limit || 20,
            existingContext: options.existingContext || null
        });
        
        // Convert IQP result to RAG format
        return {
            answer: iqpResult.answer,
            sources: this.formatSources(iqpResult.search_results),
            context_used: iqpResult.context_used,
            model: options.model || this.defaultModel,
            search_results_count: iqpResult.search_results_count,
            search_results: iqpResult.search_results,
            applied_filters: iqpResult.applied_filters,
            extracted_subject: iqpResult.extracted_subject,
            extracted_keywords: iqpResult.extracted_keywords,
            rationale: iqpResult.rationale
        };
    } else {
        // Use legacy RAG processing
        return this.legacyRAGProcessing(question, options);
    }
}
```

### Record Type Analysis for RAG

```javascript
analyzeQuestionForRecordTypes(question) {
    const lowerQuestion = question.toLowerCase();
    const relevantTypes = [];
    
    // Define keywords for each record type
    const typeKeywords = {
        recipe: ['recipe', 'cook', 'food', 'ingredient', 'meal', 'nutrition', 'cooking', 'bake'],
        exercise: ['exercise', 'workout', 'fitness', 'gym', 'muscle', 'training', 'cardio'],
        post: [
            // News and current events
            'news', 'article', 'politics', 'election', 'government', 'policy',
            'latest', 'today', 'recent', 'breaking', 'report', 'analysis',
            // Countries and regions
            'iran', 'china', 'russia', 'ukraine', 'israel', 'palestine',
            // Political and economic terms
            'president', 'congress', 'economy', 'market', 'climate', 'war',
            // Military and international relations
            'nuclear', 'military', 'defense', 'security', 'nato', 'weapons'
        ],
        podcast: ['podcast', 'audio', 'interview', 'conversation', 'episode'],
        jfkFilesDocument: ['jfk', 'kennedy', 'assassination', 'classified', 'cia', 'fbi'],
        image: ['photo', 'picture', 'image', 'visual', 'gallery', 'photography'],
        video: ['video', 'watch', 'film', 'movie', 'youtube', 'streaming', 'documentary']
    };
    
    // Score each record type based on keyword matches
    for (const [recordType, keywords] of Object.entries(typeKeywords)) {
        if (!isRecordTypeEnabled(recordType)) continue;
        
        const matchScore = keywords.reduce((score, keyword) => {
            return score + (lowerQuestion.includes(keyword) ? 1 : 0);
        }, 0);
        
        if (matchScore > 0) {
            const config = recordTypesForRAG[recordType];
            relevantTypes.push({
                type: recordType,
                score: matchScore,
                priority: config.priority,
                description: config.description
            });
        }
    }
    
    // Intelligent fallback for general queries
    if (relevantTypes.length === 0) {
        const newsKeywords = ['latest', 'news', 'current', 'today', 'recent', 'politics'];
        const isNewsQuery = newsKeywords.some(keyword => lowerQuestion.includes(keyword));
        
        if (isNewsQuery && isRecordTypeEnabled('post')) {
            return [{ type: 'post', score: 1, priority: 5, description: 'News and current events' }];
        }
        
        // Use top 2 highest priority types for general queries
        const highPriorityTypes = getRecordTypesByPriority().slice(0, 2);
        return highPriorityTypes.map(item => ({
            type: item.type,
            score: 0,
            priority: item.config.priority,
            description: item.config.description
        }));
    }
    
    // Sort by match score first, then by priority
    relevantTypes.sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        return b.priority - a.priority;
    });
    
    return relevantTypes;
}
```

---

## Search Algorithms

### Elasticsearch Integration

```javascript
async searchElasticsearch(question, options = {}) {
    const searchParams = {
        search: question,
        limit: this.maxResults * 2,
        page: 1,
        resolveDepth: 3,
        summarizeTags: true,
        tagCount: 5,
        tagPage: 1,
        includeSigs: false,
        includePubKeys: false,
        sortBy: 'date:desc',
        ...options.searchParams
    };

    console.log(`[RAG] Searching Elasticsearch with params:`, searchParams);
    
    const results = await getRecords(searchParams);
    
    // Filter results by enabled record types
    const filteredRecords = this.filterRecordsByType(results.records || []);
    
    // Search additional sources if relevant
    const additionalResults = await this.searchAdditionalSources(question, options);
    
    return {
        records: filteredRecords,
        totalResults: filteredRecords.length,
        templates: additionalResults.templates || [],
        creators: additionalResults.creators || []
    };
}
```

### Record Type Filtering and Prioritization

```javascript
filterRecordsByType(records) {
    const enabledTypes = getEnabledRecordTypes();
    const priorityOrder = getRecordTypesByPriority();
    
    // Filter by enabled types
    const filteredRecords = records.filter(record => {
        const recordType = record.oip?.recordType;
        return recordType && isRecordTypeEnabled(recordType);
    });
    
    // Sort by priority and date
    filteredRecords.sort((a, b) => {
        const typeA = a.oip?.recordType;
        const typeB = b.oip?.recordType;
        
        const priorityA = priorityOrder.find(p => p.type === typeA)?.config.priority || 0;
        const priorityB = priorityOrder.find(p => p.type === typeB)?.config.priority || 0;
        
        // Priority first (higher first)
        if (priorityA !== priorityB) {
            return priorityB - priorityA;
        }
        
        // Date second (newer first)
        const dateA = new Date(a.data?.basic?.dateCreated || 0);
        const dateB = new Date(b.data?.basic?.dateCreated || 0);
        return dateB - dateA;
    });
    
    return filteredRecords.slice(0, this.maxResults);
}
```

### Tag Summarization Search

```javascript
async searchWithTagSummarization(question, relevantTypes, options = {}) {
    const allResults = [];
    
    // Extract subject and modifiers
    const { subject, modifiers, recordType } = this.extractSubjectAndModifiers(question);
    const searchKeywords = subject || question;
    
    // Search top relevant types
    let searchTypes = relevantTypes.slice(0, 2);
    
    for (const typeInfo of searchTypes) {
        try {
            console.log(`[RAG] 🔍 Searching ${typeInfo.type} records for: "${searchKeywords}"`);
            
            const searchParams = {
                search: searchKeywords,
                recordType: typeInfo.type,
                sortBy: 'date:desc',
                resolveDepth: 3,
                summarizeTags: true,
                tagCount: 15,
                tagPage: 1,
                limit: this.maxResults * 2,
                page: 1,
                includeSigs: false,
                includePubKeys: false
            };
            
            const initialResults = await getRecords(searchParams);
            
            if (initialResults && initialResults.records && initialResults.records.length > 0) {
                const records = initialResults.records.slice(0, this.maxResults);
                
                records.forEach(record => {
                    record.ragTypeInfo = typeInfo;
                });
                
                allResults.push(...records);
                
                // Stop if we got good results
                if (records.length > 0) {
                    console.log(`[RAG] 🎯 Good results found, stopping search`);
                    break;
                }
            }
        } catch (error) {
            console.error(`[RAG] 💥 Error searching ${typeInfo.type}:`, error.message);
        }
    }
    
    // Remove duplicates and limit results
    const uniqueResults = [];
    const seenIds = new Set();
    
    for (const record of allResults) {
        const id = record.oip?.didTx;
        if (id && !seenIds.has(id)) {
            seenIds.add(id);
            uniqueResults.push(record);
            if (uniqueResults.length >= this.maxResults) break;
        }
    }
    
    return {
        records: uniqueResults,
        searchMetadata: {
            originalKeywords: searchKeywords,
            extractedModifiers: modifiers
        }
    };
}
```

---

## Content Extraction

### Multi-Modal Content Processing

ALFRED handles different types of content with specialized processing:

```javascript
async extractAndFormatContent(question, records, appliedFilters, modifiers = []) {
    const contentItems = [];
    
    for (const record of records.slice(0, 5)) {
        try {
            const basicData = record.data?.basic || {};
            const recordType = record.oip?.recordType || 'unknown';
            const specificData = record.data?.[recordType] || {};
            
            let content = {
                title: basicData.name || 'Untitled',
                description: basicData.description || '',
                type: recordType,
                did: record.oip?.didTx || ''
            };
            
            // Record type-specific processing
            await this.processRecordTypeSpecificContent(content, record, recordType, specificData);
            
            contentItems.push(content);
            
        } catch (error) {
            console.warn(`[IQP] Error processing record:`, error.message);
        }
    }
    
    // Generate RAG response
    const ragResponse = await this.generateRAGResponse(question, contentItems, appliedFilters, modifiers);
    
    return {
        question: question,
        answer: ragResponse.answer,
        sources: contentItems,
        search_results: records,
        search_results_count: records.length,
        applied_filters: appliedFilters,
        extracted_subject: appliedFilters.search,
        extracted_keywords: modifiers,
        context_used: true,
        rationale: appliedFilters.rationale || `Found ${records.length} relevant records`
    };
}
```

### Post Content Processing

For news articles and posts, ALFRED attempts to fetch full-text content:

```javascript
// Extract full text for post records
if (recordType === 'post') {
    const fullTextUrl = this.extractFullTextUrl(record);
    if (fullTextUrl) {
        try {
            const fullText = await this.fetchFullTextContent(fullTextUrl, content.title);
            if (fullText) {
                content.fullText = fullText.substring(0, 8000);
                console.log(`[IQP] Retrieved ${fullText.length} characters for: ${content.title}`);
            }
        } catch (error) {
            console.warn(`[IQP] Failed to fetch full text:`, error.message);
        }
    }
    
    // Include article text from post data
    if (specificData.articleText) {
        content.articleText = specificData.articleText;
    }
}
```

#### Full Text URL Extraction

```javascript
extractFullTextUrl(record) {
    if (!record || !record.data) return null;
    
    const recordType = record.oip?.recordType;
    if (recordType !== 'post') return null;
    
    const specificData = record.data[recordType] || {};
    
    // Check multiple possible locations for text URL
    if (specificData.articleText?.data?.text?.webUrl) {
        return specificData.articleText.data.text.webUrl;
    }
    if (specificData.articleText?.webUrl) {
        return specificData.articleText.webUrl;
    }
    if (record.data.text?.webUrl) {
        return record.data.text.webUrl;
    }
    
    return null;
}
```

#### Full Text Fetching with Caching

```javascript
async fetchFullTextContent(url, recordTitle = 'Unknown') {
    if (!url) return null;
    
    // Check cache first
    if (this.fullTextCache.has(url)) {
        console.log(`[RAG] Using cached full text for: ${recordTitle}`);
        return this.fullTextCache.get(url);
    }
    
    try {
        console.log(`[RAG] Fetching full text from: ${url}`);
        const response = await axios.get(url, { 
            timeout: 10000,
            maxContentLength: 500000
        });
        
        if (response.status === 200 && response.data) {
            const content = typeof response.data === 'string' ? response.data : String(response.data);
            
            // Cache management (limit to 50 entries)
            if (this.fullTextCache.size > 50) {
                const firstKey = this.fullTextCache.keys().next().value;
                this.fullTextCache.delete(firstKey);
            }
            this.fullTextCache.set(url, content);
            
            console.log(`[RAG] Successfully fetched ${content.length} characters for: ${recordTitle}`);
            return content;
        }
    } catch (error) {
        console.warn(`[RAG] Failed to fetch full text from ${url}:`, error.message);
    }
    
    return null;
}
```

### Recipe Content Processing

For recipe records, ALFRED extracts comprehensive cooking information:

```javascript
// Include comprehensive recipe data
if (recordType === 'recipe') {
    // Timing information
    content.prepTimeMinutes = specificData.prep_time_mins || specificData.prepTime || null;
    content.cookTimeMinutes = specificData.cook_time_mins || specificData.cookTime || null;
    content.totalTimeMinutes = specificData.total_time_mins || specificData.totalTime || null;
    
    // Ingredients and instructions
    content.ingredients = specificData.ingredients || [];
    content.instructions = specificData.instructions || specificData.method || '';
    
    // Nutritional information (from summarizeRecipe=true)
    if (record.data.summaryNutritionalInfo) {
        content.nutrition = record.data.summaryNutritionalInfo;
        console.log(`[IQP] Included nutritional info for recipe: ${content.title}`);
    }
    if (record.data.summaryNutritionalInfoPerServing) {
        content.nutritionPerServing = record.data.summaryNutritionalInfoPerServing;
    }
    
    // Serving and preparation details
    content.servings = specificData.servings || specificData.serves || null;
    content.difficulty = specificData.difficulty || null;
    content.cuisine = specificData.cuisine || null;
    
    // Full recipe data for comprehensive analysis
    content.recipeData = specificData;
    
    console.log(`[IQP] Enhanced recipe data for: ${content.title} (prep: ${content.prepTimeMinutes}min, cook: ${content.cookTimeMinutes}min)`);
}
```

---

## Response Generation

### RAG Response Generation

The core of ALFRED's intelligence lies in its RAG response generation:

```javascript
async generateRAGResponse(question, contentItems, appliedFilters, modifiers) {
    let context = '';
    
    try {
        // Build comprehensive context from content items
        contentItems.forEach((item, index) => {
            context += `\n--- Source ${index + 1}: ${item.title} ---\n`;
            if (item.description) context += `Description: ${item.description}\n`;
            if (item.fullText) context += `Full Content: ${item.fullText}\n`;
            if (item.articleText) context += `Article: ${item.articleText}\n`;
            
            // Recipe-specific context building
            if (item.type === 'recipe') {
                this.addRecipeContextToRAG(context, item);
            }
            
            context += `Type: ${item.type}\n`;
        });

        // Generate enhanced prompt for conversational responses
        const prompt = `You are answering a direct question. You have some specific information available, but if it doesn't contain what's needed to answer the question, be honest about that and then provide a helpful answer from your general knowledge.

Information available:
${context}

Question: ${question}

Instructions:
1. First, check if the information above contains what's needed to answer the question
2. If YES: Answer directly using that information (don't mention "the information" or "context")
3. If NO: Start with "I don't see that specific information in the records I found, but I can tell you that..." then provide a helpful answer from your general knowledge

Be conversational and natural. Do not use phrases like "according to the context" or "the article states."`;

        console.log(`[IQP] Generating RAG response for question: "${question}"`);
        
        // Call LLM for response generation
        const response = await axios.post(`${this.ollamaBaseUrl}/api/generate`, {
            model: this.defaultModel,
            prompt: prompt,
            stream: false,
            options: {
                temperature: 0.3,
                top_p: 0.9,
                max_tokens: 512
            }
        }, {
            timeout: 30000
        });

        const answer = response.data?.response?.trim() || "I couldn't generate a response based on the available information.";
        
        return {
            answer: answer,
            model_used: this.defaultModel,
            context_length: context.length
        };
        
    } catch (error) {
        console.error(`[IQP] RAG generation error:`, error.message);
        return this.generateFallbackResponse(question, contentItems, context);
    }
}
```

### Recipe Context Integration

```javascript
addRecipeContextToRAG(context, item) {
    if (item.prepTimeMinutes) context += `Prep Time: ${item.prepTimeMinutes} minutes\n`;
    if (item.cookTimeMinutes) context += `Cook Time: ${item.cookTimeMinutes} minutes\n`;
    if (item.totalTimeMinutes) context += `Total Time: ${item.totalTimeMinutes} minutes\n`;
    if (item.servings) context += `Servings: ${item.servings}\n`;
    if (item.difficulty) context += `Difficulty: ${item.difficulty}\n`;
    if (item.cuisine) context += `Cuisine: ${item.cuisine}\n`;
    
    if (item.ingredients && item.ingredients.length > 0) {
        context += `Ingredients: ${JSON.stringify(item.ingredients)}\n`;
    }
    if (item.instructions) context += `Instructions: ${item.instructions}\n`;
    
    if (item.nutrition) {
        context += `Nutritional Info (Total): Calories: ${item.nutrition.calories || 'N/A'}, Protein: ${item.nutrition.proteinG || 'N/A'}g, Fat: ${item.nutrition.fatG || 'N/A'}g, Carbs: ${item.nutrition.carbohydratesG || 'N/A'}g\n`;
    }
    if (item.nutritionPerServing) {
        context += `Nutritional Info (Per Serving): Calories: ${item.nutritionPerServing.calories || 'N/A'}, Protein: ${item.nutritionPerServing.proteinG || 'N/A'}g, Fat: ${item.nutritionPerServing.fatG || 'N/A'}g, Carbs: ${item.nutritionPerServing.carbohydratesG || 'N/A'}g\n`;
    }
}
```

### Fallback Response Generation

When the primary LLM fails, ALFRED provides intelligent fallbacks:

```javascript
generateFallbackResponse(question, contentItems, context) {
    let fallbackAnswer;
    
    if (contentItems.length === 0) {
        fallbackAnswer = "I couldn't find sufficient information to answer your question, but feel free to ask me anyway - I might be able to help with general knowledge.";
    } else {
        const item = contentItems[0];
        const lowerQuestion = question.toLowerCase();
        
        if (item.type === 'recipe') {
            // Recipe-specific fallback answers
            if (lowerQuestion.includes('cook') && lowerQuestion.includes('time') && item.cookTimeMinutes) {
                fallbackAnswer = `This ${item.title} takes ${item.cookTimeMinutes} minutes to cook.`;
            } else if (lowerQuestion.includes('prep') && lowerQuestion.includes('time') && item.prepTimeMinutes) {
                fallbackAnswer = `The prep time for ${item.title} is ${item.prepTimeMinutes} minutes.`;
            } else if (lowerQuestion.includes('servings') && item.servings) {
                fallbackAnswer = `${item.title} serves ${item.servings} people.`;
            } else if (lowerQuestion.includes('calories') && item.nutrition?.calories) {
                fallbackAnswer = `${item.title} has ${item.nutrition.calories} calories total.`;
            } else if (lowerQuestion.includes('ingredients') && item.ingredients?.length > 0) {
                fallbackAnswer = `The main ingredients for ${item.title} include: ${item.ingredients.slice(0, 5).join(', ')}.`;
            } else {
                fallbackAnswer = `I found information about ${item.title}: ${item.description || 'A recipe from the database.'}`;
            }
        } else {
            // General fallback for other record types
            fallbackAnswer = `I found information about ${item.title}: ${item.description || item.title}`;
        }
    }
        
    return {
        answer: fallbackAnswer,
        model_used: 'fallback',
        context_length: context.length
    };
}
```

### Empty Result Handling

When no records are found, ALFRED generates helpful responses using the LLM:

```javascript
async formatEmptyResult(question, appliedFilters, reason) {
    try {
        const fallbackPrompt = `I couldn't find any specific records about "${appliedFilters.search}" in the database, but I can still help answer your question using my general knowledge.

Question: ${question}

Please provide a helpful, conversational answer starting with "I didn't find any specific records about that, but I can tell you that..." and then give useful information from your training data. Be natural and conversational.`;

        console.log(`[IQP] No records found, generating fallback response for: "${question}"`);
        
        const response = await axios.post(`${this.ollamaBaseUrl}/api/generate`, {
            model: this.defaultModel,
            prompt: fallbackPrompt,
            stream: false,
            options: {
                temperature: 0.5,
                top_p: 0.9,
                max_tokens: 512
            }
        }, {
            timeout: 30000
        });

        const answer = response.data?.response?.trim() || `I didn't find any specific records about "${appliedFilters.search}", but feel free to ask me about it anyway - I might be able to help with general information.`;
        
        return {
            question: question,
            answer: answer,
            sources: [],
            search_results: [],
            search_results_count: 0,
            applied_filters: appliedFilters,
            context_used: false,
            rationale: `${reason} - Provided general knowledge fallback`
        };
        
    } catch (error) {
        console.error(`[IQP] Fallback response generation error:`, error.message);
        
        return {
            question: question,
            answer: `I didn't find any specific records about "${appliedFilters.search}", but feel free to ask me about it anyway - I might be able to help with general information.`,
            sources: [],
            search_results: [],
            search_results_count: 0,
            applied_filters: appliedFilters,
            context_used: false,
            rationale: `${reason} - Used static fallback due to LLM error`
        };
    }
}
```

---

## Configuration & Settings

### Environment Variables

ALFRED uses several environment variables for configuration:

```javascript
constructor() {
    this.ollamaBaseUrl = process.env.OLLAMA_HOST || 'http://ollama:11434';
    this.defaultModel = process.env.DEFAULT_LLM_MODEL || 'llama3.2:3b';
    
    // Processing limits
    this.maxRecordsForTagAnalysis = 50;
    this.maxTagsToAnalyze = 30;
    this.maxContextLength = 8000;
    this.maxResults = 5;
    
    // Caching
    this.fullTextCache = new Map();
}
```

### Key Configuration Options

- **`OLLAMA_HOST`**: LLM service endpoint
- **`DEFAULT_LLM_MODEL`**: Default language model to use
- **`maxRecordsForTagAnalysis`**: Limit for tag processing
- **`maxTagsToAnalyze`**: Maximum tags to consider
- **`maxContextLength`**: Character limit for RAG context
- **`maxResults`**: Maximum search results to process

### Record Type Configuration

ALFRED integrates with the record types configuration system:

```javascript
const { 
    getEnabledRecordTypes, 
    getRecordTypesByPriority, 
    isRecordTypeEnabled, 
    getContextFields,
    recordTypesForRAG
} = require('../config/recordTypesForRAG');
```

This allows for:
- **Dynamic record type enabling/disabling**
- **Priority-based sorting**
- **Context field configuration per record type**
- **RAG-specific settings per record type**

---

## API Integration Points

### Main Entry Points

#### 1. Voice Chat Integration (`routes/voice.js`)

```javascript
// Voice chat endpoint
ragResponse = await alfred.query(inputText, ragOptions);
responseText = ragResponse.answer;

// TTS preprocessing
let processedText = alfred.preprocessTextForTTS(responseText);
```

#### 2. API Testing (`routes/api.js`)

```javascript
const ragResponse = await alfred.query(question, {
    model: 'llama3.2:3b',
    searchParams: { limit: 3 }
});
```

#### 3. Podcast Generation (`helpers/podcast-generator.js`)

```javascript
const extractedUrl = alfred.extractFullTextUrl(record);
const fetchedContent = await alfred.fetchFullTextContent(contentUrl, article.title);
```

### Integration Parameters

#### Standard Query Options

```javascript
{
    include_filter_analysis: true,    // Enable IQP processing
    model: 'llama3.2:3b',            // LLM model to use
    searchParams: {                   // Elasticsearch parameters
        resolveDepth: 2,
        limit: 20,
        recordType: 'post',
        tags: 'tag1,tag2',
        searchMatchMode: 'OR'
    },
    existingContext: [...],           // Previous search results for follow-up
    useFieldExtraction: true          // Enable structured field extraction
}
```

#### Response Format

```javascript
{
    answer: "Generated response text",
    sources: [...],                   // Formatted source information
    context_used: true,               // Whether context was available
    model: "llama3.2:3b",            // Model used for generation
    search_results_count: 5,          // Number of records found
    search_results: [...],            // Full record objects
    applied_filters: {...},           // Filters used in search
    extracted_subject: "fort knox",   // Extracted search subject
    extracted_keywords: [...],        // Extracted modifiers
    rationale: "Found 5 relevant records matching 'fort knox'"
}
```

---

## Error Handling

### Comprehensive Error Management

ALFRED implements multiple layers of error handling:

#### 1. Search Errors

```javascript
async performSearch(filters) {
    try {
        console.log(`[IQP] Performing search with filters:`, filters);
        const results = await getRecords(filters);
        
        return {
            records: results.records || [],
            totalRecords: results.searchResults || 0,
            message: results.message
        };
    } catch (error) {
        console.error(`[IQP] Search error:`, error);
        throw new Error(`Search failed: ${error.message}`);
    }
}
```

#### 2. Content Fetching Errors

```javascript
async fetchFullTextContent(url, recordTitle = 'Unknown') {
    try {
        const response = await axios.get(url, { 
            timeout: 10000,
            maxContentLength: 500000
        });
        // ... success handling
    } catch (error) {
        console.warn(`[RAG] Failed to fetch full text from ${url}:`, error.message);
        return null; // Graceful degradation
    }
}
```

#### 3. LLM Generation Errors

```javascript
try {
    const response = await axios.post(`${this.ollamaBaseUrl}/api/generate`, {
        model: this.defaultModel,
        prompt: prompt,
        // ... other options
    });
    return response.data?.response?.trim() || "I couldn't generate a response.";
} catch (error) {
    console.error('[RAG] Error calling Ollama:', error);
    
    if (context.length > 0) {
        return this.extractDirectAnswer(question, context);
    } else {
        return "I don't have specific information about this in my knowledge base.";
    }
}
```

#### 4. Pipeline Error Handling

```javascript
async processQuestion(question, options = {}) {
    try {
        // Main processing pipeline
        // ...
    } catch (error) {
        console.error(`[IQP] Error processing question:`, error);
        return this.formatErrorResult(question, error.message);
    }
}

formatErrorResult(question, errorMessage) {
    return {
        question: question,
        answer: `I encountered an error while processing your question: ${errorMessage}`,
        sources: [],
        search_results: [],
        search_results_count: 0,
        applied_filters: {},
        context_used: false,
        error: errorMessage
    };
}
```

### Error Recovery Strategies

1. **Graceful Degradation**: When full-text fetching fails, fall back to descriptions
2. **Alternative Responses**: When LLM fails, use structured fallbacks
3. **Search Fallbacks**: When IQP fails, use legacy RAG processing
4. **Context Preservation**: Maintain error context for debugging

---

## Performance Optimizations

### 1. Caching Strategy

#### Full-Text Content Caching

```javascript
constructor() {
    this.fullTextCache = new Map(); // In-memory cache
}

async fetchFullTextContent(url, recordTitle = 'Unknown') {
    // Check cache first
    if (this.fullTextCache.has(url)) {
        console.log(`[RAG] Using cached full text for: ${recordTitle}`);
        return this.fullTextCache.get(url);
    }
    
    // ... fetch and cache
    
    // Cache management (LRU-style)
    if (this.fullTextCache.size > 50) {
        const firstKey = this.fullTextCache.keys().next().value;
        this.fullTextCache.delete(firstKey);
    }
    this.fullTextCache.set(url, content);
}
```

### 2. Search Optimization

#### Early Termination

```javascript
// Stop search when good results are found
if (records.length > 0) {
    console.log(`[RAG] 🎯 Good results found, stopping search`);
    break;
}
```

#### Result Limiting

```javascript
// Limit processing to top results
for (const record of records.slice(0, 5)) {
    // Process only top 5 records
}
```

#### Deduplication

```javascript
// Remove duplicate records efficiently
const uniqueResults = [];
const seenIds = new Set();

for (const record of allResults) {
    const id = record.oip?.didTx;
    if (id && !seenIds.has(id)) {
        seenIds.add(id);
        uniqueResults.push(record);
        if (uniqueResults.length >= this.maxResults) break;
    }
}
```

### 3. Context Management

#### Content Length Limiting

```javascript
// Limit full text content
if (fullText) {
    content.fullText = fullText.substring(0, 8000); // Prevent overflow
}

// Limit context length
if (currentLength + recordContext.length < this.maxContextLength) {
    contextParts.push(recordContext);
    currentLength += recordContext.length;
} else {
    break; // Stop adding context
}
```

#### Smart Context Building

```javascript
// Prioritize timing-related instructions for recipes
const sentences = instructionText.split(/[.!?]+/);
const timingSentences = sentences.filter(sentence => 
    /\d+\s*(?:minutes?|mins?|hours?|hrs?|seconds?|secs?)/i.test(sentence)
);

if (timingSentences.length > 0) {
    // Include timing-related instructions first
    const relevantInstructions = timingSentences.slice(0, 2).join('. ').trim();
    parts.push(`Instructions (timing): ${relevantInstructions}`);
}
```

---

## Usage Examples

### 1. Basic Question Processing

```javascript
const alfred = require('./helpers/alfred');

// Simple question
const result = await alfred.processQuestion("When was the last time the gold at Fort Knox was audited?");

console.log(result.answer);
// "The last time anyone got a glimpse of the gold was during a staged audit in 1974..."
```

### 2. Recipe Queries

```javascript
// Recipe question with automatic type detection
const result = await alfred.processQuestion("How long does it take to cook grilled chicken?");

console.log(result.applied_filters);
// { recordType: 'recipe', search: 'grilled chicken', searchMatchMode: 'AND', summarizeRecipe: true }

console.log(result.answer);
// "According to the Grilled Chicken recipe, it needs to cook for 25 minutes."
```

### 3. Follow-up Question Handling

```javascript
// Initial question
const initialResult = await alfred.processQuestion("Show me a grilled chicken recipe");

// Follow-up question with existing context
const followupResult = await alfred.processQuestion("How many calories?", {
    existingContext: initialResult.search_results
});

console.log(followupResult.answer);
// "This Grilled Chicken recipe has 320 calories total."
```

### 4. RAG Query Integration

```javascript
// Using the main RAG query method
const ragResult = await alfred.query("What's the latest news about Iran?", {
    include_filter_analysis: true,
    model: 'llama3.2:3b',
    searchParams: { limit: 5 }
});

console.log(ragResult);
// {
//   answer: "Based on recent reports...",
//   sources: [...],
//   search_results_count: 3,
//   applied_filters: { recordType: 'post', search: 'iran', searchMatchMode: 'OR' }
// }
```

### 5. Voice Integration

```javascript
const alfred = require('./helpers/alfred');

// Process voice input
const ragResponse = await alfred.query(userSpeechText, {
    include_filter_analysis: true,
    existingContext: previousSearchResults
});

// Preprocess for TTS
const processedText = alfred.preprocessTextForTTS(ragResponse.answer);
// "Cook for 3 to 5 minutes" instead of "Cook for 3-5 minutes"
```

### 6. Content Extraction

```javascript
// Extract full text from post records
const fullTextUrl = alfred.extractFullTextUrl(postRecord);
if (fullTextUrl) {
    const content = await alfred.fetchFullTextContent(fullTextUrl, "Article Title");
    console.log(`Fetched ${content.length} characters`);
}
```

---

## Troubleshooting

### Common Issues and Solutions

#### 1. No Search Results

**Problem**: ALFRED returns empty results for valid queries.

**Diagnosis**:
```javascript
console.log(result.applied_filters);
console.log(result.rationale);
```

**Solutions**:
- Check if record type is enabled in `recordTypesForRAG`
- Verify search terms are not too restrictive
- Check `searchMatchMode` (use 'OR' for broader results)
- Ensure Elasticsearch is running and accessible

#### 2. LLM Connection Errors

**Problem**: "Error calling Ollama" messages.

**Diagnosis**:
```javascript
console.log(process.env.OLLAMA_HOST);
console.log(this.defaultModel);
```

**Solutions**:
- Verify Ollama service is running
- Check `OLLAMA_HOST` environment variable
- Ensure model is available: `ollama list`
- Check network connectivity

#### 3. Poor Response Quality

**Problem**: ALFRED gives generic or incorrect answers.

**Diagnosis**:
```javascript
console.log(result.context_used);
console.log(result.search_results_count);
console.log(result.sources);
```

**Solutions**:
- Increase search result limit
- Check if relevant records exist in database
- Verify record type detection is working
- Review tag refinement process

#### 4. Follow-up Detection Issues

**Problem**: Follow-up questions trigger new searches instead of using context.

**Diagnosis**:
```javascript
console.log(alfred.isFollowUpQuestion("your question"));
console.log(existingContext.length);
```

**Solutions**:
- Ensure `existingContext` is passed correctly
- Check if question matches follow-up patterns
- Verify context has exactly one record for follow-up detection

#### 5. Memory Issues

**Problem**: High memory usage or cache overflow.

**Diagnosis**:
```javascript
console.log(alfred.fullTextCache.size);
console.log(process.memoryUsage());
```

**Solutions**:
- Reduce `maxContextLength`
- Lower `maxResults` setting
- Clear cache periodically: `alfred.fullTextCache.clear()`
- Implement more aggressive cache eviction

### Debug Logging

Enable detailed logging by checking console output:

```javascript
// Key debug points
console.log(`[IQP] Processing question: "${question}"`);
console.log(`[IQP] Extracted - Subject: "${subject}", Modifiers: [${modifiers.join(', ')}]`);
console.log(`[IQP] Initial search found ${results.length} records`);
console.log(`[RAG] Using Intelligent Question Processor for enhanced analysis`);
```

### Performance Monitoring

Monitor key metrics:

```javascript
// Response time
const startTime = Date.now();
const result = await alfred.processQuestion(question);
const processingTime = Date.now() - startTime;
console.log(`Processing took ${processingTime}ms`);

// Memory usage
const memUsage = process.memoryUsage();
console.log(`Memory: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);

// Cache efficiency
const cacheHitRate = alfred.fullTextCache.size > 0 ? 
    (cacheHits / (cacheHits + cacheMisses)) * 100 : 0;
console.log(`Cache hit rate: ${cacheHitRate.toFixed(1)}%`);
```

---

## Conclusion

ALFRED represents a sophisticated integration of natural language processing, intelligent search, and retrieval-augmented generation. Its modular architecture allows for:

- **Flexible Question Processing**: Handles various query types with specialized algorithms
- **Intelligent Search Strategies**: Uses context-aware filtering and refinement
- **Multi-Modal Content Support**: Processes different record types appropriately  
- **Robust Error Handling**: Provides graceful degradation and fallback responses
- **Performance Optimization**: Implements caching and resource management
- **Extensible Design**: Easy to add new record types and processing strategies

The system successfully bridges the gap between raw data storage and intelligent, conversational AI assistance, making complex information retrieval accessible through natural language queries.

For implementation details, refer to the source code in `helpers/alfred.js` and the related configuration files. For integration examples, see the usage in `routes/voice.js`, `routes/api.js`, and other system components. 