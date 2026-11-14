import { sql } from 'drizzle-orm';
import { pgTable, text, uuid, timestamp, integer, boolean, primaryKey, uniqueIndex, index, check, jsonb } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

export const communityUsers = pgTable('community_users', {
  id: text('id').primaryKey(), nickname: text('nickname').notNull(), avatar: text('avatar'),
  handle: text('handle'), bio: text('bio').notNull().default(''),
  quote: text('quote').notNull().default(''), instagram: text('instagram'), cover: text('cover'),
  lastSeen: timestamp('last_seen', { withTimezone: true }),
  presenceActive: boolean('presence_active').notNull().default(false),
}, (t) => [uniqueIndex('community_handle_unique').on(t.handle)]);
export const authoredBooks = pgTable('authored_books', {
  id: uuid('id').defaultRandom().primaryKey(),
  authorId: text('author_id').notNull().references(() => communityUsers.id),
  localId: text('local_id').notNull(), title: text('title').notNull(), body: text('body').notNull(),
  cover: text('cover'), genre: text('genre'), createdAt: timestamp('created_at', { withTimezone: true }),
  writerData: jsonb('writer_data'), publishedData: jsonb('published_data'),
  writerRevision: integer('writer_revision').notNull().default(0),
  publication: text('publication').notNull().default('draft'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  writerUpdatedAt: timestamp('writer_updated_at', { withTimezone: true }),
  lastSaveId: uuid('last_save_id'), lastSaveHash: text('last_save_hash'),
}, (t) => [uniqueIndex('authored_books_owner_local').on(t.authorId, t.localId)]);
export const bulletins = pgTable('bulletins', {
  id: uuid('id').defaultRandom().primaryKey(),
  authorId: text('author_id').notNull().references(() => communityUsers.id),
  clientId: uuid('client_id').notNull(), body: text('body').notNull(),
  photoIds: uuid('photo_ids').array().notNull().default(sql`'{}'::uuid[]`),
  bookId: uuid('book_id').references(() => authoredBooks.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('bulletins_owner_client').on(t.authorId, t.clientId),
  index('bulletins_feed_order').on(t.createdAt, t.id),
  index('bulletins_book_reference').on(t.bookId),
  check('bulletins_photo_limit', sql`cardinality(${t.photoIds}) <= 4`),
  check('bulletins_not_empty', sql`length(trim(${t.body})) > 0 OR cardinality(${t.photoIds}) > 0 OR ${t.bookId} IS NOT NULL`),
]);
export const bulletinUploads = pgTable('bulletin_uploads', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerId: text('owner_id').notNull().references(() => communityUsers.id),
  postId: uuid('post_id').references(() => bulletins.id, { onDelete: 'cascade' }),
  objectPath: text('object_path').notNull(), contentType: text('content_type').notNull(),
  size: integer('size').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const bulletinLikes = pgTable('bulletin_likes', {
  postId: uuid('post_id').notNull().references(() => bulletins.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => communityUsers.id),
}, (t) => [primaryKey({ columns: [t.postId, t.userId] })]);
export const bulletinComments = pgTable('bulletin_comments', {
  id: uuid('id').defaultRandom().primaryKey(),
  postId: uuid('post_id').notNull().references(() => bulletins.id, { onDelete: 'cascade' }),
  authorId: text('author_id').notNull().references(() => communityUsers.id),
  parentId: uuid('parent_id'), depth: integer('depth').notNull().default(1),
  body: text('body').notNull(), deleted: boolean('deleted').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('bulletin_comments_thread').on(t.postId, t.createdAt), check('bulletin_reply_depth', sql`${t.depth} BETWEEN 1 AND 3`)]);
export const bulletinReactions = pgTable('bulletin_reactions', {
  targetType: text('target_type').notNull(), targetId: uuid('target_id').notNull(),
  userId: text('user_id').notNull().references(() => communityUsers.id), emoji: text('emoji').notNull(),
}, (t) => [
  primaryKey({ columns: [t.targetType, t.targetId, t.userId] }),
  check('bulletin_reaction_target', sql`${t.targetType} IN ('post','comment')`),
  check('bulletin_reaction_emoji', sql`${t.emoji} IN ('❤️','😍','😂','😮','😢','👏','📖','👍')`),
]);
export const bulletinNotifications = pgTable('bulletin_notifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  recipientId: text('recipient_id').notNull().references(() => communityUsers.id),
  actorId: text('actor_id').notNull().references(() => communityUsers.id),
  kind: text('kind').notNull(), eventKey: text('event_key').notNull(),
  postId: uuid('post_id').notNull().references(() => bulletins.id, { onDelete: 'cascade' }),
  commentId: uuid('comment_id'), read: boolean('read').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('bulletin_notification_event').on(t.recipientId, t.eventKey)]);

export const insertCommunityUserSchema = createInsertSchema(communityUsers);
export const insertAuthoredBookSchema = createInsertSchema(authoredBooks);
export const insertBulletinSchema = createInsertSchema(bulletins);
export const insertBulletinCommentSchema = createInsertSchema(bulletinComments);
export type CommunityUserRow = typeof communityUsers.$inferSelect;
export type BulletinRow = typeof bulletins.$inferSelect;
