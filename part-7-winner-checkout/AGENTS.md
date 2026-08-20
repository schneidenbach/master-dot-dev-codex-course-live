# Auction House — Part 7

- `server/` contains the Fastify API and explicit PostgreSQL migrations.
- `web/` contains the React + Vite UI.
- `../stripe-service/` is the local Stripe-shaped hosted checkout dependency on port 7107.
- PostgreSQL, Redis, and RabbitMQ are shared from `../docker-compose.yml`; this part uses
  `auction_part_7` on host port 55432, Redis on 56379, and RabbitMQ on 56726. The API runs
  on 3107, the web app on 5107, and Mock Stripe on 7107.

Stable root commands: `npm run db:up`, `npm run db:down`, `npm run db:reset`,
`npm run migrate`, `npm run dev`, `npm start`, and `npm test`.

Use strict types, Zod validation at API input boundaries, plain `pg`, and ordered SQL
migrations. Build one complete vertical slice at a time. Before claiming a slice is done,
run `npm test`, typecheck both workspaces, and verify its user-facing behavior in a browser.
