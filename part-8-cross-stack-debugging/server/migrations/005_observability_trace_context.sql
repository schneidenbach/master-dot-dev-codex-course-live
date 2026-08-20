ALTER TABLE auctions ADD COLUMN traceparent text;
ALTER TABLE auction_closes ADD COLUMN traceparent text;
ALTER TABLE outbox_events ADD COLUMN traceparent text;
