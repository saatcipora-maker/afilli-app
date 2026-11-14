import { Router, type IRouter } from 'express';
import { randomUUID } from 'node:crypto';
import { pool } from '@workspace/db';
import { UpdateMyProfileBody, SetProfileFollowBody, UpdateSocialSettingsBody, UpdatePresenceBody, RequestProfileUploadBody, type ProfileBook } from '@workspace/api-zod';
import { route, parse, fail, viewer, requirePerson, transaction, uuid, postData } from '../lib/community';
import { PERSON, personId, profileData, getSettings, instagramHandle, socialUrl, requireAdministrator, socialNotify, pageCursor } from '../lib/social';
import { profileObject, profileUploadUrl, validateProfileObject } from '../lib/bulletin-storage';
import { publicBook } from '../lib/book-access';

const router: IRouter = Router();
router.get('/social-settings', route(async (_req, res) => { res.json(await getSettings()); }));
router.put('/social-settings', route(async (req, res) => {
  const actor = await requirePerson(req); await requireAdministrator(actor.id);
  const input = parse(UpdateSocialSettingsBody, req.body);
  const handle = instagramHandle(input.instagramHandle) ?? fail(400, 'Resmî Instagram kullanıcı adını yaz.');
  await pool.query(`UPDATE social_settings SET instagram_handle=$1,facebook_url=$2,x_url=$3,popular_days=$4,popular_limit=$5 WHERE id=true`,
    [handle, socialUrl(input.facebookUrl, 'facebook'), socialUrl(input.xUrl, 'x'), input.popularDays, input.popularLimit]);
  res.json(await getSettings());
}));
router.get('/my-profile', route(async (req, res) => {
  const actor = await requirePerson(req); res.json(await profileData(actor.id, actor.id));
}));
router.patch('/my-profile', route(async (req, res) => {
  const actor = await requirePerson(req), input = parse(UpdateMyProfileBody, req.body);
  const nickname = input.nickname.trim(), handle = input.handle.trim().replace(/^@/, '').toLowerCase();
  if (!nickname || !/^[a-z0-9_.]{3,30}$/.test(handle)) return fail(400, 'Takma adını ve 3–30 karakterlik kullanıcı adını kontrol et.');
  const instagram = instagramHandle(input.instagram);
  try {
    await transaction(async (client) => {
      const before = (await client.query<{ avatar: string | null; cover: string | null }>('SELECT avatar,cover FROM community_users WHERE id=$1 FOR UPDATE', [actor.id])).rows[0];
      const values: Record<'avatar' | 'cover', string | null> = { avatar: before.avatar, cover: before.cover };
      for (const purpose of ['avatar', 'cover'] as const) {
        const id = purpose === 'avatar' ? input.avatarUploadId : input.coverUploadId;
        if (id === undefined) continue;
        let url: string | null = null;
        if (id !== null) {
          const upload = (await client.query<{ content_type: string; size: number }>('SELECT content_type,size FROM profile_uploads WHERE id=$1 AND owner_id=$2 AND purpose=$3 FOR UPDATE', [uuid(id), actor.id, purpose])).rows[0];
          if (!upload) return fail(403, 'Bu fotoğrafı kullanma yetkin yok.');
          try { await validateProfileObject(id, upload.content_type, upload.size); }
          catch { return fail(400, 'Fotoğraf yüklenemedi veya dosya geçersiz. Tekrar dene.'); }
          await client.query('UPDATE profile_uploads SET attached=true WHERE id=$1', [id]);
          url = '/api/profile-media/' + id;
        }
        if (before[purpose] && before[purpose] !== url && before[purpose]?.startsWith('/api/profile-media/')) {
          const oldId = before[purpose]!.split('/').at(-1)!;
          await client.query('UPDATE profile_uploads SET attached=false WHERE id=$1 AND owner_id=$2', [oldId, actor.id]);
        }
        values[purpose] = url;
      }
      await client.query(`UPDATE community_users SET nickname=$2,handle=$3,bio=$4,quote=$5,instagram=$6,avatar=$7,cover=$8 WHERE id=$1`,
        [actor.id, nickname, handle, input.bio.trim(), input.quote.trim(), instagram, values.avatar, values.cover]);
    });
  } catch (error) {
    if ((error as { code?: string }).code === '23505') return fail(409, 'Bu kullanıcı adı zaten kullanılıyor.');
    throw error;
  }
  res.json(await profileData(actor.id, actor.id));
}));
router.get('/profiles', route(async (req, res) => {
  const search = String(req.query.search ?? '').trim().slice(0, 100).replace(/[%_\\]/g, '\\$&');
  const cursor = req.query.cursor ? personId(req.query.cursor) : null;
  const rows = (await pool.query(`SELECT u.id,u.nickname,u.avatar FROM community_users u
    WHERE (u.nickname ILIKE $1 OR coalesce(u.handle,'') ILIKE $1) AND ($2::text IS NULL OR u.id<$2) ORDER BY u.id DESC LIMIT 31`, ['%' + search + '%', cursor])).rows;
  const items = rows.slice(0, 30);
  res.json({ items, nextCursor: rows.length > 30 ? items.at(-1).id : null });
}));
router.get('/profiles/:id', route(async (req, res) => { res.json(await profileData(personId(req.params.id), viewer(req))); }));
router.put('/profiles/:id/follow', route(async (req, res) => {
  const actor = await requirePerson(req), id = personId(req.params.id), input = parse(SetProfileFollowBody, req.body);
  if (id === actor.id) return fail(400, 'Kendini takip edemezsin.');
  if (!(await pool.query('SELECT 1 FROM community_users WHERE id=$1', [id])).rowCount) return fail(404, 'Profil bulunamadı.');
  await transaction(async (client) => {
    if (input.following) {
      const created = await client.query('INSERT INTO profile_follows(follower_id,followed_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING follower_id', [actor.id, id]);
      if (created.rowCount) await socialNotify(client, id, actor.id, 'follow', 'follow:' + actor.id);
    } else await client.query('DELETE FROM profile_follows WHERE follower_id=$1 AND followed_id=$2', [actor.id, id]);
  });
  res.json(await profileData(id, actor.id));
}));
router.get('/profiles/:id/connections', route(async (req, res) => {
  const id = personId(req.params.id), kind = req.query.kind;
  if (kind !== 'followers' && kind !== 'following') return fail(400, 'Liste türünü seç.');
  const cursor = req.query.cursor ? personId(req.query.cursor) : null;
  const ownerColumn = kind === 'followers' ? 'followed_id' : 'follower_id';
  const peerColumn = kind === 'followers' ? 'follower_id' : 'followed_id';
  const rows = (await pool.query(`SELECT u.id,u.nickname,u.avatar FROM profile_follows f JOIN community_users u ON u.id=f.${peerColumn}
    WHERE f.${ownerColumn}=$1 AND ($2::text IS NULL OR u.id<$2) ORDER BY u.id DESC LIMIT 31`, [id, cursor])).rows;
  const items = rows.slice(0, 30);
  res.json({ items, nextCursor: rows.length > 30 ? items.at(-1).id : null });
}));
router.get('/profiles/:id/content', route(async (req, res) => {
  const id = personId(req.params.id), uid = viewer(req), tab = req.query.tab;
  if (tab === 'books') {
    const cursor = req.query.cursor ? uuid(req.query.cursor) : null;
    const rows = (await pool.query<ProfileBook>(`SELECT b.id,b.title,${PERSON} AS author,b.cover,b.genre,extract(year from b.created_at)::int AS year,
      (SELECT count(*)::int FROM book_reads WHERE book_id=b.id) AS "readCount",
      ${publicBook()} AS "isPublic"
      FROM authored_books b JOIN community_users u ON u.id=b.author_id WHERE b.author_id=$1 AND
      ($1=$2 OR ${publicBook()}) AND ($3::uuid IS NULL OR b.id<$3)
      ORDER BY b.id DESC LIMIT 16`, [id, uid, cursor])).rows;
    const books = rows.slice(0, 15);
    return res.json({ books, bulletins: [], nextCursor: rows.length > 15 ? books.at(-1)!.id : null });
  }
  if (tab !== 'bulletins' && tab !== 'liked') return fail(400, 'İçerik türünü seç.');
  const cursor = pageCursor(req.query.cursor);
  const condition = tab === 'bulletins' ? 'p.author_id=$1' : 'EXISTS(SELECT 1 FROM bulletin_likes l WHERE l.post_id=p.id AND l.user_id=$1)';
  const rows = (await pool.query<{ id: string; created_at: Date }>(`SELECT p.id,p.created_at FROM bulletins p WHERE ${condition}
    AND ($2::timestamptz IS NULL OR (p.created_at,p.id)<($2::timestamptz,$3::uuid)) ORDER BY p.created_at DESC,p.id DESC LIMIT 16`, [id, cursor.date, cursor.id])).rows;
  const page = rows.slice(0, 15), last = page.at(-1);
  return res.json({ books: [], bulletins: await postData(page.map((p) => p.id), uid), nextCursor: rows.length > 15 && last ? `${last.created_at.toISOString()}|${last.id}` : null });
}));
router.post('/presence', route(async (req, res) => {
  const actor = await requirePerson(req), input = parse(UpdatePresenceBody, req.body);
  await pool.query('UPDATE community_users SET presence_active=$2,last_seen=now() WHERE id=$1', [actor.id, input.active]);
  res.status(204).end();
}));
router.post('/profile-uploads', route(async (req, res) => {
  const actor = await requirePerson(req), input = parse(RequestProfileUploadBody, req.body), id = randomUUID();
  const recent = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM profile_uploads WHERE owner_id=$1 AND created_at>now()-interval '1 hour'", [actor.id]);
  if (recent.rows[0].count >= 30) return fail(429, 'Fotoğraf yükleme sınırına ulaştın. Daha sonra tekrar dene.');
  const uploadURL = await profileUploadUrl(id);
  await pool.query('INSERT INTO profile_uploads(id,owner_id,purpose,content_type,size) VALUES($1,$2,$3,$4,$5)', [id, actor.id, input.purpose, input.contentType, input.size]);
  res.json({ id, uploadURL });
}));
router.get('/profile-media/:id', route(async (req, res) => {
  const id = uuid(req.params.id);
  const image = (await pool.query<{ content_type: string }>('SELECT content_type FROM profile_uploads WHERE id=$1 AND attached', [id])).rows[0];
  if (!image) return fail(404, 'Fotoğraf bulunamadı.');
  res.setHeader('Content-Type', image.content_type); res.setHeader('X-Content-Type-Options', 'nosniff');
  const stream = profileObject(id).createReadStream();
  stream.on('error', () => { if (!res.headersSent) res.status(404).json({ error: 'Fotoğraf yüklenemedi.' }); else res.destroy(); });
  res.on('close', () => stream.destroy()); stream.pipe(res);
}));
export default router;
