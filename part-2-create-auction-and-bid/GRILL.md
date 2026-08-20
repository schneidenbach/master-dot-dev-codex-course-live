# GRILL.md — Part 2: Create auctions and bid

These product and domain decisions were agreed before implementation.

## Actors

- Ten predefined users are seeded in PostgreSQL.
- A new browser tab starts as a randomly selected seeded user. The selection is stored in
  `sessionStorage`, so navigation and reloads within that tab keep the same identity while
  separate tabs can start as different users.
- A small footer switcher can change the active user for the current tab. The header shows
  that user's name.
- There is no authentication. The active user owns auctions they post and cannot bid on
  their own auctions.

## Auctions

- A listing requires title, category, description, condition, location, starting price,
  and a future closing time. The active user supplies seller identity.
- Listings publish immediately. Closing timestamps are stored in UTC.
- Product artwork is selected from the existing category-based illustrations; there are
  no uploads or external image URLs.
- New listings do not accept specifications. The details page hides the specifications
  section when none exist.
- The six existing catalog items are seeded into PostgreSQL and all catalog, search, and
  detail views read through the API.

## Money and bidding

- USD values are stored as integer cents.
- A bid must be at least $1 above the current amount. Ended auctions remain visible but
  reject bids.
- Every accepted bid is stored and shown with bidder, amount, and timestamp.
- Part 2 guarantees ordinary sequential behavior. Simultaneous-bid locking is deliberately
  deferred to Part 3.

## Reset behavior

`npm run db:reset` drops only `auction_part_2`, recreates it, applies migrations, and
restores the ten demo users and six original auctions. User-created auctions and bids are
discarded. Normal starts and container restarts preserve data.

## Delivery slices

1. Database-backed marketplace and persistent user switching.
2. Post an auction as the active user.
3. Place, validate, persist, and inspect bids.
