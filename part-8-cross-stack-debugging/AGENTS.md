# Auction House — Part 8

- `server/` contains the Fastify API, Auction Close Worker, Notification Worker, explicit
  PostgreSQL migrations, and selective OpenTelemetry instrumentation.
- `web/` contains the React + Vite UI.
- `../stripe-service/` is the local Stripe-shaped hosted checkout dependency on port 7108.
- PostgreSQL, Redis, RabbitMQ, and Jaeger are shared from `../docker-compose.yml`. This part uses
  `auction_part_8` on host port 55432, Redis on 56379, RabbitMQ on 56726, OTLP/HTTP on 4318,
  and Jaeger UI on 16686. The API runs on 3108 and the web app on 5108.

Stable root commands: `npm run db:up`, `npm run db:down`, `npm run db:reset`,
`npm run migrate`, `npm run observability:up`, `npm run dev`, `npm start`, and `npm test`.

Use strict types, Zod validation at API input boundaries, plain `pg`, and ordered SQL
migrations. Preserve the high-signal tracing policy in `README.md`: business spans and useful
PostgreSQL operations stay visible; infrastructure polling and framework plumbing do not.
Before claiming completion, run `npm test`, typecheck all three workspaces, and verify the
golden trace in Jaeger through a browser.
