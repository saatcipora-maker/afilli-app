import AsyncStorage from '@react-native-async-storage/async-storage';

/** One unconfirmed outgoing message. The clientId is the server idempotency key and never changes. */
export type OutboxEntry = { clientId: string; body: string };
export type ChatDraft = { body: string; outbox: OutboxEntry[] };

export const EMPTY_DRAFT: ChatDraft = { body: '', outbox: [] };
export const chatDraftKey = (owner: string, threadId: string) => `afilli:chat-draft:${owner}:${threadId}`;

export class DraftStorageError extends Error {
  constructor(message: string, readonly cause?: unknown) { super(message); this.name = 'DraftStorageError'; }
}

function isEntry(v: unknown): v is OutboxEntry {
  const value = v as OutboxEntry | null;
  return !!value && typeof value.clientId === 'string' && /^[0-9a-f-]{36}$/i.test(value.clientId)
    && typeof value.body === 'string' && value.body.trim().length > 0 && value.body.length <= 4000;
}

/** Strict parse: throws on anything unreadable so callers never overwrite it with an empty draft. Accepts the legacy `failed` field. */
export function parseChatDraft(raw: string | null): ChatDraft {
  if (raw == null) return { body: '', outbox: [] };
  let v: unknown;
  try { v = JSON.parse(raw); } catch (e) { throw new DraftStorageError('Kayıtlı taslak okunamadı.', e); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new DraftStorageError('Kayıtlı taslak bozuk.');
  const o = v as { body?: unknown; outbox?: unknown; failed?: unknown };
  if (typeof o.body !== 'string' || (o.outbox !== undefined && !Array.isArray(o.outbox))
    || (o.failed !== undefined && !Array.isArray(o.failed))) throw new DraftStorageError('Kayıtlı taslak bozuk.');
  const list = Array.isArray(o.outbox) ? o.outbox : Array.isArray(o.failed) ? o.failed : [];
  if (!list.every(isEntry)) throw new DraftStorageError('Kayıtlı gönderim kuyruğu bozuk.');
  return { body: (o.body as string | undefined) ?? '', outbox: list.map(({ clientId, body }) => ({ clientId, body })) };
}

/** Strict read: throws DraftStorageError on storage or parse failure. */
export async function readChatDraft(owner: string, threadId: string): Promise<ChatDraft> {
  let raw: string | null;
  try { raw = await AsyncStorage.getItem(chatDraftKey(owner, threadId)); }
  catch (e) { throw new DraftStorageError('Cihaz depolamasına erişilemedi.', e); }
  return parseChatDraft(raw);
}

const chains = new Map<string, Promise<unknown>>();

/**
 * Serialized functional update per owner+thread: read (strict) -> fn -> write, queued so concurrent
 * save/enqueue/ack never race. Rejects (without writing) if the read or write fails.
 */
export function updateChatDraft(owner: string, threadId: string, fn: (d: ChatDraft) => ChatDraft): Promise<ChatDraft> {
  const key = chatDraftKey(owner, threadId);
  const prev = chains.get(key) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(async () => {
    const cur = await readChatDraft(owner, threadId);
    const next = fn(cur);
    try {
      if (!next.body && next.outbox.length === 0) await AsyncStorage.removeItem(key);
      else await AsyncStorage.setItem(key, JSON.stringify(next));
    } catch (e) { throw new DraftStorageError('Taslak kaydedilemedi.', e); }
    return next;
  });
  chains.set(key, run);
  run.finally(() => { if (chains.get(key) === run) chains.delete(key); }).catch(() => {});
  return run;
}

/** Save typed text; outbox untouched. */
export const saveDraftBody = (owner: string, threadId: string, body: string) =>
  updateChatDraft(owner, threadId, (d) => ({ ...d, body }));

/**
 * Durably queue an outgoing message BEFORE network send. `bodyAfter` is evaluated inside the
 * serialized write so the newest typed text is kept (pass a ref reader).
 */
export const enqueueOutbox = (owner: string, threadId: string, entry: OutboxEntry, bodyAfter: () => string) =>
  updateChatDraft(owner, threadId, (d) => ({
    body: bodyAfter(),
    outbox: [...d.outbox.filter((x) => x.clientId !== entry.clientId), entry],
  }));

/** Remove an entry only after a real server ack; keeps body and all other entries. */
export const ackOutbox = (owner: string, threadId: string, clientId: string) =>
  updateChatDraft(owner, threadId, (d) => ({ ...d, outbox: d.outbox.filter((x) => x.clientId !== clientId) }));
