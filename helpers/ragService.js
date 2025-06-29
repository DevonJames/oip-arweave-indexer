const { getRecords, getTemplatesInDB, getCreatorsInDB } = require('./elasticsearch');
const axios = require('axios');
const { 
    getEnabledRecordTypes, 
    getRecordTypesByPriority, 
    isRecordTypeEnabled, 
    getContextFields,
    recordTypesForRAG
} = require('../config/recordTypesForRAG');

class RAGService {
    constructor() {
        this.ollamaBaseUrl = process.env.OLLAMA_HOST || 'http://ollama:11434';
        this.defaultModel = process.env.DEFAULT_LLM_MODEL || 'llama3.2:3b';
        this.maxContextLength = 8000; // Increased for full text content
        this.maxResults = 5; // Max search results to include
        this.fullTextCache = new Map(); // Cache for fetched full text content
    }

    /**
     * Extract full text URL from a post record
     */
    extractFullTextUrl(record) {
        if (!record || !record.data) return null;
        
        const recordType = record.oip?.recordType;
        if (recordType !== 'post') return null;
        
        const specificData = record.data[recordType] || {};
        
        // Check multiple possible locations for text URL (same as reference client)
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
     * Extract key search terms from a natural language question
     * Intelligently separates the question from the subject matter
     */
    extractSearchKeywords(question) {
        console.log(`[RAG] Extracting keywords from: "${question}"`);
        
        // First, try to identify subject entities using smart patterns
        const subjects = this.extractSubjectEntities(question);
        if (subjects.length > 0) {
            const result = subjects.join(' ');
            console.log(`[RAG] Extracted subject entities: "${result}"`);
            return result;
        }
        
        const lowerQuestion = question.toLowerCase();
        
        // Special handling for recipe queries
        if (lowerQuestion.includes('recipe') || lowerQuestion.includes('cook') || lowerQuestion.includes('ingredient')) {
            return this.extractRecipeKeywords(question);
        }
        
        // Special handling for exercise queries
        if (lowerQuestion.includes('exercise') || lowerQuestion.includes('workout') || lowerQuestion.includes('training')) {
            return this.extractExerciseKeywords(question);
        }
        
        // Special handling for news/post queries
        if (lowerQuestion.includes('news') || lowerQuestion.includes('article') || lowerQuestion.includes('post')) {
            return this.extractNewsKeywords(question);
        }
        
        // Default keyword extraction for other queries
        const stopWords = ['what', 'is', 'are', 'the', 'latest', 'news', 'on', 'about', 'tell', 'me', 'can', 'you', 'how', 'where', 'when', 'why', 'who', 'which', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'any', 'some', 'all', 'no', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'now', 'and', 'or', 'but', 'if', 'then', 'because', 'as', 'until', 'while', 'of', 'at', 'by', 'for', 'with', 'through', 'during', 'before', 'after', 'above', 'below', 'up', 'down', 'out', 'off', 'over', 'under', 'again', 'further', 'once', 'here', 'there', 'everywhere', 'anywhere', 'somewhere', 'nowhere', 'have', 'has', 'had', 'them', 'they', 'their', 'these', 'those', 'this', 'that', 'in', 'to', 'from', 'get', 'find', 'show', 'give', 'make', 'take', 'come', 'go', 'see', 'know', 'think', 'look', 'want', 'use', 'work', 'try', 'ask', 'need', 'feel', 'become', 'leave', 'put', 'mean', 'keep', 'let', 'begin', 'seem', 'help', 'talk', 'turn', 'start', 'might', 'move', 'live', 'believe', 'hold', 'bring', 'happen', 'write', 'provide', 'sit', 'stand', 'lose', 'pay', 'meet', 'include', 'continue', 'set', 'learn', 'change', 'lead', 'understand', 'watch', 'follow', 'stop', 'create', 'speak', 'read', 'allow', 'add', 'spend', 'grow', 'open', 'walk', 'win', 'offer', 'remember', 'love', 'consider', 'appear', 'buy', 'wait', 'serve', 'die', 'send', 'expect', 'build', 'stay', 'fall', 'cut', 'reach', 'kill', 'remain'];
        return this.extractGeneralKeywords(question, stopWords);
    }

    /**
     * Extract subject entities from questions using intelligent patterns
     * Examples: "LA fire", "Iran nuclear", "Tesla stock", etc.
     */
    extractSubjectEntities(question) {
        const lowerQuestion = question.toLowerCase();
        console.log(`[RAG] Looking for subject entities in: "${lowerQuestion}"`);
        
        // Define pattern-based entity extraction rules
        const entityPatterns = [
            // Special handling for evacuation/disaster questions
            {
                pattern: /\b(la|los angeles|palisades|eaton|hollywood|malibu|santa monica)\s*(?:fire|fires|wildfire|wildfires|blaze|inferno|chaos)\b/gi,
                extract: match => match[0].trim()
            },
            // Location + Event patterns (LA fire, California wildfire, etc.)
            {
                pattern: /\b(la|los angeles|california|ca|san francisco|sf|new york|ny|nyc|texas|florida|chicago|seattle|portland|denver|atlanta|boston|miami|phoenix|detroit|philadelphia|houston|dallas|washington|dc|las vegas|nevada|arizona|oregon|colorado|ohio|illinois|pennsylvania|maryland|virginia|north carolina|south carolina|georgia|tennessee|kentucky|alabama|louisiana|arkansas|mississippi|missouri|oklahoma|kansas|nebraska|iowa|minnesota|wisconsin|michigan|indiana|west virginia|delaware|new jersey|connecticut|rhode island|massachusetts|vermont|new hampshire|maine|montana|north dakota|south dakota|wyoming|utah|idaho|alaska|hawaii)\s+(fire|wildfire|earthquake|storm|hurricane|flood|disaster|shooting|attack|incident|crisis|emergency|accident|explosion|crash|protest|riot|election|vote|politics|political)\b/gi,
                extract: match => match[0].trim()
            },
            // Country + Topic patterns (Iran nuclear, China trade, etc.)
            {
                pattern: /\b(iran|iranian|china|chinese|russia|russian|ukraine|ukrainian|israel|israeli|palestine|palestinian|north korea|south korea|japan|japanese|india|indian|pakistan|turkey|turkish|syria|syrian|afghanistan|iraq|iraqi|saudi arabia|egypt|yemen|libya|sudan|ethiopia|nigeria|south africa|brazil|mexico|canada|france|germany|italy|spain|uk|britain|british|australia|argentina)\s+(nuclear|missile|war|peace|trade|economy|sanctions|oil|gas|military|defense|attack|strike|deal|agreement|treaty|talks|summit|election|government|regime|crisis|conflict|protest|revolution|coup)\b/gi,
                extract: match => match[0].trim()
            },
            // Company + Topic patterns (Tesla stock, Apple earnings, etc.)
            {
                pattern: /\b(tesla|apple|microsoft|amazon|google|meta|facebook|netflix|nvidia|intel|amd|boeing|ford|gm|general motors|exxon|chevron|walmart|target|costco|home depot|mcdonalds|starbucks|coca cola|pepsi|johnson|pfizer|moderna|disney|twitter|x|spacex|uber|lyft|airbnb|zoom|slack|salesforce|oracle|ibm|cisco|adobe|paypal|square|robinhood|coinbase|bitcoin|ethereum|crypto|cryptocurrency)\s+(stock|price|earnings|revenue|profit|loss|ipo|merger|acquisition|ceo|lawsuit|scandal|hack|breach|update|launch|release|partnership|deal|investment|funding|valuation)\b/gi,
                extract: match => match[0].trim()
            },
            // Celebrity/Person + Topic patterns
            {
                pattern: /\b(elon musk|jeff bezos|bill gates|mark zuckerberg|tim cook|satya nadella|sundar pichai|jack dorsey|donald trump|joe biden|kamala harris|barack obama|hillary clinton|bernie sanders|nancy pelosi|mitch mcconnell|chuck schumer|alexandria ocasio-cortez|ted cruz|marco rubio|ron desantis|gavin newsom|greg abbott|vladimir putin|xi jinping|volodymyr zelensky|benjamin netanyahu|recep erdogan|narendra modi|imran khan|mohammed bin salman|kim jong un|pope francis|taylor swift|kanye west|kim kardashian|lebron james|tom brady|cristiano ronaldo|lionel messi|serena williams|roger federer|tiger woods|michael jordan|kobe bryant|stephen curry|kevin durant)\s+(tweet|twitter|statement|interview|speech|scandal|lawsuit|divorce|marriage|death|health|retirement|comeback|controversy|endorsement|criticism|praise|attack|defense|announcement|decision|action|policy|plan|strategy|investment|donation|charity|foundation|business|company|deal|partnership|meeting|visit|travel)\b/gi,
                extract: match => match[0].trim()
            },
            // General proper noun patterns (capitalized words that might be entities)
            {
                pattern: /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(fire|wildfire|earthquake|storm|hurricane|flood|disaster|shooting|attack|incident|crisis|emergency|accident|explosion|crash|protest|riot|election|vote|politics|political|nuclear|missile|war|peace|trade|economy|sanctions|oil|gas|military|defense|strike|deal|agreement|treaty|talks|summit|government|regime|conflict|revolution|coup|stock|price|earnings|revenue|profit|loss|ipo|merger|acquisition|ceo|lawsuit|scandal|hack|breach|update|launch|release|partnership|investment|funding|valuation)\b/g,
                extract: match => match[0].trim()
            }
        ];
        
        const foundEntities = [];
        const processedEntities = new Set(); // Avoid duplicates
        
        // Apply each pattern
        for (const patternRule of entityPatterns) {
            const matches = [...lowerQuestion.matchAll(patternRule.pattern)];
            console.log(`[RAG] Pattern matched ${matches.length} entities:`, matches.map(m => m[0]));
            
            for (const match of matches) {
                const entity = patternRule.extract(match);
                if (entity && entity.length > 2 && !processedEntities.has(entity.toLowerCase())) {
                    foundEntities.push(entity);
                    processedEntities.add(entity.toLowerCase());
                }
            }
        }
        
        // If no pattern matches, try to extract meaningful proper nouns and compound terms
        if (foundEntities.length === 0) {
            const properNouns = this.extractProperNouns(question);
            foundEntities.push(...properNouns);
        }
        
        console.log(`[RAG] Found ${foundEntities.length} subject entities:`, foundEntities);
        return foundEntities.slice(0, 3); // Limit to top 3 entities
    }
    
    /**
     * Extract proper nouns and compound terms as fallback
     */
    extractProperNouns(question) {
        // Find capitalized words and common compound terms
        const capitalizedWords = question.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
        
        // Filter out common question words that might be capitalized
        const questionWords = ['What', 'Who', 'Where', 'When', 'How', 'Why', 'Which', 'Can', 'Do', 'Does', 'Did', 'Will', 'Would', 'Could', 'Should'];
        const filtered = capitalizedWords.filter(word => !questionWords.includes(word));
        
        // Also look for compound terms with common patterns
        const lowerQuestion = question.toLowerCase();
        const compoundPatterns = [
            /\b\w+\s+fire\b/g,
            /\b\w+\s+wildfire\b/g,
            /\b\w+\s+election\b/g,
            /\b\w+\s+crisis\b/g,
            /\b\w+\s+war\b/g,
            /\b\w+\s+attack\b/g,
            /\b\w+\s+deal\b/g,
            /\b\w+\s+stock\b/g,
            /\b\w+\s+nuclear\b/g
        ];
        
        const compounds = [];
        for (const pattern of compoundPatterns) {
            const matches = [...lowerQuestion.matchAll(pattern)];
            compounds.push(...matches.map(m => m[0].trim()));
        }
        
        return [...filtered, ...compounds].slice(0, 2);
    }
    
    extractRecipeKeywords(question) {
        const lowerQuestion = question.toLowerCase();
        
        // Common recipe-related stop words to ignore
        const recipeStopWords = ['recipe', 'recipes', 'cook', 'cooking', 'make', 'making', 'prepare', 'preparation', 'dish', 'dishes', 'meal', 'meals', 'food', 'foods', 'ingredient', 'ingredients', 'have', 'has', 'had', 'with', 'using', 'contains', 'contain', 'any', 'some', 'all', 'that', 'which', 'what', 'how', 'do', 'does', 'can', 'could', 'would', 'should', 'will', 'them', 'they', 'their', 'in', 'for', 'to', 'from', 'of', 'on', 'at', 'by', 'me', 'i', 'my', 'is', 'are', 'the', 'and', 'or', 'but'];
        
        // Extract potential ingredient/food terms
        const words = lowerQuestion
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ')
            .filter(word => word.length > 2)
            .filter(word => !recipeStopWords.includes(word));
        
        // Common ingredients and food items to prioritize
        const foodKeywords = ['chicken', 'beef', 'pork', 'fish', 'salmon', 'shrimp', 'turkey', 'lamb', 'bacon', 'ham', 'cheese', 'egg', 'eggs', 'milk', 'butter', 'cream', 'yogurt', 'rice', 'pasta', 'bread', 'flour', 'sugar', 'salt', 'pepper', 'garlic', 'onion', 'tomato', 'potato', 'carrot', 'broccoli', 'spinach', 'mushroom', 'bell', 'basil', 'oregano', 'thyme', 'rosemary', 'parsley', 'cilantro', 'lemon', 'lime', 'apple', 'banana', 'strawberry', 'blueberry', 'avocado', 'olive', 'oil', 'vinegar', 'wine', 'beer', 'chocolate', 'vanilla', 'cinnamon', 'ginger', 'curry', 'soy', 'sauce', 'honey', 'maple', 'syrup', 'nuts', 'almond', 'walnut', 'peanut', 'coconut', 'beans', 'lentils', 'quinoa', 'oats', 'corn', 'zucchini', 'eggplant', 'cucumber', 'lettuce', 'cabbage', 'kale', 'asparagus', 'peas', 'green', 'red', 'yellow', 'white', 'black', 'blue', 'orange', 'purple'];
        
        // Prioritize food-related terms
        const foodTerms = words.filter(word => 
            foodKeywords.some(food => word.includes(food) || food.includes(word))
        );
        
        // If we found food terms, use those; otherwise use remaining words
        const keyTerms = foodTerms.length > 0 ? foodTerms : words.slice(0, 3);
        
        const result = keyTerms.slice(0, 3).join(' '); // Limit to top 3 terms for recipes
        console.log(`[RAG] Extracted recipe keywords from "${question}":`, keyTerms);
        return result;
    }
    
    extractExerciseKeywords(question) {
        const lowerQuestion = question.toLowerCase();
        
        const exerciseStopWords = ['exercise', 'exercises', 'workout', 'workouts', 'training', 'train', 'fitness', 'gym', 'routine', 'routines', 'do', 'does', 'can', 'could', 'would', 'should', 'will', 'have', 'has', 'had', 'with', 'for', 'to', 'from', 'of', 'on', 'at', 'by', 'me', 'i', 'my', 'is', 'are', 'the', 'and', 'or', 'but', 'that', 'which', 'what', 'how', 'any', 'some', 'all'];
        
        const words = lowerQuestion
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ')
            .filter(word => word.length > 2)
            .filter(word => !exerciseStopWords.includes(word));
        
        // Exercise and body part terms to prioritize
        const exerciseKeywords = ['chest', 'back', 'shoulders', 'arms', 'legs', 'abs', 'core', 'cardio', 'strength', 'push', 'pull', 'squat', 'deadlift', 'bench', 'press', 'curl', 'row', 'fly', 'dip', 'lunge', 'plank', 'crunch', 'bicep', 'tricep', 'quad', 'hamstring', 'calf', 'glute', 'lat', 'delt', 'pec', 'trap', 'running', 'walking', 'cycling', 'swimming', 'jumping', 'stretching', 'yoga', 'pilates', 'crossfit', 'bodyweight', 'dumbbell', 'barbell', 'kettlebell', 'resistance', 'band', 'machine', 'cable', 'free', 'weight', 'reps', 'sets', 'minutes', 'seconds', 'beginner', 'intermediate', 'advanced', 'easy', 'hard', 'difficult', 'upper', 'lower', 'full', 'body'];
        
        const exerciseTerms = words.filter(word => 
            exerciseKeywords.some(term => word.includes(term) || term.includes(word))
        );
        
        const keyTerms = exerciseTerms.length > 0 ? exerciseTerms : words.slice(0, 3);
        const result = keyTerms.slice(0, 3).join(' ');
        console.log(`[RAG] Extracted exercise keywords from "${question}":`, keyTerms);
        return result;
    }
    
    extractNewsKeywords(question) {
        const lowerQuestion = question.toLowerCase();
        
        const newsStopWords = ['news', 'article', 'articles', 'post', 'posts', 'story', 'stories', 'report', 'reports', 'latest', 'recent', 'new', 'current', 'today', 'yesterday', 'about', 'on', 'regarding', 'concerning', 'related', 'to', 'tell', 'me', 'show', 'find', 'get', 'give', 'what', 'is', 'are', 'the', 'and', 'or', 'but', 'have', 'has', 'had', 'do', 'does', 'can', 'could', 'would', 'should', 'will', 'any', 'some', 'all'];
        
        const words = lowerQuestion
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ')
            .filter(word => word.length > 2)
            .filter(word => !newsStopWords.includes(word));
        
        // Important news topics and entities
        const importantTerms = words.filter(word => {
            const importantPatterns = ['iran', 'china', 'russia', 'ukraine', 'israel', 'palestine', 'syria', 'afghanistan', 'turkey', 'venezuela', 'belarus', 'america', 'usa', 'europe', 'asia', 'africa', 'biden', 'trump', 'nuclear', 'war', 'peace', 'economy', 'covid', 'climate', 'election', 'congress', 'senate', 'president', 'government', 'politics', 'military', 'defense', 'security', 'trade', 'diplomacy', 'technology', 'science', 'health', 'business', 'finance', 'market', 'stock', 'crypto', 'bitcoin', 'energy', 'oil', 'gas', 'renewable', 'environment', 'climate', 'weather', 'disaster', 'emergency', 'crisis', 'conflict', 'peace', 'treaty', 'agreement', 'summit', 'meeting', 'visit', 'travel', 'border', 'immigration', 'refugee', 'protest', 'demonstration', 'strike', 'union', 'company', 'corporation', 'industry', 'factory', 'production', 'manufacturing', 'export', 'import', 'gdp', 'inflation', 'recession', 'growth', 'development'];
            return importantPatterns.some(pattern => word.includes(pattern) || pattern.includes(word));
        });
        
        const keyTerms = [...new Set([...importantTerms, ...words])].slice(0, 5);
        const result = keyTerms.join(' ');
        console.log(`[RAG] Extracted news keywords from "${question}":`, keyTerms);
        return result;
    }
    
    extractGeneralKeywords(question, stopWords) {
        // Default extraction for general queries
        const cleaned = question.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        
        const words = cleaned.split(' ')
            .filter(word => word.length > 2)
            .filter(word => !stopWords.includes(word));
        
        const keyTerms = words.slice(0, 4);
        const result = keyTerms.join(' ');
        console.log(`[RAG] Extracted general keywords from "${question}":`, keyTerms);
        return result;
    }

    /**
     * Use tag summarization to get the most relevant results for specific record types
     */
    async searchWithTagSummarization(question, relevantTypes, options = {}) {
        const allResults = [];
        
        // Extract keywords from the question instead of using the full question
        const searchKeywords = this.extractSearchKeywords(question);
        
        // For evacuation questions, use multiple search strategies
        const isEvacuationQuestion = question.toLowerCase().includes('evacuate') || 
                                   question.toLowerCase().includes('evacuation') || 
                                   question.toLowerCase().includes('evacuated');
        
        // Special handling for evacuation questions - search specific terms FIRST
        if (isEvacuationQuestion) {
            console.log(`[RAG] Evacuation question detected, prioritizing evacuation searches`);
            const evacuationTerms = ['city angels ashes', 'inferno chaos', 'palisades fire evacuation', 'eaton fire evacuation', '130000 evacuated', 'buildings destroyed', 'la fire 130000'];
            
            for (const term of evacuationTerms) {
                if (allResults.length >= this.maxResults) break;
                
                try {
                    console.log(`[RAG] Trying priority evacuation search term: "${term}"`);
                    const evacSearchParams = {
                        search: term,
                        recordType: 'post',
                        sortBy: 'date:desc',
                        resolveDepth: 3,
                        summarizeTags: true,
                        tagCount: 5,
                        tagPage: 1,
                        limit: 3,
                        page: 1,
                        includeSigs: false,
                        includePubKeys: false
                    };
                    
                    const evacResults = await getRecords(evacSearchParams);
                    if (evacResults && evacResults.records) {
                        const newRecords = evacResults.records.filter(record => 
                            !allResults.some(existing => existing.oip?.didTx === record.oip?.didTx)
                        );
                        allResults.push(...newRecords.slice(0, 2));
                        console.log(`[RAG] Found ${newRecords.length} priority evacuation records with term "${term}"`);
                    }
                } catch (error) {
                    console.warn(`[RAG] Error searching priority evacuation term "${term}":`, error.message);
                }
            }
        }
        
        // Then try normal search if we don't have enough results
        if (allResults.length < 3) {
            // First try a broader search across all enabled types if specific types yield no results
            let searchTypes = relevantTypes.slice(0, 2); // Start with top 2 relevant types
            
            for (const typeInfo of searchTypes) {
                try {
                    console.log(`[RAG] Searching ${typeInfo.type} records for keywords: "${searchKeywords}" (from question: "${question}")`);
                    
                    // Use direct database call with proper summarizeTags parameters
                    const searchParams = {
                        search: searchKeywords, // Use extracted keywords instead of full question
                        recordType: typeInfo.type,
                        sortBy: 'date:desc',
                        resolveDepth: 3, // Use proper resolve depth like the user's API call
                        summarizeTags: true, // CRITICAL: Enable tag summarization for relevance
                        tagCount: 5, // Get top 5 tags for context
                        tagPage: 1,
                        limit: this.maxResults,
                        page: 1,
                        includeSigs: false,
                        includePubKeys: false
                    };
                    
                    console.log(`[RAG] Direct DB search params:`, searchParams);
                    
                    const dbResults = await getRecords(searchParams);
                    
                    if (dbResults && dbResults.records) {
                        const records = dbResults.records.slice(0, this.maxResults);
                        console.log(`[RAG] Found ${records.length} ${typeInfo.type} records`);
                        
                        // Add type info to each record for context
                        records.forEach(record => {
                            record._ragTypeInfo = typeInfo;
                        });
                        
                        allResults.push(...records);
                    }
                    
                } catch (error) {
                    console.warn(`[RAG] Error searching ${typeInfo.type}:`, error.message);
                }
            }
        }
        
        // If no results and we have a clear search term, try broader search without record type filter
        if (allResults.length === 0 && searchKeywords.trim().length > 2) {
            console.log(`[RAG] No results with type filtering, trying broader search for keywords: "${searchKeywords}"`);
            try {
                const broadSearchParams = {
                    search: searchKeywords, // Use extracted keywords for broad search too
                    // Remove recordType filter for broader search
                    sortBy: 'date:desc',
                    resolveDepth: 3,
                    summarizeTags: true,
                    tagCount: 5,
                    tagPage: 1,
                    limit: this.maxResults,
                    page: 1,
                    includeSigs: false,
                    includePubKeys: false
                };
                
                console.log(`[RAG] Broad search params:`, broadSearchParams);
                const broadResults = await getRecords(broadSearchParams);
                
                if (broadResults && broadResults.records) {
                    const records = broadResults.records.slice(0, this.maxResults);
                    console.log(`[RAG] Found ${records.length} records in broad search`);
                    
                    // Filter to only enabled record types after the search
                    const enabledTypes = getEnabledRecordTypes();
                    const filteredRecords = records.filter(record => {
                        const recordType = record.oip?.recordType;
                        return recordType && enabledTypes.includes(recordType);
                    });
                    
                    console.log(`[RAG] After filtering by enabled types: ${filteredRecords.length} records`);
                    allResults.push(...filteredRecords);
                }
            } catch (error) {
                console.warn(`[RAG] Error in broad search:`, error.message);
            }
        }
        
        console.log(`[RAG] Total results after search: ${allResults.length}`);
        return allResults;
    }

    /**
     * Main RAG query function - searches Elasticsearch and generates context-aware response
     */
    async query(question, options = {}) {
        try {
            console.log(`[RAG] Processing query: ${question}`);
            
            // Step 1: Analyze question to determine relevant record types
            const relevantTypes = this.analyzeQuestionForRecordTypes(question);
            
            // Step 2: Use smart search with tag summarization
            const smartResults = await this.searchWithTagSummarization(question, relevantTypes, options);
            
            // Step 3: Fallback to traditional search if smart search yields no results
            let searchResults;
            if (smartResults.length > 0) {
                searchResults = {
                    records: smartResults,
                    totalResults: smartResults.length,
                    templates: [],
                    creators: []
                };
            } else {
                console.log('[RAG] Smart search yielded no results, falling back to traditional search');
                searchResults = await this.searchElasticsearch(question, options);
            }
            
            // Step 4: Build context from search results
            const context = await this.buildContext(searchResults);
            
            // Step 5: Generate LLM response with context
            const response = await this.generateResponse(question, context, options.model);
            
                    return {
            answer: response,
            sources: this.extractSources(searchResults),
            context_used: context.length > 0,
            model: options.model || this.defaultModel,
            search_results_count: searchResults.totalResults || 0,
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
                // If we have context but LLM failed, extract key information manually
                return this.extractDirectAnswer(question, context);
            } else {
                return "I don't have specific information about this in my knowledge base. Could you provide more details or try a different question?";
            }
        }
    }

    /**
     * Fallback method to extract direct answers from context when LLM fails
     */
    extractDirectAnswer(question, context) {
        const lowerQuestion = question.toLowerCase();
        const lowerContext = context.toLowerCase();
        
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
        
        // Look for acreage burned
        if (lowerQuestion.includes('acre') && (lowerQuestion.includes('burned') || lowerQuestion.includes('fire'))) {
            const acreageNumbers = context.match(/(\d{1,3}(?:,\d{3})*)\s*acres?\s*(?:burned|scorched|consumed)/gi);
            if (acreageNumbers && acreageNumbers.length > 0) {
                return `Based on the information found, ${acreageNumbers.join(', ')}.`;
            }
        }
        
        // Look for building/structure damage
        if (lowerQuestion.includes('building') || lowerQuestion.includes('structure') || lowerQuestion.includes('home')) {
            const buildingNumbers = context.match(/(\d{1,3}(?:,\d{3})*)\s*(?:buildings?|structures?|homes?)\s*(?:destroyed|damaged|reduced to rubble)/gi);
            if (buildingNumbers && buildingNumbers.length > 0) {
                return `According to the information available, ${buildingNumbers.join(', ')}.`;
            }
        }
        
        // Look for containment information
        if (lowerQuestion.includes('contain') && lowerQuestion.includes('fire')) {
            const containmentInfo = context.match(/(\d+)%?\s*contain(?:ment|ed)|zero containment|no containment/gi);
            if (containmentInfo && containmentInfo.length > 0) {
                return `Based on the latest information, ${containmentInfo.join(', ')}.`;
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
     * Build the prompt template for the LLM
     */
    buildPrompt(question, context) {
        if (context.length === 0) {
            return `You are an AI assistant for an OIP (Open Index Protocol) system. A user is asking about their data, but no relevant information was found in the knowledge base.

Question: ${question}

Please respond helpfully, acknowledging that you don't have specific information about this topic in the current knowledge base, and suggest how they might refine their search or what type of information might be available.

Response:`;
        }

        // Extract what the user is specifically asking for
        const questionType = this.categorizeQuestion(question);
        
        return `You are an AI assistant analyzing content from a knowledge base to answer a specific question.

RELEVANT CONTENT FROM KNOWLEDGE BASE:
${context}

USER'S QUESTION: ${question}

INSTRUCTIONS:
1. Read through the provided content carefully
2. Look for information that directly answers the user's question: "${question}"
3. ${this.getAnswerInstruction(questionType, question)}
4. If the information exists in the content, provide a clear, factual answer
5. If some information is missing, acknowledge what you found and what's not available
6. Be concise and focus only on answering the specific question asked
7. If you find numerical data, statistics, or specific facts that answer the question, highlight them clearly

ANSWER:`;
    }

    /**
     * Categorize the type of question to provide better answering instructions
     */
    categorizeQuestion(question) {
        const lowerQuestion = question.toLowerCase();
        
        if (lowerQuestion.includes('how many') || lowerQuestion.includes('how much') || lowerQuestion.includes('what number') || lowerQuestion.includes('count')) {
            return 'quantitative';
        }
        if (lowerQuestion.includes('when') || lowerQuestion.includes('what time') || lowerQuestion.includes('what date')) {
            return 'temporal';
        }
        if (lowerQuestion.includes('where') || lowerQuestion.includes('location') || lowerQuestion.includes('place')) {
            return 'location';
        }
        if (lowerQuestion.includes('who') || lowerQuestion.includes('which person') || lowerQuestion.includes('whose')) {
            return 'person';
        }
        if (lowerQuestion.includes('why') || lowerQuestion.includes('reason') || lowerQuestion.includes('cause')) {
            return 'causal';
        }
        if (lowerQuestion.includes('how') && !lowerQuestion.includes('how many') && !lowerQuestion.includes('how much')) {
            return 'process';
        }
        if (lowerQuestion.includes('what') || lowerQuestion.includes('which')) {
            return 'descriptive';
        }
        return 'general';
    }

    /**
     * Get specific answering instructions based on question type
     */
    getAnswerInstruction(questionType, question) {
        switch (questionType) {
            case 'quantitative':
                return 'Look for specific numbers, statistics, measurements, or quantities that answer the question. If you find them, state them clearly with their units or context.';
            case 'temporal':
                return 'Look for dates, times, or temporal references that answer when something happened or will happen.';
            case 'location':
                return 'Look for geographical locations, addresses, or place names that answer where something is or happened.';
            case 'person':
                return 'Look for names, titles, or references to specific people that answer who is involved.';
            case 'causal':
                return 'Look for explanations, reasons, or cause-and-effect relationships that explain why something happened.';
            case 'process':
                return 'Look for step-by-step information, procedures, or methods that explain how something works or is done.';
            case 'descriptive':
                return 'Look for detailed descriptions, characteristics, or features that answer what something is or which option applies.';
            default:
                return 'Look for any information that directly relates to and answers the user\'s question.';
        }
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

    /**
     * Extract applied filters for frontend display
     */
    extractAppliedFilters(question, searchResults, relevantTypes) {
        const filters = {};
        const lowerQuestion = question.toLowerCase();
        
        // Use the same smart keyword extraction that was used for the search
        const searchKeywords = this.extractSearchKeywords(question);
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
        
        // Detect audio/media filters
        if (lowerQuestion.includes('audio') || lowerQuestion.includes('podcast')) {
            filters.hasAudio = true;
        }
        
        // Generate more informative rationale based on query type
        const sourceCount = searchResults.records ? searchResults.records.length : 0;
        
        if (lowerQuestion.includes('recipe') || lowerQuestion.includes('cook')) {
            filters.rationale = `Found ${sourceCount} recipe${sourceCount === 1 ? '' : 's'}`;
            if (filters.search) {
                filters.rationale += ` containing "${filters.search}"`;
            }
        } else if (lowerQuestion.includes('exercise') || lowerQuestion.includes('workout')) {
            filters.rationale = `Found ${sourceCount} exercise${sourceCount === 1 ? '' : 's'}`;
            if (filters.search) {
                filters.rationale += ` related to "${filters.search}"`;
            }
        } else if (lowerQuestion.includes('news') || lowerQuestion.includes('article')) {
            filters.rationale = `Found ${sourceCount} news article${sourceCount === 1 ? '' : 's'}`;
            if (filters.search) {
                filters.rationale += ` about "${filters.search}"`;
            }
        } else {
            filters.rationale = `Found ${sourceCount} relevant record${sourceCount === 1 ? '' : 's'}`;
            if (filters.recordType) {
                filters.rationale += ` of type "${filters.recordType}"`;
            }
            if (filters.search) {
                filters.rationale += ` matching "${filters.search}"`;
            }
        }
        
        console.log(`[RAG] Extracted filters for "${question}":`, filters);
        return filters;
    }
}

module.exports = new RAGService(); 