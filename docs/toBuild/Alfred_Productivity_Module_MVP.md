
# Productivity Assistant MVP – OIP Alfred Module

## 🧾 Summary
A natural-language-first productivity assistant that:
- Starts with a weekly planning session
- Translates user priorities into a dynamic calendar
- Tracks task completion and progress
- Uses LLM guidance to reduce friction and boost clarity
- Fits seamlessly into Alfred's voice-first workflow, built on OIP’s existing distributed backend (Node.js, Express, Elasticsearch, Arweave, GUN)

---

## ✅ Primary MVP Features

### 1. Onboarding Coach (LLM-driven)
- Conversational agent guides user through setup:
  - Sleep, meals, school/work blocks, routines
  - Weekly goals (e.g., workout 3x, write 5k words)
  - “Flexible focus zones” vs. “Fixed tasks”
- UI: Voice or chat via Alfred (mac-client)
- Tech: `text-generator` → Ollama LLM

### 2. Smart Weekly Setup Interface
- User configures:
  - Wake/sleep time, meal times, morning/evening routine lengths
  - Fixed blocks: work/school, appointments
  - Weekly task frequency
  - Points & rewards
- NLP parsing support

### 3. Task System
Two types of tasks:
- **Fixed Tasks**: Duration + preferred time slot (e.g., 45 min haircut)
- **Flexible Tasks**: Goal-based, distributed across focus blocks

### 4. Dynamic Calendar Rendering
- Renders proposed calendar from fixed events + task distribution
- Morning/evening routines show as labels with optional expansion
- Editable preview mode

### 5. Calendar Sync
- Google Calendar (OAuth)
- iCloud Calendar (CalDAV or proxy)
- Write blocks, include metadata in notes

### 6. Check-In & Completion Flow
- After each task block, prompt for completion status
- Voice or UI feedback: Yes / No / Partially
- Logs task progress + point updates

### 7. Points & Rewards System
- Define points per task
- Define reward threshold
- Visual dashboard of progress

---

## 📦 Core MVP Modules

| Module | Description |
|--------|-------------|
| onboarding-assistant.js | LLM-driven setup via `text-generator` |
| task-parser.js | Natural language task parser |
| scheduler-engine.js | Allocates tasks across time blocks |
| calendar-sync.js | Google/iCloud integration |
| point-system.js | Point tracking logic |
| checkin-handler.js | Prompts & records task completion |
| alfred-integration.js | Voice/HTML integration in mac-client |
| record-types | `task`, `calendarSession`, `rewardPlan` via OIP |

---

## 🧩 Tech Stack

| Layer | Stack |
|-------|-------|
| AI | Ollama (`text-generator`) |
| NLP | Whisper + parser |
| Calendar | Google API, iCloud CalDAV |
| Backend | Node.js + Express |
| Storage | GUN (volatile), Arweave (permanent) |
| Search | Elasticsearch.js + getRecords() |
| Voice | mac-client (alfred.html, voice.js) |
| UI | HTML/React for MVP |

---

## 🧪 MVP Completion Criteria

- ✅ Login + Onboarding (LLM-assisted)
- ✅ Weekly goals input via NLP or form
- ✅ Task creation (fixed/flexible)
- ✅ Time allocation & calendar render
- ✅ Points & rewards tracker
- ✅ Calendar sync to Google/iCloud
- ✅ Check-in flow after tasks

---

## 🏁 16-Session Development Plan

### Week 1

#### 🕘 Day 1 AM – Project Bootstrap
- Setup Node.js backend module (under `alfred-modules/productivity`)
- Define record types: `task`, `category`, `rewardPlan`, `routine`, `calendarSession`

#### 🕐 Day 1 PM – Onboarding UI + LLM Prompting
- Set up `onboarding-assistant.js` using `text-generator` API
- Start onboarding flow: sleep, meals, work time

#### 🕘 Day 2 AM – Time Allocation Model
- Build logic for 168-hour accounting
- Store weekly time budget as `calendarSession`

#### 🕐 Day 2 PM – Routine Manager
- Create morning/evening routine builder UI + logic
- Define total duration + substeps

#### 🕘 Day 3 AM – Task Input Interface
- Structured + NLP task creation
- Start `task-parser.js`

#### 🕐 Day 3 PM – Flexible Task Categories
- Implement category system with time limits
- Begin task assignment rules

#### 🕘 Day 4 AM – Scheduler Engine
- Distribute flexible tasks into available time blocks
- Create placeholder calendar session output

#### 🕐 Day 4 PM – Calendar UI Preview
- Show proposed calendar (HTML prototype)
- Color coding, routines, flexible/fixed

### Week 2

#### 🕘 Day 5 AM – Google/iCloud Calendar Sync
- Set up Google OAuth + event sync
- Basic iCloud CalDAV or local sync stub

#### 🕐 Day 5 PM – Event Metadata & Backlink
- Write Alfred-linked record URLs in calendar note field
- Parse completion from calendar

#### 🕘 Day 6 AM – Check-In Prompt System
- Push UI or notification post-task
- Record "completed" vs "skipped"

#### 🕐 Day 6 PM – Points & Reward System
- Add reward plan editor
- Track total points earned in `calendarSession`

#### 🕘 Day 7 AM – Analytics & Feedback View
- Weekly summary: points, tasks, time spent per category

#### 🕐 Day 7 PM – Voice UI Enhancements
- Voice control of check-in and planning via `voice.js`
- Integrate with whisper → `text-generator` loop

#### 🕘 Day 8 AM – Persistence + Publishing
- Store records using `templateHelper.js` and `publisher-manager.js`
- Save to GUN or Arweave as needed

#### 🕐 Day 8 PM – Final QA + Test Cases
- Test onboarding, scheduling, check-ins, syncing
- Package module under `mac-client/alfred`

---

## 🏷️ Name Ideas
- Orbit, Axle, Motive, Cadence, Franklin, Rig, Echo, Pulse
