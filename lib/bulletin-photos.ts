import { Platform } from 'react-native';
import type { ImagePickerAsset } from 'expo-image-picker';
import { File, Directory, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { fetch as expoFetch } from 'expo/fetch';
import { requestBulletinUpload } from '@workspace/api-client-react';

export type LocalBulletinPhoto = {
  id: string; uri: string; width: number; height: number;
  mimeType: string; size: number; uploadedId?: string;
};
const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
function imageType(type: string): typeof TYPES[number] {
  if (!TYPES.includes(type as typeof TYPES[number])) throw new Error('JPEG, PNG veya WebP fotoğraf seçin.');
  return type as typeof TYPES[number];
}
function photosDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('afilli-bulletin-photos', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('photos');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Fotoğraflar bu cihaza kaydedilemedi.'));
  });
}
async function writeBlob(id: string, blob: Blob) {
  const db = await photosDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('photos', 'readwrite');
      transaction.objectStore('photos').put(blob, id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error('Fotoğraf taslağı kaydedilemedi.'));
      transaction.onabort = () => reject(new Error('Fotoğraf taslağı kaydedilemedi.'));
    });
  } finally { db.close(); }
}
async function readBlob(id: string): Promise<Blob> {
  const db = await photosDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('photos').objectStore('photos').get(id);
      request.onsuccess = () => request.result instanceof Blob ? resolve(request.result) : reject(new Error('Taslak fotoğraf bulunamadı. Fotoğrafı yeniden seçin.'));
      request.onerror = () => reject(new Error('Taslak fotoğraf açılamadı.'));
    });
  } finally { db.close(); }
}
export async function prepareBulletinPhoto(asset: ImagePickerAsset): Promise<LocalBulletinPhoto> {
  const id = randomUUID();
  const source = Platform.OS === 'web' ? await (await fetch(asset.uri)).blob() : new File(asset.uri);
  const type = imageType(asset.mimeType || source.type || 'image/jpeg');
  const size = source.size;
  if (!size || size > MAX_BYTES) throw new Error('Her fotoğraf en fazla 10 MB olabilir.');
  let uri = asset.uri;
  if (Platform.OS === 'web') {
    await writeBlob(id, source as Blob);
    uri = URL.createObjectURL(source as Blob);
  } else {
    const directory = new Directory(Paths.document, 'bulletin-photos');
    directory.create({ idempotent: true, intermediates: true });
    const target = new File(directory, id + '.' + type.split('/')[1]);
    (source as File).copy(target);
    uri = target.uri;
  }
  return { id, uri, width: asset.width, height: asset.height, mimeType: type, size };
}
export async function restoreBulletinPhotos(photos: LocalBulletinPhoto[]): Promise<LocalBulletinPhoto[]> {
  return Promise.all(photos.map(async (photo) => {
    if (photo.uploadedId && !photo.uri.startsWith('blob:')) return photo;
    if (Platform.OS === 'web') return { ...photo, uri: URL.createObjectURL(await readBlob(photo.id)) };
    if (!new File(photo.uri).exists) throw new Error('Taslak fotoğraf bulunamadı. Fotoğrafı yeniden seçin.');
    return photo;
  }));
}
export async function uploadBulletinPhoto(photo: LocalBulletinPhoto, ownerId?: string): Promise<string> {
  if (photo.uploadedId) return photo.uploadedId;
  const contentType = imageType(photo.mimeType);
  const upload = await requestBulletinUpload({ contentType, size: photo.size }, { headers: ownerId ? { 'X-Afilli-Actor': ownerId } : {} });
  const body = Platform.OS === 'web' ? await (await fetch(photo.uri)).blob() : new File(photo.uri);
  const response = await expoFetch(upload.uploadURL, { method: 'PUT', headers: { 'Content-Type': contentType }, body });
  if (!response.ok) throw new Error('Fotoğraf yüklenemedi. Taslağın korundu, tekrar dene.');
  return upload.id;
}
export function bulletinMediaUrl(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  return domain ? `https://${domain}${url}` : url;
}
