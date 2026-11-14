import React, { useCallback, useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useMagazine } from '@/context/MagazineContext';
import { SAMPLE_MAGAZINE_ID } from '@/data/magazine';
import { F } from '@/components/ui';
import { MagazineActions, MagazineHeader, MagazineSkeleton, Notice, m, sharePost } from '@/components/MagazineUI';

const COVER = require('@/assets/images/magazine/autumn-cover.webp');

export default function MagazineReader() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = String(rawId ?? '');
  const mag = useMagazine();
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const recordRef = useRef(mag.recordRead);
  recordRef.current = mag.recordRead;
  const recordedRef = useRef(false);
  const returningFromComments = useRef(false);

  // One read per actual visit: skip re-focus caused by returning from this post's comments.
  useFocusEffect(useCallback(() => {
    if (!mag.ready) return;
    if (returningFromComments.current) { returningFromComments.current = false; return; }
    if (recordedRef.current) return;
    recordedRef.current = true;
    recordRef.current(id);
    return () => { if (!returningFromComments.current) recordedRef.current = false; };
  }, [id, mag.ready]));

  const post = mag.ready ? mag.getPost(id) : undefined;

  return (
    <View style={st.screen}>
      <MagazineHeader title="Dergi" backTo="/dergi" backLabel="Dergiye dön" />
      {!mag.ready && !mag.storageError ? <MagazineSkeleton /> : !post ? (
        <View style={{ padding: 16 }}>
          <Notice tone="error" text={mag.storageError ?? 'Bu dergi yazısı bulunamadı.'} testID="reader-not-found" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={st.content}>
          {(id === SAMPLE_MAGAZINE_ID || post.image) && (
            <Image source={id === SAMPLE_MAGAZINE_ID ? COVER : { uri: post.image }} style={st.image} resizeMode="cover" accessibilityLabel="Dergi kapağı" />
          )}
          <Text style={st.title} accessibilityRole="header">{post.title}</Text>
          <Text style={st.meta}>{post.author} · {new Date(post.createdAt).toLocaleDateString('tr-TR')}</Text>
          <Text style={st.body} selectable>{post.body}</Text>
          <View style={st.bar}>
            <MagazineActions
              post={post} stats={mag.getStats(id)} ownReads={(mag.reads[id] ?? 0) > 0} prefix="reader"
              onLike={() => mag.toggleLike(id)}
              onComments={() => { returningFromComments.current = true; router.push({ pathname: '/magazine/comments/[id]', params: { id } }); }}
              onShare={async () => setShareMsg((await sharePost(post)).message)}
            />
          </View>
          {!post.likesEnabled && <Text style={st.meta}>Bu yazıda beğeniler kapalı.</Text>}
          {!post.commentsEnabled && <Text style={st.meta}>Bu yazıda yorumlar kapalı.</Text>}
          {shareMsg && <Text style={st.meta} accessibilityLiveRegion="polite">{shareMsg}</Text>}
        </ScrollView>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: m.background },
  content: { padding: 18, paddingBottom: 28, gap: 10 },
  image: { width: '100%', aspectRatio: 0.86, borderRadius: 12, backgroundColor: m.input, marginBottom: 6 },
  title: { fontSize: 25, lineHeight: 32, fontFamily: F.serifBold, color: m.text },
  meta: { fontSize: 13, fontFamily: F.body, color: m.muted },
  body: { fontSize: 17, lineHeight: 28, fontFamily: F.body, color: m.text, marginTop: 6 },
  bar: { borderTopWidth: 1, borderTopColor: m.input, marginTop: 10 },
});
