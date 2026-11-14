import { sql } from 'drizzle-orm';
import { pgTable, text, uuid, timestamp, date, integer, boolean, primaryKey, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { communityUsers, authoredBooks } from './community';

export const socialSettings = pgTable('social_settings', {
  id: boolean('id').primaryKey().default(true),
  instagramHandle: text('instagram_handle').notNull(),
  facebookUrl: text('facebook_url'), xUrl: text('x_url'),
  popularDays: integer('popular_days').notNull().default(30),
  popularLimit: integer('popular_limit').notNull().default(10),
}, (t) => [check('social_settings_singleton', sql`${t.id} = true`)]);
export const adminBootstrapGrants = pgTable('admin_bootstrap_grants', {
  identifierHash: text('identifier_hash').primaryKey(),
  userId: text('user_id').notNull(),
  appliedAt: timestamp('applied_at', { withTimezone: true }),
});
export const profileFollows = pgTable('profile_follows', {
  followerId: text('follower_id').notNull().references(() => communityUsers.id),
  followedId: text('followed_id').notNull().references(() => communityUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.followerId, t.followedId] }),
  index('profile_followed_index').on(t.followedId, t.followerId),
  check('profile_follow_no_self', sql`${t.followerId} <> ${t.followedId}`)]);
export const profileUploads = pgTable('profile_uploads', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: text('owner_id').notNull().references(() => communityUsers.id),
  purpose: text('purpose').notNull(), contentType: text('content_type').notNull(), size: integer('size').notNull(),
  attached: boolean('attached').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check('profile_upload_purpose', sql`${t.purpose} IN ('avatar','cover')`)]);
export const bookReads = pgTable('book_reads', {
  bookId: uuid('book_id').notNull().references(() => authoredBooks.id, { onDelete: 'cascade' }),
  readerId: text('reader_id').notNull().references(() => communityUsers.id),
  day: date('day').notNull().default(sql`CURRENT_DATE`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.bookId, t.readerId, t.day] }), index('book_reads_recent').on(t.createdAt)]);
export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userLow: text('user_low').notNull().references(() => communityUsers.id),
  userHigh: text('user_high').notNull().references(() => communityUsers.id),
  lowTypingUntil: timestamp('low_typing_until', { withTimezone: true }),
  highTypingUntil: timestamp('high_typing_until', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('conversation_pair_unique').on(t.userLow, t.userHigh),
  check('conversation_pair_order', sql`${t.userLow} < ${t.userHigh}`)]);
export const directMessages = pgTable('direct_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  threadId: uuid('thread_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  senderId: text('sender_id').notNull().references(() => communityUsers.id),
  clientId: uuid('client_id').notNull(), body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  readAt: timestamp('read_at', { withTimezone: true }),
}, (t) => [uniqueIndex('message_idempotency').on(t.threadId, t.senderId, t.clientId),
  index('message_thread_order').on(t.threadId, t.createdAt, t.id),
  check('message_nonempty_limit', sql`length(trim(${t.body})) BETWEEN 1 AND 4000`)]);
export const socialNotifications = pgTable('social_notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  recipientId: text('recipient_id').notNull().references(() => communityUsers.id),
  actorId: text('actor_id').notNull().references(() => communityUsers.id),
  kind: text('kind').notNull(), eventKey: text('event_key').notNull(),
  threadId: uuid('thread_id').references(() => conversations.id, { onDelete: 'cascade' }),
  bookId: uuid('book_id').references(() => authoredBooks.id, { onDelete: 'cascade' }),
  read: boolean('read').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('social_notification_event').on(t.recipientId, t.eventKey)]);
