# Auction House — Part 6

- `server/` contains the Fastify API and explicit PostgreSQL migrations.
- `web/` contains the React + Vite UI.
- PostgreSQL, Redis, and RabbitMQ are shared from `../docker-compose.yml`; this part uses
  `auction_part_6` on host port 55432, Redis on 56379, and RabbitMQ on 56726. The API runs
  on 3106 and the web app on 5106.

Stable root commands: `npm run db:up`, `npm run db:down`, `npm run db:reset`,
`npm run migrate`, `npm run dev`, `npm start`, and `npm test`.

Use strict types, Zod validation at API input boundaries, Drizzle ORM over `pg`, and ordered
Drizzle migrations. Build one complete vertical slice at a time. Before claiming a slice is done,
run `npm test`, typecheck both workspaces, and verify its user-facing behavior in a browser.
