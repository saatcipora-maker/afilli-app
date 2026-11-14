import { Router, type IRouter } from 'express';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { pool } from '@workspace/db';
import { RequestWriterUploadBody } from '@workspace/api-zod';
import { route, requirePerson, parse, uuid, fail, viewer, transaction } from '../lib/community';
import { writerObject, writerUploadUrl, writerImageAccessUrl } from '../lib/bulletin-storage';
import { PRESETS, presetUrl } from '../lib/writer-document';
import { publicBook } from '../lib/book-access';
import { setMediaReservation } from '../lib/writer-retention';

const router: IRouter = Router();
router.get('/writer-presets', route((_req, res) => res.json(PRESETS.map(({ id, title }) => ({ id, title, cover: `preset:${id}`, url: presetUrl(id) })))));
const artworkCache = new Map<string, Buffer>();
router.get('/writer-covers/:name', route(async (req, res) => {
  const preset = PRESETS.find(p => `${p.id}.png` === req.params.name);
  if (!preset) return fail(404, 'Kapak bulunamadı.');
  let image = artworkCache.get(preset.id);
  if (!image) {
    const branches = Array.from({ length: 9 }, (_, i) => `<path d="M600 ${1200 - i * 60}q${-140 - i * 16} -${100 + i * 8} ${-230 - i * 18} -${220 + i * 20}M600 ${1200 - i * 60}q${140 + i * 16} -${100 + i * 8} ${230 + i * 18} -${220 + i * 20}"/>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1800"><defs><radialGradient id="g"><stop stop-color="${preset.accent}" stop-opacity=".22"/><stop offset="1" stop-color="${preset.ink}"/></radialGradient></defs><rect width="1200" height="1800" fill="${preset.ink}"/><rect x="40" y="40" width="1120" height="1720" rx="9" fill="url(#g)" stroke="${preset.accent}" stroke-width="3"/><rect x="65" y="65" width="1070" height="1670" fill="none" stroke="${preset.accent}" opacity=".5"/><g fill="none" stroke="${preset.accent}" stroke-width="3" opacity=".55"><circle cx="600" cy="700" r="230"/><circle cx="600" cy="700" r="215"/><path d="M600 420V1270"/>${branches}</g><path d="M260 1450H940M450 1470H750" stroke="${preset.accent}" opacity=".65"/><text x="600" y="1600" fill="${preset.accent}" font-family="serif" font-size="44" text-anchor="middle" letter-spacing="16">AFİLLİ</text></svg>`;
    image = await sharp(Buffer.from(svg)).png().toBuffer();
    artworkCache.set(preset.id, image);
  }
  res.setHeader('Cache-Control', 'public,max-age=86400,immutable');
  res.type('image/png').send(image);
}));
router.post('/writer-uploads', route(async (req, res) => {
  const owner = await requirePerson(req), input = parse(RequestWriterUploadBody, req.body), id = randomUUID();
  await transaction(async db => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`writer-upload:${owner.id}`]);
    const quota = (await db.query<{ count: number; size: number }>(`SELECT count(*)::int AS count,coalesce(sum(size),0)::bigint AS size
      FROM writer_uploads WHERE owner_id=$1 AND created_at>now()-interval '24 hours'`, [owner.id])).rows[0];
    if (quota.count >= 200 || Number(quota.size) + input.size > 500 * 1024 * 1024) return fail(429, 'Bugünkü görsel yükleme sınırına ulaştın. Daha sonra tekrar dene.');
    await db.query('INSERT INTO writer_uploads(id,owner_id,content_type,size) VALUES($1,$2,$3,$4)', [id, owner.id, input.contentType, input.size]);
  });
  res.json({ id, uploadUrl: await writerUploadUrl(id) });
}));
router.put('/writer-uploads/:id/reservations/:reservationId', route(async (req, res) => {
  const owner = await requirePerson(req);
  await setMediaReservation(owner.id, uuid(req.params.id), uuid(req.params.reservationId), true);
  res.sendStatus(204);
}));
router.delete('/writer-uploads/:id/reservations/:reservationId', route(async (req, res) => {
  const owner = await requirePerson(req);
  await setMediaReservation(owner.id, uuid(req.params.id), uuid(req.params.reservationId), false);
  res.sendStatus(204);
}));
router.post('/writer-uploads/:id/complete', route(async (req, res) => {
  const owner = await requirePerson(req), id = uuid(req.params.id);
  await transaction(async db => {
    const row = (await db.query<{ owner_id: string; ready: boolean; content_type: string; size: number; deleting_at: Date | null }>('SELECT * FROM writer_uploads WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!row || row.owner_id !== owner.id) return fail(404, 'Görsel bulunamadı.');
    if (row.deleting_at) return fail(410, 'Bu görsel temizlenmek üzere ayrılmış.');
    // Completion may acknowledge an offline retry. Restore indefinite protection.
    await db.query('UPDATE writer_uploads SET released_at=NULL,orphaned_at=NULL WHERE id=$1', [id]);
    if (row.ready) return;
    try {
      const file = writerObject(`${id}/source`);
      const [meta] = await file.getMetadata();
      if (Number(meta.size) !== row.size || row.size < 1 || row.size > 10 * 1024 * 1024) throw new Error('size');
      const [input] = await file.download();
      const processor = sharp(input, { limitInputPixels: 40_000_000, failOn: 'error' });
      const info = await processor.metadata();
      const actual = info.format === 'jpeg' ? 'image/jpeg' : info.format === 'png' ? 'image/png' : info.format === 'webp' ? 'image/webp' : '';
      if (!actual || actual !== row.content_type || (info.pages ?? 1) > 1 || !info.width || !info.height) throw new Error('type');
      const sealed = await processor.rotate().resize({ width: 1800, height: 2700, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 95, mozjpeg: true }).toBuffer();
      await writerObject(`${id}/image`).save(sealed, { resumable: false, contentType: 'image/jpeg', metadata: { cacheControl: 'private,max-age=0,no-store' } });
      await db.query('UPDATE writer_uploads SET ready=true WHERE id=$1', [id]);
      // The only signed PUT targets /source. A later PUT cannot replace the sealed image.
      await file.delete().catch(() => {});
    } catch { return fail(400, 'Fotoğraf yüklemesi tamamlanmadı veya görsel geçersiz. JPEG, PNG veya WebP seçip yeniden dene.'); }
  });
  res.json({ id, url: `/api/writer-media/${id}` });
}));
async function accessible(id: string, who: string | null) {
  const rows = await pool.query(`SELECT m.id FROM writer_uploads m WHERE m.id=$1 AND m.ready AND m.deleting_at IS NULL AND
    (m.owner_id=$2 OR EXISTS(SELECT 1 FROM writer_media_refs r JOIN authored_books b ON b.id=r.book_id
      WHERE r.media_id=m.id AND r.version='published' AND ${publicBook()}))`, [id, who]);
  if (!rows.rowCount) return fail(404, 'Görsel bulunamadı.');
}
router.get('/writer-media/:id/access', route(async (req, res) => {
  const owner = await requirePerson(req), id = uuid(req.params.id);
  const own = await pool.query('SELECT id FROM writer_uploads WHERE id=$1 AND owner_id=$2 AND ready AND deleting_at IS NULL', [id, owner.id]);
  if (!own.rowCount) return fail(404, 'Görsel bulunamadı.');
  await accessible(id, owner.id);
  res.json({ id, url: await writerImageAccessUrl(id) });
}));
router.get('/writer-media/:id', route(async (req, res) => {
  const id = uuid(req.params.id);
  await accessible(id, viewer(req));
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private,no-store');
  const stream = writerObject(`${id}/image`).createReadStream();
  stream.on('error', () => { if (!res.headersSent) res.status(404).json({ error: 'Görsel bulunamadı.' }); else res.destroy(); });
  stream.pipe(res);
}));
export default router;
