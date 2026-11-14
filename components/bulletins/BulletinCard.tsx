import React, { useEffect, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  useSetBulletinLike, useSetBulletinReaction, useDeleteBulletin,
  getGetBulletinsQueryKey, getGetBulletinQueryKey, getGetBulletinLikesQueryKey, getGetBulletinReactionPeopleQueryKey,
  type Bulletin, type BulletinPhoto,
} from '@workspace/api-client-react';
import { F, tap } from '@/components/ui';
import { useCommunity } from '@/context/CommunityContext';
import { b, Avatar, BookCover, Sheet, SheetRow, ConfirmDelete, apiError, mediaUrl, timeAgo, goSignIn } from '@/components/bulletins/common';
import { ReactionPicker, ReactionBuckets, ReactionPeopleSheet, LikesSheet } from '@/components/bulletins/Reactions';
import { Composer } from '@/components/bulletins/Composer';

function Photo({ p }: { p: BulletinPhoto }) {
  const [ratio, setRatio] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const uri = mediaUrl(p.url);
  useEffect(() => {
    let live = true;
    Image.getSize(uri, (w, h) => { if (live && w && h) setRatio(w / h); }, () => {});
    return () => { live = false; };
  }, [uri]);
  if (failed) return <View style={[st.photo, st.photoFail]}><Feather name="image" size={22} color={b.muted} /><Text style={st.muted}>Fotoğraf yüklenemedi</Text></View>;
  return (
    <Image source={{ uri }} resizeMode="contain" accessibilityLabel="Bülten fotoğrafı" onError={() => setFailed(true)}
      onLoad={(e) => { const src = e.nativeEvent?.source; if (!ratio && src?.width && src?.height) setRatio(src.width / src.height); }}
      style={[st.photo, { aspectRatio: ratio ?? 4 / 3 }]} />
  );
}

export function BulletinCard({ post, onChange, onRemoved, detail }: { post: Bulletin; onChange?: (b: Bulletin) => void; onRemoved?: (id: string) => void; detail?: boolean }) {
  const qc = useQueryClient();
  const { userId } = useCommunity();
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [picker, setPicker] = useState(false);
  const [people, setPeople] = useState<string | null>(null);
  const [likes, setLikes] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const like = useSetBulletinLike();
  const react = useSetBulletinReaction();
  const del = useDeleteBulletin();
  const mine = post.reactions.find((r) => r.selected)?.emoji ?? null;

  const sync = (next: Bulletin) => {
    onChange?.(next);
    qc.setQueryData(getGetBulletinQueryKey(post.id), next);
    qc.invalidateQueries({ queryKey: getGetBulletinsQueryKey() });
  };
  const doLike = () => {
    if (!userId) return goSignIn();
    if (like.isPending) return;
    setErr(null);
    like.mutate({ id: post.id, data: { liked: !post.liked } }, {
      onSuccess: (next) => { sync(next); qc.invalidateQueries({ queryKey: getGetBulletinLikesQueryKey(post.id) }); },
      onError: (e) => setErr(apiError(e)),
    });
  };
  const doReact = (emoji: string | null) => {
    setErr(null);
    react.mutate({ data: { targetType: 'post', targetId: post.id, emoji } }, {
      onSuccess: (reactions) => {
        setPicker(false); sync({ ...post, reactions });
        qc.invalidateQueries({ queryKey: getGetBulletinReactionPeopleQueryKey({ targetId: post.id, targetType: 'post' }) });
      },
      onError: (e) => { setPicker(false); setErr(apiError(e)); },
    });
  };
  const openReact = () => { if (!userId) return goSignIn(); tap(); setPicker(true); };
  const doDelete = () => del.mutate({ id: post.id }, {
    onSuccess: () => {
      setConfirm(false); onRemoved?.(post.id);
      qc.removeQueries({ queryKey: getGetBulletinQueryKey(post.id) });
      qc.invalidateQueries({ queryKey: getGetBulletinsQueryKey() });
    },
    onError: (e) => { setConfirm(false); setErr(apiError(e, 'Bülten silinemedi.')); },
  });
  const open = () => { if (!detail) router.push({ pathname: '/bulletin/[id]', params: { id: post.id } }); };

  return (
    <Pressable testID={'bulletin-' + post.id} onLongPress={openReact} delayLongPress={350} onPress={detail ? undefined : open}
      accessibilityHint="Uzun basarak tepki ver" style={st.card}>
      <View style={st.head}>
        <Pressable testID={'bulletin-author-' + post.id} accessibilityRole="link" accessibilityLabel={post.author.nickname + ' profilini aç'} hitSlop={4}
          onPress={() => { tap(); router.push({ pathname: '/people/[id]', params: { id: post.author.id } } as never); }}
          style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Avatar person={post.author} size={42} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.name} numberOfLines={1}>{post.author.nickname}</Text>
          <Text style={st.muted}>{timeAgo(post.createdAt)}{post.updatedAt !== post.createdAt ? ' · düzenlendi' : ''}</Text>
        </View>
        </Pressable>
        {post.canEdit ? (
          <Pressable testID={'bulletin-menu-' + post.id} hitSlop={10} accessibilityRole="button" accessibilityLabel="Bülten seçenekleri" aria-expanded={menu}
            onPress={() => { tap(); setMenu(true); }} style={st.iconBtn}>
            <Feather name="more-horizontal" size={22} color={b.text} />
          </Pressable>
        ) : null}
      </View>
      {post.body ? <Text style={st.body} selectable>{post.body}</Text> : null}
      {post.photos.length ? <View style={{ gap: 8, marginTop: 10 }}>{post.photos.map((p) => <Photo key={p.id} p={p} />)}</View> : null}
      {post.book ? (
        <Pressable testID={'bulletin-book-' + post.book.id} accessibilityRole="link" accessibilityLabel={post.book.title + ', ' + post.book.author.nickname + ', kitabı aç'}
          onPress={() => { tap(); router.push({ pathname: '/authored-book/[id]', params: { id: post.book!.id } }); }}
          style={({ pressed }) => [st.book, { opacity: pressed ? 0.75 : 1 }]}>
          <BookCover title={post.book.title} author={post.book.author.nickname} w={62} />
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={st.kicker}>KENDİ KİTABI</Text>
            <Text style={st.bookTitle} numberOfLines={2}>{post.book.title}</Text>
            <Text style={st.muted} numberOfLines={1}>{post.book.author.nickname}</Text>
            <Text style={st.bookExcerpt} numberOfLines={2}>{post.book.body}</Text>
          </View>
          <Feather name="chevron-right" size={20} color={b.gold} />
        </Pressable>
      ) : null}
      <ReactionBuckets reactions={post.reactions} onBucket={(e) => setPeople(e)} />
      {err ? <Text style={st.err} accessibilityLiveRegion="polite">{err}</Text> : null}
      <View style={st.actions}>
        <View style={st.likeGroup}>
          <Pressable testID={'like-' + post.id} disabled={like.isPending} aria-disabled={like.isPending} aria-pressed={post.liked} accessibilityRole="button"
            accessibilityLabel={post.liked ? 'Beğeniyi geri al' : 'Beğen'} accessibilityState={{ selected: post.liked, disabled: like.isPending }}
            onPress={() => { tap(); doLike(); }} hitSlop={6} style={({ pressed }) => [st.action, { opacity: like.isPending ? 0.5 : pressed ? 0.6 : 1 }]}>
            <MaterialCommunityIcons name={post.liked ? 'heart' : 'heart-outline'} size={21} color={post.liked ? b.danger : b.text} />
          </Pressable>
          <Pressable testID={'like-count-' + post.id} accessibilityRole="button" accessibilityLabel={post.likeCount + ' beğeni, beğenenleri gör'}
            onPress={() => { tap(); setLikes(true); }} hitSlop={6} style={st.countBtn}>
            <Text style={st.count}>{post.likeCount}</Text>
          </Pressable>
        </View>
        <Pressable testID={'comments-' + post.id} accessibilityRole="button" accessibilityLabel={post.commentCount + ' yorum, yorumları aç'}
          onPress={() => { tap(); router.push({ pathname: '/bulletin/[id]', params: { id: post.id } }); }} style={st.action} hitSlop={6}>
          <MaterialCommunityIcons name="comment-outline" size={20} color={b.text} />
          <Text style={st.count}>{post.commentCount}</Text>
        </Pressable>
        <Pressable testID={'react-' + post.id} accessibilityRole="button" accessibilityLabel={mine ? 'Tepkin ' + mine + ', değiştir' : 'Tepki ver'}
          aria-expanded={picker} onPress={openReact} style={st.action} hitSlop={6}>
          {mine ? <Text style={{ fontSize: 18 }}>{mine}</Text> : <MaterialCommunityIcons name="emoticon-happy-outline" size={20} color={b.text} />}
          <Text style={st.count}>Tepki</Text>
        </Pressable>
      </View>

      <Sheet visible={menu} onClose={() => setMenu(false)} title="Bültenin">
        <SheetRow icon="edit-2" label="Düzenle" testID="bulletin-edit" onPress={() => { setMenu(false); setEditing(true); }} />
        <SheetRow icon="trash-2" label="Sil" danger testID="bulletin-delete" onPress={() => { setMenu(false); setConfirm(true); }} />
      </Sheet>
      <ConfirmDelete visible={confirm} busy={del.isPending} onCancel={() => setConfirm(false)} onConfirm={doDelete} text="Bu bülten herkesten silinecek. Bu işlem geri alınamaz." />
      <ReactionPicker visible={picker} onClose={() => setPicker(false)} current={mine} onPick={doReact} busy={react.isPending} />
      <ReactionPeopleSheet target={people ? { id: post.id, type: 'post' } : null} emoji={people} onClose={() => setPeople(null)} />
      <LikesSheet postId={likes ? post.id : null} onClose={() => setLikes(false)} />
      <Modal visible={editing} animationType="slide" onRequestClose={() => setEditing(false)}>
        <ScrollView style={{ flex: 1, backgroundColor: b.background }} contentContainerStyle={{ padding: 16, paddingTop: 60 }} keyboardShouldPersistTaps="handled">
          <Text style={st.editTitle}>Bülteni düzenle</Text>
          {editing ? <Composer editing={post} onDone={(next) => { setEditing(false); if (next) sync(next); }} /> : null}
        </ScrollView>
      </Modal>
    </Pressable>
  );
}

const st = StyleSheet.create({
  card: { backgroundColor: b.card, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: b.border, marginBottom: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { fontFamily: F.serifBold, fontSize: 16, color: b.text },
  muted: { fontFamily: F.body, fontSize: 12, color: b.muted },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  body: { fontFamily: F.body, fontSize: 15, lineHeight: 23, color: b.text, marginTop: 10 },
  photo: { width: '100%', borderRadius: 12, backgroundColor: b.input },
  photoFail: { aspectRatio: 3, alignItems: 'center', justifyContent: 'center', gap: 4 },
  book: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12, padding: 10, borderRadius: 14, backgroundColor: b.background, borderWidth: 1, borderColor: b.gold },
  kicker: { fontFamily: F.semi, fontSize: 10, letterSpacing: 1.2, color: b.gold },
  bookTitle: { fontFamily: F.serifBold, fontSize: 16, color: b.text },
  bookExcerpt: { fontFamily: F.body, fontSize: 12, lineHeight: 17, color: b.muted },
  err: { color: b.danger, fontFamily: F.med, fontSize: 13, marginTop: 8 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderColor: b.border, paddingTop: 6 },
  likeGroup: { flexDirection: 'row', alignItems: 'center' },
  action: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 40, paddingHorizontal: 6 },
  countBtn: { minHeight: 40, minWidth: 28, justifyContent: 'center', paddingHorizontal: 4 },
  count: { fontFamily: F.semi, fontSize: 13, color: b.text },
  editTitle: { fontFamily: F.serifBold, fontSize: 22, color: b.text, marginBottom: 12 },
});
