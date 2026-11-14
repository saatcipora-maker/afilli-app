import React from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useGetConversations, getGetConversationsQueryKey, type Conversation } from '@workspace/api-client-react';
import { useCommunity } from '@/context/CommunityContext';
import { useApp } from '@/context/AppContext';
import { F, tap } from '@/components/ui';
import { Avatar, timeAgo } from '@/components/bulletins/common';
import { MarbleBackground, P, RoundIcon, S, Skeleton, StateCard, TopBar, k } from '@/components/profile/kit';
import { go, scoped, useFocusedForeground, withIdentity } from '@/components/profile/hooks';

function Row({ c }: { c: Conversation }) {
  const status = c.peerTyping ? 'Yazıyor...' : c.lastMessage ?? 'Henüz mesaj yok';
  return (
    <Pressable testID={'conversation-' + c.id} accessibilityRole="link" accessibilityLabel={`${c.peer.nickname}, ${status}${c.unreadCount ? ', ' + c.unreadCount + ' okunmamış' : ''}`}
      onPress={() => { tap(); go('/chat/' + c.id); }} style={({ pressed }) => [st.row, { transform: [{ scale: pressed ? 0.99 : 1 }] }]}>
      <View>
        <Avatar person={c.peer} size={48} />
        <View style={[st.dot, { backgroundColor: c.peerTyping ? S.typing : c.peerOnline ? S.online : S.offline }]} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={[st.name, c.unreadCount > 0 && { fontFamily: F.serifBold }]} numberOfLines={1}>{c.peer.nickname}</Text>
          <Text style={st.time}>{timeAgo(c.updatedAt)}</Text>
        </View>
        <Text style={[st.last, c.peerTyping && { color: S.typing }, c.unreadCount > 0 && { color: P.text, fontFamily: F.semi }]} numberOfLines={1}>{status}</Text>
      </View>
      {c.unreadCount > 0 ? <View style={st.badge}><Text style={st.badgeText}>{c.unreadCount > 99 ? '99+' : c.unreadCount}</Text></View> : null}
    </Pressable>
  );
}

function Archive() {
  const { messages } = useApp();
  if (messages.length === 0) return null;
  return (
    <View testID="messages-local-archive">
      <Text style={k.section}>Bu cihazdaki eski mesajlar</Text>
      <View style={k.card}>
        {messages.map((m, i) => (
          <View key={m.id} style={[{ padding: 14, gap: 3 }, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: P.border }]}>
            <Text style={st.name}>{m.from}</Text>
            <Text style={st.last}>{m.text}</Text>
          </View>
        ))}
      </View>
      <Text style={[k.hint, { textAlign: 'center', marginTop: 8 }]}>Arşiv yalnızca bu cihazda saklanır; yanıtlanamaz.</Text>
    </View>
  );
}

function Messages() {
  const { ready, userId } = useCommunity();
  const active = useFocusedForeground();
  const q = useGetConversations({ query: { enabled: ready && !!userId, queryKey: scoped(getGetConversationsQueryKey(), userId), refetchInterval: active ? 12000 : false } });
  const items = q.data ?? [];

  let body: React.ReactNode;
  if (!ready || (userId && q.isLoading)) body = <View style={{ padding: 18, gap: 10 }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} w="100%" h={70} r={18} />)}</View>;
  else if (!userId) body = (<>
    <StateCard testID="messages-guest" icon="message-circle" title="Yazarlarla yazışmak için giriş yap" text="Mesajların hesabına bağlıdır ve yalnızca sohbetin iki tarafı görebilir."
      action={{ label: 'Giriş yap', icon: 'log-in', testID: 'messages-signin', onPress: () => go('/sign-in') }} />
    <Archive />
  </>);
  else if (q.isError && !q.data) body = (<>
    <StateCard testID="messages-error" icon="wifi-off" title="Sohbetler yüklenemedi" text="İnternet bağlantısı yok, tekrar dene." action={{ label: 'Tekrar dene', testID: 'messages-retry', onPress: () => q.refetch() }} />
    <Archive />
  </>);
  else body = (
    <FlatList data={items} keyExtractor={(c) => c.id} renderItem={({ item }) => <Row c={item} />}
      contentContainerStyle={{ paddingBottom: 30, paddingTop: 4 }}
      refreshing={q.isRefetching} onRefresh={() => q.refetch()}
      ListEmptyComponent={<StateCard testID="messages-empty" icon="feather" title="Henüz bir sohbetin yok" text="Okuduğun bir yazarın profilinden Mesaj'a dokunarak ilk mektubunu yaz."
        action={{ label: 'Okurları keşfet', icon: 'users', testID: 'messages-find-people', onPress: () => go('/people') }} />}
      ListFooterComponent={<Archive />} />
  );

  return (
    <View style={{ flex: 1, backgroundColor: P.background }}>
      <MarbleBackground />
      <TopBar back title="Mesajlar" right={userId ? <RoundIcon icon="edit" label="Yeni sohbet" testID="messages-new" onPress={() => go('/people')} /> : null} />
      {body}
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 74, marginHorizontal: 18, marginBottom: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, borderWidth: 1, borderColor: P.border, backgroundColor: P.card },
  dot: { position: 'absolute', right: 0, bottom: 0, width: 13, height: 13, borderRadius: 7, borderWidth: 2, borderColor: P.card },
  name: { flex: 1, fontFamily: F.semi, fontSize: 15, color: P.text },
  time: { fontFamily: F.body, fontSize: 11, color: P.muted },
  last: { fontFamily: F.body, fontSize: 13, color: P.muted, marginTop: 2 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: P.gold },
  badgeText: { fontFamily: F.semi, fontSize: 11, color: P.text },
});

export default withIdentity(Messages);
