import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';
import { useApp } from '@/context/AppContext';
import { Empty, GoldButton, ScreenHeader, webBottom } from '@/components/ui';

export default function Store() {
  const c = useColors();
  const { store, addStoreItem, removeStoreItem } = useApp();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const add = () => { addStoreItem(title.trim(), note.trim()); setTitle(''); setNote(''); setOpen(false); };
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScreenHeader title="Mağazam" right={<Pressable testID="store-toggle-form" accessibilityLabel="Eser ekle" hitSlop={8} onPress={() => setOpen((o) => !o)} style={{ padding: 8 }}><Feather name={open ? 'x' : 'plus'} size={22} color={c.brown} /></Pressable>} />
      <KeyboardAwareScrollViewCompat contentContainerStyle={{ padding: 18, paddingBottom: 40 + webBottom, gap: 12 }} keyboardShouldPersistTaps="handled">
        <Text style={[s.intro, { color: c.mutedForeground }]}>Kendi eserlerinin vitrini. Burada satış yapılmaz; yalnızca eserlerini sergilemek için düzenlersin.</Text>
        {open && (
          <View style={[s.form, { backgroundColor: c.paper, borderColor: c.gold }]}>
            <TextInput testID="store-title" value={title} onChangeText={setTitle} placeholder="Eser adı" placeholderTextColor={c.mutedForeground} style={[s.in, { borderColor: c.border, color: c.brown }]} />
            <TextInput testID="store-note" value={note} onChangeText={setNote} placeholder="Kısa açıklama" placeholderTextColor={c.mutedForeground} multiline style={[s.in, { borderColor: c.border, color: c.brown, minHeight: 70 }]} />
            <GoldButton label="Vitrine ekle" icon="plus" testID="store-add" disabled={!title.trim()} onPress={add} />
          </View>
        )}
        {store.length === 0 && !open ? (
          <Empty icon="shopping-bag" title="Vitrinin henüz boş" text="İlk eserini ekleyerek mağazanı oluşturmaya başla.">
            <GoldButton label="Eser ekle" icon="plus" testID="store-open-form" onPress={() => setOpen(true)} style={{ marginTop: 8 }} />
          </Empty>
        ) : store.map((it) => (
          <View key={it.id} style={[s.item, { backgroundColor: c.paper, borderColor: c.border }]}>
            <View style={[s.spine, { backgroundColor: c.gold }]} />
            <View style={{ flex: 1 }}>
              <Text style={[s.t, { color: c.brown }]}>{it.title}</Text>
              {!!it.note && <Text style={[s.n, { color: c.mutedForeground }]}>{it.note}</Text>}
            </View>
            <Pressable testID={'store-remove-' + it.id} accessibilityLabel="Kaldır" hitSlop={10} onPress={() => removeStoreItem(it.id)}><Feather name="trash-2" size={18} color={c.destructive} /></Pressable>
          </View>
        ))}
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}
const s = StyleSheet.create({
  intro: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21 },
  form: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
  in: { borderWidth: 1, borderRadius: 10, padding: 12, fontFamily: 'Inter_400Regular', fontSize: 15 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderRadius: 14, padding: 14 },
  spine: { width: 6, alignSelf: 'stretch', borderRadius: 3 },
  t: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 17 },
  n: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 2 },
});
