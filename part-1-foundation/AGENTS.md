# Auction House workshop

- `server/` contains the Fastify API and PostgreSQL migrations.
- `web/` contains the React + Vite UI.
- PostgreSQL is shared from `../docker-compose.yml`; this part uses `auction_part_1` on
  host port 55432. The API runs on 3101 and the web app on 5101.

Stable root commands: `npm run db:up`, `npm run db:down`, `npm run db:reset`,
`npm run migrate`, `npm run dev`, `npm start`, and `npm test`.

Build the least that demonstrates the slice; no speculative abstraction. Before claiming
done, tests must pass and the health page must render an OK response in a browser.
