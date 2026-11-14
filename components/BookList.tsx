import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { Cover } from '@/components/ui';
import type { Book } from '@/data/catalog';

export function BookRow({ book, sub, testID }: { book: Book; sub?: string; testID: string }) {
  const c = useColors();
  return (
    <Pressable testID={testID} accessibilityLabel={book.title} onPress={() => router.push({ pathname: '/book/[id]', params: { id: book.id } })}
      style={({ pressed }) => [s.row, { backgroundColor: c.paper, borderColor: c.border, opacity: pressed ? 0.85 : 1 }]}>
      <Cover book={book} w={52} h={74} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[s.t, { color: c.brown }]}>{book.title}</Text>
        <Text style={[s.m, { color: c.mutedForeground }]}>{book.author} · @{book.alias}</Text>
        <Text style={[s.m, { color: c.gold }]}>{sub ?? book.genre}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={c.mutedForeground} />
    </Pressable>
  );
}
const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, borderWidth: 1, marginHorizontal: 18, marginBottom: 10 },
  t: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 16 },
  m: { fontFamily: 'Inter_400Regular', fontSize: 12 },
});
