import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  displayName: text('display_name').notNull().unique(),
  handle: text('handle').notNull().unique(),
}, (table) => [
  check('users_display_name_check', sql`length(trim(${table.displayName})) BETWEEN 2 AND 40`),
  check('users_handle_check', sql`${table.handle} ~ '^[a-z0-9_]+$'`),
]);

export const auctions = pgTable('auctions', {
  id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
  slug: text('slug').notNull().unique(),
  sellerUserId: integer('seller_user_id').notNull().references(() => users.id),
  title: text('title').notNull(),
  kicker: text('kicker').notNull().default(''),
  category: text('category').notNull(),
  art: text('art').notNull(),
  startingPriceCents: integer('starting_price_cents').notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true, mode: 'date' }).notNull(),
  location: text('location').notNull(),
  condition: text('condition').notNull(),
  description: text('description').notNull(),
  specs: jsonb('specs').$type<Array<[string, string]>>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  check('auctions_slug_check', sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`),
  check('auctions_title_check', sql`length(trim(${table.title})) BETWEEN 3 AND 120`),
  check('auctions_kicker_check', sql`length(${table.kicker}) <= 160`),
  check(
    'auctions_category_check',
    sql`${table.category} IN ('GPUs', 'CPUs', 'Memory', 'Chassis', 'Networking', 'Cooling')`,
  ),
  check('auctions_art_check', sql`${table.art} IN ('gpu', 'cpu', 'memory', 'chassis', 'switch', 'cooling')`),
  check('auctions_starting_price_cents_check', sql`${table.startingPriceCents} > 0`),
  check('auctions_location_check', sql`length(trim(${table.location})) BETWEEN 2 AND 100`),
  check('auctions_condition_check', sql`length(trim(${table.condition})) BETWEEN 2 AND 100`),
  check('auctions_description_check', sql`length(trim(${table.description})) BETWEEN 10 AND 4000`),
  check('auctions_specs_check', sql`jsonb_typeof(${table.specs}) = 'array'`),
  index('auctions_ends_at_idx').on(table.endsAt),
]);

export const bids = pgTable('bids', {
  id: bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
  auctionId: bigint('auction_id', { mode: 'bigint' }).notNull()
    .references(() => auctions.id, { onDelete: 'cascade' }),
  bidderUserId: integer('bidder_user_id').notNull().references(() => users.id),
  amountCents: integer('amount_cents').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
  check('bids_amount_cents_check', sql`${table.amountCents} > 0`),
  index('bids_auction_created_idx').on(table.auctionId, table.createdAt.desc(), table.id.desc()),
]);

export const auctionCloses = pgTable('auction_closes', {
  auctionId: bigint('auction_id', { mode: 'bigint' }).primaryKey()
    .references(() => auctions.id, { onDelete: 'cascade' }),
  closedAt: timestamp('closed_at', { withTimezone: true, mode: 'date' }).notNull(),
  winningBidId: bigint('winning_bid_id', { mode: 'bigint' }).unique().references(() => bids.id),
});

export const outboxEvents = pgTable('outbox_events', {
  id: uuid('id').primaryKey(),
  eventType: text('event_type').notNull(),
  auctionId: bigint('auction_id', { mode: 'bigint' }).notNull()
    .references(() => auctions.id, { onDelete: 'cascade' }),
  payload: jsonb('payload').$type<unknown>().notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
}, (table) => [
  check('outbox_events_event_type_check', sql`${table.eventType} = 'AuctionClosed'`),
  check('outbox_events_payload_check', sql`jsonb_typeof(${table.payload}) = 'object'`),
  uniqueIndex('outbox_events_event_type_auction_id_key').on(table.eventType, table.auctionId),
  index('outbox_events_pending_idx').on(table.occurredAt, table.id)
    .where(sql`${table.publishedAt} IS NULL`),
]);

export const notificationDeliveries = pgTable('notification_deliveries', {
  id: uuid('id').primaryKey(),
  outboxEventId: uuid('outbox_event_id').notNull()
    .references(() => outboxEvents.id, { onDelete: 'cascade' }),
  recipientUserId: integer('recipient_user_id').notNull().references(() => users.id),
  recipientRole: text('recipient_role').$type<'seller' | 'winner'>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  emittedAt: timestamp('emitted_at', { withTimezone: true, mode: 'date' }),
}, (table) => [
  check('notification_deliveries_recipient_role_check', sql`${table.recipientRole} IN ('seller', 'winner')`),
  uniqueIndex('notification_deliveries_outbox_event_id_recipient_user_id_key')
    .on(table.outboxEventId, table.recipientUserId),
  index('notification_deliveries_pending_idx').on(table.createdAt, table.id)
    .where(sql`${table.emittedAt} IS NULL`),
]);
