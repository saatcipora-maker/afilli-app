import React from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import type { Book } from '@/data/catalog';

export const F = { script: 'GreatVibes_400Regular', serif: 'PlayfairDisplay_600SemiBold', serifBold: 'PlayfairDisplay_700Bold', body: 'Inter_400Regular', med: 'Inter_500Medium', semi: 'Inter_600SemiBold' };

export const tap = () => { if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {}); };

const MOTIF: Record<Book['motif'], keyof typeof MaterialCommunityIcons.glyphMap> = {
  crest: 'shield-crown-outline', snow: 'email-outline', compass: 'compass-rose', manor: 'castle', moon: 'moon-waning-crescent', feather: 'feather',
};

export function Cover({ book, w, h }: { book: Book; w: number; h: number }) {
  const small = w < 70;
  if (book.cover) return <Image source={book.cover} style={{ width: w, height: h, borderRadius: 3 }} resizeMode="cover" />;
  return (
    <LinearGradient colors={book.palette} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={[s.cover, { width: w, height: h }]}>
      <View style={[s.coverFrame, { borderColor: book.ink + '66' }]} />
      <View style={s.spine} />
      <MaterialCommunityIcons name={MOTIF[book.motif]} size={w * 0.38} color={book.ink} />
      {!small && <Text numberOfLines={2} style={[s.coverTitle, { color: book.ink, fontSize: Math.max(10, w * 0.11) }]}>{book.title}</Text>}
    </LinearGradient>
  );
}

export function Logo({ onPress }: { onPress?: () => void }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} testID="logo" accessibilityRole="button" accessibilityLabel="Afilli, en üste dön" style={({ pressed }) => [s.logo, pressed && { opacity: 0.7 }]} hitSlop={6}>
      <Text style={[s.logoText, { color: c.gold }]} numberOfLines={1}>Afilli</Text>
      <View style={s.logoMarks}>
        <MaterialCommunityIcons name="star-four-points" size={9} color={c.gold} style={{ marginLeft: 12 }} />
        <MaterialCommunityIcons name="book-open-page-variant-outline" size={18} color={c.gold} />
      </View>
    </Pressable>
  );
}

export function IconBtn({ icon, onPress, label, testID, badge }: { icon: keyof typeof Feather.glyphMap; onPress: () => void; label: string; testID: string; badge?: number }) {
  const c = useColors();
  return (
    <Pressable onPress={() => { tap(); onPress(); }} testID={testID} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}
      style={({ pressed }) => [s.iconBtn, { backgroundColor: pressed ? c.secondary : 'transparent' }]}>
      <Feather name={icon} size={22} color={c.brown} />
      {!!badge && badge > 0 && (
        <View style={[s.badge, { backgroundColor: c.destructive, borderColor: c.background }]}>
          <Text style={s.badgeText}>{badge > 9 ? '9+' : badge}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function ScreenHeader({ title, back = true, right }: { title: string; back?: boolean; right?: React.ReactNode }) {
  const c = useColors();
  const ins = useSafeAreaInsets();
  const top = Platform.OS === 'web' ? 67 : ins.top;
  return (
    <View style={[s.sh, { paddingTop: top + 6, backgroundColor: c.background, borderBottomColor: c.border }]}>
      {back ? <IconBtn icon="chevron-left" label="Geri" testID="back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} /> : <View style={{ width: 8 }} />}
      <Text numberOfLines={1} style={[s.shTitle, { color: c.brown }]}>{title}</Text>
      <View style={{ minWidth: 40, alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
}

export function SectionTitle({ title, onAll, testID }: { title: string; onAll?: () => void; testID?: string }) {
  const c = useColors();
  return (
    <View style={s.sec}>
      <Text style={[s.secTitle, { color: c.brown }]}>{title}</Text>
      {onAll && <Pressable onPress={onAll} testID={testID} accessibilityRole="button" hitSlop={8}><Text style={[s.all, { color: c.gold }]}>Tümü</Text></Pressable>}
    </View>
  );
}

export function Empty({ icon, title, text, children }: { icon: keyof typeof Feather.glyphMap; title: string; text: string; children?: React.ReactNode }) {
  const c = useColors();
  return (
    <View style={s.empty}>
      <View style={[s.emptyRing, { borderColor: c.goldSoft, backgroundColor: c.paper }]}><Feather name={icon} size={28} color={c.gold} /></View>
      <Text style={[s.emptyTitle, { color: c.brown }]}>{title}</Text>
      <Text style={[s.emptyText, { color: c.mutedForeground }]}>{text}</Text>
      {children}
    </View>
  );
}

export function GoldButton({ label, onPress, testID, icon, ghost, style, disabled }: { label: string; onPress: () => void; testID: string; icon?: keyof typeof Feather.glyphMap; ghost?: boolean; style?: ViewStyle; disabled?: boolean }) {
  const c = useColors();
  return (
    <Pressable disabled={disabled} onPress={() => { tap(); onPress(); }} testID={testID} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [s.btn, { backgroundColor: ghost ? c.paper : c.gold, borderColor: c.gold, opacity: disabled ? 0.45 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }, style]}>
      {icon && <Feather name={icon} size={16} color={c.brown} />}
      <Text style={[s.btnText, { color: c.brown }]}>{label}</Text>
    </Pressable>
  );
}

export function SampleTag() {
  const c = useColors();
  return <Text style={[s.sample, { color: c.mutedForeground, borderColor: c.border }]}>Örnek içerik</Text>;
}

export const webBottom = Platform.OS === 'web' ? 34 : 0;

const s = StyleSheet.create({
  cover: { borderRadius: 6, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: 6, gap: 6, shadowColor: '#3B2416', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  coverFrame: { position: 'absolute', top: 5, left: 7, right: 5, bottom: 5, borderWidth: 1, borderRadius: 3 },
  spine: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: 'rgba(0,0,0,0.18)' },
  coverTitle: { fontFamily: 'PlayfairDisplay_700Bold', textAlign: 'center', paddingHorizontal: 4 },
  logo: { flexDirection: 'row', alignItems: 'flex-start', flexShrink: 1 },
  logoText: { fontFamily: 'GreatVibes_400Regular', fontSize: 46, lineHeight: 58, paddingRight: 2 },
  logoMarks: { marginTop: 8, marginLeft: -2 },
  iconBtn: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 3, right: 1, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  badgeText: { color: '#FFF8EE', fontSize: 10, fontFamily: 'Inter_700Bold' },
  sh: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  shTitle: { flex: 1, textAlign: 'center', fontFamily: 'PlayfairDisplay_700Bold', fontSize: 20 },
  sec: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 20, marginTop: 26, marginBottom: 12 },
  secTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 21 },
  all: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  empty: { alignItems: 'center', paddingHorizontal: 36, paddingVertical: 48, gap: 10 },
  emptyRing: { width: 72, height: 72, borderRadius: 36, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  emptyTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 20, textAlign: 'center' },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderRadius: 999, paddingHorizontal: 20, paddingVertical: 12 },
  btnText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  sample: { alignSelf: 'flex-start', fontFamily: 'Inter_500Medium', fontSize: 11, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
});
