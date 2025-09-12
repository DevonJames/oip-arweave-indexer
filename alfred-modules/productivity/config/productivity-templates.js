/**
 * ALFRED Productivity Module - Template Definitions
 * These templates define the data structures for productivity records
 */

const productivityTemplates = {
  // Task Record Type - Core productivity unit
  task: {
    task: {
      title: "string",
      index_title: 0,
      description: "string",
      index_description: 1,
      taskType: "enum",
      taskTypeValues: [
        { code: "fixed", name: "Fixed Task" },
        { code: "flexible", name: "Flexible Task" }
      ],
      index_taskType: 2,
      category: "string",
      index_category: 3,
      duration: "long", // minutes
      index_duration: 4,
      priority: "enum",
      priorityValues: [
        { code: "low", name: "Low" },
        { code: "medium", name: "Medium" },
        { code: "high", name: "High" }
      ],
      index_priority: 5,
      frequency: "string", // "once", "daily", "3x/week", etc.
      index_frequency: 6,
      points: "long",
      index_points: 7,
      status: "enum",
      statusValues: [
        { code: "pending", name: "Pending" },
        { code: "in_progress", name: "In Progress" },
        { code: "completed", name: "Completed" },
        { code: "cancelled", name: "Cancelled" }
      ],
      index_status: 8,
      scheduledTime: "long", // Unix timestamp
      index_scheduledTime: 9,
      completedAt: "long", // Unix timestamp
      index_completedAt: 10,
      parentSession: "dref", // Reference to calendarSession
      index_parentSession: 11
    }
  },

  // Calendar Session Record Type - Weekly planning container
  calendarSession: {
    calendarSession: {
      weekStart: "long", // Unix timestamp of week start
      index_weekStart: 0,
      weekEnd: "long", // Unix timestamp of week end
      index_weekEnd: 1,
      totalPoints: "long",
      index_totalPoints: 2,
      earnedPoints: "long",
      index_earnedPoints: 3,
      sleepHours: "float", // Hours per night
      index_sleepHours: 4,
      workHours: "float", // Hours per day
      index_workHours: 5,
      workDays: "long", // Days per week
      index_workDays: 6,
      exerciseMinutes: "long", // Minutes per session
      index_exerciseMinutes: 7,
      exerciseSessions: "long", // Sessions per week
      index_exerciseSessions: 8,
      mealMinutes: "long", // Minutes per day
      index_mealMinutes: 9,
      morningRoutine: "dref", // Reference to routine
      index_morningRoutine: 10,
      eveningRoutine: "dref", // Reference to routine
      index_eveningRoutine: 11,
      tasks: "repeated dref", // References to task records
      index_tasks: 12,
      calendarSynced: "bool",
      index_calendarSynced: 13,
      googleCalendarId: "string",
      index_googleCalendarId: 14,
      icloudCalendarId: "string",
      index_icloudCalendarId: 15
    }
  },

  // Routine Record Type - Morning/evening routines
  routine: {
    routine: {
      name: "string",
      index_name: 0,
      type: "enum",
      typeValues: [
        { code: "morning", name: "Morning Routine" },
        { code: "evening", name: "Evening Routine" }
      ],
      index_type: 1,
      totalDuration: "long", // Total minutes
      index_totalDuration: 2,
      steps: "repeated string", // Array of step descriptions
      index_steps: 3,
      stepDurations: "repeated long", // Array of step durations in minutes
      index_stepDurations: 4,
      enabled: "bool",
      index_enabled: 5
    }
  },

  // Reward Plan Record Type - Gamification system
  rewardPlan: {
    rewardPlan: {
      name: "string",
      index_name: 0,
      description: "string",
      index_description: 1,
      threshold: "long", // Points needed
      index_threshold: 2,
      rewardType: "enum",
      rewardTypeValues: [
        { code: "experience", name: "Experience" },
        { code: "item", name: "Item" },
        { code: "activity", name: "Activity" }
      ],
      index_rewardType: 3,
      isActive: "bool",
      index_isActive: 4,
      unlockedAt: "long", // Unix timestamp when unlocked
      index_unlockedAt: 5,
      parentSession: "dref", // Reference to calendarSession
      index_parentSession: 6
    }
  },

  // Productivity Settings Record Type - User preferences
  productivitySettings: {
    productivitySettings: {
      timezone: "string",
      index_timezone: 0,
      weekStartDay: "enum",
      weekStartDayValues: [
        { code: "sunday", name: "Sunday" },
        { code: "monday", name: "Monday" }
      ],
      index_weekStartDay: 1,
      defaultTaskPoints: "long",
      index_defaultTaskPoints: 2,
      voiceEnabled: "bool",
      index_voiceEnabled: 3,
      calendarSyncEnabled: "bool",
      index_calendarSyncEnabled: 4,
      notificationsEnabled: "bool",
      index_notificationsEnabled: 5,
      theme: "enum",
      themeValues: [
        { code: "dark", name: "Dark Theme" },
        { code: "light", name: "Light Theme" }
      ],
      index_theme: 6
    }
  }
};

module.exports = productivityTemplates;
