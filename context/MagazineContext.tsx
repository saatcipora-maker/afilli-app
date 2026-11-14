import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  EMPTY_MAGAZINE_DRAFT, SAMPLE_MAGAZINE, SAMPLE_MAGAZINE_ID, limitMagazineText,
  validateMagazinePublication, type MagazineComment, type MagazineDraft,
  type MagazinePost, type MagazineResult,
} from '@/data/magazine';

type MagazineState = {
  draft: MagazineDraft;
  posts: MagazinePost[];
  likedIds: string[];
  reads: Record<string, number>;
  comments: Record<string, MagazineComment[]>;
};
const INITIAL: MagazineState = { draft: EMPTY_MAGAZINE_DRAFT, posts: [], likedIds: [], reads: {}, comments: {} };
const STORAGE_KEY = 'afilli:magazine:v1';
// No local-storage flag can grant paid membership. Replace this adapter with
// a verified billing entitlement only when the user connects a payment provider.
const membership: { status: 'unavailable' | 'active' | 'inactive'; isSubscriber: boolean } = {
  status: 'unavailable', isSubscriber: false,
};

type MagazineContextValue = MagazineState & {
  ready: boolean;
  storageError: string | null;
  isSubscriber: boolean;
  subscriptionStatus: typeof membership.status;
  updateDraft: (patch: Partial<MagazineDraft>) => void;
  publish: (author: string) => MagazineResult;
  getPost: (id: string) => MagazinePost | undefined;
  toggleLike: (id: string) => void;
  recordRead: (id: string) => void;
  addComment: (id: string, text: string, author: string) => MagazineResult;
  getStats: (id: string) => { likes: number; comments: number; reads: number; liked: boolean };
};
const MagazineContext = createContext<MagazineContextValue | null>(null);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

export function MagazineProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<MagazineState>(INITIAL);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (!active) return;
      if (raw) {
        const saved = JSON.parse(raw);
        if (!saved || !Array.isArray(saved.posts) || !Array.isArray(saved.likedIds)) throw new Error('Geçersiz dergi kaydı');
        setState({
          ...INITIAL, ...saved,
          draft: { ...EMPTY_MAGAZINE_DRAFT, ...saved.draft, text: limitMagazineText(saved.draft?.text ?? '').text },
        });
      }
      setReady(true);
    }).catch(() => {
      if (active) setStorageError('Dergi kayıtları açılamadı. Verilerinizi korumak için değişiklikler durduruldu; sayfayı yeniden açın.');
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const snapshot = JSON.stringify(state);
    queue.current = queue.current.then(() => AsyncStorage.setItem(STORAGE_KEY, snapshot))
      .then(() => setStorageError(null))
      .catch(() => setStorageError('Değişiklikler bu cihaza kaydedilemedi. Bu ekranı kapatmadan önce tekrar deneyin.'));
  }, [state, ready]);

  const getPost = useCallback((id: string) =>
    id === SAMPLE_MAGAZINE_ID ? SAMPLE_MAGAZINE : state.posts.find((post) => post.id === id), [state.posts]);

  const updateDraft = useCallback((patch: Partial<MagazineDraft>) => {
    if (!ready) return;
    setState((s) => ({
      ...s, draft: { ...s.draft, ...patch, ...(patch.text !== undefined ? { text: limitMagazineText(patch.text).text } : {}) },
    }));
  }, [ready]);

  const publish = useCallback((author: string): MagazineResult => {
    if (!ready) return { ok: false, error: 'Dergi kayıtlarının yüklenmesini bekleyin.' };
    const result = validateMagazinePublication(state.draft.text, membership.isSubscriber);
    if (!result.ok) return result;
    const post: MagazinePost = {
      id: uid(), title: state.draft.text.trim().split(/\n/u)[0].slice(0, 100),
      body: state.draft.text.trim(), author: author.trim() || 'Okur',
      image: state.draft.image, likesEnabled: state.draft.likesEnabled,
      commentsEnabled: state.draft.commentsEnabled, createdAt: Date.now(),
    };
    setState((s) => ({ ...s, posts: [post, ...s.posts], draft: { ...EMPTY_MAGAZINE_DRAFT } }));
    return { ok: true, id: post.id };
  }, [ready, state.draft]);

  const toggleLike = useCallback((id: string) => {
    if (!ready || !getPost(id)?.likesEnabled) return;
    setState((s) => ({ ...s, likedIds: s.likedIds.includes(id) ? s.likedIds.filter((value) => value !== id) : [...s.likedIds, id] }));
  }, [getPost, ready]);

  const recordRead = useCallback((id: string) => {
    if (!ready || !getPost(id)) return;
    setState((s) => ({ ...s, reads: { ...s.reads, [id]: (s.reads[id] ?? 0) + 1 } }));
  }, [getPost, ready]);

  const addComment = useCallback((id: string, text: string, author: string): MagazineResult => {
    if (!ready) return { ok: false, error: 'Dergi kayıtlarının yüklenmesini bekleyin.' };
    if (!getPost(id)?.commentsEnabled) return { ok: false, error: 'Bu yazıya yorum yapılamaz.' };
    if (!text.trim()) return { ok: false, error: 'Önce yorumunuzu yazın.' };
    const comment: MagazineComment = { id: uid(), body: text.trim(), author: author.trim() || 'Okur', createdAt: Date.now() };
    setState((s) => ({ ...s, comments: { ...s.comments, [id]: [...(s.comments[id] ?? []), comment] } }));
    return { ok: true };
  }, [getPost, ready]);

  const getStats = useCallback((id: string) => ({
    likes: (id === SAMPLE_MAGAZINE_ID ? 1200 : 0) + (state.likedIds.includes(id) ? 1 : 0),
    comments: (id === SAMPLE_MAGAZINE_ID ? 234 : 0) + (state.comments[id]?.length ?? 0),
    reads: (id === SAMPLE_MAGAZINE_ID ? 5300 : 0) + (state.reads[id] ?? 0),
    liked: state.likedIds.includes(id),
  }), [state.likedIds, state.comments, state.reads]);

  const value = useMemo<MagazineContextValue>(() => ({
    ...state, ready, storageError, isSubscriber: membership.isSubscriber, subscriptionStatus: membership.status,
    updateDraft, publish, getPost, toggleLike, recordRead, addComment, getStats,
  }), [state, ready, storageError, updateDraft, publish, getPost, toggleLike, recordRead, addComment, getStats]);
  return <MagazineContext.Provider value={value}>{children}</MagazineContext.Provider>;
}

export function useMagazine() {
  const context = useContext(MagazineContext);
  if (!context) throw new Error('Dergi sağlayıcısı bulunamadı.');
  return context;
}
