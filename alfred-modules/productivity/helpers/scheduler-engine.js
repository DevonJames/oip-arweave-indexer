/**
 * ALFRED Productivity Module - Scheduler Engine
 * Intelligent time allocation and calendar management
 */

const moment = require('moment');
const defaultSettings = require('../config/default-settings');

/**
 * Generate weekly schedule based on tasks and time budget
 * @param {Array} tasks - Array of task records
 * @param {Object} timeBudget - User's time budget configuration
 * @returns {Object} Generated schedule with time allocations
 */
async function generateSchedule(tasks, timeBudget) {
    try {
        console.log('Generating schedule for', tasks.length, 'tasks');

        // Separate fixed and flexible tasks
        const fixedTasks = tasks.filter(task =>
            task.data?.task?.taskType === 'fixed' &&
            task.data?.task?.scheduledTime
        );

        const flexibleTasks = tasks.filter(task =>
            task.data?.task?.taskType !== 'fixed' ||
            !task.data?.task?.scheduledTime
        );

        // Calculate available time blocks
        const availableBlocks = calculateAvailableTimeBlocks(timeBudget);

        // Schedule fixed tasks first
        const scheduledFixed = scheduleFixedTasks(fixedTasks, availableBlocks);

        // Schedule flexible tasks in remaining time
        const scheduledFlexible = scheduleFlexibleTasks(flexibleTasks, availableBlocks);

        // Generate calendar session
        const calendarSession = createCalendarSession(
            [...scheduledFixed, ...scheduledFlexible],
            timeBudget
        );

        return {
            fixedTasks: scheduledFixed,
            flexibleTasks: scheduledFlexible,
            availableBlocks,
            calendarSession,
            stats: calculateScheduleStats([...scheduledFixed, ...scheduledFlexible])
        };

    } catch (error) {
        console.error('Error generating schedule:', error);
        throw new Error(`Schedule generation failed: ${error.message}`);
    }
}

/**
 * Calculate available time blocks based on time budget
 * @param {Object} timeBudget - Time budget configuration
 * @returns {Array} Array of available time blocks
 */
function calculateAvailableTimeBlocks(timeBudget) {
    const blocks = [];
    const weekStart = moment().startOf('week').add(1, 'day'); // Monday

    // Calculate daily available time
    const totalFixedDaily = (
        (timeBudget.sleep?.hoursPerNight || 8) +
        (timeBudget.work?.hoursPerDay || 8) +
        (timeBudget.meals?.minutesPerDay || 60) / 60 +
        (timeBudget.exercise?.minutesPerSession || 45) * (timeBudget.exercise?.sessionsPerWeek || 3) / 7 / 60
    );

    const availableHoursPerDay = 24 - totalFixedDaily;
    const availableMinutesPerDay = availableHoursPerDay * 60;

    // Generate blocks for each day of the week
    for (let day = 0; day < 7; day++) {
        const dayStart = moment(weekStart).add(day, 'days');

        // Assume productive hours are 9 AM to 6 PM (adjustable)
        const workStart = moment(dayStart).set({ hour: 9, minute: 0 });
        const workEnd = moment(dayStart).set({ hour: 18, minute: 0 });

        blocks.push({
            day: dayStart.format('dddd'),
            date: dayStart.format('YYYY-MM-DD'),
            startTime: workStart.toDate(),
            endTime: workEnd.toDate(),
            duration: workEnd.diff(workStart, 'minutes'),
            available: availableMinutesPerDay,
            used: 0
        });
    }

    return blocks;
}

/**
 * Schedule fixed tasks (those with specific times)
 * @param {Array} fixedTasks - Tasks with scheduled times
 * @param {Array} availableBlocks - Available time blocks
 * @returns {Array} Scheduled fixed tasks
 */
function scheduleFixedTasks(fixedTasks, availableBlocks) {
    const scheduled = [];

    fixedTasks.forEach(task => {
        const taskTime = moment(task.data.task.scheduledTime);
        const duration = task.data.task.duration || 30;

        // Find appropriate block
        const block = availableBlocks.find(b =>
            moment(b.startTime).isSame(taskTime, 'day')
        );

        if (block && block.available >= duration) {
            scheduled.push({
                ...task,
                scheduledBlock: {
                    date: block.date,
                    startTime: taskTime.toDate(),
                    endTime: moment(taskTime).add(duration, 'minutes').toDate(),
                    duration: duration
                }
            });

            block.used += duration;
            block.available -= duration;
        } else {
            // Could not schedule - mark as unscheduled
            scheduled.push({
                ...task,
                scheduledBlock: null,
                conflict: true
            });
        }
    });

    return scheduled;
}

/**
 * Schedule flexible tasks in available time slots
 * @param {Array} flexibleTasks - Tasks without fixed times
 * @param {Array} availableBlocks - Available time blocks
 * @returns {Array} Scheduled flexible tasks
 */
function scheduleFlexibleTasks(flexibleTasks, availableBlocks) {
    const scheduled = [];

    // Sort tasks by priority (high -> medium -> low)
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    flexibleTasks.sort((a, b) => {
        const aPriority = priorityOrder[a.data?.task?.priority] || 1;
        const bPriority = priorityOrder[b.data?.task?.priority] || 1;
        return bPriority - aPriority;
    });

    flexibleTasks.forEach(task => {
        const duration = task.data.task.duration || 30;

        // Find best available block
        const bestBlock = availableBlocks
            .filter(block => block.available >= duration)
            .sort((a, b) => a.used - b.used)[0]; // Least used block first

        if (bestBlock) {
            // Schedule at the beginning of the available time
            const startTime = moment(bestBlock.startTime).add(bestBlock.used, 'minutes');

            scheduled.push({
                ...task,
                scheduledBlock: {
                    date: bestBlock.date,
                    startTime: startTime.toDate(),
                    endTime: moment(startTime).add(duration, 'minutes').toDate(),
                    duration: duration
                }
            });

            bestBlock.used += duration;
            bestBlock.available -= duration;
        } else {
            // No available time - mark as unscheduled
            scheduled.push({
                ...task,
                scheduledBlock: null,
                conflict: true
            });
        }
    });

    return scheduled;
}

/**
 * Create calendar session record
 * @param {Array} scheduledTasks - All scheduled tasks
 * @param {Object} timeBudget - Time budget configuration
 * @returns {Object} Calendar session record
 */
function createCalendarSession(scheduledTasks, timeBudget) {
    const weekStart = moment().startOf('week').add(1, 'day'); // Monday
    const weekEnd = moment(weekStart).add(6, 'days'); // Sunday

    const totalPoints = scheduledTasks.reduce((sum, task) =>
        sum + (task.data?.task?.points || 0), 0
    );

    return {
        calendarSession: {
            weekStart: weekStart.valueOf(),
            weekEnd: weekEnd.valueOf(),
            totalPoints,
            earnedPoints: 0, // Will be updated as tasks are completed
            sleepHours: timeBudget.sleep?.hoursPerNight || 8,
            workHours: timeBudget.work?.hoursPerDay || 8,
            workDays: timeBudget.work?.daysPerWeek || 5,
            exerciseMinutes: timeBudget.exercise?.minutesPerSession || 45,
            exerciseSessions: timeBudget.exercise?.sessionsPerWeek || 3,
            mealMinutes: timeBudget.meals?.minutesPerDay || 60,
            tasks: scheduledTasks.map(task => task.oip?.did || task._id),
            calendarSynced: false,
            googleCalendarId: null,
            icloudCalendarId: null
        }
    };
}

/**
 * Generate calendar view for UI display
 * @param {Array} tasks - Task records
 * @param {Object} currentSession - Current calendar session
 * @param {Date} weekStart - Start of week to display
 * @returns {Object} Calendar view data
 */
async function generateCalendarView(tasks, currentSession, weekStart) {
    const calendar = {};

    // Initialize empty calendar for 7 days
    for (let i = 0; i < 7; i++) {
        const date = moment(weekStart).add(i, 'days');
        const dateKey = date.format('YYYY-MM-DD');
        calendar[dateKey] = {
            date: dateKey,
            day: date.format('dddd'),
            tasks: [],
            routines: [],
            totalScheduled: 0
        };
    }

    // Add tasks to calendar
    tasks.forEach(task => {
        if (task.data?.task?.scheduledTime) {
            const taskDate = moment(task.data.task.scheduledTime).format('YYYY-MM-DD');

            if (calendar[taskDate]) {
                calendar[taskDate].tasks.push({
                    id: task.oip?.did || task._id,
                    title: task.data.task.title,
                    startTime: task.data.task.scheduledTime,
                    duration: task.data.task.duration || 30,
                    category: task.data.task.category,
                    priority: task.data.task.priority,
                    status: task.data.task.status
                });

                calendar[taskDate].totalScheduled += task.data.task.duration || 30;
            }
        }
    });

    return {
        calendar,
        session: currentSession,
        weekStart: weekStart.toISOString(),
        summary: {
            totalTasks: tasks.length,
            scheduledTasks: Object.values(calendar).reduce((sum, day) => sum + day.tasks.length, 0),
            totalScheduledMinutes: Object.values(calendar).reduce((sum, day) => sum + day.totalScheduled, 0)
        }
    };
}

/**
 * Calculate schedule statistics
 * @param {Array} scheduledTasks - All scheduled tasks
 * @returns {Object} Schedule statistics
 */
function calculateScheduleStats(scheduledTasks) {
    const stats = {
        totalTasks: scheduledTasks.length,
        scheduledTasks: scheduledTasks.filter(t => t.scheduledBlock).length,
        unscheduledTasks: scheduledTasks.filter(t => !t.scheduledBlock).length,
        totalScheduledMinutes: scheduledTasks
            .filter(t => t.scheduledBlock)
            .reduce((sum, t) => sum + (t.scheduledBlock.duration || 0), 0),
        conflicts: scheduledTasks.filter(t => t.conflict).length,
        byPriority: {
            high: scheduledTasks.filter(t => t.data?.task?.priority === 'high').length,
            medium: scheduledTasks.filter(t => t.data?.task?.priority === 'medium').length,
            low: scheduledTasks.filter(t => t.data?.task?.priority === 'low').length
        },
        byCategory: {}
    };

    // Group by category
    scheduledTasks.forEach(task => {
        const category = task.data?.task?.category || 'General';
        stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;
    });

    return stats;
}

/**
 * Optimize schedule for better time utilization
 * @param {Array} tasks - Tasks to optimize
 * @param {Array} availableBlocks - Available time blocks
 * @returns {Array} Optimized task schedule
 */
function optimizeSchedule(tasks, availableBlocks) {
    // Simple optimization: group similar tasks together
    const optimizedTasks = [...tasks];

    // Group by category for better focus
    optimizedTasks.sort((a, b) => {
        const categoryA = a.data?.task?.category || '';
        const categoryB = b.data?.task?.category || '';
        if (categoryA === categoryB) {
            // Within same category, sort by priority
            const priorityOrder = { high: 3, medium: 2, low: 1 };
            const priorityA = priorityOrder[a.data?.task?.priority] || 1;
            const priorityB = priorityOrder[b.data?.task?.priority] || 1;
            return priorityB - priorityA;
        }
        return categoryA.localeCompare(categoryB);
    });

    return optimizedTasks;
}

module.exports = {
    generateSchedule,
    calculateAvailableTimeBlocks,
    scheduleFixedTasks,
    scheduleFlexibleTasks,
    createCalendarSession,
    generateCalendarView,
    calculateScheduleStats,
    optimizeSchedule
};
