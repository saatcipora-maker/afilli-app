import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useGetBulletins, getGetBulletinsQueryKey, type Bulletin } from '@workspace/api-client-react';
import { F, tap } from '@/components/ui';
import { ARTICLES } from '@/data/catalog';
import { useCommunity } from '@/context/CommunityContext';
import { TopBar } from '@/components/bulletins/TopBar';
import { Composer } from '@/components/bulletins/Composer';
import { BulletinCard } from '@/components/bulletins/BulletinCard';
import { b, Btn, apiError, OFFLINE, goSignIn } from '@/components/bulletins/common';

const ARCHIVE = ARTICLES.filter((a) => a.kind === 'bulten');

function Archive() {
  const [open, setOpen] = useState(false);
  return (
    <View style={st.archive}>
      <Pressable testID="bulletin-archive" accessibilityRole="button" aria-expanded={open} accessibilityState={{ expanded: open }} accessibilityLabel="Bülten arşivi"
        onPress={() => { tap(); setOpen((o) => !o); }} style={st.archiveHead}>
        <Feather name="archive" size={17} color={b.gold} />
        <Text style={st.archiveTitle}>Bülten arşivi</Text>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={18} color={b.text} />
      </Pressable>
      {open ? ARCHIVE.map((a) => (
        <Pressable key={a.id} testID={'archive-' + a.id} accessibilityRole="link" onPress={() => router.push({ pathname: '/article/[id]', params: { id: a.id } })} style={st.archiveRow}>
          <Text style={st.archiveItem}>{a.title}</Text>
          <Text style={st.muted} numberOfLines={2}>{a.summary}</Text>
        </Pressable>
      )) : null}
    </View>
  );
}

export default function Bultenler() {
  const { userId, ready, error: sessionError } = useCommunity();
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [older, setOlder] = useState<Bulletin[]>([]);
  const [patches, setPatches] = useState<Record<string, Bulletin>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [created, setCreated] = useState<Bulletin[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  React.useEffect(() => {
    setCursor(undefined); setOlder([]); setPatches({}); setRemoved(new Set()); setCreated([]);
  }, [userId]);

  const head = useGetBulletins(undefined, { query: { queryKey: getGetBulletinsQueryKey(), refetchInterval: 20000, enabled: ready } });
  const pageParams = cursor ? { cursor } : undefined;
  const page = useGetBulletins(pageParams, { query: { queryKey: getGetBulletinsQueryKey(pageParams), enabled: !!cursor && ready, staleTime: Infinity } });

  // Append each older page once it arrives (deduped by id below).
  const pageItems = page.data?.items;
  const pageCursor = page.data?.nextCursor;
  React.useEffect(() => {
    if (cursor && pageItems) setOlder((o) => [...o, ...pageItems.filter((x) => !o.some((y) => y.id === x.id))]);
  }, [cursor, pageItems]);

  // A fresh head page supersedes local patches for the rows it contains.
  const headAt = head.dataUpdatedAt;
  React.useEffect(() => {
    const ids = new Set((head.data?.items ?? []).map((x) => x.id));
    setPatches((p) => Object.fromEntries(Object.entries(p).filter(([id]) => !ids.has(id))));
    setCreated((previous) => previous.filter((post) => !ids.has(post.id)));
  }, [headAt]); // eslint-disable-line react-hooks/exhaustive-deps

  useFocusEffect(useCallback(() => { if (ready) head.refetch(); }, [ready])); // eslint-disable-line react-hooks/exhaustive-deps

  const items = useMemo(() => {
    const headItems = head.data?.items ?? [];
    const headIds = new Set(headItems.map((x) => x.id));
    const out: Bulletin[] = [];
    const seen = new Set<string>();
    for (const x of [...created.filter((c) => !headIds.has(c.id)), ...headItems, ...older]) {
      if (seen.has(x.id) || removed.has(x.id)) continue;
      seen.add(x.id);
      out.push(patches[x.id] ?? x);
    }
    return out;
  }, [head.data, older, patches, removed, created]);

  const nextCursor = cursor ? pageCursor ?? null : head.data?.nextCursor ?? null;
  const loadMore = () => { if (nextCursor && !page.isFetching && !head.isFetching) setCursor(nextCursor); };
  const refresh = async () => {
    setRefreshing(true); setCursor(undefined); setOlder([]); setPatches({}); setRemoved(new Set()); setCreated([]);
    await head.refetch(); setRefreshing(false);
  };
  const onChange = (x: Bulletin) => setPatches((p) => ({ ...p, [x.id]: x }));
  const onRemoved = (id: string) => setRemoved((r) => new Set(r).add(id));

  const header = (
    <View>
      {!userId && ready ? (
        <Pressable onPress={goSignIn} accessibilityRole="button" style={st.signin} testID="bulletins-signin-cta">
          <Feather name="log-in" size={16} color={b.text} />
          <Text style={st.signinText}>Okumak serbest. Paylaşmak, beğenmek ve yorum yapmak için giriş yap.</Text>
        </Pressable>
      ) : null}
      {sessionError ? <Text style={st.err}>{sessionError}</Text> : null}
      <Composer key={userId ?? 'anonymous'} onCreated={(x) => setCreated((c) => [x, ...c])} />
      <Text style={st.section}>Akış</Text>
    </View>
  );
  const offline = head.isError && !head.data;
  return (
    <View style={{ flex: 1, backgroundColor: b.background }}>
      <TopBar title="Bültenler" />
      <FlatList
        data={offline || head.isLoading ? [] : items}
        keyExtractor={(x) => x.id}
        renderItem={({ item }) => <BulletinCard post={item} onChange={onChange} onRemoved={onRemoved} />}
        ListHeaderComponent={header}
        contentContainerStyle={st.list}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={b.gold} colors={[b.gold]} />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={head.isLoading || !ready ? (
          <View style={{ gap: 12 }} accessibilityLabel="Bültenler yükleniyor">{[140, 220].map((h, i) => <View key={i} style={[st.skel, { height: h }]} />)}</View>
        ) : offline ? (
          <View style={st.empty}><Feather name="wifi-off" size={28} color={b.danger} /><Text style={st.emptyTitle}>{apiError(head.error, OFFLINE)}</Text>
            <Btn label="Tekrar dene" icon="refresh-cw" onPress={() => head.refetch()} testID="bulletins-retry" /></View>
        ) : (
          <View style={st.empty}><Feather name="feather" size={28} color={b.gold} /><Text style={st.emptyTitle}>Akış henüz boş</Text>
            <Text style={st.muted}>İlk bülteni sen paylaş; topluluk seni okusun.</Text></View>
        )}
        ListFooterComponent={
          <View>
            {page.isFetching ? <ActivityIndicator color={b.gold} style={{ margin: 16 }} /> : null}
            {page.isError ? <View style={{ alignItems: 'center', gap: 8, marginBottom: 12 }}><Text style={st.err}>{OFFLINE}</Text><Btn label="Tekrar dene" ghost onPress={() => page.refetch()} /></View> : null}
            {head.isError && head.data ? <Text style={st.err}>{OFFLINE}</Text> : null}
            {!nextCursor && items.length > 0 ? <Text style={st.end}>— Akışın sonu —</Text> : null}
            <Archive />
          </View>
        }
      />
    </View>
  );
}

const st = StyleSheet.create({
  list: { padding: 14, paddingBottom: 24, maxWidth: 680, width: '100%', alignSelf: 'center' },
  section: { fontFamily: F.semi, fontSize: 11, letterSpacing: 1.6, color: b.gold, marginBottom: 10, textTransform: 'uppercase' },
  signin: { flexDirection: 'row', gap: 8, alignItems: 'center', padding: 12, borderRadius: 14, backgroundColor: b.input, marginBottom: 12, borderWidth: 1, borderColor: b.gold },
  signinText: { flex: 1, fontFamily: F.med, fontSize: 13, color: b.text, lineHeight: 18 },
  err: { color: b.danger, fontFamily: F.med, fontSize: 13, textAlign: 'center', marginVertical: 8 },
  skel: { borderRadius: 18, backgroundColor: b.input },
  empty: { alignItems: 'center', gap: 10, padding: 28, backgroundColor: b.card, borderRadius: 18, borderWidth: 1, borderColor: b.border, borderStyle: 'dashed' },
  emptyTitle: { fontFamily: F.serifBold, fontSize: 17, color: b.text, textAlign: 'center' },
  muted: { fontFamily: F.body, fontSize: 13, color: b.muted, textAlign: 'center' },
  end: { textAlign: 'center', fontFamily: F.body, fontSize: 12, color: b.muted, marginVertical: 12 },
  archive: { marginTop: 10, backgroundColor: b.card, borderRadius: 16, borderWidth: 1, borderColor: b.border, overflow: 'hidden' },
  archiveHead: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  archiveTitle: { flex: 1, fontFamily: F.serifBold, fontSize: 15, color: b.text },
  archiveRow: { paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderColor: b.border, gap: 3 },
  archiveItem: { fontFamily: F.semi, fontSize: 14, color: b.text },
});
