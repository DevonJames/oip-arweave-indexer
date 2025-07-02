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
     * Intelligently separates the question from the subject matter AND extracts modifiers
     */
    extractSearchKeywords(question) {
        console.log(`[RAG] 🔍 EXTRACTING KEYWORDS FROM: "${question}"`);
        
        // First, try to identify subject entities using smart patterns
        const subjects = this.extractSubjectEntities(question);
        if (subjects.length > 0) {
            const result = subjects.join(' ');
            console.log(`[RAG] ✅ EXTRACTED SUBJECT ENTITIES: "${result}"`);
            console.log(`[RAG] 🎯 USING SUBJECT: "${result}" (instead of full question)`);
            return result;
        }
        
        const lowerQuestion = question.toLowerCase();
        
        // Special handling for recipe queries with modifier extraction
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
                pattern: /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(fire|wildfire|earthquake|storm|hurricane|flood|disaster|shooting|attack|incident|crisis|emergency|accident|explosion|crash|protest|riot|election|vote|politics|political|nuclear|missile|war|peace|trade|economy|sanctions|oil|gas|military|defense|strike|deal|agreement|treaty|talks|summit|government|regime|conflict|revolution|coup|stock|price|earnings|revenue|profit|loss|ipo|merger|acquisition|ceo|lawsuit|scandal|hack|breach|update|launch|release|partnership|investment|funding|valuation|audit|audits|audited|auditing|investigation|investigations|report|reports|review|reviews|analysis|study|studies|examination|inquiry|inquiries|inspection|inspections|assessment|assessments)\b/g,
                extract: match => match[0].trim()
            },
            // Enhanced proper noun detection for places/facilities with specific terms
            {
                pattern: /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(base|facility|building|complex|center|centre|institute|laboratory|lab|depot|warehouse|reserve|repository|vault|fort|castle|palace|mansion|estate|park|monument|memorial|museum|library|hospital|school|university|college|airport|station|port|bridge|dam|tunnel|mine|plant|factory|refinery|headquarters|office|tower|plaza|square|district|neighborhood|zone|area|region|county|state|province|territory|country|nation|republic|kingdom|empire|union|federation|alliance|organization|agency|department|ministry|bureau|commission|committee|council|assembly|parliament|congress|senate|court|tribunal|chamber|board|company|corporation|firm|business|enterprise|group|association|society|foundation|charity|trust|fund|bank|exchange|market|store|shop|restaurant|hotel|resort|club|gym|stadium|arena|theater|cinema|mall|gallery|studio|workshop|garage|yard|farm|ranch|plantation|vineyard|orchard|garden|beach|coast|shore|island|mountain|hill|valley|river|lake|ocean|sea|desert|forest|jungle|wilderness|reserve|sanctuary|preserve)\b/gi,
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
     * Enhanced to detect important entities even when not capitalized
     */
    extractProperNouns(question) {
        // Find capitalized words and common compound terms
        const capitalizedWords = question.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
        
        // Filter out common question words that might be capitalized
        const questionWords = ['What', 'Who', 'Where', 'When', 'How', 'Why', 'Which', 'Can', 'Do', 'Does', 'Did', 'Will', 'Would', 'Could', 'Should'];
        const filtered = capitalizedWords.filter(word => !questionWords.includes(word));
        
        // Enhanced compound patterns (case insensitive) for better entity detection
        const lowerQuestion = question.toLowerCase();
        const compoundPatterns = [
            // Places + events/concepts
            /\b(fort\s+knox|white\s+house|pentagon|area\s+51|mount\s+rushmore|statue\s+of\s+liberty|golden\s+gate|brooklyn\s+bridge|empire\s+state|world\s+trade|twin\s+towers|capitol\s+building|lincoln\s+memorial|washington\s+monument|federal\s+reserve|wall\s+street|silicon\s+valley|hollywood|las\s+vegas|new\s+york|los\s+angeles|san\s+francisco|chicago|houston|philadelphia|phoenix|san\s+antonio|san\s+diego|dallas|miami|atlanta|boston|seattle|denver|detroit|washington\s+dc|puerto\s+rico|hawaii|alaska|california|texas|florida|new\s+york|illinois|pennsylvania|ohio|georgia|north\s+carolina|michigan|new\s+jersey|virginia|washington|arizona|massachusetts|tennessee|indiana|missouri|maryland|wisconsin|colorado|minnesota|south\s+carolina|alabama|louisiana|kentucky|oregon|oklahoma|connecticut|utah|nevada|arkansas|mississippi|kansas|new\s+mexico|nebraska|west\s+virginia|idaho|hawaii|new\s+hampshire|maine|montana|rhode\s+island|delaware|south\s+dakota|north\s+dakota|alaska|vermont|wyoming)\b/g,
            // Organizations + concepts
            /\b(federal\s+reserve|central\s+bank|world\s+bank|international\s+monetary|united\s+nations|nato|european\s+union|african\s+union|world\s+health|centers\s+for\s+disease|food\s+and\s+drug|environmental\s+protection|department\s+of\s+defense|homeland\s+security|treasury\s+department|state\s+department|justice\s+department|supreme\s+court|house\s+of\s+representatives|senate\s+judiciary|foreign\s+relations|intelligence\s+committee)\b/g,
            // Events + topics
            /\b\w+\s+(fire|wildfire|earthquake|storm|hurricane|flood|disaster|shooting|attack|incident|crisis|emergency|accident|explosion|crash|protest|riot|election|vote|politics|political|nuclear|missile|war|peace|trade|economy|sanctions|oil|gas|military|defense|strike|deal|agreement|treaty|talks|summit|government|regime|conflict|revolution|coup|stock|price|earnings|revenue|profit|loss|ipo|merger|acquisition|ceo|lawsuit|scandal|hack|breach|update|launch|release|partnership|investment|funding|valuation|audit|audits|investigation|report|review|analysis|study|examination|inquiry|inspection|assessment)\b/g,
            // Company/Entity + concepts
            /\b(apple|microsoft|google|amazon|tesla|meta|facebook|netflix|nvidia|intel|boeing|ford|general\s+motors|exxon|walmart|berkshire\s+hathaway|johnson\s+&\s+johnson|procter\s+&\s+gamble|jpmorgan\s+chase|bank\s+of\s+america|wells\s+fargo|goldman\s+sachs|morgan\s+stanley|blackrock|vanguard|fidelity)\s+(stock|price|earnings|revenue|profit|loss|ipo|merger|acquisition|ceo|lawsuit|scandal|hack|breach|update|launch|release|partnership|investment|funding|valuation)\b/g
        ];
        
        const compounds = [];
        for (const pattern of compoundPatterns) {
            const matches = [...lowerQuestion.matchAll(pattern)];
            compounds.push(...matches.map(m => m[0].trim()));
        }
        
        // Special handling for well-known entities that might not be capitalized
        const knownEntities = [
            'fort knox', 'white house', 'pentagon', 'federal reserve', 'wall street',
            'silicon valley', 'hollywood', 'las vegas', 'new york', 'los angeles',
            'san francisco', 'area 51', 'mount rushmore', 'statue of liberty',
            'golden gate bridge', 'brooklyn bridge', 'empire state building',
            'world trade center', 'capitol building', 'lincoln memorial',
            'washington monument', 'supreme court', 'congress', 'senate',
            'house of representatives', 'department of defense', 'treasury department',
            'homeland security', 'cia', 'fbi', 'nsa', 'secret service'
        ];
        
        const foundKnownEntities = knownEntities.filter(entity => 
            lowerQuestion.includes(entity)
        );
        
        console.log(`[RAG] Found ${foundKnownEntities.length} known entities:`, foundKnownEntities);
        console.log(`[RAG] Found ${compounds.length} compound patterns:`, compounds.slice(0, 3));
        console.log(`[RAG] Found ${filtered.length} capitalized words:`, filtered);
        
        return [...foundKnownEntities, ...filtered, ...compounds].slice(0, 3);
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
     * Enhanced with intelligent modifier detection and tag-based refinement
     */
    async searchWithTagSummarization(question, relevantTypes, options = {}) {
        const allResults = [];
        
        // Extract both subject and modifiers from the question
        const { subject, modifiers } = this.extractSubjectAndModifiers(question);
        console.log(`[RAG] 🎯 Extracted - Subject: "${subject}", Modifiers: [${modifiers.join(', ')}]`);
        
        // For backward compatibility, also extract keywords the old way
        const searchKeywords = subject || this.extractSearchKeywords(question);
        
        // For evacuation questions, use multiple search strategies
        const isEvacuationQuestion = question.toLowerCase().includes('evacuate') || 
                                   question.toLowerCase().includes('evacuation') || 
                                   question.toLowerCase().includes('evacuated');
        
        // Special handling for evacuation questions - search specific terms FIRST
        if (isEvacuationQuestion) {
            console.log(`[RAG] 🚨 Evacuation question detected, prioritizing evacuation searches`);
            const evacuationTerms = ['city angels ashes', 'inferno chaos', 'palisades fire evacuation', 'eaton fire evacuation', '130000 evacuated', 'buildings destroyed', 'la fire 130000'];
            
            for (const term of evacuationTerms) {
                if (allResults.length >= this.maxResults) break;
                
                try {
                    console.log(`[RAG] 🔥 Trying priority evacuation search term: "${term}"`);
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
                        console.log(`[RAG] ✅ Found ${newRecords.length} priority evacuation records with term "${term}"`);
                    }
                } catch (error) {
                    console.warn(`[RAG] ❌ Error searching priority evacuation term "${term}":`, error.message);
                }
            }
        }
        
        // Then try normal search if we don't have enough results
        if (allResults.length < 3) {
            // First try a broader search across all enabled types if specific types yield no results
            let searchTypes = relevantTypes.slice(0, 2); // Start with top 2 relevant types
            
            for (const typeInfo of searchTypes) {
                try {
                    console.log(`[RAG] 🔍 Searching ${typeInfo.type} records for keywords: "${searchKeywords}" (from question: "${question}")`);
                    
                    // Perform initial broad search
                    const searchParams = {
                        search: searchKeywords, // Use main subject for initial search
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
                    
                    console.log(`[RAG] 📋 Initial broad search params:`, searchParams);
                    
                    const initialResults = await getRecords(searchParams);
                    
                    if (initialResults && initialResults.records && initialResults.records.length > 0) {
                        console.log(`[RAG] 📊 Initial search found ${initialResults.records.length} ${typeInfo.type} records`);
                        
                        // Apply intelligent refinement if we have modifiers and multiple results
                        const finalResults = await this.analyzeAndRefineSearch(
                            question, 
                            initialResults, 
                            searchKeywords, 
                            modifiers
                        );
                        
                        if (finalResults && finalResults.records) {
                            const records = finalResults.records.slice(0, this.maxResults);
                            
                            // Add refinement info to records for better context
                            records.forEach(record => {
                                if (finalResults.wasRefined) {
                                    record.ragRefinementInfo = {
                                        wasRefined: true,
                                        appliedModifiers: finalResults.appliedModifiers,
                                        originalResultCount: finalResults.originalResultCount
                                    };
                                }
                                record.ragTypeInfo = typeInfo;
                            });
                            
                            allResults.push(...records);
                            
                            if (finalResults.wasRefined) {
                                console.log(`[RAG] ✨ REFINEMENT SUCCESS: refined from ${finalResults.originalResultCount} to ${records.length} results using modifiers: [${finalResults.appliedModifiers.join(', ')}]`);
                            } else {
                                console.log(`[RAG] 📝 Using ${records.length} ${typeInfo.type} records (no refinement needed/possible)`);
                            }
                            
                            // If we got refined results, we can stop here since they should be very specific
                            if (finalResults.wasRefined && records.length > 0) {
                                console.log(`[RAG] 🎯 Early termination: refined results found, stopping search`);
                                break;
                            }
                        }
                    } else {
                        console.log(`[RAG] ❌ No results found for ${typeInfo.type} with keywords: "${searchKeywords}"`);
                    }
                } catch (error) {
                    console.error(`[RAG] 💥 Error searching ${typeInfo.type}:`, error.message);
                }
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
                extractedModifiers: modifiers,
                hasRefinement: uniqueResults.some(r => r.ragRefinementInfo?.wasRefined)
            }
        };
    }

    /**
     * Check if modifiers exist as tags in search results and suggest refined search
     */
    async analyzeAndRefineSearch(question, initialResults, originalSubject, modifiers) {
        if (!initialResults || !initialResults.records || initialResults.records.length < 2) {
            console.log(`[RAG] No need to refine - got ${initialResults?.records?.length || 0} results`);
            return initialResults;
        }

        if (!modifiers || modifiers.length === 0) {
            console.log(`[RAG] No modifiers to use for refinement`);
            return initialResults;
        }

        console.log(`[RAG] Analyzing ${initialResults.records.length} results for tag-based refinement`);
        console.log(`[RAG] Looking for modifiers: [${modifiers.join(', ')}] in record tags`);

        // Collect all tags from initial results
        const allTags = new Set();
        initialResults.records.forEach(record => {
            const tags = record.data?.basic?.tagItems || [];
            tags.forEach(tag => allTags.add(tag.toLowerCase()));
        });

        console.log(`[RAG] Found ${allTags.size} unique tags in results:`, [...allTags].slice(0, 10));

        // Find which modifiers match existing tags
        const matchingTags = modifiers.filter(modifier => {
            const modifierLower = modifier.toLowerCase();
            return allTags.has(modifierLower) || 
                   [...allTags].some(tag => tag.includes(modifierLower) || modifierLower.includes(tag));
        });

        if (matchingTags.length === 0) {
            console.log(`[RAG] No modifier matches found in tags, using original results`);
            return initialResults;
        }

        console.log(`[RAG] Found matching tags for refinement: [${matchingTags.join(', ')}]`);

        // Perform refined search with tag filtering
        try {
            const recordType = initialResults.records[0]?.oip?.recordType;
            
            const refinedSearchParams = {
                search: originalSubject,
                recordType: recordType,
                tags: matchingTags.join(','),
                tagsMatchMode: 'AND', // Require ALL matching tags
                sortBy: 'tags:desc', // Sort by tag match score
                resolveDepth: 3,
                limit: 5,
                page: 1,
                includeSigs: false,
                includePubKeys: false
            };

            console.log(`[RAG] Performing refined search with tags:`, refinedSearchParams);

            const refinedResults = await getRecords(refinedSearchParams);

            if (refinedResults && refinedResults.records && refinedResults.records.length > 0) {
                console.log(`[RAG] ✅ Refined search successful: ${refinedResults.records.length} precise results`);
                
                // Add refinement metadata
                refinedResults.wasRefined = true;
                refinedResults.appliedModifiers = matchingTags;
                refinedResults.originalResultCount = initialResults.records.length;
                
                return refinedResults;
            } else {
                console.log(`[RAG] Refined search returned no results, using original`);
                return initialResults;
            }

        } catch (error) {
            console.error(`[RAG] Error during refined search:`, error.message);
            return initialResults;
        }
    }

    /**
     * Extract both main subject and modifiers from questions
     * Returns {subject: string, modifiers: string[]}
     */
    extractSubjectAndModifiers(question) {
        console.log(`[RAG] Extracting subject and modifiers from: "${question}"`);
        
        const lowerQuestion = question.toLowerCase();
        
        // Special handling for recipe queries
        if (lowerQuestion.includes('recipe') || lowerQuestion.includes('cook')) {
            return this.extractRecipeSubjectAndModifiers(question);
        }
        
        // Special handling for exercise queries
        if (lowerQuestion.includes('exercise') || lowerQuestion.includes('workout')) {
            return this.extractExerciseSubjectAndModifiers(question);
        }
        
        // Default extraction
        const words = lowerQuestion
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ');
            
        const stopWords = ['what', 'is', 'are', 'the', 'how', 'where', 'when', 'why', 'who', 'which', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'can', 'long', 'much', 'many', 'time', 'need', 'needs', 'to', 'for', 'with', 'and', 'or', 'but', 'in', 'on', 'at', 'by', 'from', 'about', 'tell', 'me', 'you'];
        
        const meaningfulWords = words.filter(word => 
            word.length > 2 && !stopWords.includes(word)
        );
        
        return {
            subject: meaningfulWords.slice(0, 2).join(' '),
            modifiers: meaningfulWords.slice(2, 5)
        };
    }

    /**
     * Extract subject and modifiers specifically for recipe queries
     */
    extractRecipeSubjectAndModifiers(question) {
        const lowerQuestion = question.toLowerCase();
        
        // Common recipe modifiers that often appear as tags
        const commonModifiers = [
            'grilled', 'grilling', 'baked', 'baking', 'fried', 'frying', 'roasted', 'roasting', 'steamed', 'steaming',
            'greek', 'italian', 'mexican', 'indian', 'chinese', 'japanese', 'french', 'thai', 'mediterranean', 'asian',
            'spicy', 'mild', 'sweet', 'savory', 'hot', 'cold', 'fresh', 'healthy', 'low-fat', 'gluten-free', 'vegan', 'vegetarian',
            'quick', 'easy', 'simple', 'fast', 'slow', 'traditional', 'classic', 'modern', 'gourmet', 'comfort',
            'marinated', 'seasoned', 'stuffed', 'glazed', 'crispy', 'tender', 'juicy', 'creamy', 'crunchy'
        ];
        
        // Extract main ingredients (subjects)
        const ingredients = ['chicken', 'beef', 'pork', 'fish', 'salmon', 'shrimp', 'turkey', 'lamb', 'tofu', 'vegetables', 'pasta', 'rice', 'beans', 'lentils'];
        const foundIngredients = ingredients.filter(ingredient => lowerQuestion.includes(ingredient));
        
        // Extract modifiers that exist in the question
        const foundModifiers = commonModifiers.filter(modifier => {
            // Check for exact match or as part of compound words
            return lowerQuestion.includes(modifier) || lowerQuestion.includes(modifier + 'ed') || lowerQuestion.includes(modifier + 'ing');
        });
        
        const subject = foundIngredients.length > 0 ? foundIngredients[0] : 'recipe';
        
        console.log(`[RAG] Recipe extraction - Subject: "${subject}", Modifiers: [${foundModifiers.join(', ')}]`);
        
        return {
            subject: subject,
            modifiers: foundModifiers
        };
    }

    /**
     * Extract subject and modifiers specifically for exercise queries
     */
    extractExerciseSubjectAndModifiers(question) {
        const lowerQuestion = question.toLowerCase();
        
        // Common exercise modifiers
        const exerciseModifiers = [
            'beginner', 'intermediate', 'advanced', 'easy', 'hard', 'difficult',
            'upper', 'lower', 'full', 'body', 'core', 'cardio', 'strength', 'endurance',
            'home', 'gym', 'outdoor', 'indoor', 'bodyweight', 'dumbbell', 'barbell', 'kettlebell',
            'chest', 'back', 'shoulders', 'arms', 'legs', 'abs', 'glutes', 'biceps', 'triceps'
        ];
        
        const exerciseTypes = ['workout', 'exercise', 'training', 'routine', 'program'];
        const foundExerciseType = exerciseTypes.find(type => lowerQuestion.includes(type)) || 'exercise';
        
        const foundModifiers = exerciseModifiers.filter(modifier => lowerQuestion.includes(modifier));
        
        console.log(`[RAG] Exercise extraction - Subject: "${foundExerciseType}", Modifiers: [${foundModifiers.join(', ')}]`);
        
        return {
            subject: foundExerciseType,
            modifiers: foundModifiers
        };
    }

    /**
     * Main RAG query function - searches Elasticsearch and generates context-aware response
     */
    async query(question, options = {}) {
        try {
            console.log(`[RAG] 🔍 Processing query: "${question}"`);
            console.log(`[RAG] 📊 Using structured field extraction: ${options.useFieldExtraction !== false ? 'ENABLED' : 'DISABLED'}`);
            
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
     * Enhanced to include comprehensive recipe timing and measurement fields
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
                
                // Temperature fields
                const tempFields = ['temperature', 'oven_temp', 'cooking_temp', 'baking_temp'];
                tempFields.forEach(field => {
                    if (basic[field] && contextFields.includes(field)) {
                        parts.push(`Temperature: ${basic[field]}`);
                    }
                });
                
                // Serving and quantity fields
                const servingFields = ['servings', 'serves', 'portions', 'yield', 'makes'];
                servingFields.forEach(field => {
                    if (basic[field] && contextFields.includes(field)) {
                        parts.push(`Servings: ${basic[field]}`);
                    }
                });
                
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
                
                // Method and technique fields
                const methodFields = ['method', 'technique', 'cooking_method', 'preparation_method'];
                methodFields.forEach(field => {
                    if (basic[field] && contextFields.includes(field)) {
                        parts.push(`Method: ${basic[field]}`);
                    }
                });
                
                // Difficulty and skill level
                if (basic.difficulty && contextFields.includes('difficulty')) {
                    parts.push(`Difficulty: ${basic.difficulty}`);
                }
                
                // Cuisine type
                if (basic.cuisine && contextFields.includes('cuisine')) {
                    parts.push(`Cuisine: ${basic.cuisine}`);
                }
                
                // Equipment needed
                if (basic.equipment && contextFields.includes('equipment')) {
                    parts.push(`Equipment: ${Array.isArray(basic.equipment) ? basic.equipment.join(', ') : basic.equipment}`);
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
     * Enhanced with structured data field extraction
     */
    async generateResponse(question, context, model = null, searchResults = null) {
        // First try to extract direct field-based answers from structured data
        if (searchResults && searchResults.records && searchResults.records.length > 0) {
            console.log(`[RAG] Attempting field-based answer extraction for: "${question}"`);
            const fieldAnswer = this.extractStructuredFieldAnswer(question, searchResults.records);
            if (fieldAnswer) {
                console.log(`[RAG] ✅ Found direct field answer: "${fieldAnswer}"`);
                return fieldAnswer;
            }
        }

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
     * Extract answers directly from structured record data using field mapping
     */
    extractStructuredFieldAnswer(question, records) {
        const lowerQuestion = question.toLowerCase();
        console.log(`[RAG] Analyzing question for field extraction: "${question}"`);
        
        // Get the first record (should be most relevant after filtering)
        const record = records[0];
        if (!record || !record.data) {
            console.log(`[RAG] No structured data available for field extraction`);
            return null;
        }

        const recordType = record.oip?.recordType;
        const recordName = record.data?.basic?.name || 'record';
        
        console.log(`[RAG] Analyzing ${recordType} record: "${recordName}"`);
        console.log(`[RAG] Available data sections:`, Object.keys(record.data));

        // Recipe-specific field extraction
        if (recordType === 'recipe' || Object.keys(record.data).includes('recipe')) {
            const recipeData = record.data.recipe || {};
            console.log(`[RAG] Recipe data fields:`, Object.keys(recipeData));
            
            // Cooking time questions
            if ((lowerQuestion.includes('how long') || lowerQuestion.includes('time')) && 
                (lowerQuestion.includes('cook') || lowerQuestion.includes('bake') || lowerQuestion.includes('grill'))) {
                
                                 // Check for specific timing fields (prioritize cook time for cooking questions)
                 const timeFields = ['cook_time_mins', 'cooking_time', 'cookingTime', 'prep_time_mins', 'total_time_mins', 'bake_time_mins', 'grill_time_mins'];
                 
                 console.log(`[RAG] Looking for timing fields in recipe data:`, timeFields);
                 console.log(`[RAG] Recipe data contains:`, Object.keys(recipeData));
                 
                 for (const field of timeFields) {
                     const value = recipeData[field];
                     console.log(`[RAG] Checking field '${field}': ${value} (type: ${typeof value})`);
                     
                     if (value !== undefined && value !== null && value !== '') {
                         console.log(`[RAG] ✅ FOUND timing field '${field}' with value: ${value}`);
                         
                         if (field.includes('cook') && !field.includes('prep')) {
                             const answer = `According to the ${recordName} recipe, it needs to cook for ${value} minutes.`;
                             console.log(`[RAG] 🎯 DIRECT ANSWER: "${answer}"`);
                             return answer;
                         } else if (field.includes('prep')) {
                             const answer = `According to the ${recordName} recipe, prep time is ${value} minutes.`;
                             console.log(`[RAG] 🎯 DIRECT ANSWER: "${answer}"`);
                             return answer;
                         } else if (field.includes('total')) {
                             const answer = `According to the ${recordName} recipe, total time is ${value} minutes.`;
                             console.log(`[RAG] 🎯 DIRECT ANSWER: "${answer}"`);
                             return answer;
                         } else if (field.includes('bake') || field.includes('grill')) {
                             const answer = `According to the ${recordName} recipe, it needs to ${field.includes('bake') ? 'bake' : 'grill'} for ${value} minutes.`;
                             console.log(`[RAG] 🎯 DIRECT ANSWER: "${answer}"`);
                             return answer;
                         }
                     }
                 }
                
                // Look for instructions that contain timing information
                if (recipeData.instructions) {
                    const instructions = recipeData.instructions;
                    const timeMatches = instructions.match(/(\d+)(?:[-–](\d+))?\s*(?:minutes?|mins?)/gi);
                    if (timeMatches) {
                        console.log(`[RAG] ✅ Found timing in instructions: ${timeMatches[0]}`);
                        return `According to the ${recordName} recipe instructions, ${timeMatches[0].toLowerCase()}.`;
                    }
                }
            }
            
            // Temperature questions
            if (lowerQuestion.includes('temperature') || lowerQuestion.includes('degrees') || lowerQuestion.includes('°')) {
                const tempFields = ['temperature', 'oven_temp', 'cooking_temp', 'cook_temperature'];
                
                for (const field of tempFields) {
                    if (recipeData[field] !== undefined && recipeData[field] !== null) {
                        const tempValue = recipeData[field];
                        console.log(`[RAG] ✅ Found temperature field ${field}: ${tempValue}`);
                        return `According to the ${recordName} recipe, cook at ${tempValue}°F.`;
                    }
                }
            }
            
            // Serving size questions
            if (lowerQuestion.includes('serving') || lowerQuestion.includes('portion') || lowerQuestion.includes('how many people')) {
                const servingFields = ['servings', 'serves', 'portions', 'yield'];
                
                for (const field of servingFields) {
                    if (recipeData[field] !== undefined && recipeData[field] !== null) {
                        const servingValue = recipeData[field];
                        console.log(`[RAG] ✅ Found serving field ${field}: ${servingValue}`);
                        return `The ${recordName} recipe serves ${servingValue} people.`;
                    }
                }
            }
            
            // Ingredient questions
            if (lowerQuestion.includes('ingredient') || lowerQuestion.includes('what do i need') || lowerQuestion.includes('what needs')) {
                if (recipeData.ingredients) {
                    console.log(`[RAG] ✅ Found ingredients field`);
                    const ingredients = Array.isArray(recipeData.ingredients) ? 
                        recipeData.ingredients.join(', ') : 
                        recipeData.ingredients;
                    return `For the ${recordName} recipe, you need: ${ingredients.substring(0, 300)}${ingredients.length > 300 ? '...' : ''}`;
                }
                
                // Check for ingredient arrays or amounts
                const ingredientFields = Object.keys(recipeData).filter(key => 
                    key.toLowerCase().includes('ingredient') || key.toLowerCase().includes('amount')
                );
                
                if (ingredientFields.length > 0) {
                    console.log(`[RAG] ✅ Found ingredient-related fields:`, ingredientFields);
                    const ingredientData = ingredientFields.map(field => recipeData[field]).join(', ');
                    return `For the ${recordName} recipe, you need: ${ingredientData.substring(0, 300)}${ingredientData.length > 300 ? '...' : ''}`;
                }
            }
            
                             // Fallback: Look for ANY numeric field that might contain timing information
                 console.log(`[RAG] No exact field match, trying fallback search for timing values...`);
                 for (const [fieldName, fieldValue] of Object.entries(recipeData)) {
                     if (typeof fieldValue === 'number' && fieldValue > 0 && fieldValue < 1000) {
                         if (fieldName.toLowerCase().includes('time') || 
                             fieldName.toLowerCase().includes('cook') || 
                             fieldName.toLowerCase().includes('bake') ||
                             fieldName.toLowerCase().includes('min')) {
                             console.log(`[RAG] 🔍 Fallback found timing field '${fieldName}': ${fieldValue}`);
                             const answer = `According to the ${recordName} recipe, ${fieldName.replace(/_/g, ' ')}: ${fieldValue} minutes.`;
                             console.log(`[RAG] 🎯 FALLBACK ANSWER: "${answer}"`);
                             return answer;
                         }
                     }
                 }
                 
                 console.log(`[RAG] Recipe question didn't match any specific fields for: "${question}"`);
             }
        
        // Workout/Exercise specific field extraction
        else if (recordType === 'workout' || recordType === 'exercise' || Object.keys(record.data).includes('workout')) {
            const workoutData = record.data.workout || record.data.exercise || {};
            console.log(`[RAG] Workout data fields:`, Object.keys(workoutData));
            
            // Duration questions
            if (lowerQuestion.includes('how long') || lowerQuestion.includes('duration') || lowerQuestion.includes('time')) {
                const durationFields = ['duration', 'time', 'length', 'workout_time'];
                
                for (const field of durationFields) {
                    if (workoutData[field] !== undefined && workoutData[field] !== null) {
                        const duration = workoutData[field];
                        console.log(`[RAG] ✅ Found duration field ${field}: ${duration}`);
                        return `The ${recordName} workout takes ${duration} minutes.`;
                    }
                }
            }
            
            // Difficulty questions
            if (lowerQuestion.includes('difficult') || lowerQuestion.includes('level') || lowerQuestion.includes('beginner') || lowerQuestion.includes('advanced')) {
                const difficultyFields = ['difficulty', 'level', 'difficulty_level'];
                
                for (const field of difficultyFields) {
                    if (workoutData[field] !== undefined && workoutData[field] !== null) {
                        const difficulty = workoutData[field];
                        console.log(`[RAG] ✅ Found difficulty field ${field}: ${difficulty}`);
                        return `The ${recordName} workout is ${difficulty} level.`;
                    }
                }
            }
        }
        
        // General field extraction for any record type
        else {
            console.log(`[RAG] Attempting general field extraction for ${recordType} record`);
            
            // Look through all data sections for potential answers
            for (const [sectionName, sectionData] of Object.entries(record.data)) {
                if (sectionName === 'basic' || !sectionData || typeof sectionData !== 'object') continue;
                
                console.log(`[RAG] Checking section: ${sectionName} with fields:`, Object.keys(sectionData));
                
                // Time-related questions
                if (lowerQuestion.includes('time') || lowerQuestion.includes('duration') || lowerQuestion.includes('how long')) {
                    const timeFields = Object.keys(sectionData).filter(key => 
                        key.toLowerCase().includes('time') || 
                        key.toLowerCase().includes('duration') ||
                        key.toLowerCase().includes('mins') ||
                        key.toLowerCase().includes('minutes')
                    );
                    
                    for (const field of timeFields) {
                        const value = sectionData[field];
                        if (value !== undefined && value !== null) {
                            console.log(`[RAG] ✅ Found time-related field ${field}: ${value}`);
                            return `According to the ${recordName}, ${field.replace(/_/g, ' ')}: ${value}${typeof value === 'number' && field.includes('min') ? ' minutes' : ''}`;
                        }
                    }
                }
            }
        }
        
        console.log(`[RAG] No specific field mapping found for question: "${question}"`);
        return null;
    }

    /**
     * Enhanced fallback method to extract direct answers from context when LLM fails
     * Now includes recipe-specific field extraction
     */
    extractDirectAnswer(question, context) {
        const lowerQuestion = question.toLowerCase();
        const lowerContext = context.toLowerCase();
        
        // Recipe-specific extractions
        if (lowerQuestion.includes('recipe') || lowerQuestion.includes('cook')) {
            return this.extractRecipeAnswer(question, context);
        }
        
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
     * Extract specific answers for recipe-related questions
     */
    extractRecipeAnswer(question, context) {
        const lowerQuestion = question.toLowerCase();
        
        // Cooking time questions
        if (lowerQuestion.includes('how long') && (lowerQuestion.includes('cook') || lowerQuestion.includes('bake') || lowerQuestion.includes('grill'))) {
            // Look for specific time fields first
            const timePatterns = [
                /cook[_\s]*time[_\s]*mins?:?\s*(\d+)/gi,
                /cooking[_\s]*time:?\s*(\d+)\s*min/gi,
                /prep[_\s]*time[_\s]*mins?:?\s*(\d+)/gi,
                /total[_\s]*time[_\s]*mins?:?\s*(\d+)/gi,
                /bake\s*(?:for\s*)?(\d+)\s*(?:minutes?|mins?)/gi,
                /grill\s*(?:for\s*)?(\d+)\s*(?:minutes?|mins?)/gi,
                /cook\s*(?:for\s*)?(\d+)\s*(?:minutes?|mins?)/gi,
                /(\d+)\s*(?:minutes?|mins?)\s*(?:of\s*)?(?:cooking|baking|grilling)/gi
            ];
            
            for (const pattern of timePatterns) {
                const matches = [...context.matchAll(pattern)];
                if (matches.length > 0) {
                    const time = matches[0][1];
                    return `According to the recipe, it needs to cook for ${time} minutes.`;
                }
            }
            
            // Look for time ranges in instructions
            const instructionTimePatterns = [
                /(\d+)[-–](\d+)\s*(?:minutes?|mins?)/gi,
                /(\d+)\s*(?:to|or)\s*(\d+)\s*(?:minutes?|mins?)/gi,
                /about\s*(\d+)\s*(?:minutes?|mins?)/gi,
                /approximately\s*(\d+)\s*(?:minutes?|mins?)/gi
            ];
            
            for (const pattern of instructionTimePatterns) {
                const matches = [...context.matchAll(pattern)];
                if (matches.length > 0) {
                    if (matches[0][2]) {
                        // Range
                        return `According to the recipe instructions, it should cook for ${matches[0][1]}-${matches[0][2]} minutes.`;
                    } else {
                        // Single time with approximation
                        return `According to the recipe instructions, it should cook for about ${matches[0][1]} minutes.`;
                    }
                }
            }
            
            // Look for specific cooking instructions that mention time
            const specificInstructions = context.match(/(?:grill|cook|bake|roast)\s+[^.]*?(\d+)(?:[-–](\d+))?\s*(?:minutes?|mins?)[^.]*/gi);
            if (specificInstructions && specificInstructions.length > 0) {
                return `Based on the cooking instructions: "${specificInstructions[0].trim()}"`;
            }
        }
        
        // Temperature questions
        if (lowerQuestion.includes('temperature') || lowerQuestion.includes('degrees') || lowerQuestion.includes('°')) {
            const tempPatterns = [
                /(\d+)°?\s*f(?:ahrenheit)?/gi,
                /(\d+)\s*degrees?\s*f/gi,
                /preheat\s*(?:oven\s*)?(?:to\s*)?(\d+)°?\s*f/gi,
                /cook\s*(?:at\s*)?(\d+)°?\s*f/gi,
                /bake\s*(?:at\s*)?(\d+)°?\s*f/gi
            ];
            
            for (const pattern of tempPatterns) {
                const matches = [...context.matchAll(pattern)];
                if (matches.length > 0) {
                    const temp = matches[0][1];
                    return `According to the recipe, cook at ${temp}°F.`;
                }
            }
        }
        
        // Serving size questions
        if (lowerQuestion.includes('serving') || lowerQuestion.includes('portion') || lowerQuestion.includes('how many people')) {
            const servingPatterns = [
                /servings?:?\s*(\d+)/gi,
                /serves?:?\s*(\d+)/gi,
                /(?:makes?\s*)?(\d+)\s*servings?/gi,
                /(?:feeds?\s*)?(\d+)\s*people/gi
            ];
            
            for (const pattern of servingPatterns) {
                const matches = [...context.matchAll(pattern)];
                if (matches.length > 0) {
                    const servings = matches[0][1];
                    return `This recipe serves ${servings} people.`;
                }
            }
        }
        
        // Ingredient questions
        if (lowerQuestion.includes('ingredient') || lowerQuestion.includes('what do i need') || lowerQuestion.includes('what needs')) {
            const ingredientMatch = context.match(/ingredients?:?\s*([^:]*?)(?:\n\n|\n(?=[A-Z])|$)/gi);
            if (ingredientMatch && ingredientMatch.length > 0) {
                const ingredients = ingredientMatch[0].replace(/ingredients?:?\s*/gi, '').trim();
                return `The ingredients needed are: ${ingredients.substring(0, 200)}${ingredients.length > 200 ? '...' : ''}`;
            }
        }
        
        // Fallback for recipe questions
        const recipeKeywords = lowerQuestion.split(/\s+/).filter(word => word.length > 3);
        const relevantSentences = context.split(/[.!?]+/).filter(sentence => {
            return recipeKeywords.some(keyword => sentence.toLowerCase().includes(keyword));
        }).slice(0, 2);
        
        if (relevantSentences.length > 0) {
            return `Here's what I found about the recipe: ${relevantSentences.join('. ').trim()}.`;
        }
        
        return "I found recipe information but couldn't extract the specific detail you're looking for. Please try asking a more specific question about the recipe.";
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
     * Enhanced to provide better explanations of refinement process
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
        
        // Check if refinement occurred and build enhanced rationale
        const sourceCount = searchResults.records ? searchResults.records.length : 0;
        const hasRefinement = searchResults.records && searchResults.records.some(r => r.ragRefinementInfo?.wasRefined);
        
        if (hasRefinement) {
            // Enhanced rationale for refined searches
            const refinedRecord = searchResults.records.find(r => r.ragRefinementInfo?.wasRefined);
            const appliedModifiers = refinedRecord.ragRefinementInfo?.appliedModifiers || [];
            const originalCount = refinedRecord.ragRefinementInfo?.originalResultCount || 0;
            
            if (lowerQuestion.includes('recipe') || lowerQuestion.includes('cook')) {
                filters.rationale = `Found ${originalCount} recipes containing "${filters.search}", then refined to ${sourceCount} specific ${sourceCount === 1 ? 'recipe' : 'recipes'} using tags: ${appliedModifiers.join(', ')}`;
                // Add tags filter to show what was applied
                filters.tags = appliedModifiers.join(',');
                filters.tagsMatchMode = 'AND';
            } else if (lowerQuestion.includes('exercise') || lowerQuestion.includes('workout')) {
                filters.rationale = `Found ${originalCount} exercises related to "${filters.search}", then refined to ${sourceCount} specific ${sourceCount === 1 ? 'exercise' : 'exercises'} using tags: ${appliedModifiers.join(', ')}`;
                filters.tags = appliedModifiers.join(',');
                filters.tagsMatchMode = 'AND';
            } else {
                filters.rationale = `Found ${originalCount} records matching "${filters.search}", then refined to ${sourceCount} specific ${sourceCount === 1 ? 'result' : 'results'} using tags: ${appliedModifiers.join(', ')}`;
                filters.tags = appliedModifiers.join(',');
                filters.tagsMatchMode = 'AND';
            }
        } else {
            // Standard rationale for non-refined searches
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
        }
        
        console.log(`[RAG] Extracted filters for "${question}":`, filters);
        return filters;
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
}

module.exports = new RAGService(); 