import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';
import type { ProfileUpload, ProfileUploadInput } from '@workspace/api-client-react';

export type ProfilePurpose = 'avatar' | 'cover';
const MAX = 10 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
type ImgType = typeof TYPES[number];

export type PickedImage = { uri: string; mimeType: ImgType; size: number };

export async function pickProfileImage(source: 'library' | 'camera', purpose: ProfilePurpose): Promise<PickedImage | null> {
  const perm = source === 'camera'
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    throw new Error(source === 'camera'
      ? 'Kamera izni verilmedi. Ayarlardan izin verip tekrar dene.'
      : 'Galeri izni verilmedi. Ayarlardan izin verip tekrar dene.');
  }
  const opts: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'], allowsEditing: true, quality: 0.9,
    aspect: purpose === 'avatar' ? [1, 1] : [3, 1],
  };
  const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (res.canceled || !res.assets[0]) return null;
  const asset = res.assets[0];
  let size = asset.fileSize ?? 0;
  let type = asset.mimeType ?? '';
  if (Platform.OS === 'web') {
    const blob = await (await fetch(asset.uri)).blob();
    size = blob.size; type = type || blob.type;
  } else if (!size) {
    size = new File(asset.uri).size ?? 0;
  }
  if (!type) type = 'image/jpeg';
  if (!TYPES.includes(type as ImgType)) throw new Error('JPEG, PNG veya WebP bir fotoğraf seç.');
  if (!size || size > MAX) throw new Error('Fotoğraf en fazla 10 MB olabilir.');
  return { uri: asset.uri, mimeType: type as ImgType, size };
}

/** requestUpload is the generated mutation's mutateAsync (carries the actor header). */
export async function uploadProfileImage(
  img: PickedImage, purpose: ProfilePurpose,
  requestUpload: (v: { data: ProfileUploadInput }) => Promise<ProfileUpload>,
): Promise<string> {
  const upload = await requestUpload({ data: { purpose, contentType: img.mimeType, size: img.size } });
  const body = Platform.OS === 'web' ? await (await fetch(img.uri)).blob() : new File(img.uri);
  const r = await expoFetch(upload.uploadURL, { method: 'PUT', headers: { 'Content-Type': img.mimeType }, body });
  if (!r.ok) throw new Error('Fotoğraf yüklenemedi, tekrar dene.');
  return upload.id;
}
