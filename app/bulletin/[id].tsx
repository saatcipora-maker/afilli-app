import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useGetBulletin, getGetBulletinQueryKey } from '@workspace/api-client-react';
import { F } from '@/components/ui';
import { MagazineScrollView } from '@/components/MagazineUI';
import { TopBar } from '@/components/bulletins/TopBar';
import { BulletinCard } from '@/components/bulletins/BulletinCard';
import { CommentsThread } from '@/components/bulletins/Comments';
import { b, Btn, apiError, OFFLINE } from '@/components/bulletins/common';

export default function BulletinDetail() {
  const { id, focusComment } = useLocalSearchParams<{ id: string; focusComment?: string }>();
  const postId = String(id ?? '');
  const q = useGetBulletin(postId, { query: { enabled: !!postId, queryKey: getGetBulletinQueryKey(postId), refetchInterval: 20000 } });
  const status = (q.error as { status?: number } | null)?.status;
  return (
    <View style={{ flex: 1, backgroundColor: b.background }}>
      <TopBar title="Bülten" backTo="/bultenler" />
      <MagazineScrollView contentContainerStyle={st.wrap}>
        {q.isLoading ? <View style={{ gap: 12 }}>{[200, 120].map((h, i) => <View key={i} style={[st.skel, { height: h }]} />)}</View> :
          q.isError || !q.data ? (
            <View style={st.empty}>
              <Feather name={status === 404 ? 'slash' : 'wifi-off'} size={28} color={b.danger} />
              <Text style={st.title}>{status === 404 ? 'Bu bülten silinmiş.' : apiError(q.error, OFFLINE)}</Text>
              {status === 404 ? <Btn label="Bültenlere dön" onPress={() => router.navigate('/bultenler')} /> : <Btn label="Tekrar dene" icon="refresh-cw" onPress={() => q.refetch()} />}
            </View>
          ) : (
            <>
              <BulletinCard post={q.data} detail onRemoved={() => router.navigate('/bultenler')} />
              <CommentsThread postId={postId} focusId={focusComment ? String(focusComment) : undefined} />
            </>
          )}
      </MagazineScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { padding: 14, paddingBottom: 40, maxWidth: 680, width: '100%', alignSelf: 'center' },
  skel: { borderRadius: 18, backgroundColor: b.input },
  empty: { alignItems: 'center', gap: 12, padding: 28, backgroundColor: b.card, borderRadius: 18, borderWidth: 1, borderColor: b.border },
  title: { fontFamily: F.serifBold, fontSize: 17, color: b.text, textAlign: 'center' },
});
