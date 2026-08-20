CREATE TABLE IF NOT EXISTS auction_closes (
  auction_id bigint PRIMARY KEY REFERENCES auctions(id) ON DELETE CASCADE,
  closed_at timestamptz NOT NULL,
  winning_bid_id bigint UNIQUE REFERENCES bids(id)
);

CREATE TABLE IF NOT EXISTS outbox_events (
  id uuid PRIMARY KEY,
  event_type text NOT NULL CHECK (event_type = 'AuctionClosed'),
  auction_id bigint NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz NOT NULL,
  published_at timestamptz,
  UNIQUE (event_type, auction_id)
);

CREATE INDEX IF NOT EXISTS outbox_events_pending_idx
  ON outbox_events (occurred_at, id)
  WHERE published_at IS NULL;
