# Auction House — Part 2

```sh
npm install
npm start
```

`npm start` ensures the shared PostgreSQL container and isolated `auction_part_2` database
are ready, runs pending migrations, and starts both apps. Open <http://localhost:5102>
(API <http://localhost:3102>).

Use `npm run db:reset` to discard Part 2 data and restore the ten demo users and six seeded
auctions. It does not affect the databases used by other parts.
