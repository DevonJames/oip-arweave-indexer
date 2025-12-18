/**
 * Summarization Service
 * Generates structured summaries for meeting notes and other content
 * 
 * Supports long meetings (4+ hours) with dynamic timeout calculation
 */
const { getALFREDInstance } = require('../helpers/alfred');

// Base timeout: 10 minutes default, configurable via env
// For very long transcripts (100k+ chars), timeout is calculated dynamically
const BASE_LLM_TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS) || 600000; // 10 minutes

/**
 * Calculate appropriate timeout based on text length
 * Longer texts need more processing time
 */
function calculateTimeout(textLength) {
    // Base: 10 minutes
    // Add 1 minute per 10k characters for very long transcripts
    const baseTimeout = BASE_LLM_TIMEOUT_MS;
    const additionalTimeout = Math.floor(textLength / 10000) * 60000; // 1 min per 10k chars
    const maxTimeout = 30 * 60 * 1000; // Cap at 30 minutes
    
    return Math.min(baseTimeout + additionalTimeout, maxTimeout);
}

class SummarizationService {
    constructor() {
        this.alfred = null;
    }

    /**
     * Get or create ALFRED instance
     * @private
     */
    async _getALFRED() {
        if (!this.alfred) {
            this.alfred = getALFREDInstance ? getALFREDInstance() : null;
        }
        return this.alfred;
    }

    /**
     * Summarize note content with structured output
     * @param {object} options - Summarization options
     * @param {string} options.text - Full transcript text
     * @param {string} options.note_type - Type of note (MEETING, IDEA, etc.)
     * @param {array} options.participants - Array of participant names
     * @param {object} options.calendar - Calendar event info
     * @param {string} options.model - LLM model to use (optional, supports 'parallel')
     * @returns {Promise<object>} Structured summary with tags
     */
    async summarize(options) {
        try {
            const {
                text,
                note_type,
                participants = [],
                calendar = null,
                model = 'parallel'
            } = options;

            const textLength = text?.length || 0;
            const timeout = calculateTimeout(textLength);
            const timeoutMins = Math.round(timeout / 60000);
            
            console.log('📝 [Summarization] Generating summary:');
            console.log(`   Note type: ${note_type}, Model: ${model}`);
            console.log(`   Text length: ${textLength.toLocaleString()} chars`);
            console.log(`   Timeout: ${timeoutMins} minutes`);
            
            if (!text || text.trim().length === 0) {
                throw new Error('No text provided for summarization');
            }

            // Build context-specific prompt
            const prompt = this._buildSummarizationPrompt(text, note_type, participants, calendar);
            
            // Call LLM for summarization with model selection
            // Pass calculated timeout to LLM methods
            let summary;
            
            if (model === 'parallel') {
                // Use parallel racing mode (like voice.js)
                summary = await this._callLLMParallel(prompt, timeout);
            } else {
                // Use specific model
                summary = await this._callLLMDirect(prompt, model, timeout);
            }

            // Parse and structure the summary response
            return this._parseLLMSummary(summary, note_type);
        } catch (error) {
            console.error('❌ [Summarization] Failed:', error.message);
            // Return empty structure on failure
            return this._getEmptySummary();
        }
    }

    /**
     * Build summarization prompt based on note type and context
     * @private
     */
    _buildSummarizationPrompt(text, note_type, participants, calendar) {
        const participantsList = participants.length > 0 
            ? participants.join(', ') 
            : 'unknown';
        
        const calendarContext = calendar 
            ? `\nMeeting: ${calendar.calendar_event_id || 'Scheduled event'}`
            : '';

        let typeSpecificInstructions = '';
        
        switch (note_type) {
            case 'MEETING':
                typeSpecificInstructions = `This is a meeting transcript with participants: ${participantsList}${calendarContext}.
Focus on:
- Key discussion points and topics covered
- Decisions made during the meeting
- Action items assigned to specific people
- Open questions or unresolved issues
- Overall sentiment and meeting effectiveness`;
                break;
            
            case 'ONE_ON_ONE':
                typeSpecificInstructions = `This is a one-on-one conversation between: ${participantsList}.
Focus on:
- Main topics discussed
- Personal or professional development points
- Action items and follow-ups
- Concerns or blockers raised
- Relationship and communication tone`;
                break;
            
            case 'STANDUP':
                typeSpecificInstructions = `This is a standup/daily sync meeting with: ${participantsList}.
Focus on:
- Progress updates from each person
- Blockers or challenges mentioned
- Today's priorities
- Help needed from team
- Brief key decisions`;
                break;
            
            case 'IDEA':
            case 'REFLECTION':
                typeSpecificInstructions = `This is a personal ${note_type.toLowerCase()} note.
Focus on:
- Core ideas or thoughts expressed
- Connections or insights made
- Questions to explore further
- Potential next steps or applications`;
                break;
            
            case 'INTERVIEW':
                typeSpecificInstructions = `This is an interview with: ${participantsList}.
Focus on:
- Key questions asked and answers given
- Candidate strengths and concerns
- Skills and experience discussed
- Cultural fit observations
- Hiring recommendations or next steps`;
                break;
            
            default:
                typeSpecificInstructions = `This is a ${note_type} note.
Provide a structured summary of the content.`;
        }

        return `Please analyze the following transcript and provide a structured summary.

${typeSpecificInstructions}

FORMAT YOUR RESPONSE AS A JSON OBJECT WITH THIS EXACT STRUCTURE:
{
  "key_points": ["point 1", "point 2", "point 3"],
  "decisions": ["decision 1", "decision 2"],
  "action_items": [
    {"text": "action description", "assignee": "person name or 'unassigned'", "due_text": "due date or 'no date'"}
  ],
  "open_questions": ["question 1", "question 2"],
  "sentiment_overall": "NEGATIVE" | "NEUTRAL" | "POSITIVE",
  "topics": ["topic1", "topic2", "topic3"],
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "tags": ["tag1", "tag2", "tag3"]
}

IMPORTANT:
- Return ONLY the JSON object, no other text
- If no items for a category, use an empty array []
- For action items without clear assignee, use "unassigned"
- For action items without clear due date, use "no date"
- Sentiment should be one of: NEGATIVE, NEUTRAL, or POSITIVE
- Topics should be high-level themes discussed (3-5 items)
- Keywords should be specific terms or concepts mentioned (5-10 items)
- Tags should be short, lowercase labels with underscores instead of spaces, suitable for search/filtering (5-10 items, e.g., "product_development", "budget_planning", "team_coordination")

TRANSCRIPT:
${text}

JSON RESPONSE:`;
    }

    /**
     * Call LLM directly (fallback method)
     * @private
     * @param {string} prompt - The prompt to send
     * @param {string} model - The model to use
     * @param {number} timeout - Optional timeout in ms (defaults to BASE_LLM_TIMEOUT_MS)
     */
    async _callLLMDirect(prompt, model, timeout = null) {
        const axios = require('axios');
        const effectiveTimeout = timeout || BASE_LLM_TIMEOUT_MS;
        
        // Determine API based on model
        const openaiModels = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'];
        const xaiModels = ['grok-4', 'grok-4-fast', 'grok-beta'];
        
        let apiUrl, apiKey;
        
        if (openaiModels.includes(model)) {
            apiUrl = 'https://api.openai.com/v1/chat/completions';
            apiKey = process.env.OPENAI_API_KEY;
        } else if (xaiModels.includes(model)) {
            apiUrl = 'https://api.x.ai/v1/chat/completions';
            apiKey = process.env.XAI_API_KEY;
        } else {
            // Default to local Ollama
            apiUrl = `${process.env.OLLAMA_HOST || 'http://ollama:11434'}/api/chat`;
            apiKey = null;
        }

        if (!apiKey && (openaiModels.includes(model) || xaiModels.includes(model))) {
            throw new Error(`API key not configured for ${model}`);
        }

        try {
            if (apiKey) {
                // OpenAI/XAI format
                const response = await axios.post(apiUrl, {
                    model: model,
                    messages: [
                        { role: 'system', content: 'You are a helpful assistant that summarizes meeting notes and conversations.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.3,
                    max_tokens: 2000
                }, {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: effectiveTimeout // Dynamic timeout based on text length
                });
                
                return response.data.choices[0].message.content;
            } else {
                // Ollama format
                const response = await axios.post(apiUrl, {
                    model: model,
                    messages: [
                        { role: 'user', content: prompt }
                    ],
                    stream: false
                }, {
                    timeout: effectiveTimeout // Dynamic timeout based on text length
                });
                
                return response.data.message.content;
            }
        } catch (error) {
            console.error('❌ [Summarization] LLM call failed:', error.message);
            throw error;
        }
    }

    /**
     * Parse AI/LLM summary response
     * @private
     */
    _parseLLMSummary(summaryText, note_type) {
        try {
            // Try to extract JSON from response
            let jsonMatch = summaryText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                
                // Validate structure
                return {
                    key_points: Array.isArray(parsed.key_points) ? parsed.key_points : [],
                    decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
                    action_items: Array.isArray(parsed.action_items) ? parsed.action_items : [],
                    open_questions: Array.isArray(parsed.open_questions) ? parsed.open_questions : [],
                    sentiment_overall: this._normalizeSentiment(parsed.sentiment_overall),
                    topics: Array.isArray(parsed.topics) ? parsed.topics : [],
                    keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
                    tags: Array.isArray(parsed.tags) ? parsed.tags : []
                };
            }
        } catch (error) {
            console.warn('⚠️ [Summarization] Failed to parse JSON response:', error.message);
        }

        // Fallback: try to extract structured data from text
        return this._extractStructuredDataFromText(summaryText);
    }

    /**
     * Extract structured data from unstructured text (fallback)
     * @private
     */
    _extractStructuredDataFromText(text) {
        const result = {
            key_points: [],
            decisions: [],
            action_items: [],
            open_questions: [],
            sentiment_overall: 'NEUTRAL'
        };

        // Simple heuristic parsing (can be improved)
        const lines = text.split('\n').filter(line => line.trim());
        
        let currentSection = null;
        for (const line of lines) {
            const lowerLine = line.toLowerCase();
            
            if (lowerLine.includes('key point') || lowerLine.includes('summary')) {
                currentSection = 'key_points';
                continue;
            } else if (lowerLine.includes('decision')) {
                currentSection = 'decisions';
                continue;
            } else if (lowerLine.includes('action') || lowerLine.includes('todo')) {
                currentSection = 'action_items';
                continue;
            } else if (lowerLine.includes('question') || lowerLine.includes('open issue')) {
                currentSection = 'open_questions';
                continue;
            }
            
            // Extract bullet points
            if (currentSection && (line.trim().startsWith('-') || line.trim().startsWith('•') || line.trim().match(/^\d+\./))) {
                const cleaned = line.trim().replace(/^[-•\d.)\s]+/, '').trim();
                if (cleaned) {
                    if (currentSection === 'action_items') {
                        result[currentSection].push({
                            text: cleaned,
                            assignee: 'unassigned',
                            due_text: 'no date'
                        });
                    } else {
                        result[currentSection].push(cleaned);
                    }
                }
            }
        }

        return result;
    }

    /**
     * Normalize sentiment value
     * @private
     */
    _normalizeSentiment(sentiment) {
        if (!sentiment) return 'NEUTRAL';
        
        const s = String(sentiment).toUpperCase();
        if (s.includes('NEG')) return 'NEGATIVE';
        if (s.includes('POS')) return 'POSITIVE';
        return 'NEUTRAL';
    }

    /**
     * Get empty summary structure
     * @private
     */
    _getEmptySummary() {
        return {
            key_points: [],
            decisions: [],
            action_items: [],
            open_questions: [],
            sentiment_overall: 'NEUTRAL',
            topics: [],
            keywords: [],
            tags: []
        };
    }

    /**
     * Call multiple LLMs in parallel and return the first response (racing mode)
     * @private
     * @param {string} prompt - The prompt to send
     * @param {number} timeout - Optional timeout in ms (defaults to BASE_LLM_TIMEOUT_MS)
     */
    async _callLLMParallel(prompt, timeout = null) {
        const axios = require('axios');
        const startTime = Date.now();
        const effectiveTimeout = timeout || BASE_LLM_TIMEOUT_MS;
        
        console.log(`🏁 [Summarization] Racing parallel LLM requests (timeout: ${Math.round(effectiveTimeout/60000)}min)...`);
        
        const requests = [];
        
        // OpenAI request
        if (process.env.OPENAI_API_KEY) {
            requests.push(this._callOpenAI(prompt, 'gpt-4o-mini', effectiveTimeout));
        }
        
        // Grok request  
        if (process.env.XAI_API_KEY) {
            requests.push(this._callGrok(prompt, 'grok-beta', effectiveTimeout));
        }
        
        // Ollama requests
        requests.push(this._callOllama(prompt, 'mistral:latest', effectiveTimeout));
        const defaultModel = process.env.DEFAULT_LLM_MODEL || 'llama3.2:3b';
        requests.push(this._callOllama(prompt, defaultModel, effectiveTimeout));
        
        // Race: first to finish wins
        let winnerFound = false;
        const racePromise = new Promise((resolve) => {
            requests.forEach((req) => {
                req.then(result => {
                    if (!winnerFound && result && result.response) {
                        winnerFound = true;
                        const raceTime = Date.now() - startTime;
                        console.log(`🏆 [Summarization] Winner: ${result.source} in ${raceTime}ms`);
                        resolve(result.response);
                    }
                }).catch(() => {
                    // Ignore errors - other requests might succeed
                });
            });
            
            // Fallback timeout
            setTimeout(() => {
                if (!winnerFound) resolve(null);
            }, effectiveTimeout);
        });
        
        const winner = await racePromise;
        
        if (!winner) {
            throw new Error('All parallel LLM requests failed');
        }
        
        return winner;
    }

    /**
     * Call OpenAI API
     * @private
     */
    async _callOpenAI(prompt, modelName, timeout = null) {
        try {
            const axios = require('axios');
            const effectiveTimeout = timeout || BASE_LLM_TIMEOUT_MS;
            const response = await axios.post('https://api.openai.com/v1/chat/completions', {
                model: modelName,
                messages: [
                    { role: 'system', content: 'You are a helpful assistant that summarizes meeting notes and conversations. Return only valid JSON.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.3,
                max_tokens: 2000
            }, {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: effectiveTimeout
            });
            
            return {
                response: response.data.choices[0].message.content,
                source: `openai-${modelName}`
            };
        } catch (error) {
            console.warn(`[Summarization] OpenAI ${modelName} failed:`, error.message);
            return null;
        }
    }

    /**
     * Call Grok/XAI API
     * @private
     */
    async _callGrok(prompt, modelName, timeout = null) {
        try {
            const axios = require('axios');
            const effectiveTimeout = timeout || BASE_LLM_TIMEOUT_MS;
            const response = await axios.post('https://api.x.ai/v1/chat/completions', {
                model: modelName,
                messages: [
                    { role: 'system', content: 'You are a helpful assistant that summarizes meeting notes and conversations. Return only valid JSON.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.3,
                max_tokens: 2000
            }, {
                headers: {
                    'Authorization': `Bearer ${process.env.XAI_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: effectiveTimeout
            });
            
            return {
                response: response.data.choices[0].message.content,
                source: `xai-${modelName}`
            };
        } catch (error) {
            console.warn(`[Summarization] XAI ${modelName} failed:`, error.message);
            return null;
        }
    }

    /**
     * Call Ollama API
     * @private
     */
    async _callOllama(prompt, modelName, timeout = null) {
        try {
            const axios = require('axios');
            const effectiveTimeout = timeout || BASE_LLM_TIMEOUT_MS;
            const ollamaBaseUrl = process.env.OLLAMA_HOST || 'http://ollama:11434';
            const response = await axios.post(`${ollamaBaseUrl}/api/chat`, {
                model: modelName,
                messages: [
                    { role: 'user', content: prompt }
                ],
                stream: false,
                options: {
                    temperature: 0.3,
                    num_predict: 2000
                }
            }, {
                timeout: effectiveTimeout
            });
            
            return {
                response: response.data.message.content,
                source: `ollama-${modelName}`
            };
        } catch (error) {
            console.warn(`[Summarization] Ollama ${modelName} failed:`, error.message);
            return null;
        }
    }

    /**
     * Generate tags for a single chunk of text
     * @param {string} chunkText - Text content of the chunk
     * @param {string} noteType - Type of note this chunk belongs to
     * @param {string} model - LLM model to use (supports 'parallel')
     * @returns {Promise<array>} Array of tags
     */
    async generateChunkTags(chunkText, noteType, model = 'parallel') {
        try {
            if (!chunkText || chunkText.trim().length === 0) {
                return [];
            }

            console.log(`🏷️ [Summarization] Generating tags for chunk (${chunkText.length} chars)`);

            const prompt = `Analyze this text segment from a ${noteType} note and generate 3-5 relevant tags.
Tags should be:
- Short, lowercase, hyphenated labels (e.g., "budget-planning", "technical-discussion")
- Specific to the content of this segment
- Suitable for search and filtering

TEXT SEGMENT:
${chunkText}

Return ONLY a JSON array of tags, nothing else. Example: ["tag1", "tag2", "tag3"]

JSON ARRAY:`;

            let response;
            
            if (model === 'parallel') {
                response = await this._callLLMParallel(prompt);
            } else {
                response = await this._callLLMDirect(prompt, model);
            }

            // Parse JSON array from response
            const jsonMatch = response.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                const tags = JSON.parse(jsonMatch[0]);
                if (Array.isArray(tags)) {
                    console.log(`✅ [Summarization] Generated ${tags.length} chunk tags`);
                    return tags.slice(0, 5); // Limit to 5 tags
                }
            }

            return [];
        } catch (error) {
            console.warn('⚠️ [Summarization] Chunk tag generation failed:', error.message);
            return [];
        }
    }

    /**
     * Regenerate summary with different model or parameters
     * @param {string} noteHash - Note hash to regenerate summary for
     * @param {object} options - Regeneration options
     * @returns {Promise<object>} New summary
     */
    async regenerateSummary(noteHash, options = {}) {
        // This will be called from the regenerate endpoint
        // For now, just proxy to the main summarize method
        return this.summarize(options);
    }
}

// Singleton instance
let summarizationServiceInstance = null;

function getSummarizationService() {
    if (!summarizationServiceInstance) {
        summarizationServiceInstance = new SummarizationService();
    }
    return summarizationServiceInstance;
}

module.exports = {
    SummarizationService,
    getSummarizationService
};

