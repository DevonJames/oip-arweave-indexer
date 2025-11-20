Below is a backend-only development plan that ties the Alfred Notes product behavior to concrete OIP/GUN/Elasticsearch work, centered around a new ingestion endpoint plus the related functionality it implies.

⸻

1. Goals and scope

Primary goal

Implement a backend pipeline and endpoint that supports the core iOS v1 flow:

Audio capture → Upload → Transcription → Chunking → Summary → Searchable RAG

All data should be stored as OIP records using your existing records API and GUN storage, with Elasticsearch indexing for retrieval.

Out of scope (handled by app / later phases)
	•	iOS/macOS/watchOS UI and local storage.
	•	Workstation pairing UX (assume a configured endpoint if needed).
	•	Spaces/Projects, tasks, reminders integration.
	•	Non-audio imports (PDF, docs) – can be added later to reuse the same indexing & summary pipeline.

⸻

2. New endpoint: /api/notes/from-audio

2.1 Route and auth
	•	Method: POST
	•	Path: /api/notes/from-audio
	•	Auth: Authorization: Bearer <jwt> (reuse existing JWT middleware)
	•	Middleware populates req.user with at least:
	•	userId
	•	email
	•	publicKey (HD wallet key used for accessControl)

2.2 Request format (v1)

Use multipart/form-data:
	•	audio (file, required)
	•	Allowed formats: mp3, m4a/aac, wav/pcm, webm/opus, flac, ogg/vorbis (matching audio.audioCodec enum).
	•	start_time (string, required)
	•	ISO 8601 (UTC) start timestamp of recording.
	•	end_time (string, required)
	•	ISO 8601 end timestamp.
	•	note_type (string, required)
	•	One of: MEETING, ONE_ON_ONE, STANDUP, IDEA, REFLECTION, INTERVIEW, OTHER.
	•	device_type (string, required)
	•	One of: IPHONE, MAC, WATCH, OTHER.
	•	capture_location (string, optional)
	•	Coarse text or encoded lat/long per your convention.
	•	transcription_engine_id (string, required)
	•	Logical engine id (e.g. "whisper_default", "maya1_local") that will map to a transcriptionEngine record.
	•	chunking_strategy (string, optional; default BY_TIME_30S)
	•	One of the values defined in notes.chunking_strategy.
	•	Participants (optional, for meetings/1:1):
	•	participant_display_names (JSON array of strings)
	•	participant_roles (JSON array of strings, parallel to names)
	•	(emails/person drefs can be added later)
	•	Calendar (optional):
	•	calendar_event_id (string)
	•	calendar_start_time (ISO string)
	•	calendar_end_time (ISO string)

Later extension: add audio_ref instead of file to reuse already-uploaded audio.

2.3 Response format

On success (HTTP 200):

{
  "success": true,
  "noteHash": "string",
  "noteDid": "did:gun:...",
  "transcriptionStatus": "COMPLETE",
  "chunkCount": 12
}

On validation error (HTTP 400):

{
  "success": false,
  "error": "Invalid note_type value"
}

On auth error: HTTP 401.
On conflict (hash collision with different content): HTTP 409.
On upstream STT / LLM failure: HTTP 502 or 500, with a generic client message and detailed logging server-side.

⸻

3. Processing pipeline (inside /from-audio)

3.1 High-level steps
	1.	Authenticate and authorize.
	2.	Validate request and normalize metadata.
	3.	Persist audio file and create audio record.
	4.	Resolve transcriptionEngine record.
	5.	Run STT with chosen engine.
	6.	Compute deterministic noteHash.
	7.	Chunk transcript and create noteChunks records.
	8.	Create transcript text record (referenced by notes.transcript_full_text).
	9.	Summarize note and populate summary fields.
	10.	Create notes record.
	11.	Index into Elasticsearch.
	12.	Return response.

3.2 Detailed behavior

3.2.1 Auth and validation
	•	Use existing JWT middleware to populate req.user.
	•	Validate:
	•	note_type is in notes.note_typeValues.code.
	•	device_type in notes.device_typeValues.code.
	•	chunking_strategy in notes.chunking_strategyValues.code (or default).
	•	start_time < end_time.
	•	Audio file size within configured max and codec allowed.
	•	Participant arrays (if present) have equal length.

Return HTTP 400 on any validation error.

3.2.2 Audio storage and audio record
	•	Persist audio binary to your media layer:
	•	For v1: store in S3 (or equivalent) and set audio.webUrl.
	•	Plan for later: Arweave / IPFS / BitTorrent addresses using your media pipeline, populating arweaveAddress, ipfsAddress, etc.

Create an audio record via:

POST /api/records/newRecord?recordType=audio&storage=gun&localId={audioHash}

Where:
	•	audioHash = sha256(raw_audio_bytes) (hex).
	•	audio.durationSec from probe metadata.
	•	audio.audioCodec enum based on actual codec.
	•	audio.contentType from HTTP/file detection.
	•	audio.size from file length.
	•	accessControl.owner_public_key = req.user.publicKey.

Store resulting DID for cross-linking if needed later (not strictly required in notes in v1 but useful for debug/auditing).

3.2.3 Resolve transcription engine
	•	Input: transcription_engine_id string from client.
	•	Lookup:
	•	GET /api/records?recordType=transcriptionEngine&fieldName=transcriptionEngine.engine_id&fieldSearch={transcription_engine_id}
	•	Expect 1 record:
	•	If 0 → 422 with clear error: engine not configured.
	•	If >1 → 409 conflict.

Use that record’s transcriptionEngine payload to configure the actual STT call (e.g., provider, model name, max duration, streaming support).

3.2.4 STT call
	•	Call STT abstraction: sttService.transcribe(audioFile, transcriptionEngineRecord)
	•	Return struct:

{
  language: "en" | string;
  text: string;                 // full transcript
  segments: Array<{
    start_ms: number;
    end_ms: number;
    text: string;
    speaker?: string;
    confidence?: number;
  }>;
}


	•	If STT fails:
	•	Option A (simpler v1): entire request fails → 502/500, no notes record created.
	•	Option B (more robust): create notes record with transcription_status = FAILED and log error. For v1 you can choose A for simplicity.

3.2.5 noteHash computation
	•	Normalize transcript:
	•	Trim whitespace, normalize \r\n to \n, NFC normalization.
	•	Compute:
	•	noteHash = sha256(normalized_transcript_utf8) (hex string).

This will be:
	•	localId for notes: {noteHash}
	•	localId for transcript text: {noteHash}:transcript
	•	localId for chunks: {noteHash}:{chunk_index}

This provides idempotency if the same transcript is processed again.

3.2.6 Chunking and noteChunks records
Use chunking_strategy to map segments → chunks:
	•	For time-based strategies (BY_TIME_15S, BY_TIME_30S, BY_TIME_60S):
	•	Walk segments and merge slices into windows of given duration.
	•	For sentence/paragraph strategies:
	•	Split on punctuation/newlines; can still use STT times as approximate.

Chunk structure:

{
  chunk_index: number;
  start_time_ms: number;
  end_time_ms: number;
  text: string;
  speaker_label?: string;
  is_marked_important: boolean;   // v1 default false; app can update later
  sentiment?: "neg" | "neu" | "pos"; // optional future field
  confidence_score?: number;
}

For each chunk:

POST /api/records/newRecord?recordType=noteChunks&storage=gun&localId={noteHash}:{chunk_index}

Body:

{
  "basic": {
    "name": "Note chunk " /* + index */,
    "description": "",
    "date": /* capture date ms */,
    "language": "en",
    "tagItems": ["alfred_note_chunk", "noteType_MEETING"]
  },
  "noteChunks": {
    "note_ref": null,                  // link later if desired
    "chunk_index": 0,
    "start_time_ms": 12345,
    "end_time_ms": 45678,
    "text": "chunk text",
    "speaker_label": "Speaker 1",
    "is_marked_important": false,
    "sentiment": "neu",
    "confidence_score": 0.94
  },
  "accessControl": {
    "access_level": "private",
    "owner_public_key": "<userPublicKey>",
    "created_by": "<userPublicKey>"
  }
}

For v1 you can omit note_ref and fill in later when you implement an update pass.

3.2.7 Transcript text record
POST /api/records/newRecord?recordType=text&storage=gun&localId={noteHash}:transcript

{
  "basic": {
    "name": "Transcript for note " /* + snippet */,
    "description": "Full transcript",
    "date": /* capture date ms */,
    "language": "en",
    "tagItems": ["alfred_note_transcript"]
  },
  "text": {
    "value": "full transcript string ..."
  },
  "accessControl": {
    "access_level": "private",
    "owner_public_key": "<userPublicKey>",
    "created_by": "<userPublicKey>"
  }
}

Store its DID to set notes.transcript_full_text.

3.2.8 Summarization
Call summarizer service:

summaryService.summarize({ text, note_type, participants, calendar })

Return:

{
  key_points: string[];
  decisions: string[];
  action_items: Array<{
    text: string;
    assignee: string;
    due_text: string;
  }>;
  open_questions: string[];
  sentiment_overall: "NEGATIVE" | "NEUTRAL" | "POSITIVE";
}

Map to notes fields:
	•	summary_key_points
	•	summary_decisions
	•	summary_action_item_texts
	•	summary_action_item_assignees
	•	summary_action_item_due_texts
	•	summary_open_questions
	•	sentiment_overall
	•	summary_version = 1

For v1, do it synchronously after STT; if latency becomes an issue, move to async job while still creating the base notes record immediately with empty summary.

3.2.9 notes record
Create via:

POST /api/records/newRecord?recordType=notes&storage=gun&localId={noteHash}

Body (core parts):

{
  "basic": {
    "name": "Meeting with ACME" /* or fallback to first few words of transcript */,
    "description": "Alfred Notes capture",
    "date": /* timestamp ms of created_at */,
    "language": "en",
    "tagItems": [
      "alfred_note",
      "noteType_MEETING"
    ]
  },
  "notes": {
    "note_type": "MEETING",
    "created_at": "2025-11-19T20:00:00Z",
    "ended_at": "2025-11-19T21:00:00Z",

    "device_type": "IPHONE",
    "capture_location": "San Luis Obispo, CA",

    "transcription_engine": "<dref_to_transcriptionEngine_record>",
    "transcription_status": "COMPLETE",
    "transcript_full_text": "<dref_to_text_transcript_record>",
    "user_edits_present": false,

    "summary_key_points": ["..."],
    "summary_decisions": ["..."],
    "summary_action_item_texts": ["..."],
    "summary_action_item_assignees": ["..."],
    "summary_action_item_due_texts": ["..."],
    "summary_open_questions": ["..."],
    "summary_version": 1,

    "participant_display_names": ["Alice", "Bob"],
    "participant_person_refs": [],
    "participant_emails": [],
    "participant_roles": ["Client", "PM"],

    "calendar_event_id": "event-id-if-provided",
    "calendar_start_time": "2025-11-19T20:00:00Z",
    "calendar_end_time": "2025-11-19T21:00:00Z",
    "linked_projects": [],

    "topics_auto": [],       // reserved for later classifier
    "keywords_auto": [],     // reserved for later
    "sentiment_overall": "NEUTRAL",

    "chunking_strategy": "BY_TIME_30S",
    "chunk_count": 12,
    "chunk_ids": [],

    "is_archived": false,
    "is_pinned": false
  },
  "accessControl": {
    "access_level": "private",
    "owner_public_key": "<userPublicKey>",
    "created_by": "<userPublicKey>"
  }
}

chunk_ids can remain empty in v1 and be populated via an update endpoint later.

⸻

4. Elasticsearch and RAG integration

4.1 Indices

Create or extend ES indices:
	1.	notes index
	•	Docs representing notes records.
	•	Key fields:
	•	noteDid, noteHash, userPublicKey
	•	note_type, created_at, ended_at
	•	summary_key_points, summary_decisions, summary_open_questions
	•	participant_display_names, tags, topics_auto, keywords_auto
	•	Used for library listing, filters, high-level search.
	2.	note_chunks index
	•	Docs representing noteChunks records.
	•	Key fields:
	•	noteDid, noteHash, chunk_index
	•	userPublicKey
	•	text (full chunk text)
	•	start_time_ms, end_time_ms
	•	is_marked_important, sentiment, confidence_score
	•	Derived fields: note_type, participants, calendar_event_id for filtering.

4.2 Indexing pipeline
	•	When notes and noteChunks records are written to GUN, your existing records→ES sync should:
	•	Detect record types notes and noteChunks.
	•	Normalize them into ES documents with user scoping (userPublicKey, owner_public_key).
	•	For RAG:
	•	Queries from Alfred/Alice chat will:
	•	Filter by user.
	•	Filter by time window (e.g. last 7 days) and/or note_type/tags.
	•	Search primarily in note_chunks.text with semantic or BM25 search.
	•	Retrieved chunks (top K) will be included in the prompt to the LLM with:
	•	noteDid, noteHash, chunk_index, and start_time_ms for citations.
	•	Answer will reference them by title and/or date, enabling iOS/macOS app to deep-link into the right note and timestamp.

⸻

5. Additional backend endpoints to support the app

While the core request was one ingestion endpoint, a minimal Alfred Notes backend should also expose:
	1.	GET /api/notes/:noteHash
	•	Returns aggregated view:
	•	notes record
	•	transcript text
	•	list of noteChunks (or at least metadata and IDs)
	•	Used by detail view in apps.
	2.	GET /api/notes
	•	Query parameters:
	•	note_type, from, to, search, pagination.
	•	Backs library list and search UI using ES.
	3.	POST /api/notes/:noteHash/regenerate-summary
	•	Triggers re-run of summaryService with updated transcript or new model.
	•	Increments summary_version.
	4.	PATCH /api/notes/:noteHash
	•	Allows edits to:
	•	summary_* fields (after user edits).
	•	participant_* arrays.
	•	is_archived, is_pinned, linked_projects.
	•	Ensures userPublicKey owns the record.
	5.	PATCH /api/noteChunks/:localId
	•	To mark chunks important (driven by “mark moment” or manual highlight).

These can be staggered in implementation after the ingestion endpoint.

⸻

6. Privacy, multi-engine support, and “local vs cloud”

6.1 Engine abstraction
	•	transcriptionEngine records already encode:
	•	engine_kind (LOCAL, REMOTE_API, SELF_HOSTED, HYBRID),
	•	codec/sample rate support,
	•	pricing and latency hints.
	•	Backend only needs:
	•	Input transcription_engine_id from client.
	•	Enforce per-user or per-plan restrictions (e.g., free tier cannot use expensive cloud engines).
	•	Route calls accordingly:
	•	REMOTE_API → OpenAI, etc.
	•	SELF_HOSTED or LOCAL → Alfred Box / workstation endpoint.

6.2 User privacy flags (integration into pipeline)
	•	User-level settings (from your user/settings store):
	•	allowCloudTranscription (bool)
	•	allowCloudLLM (bool)

The /from-audio handler must:
	•	Reject requests that select a REMOTE_API engine if allowCloudTranscription is false.
	•	Prefer local/self-hosted engines if available and permitted.

⸻

7. Implementation sequence (tasks)
	1.	Schema & config
	•	Finalize audio, notes, transcriptionEngine, noteChunks templates (already largely defined).
	•	Seed initial transcriptionEngine records:
	•	e.g., engine_id = "whisper_default" using Whisper.
	•	engine_id = "maya1_local" for local/box.
	2.	STT service abstraction
	•	Implement sttService.transcribe(...) that:
	•	Accepts transcriptionEngine record and audio path.
	•	Dispatches to correct provider.
	•	Normalizes return format.
	3.	Summarization service
	•	Implement summaryService.summarize(...) using existing LLM orchestrator.
	•	Take full transcript + lightweight metadata; output mapped fields.
	4.	Chunking service
	•	Implement chunkingService.chunk({ segments, strategy }).
	•	Support at least:
	•	BY_TIME_30S (default),
	•	BY_TIME_60S,
	•	BY_SENTENCE (optional).
	5.	Records service wrappers
	•	Helper module for:
	•	createAudioRecord(audioMeta).
	•	createTranscriptTextRecord(noteHash, text).
	•	createNoteChunkRecord(noteHash, chunk).
	•	createNoteRecord(noteHash, payload).
	•	All use existing /api/records/newRecord behind the scenes.
	6.	Implement /api/notes/from-audio
	•	Glue all services:
	•	Parse multipart.
	•	Validate.
	•	Store audio & create audio record.
	•	Resolve engine → STT → transcript.
	•	Compute hash & chunk → create noteChunks.
	•	Create transcript text record.
	•	Summarize & create notes.
	•	Return response.
	7.	Elasticsearch mappings & sync
	•	Add mappings for notes and note_chunks indices.
	•	Extend records→ES sync to:
	•	Recognize recordType=notes and noteChunks.
	•	Index necessary fields for search and RAG.
	8.	Support endpoints
	•	Implement GET /api/notes/:noteHash for app detail views.
	•	Implement GET /api/notes for listing/search.
	9.	Testing
	•	Unit tests for:
	•	STT service (mock providers).
	•	Chunking strategies.
	•	Summary service mapping.
	•	Integration tests:
	•	/from-audio with various engines and note types.
	•	Performance testing on typical meeting lengths (30–90 minutes).

This plan gives you a concrete backend path to support the Alfred Notes v1 product behavior while fitting tightly into your existing OIP/GUN/records architecture.