# ALFRED Productivity Module

A comprehensive productivity assistant that integrates seamlessly with the OIP system, providing natural language task management, intelligent scheduling, and gamified productivity tracking.

## Features

- **Natural Language Task Creation**: Parse tasks from voice or text input
- **Intelligent Scheduling**: Automatic time allocation and calendar integration
- **Voice-Native Interface**: Full integration with ALFRED's voice pipeline
- **Gamification**: Points system with rewards and achievements
- **Routine Management**: Morning/evening routines with duration tracking
- **Multi-Storage Support**: GUN for private data, Arweave for permanent records
- **Calendar Sync**: Google Calendar and iCloud integration
- **Analytics Dashboard**: Weekly productivity insights and progress tracking

## Architecture

### Core Components

1. **Task Parser** - NLP-powered task creation and parsing
2. **Scheduler Engine** - Time allocation and conflict resolution
3. **Point System** - Gamification and reward management
4. **Routine Manager** - Morning/evening routine handling
5. **Calendar Sync** - External calendar integration
6. **Voice Integration** - ALFRED voice command extensions

### Data Flow

```
Voice/Text Input → Task Parser → Scheduler Engine → GUN Storage → Elasticsearch Index → Calendar Sync
```

## Record Types

### Task Record Type
```javascript
{
  "task": {
    "title": "string",
    "description": "string",
    "taskType": "enum", // "fixed" or "flexible"
    "category": "string",
    "duration": "long", // minutes
    "priority": "enum", // "low", "medium", "high"
    "frequency": "string", // "once", "daily", "3x/week"
    "points": "long",
    "status": "enum", // "pending", "in_progress", "completed", "cancelled"
    "scheduledTime": "long", // Unix timestamp
    "completedAt": "long", // Unix timestamp
    "parentSession": "dref" // Reference to calendarSession
  }
}
```

### Calendar Session Record Type
```javascript
{
  "calendarSession": {
    "weekStart": "long", // Unix timestamp
    "totalPoints": "long",
    "earnedPoints": "long",
    "sleepHours": "float",
    "workHours": "float",
    "workDays": "long",
    "exerciseMinutes": "long",
    "exerciseSessions": "long",
    "mealMinutes": "long",
    "morningRoutine": "dref",
    "eveningRoutine": "dref",
    "tasks": "repeated dref",
    "calendarSynced": "bool",
    "googleCalendarId": "string",
    "icloudCalendarId": "string"
  }
}
```

## Installation

### Environment Variables

Add to your `.env` file:

```bash
# Productivity Module Configuration
PRODUCTIVITY_MODULE_ENABLED=true
PRODUCTIVITY_SERVICE_URL=http://localhost:3006

# Google Calendar Integration
GOOGLE_CALENDAR_CLIENT_ID=your_google_client_id
GOOGLE_CALENDAR_CLIENT_SECRET=your_google_client_secret

# iCloud Calendar Integration
ICLOUD_CALENDAR_USERNAME=your_icloud_username
ICLOUD_CALENDAR_PASSWORD=your_icloud_app_password

# Productivity Features
DEFAULT_TASK_POINTS=1
DEFAULT_TIMEZONE=America/New_York
ENABLE_CALENDAR_SYNC=true
ENABLE_VOICE_COMMANDS=true
ENABLE_POINT_SYSTEM=true
```

### Build Integration

The productivity module can be enabled/disabled at build time:

```bash
# Enable productivity module
make build PRODUCTIVITY_MODULE_ENABLED=true

# Disable productivity module
make build PRODUCTIVITY_MODULE_ENABLED=false
```

## API Endpoints

### Core Productivity Routes

- `GET /api/productivity/dashboard` - Get user's productivity dashboard
- `POST /api/productivity/tasks` - Create new task via voice/text
- `GET /api/productivity/tasks` - Get user's tasks
- `PUT /api/productivity/tasks/:taskId` - Update task
- `DELETE /api/productivity/tasks/:taskId` - Delete task
- `POST /api/productivity/tasks/:taskId/complete` - Mark task as completed

### Calendar & Scheduling

- `GET /api/productivity/calendar` - Get weekly calendar view
- `POST /api/productivity/calendar/sync` - Sync with external calendars
- `GET /api/productivity/sessions` - Get calendar sessions

### Routines & Rewards

- `GET /api/productivity/routines` - Get user's routines
- `POST /api/productivity/routines` - Create/update routine
- `GET /api/productivity/rewards` - Get available rewards
- `POST /api/productivity/rewards/:rewardId/unlock` - Unlock reward

## Voice Commands

The module extends ALFRED with productivity-specific voice commands:

### Task Management
- "create task [description]" - Create a new task
- "add task [description]" - Add a task to the system
- "complete task [task name]" - Mark a task as completed
- "show my tasks" - List current tasks

### Scheduling
- "schedule [task] for [time]" - Schedule a task
- "show calendar" - Display weekly calendar
- "plan week" - Generate weekly schedule

### Progress & Rewards
- "check points" - Show current point balance
- "show progress" - Display productivity analytics
- "unlock reward" - Check available rewards

### Routines
- "start morning routine" - Begin morning routine
- "start evening routine" - Begin evening routine
- "skip routine" - Skip current routine

## Development

### Running Tests
```bash
npm test
```

### Development Server
```bash
npm run dev
```

### Linting
```bash
npm run lint
```

## Integration Points

### ALFRED RAG Integration
The productivity module integrates with ALFRED's RAG system by:
- Adding productivity record types to RAG context
- Providing natural language productivity queries
- Enabling intelligent task suggestions based on user history

### Multi-Storage Architecture
- **GUN**: Private productivity data (tasks, personal goals, routines)
- **Arweave**: Permanent productivity records and templates
- **Elasticsearch**: Search and analytics for productivity data

### Calendar Integration
- **Google Calendar**: OAuth-based event synchronization
- **iCloud CalDAV**: Native Apple calendar integration
- **Event Metadata**: OIP record references in calendar event descriptions

## Security & Privacy

### Data Classification
- **Private (GUN)**: Personal tasks, goals, completion history, settings, routines
- **Semi-Private (Elasticsearch)**: Anonymized analytics, search indices, performance metrics
- **Public (Arweave)**: Template definitions, public productivity insights (opt-in only)

### Authentication
- JWT token authentication for all endpoints
- GUN records encrypted with user's public key
- Calendar sync requires separate OAuth tokens

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## License

MIT License - see LICENSE file for details
