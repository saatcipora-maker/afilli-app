import React, { useEffect } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import colors from '@/constants/colors';
import { F, tap } from '@/components/ui';
import { mediaUrl, timeAgo } from '@/components/bulletins/common';
import { goBack } from './hooks';

export const P = colors.magazine;
export const S = colors.social;

/** Slow opacity breathing; static when the user prefers reduced motion. */
function useShimmer(min = 0.35, max = 0.85, ms = 2600) {
  const reduce = useReducedMotion();
  const v = useSharedValue(max);
  useEffect(() => {
    if (reduce) { v.value = max; return; }
    v.value = min;
    v.value = withRepeat(withTiming(max, { duration: ms, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(v);
  }, [reduce, min, max, ms, v]);
  return useAnimatedStyle(() => ({ opacity: v.value }));
}

/** Fixed, non-scrolling cream marble with faint gold veins and corner dust. */
export function MarbleBackground() {
  const dust = useShimmer(0.25, 0.7, 3400);
  const dots = [[6, 8, 2], [14, 4, 1.5], [10, 14, 1], [88, 6, 1.6], [94, 12, 2.2], [82, 3, 1], [5, 92, 1.8], [12, 96, 1.2], [92, 90, 2], [86, 97, 1.3]];
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: P.background }]} />
      <Svg width="100%" height="100%" viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice">
        <Path d="M-20 120 C 80 90, 140 180, 230 150 S 360 60, 430 110" stroke={S.vein} strokeOpacity={0.13} strokeWidth={1.2} fill="none" />
        <Path d="M-10 160 C 60 150, 120 210, 200 190" stroke={S.vein} strokeOpacity={0.08} strokeWidth={0.7} fill="none" />
        <Path d="M410 380 C 320 350, 280 440, 180 420 S 40 470, -20 440" stroke={S.vein} strokeOpacity={0.1} strokeWidth={1} fill="none" />
        <Path d="M-20 690 C 90 650, 170 720, 260 700 S 380 640, 430 670" stroke={S.vein} strokeOpacity={0.12} strokeWidth={1.1} fill="none" />
        <Path d="M120 -10 C 140 80, 90 140, 120 230" stroke={S.vein} strokeOpacity={0.06} strokeWidth={0.8} fill="none" />
      </Svg>
      <Animated.View style={[StyleSheet.absoluteFill, dust]}>
        {dots.map(([x, y, r], i) => (
          <View key={i} style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, width: r * 2, height: r * 2, borderRadius: r, backgroundColor: S.foilMid }} />
        ))}
      </Animated.View>
    </View>
  );
}

export function TopBar({ title, back, right, backFallback = '/profile' }: { title: string; back?: boolean; right?: React.ReactNode; backFallback?: string }) {
  const ins = useSafeAreaInsets();
  return (
    <View style={[k.top, { paddingTop: (Platform.OS === 'web' ? 67 : ins.top) + 6 }]}>
      {back ? (
        <Pressable testID="profile-back" accessibilityRole="button" accessibilityLabel="Geri" hitSlop={8} onPress={() => { tap(); goBack(backFallback); }} style={k.round}>
          <Feather name="chevron-left" size={22} color={P.text} />
        </Pressable>
      ) : null}
      <Text accessibilityRole="header" numberOfLines={1} style={[k.title, { fontSize: back ? 24 : 32 }]}>{title}</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>{right}</View>
    </View>
  );
}

export function RoundIcon({ icon, label, onPress, testID }: { icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void; testID: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} hitSlop={6} onPress={() => { tap(); onPress(); }}
      style={({ pressed }) => [k.round, { opacity: pressed ? 0.7 : 1 }]}>
      <Feather name={icon} size={19} color={P.text} />
    </Pressable>
  );
}

export type Presence = { online: boolean; typing: boolean; lastSeen: string | null };
export function presenceOf(p: Presence) {
  if (p.typing) return { color: S.typing, text: 'Yazıyor...' };
  if (p.online) return { color: S.online, text: 'Çevrimiçi' };
  return { color: S.offline, text: p.lastSeen ? 'Son görülme: ' + timeAgo(p.lastSeen) : 'Çevrimdışı' };
}

export function GoldAvatar({ nickname, avatar, size = 112, crown, presence }: { nickname: string; avatar: string | null; size?: number; crown?: 'premium' | 'popular' | null; presence?: Presence | null }) {
  const glint = useShimmer(0.45, 1, 2200);
  const initials = (nickname.trim() || 'A').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toLocaleUpperCase('tr-TR');
  const inner = size - 16;
  const st = presence ? presenceOf(presence) : null;
  return (
    <View style={{ width: size, height: size + (crown ? 14 : 0), alignItems: 'center', justifyContent: 'flex-end' }}>
      {crown ? (
        <View style={k.crown} accessible accessibilityLabel={crown === 'premium' ? 'Premium yazar' : 'Çok okunan yazar'}>
          <MaterialCommunityIcons name="crown" size={26} color={S.foilMid} />
        </View>
      ) : null}
      <LinearGradient colors={[S.foilLight, S.foilMid, S.foilDeep, S.foilMid]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', shadowColor: S.foilDeep, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 }}>
        <View style={{ width: size - 9, height: size - 9, borderRadius: size, backgroundColor: P.card, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: inner + 2, height: inner + 2, borderRadius: size, borderWidth: 1, borderColor: S.foilMid, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            {avatar ? <Image source={{ uri: mediaUrl(avatar) }} style={{ width: inner, height: inner, borderRadius: inner / 2 }} resizeMode="cover" accessibilityIgnoresInvertColors />
              : <Text style={{ fontFamily: F.serifBold, fontSize: inner * 0.36, color: P.text }}>{initials}</Text>}
          </View>
        </View>
      </LinearGradient>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, glint]}>
        {[[0.15, 0.15], [0.85, 0.15], [0.15, 0.85]].map(([x, y], i) => (
          <View key={i} style={[k.ornament, { left: size * x - 3, top: (crown ? 14 : 0) + size * y - 3 }]} />
        ))}
      </Animated.View>
      {st ? <View testID="profile-status-dot" accessibilityLabel={st.text} style={[k.status, { backgroundColor: st.color, right: size * 0.06, bottom: size * 0.06 }]} /> : null}
    </View>
  );
}

export function StatusLine({ presence }: { presence: Presence }) {
  const st = presenceOf(presence);
  return (
    <View style={k.statusLine} testID="profile-status-text">
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: st.color }} />
      <Text style={[k.statusText, { color: presence.online || presence.typing ? P.text : P.muted }]}>{st.text}</Text>
    </View>
  );
}

export function FoilButton({ label, icon, onPress, testID, variant = 'foil', busy, disabled, style }: { label: string; icon?: keyof typeof Feather.glyphMap; onPress: () => void; testID: string; variant?: 'foil' | 'outline'; busy?: boolean; disabled?: boolean; style?: ViewStyle }) {
  const content = (
    <>
      {busy ? <ActivityIndicator size="small" color={P.text} /> : icon ? <Feather name={icon} size={16} color={P.text} /> : null}
      <Text style={k.btnText} numberOfLines={1}>{label}</Text>
    </>
  );
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled || !!busy, busy: !!busy }}
      disabled={disabled || busy} onPress={() => { tap(); onPress(); }}
      style={({ pressed }) => [{ flex: 1, opacity: disabled ? 0.5 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }, style]}>
      {variant === 'foil' ? (
        <LinearGradient colors={[S.foilLight, S.foilMid, S.foilDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[k.btn, { borderColor: S.foilDeep }]}>{content}</LinearGradient>
      ) : <View style={[k.btn, { backgroundColor: P.card, borderColor: P.gold }]}>{content}</View>}
    </Pressable>
  );
}

export function StatCard({ icon, value, label, onPress, testID }: { icon: keyof typeof MaterialCommunityIcons.glyphMap; value: string; label: string; onPress: () => void; testID: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={`${value} ${label}, listeyi aç`} onPress={() => { tap(); onPress(); }}
      style={({ pressed }) => [k.stat, { transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
      <MaterialCommunityIcons name={icon} size={18} color={P.gold} />
      <Text style={k.statValue}>{value}</Text>
      <Text style={k.statLabel}>{label}</Text>
    </Pressable>
  );
}

export function PillTabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <View style={k.pills} accessibilityRole="tablist">
      {tabs.map((t) => {
        const on = t.key === value;
        return (
          <Pressable key={t.key} testID={'profile-tab-' + t.key} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => { tap(); onChange(t.key); }} style={{ flex: 1 }}>
            {on ? <LinearGradient colors={[S.foilLight, S.foilMid]} style={k.pill}><Text style={[k.pillText, { fontFamily: F.semi }]}>{t.label}</Text></LinearGradient>
              : <View style={k.pill}><Text style={[k.pillText, { color: P.muted }]}>{t.label}</Text></View>}
          </Pressable>
        );
      })}
    </View>
  );
}

export function StateCard({ icon, title, text, action, testID }: { icon: keyof typeof Feather.glyphMap; title: string; text: string; action?: { label: string; onPress: () => void; testID: string; icon?: keyof typeof Feather.glyphMap }; testID?: string }) {
  return (
    <View style={k.state} testID={testID}>
      <View style={k.stateRing}><Feather name={icon} size={24} color={P.gold} /></View>
      <Text style={k.stateTitle}>{title}</Text>
      <Text style={k.stateText}>{text}</Text>
      {action ? <FoilButton label={action.label} icon={action.icon} onPress={action.onPress} testID={action.testID} style={{ flex: 0, minWidth: 180, marginTop: 6 }} /> : null}
    </View>
  );
}

export function Skeleton({ w, h, r = 10, style }: { w: number | `${number}%`; h: number; r?: number; style?: ViewStyle }) {
  const pulse = useShimmer(0.45, 0.9, 900);
  return <Animated.View style={[{ width: w, height: h, borderRadius: r, backgroundColor: P.input }, pulse, style]} />;
}

export function ProfileSkeleton() {
  return (
    <View style={{ alignItems: 'center', gap: 12, paddingTop: 24 }} testID="profile-skeleton" accessibilityLabel="Profil yükleniyor">
      <Skeleton w={112} h={112} r={56} />
      <Skeleton w={180} h={26} />
      <Skeleton w={110} h={14} />
      <Skeleton w="84%" h={58} r={18} style={{ marginTop: 10 }} />
      <View style={{ flexDirection: 'row', gap: 10, width: '90%' }}>{[0, 1, 2].map((i) => <Skeleton key={i} w="31%" h={78} r={16} />)}</View>
    </View>
  );
}

export function Notice({ text, tone = 'info', action, testID }: { text: string; tone?: 'info' | 'error'; action?: { label: string; onPress: () => void }; testID?: string }) {
  return (
    <View testID={testID} accessibilityLiveRegion="polite" style={[k.notice, { borderColor: tone === 'error' ? P.danger : P.border }]}>
      <Feather name={tone === 'error' ? 'wifi-off' : 'info'} size={16} color={tone === 'error' ? P.danger : P.gold} />
      <Text style={[k.noticeText, { color: tone === 'error' ? P.danger : P.text }]}>{text}</Text>
      {action ? <Pressable onPress={() => { tap(); action.onPress(); }} hitSlop={8} accessibilityRole="button"><Text style={k.noticeAction}>{action.label}</Text></Pressable> : null}
    </View>
  );
}

export const k = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingBottom: 8 },
  title: { flex: 1, fontFamily: F.serifBold, color: P.text, letterSpacing: 0.2 },
  round: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, borderColor: P.border, backgroundColor: P.card, alignItems: 'center', justifyContent: 'center' },
  crown: { position: 'absolute', top: -6, zIndex: 2 },
  ornament: { position: 'absolute', width: 6, height: 6, borderRadius: 3, backgroundColor: S.foilLight, borderWidth: 1, borderColor: S.foilDeep },
  status: { position: 'absolute', width: 20, height: 20, borderRadius: 10, borderWidth: 3, borderColor: P.card },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusText: { fontFamily: F.med, fontSize: 13 },
  btn: { minHeight: 46, borderRadius: 23, borderWidth: 1, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  btnText: { fontFamily: F.semi, fontSize: 14, color: P.text },
  stat: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 12, borderRadius: 16, borderWidth: 1, borderColor: P.border, backgroundColor: P.card, shadowColor: S.foilDeep, shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  statValue: { fontFamily: F.serifBold, fontSize: 21, color: P.text },
  statLabel: { fontFamily: F.body, fontSize: 12, color: P.muted },
  pills: { flexDirection: 'row', marginHorizontal: 18, padding: 4, gap: 4, borderRadius: 26, borderWidth: 1, borderColor: P.border, backgroundColor: P.card },
  pill: { minHeight: 40, borderRadius: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  pillText: { fontFamily: F.med, fontSize: 13, color: P.text },
  state: { alignItems: 'center', gap: 8, paddingHorizontal: 28, paddingVertical: 28 },
  stateRing: { width: 60, height: 60, borderRadius: 30, borderWidth: 1, borderColor: P.gold, backgroundColor: P.card, alignItems: 'center', justifyContent: 'center' },
  stateTitle: { fontFamily: F.serifBold, fontSize: 19, color: P.text, textAlign: 'center' },
  stateText: { fontFamily: F.body, fontSize: 14, lineHeight: 21, color: P.muted, textAlign: 'center' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 18, marginVertical: 6, padding: 12, borderRadius: 14, borderWidth: 1, backgroundColor: P.card },
  noticeText: { flex: 1, fontFamily: F.med, fontSize: 13, lineHeight: 19 },
  noticeAction: { fontFamily: F.semi, fontSize: 13, color: P.gold },
  card: { marginHorizontal: 18, borderRadius: 18, borderWidth: 1, borderColor: P.border, backgroundColor: P.card, overflow: 'hidden' },
  input: { minHeight: 48, borderWidth: 1, borderColor: P.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontFamily: F.body, fontSize: 15, color: P.text, backgroundColor: P.card },
  label: { fontFamily: F.semi, fontSize: 13, color: P.text, marginBottom: 6 },
  hint: { fontFamily: F.body, fontSize: 12, color: P.muted, marginTop: 4 },
  err: { fontFamily: F.med, fontSize: 12, color: P.danger, marginTop: 4 },
  section: { fontFamily: F.serifBold, fontSize: 18, color: P.text, marginHorizontal: 20, marginTop: 22, marginBottom: 10 },
});
