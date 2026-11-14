import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Image, Modal, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useGetWriterImageAccess, getGetWriterImageAccessQueryKey, useGetWriterPresets, getGetWriterPresetsQueryKey } from '@workspace/api-client-react';
import { F, tap } from '@/components/ui';
import { b, Btn, mediaUrl } from '@/components/bulletins/common';
import { scoped } from '@/components/profile/hooks';
import { useCommunity } from '@/context/CommunityContext';
import { writerMediaId } from '@/lib/writer-text';

export const W = {
  ...b, ink: b.text, paper: b.card, cream: b.background, soft: '#EADFC9', line: '#E3D3B5', deep: '#2B1D12', ok: '#5B7B4A', night: '#211810',
};

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let on = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (on) setReduced(v); }).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { on = false; sub.remove(); };
  }, []);
  return reduced;
}

/** Fades content in once; instant when the user prefers reduced motion. */
export function FadeIn({ children, delay = 0, style }: { children: React.ReactNode; delay?: number; style?: ViewStyle }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) { v.setValue(1); return; }
    Animated.timing(v, { toValue: 1, duration: 320, delay, useNativeDriver: true }).start();
  }, [reduced, v, delay]);
  return <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}>{children}</Animated.View>;
}

export type ToastMsg = { text: string; tone: 'ok' | 'warn' | 'err'; at: number } | null;
export function Toast({ msg }: { msg: ToastMsg }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState<ToastMsg>(null);
  useEffect(() => {
    if (!msg) return;
    setShown(msg);
    AccessibilityInfo.announceForAccessibility(msg.text);
    v.setValue(reduced ? 1 : 0);
    if (!reduced) Animated.timing(v, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    const t = setTimeout(() => setShown(null), msg.tone === 'err' ? 6000 : 3200);
    return () => clearTimeout(t);
  }, [msg, reduced, v]);
  if (!shown) return null;
  const icon = shown.tone === 'ok' ? 'check-circle' : shown.tone === 'warn' ? 'cloud-off' : 'alert-triangle';
  return (
    <Animated.View pointerEvents="none" accessibilityLiveRegion="polite" style={[st.toast, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) }] }, shown.tone === 'err' && { backgroundColor: W.danger }]}>
      <Feather name={icon} size={16} color={W.gold} />
      <Text style={st.toastText}>{shown.text}</Text>
    </Animated.View>
  );
}

export function Chip({ label, on, onPress, testID, disabled }: { label: string; on: boolean; onPress: () => void; testID?: string; disabled?: boolean }) {
  return (
    <Pressable testID={testID} disabled={disabled} accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled }} accessibilityLabel={label}
      onPress={() => { tap(); onPress(); }} style={({ pressed }) => [st.chip, on && st.chipOn, { opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }]}>
      {on ? <Feather name="check" size={13} color={W.ink} /> : null}
      <Text style={[st.chipText, on && { color: W.ink, fontFamily: F.semi }]}>{label}</Text>
    </Pressable>
  );
}

export function Segmented<T extends string>({ value, options, onChange, testID }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; testID?: string }) {
  return (
    <View style={st.seg} accessibilityRole="radiogroup" testID={testID}>
      {options.map((o) => (
        <Pressable key={o.v} testID={testID ? testID + '-' + o.v : undefined} accessibilityRole="radio" accessibilityState={{ selected: value === o.v }} accessibilityLabel={o.label}
          onPress={() => { tap(); onChange(o.v); }} style={[st.segItem, value === o.v && st.segOn]}>
          <Text style={[st.segText, value === o.v && { color: W.paper }]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Label({ children, right }: { children: string; right?: string }) {
  return (
    <View style={st.labelRow}>
      <Text style={st.label}>{children}</Text>
      {right ? <Text style={st.counter}>{right}</Text> : null}
    </View>
  );
}

/** Resolves a document cover reference (preset:, private canonical media, local photo) to something displayable. */
export function useCoverUri(cover: string | null | undefined, localUri?: string | null, visibility: 'private' | 'published' = 'private'): string | null {
  const { userId, ready } = useCommunity();
  const mid = writerMediaId(cover);
  const isPreset = !!cover && cover.startsWith('preset:');
  const presets = useGetWriterPresets({ query: { enabled: isPreset && ready, queryKey: scoped(getGetWriterPresetsQueryKey(), userId), staleTime: 3_600_000 } });
  const access = useGetWriterImageAccess(mid ?? '', { query: { enabled: visibility === 'private' && !!mid && ready && !!userId && !localUri, queryKey: scoped(getGetWriterImageAccessQueryKey(mid ?? ''), userId), staleTime: 240_000 } });
  if (localUri) return localUri;
  if (isPreset) { const p = presets.data?.find((x) => x.cover === cover); return p ? mediaUrl(p.url) : null; }
  if (mid) return visibility === 'published' ? mediaUrl(cover!) : access.data?.url ?? null;
  if (visibility === 'published' && cover?.startsWith('/api/')) return mediaUrl(cover);
  if (cover && /^https?:/.test(cover)) return cover;
  return null;
}

export function WriterCover({ uri, title, author, w, adult, completed, loading }: { uri: string | null; title: string; author?: string; w: number; adult?: boolean; completed?: boolean; loading?: boolean }) {
  const h = Math.round(w * 1.5);
  const small = w < 80;
  return (
    <View style={[st.cover, { width: w, height: h, borderRadius: small ? 6 : 12 }]} accessibilityLabel={(title || 'Adsız kitap') + ' kapağı'}>
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : (
        <View style={[StyleSheet.absoluteFill, st.coverBlank, { padding: w * 0.1 }]}>
          <View style={st.coverRule} />
          <Text numberOfLines={4} style={[st.coverTitle, { fontSize: Math.max(8, w * 0.13), lineHeight: Math.max(10, w * 0.17) }]}>{title || 'Adsız kitap'}</Text>
          <View style={{ flex: 1 }} />
          {author ? <Text numberOfLines={1} style={[st.coverAuthor, { fontSize: Math.max(6, w * 0.08) }]}>{author}</Text> : null}
          <View style={st.coverRule} />
        </View>
      )}
      <View style={st.spine} />
      {loading ? <View style={[StyleSheet.absoluteFill, st.coverShade]}><Feather name="upload-cloud" size={small ? 14 : 26} color={W.paper} /><Text style={[st.coverShadeText, small && { fontSize: 8 }]}>Yükleniyor</Text></View> : null}
      {adult ? <View style={[st.badge, st.badgeTop, small && st.badgeSmall]}><Text style={[st.badgeText, small && { fontSize: 7 }]}>+18</Text></View> : null}
      {completed ? <View style={[st.badge, st.badgeBottom, small && st.badgeSmall]}><Text style={[st.badgeText, small && { fontSize: 7 }]}>Tamamlandı</Text></View> : null}
    </View>
  );
}

export function Confirm({ visible, title, text, confirm, danger, busy, onCancel, onConfirm }: { visible: boolean; title: string; text: string; confirm: string; danger?: boolean; busy?: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={st.backdrop}>
        <View style={st.confirm} accessibilityViewIsModal>
          <Text style={st.confirmTitle} accessibilityRole="header">{title}</Text>
          <Text style={st.confirmText}>{text}</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
            <Btn label="Vazgeç" ghost onPress={onCancel} disabled={busy} style={{ flex: 1 }} testID="writer-confirm-cancel" />
            <Btn label={confirm} onPress={onConfirm} busy={busy} style={{ flex: 1, ...(danger ? { backgroundColor: W.danger, borderColor: W.danger } : {}) }} testID="writer-confirm-ok" />
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function Banner({ icon, tone, title, text, children, testID }: { icon: keyof typeof Feather.glyphMap; tone: 'warn' | 'err' | 'info'; title: string; text?: string; children?: React.ReactNode; testID?: string }) {
  const color = tone === 'err' ? W.danger : tone === 'warn' ? '#9A6B1F' : W.ink;
  return (
    <View style={[st.banner, { borderColor: color }]} testID={testID} accessibilityRole="alert">
      <Feather name={icon} size={18} color={color} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[st.bannerTitle, { color }]}>{title}</Text>
        {text ? <Text style={st.bannerText}>{text}</Text> : null}
        {children ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>{children}</View> : null}
      </View>
    </View>
  );
}

export function Skeleton({ h, style }: { h: number; style?: ViewStyle }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(Animated.sequence([Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: true }), Animated.timing(v, { toValue: 0.5, duration: 700, useNativeDriver: true })]));
    loop.start(); return () => loop.stop();
  }, [reduced, v]);
  return <Animated.View style={[{ height: h, borderRadius: 14, backgroundColor: W.input, opacity: v }, style]} />;
}

export const st = StyleSheet.create({
  toast: { position: 'absolute', top: 8, alignSelf: 'center', zIndex: 50, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: W.deep, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, maxWidth: '92%' },
  toastText: { color: W.paper, fontFamily: F.med, fontSize: 13, flexShrink: 1 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 13, height: 34, borderRadius: 17, borderWidth: 1, borderColor: W.border, backgroundColor: W.paper },
  chipOn: { backgroundColor: W.gold, borderColor: W.gold },
  chipText: { fontFamily: F.med, fontSize: 13, color: W.ink },
  seg: { flexDirection: 'row', backgroundColor: W.input, borderRadius: 12, padding: 3 },
  segItem: { flex: 1, height: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  segOn: { backgroundColor: W.ink },
  segText: { fontFamily: F.semi, fontSize: 12.5, color: W.ink },
  labelRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 16, marginBottom: 8 },
  label: { fontFamily: F.semi, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: W.muted },
  counter: { fontFamily: F.body, fontSize: 11, color: W.muted, fontVariant: ['tabular-nums'] },
  cover: { overflow: 'hidden', backgroundColor: W.ink, shadowColor: W.deep, shadowOpacity: 0.28, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 5 },
  coverBlank: { backgroundColor: W.ink },
  coverRule: { height: 1, backgroundColor: W.gold, opacity: 0.8, marginVertical: 4 },
  coverTitle: { fontFamily: F.serifBold, color: W.paper, textAlign: 'center', marginTop: 6 },
  coverAuthor: { fontFamily: F.med, color: W.gold, textAlign: 'center', letterSpacing: 1 },
  spine: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: 'rgba(0,0,0,0.18)' },
  coverShade: { backgroundColor: 'rgba(43,29,18,0.55)', alignItems: 'center', justifyContent: 'center', gap: 6 },
  coverShadeText: { color: W.paper, fontFamily: F.semi, fontSize: 12 },
  badge: { position: 'absolute', backgroundColor: W.gold, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeTop: { top: 8, right: 8, backgroundColor: W.danger },
  badgeBottom: { bottom: 8, left: 10 },
  badgeSmall: { paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3 },
  badgeText: { fontFamily: F.semi, fontSize: 10, color: W.paper, letterSpacing: 0.3 },
  backdrop: { flex: 1, backgroundColor: 'rgba(43,29,18,0.45)', justifyContent: 'center', padding: 26 },
  confirm: { backgroundColor: W.paper, borderRadius: 18, padding: 20, gap: 8, maxWidth: 420, width: '100%', alignSelf: 'center' },
  confirmTitle: { fontFamily: F.serifBold, fontSize: 20, color: W.ink },
  confirmText: { fontFamily: F.body, fontSize: 14, lineHeight: 20, color: W.ink },
  banner: { flexDirection: 'row', gap: 10, borderWidth: 1, borderRadius: 14, padding: 12, backgroundColor: W.paper, marginHorizontal: 16, marginTop: 12 },
  bannerTitle: { fontFamily: F.semi, fontSize: 14 },
  bannerText: { fontFamily: F.body, fontSize: 12.5, lineHeight: 18, color: W.ink },
});
