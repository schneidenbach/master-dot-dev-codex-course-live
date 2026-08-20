CREATE TABLE IF NOT EXISTS notification_deliveries (
  id uuid PRIMARY KEY,
  outbox_event_id uuid NOT NULL REFERENCES outbox_events(id) ON DELETE CASCADE,
  recipient_user_id integer NOT NULL REFERENCES users(id),
  recipient_role text NOT NULL CHECK (recipient_role IN ('seller', 'winner')),
  created_at timestamptz NOT NULL,
  emitted_at timestamptz,
  UNIQUE (outbox_event_id, recipient_user_id)
);

CREATE INDEX IF NOT EXISTS notification_deliveries_pending_idx
  ON notification_deliveries (created_at, id)
  WHERE emitted_at IS NULL;
