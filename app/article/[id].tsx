import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { Empty, SampleTag, ScreenHeader, webBottom } from '@/components/ui';
import { ARTICLES } from '@/data/catalog';

export default function ArticleScreen() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const a = ARTICLES.find((x) => x.id === id);
  if (!a) return <View style={{ flex: 1, backgroundColor: c.background }}><ScreenHeader title="Bulunamadı" /><Empty icon="file" title="İçerik bulunamadı" text="Bu yazı kaldırılmış olabilir." /></View>;
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScreenHeader title={a.meta.split(' · ')[0]} />
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 + webBottom, gap: 14 }}>
        <Text style={[s.meta, { color: c.gold }]}>{a.meta}</Text>
        <Text style={[s.t, { color: c.brown }]}>{a.title}</Text>
        <View style={[s.rule, { backgroundColor: c.gold }]} />
        <Text style={[s.lead, { color: c.brown }]}>{a.summary}</Text>
        <Text style={[s.body, { color: c.foreground }]}>{a.body}</Text>
        <SampleTag />
      </ScrollView>
    </View>
  );
}
const s = StyleSheet.create({
  meta: { fontFamily: 'Inter_600SemiBold', fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase' },
  t: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 30, lineHeight: 38 },
  rule: { width: 48, height: 2 },
  lead: { fontFamily: 'PlayfairDisplay_400Regular_Italic', fontSize: 18, lineHeight: 28 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 27 },
});
