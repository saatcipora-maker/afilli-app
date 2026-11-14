import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useGetProfileConnections, getGetProfileConnectionsQueryKey, type CommunityPerson } from '@workspace/api-client-react';
import { Avatar, Sheet } from '@/components/bulletins/common';
import { F, tap } from '@/components/ui';
import { useCommunity } from '@/context/CommunityContext';
import { FoilButton, P, Skeleton, StateCard } from './kit';
import { go, scoped } from './hooks';

type Kind = 'followers' | 'following';

function Page({ id, kind, cursor, onNext, isLast }: { id: string; kind: Kind; cursor?: string; onNext: (c: string) => void; isLast: boolean }) {
  const { ready, userId } = useCommunity();
  const params = cursor ? { kind, cursor } : { kind };
  const q = useGetProfileConnections(id, params, { query: { enabled: ready && !!id, queryKey: scoped(getGetProfileConnectionsQueryKey(id, params), userId) } });
  if (q.isLoading) return <View style={{ padding: 18, gap: 12 }}>{[0, 1, 2].map((i) => <Skeleton key={i} w="100%" h={44} />)}</View>;
  if (q.isError || !q.data) return <StateCard icon="wifi-off" title="Liste açılamadı" text="İnternet bağlantısı yok, tekrar dene." action={{ label: 'Tekrar dene', onPress: () => q.refetch(), testID: 'connections-retry' }} />;
  const items: CommunityPerson[] = q.data.items;
  if (!cursor && items.length === 0) {
    return <StateCard icon="users" title={kind === 'followers' ? 'Henüz takipçi yok' : 'Henüz kimse takip edilmiyor'} text="Kitaplar okundukça bu liste dolacak." />;
  }
  return (
    <View>
      {items.map((p) => (
        <Pressable key={p.id} testID={'connection-' + p.id} accessibilityRole="link" accessibilityLabel={p.nickname + ' profilini aç'}
          onPress={() => { tap(); go('/people/' + p.id); }}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 18, backgroundColor: pressed ? P.input : 'transparent' })}>
          <Avatar person={p} size={38} />
          <Text style={{ flex: 1, fontFamily: F.semi, fontSize: 15, color: P.text }} numberOfLines={1}>{p.nickname}</Text>
        </Pressable>
      ))}
      {isLast && q.data.nextCursor ? <View style={{ padding: 14 }}><FoilButton variant="outline" label="Daha fazla göster" testID="connections-more" onPress={() => onNext(q.data!.nextCursor!)} style={{ flex: 0 }} /></View> : null}
    </View>
  );
}

export function ConnectionsSheet({ profileId, kind, onClose }: { profileId: string; kind: Kind | null; onClose: () => void }) {
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  useEffect(() => { setCursors([undefined]); }, [kind, profileId]);
  return (
    <Sheet visible={!!kind} onClose={onClose} title={kind === 'following' ? 'Takip edilenler' : 'Takipçiler'} testID="connections-sheet">
      {kind ? cursors.map((c, i) => (
        <Page key={kind + (c ?? 'first')} id={profileId} kind={kind} cursor={c} isLast={i === cursors.length - 1} onNext={(n) => setCursors((p) => [...p, n])} />
      )) : null}
    </Sheet>
  );
}
