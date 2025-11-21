## 1. Product overview

**Working name:** Alfred Meeting Notes (placeholder)
**Platforms:**

* Phase 1: iOS (iPhone-first, iPad-compatible)
* Phase 2: macOS companion app
* Phase 3: Apple Watch satellite app

**Core idea:**
One app that lets you:

1. Capture voice (meetings, ideas, daily notes) with near-zero friction.
2. Turn that into structured summaries and searchable knowledge.
3. Ask Alfred or Alice anything about your notes and other private records via RAG.
4. Optionally run everything fully locally on your own AI workstation (upsell path).

Alfred and Alice:

* Same capabilities.
* Same tools and access.
* Main difference: voice, “vibe,” and minor tonality; user chooses whichever they prefer.

---

## 2. Primary users & jobs

### Target users

* Knowledge workers & founders (your own profile + adjacent).
* Consultants / freelancers with many client meetings.
* Managers with recurring 1:1s, standups, project meetings.
* Power users already using note apps / PKM who want AI on top.

### Core jobs-to-be-done

1. “Record this meeting and give me a clean summary plus action items.”
2. “Later, let me ask questions across all those meetings and notes.”
3. “Let me talk to a high-trust AI (Alfred/Alice) about anything, using my private notes when helpful.”
4. “If I’m privacy- or latency-obsessed, let me run all of this locally on my own hardware.”

---

## 3. Release plan

### Phase 1: iOS v1 (MVP but competitive)

* Voice capture, transcription, summary.
* Basic organization, search, export.
* Alfred/Alice chat with clear local vs cloud control.
* RAG over captured notes + basic imported docs.
* Calendar integration for meeting context.
* Honest and simple pricing.

### Phase 2: iOS v1.1+

* Spaces/Projects.
* Bulk actions, more advanced export.
* Better RAG scoping UI, per-space chat.
* Deeper workstation pairing UX.

### Phase 3: macOS companion

* Same core feature set as iOS.
* Optimized for long-form work and keyboard-driven workflows.
* Can run heavier local models more comfortably.

### Phase 4: Apple Watch app

* Quick capture (audio snippets) and view upcoming meetings with last summary.
* Simple commands to Alfred/Alice for short queries.

---

## 4. Core user flows (iOS)

### Flow A: Capture → Summarize → Organize

1. User opens app, taps big “Record” button (or uses widget / shortcut).
2. Optionally chooses a template:

   * Meeting, 1:1, Daily note, Idea, Interview, Lecture.
3. App records audio, optionally shows live transcription.
4. User taps Stop.
5. Transcription runs:

   * Short notes: on-device by default.
   * Longer notes: configurable (local vs cloud).
6. Alfred/Alice generates a structured summary:

   * Summary bullets
   * Decisions
   * Action items
   * Open questions
7. User can:

   * Edit title.
   * Tag and assign to a folder (or later, Space).
   * Save.

### Flow B: “Ask about my stuff”

1. User opens Alfred or Alice chat.
2. App prompts: “What context should I use?” with quick options:

   * No notes (general chat).
   * Today’s meetings.
   * Last 7 days.
   * A particular Space/Project (Phase 2+).
3. User types or speaks a question:

   * “What did we decide with ACME about pricing?”
4. System:

   * Runs semantic search over Elasticsearch index.
   * Pulls top N relevant notes/segments.
   * Calls chosen model (local or cloud).
5. Answer includes:

   * Direct answer.
   * Citations to specific notes with timestamps.
   * Tap-through links to open those notes.

### Flow C: General AI assistant (no RAG)

1. User opens Alfred or Alice.
2. Chooses model mode:

   * Local only
   * Cloud only
   * Smart (autopick based on length, complexity, and user preference).
3. Chat just behaves like a high-trust, multi-model AI client:

   * Code help, writing, brainstorming, etc.
   * With consistent visual indication of the model and locality.

---

## 5. Feature breakdown (iOS v1)

### 5.1 Voice capture

* Large central Record button on home screen.
* Recording templates:

  * Meeting
  * 1:1
  * Standup
  * Idea / Brain dump
  * Daily reflection
* Options before recording:

  * Template selection.
  * Associate with calendar event (if within ±15 min of a scheduled event).
* During recording:

  * Visible timer and waveform.
  * “Mark moment” button to drop markers.
* Background-friendly:

  * Persistent background indicator.
  * Safe if user locks screen or switches apps.

### 5.2 Transcription

* Transcription pipeline:

  * Use Maya1 (local ASR) by default for short recordings.
  * Option to force local only or allow cloud ASR (ElevenLabs or Whisper, etc.) in Settings.
* Editable transcript view after processing:

  * User can correct text.
  * Mark important paragraphs manually.

### 5.3 Summarization

* Summary view includes:

  * Title (user-editable).
  * Date / time / duration.
  * Linked calendar event (if applicable).
  * Section blocks:

    * Key summary
    * Decisions
    * Action items
    * Open questions
* Single “Regenerate summary” button in case of edits or wrong tone.

### 5.4 Organization & search

* Library screen:

  * List of notes, with:

    * Title
    * Date
    * Template icon
    * Tag chips
* Folders:

  * Simple folder hierarchy at v1.
* Tags:

  * Free-form multi-tags per note.
* Search:

  * Global search bar:

    * Full-text over transcripts + summaries.
    * Filters for:

      * Date range
      * Template
      * Folder
      * Tag
  * Search result detail shows matched text with highlight.

### 5.5 Export & sharing

* Note-level export:

  * Share sheet: Markdown, plain text, or PDF.
  * Include audio file toggle.
* Basic bulk export:

  * v1: multi-select notes to export as:

    * Zip of Markdown files + audio.
* Later (v1.1+):

  * “Export all notes in folder/space” with JSON schema.

### 5.6 Alfred & Alice chat

* Single “Chat” tab.
* Top toggle:

  * [Alfred] [Alice] (segmented control).
* Chat UI:

  * Persistent model badge: e.g., “Local Qwen (on-device)” or “Cloud GPT-4.1”.
  * Local/cloud icon clearly visible.
* Quick context chips above input:

  * [No context]
  * [Today’s notes]
  * [Last 7 days]
  * [Linked meeting] (when opened from a note).
* Model selection:

  * Settings → Models:

    * Local: 3 slots (e.g., Qwen, LLaMA, Mistral; actual may be remote but presented as “local” from user’s perspective if going via your workstation).
    * Cloud: 2 slots (e.g., OpenAI, Anthropic).
  * User can set:

    * Default model for short replies.
    * Default model for long/research replies.
* Voice reply / TTS:

  * Alfred uses ElevenLabs/Maya1 with male voice.
  * Alice uses ElevenLabs/Maya1 with female voice.
  * Toggle “Always speak replies” or “Tap to play.”

### 5.7 RAG integration

* Elasticsearch-backed index for:

  * Transcripts
  * Summaries
  * Markers (highlighted segments)
  * Basic metadata (tags, folder, associated calendar event).
* Retrieval:

  * For any RAG-enabled chat, system:

    * Uses the user’s query to search ES.
    * Feeds top K spans into the prompt as context, with IDs to allow citations.
* Citations:

  * Answers show inline references, e.g., “[Note: ACME Q1 Review]”.
  * Tap to open note at the relevant timestamp/paragraph.

### 5.8 Privacy & trust UI

* “Trust status” bar (or icon) on main screens:

  * Green “Local only” when no cloud usage is enabled.
  * Blue “Local + Cloud” when cloud calls are possible.
* Data & model settings page:

  * Toggles:

    * “Allow cloud LLMs”
    * “Allow cloud transcription”
    * “Send anonymized metrics” (default off or clearly opt-in).
  * Explanation of each setting in 1–2 lines.
* “Delete all my data” button:

  * Clears local store and triggers server-side deletion.

### 5.9 Pricing & account

* Account system:

  * Email/Apple Sign-in for sync across devices.
  * Distinct from any workstation login but can be linked later.
* Plan concepts:

  * Free:

    * Limited minutes/month (e.g., 60–90).
    * Limited history (e.g., last 30 days searchable).
    * Local transcription only (if feasible).
  * Pro:

    * Higher minutes/month or effectively unlimited within fair use.
    * Full RAG over entire history.
    * Cloud LLM access (within sane limits).
  * Local Pro (for workstation users; future):

    * Unlock “local only, unlimited” mode when paired to Alfred Box.

No weekly subscriptions. Monthly + annual only, with plain-language paywall.

---

## 6. macOS companion app (Phase 2+)

### Goals

* Provide a “work desk” interface for heavy users:

  * Longer meetings, more complex RAG queries.
  * Easier editing and reformatting of summaries and exported docs.
* Use same backend and sync layer as iOS.

### Key differences from iOS

* Multi-pane layout:

  * Left: folders/spaces.
  * Middle: list of notes.
  * Right: transcript/summary panel with inline chat (ask Alfred/Alice about this note).
* Richer keyboard support:

  * Global shortcuts to start recording (when mac has mic).
  * Hotkeys for quick search.
* Local models:

  * macOS app can optionally host local LLM on the machine (for users without a separate workstation), using a subset of your Alfred stack.

---

## 7. Apple Watch app (Phase 3+)

### Primary goals

* “Capture now, organize later.”
* Quick meeting context on wrist.

### Features

* Complication:

  * Tap to start quick audio note tied to current time + location.
* Simple capture:

  * One-tap record, one-tap stop.
  * Syncs audio to phone for transcription and summarization.
* Upcoming meeting view:

  * See next event.
  * Scroll to see last summary and action items.

No full chat on watch v1; maybe a tiny “Ask Alfred one short question” later if it feels natural.

---

## 8. Data model (rough)

Core entities:

* User

  * id, email, subscriptionStatus, settings.

* Note

  * id, userId, title, createdAt, updatedAt
  * templateType (enum)
  * folderId
  * tags [string]
  * calendarEventId (optional)
  * audioFileRefs (device local path + server path)
  * summary (structured JSON: summary, decisions, actionItems, openQuestions)
  * metadata (language, duration, etc.)

* TranscriptChunk

  * id, noteId, startTime, endTime, text, markers [bool or tags]

* Folder

  * id, userId, parentFolderId, name

* Space (Phase 2+)

  * id, userId, name, description, memberNoteIds

* Task (Phase 2+)

  * id, userId, title, description, dueDate, originNoteId, status, tags

* ModelConfig

  * userId, preferredLocalModel, preferredCloudModel, mode (local/cloud/smart)

* DeviceConfig

  * machineId, hasLocalModelHost, workstationPairingInfo

All indexed into Elasticsearch with fields needed for RAG.

---

## 9. Architecture (high-level)

* **Client (iOS/macOS/watchOS)**

  * Native Swift/SwiftUI frontends.
  * Local storage: Core Data / SQLite or Realm for offline notes.
  * Background upload of audio + transcripts to backend.

* **Backend services**

  * API for:

    * Authentication and sync.
    * Audio upload.
    * Transcription (if cloud).
    * Summarization and RAG query orchestration.
  * Elasticsearch cluster for user-specific indexes.
  * Orchestration layer that talks to:

    * Local Alfred Box (if paired).
    * Cloud LLMs (OpenAI, Anthropic, etc.).

* **Alfred workstation integration**

  * App detects workstation on local network (or via secure tunnel).
  * Treats it as a preferred “Local model host.”
  * UI shows “Powered by your Alfred Box” when applicable.

---

## 10. v1 scope cut

For a genuinely shippable v1 that still clearly outclasses current competitors:

* Include:

  * Capture → transcript → summary.
  * Folders, tags, search.
  * Single-note export and basic multi-select export.
  * Alfred/Alice chat with local vs cloud choice and simple RAG.
  * Calendar linking for meetings.
  * Simple, honest pricing and privacy toggles.

* Defer:

  * Spaces/Projects, Tasks, deep integrations (Reminders, etc.).
  * Workstation pairing UI (just support manually configured endpoint at first).
  * macOS and watchOS apps.