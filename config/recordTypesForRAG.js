/**
 * Configuration for record types that should be included in RAG (Retrieval-Augmented Generation) queries
 * 
 * This configuration determines which types of records from the OIP database
 * the RAG system will search through and include in context for AI responses.
 * 
 * Each record type should have:
 * - enabled: boolean - whether this type should be included in RAG searches
 * - priority: number - search priority (1-10, higher = more important)
 * - description: string - human readable description of the record type
 * - contextFields: array - which fields from this record type provide the best context
 */

const recordTypesForRAG = {
    // Recipe records - cooking and food related content
    recipe: {
        enabled: true,
        priority: 8,
        description: 'Cooking recipes and food-related content',
        contextFields: [
            'name', 'description', 'ingredients', 'instructions', 
            // Enhanced timing fields for better cooking question support
            'cookingTime', 'cook_time_mins', 'cook_time', 'cooking_time_mins', 'cooking_time',
            'prepTime', 'prep_time_mins', 'prep_time', 'preparation_time_mins', 'preparation_time', 
            'totalTime', 'total_time_mins', 'total_time', 'ready_in_mins', 'ready_time',
            'time', 'duration',
            // Temperature and measurement fields
            'temperature', 'oven_temp', 'cooking_temp', 'baking_temp',
            'servings', 'serves', 'portions', 'yield', 'makes',
            // Method and technique fields
            'method', 'technique', 'cooking_method', 'preparation_method',
            'difficulty', 'cuisine', 'equipment'
        ]
    },
    
    // Exercise records - fitness and workout content
    exercise: {
        enabled: true,
        priority: 7,
        description: 'Exercise routines, workouts, and fitness content',
        contextFields: ['name', 'description', 'muscleGroups', 'equipment', 'difficulty', 'duration']
    },

    // Workout records - structured collections of exercises with timing and metadata
    workout: {
        enabled: true,
        priority: 8,
        description: 'Complete workout plans composed of multiple exercises (warmup, main, cooldown) with duration and calories',
        contextFields: [
            // Core workout summary
            'total_duration_minutes', 'totalDurationMinutes', 'duration_minutes', 'duration',
            'estimated_calories_burned', 'calories',
            'includesWarmup', 'includesMain', 'includesCooldown',
            // Composition and guidance
            'exercise', 'exercise_amount', 'exercise_unit',
            'instructions', 'notes'
        ]
    },
    
    // General posts - blog posts, articles, general content
    post: {
        enabled: true,
        priority: 9,
        description: 'Blog posts, news articles, and general text content',
        contextFields: ['name', 'description', 'content', 'tags', 'category']
    },
    
    // Podcast records - audio content and transcripts
    podcast: {
        enabled: false,
        priority: 6,
        description: 'Podcast episodes and audio content',
        contextFields: ['name', 'description', 'transcript', 'speakers', 'duration', 'topics']
    },
    
    // JFK Files documents - historical documents
    jfkFilesDocument: {
        enabled: false,
        priority: 5,
        description: 'JFK assassination related documents and files',
        contextFields: ['name', 'description', 'content', 'documentType', 'date', 'classification']
    },
    
    // Image records - photos and visual content (lower priority for text-based RAG)
    // image: {
    //     enabled: true,
    //     priority: 3,
    //     description: 'Images and visual content with metadata',
    //     contextFields: ['name', 'description', 'tags', 'location', 'dateCreated']
    // },

    // // Video records - video content
    // video: {
    //     enabled: true,
    //     priority: 4,
    //     description: 'Video content and metadata',
    //     contextFields: ['name', 'description', 'transcript', 'duration', 'tags', 'category']
    // },

    // Productivity Module Records - Task management and planning content
    task: {
        enabled: true,
        priority: 6,
        description: 'Productivity tasks, goals, and personal productivity content',
        contextFields: [
            'title', 'description', 'category', 'priority', 'status',
            'frequency', 'duration', 'points', 'scheduledTime'
        ]
    },

    calendarSession: {
        enabled: true,
        priority: 5,
        description: 'Weekly productivity planning and time allocation sessions',
        contextFields: [
            'weekStart', 'totalPoints', 'earnedPoints', 'sleepHours',
            'workHours', 'exerciseMinutes', 'workDays', 'calendarSynced'
        ]
    },

    routine: {
        enabled: true,
        priority: 7,
        description: 'Morning and evening routines with structured steps and timing',
        contextFields: [
            'name', 'type', 'totalDuration', 'steps', 'stepDurations', 'enabled'
        ]
    },

    rewardPlan: {
        enabled: true,
        priority: 5,
        description: 'Gamification rewards and achievement systems for productivity',
        contextFields: [
            'name', 'description', 'threshold', 'rewardType', 'isActive', 'unlockedAt'
        ]
    },

    productivitySettings: {
        enabled: true,
        priority: 4,
        description: 'User productivity preferences and configuration settings',
        contextFields: [
            'timezone', 'weekStartDay', 'defaultTaskPoints', 'theme',
            'voiceEnabled', 'calendarSyncEnabled', 'notificationsEnabled'
        ]
    }
};

/**
 * Get list of enabled record types for RAG searches
 * @returns {Array} Array of enabled record type names
 */
function getEnabledRecordTypes() {
    return Object.keys(recordTypesForRAG).filter(type => recordTypesForRAG[type].enabled);
}

/**
 * Get record types sorted by priority (highest first)
 * @returns {Array} Array of {type, config} objects sorted by priority
 */
function getRecordTypesByPriority() {
    return Object.entries(recordTypesForRAG)
        .filter(([type, config]) => config.enabled)
        .sort(([, a], [, b]) => b.priority - a.priority)
        .map(([type, config]) => ({ type, config }));
}

/**
 * Get configuration for a specific record type
 * @param {string} recordType 
 * @returns {Object|null} Configuration object or null if not found
 */
function getRecordTypeConfig(recordType) {
    return recordTypesForRAG[recordType] || null;
}

/**
 * Check if a record type is enabled for RAG
 * @param {string} recordType 
 * @returns {boolean}
 */
function isRecordTypeEnabled(recordType) {
    const config = recordTypesForRAG[recordType];
    return config && config.enabled;
}

/**
 * Get context fields for a record type
 * @param {string} recordType 
 * @returns {Array} Array of field names that provide good context
 */
function getContextFields(recordType) {
    const config = recordTypesForRAG[recordType];
    return config ? config.contextFields : ['name', 'description'];
}

module.exports = {
    recordTypesForRAG,
    getEnabledRecordTypes,
    getRecordTypesByPriority,
    getRecordTypeConfig,
    isRecordTypeEnabled,
    getContextFields
}; 