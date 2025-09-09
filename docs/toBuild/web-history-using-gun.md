## Safari web history → private posts using GUN — implementation plan

### Objective
Ingest visited pages from Safari History on macOS and publish each as a private `post` record via `/api/records/newRecord?recordType=post&storage=gun`, matching the article/tweet formatting patterns used in `routes/scrape.js`. We will not store only URLs; we will resolve each URL to article content (title, byline, publish date, summary, media) and publish a complete private record.

### Constraints and considerations
- Safari history DB (`~/Library/Safari/History.db`) is accessible locally; schema includes `history_items` and `history_visits` with `url`, `title`, `visit_time`. Newer macOS versions still allow read-only access.
- Articles should follow the same field layout used in `scrape.js → publishArticleAndAttachedMedia()` for `post` records:
  - `basic`: `name`, `language`, `date`, `description`, `tagItems`
  - `post`: `bylineWriter`, `articleText.text.webUrl|contentType`, `webUrl`, optional `featuredImage.image` and `audioItems`
- Private storage via GUN with deterministic `localId` to avoid duplicates when reprocessing the same history URL.
- Respect rate limits and robots; provide config to bound throughput and time window.

---

### End-to-end flow
1) Enumerate Safari history
- Read `~/Library/Safari/History.db` via `sqlite3` from the mac-client. Query either:
  - Recent window (e.g., last N days) or
  - Since last processed timestamp stored locally.
- Extract fields: `url`, `title` (if present), `visit_time` (convert WebKit epoch to ms), `visit_count` (optional).

2) Normalize and deduplicate candidates
- Clean URL to canonical form (strip query params where appropriate using `cleanUrl`-like logic from `scrape.js`).
- Maintain a local cache DB (SQLite) with `url`, `first_seen_at`, `last_seen_at`, `times_seen`, `status`, `last_published_at`, `localId`.
- Skip URLs that have already been successfully published and unchanged.

3) Content resolution (article extraction)
- Use a resolver similar to `scrape.js`:
  - First check existing index with `GET /api/records?url=<cleanUrl>&limit=1&sortBy=inArweaveBlock:desc` to avoid duplicate archives when the backend already has it (even if not from history).
  - If not found, fetch and parse the page content:
    - Primary: `@postlight/parser` (as used) or FireCrawl when enabled.
    - Secondary enrich: Cheerio selectors for title/byline/date when missing.
    - Summarize content and tags using existing `generators.generateSummaryFromContent` if available from backend endpoints, or run locally if exposed.
  - Optional: full-page screenshot via Puppeteer (mac-client) if you want parity with `scrape.js` visual archive, stored locally and referenced via `featuredImage` if hosted by backend.

4) Build `post` record payload
- Mirror `scrape.js` structure to maximize compatibility:
  - `basic`:
    - `name`: parsed title
    - `language`: `en` (or detect)
    - `date`: publish date if available; else first visit time; else now (Unix seconds)
    - `description`: summary text
    - `tagItems`: generated/computed tags
  - `post`:
    - `bylineWriter`: parsed byline if present
    - `articleText.text`: write fetched plain text to a backend-hosted text file; set `webUrl` to that URL and `contentType` to `text/text`
    - `webUrl`: canonical page URL (cleaned)
    - `featuredImage.image`: OpenGraph/lead image if available and downloaded/hosted
    - `audioItems`: optional summary TTS if generated (hosted URL)
- Add `accessControl: { private: true }` to publish as encrypted GUN record.

5) Deterministic identity (localId)
- Use `localId = history:<cleanHost>:<sha1(cleanUrl)>` so the same URL maps to the same GUN soul.
- Alternative: include firstSeen date bucket if you want multiple snapshots per site; default is 1:1 URL→record.

6) Publish to backend as private GUN record
- `POST {BACKEND_URL}/api/records/newRecord?recordType=post&storage=gun&localId=<localId>`
- Body: the `basic` + `post` + `accessControl` payload from step 4.
- On success, store returned `did`/`soul`/`encrypted` and mark local cache row as `published` with timestamp.

7) Batching and rate limiting
- Process in small batches (e.g., 10–25 URLs per run) with a delay between fetches to be polite.
- Configurable concurrency and per-domain throttling (simple token bucket per host).

8) Errors and retries
- Mark failures with error message and next retry time; exponential backoff.
- Detect soft-blocked pages (paywalls/login) and skip or flag for manual review.

9) mac-client implementation details
- New module: `mac-client/history_manager.js`
  - Read Safari history DB (using `child_process.execFile('sqlite3', [...])` for portability or `better-sqlite3`).
  - Normalize, dedupe, and consult the local cache DB `history_sync.sqlite`.
  - For each candidate: resolve content, generate assets (text file; optional screenshot, thumb), then publish.
  - Store outcomes and timestamps.
- New routes in `enhanced_voice_interface_server.js`:
  - `GET /api/history/preview?days=...&limit=...` — return candidate URLs + parsed metadata (no publish).
  - `POST /api/history/sync` — run a batch sync with config (days back, max items, domain allowlist/denylist).
  - Optional: `POST /api/history/resume` — resume failed items.

10) Backend interactions reused
- Article pipeline mirrors `scrape.js` layout for records; leverages `/api/records/newRecord` with `storage=gun`.
- Reuse backend media hosting endpoints if present to host text file, images, and audio; otherwise mac-client can serve them locally with stable URLs.

11) Configuration
- `HISTORY_LOOKBACK_DAYS` (default 7)
- `HISTORY_MAX_PER_RUN` (default 50)
- `HISTORY_RESOLVE_TIMEOUT_MS` (default 15000)
- `HISTORY_THROTTLE_PER_HOST_MS` (default 800)
- Domain filters: `HISTORY_INCLUDE_HOSTS`, `HISTORY_EXCLUDE_HOSTS`
- Privacy defaults: `private=true` (GUN)

12) Testing
- Unit: URL canonicalization; WebKit epoch → ms conversion; dedupe logic; localId stability.
- Integration: end-to-end on a small set of known pages; validate queries:
  - `GET /api/records?source=gun&recordType=post&search=keyword`
  - `GET /api/records?source=gun&recordType=post&url=<pageUrl>`
- Verify private encryption fields in response from publish endpoint.

13) Future enhancements
- Topic classification to auto-tag (reuse existing generators).
- Screenshot + OCR fallback for paywalled pages (stored privately).
- Detect and skip non-article pages (query params, short content, mime-type checks).

---

### Pseudocode sketch (mac-client)
```
// history_manager.js
const db = openSqlite('~/Library/Safari/History.db');
const cache = openSqlite('./history_sync.sqlite');
const urls = queryRecentHistory(db, lookbackDays)
  .filter(notInCacheOrDueRetry)
  .filter(domainAllowlist/denylist)
  .slice(0, maxPerRun);

for (const url of urls) {
  const clean = canonicalize(url);
  const exists = await backendGet(`/api/records?url=${encodeURIComponent(clean)}&limit=1`);
  if (exists.searchResults > 0) { markPublishedInCache(url, exists.records[0].oip.didTx); continue; }

  const article = await resolveArticle(clean); // parser + cheerio enrich + summary + tags
  const assets = await hostAssets(article); // text file, optional image/audio
  const record = buildPostRecord(article, assets, { private: true });
  const localId = `history:${host(clean)}:${sha1(clean)}`;
  const res = await backendPost('/api/records/newRecord?recordType=post&storage=gun&localId='+localId, record, auth);
  markPublishedInCache(url, res.did, res.soul);
}
```

This plan creates a reliable, privacy-preserving pipeline to transform Safari history into full private `post` records stored in GUN, aligned with the existing `scrape.js` post format and leveraging the current publishing/indexing stack.


