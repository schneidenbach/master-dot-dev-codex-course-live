# Auction House — Part 4

```sh
npm install
npm start
```

`npm start` ensures the shared PostgreSQL and Redis containers and isolated
`auction_part_4` database are ready, runs pending migrations, and starts both apps. Open
<http://localhost:5104> (API <http://localhost:3104>).

Auction detail pages use WebSocket-only Socket.IO connections. Accepted bids continue to
use the transactional HTTP endpoint; after commit, a Redis-backed room notification causes
each open detail page to refetch the authoritative auction state.

Use `npm run db:reset` to discard Part 4 data and restore the ten demo users and six seeded
auctions. It does not affect the databases used by other parts.
