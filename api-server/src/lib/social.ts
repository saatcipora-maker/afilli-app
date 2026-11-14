import { clerkClient } from '@clerk/express';
import { createHash, randomUUID } from 'node:crypto';
import { pool } from '@workspace/db';
import type { ReaderProfile, SocialSettings } from '@workspace/api-zod';
import { fail, type Transaction } from './community';
import { publicBook } from './book-access';

// The only default official handle. All clients receive it from this configuration.
export const DEFAULT_SOCIAL_SETTINGS: SocialSettings = {
  instagramHandle: 'afilli.app', facebookUrl: null, xUrl: null, popularDays: 30, popularLimit: 10,
};
export const PERSON = `json_build_object('id',u.id,'nickname',u.nickname,'avatar',u.avatar)`;
export function personId(value: unknown) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) return fail(400, 'Geçersiz kullanıcı.');
  return value;
}
export function instagramHandle(value: string | null) {
  if (!value?.trim()) return null;
  const handle = value.trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_.]{1,30}$/.test(handle)) return fail(400, 'Instagram kullanıcı adını kontrol et.');
  return handle;
}
export function socialUrl(value: string | null, platform: 'facebook' | 'x') {
  if (!value?.trim()) return null;
  let url: URL;
  try { url = new URL(value.trim()); } catch { return fail(400, 'Geçerli bir HTTPS adresi yaz.'); }
  const hosts = platform === 'facebook' ? ['facebook.com', 'www.facebook.com', 'm.facebook.com']
    : ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'];
  if (url.protocol !== 'https:' || url.username || url.password || !hosts.includes(url.hostname) || url.port) return fail(400, 'Resmî platformun HTTPS adresini kullan.');
  return url.href;
}
export async function getSettings(): Promise<SocialSettings> {
  const existing = await pool.query<SocialSettings>(`SELECT instagram_handle AS "instagramHandle",facebook_url AS "facebookUrl",x_url AS "xUrl",
    popular_days AS "popularDays",popular_limit AS "popularLimit" FROM social_settings WHERE id=true`);
  if (existing.rows[0]) return existing.rows[0];
  const settings = DEFAULT_SOCIAL_SETTINGS;
  const result = await pool.query<SocialSettings>(`INSERT INTO social_settings(id,instagram_handle,popular_days,popular_limit)
    VALUES(true,$1,$2,$3) ON CONFLICT(id) DO UPDATE SET id=excluded.id
    RETURNING instagram_handle AS "instagramHandle",facebook_url AS "facebookUrl",x_url AS "xUrl",popular_days AS "popularDays",popular_limit AS "popularLimit"`,
  [settings.instagramHandle, settings.popularDays, settings.popularLimit]);
  return result.rows[0];
}
export async function isAdministrator(id: string) {
  const user = await clerkClient.users.getUser(id);
  return user.publicMetadata.role === 'admin';
}
export async function requireAdministrator(id: string) {
  if (!await isAdministrator(id)) return fail(403, 'Bu işlem için yönetici yetkisi gerekiyor.');
}
export async function profileData(id: string, viewer: string | null): Promise<ReaderProfile> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const handle = 'okur_' + (attempt ? randomUUID().replaceAll('-', '').slice(0, 20) : createHash('md5').update(id).digest('hex').slice(0, 12));
    try { await pool.query('UPDATE community_users SET handle=$2 WHERE id=$1 AND handle IS NULL', [id, handle]); break; }
    catch (error) { if ((error as { code?: string }).code !== '23505' || attempt === 2) throw error; }
  }
  const settings = await getSettings();
  const result = await pool.query<ReaderProfile>(`SELECT u.id,u.nickname,coalesce(u.handle,'okur_'||substr(md5(u.id),1,12)) AS handle,
    u.avatar,u.cover,u.bio,u.quote,u.instagram,
    (SELECT count(*)::int FROM authored_books b WHERE b.author_id=u.id AND
      (u.id=$2 OR ${publicBook()})) AS "bookCount",
    (SELECT count(*)::int FROM profile_follows WHERE followed_id=u.id) AS "followersCount",
    (SELECT count(*)::int FROM profile_follows WHERE follower_id=u.id) AS "followingCount",
    EXISTS(SELECT 1 FROM profile_follows WHERE followed_id=u.id AND follower_id=$2) AS following,
    (u.id=$2) IS TRUE AS "isMe",
    (u.presence_active AND u.last_seen>now()-interval '60 seconds') AS online,u.last_seen AS "lastSeen",
    EXISTS(SELECT 1 FROM conversations c WHERE
      ((c.user_low=u.id AND c.user_high=$2) OR (c.user_high=u.id AND c.user_low=$2))
      AND (CASE WHEN c.user_low=u.id THEN c.low_typing_until ELSE c.high_typing_until END)>now()) AS typing,
    EXISTS(SELECT 1 FROM (SELECT b.author_id FROM book_reads r JOIN authored_books b ON b.id=r.book_id
      WHERE r.created_at>now()-make_interval(days=>$3) AND r.reader_id<>b.author_id
      GROUP BY b.author_id ORDER BY count(*) DESC,b.author_id LIMIT $4) ranking WHERE ranking.author_id=u.id) AS popular
    FROM community_users u WHERE u.id=$1`, [id, viewer, settings.popularDays, settings.popularLimit]);
  const row = result.rows[0] ?? fail(404, 'Profil bulunamadı.');
  return { ...row, online: !!row.online, lastSeen: row.lastSeen ? new Date(row.lastSeen).toISOString() : null,
    premium: false, isAdmin: row.isMe ? await isAdministrator(id) : false };
}
export async function socialNotify(client: Transaction, recipient: string, actor: string, kind: string, event: string, threadId: string | null = null, bookId: string | null = null) {
  if (recipient === actor) return;
  await client.query(`INSERT INTO social_notifications(recipient_id,actor_id,kind,event_key,thread_id,book_id)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(recipient_id,event_key) DO UPDATE SET read=false,created_at=now()`,
  [recipient, actor, kind, event, threadId, bookId]);
}
export function pageCursor(value: unknown): { date: string | null; id: string | null } {
  if (!value) return { date: null, id: null };
  const [date, id, extra] = String(value).split('|');
  if (extra || !Number.isFinite(Date.parse(date)) || !/^[0-9a-f-]{36}$/i.test(id ?? '')) return fail(400, 'Geçersiz sayfa.');
  return { date: new Date(date).toISOString(), id };
}
