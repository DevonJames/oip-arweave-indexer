/**
 * ALFRED Productivity Module - Default User Settings
 */

const defaultSettings = {
  // Time Zone & Regional Settings
  timezone: process.env.DEFAULT_TIMEZONE || 'America/New_York',
  weekStartDay: 'monday', // 'sunday' or 'monday'

  // Task Defaults
  defaultTaskPoints: parseInt(process.env.DEFAULT_TASK_POINTS || '1'),
  defaultTaskDuration: 30, // minutes
  defaultTaskPriority: 'medium', // 'low', 'medium', 'high'

  // Time Budget (168-hour weekly accounting)
  timeBudget: {
    sleep: {
      hoursPerNight: 8,
      daysPerWeek: 7
    },
    work: {
      hoursPerDay: 8,
      daysPerWeek: 5
    },
    exercise: {
      minutesPerSession: 45,
      sessionsPerWeek: 3
    },
    meals: {
      minutesPerDay: 60, // 30 minutes for lunch, 30 for breaks
      daysPerWeek: 5 // work days
    },
    personal: {
      hoursPerWeek: 10 // flexible time for personal tasks
    }
  },

  // Feature Flags
  voiceEnabled: process.env.ENABLE_VOICE_COMMANDS !== 'false',
  calendarSyncEnabled: process.env.ENABLE_CALENDAR_SYNC === 'true',
  notificationsEnabled: true,
  pointSystemEnabled: process.env.ENABLE_POINT_SYSTEM !== 'false',

  // UI Preferences
  theme: 'dark', // 'dark' or 'light'
  dashboardLayout: 'compact', // 'compact' or 'detailed'

  // Notification Settings
  notifications: {
    taskReminders: true,
    routineReminders: true,
    rewardUnlocks: true,
    weeklySummary: true,
    reminderAdvanceTime: 10 // minutes before scheduled time
  },

  // Privacy Settings
  dataRetention: {
    taskHistory: 365, // days
    analytics: 90, // days
    exportEnabled: true
  },

  // Advanced Settings
  scheduling: {
    autoScheduleEnabled: true,
    conflictResolution: 'reschedule', // 'reschedule', 'skip', 'overwrite'
    bufferTime: 5, // minutes between tasks
    maxDailyTasks: 10
  },

  // Integration Settings
  integrations: {
    googleCalendar: {
      enabled: false,
      calendarId: null
    },
    icloudCalendar: {
      enabled: false,
      calendarId: null
    },
    fitnessTrackers: {
      enabled: false,
      providers: [] // ['apple-health', 'google-fit', 'fitbit']
    }
  }
};

module.exports = defaultSettings;
