/**
 * ALFRED Productivity Module - Task Parser
 * Natural language processing for task creation and management
 */

const chrono = require('chrono-node');
const natural = require('natural');
const defaultSettings = require('../config/default-settings');

// Initialize NLP components
const tokenizer = new natural.WordTokenizer();
const stemmer = natural.PorterStemmer;

/**
 * Parse natural language task input
 * @param {string} input - Natural language task description
 * @returns {Object} Parsed task data
 */
async function parseTaskInput(input) {
    try {
        console.log('Parsing task input:', input);

        const parsed = {
            title: '',
            description: '',
            taskType: 'flexible', // 'fixed' or 'flexible'
            category: 'General',
            duration: null, // minutes
            priority: 'medium', // 'low', 'medium', 'high'
            frequency: 'once', // 'once', 'daily', 'weekly', etc.
            points: defaultSettings.defaultTaskPoints,
            scheduledTime: null, // Unix timestamp
            createdAt: new Date().toISOString()
        };

        // Clean and tokenize input
        const cleanInput = input.toLowerCase().trim();
        const tokens = tokenizer.tokenize(cleanInput) || [];

        // Extract time-related information using chrono
        const chronoResults = chrono.parse(cleanInput);
        if (chronoResults.length > 0) {
            const timeResult = chronoResults[0];
            parsed.scheduledTime = timeResult.date().getTime();

            // Remove time text from input for further processing
            const timeText = timeResult.text;
            const remainingText = cleanInput.replace(timeText, '').trim();
            parsed.title = remainingText;
        } else {
            parsed.title = cleanInput;
        }

        // Extract duration (look for patterns like "30 minutes", "1 hour", "2h", "45m")
        const durationPatterns = [
            /(\d+)\s*(?:hours?|hrs?|h)\b/i,
            /(\d+)\s*(?:minutes?|mins?|m)\b/i,
            /(\d+):(\d+)/, // HH:MM format
            /(\d+)\s*(?:hour|hr|h)\s*(\d+)\s*(?:minutes?|mins?|m)/i // "1 hour 30 minutes"
        ];

        for (const pattern of durationPatterns) {
            const match = cleanInput.match(pattern);
            if (match) {
                if (pattern === durationPatterns[0]) { // hours
                    parsed.duration = parseInt(match[1]) * 60;
                } else if (pattern === durationPatterns[1]) { // minutes
                    parsed.duration = parseInt(match[1]);
                } else if (pattern === durationPatterns[2]) { // HH:MM
                    parsed.duration = parseInt(match[1]) * 60 + parseInt(match[2]);
                } else if (pattern === durationPatterns[3]) { // hour + minutes
                    parsed.duration = parseInt(match[1]) * 60 + parseInt(match[2]);
                }
                break;
            }
        }

        // Extract priority keywords
        const priorityKeywords = {
            high: ['urgent', 'important', 'critical', 'asap', 'priority', 'high'],
            low: ['low', 'minor', 'whenever', 'someday', 'eventually'],
            medium: ['medium', 'normal', 'regular', 'moderate']
        };

        for (const [priority, keywords] of Object.entries(priorityKeywords)) {
            if (keywords.some(keyword => cleanInput.includes(keyword))) {
                parsed.priority = priority;
                break;
            }
        }

        // Extract points (look for "+5pts", "5 points", etc.)
        const pointsPatterns = [
            /\+(\d+)\s*(?:pts?|points?)/i,
            /(\d+)\s*(?:pts?|points?)/i
        ];

        for (const pattern of pointsPatterns) {
            const match = cleanInput.match(pattern);
            if (match) {
                parsed.points = parseInt(match[1]);
                break;
            }
        }

        // Extract category (look for @Category patterns)
        const categoryMatch = cleanInput.match(/@(\w+)/i);
        if (categoryMatch) {
            parsed.category = categoryMatch[1].charAt(0).toUpperCase() + categoryMatch[1].slice(1);
        }

        // Determine task type based on context
        if (parsed.scheduledTime || parsed.duration) {
            parsed.taskType = 'fixed';
        }

        // Extract frequency patterns
        const frequencyPatterns = [
            { pattern: /\bdaily\b/i, value: 'daily' },
            { pattern: /\bweekly\b/i, value: 'weekly' },
            { pattern: /\bmonthly\b/i, value: 'monthly' },
            { pattern: /(\d+)\s*(?:times?|x)\s*(?:per|a)\s*(week|month)/i, value: (match) => `${match[1]}x/${match[2]}` },
            { pattern: /\bevery\s*(\d+)\s*(days?|weeks?|months?)/i, value: (match) => `every ${match[1]} ${match[2]}` }
        ];

        for (const { pattern, value } of frequencyPatterns) {
            const match = cleanInput.match(pattern);
            if (match) {
                parsed.frequency = typeof value === 'function' ? value(match) : value;
                break;
            }
        }

        // Clean up title by removing parsed elements
        parsed.title = cleanParsedTitle(parsed.title, parsed);

        // Generate description if title is very short
        if (parsed.title.length < 10 && parsed.duration) {
            parsed.description = `Task scheduled for ${parsed.duration} minutes`;
        }

        console.log('Parsed task:', parsed);
        return parsed;

    } catch (error) {
        console.error('Error parsing task input:', error);
        // Return basic fallback
        return {
            title: input,
            description: '',
            taskType: 'flexible',
            category: 'General',
            duration: null,
            priority: 'medium',
            frequency: 'once',
            points: defaultSettings.defaultTaskPoints,
            scheduledTime: null,
            createdAt: new Date().toISOString()
        };
    }
}

/**
 * Clean parsed elements from the title
 * @param {string} title - Original title
 * @param {Object} parsed - Parsed task data
 * @returns {string} Cleaned title
 */
function cleanParsedTitle(title, parsed) {
    let cleanTitle = title;

    // Remove time-related text
    cleanTitle = cleanTitle.replace(/\b(?:today|tomorrow|yesterday|next\s+\w+|in\s+\d+\s+\w+)\b/gi, '').trim();

    // Remove duration text
    cleanTitle = cleanTitle.replace(/\b\d+\s*(?:minutes?|mins?|hours?|hrs?|h|m)\b/gi, '').trim();
    cleanTitle = cleanTitle.replace(/\b\d+:\d+\b/g, '').trim();

    // Remove priority keywords
    const priorityWords = ['urgent', 'important', 'critical', 'asap', 'priority', 'high', 'low', 'minor', 'whenever'];
    priorityWords.forEach(word => {
        cleanTitle = cleanTitle.replace(new RegExp(`\\b${word}\\b`, 'gi'), '').trim();
    });

    // Remove points text
    cleanTitle = cleanTitle.replace(/\+?\d+\s*(?:pts?|points?)/gi, '').trim();

    // Remove category markers
    cleanTitle = cleanTitle.replace(/@\w+/gi, '').trim();

    // Remove frequency words
    const frequencyWords = ['daily', 'weekly', 'monthly', 'every'];
    frequencyWords.forEach(word => {
        cleanTitle = cleanTitle.replace(new RegExp(`\\b${word}\\b`, 'gi'), '').trim();
    });

    // Clean up extra spaces
    cleanTitle = cleanTitle.replace(/\s+/g, ' ').trim();

    // If title became too short, use original
    if (cleanTitle.length < 3) {
        return title;
    }

    return cleanTitle;
}

/**
 * Parse completion commands
 * @param {string} input - Voice command like "complete task X" or "mark done Y"
 * @returns {Object} Parsed completion data
 */
function parseCompletionCommand(input) {
    const cleanInput = input.toLowerCase().trim();

    // Patterns for completion commands
    const patterns = [
        /\b(?:complete|finish|done|mark\s+(?:as\s+)?done|finish\s+up)\s+(?:task\s+)?(.+)/i,
        /\b(?:mark|set)\s+(.+)\s+(?:as\s+)?(?:complete|done|finished)/i
    ];

    for (const pattern of patterns) {
        const match = cleanInput.match(pattern);
        if (match) {
            return {
                action: 'complete',
                taskIdentifier: match[1].trim(),
                parsed: true
            };
        }
    }

    return {
        action: null,
        taskIdentifier: null,
        parsed: false
    };
}

/**
 * Parse cancellation commands
 * @param {string} input - Voice command like "cancel task X" or "delete task Y"
 * @returns {Object} Parsed cancellation data
 */
function parseCancellationCommand(input) {
    const cleanInput = input.toLowerCase().trim();

    // Patterns for cancellation commands
    const patterns = [
        /\b(?:cancel|delete|remove|stop)\s+(?:task\s+)?(.+)/i,
        /\b(?:mark|set)\s+(.+)\s+(?:as\s+)?(?:cancelled|canceled)/i
    ];

    for (const pattern of patterns) {
        const match = cleanInput.match(pattern);
        if (match) {
            return {
                action: 'cancel',
                taskIdentifier: match[1].trim(),
                parsed: true
            };
        }
    }

    return {
        action: null,
        taskIdentifier: null,
        parsed: false
    };
}

/**
 * Parse status query commands
 * @param {string} input - Voice command like "show my tasks" or "what are my pending tasks"
 * @returns {Object} Parsed query data
 */
function parseStatusQuery(input) {
    const cleanInput = input.toLowerCase().trim();

    // Patterns for status queries
    const patterns = {
        show_tasks: /\b(?:show|list|tell me|get|what are|give me)\s+(?:my\s+)?(?:all\s+)?tasks\b/i,
        pending_tasks: /\b(?:pending|incomplete|unfinished|open)\s+tasks?\b/i,
        completed_tasks: /\b(?:completed|done|finished)\s+tasks?\b/i,
        today_tasks: /\b(?:today|todays?)\s+tasks?\b/i,
        priority_tasks: /\b(?:high|medium|low)\s+priority\s+tasks?\b/i
    };

    for (const [type, pattern] of Object.entries(patterns)) {
        if (pattern.test(cleanInput)) {
            const status = type.split('_')[0];
            return {
                action: 'query',
                type: status === 'show' ? 'all' : status,
                parsed: true
            };
        }
    }

    return {
        action: null,
        type: null,
        parsed: false
    };
}

module.exports = {
    parseTaskInput,
    parseCompletionCommand,
    parseCancellationCommand,
    parseStatusQuery
};
