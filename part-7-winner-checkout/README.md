# Auction House — Part 7

```sh
npm install
npm start
```

`npm start` ensures the shared PostgreSQL, Redis, and RabbitMQ containers and isolated
`auction_part_7` database are ready, installs the sibling Mock Stripe service, runs pending
migrations, and starts the API, Auction Close Worker, Notification Worker, Mock Stripe, and
web app. Open <http://localhost:5107> (API <http://localhost:3107>, Mock Stripe
<http://127.0.0.1:7107>).

Auction detail pages use WebSocket-only Socket.IO connections. Accepted bids continue to
use the transactional HTTP endpoint; after commit, a Redis-backed room notification causes
each open detail page to refetch the authoritative auction state.

The separate Auction Close Worker polls for due auctions every second. It records the final
winner (or a no-bid outcome) and one pending `AuctionClosed` outbox event atomically, then
publishes pending events through RabbitMQ with publisher confirms. The Notification Worker
creates idempotent seller and winner deliveries and emits them through Redis to user-targeted
Socket.IO rooms. Every online recipient session shows a dismiss-required modal; offline
retrieval is not included.

After an auction closes with a winner, that winning demo user can open hosted checkout from
the outcome modal or the auction page. Auction House creates one durable purchase for the
authoritative winning bid and constructs the USD amount server-side. Mock Stripe accepts
`4242 4242 4242 4242` for success and declines `4000 0000 0000 0002`; any valid future
`MM / YY` and three-digit CVC work. Only a signed, matching, replay-safe webhook marks the
purchase paid. Canceling or declining never prevents another attempt.

The seller sees a deliberately limited payment view—only `Awaiting payment` or `Paid`—while
unrelated users receive no payment information. Both winner and seller views poll authoritative
purchase state so they converge after webhook completion. If the in-memory Mock Stripe process
restarts and loses a pending Checkout Session, retrying checkout replaces only the missing provider
Session; the durable purchase UUID and winning amount remain unchanged.

Use `npm run db:reset` to discard Part 7 data and restore the ten demo users and six seeded
auctions. It does not affect the databases used by other parts.
