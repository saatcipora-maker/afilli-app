import { randomUUID } from 'expo-crypto';
import type { WriterChapter, WriterDocument, WriterDocumentGenresItem } from '@workspace/api-client-react';

export const GENRES: WriterDocumentGenresItem[] = ['Roman', 'Hikaye', 'Şiir', 'Fantastik', 'Bilim Kurgu', 'Korku', 'Aşk', 'Tarihi', 'Kişisel Gelişim'];
export const LANGUAGES = ['Türkçe', 'English', 'Deutsch', 'Français', 'Español', 'Kurmancî', 'العربية'];
export const MAX_CHAPTER_CHARS = 50_000;
export const MAX_CHAPTERS = 200;
export const TITLE_MAX = 100;
export const DESC_MAX = 500;
export const CHAPTER_TITLE_MAX = 150;

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

/** Decodes the server's entity set exactly once. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    const v = ENTITY[e.toLowerCase()];
    return v ?? m;
  });
}

/** Mirrors the server's TEXT count: br and closing blocks become newlines, tags stripped, entities decoded once, one trailing newline removed. */
export function htmlToPlain(html: string): string {
  let s = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h[1-6]|li|blockquote)\s*>/gi, '\n').replace(/<[^>]*>/g, '');
  s = decodeEntities(s);
  if (s.endsWith('\n')) s = s.slice(0, -1);
  return s;
}

export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}
export function readMinutes(words: number): number { return words === 0 ? 0 : Math.max(1, Math.ceil(words / 200)); }
export function chapterStats(html: string) {
  const text = htmlToPlain(html);
  const words = countWords(text);
  return { chars: text.length, words, minutes: readMinutes(words), empty: text.trim().length === 0 };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function newChapter(n: number, html = ''): WriterChapter {
  return { id: randomUUID(), title: 'Bölüm ' + n, html, status: 'draft' };
}
export function emptyDocument(): WriterDocument {
  return { title: '', description: '', genres: [], ageRating: 'all', language: 'Türkçe', completion: 'ongoing', cover: null, chapters: [newChapter(1)] };
}

/** Lossless conversion of old plain text into chapters, each under the 50k TEXT limit. Never truncates. */
export function legacyTextToChapters(body: string): WriterChapter[] {
  const budget = MAX_CHAPTER_CHARS - 200;
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const pieces: string[] = [];
  for (const line of lines) {
    if (line.length <= budget) { pieces.push(line); continue; }
    for (let i = 0; i < line.length; i += budget) pieces.push(line.slice(i, i + budget));
  }
  const chapters: WriterChapter[] = [];
  let buf: string[] = [], size = 0;
  const flush = () => {
    if (!buf.length) return;
    const html = buf.map((l) => '<p>' + (l ? escapeHtml(l) : '<br>') + '</p>').join('');
    chapters.push(newChapter(chapters.length + 1, html));
    buf = []; size = 0;
  };
  for (const p of pieces) {
    if (size + p.length + 2 > budget) flush();
    buf.push(p); size += p.length + 2;
  }
  flush();
  return chapters.length ? chapters : [newChapter(1)];
}

export type Problem = { key: 'cover' | 'title' | 'genre' | 'chapter' | 'size'; text: string };

/** Mirrors whole-publication validation so the writer learns before the server refuses. */
export function publishProblems(doc: WriterDocument, hasCover: boolean): Problem[] {
  const out: Problem[] = [];
  if (!hasCover) out.push({ key: 'cover', text: 'Önce kapak fotoğrafı yükle' });
  const t = doc.title.trim().length;
  if (t < 2 || t > TITLE_MAX) out.push({ key: 'title', text: 'Kitap adı yaz (2-100 karakter)' });
  if (doc.genres.length < 1) out.push({ key: 'genre', text: 'En az bir tür seç' });
  const selected = doc.chapters.some((c) => c.status === 'published') ? doc.chapters.filter((c) => c.status === 'published') : doc.chapters;
  if (!selected.length || selected.some((c) => chapterStats(c.html).empty)) out.push({ key: 'chapter', text: 'Bölümünü yaz: seçili bölümler boş olamaz' });
  if (doc.chapters.some((c) => chapterStats(c.html).chars > MAX_CHAPTER_CHARS)) out.push({ key: 'size', text: 'Bir bölüm 50.000 karakteri aşıyor; bölümü ikiye ayır' });
  return out;
}

export function clockTR(at: number | string | null | undefined): string {
  if (!at) return '';
  const d = new Date(at);
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}
export const AGE_LABEL: Record<string, string> = { all: 'Herkese Uygun', '13': '+13', '18': '+18' };

/** Canonical own image path -> media id. */
export function writerMediaId(src: string | null | undefined): string | null {
  const m = /^\/api\/writer-media\/([0-9a-f-]{36})$/i.exec(src ?? '');
  return m ? m[1] : null;
}
