## Calendar records using GUN (private) — template proposal and implementation plan

### Goal
Add private, encrypted calendar records to OIP using the mac-client to read local calendar data and publish to the backend via `/api/records/newRecord` with `storage=gun`. Records should be queryable through existing `/api/records` search features while remaining private in storage.

### Proposed OIP template: `calendarEvent`
This template prioritizes:
- Strong alignment with common calendar fields (Apple Calendar, Google Calendar, ICS/RFC 5545)
- Efficient querying via existing API (date filtering, text search, tags)
- Minimal PII exposure in indices; private storage handled by GUN encryption

Template fields (flat format expected by current system):

```json
{
  "calendarEvent": {
    "title": "string",
    "index_title": 0,

    "description": "string",
    "index_description": 1,

    "startTime": "long",        
    "index_startTime": 2,

    "endTime": "long",
    "index_endTime": 3,

    "timezone": "string",
    "index_timezone": 4,

    "allDay": "bool",
    "index_allDay": 5,

    "location": "string",
    "index_location": 6,

    "organizerName": "string",
    "index_organizerName": 7,

    "organizerEmail": "string",
    "index_organizerEmail": 8,

    "attendee": "repeated string",      
    "index_attendee": 9,

    "recurrenceRule": "string",         
    "index_recurrenceRule": 10,

    "recurrenceId": "string",           
    "index_recurrenceId": 11,

    "exceptionDate": "repeated long",   
    "index_exceptionDate": 12,

    "status": "enum",                   
    "statusValues": [
      { "code": "confirmed", "name": "Confirmed" },
      { "code": "tentative", "name": "Tentative" },
      { "code": "cancelled", "name": "Cancelled" }
    ],
    "index_status": 13,

    "transparency": "enum",             
    "transparencyValues": [
      { "code": "opaque", "name": "Opaque" },
      { "code": "transparent", "name": "Transparent" }
    ],
    "index_transparency": 14,

    "remindersMinutesBeforeStart": "repeated uint64",
    "index_remindersMinutesBeforeStart": 15,

    "sourceSystem": "enum",             
    "sourceSystemValues": [
      { "code": "apple", "name": "Apple Calendar" },
      { "code": "google", "name": "Google Calendar" },
      { "code": "outlook", "name": "Outlook" },
      { "code": "ics", "name": "ICS" }
    ],
    "index_sourceSystem": 16,

    "sourceCalendarName": "string",
    "index_sourceCalendarName": 17,

    "externalUid": "string",           
    "index_externalUid": 18,

    "lastModified": "long",            
    "index_lastModified": 19,

    "tagItems": "repeated string",     
    "index_tagItems": 20
  }
}
```

Notes:
- For API date filtering compatibility, we will also set `basic.date = startTime` in the record when publishing. This ensures `/api/records?dateStart=&dateEnd=` works out of the box.
- `attendee` is an array of strings (e.g., "Name <email>"). In a later phase, these could become `repeated dref` to contact records.
- `recurrenceRule` follows RFC 5545 RRule (e.g., `RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR`). `exceptionDate` uses epoch ms.

Example record (expanded JSON used as input to publish):

```json
{
  "basic": {
    "name": "Team Standup",
    "description": "Daily sync",
    "date": 1736355600000,
    "language": "en",
    "tagItems": ["work", "standup"]
  },
  "calendarEvent": {
    "title": "Team Standup",
    "description": "Daily sync",
    "startTime": 1736355600000,
    "endTime": 1736357400000,
    "timezone": "America/Los_Angeles",
    "allDay": false,
    "location": "Zoom",
    "organizerName": "Alice",
    "organizerEmail": "alice@example.com",
    "attendee": ["Alice <alice@example.com>", "Bob <bob@example.com>"],
    "recurrenceRule": "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    "recurrenceId": "A7F1C0D3-UID-EXAMPLE",
    "exceptionDate": [],
    "status": "confirmed",
    "transparency": "opaque",
    "remindersMinutesBeforeStart": [10],
    "sourceSystem": "apple",
    "sourceCalendarName": "Work",
    "externalUid": "A7F1C0D3-UID-EXAMPLE",
    "lastModified": 1736270000000,
    "tagItems": ["work", "standup"]
  },
  "accessControl": { "private": true, "readers": [] }
}
```

Publishing will use `recordType=calendarEvent` and `storage=gun` with a deterministic `localId` to ensure idempotency.

Deterministic identity for deduplication:
- `localId` format: `<sourceSystem>:<sourceCalendarName>:<externalUid>` (e.g., `apple:Work:A7F1C0D3-UID-EXAMPLE`)
- The GUN soul becomes deterministic via `publisherPubKey` + `localId`, enabling overwrite-on-update semantics for the same event.

---

### End-to-end implementation plan

#### 1) Publish the template
- Add/publish the `calendarEvent` template via existing template publication flow:
  - Option A (CLI/script): use existing `publishNewTemplate()` programmatically
  - Option B (API): `POST /api/templates/newTemplate` with the JSON above
- Store the returned `didTx` for internal reference. The index mapping values above will be used during compression/expansion.

#### 2) mac-client: calendar ingestion module
Create `mac-client/calendar_manager.js` to read local Apple Calendar data on macOS.

Approach: AppleScript via `osascript` to avoid private DB access and keep permissions simple.
- Use `child_process.execFile('osascript', [...])` to run AppleScript that queries Calendar.app for events in a window.
- Extract fields: title, description, start date, end date, all-day, location, organizer, attendees, recurrence, UID, last modified.

Example AppleScript sketch (to be refined):
```applescript
tell application "Calendar"
  set theStart to (current date) - (1 * days)
  set theEnd to (current date) + (30 * days)
  set out to {}
  repeat with cal in calendars
    set calName to name of cal
    repeat with e in (every event of cal whose start date ≥ theStart and start date ≤ theEnd)
      set endDate to end date of e
      set recRule to recurrence of e
      set theUID to uid of e
      set theOrganizer to organizer of e -- may be empty
      set attendeeStrs to {}
      repeat with a in attendees of e
        set end of attendeeStrs to (name of a & " <" & email of a & ">")
      end repeat
      copy {calName, summary of e, description of e, location of e, start date of e, endDate, all day event of e, theUID, recRule, attendeeStrs} to end of out
    end repeat
  end repeat
  return out
end tell
```

`calendar_manager.js` responsibilities:
- Run the AppleScript and parse results into JS objects
- Normalize time to epoch ms; detect timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`)
- Build OIP record JSON per the template and set `basic.date = startTime`
- Derive `localId` using `<sourceSystem>:<sourceCalendarName>:<externalUid>`
- Add `accessControl` based on config (default private; optional readers)

Config additions (extend `EnhancedVoiceInterfaceServer` config or a small `config/calendar.json`):
- `BACKEND_URL` (already present)
- `CALENDAR_SYNC_WINDOW_DAYS` (default 30)
- `CALENDAR_PRIVACY_DEFAULT` (default true)
- `CALENDAR_READERS` (array of DIDs/emails; optional)
- Backend auth: either stored token or login credentials used to fetch a JWT

#### 3) mac-client: backend integration and endpoints
Add to `enhanced_voice_interface_server.js` new routes:
- `POST /api/calendar/sync` — triggers a one-shot sync for window `X` days
- `GET /api/calendar/preview` — returns the mapped (but unpublished) events for inspection

Auth to backend:
- `POST /api/user/login` to get JWT using configured credentials
- Include `Authorization: Bearer <token>` when POSTing records

Publish flow per event:
1. Build record JSON (as above)
2. POST to backend:
   - `POST {BACKEND_URL}/api/records/newRecord?recordType=calendarEvent&storage=gun&localId=<computedLocalId>`
   - Body: record JSON including `accessControl`
3. The backend uses `publishNewRecord(record, 'calendarEvent', ..., { storage: 'gun', localId, accessControl })`
4. The GUN publisher encrypts if `accessControl.private === true`
5. Indexed into Elasticsearch for unified queries

Idempotency and updates:
- Using the same `localId` ensures the same GUN soul; re-publishing updates the record in place
- Compare `lastModified` to skip unchanged events

Deletions/cancellations:
- If an event is cancelled, publish with `status = cancelled`
- Optionally add a local delete mechanism later using the GUN helper

Scheduling:
- Add an internal interval (e.g., every 15 minutes) to re-sync and publish updates, or rely on manual `POST /api/calendar/sync`

#### 4) Backend: expected behavior (no new endpoints required)
- Existing `POST /api/records/newRecord` supports `storage=gun`, `localId`, `accessControl`
- Records are indexed with `oip.storage = 'gun'` and `oip.encrypted = true` when private
- Queries can combine sources using `source=gun` or `source=all`

#### 5) Querying calendar data examples
- Latest events (private GUN):
  - `GET /api/records?source=gun&recordType=calendarEvent&sortBy=date:desc&limit=20`
- Between two dates:
  - `GET /api/records?source=gun&recordType=calendarEvent&dateStart=2025-01-01&dateEnd=2025-01-31`
- Search by title/description:
  - `GET /api/records?source=gun&recordType=calendarEvent&search=standup&searchMatchMode=AND`
- Exact match by external UID:
  - `GET /api/records?source=gun&recordType=calendarEvent&exactMatch={"data.calendarEvent.externalUid":"A7F1C0D3-UID-EXAMPLE"}`

#### 6) Testing plan
- Unit-test the AppleScript parser with fixture output
- Dry-run preview endpoint and verify mapping/normalization
- Integration test: publish a small set of events and query via `/api/records`
- Verify encryption flag (`encrypted: true`) on responses from `POST /api/records/newRecord`
- Confirm idempotency by re-running sync (no dupes; same soul/localId)

#### 7) Privacy and key management
- Current GUN encryption uses a symmetric key in the helper; accept as v1 for private local records
- Future improvement: per-user keys and reader-specific encryption (align with Lit Protocol model)

#### 8) Rollout steps
1. Publish `calendarEvent` template
2. Implement `calendar_manager.js` and new mac-client routes
3. Configure backend credentials in mac-client and test login
4. Run one-shot sync and validate records in `/api/records?source=gun`
5. Enable periodic sync

---

This plan leverages existing GUN integration and records APIs, keeping all calendar data private by default while enabling robust search and filtering through Elasticsearch. The mac-client performs ingestion and publishing, using Apple Silicon for local processing and the backend for indexing and query.


