/**
 * ALFRED Productivity Module - Calendar Integration Configuration
 */

const calendarConfig = {
  // Google Calendar Configuration
  google: {
    clientId: process.env.GOOGLE_CALENDAR_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_CALENDAR_REDIRECT_URI || 'http://localhost:3005/api/productivity/auth/google/callback',
    scopes: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events'
    ],
    calendarName: 'ALFRED Productivity',
    eventDefaults: {
      reminders: [
        { method: 'popup', minutes: 10 },
        { method: 'email', minutes: 30 }
      ],
      colorId: '7' // Light blue color
    }
  },

  // iCloud CalDAV Configuration
  icloud: {
    server: process.env.ICLOUD_CALENDAR_SERVER || 'https://caldav.icloud.com',
    username: process.env.ICLOUD_CALENDAR_USERNAME,
    password: process.env.ICLOUD_CALENDAR_PASSWORD,
    calendarName: 'ALFRED Productivity',
    principalPath: '/principals/users/',
    calendarHomeSet: '/calendars/'
  },

  // General Calendar Settings
  sync: {
    enabled: process.env.ENABLE_CALENDAR_SYNC === 'true',
    interval: parseInt(process.env.CALENDAR_SYNC_INTERVAL || '300000'), // 5 minutes
    maxRetries: 3,
    retryDelay: 10000, // 10 seconds
    conflictResolution: 'overwrite', // 'overwrite' or 'skip'
    batchSize: 50 // Maximum events to sync at once
  },

  // Event Template
  eventTemplate: {
    summary: '{{task.title}}',
    description: 'ALFRED Productivity Task\n\n{{task.description}}\n\nPoints: {{task.points}}\nCategory: {{task.category}}\nPriority: {{task.priority}}\n\nTask ID: {{task.did}}\nCreated by ALFRED',
    location: '',
    transparency: 'transparent', // Show as free time
    visibility: 'private'
  },

  // Routine Event Template
  routineEventTemplate: {
    summary: '{{routine.name}}',
    description: 'ALFRED Routine\n\n{{routine.steps}}\n\nDuration: {{routine.totalDuration}} minutes\n\nRoutine ID: {{routine.did}}\nCreated by ALFRED',
    colorId: '11', // Light green for routines
    transparency: 'transparent'
  }
};

module.exports = calendarConfig;
