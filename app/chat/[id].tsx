import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetConversation, getGetConversationQueryKey, useGetConversationMessages, getGetConversationMessagesQueryKey,
  getGetConversationsQueryKey, useReadConversation, useSendConversationMessage, type DirectMessage,
} from '@workspace/api-client-react';
import { useCommunity } from '@/context/CommunityContext';
import { F, tap } from '@/components/ui';
import { Avatar, apiError } from '@/components/bulletins/common';
import { MarbleBackground, Notice, P, S, Skeleton, StateCard, StatusLine, TopBar } from '@/components/profile/kit';
import { ChatComposer } from '@/components/profile/ChatComposer';
import { ackOutbox, readChatDraft, type OutboxEntry } from '@/lib/chat-drafts';
import { actorRequest, go, scoped, useFocusedForeground, useIdentityKey, useOwnerGuard } from '@/components/profile/hooks';

/** sending = in flight or paused offline; unconfirmed = restored from the durable outbox; failed = server/network error. */
type Pending = OutboxEntry & { status: 'sending' | 'failed' | 'unconfirmed'; error?: string };
type Item = { kind: 'server'; m: DirectMessage } | { kind: 'pending'; p: Pending };

export default function ChatRoute() {
  const { id: raw } = useLocalSearchParams<{ id: string }>();
  const id = typeof raw === 'string' ? raw : '';
  const key = useIdentityKey(id);
  return <Chat key={key} id={id} />;
}

/** Remounted per identity+thread: no messages, pending sends or peer survive a switch. */
function Chat({ id }: { id: string }) {
  const { ready, userId } = useCommunity();
  const owner = userId;
  const alive = useOwnerGuard(owner);
  const qc = useQueryClient();
  const active = useFocusedForeground();
  const enabled = ready && !!userId && !!id;
  const poll = active ? 4000 : false;
  const conv = useGetConversation(id, { query: { enabled, queryKey: scoped(getGetConversationQueryKey(id), owner), refetchInterval: poll } });
  const first = {};
  const latest = useGetConversationMessages(id, first, { query: { enabled, queryKey: scoped(getGetConversationMessagesQueryKey(id, first), owner), refetchInterval: poll } });
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [older, setOlder] = useState<DirectMessage[]>([]);
  const [nextOlder, setNextOlder] = useState<string | null | undefined>(undefined);
  const olderParams = { cursor: olderCursor ?? '' };
  const olderQ = useGetConversationMessages(id, olderParams, { query: { enabled: enabled && !!olderCursor, queryKey: scoped(getGetConversationMessagesQueryKey(id, olderParams), owner) } });
  const [pending, setPending] = useState<Pending[]>([]);
  const [outboxErr, setOutboxErr] = useState(false);
  const [outboxAttempt, setOutboxAttempt] = useState(0);
  const send = useSendConversationMessage({ request: actorRequest(userId) });
  const read = useReadConversation({ request: actorRequest(userId) });
  const readRef = useRef(read.mutate); readRef.current = read.mutate;
  const lastMarked = useRef<string | null>(null);
  const aliveRef = useRef(alive); aliveRef.current = alive;

  // Reset all identity/thread-bound state; restore failed sends from this account's draft.
  useEffect(() => {
    setOlder([]); setOlderCursor(null); setNextOlder(undefined); lastMarked.current = null;
    if (!owner || !id) return;
    let on = true;
    const live = aliveRef.current;
    setOutboxErr(false);
    // Restore every unacknowledged send; never clobber entries already in flight this session.
    readChatDraft(owner, id).then(
      (d) => {
        if (!on || !live()) return;
        setPending((list) => [...list, ...d.outbox.filter((e) => !list.some((x) => x.clientId === e.clientId)).map((e) => ({ ...e, status: 'unconfirmed' as const }))]);
      },
      () => { if (on && live()) setOutboxErr(true); },
    );
    return () => { on = false; };
  }, [owner, id, outboxAttempt]);

  useEffect(() => { if (nextOlder === undefined && latest.data) setNextOlder(latest.data.nextCursor); }, [latest.data, nextOlder]);
  useEffect(() => {
    if (!olderQ.data || !olderCursor || !alive()) return;
    setOlder((prev) => [...prev, ...olderQ.data.items]);
    setNextOlder(olderQ.data.nextCursor);
  }, [olderQ.data, olderCursor]);

  const messages = useMemo(() => {
    const map = new Map<string, DirectMessage>();
    for (const m of [...(latest.data?.items ?? []), ...older]) map.set(m.id, m);
    return [...map.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [latest.data, older]);
  const peer = enabled ? conv.data?.peer : undefined;

  // Mark read only while focused + foreground, and only for peer messages actually shown.
  useEffect(() => {
    if (!active || !peer || !enabled || !latest.data || !alive()) return;
    const newestUnread = messages.find((m) => m.sender.id === peer.id && !m.readAt);
    if (!newestUnread || lastMarked.current === newestUnread.id) return;
    lastMarked.current = newestUnread.id;
    readRef.current({ id }, { onSuccess: () => { if (alive()) qc.invalidateQueries({ queryKey: getGetConversationsQueryKey() }); } });
  }, [active, messages, peer, id, qc, enabled, latest.data, alive]);

  // The entry is already durable in the owner's outbox; it is removed ONLY after a real server ack.
  const deliver = (p: OutboxEntry) => {
    if (!alive() || !owner) return;
    const who = owner;
    setPending((list) => [{ ...p, status: 'sending' as const }, ...list.filter((x) => x.clientId !== p.clientId)]);
    send.mutate({ id, data: { clientId: p.clientId, body: p.body } }, {
      onSuccess: () => {
        ackOutbox(who, id, p.clientId).then(
          () => { if (alive()) setPending((list) => list.filter((x) => x.clientId !== p.clientId)); },
          // Server has it, but the local queue could not be updated: keep it visible; retry is idempotent (same clientId).
          () => { if (alive()) setPending((list) => list.map((x) => x.clientId === p.clientId ? { ...x, status: 'failed' as const, error: 'Gönderildi; cihaz kaydı güncellenemedi' } : x)); },
        );
        if (!alive()) return;
        qc.invalidateQueries({ queryKey: scoped(getGetConversationMessagesQueryKey(id, first), who) });
        qc.invalidateQueries({ queryKey: getGetConversationsQueryKey() });
      },
      onError: (e) => {
        if (!alive()) return; // stays in the durable outbox for its owner
        setPending((list) => list.map((x) => x.clientId === p.clientId ? { ...x, status: 'failed' as const, error: apiError(e, 'Gönderilemedi.') } : x));
      },
    });
  };

  const data: Item[] = [...pending.map((p) => ({ kind: 'pending' as const, p })), ...messages.map((m) => ({ kind: 'server' as const, m }))];
  const lastMineRead = messages.find((m) => peer && m.sender.id !== peer.id);
  const status = (conv.error as { status?: number } | null)?.status;

  let body: React.ReactNode;
  if (!ready || (enabled && (conv.isLoading || latest.isLoading))) body = <View style={{ padding: 18, gap: 12 }}>{[0, 1, 2].map((i) => <Skeleton key={i} w={i % 2 ? '60%' : '72%'} h={48} r={18} style={{ alignSelf: i % 2 ? 'flex-end' : 'flex-start' }} />)}</View>;
  else if (!userId) body = <StateCard icon="lock" title="Sohbet için giriş yap" text="Mesajlar yalnızca sohbetin iki tarafına görünür." action={{ label: 'Giriş yap', testID: 'chat-signin', onPress: () => go('/sign-in') }} />;
  else if (status === 403 || status === 404) body = <StateCard testID="chat-forbidden" icon="lock" title="Bu sohbete erişimin yok" text="Sohbet yalnızca katılımcılarına açıktır." action={{ label: 'Mesajlara dön', testID: 'chat-back-messages', onPress: () => go('/messages') }} />;
  else if (!conv.data) body = <StateCard testID="chat-error" icon="wifi-off" title="Sohbet açılamadı" text="İnternet bağlantısı yok, tekrar dene." action={{ label: 'Tekrar dene', testID: 'chat-retry', onPress: () => { conv.refetch(); latest.refetch(); } }} />;
  else body = (
    <>
      {latest.isError ? <Notice tone="error" text="Yeni mesajlar alınamıyor. İnternet bağlantısı yok, tekrar dene." action={{ label: 'Tekrar dene', onPress: () => latest.refetch() }} /> : null}
      <FlatList
        testID="chat-list" inverted data={data} style={{ flex: 1 }}
        keyExtractor={(it) => it.kind === 'server' ? it.m.id : 'p-' + it.p.clientId}
        keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 12, gap: 6 }}
        onEndReachedThreshold={0.3}
        onEndReached={() => { if (nextOlder && !olderQ.isFetching && nextOlder !== olderCursor) setOlderCursor(nextOlder); }}
        ListFooterComponent={olderQ.isFetching ? <Text style={st.meta}>Eski mesajlar yükleniyor...</Text> : nextOlder === null && messages.length > 0 ? <Text style={st.meta}>Sohbetin başlangıcı</Text> : undefined}
        ListEmptyComponent={<View style={{ transform: [{ scaleY: -1 }] }}><StateCard icon="feather" title={`${peer?.nickname ?? ''} ile ilk mektubun`} text="Kibar bir merhaba her güzel yazışmanın başlangıcıdır." /></View>}
        renderItem={({ item }) => {
          if (item.kind === 'pending') {
            const p = item.p;
            return (
              <View style={[st.bubble, st.mine, { opacity: p.status === 'sending' ? 0.7 : 1 }]}>
                <Text style={st.mineText}>{p.body}</Text>
                {p.status !== 'sending' ? (
                  <Pressable testID={'chat-retry-' + p.clientId} accessibilityRole="button" accessibilityLabel="Tekrar gönder" onPress={() => { tap(); deliver(p); }} style={st.retry}>
                    <MaterialCommunityIcons name="alert-circle-outline" size={14} color={S.igYellow} />
                    <Text style={st.retryText}>{p.status === 'unconfirmed' ? 'Son gönderim doğrulanamadı' : p.error ?? 'Gönderilemedi'} · Tekrar dene</Text>
                  </Pressable>
                ) : <Text style={st.mineMeta}>Gönderiliyor...</Text>}
              </View>
            );
          }
          const m = item.m; const mine = !!peer && m.sender.id !== peer.id;
          const time = new Date(m.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
          return (
            <View testID={'chat-message-' + m.id} style={[st.bubble, mine ? st.mine : st.theirs]}>
              <Text style={mine ? st.mineText : st.theirText}>{m.body}</Text>
              <View style={st.metaRow}>
                <Text style={mine ? st.mineMeta : st.theirMeta}>{time}</Text>
                {mine ? <MaterialCommunityIcons name={m.readAt ? 'check-all' : 'check'} size={14} color={m.readAt ? S.foilLight : S.bubbleMineText} accessibilityLabel={m.readAt ? 'Okundu' : 'İletildi'} /> : null}
              </View>
              {mine && lastMineRead?.id === m.id ? <Text style={st.mineMeta}>{m.readAt ? 'Okundu' : 'İletildi'}</Text> : null}
            </View>
          );
        }}
      />
      {conv.data.peerTyping ? <Text testID="chat-typing" style={[st.meta, { color: S.typing, textAlign: 'left', paddingHorizontal: 18 }]}>{peer?.nickname} yazıyor...</Text> : null}
      {outboxErr ? <Notice tone="error" testID="chat-outbox-error" text="Bekleyen gönderimlerin okunamadı; silinmedi." action={{ label: 'Tekrar dene', onPress: () => setOutboxAttempt((n) => n + 1) }} /> : null}
      <ChatComposer userId={userId} threadId={id} onQueued={deliver} />
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: P.background }}>
      <MarbleBackground />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }} keyboardVerticalOffset={0}>
        <TopBar back title="" right={ready && enabled && peer && conv.data && !conv.isError ? (
          <Pressable testID="chat-peer" accessibilityRole="link" accessibilityLabel={peer.nickname + ' profilini aç'} onPress={() => go('/people/' + peer.id)} style={st.peer}>
            <Avatar person={peer} size={38} />
            <View style={{ flexShrink: 1 }}>
              <Text style={st.peerName} numberOfLines={1}>{peer.nickname}</Text>
              <StatusLine presence={{ online: conv.data.peerOnline, typing: conv.data.peerTyping, lastSeen: conv.data.peerLastSeen }} />
            </View>
          </Pressable>
        ) : null} />
        {body}
      </KeyboardAvoidingView>
    </View>
  );
}

const st = StyleSheet.create({
  peer: { flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: 260 },
  peerName: { fontFamily: F.serifBold, fontSize: 17, color: P.text },
  bubble: { maxWidth: '82%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9, gap: 3 },
  mine: { alignSelf: 'flex-end', backgroundColor: S.bubbleMine, borderBottomRightRadius: 6 },
  theirs: { alignSelf: 'flex-start', backgroundColor: P.card, borderWidth: 1, borderColor: P.border, borderBottomLeftRadius: 6 },
  mineText: { fontFamily: F.body, fontSize: 15, lineHeight: 21, color: S.bubbleMineText },
  theirText: { fontFamily: F.body, fontSize: 15, lineHeight: 21, color: P.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end' },
  mineMeta: { fontFamily: F.body, fontSize: 11, color: S.bubbleMineText, opacity: 0.8, alignSelf: 'flex-end' },
  theirMeta: { fontFamily: F.body, fontSize: 11, color: P.muted },
  retry: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 },
  retryText: { fontFamily: F.semi, fontSize: 12, color: S.igYellow },
  meta: { fontFamily: F.body, fontSize: 12, color: P.muted, textAlign: 'center', paddingVertical: 8 },
});
