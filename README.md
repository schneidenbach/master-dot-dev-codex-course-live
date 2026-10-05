# Fullstack Codex Course — Master.dev

Demo app for the [Build a Fullstack App with Codex](https://master.dev/courses/fullstack-app-codex) Codex fullstack course from [Master.dev](https://master.dev). The app is a live auction site built as **vertical slices**, one folder per part. Every line of app code was written by the
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

## Goals
Before each `/grill me` session, Spencer reviews the goals of the feature being added. You can reference these goals to better direct your AI coding tool.

**Auctions & Bidding**
- Create and persist auctions within Postgres
- Bid on auctions, store bids in Postgres
- We need some concept of users as well

**Business Rules and Concurrency**
- Add in some value-added seller features (minimum bids)
- Add in concurrency protection (via transaction locks in Postgres)
- Add in stale bid protection
- Add in BIDDING WARS test

**Real-time UI Updates**
- Make the UI update bids as bids come in, as opposed to requiring a refresh on the page
- Introduce a bit of architectural complexity

**Closing the Auction**
- Model real-world architecture for triggering workflows
  - Auction ends
  - Event is broadcast to a backend service to trigger communication and checkout
- Add observability

**Checkout w/ Payments**
- Auction ends, winning bidder makes payment

## Prompts
Below are the prompts used in each section of the course.

**01-foundations**
```md
I would like to build an auction site. it's going to roughly model how other popular auction sites look online.
please use React
keep it to two routes right now:
- Home page with auctions on it as well as some sample auctions (6)
- separate route to actually view the auction\

I'd like you to build it with three different looks/themes, have those available on the homepage, and let me click between them
```

**02-create-auction-and-bid**

```md
I want to add on the ability to post auctions and make bids. these should be stored in the postgres database (see the docker compose file - that's where the database should live). GRILL ME with DOCS!
```


**03-business-rules-concurrency**
```md
I'd like to add bidding concurrency protection, closed-auction checks to the backend (if they aren't there already, they might be), handling stale bids gracefully on the frontend

grill me with docs
```

**04-realtime-socketio-redis**
```md
we want to make the frontend use websockets to update as soon as bids come through. we want to protect against when this app is distributed that the websockets will succeed. grill me with docs!
```

**05-hidden-defect-review**
```md
introduce a concurrency defect in the postgres bidding query, we're going to see if another LLM can find it
```

**06-async-close-rabbit**
```md
once the auction is in the past, I want to trigger a workflow for notifying the winning bid user that the auction has ended. we'll do that with a popup notification on the screen triggered by web socket. the service for polling the auction table for ended auctions will be separated from the service that actually handles and triggers notifications. they will be triggered and bound together via rabbit MQ.

GRILL ME WITH DOCS!
```

**07-winner-checkout**
```md
I want to implement winner checkout using the mock Stripe service inside of this repo. please grill me with docs
```

**08-cross-stack-debugging**
```md
we want to add Jaeger for observability. please make it so that it's as little noise as possible inside of our spans and traces - high signal stuff only for the purposes of this workshop. focus on the auction checkout side of things- I want to see a trace that contains spans across auction bids, closes, and communication.

Grill me shorter - just one round of questions please!
```

