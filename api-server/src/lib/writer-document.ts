import { createHash } from 'node:crypto';
import sanitizeHtml from 'sanitize-html';
import type { WriterChapter, WriterDocument, WriterBook } from '@workspace/api-zod';
import { fail } from './community';

export const PRESETS = [
  { id: 'forest', title: 'Ormanın Sesi', ink: '#213E32', accent: '#CDBE84' },
  { id: 'night', title: 'Gece Atlası', ink: '#1E2D48', accent: '#D1BA78' },
  { id: 'paper', title: 'Klasik Sayfalar', ink: '#E6D5B7', accent: '#70503A' },
  { id: 'wine', title: 'Bordo Defter', ink: '#552C39', accent: '#D8B982' },
  { id: 'sea', title: 'Mavi Ufuk', ink: '#28505B', accent: '#D5D0AF' },
  { id: 'sun', title: 'Altın Gün', ink: '#B5733F', accent: '#F5E4BC' },
];
export const presetUrl = (id: string) => `/api/writer-covers/${id}.png`;
export function coverUrl(cover: string | null | undefined) {
  return cover?.startsWith('preset:') ? presetUrl(cover.slice(7)) : cover || null;
}
export function plain(html: string) {
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(?:p|div|h[1-6]|li|blockquote)>/gi, '\n')
    .replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-f]+);/gi, (m, entity: string) => {
      const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
      if (entity[0] !== '#') return named[entity.toLowerCase()] ?? m;
      const code = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\ufffd';
    }).replace(/\n$/, '');
}
export const escapeText = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export function cleanHtml(html: string) {
  return sanitizeHtml(html, {
    allowedTags: ['p', 'div', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'span', 'a', 'img', 'font'],
    allowedAttributes: { '*': ['style'], a: ['href', 'title', 'target', 'rel'], img: ['src', 'alt'] },
    allowedStyles: { '*': { 'text-align': [/^(left|center|right)$/], color: [/^#[0-9a-f]{3,8}$/i, /^rgb\(\s*\d{1,3},\s*\d{1,3},\s*\d{1,3}\s*\)$/], 'font-size': [/^(?:12|14|16|17|18|20|22|24|28|32)px$/],
      'font-weight': [/^(?:bold|normal|[1-9]00)$/], 'font-style': [/^(?:italic|normal)$/],
      'text-decoration': [/^(?:underline|line-through)(?: (?:underline|line-through))?$/],
      'text-decoration-line': [/^(?:underline|line-through)(?: (?:underline|line-through))?$/] } },
    allowedSchemes: ['http', 'https', 'mailto'], allowProtocolRelative: false, nestingLimit: 30,
    transformTags: {
      font: (_name, attr) => ({ tagName: 'span', attribs: { style: `font-size:${({ '1': 14, '2': 14, '3': 17, '4': 20, '5': 24, '6': 28, '7': 32 } as Record<string, number>)[attr.size] ?? 17}px;${/^#[0-9a-f]{3,8}$/i.test(attr.color ?? '') ? `color:${attr.color}` : ''}` } }),
      a: (_name, attr) => ({ tagName: 'a', attribs: { href: /^(https?:\/\/|mailto:)/i.test(attr.href ?? '') ? attr.href : '', target: '_blank', rel: 'noopener noreferrer' } }),
      img: (_name, attr) => {
        if (!/^\/api\/writer-media\/[0-9a-f-]{36}$/i.test(attr.src ?? '')) return fail(400, 'Bölüm fotoğrafını görsel ekleme düğmesinden yükle.');
        return { tagName: 'img', attribs: { src: attr.src, alt: (attr.alt ?? '').slice(0, 300) } };
      },
    },
  });
}
export function normalizeDocument(doc: WriterDocument): WriterDocument {
  if (new Set(doc.genres).size !== doc.genres.length) return fail(400, 'Aynı türü birden fazla seçme.');
  if (doc.cover && !(PRESETS.some(p => doc.cover === `preset:${p.id}`) || /^\/api\/writer-media\/[0-9a-f-]{36}$/i.test(doc.cover))) return fail(400, 'Önce kapak fotoğrafı yükle.');
  if (new Set(doc.chapters.map(ch => ch.id)).size !== doc.chapters.length) return fail(400, 'Bölüm kimlikleri birbirinden farklı olmalı.');
  const chapters = doc.chapters.map(ch => {
    const html = cleanHtml(ch.html);
    if (plain(html).length > 50_000) return fail(400, 'Bir bölüm en fazla 50.000 karakter olabilir. Yazın cihazında korunuyor.');
    return { ...ch, html };
  });
  return { ...doc, chapters };
}
export function mediaIds(doc: WriterDocument) {
  const cover = /^\/api\/writer-media\/([0-9a-f-]{36})$/i.exec(doc.cover ?? '')?.[1];
  const images = doc.chapters.flatMap(ch => [...ch.html.matchAll(/<img\b[^>]*\bsrc="\/api\/writer-media\/([0-9a-f-]{36})"/gi)].map(match => match[1]));
  return [...new Set([...(cover ? [cover] : []), ...images])];
}
export function deltaMediaIds(previous: WriterDocument, document: WriterDocument, changedIds: string[], deletedIds: string[]) {
  const changed = new Set(changedIds), affected = new Set([...changed, ...deletedIds]);
  const next = mediaIds({ ...document, chapters: document.chapters.filter(ch => changed.has(ch.id)) });
  const before = mediaIds({ ...previous, chapters: previous.chapters.filter(ch => affected.has(ch.id)) });
  const candidates = before.filter(id => !next.includes(id));
  // Image removal is uncommon. Only then scan untouched chapters to preserve
  // images shared with another chapter (or the cover).
  const remaining = candidates.length ? new Set(mediaIds(document)) : new Set<string>();
  return { next, removed: candidates.filter(id => !remaining.has(id)) };
}
export function validatePublication(doc: WriterDocument) {
  if (!doc.cover) return fail(400, 'Önce kapak fotoğrafı yükle. Kapak yükle.');
  if (doc.title.trim().length < 2 || doc.title.trim().length > 100) return fail(400, 'Kitap adı yaz. Adı 2–100 karakter olmalı.');
  if (!doc.genres.length || doc.genres.length > 3) return fail(400, 'En az 1, en fazla 3 tür seç.');
  if (!doc.chapters.length || doc.chapters.some(ch => !plain(ch.html).trim())) return fail(400, 'Bölümünü yaz. Yayınlanacak bölümler boş olamaz.');
}
export type WriterRow = {
  id: string; author_id: string; local_id: string; title: string; body: string; cover: string | null; genre: string | null;
  writer_data: WriterDocument | null; published_data: WriterDocument | null; writer_revision: number;
  publication: 'draft' | 'published'; legacy_public: boolean; published_at: Date | null; writer_updated_at: Date | null;
  last_save_id: string | null; last_save_hash: string | null;
};
function legacyId(id: string, index: number) {
  const hex = createHash('sha256').update(`${id}:legacy:${index}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function legacyDocument(row: WriterRow): WriterDocument {
  const parts: string[] = [];
  for (let start = 0; start < row.body.length;) {
    let end = Math.min(start + 50_000, row.body.length);
    if (end < row.body.length && /[\uD800-\uDBFF]/.test(row.body[end - 1])) end--;
    parts.push(row.body.slice(start, end)); start = end;
  }
  if (!parts.length) parts.push('');
  return { title: row.title, description: '', genres: [], ageRating: 'all', language: 'Türkçe', completion: 'ongoing',
    cover: row.cover, chapters: parts.map((body, i): WriterChapter => ({ id: legacyId(row.id, i), title: `Bölüm ${i + 1}`, html: `<p>${escapeText(body).replaceAll('\n', '<br>')}</p>`, status: row.legacy_public ? 'published' : 'draft' })) };
}
export function writerBook(row: WriterRow): WriterBook {
  return { id: row.id, localId: row.local_id, document: row.writer_data ?? legacyDocument(row), revision: row.writer_revision,
    publication: row.publication === 'published' || row.legacy_public ? 'published' : 'draft',
    publishedAt: row.published_at?.toISOString() ?? null, updatedAt: row.writer_updated_at?.toISOString() ?? null };
}
