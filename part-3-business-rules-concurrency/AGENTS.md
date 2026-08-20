# Auction House — Part 3

- `server/` contains the Fastify API and explicit PostgreSQL migrations.
- `web/` contains the React + Vite UI.
- PostgreSQL is shared from `../docker-compose.yml`; this part uses `auction_part_3` on
  host port 55432. The API runs on 3103 and the web app on 5103.

Stable root commands: `npm run db:up`, `npm run db:down`, `npm run db:reset`,
`npm run migrate`, `npm run dev`, `npm start`, and `npm test`.

Use strict types, Zod validation at API input boundaries, plain `pg`, and ordered SQL
migrations. Build one complete vertical slice at a time. Before claiming a slice is done,
run `npm test`, typecheck both workspaces, and verify its user-facing behavior in a browser.
