# CODEX.md — Part 1: Foundation

How this slice was built: Codex CLI (`codex-cli 0.144.6`, ChatGPT auth) was invoked
non-interactively and did all implementation work. Full raw session transcripts are in
`codex-logs/` alongside this file. Nothing in `server/`, `web/`, or the root config was
written by hand.

## Session 1 — Build

Invocation:

```bash
codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check \
  --color never -C part-1-foundation - < part1-prompt.md
```

### Prompt (verbatim)

> You are building **Part 1 (Foundation)** of a live-coding workshop demo: a live-auction
> web app that will grow slice by slice in later parts (auctions/bids, business rules,
> Socket.IO + Redis, RabbitMQ worker, Stripe). This part is the foundation only. You are
> working in the folder `part-1-foundation/`, which is currently empty except for GRILL.md
> (pre-implementation decisions — read it first and follow it).
>
> ## Hard constraints
>
> - ULTRA-MINIMALIST. This is a teaching demo, not a product. Build the least code that
>   proves the vertical path works. No speculative abstractions, no "we'll need this later"
>   scaffolding.
> - Stack: TypeScript + ESM everywhere. React + Vite in `web/`. Fastify in `server/`.
>   PostgreSQL 16 via Docker Compose. Plain `pg` client — NO ORM, no query builder.
>   Vitest for tests.
> - npm workspaces monorepo at the folder root: workspaces `server` and `web`.
> - Infrastructure runs in Docker; the API and web dev server run on the host (host has
>   Node v25 installed; Docker daemon is running; ports 5432, 3000, 5173 are free).
> - Do NOT run `git init` or create any git repository.
> - Do NOT add: CSS frameworks, component libraries, react-router, state libraries, auth,
>   ESLint/Prettier config, husky, CI files, Dockerfiles for the apps.
>
> ## What to build
>
> 1. `docker-compose.yml`: one service, `postgres:16-alpine`, port 5432, user/password/
>    database all `auction`, a `pg_isready` healthcheck, named volume.
> 2. Root `package.json` with workspaces and these stable scripts (humans and agents share
>    them for the whole workshop): `db:up` (compose up -d --wait), `db:down` (compose
>    down -v), `db:reset` (down then up then migrate), `migrate`, `dev` (server + web
>    concurrently), `test`.
> 3. `server/` — Fastify listening on 3000:
>    - `GET /api/health`: runs `SELECT 1` against Postgres, returns
>      `{ ok: true, db: "ok", requestId }`; if the DB is unreachable returns 503
>      `{ ok: false, db: "down", requestId }`.
>    - Correlation ID baseline: accept an incoming `x-request-id` header or generate one;
>      set it on the response header, include it in the structured pino logs and in the
>      health payload.
>    - OpenTelemetry baseline: a single small `otel.ts` loaded before the app — NodeSDK
>      with auto-instrumentations (http/fastify/pg) and a ConsoleSpanExporter. No
>      collector, no Jaeger yet (that arrives in a later part). Keep it to one file.
>    - Migration runner: a ~30-line `migrate.ts` that applies `server/migrations/*.sql` in
>      filename order and records applied files in a `schema_migrations` table (creating
>      it if absent). No migration files exist yet in part 1 — running it should print
>      that 0 migrations were applied. No migration framework.
>    - Export a `buildApp()` factory separate from the listen call so tests can inject
>      requests.
>    - One vitest test: inject `GET /api/health` against `buildApp()` with the real
>      Postgres up, assert 200 and `ok: true`. This is the backpressure pattern later
>      parts will extend.
> 4. `web/` — Vite + React + TypeScript, dev server on 5173 with a proxy for `/api` →
>    `http://localhost:3000`. One page: an "Auction House" heading, a fetch of
>    `/api/health` on mount, and the JSON result rendered plainly with an OK/error
>    indicator. Plain inline styles or a tiny CSS file only. Nothing else on the page.
> 5. `AGENTS.md` at the folder root, brief: the layout, the stable root commands, the
>    minimalism principle ("build the least that demonstrates the slice; no speculative
>    abstraction"), and the verification expectation (tests pass + the health page renders
>    ok in a browser before claiming done).
> 6. `README.md`: a short quickstart (install, db:up, migrate, dev, open 5173).
>
> ## Verify before you finish (collect evidence, don't just claim)
>
> 1. `npm install` at the root.
> 2. `npm run db:up` and wait until the container is healthy.
> 3. `npm run migrate` — expect "0 migrations applied".
> 4. `npm test` — the health test must pass.
> 5. Start the dev servers, then `curl http://localhost:5173/api/health` (through the Vite
>    proxy) and confirm `ok: true` with a requestId present.
> 6. Kill every dev-server process you started (nothing may be left listening on 3000/5173
>    when you exit). Leave the Postgres container running.
> 7. End with a short summary of what you built and the evidence gathered.

### What Codex did (condensed — full transcript in `codex-logs/part1-build.log`)

Read GRILL.md first, then scaffolded the workspace root, `server/`, and `web/` via
`apply_patch`, and self-verified with: `npm install` → `docker pull postgres:16-alpine`
(diagnosed a Docker credential-helper issue by reading `~/.docker/config.json` and using an
anonymous pull config) → `npm run db:up` + `docker compose ps` → `npm run migrate`
(0 migrations applied) → `npm test` (1 passed) → `npx tsc` on both workspaces →
`npm run dev` → `curl` of `http://localhost:5173/api/health` with and without a supplied
`x-request-id` → killed the dev servers and proved ports 3000/5173 were clear with `lsof`.
It attempted its in-app browser skill for a visual check but no browser instance was
available in exec mode, and said so rather than claiming visual verification.

### Codex final message (verbatim)

> Implemented the Part 1 foundation:
>
> - npm workspaces with Fastify server and React/Vite web app.
> - PostgreSQL 16 Compose service and migration runner.
> - Health endpoint with real DB query, correlation IDs, pino logging, and OpenTelemetry.
> - Minimal health UI, documentation, and real-Postgres Vitest test.
>
> Verification evidence:
>
> - `npm install` succeeded.
> - PostgreSQL is running and healthy.
> - Migration output: `0 migrations applied`.
> - Tests: 1 test passed.
> - TypeScript checks passed for server and web.
> - Vite proxy returned `{"ok":true,"db":"ok","requestId":"req-1"}`.
> - Incoming `x-request-id` propagation was also verified.
> - Ports 3000 and 5173 are clear; PostgreSQL remains running.
>
> The browser-control environment had no browser instance available, so visual browser
> inspection could not be performed; the UI compiled and the requested end-to-end proxy
> curl passed.

## Session 2 — Codex QA pass (same thread, `codex exec resume --last --yolo`)

The dev servers were started externally first so QA was purely observational. QA prompt is
in `codex-logs/part1-qa-prompt.md`; full transcript in `codex-logs/part1-qa.log`.

### Codex QA verdict (verbatim)

> Browser automation could not obtain an instance—the available browser list was empty.
> I used the prescribed HTTP fallback.
>
> | Check | Verdict | Evidence |
> |---|---|---|
> | 1. Browser/page | PASS (fallback) | `/` returned 200 with `<title>Auction House</title>`, root element, Vite client, and `/src/main.tsx`. Both `main.tsx` and `App.tsx` returned 200. The served component renders `Auction House`, `OK`, and JSON containing `ok: true`, `db: "ok"`, and `requestId`. Proxy health returned 200 with `x-request-id: req-a` and `{"ok":true,"db":"ok","requestId":"req-a"}`. Browser console inspection was unavailable. |
> | 2. Correlation ID | PASS | Direct API response header: `x-request-id: qa-123`. Body: `{"ok":true,"db":"ok","requestId":"qa-123"}`. |
> | 3. Proxy path | PASS | `http://localhost:5173/api/health` returned HTTP 200 and `{"ok":true,"db":"ok","requestId":"req-a"}`. |
> | 4. OTel baseline | PASS (static) | No repository log file exists; the running process writes to a Unix pipe, so live output was inaccessible. Static verification shows `index.ts` imports `./otel.js` before dynamically importing `app.js`. `otel.ts` starts `NodeSDK` with `ConsoleSpanExporter` and Node auto-instrumentations. |
>
> No files were modified, and the existing dev servers were left running.

## Independent QA (not Codex)

- A Claude Opus subagent did real browser QA via the in-app browser: page renders the
  "Auction House" heading with OK status and health JSON; zero console errors/warnings;
  `GET /api/health` 200 through the proxy; requestId changes across reloads (req-5 →
  req-9); `curl -H 'x-request-id: opus-qa-1'` echoed in both response header and body.
  All five checks PASS.
- OTel span emission was confirmed dynamically from the captured dev-server output:
  87 console spans (http/fastify/pg/dns) recorded during QA traffic.

## Outcome

Slice complete. Evidence: 1 vitest test passing against real Postgres, typechecks clean,
end-to-end health path verified in a real browser, correlation-ID propagation proven both
directions, OTel console spans emitting. Known limitation: `codex exec` had no browser
instance available for its own visual QA (its HTTP fallback was used); independent browser
QA covered the gap.
