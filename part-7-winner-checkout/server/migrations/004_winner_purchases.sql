CREATE TABLE purchases (
  id uuid PRIMARY KEY,
  auction_id bigint NOT NULL UNIQUE REFERENCES auction_closes(auction_id) ON DELETE CASCADE,
  winning_bidder_user_id integer NOT NULL REFERENCES users(id),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL CHECK (currency = 'usd'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  provider_session_id text UNIQUE,
  provider_checkout_url text,
  created_at timestamptz NOT NULL,
  paid_at timestamptz,
  CHECK ((provider_session_id IS NULL) = (provider_checkout_url IS NULL)),
  CHECK ((status = 'paid') = (paid_at IS NOT NULL))
);

CREATE TABLE payment_webhook_events (
  id uuid PRIMARY KEY,
  purchase_id uuid NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  provider_session_id text NOT NULL,
  received_at timestamptz NOT NULL
);

