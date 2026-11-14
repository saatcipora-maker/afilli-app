import React, { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { useGetAuthoredBookComments, getGetAuthoredBookCommentsQueryKey, addAuthoredBookComment, type WriterComment } from '@workspace/api-client-react';
import { F } from '@/components/ui';
import { Avatar, Btn, apiError, goSignIn } from '@/components/bulletins/common';
import { scoped, actorRequest, useOwnerGuard } from '@/components/profile/hooks';
import { useCommunity } from '@/context/CommunityContext';
import { W } from '@/components/writer/parts';

export function BookComments({ bookId, chapterId, chapterTitle, onCount }: { bookId: string; chapterId: string | null; chapterTitle: string | null; onCount: () => void }) {
  const { userId, ready } = useCommunity();
  const guard = useOwnerGuard(userId);
  const qc = useQueryClient();
  const key = scoped(getGetAuthoredBookCommentsQueryKey(bookId), userId);
  const q = useGetAuthoredBookComments(bookId, { query: { enabled: ready && !!bookId, queryKey: key }, request: actorRequest(userId) });
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const clientId = useRef(randomUUID());
  const send = async () => {
    const t = body.trim();
    if (!t || !userId || busy) return;
    setBusy(true); setErr(null);
    try {
      const c = await addAuthoredBookComment(bookId, { clientId: clientId.current, body: t, chapterId }, actorRequest(userId));
      if (!guard()) return;
      qc.setQueryData<WriterComment[]>(key, (old) => old ? (old.some((x) => x.id === c.id) ? old : [...old, c]) : [c]);
      clientId.current = randomUUID(); setBody(''); onCount();
    } catch (e) { if (guard()) setErr(apiError(e, 'Yorum gönderilemedi. Metnin duruyor.')); }
    finally { setBusy(false); }
  };
  const list = q.data ?? [];
  return (
    <View style={cm.wrap} testID="book-comments">
      <Text style={cm.h} accessibilityRole="header">Yorumlar <Text style={cm.n}>{list.length}</Text></Text>
      {q.isLoading ? <ActivityIndicator color={W.gold} /> : q.isError ? (
        <View style={{ gap: 8 }}><Text style={cm.err}>{apiError(q.error, 'Yorumlar yüklenemedi.')}</Text><Btn label="Tekrar dene" ghost onPress={() => void q.refetch()} /></View>
      ) : list.length === 0 ? <Text style={cm.empty}>İlk yorumu sen yaz. Yazar okurlarını duymayı sever.</Text> : list.map((c) => (
        <View key={c.id} style={cm.row}>
          <Avatar person={c.author} size={32} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={cm.name}>{c.author.nickname} <Text style={cm.meta}>· {new Date(c.createdAt).toLocaleDateString('tr-TR')}</Text></Text>
            <Text style={cm.body} selectable>{c.body}</Text>
          </View>
        </View>
      ))}
      {userId ? (
        <View style={{ gap: 8, marginTop: 8 }}>
          <TextInput testID="comment-input" value={body} onChangeText={setBody} maxLength={3000} multiline placeholder={chapterTitle ? chapterTitle + ' hakkında ne düşündün?' : 'Ne düşündün?'}
            placeholderTextColor={W.muted} style={cm.input} accessibilityLabel="Yorum yaz" />
          {err ? <Text style={cm.err}>{err}</Text> : null}
          <Btn label="Gönder" icon="send" testID="comment-send" busy={busy} disabled={!body.trim()} onPress={() => void send()} />
        </View>
      ) : <Btn label="Yorum yazmak için giriş yap" ghost onPress={goSignIn} style={{ marginTop: 8 }} />}
    </View>
  );
}

const cm = StyleSheet.create({
  wrap: { marginTop: 18, padding: 16, borderRadius: 18, backgroundColor: W.paper, borderWidth: 1, borderColor: W.line, gap: 12 },
  h: { fontFamily: F.serifBold, fontSize: 19, color: W.ink },
  n: { fontFamily: F.body, fontSize: 14, color: W.muted },
  row: { flexDirection: 'row', gap: 10 },
  name: { fontFamily: F.semi, fontSize: 13.5, color: W.ink },
  meta: { fontFamily: F.body, fontSize: 11.5, color: W.muted },
  body: { fontFamily: F.body, fontSize: 14, lineHeight: 20, color: W.ink },
  empty: { fontFamily: F.body, fontSize: 13, color: W.muted },
  err: { fontFamily: F.med, fontSize: 13, color: W.danger },
  input: { minHeight: 70, fontFamily: F.body, fontSize: 14, color: W.ink, backgroundColor: W.cream, borderRadius: 12, padding: 12, textAlignVertical: 'top' },
});
