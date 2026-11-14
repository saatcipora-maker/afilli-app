import React, { useRef } from 'react';
import { Image, ImageBackground, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { ScrollViewInstance } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useApp } from '@/context/AppContext';
import { Cover, tap } from '@/components/ui';
import { HOME_SECTIONS, getBook, type Book } from '@/data/catalog';
import colors from '@/constants/colors';
import { useGetPublishedBooks, getGetPublishedBooksQueryKey, type AuthoredBook } from '@workspace/api-client-react';
import { useCommunity } from '@/context/CommunityContext';
import { scoped, actorRequest } from '@/components/profile/hooks';
import { mediaUrl } from '@/components/bulletins/common';

// Home-only tokens sampled from the reference screenshot.
const H = colors.home;

const PILLS = [
  { key: 'store', label: 'Mağazam', icon: 'storefront-outline', href: '/store' },
  { key: 'dergi', label: 'Dergi', icon: 'newspaper-variant-outline', href: '/dergi' },
  { key: 'bulten', label: 'Bültenler', icon: 'text-box-outline', href: '/bultenler' },
  { key: 'ozel', label: 'Özel', icon: 'star-four-points-outline', href: '/ozel' },
] as const;

function HeaderBtn({ icon, label, testID, onPress, badge, circle }: { icon: keyof typeof Feather.glyphMap; label: string; testID: string; onPress: () => void; badge?: number; circle?: boolean }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} hitSlop={6} onPress={() => { tap(); onPress(); }}
      style={({ pressed }) => [st.hbtn, pressed && { opacity: 0.6 }]}>
      {circle ? <View style={st.avatar}><MaterialCommunityIcons name="account" size={20} color={H.ink} /></View> : icon === 'message-circle' ? <MaterialCommunityIcons name="message-processing-outline" size={22} color={H.ink} /> : <Feather name={icon} size={21} color={H.ink} />}
      {!!badge && badge > 0 && <View style={st.badge}><Text style={st.badgeText}>{badge > 9 ? '9+' : badge}</Text></View>}
    </Pressable>
  );
}

function BookCard({ b }: { b: Book }) {
  return (
    <Pressable testID={'home-book-' + b.id} accessibilityRole="button" accessibilityLabel={b.title + ', ' + b.author}
      onPress={() => { tap(); router.push({ pathname: '/book/[id]', params: { id: b.id } }); }}
      style={({ pressed }) => [st.card, { transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
      <View style={st.coverWrap}><Cover book={b} w={58} h={70} /></View>
      <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.85} style={st.title}>{b.title}</Text>
      <Text numberOfLines={1} style={st.author}>{b.author}</Text>
      <View style={st.stats}>
        <View style={st.stat}><MaterialCommunityIcons name="eye" size={13} color={H.ink} /><Text style={st.statT}>{b.reads}</Text></View>
        <View style={st.stat}><MaterialCommunityIcons name="heart" size={13} color={H.heart} /><Text style={st.statT}>{b.likes}</Text></View>
        <View style={st.stat}><MaterialCommunityIcons name="message-processing-outline" size={13} color={H.ink} /><Text style={st.statT}>{b.comments}</Text></View>
      </View>
    </Pressable>
  );
}

function PublishedCard({ p }: { p: AuthoredBook }) {
  const uri = p.coverUrl ? mediaUrl(p.coverUrl) : null;
  return (
    <Pressable testID={'home-authored-' + p.id} accessibilityRole="button" accessibilityLabel={p.title + ', ' + p.author.nickname}
      onPress={() => { tap(); router.push({ pathname: '/authored-book/[id]', params: { id: p.id } }); }}
      style={({ pressed }) => [st.card, { transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
      <View style={st.coverWrap}>{uri ? <Image source={{ uri }} style={{ width: 58, height: 70, borderRadius: 4, backgroundColor: H.border }} resizeMode="cover" /> : <View style={{ width: 58, height: 70, borderRadius: 4, backgroundColor: H.ink }} />}</View>
      <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.85} style={st.title}>{p.title}</Text>
      <Text numberOfLines={1} style={st.author}>{p.author.nickname}</Text>
      <View style={st.stats}>
        <View style={st.stat}><MaterialCommunityIcons name="eye" size={13} color={H.ink} /><Text style={st.statT}>{p.readCount ?? 0}</Text></View>
        <View style={st.stat}><MaterialCommunityIcons name="heart" size={13} color={H.heart} /><Text style={st.statT}>{p.likeCount ?? 0}</Text></View>
        <View style={st.stat}><MaterialCommunityIcons name="message-processing-outline" size={13} color={H.ink} /><Text style={st.statT}>{p.commentCount ?? 0}</Text></View>
      </View>
    </Pressable>
  );
}

export default function Home() {
  const ins = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { unread } = useApp();
  const ref = useRef<ScrollViewInstance>(null);
  const top = Platform.OS === 'web' ? 67 : ins.top;
  const { ready, userId } = useCommunity();
  const pubQ = useGetPublishedBooks({ query: { enabled: ready, queryKey: scoped(getGetPublishedBooksQueryKey(), userId) }, request: actorRequest(userId) });
  const pub = pubQ.data ?? [];
  const extra: Record<string, AuthoredBook[]> = {
    oneriler: [...pub].sort((a, b) => (b.likeCount ?? 0) - (a.likeCount ?? 0)).slice(0, 2),
    yeni: [...pub].sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '')).slice(0, 2),
  };

  return (
    <ImageBackground source={require('@/assets/images/reference/paper.webp')} resizeMode="cover" imageStyle={{ opacity: 0.35 }} style={{ flex: 1, backgroundColor: H.bg }}>
      <View style={[st.header, { paddingTop: top }]}>
        <Pressable testID="logo" accessibilityRole="button" accessibilityLabel="Afilli, en üste dön" onPress={() => ref.current?.scrollTo({ y: 0, animated: true })} style={({ pressed }) => pressed && { opacity: 0.7 }}>
          <Image source={require('@/assets/images/reference/afilli-logo.png')} style={st.logo} resizeMode="contain" />
        </Pressable>
        <View style={st.actions}>
          <HeaderBtn icon="search" label="Keşfet ve ara" testID="open-search" onPress={() => router.push('/search')} />
          <HeaderBtn icon="message-circle" label={unread ? 'Mesajlar, ' + unread + ' okunmamış' : 'Mesajlar'} testID="open-messages" badge={unread} onPress={() => router.push('/messages')} />
          <HeaderBtn icon="user" circle label="Profil" testID="open-profile" onPress={() => router.navigate('/profile')} />
        </View>
      </View>
      <View style={[st.pills, width < 360 && { paddingHorizontal: 12, gap: 5 }]}>
        {PILLS.map((p) => (
          <Pressable key={p.key} testID={'pill-' + p.key} accessibilityRole="button" accessibilityLabel={p.label}
            onPress={() => { tap(); router.push(p.href); }}
            style={({ pressed }) => [st.pill, { transform: [{ scale: pressed ? 0.96 : 1 }] }]}>
            <MaterialCommunityIcons name={p.icon} size={14} color={H.ink} />
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[st.pillText, width < 360 && { fontSize: 10 }]}>{p.label}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView ref={ref} contentContainerStyle={{ paddingBottom: 20 }} showsVerticalScrollIndicator={false}>
        {HOME_SECTIONS.map((sec) => (
          <View key={sec.id} testID={'home-section-' + sec.id}>
            <Text style={[st.sec, 'center' in sec && sec.center && { textAlign: 'center' }]}>{sec.title}</Text>
            <View style={st.grid}>
              {/* Same single 2-card row: real published books take the slots first, curated cards fill the rest. */}
              {sec.ids.slice(0, 2).map((id, i) => {
                const real = extra[sec.id]?.[i];
                if (real) return <PublishedCard key={'p' + real.id} p={real} />;
                const b = getBook(id); return b ? <BookCard key={id} b={b} /> : null;
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </ImageBackground>
  );
}

const shadow = { shadowColor: H.ink, shadowOpacity: 0.14, shadowRadius: 5, shadowOffset: { width: 0, height: 3 }, elevation: 3 };

const st = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 20, paddingRight: 14 },
  logo: { width: 150, height: 54 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hbtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.3, borderColor: H.ink, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  badge: { position: 'absolute', top: 1, right: 0, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, backgroundColor: H.badge, borderWidth: 1.5, borderColor: H.bg, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: H.badgeText, fontSize: 9, fontFamily: 'Inter_700Bold' },
  pills: { flexDirection: 'row', gap: 8, paddingHorizontal: 24, paddingTop: 6, paddingBottom: 4 },
  pill: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, height: 28, borderRadius: 8, borderWidth: 1, borderColor: H.muted, backgroundColor: H.card, paddingHorizontal: 4, ...shadow, shadowOpacity: 0.1 },
  pillText: { flexShrink: 1, fontFamily: 'Inter_700Bold', fontSize: 11, color: H.ink },
  sec: { fontFamily: 'Inter_700Bold', fontSize: 18, lineHeight: 22, color: H.ink, paddingHorizontal: 24, marginTop: 12, marginBottom: 7 },
  grid: { flexDirection: 'row', gap: 12, paddingHorizontal: 24 },
  card: { flex: 1, minWidth: 0, backgroundColor: H.card, borderRadius: 10, borderWidth: 1, borderColor: H.border, paddingTop: 6, paddingBottom: 8, paddingHorizontal: 8, alignItems: 'center', ...shadow },
  coverWrap: { ...shadow, shadowOpacity: 0.22, marginBottom: 6 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 12, lineHeight: 14, color: H.ink, textAlign: 'center' },
  author: { fontFamily: 'Inter_400Regular', fontSize: 10, lineHeight: 12, color: H.muted, marginTop: 2 },
  stats: { flexDirection: 'row', alignSelf: 'stretch', justifyContent: 'space-between', marginTop: 6, paddingHorizontal: 2 },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statT: { fontFamily: 'Inter_500Medium', fontSize: 10.5, lineHeight: 13, color: H.ink },
});
