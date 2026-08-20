You are building **Part 1 (Foundation)** of a live-coding workshop demo: a live-auction web app that will grow slice by slice in later parts (auctions/bids, business rules, Socket.IO + Redis, RabbitMQ worker, Stripe). This part is the foundation only. You are working in the folder `part-1-foundation/`, which is currently empty except for GRILL.md (pre-implementation decisions — read it first and follow it).

## Hard constraints

- ULTRA-MINIMALIST. This is a teaching demo, not a product. Build the least code that proves the vertical path works. No speculative abstractions, no "we'll need this later" scaffolding.
- Stack: TypeScript + ESM everywhere. React + Vite in `web/`. Fastify in `server/`. PostgreSQL 16 via Docker Compose. Plain `pg` client — NO ORM, no query builder. Vitest for tests.
- npm workspaces monorepo at the folder root: workspaces `server` and `web`.
- Infrastructure runs in Docker; the API and web dev server run on the host (host has Node v25 installed; Docker daemon is running; ports 5432, 3000, 5173 are free).
- Do NOT run `git init` or create any git repository.
- Do NOT add: CSS frameworks, component libraries, react-router, state libraries, auth, ESLint/Prettier config, husky, CI files, Dockerfiles for the apps.

## What to build

1. `docker-compose.yml`: one service, `postgres:16-alpine`, port 5432, user/password/database all `auction`, a `pg_isready` healthcheck, named volume.
2. Root `package.json` with workspaces and these stable scripts (humans and agents share them for the whole workshop): `db:up` (compose up -d --wait), `db:down` (compose down -v), `db:reset` (down then up then migrate), `migrate`, `dev` (server + web concurrently), `test`.
3. `server/` — Fastify listening on 3000:
   - `GET /api/health`: runs `SELECT 1` against Postgres, returns `{ ok: true, db: "ok", requestId }`; if the DB is unreachable returns 503 `{ ok: false, db: "down", requestId }`.
   - Correlation ID baseline: accept an incoming `x-request-id` header or generate one; set it on the response header, include it in the structured pino logs and in the health payload.
   - OpenTelemetry baseline: a single small `otel.ts` loaded before the app — NodeSDK with auto-instrumentations (http/fastify/pg) and a ConsoleSpanExporter. No collector, no Jaeger yet (that arrives in a later part). Keep it to one file.
   - Migration runner: a ~30-line `migrate.ts` that applies `server/migrations/*.sql` in filename order and records applied files in a `schema_migrations` table (creating it if absent). No migration files exist yet in part 1 — running it should print that 0 migrations were applied. No migration framework.
   - Export a `buildApp()` factory separate from the listen call so tests can inject requests.
   - One vitest test: inject `GET /api/health` against `buildApp()` with the real Postgres up, assert 200 and `ok: true`. This is the backpressure pattern later parts will extend.
4. `web/` — Vite + React + TypeScript, dev server on 5173 with a proxy for `/api` → `http://localhost:3000`. One page: an "Auction House" heading, a fetch of `/api/health` on mount, and the JSON result rendered plainly with an OK/error indicator. Plain inline styles or a tiny CSS file only. Nothing else on the page.
5. `AGENTS.md` at the folder root, brief: the layout, the stable root commands, the minimalism principle ("build the least that demonstrates the slice; no speculative abstraction"), and the verification expectation (tests pass + the health page renders ok in a browser before claiming done).
6. `README.md`: a short quickstart (install, db:up, migrate, dev, open 5173).

## Verify before you finish (collect evidence, don't just claim)

1. `npm install` at the root.
2. `npm run db:up` and wait until the container is healthy.
3. `npm run migrate` — expect "0 migrations applied".
4. `npm test` — the health test must pass.
5. Start the dev servers, then `curl http://localhost:5173/api/health` (through the Vite proxy) and confirm `ok: true` with a requestId present.
6. Kill every dev-server process you started (nothing may be left listening on 3000/5173 when you exit). Leave the Postgres container running.
7. End with a short summary of what you built and the evidence gathered.
