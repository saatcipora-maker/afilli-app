import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useGetMyProfile, getGetMyProfileQueryKey } from '@workspace/api-client-react';
import { useCommunity } from '@/context/CommunityContext';
import { useApp } from '@/context/AppContext';
import { F, tap } from '@/components/ui';
import { Sheet } from '@/components/bulletins/common';
import { FoilButton, MarbleBackground, Notice, P, TopBar, k } from '@/components/profile/kit';
import { SocialRow } from '@/components/profile/SocialRow';
import { go, scoped, useOwnerGuard, withIdentity } from '@/components/profile/hooks';

function Row({ icon, label, sub, onPress, testID, danger }: { icon: keyof typeof Feather.glyphMap; label: string; sub?: string; onPress: () => void; testID: string; danger?: boolean }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={() => { tap(); onPress(); }}
      style={({ pressed }) => [st.row, { backgroundColor: pressed ? P.input : 'transparent' }]}>
      <Feather name={icon} size={18} color={danger ? P.danger : P.gold} />
      <View style={{ flex: 1 }}>
        <Text style={[st.label, danger && { color: P.danger }]}>{label}</Text>
        {sub ? <Text style={st.sub}>{sub}</Text> : null}
      </View>
      <Feather name="chevron-right" size={18} color={P.muted} />
    </Pressable>
  );
}

function ProfileSettings() {
  const { ready, userId, person, signOut } = useCommunity();
  const { legacyAvailable, importLocalData, storageError, retryLoad } = useApp();
  const me = useGetMyProfile({ query: { enabled: ready && !!userId, queryKey: scoped(getGetMyProfileQueryKey(), userId) } });
  const alive = useOwnerGuard(userId);
  const mine = ready && me.data && me.data.id === userId ? me.data : undefined;
  const isAdmin = !!mine?.isAdmin;
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [imported, setImported] = useState<{ name: string; bio: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const doImport = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await importLocalData();
      if (!alive()) return;
      setImported(r);
      setConfirm(false);
    } catch { if (alive()) setErr('Eski veriler aktarılamadı. Cihazdaki veriler silinmedi; tekrar dene.'); }
    finally { if (alive()) setBusy(false); }
  };
  const leave = async (thenSignIn: boolean) => {
    setSigningOut(true); setErr(null);
    try { await signOut(thenSignIn ? '/sign-in' : '/profile'); if (thenSignIn) router.replace('/sign-in'); else router.replace('/profile'); }
    catch { setErr('Çıkış yapılamadı. İnternet bağlantısı yok, tekrar dene.'); }
    finally { setSigningOut(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: P.background }}>
      <MarbleBackground />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <TopBar back title="Ayarlar" />
        {err ? <Notice tone="error" text={err} testID="settings-error" /> : null}

        <Text style={k.section}>Hesap</Text>
        <View style={k.card}>
          {userId ? (<>
            <View style={st.row}>
              <Feather name="user" size={18} color={P.gold} />
              <View style={{ flex: 1 }}>
                <Text style={st.label}>{mine?.nickname ?? (ready ? person?.nickname : undefined) ?? 'Hesabın'}</Text>
                <Text style={st.sub}>{mine ? '@' + mine.handle : 'Oturum açık'}</Text>
              </View>
            </View>
            <Row icon="edit-2" label="Profili Düzenle" testID="settings-edit-profile" onPress={() => go('/profile-edit')} />
            <Row icon="repeat" label="Hesap değiştir" sub="Çıkış yapıp başka bir hesapla gir" testID="settings-switch-account" onPress={() => leave(true)} />
            <Row icon="log-out" label={signingOut ? 'Çıkış yapılıyor...' : 'Çıkış yap'} testID="settings-sign-out" danger onPress={() => leave(false)} />
          </>) : (<>
            <Row icon="log-in" label="Giriş yap" sub="Profilin ve mesajların hesabınla eşitlenir" testID="settings-sign-in" onPress={() => go('/sign-in')} />
            <Row icon="user-plus" label="Hesap oluştur" testID="settings-sign-up" onPress={() => go('/sign-up')} />
          </>)}
        </View>

        <Text style={k.section}>Bu cihazdaki veriler</Text>
        <View style={[k.card, { padding: 16, gap: 10 }]}>
          {storageError ? (<>
            <Text style={[st.sub, { color: P.danger }]}>{storageError}</Text>
            <FoilButton variant="outline" label="Yeniden yükle" icon="refresh-cw" testID="settings-storage-retry" onPress={retryLoad} style={{ flex: 0 }} />
          </>) : null}
          {imported ? (<>
            <Text style={st.label}>Eski verilerin bu hesaba aktarıldı.</Text>
            {imported.name || imported.bio ? (<>
              <Text style={st.sub}>Eski adın "{imported.name}"{imported.bio ? ' ve tanıtımın' : ''} profiline otomatik yazılmadı. İstersen düzenleyicide gözden geçirip kaydedebilirsin.</Text>
              <FoilButton label="Profil düzenleyicide kullan" icon="edit-2" testID="settings-import-prefill"
                onPress={() => router.push({ pathname: '/profile-edit', params: { prefillName: imported.name, prefillBio: imported.bio } } as never)} style={{ flex: 0 }} />
            </>) : null}
          </>) : legacyAvailable && userId ? (<>
            <Text style={st.label}>Bu cihazda hesapsız kullanılan eski Afilli verileri var.</Text>
            <Text style={st.sub}>Kitaplık ilerlemen, kayıtların ve taslakların yalnızca sen onaylarsan bu hesaba aktarılır.</Text>
            <FoilButton label="Eski verileri bu hesaba aktar" icon="download" testID="settings-import" onPress={() => setConfirm(true)} style={{ flex: 0 }} />
          </>) : legacyAvailable ? (
            <Text style={st.sub}>Bu cihazda eski veriler var. Aktarmak için önce giriş yap.</Text>
          ) : (
            <Text style={st.sub}>Kitaplık, kayıtlar ve taslaklar bu cihazda hesabına göre ayrı saklanır. Aktarılacak eski veri yok.</Text>
          )}
        </View>

        {isAdmin ? (<>
          <Text style={k.section}>Yönetim</Text>
          <View style={k.card}>
            <Row icon="sliders" label="Sosyal bağlantı ayarları" sub="Instagram, Facebook, X ve çok okunan kuralı" testID="settings-admin" onPress={() => go('/social-admin')} />
          </View>
        </>) : null}

        <Text style={k.section}>Afilli topluluğu</Text>
        <SocialRow isAdmin={isAdmin} />
      </ScrollView>
      <Sheet visible={confirm} onClose={() => { if (!busy) setConfirm(false); }} title="Eski verileri aktar" testID="settings-import-sheet">
        <View style={{ padding: 18, gap: 12 }}>
          <Text style={st.sub}>Bu cihazdaki eski kitaplık ilerlemesi, kayıtlar ve taslaklar şu anki hesabına bağlanacak. Adın ve tanıtımın otomatik değiştirilmez.</Text>
          <FoilButton label="Aktar" icon="download" testID="settings-import-confirm" busy={busy} onPress={doImport} style={{ flex: 0 }} />
          <FoilButton variant="outline" label="Vazgeç" testID="settings-import-cancel" disabled={busy} onPress={() => setConfirm(false)} style={{ flex: 0 }} />
        </View>
      </Sheet>
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: P.border },
  label: { fontFamily: F.semi, fontSize: 15, color: P.text },
  sub: { fontFamily: F.body, fontSize: 13, lineHeight: 19, color: P.muted, marginTop: 2 },
});

export default withIdentity(ProfileSettings);
