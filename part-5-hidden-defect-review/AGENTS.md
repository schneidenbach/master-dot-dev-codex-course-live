# Auction House — Part 5

- `server/` contains the Fastify API and explicit PostgreSQL migrations.
- `web/` contains the React + Vite UI.
- PostgreSQL and Redis are shared from `../docker-compose.yml`; this part uses
  `auction_part_5` on host port 55432 and Redis on 56379. The API runs on 3105 and the web
  app on 5105.

Stable root commands: `npm run db:up`, `npm run db:down`, `npm run db:reset`,
`npm run migrate`, `npm run dev`, `npm start`, and `npm test`.

Use strict types, Zod validation at API input boundaries, plain `pg`, and ordered SQL
migrations. Build one complete vertical slice at a time. Before claiming a slice is done,
run `npm test`, typecheck both workspaces, and verify its user-facing behavior in a browser.
