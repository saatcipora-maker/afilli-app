import { sql } from 'drizzle-orm';
import { pgTable, text, uuid, integer, boolean, timestamp, date, primaryKey, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { authoredBooks, communityUsers } from './community';

export const writerUploads = pgTable('writer_uploads', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: text('owner_id').notNull().references(() => communityUsers.id),
  contentType: text('content_type').notNull(), size: integer('size').notNull(),
  ready: boolean('ready').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // NULL is an indefinite initial offline reservation, including pre-existing uploads.
  releasedAt: timestamp('released_at', { withTimezone: true }),
  orphanedAt: timestamp('orphaned_at', { withTimezone: true }),
  deletingAt: timestamp('deleting_at', { withTimezone: true }),
});
export const writerMediaReservations = pgTable('writer_media_reservations', {
  mediaId: uuid('media_id').notNull().references(() => writerUploads.id, { onDelete: 'cascade' }),
  reservationId: uuid('reservation_id').notNull(),
  releasedAt: timestamp('released_at', { withTimezone: true }),
}, t => [primaryKey({ columns: [t.mediaId, t.reservationId] })]);
export const writerMediaRefs = pgTable('writer_media_refs', {
  mediaId: uuid('media_id').notNull().references(() => writerUploads.id, { onDelete: 'cascade' }),
  bookId: uuid('book_id').notNull().references(() => authoredBooks.id, { onDelete: 'cascade' }),
  version: text('version').notNull(),
}, t => [primaryKey({ columns: [t.mediaId, t.bookId, t.version] }),
  check('writer_media_version', sql`${t.version} IN ('draft','published')`)]);
export const writerLikes = pgTable('writer_likes', {
  bookId: uuid('book_id').notNull().references(() => authoredBooks.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => communityUsers.id),
}, t => [primaryKey({ columns: [t.bookId, t.userId] })]);
export const writerComments = pgTable('writer_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  bookId: uuid('book_id').notNull().references(() => authoredBooks.id, { onDelete: 'cascade' }),
  authorId: text('author_id').notNull().references(() => communityUsers.id),
  clientId: uuid('client_id').notNull(), chapterId: uuid('chapter_id'),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex('writer_comment_idempotency').on(t.bookId, t.authorId, t.clientId)]);
export const writerVoiceUsage = pgTable('writer_voice_usage', {
  userId: text('user_id').notNull().references(() => communityUsers.id),
  day: date('day').notNull().default(sql`CURRENT_DATE`),
  seconds: integer('seconds').notNull().default(0),
}, t => [primaryKey({ columns: [t.userId, t.day] })]);
export const writerVoiceRequests = pgTable('writer_voice_requests', {
  id: uuid('id').primaryKey(), ownerId: text('owner_id').notNull().references(() => communityUsers.id),
  audioHash: text('audio_hash'), status: text('status').notNull(),
  text: text('text'), seconds: integer('seconds').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resultExpiresAt: timestamp('result_expires_at', { withTimezone: true }),
});
export const writerBookDeletions = pgTable('writer_book_deletions', {
  bookId: uuid('book_id').primaryKey(),
  ownerId: text('owner_id').notNull().references(() => communityUsers.id),
  deletedAt: timestamp('deleted_at', { withTimezone: true }).notNull().defaultNow(),
});
