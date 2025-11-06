# PRD Chapter: Name Resolution Integration (ENS + GNS)

## Summary

Provide dual naming: **ENS** for broad reach and human-readable names; **GNS** for private lookups. Publish identical service metadata in both systems. Ship a resolver helper that defaults to ENS and switches to GNS when the user enables **Private Lookup Mode**. Keep ICANN DNS as a simple fallback URL.

## Goals

* Human-friendly names that resolve in mainstream environments (ENS path).
* Query privacy for users who need it (GNS path).
* One-click UX to choose Fast vs Private lookup.
* Single source of truth for service endpoints across both systems.
* No central dependency for naming continuity.

## Non-Goals

* No attempt to make browsers natively resolve GNS.
* No global governance of third-party namespaces.
* No host anonymity by naming alone; pair with Tor where needed.

## Users and Stories

* **Reader (fast):** “I enter a name and it resolves in a normal browser.”
* **Reader (private):** “I enable Private Lookup Mode and my queries are not exposed.”
* **Operator:** “I publish once and the system updates ENS and GNS consistently.”
* **Developer:** “I can resolve names via a small CLI/SDK without wallet code.”

## Scope

### Records to publish

* **Core endpoint:** service base URL(s), onion hints, and content-addressed pointers.
* **ENS**

  * `contenthash` → IPFS/IPNS pointer to the index entry.
  * `TXT` → JSON with `https`, `onion`, `ipfs`, `api`, version.
  * Optional `SRV` for non-HTTP services.
* **GNS**

  * Equivalent zone with records for `https`, `onion`, `ipfs`, `api`.
  * Signed zone data; short TTLs for rotation.

### Resolver Helper (client-side)

* **Modes:** `fast` (ENS-first) and `private` (GNS-only; falls back to ENS if allowed).
* **Outputs:** canonical service descriptor JSON for the app or browser extension.
* **Packaging:** CLI + lightweight local service; optional browser extension for redirect.

### Operator Tools

* Name publisher utility:

  * Takes a canonical service descriptor file.
  * Updates ENS (via configured wallet) and GNS (via GNUnet).
  * Verifies propagation and writes an audit log.

## Architecture

```
Canonical Descriptor (YAML/JSON)
        │
        ├──► ENS Publisher ──► ENS: contenthash + TXT/SRV
        │
        └──► GNS Publisher ──► GNS: zone records
Client:
Resolver Helper (fast|private) ──► returns service descriptor
Browser/App consumes descriptor to connect (HTTPS/IPFS/onion)
```

### Components

* **Descriptor format** (example)

```json
{
  "version": 1,
  "https": ["https://lo.example.org", "https://lo.limo.name/xyz"],
  "onion": ["http://abcd1234.onion"],
  "ipfs": ["ipfs://bafy..."],
  "api": ["https://api.lo.example.org/v1"],
  "updated": "2025-11-06T00:00:00Z"
}
```

* **ENS Publisher**

  * Writes `contenthash` for IPFS/IPNS.
  * Writes `TXT` with the descriptor (compact JSON).
* **GNS Publisher**

  * Stores the descriptor across records in the zone.
  * Signs and publishes via GNUnet.

## Security and Privacy

* **Requester privacy:** only in **GNS** path. Helper warns when in `fast` mode.
* **Host anonymity:** not provided by naming. Pair with Tor onion for origin privacy.
* **Key handling:**

  * ENS: hardware wallet or custodial signer support; no private keys on server by default.
  * GNS: zone keys stored in an encrypted keystore; offline backup procedure.
* **Integrity:**

  * Descriptor signed (detached JWS) and embedded identically in ENS TXT and GNS records.
  * Clients verify JWS before use.
* **Logging:** Publisher logs exclude seed phrases, include tx/operation IDs only.

## Functional Requirements

### FR-1 Canonical Descriptor

* Tool validates schema, emits minified JSON ≤ 1.5 KB for ENS `TXT`.

### FR-2 ENS Publish

* Update `contenthash` to match `ipfs`.
* Upsert `TXT` with the signed descriptor.
* Return ENS tx hash and verify read-back.

### FR-3 GNS Publish

* Upsert name records with the same descriptor fields.
* Sign and propagate; verify read-back via GNUnet resolver.

### FR-4 Resolver Helper

* `resolve <name>`:

  * **fast:** ENS → gateway (`.limo` or direct) → return verified descriptor.
  * **private:** GNS first; if `--allow-fallback`, try ENS next; else fail closed.
* Verifies JWS signature with pinned public key.
* Exposes local HTTP on `127.0.0.1:4777` for browser extension use.

### FR-5 Browser Extension (optional)

* Intercepts configured names and fetches from the local helper.
* Shows mode badge: FAST or PRIVATE.

### FR-6 Rotation

* Operator rotates endpoints; publisher updates both systems atomically.
* Helper honors `updated` and a `ttl` hint for cache invalidation.

## Non-Functional Requirements

* **Performance:** helper resolve P95 ≤ 300 ms (ENS path), ≤ 800 ms (GNS path, local stack).
* **Reliability:** publish tools retry transient failures; consistent-after-write checks.
* **Compatibility:** ENS on Ethereum mainnet; GNS via GNUnet ≥ current LTS.

## Configuration

### Operator

* `ens_name`, `ens_signer` (RPC endpoint or hardware wallet).
* `gns_zone`, `gns_key_path`, `gnunet_home`.
* `icann_fallback_url` for documentation and mainstream users.

### Client

* Default mode: `fast`.
* `private` toggled via CLI flag or UI switch.
* `allow_fallback` boolean when in private mode.

## APIs

### Local Helper

* `GET /v1/resolve?name=<n>&mode=fast|private`

  * `200` → descriptor JSON + `source: ens|gns`
  * `409` → signature mismatch
  * `404` → not found in chosen mode

## Acceptance Criteria

* Single descriptor publishes to ENS and GNS; read-back matches byte-for-byte payload.
* Helper resolves an ENS-only name in fast mode and a GNS-only name in private mode.
* JWS verification fails on tampered records.
* Switching modes changes the resolution source without app restart.

## Testing Plan

* **Unit:** descriptor schema, JWS sign/verify, ENS TXT packing/unpacking, GNS record mapping.
* **Integration:** live publish to test namespaces; resolve via helper; browser extension redirect.
* **Failure modes:** ENS down, GNS daemon down, signature mismatch, stale caches.
* **Perf:** cold and warm resolve timings per mode.

## Rollout

* Phase 1: ENS-only path + helper in fast mode.
* Phase 2: GNS publishing and private mode with bundled GNUnet installer.
* Phase 3: Browser extension, UI polish, rotation tooling.

## Risks and Mitigations

* **Fragmented UX:** Provide a clear “Fast vs Private” toggle and an ICANN fallback URL.
* **Record size limits (ENS):** keep TXT under size caps; offload large data to IPFS/IPNS.
* **Key loss:** hardware wallet support for ENS; encrypted backups for GNS keys.
* **Stale gateways:** helper verifies JWS to detect stale or hijacked records.

## Metrics and Success

* ≥ 95% successful resolves in fast mode; ≥ 90% in private mode with GNUnet installed.
* Median fast resolve ≤ 300 ms; private resolve ≤ 800 ms.
* < 1% signature mismatches after propagation.
* ≥ 80% of users keep default fast mode; ≥ 10% use private mode at least once per month.
