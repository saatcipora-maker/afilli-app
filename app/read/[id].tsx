import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useApp } from '@/context/AppContext';
import { Empty, SampleTag, ScreenHeader, webBottom } from '@/components/ui';
import { getBook } from '@/data/catalog';

export default function Reader() {
  const c = useColors();
  const { id, c: ci } = useLocalSearchParams<{ id: string; c?: string }>();
  const { openBook, isSaved, toggleSave } = useApp();
  const b = getBook(id);
  const [idx, setIdx] = useState(Number(ci ?? 0) || 0);
  const [size, setSize] = useState(18);
  useEffect(() => { if (b) openBook(b.id, idx); }, [b?.id, idx]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!b) return <View style={{ flex: 1, backgroundColor: c.background }}><ScreenHeader title="Okuma" /><Empty icon="book" title="Bölüm bulunamadı" text="Bu bölüm kaldırılmış olabilir." /></View>;
  const ch = b.chapters[Math.min(idx, b.chapters.length - 1)];
  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <ScreenHeader title={b.title} right={
        <View style={{ flexDirection: 'row' }}>
          <Pressable testID="font-smaller" accessibilityLabel="Yazıyı küçült" onPress={() => setSize((x) => Math.max(14, x - 2))} style={s.tb}><Text style={[s.aa, { color: c.brown, fontSize: 13 }]}>A</Text></Pressable>
          <Pressable testID="font-larger" accessibilityLabel="Yazıyı büyüt" onPress={() => setSize((x) => Math.min(26, x + 2))} style={s.tb}><Text style={[s.aa, { color: c.brown }]}>A</Text></Pressable>
          <Pressable testID="reader-save" accessibilityLabel="Kaydet" onPress={() => toggleSave(b.id)} style={s.tb}><Feather name="bookmark" size={19} color={isSaved(b.id) ? c.gold : c.brown} /></Pressable>
        </View>} />
      <ScrollView contentContainerStyle={{ padding: 26, paddingBottom: 60 + webBottom }}>
        <Text style={[s.ch, { color: c.gold }]}>{ch.title}</Text>
        <Text style={[s.orn, { color: c.gold }]}>~ ✦ ~</Text>
        <Text style={[s.body, { color: c.foreground, fontSize: size, lineHeight: size * 1.65 }]}>{ch.body}</Text>
        <View style={s.nav}>
          <Pressable testID="prev-chapter" disabled={idx >= b.chapters.length - 1} onPress={() => setIdx(idx + 1)} style={{ opacity: idx >= b.chapters.length - 1 ? 0.3 : 1 }}><Text style={[s.nl, { color: c.brown }]}>Önceki bölüm</Text></Pressable>
          <Pressable testID="next-chapter" disabled={idx <= 0} onPress={() => setIdx(idx - 1)} style={{ opacity: idx <= 0 ? 0.3 : 1 }}><Text style={[s.nl, { color: c.brown }]}>Sonraki bölüm</Text></Pressable>
        </View>
        <SampleTag />
      </ScrollView>
    </View>
  );
}
const s = StyleSheet.create({
  tb: { padding: 8 },
  aa: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 19 },
  ch: { fontFamily: 'Inter_600SemiBold', fontSize: 13, letterSpacing: 1.2, textTransform: 'uppercase', textAlign: 'center' },
  orn: { textAlign: 'center', marginVertical: 14, fontSize: 14 },
  body: { fontFamily: 'PlayfairDisplay_400Regular_Italic' },
  nav: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 40, marginBottom: 20 },
  nl: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
});
