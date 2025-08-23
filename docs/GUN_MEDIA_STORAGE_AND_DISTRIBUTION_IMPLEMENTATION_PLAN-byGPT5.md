## GUN Media Storage and Distribution – Implementation Plan (by GPT‑5)

### Objectives

- Leverage the existing GUN integration to enable resilient, peer‑assisted distribution of media assets (video, audio, images) that are stored on the server’s filesystem.
- Use GUN for decentralized manifest indexing, peer presence, and optional small‑chunk sync; use BitTorrent/WebTorrent and HTTP as primary data planes for large payloads.
- Maintain compatibility with current OIP records and `helpers/media-manager.js` addresses (`arweaveAddress`, `ipfsAddress`, `bittorrentAddress`, `arfleetAddress`).
- Support optional end‑to‑end encryption so peers can seed encrypted bytes while only authorized clients can decrypt.

### Design Principles

- Content‑address everything: derive a stable `mediaId = sha256(fileBytes)`; build torrent `infoHash`; index both.
- Use GUN for small metadata, discovery, and real‑time presence; offload large transfers to data planes optimized for bulk.
- BitTorrent/WebTorrent is the primary transport for large media; fall back to HTTP, then IPFS, with an optional bounded GUN chunk bootstrap for critical small portions.
- Prefer append‑only, verifiable state; never overwrite manifests—publish updates as new versions keyed by content hash or semantic version.
- Keep server components stateless where feasible; store files and manifests under deterministic paths for reproducibility and seeding continuity.

---

## High‑Level Architecture

1) Media Uploader API (Node/Express)
- Accepts file uploads and URLs; writes to local disk under `/data/media/<mediaId>`.
- Computes `sha256`, size, mime; optionally encrypts, then emits a Media Manifest.

2) Persistent Seeder Service
- Uses WebTorrent in Node to seed stored files continuously.
- Publishes the `magnetURI`, `infoHash`, and tracker list.

3) GUN Manifest Index (via gun‑relay)
- Publishes a canonical `MediaManifest` under `media:<mediaId>` and maintains a `media:<mediaId>:peers` presence list.
- Optionally publishes a chunk map for fallback small‑chunk sync via GUN.

4) Client/Peer Nodes
- Discover manifests via Elasticsearch queries (OIP) and/or GUN subscriptions.
- Fetch media via torrent first; fall back to HTTP or IPFS.
- After download, register as a seeder in GUN and optionally rehost via HTTP/IPFS.

5) Optional Permanent Backends
- Existing Arweave/Irys/IPFS/ArFleet publishing continues to work; the manifest includes those addresses when enabled.

---

## Data Model

### DID and Keys
- DID for manifest: `did:gun:media:<mediaId>`
- Alternate: `did:bt:<infoHash>` when torrent is primary. Both can coexist in the manifest.

### MediaManifest (stored in GUN)

```json
{
  "id": "<mediaId_sha256>",
  "did": "did:gun:media:<mediaId>",
  "mime": "video/mp4",
  "size": 104857600,
  "createdAt": "2025-08-22T12:34:56.000Z",
  "encryption": {
    "enabled": false,
    "method": "aes-256-gcm",
    "iv": "<hex>",
    "keyEnvelope": {
      "scheme": "sea|lit",
      "for": ["<pubkey1>", "<pubkey2>"]
    }
  },
  "transport": {
    "bittorrent": {
      "magnetURI": "magnet:?xt=urn:btih:<infoHash>...",
      "infoHash": "<infoHash>",
      "trackers": ["wss://tracker.openwebtorrent.com", "wss://tracker.btorrent.xyz"],
      "pieceLength": 262144
    },
    "http": [
      "https://<host>/media/<mediaId>"
    ],
    "ipfs": {
      "cid": "<cid>",
      "gateways": ["https://ipfs.io/ipfs/<cid>"]
    },
    "arweave": { "txId": "<txId>", "url": "https://arweave.net/<txId>" }
  },
  "chunks": {
    "chunkSize": 65536,
    "count": 1600,
    "hashes": ["<sha256_chunk_0>", "<sha256_chunk_1>", "..."]
  },
  "oip": {
    "recordDid": "did:arweave:<txId>",
    "fieldPath": "post.featuredImage"
  },
  "version": 1
}
```

### Peer Presence (stored in GUN)

Key: `media:<mediaId>:peers:<pubkeyHash>` →

```json
{
  "peerId": "<nodeId>",
  "protocols": { "bittorrent": true, "http": true, "ipfs": false },
  "endpoints": { "http": "https://<host>/media/<mediaId>" },
  "lastSeen": 1724260000,
  "region": "us-west"
}
```

Notes:
- `chunks.hashes` only needed if enabling GUN small‑chunk fallback. For very large media, keep this optional.
- If `encryption.enabled = true`, the stored bytes on disk and in torrent/ipfs should be encrypted; only manifests and key envelopes are in cleartext.

---

## Server‑Side Components and Changes

### 1) Add a Media Uploader API

- Route: `POST /api/media/upload`
- Accept: multipart/form‑data file, or JSON with `source=url|base64`.
- Steps:
  1. Stream to a temp path; compute `sha256`, size, and sniff MIME.
  2. Optional encrypt (AES‑256‑GCM) using per‑asset symmetric key; store `iv`, authTag in manifest; wrap key via SEA or Lit.
  3. Move file to `/data/media/<mediaId>/original` (or `/encrypted`).
  4. Create torrent via persistent WebTorrent client; keep seeding.
  5. Optionally add to IPFS; optionally publish to Arweave/Irys/ArFleet using existing `helpers/media-manager.js` logic.
  6. Build `MediaManifest`; write to disk `/data/media/<mediaId>/manifest.json`.
  7. Publish manifest & presence to GUN under `media:<mediaId>` and `media:<mediaId>:peers:<selfId>`.
  8. Return manifest.

Implementation notes:
- Reuse `helpers/media-manager.js` for IPFS/Arweave, but add a persistent seeder.
- Keep torrent client/process alive; do not destroy after getting a magnet (unlike the current one‑shot `createTorrent`).

### 2) Persistent Seeder Service

- New module `services/mediaSeeder.js`:
  - Initializes one WebTorrent client per container.
  - Seeds any files found under `/data/media/*/original` (or `/encrypted`).
  - Writes/loads state file `/data/media/seeder.json` with `infoHash` ↔ `mediaId` mapping.
  - Emits `magnetURI` + tracker list for manifests.
- On startup, scan disk and resume seeding; publish presence in GUN for all media it seeds.

### 3) Peer Orchestration & Health

- Lightweight peer registry and health tracking:
  - Maintain an in‑memory map of peers with `url`, `capabilities`, `lastSeen`, `healthy`, and recent stats.
  - Add `/health` endpoint to expose basic metrics: files seeded, peers seen, replication queue length, uptime.
  - Background tasks: peer health checks (every 30s) and pruning peers not seen for 5+ minutes.
- Replication queue/manager:
  - Queue newly uploaded media for replication to N healthy peers (configurable, e.g., 2–3) with retry/backoff.
  - Endpoint `/replicate/:mediaId` to request a peer to pull a file from a `sourcePeerUrl`.
  - Update GUN metadata (`media:<mediaId>`) with peer lists as replicas arrive.

### 4) Extend gun‑relay for Media Manifests

Add the following HTTP endpoints to `gun-relay-server.js` (or sibling `gun-media-relay.js`):

- `POST /media/manifest` → body: `MediaManifest` (server can also produce manifests locally)
  - Writes to GUN: `gun.get('media').get(mediaId).put(manifest)` and `gun.get('media').get(mediaId).get('peers').get(self).put(peerPresence)`.
- `GET /media/manifest?id=<mediaId>` → returns manifest from GUN (or local disk cache).
- `POST /media/presence` → upsert presence heartbeat for current node.
- `POST /register-peer` → register a peer with capabilities and endpoint URLs (optionally signed).
- `POST /replicate/:mediaId` → ask this node to fetch a file from a specified `sourcePeerUrl`.

Keep the existing `/put` and `/get` for generic graph ops. Media API is a thin convenience layer and can live in the same server.

### 5) Direct HTTP File Serving

- Route: `GET /media/:mediaId`
  - Streams the stored file (`encrypted` bytes if manifest is encrypted), supports HTTP range requests for video.
  - If public, serve directly; if encrypted, serve encrypted bytes; clients decrypt locally.

### 6) Optional: GUN Chunk Fallback

- For small/critical assets, implement chunk upload/download over GUN:
  - `media:<mediaId>:chunks:<index>` → hex/base64 chunk string.
  - Upload on demand or selectively (e.g., first 1–2 MB) to bootstrap playback while torrent connects.
- Clients can reconstruct by verifying `chunks.hashes[i]` and concatenating.
- This is optional and bounded to avoid bloat; prefer torrent/HTTP for full transfer.

### 7) Elasticsearch Indexing

- When a manifest is created, index a lightweight document for discovery:
  - `oip.did` = `did:gun:media:<mediaId>`
  - `oip.storage` = `gun`
  - `data.basic.name` if supplied by the uploader
  - `media.mime`, `media.size`, `media.transport.bittorrent.infoHash`
- This allows queries like `storage=gun&recordType=media` and searching by name/type.

---

## Client / Peer Behavior

1) Discover a manifest
- Via API/ES search or subscribe to `gun.get('media').map()` for new items, or query specific `did:gun:media:<mediaId>`.

2) Pick transport
- Try torrent first using `magnetURI`; fall back to HTTP; optionally try IPFS.
- If manifest is encrypted, download encrypted bytes and decrypt locally using the key envelope.

3) Verify and register
- Verify `sha256` of the plaintext (or ciphertext if seeding encrypted) matches `mediaId` or a declared `cipherHash`.
- Register presence in `media:<mediaId>:peers:<self>` with supported protocols and an HTTP endpoint if exposed.

4) Seed
- Continue seeding via WebTorrent; optionally rehost via a local HTTP server and/or add to local IPFS node.

---

## Security and Privacy

- Encrypt media before distribution for private assets:
  - Symmetric AEAD (AES‑256‑GCM) per asset, random IV per file.
  - Store only encrypted bytes on disk and in torrents/IPFS.
  - Key envelope strategies:
    - SEA: encrypt symmetric key to allowed public keys.
    - Lit Protocol: managed access control with on‑demand key unwrap.
- Peers seed encrypted bytes; authorization is enforced at the decryption layer in clients.
- Manifest integrity: sign manifests with the publisher key; include `creatorPubKey` and `creatorSig` in `manifest.oip`.

---

## Integration with Existing Codebase

- `helpers/media-manager.js`
  - Keep existing `publishToNetworks` and address formatting.
  - Replace the one‑shot `createTorrent` with hooks into the persistent seeder: `services/mediaSeeder.seed(buffer|filePath)` that returns `magnetURI/infoHash` and continues seeding.

- `gun-relay-server.js`
  - Add media endpoints (`/media/manifest`, `/media/presence`, `/media/manifest?id=...`).
  - Persist manifests under `media:<mediaId>` and presence under `media:<mediaId>:peers`.

- `routes/records.js`
  - No breaking changes. When media is uploaded as part of a record, attach the returned `bittorrentAddress` and `did:gun:media:<mediaId>` into the record’s `media` field (already supported by address mapping).

---

## API Sketches

### Upload

Request:

```
POST /api/media/upload
Content-Type: multipart/form-data

fields:
- file: <binary>
- encrypt: true|false
- publishTo[ipfs]=true
- publishTo[arweave]=false
- name: Optional human name
```

Response:

```json
{
  "mediaId": "<sha256>",
  "did": "did:gun:media:<sha256>",
  "magnetURI": "magnet:?xt=urn:btih:<infoHash>...",
  "transport": { "http": ["https://.../media/<sha256>"] },
  "encrypted": false
}
```

### Get Manifest

```
GET /media/manifest?id=<mediaId>
```

### Presence Heartbeat

```json
POST /media/presence
{ "mediaId": "<sha256>", "protocols": { "bittorrent": true, "http": true } }
```

### Peer Registration

Request:

```
POST /register-peer
Content-Type: application/json

{
  "peerUrl": "https://peer-1.example.com:8765",
  "capabilities": { "bittorrent": true, "http": true, "ipfs": false },
  "signature": "<optional_sig_over_payload>"
}
```

Response:

```json
{ "success": true, "totalPeers": 5 }
```

### Replication Request

```
POST /replicate/:mediaId
Content-Type: application/json

{ "sourcePeerUrl": "https://peer-1.example.com:8765" }
```

Response:

```json
{ "success": true, "message": "File replicated successfully" }
```

### Health

```
GET /health
```

Response:

```json
{
  "status": "healthy",
  "timestamp": 1724260000,
  "mediaFiles": 42,
  "peers": 7,
  "replicationQueue": 1,
  "uptimeSec": 86400
}
```

---

## Docker and Ops

- Volumes:
  - Mount `/data/media` for persistent storage across restarts.
- Ports:
  - WebTorrent in Node uses TCP/UDP and DHT; prefer tracker‑only mode to avoid port juggling. Configure public WSS trackers.
- Env:
  - `MEDIA_DIR=/usr/src/app/data/media`
  - `WEBTORRENT_TRACKERS=wss://tracker.openwebtorrent.com,wss://tracker.btorrent.xyz`
  - `GUN_PEERS=http://gun-relay:8765`
  - `GUN_ENABLE_ENCRYPTION=true|false`
  - `REPLICATION_FACTOR=3`

Monitoring/KPIs (initial):
- Expose `/health` counters; later add Prometheus metrics endpoint (e.g., `/metrics`) for scrape.
- KPIs to watch: median download time (10–100MB), replication time to N peers, active seeders per media, error rates.

---

## Rollout Plan (Phased)

Phase 1 – Foundations
- Implement `services/mediaSeeder.js` (persistent seeding from disk). 
- Add `/api/media/upload` and `/media/:mediaId` routes in the main API.
- Compute and return `magnetURI/infoHash`; keep seeding.

Phase 2 – GUN Manifests & Presence
- Extend `gun-relay` with `/media/manifest`, `/media/manifest?id=...`, `/media/presence`.
- Publish manifests on upload; add heartbeat job to maintain presence.

Phase 3 – Encryption & Key Envelopes
- Add optional AES‑GCM file encryption pipeline.
- SEA recipient wrapping; optional Lit integration for policy‑based access.

Phase 4 – Optional GUN Chunk Fallback
- Implement bounded chunk map + first‑N‑MB chunk publish in GUN for quick bootstrap.
- Clients stitch/verify while torrent completes.

Phase 5 – Frontend/Client Enhancements
- Reference client: show manifest, transport availability, seeder counts.
- Provide download + decrypt flow; rehost toggle to start seeding in client environments that support WebTorrent.

Phase 6 – Peer Orchestration & Replication
- Implement `/register-peer`, health checks, and replication queue to proactively reach target replication factor.
- Add basic rate limiting and signed peer registration.

Phase 7 – Monitoring & Ops Hardening
- Add Prometheus `/metrics`, dashboards for seeders/replication time/download speeds.
- Define on‑call runbook for replication failures and peer churn.

MVP/Hybrid path:
- Start with HTTP serving and simple peer replication for immediate value; enable persistent WebTorrent seeding as primary transport as soon as seeder is stable; keep HTTP/IPFS as fallbacks.

---

## Testing Strategy

- Unit: hashing, manifest generation, encryption/decryption, torrent creation.
- Integration: two containers – upload in A → B discovers via GUN → B downloads via torrent/HTTP → B registers presence → A sees peer count increase.
- E2E: publish OIP record that references `bittorrentAddress` and `did:gun:media:<mediaId>`; validate ES search and hydration.
 - Ops tests: simulate peer loss; verify replication queue backfills to target replication factor.

Sample automated tests:
- `test/test-media-distribution.js`:
  - Upload medium video (50–100MB), ensure `magnetURI` returned and client remains seeding.
  - Spin a second node, subscribe to GUN manifest, download via torrent, verify `sha256` and playback.
  - If encrypted, verify end‑to‑end decryption and that peers seed ciphertext only.

---

## Risks and Mitigations

- Large data in GUN: avoid storing full media; store only manifests and optional tiny chunk bootstrap.
- NAT/DHT issues: rely on public WSS trackers; provide HTTP fallback.
- Storage growth: GC policy on old/unseeded media; optional Arweave/Irys archiving for long‑term.
- Privacy: default encrypted distribution for private assets; never publish plaintext keys in GUN.
- Peer abuse: require signed peer registration; rate‑limit replication and download endpoints; maintain allowlist for privileged replication.

---

## Minimal Code Changes (Pointers)

- New: `services/mediaSeeder.js` (persistent torrent seeding)
- Update: `helpers/media-manager.js` → use persistent seeder instead of one‑shot `createTorrent`
- Update: `gun-relay-server.js` → add `/media/manifest`, `/media/presence`, `/media/manifest?id=...`
- Update: `gun-relay-server.js` → add `/register-peer`, `/replicate/:mediaId`, and `/health` metrics.
- New: `routes/media.js` → `POST /api/media/upload`, `GET /media/:mediaId`
- Config: `.env` → `MEDIA_DIR`, `WEBTORRENT_TRACKERS`, `GUN_*`

---

## Security Hardening (additional)

- Signed manifests and peer registrations using the creator/publisher key; store `creatorPubKey` and `creatorSig` in manifest.
- Rate limiting on upload/download/replicate; basic auth on admin‑level endpoints if exposed.
- Key rotation guidance for encrypted assets; rotate per‑asset keys on policy changes; maintain revocation list.

## Frontend UX Notes

- Display transport availability (torrent/http/ipfs) and seeder counts on media details.
- Badge for encrypted/private media; prompt for decryption when needed.
- “Seed this media” toggle in reference client environments that support WebTorrent.

## Future Enhancements

- Global content deduplication across peers and nodes; disk quota policies and eviction.
- Hybrid CDN + P2P distribution; cache warmers for hot content.
- Analytics: download time distributions, regional seeder density, popularity heatmaps.
- Room/collection‑based pinning policies in GUN for collaborative content sets.

This plan delivers resilient, decentralized distribution with familiar operational tools, minimal surface‑area changes to the OIP record flow, and a clean path to private, end‑to‑end encrypted media.


