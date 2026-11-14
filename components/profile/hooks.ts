import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { useCommunity } from '@/context/CommunityContext';
import { router, useFocusEffect, type Href } from 'expo-router';
import * as Network from 'expo-network';

/** Real device network state; only a definite "false" counts as offline. */
export function useOffline(): boolean {
  const st = Network.useNetworkState();
  return st.isConnected === false || st.isInternetReachable === false;
}

/** True only while this screen is focused AND the app is in the foreground. */
export function useFocusedForeground(): boolean {
  const [focused, setFocused] = useState(false);
  const [fg, setFg] = useState(AppState.currentState === 'active' || AppState.currentState == null);
  const [visible, setVisible] = useState(() => !webDoc() || webDoc()!.visibilityState !== 'hidden');
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setFg(s === 'active'));
    return () => sub.remove();
  }, []);
  // On web AppState can lag tab visibility; listen to the document directly.
  useEffect(() => {
    const d = webDoc();
    if (!d) return;
    const on = () => setVisible(d.visibilityState !== 'hidden');
    on();
    d.addEventListener('visibilitychange', on);
    return () => d.removeEventListener('visibilitychange', on);
  }, []);
  return focused && fg && visible;
}

function webDoc(): Document | null {
  return Platform.OS === 'web' && typeof document !== 'undefined' ? document : null;
}

/** Identity-scoped query key: appends the viewer so account A's cache is never served to B. */
export function scoped<T extends readonly unknown[]>(base: T, userId: string | null | undefined): T {
  return [...base, { as: userId ?? 'guest' }] as unknown as T;
}

/** Stable key for remounting identity-bound subtrees; 'pending' until the session is ready. */
export function useIdentityKey(extra = ''): string {
  const { ready, userId } = useCommunity();
  return (ready ? userId ?? 'guest' : 'pending') + (extra ? ':' + extra : '');
}

/** Renders Inner remounted per identity (and optional extra key) so no state survives an account switch. */
export function withIdentity<P extends object>(Inner: React.ComponentType<P>, extra?: (p: P) => string) {
  return function IdentityBound(props: P) {
    const key = useIdentityKey(extra ? extra(props) : '');
    return React.createElement(Inner, { ...props, key });
  };
}

/** Live guard for async callbacks: true only while mounted and the session still belongs to owner. */
export function useOwnerGuard(owner: string | null) {
  const { userId } = useCommunity();
  const live = useRef(userId); live.current = userId;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return useCallback(() => mounted.current && !!owner && live.current === owner, [owner]);
}

export function actorRequest(userId: string | null): { headers: Record<string, string> } {
  return { headers: userId ? { 'X-Afilli-Actor': userId } : {} };
}

export function compactCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(1).replace('.0', '').replace('.', ',') + 'b';
  return (n / 1_000_000).toFixed(1).replace('.0', '').replace('.', ',') + 'm';
}

export function go(path: string) { router.push(path as Href); }
export function goBack(fallback = '/profile') {
  if (router.canGoBack()) router.back(); else router.replace(fallback as Href);
}
