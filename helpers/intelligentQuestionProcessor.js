const { getRecords } = require('./elasticsearch');
const axios = require('axios');

class IntelligentQuestionProcessor {
    constructor() {
        this.ollamaBaseUrl = process.env.OLLAMA_HOST || 'http://ollama:11434';
        this.defaultModel = process.env.DEFAULT_LLM_MODEL || 'llama3.2:3b';
        this.maxRecordsForTagAnalysis = 50;
        this.maxTagsToAnalyze = 30;
    }

    /**
     * Process a user question intelligently, extracting search terms, applying filters,
     * and refining results using tag analysis
     */
    async processQuestion(question, options = {}) {
        console.log(`[IQP] Processing question: "${question}"`);
        
        try {
            // Step 1: Extract subject and modifiers from the question
            const { subject, modifiers, recordType } = this.extractSubjectAndModifiers(question);
            console.log(`[IQP] Extracted - Subject: "${subject}", Modifiers: [${modifiers.join(', ')}], RecordType: "${recordType}"`);
            
            // Step 2: Perform initial search
            const initialFilters = this.buildInitialFilters(subject, recordType, options);
            console.log(`[IQP] Initial search filters:`, initialFilters);
            
            const initialResults = await this.performSearch(initialFilters);
            console.log(`[IQP] Initial search found ${initialResults.records?.length || 0} records`);
            
            if (!initialResults.records || initialResults.records.length === 0) {
                return this.formatEmptyResult(question, initialFilters, "No records found for initial search");
            }
            
            if (initialResults.records.length === 1) {
                // Perfect match - proceed directly to content extraction
                console.log(`[IQP] Perfect match found, proceeding to content extraction`);
                return this.extractAndFormatContent(question, initialResults.records, initialFilters, modifiers);
            }
            
            // Step 3: If many results and we have modifiers, use tag summarization for refinement
            if (initialResults.records.length > 1 && modifiers.length > 0) {
                console.log(`[IQP] Multiple results (${initialResults.records.length}) with modifiers, attempting tag refinement`);
                
                const refinedResult = await this.refineSearchWithTags(question, subject, modifiers, recordType, options);
                if (refinedResult) {
                    console.log(`[IQP] ✅ Successfully refined from ${initialResults.records.length} to ${refinedResult.records.length} results`);
                    return refinedResult;
                }
            }
            
            // Step 4: If refinement didn't work or no modifiers, use initial results
            console.log(`[IQP] Using initial results (${initialResults.records.length} records)`);
            return this.extractAndFormatContent(question, initialResults.records, initialFilters, modifiers);
            
        } catch (error) {
            console.error(`[IQP] Error processing question:`, error);
            return this.formatErrorResult(question, error.message);
        }
    }

    /**
     * Extract subject and modifiers from a question using enhanced detection
     */
    extractSubjectAndModifiers(question) {
        const lowerQuestion = question.toLowerCase().trim();
        
        // Record type detection patterns
        const recordTypePatterns = {
            post: [
                /\b(post|article|news|story|report|blog|when|where|who|what happened|last time|audit|investigation)\b/i,
                /\b(fort knox|gold|government|federal|treasury|audit|security|storage)\b/i
            ],
            recipe: [
                /\b(recipe|cook|food|ingredient|meal|dish|kitchen|grilled|baked|fried|roasted)\b/i,
                /\b(greek|italian|mexican|indian|chinese|thai|mediterranean|spicy|healthy)\b/i
            ],
            workout: [
                /\b(workout|exercise|fitness|gym|training|beginner|intermediate|advanced)\b/i,
                /\b(chest|back|legs|arms|cardio|strength|muscle)\b/i
            ],
            video: [
                /\b(video|watch|film|movie|youtube|streaming|documentary)\b/i
            ]
        };

        // Determine record type
        let recordType = 'post'; // Default for news/information queries
        for (const [type, patterns] of Object.entries(recordTypePatterns)) {
            if (patterns.some(pattern => pattern.test(lowerQuestion))) {
                recordType = type;
                break;
            }
        }

        // Use the full question as the search term for better results
        // The searchMatchMode=OR will handle finding relevant records
        return {
            subject: question, // Use full question instead of parsed subject
            modifiers: [], // Disable modifier detection for now
            recordType: recordType
        };
    }

    /**
     * Parse question structure to identify subject and modifiers
     */
    parseQuestionStructure(question, recordType) {
        const lowerQuestion = question.toLowerCase();
        
        // Common question word patterns that we should strip from search terms
        const questionPrefixes = [
            /^(when is|when was|when did|when will)/,
            /^(where is|where was|where did|where can)/,
            /^(who is|who was|who did|who can)/,
            /^(what is|what was|what did|what can|what about)/,
            /^(how is|how was|how did|how can|how to|how do|how does|how long|how much|how many)/,
            /^(why is|why was|why did|why can)/,
            /^(which is|which was|which did)/,
            /^(tell me about|show me|find|search|get|give me)/
        ];

        // Remove question prefixes
        let cleanedQuestion = question;
        for (const prefix of questionPrefixes) {
            cleanedQuestion = cleanedQuestion.replace(prefix, '').trim();
        }

        // Special handling for audit-related questions
        if (lowerQuestion.includes('audit') || lowerQuestion.includes('last time')) {
            // For questions like "when is the last time the gold at fort knox was audited"
            const auditMatch = cleanedQuestion.match(/(?:the\s+)?(.+?)\s+(?:at|in|of)\s+(.+?)\s+(?:was|were|has been|have been)?\s*(?:audit|inspect|examin|check)/i);
            if (auditMatch) {
                const subject = `${auditMatch[2].trim()}`; // fort knox
                const modifiers = [auditMatch[1].trim()]; // gold
                return { subject, modifiers: modifiers.filter(m => m.length > 0) };
            }
            
            // Fallback for audit questions
            const words = this.extractMeaningfulWords(cleanedQuestion);
            const subject = this.findPrimarySubject(words);
            const modifiers = words.filter(word => word !== subject && word.length > 2);
            return { subject, modifiers };
        }

        // Recipe-specific parsing
        if (recordType === 'recipe') {
            return this.parseRecipeQuestion(cleanedQuestion);
        }

        // General parsing
        const words = this.extractMeaningfulWords(cleanedQuestion);
        const subject = this.findPrimarySubject(words);
        const modifiers = words.filter(word => word !== subject && word.length > 2);

        return { subject, modifiers };
    }

    /**
     * Parse recipe-specific questions for cooking methods and cuisines
     */
    parseRecipeQuestion(cleanedQuestion) {
        const cookingMethods = ['grilled', 'baked', 'fried', 'roasted', 'steamed', 'boiled', 'sautéed', 'braised'];
        const cuisines = ['greek', 'italian', 'mexican', 'indian', 'chinese', 'thai', 'mediterranean', 'french', 'spanish'];
        const characteristics = ['spicy', 'healthy', 'quick', 'easy', 'traditional', 'crispy', 'tender', 'creamy'];
        
        const words = this.extractMeaningfulWords(cleanedQuestion);
        const modifiers = [];
        
        // Find cooking methods, cuisines, and characteristics
        words.forEach(word => {
            if (cookingMethods.includes(word) || cuisines.includes(word) || characteristics.includes(word)) {
                modifiers.push(word);
            }
        });
        
        // Find the main ingredient (usually a noun)
        const commonIngredients = ['chicken', 'beef', 'pork', 'fish', 'salmon', 'shrimp', 'pasta', 'rice', 'vegetables'];
        let subject = commonIngredients.find(ingredient => words.includes(ingredient)) || 'recipe';
        
        // If no common ingredient found, look for recipe-related words
        if (subject === 'recipe') {
            const nonModifierWords = words.filter(word => !modifiers.includes(word) && !['recipe', 'cook', 'cooking'].includes(word));
            subject = nonModifierWords[0] || 'recipe';
        }
        
        return { subject, modifiers };
    }

    /**
     * Extract meaningful words from text, removing stop words and cleaning
     */
    extractMeaningfulWords(text) {
        const stopWords = new Set([
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
            'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
            'will', 'would', 'could', 'should', 'may', 'might', 'can', 'must', 'shall',
            'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
            'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'her', 'its', 'our', 'their',
            'need', 'needs', 'recipe', 'time', 'about', 'how', 'does'
        ]);

        return text.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(word => word.length > 1 && !stopWords.has(word));
    }

    /**
     * Find the primary subject from extracted words
     */
    findPrimarySubject(words) {
        // Look for compound terms first (like "fort knox")
        const compoundTerms = [
            'fort knox', 'federal reserve', 'social security', 'climate change',
            'artificial intelligence', 'machine learning', 'renewable energy'
        ];
        
        const joinedWords = words.join(' ');
        for (const term of compoundTerms) {
            if (joinedWords.includes(term)) {
                return term;
            }
        }
        
        // Return the first meaningful word as primary subject
        return words[0] || '';
    }

    /**
     * Build initial search filters from extracted components
     */
    buildInitialFilters(subject, recordType, options = {}) {
        const filters = {
            search: subject,
            recordType: recordType,
            searchMatchMode: 'OR', // Use OR mode to get maximum results for AI analysis
            resolveDepth: options.resolveDepth || 2,
            limit: options.limit || 20,
            sortBy: options.sortBy || 'matchCount:desc' // Use relevance sorting by default
        };

        // Add recipe-specific parameters for nutritional and timing information
        if (recordType === 'recipe') {
            filters.summarizeRecipe = true;
        }

        return filters;
    }

    /**
     * Perform search using OIP records API
     */
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

    /**
     * Refine search using tag analysis when there are multiple results and modifiers
     */
    async refineSearchWithTags(question, subject, modifiers, recordType, options = {}) {
        try {
            // Get tag summary for current results
            const tagSummaryFilters = {
                search: subject,
                recordType: recordType,
                summarizeTags: true,
                tagCount: this.maxTagsToAnalyze,
                limit: this.maxRecordsForTagAnalysis
            };
            
            console.log(`[IQP] Getting tag summary for refinement:`, tagSummaryFilters);
            const tagResults = await getRecords(tagSummaryFilters);
            
            if (!tagResults.tagSummary || tagResults.tagSummary.length === 0) {
                console.log(`[IQP] No tag summary available for refinement`);
                return null;
            }
            
            // Find matching tags for our modifiers
            const matchingTags = this.findMatchingTags(modifiers, tagResults.tagSummary);
            
            if (matchingTags.length === 0) {
                console.log(`[IQP] No matching tags found for modifiers: [${modifiers.join(', ')}]`);
                return null;
            }
            
            console.log(`[IQP] Found matching tags for refinement: [${matchingTags.join(', ')}]`);
            
            // Perform refined search with tags
            const refinedFilters = {
                search: subject,
                recordType: recordType,
                tags: matchingTags.join(','),
                tagsMatchMode: 'AND',
                resolveDepth: options.resolveDepth || 2,
                limit: options.limit || 10,
                sortBy: 'tags:desc'
            };
            
            const refinedResults = await this.performSearch(refinedFilters);
            
            if (refinedResults.records && refinedResults.records.length > 0) {
                const rationale = `Found ${tagResults.totalRecords} records containing '${subject}', then refined to ${refinedResults.records.length} specific records using tags: ${matchingTags.join(', ')}`;
                
                return this.extractAndFormatContent(
                    question, 
                    refinedResults.records, 
                    { ...refinedFilters, rationale }, 
                    modifiers
                );
            }
            
            return null;
            
        } catch (error) {
            console.error(`[IQP] Tag refinement error:`, error);
            return null;
        }
    }

    /**
     * Find tags that match our modifiers
     */
    findMatchingTags(modifiers, tagSummary) {
        const matchingTags = [];
        
        for (const modifier of modifiers) {
            const lowerModifier = modifier.toLowerCase();
            
            // Look for exact matches first
            const exactMatch = tagSummary.find(tagItem => 
                tagItem.tag.toLowerCase() === lowerModifier
            );
            
            if (exactMatch) {
                matchingTags.push(exactMatch.tag);
                continue;
            }
            
            // Look for partial matches
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

    /**
     * Extract content from records and format for RAG consumption
     */
    async extractAndFormatContent(question, records, appliedFilters, modifiers = []) {
        const contentItems = [];
        
        for (const record of records.slice(0, 5)) { // Limit to top 5 results
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
                
                // Extract full text for post records
                if (recordType === 'post') {
                    const fullTextUrl = this.extractFullTextUrl(record);
                    if (fullTextUrl) {
                        try {
                            const fullText = await this.fetchFullTextContent(fullTextUrl, content.title);
                            if (fullText) {
                                content.fullText = fullText.substring(0, 8000); // Limit to prevent overflow
                                console.log(`[IQP] Retrieved ${fullText.length} characters of full text for: ${content.title}`);
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
                
                // Include comprehensive recipe data for recipe records
                if (recordType === 'recipe') {
                    // Include timing information
                    content.prepTimeMinutes = specificData.prep_time_mins || specificData.prepTime || null;
                    content.cookTimeMinutes = specificData.cook_time_mins || specificData.cookTime || null;
                    content.totalTimeMinutes = specificData.total_time_mins || specificData.totalTime || null;
                    
                    // Include ingredients and instructions
                    content.ingredients = specificData.ingredients || [];
                    content.instructions = specificData.instructions || specificData.method || '';
                    
                    // Include nutritional information (from summarizeRecipe=true)
                    if (record.data.summaryNutritionalInfo) {
                        content.nutrition = record.data.summaryNutritionalInfo;
                        console.log(`[IQP] Included nutritional info for recipe: ${content.title}`);
                    }
                    if (record.data.summaryNutritionalInfoPerServing) {
                        content.nutritionPerServing = record.data.summaryNutritionalInfoPerServing;
                    }
                    
                    // Include serving information
                    content.servings = specificData.servings || specificData.serves || null;
                    content.difficulty = specificData.difficulty || null;
                    content.cuisine = specificData.cuisine || null;
                    
                    // Include full recipe data for comprehensive analysis
                    content.recipeData = specificData;
                    
                    console.log(`[IQP] Enhanced recipe data for: ${content.title} (prep: ${content.prepTimeMinutes}min, cook: ${content.cookTimeMinutes}min)`);
                }
                
                contentItems.push(content);
                
            } catch (error) {
                console.warn(`[IQP] Error processing record:`, error.message);
            }
        }
        
        // Generate response using RAG
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

    /**
     * Extract full text URL from post records
     */
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

    /**
     * Fetch full text content from URL with timeout and caching
     */
    async fetchFullTextContent(url, recordTitle = 'Unknown') {
        if (!url) return null;
        
        try {
            console.log(`[IQP] Fetching full text from: ${url}`);
            const response = await axios.get(url, { 
                timeout: 10000,
                maxContentLength: 500000
            });
            
            if (response.status === 200 && response.data) {
                const content = typeof response.data === 'string' ? response.data : String(response.data);
                console.log(`[IQP] Successfully fetched ${content.length} characters for: ${recordTitle}`);
                return content;
            }
        } catch (error) {
            console.warn(`[IQP] Failed to fetch full text from ${url}:`, error.message);
        }
        
        return null;
    }

    /**
     * Generate RAG response using LLM with structured context
     */
    async generateRAGResponse(question, contentItems, appliedFilters, modifiers) {
        try {
            // Build context from content items
            let context = '';
            contentItems.forEach((item, index) => {
                context += `\n--- Source ${index + 1}: ${item.title} ---\n`;
                if (item.description) context += `Description: ${item.description}\n`;
                if (item.fullText) context += `Full Content: ${item.fullText}\n`;
                if (item.articleText) context += `Article: ${item.articleText}\n`;
                
                // Include recipe-specific information
                if (item.type === 'recipe') {
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
                
                context += `Type: ${item.type}\n`;
            });

            const prompt = `You are answering a direct question using factual information. Provide a natural, conversational response without mentioning sources, context, or articles.

Information available:
${context}

Question: ${question}

Answer the question directly and naturally, as if you're having a conversation. Do not use phrases like "according to the context," "the article states," "based on the information," or similar references. Just state the facts conversationally.`;

            console.log(`[IQP] Generating RAG response for question: "${question}"`);
            
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
            
            console.log(`[IQP] Generated response (${answer.length} chars)`);
            
            return {
                answer: answer,
                model_used: this.defaultModel,
                context_length: context.length
            };
            
        } catch (error) {
            console.error(`[IQP] RAG generation error:`, error.message);
            
            // Fallback response
            const fallbackAnswer = contentItems.length > 0 
                ? `Based on the available records, I found ${contentItems.length} relevant sources about "${appliedFilters.search}". ${contentItems[0].description || contentItems[0].title}`
                : "I couldn't find sufficient information to answer your question.";
                
            return {
                answer: fallbackAnswer,
                model_used: 'fallback',
                context_length: 0
            };
        }
    }

    /**
     * Format empty result response
     */
    formatEmptyResult(question, appliedFilters, reason) {
        return {
            question: question,
            answer: `I couldn't find any relevant information about "${appliedFilters.search}". ${reason}`,
            sources: [],
            search_results: [],
            search_results_count: 0,
            applied_filters: appliedFilters,
            context_used: false,
            rationale: reason
        };
    }

    /**
     * Format error result response
     */
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
}

module.exports = new IntelligentQuestionProcessor(); 