import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@clerk/expo';
import { localKey, loadLocalAccount, legacyToImport, mergeLegacy } from '@/lib/local-account-data';

export type Draft = { id: string; title: string; body: string; updatedAt: number; ownerId?: string };
export type StoreItem = { id: string; title: string; note: string; createdAt: number };
export type Message = { id: string; from: string; text: string; read: boolean };
export type AppNotification = { id: string; title: string; body: string; read: boolean };
export type State = { saved: string[]; library: Record<string, number>; drafts: Draft[]; store: StoreItem[]; messages: Message[]; notifications: AppNotification[]; name: string; bio: string; legacyImported?: boolean; guestAfterClaim?: string };
const initial: State = { saved: [], library: {}, drafts: [], store: [], messages: [], notifications: [], name: 'Okur', bio: '' };

type Ctx = State & {
  ready: boolean; unread: number;
  legacyAvailable: boolean; storageError: string | null;
  importLocalData: () => Promise<{ name: string; bio: string }>; retryLoad: () => void;
  toggleSave: (id: string) => void; isSaved: (id: string) => boolean;
  openBook: (id: string, chapter: number) => void;
  saveDraft: (d: { id?: string; title: string; body: string }) => Draft;
  deleteDraft: (id: string) => void;
  addStoreItem: (title: string, note: string) => void; removeStoreItem: (id: string) => void;
  markAllRead: () => void; setProfile: (name: string, bio: string) => void;
  markNotificationRead: (id: string) => void;
};
const C = createContext<Ctx | null>(null);
const uid = () => Date.now().toString() + Math.random().toString(36).slice(2, 9);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const { userId: authUserId } = useAuth();
  const userId = authUserId ?? null;
  const [s, setS] = useState<State>(initial);
  const [ready, setReady] = useState(false);
  const [legacyAvailable, setLegacyAvailable] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const loadedFor = useRef<string | null | undefined>(undefined);
  const currentUser = useRef(userId); currentUser.current = userId;
  const currentState = useRef(s); currentState.current = s;
  useEffect(() => {
    let active = true;
    loadedFor.current = undefined;
    setS(initial); setReady(false); setStorageError(null); setLegacyAvailable(false);
    loadLocalAccount(userId, initial).then(({ state, legacyAvailable }) => {
      if (!active) return;
      loadedFor.current = userId; setS(state); setLegacyAvailable(legacyAvailable); setReady(true);
    }).catch(() => { if (active) setStorageError('Cihaz kayıtların açılamadı. Eski verilerin korunuyor; yeniden dene.'); });
    return () => { active = false; };
  }, [userId, loadAttempt]);
  useEffect(() => {
    if (!ready || loadedFor.current !== userId) return;
    let active = true;
    AsyncStorage.setItem(localKey(userId), JSON.stringify(s)).then(() => { if (active) setStorageError(null); })
      .catch(() => { if (active) setStorageError('Cihaz kaydı başarısız. İçeriğin bu oturumda korunuyor; yeniden dene.'); });
    return () => { active = false; };
  }, [s, ready, userId]);
  const retryLoad = useCallback(() => {
    const owner = currentUser.current;
    if (ready && loadedFor.current === owner) {
      void AsyncStorage.setItem(localKey(owner), JSON.stringify(currentState.current))
        .then(() => { if (currentUser.current === owner) setStorageError(null); })
        .catch(() => { if (currentUser.current === owner) setStorageError('Cihaz kaydı başarısız. İçeriğin bu oturumda korunuyor; yeniden dene.'); });
    } else setLoadAttempt((value) => value + 1);
  }, [ready]);
  const updateState = useCallback((updater: (value: State) => State) => {
    const owner = userId;
    if (loadedFor.current !== owner || currentUser.current !== owner) throw new Error('Cihaz kayıtların henüz hazır değil. Yeniden dene.');
    setS((value) => currentUser.current === owner ? updater(value) : value);
  }, [userId]);
  const importLocalData = useCallback(async () => {
    if (!userId || !ready || loadedFor.current !== userId) throw new Error('Önce hesabına giriş yap.');
    const owner = userId;
    const legacy = await legacyToImport(owner, initial);
    const base = currentUser.current === owner ? currentState.current : (await loadLocalAccount(owner, initial)).state;
    const merged = mergeLegacy(base, legacy);
    await AsyncStorage.setItem(localKey(owner), JSON.stringify(merged));
    if (currentUser.current === owner) { setS((value) => mergeLegacy(value, legacy)); setLegacyAvailable(false); }
    return { name: legacy.name, bio: legacy.bio };
  }, [userId, ready]);

  const toggleSave = useCallback((id: string) => updateState((p) => ({ ...p, saved: p.saved.includes(id) ? p.saved.filter((x) => x !== id) : [id, ...p.saved] })), [updateState]);
  const openBook = useCallback((id: string, chapter: number) => updateState((p) => ({ ...p, library: { ...p.library, [id]: chapter } })), [updateState]);
  const saveDraft = useCallback((d: { id?: string; title: string; body: string }) => {
    const draft: Draft = {
      id: d.id ?? uid(), title: d.title, body: d.body, updatedAt: Date.now(),
      ownerId: userId ?? undefined,
    };
    updateState((p) => ({ ...p, drafts: [draft, ...p.drafts.filter((x) => x.id !== draft.id)] }));
    return draft;
  }, [userId, updateState]);
  const deleteDraft = useCallback((id: string) => updateState((p) => ({ ...p, drafts: p.drafts.filter((x) => x.id !== id) })), [updateState]);
  const addStoreItem = useCallback((title: string, note: string) => updateState((p) => ({ ...p, store: [{ id: uid(), title, note, createdAt: Date.now() }, ...p.store] })), [updateState]);
  const removeStoreItem = useCallback((id: string) => updateState((p) => ({ ...p, store: p.store.filter((x) => x.id !== id) })), [updateState]);
  const markAllRead = useCallback(() => updateState((p) => ({ ...p, messages: p.messages.map((m) => ({ ...m, read: true })) })), [updateState]);
  const setProfile = useCallback((name: string, bio: string) => updateState((p) => ({ ...p, name, bio })), [updateState]);
  const markNotificationRead = useCallback((id: string) => updateState((p) => ({
    ...p, notifications: p.notifications.map((n) => n.id === id ? { ...n, read: true } : n),
  })), [updateState]);

  const value = useMemo<Ctx>(() => {
    const visible = loadedFor.current === userId ? s : initial;
    return {
      ...visible, ready: ready && loadedFor.current === userId, legacyAvailable: loadedFor.current === userId && legacyAvailable,
      storageError, importLocalData, retryLoad, unread: visible.messages.filter((m) => !m.read).length,
      toggleSave, isSaved: (id) => visible.saved.includes(id), openBook, saveDraft, deleteDraft, addStoreItem, removeStoreItem, markAllRead, setProfile, markNotificationRead,
    };
  }, [s, ready, userId, legacyAvailable, storageError, importLocalData, retryLoad, toggleSave, openBook, saveDraft, deleteDraft, addStoreItem, removeStoreItem, markAllRead, setProfile, markNotificationRead]);
  return <C.Provider value={value}>{children}</C.Provider>;
}
export function useApp() { const c = useContext(C); if (!c) throw new Error('useApp outside provider'); return c; }
