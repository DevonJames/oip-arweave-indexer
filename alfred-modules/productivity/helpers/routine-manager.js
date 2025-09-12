/**
 * ALFRED Productivity Module - Routine Manager
 * Handles morning and evening routines with step-by-step guidance
 */

const { publishNewRecord } = require('../../../helpers/templateHelper');
const moment = require('moment');

/**
 * Start a routine session
 * @param {string} userPubKey - User's public key
 * @param {string} routineType - 'morning' or 'evening'
 * @returns {Object} Routine session data
 */
async function startRoutine(userPubKey, routineType) {
    try {
        console.log(`Starting ${routineType} routine for user`);

        // Get user's routine
        const { getRecords } = require('../../../helpers/elasticsearch');

        const routines = await getRecords({
            recordType: 'routine',
            storage: 'gun',
            creator_did_address: `did:arweave:${userPubKey}`,
            exactMatch: { "data.routine.type": routineType },
            limit: 1
        });

        if (!routines.records || routines.records.length === 0) {
            throw new Error(`No ${routineType} routine found. Please create one first.`);
        }

        const routine = routines.records[0];
        const routineData = routine.data.routine;

        if (!routineData.enabled) {
            throw new Error(`${routineType} routine is disabled`);
        }

        // Create routine session
        const session = {
            routineSession: {
                routineId: routine.oip?.did || routine._id,
                routineType,
                startedAt: new Date().toISOString(),
                status: 'in_progress',
                currentStep: 0,
                totalSteps: routineData.steps?.length || 0,
                estimatedDuration: routineData.totalDuration || 0,
                completedSteps: [],
                userPubKey
            }
        };

        const result = await publishNewRecord(session, 'routineSession', false, false, false, null, 'gun', false, {
            storage: 'gun',
            publisherPubKey: userPubKey,
            localId: `routine_session_${Date.now()}`
        });

        return {
            session: result.recordToIndex,
            routine: routineData,
            nextStep: getNextStep(routineData, 0)
        };

    } catch (error) {
        console.error('Error starting routine:', error);
        throw error;
    }
}

/**
 * Complete a routine step
 * @param {string} userPubKey - User's public key
 * @param {string} sessionId - Routine session ID
 * @param {number} stepIndex - Index of completed step
 * @returns {Object} Updated session data
 */
async function completeStep(userPubKey, sessionId, stepIndex) {
    try {
        console.log(`Completing step ${stepIndex} for session ${sessionId}`);

        // Get current session
        const { getRecords } = require('../../../helpers/elasticsearch');

        const sessions = await getRecords({
            did: sessionId,
            storage: 'gun',
            creator_did_address: `did:arweave:${userPubKey}`,
            limit: 1
        });

        if (!sessions.records || sessions.records.length === 0) {
            throw new Error('Routine session not found');
        }

        const session = sessions.records[0];
        const sessionData = session.data.routineSession;

        // Get routine details
        const routines = await getRecords({
            did: sessionData.routineId,
            storage: 'gun',
            creator_did_address: `did:arweave:${userPubKey}`,
            limit: 1
        });

        if (!routines.records || routines.records.length === 0) {
            throw new Error('Routine not found');
        }

        const routine = routines.records[0];
        const routineData = routine.data.routine;

        // Mark step as completed
        const completedSteps = [...(sessionData.completedSteps || [])];
        if (!completedSteps.includes(stepIndex)) {
            completedSteps.push(stepIndex);
        }

        // Check if routine is complete
        const isComplete = completedSteps.length >= (routineData.steps?.length || 0);
        const status = isComplete ? 'completed' : 'in_progress';

        // Update session
        const updatedSession = {
            ...sessionData,
            completedSteps,
            currentStep: Math.min(stepIndex + 1, (routineData.steps?.length || 0) - 1),
            status,
            completedAt: isComplete ? new Date().toISOString() : null,
            lastUpdated: new Date().toISOString()
        };

        const record = {
            routineSession: updatedSession
        };

        const result = await publishNewRecord(record, 'routineSession', false, false, false, null, 'gun', false, {
            storage: 'gun',
            publisherPubKey: userPubKey,
            localId: `routine_session_update_${Date.now()}`
        });

        // Award points for completing routine
        if (isComplete) {
            const { awardPoints } = require('./point-system');
            await awardPoints(userPubKey, 5, `Completed ${sessionData.routineType} routine`);
        }

        return {
            session: result.recordToIndex,
            routine: routineData,
            nextStep: isComplete ? null : getNextStep(routineData, updatedSession.currentStep),
            completed: isComplete
        };

    } catch (error) {
        console.error('Error completing step:', error);
        throw error;
    }
}

/**
 * Skip current routine step
 * @param {string} userPubKey - User's public key
 * @param {string} sessionId - Routine session ID
 * @returns {Object} Updated session data
 */
async function skipStep(userPubKey, sessionId) {
    try {
        console.log(`Skipping current step for session ${sessionId}`);

        // Get current session
        const { getRecords } = require('../../../helpers/elasticsearch');

        const sessions = await getRecords({
            did: sessionId,
            storage: 'gun',
            creator_did_address: `did:arweave:${userPubKey}`,
            limit: 1
        });

        if (!sessions.records || sessions.records.length === 0) {
            throw new Error('Routine session not found');
        }

        const session = sessions.records[0];
        const sessionData = session.data.routineSession;

        // Get routine details
        const routines = await getRecords({
            did: sessionData.routineId,
            storage: 'gun',
            creator_did_address: `did:arweave:${userPubKey}`,
            limit: 1
        });

        const routine = routines.records[0];
        const routineData = routine.data.routine;

        // Move to next step
        const nextStepIndex = Math.min(sessionData.currentStep + 1, (routineData.steps?.length || 0) - 1);

        const updatedSession = {
            ...sessionData,
            currentStep: nextStepIndex,
            skippedSteps: [...(sessionData.skippedSteps || []), sessionData.currentStep],
            lastUpdated: new Date().toISOString()
        };

        const record = {
            routineSession: updatedSession
        };

        const result = await publishNewRecord(record, 'routineSession', false, false, false, null, 'gun', false, {
            storage: 'gun',
            publisherPubKey: userPubKey,
            localId: `routine_session_skip_${Date.now()}`
        });

        return {
            session: result.recordToIndex,
            routine: routineData,
            nextStep: getNextStep(routineData, nextStepIndex)
        };

    } catch (error) {
        console.error('Error skipping step:', error);
        throw error;
    }
}

/**
 * Get next step in routine
 * @param {Object} routine - Routine data
 * @param {number} stepIndex - Current step index
 * @returns {Object} Next step data
 */
function getNextStep(routine, stepIndex) {
    if (!routine.steps || stepIndex >= routine.steps.length) {
        return null;
    }

    const step = routine.steps[stepIndex];
    const duration = routine.stepDurations?.[stepIndex] || 0;

    return {
        index: stepIndex,
        description: step,
        duration: duration,
        estimatedTime: duration > 0 ? `${duration} minutes` : 'Variable time',
        progress: {
            current: stepIndex + 1,
            total: routine.steps.length,
            percentage: Math.round(((stepIndex + 1) / routine.steps.length) * 100)
        }
    };
}

/**
 * Create a new routine
 * @param {string} userPubKey - User's public key
 * @param {Object} routineData - Routine configuration
 * @returns {Object} Created routine
 */
async function createRoutine(userPubKey, routineData) {
    try {
        console.log('Creating new routine:', routineData.name);

        const routine = {
            routine: {
                name: routineData.name,
                type: routineData.type, // 'morning' or 'evening'
                totalDuration: calculateTotalDuration(routineData.stepDurations || []),
                steps: routineData.steps || [],
                stepDurations: routineData.stepDurations || [],
                enabled: routineData.enabled !== false,
                createdAt: new Date().toISOString(),
                userPubKey
            }
        };

        const result = await publishNewRecord(routine, 'routine', false, false, false, null, 'gun', false, {
            storage: 'gun',
            publisherPubKey: userPubKey,
            localId: `routine_${Date.now()}`
        });

        return result.recordToIndex;

    } catch (error) {
        console.error('Error creating routine:', error);
        throw error;
    }
}

/**
 * Update an existing routine
 * @param {string} userPubKey - User's public key
 * @param {string} routineId - Routine ID
 * @param {Object} updates - Updates to apply
 * @returns {Object} Updated routine
 */
async function updateRoutine(userPubKey, routineId, updates) {
    try {
        console.log('Updating routine:', routineId);

        // Get existing routine
        const { getRecords } = require('../../../helpers/elasticsearch');

        const routines = await getRecords({
            did: routineId,
            storage: 'gun',
            creator_did_address: `did:arweave:${userPubKey}`,
            limit: 1
        });

        if (!routines.records || routines.records.length === 0) {
            throw new Error('Routine not found');
        }

        const existingRoutine = routines.records[0];
        const routineData = existingRoutine.data.routine;

        // Apply updates
        const updatedRoutine = {
            ...routineData,
            ...updates,
            totalDuration: updates.stepDurations ?
                calculateTotalDuration(updates.stepDurations) :
                routineData.totalDuration,
            updatedAt: new Date().toISOString()
        };

        const record = {
            routine: updatedRoutine
        };

        const result = await publishNewRecord(record, 'routine', false, false, false, null, 'gun', false, {
            storage: 'gun',
            publisherPubKey: userPubKey,
            localId: `routine_update_${Date.now()}`
        });

        return result.recordToIndex;

    } catch (error) {
        console.error('Error updating routine:', error);
        throw error;
    }
}

/**
 * Get user's routines
 * @param {string} userPubKey - User's public key
 * @param {string} type - Optional: 'morning' or 'evening'
 * @returns {Array} User's routines
 */
async function getUserRoutines(userPubKey, type = null) {
    try {
        const { getRecords } = require('../../../helpers/elasticsearch');

        const filters = {
            recordType: 'routine',
            storage: 'gun',
            creator_did_address: `did:arweave:${userPubKey}`,
            limit: 20
        };

        if (type) {
            filters.exactMatch = { "data.routine.type": type };
        }

        const result = await getRecords(filters);

        return result.records?.map(record => ({
            id: record.oip?.did || record._id,
            ...record.data.routine
        })) || [];

    } catch (error) {
        console.error('Error getting user routines:', error);
        return [];
    }
}

/**
 * Get active routine session
 * @param {string} userPubKey - User's public key
 * @param {string} routineType - 'morning' or 'evening'
 * @returns {Object|null} Active session or null
 */
async function getActiveSession(userPubKey, routineType) {
    try {
        const { getRecords } = require('../../../helpers/elasticsearch');

        const sessions = await getRecords({
            recordType: 'routineSession',
            storage: 'gun',
            creator_did_address: `did:arweave:${userPubKey}`,
            exactMatch: {
                "data.routineSession.status": "in_progress",
                "data.routineSession.routineType": routineType
            },
            limit: 1,
            sortBy: 'date:desc'
        });

        if (sessions.records && sessions.records.length > 0) {
            const session = sessions.records[0];

            // Get routine details
            const routines = await getRecords({
                did: session.data.routineSession.routineId,
                storage: 'gun',
                creator_did_address: `did:arweave:${userPubKey}`,
                limit: 1
            });

            const routine = routines.records?.[0];

            return {
                session: session.data.routineSession,
                sessionId: session.oip?.did || session._id,
                routine: routine?.data?.routine,
                nextStep: getNextStep(routine?.data?.routine, session.data.routineSession.currentStep)
            };
        }

        return null;

    } catch (error) {
        console.error('Error getting active session:', error);
        return null;
    }
}

/**
 * Calculate total duration of routine
 * @param {Array} stepDurations - Array of step durations
 * @returns {number} Total duration in minutes
 */
function calculateTotalDuration(stepDurations) {
    return stepDurations?.reduce((total, duration) => total + (duration || 0), 0) || 0;
}

/**
 * Get routine suggestions based on time of day
 * @param {string} userPubKey - User's public key
 * @returns {Object} Routine suggestions
 */
async function getRoutineSuggestions(userPubKey) {
    try {
        const now = moment();
        const hour = now.hour();

        let suggestedType = null;
        let reason = '';

        // Morning routine (6 AM - 10 AM)
        if (hour >= 6 && hour <= 10) {
            suggestedType = 'morning';
            reason = 'Good morning! Time for your morning routine to start the day right.';
        }
        // Evening routine (6 PM - 10 PM)
        else if (hour >= 18 && hour <= 22) {
            suggestedType = 'evening';
            reason = 'Good evening! Time to wind down with your evening routine.';
        }

        if (!suggestedType) {
            return {
                hasSuggestion: false,
                message: 'No routine suggestions at this time.'
            };
        }

        // Check if user has this type of routine
        const routines = await getUserRoutines(userPubKey, suggestedType);
        const activeSession = await getActiveSession(userPubKey, suggestedType);

        if (routines.length === 0) {
            return {
                hasSuggestion: false,
                message: `You don't have a ${suggestedType} routine set up yet. Would you like to create one?`
            };
        }

        if (activeSession) {
            return {
                hasSuggestion: true,
                type: 'continue',
                routineType: suggestedType,
                sessionId: activeSession.sessionId,
                message: `You have a ${suggestedType} routine in progress. Would you like to continue?`,
                nextStep: activeSession.nextStep
            };
        }

        return {
            hasSuggestion: true,
            type: 'start',
            routineType: suggestedType,
            message: reason,
            availableRoutines: routines.length
        };

    } catch (error) {
        console.error('Error getting routine suggestions:', error);
        return {
            hasSuggestion: false,
            message: 'Unable to get routine suggestions at this time.'
        };
    }
}

/**
 * Get routine statistics
 * @param {string} userPubKey - User's public key
 * @returns {Object} Routine statistics
 */
async function getRoutineStats(userPubKey) {
    try {
        const { getRecords } = require('../../../helpers/elasticsearch');

        // Get all routine sessions
        const sessions = await getRecords({
            recordType: 'routineSession',
            storage: 'gun',
            creator_did_address: `did:arweave:${userPubKey}`,
            limit: 1000
        });

        const sessionRecords = sessions.records || [];

        const stats = {
            totalSessions: sessionRecords.length,
            completedSessions: sessionRecords.filter(s => s.data?.routineSession?.status === 'completed').length,
            inProgressSessions: sessionRecords.filter(s => s.data?.routineSession?.status === 'in_progress').length,
            morningRoutines: sessionRecords.filter(s => s.data?.routineSession?.routineType === 'morning').length,
            eveningRoutines: sessionRecords.filter(s => s.data?.routineSession?.routineType === 'evening').length,
            averageCompletionTime: calculateAverageCompletionTime(sessionRecords)
        };

        stats.completionRate = stats.totalSessions > 0 ?
            (stats.completedSessions / stats.totalSessions * 100).toFixed(1) : 0;

        return stats;

    } catch (error) {
        console.error('Error getting routine stats:', error);
        return {
            totalSessions: 0,
            completedSessions: 0,
            inProgressSessions: 0,
            morningRoutines: 0,
            eveningRoutines: 0,
            completionRate: 0,
            averageCompletionTime: 0
        };
    }
}

/**
 * Calculate average completion time
 * @param {Array} sessions - Routine session records
 * @returns {number} Average completion time in minutes
 */
function calculateAverageCompletionTime(sessions) {
    const completedSessions = sessions.filter(s =>
        s.data?.routineSession?.status === 'completed' &&
        s.data?.routineSession?.startedAt &&
        s.data?.routineSession?.completedAt
    );

    if (completedSessions.length === 0) {
        return 0;
    }

    const totalTime = completedSessions.reduce((sum, session) => {
        const start = new Date(session.data.routineSession.startedAt);
        const end = new Date(session.data.routineSession.completedAt);
        return sum + (end - start) / (1000 * 60); // Convert to minutes
    }, 0);

    return Math.round(totalTime / completedSessions.length);
}

module.exports = {
    startRoutine,
    completeStep,
    skipStep,
    createRoutine,
    updateRoutine,
    getUserRoutines,
    getActiveSession,
    getRoutineSuggestions,
    getRoutineStats,
    getNextStep,
    calculateTotalDuration
};
