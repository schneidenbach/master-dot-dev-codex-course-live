# Auction House — Part 3

```sh
npm install
npm start
```

`npm start` ensures the shared PostgreSQL container and isolated `auction_part_3` database
are ready, runs pending migrations, and starts both apps. Open <http://localhost:5103>
(API <http://localhost:3103>).

Use `npm run db:reset` to discard Part 3 data and restore the ten demo users and six seeded
auctions. It does not affect the databases used by other parts.
