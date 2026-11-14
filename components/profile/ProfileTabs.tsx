import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useGetProfileContent, getGetProfileContentQueryKey, type ProfileBook } from '@workspace/api-client-react';
import { F, tap } from '@/components/ui';
import { BookCover, mediaUrl } from '@/components/bulletins/common';
import { BulletinCard } from '@/components/bulletins/BulletinCard';
import { useCommunity } from '@/context/CommunityContext';
import { FoilButton, P, PillTabs, S, Skeleton, StateCard } from './kit';
import { go, scoped } from './hooks';

export type ContentTab = 'books' | 'bulletins' | 'liked';
const TABS: { key: ContentTab; label: string }[] = [
  { key: 'books', label: 'Kitaplarım' }, { key: 'bulletins', label: 'Bültenler' }, { key: 'liked', label: 'Beğenilenler' },
];

function BookCard({ book }: { book: ProfileBook }) {
  const meta = [book.genre, book.year ? String(book.year) : null].filter(Boolean).join(' • ');
  return (
    <Pressable testID={'profile-book-' + book.id} accessibilityRole="link" accessibilityLabel={book.title + ', kitabı aç'}
      onPress={() => { tap(); go('/authored-book/' + book.id); }} style={({ pressed }) => [st.book, { transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
      <View style={st.coverBox}>
        {book.cover ? <Image source={{ uri: mediaUrl(book.cover) }} style={st.coverImg} resizeMode="cover" /> : <BookCover title={book.title} author={book.author.nickname} w={132} />}
        <View style={st.ribbon}><MaterialCommunityIcons name="bookmark" size={22} color={S.foilMid} /></View>
        {!book.isPublic ? <View style={st.private}><Text style={st.privateText}>Gizli</Text></View> : null}
      </View>
      <Text style={st.bookTitle} numberOfLines={2}>{book.title}</Text>
      <Text style={st.meta} numberOfLines={1}>{meta || 'Tür ve yıl belirtilmemiş'}</Text>
      <Text style={st.reads}>{book.readCount} okuma</Text>
    </Pressable>
  );
}

function ContentPage({ id, tab, cursor, isFirst, isLast, onNext, isMe }: { id: string; tab: ContentTab; cursor?: string; isFirst: boolean; isLast: boolean; onNext: (c: string) => void; isMe: boolean }) {
  const { ready, userId } = useCommunity();
  const params = cursor ? { tab, cursor } : { tab };
  const q = useGetProfileContent(id, params, { query: { enabled: ready && !!id, queryKey: scoped(getGetProfileContentQueryKey(id, params), userId) } });
  if (q.isLoading) return <View style={st.grid}>{[0, 1].map((i) => <Skeleton key={i} w="47%" h={220} r={14} />)}</View>;
  if (q.isError || !q.data) return <StateCard testID="profile-content-error" icon="wifi-off" title="İçerik yüklenemedi" text="İnternet bağlantısı yok, tekrar dene." action={{ label: 'Tekrar dene', onPress: () => q.refetch(), testID: 'profile-content-retry' }} />;
  const { books, bulletins, nextCursor } = q.data;
  const empty = tab === 'books' ? books.length === 0 : bulletins.length === 0;
  if (isFirst && empty) {
    const copy = {
      books: isMe ? ['Rafın seni bekliyor', 'İlk kitabını yaz; okurların seni kelimelerinden tanısın.'] : ['Henüz yayımlanmış kitap yok', 'Bu yazarın yayımladığı kitaplar burada görünecek.'],
      bulletins: isMe ? ['Henüz bülten paylaşmadın', 'Okurlarına kısa bir not bırak.'] : ['Henüz bülten yok', 'Bu yazarın paylaştığı bültenler burada görünecek.'],
      liked: ['Beğenilen bülten yok', 'Beğenilen bültenler burada toplanır.'],
    }[tab];
    const action = isMe && tab === 'books' ? { label: 'Kitap Yaz', icon: 'feather' as const, testID: 'profile-empty-write', onPress: () => go('/write') }
      : isMe && tab === 'bulletins' ? { label: 'Bülten paylaş', icon: 'edit-3' as const, testID: 'profile-empty-bulletin', onPress: () => go('/bultenler') } : undefined;
    return <StateCard testID={'profile-empty-' + tab} icon={tab === 'books' ? 'book' : tab === 'liked' ? 'heart' : 'file-text'} title={copy[0]} text={copy[1]} action={action} />;
  }
  return (
    <View>
      {tab === 'books' ? <View style={st.grid}>{books.map((b) => <BookCard key={b.id} book={b} />)}</View>
        : <View style={{ paddingHorizontal: 12 }}>{bulletins.map((b) => <BulletinCard key={b.id} post={b} />)}</View>}
      {isLast && nextCursor ? <View style={{ paddingHorizontal: 18, paddingTop: 6 }}><FoilButton variant="outline" label="Daha fazla göster" testID={'profile-more-' + tab} onPress={() => onNext(nextCursor)} style={{ flex: 0 }} /></View> : null}
    </View>
  );
}

export function ProfileTabs({ profileId, isMe, tab, onTab }: { profileId: string; isMe: boolean; tab: ContentTab; onTab: (t: ContentTab) => void }) {
  const [cursors, setCursors] = useState<Record<ContentTab, (string | undefined)[]>>({ books: [undefined], bulletins: [undefined], liked: [undefined] });
  const list = cursors[tab];
  return (
    <View style={{ marginTop: 22, gap: 14 }}>
      <PillTabs tabs={TABS} value={tab} onChange={onTab} />
      {list.map((c, i) => (
        <ContentPage key={tab + (c ?? 'first')} id={profileId} tab={tab} cursor={c} isFirst={i === 0} isLast={i === list.length - 1} isMe={isMe}
          onNext={(n) => setCursors((p) => ({ ...p, [tab]: [...p[tab], n] }))} />
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 18, paddingHorizontal: 18 },
  book: { width: '47%', gap: 4 },
  coverBox: { alignItems: 'center', borderRadius: 12, overflow: 'hidden', backgroundColor: P.card, borderWidth: 1, borderColor: P.border, paddingVertical: 10 },
  coverImg: { width: '100%', aspectRatio: 2 / 3, marginVertical: -10 },
  ribbon: { position: 'absolute', top: 0, right: 8 },
  private: { position: 'absolute', left: 8, top: 8, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, backgroundColor: P.card, borderWidth: 1, borderColor: P.border },
  privateText: { fontFamily: F.semi, fontSize: 10, color: P.muted },
  bookTitle: { fontFamily: F.serifBold, fontSize: 15, color: P.text, marginTop: 6 },
  meta: { fontFamily: F.body, fontSize: 12, color: P.muted },
  reads: { fontFamily: F.med, fontSize: 12, color: S.foilDeep },
});
