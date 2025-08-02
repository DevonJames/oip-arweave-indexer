const { getRecords, getTemplatesInDB, getCreatorsInDB } = require('./elasticsearch');
const axios = require('axios');
const { 
    getEnabledRecordTypes, 
    getRecordTypesByPriority, 
    isRecordTypeEnabled, 
    getContextFields,
    recordTypesForRAG
} = require('../config/recordTypesForRAG');

class ALFRED {
    constructor() {
        this.ollamaBaseUrl = process.env.OLLAMA_HOST || 'http://ollama:11434';
        this.defaultModel = process.env.DEFAULT_LLM_MODEL || 'llama3.2:3b';
        this.maxRecordsForTagAnalysis = 50;
        
        // Cloud model configurations
        this.xaiApiKey = process.env.XAI_API_KEY;
        this.openaiApiKey = process.env.OPENAI_API_KEY;
        
        // Define which models are cloud-hosted vs self-hosted
        this.cloudModels = {
            // XAI Models (Grok)
            'grok-beta': { provider: 'xai', apiUrl: 'https://api.x.ai/v1/chat/completions' },
            
            // OpenAI Models
            'gpt-4o': { provider: 'openai', apiUrl: 'https://api.openai.com/v1/chat/completions' },
            'gpt-4o-mini': { provider: 'openai', apiUrl: 'https://api.openai.com/v1/chat/completions' },
            'gpt-4-turbo': { provider: 'openai', apiUrl: 'https://api.openai.com/v1/chat/completions' },
            'gpt-4-turbo-preview': { provider: 'openai', apiUrl: 'https://api.openai.com/v1/chat/completions' },
            'gpt-4': { provider: 'openai', apiUrl: 'https://api.openai.com/v1/chat/completions' },
            'gpt-3.5-turbo': { provider: 'openai', apiUrl: 'https://api.openai.com/v1/chat/completions' }
        };
        this.maxTagsToAnalyze = 30;
        // RAG Service properties
        this.maxContextLength = 8000; // Increased for full text content
        this.maxResults = 5; // Max search results to include
        this.fullTextCache = new Map(); // Cache for fetched full text content
    }

    /**
     * Preprocess text for better TTS pronunciation
     */
    preprocessTextForTTS(text) {
        // Replace number-dash-number patterns with "number to number" for better TTS
        // Examples: "3-5" becomes "3 to 5", "8-10" becomes "8 to 10"
        // Replace * and # symbols with spaces
        text = text.replace(/\*/g, ' ');
        text = text.replace(/#/g, ' ');
        return text.replace(/(\d+)-(\d+)/g, '$1 to $2');
    }

    /**
     * Check if a model is cloud-hosted or self-hosted
     */
    isCloudModel(modelName) {
        return this.cloudModels.hasOwnProperty(modelName);
    }

    /**
     * Call a cloud-hosted LLM API (Grok, GPT, etc.)
     */
    async callCloudModel(modelName, prompt, options = {}) {
        const modelConfig = this.cloudModels[modelName];
        if (!modelConfig) {
            throw new Error(`Unknown cloud model: ${modelName}`);
        }

        let headers = {
            'Content-Type': 'application/json'
        };

        let apiKey;
        if (modelConfig.provider === 'xai') {
            apiKey = this.xaiApiKey;
            if (!apiKey) {
                throw new Error('XAI_API_KEY environment variable is required for Grok models');
            }
        } else if (modelConfig.provider === 'openai') {
            apiKey = this.openaiApiKey;
            if (!apiKey) {
                throw new Error('OPENAI_API_KEY environment variable is required for OpenAI models');
            }
        }

        headers['Authorization'] = `Bearer ${apiKey}`;

        // Default options for analysis vs generation
        const defaultOptions = {
            temperature: 0.2,
            max_tokens: 150,
            stop: ["\n\n", "Question:", "Explanation:", "Note:"]
        };

        const finalOptions = { ...defaultOptions, ...options };

        const requestBody = {
            model: modelName,
            messages: [
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: finalOptions.temperature,
            max_tokens: finalOptions.max_tokens,
            stop: finalOptions.stop
        };

        console.log(`[ALFRED] 🌐 Calling ${modelConfig.provider} API for ${modelName}`);

        const response = await axios.post(modelConfig.apiUrl, requestBody, {
            headers: headers,
            timeout: 30000
        });

        if (response.data?.choices?.[0]?.message?.content) {
            return response.data.choices[0].message.content.trim();
        } else {
            throw new Error(`Invalid response format from ${modelConfig.provider} API`);
        }
    }

    /**
     * Use LLM to comprehensively analyze a question and extract all needed information
     * including follow-up detection, subject/modifier extraction, and categorization
     */
    async analyzeQuestionWithLLM(question, selectedModel = null, context = null) {
        try {
            const modelToUse = selectedModel || this.defaultModel;
            
            // Build context information for the prompt
            let contextInfo = '';
            if (context) {
                if (context.existingContext && context.existingContext.length > 0) {
                    // We have actual filtered records
                    const recordTypes = [...new Set(context.existingContext.map(r => r.recordType).filter(Boolean))];
                    const recordTitles = context.existingContext
                        .slice(0, 3) // Show first 3 titles as examples
                        .map(r => r.data?.basic?.name || r.data?.basic?.title || 'Untitled')
                        .filter(Boolean);
                    
                    contextInfo = `\nCURRENT USER CONTEXT:
The user is currently viewing ${context.existingContext.length} filtered records of type: ${recordTypes.join(', ')}
Example records they're looking at: ${recordTitles.join(', ')}

When determining if this is a follow-up question, look for these CLEAR INDICATORS:
- Pronouns referring to people/things from the context: "they", "it", "this", "that", "he", "she"
- Definite articles referring to previously mentioned items: "the money", "the case", "the recipe", "the person"
- Questions that would make no sense without the previous context
- References to actions or events from the loaded records
- **CRITICAL**: Questions with NO CLEAR SUBJECT when there are only 1-3 records loaded (e.g., "What are the steps?", "How long does it take?", "What's involved?")

**CATEGORY MISMATCH RULE**: If your analysis determines this question belongs to a DIFFERENT category than the loaded records (e.g., asking about "news" when context contains "${recordTypes.join('/')}" records), it is likely NOT a follow-up even if it uses pronouns.

${context.existingContext.length <= 3 ? '⚠️ SPECIAL CASE: Very few records loaded - questions without clear subjects are LIKELY follow-ups, BUT only if categories match!' : ''}

Examples of follow-up questions: "How much did they steal?" (news context), "What happened to him?" (news context), "Is this recipe healthy?" (recipe context), "When did it happen?" (matching category), "What are the steps?" (exercise context), "How long does it take?" (recipe context)
Examples of NEW questions: "Tell me about tax fraud" (when context is recipes), "Find me a chicken recipe" (when context is news), "What's the latest news?" (when context is exercises), "Show me shoulder exercises" (when context is news)`;
                    
                } else if (context.searchParams?.recordType) {
                    // We only have record type information
                    contextInfo = `\nCURRENT USER CONTEXT:
The user is currently filtering to view only "${context.searchParams.recordType}" records.

When determining if this is a follow-up question, look for these CLEAR INDICATORS:
- Pronouns referring to people/things: "they", "it", "this", "that", "he", "she"  
- Definite articles: "the person", "the recipe", "the story", "the exercise"
- Questions that assume context about ${context.searchParams.recordType}s
- References that would make no sense without previous context

**CATEGORY MISMATCH RULE**: If your analysis determines this question belongs to a DIFFERENT category than "${context.searchParams.recordType}" (e.g., asking about "news" when user is viewing ${context.searchParams.recordType} records), it is likely NOT a follow-up even if it uses pronouns.

Since the user is viewing ${context.searchParams.recordType}s, questions about general ${context.searchParams.recordType} topics are likely NEW questions, while questions using pronouns or "the" about ${context.searchParams.recordType}s are likely follow-ups.`;
                }
            }
            
            const prompt = `You are a JSON extraction tool. You MUST respond with ONLY valid JSON, no other text.
${contextInfo}

Extract from this question:
- follow-up: true/false (does this question use pronouns like "they/it/this" or phrases like "the money/the person" that refer to previously loaded content AND does the question category match the loaded records' categories?)
- category: "recipe" (if mentions recipe/cook/food), "exercise" (if mentions workout/fitness), "podcast" (if mentions audio/interview), or "news" (otherwise)  
- primary_entity: main thing asked about (for recipes: the food item like "chicken", NOT "recipe")
- modifiers: array of descriptive words (cooking methods, cuisines, difficulty)
- second_entity: secondary entity if any, empty string if none

CRITICAL: Your response must be ONLY the JSON object. No explanation. No other text.

JSON FORMAT:
{"follow-up":false,"category":"recipe","primary_entity":"name of recipe","modifiers":["cuiside","cooking-method"],"second_entity":""}

Question: "${question}"

JSON Response:`;
            
            console.log(`[ALFRED] 🤖 Using ${modelToUse} to analyze question: "${question}"`);
            
            let rawResponse;
            
            // Route to appropriate API based on model type
            if (this.isCloudModel(modelToUse)) {
                // Use cloud API
                rawResponse = await this.callCloudModel(modelToUse, prompt);
            } else {
                // Use Ollama API
                const response = await axios.post(`${this.ollamaBaseUrl}/api/generate`, {
                    model: modelToUse,
                    prompt: prompt,
                    stream: false,
                    options: {
                        temperature: 0.2,
                        top_p: 0.1,
                        top_k: 1,
                        repeat_penalty: 1.0,
                        num_predict: 100,
                        stop: ["\n\n", "Question:", "Explanation:", "Note:"]
                    }
                }, {
                    timeout: 10000
                });
                
                rawResponse = response.data?.response?.trim() || '';
            }
            
            console.log(`[ALFRED] 🤖 raw response from ${modelToUse}: "${rawResponse}"`);
            
            // Try to parse JSON response with multiple strategies
            let analysis;
            try {
                // Strategy 1: Try direct parsing first
                try {
                    analysis = JSON.parse(rawResponse);
                } catch (directParseError) {
                    // Strategy 2: Extract JSON object from response
                    let jsonMatch = rawResponse.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/);
                    if (!jsonMatch) {
                        // Strategy 3: Try to find JSON-like content and fix common issues
                        let cleanedResponse = rawResponse
                            .replace(/^[^{]*/, '') // Remove everything before first {
                            .replace(/[^}]*$/, '') // Remove everything after last }
                            .replace(/'/g, '"') // Replace single quotes with double quotes
                            .replace(/(\w+):/g, '"$1":') // Add quotes around unquoted keys
                            .replace(/,\s*}/g, '}') // Remove trailing commas
                            .replace(/,\s*]/g, ']'); // Remove trailing commas in arrays
                        
                        if (cleanedResponse.includes('{') && cleanedResponse.includes('}')) {
                            analysis = JSON.parse(cleanedResponse);
                        } else {
                            throw new Error('No JSON structure found');
                        }
                    } else {
                        analysis = JSON.parse(jsonMatch[0]);
                    }
                }
            } catch (parseError) {
                console.warn(`[ALFRED] ⚠️ Failed to parse ${modelToUse} JSON response after all strategies: "${rawResponse}"`);
                console.warn(`[ALFRED] Parse error:`, parseError.message);
                throw new Error('JSON parse failed');
            }
            
            // Validate and normalize the response - handle both "modifier" and "modifiers" 
            const modifiersArray = analysis.modifiers || analysis.modifier || [];
            const result = {
                isFollowUp: Boolean(analysis['follow-up']),
                category: analysis.category || analysis.categoory || 'news',
                primaryEntity: String(analysis.primary_entity || question).trim(),
                modifiers: Array.isArray(modifiersArray) ? modifiersArray.map(m => String(m).trim()) : [],
                secondEntity: String(analysis.second_entity || '').trim()
            };
            
            console.log(`[ALFRED] 🎯 ${modelToUse} analysis result:`, result);
            return result;
            
        } catch (error) {
            console.warn(`[ALFRED] ⚠️ LLM question analysis failed, using fallback: ${error.message}`);
            
            // Fallback to simple pattern-based approach
            return {
                isFollowUp: false,
                category: question.toLowerCase().includes('recipe') ? 'recipe' : 'news',
                primaryEntity: question,
                modifiers: [],
                secondEntity: ''
            };
        }
    }

    /**
     * Process a user question intelligently, extracting search terms, applying filters,
     * and refining results using tag analysis
     */
    async processQuestion(question, options = {}) {
        console.log(`[ALFRED] Processing question: "${question}"`);
        const { existingContext = null, selectedModel = null, searchParams = {} } = options;
        
        try {
            // Step 0: Analyze question using selected LLM for comprehensive understanding
            // Pass context information to help with follow-up detection
            const contextForAnalysis = {
                existingContext: existingContext,
                searchParams: searchParams
            };
            
            const analysis = await this.analyzeQuestionWithLLM(question, selectedModel, contextForAnalysis);
            const { isFollowUp, category, primaryEntity, modifiers, secondEntity } = analysis;

            console.log(`[ALFRED] LLM Question Analysis Result:`, analysis);
            
            // Check if this is a follow-up question with existing context
            if (existingContext && existingContext.length > 0 && isFollowUp) {
                console.log(`[ALFRED] 🔄 Detected follow-up question, using existing context (${existingContext.length} records) instead of new search`);
                console.log(`[ALFRED] 🔄 Existing context:`, existingContext);
                // Determine record type from existing context or analysis
                const contextRecordType = existingContext[0]?.recordType || 
                                        category || 'unknown';
                
                return this.extractAndFormatContent(
                    question, 
                    existingContext, 
                    { 
                        search: 'existing_context_followup', 
                        recordType: contextRecordType,
                        limit: existingContext.length 
                    }, 
                    modifiers
                );
            }
            
            // Step 1: Use LLM analysis results
            const subject = primaryEntity;
            // if the category is news, set recordType to post, otherwise is the category
            const recordType = category === 'news' ? 'post' : category;
            console.log(`[ALFRED] LLM Analysis - FollowUp: "${isFollowUp}", Subject: "${subject}", Modifiers: [${modifiers.join(', ')}], RecordType: "${recordType}", SecondEntity: "${secondEntity}"`);
            
            // Step 2: Perform initial search
            const initialFilters = this.buildInitialFilters(subject, recordType, options);
            console.log(`[ALFRED] Initial search filters:`, initialFilters);
            
            const initialResults = await this.performSearch(initialFilters);
            console.log(`[ALFRED] Initial search found ${initialResults.records?.length || 0} records`);
            
            if (!initialResults.records || initialResults.records.length === 0) {
                return await this.formatEmptyResult(question, initialFilters, "No records found for initial search");
            }
            
            if (initialResults.records.length === 1) {
                // Perfect match - proceed directly to content extraction
                console.log(`[ALFRED] Perfect match found, proceeding to content extraction`);
                return this.extractAndFormatContent(question, initialResults.records, initialFilters, modifiers);
            }
            
            // Step 3: Recipe-specific tag refinement or general refinement with modifiers
            if (initialResults.records.length > 1) {
                let shouldRefine = false;
                let termsForRefinement = modifiers;
                
                if (recordType === 'recipe') {
                    // For recipes, always try refinement when multiple results exist
                    shouldRefine = true;
                    // Use modifiers and entities from LLM analysis for tag matching
                    termsForRefinement = [...modifiers];
                    if (secondEntity && secondEntity.length > 0) {
                        termsForRefinement.push(secondEntity);
                    }
                    console.log(`[ALFRED] Multiple recipe results (${initialResults.records.length}), attempting tag refinement with LLM terms: [${termsForRefinement.join(', ')}]`);
                } else if (modifiers.length > 0) {
                    // For non-recipes, only refine if we have explicit modifiers
                    shouldRefine = true;
                    console.log(`[ALFRED] Multiple results (${initialResults.records.length}) with modifiers, attempting tag refinement`);
                }

                // before refineSearchWithTags, we need to refineSearchWithCuisine
                
                if (shouldRefine) {
                    const refinedResult = await this.refineSearchWithCuisine(question, subject, termsForRefinement, recordType, options);
                    if (refinedResult) {
                        console.log(`[ALFRED] Successfully refined with cuisine:`, refinedResult);
                        console.log(`[ALFRED] ✅ Successfully refined from ${initialResults.records.length} to ${refinedResult.search_results_count} results`);
                        // return refinedResult;
                        
                        if (refinedResult.search_results_count > 1) {
                            
                            const furtherRefinedResult1 = await this.refineSearchWithTags(question, subject, termsForRefinement, recordType, options);
                            if (furtherRefinedResult1) {
                                console.log(`[ALFRED] ✅ Successfully refined from ${initialResults.records.length} to ${furtherRefinedResult1.search_results_count} results`);
                                shouldRefine = false;
                                // return this.extractAndFormatContent(question, furtherRefinedResult1, initialFilters, modifiers);
                                return furtherRefinedResult1;
                            }
                        } 
                        if (refinedResult.search_results_count === 1) {
                            console.log(`[ALFRED] ✅ Successfully refined from ${initialResults.records.length} to ${refinedResult.search_results_count} results`);
                            shouldRefine = false;
                            // return this.extractAndFormatContent(question, refinedResult, initialFilters, modifiers);
                            return refinedResult;
                        }
                    }
                        else {
                                console.log(`[ALFRED] ❌ Not sure what this case means`);

                            }
                            
                }
            }
            
            // Step 4: If refinement didn't work or no modifiers, use initial results
            console.log(`[ALFRED] Using initial results (${initialResults.records.length} records)`);
            return this.extractAndFormatContent(question, initialResults.records, initialFilters, modifiers);
            
        } catch (error) {
            console.error(`[ALFRED] Error processing question:`, error);
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
        
        console.log(`[ALFRED] Recipe parsing: "${cleanedQuestion}" -> subject: "${subject}", modifiers: [${remainingModifiers.join(', ')}]`);
        
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
        } else if (recordType === 'exercise') {
            filters.searchMatchMode = 'AND'; // Use AND mode for precise exercise matching
            // No additional flags needed for exercises - they have full data by default
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
            console.log(`[ALFRED] Performing search with filters:`, filters);
            const results = await getRecords(filters);
            
            return {
                records: results.records || [],
                totalRecords: results.searchResults || 0,
                message: results.message
            };
        } catch (error) {
            console.error(`[ALFRED] Search error:`, error);
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
            
            console.log(`[ALFRED] Getting tag summary for refinement:`, tagSummaryFilters);
            const tagResults = await getRecords(tagSummaryFilters);
            
            if (!tagResults.tagSummary || tagResults.tagSummary.length === 0) {
                console.log(`[ALFRED] No tag summary available for refinement`);
                return null;
            }
            
            // Find matching tags for our modifiers
            const matchingTags = this.findMatchingTags(modifiers, tagResults.tagSummary);
            
            if (matchingTags.length === 0) {
                console.log(`[ALFRED] No matching tags found for modifiers: [${modifiers.join(', ')}]`);
                return null;
            }
            
            console.log(`[ALFRED] Found matching tags for refinement: [${matchingTags.join(', ')}]`);
            
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
            
            // Apply record type-specific settings
            if (recordType === 'recipe') {
                refinedFilters.searchMatchMode = 'AND';
                refinedFilters.summarizeRecipe = true;
            } else if (recordType === 'exercise') {
                refinedFilters.searchMatchMode = 'AND';
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
            console.error(`[ALFRED] Tag refinement error:`, error);
            return null;
        }
    }

    async refineSearchWithCuisine(question, subject, modifiers, recordType, options = {}) {
        try {
            // check if any of the values in modifiers match a value in the cuisine field
            const cuisineFilters = {
                search: subject,
                recordType: recordType,
                cuisine: modifiers.join(','),
                limit: 10,
                resolveDepth: options.resolveDepth || 2,
                sortBy: 'matchCount:desc'
            };
            
            // Add record type-specific settings
            if (recordType === 'recipe') {
                cuisineFilters.searchMatchMode = 'AND';
                cuisineFilters.summarizeRecipe = true;
            } else if (recordType === 'exercise') {
                cuisineFilters.searchMatchMode = 'AND';
            }
            
            console.log(`[ALFRED] Searching with cuisine filters:`, cuisineFilters);
            const cuisineResults = await getRecords(cuisineFilters);
            
            if (cuisineResults.records && cuisineResults.records.length > 0) {
                console.log(`[ALFRED] Found ${cuisineResults.records.length} matching cuisine results: [${cuisineResults.records.map(record => record.data?.basic?.name || 'Unnamed').join(', ')}]`);
                
                const rationale = `Found ${cuisineResults.records.length} records matching cuisine: ${modifiers.join(', ')}`;
                return this.extractAndFormatContent(
                    question, 
                    cuisineResults.records, 
                    { ...cuisineFilters, rationale }, 
                    modifiers
                );
            } else {
                console.log(`[ALFRED] No cuisine results found for: ${modifiers.join(', ')}`);
                return null;
            }
        } catch (error) {
            console.error(`[ALFRED] Cuisine refinement error:`, error);
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
                const recordType = record.recordType || record.oip?.recordType || 'unknown';
                const specificData = record.data?.[recordType] || {};
                
                console.log(`[ALFRED] Processing record: ${basicData.name || 'Untitled'} (type: ${recordType}) - recordType source: ${record.recordType ? 'record.recordType' : record.oip?.recordType ? 'record.oip.recordType' : 'unknown'}`);
                
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
                                console.log(`[ALFRED] Retrieved ${fullText.length} characters of full text for: ${content.title}`);
                            }
                        } catch (error) {
                            console.warn(`[ALFRED] Failed to fetch full text:`, error.message);
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
                        console.log(`[ALFRED] Included nutritional info for recipe: ${content.title}`);
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
                    
                    console.log(`[ALFRED] Enhanced recipe data for: ${content.title} (prep: ${content.prepTimeMinutes}min, cook: ${content.cookTimeMinutes}min)`);
                } else if (recordType === 'exercise') {
                    // Include comprehensive exercise data for exercise records
                    const exerciseData = record.data.exercise || {};
                    
                    console.log(`[ALFRED] 🏋️ Processing exercise record: ${content.title}, recordType: ${recordType}`);
                    console.log(`[ALFRED] 🏋️ Exercise data keys:`, Object.keys(exerciseData));
                    
                    // Include detailed exercise instructions
                    content.instructions = exerciseData.instructions || [];
                    content.muscleGroups = exerciseData.muscleGroups || [];
                    content.difficulty = exerciseData.difficulty || null;
                    content.category = exerciseData.category || null;
                    content.equipmentRequired = exerciseData.equipmentRequired || [];
                    content.isBodyweight = exerciseData.isBodyweight || false;
                    content.exerciseType = exerciseData.exercise_type || null;
                    content.measurementType = exerciseData.measurement_type || null;
                    content.estimatedDurationMinutes = exerciseData.est_duration_minutes || null;
                    content.recommendedSets = exerciseData.recommended_sets || null;
                    content.recommendedReps = exerciseData.recommended_reps || null;
                    
                    // Include full exercise data for comprehensive analysis
                    content.exerciseData = exerciseData;
                    
                    console.log(`[ALFRED] Enhanced exercise data for: ${content.title} (muscles: ${content.muscleGroups.join(', ')}, equipment: ${content.equipmentRequired.join(', ')}, instructions: ${content.instructions.length} steps)`);
                }
                
                contentItems.push(content);
                
            } catch (error) {
                console.warn(`[ALFRED] Error processing record:`, error.message);
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
            console.log(`[ALFRED] Fetching full text from: ${url}`);
            const response = await axios.get(url, { 
                timeout: 10000,
                maxContentLength: 500000
            });
            
            if (response.status === 200 && response.data) {
                const content = typeof response.data === 'string' ? response.data : String(response.data);
                console.log(`[ALFRED] Successfully fetched ${content.length} characters for: ${recordTitle}`);
                return content;
            }
        } catch (error) {
            console.warn(`[ALFRED] Failed to fetch full text from ${url}:`, error.message);
        }
        
        return null;
    }

    /**
     * Generate RAG response using LLM with structured context
     */
    async generateRAGResponse(question, contentItems, appliedFilters, modifiers) {
        // Build context from content items
        let context = '';
        
        try {
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
                
                // Include exercise-specific information
                if (item.type === 'exercise') {
                    if (item.difficulty) context += `Difficulty: ${item.difficulty}\n`;
                    if (item.category) context += `Category: ${item.category}\n`;
                    if (item.muscleGroups && item.muscleGroups.length > 0) {
                        context += `Target Muscles: ${item.muscleGroups.join(', ')}\n`;
                    }
                    if (item.equipmentRequired && item.equipmentRequired.length > 0) {
                        context += `Equipment Required: ${item.equipmentRequired.join(', ')}\n`;
                    }
                    if (item.isBodyweight !== null) {
                        context += `Bodyweight Exercise: ${item.isBodyweight ? 'Yes' : 'No'}\n`;
                    }
                    if (item.exerciseType) context += `Exercise Type: ${item.exerciseType}\n`;
                    if (item.measurementType) context += `Measurement Type: ${item.measurementType}\n`;
                    if (item.estimatedDurationMinutes) context += `Estimated Duration: ${item.estimatedDurationMinutes} minutes\n`;
                    if (item.recommendedSets) context += `Recommended Sets: ${item.recommendedSets}\n`;
                    if (item.recommendedReps) context += `Recommended Reps: ${item.recommendedReps}\n`;
                    
                    if (item.instructions && item.instructions.length > 0) {
                        context += `Instructions:\n`;
                        item.instructions.forEach((step, stepIndex) => {
                            context += `${stepIndex + 1}. ${step}\n`;
                        });
                    }
                }
                
                context += `Type: ${item.type}\n`;
            });

            const prompt = `You are answering a direct question. You have some specific information available, but if it doesn't contain what's needed to answer the question, be honest about that and then provide a helpful answer from your general knowledge.

Information available:
${context}

Question: ${question}

Instructions:
1. First, check if the information above contains what's needed to answer the question
2. If YES: Answer directly using that information (don't mention "the information" or "context")
3. If NO: Start with "I don't see that specific information in the records I found, but I can tell you that..." then provide a helpful answer from your general knowledge

Be conversational and natural. Do not use phrases like "according to the context" or "the article states."`;

            console.log(`[ALFRED] Generating RAG response for question: "${question}"`);
            
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
            
            console.log(`[ALFRED] Generated response (${answer.length} chars)`);
            
            return {
                answer: answer,
                model_used: this.defaultModel,
                context_length: context.length
            };
            
        } catch (error) {
            console.error(`[ALFRED] RAG generation error:`, error.message);
            
            // Improved fallback response that tries to provide specific information
            let fallbackAnswer;
            
            if (contentItems.length === 0) {
                fallbackAnswer = "I couldn't find sufficient information to answer your question, but feel free to ask me anyway - I might be able to help with general knowledge.";
            } else {
                // Try to extract relevant information from the context items
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
    }

    /**
     * Format empty result response with fallback from training data
     */
    async formatEmptyResult(question, appliedFilters, reason) {
        try {
            // Generate a helpful response from training data
            const fallbackPrompt = `I couldn't find any specific records about "${appliedFilters.search}" in the database, but I can still help answer your question using my general knowledge.

Question: ${question}

Please provide a helpful, conversational answer starting with "I didn't find any specific records about that, but I can tell you that..." and then give useful information from your training data. Be natural and conversational.`;

            console.log(`[ALFRED] No records found, generating fallback response for: "${question}"`);
            
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
            console.error(`[ALFRED] Fallback response generation error:`, error.message);
            
            // Final fallback if LLM fails
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

    // ===== RAG SERVICE METHODS MERGED BELOW =====

    /**
     * Analyze question context to determine relevant record types
     */
    analyzeQuestionForRecordTypes(question) {
        const lowerQuestion = question.toLowerCase();
        const relevantTypes = [];
        
        // Define keywords for each record type based on their descriptions
        const typeKeywords = {
            recipe: ['recipe', 'cook', 'food', 'ingredient', 'meal', 'dish', 'kitchen', 'eat', 'nutrition', 'cooking', 'bake', 'chef'],
            exercise: ['exercise', 'workout', 'fitness', 'gym', 'muscle', 'training', 'sport', 'physical', 'cardio', 'strength', 'yoga', 'pilates'],
            post: [
                // News and current events
                'news', 'article', 'politics', 'election', 'government', 'policy', 'social', 'current', 'event', 'opinion', 'blog', 'discussion',
                'latest', 'today', 'recent', 'now', 'happening', 'update', 'breaking', 'report', 'analysis', 'story',
                // Countries and regions (high-relevance for news) - improved Iran matching
                'iran', 'iranian', 'tehran', 'china', 'chinese', 'russia', 'russian', 'ukraine', 'ukrainian', 'israel', 'israeli', 
                'palestine', 'palestinian', 'syria', 'syrian', 'afghanistan', 'turkey', 'turkish', 'venezuela', 'belarus',
                'america', 'american', 'usa', 'united states', 'europe', 'european', 'asia', 'asian', 'africa', 'african', 'middle east',
                // Political and economic terms
                'president', 'congress', 'senate', 'parliament', 'minister', 'prime minister', 'democracy', 'dictatorship',
                'economy', 'economic', 'market', 'inflation', 'recession', 'covid', 'pandemic', 'climate', 'war', 'peace', 'treaty',
                'sanctions', 'trade', 'tariff', 'diplomacy', 'diplomatic', 'summit', 'crisis', 'protest', 'revolution',
                // Military and international relations
                'nuclear', 'military', 'defense', 'security', 'nato', 'un', 'united nations', 'strike', 'attack', 'conflict',
                'preemptive', 'missile', 'enrichment', 'weapons', 'biden', 'trump', 'administration'
            ],
            podcast: ['podcast', 'audio', 'interview', 'conversation', 'talk', 'speaker', 'listen', 'episode', 'radio', 'show'],
            jfkFilesDocument: ['jfk', 'kennedy', 'assassination', 'document', 'classified', 'cia', 'fbi', 'government', 'conspiracy', 'file', 'secret'],
            image: ['photo', 'picture', 'image', 'visual', 'gallery', 'photography', 'camera', 'snapshot'],
            video: ['video', 'watch', 'film', 'movie', 'youtube', 'streaming', 'visual', 'documentary', 'clip']
        };
        
        // Check each record type for keyword matches
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
        
        // If no specific matches found, use intelligent fallback based on question context
        if (relevantTypes.length === 0) {
            console.log('[RAG] No specific record type matches, using intelligent fallback');
            
            // For news/current events/politics questions, default to posts only
            const newsKeywords = ['latest', 'news', 'current', 'today', 'recent', 'now', 'happening', 'update', 'politics', 'government', 'election', 'policy', 'iran', 'china', 'russia', 'ukraine', 'israel', 'palestine', 'covid', 'economy', 'market'];
            const isNewsQuery = newsKeywords.some(keyword => lowerQuestion.includes(keyword));
            
            if (isNewsQuery && isRecordTypeEnabled('post')) {
                console.log('[RAG] News/current events query detected, using posts only');
                return [{
                    type: 'post',
                    score: 1,
                    priority: recordTypesForRAG.post?.priority || 5,
                    description: 'News and current events content'
                }];
            }
            
            // For other general queries, use top 2 highest priority types (but still be selective)
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
        
        console.log(`[RAG] Relevant record types for "${question}":`, 
            relevantTypes.map(rt => `${rt.type} (score: ${rt.score}, priority: ${rt.priority})`));
        
        return relevantTypes;
    }

    /**
     * Main RAG query function - searches Elasticsearch and generates context-aware response
     */
    async query(question, options = {}) {
        try {
            console.log(`[ALFRED] 🔍 Processing query: "${question}"`);
            const { include_filter_analysis = false, searchParams = {} } = options;
            
            // Check if we should use the Intelligent Question Processor (IQP)
            const shouldUseIQP = include_filter_analysis && 
                (!searchParams.recordType && !searchParams.tags && !searchParams.creatorHandle);
            
            if (shouldUseIQP) {
                console.log('[ALFRED] Using Intelligent Question Processor for enhanced analysis with model: ', options.model, 'and context: ', options.existingContext);
                try {
                    const iqpResult = await this.processQuestion(question, {
                        resolveDepth: searchParams.resolveDepth || 2,
                        limit: searchParams.limit || 20,
                        existingContext: options.existingContext || null,
                        selectedModel: options.model || null,
                        searchParams: options.searchParams || searchParams
                    });

                    // console.log(`[ALFRED] IQP Result: ${JSON.stringify(iqpResult)}`);
                            // Step 4: Build context from search results
                    const context = await this.buildContext(iqpResult);
                    
                    // Convert IQP result to RAG format for compatibility
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
                } catch (iqpError) {
                    console.warn('[RAG] Intelligent Question Processor failed, falling back to legacy method:', iqpError.message);
                    // Fall through to legacy processing
                }
            }
            
            console.log(`[RAG] 📊 Using legacy RAG processing with field extraction: ${options.useFieldExtraction !== false ? 'ENABLED' : 'DISABLED'}`);
            
            // Step 1: Analyze question to determine relevant record types
            const relevantTypes = this.analyzeQuestionForRecordTypes(question);
            
            // Step 2: Use smart search with tag summarization
            const smartResults = await this.searchWithTagSummarization(question, relevantTypes, options);
            
            // Step 3: Fallback to traditional search if smart search yields no results
            let searchResults;
            if (smartResults.records.length > 0) {
                searchResults = {
                    records: smartResults.records,
                    totalResults: smartResults.records.length,
                    templates: [],
                    creators: []
                };
            } else {
                console.log('[RAG] Smart search yielded no results, falling back to traditional search');
                searchResults = await this.searchElasticsearch(question, options);
            }
            
            // Step 4: Build context from search results
            const context = await this.buildContext(searchResults);
            
            // Step 5: Generate LLM response with context (enhanced with structured data)
            const response = await this.generateResponse(question, context, options.model, searchResults);
            
            return {
                answer: response,
                sources: this.extractSources(searchResults),
                context_used: context.length > 0,
                model: options.model || this.defaultModel,
                search_results_count: searchResults.totalResults || 0,
                search_results: searchResults.records, // Include actual records for frontend analysis
                relevant_types: relevantTypes.map(rt => rt.type),
                applied_filters: this.extractAppliedFilters(question, searchResults, relevantTypes)
            };
            
        } catch (error) {
            console.error('[RAG] Error processing query:', error);
            return {
                answer: "I'm having trouble accessing my knowledge base right now. Could you try rephrasing your question?",
                sources: [],
                context_used: false,
                error: error.message
            };
        }
    }

    /**
     * Format sources for compatibility with different parts of the system
     */
    formatSources(records) {
        if (!records || !Array.isArray(records)) return [];
        
        return records.slice(0, 5).map(record => {
            const basic = record.data?.basic || {};
            return {
                type: 'record',
                title: basic.name || 'Untitled Record',
                creator: record.oip?.creator?.creatorHandle || 'Unknown',
                didTx: record.oip?.didTx || '',
                recordType: record.oip?.recordType || 'unknown',
                preview: basic.description ? basic.description.substring(0, 100) + '...' : '',
                record: record // Include full record for detailed analysis
            };
        });
    }

    /**
     * Search Elasticsearch using existing getRecords function
     */
    async searchElasticsearch(question, options = {}) {
        const searchParams = {
            search: question,
            limit: this.maxResults * 2, // Get more results since we'll filter by record type
            page: 1,
            resolveDepth: 3, // Use proper resolve depth like the user's API call
            summarizeTags: true, // CRITICAL: Enable tag summarization for relevance
            tagCount: 5, // Get top 5 tags for context
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
        
        // Also search templates and creators if query seems relevant
        const additionalResults = await this.searchAdditionalSources(question, options);
        
        return {
            records: filteredRecords,
            totalResults: filteredRecords.length,
            templates: additionalResults.templates || [],
            creators: additionalResults.creators || []
        };
    }

    /**
     * Filter records by enabled record types and prioritize them
     */
    filterRecordsByType(records) {
        const enabledTypes = getEnabledRecordTypes();
        const priorityOrder = getRecordTypesByPriority();
        
        console.log(`[RAG] Filtering records by enabled types:`, enabledTypes);
        
        // Filter records to only include enabled types
        const filteredRecords = records.filter(record => {
            const recordType = record.oip?.recordType;
            if (!recordType) return false;
            
            const isEnabled = isRecordTypeEnabled(recordType);
            if (!isEnabled) {
                console.log(`[RAG] Excluding record type: ${recordType}`);
            }
            return isEnabled;
        });
        
        // Sort by priority and then by date
        filteredRecords.sort((a, b) => {
            const typeA = a.oip?.recordType;
            const typeB = b.oip?.recordType;
            
            const priorityA = priorityOrder.find(p => p.type === typeA)?.config.priority || 0;
            const priorityB = priorityOrder.find(p => p.type === typeB)?.config.priority || 0;
            
            // First sort by priority (higher first)
            if (priorityA !== priorityB) {
                return priorityB - priorityA;
            }
            
            // Then by date (newer first)
            const dateA = new Date(a.data?.basic?.dateCreated || 0);
            const dateB = new Date(b.data?.basic?.dateCreated || 0);
            return dateB - dateA;
        });
        
        // Limit to maxResults
        return filteredRecords.slice(0, this.maxResults);
    }

    /**
     * Search templates and creators for additional context
     */
    async searchAdditionalSources(question, options = {}) {
        const results = { templates: [], creators: [] };
        
        try {
            // Search templates if question relates to templates/structure
            if (this.isTemplateQuery(question)) {
                const templatesData = await getTemplatesInDB();
                results.templates = templatesData.templatesInDB || [];
            }
            
            // Search creators if question relates to creators/users
            if (this.isCreatorQuery(question)) {
                const creatorsData = await getCreatorsInDB();
                results.creators = creatorsData.creatorsInDB || [];
            }
            
        } catch (error) {
            console.warn('[RAG] Error searching additional sources:', error);
        }
        
        return results;
    }

    /**
     * Check if query is about templates
     */
    isTemplateQuery(question) {
        const templateKeywords = ['template', 'structure', 'field', 'schema', 'format', 'type'];
        const lowerQuestion = question.toLowerCase();
        return templateKeywords.some(keyword => lowerQuestion.includes(keyword));
    }

    /**
     * Check if query is about creators
     */
    isCreatorQuery(question) {
        const creatorKeywords = ['creator', 'user', 'author', 'publisher', 'who created', 'who made', 'who posted'];
        const lowerQuestion = question.toLowerCase();
        return creatorKeywords.some(keyword => lowerQuestion.includes(keyword));
    }

    /**
     * Build context string from search results
     */
    async buildContext(searchResults) {
        const contextParts = [];
        let currentLength = 0;

        // Add record content with clear numbering
        if (searchResults.records && searchResults.records.length > 0) {
            contextParts.push("📚 RELEVANT INFORMATION FROM YOUR DATA:");
            contextParts.push("");
            
            for (let i = 0; i < searchResults.records.length; i++) {
                const record = searchResults.records[i];
                const recordContext = await this.extractRecordContext(record);
                if (currentLength + recordContext.length < this.maxContextLength) {
                    contextParts.push(`RECORD ${i + 1}:`);
                    contextParts.push(recordContext);
                    contextParts.push("");
                    currentLength += recordContext.length;
                } else {
                    break;
                }
            }
        }

        // Add template information if relevant
        if (searchResults.templates && searchResults.templates.length > 0) {
            const templateContext = this.extractTemplateContext(searchResults.templates);
            if (currentLength + templateContext.length < this.maxContextLength) {
                contextParts.push("📋 RELEVANT TEMPLATES:");
                contextParts.push(templateContext);
                contextParts.push("");
            }
        }

        // Add creator information if relevant  
        if (searchResults.creators && searchResults.creators.length > 0) {
            const creatorContext = this.extractCreatorContext(searchResults.creators);
            if (currentLength + creatorContext.length < this.maxContextLength) {
                contextParts.push("👥 RELEVANT CREATORS:");
                contextParts.push(creatorContext);
                contextParts.push("");
            }
        }

        return contextParts.join('\n');
    }

    /**
     * Extract context from a record using configured context fields
     */
    async extractRecordContext(record) {
        const basic = record.data?.basic || {};
        const oip = record.oip || {};
        const recordType = oip.recordType;
        const ragTypeInfo = record._ragTypeInfo; // Added by smart search
        
        const parts = [];
        
        // Get configured context fields for this record type
        const contextFields = getContextFields(recordType);
        
        // Always include basic information with clear formatting
        if (basic.name) {
            parts.push(`TITLE: ${basic.name}`);
        }
        
        // For posts, try to fetch full text content first
        if (recordType === 'post') {
            const fullTextUrl = this.extractFullTextUrl(record);
            if (fullTextUrl) {
                const fullText = await this.fetchFullTextContent(fullTextUrl, basic.name);
                if (fullText && fullText.trim()) {
                    // Use full text but limit to reasonable size for context
                    const maxFullTextLength = 3000; // Generous but not excessive
                    const truncatedText = fullText.length > maxFullTextLength 
                        ? fullText.substring(0, maxFullTextLength) + '...' 
                        : fullText;
                    parts.push(`FULL TEXT: ${truncatedText}`);
                } else if (basic.description) {
                    // Fall back to description if full text fetch fails
                    parts.push(`CONTENT: ${basic.description}`);
                }
            } else if (basic.description) {
                // No full text URL available, use description
                parts.push(`CONTENT: ${basic.description}`);
            }
        } else if (basic.description) {
            // For non-post records, use description as before
            parts.push(`CONTENT: ${basic.description}`);
        }
        
        // Add publication date for timing context
        if (basic.dateReadable) {
            parts.push(`PUBLISHED: ${basic.dateReadable}`);
        }
        
        // Add relevant tags (limit to most important ones)
        if (basic.tagItems && basic.tagItems.length > 0) {
            parts.push(`TAGS: ${basic.tagItems.slice(0, 8).join(', ')}`);
        }
        
        // Add record type with relevance score if available
        if (recordType) {
            if (ragTypeInfo && ragTypeInfo.score > 0) {
                parts.push(`SOURCE: ${recordType} (relevance: ${ragTypeInfo.score})`);
            } else {
                parts.push(`SOURCE: ${recordType}`);
            }
        }
        
        // Add creator info
        if (oip.creator?.creatorHandle) {
            parts.push(`CREATOR: ${oip.creator.creatorHandle}`);
        }
        
        // Add record type specific fields
        this.addRecordTypeSpecificContext(parts, record, recordType, contextFields);
        
        if (basic.webUrl || basic.url) {
            parts.push(`URL: ${basic.webUrl || basic.url}`);
        }

        return parts.join('\n') + '\n---';
    }

    /**
     * Fetch full text content from a URL with caching
     */
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
                timeout: 10000, // 10 second timeout
                maxContentLength: 500000 // 500KB max
            });
            
            if (response.status === 200 && response.data) {
                const content = typeof response.data === 'string' ? response.data : String(response.data);
                
                // Cache the content (limit cache size to prevent memory issues)
                if (this.fullTextCache.size > 50) {
                    // Clear oldest entries
                    const firstKey = this.fullTextCache.keys().next().value;
                    this.fullTextCache.delete(firstKey);
                }
                this.fullTextCache.set(url, content);
                
                console.log(`[RAG] Successfully fetched ${content.length} characters of full text for: ${recordTitle}`);
                return content;
            }
        } catch (error) {
            console.warn(`[RAG] Failed to fetch full text from ${url}:`, error.message);
        }
        
        return null;
    }

    /**
     * Add record type specific context fields
     */
    addRecordTypeSpecificContext(parts, record, recordType, contextFields) {
        const basic = record.data?.basic || {};
        
        // Add specific fields based on record type
        switch (recordType) {
            case 'recipe':
                // Enhanced recipe field extraction for better cooking question support
                
                // Timing fields - multiple variations to catch different field names
                const timingFields = [
                    'cook_time_mins', 'cookingTime', 'cook_time', 'cooking_time_mins', 'cooking_time',
                    'prep_time_mins', 'prepTime', 'prep_time', 'preparation_time_mins', 'preparation_time',
                    'total_time_mins', 'totalTime', 'total_time', 'ready_in_mins', 'ready_time'
                ];
                
                timingFields.forEach(field => {
                    if (basic[field] && contextFields.includes(field)) {
                        const displayName = field.replace(/_/g, ' ').replace(/mins?/i, 'minutes');
                        parts.push(`${displayName}: ${basic[field]} minutes`);
                    }
                });
                
                // If no specific timing fields found, look for generic time mentions
                if (!timingFields.some(field => basic[field])) {
                    if (basic.time && contextFields.includes('time')) {
                        parts.push(`Time: ${basic.time}`);
                    }
                    if (basic.duration && contextFields.includes('duration')) {
                        parts.push(`Duration: ${basic.duration}`);
                    }
                }
                
                // Ingredient handling - enhanced to be more comprehensive
                if (basic.ingredients && contextFields.includes('ingredients')) {
                    let ingredientText = '';
                    if (Array.isArray(basic.ingredients)) {
                        ingredientText = basic.ingredients.join(', ');
                    } else if (typeof basic.ingredients === 'object') {
                        // Handle structured ingredient objects
                        ingredientText = Object.values(basic.ingredients).join(', ');
                    } else {
                        ingredientText = String(basic.ingredients);
                    }
                    parts.push(`Ingredients: ${ingredientText.substring(0, 300)}${ingredientText.length > 300 ? '...' : ''}`);
                }
                
                // Instructions - enhanced to capture cooking methods and timing
                if (basic.instructions && contextFields.includes('instructions')) {
                    let instructionText = String(basic.instructions);
                    // Prioritize sentences with timing information
                    const sentences = instructionText.split(/[.!?]+/);
                    const timingSentences = sentences.filter(sentence => 
                        /\d+\s*(?:minutes?|mins?|hours?|hrs?|seconds?|secs?)/i.test(sentence)
                    );
                    
                    if (timingSentences.length > 0) {
                        // Include timing-related instructions first
                        const relevantInstructions = timingSentences.slice(0, 2).join('. ').trim();
                        parts.push(`Instructions (timing): ${relevantInstructions}${relevantInstructions.length > 200 ? '...' : ''}`);
                    }
                    
                    // Then add general instructions if there's space
                    const generalInstructions = instructionText.substring(0, 200);
                    parts.push(`Instructions: ${generalInstructions}${instructionText.length > 200 ? '...' : ''}`);
                }
                break;
                
            case 'exercise':
                if (basic.muscleGroups && contextFields.includes('muscleGroups')) {
                    parts.push(`Muscle Groups: ${Array.isArray(basic.muscleGroups) ? basic.muscleGroups.join(', ') : basic.muscleGroups}`);
                }
                if (basic.equipment && contextFields.includes('equipment')) {
                    parts.push(`Equipment: ${basic.equipment}`);
                }
                if (basic.difficulty && contextFields.includes('difficulty')) {
                    parts.push(`Difficulty: ${basic.difficulty}`);
                }
                if (basic.duration && contextFields.includes('duration')) {
                    parts.push(`Duration: ${basic.duration}`);
                }
                break;
                
            case 'post':
                // Note: Full text content is already handled in the main extractRecordContext method
                // Only add additional fields here that aren't the main content
                if (basic.category && contextFields.includes('category')) {
                    parts.push(`Category: ${basic.category}`);
                }
                // Add additional content field only if we don't already have full text
                if (basic.content && contextFields.includes('content') && !parts.find(p => p.startsWith('FULL TEXT:'))) {
                    parts.push(`Additional Content: ${basic.content.substring(0, 300)}...`);
                }
                break;
        }
    }

    /**
     * Extract context from templates
     */
    extractTemplateContext(templates) {
        return templates.slice(0, 3).map(template => {
            const data = template.data || {};
            return `Template: ${data.template || 'Unknown'}\nCreator: ${template.oip?.creator?.creatorHandle || 'Unknown'}\nFields: ${data.fields || 'N/A'}`;
        }).join('\n---\n');
    }

    /**
     * Extract context from creators
     */
    extractCreatorContext(creators) {
        return creators.slice(0, 3).map(creator => {
            const data = creator.data || {};
            return `Creator: ${data.creatorHandle || 'Unknown'}\nName: ${data.name || ''} ${data.surname || ''}\nDescription: ${data.description || 'N/A'}`;
        }).join('\n---\n');
    }

    /**
     * Generate response using Ollama with context
     */
    async generateResponse(question, context, model = null, searchResults = null) {
        const modelName = model || this.defaultModel;
        const prompt = this.buildPrompt(question, context);
        
        try {
            let responseText;
            
            // Route to appropriate API based on model type
            if (this.isCloudModel(modelName)) {
                // Use cloud API for generation with longer response limit
                responseText = await this.callCloudModel(modelName, prompt, {
                    temperature: 0.7,
                    max_tokens: 800,
                    stop: null // Allow full responses for generation
                });
            } else {
                // Use Ollama API
                const response = await axios.post(`${this.ollamaBaseUrl}/api/generate`, {
                    model: modelName,
                    prompt: prompt,
                    stream: false,
                    options: {
                        temperature: 0.7,
                        top_p: 0.9,
                        max_tokens: 500
                    }
                }, {
                    timeout: 30000 // 30 second timeout
                });
                
                responseText = response.data.response?.trim() || '';
            }
            
            return responseText || "I couldn't generate a response.";
            
        } catch (error) {
            console.error(`[RAG] Error calling ${this.isCloudModel(modelName) ? 'cloud API' : 'Ollama'}:`, error);
            
            if (context.length > 0) {
                // If we have context but LLM failed, extract key information manually
                return this.extractDirectAnswer(question, context);
            } else {
                return "I don't have specific information about this in my knowledge base. Could you provide more details or try a different question?";
            }
        }
    }

    /**
     * Build the prompt template for the LLM
     */
    buildPrompt(question, context) {
        if (context.length === 0) {
            return `You are an AI assistant for an OIP (Open Index Protocol) system. A user is asking about their data, but no relevant information was found in the knowledge base.

Question: ${question}

Please respond helpfully, acknowledging that you don't have specific information about this topic in the current knowledge base, and suggest how they might refine their search or what type of information might be available.

Response:`;
        }

        return `You are an AI assistant analyzing content from a knowledge base to answer a specific question.

RELEVANT CONTENT FROM KNOWLEDGE BASE:
${context}

USER'S QUESTION: ${question}

INSTRUCTIONS:
1. Read through the provided content carefully
2. Look for information that directly answers the user's question: "${question}"
3. If the information exists in the content, provide a clear, factual answer
4. If some information is missing, acknowledge what you found and what's not available
5. Be concise and focus only on answering the specific question asked
6. If you find numerical data, statistics, or specific facts that answer the question, highlight them clearly

ANSWER:`;
    }

    /**
     * Enhanced fallback method to extract direct answers from context when LLM fails
     */
    extractDirectAnswer(question, context) {
        const lowerQuestion = question.toLowerCase();
        
        // Look for evacuation numbers in the context
        if (lowerQuestion.includes('how many') && (lowerQuestion.includes('evacuated') || lowerQuestion.includes('evacuation'))) {
            const evacuationNumbers = context.match(/(\d{1,3}(?:,\d{3})*)\s*(?:residents|people|individuals)?\s*(?:evacuated|forced to evacuate)/gi);
            if (evacuationNumbers && evacuationNumbers.length > 0) {
                const numbers = evacuationNumbers.map(match => {
                    const num = match.match(/(\d{1,3}(?:,\d{3})*)/);
                    return num ? num[1] : null;
                }).filter(Boolean);
                
                if (numbers.length > 0) {
                    return `Based on the information in my knowledge base, ${numbers[0]} people were evacuated due to the LA fires. ${evacuationNumbers[0]}`;
                }
            }
        }
        
        // Generic fallback with context preview
        const sentences = context.split(/[.!?]+/).filter(s => s.trim().length > 20);
        const relevantSentences = sentences.filter(sentence => {
            const keywords = lowerQuestion.split(/\s+/).filter(word => word.length > 3);
            return keywords.some(keyword => sentence.toLowerCase().includes(keyword));
        });
        
        if (relevantSentences.length > 0) {
            const preview = relevantSentences.slice(0, 2).join('. ').trim();
            return `I found relevant information in my knowledge base: ${preview}${preview.endsWith('.') ? '' : '.'}`;
        }
        
        return "I found relevant information in my knowledge base, but I'm having trouble generating a response right now. Please try asking a more specific question.";
    }

    /**
     * Extract source information for attribution
     */
    extractSources(searchResults) {
        const sources = [];
        
        if (searchResults.records) {
            for (const record of searchResults.records.slice(0, 3)) {
                const basic = record.data?.basic || {};
                sources.push({
                    type: 'record',
                    title: basic.name || 'Untitled Record',
                    creator: record.oip?.creator?.creatorHandle || 'Unknown',
                    didTx: record.oip?.didTx || '',
                    recordType: record.oip?.recordType || 'unknown',
                    preview: basic.description ? basic.description.substring(0, 100) + '...' : ''
                });
            }
        }
        
        return sources;
    }

    /**
     * Extract applied filters for frontend display
     */
    extractAppliedFilters(question, searchResults, relevantTypes) {
        const filters = {};
        const lowerQuestion = question.toLowerCase();
        
        // Use the same smart keyword extraction that was used for the search
        const searchKeywords = this.extractSearchKeywords ? this.extractSearchKeywords(question) : question;
        if (searchKeywords && searchKeywords.trim().length > 0) {
            filters.search = searchKeywords.trim();
        }
        
        // Determine record type from search results or query analysis
        if (searchResults.records && searchResults.records.length > 0) {
            const recordTypes = [...new Set(searchResults.records.map(r => r.oip?.recordType).filter(Boolean))];
            if (recordTypes.length === 1) {
                filters.recordType = recordTypes[0];
            }
        } else if (relevantTypes && relevantTypes.length === 1) {
            filters.recordType = relevantTypes[0].type;
        }
        
        // Detect sorting preferences
        if (lowerQuestion.includes('recent') || lowerQuestion.includes('latest') || lowerQuestion.includes('new')) {
            filters.sortBy = 'date:desc';
        }
        
        // Check if refinement occurred and build enhanced rationale
        const sourceCount = searchResults.records ? searchResults.records.length : 0;
        
        filters.rationale = `Found ${sourceCount} relevant record${sourceCount === 1 ? '' : 's'}`;
        if (filters.recordType) {
            filters.rationale += ` of type "${filters.recordType}"`;
        }
        if (filters.search) {
            filters.rationale += ` matching "${filters.search}"`;
        }
        
        console.log(`[RAG] Extracted filters for "${question}":`, filters);
        return filters;
    }

    /**
     * Use tag summarization to get the most relevant results for specific record types
     */
    async searchWithTagSummarization(question, relevantTypes, options = {}) {
        const allResults = [];
        
        // Extract both subject and modifiers from the question using existing method
        const { subject, modifiers, recordType } = this.extractSubjectAndModifiers(question);
        console.log(`[RAG] 🎯 Extracted - Subject: "${subject}", Modifiers: [${modifiers.join(', ')}]`);
        
        const searchKeywords = subject || question;
        
        // Try normal search for top relevant types
        let searchTypes = relevantTypes.slice(0, 2); // Start with top 2 relevant types
        
        for (const typeInfo of searchTypes) {
            try {
                console.log(`[RAG] 🔍 Searching ${typeInfo.type} records for keywords: "${searchKeywords}"`);
                
                // Perform initial broad search
                const searchParams = {
                    search: searchKeywords,
                    recordType: typeInfo.type,
                    sortBy: 'date:desc',
                    resolveDepth: 3,
                    summarizeTags: true,
                    tagCount: 15, // Get more tags for analysis
                    tagPage: 1,
                    limit: this.maxResults * 2, // Get more results initially for refinement
                    page: 1,
                    includeSigs: false,
                    includePubKeys: false
                };
                
                const initialResults = await getRecords(searchParams);
                
                if (initialResults && initialResults.records && initialResults.records.length > 0) {
                    console.log(`[RAG] 📊 Initial search found ${initialResults.records.length} ${typeInfo.type} records`);
                    
                    const records = initialResults.records.slice(0, this.maxResults);
                    
                    records.forEach(record => {
                        record.ragTypeInfo = typeInfo;
                    });
                    
                    allResults.push(...records);
                    
                    console.log(`[RAG] 📝 Using ${records.length} ${typeInfo.type} records`);
                    
                    // If we got good results, we can stop here
                    if (records.length > 0) {
                        console.log(`[RAG] 🎯 Good results found, stopping search`);
                        break;
                    }
                } else {
                    console.log(`[RAG] ❌ No results found for ${typeInfo.type} with keywords: "${searchKeywords}"`);
                }
            } catch (error) {
                console.error(`[RAG] 💥 Error searching ${typeInfo.type}:`, error.message);
            }
        }
        
        // Remove duplicates and limit total results
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
        
        console.log(`[RAG] 🏁 Final search results: ${uniqueResults.length} unique records`);
        
        return {
            records: uniqueResults,
            searchMetadata: {
                originalKeywords: searchKeywords,
                extractedModifiers: modifiers
            }
        };
    }
}

module.exports = new ALFRED(); 