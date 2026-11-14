import AsyncStorage from '@react-native-async-storage/async-storage';

// Manuscripts must not be limited by localStorage's small per-origin quota.
// A transaction is acknowledged only after commit, not request.onsuccess.
let connection: Promise<IDBDatabase> | null = null;
function database() {
  if (!connection) {
    connection = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('afilli-writer-v1', 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv'); };
      req.onerror = () => reject(req.error ?? new Error('Yerel yazı deposu açılamadı.'));
      req.onblocked = () => reject(new Error('Yerel yazı deposu başka bir sekmede açık. Diğer sekmeyi kapatıp yeniden dene.'));
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); connection = null; };
        resolve(db);
      };
    }).catch(error => { connection = null; throw error; });
  }
  return connection;
}
async function operation<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction('kv', mode), req = fn(tx.objectStore('kv'));
    let result: T;
    req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () => reject(tx.error ?? req.error ?? new Error('Yerel yazı kaydı tamamlanamadı.'));
  });
}
const storage = {
  async getItem(key: string): Promise<string | null> {
    const value = await operation<string | null | undefined>('readonly', store => store.get(key));
    // A stored null is a deletion marker: never fall back to old bytes.
    return value === undefined ? AsyncStorage.getItem(key) : value;
  },
  async setItem(key: string, value: string): Promise<void> {
    await operation('readwrite', store => store.put(value, key));
    await AsyncStorage.removeItem(key).catch(() => undefined);
  },
  async removeItem(key: string): Promise<void> {
    await operation('readwrite', store => store.put(null, key));
    await AsyncStorage.removeItem(key).catch(() => undefined);
  },
  async getAllKeys(): Promise<string[]> {
    const keys = await operation<IDBValidKey[]>('readonly', store => store.getAllKeys());
    const legacy = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith('afilli:writer:'));
    return [...new Set([...keys.filter((key): key is string => typeof key === 'string'), ...legacy])];
  },
};
export default storage;
