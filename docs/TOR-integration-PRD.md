# PRD Chapter: Tor/Onion Routing Integration for OIP

## Summary

Expose a publisher-only gateway as a Tor v3 onion service. Keep all existing consumer and distribution services on clearnet as-is. The gateway accepts publish requests and forwards them to local backend APIs over loopback or UNIX socket. Goal: publisher network anonymity.

## Goals

* Hide publisher IP and network path from OIP infrastructure.
* Hide OIP server IP and hosting from publishers.
* Preserve existing clearnet performance for media distribution and discovery.
* Keep blast radius small: isolate Tor to a single ingress service.

## Non-Goals

* No Tor for Arweave, IPFS, BitTorrent, Elasticsearch, or GUN gossip.
* No attempt to anonymize large media distribution over Tor.
* No change to consumer access paths.

## Users and Stories

* **Anonymous publisher:** “As a publisher I can submit a record to OIP without revealing my IP, using a `.onion` address.”
* **Operator:** “As an operator I can run the gateway with minimal ops overhead and without exposing new public clearnet ports.”
* **Reviewer:** “As a reviewer I can query submission status over the same `.onion` endpoint.”

## Scope

### Services over Tor (new)

* **Publisher Gateway (onion service)**

  * `POST /publish` — submit signed publish payload.
  * `GET /status/:id` — retrieve processing status.
  * `GET /health` — liveness for automated checks.
  * `GET /version` — build and config surface.
  * Optional: `POST /auth/exchange` — exchange a signed proof for a short-lived token.
  * Optional: `GET /queue/limits` — per-token rate and size limits.

### Services that remain clearnet

* **Backend API** (existing) — bound to loopback only; not exposed publicly.
* **Arweave/IPFS/Bittorrent publishing** — unchanged, clearnet only.
* **Elasticsearch** — unchanged, clearnet or private network only.
* **GUN relay** — unchanged, clearnet peers only.
* **End-user read paths (web, APIs, media)** — unchanged.

## Architecture

### High-level

Tor v3 onion service → **Publisher Gateway** (localhost listener) → **Backend API** (UNIX socket or 127.0.0.1) → existing pipelines.

### Components

* **Tor daemon**

  * v3 hidden service with persistent keys.
  * `HiddenServicePort 80 127.0.0.1:<gateway_port>`.
  * Optional client authorization if the onion address should be private.
* **Publisher Gateway**

  * Fastify/Express service.
  * Validates auth, schema, and sizes.
  * Adds idempotency keys and a submission ID.
  * Forwards normalized request to backend via UNIX socket or loopback.
  * Never opens clearnet ports.
* **Backend**

  * Existing publish endpoints.
  * Listens only on loopback or UNIX socket.
  * Processes queue, writes to Arweave/IPFS/ES as today.

## Security and Privacy Requirements

* **Network**

  * Gateway egress restricted to loopback by firewall or container policy.
  * Backend not reachable from WAN.
* **Headers**

  * Strip and ignore `X-Forwarded-*`, `Forwarded`.
  * Overwrite `Via` with internal value.
* **Auth**

  * Header-based token or detached signature (ed25519/secp256k1).
  * Tokens are pseudonymous; no email or phone in onion flow.
* **CORS/CSRF**

  * CORS allowlist includes only the configured `.onion` Origin.
  * Header auth only. No cookies.
* **Logging**

  * No IPs or UAs stored on onion routes.
  * Structured logs with submission ID, token hash, and event codes.
  * Disable reverse DNS and GeoIP.
* **Timing**

  * Queue and batch clearnet side-effects with randomized delays (configurable) to reduce timing correlation.
* **Limits**

  * Max body size (default 5–25 MB, configurable).
  * Per-token rate limits and concurrency caps.
* **Key management**

  * Secure storage for `hs_ed25519_secret_key`.
  * Document rotation and backup procedures.

## Functional Requirements

### FR-1 Onion Service Availability

* The `.onion` hostname is stable and reachable with Tor Browser and `torsocks`.
* Health endpoint returns `200 OK` within SLA when Tor circuit is healthy.

### FR-2 Publish Submission

* `POST /publish` accepts JSON payload:

  * `record` (object or base64 blob)
  * `signature` and `pubkey` or `Authorization: Bearer <token>`
  * `idempotency-key` header optional
* Returns `202 Accepted` with `{submissionId, estimatedStart}`.

### FR-3 Status Retrieval

* `GET /status/:id` returns one of:

  * `queued`, `processing`, `succeeded` (with OIP TXIDs/URIs), `failed` (with error code).

### FR-4 Validation

* Schema, signature, and size validation occurs at the gateway.
* Rejected submissions return `4xx` with machine-readable error codes.

### FR-5 Forwarding

* Gateway forwards to backend at `/api/publish` over UNIX socket or `127.0.0.1`.
* Retries with exponential backoff on transient local errors only.

### FR-6 Idempotency

* Same `idempotency-key` and token return the same `submissionId` for 24 hours.

## Non-Functional Requirements

### Performance

* P95 response for `/publish` ≤ 800 ms excluding downstream processing.
* Support short bursts of 50 rps for 60 seconds without error > 1%.

### Reliability

* Target 99.5% availability for the onion gateway.
* Graceful degradation when Tor circuits churn; return clear `503` with `Retry-After`.

### Observability

* Metrics: accepted/rejected submissions, queue length, processing latency, Tor circuit errors, rate-limit hits.
* Traces excluded from payload content; IDs only.

## Configuration

### torrc

```
HiddenServiceDir /var/lib/tor/oip_publish_hs
HiddenServiceVersion 3
HiddenServicePort 80 127.0.0.1:8080
# Optional client auth:
# HiddenServiceAuthorizeClient stealth client1,client2
```

### Gateway env

* `GATEWAY_PORT=8080`
* `BACKEND_SOCKET=/run/oip/backend.sock` or `BACKEND_HOST=127.0.0.1:9090`
* `MAX_BODY_MB=25`
* `ALLOWED_ORIGIN_ONION=<host>.onion`
* `RATE_LIMIT_RPS=5`
* `BATCH_FLUSH_MIN_MS=60000`
* `BATCH_FLUSH_JITTER_MS=30000`

## APIs

### `POST /publish`

* Headers:

  * `Content-Type: application/json`
  * `Authorization: Bearer <token>` or `X-Public-Key`, `X-Signature`
  * `Idempotency-Key` optional
* Body: `{ record: {...} | "<base64>", meta?: {...} }`
* Responses:

  * `202` `{ submissionId, status: "queued" }`
  * `400/401/413/429` with `code`, `message`.

### `GET /status/:submissionId`

* `200` `{ status, outputs?, error? }`
* `404` if unknown after retention window.

### `GET /health`, `GET /version`

* Plain text or minimal JSON.

## Acceptance Criteria

* Onion hostname published and tested from Tor Browser and CLI.
* Gateway never listens on non-loopback addresses.
* Successful E2E: submit over onion → backend processes → outputs visible on clearnet endpoints.
* Logs contain no IP/UAs from onion requests.
* CORS blocks non-onion origins.
* Rate limits and size limits enforced and observable.

## Testing Plan

* **Unit:** schema, auth, idempotency.
* **Integration:** Tor-to-gateway path with `torsocks curl`.
* **Load:** 50 rps for 60 s, P95 under target, zero memory leaks.
* **Chaos:** restart Tor mid-traffic; verify graceful failures and recovery.
* **Security:** header spoofing tests, CSRF checks, log redaction verification.
* **E2E timing:** verify batching reduces one-to-one timing between onion submission and clearnet publish.

## Rollout

* Stage in a private onion with client auth.
* Shadow traffic from a canary publisher.
* Promote to public onion. Publish docs. Keep clearnet paths unchanged.
* Monitor for 1–2 weeks. Enable batching once stable.

## Risks and Mitigations

* **Timing correlation:** Batch and randomize clearnet side-effects.
* **DoS over onion:** Token-based rate limits and small default body caps.
* **Key loss:** Automated encrypted backups of `HiddenServiceDir`.
* **Misconfig exposure:** CI check asserts no non-loopback listeners; port scan in deploy step.

## Metrics and Success Criteria

* ≥ 95% of onion submissions succeed end-to-end.
* Zero IP addresses from onion requests present in logs.
* Median additional latency over onion ≤ 400 ms vs clearnet gateway baseline.
* No increase in backend failure rate attributable to Tor churn.

## Documentation Deliverables

* Operator runbook: setup, rotate, restore onion keys.
* Publisher guide: `.onion` URL, auth method, payload schema, limits.
* Security note: what Tor protects, what it does not, and client hygiene guidance.

