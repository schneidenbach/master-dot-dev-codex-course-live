# Publish auction close events through a transactional outbox

Auction closing and live outcome notification are separate services connected through
RabbitMQ. The Auction Close Worker records the authoritative close and an `AuctionClosed`
outbox row in one PostgreSQL transaction, then marks that row published only after RabbitMQ
confirms the persistent message. This avoids losing the workflow when a worker crashes between
committing the close and publishing its event, while idempotent close, outbox, delivery, and
browser notification identifiers make at-least-once delivery safe. Only the durable topology,
confirmations, acknowledgements, and pending-row republication required by this pattern are in
scope; retry scheduling and dead-letter infrastructure are deliberately deferred.
