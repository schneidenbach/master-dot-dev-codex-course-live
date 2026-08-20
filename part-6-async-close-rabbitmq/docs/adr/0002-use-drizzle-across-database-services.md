# Use Drizzle across database-backed services

Part 6 uses Drizzle ORM over the `pg` driver for the Fastify API, Auction Close Worker,
Notification Worker, integration-test data setup, and migration execution. This gives every
service one schema-derived type boundary while retaining the explicit PostgreSQL semantics the
auction rules require, including row locks, `SKIP LOCKED` batch claims, conflict handling, and
transactional outbox writes; handwritten SQL remains confined to ordered migration files and
test-only database probes that Drizzle executes.
