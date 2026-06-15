# remi-ingestor

> Standalone SMS / Group Message Ingestor for REMI — the autonomous AI property
> management assistant.

## Prerequisites

- Node.js >= 18
- npm >= 9

## Setup

```bash
npm install
cp .env.example .env
# Edit .env if desired (defaults work for local testing)
```

## Run (development)

```bash
npm run dev
```

The server accepts both `application/json` and `application/x-www-form-urlencoded`
payloads (Twilio sends form-encoded webhooks).

## Run (production build)

```bash
npm run build
npm start
```

## Test

```bash
npm test
```

## Simulate (in a second terminal)

Start the server first (`npm run dev`), then:

```bash
npm run simulate
```

Scenario 5 (worker retry) requires `SIMULATE_FAILURE_IDS=SM999` in the server's
`.env` (included in `.env.example`).

## Endpoints

| Method | Path                | Description                                      |
| ------ | ------------------- | ------------------------------------------------ |
| POST   | `/webhook/messages` | Ingest a Twilio webhook payload                  |
| GET    | `/health`           | Service health                                   |
| GET    | `/stats`            | Processing statistics                            |

### `GET /stats` response example

```json
{
  "messagesReceived": 12,
  "messagesProcessed": 10,
  "duplicatesIgnored": 2,
  "failedMessages": 0,
  "pendingQueueDepth": 0,
  "messagesStoredInDB": 10
}
```

- `messagesReceived` — every webhook POST (including duplicates)
- `messagesProcessed` — successfully completed queue jobs
- `duplicatesIgnored` — webhook requests rejected as duplicates
- `failedMessages` — jobs that exhausted all retries
- `pendingQueueDepth` — jobs waiting or in-flight

## Environment variables

| Variable                    | Default                          | Description                                      |
| --------------------------- | -------------------------------- | ------------------------------------------------ |
| `PORT`                      | `3001`                           | HTTP listen port                                 |
| `DB_PATH`                   | `:memory:`                       | SQLite path (`:memory:` for in-memory)           |
| `MEDIA_DIR`                 | OS temp dir + `/remi-media`      | Local media download directory                   |
| `LOG_LEVEL`                 | `info`                           | Pino log level                                   |
| `WORKER_CONCURRENCY`        | `3`                              | Max parallel queue workers                       |
| `WORKER_RETRY_DELAY_MS`     | `500`                            | Base delay before retry (exponential backoff)    |
| `WORKER_RETRY_MAX_DELAY_MS` | `30000`                          | Cap on exponential retry delay                   |
| `WORKER_MAX_RETRIES`        | `3`                              | Max retry attempts per job                       |
| `MAX_MEDIA_ATTACHMENTS`     | `10`                             | Max media items parsed per message               |
| `SIMULATE_FAILURE_IDS`      | (empty)                          | Comma-separated MessageSids for one-shot DB fail |
| `SIMULATE_BASE_URL`         | `http://localhost:3001`          | Base URL for `npm run simulate` only             |
| `NODE_ENV`                  | `development`                    | Set to `production` for JSON logs                |

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md).

## What would be added in production

- Twilio webhook signature validation (X-Twilio-Signature HMAC-SHA1)
- Real S3 upload in media.ts
- Persistent PostgreSQL replacing SQLite
- BullMQ or SQS replacing the in-memory queue
- OpenTelemetry tracing
- Twilio Conversations API integration for native participant lists
- Rate limiting per sender
- Graceful shutdown that drains the in-memory queue before exit
