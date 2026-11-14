import { Linking, Platform } from 'react-native';

export const OFFLINE_MESSAGE = 'İnternet bağlantısı yok, tekrar dene';
export const IG_HANDLE_RE = /^[A-Za-z0-9_.]{1,30}$/;
export const PROFILE_HANDLE_RE = /^[a-z0-9_.]{3,30}$/;

/** Accepts "@name", "name" or an instagram.com URL; returns the bare handle. */
export function normalizeInstagram(value: string): string {
  return value.trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^@/, '')
    .replace(/[/?#].*$/, '');
}
export function isValidInstagram(value: string): boolean { return IG_HANDLE_RE.test(value); }
export function instagramWebUrl(handle: string): string { return `https://www.instagram.com/${encodeURIComponent(handle)}/`; }
export function instagramAppUrl(handle: string): string { return `instagram://user?username=${encodeURIComponent(handle)}`; }

const HOSTS: Record<'facebook' | 'x', string[]> = {
  facebook: ['facebook.com'],
  x: ['x.com', 'twitter.com'],
};
/** Only verified https links on the platform's own host (www./m. allowed). */
export function isValidSocialUrl(url: string, kind: 'facebook' | 'x'): boolean {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
    return HOSTS[kind].includes(host) && u.pathname.length > 1;
  } catch { return false; }
}

type Fail = (message: string) => void;

/** Web: must be called synchronously inside the press handler (popup blockers). */
function openWeb(url: string) {
  if (typeof window === 'undefined') return;
  // noopener can return null even after successfully opening a tab. Open a
  // harmless blank tab first so that fallback cannot also navigate Afilli away.
  const w = window.open('about:blank', '_blank');
  if (!w) return window.location.assign(url);
  w.opener = null;
  w.location.replace(url);
}

export function openExternalUrl(url: string, offline: boolean, onFail: Fail) {
  if (offline) return onFail(OFFLINE_MESSAGE);
  if (Platform.OS === 'web') return openWeb(url);
  Linking.openURL(url).catch(() => onFail('Bağlantı açılamadı. ' + OFFLINE_MESSAGE));
}

/**
 * Native: check the scheme, open the Instagram user deep link, fall back to https.
 * A false query can mean restricted visibility in Expo Go on either platform.
 */
export function openInstagram(handle: string, offline: boolean, onFail: Fail) {
  if (offline) return onFail(OFFLINE_MESSAGE);
  const web = instagramWebUrl(handle);
  if (Platform.OS === 'web') return openWeb(web);
  const app = instagramAppUrl(handle);
  (async () => {
    let can = false;
    try { can = await Linking.canOpenURL(app); } catch { can = false; }
    if (can || Platform.OS === 'android' || Platform.OS === 'ios') {
      try { await Linking.openURL(app); return; } catch { /* fall through to https */ }
    }
    await Linking.openURL(web);
  })().catch(() => onFail('Instagram açılamadı. ' + OFFLINE_MESSAGE));
}
