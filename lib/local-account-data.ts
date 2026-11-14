import AsyncStorage from '@react-native-async-storage/async-storage';
import type { State } from '@/context/AppContext';

const LEGACY_KEY = 'afilli:v1';
const CLAIM_KEY = 'afilli:legacy-owner:v1';
type Claim = { ownerId: string; state?: State };
let claimQueue: Promise<unknown> = Promise.resolve();
function decodeClaim(raw: string | null, initial: State): Claim | null {
  if (!raw) return null;
  if (!raw.startsWith('{')) return { ownerId: raw };
  const claim = JSON.parse(raw) as Claim;
  if (!claim.ownerId || typeof claim.ownerId !== 'string') throw new Error('Aktarım kaydı açılamadı.');
  return { ownerId: claim.ownerId, state: claim.state ? decodeState(JSON.stringify(claim.state), initial) : undefined };
}
export const localKey = (userId: string | null) => 'afilli:v2:' + (userId ?? 'guest');
export function decodeState(raw: string | null, initial: State): State {
  if (!raw) return { ...initial };
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Geçersiz cihaz kaydı.');
  const state = { ...initial, ...value } as State;
  if (!Array.isArray(state.drafts) || !Array.isArray(state.saved) || !Array.isArray(state.messages) || !Array.isArray(state.store)
    || !Array.isArray(state.notifications) || !state.library || typeof state.library !== 'object') throw new Error('Cihaz kaydı açılamadı.');
  if (state.drafts.some((d) => !d || typeof d.id !== 'string' || typeof d.title !== 'string' || typeof d.body !== 'string' || !Number.isFinite(d.updatedAt)
    || (d.ownerId !== undefined && typeof d.ownerId !== 'string')) || state.saved.some((id) => typeof id !== 'string')
    || state.messages.some((m) => !m || typeof m.id !== 'string' || typeof m.from !== 'string' || typeof m.text !== 'string' || typeof m.read !== 'boolean')
    || state.notifications.some((n) => !n || typeof n.id !== 'string' || typeof n.title !== 'string' || typeof n.body !== 'string' || typeof n.read !== 'boolean')
    || state.store.some((i) => !i || typeof i.id !== 'string' || typeof i.title !== 'string' || typeof i.note !== 'string' || !Number.isFinite(i.createdAt))
    || typeof state.name !== 'string' || typeof state.bio !== 'string' || Object.values(state.library).some((value) => !Number.isFinite(value))) throw new Error('Cihaz kaydı açılamadı.');
  return state;
}
export async function loadLocalAccount(userId: string | null, initial: State) {
  const [raw, old, claimRaw, guestRaw] = await Promise.all([AsyncStorage.getItem(localKey(userId)), AsyncStorage.getItem(LEGACY_KEY),
    AsyncStorage.getItem(CLAIM_KEY), userId ? AsyncStorage.getItem(localKey(null)) : Promise.resolve(null)]);
  const claim = decodeClaim(claimRaw, initial), claimedBy = claim?.ownerId;
  let legacy: State;
  try { legacy = decodeState(old, initial); } catch (error) { if (!raw && !(claim?.ownerId === userId && claim.state)) throw error; legacy = initial; }
  const guest = !claimedBy && guestRaw ? decodeState(guestRaw, initial) : initial;
  const hasContent = (value: State) => value.drafts.some((draft) => !draft.ownerId) || value.saved.length > 0 || value.store.length > 0
    || Object.keys(value.library).length > 0 || value.messages.length > 0 || value.notifications.length > 0 || value.name !== 'Okur' || !!value.bio;
  const hasLegacy = hasContent(legacy) || hasContent(guest);
  const available = !!userId && hasLegacy && (!claimedBy || claimedBy === userId);
  let state: State;
  if (raw) state = decodeState(raw, initial);
  else if (userId) state = { ...initial, drafts: legacy.drafts.filter((draft) => draft.ownerId === userId) };
  else state = claimedBy ? { ...initial } : { ...legacy, drafts: legacy.drafts.filter((draft) => !draft.ownerId) };
  if (!userId && claimedBy && state.guestAfterClaim !== claimedBy) state = { ...initial, guestAfterClaim: claimedBy };
  // The claim is an atomic recovery snapshot, retained even if the next write fails.
  if (userId && claimedBy === userId && claim?.state && !state.legacyImported) state = mergeLegacy(state, claim.state);
  // A stale/corrupt local snapshot can never expose another account's drafts.
  state = { ...state, drafts: state.drafts.filter((draft) => userId ? draft.ownerId === userId : !draft.ownerId) };
  return { state, legacyAvailable: available && !state.legacyImported };
}
export async function legacyToImport(userId: string, initial: State) {
  const reserve = async () => {
    const claim = decodeClaim(await AsyncStorage.getItem(CLAIM_KEY), initial);
    if (claim && claim.ownerId !== userId) throw new Error('Bu eski kayıtlar başka bir hesaba aktarılmış.');
    if (claim?.state) return claim.state;
    const legacy = decodeState(await AsyncStorage.getItem(LEGACY_KEY), initial);
    const guestRaw = await AsyncStorage.getItem(localKey(null));
    const guest = guestRaw ? decodeState(guestRaw, initial) : initial;
    const source = { ...mergeLegacy(guest, legacy), name: guestRaw ? guest.name : legacy.name, bio: guestRaw ? guest.bio : legacy.bio };
    const state = { ...source, drafts: source.drafts.filter((draft) => !draft.ownerId || draft.ownerId === userId).map((draft) => ({ ...draft, ownerId: userId })) };
    // One atomic write both reserves ownership and stores the latest anonymous
    // content. Neither failed persistence nor guest cleanup can destroy it.
    await AsyncStorage.setItem(CLAIM_KEY, JSON.stringify({ ownerId: userId, state }));
    return state;
  };
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(CLAIM_KEY, reserve);
  const operation = claimQueue.then(reserve, reserve);
  claimQueue = operation.then(() => undefined, () => undefined);
  return operation;
}
export function mergeLegacy(current: State, legacy: State): State {
  const drafts = [...current.drafts, ...legacy.drafts.filter((draft) => !current.drafts.some((own) => own.id === draft.id))];
  const store = [...current.store, ...legacy.store.filter((item) => !current.store.some((own) => own.id === item.id))];
  const messages = [...current.messages, ...legacy.messages.filter((item) => !current.messages.some((own) => own.id === item.id))];
  const notifications = [...current.notifications, ...legacy.notifications.filter((item) => !current.notifications.some((own) => own.id === item.id))];
  return { ...current, drafts, store, messages, notifications, library: { ...legacy.library, ...current.library },
    saved: [...new Set([...current.saved, ...legacy.saved])], name: legacy.name, bio: legacy.bio, legacyImported: true };
}
