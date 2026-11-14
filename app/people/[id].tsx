import React, { useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetReaderProfile, getGetReaderProfileQueryKey, useGetMyProfile, getGetMyProfileQueryKey,
  useSetProfileFollow, useStartConversation,
} from '@workspace/api-client-react';
import { useCommunity } from '@/context/CommunityContext';
import { apiError, goSignIn } from '@/components/bulletins/common';
import { FoilButton, MarbleBackground, Notice, P, ProfileSkeleton, RoundIcon, StateCard, TopBar } from '@/components/profile/kit';
import { ProfileHeader } from '@/components/profile/ProfileHeader';
import { ProfileTabs, type ContentTab } from '@/components/profile/ProfileTabs';
import { actorRequest, go, scoped, useIdentityKey, useOwnerGuard } from '@/components/profile/hooks';

export default function PublicProfileRoute() {
  const { id: raw } = useLocalSearchParams<{ id: string }>();
  const id = typeof raw === 'string' ? raw : '';
  const key = useIdentityKey(id);
  return <PublicProfile key={key} id={id} />;
}

function PublicProfile({ id }: { id: string }) {
  const { ready, userId } = useCommunity();
  const alive = useOwnerGuard(userId);
  const qc = useQueryClient();
  const [tab, setTab] = useState<ContentTab>('books');
  const [err, setErr] = useState<string | null>(null);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const tabsY = useRef(0);
  const q = useGetReaderProfile(id, { query: { enabled: ready && !!id, queryKey: scoped(getGetReaderProfileQueryKey(id), userId), refetchInterval: 15000 } });
  const me = useGetMyProfile({ query: { enabled: ready && !!userId, queryKey: scoped(getGetMyProfileQueryKey(), userId) } });
  const meData = me.data && me.data.id === userId ? me.data : undefined;
  const follow = useSetProfileFollow({ request: actorRequest(userId) });
  const start = useStartConversation({ request: actorRequest(userId) });
  const p = q.data;

  const toggleFollow = () => {
    if (!userId) return goSignIn();
    if (!p) return;
    setErr(null);
    follow.mutate({ id: p.id, data: { following: !p.following } }, {
      onSuccess: (next) => {
        if (!alive()) return;
        qc.setQueryData(scoped(getGetReaderProfileQueryKey(p.id), userId), next);
        qc.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
      },
      onError: (e) => alive() && setErr(apiError(e, 'Takip güncellenemedi.')),
    });
  };
  const message = async () => {
    if (!userId) return goSignIn();
    if (!p) return;
    setErr(null);
    try {
      const conv = await start.mutateAsync({ data: { peerId: p.id } });
      if (alive()) go('/chat/' + conv.id);
    } catch (e) { if (alive()) setErr(apiError(e, 'Sohbet başlatılamadı.')); }
  };

  let body: React.ReactNode;
  if (!ready || (q.isLoading && !p)) body = <ProfileSkeleton />;
  else if (!p) {
    const notFound = (q.error as { status?: number } | null)?.status === 404;
    body = <StateCard testID="public-profile-error" icon={notFound ? 'user-x' : 'wifi-off'} title={notFound ? 'Bu profil bulunamadı' : 'Profil açılamadı'}
      text={notFound ? 'Hesap kapatılmış ya da bağlantı değişmiş olabilir.' : 'İnternet bağlantısı yok, tekrar dene.'}
      action={notFound ? { label: 'Okurlara dön', testID: 'public-profile-people', onPress: () => go('/people') } : { label: 'Tekrar dene', testID: 'public-profile-retry', onPress: () => q.refetch() }} />;
  } else {
    body = (
      <>
        {err ? <Notice tone="error" text={err} testID="public-profile-action-error" /> : null}
        <ProfileHeader profile={p} viewerIsAdmin={!!meData?.isAdmin}
          onBooks={() => { setTab('books'); scroll.current?.scrollTo({ y: tabsY.current, animated: true }); }}
          actions={p.isMe ? (
            <FoilButton variant="outline" label="Profili Düzenle" icon="edit-2" testID="public-profile-edit" onPress={() => go('/profile-edit')} />
          ) : (<>
            <FoilButton variant={p.following ? 'outline' : 'foil'} label={p.following ? 'Takibi Bırak' : 'Takip Et'} icon={p.following ? 'user-check' : 'user-plus'}
              testID="public-profile-follow" busy={follow.isPending} onPress={toggleFollow} />
            <FoilButton variant="outline" label="Mesaj" icon="message-circle" testID="public-profile-message" busy={start.isPending} onPress={message} />
          </>)} />
        <View onLayout={(e) => { tabsY.current = e.nativeEvent.layout.y; }}>
          <ProfileTabs profileId={p.id} isMe={p.isMe} tab={tab} onTab={setTab} />
        </View>
      </>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: P.background }}>
      <MarbleBackground />
      <ScrollView ref={scroll} contentContainerStyle={{ paddingBottom: 40 }}>
        <TopBar back title={p ? p.nickname : 'Yazar'} right={userId ? <RoundIcon icon="settings" label="Ayarlar" testID="public-profile-settings" onPress={() => go('/profile-settings')} /> : null} />
        {body}
      </ScrollView>
    </View>
  );
}
