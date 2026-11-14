import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader, SampleTag, webBottom } from '@/components/ui';
import { ARTICLES, Article } from '@/data/catalog';

const ICON = { bulten: 'newspaper-variant-outline', dergi: 'book-open-variant', ozel: 'star-four-points-outline' } as const;

export function ArticleList({ kind, title, intro }: { kind: Article['kind']; title: string; intro: string }) {
  const c = useColors();
  const items = ARTICLES.filter((a) => a.kind === kind);
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScreenHeader title={title} />
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 30 + webBottom, gap: 12 }}>
        <Text style={[s.intro, { color: c.mutedForeground }]}>{intro}</Text>
        <SampleTag />
        {items.map((a, i) => (
          <Pressable key={a.id} testID={'article-' + a.id} accessibilityLabel={a.title}
            onPress={() => router.push({ pathname: '/article/[id]', params: { id: a.id } })}
            style={({ pressed }) => [s.card, { backgroundColor: i === 0 && kind === 'dergi' ? c.brown : c.paper, borderColor: c.border, transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
            <View style={[s.ic, { borderColor: c.gold }]}><MaterialCommunityIcons name={ICON[kind]} size={20} color={c.gold} /></View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[s.meta, { color: c.gold }]}>{a.meta}</Text>
              <Text style={[s.t, { color: i === 0 && kind === 'dergi' ? c.paper : c.brown }]}>{a.title}</Text>
              <Text style={[s.sum, { color: i === 0 && kind === 'dergi' ? c.goldSoft : c.mutedForeground }]}>{a.summary}</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
const s = StyleSheet.create({
  intro: { fontFamily: 'PlayfairDisplay_400Regular_Italic', fontSize: 16, lineHeight: 24 },
  card: { flexDirection: 'row', gap: 14, borderWidth: 1, borderRadius: 16, padding: 16 },
  ic: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  meta: { fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase' },
  t: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 18 },
  sum: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
});
