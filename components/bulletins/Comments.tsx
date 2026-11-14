import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetBulletinComments, getGetBulletinCommentsQueryKey, getGetBulletinQueryKey, getGetBulletinsQueryKey, getGetBulletinReactionPeopleQueryKey,
  useCreateBulletinComment, useUpdateBulletinComment, useDeleteBulletinComment, useSetBulletinReaction, type BulletinComment,
} from '@workspace/api-client-react';
import { F, tap } from '@/components/ui';
import { useCommunity } from '@/context/CommunityContext';
import { b, Avatar, Btn, ConfirmDelete, apiError, timeAgo, goSignIn, OFFLINE } from '@/components/bulletins/common';
import { ReactionPicker, ReactionBuckets, ReactionPeopleSheet } from '@/components/bulletins/Reactions';

function useRefresh(postId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: getGetBulletinCommentsQueryKey(postId) });
    qc.invalidateQueries({ queryKey: getGetBulletinQueryKey(postId) });
    qc.invalidateQueries({ queryKey: getGetBulletinsQueryKey() });
  };
}

export function CommentInput({ postId, parentId, placeholder, initial, onDone, autoFocus, testID }: {
  postId: string; parentId?: string | null; placeholder: string; initial?: { id: string; body: string }; onDone?: () => void; autoFocus?: boolean; testID: string;
}) {
  const { userId } = useCommunity();
  const refresh = useRefresh(postId);
  const create = useCreateBulletinComment();
  const update = useUpdateBulletinComment();
  const [text, setText] = useState(initial?.body ?? '');
  const [err, setErr] = useState<string | null>(null);
  const pending = create.isPending || update.isPending;
  const send = () => {
    if (!userId) return goSignIn();
    const body = text.trim();
    if (!body) return setErr('Boş yorum gönderilemez.');
    if (pending) return;
    setErr(null);
    const opts = { onSuccess: () => { setText(''); refresh(); onDone?.(); }, onError: (e: unknown) => setErr(apiError(e, OFFLINE)) };
    if (initial) update.mutate({ id: initial.id, data: { body } }, opts);
    else create.mutate({ id: postId, data: { body, parentId: parentId ?? null } }, opts);
  };
  return (
    <View style={{ marginTop: 8 }}>
      <View style={st.inputRow}>
        <TextInput testID={testID + '-input'} value={text} onChangeText={(t) => { setErr(null); setText(t); }} maxLength={1000} multiline autoFocus={autoFocus}
          onFocus={() => { if (!userId) goSignIn(); }} placeholder={placeholder} placeholderTextColor={b.muted} style={st.input} editable={!pending} accessibilityLabel={placeholder} />
        <Pressable testID={testID + '-send'} disabled={pending} aria-disabled={pending} accessibilityRole="button" accessibilityLabel={initial ? 'Kaydet' : 'Gönder'}
          onPress={() => { tap(); send(); }} style={({ pressed }) => [st.send, { opacity: pending ? 0.5 : pressed ? 0.7 : 1 }]}>
          {pending ? <ActivityIndicator size="small" color={b.card} /> : <Text style={st.sendText}>{initial ? 'Kaydet' : 'Gönder'}</Text>}
        </Pressable>
      </View>
      {err ? <Text style={st.err} accessibilityLiveRegion="polite">{err}</Text> : null}
      {onDone ? <Pressable onPress={onDone} accessibilityRole="button" style={{ alignSelf: 'flex-start', paddingVertical: 4 }}><Text style={st.link}>Vazgeç</Text></Pressable> : null}
    </View>
  );
}

function CommentNode({ c, byParent, byId, postId, focusId }: { c: BulletinComment; byParent: Map<string, BulletinComment[]>; byId: Map<string, BulletinComment>; postId: string; focusId?: string }) {
  const { userId } = useCommunity();
  const refresh = useRefresh(postId);
  const qc = useQueryClient();
  const [reply, setReply] = useState(false);
  const [edit, setEdit] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [picker, setPicker] = useState(false);
  const [people, setPeople] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const del = useDeleteBulletinComment();
  const react = useSetBulletinReaction();
  const kids = byParent.get(c.id) ?? [];
  const parent = c.parentId ? byId.get(c.parentId) : undefined;
  const mine = c.reactions.find((r) => r.selected)?.emoji ?? null;
  const openReact = () => { if (c.deleted) return; if (!userId) return goSignIn(); setPicker(true); };
  const doReact = (emoji: string | null) => react.mutate({ data: { targetType: 'comment', targetId: c.id, emoji } }, {
    onSuccess: () => { setPicker(false); qc.invalidateQueries({ queryKey: getGetBulletinCommentsQueryKey(postId) }); qc.invalidateQueries({ queryKey: getGetBulletinReactionPeopleQueryKey({ targetId: c.id, targetType: 'comment' }) }); },
    onError: (e) => { setPicker(false); setErr(apiError(e)); },
  });
  const action = (label: string, onPress: () => void, id: string, expanded?: boolean) => (
    <Pressable testID={id + '-' + c.id} accessibilityRole="button" accessibilityLabel={label} aria-expanded={expanded} hitSlop={6}
      onPress={() => { tap(); onPress(); }} style={({ pressed }) => [st.act, { opacity: pressed ? 0.6 : 1 }]}>
      <Text style={st.link}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={[c.depth > 1 && st.nested]}>
      <Pressable onLongPress={openReact} delayLongPress={350} accessibilityHint="Uzun basarak tepki ver"
        style={[st.comment, focusId === c.id && st.focus]} testID={'comment-' + c.id}>
        <Avatar person={c.deleted ? null : c.author} size={30} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.name} numberOfLines={1}>{c.deleted ? 'Silinmiş yorum' : c.author.nickname}<Text style={st.time}>  {timeAgo(c.createdAt)}</Text></Text>
          {edit ? <CommentInput postId={postId} placeholder="Yorumunu düzenle..." initial={{ id: c.id, body: c.body }} onDone={() => setEdit(false)} autoFocus testID={'edit-' + c.id} /> : (
            <Text style={[st.body, c.deleted && st.deleted]} selectable>
              {!c.deleted && parent ? <Text style={st.mention}>@{parent.deleted ? 'silinmiş' : parent.author.nickname} </Text> : null}
              {c.deleted ? 'Bu yorum silindi.' : c.body}
            </Text>
          )}
          {!c.deleted ? <ReactionBuckets reactions={c.reactions} onBucket={(e) => setPeople(e)} /> : null}
          {err ? <Text style={st.err}>{err}</Text> : null}
          {!c.deleted && !edit ? (
            <View style={st.acts}>
              {c.depth < 3 ? action('Cevapla', () => { if (!userId) return goSignIn(); setReply((r) => !r); }, 'reply', reply) : null}
              {action(mine ? 'Tepki ' + mine : 'Tepki ver', openReact, 'creact', picker)}
              {c.canEdit ? action('Düzenle', () => setEdit(true), 'cedit') : null}
              {c.canDelete ? action('Sil', () => setConfirm(true), 'cdelete') : null}
            </View>
          ) : null}
          {reply ? <CommentInput postId={postId} parentId={c.id} placeholder={'@' + c.author.nickname + ' kişisine cevap yaz...'} onDone={() => setReply(false)} autoFocus testID={'reply-' + c.id} /> : null}
        </View>
      </Pressable>
      {kids.map((k) => <CommentNode key={k.id} c={k} byParent={byParent} byId={byId} postId={postId} focusId={focusId} />)}
      <ConfirmDelete visible={confirm} busy={del.isPending} onCancel={() => setConfirm(false)} text="Bu yorum silinecek."
        onConfirm={() => del.mutate({ id: c.id }, { onSuccess: () => { setConfirm(false); refresh(); }, onError: (e) => { setConfirm(false); setErr(apiError(e, 'Yorum silinemedi.')); } })} />
      <ReactionPicker visible={picker} onClose={() => setPicker(false)} current={mine} onPick={doReact} busy={react.isPending} />
      <ReactionPeopleSheet target={people ? { id: c.id, type: 'comment' } : null} emoji={people} onClose={() => setPeople(null)} />
    </View>
  );
}

export function CommentsThread({ postId, focusId }: { postId: string; focusId?: string }) {
  const q = useGetBulletinComments(postId, { query: { enabled: !!postId, queryKey: getGetBulletinCommentsQueryKey(postId), refetchInterval: 20000 } });
  const { byParent, byId, roots } = useMemo(() => {
    const list = [...(q.data ?? [])].sort((a, z) => a.createdAt.localeCompare(z.createdAt));
    const byParent = new Map<string, BulletinComment[]>(); const byId = new Map<string, BulletinComment>();
    list.forEach((c) => byId.set(c.id, c));
    const roots: BulletinComment[] = [];
    list.forEach((c) => {
      if (c.parentId && byId.has(c.parentId)) byParent.set(c.parentId, [...(byParent.get(c.parentId) ?? []), c]);
      else roots.push(c);
    });
    return { byParent, byId, roots };
  }, [q.data]);
  return (
    <View style={st.wrap}>
      <Text style={st.heading} accessibilityRole="header">Yorumlar</Text>
      {q.isLoading ? <View style={{ gap: 10 }}>{[0, 1].map((i) => <View key={i} style={st.skel} />)}</View> :
        q.isError ? <View style={{ gap: 8 }}><Text style={st.err}>{apiError(q.error, OFFLINE)}</Text><Btn label="Tekrar dene" ghost onPress={() => q.refetch()} testID="comments-retry" /></View> :
        roots.length === 0 ? <Text style={st.empty}>Henüz yorum yok. Sohbeti sen başlat.</Text> :
        roots.map((c) => <CommentNode key={c.id} c={c} byParent={byParent} byId={byId} postId={postId} focusId={focusId} />)}
      <CommentInput postId={postId} placeholder="Yorumunu yaz..." testID="root-comment" />
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { backgroundColor: b.card, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: b.border },
  heading: { fontFamily: F.serifBold, fontSize: 18, color: b.text, marginBottom: 8 },
  nested: { marginLeft: 12, paddingLeft: 8, borderLeftWidth: 1.5, borderColor: b.gold },
  comment: { flexDirection: 'row', gap: 8, paddingVertical: 8 },
  focus: { backgroundColor: b.input, borderRadius: 10, paddingHorizontal: 6 },
  name: { fontFamily: F.semi, fontSize: 13, color: b.text },
  time: { fontFamily: F.body, fontSize: 11, color: b.muted },
  body: { fontFamily: F.body, fontSize: 14, lineHeight: 20, color: b.text, marginTop: 2 },
  deleted: { fontStyle: 'italic', color: b.muted },
  mention: { fontFamily: F.semi, color: b.gold },
  acts: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 },
  act: { minHeight: 30, justifyContent: 'center' },
  link: { fontFamily: F.semi, fontSize: 12, color: b.muted },
  inputRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-end' },
  input: { flex: 1, minHeight: 42, maxHeight: 120, backgroundColor: b.background, borderRadius: 14, borderWidth: 1, borderColor: b.border, paddingHorizontal: 12, paddingVertical: 10, fontFamily: F.body, fontSize: 14, color: b.text },
  send: { minHeight: 42, paddingHorizontal: 14, borderRadius: 14, backgroundColor: b.text, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: b.card, fontFamily: F.semi, fontSize: 13 },
  err: { color: b.danger, fontFamily: F.med, fontSize: 12, marginTop: 4 },
  empty: { fontFamily: F.body, fontSize: 14, color: b.muted, paddingVertical: 10 },
  skel: { height: 48, borderRadius: 10, backgroundColor: b.input },
});
