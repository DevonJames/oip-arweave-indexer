const { getRecords, getTemplatesInDB, getCreatorsInDB } = require('./elasticsearch');
const axios = require('axios');
const { 
    getEnabledRecordTypes, 
    getRecordTypesByPriority, 
    isRecordTypeEnabled, 
    getContextFields 
} = require('../config/recordTypesForRAG');

class RAGService {
    constructor() {
        this.ollamaBaseUrl = process.env.OLLAMA_HOST || 'http://ollama:11434';
        this.defaultModel = process.env.DEFAULT_LLM_MODEL || 'llama3.2:3b';
        this.maxContextLength = 2000; // Max characters for context
        this.maxResults = 5; // Max search results to include
    }

    /**
     * Main RAG query function - searches Elasticsearch and generates context-aware response
     */
    async query(question, options = {}) {
        try {
            console.log(`[RAG] Processing query: ${question}`);
            
            // Step 1: Search Elasticsearch for relevant content
            const searchResults = await this.searchElasticsearch(question, options);
            
            // Step 2: Build context from search results
            const context = this.buildContext(searchResults);
            
            // Step 3: Generate LLM response with context
            const response = await this.generateResponse(question, context, options.model);
            
            return {
                answer: response,
                sources: this.extractSources(searchResults),
                context_used: context.length > 0,
                model: options.model || this.defaultModel,
                search_results_count: searchResults.totalResults || 0
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
     * Search Elasticsearch using existing getRecords function
     */
    async searchElasticsearch(question, options = {}) {
        const searchParams = {
            search: question,
            limit: this.maxResults * 2, // Get more results since we'll filter by record type
            page: 1,
            resolveDepth: 1,
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
     * Build context string from search results
     */
    buildContext(searchResults) {
        const contextParts = [];
        let currentLength = 0;

        // Add record content
        if (searchResults.records && searchResults.records.length > 0) {
            contextParts.push("=== RELEVANT RECORDS ===");
            
            for (const record of searchResults.records) {
                const recordContext = this.extractRecordContext(record);
                if (currentLength + recordContext.length < this.maxContextLength) {
                    contextParts.push(recordContext);
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
                contextParts.push("=== RELEVANT TEMPLATES ===");
                contextParts.push(templateContext);
            }
        }

        // Add creator information if relevant  
        if (searchResults.creators && searchResults.creators.length > 0) {
            const creatorContext = this.extractCreatorContext(searchResults.creators);
            if (currentLength + creatorContext.length < this.maxContextLength) {
                contextParts.push("=== RELEVANT CREATORS ===");
                contextParts.push(creatorContext);
            }
        }

        return contextParts.join('\n\n');
    }

    /**
     * Extract context from a record using configured context fields
     */
    extractRecordContext(record) {
        const basic = record.data?.basic || {};
        const oip = record.oip || {};
        const recordType = oip.recordType;
        
        const parts = [];
        
        // Get configured context fields for this record type
        const contextFields = getContextFields(recordType);
        
        // Always include basic information
        if (basic.name) {
            parts.push(`Title: ${basic.name}`);
        }
        
        if (basic.description) {
            parts.push(`Description: ${basic.description}`);
        }
        
        // Add record type
        if (recordType) {
            parts.push(`Type: ${recordType}`);
        }
        
        // Add creator info
        if (oip.creator?.creatorHandle) {
            parts.push(`Creator: ${oip.creator.creatorHandle}`);
        }
        
        // Add record type specific fields
        this.addRecordTypeSpecificContext(parts, record, recordType, contextFields);
        
        // Add common fields
        if (basic.tagItems && basic.tagItems.length > 0) {
            parts.push(`Tags: ${basic.tagItems.join(', ')}`);
        }
        
        if (basic.dateReadable) {
            parts.push(`Date: ${basic.dateReadable}`);
        }
        
        if (basic.webUrl || basic.url) {
            parts.push(`URL: ${basic.webUrl || basic.url}`);
        }

        return parts.join('\n') + '\n---';
    }

    /**
     * Add record type specific context fields
     */
    addRecordTypeSpecificContext(parts, record, recordType, contextFields) {
        const basic = record.data?.basic || {};
        
        // Add specific fields based on record type
        switch (recordType) {
            case 'recipe':
                if (basic.ingredients && contextFields.includes('ingredients')) {
                    parts.push(`Ingredients: ${Array.isArray(basic.ingredients) ? basic.ingredients.join(', ') : basic.ingredients}`);
                }
                if (basic.instructions && contextFields.includes('instructions')) {
                    parts.push(`Instructions: ${basic.instructions.substring(0, 200)}...`);
                }
                if (basic.cookingTime && contextFields.includes('cookingTime')) {
                    parts.push(`Cooking Time: ${basic.cookingTime}`);
                }
                if (basic.servings && contextFields.includes('servings')) {
                    parts.push(`Servings: ${basic.servings}`);
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
                if (basic.content && contextFields.includes('content')) {
                    parts.push(`Content: ${basic.content.substring(0, 300)}...`);
                }
                if (basic.category && contextFields.includes('category')) {
                    parts.push(`Category: ${basic.category}`);
                }
                break;
                
            case 'podcast':
                if (basic.transcript && contextFields.includes('transcript')) {
                    parts.push(`Transcript: ${basic.transcript.substring(0, 300)}...`);
                }
                if (basic.speakers && contextFields.includes('speakers')) {
                    parts.push(`Speakers: ${Array.isArray(basic.speakers) ? basic.speakers.join(', ') : basic.speakers}`);
                }
                if (basic.duration && contextFields.includes('duration')) {
                    parts.push(`Duration: ${basic.duration}`);
                }
                if (basic.topics && contextFields.includes('topics')) {
                    parts.push(`Topics: ${Array.isArray(basic.topics) ? basic.topics.join(', ') : basic.topics}`);
                }
                break;
                
            case 'jfkFilesDocument':
                if (basic.content && contextFields.includes('content')) {
                    parts.push(`Content: ${basic.content.substring(0, 300)}...`);
                }
                if (basic.documentType && contextFields.includes('documentType')) {
                    parts.push(`Document Type: ${basic.documentType}`);
                }
                if (basic.classification && contextFields.includes('classification')) {
                    parts.push(`Classification: ${basic.classification}`);
                }
                break;
                
            case 'video':
                if (basic.transcript && contextFields.includes('transcript')) {
                    parts.push(`Transcript: ${basic.transcript.substring(0, 300)}...`);
                }
                if (basic.duration && contextFields.includes('duration')) {
                    parts.push(`Duration: ${basic.duration}`);
                }
                if (basic.category && contextFields.includes('category')) {
                    parts.push(`Category: ${basic.category}`);
                }
                break;
                
            case 'image':
                if (basic.location && contextFields.includes('location')) {
                    parts.push(`Location: ${basic.location}`);
                }
                if (basic.dateCreated && contextFields.includes('dateCreated')) {
                    parts.push(`Date Created: ${basic.dateCreated}`);
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
    async generateResponse(question, context, model = null) {
        const modelName = model || this.defaultModel;
        
        const prompt = this.buildPrompt(question, context);
        
        try {
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
            
            return response.data.response?.trim() || "I couldn't generate a response.";
            
        } catch (error) {
            console.error('[RAG] Error calling Ollama:', error);
            
            if (context.length > 0) {
                return "I found relevant information in my knowledge base, but I'm having trouble generating a response right now. Please try asking a more specific question.";
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

        return `You are an AI assistant for an OIP (Open Index Protocol) system. Use the following context from the user's data to answer their question. Be specific and cite information from the context when possible. If the context doesn't contain enough information to fully answer the question, say so honestly.

Context from OIP Database:
${context}

Question: ${question}

Based on the context above, provide a helpful and accurate response:`;
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
     * Advanced search with specific parameters
     */
    async advancedSearch(question, searchOptions = {}) {
        // Parse question for specific search intents
        const intent = this.parseSearchIntent(question);
        
        const params = {
            ...searchOptions,
            ...intent.params
        };
        
        return await this.query(question, { searchParams: params });
    }

    /**
     * Parse question for search intent and parameters
     */
    parseSearchIntent(question) {
        const lowerQuestion = question.toLowerCase();
        const params = {};
        
        // Parse creator mentions
        const creatorMatch = lowerQuestion.match(/by\s+(\w+)|from\s+(\w+)|creator\s+(\w+)/);
        if (creatorMatch) {
            params.creatorHandle = creatorMatch[1] || creatorMatch[2] || creatorMatch[3];
        }
        
        // Parse date ranges
        if (lowerQuestion.includes('recent') || lowerQuestion.includes('latest')) {
            params.sortBy = 'date:desc';
            params.limit = 3;
        }
        
        // Parse content type
        if (lowerQuestion.includes('audio') || lowerQuestion.includes('podcast')) {
            params.hasAudio = true;
        }
        
        if (lowerQuestion.includes('video')) {
            params.recordType = 'video';
        }
        
        if (lowerQuestion.includes('post')) {
            params.recordType = 'post';
        }
        
        return { params };
    }
}

module.exports = new RAGService(); 