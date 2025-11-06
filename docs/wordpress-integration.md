# PRD Chapter: WordPress Integration for OIP (“Lapis Obscura”)

## Summary

Provide first-class WordPress authoring that outputs OIP-compatible, signed records and submits them to an OIP gateway. Support both **create-but-don’t-send** (export for out-of-band relay) and **submit via configured endpoint** (clearnet or onion). Keep WordPress as the editor and preview surface; keep OIP as the persistent, widely replicated index layer and distribution router.

## Goals

* Let authors use WordPress to compose posts and media, then publish to OIP with one action.
* Keep writer privacy: sign locally, no accounts, no PII in payloads.
* Enable **gateway-scoped moderation**: operators decide what their gateway indexes and serves.
* Preserve existing WP workflows: drafts, revisions, scheduled publish, categories/tags.
* Decouple assets: large media is referenced via peer distribution (e.g., BitTorrent/WebTorrent/IPFS), not served from WP.

## Non-Goals

* No global moderation. Decisions are per gateway.
* No reliance on blockchain UX. Speak only to an OIP gateway and index layer.
* No requirement to host public WP sites. WP may run headless or behind Tor.

## Users and Stories

* **Journalist:** “As an author I write in WordPress, click Publish to OIP, and get a receipt without making an account.”
* **Security analyst:** “I can export a signed package to a file and hand it to a courier for offline relay.”
* **Gateway operator:** “I set ingest limits and approval rules. I can auto-approve certain tags and queue others.”
* **Archivist/editor:** “I can map WP categories/tags to OIP template fields and add provenance notes.”

## Scope

### WordPress Plugin (“LO Publisher”)

* **Editor integration**

  * Gutenberg sidebar panel: status, validation, target gateway, “Publish to OIP,” “Export signed package.”
  * Field mapping UI: WP fields → OIP template fields (title, excerpt, body, byline, tags, attachments, provenance).
* **Signing**

  * Local DID key management in WP (PHP OpenSSL + libsodium, or JS Web Crypto in browser with detached JWS).
  * Import/export keys via password-encrypted backup file. Hardware key support later.
* **Submission modes**

  * **Submit:** POST to configured OIP gateway (`/publish`), receive `submissionId`, track status.
  * **Create-but-don’t-send:** writes a `.lopkg` file (JSON + attachments manifest) for sneaker-net/Tor submission elsewhere.
* **Media handling**

  * Generates a distribution manifest for each attachment: file hash, size, MIME, and one or more distribution hints (torrent magnet, WebTorrent info, IPFS CID, HTTP mirror if operator opts in).
  * Optional background seeding via a companion seeder (see “Seeder” below) instead of serving from WP.
* **Preview**

  * “Preview from OIP” pulls the rendered record from a read API or local formatter to match how end readers will see it.
* **Moderation cues**

  * Displays gateway policy hints returned by `/queue/limits` (max size, allowed MIME, required tags).

### OIP Gateway (ingest side additions)

* Accept WP-specific payload variant (same schema as generic publish, plus optional WP meta).
* Offer `/queue/limits` and `/schema/oip-templates` for plugin configuration.
* Optional **review queue** with token-scoped rules (size, MIME, tags, rate).

### Seeder (optional, headless)

* Lightweight process or Docker service that seeds uploaded media to peer networks.
* Runs on the same host or a separate box; exposes no public WP endpoints.

## Architecture

```
WP (author) ──(sign locally)──►
  [Submit]  ──HTTPS/Tor──► OIP Gateway ──► Index layer + peer distribution
  [Export]  ──.lopkg file──► Any relay (human or automated) ──► OIP Gateway
Media path: WP → Seeder → BitTorrent/WebTorrent/IPFS hints → referenced in record
```

### Components

* **WP Plugin**

  * PHP core + minimal React sidebar.
  * Local key store in WP options table, encrypted at rest; or browser-held ephemeral keys.
* **OIP Gateway**

  * Existing `/publish`, `/status/:id`, `/health`, `/version`.
  * New: `/queue/limits`, `/schema/oip-templates`.
* **Seeder**

  * CLI/daemon, reads a watch directory from WP uploads, produces magnets/CIDs, reports back to plugin.

## Security and Privacy Requirements

* **Keys** never leave the author’s environment. Master keys are not used for routine signing. Use purpose-scoped child keys.
* **No cookies** for publish calls. Header tokens or detached signatures only.
* **No IP logging** requirement for plugin; gateway onion routes already strip IPs. Clearnet operators may log per their policy.
* **CORS/CSRF**: plugin calls gateway with header auth; no ambient cookies.
* **Payload hygiene**: strip EXIF and dangerous HTML if configured. MIME allowlist. Size caps.
* **Timing**: gateway batches external side effects to reduce correlation.

## Functional Requirements

### FR-WP-1 Install and Setup

* Installable from zip or WP directory. Requires PHP ≥ 8.1.
* Setup wizard:

  * Create/import DID key.
  * Choose submission mode defaults.
  * Configure gateway URL(s) and tokens.
  * Enable/disable Seeder integration.

### FR-WP-2 Compose and Validate

* Sidebar shows live validation:

  * Required fields present.
  * Media manifest built.
  * Size/MIME within gateway limits (queried from `/queue/limits`).

### FR-WP-3 Sign

* Produce `DataForSignature` JSON canonicalized (deterministic key order, LF line endings).
* Hash and sign with selected child key.
* Attach signature, pubkey reference, and derivation hint.

### FR-WP-4 Publish to OIP

* `POST /publish` with `{ record, signature, pubkeyRef, meta }`.
* Handle `202 Accepted` and store `submissionId` in WP post meta.
* Periodically poll `/status/:id` via WP-Cron; update status.

### FR-WP-5 Export Package

* Generate `.lopkg`:

  * `record.json` (signed).
  * `media.json` (hashes, sizes, manifests).
  * Optional attachments or only checksums, per setting.
* Save to local disk and offer download.

### FR-WP-6 Media Seeding (optional)

* On upload, seed via Seeder; store returned magnet/CID in attachment meta.
* If seeding disabled, allow operator to add external mirrors manually.

### FR-WP-7 Moderation Signals

* Display gateway moderation outcomes for submissions: `approved`, `quarantined`, `hidden`, `rejected(code)`.
* Show reasons and remediation hints when available.

### FR-GW-1 Limits and Schemas

* `/queue/limits` returns max body MB, max attachments, MIME allowlist, tag policies, rate limits, and current moderation mode.
* `/schema/oip-templates` returns available templates and field definitions for mapping UI.

## Non-Functional Requirements

### Performance

* Signing operation under 200 ms for typical posts on commodity hardware.
* P95 plugin UI actions under 150 ms.

### Reliability

* Offline-tolerant: export always available; publish retries with exponential backoff.

### Compatibility

* WordPress 6.4+; PHP 8.1+; Gutenberg editor.
* Works with classic editor in degraded mode (no sidebar, admin screen actions only).

### Observability

* Plugin logs only local errors and submission IDs. No PII by default.
* Gateway exposes metrics on WP-sourced submissions and moderation outcomes.

## Configuration

### WP Plugin Settings

* Gateway URLs (clearnet and/or `.onion`), tokens.
* Default submission mode: Submit | Export.
* Template mapping presets per post type.
* Media policy: strip EXIF, transcode, max size, seeding on/off.
* Key management: create/import/export, rotation reminder.
* Safety: warn on oversized payloads; block dangerous MIME.

### Seeder Settings

* Watch path, max concurrent seeds, bandwidth caps.
* Peer distribution backends enabled (torrent, WebTorrent, IPFS).
* Report URL for magnets/CIDs.

## APIs

### Gateway

* `GET /queue/limits`

  * `200` `{ maxBodyMb, maxAttachments, mimeAllow, tagPolicy, rps, moderationMode }`
* `GET /schema/oip-templates`

  * `200` `{ templates:[{name, fields:[...]}] }`
* `POST /publish`

  * As defined in Tor chapter. Same contract.

### Plugin (local admin AJAX)

* `POST /lo-publisher/sign` → returns `{ signature, pubkeyRef }`
* `POST /lo-publisher/export` → returns file path or download stream
* `POST /lo-publisher/status` → proxies `/status/:id` for UI

## Acceptance Criteria

* A post with text + 2 images validates, signs, and submits; status becomes `succeeded`; gateway shows it indexed.
* The same post exports to `.lopkg` and is accepted when submitted from a different machine.
* Gateway enforces MIME allowlist and size caps; plugin surfaces rejections with actionable codes.
* Seeder produces magnets/CIDs and the record references them in the manifest.
* Operator toggles moderation to “quarantine by default”; plugin displays queued state.

## Testing Plan

* **Unit:** canonicalization, signing, field mapping, error codes.
* **Integration:** end-to-end submit over clearnet and onion; status sync.
* **Load:** batch submit 50 posts; verify rate-limit handling and UI resilience.
* **Security:** XSS in content sanitized per operator policy; EXIF stripping validated; key export/import encryption verified.
* **Offline:** gateway down → export path still works; submit retries honor backoff.

## Rollout

* Alpha: zip install for testers; one reference gateway.
* Beta: WP.org listing; Docker Compose example with WP + Seeder + Gateway.
* GA: Raspberry Pi image with pre-configured stack and first-run wizard.

## Risks and Mitigations

* **Key loss:** encrypted backups + recovery docs; warn before rotation.
* **Operator misconfig (serving originals):** default to seeding; explicit opt-in to serve media over WP.
* **Large payloads:** preflight against `/queue/limits`; client-side compression guidance.
* **Timing correlation:** rely on gateway batching; document best practices.

## Metrics and Success Criteria

* ≥ 90% of valid submissions succeed on first attempt.
* Median “click Publish → receipt” under 2 s excluding gateway processing.
* ≤ 2% rejections due to size/MIME after initial setup.
* ≥ 80% of media uses peer distribution manifests rather than WP origin.

## Documentation Deliverables

* Author guide: install, key setup, compose, publish, export, troubleshoot.
* Operator guide: limits, moderation modes, Seeder setup, mirrors.
* Security note: what local signing protects, content hygiene checklist.
* Field mapping cookbook: common mappings for posts, docs, datasets, media drops.
