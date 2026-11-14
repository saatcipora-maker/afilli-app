import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat, type Action } from 'expo-image-manipulator';
import { File, Directory, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { fetch as expoFetch } from 'expo/fetch';
import { requestWriterUpload, completeWriterUpload } from '@workspace/api-client-react';
import type { LocalImage } from '@/lib/writer-store';

const MAX = 10 * 1024 * 1024;
export type PickResult = { ok: true; uri: string; width: number; height: number } | { ok: false; reason: 'cancel' | 'denied' | 'unavailable'; message?: string };

export async function pickImage(source: 'camera' | 'gallery'): Promise<PickResult> {
  try {
    if (source === 'camera') {
      if (Platform.OS === 'web') return { ok: false, reason: 'unavailable', message: 'Tarayıcıda kamera yerine galeriden seç.' };
      const p = await ImagePicker.requestCameraPermissionsAsync();
      if (!p.granted) return { ok: false, reason: 'denied', message: p.canAskAgain ? 'Kamera izni verilmedi.' : 'Kamera izni kapalı. Ayarlar > Afilli bölümünden açabilirsin.' };
      const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
      if (r.canceled || !r.assets[0]) return { ok: false, reason: 'cancel' };
      return { ok: true, uri: r.assets[0].uri, width: r.assets[0].width, height: r.assets[0].height };
    }
    if (Platform.OS !== 'web') {
      const p = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!p.granted) return { ok: false, reason: 'denied', message: p.canAskAgain ? 'Galeri izni verilmedi.' : 'Galeri izni kapalı. Ayarlar > Afilli bölümünden açabilirsin.' };
    }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (r.canceled || !r.assets[0]) return { ok: false, reason: 'cancel' };
    return { ok: true, uri: r.assets[0].uri, width: r.assets[0].width, height: r.assets[0].height };
  } catch (e) {
    return { ok: false, reason: 'unavailable', message: (e as Error)?.message || 'Fotoğraf açılamadı.' };
  }
}

export type CropSpec = { rotation: 0 | 90 | 180 | 270; zoom: number; dx: number; dy: number };
/** Book-shaped (2:3) crop rectangle in rotated-image pixels. dx/dy in -1..1. */
export function cropRect(w: number, h: number, spec: CropSpec) {
  const [rw, rh] = spec.rotation % 180 ? [h, w] : [w, h];
  let cw = rw, ch = rw * 1.5;
  if (ch > rh) { ch = rh; cw = rh / 1.5; }
  cw /= spec.zoom; ch /= spec.zoom;
  const x = (rw - cw) / 2 * (1 + spec.dx), y = (rh - ch) / 2 * (1 + spec.dy);
  return { rw, rh, x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)), w: Math.floor(Math.min(cw, rw)), h: Math.floor(Math.min(ch, rh)) };
}

/** Real ImageManipulator crop/rotate; output high-quality JPEG max 1200px wide, stored durably on this device. */
export async function renderCover(uri: string, width: number, height: number, spec: CropSpec): Promise<LocalImage> {
  const c = cropRect(width, height, spec);
  const actions: Action[] = [];
  if (spec.rotation) actions.push({ rotate: spec.rotation });
  actions.push({ crop: { originX: c.x, originY: c.y, width: c.w, height: c.h } });
  if (c.w > 1200) actions.push({ resize: { width: 1200 } });
  const out = await manipulateAsync(uri, actions, { compress: 0.92, format: SaveFormat.JPEG });
  return persistImage(out.uri, 'image/jpeg', out.width, out.height);
}

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('afilli-writer-images', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('images');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(new Error('Fotoğraf bu cihaza kaydedilemedi.'));
  });
}
async function idbPut(key: string, blob: Blob) {
  const d = await db();
  try {
    await new Promise<void>((res, rej) => {
      const t = d.transaction('images', 'readwrite'); t.objectStore('images').put(blob, key);
      t.oncomplete = () => res(); t.onerror = () => rej(new Error('Fotoğraf kaydedilemedi (depolama dolu olabilir).')); t.onabort = t.onerror;
    });
  } finally { d.close(); }
}
async function idbGet(key: string): Promise<Blob> {
  const d = await db();
  try {
    return await new Promise((res, rej) => {
      const q = d.transaction('images').objectStore('images').get(key);
      q.onsuccess = () => q.result instanceof Blob ? res(q.result) : rej(new Error('Cihazdaki kapak bulunamadı. Fotoğrafı yeniden seç.'));
      q.onerror = () => rej(new Error('Cihazdaki kapak açılamadı.'));
    });
  } finally { d.close(); }
}

async function persistImage(uri: string, mimeType: LocalImage['mimeType'], width: number, height: number): Promise<LocalImage> {
  const key = randomUUID();
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    if (blob.size > MAX) throw new Error('Fotoğraf 10 MB sınırını aşıyor.');
    await idbPut(key, blob);
    return { key, uri: URL.createObjectURL(blob), mimeType, size: blob.size, width, height };
  }
  const dir = new Directory(Paths.document, 'writer-images');
  dir.create({ idempotent: true, intermediates: true });
  const target = new File(dir, key + '.jpg');
  new File(uri).copy(target);
  if (target.size > MAX) throw new Error('Fotoğraf 10 MB sınırını aşıyor.');
  return { key, uri: target.uri, mimeType, size: target.size, width, height };
}

/** Rehydrates a pending local image after reload (web blob URLs do not survive). */
export async function restoreImage(img: LocalImage): Promise<LocalImage> {
  if (Platform.OS === 'web') return { ...img, uri: URL.createObjectURL(await idbGet(img.key)) };
  if (!new File(img.uri).exists) throw new Error('Cihazdaki kapak bulunamadı. Fotoğrafı yeniden seç.');
  return img;
}

/** request -> PUT bytes to signed URL -> complete; returns canonical /api/writer-media/UUID. */
export async function uploadImage(img: LocalImage, owner: string): Promise<string> {
  const h = { headers: { 'X-Afilli-Actor': owner } };
  const up = await requestWriterUpload({ contentType: img.mimeType, size: img.size }, h);
  const body = Platform.OS === 'web' ? await idbGet(img.key) : new File(img.uri);
  const res = await expoFetch(up.uploadUrl, { method: 'PUT', headers: { 'Content-Type': img.mimeType }, body });
  if (!res.ok) throw new Error('Fotoğraf yüklenemedi. Cihazda saklı, tekrar dene.');
  const done = await completeWriterUpload(up.id, h);
  if (!/^\/api\/writer-media\/[0-9a-f-]{36}$/i.test(done.url)) throw new Error('Sunucu beklenmeyen bir görsel adresi döndürdü.');
  return done.url;
}

/** Picks + uploads an inline chapter image immediately (requires connection). */
export async function prepareInlineImage(uri: string, width: number, height: number): Promise<LocalImage> {
  const actions: Action[] = width > 1600 ? [{ resize: { width: 1600 } }] : [];
  const out = await manipulateAsync(uri, actions, { compress: 0.9, format: SaveFormat.JPEG });
  return persistImage(out.uri, 'image/jpeg', out.width, out.height);
}
