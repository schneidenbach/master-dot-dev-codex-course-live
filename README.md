# Codex Workshop — Live Auction Platform

Demo app for the Codex full-stack/backend workshop: a live auction site built as
**vertical slices**, one folder per part. Every line of app code was written by the
Codex CLI (`codex exec`); each folder starts as a verbatim copy of the previous part
and adds exactly one slice.

**Stack:** TypeScript + ESM, React + Vite, Fastify, Zod, PostgreSQL, Redis + Socket.IO,
RabbitMQ worker, OpenTelemetry + Jaeger, Docker Compose (infra in Docker, apps on host).

## The parts

| Folder | Slice |
|---|---|
| `part-1-foundation` | React → Fastify → Postgres health path, OTel baseline |
| `part-2-create-auction-and-bid` | Create/list auctions, place bids |
| `part-3-business-rules-concurrency` | Min increment, seller/closed gates, `FOR UPDATE` race fix |
| `part-4-hidden-defect-review` | Seeded SQL defect; Codex finds & fixes it from runtime evidence |
| `part-5-realtime-socketio-redis` | Live bid fan-out via Redis pub/sub + Socket.IO |
| `part-6-async-close-rabbitmq` | Worker-driven auction close, exactly-one-winner, Jaeger traces |
| `part-7-winner-checkout` | Winner payment (stubbed, Stripe-shaped, replay-safe) |
| `part-8-cross-stack-debugging` | Seeded cross-stack bug; Codex root-causes it layer by layer |

## Anatomy of a part

- `GRILL.md` — the pre-build interrogation: questions asked, decisions locked.
- `CODEX.md` — the story: prompts, what Codex did, QA verdicts, steering feedback.
- `codex-logs/` — complete raw transcripts of every Codex session.
- Everything else — the app at that stage (`server/`, `web/`, `worker/` from part 6).

## Running a part

```bash
cd part-N-whatever
npm install
npm start
```

`npm start` ensures the shared PostgreSQL container and any part-local infrastructure are
running, creates and migrates that part's isolated database, and starts its API, web app, and
worker (from Part 6 onward). Run `npm test` separately when needed.

All eight parts can run at the same time:

| Part | Web | API | Database |
|---|---:|---:|---|
| 1 | <http://localhost:5101> | `3101` | `auction_part_1` |
| 2 | <http://localhost:5102> | `3102` | `auction_part_2` |
| 3 | <http://localhost:5103> | `3103` | `auction_part_3` |
| 4 | <http://localhost:5104> | `3104` | `auction_part_4` |
| 5 | <http://localhost:5105> | `3105` | `auction_part_5` |
| 6 | <http://localhost:5106> | `3106` | `auction_part_6` |
| 7 | <http://localhost:5107> | `3107` | `auction_part_7` |
| 8 | <http://localhost:5108> | `3108` | `auction_part_8` |

The databases share PostgreSQL at `localhost:55432`. Parts 5–8 keep Redis, RabbitMQ,
and Jaeger isolated in their own Compose projects so events and jobs cannot leak between demos.
`npm run db:down` removes only the selected part's database and part-local infrastructure;
the shared PostgreSQL container remains available for the other parts.

| Part | Redis | RabbitMQ | Rabbit UI | Jaeger | OTLP HTTP |
|---|---:|---:|---:|---:|---:|
| 5 | `6305` | — | — | — | — |
| 6 | `6306` | `5606` | `15606` | `16606` | `4306` |
| 7 | `6307` | `5607` | `15607` | `16607` | `4307` |
| 8 | `6308` | `5608` | `15608` | `16608` | `4308` |

After every demo is finished, run `docker compose down` from the repository root to stop the
shared PostgreSQL container. Add `-v` only when you also want to delete every part's database.
