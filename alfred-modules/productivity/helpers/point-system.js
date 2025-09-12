/**
 * ALFRED Productivity Module - Point System
 * Gamification engine for productivity rewards and achievements
 */

const { publishNewRecord } = require('../../../helpers/templateHelper');
const defaultSettings = require('../config/default-settings');

/**
 * Award points for completed tasks or achievements
 * @param {string} userPubKey - User's public key
 * @param {number} points - Points to award
 * @param {string} reason - Reason for awarding points
 * @returns {number} Points actually awarded
 */
async function awardPoints(userPubKey, points, reason) {
    try {
        console.log(`Awarding ${points} points to user for: ${reason}`);

        // Create points transaction record
        const pointsRecord = {
            pointsTransaction: {
                userPubKey,
                points,
                reason,
                timestamp: new Date().toISOString(),
                transactionType: 'earned'
            }
        };

        // Publish to GUN for private storage
        await publishNewRecord(pointsRecord, 'pointsTransaction', false, false, false, null, 'gun', false, {
            storage: 'gun',
            publisherPubKey: userPubKey,
            localId: `points_${Date.now()}`
        });

        // Update user's total points
        await updateUserPoints(userPubKey, points, 'add');

        console.log(`✅ Awarded ${points} points for ${reason}`);
        return points;

    } catch (error) {
        console.error('Error awarding points:', error);
        return 0;
    }
}

/**
 * Deduct points (for penalties or purchases)
 * @param {string} userPubKey - User's public key
 * @param {number} points - Points to deduct
 * @param {string} reason - Reason for deduction
 * @returns {number} Points actually deducted
 */
async function deductPoints(userPubKey, points, reason) {
    try {
        console.log(`Deducting ${points} points from user for: ${reason}`);

        const pointsRecord = {
            pointsTransaction: {
                userPubKey,
                points: -points, // Negative for deductions
                reason,
                timestamp: new Date().toISOString(),
                transactionType: 'deducted'
            }
        };

        await publishNewRecord(pointsRecord, 'pointsTransaction', false, false, false, null, 'gun', false, {
            storage: 'gun',
            publisherPubKey: userPubKey,
            localId: `points_${Date.now()}`
        });

        await updateUserPoints(userPubKey, points, 'subtract');

        console.log(`✅ Deducted ${points} points for ${reason}`);
        return points;

    } catch (error) {
        console.error('Error deducting points:', error);
        return 0;
    }
}

/**
 * Update user's total points
 * @param {string} userPubKey - User's public key
 * @param {number} points - Points to add/subtract
 * @param {string} operation - 'add' or 'subtract'
 */
async function updateUserPoints(userPubKey, points, operation) {
    try {
        // Create or update points balance record
        const balanceRecord = {
            pointsBalance: {
                userPubKey,
                lastUpdated: new Date().toISOString(),
                operation,
                pointsChange: points
            }
        };

        await publishNewRecord(balanceRecord, 'pointsBalance', false, false, false, null, 'gun', false, {
            storage: 'gun',
            publisherPubKey: userPubKey,
            localId: `balance_${Date.now()}`
        });

    } catch (error) {
        console.error('Error updating user points:', error);
    }
}

/**
 * Get user's current point balance
 * @param {string} userPubKey - User's public key
 * @returns {number} Current point balance
 */
async function getUserPoints(userPubKey) {
    try {
        const { getRecords } = require('../../../helpers/elasticsearch');

        const transactions = await getRecords({
            recordType: 'pointsTransaction',
            storage: 'gun',
            creator_did_address: `did:arweave:${userPubKey}`,
            limit: 1000 // Get all transactions
        });

        let balance = 0;
        transactions.records?.forEach(record => {
            balance += record.data?.pointsTransaction?.points || 0;
        });

        return Math.max(0, balance); // Never go below 0

    } catch (error) {
        console.error('Error getting user points:', error);
        return 0;
    }
}

/**
 * Check if user can unlock rewards
 * @param {string} userPubKey - User's public key
 * @returns {Array} Array of available rewards
 */
async function checkAvailableRewards(userPubKey) {
    try {
        const { getRecords } = require('../../../helpers/elasticsearch');
        const currentPoints = await getUserPoints(userPubKey);

        // Get all reward plans
        const rewards = await getRecords({
            recordType: 'rewardPlan',
            storage: 'gun',
            creator_did_address: `did:arweave:${userPubKey}`,
            limit: 100
        });

        const availableRewards = [];

        rewards.records?.forEach(record => {
            const reward = record.data?.rewardPlan;
            if (reward && !reward.unlockedAt && currentPoints >= reward.threshold) {
                availableRewards.push({
                    id: record.oip?.did || record._id,
                    name: reward.name,
                    description: reward.description,
                    threshold: reward.threshold,
                    rewardType: reward.rewardType,
                    pointsNeeded: reward.threshold - currentPoints
                });
            }
        });

        return availableRewards;

    } catch (error) {
        console.error('Error checking available rewards:', error);
        return [];
    }
}

/**
 * Unlock a reward for the user
 * @param {string} userPubKey - User's public key
 * @param {string} rewardId - Reward record ID
 * @returns {Object} Unlock result
 */
async function unlockReward(userPubKey, rewardId) {
    try {
        const { getRecords } = require('../../../helpers/elasticsearch');

        // Get the reward
        const rewardRecords = await getRecords({
            did: rewardId,
            storage: 'gun',
            creator_did_address: `did:arweave:${userPubKey}`,
            limit: 1
        });

        if (!rewardRecords.records || rewardRecords.records.length === 0) {
            throw new Error('Reward not found');
        }

        const reward = rewardRecords.records[0];
        const currentPoints = await getUserPoints(userPubKey);

        if (currentPoints < reward.data.rewardPlan.threshold) {
            throw new Error('Insufficient points to unlock reward');
        }

        // Mark reward as unlocked
        const unlockedReward = {
            ...reward.data.rewardPlan,
            unlockedAt: new Date().toISOString()
        };

        const record = {
            rewardPlan: unlockedReward
        };

        await publishNewRecord(record, 'rewardPlan', false, false, false, null, 'gun', false, {
            storage: 'gun',
            publisherPubKey: userPubKey,
            localId: `reward_unlock_${Date.now()}`
        });

        // Deduct points for the reward
        await deductPoints(userPubKey, reward.data.rewardPlan.threshold, `Unlocked reward: ${reward.data.rewardPlan.name}`);

        return {
            success: true,
            reward: unlockedReward,
            pointsSpent: reward.data.rewardPlan.threshold,
            remainingPoints: currentPoints - reward.data.rewardPlan.threshold
        };

    } catch (error) {
        console.error('Error unlocking reward:', error);
        throw error;
    }
}

/**
 * Get user's points history
 * @param {string} userPubKey - User's public key
 * @param {number} limit - Number of transactions to return
 * @returns {Array} Points transaction history
 */
async function getPointsHistory(userPubKey, limit = 50) {
    try {
        const { getRecords } = require('../../../helpers/elasticsearch');

        const transactions = await getRecords({
            recordType: 'pointsTransaction',
            storage: 'gun',
            creator_did_address: `did:arweave:${userPubKey}`,
            limit,
            sortBy: 'date:desc'
        });

        return transactions.records?.map(record => ({
            id: record.oip?.did || record._id,
            points: record.data?.pointsTransaction?.points || 0,
            reason: record.data?.pointsTransaction?.reason || '',
            timestamp: record.data?.pointsTransaction?.timestamp,
            type: record.data?.pointsTransaction?.transactionType || 'earned'
        })) || [];

    } catch (error) {
        console.error('Error getting points history:', error);
        return [];
    }
}

/**
 * Get productivity statistics
 * @param {string} userPubKey - User's public key
 * @returns {Object} Productivity statistics
 */
async function getProductivityStats(userPubKey) {
    try {
        const { getRecords } = require('../../../helpers/elasticsearch');

        // Get tasks for current week
        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1); // Monday
        weekStart.setHours(0, 0, 0, 0);

        const tasks = await getRecords({
            recordType: 'task',
            storage: 'gun',
            creator_did_address: `did:arweave:${userPubKey}`,
            dateStart: weekStart,
            limit: 200
        });

        const taskRecords = tasks.records || [];
        const currentPoints = await getUserPoints(userPubKey);

        const stats = {
            currentPoints,
            weeklyStats: {
                totalTasks: taskRecords.length,
                completedTasks: taskRecords.filter(t => t.data?.task?.status === 'completed').length,
                pendingTasks: taskRecords.filter(t => t.data?.task?.status === 'pending').length,
                inProgressTasks: taskRecords.filter(t => t.data?.task?.status === 'in_progress').length,
                totalPointsEarned: taskRecords
                    .filter(t => t.data?.task?.status === 'completed')
                    .reduce((sum, t) => sum + (t.data?.task?.points || 0), 0)
            },
            streaks: calculateStreaks(taskRecords),
            achievements: await getAchievements(userPubKey)
        };

        stats.weeklyStats.completionRate = stats.weeklyStats.totalTasks > 0 ?
            (stats.weeklyStats.completedTasks / stats.weeklyStats.totalTasks * 100).toFixed(1) : 0;

        return stats;

    } catch (error) {
        console.error('Error getting productivity stats:', error);
        return {
            currentPoints: 0,
            weeklyStats: {
                totalTasks: 0,
                completedTasks: 0,
                pendingTasks: 0,
                inProgressTasks: 0,
                totalPointsEarned: 0,
                completionRate: 0
            },
            streaks: { current: 0, longest: 0 },
            achievements: []
        };
    }
}

/**
 * Calculate completion streaks
 * @param {Array} tasks - Task records
 * @returns {Object} Streak information
 */
function calculateStreaks(tasks) {
    // Sort tasks by completion date
    const completedTasks = tasks
        .filter(t => t.data?.task?.status === 'completed' && t.data?.task?.completedAt)
        .sort((a, b) => new Date(a.data.task.completedAt) - new Date(b.data.task.completedAt));

    if (completedTasks.length === 0) {
        return { current: 0, longest: 0 };
    }

    let currentStreak = 1;
    let longestStreak = 1;
    let tempStreak = 1;

    for (let i = 1; i < completedTasks.length; i++) {
        const prevDate = new Date(completedTasks[i - 1].data.task.completedAt);
        const currDate = new Date(completedTasks[i].data.task.completedAt);

        // Check if tasks were completed on consecutive days
        const dayDiff = Math.floor((currDate - prevDate) / (1000 * 60 * 60 * 24));

        if (dayDiff === 1) {
            tempStreak++;
            longestStreak = Math.max(longestStreak, tempStreak);
        } else if (dayDiff > 1) {
            tempStreak = 1;
        }
    }

    // Calculate current streak (from most recent completion)
    const mostRecent = new Date(completedTasks[completedTasks.length - 1].data.task.completedAt);
    const today = new Date();
    const daysSinceLastCompletion = Math.floor((today - mostRecent) / (1000 * 60 * 60 * 24));

    currentStreak = daysSinceLastCompletion <= 1 ? tempStreak : 0;

    return {
        current: currentStreak,
        longest: longestStreak
    };
}

/**
 * Get user's achievements
 * @param {string} userPubKey - User's public key
 * @returns {Array} Array of unlocked achievements
 */
async function getAchievements(userPubKey) {
    try {
        const { getRecords } = require('../../../helpers/elasticsearch');

        // Get all completed tasks
        const tasks = await getRecords({
            recordType: 'task',
            storage: 'gun',
            creator_did_address: `did:arweave:${userPubKey}`,
            exactMatch: { "data.task.status": "completed" },
            limit: 1000
        });

        const completedTasks = tasks.records || [];
        const achievements = [];

        // First Task Achievement
        if (completedTasks.length >= 1) {
            achievements.push({
                id: 'first_task',
                name: 'Getting Started',
                description: 'Complete your first task',
                icon: '🎯',
                unlockedAt: completedTasks[0]?.data?.task?.completedAt
            });
        }

        // 10 Tasks Achievement
        if (completedTasks.length >= 10) {
            achievements.push({
                id: 'ten_tasks',
                name: 'Task Master',
                description: 'Complete 10 tasks',
                icon: '🔥',
                unlockedAt: completedTasks[9]?.data?.task?.completedAt
            });
        }

        // Streak Achievements
        const streaks = calculateStreaks(completedTasks);
        if (streaks.longest >= 7) {
            achievements.push({
                id: 'week_streak',
                name: 'Week Warrior',
                description: 'Complete tasks for 7 days in a row',
                icon: '📅',
                unlockedAt: new Date().toISOString()
            });
        }

        return achievements;

    } catch (error) {
        console.error('Error getting achievements:', error);
        return [];
    }
}

/**
 * Show user's current progress
 * @param {string} userPubKey - User's public key
 * @returns {Object} Progress summary
 */
async function showProgress(userPubKey) {
    try {
        const stats = await getProductivityStats(userPubKey);
        const availableRewards = await checkAvailableRewards(userPubKey);

        return {
            points: stats.currentPoints,
            weeklyCompletion: `${stats.weeklyStats.completedTasks}/${stats.weeklyStats.totalTasks} tasks`,
            completionRate: `${stats.weeklyStats.completionRate}%`,
            currentStreak: stats.streaks.current,
            availableRewards: availableRewards.length,
            nextReward: availableRewards.length > 0 ? availableRewards[0] : null
        };

    } catch (error) {
        console.error('Error showing progress:', error);
        return {
            points: 0,
            weeklyCompletion: '0/0 tasks',
            completionRate: '0%',
            currentStreak: 0,
            availableRewards: 0,
            nextReward: null
        };
    }
}

module.exports = {
    awardPoints,
    deductPoints,
    getUserPoints,
    checkAvailableRewards,
    unlockReward,
    getPointsHistory,
    getProductivityStats,
    showProgress,
    calculateStreaks,
    getAchievements
};
