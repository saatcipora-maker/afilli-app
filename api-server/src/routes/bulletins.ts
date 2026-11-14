import { Router, type IRouter } from 'express';
import { randomUUID } from 'node:crypto';
import { pool } from '@workspace/db';
import {
  SaveCommunityProfileBody, CreateBulletinBody, UpdateBulletinBody, SetBulletinLikeBody,
  CreateBulletinCommentBody, UpdateBulletinCommentBody, SetBulletinReactionBody,
  RequestBulletinUploadBody,
} from '@workspace/api-zod';
import {
  EMOJIS, route, parse, uuid, fail, viewer, requirePerson, postOwner, transaction,
  notify, postData, reactions, commentsData, type Transaction,
} from '../lib/community';
import { bulletinObject, bulletinUploadUrl, validateBulletinObject } from '../lib/bulletin-storage';
import { publicBook } from '../lib/book-access';

const router: IRouter = Router();

router.post('/community-profile', route(async (req, res) => {
  const person = await requirePerson(req);
  const input = parse(SaveCommunityProfileBody, req.body);
  const nickname = input.nickname.trim();
  if (!nickname) return fail(400, 'Takma adını yaz.');
  const result = await pool.query('UPDATE community_users SET nickname=$2 WHERE id=$1 RETURNING *', [person.id, nickname]);
  res.json(result.rows[0]);
}));
router.get('/bulletins', route(async (req, res) => {
  let date: string | null = null, id: string | null = null;
  if (req.query.cursor) {
    const parts = String(req.query.cursor).split('|');
    if (parts.length !== 2 || !Number.isFinite(Date.parse(parts[0]))) return fail(400, 'Geçersiz sayfa.');
    date = new Date(parts[0]).toISOString(); id = uuid(parts[1]);
  }
  const result = await pool.query<{ id: string; created_at: Date }>(
    `SELECT id,created_at FROM bulletins WHERE ($1::timestamptz IS NULL OR (created_at,id)<($1::timestamptz,$2::uuid))
     ORDER BY created_at DESC,id DESC LIMIT 16`, [date, id],
  );
  const page = result.rows.slice(0, 15), last = page.at(-1);
  res.json({
    items: await postData(page.map((p) => p.id), viewer(req)),
    nextCursor: result.rows.length > 15 && last ? `${last.created_at.toISOString()}|${last.id}` : null,
  });
}));
router.get('/bulletins/:id', route(async (req, res) => {
  const id = uuid(req.params.id); await postOwner(id);
  res.json((await postData([id], viewer(req)))[0]);
}));

async function validateAttachments(client: Transaction, owner: string, photoIds: string[], bookId?: string | null, postId?: string) {
  if (new Set(photoIds).size !== photoIds.length) return fail(400, 'Aynı fotoğrafı birden fazla ekleme.');
  if (bookId) {
    uuid(bookId);
    const own = await client.query('SELECT id FROM authored_books WHERE id=$1 AND author_id=$2', [bookId, owner]);
    if (!own.rowCount) return fail(403, 'Yalnızca kendi yazdığın kitabı paylaşabilirsin.');
    const published = await client.query(`SELECT b.id FROM authored_books b WHERE b.id=$1 AND ${publicBook()}`, [bookId]);
    if (!published.rowCount) return fail(400, 'Bu kitap özel taslak. Önce Kitap Yaz sayfasından yayınla.');
  }
  for (const id of photoIds) {
    const upload = await client.query<{ owner_id: string; post_id: string | null; content_type: string; size: number }>(
      'SELECT * FROM bulletin_uploads WHERE id=$1 FOR UPDATE', [uuid(id)],
    );
    const file = upload.rows[0];
    if (!file || file.owner_id !== owner || (file.post_id && file.post_id !== postId)) return fail(403, 'Bu fotoğrafı kullanma yetkin yok.');
    try { await validateBulletinObject(id, file.content_type, file.size); }
    catch { return fail(400, 'Fotoğraf yüklenemedi veya dosya geçersiz. Tekrar dene.'); }
  }
}
router.post('/bulletins', route(async (req, res) => {
  const person = await requirePerson(req);
  const input = parse(CreateBulletinBody, req.body);
  if (!input.body.trim() && !input.photoIds.length && !input.bookId) return fail(400, 'Önce yazını yaz');
  const id = await transaction(async (client) => {
    // An idempotency lock also prevents concurrent retries from producing two posts.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [person.id + input.clientId]);
    const previous = await client.query<{ id: string }>('SELECT id FROM bulletins WHERE author_id=$1 AND client_id=$2', [person.id, input.clientId]);
    if (previous.rows[0]) return previous.rows[0].id;
    await validateAttachments(client, person.id, input.photoIds, input.bookId);
    const post = await client.query<{ id: string }>(
      'INSERT INTO bulletins(author_id,client_id,body,photo_ids,book_id) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [person.id, input.clientId, input.body.trim(), input.photoIds, input.bookId || null],
    );
    const id = post.rows[0].id;
    await client.query('UPDATE bulletin_uploads SET post_id=$1 WHERE id=ANY($2::uuid[])', [id, input.photoIds]);
    return id;
  });
  res.status(201).json((await postData([id], person.id))[0]);
}));
router.patch('/bulletins/:id', route(async (req, res) => {
  const person = await requirePerson(req), id = uuid(req.params.id);
  const input = parse(UpdateBulletinBody, req.body);
  if (!input.body.trim() && !input.photoIds.length && !input.bookId) return fail(400, 'Önce yazını yaz');
  await transaction(async (client) => {
    const result = await client.query<{ author_id: string }>('SELECT author_id FROM bulletins WHERE id=$1 FOR UPDATE', [id]);
    if (!result.rows[0]) return fail(404, 'Bülten bulunamadı.');
    if (result.rows[0].author_id !== person.id) return fail(403, 'Bu bülteni düzenleyemezsin.');
    await validateAttachments(client, person.id, input.photoIds, input.bookId, id);
    await client.query('UPDATE bulletin_uploads SET post_id=NULL WHERE post_id=$1 AND NOT(id=ANY($2::uuid[]))', [id, input.photoIds]);
    await client.query('UPDATE bulletin_uploads SET post_id=$1 WHERE id=ANY($2::uuid[])', [id, input.photoIds]);
    await client.query('UPDATE bulletins SET body=$2,photo_ids=$3,book_id=$4,updated_at=now() WHERE id=$1', [id, input.body.trim(), input.photoIds, input.bookId || null]);
  });
  res.json((await postData([id], person.id))[0]);
}));
router.delete('/bulletins/:id', route(async (req, res) => {
  const person = await requirePerson(req), id = uuid(req.params.id);
  await transaction(async (client) => {
    if (await postOwner(id, client) !== person.id) return fail(403, 'Bu bülteni silemezsin.');
    await client.query(`DELETE FROM bulletin_reactions WHERE (target_type='post' AND target_id=$1)
      OR (target_type='comment' AND target_id IN (SELECT id FROM bulletin_comments WHERE post_id=$1))`, [id]);
    await client.query('DELETE FROM bulletins WHERE id=$1 AND author_id=$2', [id, person.id]);
  });
  res.status(204).end();
}));
router.put('/bulletins/:id/like', route(async (req, res) => {
  const person = await requirePerson(req), id = uuid(req.params.id), input = parse(SetBulletinLikeBody, req.body);
  await transaction(async (client) => {
    const owner = await postOwner(id, client);
    if (input.liked) {
      const inserted = await client.query('INSERT INTO bulletin_likes(post_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING post_id', [id, person.id]);
      if (inserted.rowCount) await notify(client, owner, person.id, 'like', id);
    } else await client.query('DELETE FROM bulletin_likes WHERE post_id=$1 AND user_id=$2', [id, person.id]);
  });
  res.json((await postData([id], person.id))[0]);
}));
router.get('/bulletins/:id/likes', route(async (req, res) => {
  const id = uuid(req.params.id); await postOwner(id);
  const result = await pool.query('SELECT u.id,u.nickname,u.avatar FROM bulletin_likes l JOIN community_users u ON u.id=l.user_id WHERE post_id=$1 ORDER BY u.nickname,u.id', [id]);
  res.json(result.rows);
}));
router.get('/bulletins/:id/comments', route(async (req, res) => {
  const id = uuid(req.params.id); await postOwner(id);
  res.json(await commentsData(id, viewer(req)));
}));
router.post('/bulletins/:id/comments', route(async (req, res) => {
  const person = await requirePerson(req), postId = uuid(req.params.id);
  const input = parse(CreateBulletinCommentBody, req.body), body = input.body.trim();
  if (!body) return fail(400, 'Önce yorumunu yaz.');
  const id = await transaction(async (client) => {
    const owner = await postOwner(postId, client);
    let depth = 1, parentAuthor: string | null = null;
    if (input.parentId) {
      const result = await client.query<{ depth: number; author_id: string }>('SELECT depth,author_id FROM bulletin_comments WHERE id=$1 AND post_id=$2 AND NOT deleted FOR UPDATE', [uuid(input.parentId), postId]);
      const parent = result.rows[0];
      if (!parent) return fail(404, 'Cevaplanacak yorum bulunamadı.');
      if (parent.depth >= 3) return fail(400, 'Cevaplar en fazla üç katman olabilir.');
      depth = parent.depth + 1; parentAuthor = parent.author_id;
    }
    const result = await client.query<{ id: string }>('INSERT INTO bulletin_comments(post_id,author_id,parent_id,depth,body) VALUES($1,$2,$3,$4,$5) RETURNING id', [postId, person.id, input.parentId || null, depth, body]);
    const id = result.rows[0].id;
    await notify(client, owner, person.id, input.parentId ? 'reply' : 'comment', postId, id);
    if (parentAuthor && parentAuthor !== owner) await notify(client, parentAuthor, person.id, 'reply', postId, id);
    return id;
  });
  res.status(201).json((await commentsData(postId, person.id)).find((c) => c.id === id));
}));
router.patch('/bulletin-comments/:id', route(async (req, res) => {
  const person = await requirePerson(req), id = uuid(req.params.id), input = parse(UpdateBulletinCommentBody, req.body);
  if (!input.body.trim()) return fail(400, 'Önce yorumunu yaz.');
  const result = await pool.query<{ post_id: string }>('UPDATE bulletin_comments SET body=$3 WHERE id=$1 AND author_id=$2 AND NOT deleted RETURNING post_id', [id, person.id, input.body.trim()]);
  if (!result.rows[0]) return fail(403, 'Bu yorumu düzenleyemezsin.');
  res.json((await commentsData(result.rows[0].post_id, person.id)).find((c) => c.id === id));
}));
router.delete('/bulletin-comments/:id', route(async (req, res) => {
  const person = await requirePerson(req), id = uuid(req.params.id);
  await transaction(async (client) => {
    const result = await client.query(`UPDATE bulletin_comments c SET body='',deleted=true FROM bulletins p
      WHERE c.id=$1 AND c.post_id=p.id AND (c.author_id=$2 OR p.author_id=$2) AND NOT c.deleted RETURNING c.id`, [id, person.id]);
    if (!result.rowCount) return fail(403, 'Bu yorumu silemezsin.');
    await client.query("DELETE FROM bulletin_reactions WHERE target_type='comment' AND target_id=$1", [id]);
  });
  res.status(204).end();
}));
router.get('/bulletin-reactions', route(async (req, res) => {
  const id = uuid(req.query.targetId), type = req.query.targetType;
  if (type !== 'post' && type !== 'comment') return fail(400, 'Geçersiz tepki hedefi.');
  const result = await pool.query(`SELECT json_build_object('id',u.id,'nickname',u.nickname,'avatar',u.avatar) AS person,r.emoji
    FROM bulletin_reactions r JOIN community_users u ON u.id=r.user_id WHERE r.target_type=$1 AND r.target_id=$2 ORDER BY u.nickname,u.id`, [type, id]);
  res.json(result.rows);
}));
router.put('/bulletin-reactions', route(async (req, res) => {
  const person = await requirePerson(req), input = parse(SetBulletinReactionBody, req.body), id = uuid(input.targetId);
  if (input.emoji !== null && !EMOJIS.includes(input.emoji)) return fail(400, 'Geçersiz tepki.');
  await transaction(async (client) => {
    let postId = id;
    if (input.targetType === 'comment') {
      const result = await client.query<{ post_id: string }>('SELECT post_id FROM bulletin_comments WHERE id=$1 AND NOT deleted FOR UPDATE', [id]);
      postId = result.rows[0]?.post_id ?? fail(404, 'Yorum bulunamadı.');
    }
    const owner = await postOwner(postId, client);
    if (input.emoji === null) await client.query('DELETE FROM bulletin_reactions WHERE target_type=$1 AND target_id=$2 AND user_id=$3', [input.targetType, id, person.id]);
    else {
      await client.query(`INSERT INTO bulletin_reactions(target_type,target_id,user_id,emoji) VALUES($1,$2,$3,$4)
        ON CONFLICT(target_type,target_id,user_id) DO UPDATE SET emoji=excluded.emoji`, [input.targetType, id, person.id, input.emoji]);
      await notify(client, owner, person.id, 'reaction', postId, input.targetType === 'comment' ? id : null);
    }
  });
  res.json(await reactions(input.targetType, id, person.id));
}));
router.get('/bulletin-notifications', route(async (req, res) => {
  const person = await requirePerson(req);
  const result = await pool.query(`SELECT n.id,n.post_id AS "postId",n.comment_id AS "commentId",n.read,n.created_at AS "createdAt",
    u.nickname||', bültenine '||CASE n.kind WHEN 'like' THEN 'beğeni bıraktı' WHEN 'comment' THEN 'yorum yaptı' WHEN 'reply' THEN 'cevap verdi' ELSE 'tepki verdi' END AS body
    FROM bulletin_notifications n JOIN community_users u ON u.id=n.actor_id WHERE n.recipient_id=$1 ORDER BY n.created_at DESC,n.id DESC LIMIT 100`, [person.id]);
  res.json(result.rows);
}));
router.patch('/bulletin-notifications/:id', route(async (req, res) => {
  const person = await requirePerson(req), id = uuid(req.params.id);
  const result = await pool.query('UPDATE bulletin_notifications SET read=true WHERE id=$1 AND recipient_id=$2', [id, person.id]);
  if (!result.rowCount) return fail(404, 'Bildirim bulunamadı.');
  res.status(204).end();
}));
router.post('/bulletin-uploads', route(async (req, res) => {
  const person = await requirePerson(req), input = parse(RequestBulletinUploadBody, req.body), id = randomUUID();
  const recent = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM bulletin_uploads WHERE owner_id=$1 AND created_at>now()-interval '1 hour'", [person.id]);
  if (recent.rows[0].count >= 60) return fail(429, 'Fotoğraf yükleme sınırına ulaştın. Daha sonra tekrar dene.');
  const uploadURL = await bulletinUploadUrl(id);
  await pool.query('INSERT INTO bulletin_uploads(id,owner_id,object_path,content_type,size) VALUES($1,$2,$3,$4,$5)', [id, person.id, `bulletins/${id}`, input.contentType, input.size]);
  res.json({ id, uploadURL });
}));
router.get('/bulletin-media/:id', route(async (req, res) => {
  const id = uuid(req.params.id);
  const result = await pool.query<{ content_type: string }>('SELECT content_type FROM bulletin_uploads WHERE id=$1 AND post_id IS NOT NULL', [id]);
  if (!result.rows[0]) return fail(404, 'Fotoğraf bulunamadı.');
  res.setHeader('Content-Type', result.rows[0].content_type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const stream = bulletinObject(id).createReadStream();
  stream.on('error', () => { if (!res.headersSent) res.status(404).json({ error: 'Fotoğraf yüklenemedi.' }); else res.destroy(); });
  stream.pipe(res);
}));
export default router;
