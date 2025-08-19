# GUN Integration Plan for OIP Arweave Platform

This document proposes a concrete, incremental plan to integrate GUN as a private/temporary, real‑time storage layer that interoperates with the OIP records and templates system (Arweave + Elasticsearch). The goal is to enable a single API surface to read and write both permanent OIP records and private/ephemeral GUN data, using a unified DID scheme and template semantics, with the highest possible interoperability across the stack.

Reference: GUN documentation `https://gun.eco/docs`.

## Objectives

- Unify identifiers by replacing `oip.didTx` with `oip.did` (backward compatible) to support any DID method, including `did:arweave:` and `did:gun:`.
- Write path: Allow `/api/records/newRecord` to publish to GUN (private/temporary) in addition to Arweave/Irys (permanent), while preserving OIP template semantics.
- Read path: Allow `/api/records` to return a merged, uniform view of Arweave and GUN records, including filtering, sorting, resolution, and search.
- Indexing: Index GUN content into Elasticsearch in the same shape as OIP records for cross‑source querying and resolver interoperability.
- Security & privacy: Use GUN SEA for encryption of private data and (optionally) reuse existing access control patterns (Lit) for policies; avoid leaking secrets to ES.
- Deployment: Provide a `gun-relay` service and app‑internal GUN client, integrate without disrupting current Docker profiles.

## High‑level Architecture

- Permanent records: Arweave + OIP compressed records → indexed in Elasticsearch (existing flow).
- Private/temporary records: GUN graph nodes (CRDT, local‑first) with SEA encryption → indexed into Elasticsearch as normalized JSON documents (no secret material).
- Unified API: `/api/records` and `/api/records/newRecord` support both sources via parameters and defaults, returning uniform shapes.
- Unified DID: `oip.did` replaces `oip.didTx`. `did:arweave:<txid>` for Arweave; `did:gun:<soul>` for GUN.

## DID Scheme & Backward Compatibility

### Changes

- Rename `oip.didTx` → `oip.did`. Preserve `oip.didTx` as read‑only alias during transition.
- Accept both `didTx` and `did` query params on `/api/records`; normalize to `did` internally.
- Update helper validators:
  - `isValidDid(did)` → allow multiple DID methods: `did:arweave:<txid>`, `did:gun:<soul>`.
  - `txidToDid()` and `didToTxid()` remain for `did:arweave:*`. Add `didToGunSoul()` for `did:gun:*`.

### GUN DID Format

- `did:gun:<soul>` where `<soul>` is the GUN node’s stable address (e.g., `oip:records:<uuid>`). Souls MUST be deterministic for a given logical record.
- Recommendation: `soul = oip:records:<publisherPubKey>:<contentHashOrUuid>`.
- Optional fragment to reference subfields: `did:gun:<soul>#path.to.field` (not required for MVP).

### Deterministic GUN Soul (MVP)

To avoid collisions and keep edits stable across sessions/devices while remaining simple to implement:

- Preferred: client supplies `localId` (UUID v4) on first draft creation; server computes: `soul = oip:records:<publisherPubKey>:<localId>`.
- Fallback (if no `localId` provided): compute a short content hash of the canonicalized JSON and use first 12 hex chars: `soul = oip:records:<publisherPubKey>:h:<sha256(canon)[:12]>`.
- Store `oip.localId` in the node to continue using the same `soul` after the first write.

This guarantees a stable, human‑auditable soul and avoids accidental fan‑out of multiple nodes for the same logical record.

### ES Migration (backfill)

- Copy `oip.didTx` → `oip.did` for all docs; keep `oip.didTx` for compatibility. New writes populate both for a short period, then remove.
- Update ES mappings: ensure `oip.did` is `keyword`.

## Data Model for GUN Records

- Store expanded JSON (human‑readable) in GUN for easy client use and SEA encryption.
- Maintain OIP template semantics by attaching template references, so both Arweave and GUN variants can be rendered/queried uniformly.

Example GUN node value (expanded):

```json
{
  "data": {
    "basic": { "name": "My Private Draft", "language": "en", "tagItems": ["draft"] },
    "post": { "bylineWriter": "Alice", "articleText": { "text": { "webUrl": "https://..." } } }
  },
  "oip": {
    "did": "did:gun:oip:records:pub:abcdef...:f7c1...",
    "storage": "gun",
    "recordType": "post",
    "indexedAt": "2025-01-01T00:00:00.000Z",
    "creator": {
      "didAddress": "did:arweave:<creatorAddress>",
      "publicKey": "<creatorPublicKey>"
    },
    "templateRefs": { "basic": "<templateTxId>", "post": "<templateTxId>" }
  },
  "accessControl": {
    "private": true,
    "readers": ["<pubKey1>", "<pubKey2>"],
    "policy": "sea",
    "encrypted": true
  }
}
```

Notes:
- We keep an OIP‑like envelope under `oip` and expanded `data` keyed by template names.
- `templateRefs` ties expanded fields to canonical Arweave templates for interoperability.
- We do NOT index SEA secrets to ES; only public metadata goes to ES.

## API Changes

### Parameter naming and compatibility (MVP)

- Write path: use `storage=arweave|irys|gun` (keep legacy `blockchain` as alias). Default remains `arweave`.
- Read path: use `source=all|arweave|gun` (default `all`).
- Unified DID param: accept both `did` and legacy `didTx`; internally normalize to `did`.

### 1) Publish: `/api/records/newRecord`

- New param: `storage=arweave|gun|irys` (alias: `blockchain=arweave|irys|gun`). Default: `arweave` (unchanged).
- For `storage=gun`:
  - Accept same request body (expanded template‑keyed JSON) as today.
  - Use a new `helpers/gun.js` to write a node under a computed soul (see DID format), SEA‑encrypting `data` if `accessControl.private=true`.
  - Generate `did = did:gun:<soul>`.
  - Immediately index a normalized document to ES with `oip.storage = gun` and `oip.did` set. Avoid indexing secrets.
  - Response mirrors Arweave flow: `{ did, recordToIndex, storage: 'gun' }`.

Backward‑compatible tags/signatures:
- For GUN, there are no Arweave tags. We still compute and store a signature envelope (publisher pubkey + signature over canonical JSON) in the GUN node metadata for provenance.

### 2) Read: `/api/records`

- New param: `source=all|arweave|gun` (default: `all`).
  - `all`: query ES across both storages.
  - `arweave`: filter `oip.storage=arweave`.
  - `gun`: filter `oip.storage=gun`.
- New param: `did` (alias: `didTx`). If `did` starts with `did:gun:`, try ES first; if not present, fallback to live GUN fetch and then transform to standard response shape (optional in MVP if all GUN writes index to ES synchronously).
- Resolution: `resolveDepth` continues to work because GUN records are in ES in the same shape. If a referenced `did:gun:*` isn’t in ES (race condition), optionally fetch from GUN helper and inline it for that response.

### 3) Decrypt: `/api/records/decrypt`

- Extend to handle `did:gun:*` by verifying SEA access rights and decrypting node contents. Maintain current Lit‑based Arweave unlock flow for `did:arweave:*`.

## Indexing Strategy for GUN

Two complementary mechanisms:

1) Synchronous indexing on publish: When `/newRecord` writes to GUN, also index the normalized document immediately into ES (existing `indexRecord()` code path). Set `oip.storage='gun'`. No `inArweaveBlock`.
2) Optional watcher/sidecar: A `gun-indexer` process subscribes to `oip:records:*` paths, normalizes nodes, and upserts to ES. This keeps ES in sync with live edits (if desired), or only indexes on “publish/finalize” events.

Normalization rules:
- Copy `data` as is (expanded), with null‑stripping if `hideNullValues=true` in queries.
- Copy `oip` metadata; set `oip.did` and `oip.storage`.
- Derive fields used by filters/sorting (e.g., `data.basic.date`, tags, language, etc.).
- Never index SEA private material (keys, nonces, decrypted content).

### ES Mapping update & migration scripts (MVP)

Mapping additions:

```json
{
  "mappings": {
    "properties": {
      "oip": {
        "properties": {
          "did": { "type": "keyword" },
          "didTx": { "type": "keyword" },
          "storage": { "type": "keyword" }
        }
      }
    }
  }
}
```

Backfill script sketch:

```js
await elasticClient.updateByQuery({
  index: 'records',
  body: {
    script: {
      source: "if (ctx._source.oip != null && ctx._source.oip.did == null && ctx._source.oip.didTx != null) { ctx._source.oip.did = ctx._source.oip.didTx; }"
    }
  },
  refresh: true
});
```

## Template Semantics for GUN

- Use Arweave‑hosted templates as the single source of truth for schema. GUN nodes include `templateRefs` per block name.
- For “publish to Arweave” from a GUN draft, the existing `translateJSONtoOIPData()` uses templates to compress to OIP format and publish; the bridge writes back the new `did:arweave:<txid>` to the GUN node.
- For “GUN‑only records,” the ES normalization aligns fields to the same filter/sort/search expectations as Arweave records.

## Security & Privacy

- GUN SEA for encryption of `data` and sensitive metadata when `accessControl.private=true`.
- Provenance: add a signature envelope to GUN nodes (publisher’s pubkey + signature over canonical form), verifiable by readers.
- Access control policies can remain SEA‑only, or hybrid with Lit: store Lit conditions in metadata for cross‑ecosystem policy consistency; keep symmetric keys exclusively in SEA.
- Do not index secrets to ES. Only index what is safe for search and discovery.

## Docker & Deployment

Add a relay peer for GUN so all containers and clients can sync:

```yaml
gun-relay:
  image: node:18-alpine
  working_dir: /app
  command: sh -c "npm init -y >/dev/null 2>&1 || true && npm i gun && node server.js"
  volumes:
    - ./services/gun-relay:/app
  ports:
    - "8765:8765"
  networks:
    - oip-network
  restart: unless-stopped
  profiles:
    - standard
    - minimal
    - gpu
    - standard-gpu
```

`services/gun-relay/server.js` (minimal):

```js
const Gun = require('gun');
require('gun/sea');
require('gun/lib/path');
const http = require('http');

const port = process.env.GUN_PORT || 8765;
const server = http.createServer();
const gun = Gun({ web: server, radisk: true, file: 'data', axe: false });
server.listen(port, () => console.log('GUN relay on :' + port));
```

Configure peers in the app (env): `GUN_PEERS=http://gun-relay:8765/gun`.

## Code Changes (Implementation Outline)

### 1) DID & Utils

- `helpers/utils.js`
  - Update `isValidDid()` to accept `did:arweave:` and `did:gun:`.
  - Add `didToGunSoul(did)` and `gunSoulToDid(soul)`.
  - Keep `txidToDid()`/`didToTxid()` for Arweave.

### 2) Publisher Manager

- `helpers/publisher-manager.js`
  - Add `gun` as a provider alongside `arweave` and `irys`.
  - Implement `publishToGun(data, options)` using a new `helpers/gun.js`.

### 3) GUN Helper

- New file: `helpers/gun.js`
  - Initialize GUN client with peers from `GUN_PEERS`.
  - API (MVP):
    - `computeSoul({ publisherPubKey, localId, canon }) => string`
    - `putRecord({ recordExpanded, soul, encrypt, readers, signer }) => Promise<{ soul, did }>`
    - `getRecordBySoul(soul, opts) => Promise<ExpandedRecord | null>`
    - `signEnvelope(recordExpanded, signer) => { pubkey, sig, algo }`
  - SEA: If `encrypt=true`, encrypt only `data` payload; keep `oip` metadata public.

### 4) Publish Flow

- `helpers/templateHelper.js`
  - In `publishNewRecord()`, branch on `storage`/`blockchain`:
    - `arweave|irys`: existing flow.
    - `gun`: skip OIP compression, write expanded JSON to GUN via helper, create `recordToIndex` with `oip.storage='gun'` and `oip.did`. Call `indexRecord()`.

### 5) Records Retrieval

- `routes/records.js`
  - Accept `did` and `source` params; map `didTx` → `did`.
  - Pass `source` to `getRecords()` to filter `oip.storage`.
  - If `did` is `did:gun:` and not found in ES, optionally fetch live via `helpers/gun.js` and format.

### 6) Elasticsearch Integration

- `helpers/elasticsearch.js`
  - Add `oip.storage` to mappings.
  - Ensure `oip.did` is `keyword`.
  - Update `getRecords()` filters to handle `source`, `did` (and legacy `didTx`).
  - Optional: add a lightweight `indexGunRecord()` wrapper reusing `indexRecord()`.

### 7) Frontend & Reference Client

- `public/reference-client.html`
  - Update UI and API calls to use `did` instead of `didTx` (keep compatibility).
  - Add source filter: All / Arweave / GUN.

### 8) Alfred Integration

- `helpers/alfred.js`
  - Use `oip.did` field for citations, sources.
  - When answering about a `did:gun:` record, prefer ES; fallback to GUN helper if needed; keep same resolution depth semantics.

### 9) Minimal Test Plan (MVP)

1) Write GUN record:
   - POST `/api/records/newRecord?recordType=post&storage=gun` with expanded JSON (+ optional `accessControl.private=true`).
   - Expect 200 with `{ did: 'did:gun:...', recordToIndex.oip.storage='gun' }`.
   - Verify ES has the document with `oip.did` and `oip.storage='gun'` (no secret fields).

2) Read mixed:
   - GET `/api/records?search=test&source=all&limit=10` returns both storages.
   - GET `/api/records?source=gun&did=<did:gun:...>` returns the GUN record.

3) Resolve drefs:
   - Create a GUN record referencing another GUN DID; ensure `/api/records?resolveDepth=2` resolves via ES, or falls back to live GUN fetch if missing, then returns expanded object.

4) Backward compat:
   - GET with `didTx=` still works and maps to `did`.

5) Decrypt (if private):
   - POST `/api/records/decrypt` for `did:gun:*` with authorized reader; expect plaintext. Unauthorized reader → 403.

## Backward Compatibility Plan

- Phase 1 (dual): Write both `oip.did` and `oip.didTx`. Accept both query params. Update UI to prefer `did`.
- Phase 2 (migration): ES reindex/update‑by‑query to copy missing values and update mappings. Audit code for `didTx` occurrences and replace with `did` (+ alias reads).
- Phase 3 (cleanup): Remove `didTx` from documents and code paths after clients are updated.

## Example Requests

### Publish a private GUN record

```bash
curl -X POST \
  'https://api.oip.onl/api/records/newRecord?recordType=post&storage=gun' \
  -H 'Authorization: Bearer <JWT>' \
  -H 'Content-Type: application/json' \
  -d '{
    "basic": {"name": "Private Draft", "language": "en", "tagItems": ["draft"]},
    "post": {"bylineWriter": "Alice", "articleText": {"text": {"webUrl": "https://example.com/draft"}}},
    "accessControl": {"private": true, "readers": ["<pubKey>"]}
  }'
```

Response:

```json
{
  "did": "did:gun:oip:records:pub:abcdef...:f7c1...",
  "recordToIndex": { "oip": { "did": "did:gun:...", "storage": "gun", "recordType": "post" }, "data": { /* expanded */ } },
  "storage": "gun"
}
```

### Read records from both sources

```bash
GET /api/records?search=meditation&source=all&resolveDepth=2&limit=10
```

### Fetch by DID (GUN)

```bash
GET /api/records?did=did:gun:oip:records:pub:abcdef...:f7c1...
```

## Phased Rollout

1) Foundations
   - Add `gun-relay` service, `helpers/gun.js`, and provider in `publisher-manager`.
   - Update utils for generalized DIDs. Start writing `oip.did` alongside `oip.didTx`.
2) Write path (gun)
   - Add `storage=gun` to publish route. Synchronous ES indexing for GUN.
3) Read path (merged)
   - Add `source` param to `/api/records`. Ensure `getRecords()` filters by `oip.storage` and `oip.did`.
4) Alfred + reference client
   - Switch primary field to `oip.did`. Add source filter UI.
5) Optional live hydration
   - Implement GUN fallback fetch for unresolved `did:gun:*` and a watcher for near‑real‑time ES sync.
6) Cleanup
   - Migrate ES and code to remove `didTx`.

## Risks & Mitigations

- Query performance for GUN: Mitigated by indexing GUN records into ES like Arweave records. GUN remains for live edits/presence, not global search.
- Security of private data: SEA encryption on GUN; index only safe metadata. Keep keys off ES.
- DID rename impact: Plan phased rollout with dual‑write and alias reads.
- Reference resolution: If a `did:gun:*` is referenced but not indexed yet, add a short GUN fetch fallback, then cache via ES.

## What’s In/Out for MVP

In:
- `storage=gun` publish, ES indexing, unified `/api/records` with `source`, DID dual‑write, SEA encryption option, Docker relay.

Out (later):
- Complex hybrid Lit+SEA policy enforcement on GUN, GUN live change streams to clients via SSE/WebSocket bridges, advanced per‑field fragments via DID `#path`.

## Reference

- GUN documentation: `https://gun.eco/docs`

---

With this plan, GUN becomes the fast, local‑first “working memory” for private/ephemeral data and real‑time collaboration, while OIP on Arweave remains the permanent, signed record of truth. Elasticsearch provides a single discovery layer across both, and the API surface stays uniform for clients and Alfred.


