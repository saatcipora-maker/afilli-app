import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { F, tap } from '@/components/ui';
import { MagazineHeader, m } from '@/components/MagazineUI';

export default function Subscription() {
  return (
    <View style={st.screen}>
      <MagazineHeader title="Abonelik" backTo="/dergi" backLabel="Dergiye dön" />
      <ScrollView contentContainerStyle={st.content}>
        <View style={st.card}>
          <MaterialCommunityIcons name="crown" size={56} color={m.gold} style={{ alignSelf: 'center' }} />
          <Text style={st.title}>Dergi Yazarı Aboneliği</Text>
          <View style={st.pill}><Text style={st.pillText}>Aylık Abonelik Ücretli</Text></View>
          <Text style={st.body}>
            Ödeme sistemi henüz bağlı değil. Bu nedenle şu an hiçbir ücret alınamaz ve abonelik başlatılamaz. Fiyat bilgisi, ödeme altyapısı bağlandığında burada gösterilecek.
          </Text>
          <Text style={st.body}>
            Abonelik olmadan dergi yazısı yayınlanamaz. Dergi yazılarını okumaya, beğenmeye ve yorum yapmaya devam edebilirsiniz.
          </Text>
          <Pressable disabled testID="subscription-purchase-disabled" accessibilityRole="button" accessibilityLabel="Abone Ol, ödeme bağlı olmadığı için kullanılamıyor" accessibilityState={{ disabled: true }} aria-disabled style={st.disabledBtn}>
            <Text style={st.disabledText}>Abone Ol (kullanılamıyor)</Text>
          </Pressable>
          <Pressable
            testID="subscription-back" accessibilityRole="button" accessibilityLabel="Dergiye dön"
            onPress={() => { tap(); router.navigate('/dergi'); }}
            style={({ pressed }) => [st.backBtn, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={st.backText}>Dergiye dön</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: m.background },
  content: { padding: 16 },
  card: { backgroundColor: m.card, borderRadius: 18, borderWidth: 1, borderColor: m.border, padding: 22, gap: 14 },
  title: { fontSize: 22, fontFamily: F.semi, fontWeight: '700', color: m.text, textAlign: 'center' },
  pill: { alignSelf: 'center', backgroundColor: m.input, borderWidth: 1, borderColor: m.border, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { fontSize: 12, fontFamily: F.med, color: m.text },
  body: { fontSize: 15, lineHeight: 22, fontFamily: F.body, color: m.text },
  disabledBtn: { height: 48, borderRadius: 8, backgroundColor: m.gold, opacity: 0.45, alignItems: 'center', justifyContent: 'center' },
  disabledText: { fontSize: 16, fontFamily: F.semi, color: m.text },
  backBtn: { height: 48, borderRadius: 8, borderWidth: 1, borderColor: m.border, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 16, fontFamily: F.semi, color: m.text },
});
