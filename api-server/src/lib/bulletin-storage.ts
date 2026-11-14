import { Storage } from '@google-cloud/storage';

const REPLIT_SIDECAR_ENDPOINT = 'http://127.0.0.1:1106';
// Canonical Replit sidecar authentication; never put account keys in the app.
const objectStorageClient = new Storage({
  credentials: {
    audience: 'replit', subject_token_type: 'access_token',
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`, type: 'external_account',
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: { type: 'json', subject_token_field_name: 'access_token' },
    },
    universe_domain: 'googleapis.com',
  },
  projectId: '',
});
type ImageFolder = 'bulletins' | 'profiles' | 'writer';
function imageObject(id: string, folder: ImageFolder) {
  const directory = process.env.PRIVATE_OBJECT_DIR;
  if (!directory) throw new Error('Fotoğraf depolaması yapılandırılmadı.');
  const parts = `${directory}/${folder}/${id}`.replace(/^\/+/, '').split('/');
  return objectStorageClient.bucket(parts.shift()!).file(parts.join('/'));
}
export const bulletinObject = (id: string) => imageObject(id, 'bulletins');
export const profileObject = (id: string) => imageObject(id, 'profiles');
export const writerObject = (id: string) => imageObject(id, 'writer');
export const bulletinUploadUrl = (id: string) => imageUploadUrl(id, 'bulletins');
export const profileUploadUrl = (id: string) => imageUploadUrl(id, 'profiles');
export const writerUploadUrl = (id: string) => imageUploadUrl(`${id}/source`, 'writer');
export const writerImageAccessUrl = (id: string) => signedImageUrl(`${id}/image`, 'writer', 'GET', 300_000);
async function imageUploadUrl(id: string, folder: ImageFolder) {
  return signedImageUrl(id, folder, 'PUT', 900_000);
}
async function signedImageUrl(id: string, folder: ImageFolder, method: 'GET' | 'PUT', lifetime: number) {
  const file = imageObject(id, folder);
  const response = await fetch(`${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bucket_name: file.bucket.name, object_name: file.name, method,
      expires_at: new Date(Date.now() + lifetime).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error('Fotoğraf yükleme bağlantısı oluşturulamadı.');
  const result = await response.json() as { signed_url: string };
  return result.signed_url;
}
export const validateBulletinObject = (id: string, contentType: string, expectedSize: number) => validateImageObject(id, contentType, expectedSize, 'bulletins');
export const validateProfileObject = (id: string, contentType: string, expectedSize: number) => validateImageObject(id, contentType, expectedSize, 'profiles');
async function validateImageObject(id: string, contentType: string, expectedSize: number, folder: 'bulletins' | 'profiles') {
  const file = imageObject(id, folder);
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size);
  if (size !== expectedSize || size < 1 || size > 10 * 1024 * 1024) throw new Error('Fotoğraf yüklemesi tamamlanmadı veya dosya boyutu geçersiz.');
  const [bytes] = await file.download({ start: 0, end: 15, validation: false });
  const valid = contentType === 'image/jpeg' ? bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
    : contentType === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : contentType === 'image/webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!valid) throw new Error('Geçerli bir JPEG, PNG veya WebP fotoğraf seçin.');
}
