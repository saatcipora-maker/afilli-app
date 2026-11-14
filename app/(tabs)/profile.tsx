import React, { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useGetMyProfile, getGetMyProfileQueryKey } from '@workspace/api-client-react';
import { useCommunity } from '@/context/CommunityContext';
import { F } from '@/components/ui';
import { FoilButton, MarbleBackground, Notice, P, ProfileSkeleton, RoundIcon, StateCard, TopBar } from '@/components/profile/kit';
import { ProfileHeader } from '@/components/profile/ProfileHeader';
import { ProfileTabs, type ContentTab } from '@/components/profile/ProfileTabs';
import { LocalShelf } from '@/components/profile/LocalShelf';
import { SocialRow } from '@/components/profile/SocialRow';
import { go, scoped, withIdentity } from '@/components/profile/hooks';

function Guest() {
  return (
    <View testID="profile-guest">
      <View style={st.crest}>
        <Text style={st.kicker}>Afilli okur kulübü</Text>
        <Text style={st.guestTitle}>Yazarlar burada kitaplarıyla tanınır.</Text>
        <Text style={st.guestText}>Giriş yaptığında profilin, takipçilerin, kitapların ve mesajların seninle birlikte her cihaza gelir.</Text>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 14, alignSelf: 'stretch' }}>
          <FoilButton label="Giriş yap" icon="log-in" testID="profile-guest-signin" onPress={() => go('/sign-in')} />
          <FoilButton variant="outline" label="Hesap oluştur" icon="user-plus" testID="profile-guest-signup" onPress={() => go('/sign-up')} />
        </View>
      </View>
      <SocialRow />
      <LocalShelf signedIn={false} />
    </View>
  );
}

function Profile() {
  const { ready, userId, error: sessionError, refreshProfile } = useCommunity();
  const [tab, setTab] = useState<ContentTab>('books');
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const tabsY = useRef(0);
  const me = useGetMyProfile({ query: { enabled: ready && !!userId, queryKey: scoped(getGetMyProfileQueryKey(), userId), refetchInterval: 30000 } });
  // Mask everything private until the fetched profile provably belongs to this session.
  const p = me.data && me.data.id === userId ? me.data : undefined;

  let body: React.ReactNode;
  if (!ready) body = <ProfileSkeleton />;
  else if (!userId) body = <Guest />;
  else if (!p && (me.isLoading || (me.data && me.data.id !== userId))) body = <ProfileSkeleton />;
  else if (!p) {
    body = <StateCard testID="profile-error" icon="wifi-off" title="Profilin açılamadı" text="İnternet bağlantısı yok, tekrar dene. Cihazdaki kitapların güvende."
      action={{ label: 'Tekrar dene', icon: 'refresh-cw', testID: 'profile-retry', onPress: () => { me.refetch(); refreshProfile().catch(() => {}); } }} />;
  } else {
    body = (
      <>
        {sessionError ? <Notice tone="error" text={sessionError} action={{ label: 'Tekrar dene', onPress: () => { refreshProfile().catch(() => {}); } }} /> : null}
        <ProfileHeader profile={p} viewerIsAdmin={p.isAdmin}
          onBooks={() => { setTab('books'); scroll.current?.scrollTo({ y: tabsY.current, animated: true }); }}
          actions={<>
            <FoilButton variant="outline" label="Profili Düzenle" icon="edit-2" testID="profile-edit" onPress={() => go('/profile-edit')} />
            <FoilButton variant="outline" label="Mesajlar" icon="message-circle" testID="profile-messages" onPress={() => go('/messages')} />
          </>} />
        <View onLayout={(e) => { tabsY.current = e.nativeEvent.layout.y; }}>
          <ProfileTabs profileId={p.id} isMe tab={tab} onTab={setTab} />
        </View>
        <LocalShelf signedIn />
      </>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: P.background }}>
      <MarbleBackground />
      <ScrollView ref={scroll} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <TopBar back backFallback="/" title="Profil" right={<>
          <RoundIcon icon="search" label="Okurları bul" testID="profile-people" onPress={() => go('/people')} />
          <RoundIcon icon="settings" label="Ayarlar" testID="profile-settings" onPress={() => go('/profile-settings')} />
        </>} />
        {body}
      </ScrollView>
    </View>
  );
}

export default withIdentity(Profile);

const st = StyleSheet.create({
  crest: { marginHorizontal: 18, marginTop: 10, padding: 22, borderRadius: 24, borderWidth: 1, borderColor: P.gold, backgroundColor: P.card, alignItems: 'center', gap: 6 },
  kicker: { fontFamily: F.script, fontSize: 26, color: P.gold },
  guestTitle: { fontFamily: F.serifBold, fontSize: 24, lineHeight: 31, color: P.text, textAlign: 'center' },
  guestText: { fontFamily: F.body, fontSize: 14, lineHeight: 21, color: P.muted, textAlign: 'center' },
});
