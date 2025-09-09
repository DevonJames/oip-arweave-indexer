## Notes records using GUN (private) — template proposal and implementation plan

### Goal
Add private, encrypted Notes records to OIP using the mac-client to read Apple Notes data (via JXA/AppleScript) and publish to the backend through `/api/records/newRecord` with `storage=gun`. Records remain private in storage while still queryable via `/api/records`.

### Recommended ingestion approach on macOS (Sonoma/Sequoia)
- Use JXA (JavaScript for Automation) or AppleScript to enumerate Notes content (title, body HTML, created/modified, account, folder path, links).
- Optionally filter by a specific folder name and include subfolders recursively.
- Do not attempt to read the encrypted `NoteStore.sqlite` directly.
- For rich link “cards”, export canonical URLs and resolve full content outside Notes (article extraction, tweet text) if desired.

---

### Proposed OIP template: `personalNote`
Priorities:
- Map cleanly to Apple Notes data model without private APIs.
- Enable full-text and tag searches; enable date-range queries using existing API.
- Keep PII private via GUN encryption; index only useful metadata.

Template (flat format expected by current system):

```json
{
  "personalNote": {
    "title": "string",
    "index_title": 0,

    "bodyHtml": "string",
    "index_bodyHtml": 1,

    "bodyPlain": "string",
    "index_bodyPlain": 2,

    "createdAt": "long",
    "index_createdAt": 3,

    "updatedAt": "long",
    "index_updatedAt": 4,

    "account": "string",
    "index_account": 5,

    "folderPath": "string",
    "index_folderPath": 6,

    "urls": "repeated string",
    "index_urls": 7,

    "hasLocked": "bool",
    "index_hasLocked": 8,

    "sourceSystem": "enum",
    "sourceSystemValues": [
      { "code": "apple", "name": "Apple Notes" },
      { "code": "imap", "name": "IMAP Notes" }
    ],
    "index_sourceSystem": 9,

    "externalUid": "string",
    "index_externalUid": 10,

    "lastModified": "long",
    "index_lastModified": 11,

    "attachmentPaths": "repeated string",
    "index_attachmentPaths": 12,

    "tagItems": "repeated string",
    "index_tagItems": 13
  }
}
```

Notes:
- For API date filtering compatibility, set `basic.date = updatedAt` when publishing so `/api/records?dateStart=&dateEnd=` works.
- `bodyPlain` enables lighter-weight search/summarization; it is derived from `bodyHtml` locally.
- `urls` collects canonical links found in the note body and, when available, on attachments via scripting.
- `attachmentPaths` is optional: if we extend the exporter to save binaries to disk, store relative paths here. Otherwise, leave empty.

Example record (expanded JSON used as input to publish):

```json
{
  "basic": {
    "name": "Reading list – LLM evals",
    "description": "Clips from Safari share menu",
    "date": 1736355600000,
    "language": "en",
    "tagItems": ["reading", "ai"]
  },
  "personalNote": {
    "title": "Reading list – LLM evals",
    "bodyHtml": "<div>Links and quotes…</div>",
    "bodyPlain": "Links and quotes…",
    "createdAt": 1736270000000,
    "updatedAt": 1736355600000,
    "account": "iCloud",
    "folderPath": "Reading/AI",
    "urls": [
      "https://arxiv.org/abs/2403.00000",
      "https://x.com/someuser/status/1234567890"
    ],
    "hasLocked": false,
    "sourceSystem": "apple",
    "externalUid": "A1B2C3D4-UID-EXAMPLE",
    "lastModified": 1736355600000,
    "attachmentPaths": [],
    "tagItems": ["reading", "ai"]
  },
  "accessControl": { "private": true, "readers": [] }
}
```

Deterministic identity for deduplication:
- `localId` format: `apple:<account>:<folderPath>:<externalUid>` (e.g., `apple:iCloud:Reading/AI:A1B2C3D4-UID-EXAMPLE`).
- This ensures idempotent writes to the same GUN soul via `publisherPubKey + localId`.

---

### End-to-end implementation plan

#### 1) Publish the template
- Publish `personalNote` through the existing template flow (programmatic or `POST /api/templates/newTemplate`).
- Keep the index mapping stable; store returned `didTx` for internal reference.

#### 2) mac-client: Notes ingestion module
Create `mac-client/notes_manager.js` to export Notes via JXA and normalize output.

Exporter (JXA) requirements:
- Accept optional `folderName` and `--recursive` to filter scope.
- Emit JSON array with: `id`, `name`, `body_html`, `created_at`, `updated_at`, `account`, `folder_path`, `urls`.
- For locked notes, the body may be empty; mark `hasLocked = true` when `body_html` is empty but `name` exists.

High-level flow in `notes_manager.js`:
1. Run JXA with `osascript -l JavaScript export_notes_with_links.jxa [folderName] [--recursive]`.
2. Parse JSON, map to OIP record structure:
   - `basic.name = note.name`
   - `basic.description = first 120 chars of bodyPlain`
   - `basic.date = updatedAt`
   - `personalNote.*` fields per template
3. Convert times to epoch ms; derive `bodyPlain` from `bodyHtml`.
4. Compute `localId = apple:<account>:<folderPath>:<id>`.
5. Attach `accessControl` with `private: true` (default) and optional `readers`.

Config additions (extend interface server config or a small `config/notes.json`):
- `BACKEND_URL` (already present)
- `NOTES_SYNC_FOLDER` (optional folder name to filter)
- `NOTES_SYNC_RECURSIVE` (boolean)
- `NOTES_PRIVACY_DEFAULT` (default true)
- `NOTES_READERS` (optional array)

#### 3) mac-client: API endpoints and scheduling
Add to `enhanced_voice_interface_server.js`:
- `POST /api/notes/sync` — one-shot sync for configured folder/scope.
- `GET /api/notes/preview` — returns the mapped (but unpublished) notes to inspect.

Scheduling options:
- Manual trigger via the endpoint.
- Optional interval (e.g., every N minutes) to re-sync; skip unchanged notes by comparing `updatedAt`.

#### 4) Backend publishing via existing API
For each note to publish:
- `POST {BACKEND_URL}/api/records/newRecord?recordType=personalNote&storage=gun&localId=<computedLocalId>`
- Body: the expanded record including `accessControl`
- The backend uses `publishNewRecord(record, 'personalNote', ..., { storage: 'gun', localId, accessControl })`.
- GUN payload is encrypted when `private: true` and indexed into Elasticsearch for unified queries.

Delta logic and idempotency:
- Compare `updatedAt` (or `lastModified`) to a local cache; skip if unchanged.
- Re-publishing the same `localId` updates in place (same GUN soul).

#### 5) Optional: link resolution pipeline
- For each URL in a note:
  - Fetch page and extract article text/title (e.g., Trafilatura) and store results locally (not required for OIP record).
  - For tweets/X, store URLs and resolve on demand through a compliant service.
- If attachments are exported to disk, include relative paths in `attachmentPaths`.

#### 6) Querying examples
- Latest notes (private GUN):
  - `GET /api/records?source=gun&recordType=personalNote&sortBy=date:desc&limit=20`
- Notes in a folder path:
  - `GET /api/records?source=gun&recordType=personalNote&exactMatch={"data.personalNote.folderPath":"Reading/AI"}`
- Date range:
  - `GET /api/records?source=gun&recordType=personalNote&dateStart=2025-01-01&dateEnd=2025-02-01`
- Search by text/URL:
  - `GET /api/records?source=gun&recordType=personalNote&search=LLM%20evals`

#### 7) Testing plan
- Unit-test JXA output parsing and HTML→plaintext conversion.
- Preview endpoint returns normalized notes for manual inspection.
- Integration test end-to-end publish, then query via `/api/records` with `source=gun`.
- Verify encryption flag and idempotent updates (same `localId`).

#### 8) Privacy and limitations
- Locked notes: bodies are not exposed via automation unless unlocked. Mark `hasLocked=true` when body is empty.
- Thumbnails from rich links are not exported; fetch OpenGraph images during link resolution if needed.
- All payloads are private by default (`accessControl.private=true`).

#### 9) Rollout
1. Publish `personalNote` template.
2. Implement `notes_manager.js` and local config.
3. Add `/api/notes/preview` and `/api/notes/sync` to the mac-client server.
4. Configure backend credentials; test a small sync.
5. Enable periodic sync and monitor.

---

This plan uses Apple’s supported automation to reliably export Notes on current macOS, keeps content private in GUN, and leverages the existing records API and Elasticsearch index for fast search and filtering.


