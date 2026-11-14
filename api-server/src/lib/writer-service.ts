import { pool } from '@workspace/db';
import type { AuthoredBook, WriterDocument, WriterSaveInput, WriterDeltaInput, WriterSaveAck, WriterPublicationInput, WriterSummary } from '@workspace/api-zod';
import { createHash } from 'node:crypto';
import { fail, type Transaction } from './community';
import { publicBook } from './book-access';
import { coverUrl, deltaMediaIds, legacyDocument, mediaIds, normalizeDocument, plain, validatePublication, writerBook, type WriterRow } from './writer-document';

type Db = Transaction | typeof pool;
export async function writerRow(id: string, db: Db = pool, lock = false): Promise<WriterRow> {
  const result = await db.query<WriterRow>(`SELECT b.*,(b.writer_data IS NULL AND EXISTS(SELECT 1 FROM bulletins WHERE book_id=b.id)) AS legacy_public
    FROM authored_books b WHERE b.id=$1 ${lock ? 'FOR UPDATE OF b' : ''}`, [id]);
  return result.rows[0] ?? fail(404, 'Kitap bulunamadı.');
}
export async function ownWriter(id: string, owner: string, db: Db = pool, lock = false) {
  const row = await writerRow(id, db, lock);
  if (row.author_id !== owner) return fail(404, 'Taslak bulunamadı.');
  return row;
}
export function isPublished(row: WriterRow) { return row.publication === 'published' || row.legacy_public; }
export async function syncMediaRefs(db: Transaction, bookId: string, owner: string, version: 'draft' | 'published', doc: WriterDocument) {
  const ids = mediaIds(doc);
  if (ids.length) {
    const result = await db.query<{ id: string }>('SELECT id FROM writer_uploads WHERE owner_id=$1 AND ready AND deleting_at IS NULL AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE', [owner, ids]);
    if (result.rowCount !== ids.length) return fail(403, 'Görsel yüklemesi tamamlanmadı veya bu görsel sana ait değil.');
    await db.query('UPDATE writer_uploads SET orphaned_at=NULL WHERE id=ANY($1::uuid[]) AND orphaned_at IS NOT NULL', [ids]);
  }
  await db.query('DELETE FROM writer_media_refs WHERE book_id=$1 AND version=$2', [bookId, version]);
  if (ids.length) await db.query(`INSERT INTO writer_media_refs(media_id,book_id,version) SELECT unnest($1::uuid[]),$2,$3`, [ids, bookId, version]);
}
/** Existing refs protect untouched chapters. Only inspect the full document when
 * a removed image might still be used by an unchanged chapter or the cover. */
async function syncDeltaMediaRefs(db: Transaction, row: WriterRow, owner: string, document: WriterDocument, delta: WriterDeltaInput) {
  const { next: nextIds, removed } = deltaMediaIds(row.writer_data!, document, delta.upserts.map(ch => ch.id), delta.deletedChapterIds);
  // Same upload-row locks and checks as full saves, before modifying any refs.
  if (nextIds.length) {
    const uploads = await db.query('SELECT id FROM writer_uploads WHERE owner_id=$1 AND ready AND deleting_at IS NULL AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE', [owner, nextIds]);
    if (uploads.rowCount !== nextIds.length) return fail(403, 'Görsel yüklemesi tamamlanmadı veya bu görsel sana ait değil.');
    await db.query('UPDATE writer_uploads SET orphaned_at=NULL WHERE id=ANY($1::uuid[]) AND orphaned_at IS NOT NULL', [nextIds]);
  }
  if (removed.length) await db.query('DELETE FROM writer_media_refs WHERE book_id=$1 AND version=$2 AND media_id=ANY($3::uuid[])', [row.id, 'draft', removed]);
  if (nextIds.length) await db.query(`INSERT INTO writer_media_refs(media_id,book_id,version)
    SELECT unnest($1::uuid[]),$2,'draft' ON CONFLICT DO NOTHING`, [nextIds, row.id]);
}
export async function saveWriter(db: Transaction, id: string, owner: string, input: WriterSaveInput) {
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`writer-book:${id}`]);
  const deleted = (await db.query<{ owner_id: string }>('SELECT owner_id FROM writer_book_deletions WHERE book_id=$1', [id])).rows[0];
  if (deleted) return fail(deleted.owner_id === owner ? 410 : 404, 'Bu kitap sunucuda silinmiş. Cihazındaki metni yeni bir taslağa kopyalayabilirsin.');
  const document = normalizeDocument(input.document);
  const hash = createHash('sha256').update(JSON.stringify([input.expectedRevision, document])).digest('hex');
  if (input.expectedRevision === 0) {
    await db.query(`INSERT INTO authored_books(id,author_id,local_id,title,body,created_at)
      VALUES($1,$2,$3,'','',now()) ON CONFLICT DO NOTHING`, [id, owner, input.localId ?? id]);
  }
  const row = await ownWriter(id, owner, db, true);
  if (row.last_save_id === input.saveId) {
    if (row.last_save_hash !== hash) return fail(409, 'Bu kayıt kimliği başka içerikle kullanılmış. Yerel sürümünü koruyup yeniden dene.');
    return writerBook(row);
  }
  if (row.writer_revision !== input.expectedRevision) return fail(409, 'Başka bir cihazda değişiklik var. Yerel metnin korunuyor; sürümleri karşılaştır.');
  return persistWriter(db, row, owner, document, input.saveId, hash);
}

/** The patch identity is hashed independently of the current document, so lost-response
 * retries can be acknowledged BEFORE attempting to merge against the now-newer revision. */
export async function patchWriter(db: Transaction, id: string, owner: string, input: WriterDeltaInput): Promise<WriterSaveAck> {
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`writer-book:${id}`]);
  const deleted = (await db.query<{ owner_id: string }>('SELECT owner_id FROM writer_book_deletions WHERE book_id=$1', [id])).rows[0];
  if (deleted) return fail(deleted.owner_id === owner ? 410 : 404, 'Bu kitap sunucuda silinmiş.');
  const row = await ownWriter(id, owner, db, true);
  const hash = createHash('sha256').update(JSON.stringify(['chapter-delta-v1', input.expectedRevision,
    input.metadata ?? null, input.upserts, input.deletedChapterIds, input.chapterOrder ?? null])).digest('hex');
  const ack = (saved: WriterRow): WriterSaveAck => ({ id, saveId: input.saveId, revision: saved.writer_revision,
    updatedAt: saved.writer_updated_at?.toISOString() ?? null });
  if (row.last_save_id === input.saveId) {
    if (row.last_save_hash !== hash) return fail(409, 'Bu kayıt kimliği başka içerikle kullanılmış.');
    return ack(row);
  }
  if (row.writer_revision !== input.expectedRevision) return fail(409, 'Başka bir cihazda değişiklik var. Yerel metnin korunuyor; sürümleri karşılaştır.');
  const base = row.writer_data ?? legacyDocument(row);
  const removed = new Set(input.deletedChapterIds);
  const upsertIds = new Set(input.upserts.map(c => c.id));
  if (upsertIds.size !== input.upserts.length || removed.size !== input.deletedChapterIds.length
    || input.upserts.some(c => removed.has(c.id)) || input.deletedChapterIds.some(id => !base.chapters.some(c => c.id === id))) {
    return fail(400, 'Bölüm değişiklikleri tutarsız.');
  }
  const structural = removed.size > 0 || input.upserts.some(c => !base.chapters.some(old => old.id === c.id));
  if (structural && input.chapterOrder === undefined) return fail(400, 'Bölüm eklerken veya silerken son sıralamayı gönder.');
  // Only changed HTML is sanitized again. Existing chapters already passed validation.
  const normalized = normalizeDocument({ ...base, ...input.metadata, chapters: input.upserts });
  const chapters = new Map(base.chapters.filter(c => !removed.has(c.id)).map(c => [c.id, c]));
  normalized.chapters.forEach(c => chapters.set(c.id, c));
  const order = input.chapterOrder ?? base.chapters.map(c => c.id);
  if (chapters.size > 200 || order.length !== chapters.size || new Set(order).size !== order.length || order.some(id => !chapters.has(id))) {
    return fail(400, 'Bölüm sıralaması kitaptaki her bölümü tam bir kez içermeli.');
  }
  const document: WriterDocument = { ...normalized, chapters: order.map(id => chapters.get(id)!) };
  const saved = await persistWriter(db, row, owner, document, input.saveId, hash, input);
  return { id, saveId: input.saveId, revision: saved.revision, updatedAt: saved.updatedAt };
}

/** Full and delta saves share publication, media authorization and atomic revision semantics. */
async function persistWriter(db: Transaction, row: WriterRow, owner: string, document: WriterDocument, saveId: string, hash: string, delta?: WriterDeltaInput) {
  const id = row.id;
  const published = isPublished(row);
  const snapshot = row.published_data ?? (published ? legacyDocument(row) : null);
  if (delta && row.writer_data) await syncDeltaMediaRefs(db, row, owner, document, delta);
  else await syncMediaRefs(db, id, owner, 'draft', document);
  if (snapshot && row.writer_data === null) await syncMediaRefs(db, id, owner, 'published', snapshot);
  const params: unknown[] = [id, saveId, hash];
  const bind = (value: unknown) => { params.push(value); return `$${params.length}`; };
  let draftSql: string;
  // jsonb_set still rewrites the draft's TOAST value, but avoids transferring the
  // entire book to PostgreSQL. Bound nesting for bulk/structural edits.
  if (delta && row.writer_data && !delta.chapterOrder && !delta.deletedChapterIds.length
    && delta.upserts.length <= 8 && delta.upserts.every(ch => row.writer_data!.chapters.some(old => old.id === ch.id))) {
    draftSql = 'writer_data';
    for (const chapter of delta.upserts) {
      const index = row.writer_data.chapters.findIndex(ch => ch.id === chapter.id);
      draftSql = `jsonb_set(${draftSql},${bind(['chapters', String(index)])}::text[],${bind(document.chapters[index])}::jsonb)`;
    }
    if (delta.metadata) {
      const { chapters: _chapters, ...metadata } = document;
      draftSql = `(${draftSql} || ${bind(metadata)}::jsonb)`;
    }
  } else draftSql = bind(document);
  const assignments = [`writer_data=${draftSql}`, 'writer_revision=writer_revision+1',
    'writer_updated_at=now()', 'last_save_id=$2', 'last_save_hash=$3'];
  // A release is immutable during autosave. Even an equal JSONB parameter would
  // create new TOAST/WAL data; leave the columns out of UPDATE altogether.
  if (row.writer_data === null) {
    assignments.push(`published_data=${bind(snapshot)}`, `publication=${bind(published ? 'published' : 'draft')}`);
  }
  if (!published || !snapshot) {
    // Draft readers already derive body from writer_data. The legacy body is
    // only authoritative before migration, or as the last released projection.
    const display = { title: document.title, cover: coverUrl(document.cover), genre: document.genres.join(' · ') || null };
    for (const key of ['title', 'cover', 'genre'] as const) {
      if (display[key] !== row[key]) assignments.push(`${key}=${bind(display[key])}`);
    }
  }
  const result = await db.query<Pick<WriterRow, 'writer_revision' | 'writer_updated_at'>>(`UPDATE authored_books SET ${assignments.join(',')}
    WHERE id=$1 RETURNING writer_revision,writer_updated_at`, params);
  // The normalized draft is already in memory; do not SELECT and parse both
  // multi-megabyte documents again just to return a revision acknowledgement.
  return writerBook({ ...row, ...result.rows[0], writer_data: document, publication: published ? 'published' : 'draft' });
}
export async function librarySummaries(owner: string): Promise<WriterSummary[]> {
  const rows = await pool.query<Omit<WriterSummary, 'coverUrl' | 'updatedAt'> & { cover_ref: string | null; saved_at: Date | null }>(`SELECT
    b.id,b.local_id AS "localId",CASE WHEN b.writer_data IS NULL THEN b.title ELSE b.writer_data->>'title' END AS title,
    CASE WHEN b.writer_data IS NULL THEN b.cover ELSE b.writer_data->>'cover' END AS cover_ref,
    CASE WHEN ${publicBook()} THEN 'published' ELSE 'draft' END AS publication,
    CASE WHEN b.writer_data IS NULL THEN greatest(1,ceil(length(b.body)::numeric/50000))::int ELSE jsonb_array_length(b.writer_data->'chapters') END AS "chapterCount",
    b.writer_revision AS revision,b.writer_updated_at AS saved_at
    FROM authored_books b WHERE b.author_id=$1 ORDER BY b.writer_updated_at DESC NULLS LAST,b.id DESC`, [owner]);
  return rows.rows.map(({ cover_ref, saved_at, ...row }) => ({ ...row, coverUrl: coverUrl(cover_ref), updatedAt: saved_at?.toISOString() ?? null }));
}
export async function authoredCards(owner: string | null): Promise<AuthoredBook[]> {
  // Project scalar metadata in SQL: a feed must never transfer entire manuscripts.
  const rows = await pool.query<AuthoredBook>(`SELECT b.id,
    b.title AS title,
    '' AS body,json_build_object('id',u.id,'nickname',u.nickname,'avatar',u.avatar) AS author,
    b.cover AS "coverUrl",(${publicBook()}) AS published,
    coalesce((CASE WHEN ${publicBook()} THEN b.published_data ELSE b.writer_data END)->>'cover',b.cover) AS cover,
    coalesce((CASE WHEN ${publicBook()} THEN b.published_data ELSE b.writer_data END)->>'description','') AS description,
    coalesce((CASE WHEN ${publicBook()} THEN b.published_data ELSE b.writer_data END)->'genres','[]'::jsonb) AS genres,
    coalesce((CASE WHEN ${publicBook()} THEN b.published_data ELSE b.writer_data END)->>'ageRating','all') AS "ageRating",
    coalesce((CASE WHEN ${publicBook()} THEN b.published_data ELSE b.writer_data END)->>'language','Türkçe') AS language,
    coalesce((CASE WHEN ${publicBook()} THEN b.published_data ELSE b.writer_data END)->>'completion','ongoing') AS completion,
    b.published_at AS "publishedAt",'[]'::json AS chapters,(b.author_id=$1) IS TRUE AS "canEdit",
    (SELECT count(*)::int FROM book_reads WHERE book_id=b.id) AS "readCount",
    (SELECT count(*)::int FROM writer_likes WHERE book_id=b.id) AS "likeCount",
    (SELECT count(*)::int FROM writer_comments WHERE book_id=b.id) AS "commentCount",
    EXISTS(SELECT 1 FROM writer_likes WHERE book_id=b.id AND user_id=$1) AS liked
    FROM authored_books b JOIN community_users u ON u.id=b.author_id
    WHERE CASE WHEN $1::text IS NULL THEN ${publicBook()} ELSE b.author_id=$1 END
    ORDER BY b.published_at DESC NULLS LAST,b.writer_updated_at DESC NULLS LAST,b.id DESC
    LIMIT CASE WHEN $1::text IS NULL THEN 100 ELSE NULL END`, [owner]);
  return rows.rows.map(row => ({ ...row, coverUrl: coverUrl(row.cover) }));
}
async function notifyReaders(db: Transaction, row: WriterRow, before: WriterDocument | null, after: WriterDocument) {
  const fresh = !before ? ['book'] : after.chapters.filter(ch => !before.chapters.some(old => old.id === ch.id)).map(ch => `chapter:${ch.id}`);
  for (const event of fresh) await db.query(`INSERT INTO social_notifications(recipient_id,actor_id,kind,event_key,book_id)
    SELECT follower_id,$1,$2,$3,$4 FROM profile_follows WHERE followed_id=$1 AND follower_id<>$1
    ON CONFLICT(recipient_id,event_key) DO NOTHING`,
  [row.author_id, event === 'book' ? 'publication' : 'chapter', `writer:${row.id}:${event}`, row.id]);
}
export async function publishWriter(db: Transaction, id: string, owner: string, input: WriterPublicationInput) {
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`writer-book:${id}`]);
  const row = await ownWriter(id, owner, db, true);
  if (row.writer_revision !== input.expectedRevision) return fail(409, 'Başka bir cihazda değişiklik var. Önce sürümleri karşılaştır.');
  const document = structuredClone(row.writer_data ?? legacyDocument(row));
  const before = row.published_data ?? (row.legacy_public ? legacyDocument(row) : null);
  let snapshot = before ? structuredClone(before) : null;
  let published = isPublished(row);
  if (input.action === 'publish') {
    const chosen = document.chapters.filter(ch => ch.status === 'published');
    const selected = chosen.length ? chosen : document.chapters;
    snapshot = { ...document, chapters: selected.map(ch => ({ ...ch, status: 'published' })) };
    validatePublication(snapshot);
    document.chapters.forEach(ch => { if (snapshot!.chapters.some(pub => pub.id === ch.id)) ch.status = 'published'; });
    published = true;
  } else if (input.action === 'unpublish') {
    published = false;
  } else {
    const chapter = document.chapters.find(ch => ch.id === input.chapterId);
    if (!chapter) return fail(404, 'Bölüm bulunamadı.');
    chapter.status = input.action === 'publishChapter' ? 'published' : 'draft';
    if (input.action === 'publishChapter') validatePublication({ ...document, chapters: [chapter] });
    if (published && snapshot) {
      if (chapter.status === 'published') {
        const publishedIds = new Set([...snapshot.chapters.map(ch => ch.id), chapter.id]);
        snapshot = { ...snapshot, chapters: document.chapters.filter(ch => publishedIds.has(ch.id)).map(ch => {
          const saved = snapshot!.chapters.find(old => old.id === ch.id);
          return ch.id === chapter.id ? { ...chapter, status: 'published' as const } : saved!;
        }) };
        // Chapter publication does not implicitly publish edited book metadata.
      } else snapshot.chapters = snapshot.chapters.filter(ch => ch.id !== chapter.id);
      if (!snapshot.chapters.length) published = false;
    }
  }
  await syncMediaRefs(db, id, owner, 'draft', document);
  if (published && snapshot && input.action === 'publishChapter') validatePublication(snapshot);
  if (snapshot) await syncMediaRefs(db, id, owner, 'published', snapshot);
  if (published && snapshot) await notifyReaders(db, row, before, snapshot);
  const display = published && snapshot ? snapshot : document;
  await db.query(`UPDATE authored_books SET writer_data=$2,published_data=$3,publication=$4,writer_revision=writer_revision+1,
    title=$5,body=$6,cover=$7,genre=$8,published_at=CASE WHEN $4='published' THEN coalesce(published_at,now()) ELSE published_at END,
    writer_updated_at=now(),last_save_id=NULL,last_save_hash=NULL WHERE id=$1`,
  [id, document, snapshot, published ? 'published' : 'draft', display.title, display.chapters.map(ch => plain(ch.html)).join('\n\n'),
    coverUrl(display.cover), display.genres.join(' · ') || null]);
  return writerBook(await writerRow(id, db));
}
export async function authoredBook(id: string, viewer: string | null, db: Db = pool): Promise<AuthoredBook> {
  const row = await writerRow(id, db), own = row.author_id === viewer, published = isPublished(row);
  if (!own && !published) return fail(404, 'Kitap bulunamadı.');
  // A public reader link always means the released snapshot, including for its
  // author. Private previews explicitly use the authenticated writer endpoint.
  const doc = published ? row.published_data ?? legacyDocument(row) : row.writer_data ?? legacyDocument(row);
  const author = (await db.query('SELECT id,nickname,avatar FROM community_users WHERE id=$1', [row.author_id])).rows[0];
  const counts = (await db.query<{ read_count: number; like_count: number; comment_count: number; liked: boolean }>(`SELECT
    (SELECT count(*)::int FROM book_reads WHERE book_id=$1) AS read_count,
    (SELECT count(*)::int FROM writer_likes WHERE book_id=$1) AS like_count,
    (SELECT count(*)::int FROM writer_comments WHERE book_id=$1) AS comment_count,
    EXISTS(SELECT 1 FROM writer_likes WHERE book_id=$1 AND user_id=$2) AS liked`, [id, viewer])).rows[0];
  return { id, title: doc.title, body: doc.chapters.map(ch => plain(ch.html)).join('\n\n'), author, cover: doc.cover, coverUrl: coverUrl(doc.cover),
    description: doc.description, genres: doc.genres, ageRating: doc.ageRating, language: doc.language, completion: doc.completion,
    published, chapters: doc.chapters, publishedAt: row.published_at?.toISOString() ?? null, readCount: counts.read_count,
    likeCount: counts.like_count, commentCount: counts.comment_count, liked: counts.liked, canEdit: own };
}
export async function requirePublished(id: string, db: Db = pool) {
  const rows = await db.query<{ id: string }>(`SELECT b.id FROM authored_books b WHERE b.id=$1 AND ${publicBook()}`, [id]);
  if (!rows.rowCount) return fail(404, 'Yayınlanmış kitap bulunamadı.');
}
