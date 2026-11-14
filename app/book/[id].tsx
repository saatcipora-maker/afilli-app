import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useApp } from '@/context/AppContext';
import { Cover, Empty, GoldButton, SampleTag, ScreenHeader, tap, webBottom } from '@/components/ui';
import { getBook } from '@/data/catalog';

export default function BookScreen() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isSaved, toggleSave, library } = useApp();
  const b = getBook(id);
  if (!b) return <View style={{ flex: 1, backgroundColor: c.background }}><ScreenHeader title="Kitap" /><Empty icon="book" title="Kitap bulunamadı" text="Bu kitap kaldırılmış olabilir." /></View>;
  const saved = isSaved(b.id);
  const cont = library[b.id];
  const read = (ci: number) => router.push({ pathname: '/read/[id]', params: { id: b.id, c: String(ci) } });
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScreenHeader title="" right={
        <Pressable testID="book-save" accessibilityLabel={saved ? 'Kayıttan çıkar' : 'Kaydet'} hitSlop={8} onPress={() => { tap(); toggleSave(b.id); }} style={{ padding: 8 }}>
          <Feather name="bookmark" size={22} color={saved ? c.gold : c.brown} />
          {saved && <View style={[s.dot, { backgroundColor: c.gold }]} />}
        </Pressable>} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 + webBottom }}>
        <View style={[s.hero, { backgroundColor: c.secondary }]}>
          <Cover book={b} w={140} h={200} />
          <Text style={[s.t, { color: c.brown }]}>{b.title}</Text>
          <Text style={[s.a, { color: c.mutedForeground }]}>{b.author} · @{b.alias}</Text>
          <View style={s.stats}>
            <Text style={[s.st, { color: c.brown }]}><Feather name="star" color={c.gold} /> {b.rating}</Text>
            <Text style={[s.st, { color: c.brown }]}><Feather name="heart" /> {b.likes}</Text>
            <Text style={[s.st, { color: c.brown }]}><Feather name="eye" /> {b.reads}</Text>
            <Text style={[s.st, { color: c.gold }]}>{b.genre}</Text>
          </View>
        </View>
        <View style={{ padding: 20, gap: 14 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <GoldButton label={cont !== undefined ? 'Devam et' : 'Okumaya başla'} icon="book-open" testID="book-read" onPress={() => read(cont ?? b.chapters.length - 1)} style={{ flex: 1 }} />
            <GoldButton label={saved ? 'Kayıtlı' : 'Kaydet'} icon="bookmark" ghost testID="book-save-btn" onPress={() => toggleSave(b.id)} />
          </View>
          <Text style={[s.blurb, { color: c.brown }]}>{b.blurb}</Text>
          <Text style={[s.h, { color: c.brown }]}>Bölümler</Text>
          {[...b.chapters].map((ch, i) => (
            <Pressable key={i} testID={'book-chapter-' + i} onPress={() => read(i)} style={({ pressed }) => [s.ch, { borderColor: c.border, backgroundColor: pressed ? c.secondary : c.paper }]}>
              <View style={{ flex: 1 }}><Text style={[s.ct, { color: c.brown }]}>{ch.title}</Text><Text style={[s.a, { color: c.mutedForeground }]}>{ch.ago}</Text></View>
              <Feather name="chevron-right" size={18} color={c.mutedForeground} />
            </Pressable>
          ))}
          <SampleTag />
        </View>
      </ScrollView>
    </View>
  );
}
const s = StyleSheet.create({
  dot: { position: 'absolute', top: 6, right: 6, width: 6, height: 6, borderRadius: 3 },
  hero: { alignItems: 'center', paddingVertical: 26, gap: 6 },
  t: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 26, marginTop: 14, textAlign: 'center', paddingHorizontal: 20 },
  a: { fontFamily: 'Inter_400Regular', fontSize: 13 },
  stats: { flexDirection: 'row', gap: 14, marginTop: 6 },
  st: { fontFamily: 'Inter_500Medium', fontSize: 13 },
  blurb: { fontFamily: 'PlayfairDisplay_400Regular_Italic', fontSize: 17, lineHeight: 27 },
  h: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 19, marginTop: 6 },
  ch: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, padding: 14 },
  ct: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
});
