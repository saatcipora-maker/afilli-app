import type { Request, RequestHandler } from 'express';
import { getAuth, clerkClient } from '@clerk/express';
import { pool, type PoolClient } from '@workspace/db';
import type { Bulletin, BulletinComment, CommunityPerson, AuthoredBook, BulletinReaction } from '@workspace/api-zod';
import { publicBook } from './book-access';

export const EMOJIS = ['❤️', '😍', '😂', '😮', '😢', '👏', '📖', '👍'];
export class CommunityError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const fail = (status: number, message: string): never => { throw new CommunityError(status, message); };
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return fail(400, 'Geçersiz kayıt.');
  return value;
}
export type Transaction = PoolClient;
export async function transaction<T>(fn: (client: Transaction) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
export const viewer = (req: Request) => getAuth(req).userId ?? null;
export async function requirePerson(req: Request): Promise<CommunityPerson> {
  const id = viewer(req);
  if (!id) return fail(401, 'Devam etmek için giriş yap.');
  if (req.header('X-Afilli-Actor') && req.header('X-Afilli-Actor') !== id) return fail(401, 'Hesabın değişti. İşlemi kendi hesabında yeniden dene.');
  const found = await pool.query<CommunityPerson>('SELECT id,nickname,avatar FROM community_users WHERE id=$1', [id]);
  if (found.rows[0]) return found.rows[0];
  const user = await clerkClient.users.getUser(id);
  const result = await pool.query<CommunityPerson>(
    'INSERT INTO community_users(id,nickname,avatar) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET id=excluded.id RETURNING *',
    [id, user.username || user.firstName || 'Okur', user.imageUrl || null],
  );
  return result.rows[0];
}
export const route = (fn: RequestHandler): RequestHandler => async (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  try { await fn(req, res, next); }
  catch (error) {
    if (error instanceof CommunityError) { res.status(error.status).json({ error: error.message }); return; }
    req.log.error({ errorType: error instanceof Error ? error.name : 'Unknown' }, 'Bülten işlemi başarısız');
    res.status(500).json({ error: 'İşlem tamamlanamadı. Tekrar dene.' });
  }
};
export function parse<T>(schema: { safeParse: (input: unknown) => { success: true; data: T } | { success: false } }, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) return fail(400, 'Alanları ve karakter sınırını kontrol et.');
  return result.data;
}
export async function postOwner(id: string, client: Transaction | typeof pool = pool) {
  const result = await client.query<{ author_id: string }>('SELECT author_id FROM bulletins WHERE id=$1', [id]);
  return result.rows[0]?.author_id ?? fail(404, 'Bülten bulunamadı.');
}
export async function notify(client: Transaction, recipient: string, actor: string, kind: string, postId: string, commentId: string | null = null) {
  if (recipient === actor) return;
  const eventKey = `${kind}:${postId}:${commentId ?? ''}:${actor}`;
  await client.query(
    `INSERT INTO bulletin_notifications(recipient_id,actor_id,kind,event_key,post_id,comment_id)
     VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(recipient_id,event_key)
     DO UPDATE SET read=false,created_at=now()`, [recipient, actor, kind, eventKey, postId, commentId],
  );
}
const PERSON_SQL = `json_build_object('id',u.id,'nickname',u.nickname,'avatar',u.avatar)`;
const BOOK_SQL = `json_build_object('id',b.id,'title',b.title,'body','','coverUrl',b.cover,'cover',b.published_data->>'cover',
  'published',${publicBook()},'author',json_build_object('id',bu.id,'nickname',bu.nickname,'avatar',bu.avatar))`;
export async function bookData(id: string): Promise<AuthoredBook> {
  const result = await pool.query<{ value: AuthoredBook }>(
    `SELECT ${BOOK_SQL} AS value FROM authored_books b JOIN community_users bu ON bu.id=b.author_id WHERE b.id=$1`, [id],
  );
  return result.rows[0]?.value ?? fail(404, 'Kitap bulunamadı.');
}
export async function reactions(type: string, id: string, userId: string | null): Promise<BulletinReaction[]> {
  const result = await pool.query<BulletinReaction>(
    `SELECT emoji,count(*)::int AS count,coalesce(bool_or(user_id=$3),false) AS selected FROM bulletin_reactions
     WHERE target_type=$1 AND target_id=$2 GROUP BY emoji ORDER BY emoji`, [type, id, userId],
  );
  return result.rows;
}
export async function postData(ids: string[], userId: string | null): Promise<Bulletin[]> {
  if (!ids.length) return [];
  const result = await pool.query<Bulletin & { createdAt: Date; updatedAt: Date }>(
    `SELECT p.id,${PERSON_SQL} AS author,p.body,
      coalesce((SELECT json_agg(json_build_object('id',x.id,'url','/api/bulletin-media/'||x.id) ORDER BY x.ord)
       FROM unnest(p.photo_ids) WITH ORDINALITY x(id,ord)),'[]') AS photos,
      CASE WHEN b.id IS NULL THEN NULL ELSE ${BOOK_SQL} END AS book,
      p.created_at AS "createdAt",p.updated_at AS "updatedAt",
      (SELECT count(*)::int FROM bulletin_likes l WHERE l.post_id=p.id) AS "likeCount",
      EXISTS(SELECT 1 FROM bulletin_likes l WHERE l.post_id=p.id AND l.user_id=$2) AS liked,
      (SELECT count(*)::int FROM bulletin_comments c WHERE c.post_id=p.id AND NOT c.deleted) AS "commentCount",
      (p.author_id=$2) IS TRUE AS "canEdit"
     FROM bulletins p JOIN community_users u ON u.id=p.author_id
     LEFT JOIN authored_books b ON b.id=p.book_id AND (b.author_id=$2 OR ${publicBook()}) LEFT JOIN community_users bu ON bu.id=b.author_id
     WHERE p.id=ANY($1::uuid[]) ORDER BY p.created_at DESC,p.id DESC`, [ids, userId],
  );
  return Promise.all(result.rows.map(async (row) => ({
    ...row, createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString(),
    reactions: await reactions('post', row.id, userId),
  })));
}
export async function commentsData(postId: string, userId: string | null): Promise<BulletinComment[]> {
  const result = await pool.query<BulletinComment & { createdAt: Date }>(
    `SELECT c.id,c.post_id AS "postId",${PERSON_SQL} AS author,c.parent_id AS "parentId",c.depth,c.body,c.deleted,
       c.created_at AS "createdAt",(c.author_id=$2 AND NOT c.deleted) IS TRUE AS "canEdit",
       ((c.author_id=$2 OR p.author_id=$2) AND NOT c.deleted) IS TRUE AS "canDelete"
     FROM bulletin_comments c JOIN community_users u ON u.id=c.author_id JOIN bulletins p ON p.id=c.post_id
     WHERE c.post_id=$1 ORDER BY c.created_at,c.id`, [postId, userId],
  );
  return Promise.all(result.rows.map(async (row) => ({
    ...row, createdAt: new Date(row.createdAt).toISOString(), reactions: await reactions('comment', row.id, userId),
  })));
}
