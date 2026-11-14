import React, { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useGetPeople, getGetPeopleQueryKey, type CommunityPerson } from '@workspace/api-client-react';
import { useCommunity } from '@/context/CommunityContext';
import { F, tap } from '@/components/ui';
import { Avatar } from '@/components/bulletins/common';
import { FoilButton, MarbleBackground, P, Skeleton, StateCard, TopBar, k } from '@/components/profile/kit';
import { go, scoped, withIdentity } from '@/components/profile/hooks';

function People() {
  const { ready, userId } = useCommunity();
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<CommunityPerson[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const params = { ...(search ? { search } : {}), ...(cursor ? { cursor } : {}) };
  const q = useGetPeople(params, { query: { enabled: ready, queryKey: scoped(getGetPeopleQueryKey(params), userId) } });

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (!q.data) return;
    const page = q.data.items;
    setItems((prev) => {
      if (!cursor) return page;
      const seen = new Set(prev.map((p) => p.id));
      return [...prev, ...page.filter((p) => !seen.has(p.id))];
    });
  }, [q.data, cursor]);

  const onText = (t: string) => {
    setText(t);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { setCursor(undefined); setSearch(t.trim()); }, 350);
  };
  const firstLoad = q.isLoading && !cursor;

  return (
    <View style={{ flex: 1, backgroundColor: P.background }}>
      <MarbleBackground />
      <TopBar back title="Okurlar ve yazarlar" />
      <View style={st.searchBox}>
        <Feather name="search" size={18} color={P.muted} />
        <TextInput testID="people-search" value={text} onChangeText={onText} placeholder="Ad veya kullanıcı adıyla ara" placeholderTextColor={P.muted}
          style={st.search} autoCapitalize="none" autoCorrect={false} returnKeyType="search" accessibilityLabel="Okur ara" />
        {text ? <Pressable testID="people-search-clear" onPress={() => onText('')} hitSlop={10} accessibilityLabel="Aramayı temizle"><Feather name="x" size={18} color={P.muted} /></Pressable> : null}
      </View>
      {firstLoad ? <View style={{ padding: 18, gap: 12 }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} w="100%" h={60} r={16} />)}</View>
        : q.isError && items.length === 0 ? <StateCard testID="people-error" icon="wifi-off" title="Okurlar yüklenemedi" text="İnternet bağlantısı yok, tekrar dene." action={{ label: 'Tekrar dene', testID: 'people-retry', onPress: () => q.refetch() }} />
        : (
          <FlatList
            data={items}
            keyExtractor={(p) => p.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 30, paddingTop: 6 }}
            ListEmptyComponent={<StateCard testID="people-empty" icon="users" title={search ? 'Kimse bulunamadı' : 'Henüz okur yok'} text={search ? `"${search}" ile eşleşen bir okur yok. Başka bir ad dene.` : 'İlk okurlar katıldığında burada görünecek.'} />}
            renderItem={({ item }) => (
              <Pressable testID={'people-row-' + item.id} accessibilityRole="link" accessibilityLabel={item.nickname + ' profilini aç'}
                onPress={() => { tap(); go('/people/' + item.id); }} style={({ pressed }) => [st.row, { transform: [{ scale: pressed ? 0.99 : 1 }] }]}>
                <Avatar person={item} size={44} />
                <Text style={st.name} numberOfLines={1}>{item.nickname}</Text>
                <Feather name="chevron-right" size={18} color={P.muted} />
              </Pressable>
            )}
            ListFooterComponent={q.data?.nextCursor ? (
              <View style={{ padding: 18 }}>
                <FoilButton variant="outline" label="Daha fazla göster" testID="people-more" busy={q.isFetching} onPress={() => setCursor(q.data!.nextCursor!)} style={{ flex: 0 }} />
              </View>
            ) : undefined}
          />
        )}
    </View>
  );
}

const st = StyleSheet.create({
  searchBox: { ...k.input, flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 18, marginBottom: 6, paddingVertical: 0 },
  search: { flex: 1, minHeight: 46, fontFamily: F.body, fontSize: 15, color: P.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, marginHorizontal: 18, marginBottom: 8, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: P.border, backgroundColor: P.card },
  name: { flex: 1, fontFamily: F.semi, fontSize: 15, color: P.text },
});

export default withIdentity(People);
