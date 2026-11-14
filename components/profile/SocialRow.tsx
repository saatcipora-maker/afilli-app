import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { FontAwesome6, MaterialCommunityIcons } from '@expo/vector-icons';
import { useGetSocialSettings, getGetSocialSettingsQueryKey } from '@workspace/api-client-react';
import { F, tap } from '@/components/ui';
import { Sheet } from '@/components/bulletins/common';
import { openExternalUrl, openInstagram } from '@/lib/social-links';
import { FoilButton, Notice, P, S, Skeleton } from './kit';
import { go, useOffline } from './hooks';

/** The single source of the official handle: backend social settings. */
export function useSocialSettings() {
  return useGetSocialSettings({ query: { queryKey: getGetSocialSettingsQueryKey(), staleTime: 5 * 60_000, retry: 1 } });
}

export function InstagramGlyph({ size = 40 }: { size?: number }) {
  return (
    <LinearGradient colors={[S.igYellow, S.igOrange, S.igPink, S.igPurple, S.igBlue]} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }}
      style={{ width: size, height: size, borderRadius: size * 0.28, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: S.onBrand }}>
      <MaterialCommunityIcons name="instagram" size={size * 0.68} color={S.onBrand} />
    </LinearGradient>
  );
}

export function SocialRow({ personalInstagram, isAdmin }: { personalInstagram?: string | null; isAdmin?: boolean }) {
  const settings = useSocialSettings();
  const offline = useOffline();
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<null | 'facebook' | 'x'>(null);
  const data = settings.data;

  if (!data && settings.isLoading) return <Skeleton w="90%" h={62} r={20} style={{ alignSelf: 'center', marginVertical: 8 }} />;
  if (!data) {
    return (
      <Notice testID="social-settings-error" tone="error" text="Afilli'nin Instagram adresi yüklenemedi. İnternet bağlantısı yok, tekrar dene."
        action={{ label: 'Tekrar dene', onPress: () => settings.refetch() }} />
    );
  }
  const handle = data.instagramHandle;
  const ig = () => { tap(); setError(null); openInstagram(handle, offline, setError); };
  const ext = (kind: 'facebook' | 'x') => {
    tap(); setError(null);
    const url = kind === 'facebook' ? data.facebookUrl : data.xUrl;
    if (!url) return setMissing(kind);
    openExternalUrl(url, offline, setError);
  };

  return (
    <View style={{ marginHorizontal: 18, marginTop: 14, gap: 10 }}>
      <View style={st.row}>
        <Pressable testID="instagram-official" accessibilityRole="link" accessibilityLabel={`@${handle} - Bizi Instagram'da Takip Et`} onPress={ig}
          style={({ pressed }) => [{ flex: 1, transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
          <LinearGradient colors={[S.igOrange, S.igPink, S.igPurple]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.cta}>
            <InstagramGlyph size={40} />
            <Text style={st.ctaText} numberOfLines={2}>@{handle} - Bizi Instagram'da Takip Et</Text>
          </LinearGradient>
        </Pressable>
        <View style={{ gap: 8 }}>
          <Pressable testID="social-facebook" accessibilityRole="link" accessibilityLabel={data.facebookUrl ? "Afilli Facebook sayfası" : "Facebook sayfası henüz eklenmedi"} onPress={() => ext('facebook')}
            style={[st.circle, !data.facebookUrl && st.unset]}>
            <FontAwesome6 name="facebook-f" size={15} color={P.text} />
          </Pressable>
          <Pressable testID="social-x" accessibilityRole="link" accessibilityLabel={data.xUrl ? 'Afilli X hesabı' : 'X hesabı henüz eklenmedi'} onPress={() => ext('x')}
            style={[st.circle, !data.xUrl && st.unset]}>
            <FontAwesome6 name="x-twitter" size={14} color={P.text} />
          </Pressable>
        </View>
      </View>
      {personalInstagram ? (
        <Pressable testID="instagram-personal" accessibilityRole="link" accessibilityLabel={`Kişisel Instagram: @${personalInstagram}`}
          onPress={() => { tap(); setError(null); openInstagram(personalInstagram, offline, setError); }} style={st.personal}>
          <InstagramGlyph size={24} />
          <Text style={st.personalText} numberOfLines={1}>@{personalInstagram}</Text>
        </Pressable>
      ) : null}
      {error ? <Notice testID="social-open-error" tone="error" text={error} action={{ label: 'Tekrar dene', onPress: ig }} /> : null}
      <Sheet visible={!!missing} onClose={() => setMissing(null)} title={missing === 'facebook' ? 'Facebook' : 'X'} testID="social-missing-sheet">
        <View style={{ padding: 18, gap: 12 }}>
          <Text style={st.sheetText}>
            Afilli'nin {missing === 'facebook' ? 'Facebook sayfası' : 'X hesabı'} henüz eklenmedi. Uydurma bir adres açmak yerine burayı boş bırakıyoruz; şimdilik bizi Instagram'da @{handle} adresinden takip edebilirsin.
          </Text>
          <FoilButton label="Instagram'ı aç" icon="instagram" testID="social-missing-instagram" onPress={() => { setMissing(null); ig(); }} style={{ flex: 0 }} />
          {isAdmin ? <FoilButton variant="outline" label="Yönetici ayarlarında ekle" icon="settings" testID="social-missing-admin" onPress={() => { setMissing(null); go('/social-admin'); }} style={{ flex: 0 }} /> : null}
        </View>
      </Sheet>
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cta: { minHeight: 64, borderRadius: 20, borderWidth: 1, borderColor: S.foilMid, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10, shadowColor: S.igPurple, shadowOpacity: 0.22, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  ctaText: { flex: 1, color: S.onBrand, fontFamily: F.semi, fontWeight: '700', fontSize: 14, lineHeight: 19 },
  circle: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: P.gold, backgroundColor: P.card, alignItems: 'center', justifyContent: 'center' },
  unset: { borderStyle: 'dashed', opacity: 0.7 },
  personal: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, borderColor: P.gold, backgroundColor: P.card },
  personalText: { fontFamily: F.med, fontSize: 13, color: P.text, maxWidth: 220 },
  sheetText: { fontFamily: F.body, fontSize: 14, lineHeight: 21, color: P.text },
});
