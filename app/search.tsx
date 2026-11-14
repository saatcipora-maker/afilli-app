import React, { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { BookRow } from '@/components/BookList';
import { Empty, webBottom } from '@/components/ui';
import { BOOKS, trNorm } from '@/data/catalog';

export default function Search() {
  const c = useColors();
  const ins = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const n = trNorm(q);
    if (!n) return BOOKS;
    return BOOKS.filter((b) => [b.title, b.author, b.alias].some((f) => trNorm(f).includes(n)));
  }, [q]);
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View style={[s.bar, { paddingTop: (Platform.OS === 'web' ? 67 : ins.top) + 8 }]}>
        <View style={[s.field, { backgroundColor: c.paper, borderColor: c.gold }]}>
          <Feather name="search" size={18} color={c.gold} />
          <TextInput testID="search-input" autoFocus value={q} onChangeText={setQ} placeholder="Kitap, yazar veya takma ad" placeholderTextColor={c.mutedForeground}
            style={[s.in, { color: c.brown }]} returnKeyType="search" autoCorrect={false} autoCapitalize="none" accessibilityLabel="Ara" />
          {!!q && <Pressable testID="search-clear" accessibilityLabel="Temizle" hitSlop={8} onPress={() => setQ('')}><Feather name="x-circle" size={18} color={c.mutedForeground} /></Pressable>}
        </View>
        <Pressable testID="search-cancel" accessibilityRole="button" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} hitSlop={8}>
          <Text style={[s.cancel, { color: c.brown }]}>Vazgeç</Text>
        </Pressable>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: 8, paddingBottom: 30 + webBottom }}>
        <Text style={[s.h, { color: c.mutedForeground }]}>{q ? results.length + ' sonuç' : 'Keşfet'}</Text>
        {results.length === 0 ? <Empty icon="search" title="Sonuç bulunamadı" text={'"' + q + '" için eşleşen kitap, yazar veya takma ad yok.'} />
          : results.map((b) => <BookRow key={b.id} book={b} testID={'result-' + b.id} />)}
      </ScrollView>
    </View>
  );
}
const s = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 10 },
  field: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, height: 44 },
  in: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 15, height: 44 },
  cancel: { fontFamily: 'Inter_500Medium', fontSize: 15 },
  h: { fontFamily: 'Inter_600SemiBold', fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase', marginHorizontal: 20, marginBottom: 10 },
});
