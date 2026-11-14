import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, type Href } from 'expo-router';
import { useMagazine } from '@/context/MagazineContext';
import { useApp } from '@/context/AppContext';
import { SAMPLE_MAGAZINE_ID } from '@/data/magazine';
import { F, tap } from '@/components/ui';
import { MagazineHeader, MagazineScrollView, MagazineSkeleton, Notice, m } from '@/components/MagazineUI';

export default function MagazineComments() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = String(rawId ?? '');
  const mag = useMagazine();
  const { name } = useApp();
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const post = mag.ready ? mag.getPost(id) : undefined;
  const list = mag.comments[id] ?? [];
  const backTo = { pathname: '/magazine/[id]', params: { id } } as Href;

  const send = () => {
    tap();
    const r = mag.addComment(id, text, name);
    if (r.ok) { setText(''); setErr(null); } else setErr(r.error);
  };

  return (
    <View style={st.screen}>
      <MagazineHeader title="Yorumlar" backTo={post ? backTo : '/dergi'} backLabel="Yazıya dön" />
      {!mag.ready && !mag.storageError ? <MagazineSkeleton /> : !post ? (
        <View style={{ padding: 16 }}><Notice tone="error" text={mag.storageError ?? 'Bu dergi yazısı bulunamadı.'} /></View>
      ) : (
        <MagazineScrollView contentContainerStyle={st.content}>
          <Text style={st.title}>{post.title}</Text>
          {id === SAMPLE_MAGAZINE_ID && (
            <Notice text="Örnek yazıdaki 234 yorum sayısı yalnızca gösterim amaçlı bir referanstır; bu yorumların içeriği mevcut değildir. Aşağıda yalnızca bu cihazda eklenen yorumlar listelenir." testID="comments-reference-note" />
          )}
          {list.length === 0 ? (
            <View style={st.empty} testID="comments-empty">
              <Feather name="message-circle" size={30} color={m.gold} />
              <Text style={st.emptyText}>Bu cihazda henüz yorum yok.</Text>
            </View>
          ) : list.map((c) => (
            <View key={c.id} style={st.comment}>
              <Text style={st.author}>{c.author} <Text style={st.meta}>· {new Date(c.createdAt).toLocaleString('tr-TR')}</Text></Text>
              <Text style={st.body}>{c.body}</Text>
            </View>
          ))}
          {post.commentsEnabled ? (
            <View style={st.composer}>
              <TextInput
                testID="comment-input" accessibilityLabel="Yorum yaz" value={text}
                onChangeText={(t) => { setText(t); if (err) setErr(null); }}
                placeholder="Yorumunuzu yazın..." placeholderTextColor={m.muted} multiline style={st.input}
              />
              <Pressable
                testID="comment-send" accessibilityRole="button" accessibilityLabel="Yorumu gönder" onPress={send}
                style={({ pressed }) => [st.send, { opacity: pressed ? 0.7 : 1 }]}
              >
                <Feather name="send" size={20} color={m.text} />
              </Pressable>
            </View>
          ) : (
            <Notice text="Bu yazıda yorumlar kapalı." testID="comments-disabled" />
          )}
          {err && <Text style={st.err} accessibilityLiveRegion="polite">{err}</Text>}
          <Text style={st.meta}>Yorumlar yalnızca bu cihazda saklanır.</Text>
        </MagazineScrollView>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: m.background },
  content: { padding: 16, gap: 12, paddingBottom: 24 },
  title: { fontSize: 19, fontFamily: F.semi, fontWeight: '700', color: m.text },
  empty: { alignItems: 'center', gap: 8, padding: 24, backgroundColor: m.card, borderRadius: 16 },
  emptyText: { fontSize: 14, fontFamily: F.body, color: m.muted },
  comment: { backgroundColor: m.card, borderRadius: 14, padding: 14, gap: 4 },
  author: { fontSize: 14, fontFamily: F.semi, color: m.text },
  meta: { fontSize: 12, fontFamily: F.body, color: m.muted },
  body: { fontSize: 15, lineHeight: 22, fontFamily: F.body, color: m.text },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: { flex: 1, minHeight: 48, maxHeight: 140, backgroundColor: m.input, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, fontSize: 15, fontFamily: F.body, color: m.text },
  send: { width: 48, height: 48, borderRadius: 10, backgroundColor: m.gold, alignItems: 'center', justifyContent: 'center' },
  err: { fontSize: 13, fontFamily: F.semi, color: m.danger },
});
