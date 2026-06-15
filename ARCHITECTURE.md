# remi-ingestor Architecture

## Provider decision: Twilio

### Why Twilio

- Largest market share; best TypeScript SDK and documentation.
- Programmable Messaging supports Group MMS natively via multi-recipient sends
  and Conversations API.
- Inbound webhooks POST to your endpoint with all message metadata synchronously.
- Mature reliability SLAs (99.95% uptime).
- Webhook signature validation via X-Twilio-Signature HMAC-SHA1 (implemented
  in production; mocked here).

### How Twilio handles Group SMS/MMS

- Group MMS is handled as a single message sent to multiple To numbers.
- Each recipient's reply comes back as a separate inbound webhook from their number.
- For true group conversation threading, Twilio Conversations API is preferred:
  it models a Conversation (persistent thread), Participants, and Messages.
- In this implementation we reconstruct the groupId by canonicalizing the
  participant list (sorted, deduplicated, joined with a unit separator) and
  hashing with SHA-256 (`grp_<hex>`). Participant phone numbers are still
  stored separately on each message for AI context.

### Participant phone number availability

- For inbound MMS, Twilio sends From (sender) and To (receiving Twilio number).
- Full participant list is NOT in the standard webhook — it must be:
  (a) injected by a Twilio Studio Flow or Conversations webhook that hydrates it, or
  (b) maintained server-side in a group registry.
- In this implementation we use a synthetic Participants field in the payload
  (populated by our mock sender) to simulate what a Twilio Conversations webhook
  provides natively.
- Production approach: use Twilio Conversations API webhook which includes all
  participant identities in the event payload.

### Media attachments

- Twilio exposes media as authenticated URLs: MediaUrl0, MediaUrl1, …
- URLs are only valid for 48 hours (configurable via Media Retention settings).
- Production: download immediately (as this service does) and re-host on S3/GCS
  with indefinite retention. Set up a Twilio MediaRetention policy to auto-delete.
- Content type is provided in MediaContentType{n}.

### Known limitations / risks

- Standard Group SMS has no persistent thread ID — our derived groupId strategy
  is fragile if participants are added/removed.
- Twilio does not guarantee delivery order for high-throughput groups.
- Webhook retries: Twilio retries on 5xx for up to 24 hours — idempotency is
  critical (implemented via providerMessageId deduplication).
- Media URL expiry: 48h window means background download must be fast.

### Why not the alternatives

- **Bandwidth**: No hosted Group MMS threading; requires BYOC (Bring Your Own Carrier).
  Good for carrier-grade routing but adds infrastructure complexity.
- **Telnyx**: Excellent API but smaller ecosystem; fewer pre-built integrations;
  group MMS support is less documented.
- **Plivo**: Strong voice but messaging is an afterthought; limited Conversations
  equivalent.
- **Sinch**: Good for international SMS but Group MMS support is fragmented across
  product lines.

## Service design

### Request path

1. **Webhook** (`POST /webhook/messages`) accepts JSON or form-encoded Twilio payloads.
2. **Dedup** uses a two-phase model: `pendingIds` (accepted, not yet persisted) and
   SQLite `messages` (successfully processed). Duplicates are rejected if either applies.
3. **Sequence reservation** calls `nextSequenceForGroup` synchronously before enqueue.
   An in-memory per-group counter (seeded from SQLite on first use) prevents race
   conditions when multiple webhooks arrive before async DB writes complete.
4. **Normalizer** builds a `RemiMessage` with deterministic `groupId` from a
   SHA-256 hash of the canonicalized participant list.
5. **Queue** returns `202 Accepted` immediately; media download and DB writes happen asynchronously.

### Queue semantics

- **FIFO per groupId**: messages within the same conversation process in order.
  Retries are re-queued at the front of their group to preserve ordering.
- **Global concurrency**: up to `WORKER_CONCURRENCY` jobs run in parallel across groups.
- **Retries**: failed jobs re-enqueue with exponential backoff:
  `WORKER_RETRY_DELAY_MS * 2^(attempt-1)`, capped at `WORKER_RETRY_MAX_DELAY_MS`,
  up to `WORKER_MAX_RETRIES` attempts. On permanent failure, the message is released
  from `pendingIds` so Twilio webhook retries can re-ingest it.

### Storage

- SQLite via `better-sqlite3` (synchronous API).
- `raw_payloads` stores the original provider payload at webhook accept time.
- `messages` stores normalized messages with JSON-serialized participants and media metadata.

### Shutdown

- SIGTERM/SIGINT stops accepting new queue work and closes the HTTP server.
- In-flight jobs are not drained (acceptable for this challenge; production would
  use a persistent queue with graceful drain).

### Opinionated decisions

- **In-memory SQLite default** (`:memory:`) for zero-config local dev; set `DB_PATH` for persistence.
- **Mock S3 URLs** (`https://mock-s3.remi.local/...`) instead of real object storage.
- **Participants field** extension on Twilio payload for group context in tests.
- **Scenario 5 retry**: `SIMULATE_FAILURE_IDS` env var arms one-shot failures in
  `store.saveMessage` for integration testing across processes.
