# GRILL.md — Part 1: Foundation

Pre-implementation grilling for the foundation slice. Questions kept minimal per standing
instruction; answers chosen for the most minimal demo-appropriate option and locked in
before Codex was prompted.

## Q1. Does the app itself run in Docker, or only the infrastructure?

**Answer: infra in Docker, apps on host.** Postgres (and later Redis, RabbitMQ, Jaeger)
run in Docker Compose. The Fastify API and Vite dev server run on the host via `npm run dev`.
Rationale: fast iteration loop for Codex during the workshop, no image-rebuild friction,
and "services hosted in Docker" refers to the stateful dependencies. This decision carries
through every later part.

## Q2. Repo layout for the slice?

**Answer: npm workspaces monorepo.** Root `package.json` with two workspaces: `server/`
(Fastify + TypeScript ESM) and `web/` (React + Vite + TypeScript). Root scripts are the
stable commands humans and Codex share: `dev`, `db:up`, `db:down`, `db:reset`, `migrate`,
`test`. No shared package yet — premature until two consumers exist.

## Q3. What is the completion evidence for part 1?

**Answer: one vertical health path.** A single React page calls `GET /api/health` (through
the Vite proxy); the API runs `SELECT 1` against Postgres and returns `{ ok, db, requestId }`;
the page renders the result. If that renders "ok" in a browser, the React → Fastify →
Postgres path is proven end to end. No auth, no routing, no CSS framework.

## Q4. Migrations and data access — ORM or raw SQL?

**Answer: plain `pg` + ordered SQL files.** A ~30-line migrate script applies
`server/migrations/*.sql` in filename order, tracked in a `schema_migrations` table.
No Prisma/Drizzle/Knex — an ORM is the single biggest minimalism-killer in a demo and
hides the SQL the workshop wants visible. Part 1 ships the runner with only the bootstrap
migration; part 2 adds real tables.

## Q5. How much OpenTelemetry in part 1?

**Answer: baseline only, sliced like everything else.** OTel NodeSDK with HTTP/Fastify
auto-instrumentation and a console span exporter, plus structured request logs (Fastify's
pino) carrying a correlation ID (`x-request-id`: accepted or generated, echoed in the
response header and the health payload). No Jaeger container yet — it arrives in part 6
when a trace first crosses a process boundary. Every later slice extends its own telemetry.

## Ports (verified free on this machine)

Postgres 5432, API 3000, web 5173. Later parts: Redis 6379, RabbitMQ 5672/15672,
Jaeger 16686, OTLP 4318.
