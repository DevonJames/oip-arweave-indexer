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
     * Detect if a question is a follow-up question about existing context
     * rather than a new search query
     */
    isFollowUpQuestion(question) {
        const lowerQuestion = question.toLowerCase().trim();
        
        // Pattern 1: Direct follow-up phrases (be specific to avoid false positives)
        const followUpPatterns = [
            /^(tell me more|give me more details|more info|more information|what else|anything else)/,
            /^(how many calories|what about calories|calories|nutrition|nutritional info)/,
            /^(how long|cook time|cooking time|prep time|preparation time)(?!\s+(to|does|for).*(make|cook|prepare|recipe))/,
            /^(ingredients|what ingredients)(?!\s+(for|to|in).*(recipe|dish))/,
            /^(servings|how many servings|serves how many)/,
            /^(can you|could you|would you|will you).+(tell|give|show|explain)(?!\s+me.*(recipe|how to))/,
            /^(what about|how about)(?!\s+(making|cooking|recipe))/,
            /^(what's the|what is the)\s+(time|calories|nutrition|servings|difficulty)/
        ];
        
        if (followUpPatterns.some(pattern => pattern.test(lowerQuestion))) {
            console.log(`[IQP] 🎯 Follow-up detected by pattern: "${lowerQuestion}"`);
            return true;
        }
        
        // Pattern 2: Questions starting with pronouns (referring to existing context)
        const pronounPatterns = [
            /^(it|this|that|the recipe|the dish|the food)/,
            /^(what does it|how does it|when does it|where does it)/,
            /^(what is it|what's it|how is it|how's it)/
        ];
        
        if (pronounPatterns.some(pattern => pattern.test(lowerQuestion))) {
            console.log(`[IQP] 🎯 Follow-up detected by pronoun: "${lowerQuestion}"`);
            return true;
        }
        
        // Pattern 3: Questions with no meaningful subject (just attributes)
        const words = this.extractMeaningfulWords(lowerQuestion);
        const questionWords = ['what', 'how', 'when', 'where', 'why', 'which', 'who'];
        const attributeWords = ['calories', 'time', 'ingredients', 'servings', 'nutrition', 'cook', 'prep', 'difficulty'];
        
        // If question is mostly question words + attribute words, it's likely a follow-up
        const nonQuestionWords = words.filter(word => !questionWords.includes(word));
        const isAttributeQuery = nonQuestionWords.length > 0 && 
                                nonQuestionWords.every(word => attributeWords.includes(word));
        
        if (isAttributeQuery) {
            console.log(`[IQP] 🎯 Follow-up detected by attribute query: "${lowerQuestion}"`);
            return true;
        }
        
        // Pattern 4: Very short questions (likely follow-ups)
        if (words.length <= 2 && attributeWords.some(attr => words.includes(attr))) {
            console.log(`[IQP] 🎯 Follow-up detected by short attribute question: "${lowerQuestion}"`);
            return true;
        }
        
        return false;
    }

    /**
     * Process a user question intelligently, extracting search terms, applying filters,
     * and refining results using tag analysis
     */
    async processQuestion(question, options = {}) {
        console.log(`[IQP] Processing question: "${question}"`);
        const { existingContext = null } = options;
        
        try {
            // Step 0: Check if this is a follow-up question with existing context
            if (existingContext && existingContext.length === 1) {
                const isFollowUp = this.isFollowUpQuestion(question);
                if (isFollowUp) {
                    console.log(`[IQP] 🔄 Detected follow-up question, using existing context instead of new search`);
                    return this.extractAndFormatContent(
                        question, 
                        existingContext, 
                        { search: 'existing_context', recordType: existingContext[0].oip?.recordType || 'unknown' }, 
                        []
                    );
                }
            }
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
            
            // Step 3: Recipe-specific tag refinement or general refinement with modifiers
            if (initialResults.records.length > 1) {
                let shouldRefine = false;
                let termsForRefinement = modifiers;
                
                if (recordType === 'recipe') {
                    // For recipes, always try refinement when multiple results exist
                    shouldRefine = true;
                    // Use all meaningful words from the original question for tag matching
                    termsForRefinement = this.extractMeaningfulWords(question);
                    console.log(`[IQP] Multiple recipe results (${initialResults.records.length}), attempting tag refinement with question terms: [${termsForRefinement.join(', ')}]`);
                } else if (modifiers.length > 0) {
                    // For non-recipes, only refine if we have explicit modifiers
                    shouldRefine = true;
                    console.log(`[IQP] Multiple results (${initialResults.records.length}) with modifiers, attempting tag refinement`);
                }
                
                if (shouldRefine) {
                    const refinedResult = await this.refineSearchWithTags(question, subject, termsForRefinement, recordType, options);
                    if (refinedResult) {
                        console.log(`[IQP] ✅ Successfully refined from ${initialResults.records.length} to ${refinedResult.records.length} results`);
                        return refinedResult;
                    }
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

        // For recipes, extract proper subject and modifiers for precise searching
        // For posts, use full question to get broader context
        if (recordType === 'recipe') {
            const result = this.parseQuestionStructure(question, recordType);
            return {
                subject: result.subject,
                modifiers: result.modifiers,
                recordType: recordType
            };
        } else {
            // For posts and other types, use full question for broader context
            return {
                subject: question,
                modifiers: [],
                recordType: recordType
            };
        }
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
        const cookingMethods = ['grilled', 'baked', 'fried', 'roasted', 'steamed', 'boiled', 'sautéed', 'braised', 'smoked', 'bbq', 'barbecue'];
        const cuisines = ['greek', 'italian', 'mexican', 'indian', 'chinese', 'thai', 'mediterranean', 'french', 'spanish', 'asian'];
        const characteristics = ['spicy', 'healthy', 'quick', 'easy', 'traditional', 'crispy', 'tender', 'creamy', 'slow', 'instant'];
        
        const words = this.extractMeaningfulWords(cleanedQuestion);
        const foundModifiers = [];
        
        // Find cooking methods, cuisines, and characteristics
        words.forEach(word => {
            if (cookingMethods.includes(word) || cuisines.includes(word) || characteristics.includes(word)) {
                foundModifiers.push(word);
            }
        });
        
        // Find the main ingredient (usually a noun)
        const commonIngredients = ['chicken', 'beef', 'pork', 'fish', 'salmon', 'shrimp', 'pasta', 'rice', 'vegetables', 'turkey', 'lamb', 'tofu', 'beans'];
        const foundIngredient = commonIngredients.find(ingredient => words.includes(ingredient));
        
        let subject;
        
        if (foundIngredient && foundModifiers.length > 0) {
            // Combine modifier + ingredient (e.g., "grilled chicken")
            subject = `${foundModifiers[0]} ${foundIngredient}`;
        } else if (foundIngredient) {
            // Just the ingredient
            subject = foundIngredient;
        } else if (foundModifiers.length > 0) {
            // Just the cooking method
            subject = foundModifiers[0];
        } else {
            // Look for other potential recipe subjects
            const nonStopWords = words.filter(word => !['recipe', 'cook', 'cooking', 'time', 'long', 'much', 'many'].includes(word));
            subject = nonStopWords.length > 0 ? nonStopWords[0] : 'recipe';
        }
        
        // Return remaining modifiers that weren't used in the subject
        const remainingModifiers = foundModifiers.filter(mod => !subject.includes(mod));
        
        console.log(`[IQP] Recipe parsing: "${cleanedQuestion}" -> subject: "${subject}", modifiers: [${remainingModifiers.join(', ')}]`);
        
        return { subject, modifiers: remainingModifiers };
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
            resolveDepth: options.resolveDepth || 2,
            limit: options.limit || 20,
            sortBy: options.sortBy || 'matchCount:desc' // Use relevance sorting by default
        };

        // Recipe-specific settings for precise search
        if (recordType === 'recipe') {
            filters.searchMatchMode = 'AND'; // Use AND mode for precise recipe matching
            filters.summarizeRecipe = true; // Get nutritional information
        } else {
            filters.searchMatchMode = 'OR'; // Use OR mode for broader post/news searches
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
                tagCount: recordType === 'recipe' ? 10 : this.maxTagsToAnalyze, // Use 10 tags for recipes as specified
                limit: this.maxRecordsForTagAnalysis
            };
            
            // Use the same searchMatchMode as the main search
            if (recordType === 'recipe') {
                tagSummaryFilters.searchMatchMode = 'AND';
            }
            
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
                sortBy: 'matchCount:desc' // Use relevance sorting
            };
            
            // Apply recipe-specific settings
            if (recordType === 'recipe') {
                refinedFilters.searchMatchMode = 'AND';
                refinedFilters.summarizeRecipe = true;
            } else {
                refinedFilters.searchMatchMode = 'OR';
            }
            
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