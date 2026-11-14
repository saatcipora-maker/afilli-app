import { Router, type IRouter } from 'express';
import { pool } from '@workspace/db';
import { StartConversationBody, SendConversationMessageBody, SetConversationTypingBody, type Conversation, type DirectMessage } from '@workspace/api-zod';
import { route, requirePerson, parse, fail, uuid, transaction, type Transaction } from '../lib/community';
import { personId, PERSON, socialNotify, pageCursor } from '../lib/social';

const router: IRouter = Router();
async function member(thread: string, actor: string, client: Transaction | typeof pool = pool, lock = false) {
  const row = (await client.query<{ user_low: string; user_high: string }>(`SELECT user_low,user_high FROM conversations
    WHERE id=$1 AND (user_low=$2 OR user_high=$2) ${lock ? 'FOR UPDATE' : ''}`, [thread, actor])).rows[0];
  return row ?? fail(404, 'Konuşma bulunamadı.');
}
async function threads(actor: string, id: string | null = null): Promise<Conversation[]> {
  const result = await pool.query<Conversation>(`SELECT c.id,${PERSON} AS peer,
    (SELECT body FROM direct_messages WHERE thread_id=c.id ORDER BY created_at DESC,id DESC LIMIT 1) AS "lastMessage",
    c.updated_at AS "updatedAt",(SELECT count(*)::int FROM direct_messages WHERE thread_id=c.id AND sender_id<>$1 AND read_at IS NULL) AS "unreadCount",
    coalesce((CASE WHEN c.user_low=u.id THEN c.low_typing_until ELSE c.high_typing_until END)>now(),false) AS "peerTyping",
    coalesce(u.presence_active AND u.last_seen>now()-interval '60 seconds',false) AS "peerOnline",u.last_seen AS "peerLastSeen"
    FROM conversations c JOIN community_users u ON u.id=CASE WHEN c.user_low=$1 THEN c.user_high ELSE c.user_low END
    WHERE (c.user_low=$1 OR c.user_high=$1) AND ($2::uuid IS NULL OR c.id=$2) ORDER BY c.updated_at DESC,c.id DESC LIMIT 100`, [actor, id]);
  return result.rows.map((row) => ({ ...row, updatedAt: new Date(row.updatedAt).toISOString(), peerLastSeen: row.peerLastSeen ? new Date(row.peerLastSeen).toISOString() : null }));
}
async function messageData(ids: string[]): Promise<DirectMessage[]> {
  const rows = (await pool.query<DirectMessage>(`SELECT m.id,m.thread_id AS "threadId",${PERSON} AS sender,m.body,m.created_at AS "createdAt",m.read_at AS "readAt"
    FROM direct_messages m JOIN community_users u ON u.id=m.sender_id WHERE m.id=ANY($1::uuid[]) ORDER BY m.created_at DESC,m.id DESC`, [ids])).rows;
  return rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt).toISOString(), readAt: row.readAt ? new Date(row.readAt).toISOString() : null }));
}
router.get('/conversations', route(async (req, res) => {
  const actor = await requirePerson(req); res.json(await threads(actor.id));
}));
router.post('/conversations', route(async (req, res) => {
  const actor = await requirePerson(req), input = parse(StartConversationBody, req.body), peer = personId(input.peerId);
  if (peer === actor.id) return fail(400, 'Kendine mesaj gönderemezsin.');
  if (!(await pool.query('SELECT 1 FROM community_users WHERE id=$1', [peer])).rowCount) return fail(404, 'Profil bulunamadı.');
  const row = (await pool.query<{ id: string }>(`INSERT INTO conversations(user_low,user_high) VALUES(least($1::text,$2::text),greatest($1::text,$2::text))
    ON CONFLICT(user_low,user_high) DO UPDATE SET user_low=excluded.user_low RETURNING id`, [actor.id, peer])).rows[0];
  res.json((await threads(actor.id, row.id))[0]);
}));
router.get('/conversations/:id', route(async (req, res) => {
  const actor = await requirePerson(req), id = uuid(req.params.id); await member(id, actor.id);
  res.json((await threads(actor.id, id))[0]);
}));
router.get('/conversations/:id/messages', route(async (req, res) => {
  const actor = await requirePerson(req), id = uuid(req.params.id), cursor = pageCursor(req.query.cursor);
  await member(id, actor.id);
  const rows = (await pool.query<{ id: string; created_at: Date }>(`SELECT id,created_at FROM direct_messages WHERE thread_id=$1 AND
    ($2::timestamptz IS NULL OR (created_at,id)<($2::timestamptz,$3::uuid)) ORDER BY created_at DESC,id DESC LIMIT 31`, [id, cursor.date, cursor.id])).rows;
  const page = rows.slice(0, 30), last = page.at(-1);
  res.json({ items: await messageData(page.map((item) => item.id)), nextCursor: rows.length > 30 && last ? `${last.created_at.toISOString()}|${last.id}` : null });
}));
router.post('/conversations/:id/messages', route(async (req, res) => {
  const actor = await requirePerson(req), id = uuid(req.params.id), input = parse(SendConversationMessageBody, req.body);
  if (!input.body.trim()) return fail(400, 'Boş mesaj gönderilemez.');
  const message = await transaction(async (client) => {
    const pair = await member(id, actor.id, client, true);
    const previous = (await client.query<{ id: string }>('SELECT id FROM direct_messages WHERE thread_id=$1 AND sender_id=$2 AND client_id=$3', [id, actor.id, input.clientId])).rows[0];
    if (previous) return previous.id;
    const recent = (await client.query<{ count: number }>("SELECT count(*)::int AS count FROM direct_messages WHERE sender_id=$1 AND created_at>now()-interval '1 minute'", [actor.id])).rows[0];
    if (recent.count >= 60) return fail(429, 'Çok hızlı mesaj gönderiyorsun. Biraz bekleyip tekrar dene.');
    const row = (await client.query<{ id: string }>('INSERT INTO direct_messages(thread_id,sender_id,client_id,body) VALUES($1,$2,$3,$4) RETURNING id', [id, actor.id, input.clientId, input.body.trim()])).rows[0];
    const typing = pair.user_low === actor.id ? 'low_typing_until' : 'high_typing_until';
    await client.query(`UPDATE conversations SET updated_at=now(),${typing}=NULL WHERE id=$1`, [id]);
    const recipient = pair.user_low === actor.id ? pair.user_high : pair.user_low;
    await socialNotify(client, recipient, actor.id, 'message', 'message:' + row.id, id);
    return row.id;
  });
  res.status(201).json((await messageData([message]))[0]);
}));
router.put('/conversations/:id/read', route(async (req, res) => {
  const actor = await requirePerson(req), id = uuid(req.params.id);
  await transaction(async (client) => {
    await member(id, actor.id, client, true);
    await client.query('UPDATE direct_messages SET read_at=now() WHERE thread_id=$1 AND sender_id<>$2 AND read_at IS NULL', [id, actor.id]);
    await client.query("UPDATE social_notifications SET read=true WHERE thread_id=$1 AND recipient_id=$2 AND kind='message'", [id, actor.id]);
  });
  res.status(204).end();
}));
router.put('/conversations/:id/typing', route(async (req, res) => {
  const actor = await requirePerson(req), id = uuid(req.params.id), input = parse(SetConversationTypingBody, req.body);
  const pair = await member(id, actor.id);
  const column = pair.user_low === actor.id ? 'low_typing_until' : 'high_typing_until';
  await pool.query(`UPDATE conversations SET ${column}=CASE WHEN $2 THEN now()+interval '6 seconds' ELSE NULL END WHERE id=$1`, [id, input.typing]);
  res.status(204).end();
}));
router.get('/social-notifications', route(async (req, res) => {
  const actor = await requirePerson(req);
  const rows = (await pool.query(`SELECT n.id,n.actor_id AS "actorId",n.thread_id AS "threadId",n.book_id AS "bookId",n.read,n.created_at AS "createdAt",
    u.nickname||CASE n.kind WHEN 'message' THEN ' sana mesaj gönderdi.' WHEN 'publication' THEN ' yeni bir kitap yayımladı.' WHEN 'chapter' THEN ' yeni bir bölüm yayımladı.' ELSE ' seni takip etmeye başladı.' END AS body
    FROM social_notifications n JOIN community_users u ON u.id=n.actor_id WHERE n.recipient_id=$1 ORDER BY n.created_at DESC,n.id DESC LIMIT 100`, [actor.id])).rows;
  res.json(rows);
}));
router.patch('/social-notifications/:id', route(async (req, res) => {
  const actor = await requirePerson(req), id = uuid(req.params.id);
  const result = await pool.query('UPDATE social_notifications SET read=true WHERE id=$1 AND recipient_id=$2', [id, actor.id]);
  if (!result.rowCount) return fail(404, 'Bildirim bulunamadı.');
  res.status(204).end();
}));
export default router;
