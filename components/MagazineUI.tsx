import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { Platform, Pressable, ScrollView, Share, StyleSheet, Text, View, type ScrollViewProps, type ScrollViewInstance } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView, type KeyboardAwareScrollViewRef } from 'react-native-keyboard-controller';
import colors from '@/constants/colors';
import { F, tap } from '@/components/ui';
import { formatMagazineCount, type MagazinePost } from '@/data/magazine';

export const m = colors.magazine;

/** Scroll container that forwards a real ScrollView-compatible ref on both platforms. */
export type MagazineScrollHandle = { scrollTo: (options: { x?: number; y?: number; animated?: boolean }) => void };
export const MagazineScrollView = forwardRef<MagazineScrollHandle, ScrollViewProps>(function MagazineScrollView(props, ref) {
  const webRef = useRef<ScrollViewInstance>(null);
  const nativeRef = useRef<KeyboardAwareScrollViewRef>(null);
  useImperativeHandle(ref, () => ({
    scrollTo: (options) => {
      if (Platform.OS === 'web') webRef.current?.scrollTo(options);
      else nativeRef.current?.scrollTo(options);
    },
  }), []);
  if (Platform.OS === 'web') return <ScrollView ref={webRef} keyboardShouldPersistTaps="handled" {...props} />;
  return <KeyboardAwareScrollView ref={nativeRef} keyboardShouldPersistTaps="handled" bottomOffset={24} {...props} />;
});

export function MagazineHeader({ title, backTo, backLabel }: { title: string; backTo: Href; backLabel: string }) {
  const insets = useSafeAreaInsets();
  const top = Platform.OS === 'web' ? 67 : insets.top;
  return (
    <View style={[s.header, { paddingTop: top + 6 }]}>
      <Pressable
        testID="magazine-back" accessibilityRole="button" accessibilityLabel={backLabel} hitSlop={12}
        onPress={() => { tap(); router.navigate(backTo); }}
        style={({ pressed }) => [s.back, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Feather name="arrow-left" size={28} color={m.text} />
      </Pressable>
      <Text style={s.headerTitle} numberOfLines={1} accessibilityRole="header">{title}</Text>
      <View style={s.back} />
    </View>
  );
}

/** Compact count normally; full count once the user's own action changed it, so +1 is visible. */
export function displayCount(n: number, full: boolean) {
  return full ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.') : formatMagazineCount(n);
}

export type ShareOutcome = { kind: 'success' | 'cancel' | 'error'; message: string };

export async function sharePost(post: MagazinePost): Promise<ShareOutcome> {
  const message = post.title + '\n\n' + post.body + '\n\n- ' + post.author + ' (Afilli Dergi)';
  try {
    if (Platform.OS !== 'web') {
      const r = await Share.share({ title: post.title, message });
      return r.action === Share.dismissedAction
        ? { kind: 'cancel', message: 'Paylaşım iptal edildi.' }
        : { kind: 'success', message: 'Paylaşım menüsü tamamlandı.' };
    }
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (nav && typeof nav.share === 'function') {
      try {
        await nav.share({ title: post.title, text: message });
        return { kind: 'success', message: 'Paylaşıldı.' };
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return { kind: 'cancel', message: 'Paylaşım iptal edildi.' };
      }
    }
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(message);
      return { kind: 'success', message: 'Paylaşım desteklenmiyor; yazı panoya kopyalandı.' };
    }
    return { kind: 'error', message: 'Bu tarayıcı paylaşımı ve panoya kopyalamayı desteklemiyor.' };
  } catch {
    return { kind: 'error', message: 'Paylaşım yapılamadı. Tekrar deneyin.' };
  }
}

type Stats = { likes: number; comments: number; reads: number; liked: boolean };

export function MagazineActions({ post, stats, ownReads, onLike, onComments, onShare, prefix }: {
  post: MagazinePost; stats: Stats; ownReads: boolean; prefix: string;
  onLike: () => void; onComments: () => void; onShare: () => void;
}) {
  const items = [
    {
      key: 'like', icon: stats.liked ? 'heart' as const : 'heart-outline' as const, label: displayCount(stats.likes, stats.liked),
      a11y: (stats.liked ? 'Beğeniyi geri al, ' : 'Beğen, ') + stats.likes + ' beğeni' + (post.likesEnabled ? '' : ', beğeniler kapalı'),
      onPress: onLike, disabled: !post.likesEnabled, active: stats.liked,
    },
    {
      key: 'comments', icon: 'comment-outline' as const, label: displayCount(stats.comments, false),
      a11y: 'Yorumlar, ' + stats.comments + (post.commentsEnabled ? '' : ', yorumlar kapalı'),
      onPress: onComments, disabled: false, active: false,
    },
    { key: 'reads', icon: 'eye-outline' as const, label: displayCount(stats.reads, ownReads), a11y: stats.reads + ' okunma', onPress: undefined, disabled: false, active: false },
    { key: 'share', icon: 'share-variant-outline' as const, label: 'Paylaş', a11y: 'Paylaş', onPress: onShare, disabled: false, active: false },
  ];
  return (
    <View style={s.actions}>
      {items.map((it) => it.onPress ? (
        <Pressable
          key={it.key} testID={prefix + '-' + it.key} accessibilityRole="button" accessibilityLabel={it.a11y}
          accessibilityState={{ disabled: it.disabled, selected: it.active }} aria-disabled={it.disabled} aria-selected={it.active} disabled={it.disabled} hitSlop={6}
          onPress={() => { tap(); it.onPress?.(); }}
          style={({ pressed }) => [s.action, { opacity: it.disabled ? 0.4 : pressed ? 0.6 : 1 }]}
        >
          <MaterialCommunityIcons name={it.icon} size={19} color={it.active ? m.danger : m.text} />
          <Text style={s.actionText}>{it.label}</Text>
        </Pressable>
      ) : (
        <View key={it.key} testID={prefix + '-' + it.key} accessible accessibilityLabel={it.a11y} style={s.action}>
          <MaterialCommunityIcons name={it.icon} size={19} color={m.text} />
          <Text style={s.actionText}>{it.label}</Text>
        </View>
      ))}
    </View>
  );
}

export function Notice({ text, tone = 'info', testID }: { text: string; tone?: 'info' | 'error'; testID?: string }) {
  return (
    <View testID={testID} accessibilityLiveRegion="polite" style={[s.notice, { borderColor: tone === 'error' ? m.danger : m.border }]}>
      <Feather name={tone === 'error' ? 'alert-circle' : 'info'} size={15} color={tone === 'error' ? m.danger : m.muted} />
      <Text style={[s.noticeText, { color: tone === 'error' ? m.danger : m.text }]}>{text}</Text>
    </View>
  );
}

export function MagazineSkeleton() {
  return (
    <View style={{ padding: 18, gap: 14 }} accessibilityLabel="Dergi yükleniyor">
      {[120, 220, 160].map((h, i) => <View key={i} style={[s.skel, { height: h }]} />)}
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingBottom: 10, backgroundColor: m.background },
  back: { width: 44, height: 44, justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 26, fontFamily: 'Inter_700Bold', color: m.text },
  actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 36, paddingHorizontal: 4 },
  actionText: { fontSize: 13, fontFamily: F.semi, color: m.text },
  notice: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', borderWidth: 1, borderRadius: 10, padding: 10, backgroundColor: m.card },
  noticeText: { flex: 1, fontSize: 13, lineHeight: 18, fontFamily: F.body },
  skel: { borderRadius: 16, backgroundColor: m.input, opacity: 0.7 },
});
