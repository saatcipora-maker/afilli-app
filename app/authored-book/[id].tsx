import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useGetAuthoredBook, getGetAuthoredBookQueryKey, useGetWriterBook, getGetWriterBookQueryKey, setAuthoredBookLike, type AuthoredBook, type WriterChapter } from '@workspace/api-client-react';
import { F, tap } from '@/components/ui';
import { MagazineScrollView } from '@/components/MagazineUI';
import { TopBar } from '@/components/bulletins/TopBar';
import { Avatar, Btn, apiError, goSignIn, OFFLINE } from '@/components/bulletins/common';
import { scoped, actorRequest, withIdentity, useOwnerGuard, compactCount } from '@/components/profile/hooks';
import { useCommunity } from '@/context/CommunityContext';
import { W, WriterCover, useCoverUri, Banner, Skeleton, FadeIn } from '@/components/writer/parts';
import { HtmlView } from '@/components/writer/HtmlView';
import { BookComments } from '@/components/writer/BookComments';
import { chapterStats, escapeHtml, AGE_LABEL } from '@/lib/writer-text';

function Reader() {
  const { id, preview } = useLocalSearchParams<{ id: string; preview?: string }>();
  const bookId = String(id ?? '');
  const { userId, ready } = useCommunity();
  const guard = useOwnerGuard(userId);
  const qc = useQueryClient();
  const key = scoped(getGetAuthoredBookQueryKey(bookId), userId);
  const q = useGetAuthoredBook(bookId, { query: { enabled: ready && !!bookId, queryKey: key, retry: 1 }, request: actorRequest(userId) });
  const notFound = (q.error as { status?: number } | null)?.status === 404;
  const wantPreview = !!userId && (preview === '1' || notFound);
  const w = useGetWriterBook(bookId, { query: { enabled: ready && wantPreview, queryKey: scoped(getGetWriterBookQueryKey(bookId), userId), retry: false }, request: actorRequest(userId) });
  const draft = wantPreview && w.data ? w.data : null;
  const book = q.data;
  const [idx, setIdx] = useState(0);
  const [night, setNight] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);
  const [likeErr, setLikeErr] = useState<string | null>(null);

  const chapters: WriterChapter[] = useMemo(() => {
    if (draft) return draft.document.chapters;
    if (!book) return [];
    const pub = (book.chapters ?? []).filter((c) => c.status === 'published');
    if (pub.length) return pub;
    if (book.body?.trim()) return [{ id: 'legacy', title: book.title, status: 'published', html: book.body.split(/\n{2,}/).map((p) => '<p>' + escapeHtml(p).replace(/\n/g, '<br>') + '</p>').join('') }];
    return [];
  }, [draft, book]);
  const ch = chapters[Math.min(idx, Math.max(0, chapters.length - 1))];
  const meta = draft ? { title: draft.document.title, description: draft.document.description, genres: draft.document.genres as string[], age: draft.document.ageRating, completion: draft.document.completion, lang: draft.document.language }
    : book ? { title: book.title, description: book.description ?? '', genres: book.genres ?? [], age: book.ageRating ?? 'all', completion: book.completion ?? 'ongoing', lang: book.language ?? 'Türkçe' } : null;
  const cover = useCoverUri(draft ? draft.document.cover : book?.coverUrl ?? null, null, draft ? 'private' : 'published');
  const stats = useMemo(() => chapters.reduce((a, c) => { const s = chapterStats(c.html); return { words: a.words + s.words, minutes: a.minutes + s.minutes }; }, { words: 0, minutes: 0 }), [chapters]);

  const like = async () => {
    if (!book || !userId) { goSignIn(); return; }
    setLikeBusy(true); setLikeErr(null);
    try {
      const next = await setAuthoredBookLike(bookId, { liked: !book.liked }, actorRequest(userId));
      if (guard()) qc.setQueryData<AuthoredBook>(key, next);
    } catch (e) { if (guard()) setLikeErr(apiError(e, 'Beğeni kaydedilemedi.')); } finally { setLikeBusy(false); }
  };
  const bg = night ? W.night : W.cream;
  const loading = !ready || q.isLoading || (wantPreview && w.isLoading);

  return (
    <View style={{ flex: 1, backgroundColor: bg }}>
      <TopBar title={draft ? 'Taslak önizleme' : 'Kitap'} backTo="/library" icons={false} />
      <MagazineScrollView contentContainerStyle={st.wrap}>
        {loading ? <View style={{ gap: 12 }}><Skeleton h={260} /><Skeleton h={400} /></View>
          : !meta ? (
            <View style={st.empty}>
              <Feather name="book" size={28} color={W.danger} />
              <Text style={st.title}>{notFound ? 'Bu kitap bulunamadı ya da yayında değil.' : apiError(q.error, OFFLINE)}</Text>
              <Btn label="Tekrar dene" icon="refresh-cw" onPress={() => { void q.refetch(); if (wantPreview) void w.refetch(); }} />
            </View>
          ) : (
            <FadeIn>
              {draft ? <Banner icon="eye-off" tone="info" title="Taslak önizleme" text="Bunu yalnızca sen görüyorsun. Okurlar yalnızca yayınladığın bölümleri görür." >
                <Btn label="Düzenle" icon="edit-3" ghost onPress={() => router.push({ pathname: '/write', params: { book: bookId } })} /></Banner> : null}
              <View style={st.hero}>
                <WriterCover uri={cover} title={meta.title} author={draft ? undefined : book?.author.nickname} w={150} adult={meta.age === '18'} completed={meta.completion === 'completed'} />
                <Text style={[st.title, night && { color: '#EADBC4' }]} accessibilityRole="header">{meta.title || 'Adsız kitap'}</Text>
                {book && !draft ? <View style={st.byline}><Avatar person={book.author} size={26} /><Text style={[st.author, night && { color: '#EADBC4' }]}>{book.author.nickname}</Text></View> : null}
                <Text style={st.meta}>{[...meta.genres, AGE_LABEL[meta.age] ?? meta.age, meta.lang, meta.completion === 'completed' ? 'Tamamlandı' : 'Devam ediyor'].join(' · ')}</Text>
                <Text style={st.meta}>{chapters.length} bölüm · {stats.words.toLocaleString('tr-TR')} kelime · {stats.minutes} dk</Text>
                {meta.description ? <Text style={[st.desc, night && { color: '#EADBC4' }]}>{meta.description}</Text> : null}
                {book && !draft ? (
                  <View style={st.actions}>
                    <Pressable testID="book-like" accessibilityRole="button" accessibilityState={{ selected: !!book.liked, busy: likeBusy }} accessibilityLabel={book.liked ? 'Beğeniyi geri al' : 'Beğen'}
                      disabled={likeBusy} onPress={() => { tap(); void like(); }} style={({ pressed }) => [st.likeBtn, book.liked && st.likeOn, pressed && { opacity: 0.7 }]}>
                      <Feather name="heart" size={16} color={book.liked ? W.paper : W.ink} />
                      <Text style={[st.likeText, book.liked && { color: W.paper }]}>{compactCount(book.likeCount ?? 0)}</Text>
                    </Pressable>
                    <View style={st.stat}><Feather name="eye" size={15} color={W.muted} /><Text style={st.meta}>{compactCount(book.readCount ?? 0)}</Text></View>
                    <View style={st.stat}><Feather name="message-circle" size={15} color={W.muted} /><Text style={st.meta}>{compactCount(book.commentCount ?? 0)}</Text></View>
                    {book.canEdit ? <Btn label="Düzenle" icon="edit-3" ghost onPress={() => router.push({ pathname: '/write', params: { book: bookId } })} /> : null}
                  </View>
                ) : null}
                {likeErr ? <Text style={st.err}>{likeErr}</Text> : null}
              </View>

              {chapters.length > 1 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                  {chapters.map((c, i) => (
                    <Pressable key={c.id} testID={'read-chapter-' + i} accessibilityRole="tab" accessibilityState={{ selected: i === idx }} onPress={() => { tap(); setIdx(i); }}
                      style={[st.tab, i === idx && st.tabOn]}>
                      <Text style={[st.tabText, i === idx && { color: W.paper }]} numberOfLines={1}>{i + 1}. {c.title}{draft && c.status === 'draft' ? ' (taslak)' : ''}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              ) : null}

              <View style={[st.page, night && { backgroundColor: '#2A1F15', borderColor: '#3A2C1F' }]}>
                <View style={st.pageHead}>
                  <Text style={[st.chTitle, night && { color: '#EADBC4' }]}>{ch?.title ?? ''}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel={night ? 'Gündüz modu' : 'Gece modu'} hitSlop={8} onPress={() => setNight(!night)}>
                    <Feather name={night ? 'sun' : 'moon'} size={18} color={night ? '#EADBC4' : W.ink} />
                  </Pressable>
                </View>
                {ch && (!chapterStats(ch.html).empty || /<img\b/i.test(ch.html)) ? <HtmlView html={ch.html} night={night} owner={userId} privatePreview={!!draft} />
                  : <Text style={st.meta}>Bu bölümde henüz metin yok.</Text>}
                {chapters.length > 1 ? (
                  <View style={st.nav}>
                    <Btn label="Önceki" icon="chevron-left" ghost disabled={idx === 0} onPress={() => setIdx(idx - 1)} style={{ flex: 1 }} />
                    <Btn label="Sonraki" icon="chevron-right" ghost disabled={idx >= chapters.length - 1} onPress={() => setIdx(idx + 1)} style={{ flex: 1 }} />
                  </View>
                ) : null}
              </View>
              {book && !draft ? <BookComments bookId={bookId} chapterId={ch && ch.id !== 'legacy' ? ch.id : null} chapterTitle={ch?.title ?? null}
                onCount={() => qc.setQueryData<AuthoredBook>(key, (o) => o ? { ...o, commentCount: (o.commentCount ?? 0) + 1 } : o)} /> : null}
            </FadeIn>
          )}
      </MagazineScrollView>
    </View>
  );
}
export default withIdentity(Reader);

const st = StyleSheet.create({
  wrap: { padding: 16, paddingBottom: 60, maxWidth: 720, width: '100%', alignSelf: 'center' },
  empty: { alignItems: 'center', gap: 12, padding: 28, backgroundColor: W.paper, borderRadius: 18 },
  hero: { alignItems: 'center', gap: 8, paddingVertical: 18 },
  title: { fontFamily: F.serifBold, fontSize: 25, color: W.ink, textAlign: 'center', marginTop: 8 },
  byline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  author: { fontFamily: F.semi, fontSize: 14, color: W.ink },
  meta: { fontFamily: F.body, fontSize: 12, color: W.muted, textAlign: 'center' },
  desc: { fontFamily: F.body, fontSize: 14, lineHeight: 21, color: W.ink, textAlign: 'center', marginTop: 4, maxWidth: 520 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 6 },
  likeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 38, borderRadius: 19, borderWidth: 1, borderColor: W.border, backgroundColor: W.paper },
  likeOn: { backgroundColor: W.danger, borderColor: W.danger },
  likeText: { fontFamily: F.semi, fontSize: 13, color: W.ink },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  err: { fontFamily: F.med, fontSize: 12.5, color: W.danger },
  tab: { paddingHorizontal: 12, height: 34, borderRadius: 17, backgroundColor: W.paper, borderWidth: 1, borderColor: W.line, justifyContent: 'center', maxWidth: 220 },
  tabOn: { backgroundColor: W.ink, borderColor: W.ink },
  tabText: { fontFamily: F.med, fontSize: 12.5, color: W.ink },
  page: { marginTop: 12, backgroundColor: W.paper, borderRadius: 18, padding: 20, borderWidth: 1, borderColor: W.line },
  pageHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  chTitle: { flex: 1, fontFamily: F.serifBold, fontSize: 20, color: W.ink },
  nav: { flexDirection: 'row', gap: 10, marginTop: 18 },
});
