/**
 * ALFRED Productivity Module - Main Routes
 * Core API endpoints for productivity management
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../../helpers/utils');
const { getRecords } = require('../../../helpers/elasticsearch');
const { publishNewRecord, publishToGun } = require('../../../helpers/templateHelper');
const productivityTemplates = require('../config/productivity-templates');
const defaultSettings = require('../config/default-settings');

// Import helper modules (to be created)
const taskParser = require('../helpers/task-parser');
const schedulerEngine = require('../helpers/scheduler-engine');
const pointSystem = require('../helpers/point-system');
const routineManager = require('../helpers/routine-manager');

// Health check endpoint
router.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        module: 'alfred-productivity',
        version: '1.0.0',
        timestamp: new Date().toISOString()
    });
});

/**
 * GET /api/productivity/dashboard
 * Get user's productivity dashboard data
 */
router.get('/dashboard', authenticateToken, async (req, res) => {
    try {
        const userPubKey = req.user.publisherPubKey;
        const weekStart = getWeekStart();
        const weekEnd = getWeekEnd();

        // Get current week's data
        const [tasks, sessions, routines, rewards] = await Promise.all([
            getRecords({
                recordType: 'task',
                storage: 'gun',
                creator_did_address: req.user.didAddress,
                dateStart: weekStart,
                dateEnd: weekEnd,
                limit: 100
            }),
            getRecords({
                recordType: 'calendarSession',
                storage: 'gun',
                creator_did_address: req.user.didAddress,
                limit: 1
            }),
            getRecords({
                recordType: 'routine',
                storage: 'gun',
                creator_did_address: req.user.didAddress,
                limit: 10
            }),
            getRecords({
                recordType: 'rewardPlan',
                storage: 'gun',
                creator_did_address: req.user.didAddress,
                limit: 20
            })
        ]);

        res.json({
            success: true,
            data: {
                tasks: tasks.records || [],
                currentSession: sessions.records?.[0] || null,
                routines: routines.records || [],
                rewards: rewards.records || [],
                weekStart,
                weekEnd,
                stats: calculateWeeklyStats(tasks.records || [])
            }
        });
    } catch (error) {
        console.error('Error fetching productivity dashboard:', error);
        res.status(500).json({
            error: 'Failed to fetch dashboard data',
            details: error.message
        });
    }
});

/**
 * POST /api/productivity/tasks
 * Create a new task via voice/text input
 */
router.post('/tasks', authenticateToken, async (req, res) => {
    try {
        const { taskInput, parseNaturalLanguage = true } = req.body;
        const userPubKey = req.user.publisherPubKey;

        let taskData;
        if (parseNaturalLanguage) {
            // Use NLP to parse the task input
            taskData = await taskParser.parseTaskInput(taskInput);
        } else {
            taskData = taskInput;
        }

        // Set default values
        taskData.status = taskData.status || 'pending';
        taskData.points = taskData.points || defaultSettings.defaultTaskPoints;
        taskData.priority = taskData.priority || defaultSettings.defaultTaskPriority;

        const record = {
            task: taskData
        };

        // Publish to GUN for private storage
        const result = await publishNewRecord(record, 'task', false, false, false, null, 'gun', false, {
            storage: 'gun',
            publisherPubKey: userPubKey,
            localId: `task_${Date.now()}`
        });

        res.json({
            success: true,
            task: result.recordToIndex,
            did: result.did,
            parsed: parseNaturalLanguage ? taskData : null
        });
    } catch (error) {
        console.error('Error creating task:', error);
        res.status(500).json({
            error: 'Failed to create task',
            details: error.message
        });
    }
});

/**
 * GET /api/productivity/tasks
 * Get user's tasks with filtering
 */
router.get('/tasks', authenticateToken, async (req, res) => {
    try {
        const { status, priority, category, limit = 50, page = 1 } = req.query;

        const filters = {
            recordType: 'task',
            storage: 'gun',
            creator_did_address: req.user.didAddress,
            limit: parseInt(limit),
            page: parseInt(page)
        };

        // Add filters if provided
        if (status) filters.exactMatch = { "data.task.status": status };
        if (priority) filters.exactMatch = { ...filters.exactMatch, "data.task.priority": priority };
        if (category) filters.tags = category;

        const result = await getRecords(filters);

        res.json({
            success: true,
            tasks: result.records,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: result.totalRecords || 0,
                pages: Math.ceil((result.totalRecords || 0) / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Error fetching tasks:', error);
        res.status(500).json({
            error: 'Failed to fetch tasks',
            details: error.message
        });
    }
});

/**
 * PUT /api/productivity/tasks/:taskId
 * Update a task
 */
router.put('/tasks/:taskId', authenticateToken, async (req, res) => {
    try {
        const { taskId } = req.params;
        const updates = req.body;

        // Find the existing task
        const existingTask = await getRecords({
            did: taskId,
            storage: 'gun',
            creator_did_address: req.user.didAddress,
            limit: 1
        });

        if (!existingTask.records || existingTask.records.length === 0) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const task = existingTask.records[0];
        const updatedTask = {
            ...task.data.task,
            ...updates,
            updatedAt: new Date().toISOString()
        };

        const record = {
            task: updatedTask
        };

        // Publish updated record
        const result = await publishNewRecord(record, 'task', false, false, false, null, 'gun', false, {
            storage: 'gun',
            publisherPubKey: req.user.publisherPubKey,
            localId: `task_${Date.now()}_update`
        });

        res.json({
            success: true,
            task: result.recordToIndex,
            did: result.did
        });
    } catch (error) {
        console.error('Error updating task:', error);
        res.status(500).json({
            error: 'Failed to update task',
            details: error.message
        });
    }
});

/**
 * POST /api/productivity/tasks/:taskId/complete
 * Mark a task as completed and award points
 */
router.post('/tasks/:taskId/complete', authenticateToken, async (req, res) => {
    try {
        const { taskId } = req.params;
        const { notes } = req.body;

        // Find the existing task
        const existingTask = await getRecords({
            did: taskId,
            storage: 'gun',
            creator_did_address: req.user.didAddress,
            limit: 1
        });

        if (!existingTask.records || existingTask.records.length === 0) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const task = existingTask.records[0];
        const completedTask = {
            ...task.data.task,
            status: 'completed',
            completedAt: new Date().toISOString(),
            notes: notes || null
        };

        const record = {
            task: completedTask
        };

        // Publish updated record
        const result = await publishNewRecord(record, 'task', false, false, false, null, 'gun', false, {
            storage: 'gun',
            publisherPubKey: req.user.publisherPubKey,
            localId: `task_${Date.now()}_complete`
        });

        // Award points if applicable
        const pointsEarned = await pointSystem.awardPoints(
            req.user.publisherPubKey,
            completedTask.points || defaultSettings.defaultTaskPoints,
            'task_completion'
        );

        res.json({
            success: true,
            task: result.recordToIndex,
            did: result.did,
            pointsEarned
        });
    } catch (error) {
        console.error('Error completing task:', error);
        res.status(500).json({
            error: 'Failed to complete task',
            details: error.message
        });
    }
});

/**
 * DELETE /api/productivity/tasks/:taskId
 * Delete a task
 */
router.delete('/tasks/:taskId', authenticateToken, async (req, res) => {
    try {
        const { taskId } = req.params;

        // Verify ownership and delete
        // Note: GUN records are immutable, so we mark as deleted
        const deletedTask = {
            task: {
                id: taskId,
                deleted: true,
                deletedAt: new Date().toISOString()
            }
        };

        const result = await publishNewRecord(deletedTask, 'task', false, false, false, null, 'gun', false, {
            storage: 'gun',
            publisherPubKey: req.user.publisherPubKey,
            localId: `task_${Date.now()}_delete`
        });

        res.json({
            success: true,
            message: 'Task marked as deleted',
            did: result.did
        });
    } catch (error) {
        console.error('Error deleting task:', error);
        res.status(500).json({
            error: 'Failed to delete task',
            details: error.message
        });
    }
});

/**
 * GET /api/productivity/calendar
 * Get weekly calendar view with scheduled tasks
 */
router.get('/calendar', authenticateToken, async (req, res) => {
    try {
        const { weekStart } = req.query;
        const week = weekStart ? new Date(weekStart) : getWeekStart();

        // Get tasks for the week
        const tasks = await getRecords({
            recordType: 'task',
            storage: 'gun',
            creator_did_address: req.user.didAddress,
            dateStart: week,
            dateEnd: new Date(week.getTime() + 7 * 24 * 60 * 60 * 1000),
            limit: 100
        });

        // Get current session
        const sessions = await getRecords({
            recordType: 'calendarSession',
            storage: 'gun',
            creator_did_address: req.user.didAddress,
            limit: 1
        });

        // Generate calendar view
        const calendarView = await schedulerEngine.generateCalendarView(
            tasks.records || [],
            sessions.records?.[0] || null,
            week
        );

        res.json({
            success: true,
            calendar: calendarView,
            weekStart: week.toISOString(),
            weekEnd: new Date(week.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
        });
    } catch (error) {
        console.error('Error fetching calendar:', error);
        res.status(500).json({
            error: 'Failed to fetch calendar data',
            details: error.message
        });
    }
});

/**
 * POST /api/productivity/calendar/generate
 * Generate weekly schedule based on tasks and time budget
 */
router.post('/calendar/generate', authenticateToken, async (req, res) => {
    try {
        const { timeBudget } = req.body;

        // Get user's tasks
        const tasks = await getRecords({
            recordType: 'task',
            storage: 'gun',
            creator_did_address: req.user.didAddress,
            exactMatch: { "data.task.status": "pending" },
            limit: 100
        });

        // Generate schedule
        const schedule = await schedulerEngine.generateSchedule(
            tasks.records || [],
            timeBudget || defaultSettings.timeBudget
        );

        res.json({
            success: true,
            schedule,
            message: 'Weekly schedule generated successfully'
        });
    } catch (error) {
        console.error('Error generating schedule:', error);
        res.status(500).json({
            error: 'Failed to generate schedule',
            details: error.message
        });
    }
});

// Utility functions
function getWeekStart(date = new Date()) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day;
    return new Date(d.setDate(diff));
}

function getWeekEnd(date = new Date()) {
    const weekStart = getWeekStart(date);
    return new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000);
}

function calculateWeeklyStats(tasks) {
    const stats = {
        totalTasks: tasks.length,
        completedTasks: tasks.filter(t => t.data?.task?.status === 'completed').length,
        pendingTasks: tasks.filter(t => t.data?.task?.status === 'pending').length,
        totalPoints: tasks.reduce((sum, t) => sum + (t.data?.task?.points || 0), 0),
        earnedPoints: tasks
            .filter(t => t.data?.task?.status === 'completed')
            .reduce((sum, t) => sum + (t.data?.task?.points || 0), 0)
    };

    stats.completionRate = stats.totalTasks > 0 ?
        (stats.completedTasks / stats.totalTasks * 100).toFixed(1) : 0;

    return stats;
}

module.exports = router;
