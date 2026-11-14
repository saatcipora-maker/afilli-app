import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useGetWriterLibrary, getGetWriterLibraryQueryKey, useGetAuthoredBooks, getGetAuthoredBooksQueryKey, getAuthoredBook, type AuthoredBook } from '@workspace/api-client-react';
import { F, tap } from '@/components/ui';
import { useCommunity } from '@/context/CommunityContext';
import { scoped, actorRequest, useOwnerGuard } from '@/components/profile/hooks';
import { b, Sheet, Btn, BookCover, apiError, mediaUrl, OFFLINE } from '@/components/bulletins/common';
import { WriterCover } from '@/components/writer/parts';

/**
 * Only the signed-in author's own server books. Published ones can be shared;
 * drafts point to Kitap Yaz and are NEVER published by attaching them.
 */
export function BookPicker({ visible, onClose, onSelect }: { visible: boolean; onClose: () => void; onSelect: (book: AuthoredBook) => void }) {
  const { userId, ready } = useCommunity();
  const guard = useOwnerGuard(userId);
  const on = visible && ready && !!userId;
  const lib = useGetWriterLibrary({ query: { enabled: on, queryKey: scoped(getGetWriterLibraryQueryKey(), userId) }, request: actorRequest(userId) });
  const legacy = useGetAuthoredBooks({ query: { enabled: on, queryKey: scoped(getGetAuthoredBooksQueryKey(), userId) }, request: actorRequest(userId) });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const books = lib.data ?? [];
  const known = new Set(books.map((x) => x.id));
  // Previously shared legacy books (grandfathered by the server) that are not in the writer library.
  const older = (legacy.data ?? []).filter((x) => !known.has(x.id) && x.published !== false);
  const published = books.filter((x) => x.publication === 'published');
  const drafts = books.filter((x) => x.publication !== 'published');

  const pick = async (id: string) => {
    if (!userId) return;
    setBusy(id); setErr(null);
    try { const book = await getAuthoredBook(id, actorRequest(userId)); if (guard()) onSelect(book); }
    catch (e) { if (guard()) setErr(apiError(e, 'Kitap alınamadı.')); } finally { setBusy(null); }
  };
  const write = (id?: string) => { onClose(); router.navigate(id ? { pathname: '/write', params: { book: id } } : '/write'); };
  const loading = lib.isLoading || legacy.isLoading;

  return (
    <Sheet visible={visible} onClose={onClose} title="Kendi Yazdığın Kitaplar" testID="book-picker">
      {!userId ? <Text style={st.muted}>Kitap paylaşmak için giriş yapmalısın.</Text> : null}
      {err ? <Text style={st.err}>{err}</Text> : null}
      {loading ? <ActivityIndicator color={b.gold} style={{ margin: 16 }} /> : lib.isError ? (
        <View style={{ gap: 8, marginBottom: 10 }}><Text style={st.err}>{apiError(lib.error, OFFLINE)}</Text><Btn label="Tekrar dene" ghost onPress={() => { void lib.refetch(); void legacy.refetch(); }} /></View>
      ) : null}
      {published.map((x) => (
        <Pressable key={x.id} testID={'pick-book-' + x.id} disabled={!!busy} accessibilityRole="button" accessibilityLabel={x.title + ' kitabını seç'}
          onPress={() => { tap(); void pick(x.id); }} style={({ pressed }) => [st.row, { opacity: busy && busy !== x.id ? 0.4 : pressed ? 0.6 : 1 }]}>
          <WriterCover uri={x.coverUrl ? mediaUrl(x.coverUrl) : null} title={x.title} w={44} />
          <View style={{ flex: 1 }}><Text style={st.title} numberOfLines={2}>{x.title || 'Adsız kitap'}</Text><Text style={st.muted}>Yayında · {x.chapterCount} bölüm</Text></View>
          {busy === x.id ? <ActivityIndicator color={b.gold} /> : <Feather name="plus-circle" size={20} color={b.gold} />}
        </Pressable>
      ))}
      {older.map((x) => (
        <Pressable key={x.id} testID={'pick-book-' + x.id} accessibilityRole="button" accessibilityLabel={x.title + ' kitabını seç'}
          onPress={() => { tap(); onSelect(x); }} style={({ pressed }) => [st.row, { opacity: pressed ? 0.6 : 1 }]}>
          <BookCover title={x.title} author={x.author.nickname} w={44} />
          <View style={{ flex: 1 }}><Text style={st.title} numberOfLines={2}>{x.title}</Text><Text style={st.muted}>Daha önce paylaşılmış</Text></View>
          <Feather name="plus-circle" size={20} color={b.gold} />
        </Pressable>
      ))}
      {drafts.length ? <Text style={st.section}>Taslaklar (paylaşılamaz)</Text> : null}
      {drafts.map((x) => (
        <Pressable key={x.id} testID={'pick-draft-' + x.id} accessibilityRole="button" accessibilityLabel={(x.title || 'Adsız kitap') + ' taslağını Kitap Yaz sayfasında aç'}
          onPress={() => { tap(); write(x.id); }} style={({ pressed }) => [st.row, { opacity: pressed ? 0.6 : 0.85 }]}>
          <WriterCover uri={x.coverUrl ? mediaUrl(x.coverUrl) : null} title={x.title} w={44} />
          <View style={{ flex: 1 }}><Text style={st.title} numberOfLines={2}>{x.title || 'Adsız kitap'}</Text><Text style={st.muted}>Taslak. Paylaşmak için önce Kitap Yaz'da yayınla.</Text></View>
          <Feather name="edit-3" size={18} color={b.muted} />
        </Pressable>
      ))}
      {userId && !loading && !lib.isError && published.length + older.length + drafts.length === 0 ? (
        <View style={st.empty}>
          <Feather name="feather" size={28} color={b.gold} />
          <Text style={st.title}>Henüz kendi kitabın yok</Text>
          <Text style={[st.muted, { textAlign: 'center' }]}>Sadece kendi yazdığın ve yayınladığın kitapları paylaşabilirsin.</Text>
          <Btn label="Kitap Yaz" icon="edit-3" testID="book-picker-write" onPress={() => write()} />
        </View>
      ) : null}
      <Text style={st.note}>Cihazında kalan veya misafirken yazılan taslaklar burada görünmez. Kitap Yaz'da açıp hesabına aktar ve yayınla.</Text>
    </Sheet>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: b.border },
  title: { fontFamily: F.serifBold, fontSize: 15, color: b.text },
  muted: { fontFamily: F.body, fontSize: 12, color: b.muted },
  section: { fontFamily: F.semi, fontSize: 11, letterSpacing: 1, color: b.gold, marginTop: 14, textTransform: 'uppercase' },
  err: { color: b.danger, fontFamily: F.med, fontSize: 13, marginBottom: 8 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 18 },
  note: { fontFamily: F.body, fontSize: 12, lineHeight: 17, color: b.muted, marginTop: 14, padding: 10, borderRadius: 10, backgroundColor: b.background },
});
