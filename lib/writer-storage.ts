import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { randomUUID, digestStringAsync, CryptoDigestAlgorithm } from 'expo-crypto';

// Large novels cannot safely live in Android AsyncStorage's cursor-sized rows.
// Each generation is written and verified in the same directory, then renamed
// to a UNIQUE final filename. The previous committed generation is never
// removed before its replacement exists. Interrupted .tmp files are ignored.
const root = () => new Directory(Paths.document, 'afilli-writer-v1');
const folder = (key: string) => {
  // Route parameters are untrusted. Encoded slashes can become real path
  // separators when a native file URL is decoded; writer keys need none.
  const name = encodeURIComponent(key);
  if (!/^[A-Za-z0-9:_-]+$/.test(key) || name.length > 240)
    throw new Error('Yerel kayıt kimliği geçersiz. Varolan dosyalar değiştirilmedi.');
  return new Directory(root(), name);
};
const hash = (value: string | null) => digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify(value));
function generations(dir: Directory): File[] {
  if (!dir.exists) return [];
  return dir.list().filter((entry): entry is File => entry instanceof File && /^\d{16}-[0-9a-f-]+\.json$/.test(entry.name))
    .sort((a, b) => b.name.localeCompare(a.name));
}
async function readCurrent(key: string): Promise<string | null | undefined> {
  const current = generations(folder(key))[0];
  if (!current) return undefined;
  let value: { v: number; key: string; value: string | null; digest: string };
  try { value = JSON.parse(await current.text()); } catch { throw new Error('Yerel yazı dosyası okunamadı. Dosya silinmedi.'); }
  if (value.v !== 1 || value.key !== key || (value.value !== null && typeof value.value !== 'string')
    || value.digest !== await hash(value.value)) throw new Error('Yerel yazı dosyası doğrulanamadı. Dosya silinmedi.');
  return value.value;
}
async function write(key: string, value: string | null) {
  const dir = folder(key);
  dir.create({ intermediates: true, idempotent: true });
  const previous = generations(dir);
  const last = Number(previous[0]?.name.slice(0, 16) ?? 0);
  const name = String(Math.max(Date.now(), last + 1)).padStart(16, '0') + '-' + randomUUID();
  const temp = new File(dir, name + '.tmp'), committed = new File(dir, name + '.json');
  const bytes = JSON.stringify({ v: 1, key, value, digest: await hash(value) });
  try {
    temp.write(bytes);
    if (await temp.text() !== bytes) throw new Error('Yerel yazı dosyası eksik yazıldı. Önceki kayıt korunuyor.');
    temp.move(committed);
  } finally {
    // File.move updates the File object's own URI. Never delete that object
    // after it became the committed generation.
    if (temp.uri !== committed.uri && temp.exists) temp.delete();
  }
  // Cleanup cannot turn a successful committed save into a failed save.
  const retained = value === null ? 0 : 1;
  for (const old of previous.slice(retained)) { try { old.delete(); } catch { /* private old generation; safe to retry later */ } }
  await AsyncStorage.removeItem(key).catch(() => undefined);
}
const storage = {
  async getItem(key: string): Promise<string | null> {
    const current = await readCurrent(key);
    return current === undefined ? AsyncStorage.getItem(key) : current;
  },
  setItem: (key: string, value: string) => write(key, value),
  removeItem: (key: string) => write(key, null),
  async getAllKeys(): Promise<string[]> {
    const dir = root();
    const current = dir.exists ? dir.list().filter(entry => entry instanceof Directory).map(entry => decodeURIComponent(entry.name)) : [];
    const legacy = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith('afilli:writer:'));
    return [...new Set([...current, ...legacy])];
  },
};
export default storage;
