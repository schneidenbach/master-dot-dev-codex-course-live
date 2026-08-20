# Auction House — Part 6

```sh
npm install
npm start
```

`npm start` ensures the shared PostgreSQL, Redis, and RabbitMQ containers and isolated
`auction_part_6` database are ready, runs pending migrations, and starts the API, Auction
Close Worker, Notification Worker, and web app. Open <http://localhost:5106> (API
<http://localhost:3106>).

Auction detail pages use WebSocket-only Socket.IO connections. Accepted bids continue to
use the transactional HTTP endpoint; after commit, a Redis-backed room notification causes
each open detail page to refetch the authoritative auction state.

The separate Auction Close Worker polls for due auctions every second. It records the final
winner (or a no-bid outcome) and one pending `AuctionClosed` outbox event atomically, then
publishes pending events through RabbitMQ with publisher confirms. The Notification Worker
creates idempotent seller and winner deliveries and emits them through Redis to user-targeted
Socket.IO rooms. Every online recipient session shows a dismiss-required modal; offline
retrieval is not included.

Use `npm run db:reset` to discard Part 6 data and restore the ten demo users and six seeded
auctions. It does not affect the databases used by other parts.
