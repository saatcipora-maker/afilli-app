import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { F, tap } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { P, k } from './kit';
import { go } from './hooks';

type Row = { icon: keyof typeof Feather.glyphMap; label: string; value?: number; path: string; testID: string };

/** Private, on-device shelf: these counts are never shown to other readers. */
export function LocalShelf({ signedIn }: { signedIn: boolean }) {
  const { library, saved, drafts, store, legacyAvailable, storageError, retryLoad } = useApp();
  const rows: Row[] = [
    { icon: 'book-open', label: 'Kitaplık', value: Object.keys(library).length, path: '/library', testID: 'profile-local-library' },
    { icon: 'bookmark', label: 'Kayıtlı', value: saved.length, path: '/library', testID: 'profile-local-saved' },
    { icon: 'edit-3', label: 'Taslaklar', value: drafts.length, path: '/write', testID: 'profile-local-drafts' },
    { icon: 'shopping-bag', label: 'Mağazam', value: store.length, path: '/store', testID: 'profile-store' },
    ...(signedIn ? [{ icon: 'message-circle' as const, label: 'Mesajlar', path: '/messages', testID: 'profile-local-messages' }] : []),
    { icon: 'users', label: 'Okurları keşfet', path: '/people', testID: 'profile-local-people' },
  ];
  return (
    <View>
      <Text style={k.section}>Bu cihazda</Text>
      {storageError ? (
        <Pressable testID="profile-storage-retry" onPress={() => { tap(); retryLoad(); }} style={[st.alert]}>
          <Feather name="alert-triangle" size={16} color={P.danger} />
          <Text style={st.alertText}>{storageError} Tekrar denemek için dokun.</Text>
        </Pressable>
      ) : null}
      {legacyAvailable && signedIn ? (
        <Pressable testID="profile-legacy-banner" onPress={() => { tap(); go('/profile-settings'); }} style={st.alert}>
          <Feather name="archive" size={16} color={P.gold} />
          <Text style={[st.alertText, { color: P.text }]}>Bu cihazda eski Afilli verilerin var. Hesabına aktarmak istersen Ayarlar'dan seçebilirsin.</Text>
        </Pressable>
      ) : null}
      <View style={k.card}>
        {rows.map((r, i) => (
          <Pressable key={r.testID} testID={r.testID} accessibilityRole="link" accessibilityLabel={r.label + (r.value !== undefined ? ', ' + r.value : '')}
            onPress={() => { tap(); go(r.path); }}
            style={({ pressed }) => [st.row, i > 0 && st.divider, { backgroundColor: pressed ? P.input : 'transparent' }]}>
            <Feather name={r.icon} size={18} color={P.gold} />
            <Text style={st.label}>{r.label}</Text>
            {r.value !== undefined ? <Text style={st.value}>{r.value}</Text> : null}
            <Feather name="chevron-right" size={18} color={P.muted} />
          </Pressable>
        ))}
      </View>
      <Text style={st.foot}>Kitaplık, kayıtlı kitaplar ve taslak sayıların yalnızca sana görünür.</Text>
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 54, paddingHorizontal: 16 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: P.border },
  label: { flex: 1, fontFamily: F.semi, fontSize: 15, color: P.text },
  value: { fontFamily: F.serifBold, fontSize: 16, color: P.text },
  foot: { fontFamily: F.body, fontSize: 12, color: P.muted, textAlign: 'center', marginTop: 12, marginHorizontal: 30 },
  alert: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 18, marginBottom: 10, padding: 12, minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: P.border, backgroundColor: P.card },
  alertText: { flex: 1, fontFamily: F.med, fontSize: 13, lineHeight: 19, color: P.danger },
});
